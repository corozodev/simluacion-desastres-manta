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
const evidence = process.env.MANTASIM_EVIDENCE_DIR || path.join(root, `deploy/evidence-private/mantasim-mapfirst-${Date.now()}`);
const children = [];
let browser;
const report = { recorded_at: new Date().toISOString(), source: 'Local real Go, React and Chromium; not AWS performance evidence', authorization: 'Flood local loopback session with cookie, origin and CSRF; production operator authorization separately covered by Go HTTP tests', raster_tiles: 'Disabled in automated QA; real checked-in OSM vectors preserved', checks: [], viewports: [], console_errors: [], unexpected_http_errors: [], asset_errors: [] };
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
    const map = document.querySelector('.map-stage > svg')?.getBoundingClientRect();
    const roads = [...document.querySelectorAll('.map-stage .escape-road, .map-stage path[data-road-state]')].filter(element => element.getAttribute('d')).map(element => element.getBoundingClientRect());
    const visibleNetwork = roads.some(road => road.top < innerHeight && road.bottom > Math.max(0, map?.top ?? 0) && road.right > 0 && road.left < innerWidth);
    return { visible_network: visibleNetwork, overflow: document.documentElement.scrollWidth > innerWidth, width: innerWidth, layout: [...document.querySelectorAll('.topbar,.page-header,.map-workspace-hud,.flood-workspace-preparation,.simulation-hud,.map-toolbar')].map(element=>({class:element.className,y:element.getBoundingClientRect().y,height:element.getBoundingClientRect().height})), map: map && { x: map.x, y: map.y, width: map.width, height: map.height } };
  });
  report.viewports.push({ label, ...measurement });
  if (measurement.map?.y >= (measurement.width < 760 || label.includes('full') ? 320 : 240)) await page.screenshot({path:path.join(evidence, `failure-${label}.png`),fullPage:true});
  assert.equal(measurement.visible_network, true, `${label}: actual road geometry visible in first viewport`);
  assert.equal(measurement.overflow, false, `${label}: horizontal overflow`);
  assert.ok(measurement.map?.y < (measurement.width < 760 || label.includes('full') ? 320 : 240), `${label}: map visible immediately (top=${measurement.map?.y})`);
  assert.ok(measurement.map?.width > 200, `${label}: usable map width`);
  assert.ok(measurement.map.x >= 0 && measurement.map.x + measurement.map.width <= measurement.width + 1, `${label}: map within viewport`);
  const oversizedIcons = await page.locator('.map-stage-ui button svg, .map-workspace-hud button svg').evaluateAll(icons => icons.filter(icon => { const box=icon.getBoundingClientRect(); return box.width>24 || box.height>24; }).length);
  assert.equal(oversizedIcons, 0, `${label}: UI icons remain compact`);
  await expect(page.getByRole('button',{name:'Refugios y agentes',exact:true})).toHaveCSS('min-height', /^(38|40)px$/);
  assert.ok((await page.getByRole('button',{name:'Refugios y agentes',exact:true}).boundingBox()).height <= 48, `${label}: compact panel trigger`);
  assert.equal(await page.locator('.status-indicator:visible').count(), 1, `${label}: exactly one API indicator`);
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
    page.on('console', message => { if(message.type() === 'error') report.console_errors.push(message.text()); });
    page.on('response', response => { if (response.url().includes('/visualization/') && response.status() >= 400) report.asset_errors.push({path:new URL(response.url()).pathname,status:response.status()}); if ((response.url().startsWith(world) || response.url().startsWith(flood)) && response.status() >= 400) report.unexpected_http_errors.push({ path: new URL(response.url()).pathname, status: response.status() }); });
    page.on('request', request => { if (request.method() === 'POST') posts.push(new URL(request.url()).pathname); if (new URL(request.url()).pathname === '/grafo') graphReads.push(request.url()); assert.equal(Boolean(request.headers()['x-api-key']), false, 'No private engine key in browser'); });
    await page.goto(`${origin}/flood-lab`);
    await expect(page.getByRole('img', { name: /^Red urbana de inundación simulada/ })).toBeVisible();
    if (viewport.width === 1366) await expect(page.getByRole('button', { name: 'Iniciar tormenta', exact: true })).toBeEnabled();
    else { const active = await (await fetch(`${flood}/lab/state`)).json(); await expect(page.getByRole('button', { name: active.state === 'paused' ? 'Continuar' : active.state === 'running' ? 'Pausar' : 'Iniciar tormenta', exact: true })).toBeVisible(); }
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
      await page.screenshot({ path: path.join(evidence, 'flood-running-1366.png'), fullPage: true });
      await page.getByRole('button', { name: 'Pausar', exact: true }).click();
      await expect.poll(async () => (await (await fetch(`${flood}/lab/state`)).json()).state).toBe('paused');
      await page.getByRole('button', { name: 'Continuar', exact: true }).click();
      await expect.poll(async () => (await (await fetch(`${flood}/lab/state`)).json()).state).toBe('running');
      await page.getByRole('button', { name: 'Pausar', exact: true }).click();
      await expect.poll(async () => (await (await fetch(`${flood}/lab/state`)).json()).state).toBe('paused');
      report.checks.push('Direct authorized flood start, server progress, pause and resume without auto-start');
      await page.locator('summary').filter({hasText:/^Configurar tormenta$/}).click();
      const fullFloodGraph = page.waitForResponse(response => new URL(response.url()).pathname === '/lab/graph' && new URL(response.url()).searchParams.get('mode') === 'full');
      await page.getByRole('combobox', { name: /Cobertura de inundación/ }).selectOption('full');
      const fullResponse = await fullFloodGraph;
      await expect(page.locator('.map-source-strip > p')).toContainText('9.179');
      await page.locator('summary').filter({hasText:/^Configurar tormenta$/}).click();
      await geometry(page, 'flood-full-1366');
      await page.screenshot({ path: path.join(evidence, 'flood-full-1366.png'), fullPage: true });
      report.master_previews ??= [];
      report.master_previews.push({scenario:'flood',nodes:9179,edges:13452,graph_bytes:(await fullResponse.body()).length,map_dom_nodes:await page.locator('.map-stage *').count(),street_paths:await page.locator('path[data-road-state]').count()});
      report.checks.push('Flood FULL preview without starting an expensive master execution');
    }
    if(viewport.width === 390) {
      const resume = page.getByRole('button',{name:'Continuar',exact:true});
      if(await resume.count()) { await resume.click(); await expect(page.getByRole('button',{name:'Pausar',exact:true})).toBeVisible(); }
      await page.screenshot({path:path.join(evidence,'flood-running-390.png'),fullPage:true});
      await page.getByRole('button',{name:'Pausar',exact:true}).click();
    }
    await page.goto(`${origin}/escape`);
    const map = page.getByRole('img', { name: /Red de evacuación/ }); await expect(map).toBeVisible();
    assert.equal(posts.filter(item => item === '/v1/simulations').length, 0, 'Zombie navigation does not create a session');
    await geometry(page, `zombie-${viewport.width}`);
    if (viewport.width >= 760) {
      const before = await map.boundingBox(); const camera = await map.getAttribute('viewBox');
      await page.getByRole('button', { name: 'Colapsar barra lateral' }).click();
      await expect.poll(async () => (await map.boundingBox()).width).toBeGreaterThan(before.width);
      const sidebar = await page.locator('.sidebar').boundingBox();
      assert.ok(sidebar.width >= 48 && sidebar.width <= 56, 'Collapsed sidebar48–56px');
      const initialCamera = camera.split(' ').map(Number); const resizedCamera = (await map.getAttribute('viewBox')).split(' ').map(Number);
      assert.ok(Math.abs(initialCamera[0] + initialCamera[2] / 2 - resizedCamera[0] - resizedCamera[2] / 2) < 1e-6, 'Sidebar preserves camera center');
      await geometry(page, `zombie-collapsed-${viewport.width}`);
      await page.screenshot({ path: path.join(evidence, `sidebar-collapsed-${viewport.width}.png`), fullPage: true });
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
      await expect(page.locator('.map-source-strip > p')).toContainText('9.179'); await expect(map).toBeVisible(); await geometry(page, 'zombie-full-1366');
      const view = await map.getAttribute('viewBox'); await map.focus(); await page.keyboard.press('+'); await expect(map).not.toHaveAttribute('viewBox', view);
      await page.getByRole('button', { name: 'Restablecer vista', exact: true }).click(); await expect(map).toHaveAttribute('viewBox', view);
      assert.equal(graphReads.filter(url => url.includes('mode=full')).length, 1, 'Camera never reloads full graph');
      await page.screenshot({ path: path.join(evidence, 'zombie-full-1366.png'), fullPage: true });
      report.master_previews.push({scenario:'zombie',nodes:9179,edges:13452,map_dom_nodes:await page.locator('.map-stage *').count(),street_paths:await page.locator('.escape-road').count(),full_geography_requests:graphReads.filter(url=>url.includes('mode=full')).length});
      await page.getByRole('combobox', { name: /Profundidad del grafo/ }).selectOption('BASE');
      const baseGraph = await (await fetch(`${world}/grafo?mode=competition`)).json();
      const shelter = baseGraph.shelters[0];
      const shelterNodes = new Set(baseGraph.shelters.map(item => item.node_id));
      const openEdges = baseGraph.edges.filter(edge => !edge.blocked);
      const index = openEdges.findIndex(edge => !shelterNodes.has(edge.from));
      assert.ok(index >= 0, 'Real alternative graph node');
      await page.getByRole('button', { name: 'Refugios y agentes', exact: true }).click();
      await page.getByText('Refugios · 4 ubicaciones', { exact: true }).click();
      await page.getByLabel(`Capacidad de ${shelter.id}`, { exact: true }).fill('37');
      await page.getByRole('button', { name: `Editar ubicación de ${shelter.id}`, exact: true }).click();
      const roadPath = await map.locator('.escape-road').first().getAttribute('d');
      const start = /^([\d.eE+-]+),([\d.eE+-]+)/.exec(roadPath.split('M').filter(Boolean)[index]);
      assert.ok(start, 'Real road endpoint');
      const click = await map.evaluate((svg, point) => { const transformed = new DOMPoint(point.x, point.y).matrixTransform(svg.getScreenCTM()); return { x: transformed.x, y: transformed.y }; }, { x: Number(start[1]), y: Number(start[2]) });
      await page.mouse.click(click.x, click.y);
      await page.getByRole('button', { name: 'Confirmar ubicación', exact: true }).click();
      await map.focus(); await map.press('+');
      const cameraBeforeStart = await map.getAttribute('viewBox'), renderer = await map.elementHandle();
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
      assert.equal(live.snapshot.shelters.find(item => item.id === shelter.id).node_id, requestedNode);
      await expect(page.getByLabel('Tu simulación', { exact: true })).toBeVisible();
      assert.equal(await map.evaluate((current, previous) => current === previous, renderer), true, 'Single renderer survives explicit start');
      await expect(map).toHaveAttribute('viewBox', cameraBeforeStart);
      await expect.poll(async () => (await readPrivate()).tick, { timeout: 10000 }).toBeGreaterThanOrEqual(2);
      await page.screenshot({ path: path.join(evidence, 'zombie-running-1366.png'), fullPage: true });
      await page.getByRole('button', { name: 'Pausar', exact: true }).click();
      await expect(page.getByLabel('Tu simulación', { exact: true })).toContainText('Pausada');
      const paused = await readPrivate();
      const uniqueRoutes = new Set();
      const agents = paused.snapshot.survivors.filter(agent => { const key = JSON.stringify(agent.planned_route); if (agent.planned_route.length < 2 || uniqueRoutes.has(key)) return false; uniqueRoutes.add(key); return true; });
      assert.ok(agents.length >= 2, 'Two real distinct published routes');
      await page.getByRole('button', { name: 'Refugios y agentes', exact: true }).click();
      await page.getByRole('tab', { name: /Supervivientes/ }).click();
      const panel = page.getByRole('region', { name: 'Refugios y agentes' });
      await expect(panel.getByRole('columnheader')).toHaveText(['Superviviente', 'Estado', 'Refugio', 'Acción']);
      const panelCamera = await map.getAttribute('viewBox'), geographyReadsBeforePanel = graphReads.length;
      await panel.getByRole('searchbox', { name: 'Buscar por ID' }).fill(agents[0].id);
      await panel.getByRole('button', { name: `Ver ruta de ${agents[0].id}`, exact: true }).click();
      await expect(map.locator('.escape-planned-route')).toBeVisible();
      const firstRoute = await map.locator('.escape-planned-route').getAttribute('points');
      await expect(panel).toContainText(`${agents[0].id} · Ruta resaltada en el mapa`);
      assert.equal(/OSM-|Ruta publicada:|Siguiente movimiento:|Posición:/.test(await panel.innerText()), false);
      await panel.getByRole('searchbox', { name: 'Buscar por ID' }).fill(agents[1].id);
      await panel.getByRole('button', { name: `Ver ruta de ${agents[1].id}`, exact: true }).click();
      await expect(map.locator('.escape-planned-route')).not.toHaveAttribute('points', firstRoute);
      await expect(panel.locator('tr[aria-selected=true]')).toContainText(agents[1].id);
      await expect(map).toHaveAttribute('viewBox', panelCamera);
      assert.equal(graphReads.length, geographyReadsBeforePanel, 'Panel/search/route inspection never reloads geography');
      const canvas = await map.boundingBox();
      await page.mouse.move(canvas.x + canvas.width - 35, canvas.y + 30);
      await page.mouse.down(); await page.mouse.move(canvas.x + canvas.width - 75, canvas.y + 55, {steps:4}); await page.mouse.up();
      await expect(map).not.toHaveAttribute('viewBox', panelCamera);
      await expect(panel).toBeVisible();
      await page.screenshot({ path: path.join(evidence, 'zombie-agents-1366.png'), fullPage: true });
      await panel.getByRole('button', { name: 'Ocultar ruta', exact: true }).click();
      await expect(map.locator('.escape-planned-route')).toHaveCount(0);
      await expect(panel.getByRole('searchbox', {name:'Buscar por ID'})).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(panel).toHaveCount(0);
      await page.getByRole('button', { name: 'Continuar', exact: true }).click();
      await expect(page.getByLabel('Tu simulación', { exact: true })).toContainText('En ejecución');
      await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
      await expect(page.getByLabel('Resultados de simulación')).toBeVisible();
      assert.equal(posts.filter(item => item === '/v1/simulations').length, 1, 'One explicit create');
      report.checks.push('One persistent renderer/camera, real custom refuges, actual2000ms, server progress and compact actions');
      report.checks.push('Friendly four-column survivor panel, real distinct route selection/switch/hide, search and no technical IDs');
    }
    if(viewport.width === 390) {
      const creation = page.waitForResponse(response => response.url() === `${world}/v1/simulations` && response.request().method() === 'POST');
      await page.getByRole('button',{name:'Iniciar simulación',exact:true}).click();
      const created = await (await creation).json();
      const readPrivate = async () => (await fetch(`${world}/v1/simulations/${created.simulation_id}/state`,{headers:{Authorization:`Bearer ${created.access_token}`}})).json();
      await expect(page.getByLabel('Tu simulación',{exact:true})).toBeVisible();
      await expect.poll(async()=>(await readPrivate()).tick).toBeGreaterThanOrEqual(1);
      await page.screenshot({path:path.join(evidence,'zombie-running-390.png'),fullPage:true});
      await page.getByRole('button',{name:'Pausar',exact:true}).click();
      const paused = await readPrivate(), agent = paused.snapshot.survivors.find(agent => agent.planned_route.length > 1);
      assert.ok(agent,'Real published mobile route');
      await page.getByRole('button',{name:'Refugios y agentes',exact:true}).click();
      await page.getByRole('tab',{name:/Supervivientes/}).click();
      const panel=page.getByRole('region',{name:'Refugios y agentes'});
      await panel.getByRole('searchbox',{name:'Buscar por ID'}).fill(agent.id);
      await panel.getByRole('button',{name:`Ver ruta de ${agent.id}`,exact:true}).click();
      await expect(map.locator('.escape-planned-route')).toBeVisible();
      await expect(panel.getByRole('columnheader')).toHaveText(['Superviviente','Estado','Refugio','Acción']);
      const box=await panel.boundingBox(), mapBox=await map.boundingBox();
      assert.ok(box.x>=0 && box.x+box.width<=viewport.width+1 && box.y>=mapBox.y-1,'Mobile drawer stays inside map bounds');
      assert.equal(/OSM-|Ruta publicada:|Siguiente movimiento:|Posición:/.test(await panel.innerText()),false);
      await page.screenshot({path:path.join(evidence,'zombie-agents-390.png'),fullPage:true});
      await panel.getByRole('button',{name:'Ocultar ruta',exact:true}).click();
      await expect(map.locator('.escape-planned-route')).toHaveCount(0);
      await expect(panel.getByRole('searchbox', {name:'Buscar por ID'})).toBeFocused();
      await page.keyboard.press('Escape');
      await page.getByRole('button',{name:'Cancelar',exact:true}).click();
      report.checks.push('Mobile active HUD, friendly survivor drawer inside map, actual selected route and clear');
    }
    await context.close();
  }
  assert.deepEqual(report.console_errors, [], 'No uncaught browser errors');
  assert.deepEqual(report.unexpected_http_errors, [], 'No HTTP errors');
  assert.deepEqual(report.asset_errors, [], 'Existing sprite resources load correctly');
  report.checks.push('Authorized real synthetic report persisted and polled, keyboard popup open/Escape close/focus restoration, contained popup at all viewport sizes');
  report.checks.push('All three viewport sizes: no horizontal overflow, usable maps, one API indicator, sidebar and mobile keyboard controls');
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ passed: true, evidence, checks: report.checks, viewports: report.viewports.length }));
} catch(error) {
  await writeFile(path.join(evidence,'failure.json'),JSON.stringify({...report,error:error.message},null,2)+'\n',{mode:0o600});
  throw error;
} finally {
  await browser?.close(); for (const child of children.reverse()) await stop(child); await rm(temporary, { recursive: true, force: true });
}
