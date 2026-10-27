// Actual Flutter repository -> durable Go HTTP -> React -> isolated flood overlay.
// This local experiment does not contact AWS, GPS, or raster map services.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { chromium, expect } from '@playwright/test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const backend = path.join(root, 'services/evacuation');
const temporary = await mkdtemp(path.join(tmpdir(), 'corodev-incidents-lab-'));
const directory = process.env.INCIDENTS_LAB_EVIDENCE_DIR || path.join(root, `deploy/evidence-private/mantasim-incidents-${Date.now()}`);
const origin = 'http://127.0.0.1:5181';
const children = [];
let browser;
const definitions = JSON.parse(await readFile(path.join(root, 'packages/contracts/generated/schemas.json'), 'utf8'));
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(definitions, 'contract');
const validators = new Map();
function check(name, value) {
  if (!validators.has(name)) validators.set(name, ajv.compile({ $ref: `contract#/definitions/${name}` }));
  const validate = validators.get(name);
  if (!validate(value)) throw new Error(`${name}: ${ajv.errorsText(validate.errors)}`);
  return value;
}
function assert(condition, message) { if (!condition) throw new Error(message); }
async function until(callback, predicate, label, timeout = 30000) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    const value = await callback();
    if (predicate(value)) return value;
    await delay(25);
  }
  throw new Error(`Timed out: ${label}`);
}
async function command(binary, args, cwd) {
  const child = spawn(binary, args, { cwd, stdio: ['ignore', 'inherit', 'inherit'], env: process.env });
  children.push(child);
  const [code] = await once(child, 'exit');
  assert(code === 0, `Command failed (${code}): ${path.basename(binary)} ${args[0]}`);
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  await exited;
  clearTimeout(timer);
}
async function start(binary, args, env, readiness) {
  const child = spawn(binary, args, { cwd: backend, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  child.stderr.resume();
  const url = await new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('Go readiness timed out')), 20000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Go exited before readiness: ${code}`)); });
    child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      for (let newline; (newline = buffer.indexOf('\n')) >= 0;) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        try { const record = JSON.parse(line); if (readiness(record)) { clearTimeout(timer); resolve(record.url); } } catch { /* Only structured lifecycle records. */ }
      }
    });
  });
  return { child, url };
}
async function json(base, route, schema, init) {
  const response = await fetch(`${base}${route}`, { ...init, signal: AbortSignal.timeout(30000) });
  const value = await response.json();
  if (!response.ok) { check('ErrorResponse', value); throw new Error(`${route}: HTTP ${response.status} ${value.error.code}: ${value.error.message}`); }
  return check(schema, value);
}
async function operator(base) {
  const response = await fetch(`${base}/lab/session`, { headers: { Origin: origin } });
  const session = check('LabSession', await response.json());
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  assert(cookie && session.authenticated, 'Local operator session not established');
  return {
    csrf: session.csrf_token,
    headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf_token },
    mutate: (route, body, schema = 'LabState') => json(base, route, schema, { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf_token }, body: JSON.stringify(body) }),
  };
}
const pair = (a, b) => `${a}\0${b}`;
function streetIndex(graph) {
  const pairs = new Map();
  for (const edge of graph.edges) {
    for (const key of edge.directed ? [pair(edge.from, edge.to)] : [pair(edge.from, edge.to), pair(edge.to, edge.from)]) {
      const edges = pairs.get(key) ?? []; edges.push(edge); pairs.set(key, edges);
    }
  }
  return pairs;
}
function canDetour(graph, from, to, excluded) {
  const neighbors = new Map();
  for (const edge of graph.edges) {
    if (edge.id === excluded || edge.blocked) continue;
    const add = (a, b) => { const items = neighbors.get(a) ?? []; items.push(b); neighbors.set(a, items); };
    add(edge.from, edge.to); if (!edge.directed) add(edge.to, edge.from);
  }
  const seen = new Set([from]), queue = [from];
  for (let i = 0; i < queue.length; i++) { const node = queue[i]; if (node === to) return true; for (const next of neighbors.get(node) ?? []) if (!seen.has(next)) { seen.add(next); queue.push(next); } }
  return false;
}
async function chooseRoad(base, graph, state) {
  const pairs = streetIndex(graph), nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const agents = state.scenario.agents.filter(agent => agent.state === 'moving' && agent.planned_route.length > 2).sort((a, b) => b.planned_route.length - a.planned_route.length);
  for (const agent of agents) {
    for (let index = 1; index < agent.planned_route.length; index++) {
      const candidates = pairs.get(pair(agent.planned_route[index - 1], agent.planned_route[index])) ?? [];
      if (candidates.length !== 1) continue;
      const edge = candidates[0];
      if (edge.blocked || !canDetour(graph, agent.current_node, agent.planned_route.at(-1), edge.id)) continue;
      const points = edge.geometry?.length ? edge.geometry : [nodes.get(edge.from), nodes.get(edge.to)];
      const segments = points.slice(1).map((point, i) => ({ before: points[i], point, length: Math.hypot(point.lat - points[i].lat, point.lng - points[i].lng) })).sort((a, b) => b.length - a.length);
      for (const segment of segments) {
        const latitude = (segment.before.lat + segment.point.lat) / 2, longitude = (segment.before.lng + segment.point.lng) / 2;
        const resolution = await json(base, '/v1/incidents/resolve', 'IncidentResolution', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ latitude, longitude, edge_id_hint: edge.id }) });
        if (resolution.matched && resolution.candidates[0]?.edge_id === edge.id) return { agent_id: agent.id, edge_id: edge.id, latitude, longitude, original_route: agent.planned_route, resolution };
      }
    }
  }
  throw new Error('No route street with a genuine nearby association and alternate path was found');
}
const report = {
  phase: 'MantaSim incidents regression', recorded_at: new Date().toISOString(),
  source: 'Local real Flutter repository, durable Go HTTP, React and Chromium; checked-in OSM geometry, synthetic agents and test observation, no GPS/AWS.',
  raster_tiles: 'Disabled during headless QA; checked-in OSM vectors remain visible.',
  isolation_scope: 'One explicitly identified experimental run per Manager. Browser operator cookies share that local run; independent Managers are verified by Go tests.',
  checks: {}, browser: {}, incident: {}, routing: {},
};
try {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const go = process.env.GO_BIN || (existsSync('/usr/local/go/bin/go') ? '/usr/local/go/bin/go' : 'go');
  const labBinary = path.join(temporary, 'flood-lab'), zombieBinary = path.join(temporary, 'zombie');
  await command(go, ['build', '-o', labBinary, './cmd/flood-lab'], backend);
  await command(go, ['build', '-o', zombieBinary, './cmd/server'], backend);
  const store = path.join(temporary, 'persistent-incidents');
  const startLab = () => start(labBinary, ['-listen', '127.0.0.1:0', '-origin', origin, '-data-dir', 'data', '-incident-dir', store], {}, record => record.event === 'ready');
  let lab = await startLab();
  const zombie = await start(zombieBinary, [], { API_KEY: randomBytes(32).toString('hex'), LISTEN_ADDR: '127.0.0.1:0', SIM_AUTOSTART: 'false', CORS_ORIGINS: origin }, record => record.msg === 'backend ready');
  const zombieBefore = await json(zombie.url, '/estado', 'WorldSnapshot');
  const catalog = await json(lab.url, '/lab/catalog', 'LabCatalog');
  const baseGraph = await json(lab.url, '/lab/graph?mode=competition', 'Graph');
  let session = await operator(lab.url);
  let state = await json(lab.url, '/lab/state', 'LabState');
  const runConfig = { ...catalog.default_config, seed: 42, agents: 20, simulation_duration: 80, rainfall_profile: 'constant', rainfall_intensity: 0, evacuation_behavior: 'preventive', interval_ms: 1000 };
  async function startPaused() {
    const initial = await json(lab.url, '/lab/state', 'LabState');
    let value = await session.mutate('/lab/runs', { config: runConfig, expected_run_id: initial.run_id });
    await until(() => json(lab.url, '/lab/state', 'LabState'), current => current.scenario.simulation_step >= 1, 'first deterministic flood step');
    value = await session.mutate('/lab/actions', { action: 'pause', expected_run_id: value.run_id });
    assert(value.scenario.simulation_step === 1, 'Harness must pause exactly after the first step');
    return value;
  }
  state = await startPaused();
  const route = await chooseRoad(lab.url, baseGraph, state);
  report.routing.fixture = route;
  const flutterOutput = path.join(temporary, 'flutter-receipt.json');
  const flutter = process.env.FLUTTER_BIN || (existsSync('/home/naielik/Android/flutter/bin/flutter') ? '/home/naielik/Android/flutter/bin/flutter' : 'flutter');
  await command(flutter, ['test', '--dart-define=RUN_INCIDENT_HTTP_TESTS=true', `--dart-define=INCIDENTS_API_BASE_URL=${lab.url}`, `--dart-define=INCIDENT_TEST_LATITUDE=${route.latitude}`, `--dart-define=INCIDENT_TEST_LONGITUDE=${route.longitude}`, `--dart-define=INCIDENT_TEST_EDGE_ID=${route.edge_id}`, `--dart-define=INCIDENT_TEST_OUTPUT=${flutterOutput}`, 'test/world_incidents_http_integration_test.dart'], path.join(root, 'apps/mobile'));
  const flutterReceipt = JSON.parse(await readFile(flutterOutput, 'utf8'));
  const incident = check('Incident', flutterReceipt.incident);
  assert(incident.source_type === 'citizen' && incident.verification_status === 'pending', 'Flutter report must remain an unverified citizen observation');
  assert(incident.affected_edge_ids.includes(route.edge_id) && flutterReceipt.replay_incident_id === incident.incident_id, 'Flutter idempotent replay must retain the associated road and incident ID');
  report.checks.actual_flutter_repository_post_and_replay = true;
  report.incident = { incident_id: incident.incident_id, source_type: incident.source_type, verification_status: incident.verification_status, affected_edge_ids: incident.affected_edge_ids, received_at: incident.received_at, event_time: incident.event_time, location_precision_m: incident.location_precision_m };
  const beforeRestart = await json(lab.url, `/v1/incidents/${incident.incident_id}`, 'Incident');
  await stop(lab.child);
  lab = await startLab();
  const persisted = await json(lab.url, `/v1/incidents/${incident.incident_id}`, 'Incident');
  assert(JSON.stringify(persisted) === JSON.stringify(beforeRestart), 'Incident changed or disappeared across a real Go process restart');
  report.checks.incident_survives_process_restart = true;
  session = await operator(lab.url);
  state = await startPaused();
  const selected = state.scenario.agents.find(agent => agent.id === route.agent_id);
  assert(JSON.stringify(selected?.planned_route) === JSON.stringify(route.original_route), 'Same configuration and step did not reproduce the selected route after restart');
  const unauthenticated = await fetch(`${lab.url}/lab/incidents/${incident.incident_id}/apply`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ expected_run_id: state.run_id, duration_steps: 20, effect: 'blocked', experimental_ack: true }) });
  assert([401, 403].includes(unauthenticated.status), 'Incident application accepted an unauthenticated operator');
  check('ErrorResponse', await unauthenticated.json());
  report.checks.application_requires_local_session_origin_and_csrf = true;

  const web = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5181', '--strictPort'], { cwd: path.join(root, 'apps/web'), stdio: 'ignore', env: { ...process.env, VITE_WORLD_API_BASE_URL: zombie.url, VITE_FLOOD_API_BASE_URL: lab.url, VITE_INCIDENTS_API_BASE_URL: lab.url, VITE_OSM_TILES_ENABLED: 'false' } });
  children.push(web);
  await until(async () => { if (web.exitCode !== null) throw new Error('Vite exited before readiness'); try { return (await fetch(origin, { signal: AbortSignal.timeout(500) })).ok; } catch { return false; } }, Boolean, 'Vite');
  browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [], consoleErrors = [], failedRequests = [], cancelledRequests = [], httpErrors = [], credentialLeaks = [], rasterRequests = [];
  await page.route(/https?:\/\/[^/]*tile\.openstreetmap\.org\//, request => { rasterRequests.push(request.request().url()); return request.abort(); });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('requestfailed', request => {
    if (![lab.url, zombie.url].some(base => request.url().startsWith(base))) return;
    const value = { path: new URL(request.url()).pathname, failure: request.failure()?.errorText };
    (value.failure === 'net::ERR_ABORTED' ? cancelledRequests : failedRequests).push(value);
  });
  page.on('response', response => { if ([lab.url, zombie.url].some(base => response.url().startsWith(base)) && response.status() >= 400) httpErrors.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  page.on('request', request => { if (request.headers()['x-api-key'] || request.headers().authorization) credentialLeaks.push(new URL(request.url()).pathname); });
  await page.goto(`${origin}/escape?scenario=urban_flood`);
  await page.getByTestId('flood-map').waitFor();
  await page.getByText('Reportes y herramientas autorizadas', { selector: 'summary', exact: true }).click();
  await page.getByLabel('Tipo de novedad', { exact: true }).selectOption('fallen_tree');
  await expect(page.getByText('No hay novedades con estos filtros en la cobertura mostrada.', { exact: true })).toBeVisible();
  await page.getByLabel('Tipo de novedad', { exact: true }).selectOption('road_closed');
  await page.getByLabel('Estado de verificación', { exact: true }).selectOption('verified');
  await expect(page.getByText('No hay novedades con estos filtros en la cobertura mostrada.', { exact: true })).toBeVisible();
  await page.getByLabel('Estado de verificación', { exact: true }).selectOption('pending');
  await page.getByLabel('Antigüedad del reporte', { exact: true }).selectOption('1');
  await page.getByRole('button', { name: `Seleccionar incidente ${incident.incident_id}`, exact: true }).click();
  const detail = page.getByRole('region', { name: `Detalle de incidente ${incident.incident_id}` });
  await expect(detail.getByText('Reporte ciudadano pendiente de verificación', { exact: true })).toBeVisible();
  await expect(detail).toContainText('cuantización de 20 m');
  const marker = page.locator(`[data-incident-id="${incident.incident_id}"]`);
  await expect(marker).toHaveAttribute('data-incident-status', 'pending');
  await expect(marker).toHaveAttribute('data-incident-source', 'citizen');
  await page.getByText('Agentes y disponibilidad de refugios', { selector: 'summary', exact: true }).click();
  await page.getByRole('button', { name: `Ver ruta de inundación de ${route.agent_id}`, exact: true }).click();
  const routeBefore = await page.locator('path[data-layer="routes"]').getAttribute('d');
  assert(routeBefore, 'React did not render the selected authoritative route');
  await detail.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(directory, 'citizen-pending-before-application.png'), fullPage: true });
  report.checks.react_pending_marker_provenance_and_detail = true;
  report.checks.react_server_filters_type_status_and_age = true;
  const before = await json(lab.url, '/lab/state', 'LabState');
  await detail.getByText('Evaluación experimental en esta ejecución', { selector: 'summary', exact: true }).click();
  await detail.getByRole('button', { name: 'Revisar aplicación experimental' }).click();
  await expect(detail.getByRole('button', { name: 'Aplicar incidente a simulación', exact: true })).toBeDisabled();
  await detail.getByRole('checkbox', { name: /Entiendo que esta evaluación es experimental/ }).check();
  const applicationResponse = page.waitForResponse(response => response.url() === `${lab.url}/lab/incidents/${incident.incident_id}/apply` && response.request().method() === 'POST');
  await detail.getByRole('button', { name: 'Aplicar incidente a simulación', exact: true }).click();
  const appliedHTTP = await applicationResponse;
  assert(appliedHTTP.ok(), 'React operator application failed');
  const applied = check('IncidentApplyResult', await appliedHTTP.json());
  assert(!applied.already_applied && applied.application.run_id === before.run_id, 'Application does not belong to the current experimental run');
  const after = applied.state;
  const afterAgent = after.scenario.agents.find(agent => agent.id === route.agent_id);
  assert(after.scenario.simulation_step === before.scenario.simulation_step && after.scenario.simulation_time === before.scenario.simulation_time, 'Applying in pause advanced the simulation clock');
  assert(JSON.stringify(after.scenario.agents.map(agent => [agent.id, agent.current_node])) === JSON.stringify(before.scenario.agents.map(agent => [agent.id, agent.current_node])), 'Applying an overlay moved an agent');
  assert(after.scenario.world_version > before.scenario.world_version, 'Applying an overlay did not publish a new world version');
  assert(afterAgent?.planned_route.length > 1 && JSON.stringify(afterAgent.planned_route) !== JSON.stringify(selected.planned_route), 'Selected affected agent did not receive an alternate route');
  assert(after.scenario.evacuation_metrics.reroute_count > before.scenario.evacuation_metrics.reroute_count, 'Reroute metric did not reflect the invalidated road');
  const road = after.scenario.road_conditions.find(item => item.edge_id === route.edge_id);
  assert(road?.state === 'blocked' && road.risk_source.includes('experimental_incident'), 'Temporary incident overlay did not block the associated road');
  assert(road.updated_at_simulation_step === after.scenario.simulation_step, 'Incident road update does not record its actual simulation step');
  assert(applied.incident.source_type === 'citizen' && applied.incident.verification_status === 'pending', 'Applying an incident changed its provenance or verification');
  await expect(detail.getByLabel('Registro de aplicación experimental')).toContainText(String(applied.application.world_version));
  await expect(page.locator('path[data-layer="routes"]')).not.toHaveAttribute('d', routeBefore);
  await page.getByLabel('Inspeccionar arista', { exact: true }).fill(route.edge_id);
  await expect(page.getByLabel(`Detalle de arista ${route.edge_id}`)).toContainText('Bloqueada');
  await expect(page.getByLabel(`Detalle de arista ${route.edge_id}`)).toContainText('experimental_incident');
  await page.keyboard.press('Escape');
  await page.getByLabel('Inspeccionar arista', { exact: true }).blur();
  await page.screenshot({ path: path.join(directory, 'citizen-applied-route-and-audit.png'), fullPage: true });
  await page.getByTestId('flood-map').screenshot({ path: path.join(directory, 'incident-overlay-map.png') });
  report.checks.explicit_react_application_closes_road_and_replans_without_movement = true;
  report.routing.before = { run_id: before.run_id, step: before.scenario.simulation_step, world_version: before.scenario.world_version, reroute_count: before.scenario.evacuation_metrics.reroute_count, route: selected.planned_route };
  report.routing.after = { step: after.scenario.simulation_step, world_version: after.scenario.world_version, reroute_count: after.scenario.evacuation_metrics.reroute_count, route: afterAgent.planned_route, road_condition: road, application: applied.application };
  const duplicate = await session.mutate(`/lab/incidents/${incident.incident_id}/apply`, { expected_run_id: before.run_id, duration_steps: 20, effect: 'blocked', experimental_ack: true }, 'IncidentApplyResult');
  assert(duplicate.already_applied && duplicate.application.application_id === applied.application.application_id, 'Repeated application did not reuse the durable receipt');
  assert(JSON.stringify(duplicate.state) === JSON.stringify(after), 'Repeated application changed the world, metrics, audit or overlay');
  report.checks.application_idempotent_without_extra_effects = true;
  const graphAfter = await json(lab.url, '/lab/graph?mode=competition', 'Graph');
  assert(JSON.stringify(graphAfter) === JSON.stringify(baseGraph), 'Base graph changed after temporary incident application');
  assert(JSON.stringify(await json(zombie.url, '/estado', 'WorldSnapshot')) === JSON.stringify(zombieBefore), 'Existing zombie simulation was modified by an incident');
  report.checks.base_graph_and_zombie_scenario_unchanged = true;
  const reset = await session.mutate('/lab/actions', { action: 'restart', expected_run_id: after.run_id });
  assert(reset.run_id !== after.run_id && !(reset.incident_applications?.length), 'Restart retained another run application audit');
  assert(!reset.scenario.road_conditions.some(item => item.edge_id === route.edge_id && item.risk_source.includes('experimental_incident')), 'Restart inherited the previous run incident overlay');
  const stale = await fetch(`${lab.url}/lab/incidents/${incident.incident_id}/apply`, { method: 'POST', headers: session.headers, body: JSON.stringify({ expected_run_id: after.run_id, duration_steps: 20, effect: 'blocked', experimental_ack: true }) });
  assert(stale.status === 409, 'A stale run ID was accepted for incident application');
  check('ErrorResponse', await stale.json());
  report.checks.new_run_clears_overlay_and_stale_run_is_rejected = true;
  // The API restart precedes the browser's next poll. Wait for the new idle
  // run and its graph/list instead of scrolling an element from the old run.
  await expect(page.getByText('Lista para iniciar', { exact: true })).toBeVisible();
  await expect(page.getByTestId('flood-map')).toBeVisible();
  await expect(page.getByRole('button', { name: `Seleccionar incidente ${incident.incident_id}`, exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: `Seleccionar incidente ${incident.incident_id}`, exact: true }).scrollIntoViewIfNeeded();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(directory, 'citizen-report-mobile-390.png'), fullPage: true });
  await detail.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(directory, 'citizen-detail-mobile-viewport-390.png') });
  await detail.screenshot({ path: path.join(directory, 'citizen-detail-mobile-card-390.png') });
  report.checks.mobile_390_no_horizontal_overflow = true;
  await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
  await page.getByRole('link', { name: 'Escape Manta Zombie', exact: true }).click();
  await page.getByRole('img', { name: /Red de evacuación y posiciones observables/ }).waitFor();
  report.checks.existing_zombie_react_screen_remains_usable = true;
  assert(!errors.length && !consoleErrors.length && !failedRequests.length && !httpErrors.length && !credentialLeaks.length && !rasterRequests.length, `Browser errors: ${JSON.stringify({ errors, consoleErrors, failedRequests, httpErrors, credentialLeaks, rasterRequests })}`);
  report.browser = { errors, console_errors: consoleErrors, failed_requests: failedRequests, normal_cancelled_get_requests: cancelledRequests, http_errors: httpErrors, movement_credential_leaks: credentialLeaks, raster_requests: rasterRequests };
  await writeFile(path.join(directory, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`MantaSim incidents regression complete: Flutter ${incident.incident_id}, persistencia tras reinicio, React pendiente, arista ${route.edge_id}, rutas/versiones ${before.scenario.world_version}→${after.scenario.world_version}, idempotencia y regresión.`);
} finally {
  if (browser) await browser.close();
  for (const child of children.toReversed()) await stop(child);
  await rm(temporary, { recursive: true, force: true });
}
