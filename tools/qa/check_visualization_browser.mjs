// Local integration only: real React + Go, independent browser session stores.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const backend = path.join(root, 'services/evacuation');
const temporary = await mkdtemp(path.join(tmpdir(), 'corodev-session-browser-'));
const processes = [];
const evidence = process.env.VISUALIZATION_EVIDENCE_DIR || path.join(root, `deploy/evidence-private/mantasim-mapfirst-visuals-${Date.now()}`);
let browser;
let logs = '';
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  await exited;
  clearTimeout(timer);
}
async function unusedPort() {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  return port;
}
async function waitFor(check, label, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
}
try {
  if (evidence) await mkdir(evidence, { recursive: true });
  const go = process.env.GO_BIN || (existsSync('/usr/local/go/bin/go') ? '/usr/local/go/bin/go' : 'go');
  const binary = path.join(temporary, 'server');
  const build = spawn(go, ['build', '-o', binary, './cmd/server'], { cwd: backend, stdio: 'inherit' });
  assert.equal((await once(build, 'exit'))[0], 0, 'Go build failed');
  const webPort = await unusedPort();
  const origin = `http://127.0.0.1:${webPort}`;
  async function startServer(address = '127.0.0.1:0') {
    const child = spawn(binary, [], { cwd: backend, stdio: ['ignore', 'pipe', 'pipe'], env: {
      ...process.env, API_KEY: randomBytes(32).toString('hex'), LISTEN_ADDR: address, CORS_ORIGINS: origin,
      SIM_AUTOSTART: 'false', SIM_MAX_ACTIVE: '2', SIM_MAX_FULL_ACTIVE: '1', ENABLE_FULL_MODE: 'true',
      SIM_RATE_LIMIT_PER_MINUTE: '1000', SIM_CREATE_LIMIT_PER_MINUTE: '100',
      ADMIN_OPERATOR: '', ADMIN_ACCESS_HASH: '',
    } });
    processes.push(child);
    child.stderr.resume();
    const url = await new Promise((resolve, reject) => {
      let buffer = '';
      const timer = setTimeout(() => reject(new Error('Go readiness timed out')), 15_000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Go exited before ready')); });
      child.stdout.on('data', data => {
        logs += data.toString(); buffer += data.toString();
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
          try { const record = JSON.parse(line); if (record.msg === 'backend ready') { clearTimeout(timer); resolve(record.url); } } catch { /* Structured log records only. */ }
        }
      });
    });
    return { child, url };
  }
  const server = await startServer();
  const api = server.url;
  const web = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], {
    cwd: path.join(root, 'apps/web'), stdio: 'ignore', env: { ...process.env, VITE_WORLD_API_BASE_URL: api, VITE_OSM_TILES_ENABLED: 'false', VITE_INCIDENTS_API_BASE_URL: api, VITE_FLOOD_API_BASE_URL: api },
  });
  processes.push(web);
  await waitFor(async () => { try { return (await fetch(origin, { signal: AbortSignal.timeout(500) })).ok; } catch { return false; } }, 'Vite readiness');
  browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
  const measurements = [];
  const errors = [];
  const forbidden = [];
  const contexts = [];
  for (const [name, viewport, scenario, profile] of [
    ['zombie-desktop', { width: 1440, height: 1100 }, 'zombie_outbreak', 'BASE'],
    ['flood-mobile', { width: 390, height: 844 }, 'urban_flood', 'FULL_MANTA'],
  ].filter(item => !process.env.VISUALIZATION_SCENARIO || item[2] === process.env.VISUALIZATION_SCENARIO)) {
    const context = await browser.newContext({ viewport }); contexts.push(context);
    const page = await context.newPage();
    let creates = 0, explicitApiCreates = 0;
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname === '/v1/simulations' && request.method() === 'POST') creates++;
      if (url.pathname === '/paso' || url.search.includes('token') || request.headers()['x-api-key']) forbidden.push(url.pathname);
    });
    await page.goto(`${origin}/escape`);
    await expect(page.getByRole('button', { name: 'Iniciar simulación', exact: true })).toBeEnabled();
    await expect(page.locator('[data-display-key]')).toHaveCount(0);
    assert.equal(creates, 0);
    let credentials;
    if (scenario === 'zombie_outbreak') {
      await page.getByLabel('Profundidad del grafo').selectOption(profile);
      await page.getByLabel('Agentes', { exact: true }).fill('80');
      await page.getByText('Configuración avanzada', { selector: 'summary', exact: true }).click();
      await page.getByLabel('Turnos máximos').fill('12');
      await page.getByText('Configuración avanzada', { selector: 'summary', exact: true }).click();
      const response = page.waitForResponse(r => r.url() === `${api}/v1/simulations` && r.request().method() === 'POST');
      await page.getByRole('button', { name: 'Iniciar simulación', exact: true }).click();
      credentials = await (await response).json();
    } else {
      // The zombie route intentionally has no threat selector. Exercise its
      // supported recovery observer using a legitimately created flood session.
      const response = await fetch(`${api}/v1/simulations`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ scenario, graph_profile: profile, seed: 20261026, max_ticks: 12, tick_interval_ms: 2000, config: { survivors: 80, round: 'round1', rainfall_intensity: .8 } }) });
      assert.equal(response.status, 201);
      credentials = await response.json(); explicitApiCreates++;
      await page.evaluate(value => sessionStorage.setItem('corodev.simulation-session.v1', JSON.stringify(value)), { simulation_id: credentials.simulation_id, access_token: credentials.access_token, endpoint: api });
      await page.reload();
    }
    assert.equal(credentials.tick_interval_ms, 2000);
    const current = async () => (await fetch(`${api}/v1/simulations/${credentials.simulation_id}/state`, { headers: { Authorization: `Bearer ${credentials.access_token}` } })).json();
    await expect(page.locator('[data-display-key]').first()).toBeVisible();
    if (scenario === 'urban_flood') await waitFor(async () => (await current()).tick >= 6, 'Flood exposure after six actual turns', 20_000);
    const stateForSelection = await current();
    const selectedAgent = scenario === 'urban_flood' ? stateForSelection.scenario_state.agents.find(agent => agent.planned_route.length > 1) : stateForSelection.snapshot.survivors.find(agent => agent.planned_route.length > 1);
    assert.ok(selectedAgent, 'Real engine must publish a selectable route');
    await page.getByRole('button', { name: 'Refugios y agentes', exact: true }).click();
    await page.getByRole('tab', { name: /Supervivientes/ }).click();
    await page.getByRole('searchbox', { name: 'Buscar por ID', exact: true }).fill(selectedAgent.id);
    await page.getByRole('button', { name: `Ver ruta de ${selectedAgent.id}`, exact: true }).click();
    await page.getByRole('button', { name: 'Cerrar refugios y agentes', exact: true }).click();
    const map = page.getByRole('img', { name: scenario === 'urban_flood' ? /^Red urbana de inundación/ : /^Red de evacuación/ });
    await map.scrollIntoViewIfNeeded();
    const selectedMarker = page.locator(`[data-agent-id="${selectedAgent.id}"]`);
    await expect(selectedMarker).toBeVisible();
    // Use the available natural camera gestures to inspect the selected atlas.
    for (let zoom = 0; zoom < 2; zoom++) {
      const box = await selectedMarker.boundingBox(); assert.ok(box);
      await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    }
    await expect(selectedMarker.locator('[data-sprite]')).toBeVisible();
    await page.locator('summary').filter({ hasText: /^Visualización$/ }).click();
    // Measure actual browser RAF intervals and DOM/heap; this is not a guaranteed paint FPS.
    const sample = await page.evaluate(async () => {
      const intervals = []; let previous; const start = performance.now();
      await new Promise(resolve => { function frame(now) { if (previous !== undefined) intervals.push(now - previous); previous = now; if (now - start < 2500) requestAnimationFrame(frame); else resolve(); } requestAnimationFrame(frame); });
      intervals.sort((a, b) => a - b);
      return { samples: intervals.length, raf_p50_ms: intervals[Math.floor(intervals.length * .5)], raf_p95_ms: intervals[Math.floor(intervals.length * .95)], dom: document.querySelectorAll('*').length, displayed: document.querySelectorAll('[data-display-key]').length };
    });
    const cdp = await context.newCDPSession(page); await cdp.send('Performance.enable');
    const metrics = await cdp.send('Performance.getMetrics');
    measurements.push({ scenario, profile, viewport, ...sample, js_heap_bytes: metrics.metrics.find(m => m.name === 'JSHeapUsedSize')?.value });
    // Zoom LOD and opt-out do not mutate state or cause control requests.
    await page.getByRole('checkbox', { name: 'Animaciones', exact: true }).uncheck();
    await expect(page.locator('[data-layer="animated-entities"]')).toHaveAttribute('data-animation-active', 'false');
    await page.getByRole('checkbox', { name: 'Animaciones', exact: true }).check();
    await page.getByRole('button', { name: 'Pausar', exact: true }).click();
    await expect(page.getByLabel('Tu simulación')).toContainText('Pausada');
    const paused = await current();
    const transforms = await page.locator('[data-display-key]').evaluateAll(elements => elements.map(e => e.getAttribute('transform')));
    await delay(600);
    assert.deepEqual(await page.locator('[data-display-key]').evaluateAll(elements => elements.map(e => e.getAttribute('transform'))), transforms);
    assert.equal((await current()).tick, paused.tick);
    await map.screenshot({ path: path.join(evidence, `${name}-close-paused.png`) });
    await page.screenshot({ path: path.join(evidence, `${name}-page.png`), fullPage: true });
    if (scenario === 'urban_flood') { await expect(page.locator('[data-layer=exposure] circle').first()).toBeAttached(); await map.screenshot({ path: path.join(evidence, `${name}-exposure.png`) }); }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.getByText(/Movimiento reducido: efectos detenidos/)).toBeVisible();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.getByRole('button', { name: 'Restablecer vista', exact: true }).click();
    await map.screenshot({ path: path.join(evidence, `${name}-overview.png`) });
    if (!await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)) {
      console.log('Overflow elements', await page.evaluate(() => [...document.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > innerWidth + 1 && e.getBoundingClientRect().width > 0).map(e => ({ tag: e.tagName, class: e.getAttribute('class'), width: e.getBoundingClientRect().width, right: e.getBoundingClientRect().right, text: e.textContent?.slice(0, 80) })).slice(0, 20)));
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} overflow`);
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByLabel('Tu simulación')).toContainText('En ejecución');
    await context.setOffline(true);
    await expect(page.locator('[data-layer="animated-entities"]')).toHaveAttribute('data-animation-active', 'false');
    await context.setOffline(false);
    await page.reload();
    await page.getByText('Configuración e información técnica', { selector: 'summary', exact: true }).click();
    await expect(page.locator('details').filter({ has: page.getByText('Configuración e información técnica', { selector: 'summary', exact: true }) })).toContainText(credentials.simulation_id);
    assert.equal(creates + explicitApiCreates, 1, 'Refresh created another simulation');
    await expect(page.getByLabel('Resultados de simulación')).toContainText('Finalizada', { timeout: 35_000 });
    await expect(page.locator('[data-layer="animated-entities"]')).toHaveAttribute('data-animation-active', 'false');
    const final = await current();
    assert.equal(final.status, 'COMPLETED');
    // Capture both viewport sizes for each real scenario.
    await page.setViewportSize(viewport.width === 390 ? { width: 1440, height: 1100 } : { width: 390, height: 844 });
    await map.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(evidence, `${name}-alternate-viewport-final.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  assert.equal(logs.includes('access_token'), false, 'Server logs exposed credential fields');
  assert.deepEqual(errors, []); assert.deepEqual(forbidden, []);
  await writeFile(path.join(evidence, 'browser-measurements.json'), JSON.stringify({ date: '2026-10-27', note: 'Local Chromium RAF scheduling intervals, not guaranteed paint FPS. Real Go snapshots; zombie UI explicit creation, managed flood via explicit real API creation and session recovery. No runtime fixtures. Raster disabled.', measurements }, null, 2) + '\n');
  console.log(JSON.stringify({ checks: 'Real React/Go zombie BASE + flood FULL_MANTA; explicit start, SVG atlases, LOD, opt-out, pause/resume, offline, reduced motion, reload, completion; desktop/mobile screenshots and measured RAF/DOM/heap', evidence, measurements }));
} finally {
  if (browser) await browser.close();
  for (const child of processes.reverse()) await stop(child);
  await rm(temporary, { recursive: true, force: true });
}
