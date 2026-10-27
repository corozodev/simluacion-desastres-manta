// Local integration only: real React + Go, independent browser session stores.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
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
const evidence = process.env.SIMULATION_BROWSER_EVIDENCE_DIR;
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
      SIM_AUTOSTART: 'false', SIM_MAX_ACTIVE: '2', SIM_MAX_FULL_ACTIVE: '1', ENABLE_FULL_MODE: 'false',
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
    cwd: path.join(root, 'apps/web'), stdio: 'ignore', env: { ...process.env, VITE_WORLD_API_BASE_URL: api, VITE_OSM_TILES_ENABLED: 'false' },
  });
  processes.push(web);
  await waitFor(async () => { try { return (await fetch(origin, { signal: AbortSignal.timeout(500) })).ok; } catch { return false; } }, 'Vite readiness');
  browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
  const a = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const b = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pageA = await a.newPage(); const pageB = await b.newPage();
  const counts = { a: 0, b: 0 };
  const privileged = [], errors = [];
  for (const [name, page] of [['a', pageA], ['b', pageB]]) {
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (request.url().startsWith(api)) {
        const url = new URL(request.url());
        if (request.method() === 'POST' && url.pathname === '/v1/simulations') counts[name]++;
        if (request.headers()['x-api-key'] || url.pathname === '/paso' || url.search.includes('token')) privileged.push(url.pathname);
      }
    });
    await page.goto(`${origin}/escape`);
    await expect(page.getByRole('button', { name: 'Iniciar simulación', exact: true })).toBeEnabled();
    await expect(page.locator('.escape-survivor, .escape-zombie')).toHaveCount(0);
  }
  assert.deepEqual(counts, { a: 0, b: 0 }, 'Opening pages created a session');
  if (evidence) await pageA.screenshot({ path: path.join(evidence, 'exploration-desktop.png'), fullPage: true });
  assert.equal((await (await fetch(`${api}/estado`)).json()).turn, 0, 'Legacy startup advanced');
  await pageA.getByText('Configuración avanzada', { exact: true }).click();
  await pageA.getByLabel('Turnos máximos').fill('8');
  await pageA.getByText('Configuración avanzada', { exact: true }).click();
  const createdA = pageA.waitForResponse(response => response.url() === `${api}/v1/simulations` && response.request().method() === 'POST');
  await pageA.getByRole('button', { name: 'Iniciar simulación', exact: true }).dblclick();
  const credentialsA = await (await createdA).json();
  await expect(pageA.getByLabel('Tu simulación')).toBeVisible();
  await pageA.getByRole('button', { name: 'Pausar', exact: true }).click();
  await expect(pageA.getByLabel('Tu simulación')).toContainText('Pausada');
  if (evidence) await pageA.screenshot({ path: path.join(evidence, 'session-paused-desktop.png'), fullPage: true });
  const headersA = { Authorization: `Bearer ${credentialsA.access_token}` };
  const stateA = async () => (await fetch(`${api}/v1/simulations/${credentialsA.simulation_id}/state`, { headers: headersA })).json();
  const paused = await stateA();
  assert.equal(paused.tick_interval_ms, 2000);
  await pageB.getByLabel('Agentes', { exact: true }).fill('5');
  await pageB.getByText('Configuración avanzada', { exact: true }).click();
  await pageB.getByLabel('Turnos máximos').fill('2');
  await pageB.getByText('Configuración avanzada', { exact: true }).click();
  const createdB = pageB.waitForResponse(response => response.url() === `${api}/v1/simulations` && response.request().method() === 'POST');
  await pageB.getByRole('button', { name: 'Iniciar simulación', exact: true }).click();
  const credentialsB = await (await createdB).json();
  assert.notEqual(credentialsA.simulation_id, credentialsB.simulation_id);
  assert.equal(credentialsA.access_token !== credentialsB.access_token, true, 'Sessions reused a credential');
  const unauthorized = await fetch(`${api}/v1/simulations/${credentialsA.simulation_id}/state`, { headers: { Authorization: `Bearer ${credentialsB.access_token}` } });
  assert.equal(unauthorized.status, 401, 'One browser controlled another session');
  const third = await fetch(`${api}/v1/simulations`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ scenario: 'zombie_outbreak', graph_profile: 'BASE' }) });
  assert.equal(third.status, 503, 'Paused session did not retain capacity');
  await pageA.reload();
  await expect(pageA.getByLabel('Tu simulación')).toContainText('Pausada');
  await expect(pageB.getByLabel('Resultados de simulación')).toContainText('Finalizada', { timeout: 12_000 });
  if (evidence) await pageB.screenshot({ path: path.join(evidence, 'results-mobile.png'), fullPage: true });
  assert.equal((await stateA()).tick, paused.tick, 'Paused session advanced while another ran');
  assert.equal((await stateA()).snapshot.survivors.length, 20);
  const headersB = { Authorization: `Bearer ${credentialsB.access_token}` };
  const stateB = await (await fetch(`${api}/v1/simulations/${credentialsB.simulation_id}/state`, { headers: headersB })).json();
  assert.equal(stateB.snapshot.survivors.length, 5);
  assert.equal(stateB.status, 'COMPLETED');
  assert.equal(await pageB.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile viewport overflow');
  await pageA.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(pageA.getByLabel('Tu simulación')).toContainText('En ejecución');
  await a.close();
  await waitFor(async () => (await stateA()).status === 'COMPLETED', 'Backend execution without browser', 20_000);
  assert.deepEqual(counts, { a: 1, b: 1 }, 'Refresh or double click duplicated creation');
  assert.equal((await (await fetch(`${api}/estado`)).json()).turn, 0, 'Session changed legacy world');
  for (const credential of [credentialsA.access_token, credentialsB.access_token]) assert.equal(logs.includes(credential), false, 'Credential leaked to server logs');
  assert.deepEqual(privileged, []);
  assert.deepEqual(errors, []);
  // FASE 7 selectors must reach the real engine, with immutable active policy.
  const proContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const proPage = await proContext.newPage();
  proPage.on('pageerror', error => errors.push(error.message));
  await proPage.goto(`${origin}/escape`);
  await expect(proPage.getByRole('button', { name: 'Iniciar simulación', exact: true })).toBeEnabled();
  await proPage.getByRole('combobox', { name: /^Ronda/ }).selectOption('round3');
  await proPage.getByLabel('Agentes', { exact: true }).fill('8');
  await proPage.getByText('Configuración avanzada', { exact: true }).click();
  await proPage.getByLabel('Turnos máximos').fill('2');
  await proPage.getByLabel('Política de zombis').selectOption('adaptive_exploration');
  await proPage.getByLabel('Algoritmo de evacuación').selectOption('predictive_temporal_astar');
  await proPage.getByLabel('Flota de rescate · experimental').check();
  await proPage.getByText('Configuración avanzada', { exact: true }).click();
  const proCreated = proPage.waitForResponse(response => response.url() === `${api}/v1/simulations` && response.request().method() === 'POST');
  await proPage.getByRole('button', { name: 'Iniciar simulación', exact: true }).click();
  const proCredentials = await (await proCreated).json();
  assert.equal(proCredentials.config.zombie_policy, 'adaptive_exploration');
  assert.equal(proCredentials.config.evacuation_algorithm, 'predictive_temporal_astar');
  assert.equal(proCredentials.config.pro.rescue_fleet, true);
  await proPage.getByRole('button', { name: 'Pausar', exact: true }).click();
  await expect(proPage.getByLabel('Tu simulación')).toContainText('Pausada');
  await expect(proPage.getByLabel('Configuración de simulación', { exact: true })).toHaveCount(0);
  await expect(proPage.getByLabel('Política de zombis')).toHaveCount(0);
  if (evidence) await proPage.screenshot({ path: path.join(evidence, 'phase7-fleet-mobile.png'), fullPage: true });
  await proPage.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(proPage.getByLabel('Resultados de simulación')).toContainText('Finalizada', { timeout: 12_000 });
  assert.equal(await proPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'PRO mobile viewport overflow');
  const compareContext = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  const comparePage = await compareContext.newPage();
  comparePage.on('pageerror', error => errors.push(error.message));
  const comparisonInputs = [];
  comparePage.on('request', request => {
    if (request.method() === 'POST' && request.url() === `${api}/v1/simulations`) comparisonInputs.push(request.postDataJSON());
    if (request.url().startsWith(api)) assert.equal(Boolean(request.headers()['x-api-key']), false);
  });
  await comparePage.goto(`${origin}/escape`);
  await expect(comparePage.getByRole('button', { name: 'Iniciar simulación', exact: true })).toBeEnabled();
  await comparePage.getByLabel('Agentes', { exact: true }).fill('5');
  await comparePage.getByText('Configuración avanzada', { exact: true }).click();
  await comparePage.getByLabel('Turnos máximos').fill('2');
  await comparePage.getByText('Configuración avanzada', { exact: true }).click();
  await comparePage.getByText('Laboratorio comparativo', { exact: true }).click();
  assert.equal(comparisonInputs.length, 0, 'Opening comparison started sessions');
  await comparePage.getByRole('button', { name: 'Ejecutar comparación', exact: true }).click();
  await expect(comparePage.getByRole('button', { name: 'Repetir comparación y semillas', exact: true })).toBeVisible({ timeout: 25_000 });
  assert.equal(comparisonInputs.length, 2, 'Comparison must create two explicit independent sessions');
  const [inputA, inputB] = comparisonInputs.map(input => structuredClone(input));
  delete inputA.config.evacuation_algorithm; delete inputB.config.evacuation_algorithm;
  assert.deepEqual(inputA, inputB, 'Comparison changed initial conditions');
  await expect(comparePage.getByRole('table', { name: /Resultados observados/ })).toContainText('COMPLETED / 2');
  const downloaded = comparePage.waitForEvent('download');
  await comparePage.getByRole('button', { name: 'Exportar JSON', exact: true }).click();
  const exported = JSON.parse(await readFile(await (await downloaded).path(), 'utf8'));
  assert.equal(exported.results.length, 2);
  assert(exported.results.every(row => row.analytics?.agents.length === 5));
  assert.equal(JSON.stringify(exported).includes('access_token'), false, 'Export leaked comparison secrets');
  if (evidence) await comparePage.screenshot({ path: path.join(evidence, 'phase7-comparison-desktop.png'), fullPage: true });
  assert.deepEqual(errors, []);
  assert.equal(logs.includes(proCredentials.access_token), false);
  await proContext.close(); await compareContext.close();
  await stop(server.child);
  await startServer(new URL(api).host);
  await pageB.reload();
  await expect(pageB.getByText(/Tu simulación ya no está disponible/)).toBeVisible();
  await expect(pageB.getByRole('button', { name: 'Iniciar simulación', exact: true })).toBeEnabled();
  assert.equal(counts.b, 1, 'Process restart caused automatic creation');
  console.log('React → Go real: exploración sin arranque, doble clic único, dos navegadores aislados, Bearer privado, pausa/recarga/reanudación, capacidad, resultados, ejecución sin navegador y recuperación tras reinicio; móvil sin desborde; FASE7 políticas reales/flota, bloqueo activo y comparación explícita con exportación sin credenciales.');
} finally {
  if (browser) await browser.close();
  for (const child of processes.reverse()) await stop(child);
  await rm(temporary, { recursive: true, force: true });
}
