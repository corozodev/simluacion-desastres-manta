// Actual React + Go browser integration. Device profiles use Chromium, not iOS.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, devices, expect } from '@playwright/test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const backend = path.join(root, 'services/evacuation');
const temporary = await mkdtemp(path.join(tmpdir(), 'mantasim-mobile-'));
const evidence = process.env.MOBILE_EVIDENCE_DIR || path.join(root, 'deploy/evidence-private/mobile-spectators');
const children = [];
let browser;
const report = { recorded_at: new Date().toISOString(), source: 'Real local Go HTTP + React + Chromium', safari_real: 'Not available; iPhone viewport uses Chromium only', raster_tiles: 'Disabled; checked-in real OSM vectors remain visible', checks: [], screenshots: [], errors: [] };
async function port() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const value = server.address().port; await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); return value;
}
async function build(command, target) {
  const go = process.env.GO_BIN || (existsSync('/usr/local/go/bin/go') ? '/usr/local/go/bin/go' : 'go');
  const child = spawn(go, ['build', '-o', target, command], { cwd: backend, stdio: 'inherit' });
  assert.equal((await once(child, 'exit'))[0], 0, command);
}
async function start(binary, args, env, ready) {
  const child = spawn(binary, args, { cwd: backend, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } }); children.push(child); child.stderr.resume();
  const url = await new Promise((resolve, reject) => {
    let buffer = ''; const timer = setTimeout(() => reject(new Error('Go readiness timeout')), 20000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Go exit ${code}`)); });
    child.stdout.on('data', chunk => { buffer += chunk.toString(); for (let index; (index = buffer.indexOf('\n')) >= 0;) { const line = buffer.slice(0, index); buffer = buffer.slice(index + 1); try { const value = JSON.parse(line); if (ready(value)) { clearTimeout(timer); resolve(value.url); } } catch { /* No runtime logs or credentials. */ } } });
  });
  return { child, url };
}
async function until(check, label) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { if (await check()) return; await delay(100); }
  throw new Error(`Timeout: ${label}`);
}
const json = async url => (await fetch(url, { signal: AbortSignal.timeout(10000) })).json();
async function screenshot(page, name) { const file = path.join(evidence, `${name}.png`); await page.screenshot({ path: file, fullPage: true }); report.screenshots.push(file); }
async function geometry(page, name) {
  await expect(page.locator('.mobile-content:not([hidden]) .map-stage > svg')).toBeVisible();
  const value = await page.evaluate(() => {
    const content = [...document.querySelectorAll('.mobile-content')].find(element => !element.hidden);
    const map = content?.querySelector('.map-stage > svg')?.getBoundingClientRect();
    return { width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth, map: map && { x: map.x, y: map.y, width: map.width, height: map.height }, roads: content?.querySelectorAll('.escape-road[d],path[data-road-state][d]').length ?? 0 };
  });
  report.geometry ??= []; report.geometry.push({ name, ...value });
  assert.equal(value.overflow, false, `${name} horizontal overflow`); assert.ok(value.map?.width > 200 && value.map.height >= 300 && value.map.y < (name.includes('Flood') ? 320 : 250), `${name} map-first usable viewport`); assert.ok(value.roads > 0, `${name} actual streets`);
  return value;
}
try {
  await mkdir(evidence, { recursive: true, mode: 0o700 });
  const webPort = await port(), origin = `http://127.0.0.1:${webPort}`;
  const worldBinary = path.join(temporary, 'world'), floodBinary = path.join(temporary, 'flood');
  await build('./cmd/server', worldBinary); await build('./cmd/flood-lab', floodBinary);
  const world = await start(worldBinary, [], { API_KEY: randomBytes(32).toString('hex'), LISTEN_ADDR: '127.0.0.1:0', CORS_ORIGINS: origin, SIM_AUTOSTART: 'false', SIM_RATE_LIMIT_PER_MINUTE: '1000', SIM_CREATE_LIMIT_PER_MINUTE: '100' }, value => value.msg === 'backend ready');
  const flood = await start(floodBinary, ['-listen', '127.0.0.1:0', '-origin', origin, '-incident-dir', path.join(temporary, 'incidents'), '-reference-cache', path.join(temporary, 'reference.json')], {}, value => value.event === 'ready');
  const web = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], { cwd: path.join(root, 'apps/web'), stdio: 'ignore', env: { ...process.env, VITE_WORLD_API_BASE_URL: world.url, VITE_FLOOD_API_BASE_URL: flood.url, VITE_INCIDENTS_API_BASE_URL: flood.url, VITE_OSM_TILES_ENABLED: 'false' } }); children.push(web);
  await until(async () => { try { return (await fetch(origin)).ok; } catch { return false; } }, 'Vite ready');
  browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
  const mobile = await browser.newContext({ ...devices['iPhone 13'], defaultBrowserType: undefined, reducedMotion: 'reduce' });
  const phone = await mobile.newPage();
  const posts = [], modules = [], geography = [], observed = [], observedFlood = [];
  phone.on('pageerror', error => report.errors.push(error.message));
  phone.on('request', request => { const url = new URL(request.url()); if (request.method() === 'POST') posts.push(url.pathname); if (url.pathname.includes('/src/')) modules.push(url.pathname); if (url.pathname === '/grafo' || url.pathname === '/lab/graph') geography.push(request.url()); assert.ok(!request.headers()['x-api-key'], 'No private engine credentials'); });
  phone.on('response', async response => { if (response.url().endsWith('/v1/simulations/published/zombie_outbreak') && response.status() === 200) { try { observed.push(await response.json()); } catch { /* Navigation may cancel reading an old response body. */ } } });
  phone.on('response', async response => { if (response.url().endsWith('/lab/published') && response.status() === 200) { try { observedFlood.push(await response.json()); } catch { /* Navigation can cancel an old read. */ } } });
  await phone.goto(`${origin}/mobile`);
  await expect(phone.getByText('Sin simulación activa', { exact: true })).toBeVisible();
  await expect(phone.getByRole('img', { name: /Red de evacuación/ })).toBeVisible();
  report.iphone_geometry = await geometry(phone, 'iPhone profile');
  await screenshot(phone, 'mobile-zombie-empty');
  assert.equal(posts.length, 0); assert.ok(!modules.some(value => /ScenarioScreen|FloodLab|OperatorAccess|ComparisonLab/.test(value)), 'Administrative screens not imported by mobile route');
  report.checks.push('Direct /mobile without login or POST; actual geography while empty; administrative modules not loaded');

  const consolePage = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  consolePage.on('pageerror', error => report.errors.push(error.message));
  await consolePage.goto(`${origin}/escape`);
  await expect(consolePage.getByRole('button', { name: 'Iniciar simulación', exact: true })).toBeEnabled();
  await consolePage.getByLabel('Agentes', { exact: true }).fill('80');
  const createdResponse = consolePage.waitForResponse(response => new URL(response.url()).pathname === '/v1/simulations' && response.request().method() === 'POST');
  await consolePage.getByRole('button', { name: 'Iniciar simulación', exact: true }).click();
  const created = await (await createdResponse).json();
  assert.ok(created.simulation_id && created.access_token);
  await until(async () => (await json(`${world.url}/v1/simulations/published/zombie_outbreak`)).simulation?.tick >= 2, 'zombie tick2');
  await phone.reload();
  await expect(phone.locator('.mobile-hud')).toContainText('En ejecución');
  await until(async () => observed.at(-1)?.simulation?.simulation_id === created.simulation_id && observed.at(-1)?.simulation?.tick >= 2, 'late browser snapshot');
  await consolePage.getByRole('button', { name: 'Pausar', exact: true }).click();
  await expect(phone.locator('.mobile-hud')).toContainText('Pausada', { timeout: 20000 });
  await phone.locator('.mobile-entities > summary').click();
  const route = phone.getByRole('button', { name: 'Ver ruta', exact: true }).first();
  if (await route.count()) { await route.click(); await expect(phone.getByRole('region', { name: 'Persona seleccionada' })).toBeVisible(); await screenshot(phone, 'mobile-zombie-route'); await phone.getByRole('button', { name: 'Cerrar detalle' }).click(); }
  await phone.locator('.mobile-entities').getByRole('button', { name: /^Refugio 1 ·/ }).click();
  await expect(phone.getByRole('region', { name: 'Refugio seleccionado' })).toContainText('Capacidad');
  await screenshot(phone, 'mobile-zombie-shelter'); await phone.getByRole('button', { name: 'Cerrar detalle' }).click();
  const graphCount = geography.filter(value => new URL(value).pathname === '/grafo').length;
  await consolePage.getByRole('button', { name: 'Continuar', exact: true }).click();
  // Paused viewers discover transitions slowly. Re-opening resynchronizes now.
  await phone.reload(); await expect(phone.locator('.mobile-hud')).toContainText('En ejecución');
  const reconnectGraphCount = geography.filter(value => new URL(value).pathname === '/grafo').length;
  await mobile.setOffline(true);
  await expect(phone.getByText(/Sin conexión; el último estado/)).toBeVisible({ timeout: 20000 });
  await mobile.setOffline(false); await phone.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(phone.getByText(/Sin conexión; el último estado/)).toHaveCount(0, { timeout: 20000 });
  assert.equal(geography.filter(value => new URL(value).pathname === '/grafo').length, reconnectGraphCount, 'Polling/reconnect does not refetch unchanged geography');
  assert.ok(graphCount >= 1);
  await consolePage.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(phone.locator('.mobile-hud')).toContainText('Cancelada', { timeout: 20000 });
  await screenshot(phone, 'mobile-zombie-final');
  assert.equal(posts.length, 0, 'Observer cannot create/control simulations');
  report.checks.push('React console creates authoritative zombie run; mobile joins current tick; route and shelter inspection; pause/resume/final observed; offline/reconnect current snapshot with no geography repoll or duplicate engine');

  await consolePage.goto(`${origin}/flood-lab`);
  await expect(consolePage.getByRole('button', { name: 'Iniciar tormenta', exact: true })).toBeEnabled();
  await expect(consolePage.getByText('Acceso de operador', { exact: true })).toHaveCount(0); await expect(consolePage.getByLabel('Código de acceso', { exact: true })).toHaveCount(0);
  await screenshot(consolePage, 'flood-lab-without-login');
  const stormResponse = consolePage.waitForResponse(response => new URL(response.url()).pathname === '/lab/runs' && response.request().method() === 'POST');
  await consolePage.getByRole('button', { name: 'Iniciar tormenta', exact: true }).click();
  const stormHTTP = await stormResponse, storm = await stormHTTP.json(); assert.equal(stormHTTP.status(), 200);
  const stormHeaders = stormHTTP.request().headers(); assert.ok(!stormHeaders.authorization && !stormHeaders['x-csrf-token'] && !stormHeaders.cookie, 'Flood lifecycle is anonymous');
  await phone.getByRole('button', { name: 'Inundaciones', exact: true }).click();
  await expect(phone.getByRole('button', { name: 'Mapa ciudadano', exact: true })).toBeVisible();
  await expect(phone.locator('path[data-road-state="blocked"]')).toHaveCount(0);
  await screenshot(phone, 'mobile-citizen-map');
  await phone.getByRole('button', { name: 'Simulación experimental', exact: true }).click();
  await expect(phone.locator('.mobile-content:not([hidden]) .mobile-hud')).toContainText('En ejecución');
  await expect(phone.getByText('Simulación con datos sintéticos.', { exact: true })).toBeVisible();
  assert.equal((await json(`${flood.url}/lab/published`)).run_id, storm.run_id);
  report.flood_geometry = await geometry(phone, 'Flood mobile'); await screenshot(phone, 'mobile-flood-running');
  await consolePage.getByRole('button', { name: 'Pausar', exact: true }).click();
  await expect(phone.locator('.mobile-content:not([hidden]) .mobile-hud')).toContainText('Pausada', { timeout: 20000 });
  assert.equal(observedFlood.at(-1)?.run_id, storm.run_id, 'Mobile browser observes the console flood ID');
  if (process.argv.includes('--flutter')) {
    const output = path.join(evidence, 'flutter-shared-with-react.json');
    const flutter = spawn(process.execPath, [path.join(root, 'tools/scripts/flutter.mjs'), 'test', '--dart-define=RUN_PUBLISHED_HTTP_TESTS=true',
      `--dart-define=WORLD_API_BASE_URL=${world.url}`, `--dart-define=FLOOD_API_BASE_URL=${flood.url}`, `--dart-define=EXPECTED_ZOMBIE_ID=${created.simulation_id}`, `--dart-define=EXPECTED_FLOOD_ID=${storm.run_id}`, `--dart-define=PUBLISHED_TEST_OUTPUT=${output}`,
      'test/published_http_integration_test.dart'], { cwd: root, stdio: 'inherit', env: process.env }); children.push(flutter);
    assert.equal((await once(flutter, 'exit'))[0], 0, 'Flutter observes these same React-created executions');
    const actual = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(actual.zombie_outbreak.id, observed.at(-1).simulation.simulation_id);
    assert.equal(actual.urban_flood.id, observedFlood.at(-1).run_id);
    assert.equal(actual.urban_flood.tick, observedFlood.at(-1).scenario.simulation_step);
    report.checks.push('React console, React mobile and Flutter repository use the same actual published IDs; paused flood tick also matches exactly');
  }
  await phone.getByRole('button', { name: 'Mapa ciudadano', exact: true }).click();
  await phone.getByRole('button', { name: 'Reportar novedad', exact: true }).click();
  await phone.evaluate(() => window.scrollTo(0, 0));
  const map = phone.getByTestId('flood-map');
  // Select a real rendered street midpoint clear of the report sheet.
  const point = await map.evaluate(svg => {
    const d = svg.querySelector('path[data-road-state]')?.getAttribute('d') ?? '';
    const vertices = [...d.matchAll(/([ML])([\d.-]+),([\d.-]+)/g)].map(match => ({ command: match[1], x: Number(match[2]), y: Number(match[3]) }));
    const box = svg.getBoundingClientRect();
    const segments = vertices.slice(1).flatMap((vertex, index) => {
      if (vertex.command !== 'L') return [];
      const before = vertices[index], center = svg.createSVGPoint(); center.x = (before.x + vertex.x) / 2; center.y = (before.y + vertex.y) / 2;
      const screen = center.matrixTransform(svg.getScreenCTM());
      return screen.y > Math.max(box.top + 90, 120) && screen.y < Math.min(box.bottom - 160, innerHeight - 190) && screen.x > box.left + 30 && screen.x < box.right - 30 ? [{ x: screen.x, y: screen.y, length: Math.hypot(vertex.x - before.x, vertex.y - before.y) }] : [];
    });
    return segments.sort((a, b) => b.length - a.length)[0];
  });
  assert.ok(point, 'Selectable street midpoint');
  report.report_pick = { ...point, hit: await phone.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.outerHTML.slice(0, 250), point) };
  assert.ok(await map.evaluate((svg, location) => svg.contains(document.elementFromPoint(location.x, location.y)), point), 'Actual street is unobscured and touchable');
  await screenshot(phone, 'mobile-report-location');
  await phone.touchscreen.tap(point.x, point.y);
  await expect(phone.getByLabel('Descripción breve')).toBeVisible();
  await phone.getByLabel('Descripción breve').fill('Reporte de comprobación local desde el visor ciudadano.');
  const streetChoice = phone.getByRole('radio', { name: /^Calle cercana 1/ });
  if (await streetChoice.count()) await streetChoice.check();
  await expect(phone.getByRole('button', { name: 'Revisar reporte', exact: true })).toBeEnabled();
  await phone.getByRole('button', { name: 'Revisar reporte', exact: true }).click();
  await screenshot(phone, 'mobile-report-review');
  const reportResponse = phone.waitForResponse(response => new URL(response.url()).pathname === '/v1/incidents' && response.request().method() === 'POST');
  await phone.getByRole('button', { name: 'Enviar reporte', exact: true }).click();
  const reportHTTP = await reportResponse, incident = await reportHTTP.json(); assert.equal(reportHTTP.status(), 201); assert.equal(incident.verification_status, 'pending'); assert.equal(incident.source_type, 'citizen');
  await expect(phone.getByRole('region', { name: 'Novedad seleccionada' })).toContainText('Reporte de comprobación local');
  await screenshot(phone, 'mobile-report-received');
  assert.ok((await json(`${flood.url}/v1/incidents`)).incidents.some(value => value.incident_id === incident.incident_id));
  report.checks.push('Flood starts without credentials; mobile observes the same storm and pause; citizen map excludes synthetic closures; map selection/review/send receives a real pending citizen report');
  assert.ok(posts.every(route => route === '/v1/incidents/resolve' || route === '/v1/incidents'), 'Only citizen report mutations; no simulation controls');
  const desktopMobile = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); await desktopMobile.goto(`${origin}/mobile`); await expect(desktopMobile.locator('.mobile-device')).toBeVisible(); await geometry(desktopMobile, 'Desktop phone frame'); await screenshot(desktopMobile, 'desktop-iphone-frame');
  const android = await browser.newContext({ ...devices['Pixel 7'], reducedMotion: 'reduce' }); const androidPage = await android.newPage(); await androidPage.goto(`${origin}/mobile`); await expect(androidPage.locator('.mobile-hud')).toBeVisible(); report.android_geometry = await geometry(androidPage, 'Chrome Android profile'); await screenshot(androidPage, 'chrome-android-viewer');
  assert.deepEqual(report.errors, []); report.result = 'PASS'; console.log(JSON.stringify({ result: report.result, checks: report.checks, evidence }, null, 2));
} catch (error) { report.result = 'FAIL'; report.error = error.message; console.error(error); process.exitCode = 1; }
finally {
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser?.close();
  for (const child of children) { if (child.exitCode !== null || child.signalCode !== null) continue; const exited = once(child, 'exit'); child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 5000); await exited; clearTimeout(timer); }
  await rm(temporary, { recursive: true, force: true });
}
