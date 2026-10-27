// Real local React + Go UI acceptance. Raster tiles are deliberately disabled:
// headless QA must not prefetch a public tile provider or claim tile availability.
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
const temporary = await mkdtemp(path.join(tmpdir(), 'mantasim-ui-'));
const evidence = process.env.MANTASIM_EVIDENCE_DIR || path.join(root, 'deploy/evidence-private/mantasim-ui-20261027');
const children = [];
let browser;
const report = { recorded_at: new Date().toISOString(), source: 'Local real Go, React and Chromium; not AWS performance evidence', authorization: 'Flood local loopback session with cookie, origin and CSRF; production operator authorization separately covered by Go HTTP tests', raster_tiles: 'Disabled in automated QA; real checked-in OSM vectors preserved', checks: [], viewports: [], console_errors: [], unexpected_http_errors: [] };
async function port() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const value = server.address().port; await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); return value;
}
async function build(command, output) {
  const go = process.env.GO_BIN || (existsSync('/usr/local/go/bin/go') ? '/usr/local/go/bin/go' : 'go');
  const child = spawn(go, ['build', '-o', output, command], { cwd: backend, stdio: 'inherit' });
  assert.equal((await once(child, 'exit'))[0], 0, `Go build ${command}`);
}
async function start(binary, args, env, ready) {
  const child = spawn(binary, args, { cwd: backend, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } }); children.push(child); child.stderr.resume();
  return new Promise((resolve, reject) => {
    let buffer = ''; const timer = setTimeout(() => reject(new Error('Go readiness timeout')), 20000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Go exited ${code}`)); });
    child.stdout.on('data', data => { buffer += data.toString(); for (let index; (index = buffer.indexOf('\n')) >= 0;) { const line = buffer.slice(0, index); buffer = buffer.slice(index + 1); try { const record = JSON.parse(line); if (ready(record)) { clearTimeout(timer); resolve(record.url); } } catch { /* Lifecycle only; never emit process logs or credentials. */ } } });
  });
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit'); child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 5000); await exited; clearTimeout(timer);
}
async function until(check, label) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { if (await check()) return; await delay(100); }
  throw new Error(`Timeout: ${label}`);
}
async function geometry(page, label) {
  const measurement = await page.evaluate(() => {
    const map = document.querySelector('.map-stage svg, .escape-map svg, .flood-map svg')?.getBoundingClientRect();
    return { overflow: document.documentElement.scrollWidth > innerWidth, width: innerWidth, map: map && { x: map.x, y: map.y, width: map.width, height: map.height } };
  });
  assert.equal(measurement.overflow, false, `${label}: horizontal overflow`);
  assert.ok(measurement.map?.width > 200, `${label}: usable map width`);
  assert.ok(measurement.map.x >= 0 && measurement.map.x + measurement.map.width <= measurement.width + 1, `${label}: map within viewport`);
  assert.equal(await page.locator('.status-indicator:visible').count(), 1, `${label}: exactly one API indicator`);
  report.viewports.push({ label, ...measurement });
}
try {
  await mkdir(evidence, { recursive: true, mode: 0o700 });
  const webPort = await port(); const origin = `http://127.0.0.1:${webPort}`;
  const worldBinary = path.join(temporary, 'world'), floodBinary = path.join(temporary, 'flood');
  await build('./cmd/server', worldBinary); await build('./cmd/flood-lab', floodBinary);
  const world = await start(worldBinary, [], { API_KEY: randomBytes(32).toString('hex'), LISTEN_ADDR: '127.0.0.1:0', CORS_ORIGINS: origin, SIM_AUTOSTART: 'false', ENABLE_FULL_MODE: 'true', SIM_MAX_ACTIVE: '2', SIM_MAX_FULL_ACTIVE: '1', SIM_RATE_LIMIT_PER_MINUTE: '1000', SIM_CREATE_LIMIT_PER_MINUTE: '100', ADMIN_OPERATOR: '', ADMIN_ACCESS_HASH: '' }, value => value.msg === 'backend ready');
  const flood = await start(floodBinary, ['-listen', '127.0.0.1:0', '-origin', origin, '-incident-dir', path.join(temporary, 'incidents'), '-reference-cache', path.join(temporary, 'reference.json')], {}, value => value.event === 'ready');
  // A labelled synthetic report exercises real store -> polling -> marker -> popup.
  // Creation alone must leave the idle flood engine unchanged.
  const labGraph = await (await fetch(`${flood}/lab/graph?mode=competition`)).json();
  const beforeReport = await (await fetch(`${flood}/lab/state`)).json();
  const sessionResponse = await fetch(`${flood}/lab/session`, { headers: { Origin: origin } });
  const labSession = await sessionResponse.json(); const labCookie = sessionResponse.headers.get('set-cookie').split(';')[0];
  const reportEdge = labGraph.edges.find(edge => edge.geometry?.length >= 2);
  const reportNode = { lat: (reportEdge.geometry[0].lat + reportEdge.geometry[1].lat) / 2, lng: (reportEdge.geometry[0].lng + reportEdge.geometry[1].lng) / 2 };
  const incidentResponse = await fetch(`${flood}/lab/incidents/synthetic`, { method: 'POST', headers: { Origin: origin, Cookie: labCookie, 'Content-Type': 'application/json', 'X-CSRF-Token': labSession.csrf_token, 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ incident_type: 'flooded_road', edge_id_hint: reportEdge.id, latitude: reportNode.lat, longitude: reportNode.lng, description: 'Prueba sintética de interfaz MantaSim; no describe una inundación real.', severity_reported: 'moderate', road_passability_reported: 'restricted', event_time: new Date().toISOString(), location_method: 'manual' }) });
  const incident = await incidentResponse.json();
  assert.equal(incidentResponse.status, 201, `Authorized synthetic report created: ${JSON.stringify(incident.error ?? {})}`);
  assert.equal(incident.source_type, 'synthetic');
  const afterReport = await (await fetch(`${flood}/lab/state`)).json();
  assert.equal(afterReport.scenario.world_version, beforeReport.scenario.world_version, 'Independent report never mutates flood state automatically');
  const web = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], { cwd: path.join(root, 'apps/web'), stdio: 'ignore', env: { ...process.env, VITE_WORLD_API_BASE_URL: world, VITE_FLOOD_API_BASE_URL: flood, VITE_INCIDENTS_API_BASE_URL: flood, VITE_OSM_TILES_ENABLED: 'false' } }); children.push(web);
  await until(async () => { try { return (await fetch(origin)).ok; } catch { return false; } }, 'Vite readiness');
  browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
  for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce', isMobile: viewport.width < 760, hasTouch: viewport.width < 760 });
    const page = await context.newPage(); const posts = []; const graphReads = [];
    page.on('pageerror', error => report.console_errors.push(error.message));
    page.on('response', response => { if ((response.url().startsWith(world) || response.url().startsWith(flood)) && response.status() >= 400) report.unexpected_http_errors.push({ path: new URL(response.url()).pathname, status: response.status() }); });
    page.on('request', request => { if (request.method() === 'POST') posts.push(new URL(request.url()).pathname); if (new URL(request.url()).pathname === '/grafo') graphReads.push(request.url()); assert.equal(Boolean(request.headers()['x-api-key']), false, 'No private engine key in browser'); });
    await page.goto(`${origin}/flood-lab`);
    await expect(page.getByRole('img', { name: /^Red urbana de inundación simulada/ })).toBeVisible();
    if (viewport.width === 1366) await expect(page.getByRole('button', { name: 'Iniciar tormenta', exact: true })).toBeEnabled();
    else await expect(page.getByRole('button', { name: 'Iniciar tormenta', exact: true })).toBeVisible();
    assert.equal(posts.length, 0, 'Direct flood visit does not start work');
    await geometry(page, `flood-${viewport.width}`);
    await page.screenshot({ path: path.join(evidence, `flood-${viewport.width}.png`), fullPage: true });
    const marker = page.locator(`[data-incident-id="${incident.incident_id}"]`);
    await expect(marker).toBeVisible(); await marker.focus(); await marker.press('Enter');
    const popup = page.getByRole('region', { name: /^Reporte en mapa:/ });
    await expect(popup).toBeVisible(); await expect(popup).toContainText('no es una observación real');
    const popupBox = await popup.boundingBox();
    assert.ok(popupBox.x >= 0 && popupBox.x + popupBox.width <= viewport.width + 1, 'Popup contained at viewport width');
    await page.screenshot({ path: path.join(evidence, `flood-popup-${viewport.width}.png`) });
    await popup.getByRole('button', { name: 'Cerrar reporte del mapa' }).focus(); await page.keyboard.press('Escape');
    await expect(popup).toHaveCount(0); await expect(marker).toBeFocused();

    if (viewport.width === 1366) {
      await page.getByRole('button', { name: 'Iniciar tormenta', exact: true }).click();
      await expect.poll(async () => (await (await fetch(`${flood}/lab/state`)).json()).scenario.simulation_step).toBeGreaterThan(0);
      await page.getByRole('button', { name: 'Pausar', exact: true }).click();
      await expect.poll(async () => (await (await fetch(`${flood}/lab/state`)).json()).state).toBe('paused');
      await page.getByRole('button', { name: 'Continuar', exact: true }).click();
      await expect.poll(async () => (await (await fetch(`${flood}/lab/state`)).json()).state).toBe('running');
      report.checks.push('Direct authorized flood start, real step evolution, pause and resume');
      await page.getByText(/^Parámetros ·/).click();
      const fullFloodGraph = page.waitForResponse(response => new URL(response.url()).pathname === '/lab/graph' && new URL(response.url()).searchParams.get('mode') === 'full');
      await page.getByRole('combobox', { name: /Cobertura de inundación/ }).selectOption('full');
      await fullFloodGraph;
      await expect(page.getByRole('heading', { name: 'Previsualización de cobertura', exact: true })).toBeVisible();
      await page.getByText(/^Parámetros ·/).click();
      await geometry(page, 'flood-full-1366');
      await page.screenshot({ path: path.join(evidence, 'flood-full-1366.png'), fullPage: true });
      report.checks.push('Flood FULL_MANTA preview without changing the active storm or mixing live agents');

    }
    await page.goto(`${origin}/escape`);
    const map = page.getByRole('img', { name: /Red de evacuación/ }); await expect(map).toBeVisible();
    assert.equal(posts.filter(item => item === '/v1/simulations').length, 0, 'Zombie navigation does not create a session');
    await geometry(page, `zombie-${viewport.width}`);
    if (viewport.width >= 760) {
      const before = await map.boundingBox(); const camera = await map.getAttribute('viewBox');
      await page.getByRole('button', { name: 'Colapsar barra lateral' }).click();
      await expect.poll(async () => (await map.boundingBox()).width).toBeGreaterThan(before.width);
      const initialCamera = camera.split(' ').map(Number); const resizedCamera = (await map.getAttribute('viewBox')).split(' ').map(Number);
      assert.ok(Math.abs(initialCamera[0] + initialCamera[2] / 2 - resizedCamera[0] - resizedCamera[2] / 2) < 1e-6, 'Sidebar preserves camera center');
      assert.ok(Math.abs(initialCamera[3] - resizedCamera[3]) < 1e-6, 'Sidebar preserves camera scale while adapting aspect ratio');
      await geometry(page, `zombie-collapsed-${viewport.width}`);
      await page.getByRole('button', { name: 'Expandir barra lateral' }).click();
    } else {
      await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
      await expect(page.getByRole('link', { name: 'Escape Manta Inundación' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Abrir menú', exact: true })).toBeFocused();
    }
    await page.screenshot({ path: path.join(evidence, `zombie-${viewport.width}.png`), fullPage: true });
    if (viewport.width === 1366) {
      await page.getByRole('combobox', { name: /Profundidad del grafo/ }).selectOption('FULL_MANTA');
      await expect.poll(() => graphReads.filter(url => url.includes('mode=full')).length).toBe(1);
      await expect(map).toBeVisible(); await geometry(page, 'zombie-full-1366');
      const view = await map.getAttribute('viewBox'); await map.focus(); await page.keyboard.press('+'); await expect(map).not.toHaveAttribute('viewBox', view);
      await page.getByRole('button', { name: 'Restablecer vista', exact: true }).click(); await expect(map).toHaveAttribute('viewBox', view);
      assert.equal(graphReads.filter(url => url.includes('mode=full')).length, 1, 'Camera never reloads full graph');
      await page.screenshot({ path: path.join(evidence, 'zombie-full-1366.png'), fullPage: true });
      await page.getByRole('combobox', { name: /Profundidad del grafo/ }).selectOption('BASE');
      const baseGraph = await (await fetch(`${world}/grafo?mode=competition`)).json();
      const shelter = baseGraph.shelters[0];
      const shelterNodes = new Set(baseGraph.shelters.map(item => item.node_id));
      const openEdges = baseGraph.edges.filter(edge => !edge.blocked);
      const index = openEdges.findIndex(edge => !shelterNodes.has(edge.from));
      assert.ok(index >= 0, 'Real alternative graph node');
      await page.getByText('Refugios · 4 ubicaciones', { exact: true }).click();
      await page.getByLabel(`Capacidad de ${shelter.id}`, { exact: true }).fill('37');
      await page.getByRole('button', { name: `Editar ubicación de ${shelter.id}`, exact: true }).click();
      await map.scrollIntoViewIfNeeded();
      const roadPath = await map.locator('.escape-road').first().getAttribute('d');
      const start = /^([\d.eE+-]+),([\d.eE+-]+)/.exec(roadPath.split('M').filter(Boolean)[index]);
      assert.ok(start, 'Real road endpoint');
      const click = await map.evaluate((svg, point) => { const transformed = new DOMPoint(point.x, point.y).matrixTransform(svg.getScreenCTM()); return { x: transformed.x, y: transformed.y }; }, { x: Number(start[1]), y: Number(start[2]) });
      await page.mouse.click(click.x, click.y);
      await page.getByRole('button', { name: 'Confirmar ubicación', exact: true }).click();
      const createdResponse = page.waitForResponse(response => response.url() === `${world}/v1/simulations` && response.request().method() === 'POST');
      await page.getByRole('button', { name: 'Iniciar simulación', exact: true }).click();
      const created = await (await createdResponse).json();
      assert.equal(created.tick_interval_ms, 2000, 'Server really uses required cadence');
      const readPrivate = async () => (await fetch(`${world}/v1/simulations/${created.simulation_id}/state`, { headers: { Authorization: `Bearer ${created.access_token}` } })).json();
      const live = await readPrivate();
      assert.equal(live.snapshot.shelters.find(item => item.id === shelter.id).capacity, 37, 'Real server shelter capacity overlay');
      const requestedNode = created.config.custom_shelters.find(item => item.id === shelter.id).node_id;
      assert.notEqual(requestedNode, shelter.node_id, 'Confirmed shelter actually moved');
      assert.ok(baseGraph.nodes.some(node => node.id === requestedNode), 'Snapped node belongs to real graph');
      assert.equal(live.snapshot.shelters.find(item => item.id === shelter.id).node_id, requestedNode, 'Server matches the confirmed snapped node exactly');
      await expect.poll(async () => (await readPrivate()).tick, { timeout: 10000 }).toBeGreaterThanOrEqual(2);
      await expect(page.getByLabel('Tu simulación', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Pausar', exact: true }).click();
      await expect(page.getByLabel('Tu simulación', { exact: true })).toContainText('Pausada');
      await page.getByRole('button', { name: 'Reanudar', exact: true }).click();
      await expect(page.getByLabel('Tu simulación', { exact: true })).toContainText('En ejecución');
      await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
      await expect(page.getByLabel('Resultados de simulación')).toBeVisible();
      assert.equal(posts.filter(item => item === '/v1/simulations').length, 1, 'One explicit create');
      report.checks.push('Zombie real session create/pause/resume/cancel/results, actual 2000 ms cadence, confirmed custom shelter node/capacity overlay, BASE/FULL exploration and cached geography');
    }
    await context.close();
  }
  assert.deepEqual(report.console_errors, [], 'No uncaught browser errors');
  assert.deepEqual(report.unexpected_http_errors, [], 'No HTTP errors');
  report.checks.push('Authorized real synthetic report persisted and polled, keyboard popup open/Escape close/focus restoration, contained popup at all viewport sizes');
  report.checks.push('All three viewport sizes: no horizontal overflow, usable maps, one API indicator, sidebar and mobile keyboard controls');
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ passed: true, evidence, checks: report.checks, viewports: report.viewports.length }));
} finally {
  await browser?.close(); for (const child of children.reverse()) await stop(child); await rm(temporary, { recursive: true, force: true });
}
