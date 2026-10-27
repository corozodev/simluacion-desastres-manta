// Real Go + Chromium control/preview integration. No AWS calls or lasting keys.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const backend = path.join(root, 'services/evacuation');
const temporary = await mkdtemp(path.join(tmpdir(), 'corodev-multigraph-'));
const origin = 'http://127.0.0.1:5178';
const code = randomBytes(32).toString('base64url');
const processes = [];
let browser;
const report = { phase: '3B.2', recorded_at: new Date().toISOString(), source: 'Local real Go HTTP and Chromium; not production or AWS hardware', checks: {}, browser: {} };
try {
  const binary = path.join(temporary, 'server');
  const build = spawn(process.env.GO_BIN || '/usr/local/go/bin/go', ['build', '-o', binary, './cmd/server'], { cwd: backend, stdio: 'inherit' });
  if ((await once(build, 'exit'))[0] !== 0) throw new Error('Go build failed');
  const server = spawn(binary, [], { cwd: backend, stdio: ['ignore', 'pipe', 'pipe'], env: {
    ...process.env, API_KEY: randomBytes(32).toString('hex'), LISTEN_ADDR: '127.0.0.1:0',
    GRAPH_PATH: 'data/manta-v2.json', SCENARIO_PATH: 'scenarios/urban/round1.json',
    SIM_AUTOSTART: 'false', SIM_INTERVAL: '10ms', SIM_CONCURRENCY: '16',
    ENABLE_FULL_MODE: 'true', ENABLE_EXPANDED_MODE: 'false',
    ADMIN_OPERATOR: 'local-test', ADMIN_ACCESS_HASH: createHash('sha256').update(code).digest('hex'),
    ADMIN_ALLOW_INSECURE_LOOPBACK: 'true', CORS_ORIGINS: origin,
  } });
  processes.push(server);
  server.stderr.resume();
  const base = await new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('Go readiness timed out')), 15000);
    server.once('exit', () => { clearTimeout(timer); reject(new Error('Go exited')); });
    server.stdout.on('data', data => {
      buffer += data;
      for (let newline; (newline = buffer.indexOf('\n')) >= 0;) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        try { const record = JSON.parse(line); if (record.msg === 'backend ready') { clearTimeout(timer); resolve(record.url); } } catch { /* Structured records only. */ }
      }
    });
  });
  const initial = await (await fetch(`${base}/simulation`)).json();
  const unauth = await fetch(`${base}/admin/runs`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'full', round: 'round1', seed: 20261026, expected_run_id: initial.run_id }) });
  if (unauth.status !== 401) throw new Error('Public administrative mutation accepted');
  report.checks.unauthenticated_start_401 = true;
  const web = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5178', '--strictPort'], { cwd: path.join(root, 'apps/web'), stdio: 'ignore', env: { ...process.env, VITE_WORLD_API_BASE_URL: base } });
  processes.push(web);
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(origin)).ok) { ready = true; break; } } catch { /* wait */ }
    await delay(50);
  }
  if (!ready) throw new Error('Vite readiness failed');
  browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [], leaks = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.headers()['x-api-key']) leaks.push('movement credential'); });
  await page.goto(`${origin}/escape`);
  await expect(page.locator('.escape-road')).toHaveCount(383);
  await expect(page.getByText('Visita pública: solo lectura.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Iniciar ronda seleccionada' })).toHaveCount(0);
  const previewStart = performance.now();
  await page.getByLabel('Previsualizar cobertura').selectOption('full');
  await expect(page.locator('.escape-road')).toHaveCount(13452, { timeout: 15000 });
  report.browser.full_preview_load_to_render_ms = performance.now() - previewStart;
  await expect(page.locator('.escape-survivor, .escape-zombie, .escape-planned-route')).toHaveCount(0);
  if ((await (await fetch(`${base}/simulation`)).json()).run_id !== initial.run_id) throw new Error('Preview changed the active run');
  report.checks.preview_does_not_activate_or_mix_positions = true;
  const map = page.getByRole('img', { name: /Red de evacuación/ });
  const view = await map.getAttribute('viewBox');
  const interactionStart = performance.now();
  await page.getByRole('button', { name: 'Acercar mapa', exact: true }).click();
  await expect(map).not.toHaveAttribute('viewBox', view);
  await page.getByRole('button', { name: 'Restablecer mapa', exact: true }).click();
  await expect(map).toHaveAttribute('viewBox', view);
  report.browser.full_preview_zoom_reset_ms = performance.now() - interactionStart;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = await cdp.send('Performance.getMetrics');
  report.browser.full_preview_js_heap_used_bytes = metrics.metrics.find(m => m.name === 'JSHeapUsedSize')?.value;
  report.browser.dom_nodes = await page.locator('*').count();
  const directory = process.env.MULTIGRAPH_EVIDENCE_DIR;
  if (directory) { await mkdir(directory, { recursive: true, mode: 0o700 }); await page.screenshot({ path: path.join(directory, 'full-preview-desktop.png'), fullPage: true }); }
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Full preview overflows on mobile');
  if (directory) await page.screenshot({ path: path.join(directory, 'full-preview-mobile.png'), fullPage: true });
  report.checks.full_preview_13452_roads_zoom_reset_mobile = true;
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByText('Acceso de operador', { exact: true }).click();
  await page.getByLabel('Operador', { exact: true }).fill('local-test');
  await page.getByLabel('Código de acceso').fill(code);
  await page.getByRole('button', { name: 'Acceder', exact: true }).click();
  const start = page.getByRole('button', { name: 'Iniciar ronda seleccionada' });
  await expect(start).toBeEnabled();
  if (await page.evaluate(() => Object.values(localStorage).length + Object.values(sessionStorage).length)) throw new Error('Browser persisted administrative material');
  await start.click();
  await expect(page.getByText('En ejecución', { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(start).toBeDisabled();
  await expect(page.locator('.escape-road')).toHaveCount(13452);
  await expect(page.getByText('Previsualización.', { exact: true })).toHaveCount(0);
  report.checks.authenticated_full_start_and_active_lock = true;
  await expect(page.getByText('Finalizada', { exact: true })).toBeVisible({ timeout: 120000 });
  const final = await (await fetch(`${base}/estado`)).json();
  if (final.simulation.mode !== 'full' || final.turn !== 150 || final.survivors.length !== 20) throw new Error('Full run did not finish with the reviewed configuration');
  const saved = await fetch(`${base}/runs/${final.simulation.run_id}/estado`);
  if (saved.status !== 200) throw new Error('Final state was not retained');
  report.checks.full_run_150_turns_and_retained_snapshot = true;
  await page.getByLabel('Previsualizar cobertura').selectOption('competition');
  await expect(page.locator('.escape-road')).toHaveCount(383);
  await expect(page.locator('.escape-survivor, .escape-zombie, .escape-planned-route')).toHaveCount(0);
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await expect(start).toHaveCount(0);
  report.checks.logout_returns_read_only = true;
  report.browser.javascript_errors = errors;
  report.browser.privileged_movement_requests = leaks.length;
  report.accelerated_run_interval_ms = 10;
  if (errors.length || leaks.length) throw new Error('Browser errors or movement credentials detected');
  if (directory) await writeFile(path.join(directory, 'browser.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (browser) await browser.close();
  for (const child of processes.reverse()) {
    if (child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, 'exit'); child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      await stopped; clearTimeout(timer);
    }
  }
  await rm(temporary, { recursive: true, force: true });
}
