// Real local Go/React experiment. Official records come only from the validated
// checked-in snapshot; this test makes no provider, GPS, AWS or raster requests.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const root = fileURLToPath(new URL('../../', import.meta.url));
const backend = path.join(root, 'services/evacuation');
const temporary = await mkdtemp(path.join(tmpdir(), 'corodev-reference-'));
const directory = process.env.REFERENCE_EVIDENCE_DIR || path.join(root, `deploy/evidence-private/mantasim-mapfirst-reference-${Date.now()}`);
const origin = 'http://127.0.0.1:5183';
const children = [];
let browser;
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(JSON.parse(await readFile(path.join(root, 'packages/contracts/generated/schemas.json'), 'utf8')), 'contract');
const validators = new Map();
function assert(value, message) { if (!value) throw new Error(message); }
function check(schema, value) {
  if (!validators.has(schema)) validators.set(schema, ajv.compile({ $ref: `contract#/definitions/${schema}` }));
  const validate = validators.get(schema);
  assert(validate(value), `${schema}: ${ajv.errorsText(validate.errors)}`);
  return value;
}
async function until(callback, predicate, label, timeout = 30000) {
  const end = performance.now() + timeout;
  while (performance.now() < end) { const value = await callback(); if (predicate(value)) return value; await delay(25); }
  throw new Error(`Timed out: ${label}`);
}
async function command(binary, args, cwd) {
  const child = spawn(binary, args, { cwd, stdio: 'inherit' }); children.push(child);
  assert((await once(child, 'exit'))[0] === 0, `Command failed: ${path.basename(binary)}`);
}
async function start(binary, args, env, lifecycle) {
  const child = spawn(binary, args, { cwd: backend, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }); children.push(child); child.stderr.resume();
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Go readiness timeout')), 20000); let buffer = '';
    child.once('error', reject); child.once('exit', code => { clearTimeout(timer); reject(new Error(`Go exited: ${code}`)); });
    child.stdout.on('data', data => { buffer += data.toString(); for (let index; (index = buffer.indexOf('\n')) >= 0;) { const line = buffer.slice(0, index); buffer = buffer.slice(index + 1); try { const record = JSON.parse(line); if (lifecycle(record)) { clearTimeout(timer); resolve(record.url); } } catch { /* Structured lifecycle only. */ } } });
  }); return { child, url };
}
async function get(base, route, schema) { const response = await fetch(base + route, { signal: AbortSignal.timeout(30000) }); assert(response.ok, `${route}: HTTP ${response.status}`); const raw = await response.text(); if (schema === 'ReferenceCollection') report.measurements.reference_payload_bytes = Buffer.byteLength(raw); if (schema === 'Graph' && route.includes('run_id=')) report.measurements.master_graph_bytes = Buffer.byteLength(raw); return check(schema, JSON.parse(raw)); }
async function operator(base) {
  const response = await fetch(base + '/lab/session', { headers: { Origin: origin } }); const session = check('LabSession', await response.json());
  const headers = { Origin: origin, Cookie: response.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': session.csrf_token, 'Content-Type': 'application/json' };
  return async (route, body) => { const result = await fetch(base + route, { method: 'POST', headers, body: JSON.stringify(body) }); assert(result.ok, `${route}: HTTP ${result.status}`); return check('LabState', await result.json()); };
}
const stable = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const report = { phase: 'MantaSim map-first reference regression', recorded_at: new Date().toISOString(), scope: 'Current MantaSim UX regression: local real Go, React, Chromium, checked-in official copy; no provider/GPS/AWS/raster requests', checks: {}, measurements: {}, browser: {}, provenance: {} };
try {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const go = process.env.GO_BIN || (existsSync('/usr/local/go/bin/go') ? '/usr/local/go/bin/go' : 'go');
  const labBinary = path.join(temporary, 'lab'), zombieBinary = path.join(temporary, 'zombie');
  await command(go, ['build', '-o', labBinary, './cmd/flood-lab'], backend);
  await command(go, ['build', '-o', zombieBinary, './cmd/server'], backend);
  const lab = await start(labBinary, ['-listen', '127.0.0.1:0', '-origin', origin, '-data-dir', 'data', '-incident-dir', path.join(temporary, 'incidents'), '-reference-cache', path.join(temporary, 'cache.json')], {}, record => record.event === 'ready');
  const zombie = await start(zombieBinary, [], { API_KEY: randomBytes(32).toString('hex'), LISTEN_ADDR: '127.0.0.1:0', SIM_AUTOSTART: 'false', CORS_ORIGINS: origin }, record => record.msg === 'backend ready');
  const initialZombie = await get(zombie.url, '/estado', 'WorldSnapshot');
  const catalog = await get(lab.url, '/lab/catalog', 'LabCatalog');
  const beforeGraph = await get(lab.url, '/lab/graph?mode=competition', 'Graph');
  const status = await get(lab.url, '/v1/reference/status', 'ReferenceStatus');
  assert(status.mode === 'offline' && status.feature_count === 59 && status.metrics.queries === 0, 'No valid offline official snapshot');
  const collection = await get(lab.url, `/v1/reference/susceptibility?version=${status.dataset_version}`, 'ReferenceCollection');
  const events = await get(lab.url, '/v1/reference/rain-events', 'OfficialRainEvents');
  assert(collection.vertex_count === 3463 && events.events.length === 16 && events.events.every(event => event.event_date.startsWith('2025-')), 'Unexpected official copy/temporal scope');
  report.provenance = { ...status.provenance, event_version: events.provenance.dataset_version, events_min_date: events.events.map(event => event.event_date).sort()[0], events_max_date: events.events.map(event => event.event_date).sort().at(-1) };
  report.checks.verified_official_copy_wgs84_categories_attribution_and_historical_dates = true;
  const mutate = await operator(lab.url);
  let state = await get(lab.url, '/lab/state', 'LabState');
  const runConfig = { ...catalog.default_config, seed: 42, agents: 20, simulation_duration: 40, interval_ms: 1000 };
  state = await mutate('/lab/runs', { expected_run_id: state.run_id, config: runConfig });
  await until(() => get(lab.url, '/lab/state', 'LabState'), value => value.scenario.simulation_step >= 1, 'baseline first step');
  state = await mutate('/lab/actions', { expected_run_id: state.run_id, action: 'pause' });
  const baseline = state;
  const web = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5183', '--strictPort'], { cwd: path.join(root, 'apps/web'), stdio: 'ignore', env: { ...process.env, VITE_WORLD_API_BASE_URL: zombie.url, VITE_FLOOD_API_BASE_URL: lab.url, VITE_INCIDENTS_API_BASE_URL: lab.url, VITE_OSM_TILES_ENABLED: 'false' } }); children.push(web);
  await until(async () => { try { return (await fetch(origin)).ok; } catch { return false; } }, Boolean, 'Vite');
  browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on('dialog', dialog => dialog.accept());
  const errors = [], failed = [], cancelled = [], http = [], external = [], secretLeaks = [], polygonRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => { if (request.headers()['x-api-key']) secretLeaks.push(new URL(request.url()).pathname); if (request.url().includes('/v1/reference/susceptibility')) polygonRequests.push(request.url()); });
  page.on('requestfailed', request => { const record = { path: new URL(request.url()).pathname, reason: request.failure()?.errorText }; (record.reason === 'net::ERR_ABORTED' ? cancelled : failed).push(record); });
  page.on('response', response => { if (response.status() >= 400) http.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  await page.route('**/*', route => { const url = route.request().url(); if ([origin, lab.url, zombie.url].some(base => url.startsWith(base))) return route.continue(); external.push(url); return route.abort(); });
  await page.goto(origin + '/flood-lab');
  await expect(page.getByRole('heading', { name: 'Escape Manta Inundación', exact: true })).toBeVisible();
  const openDetails = async name => { const summary = page.locator('summary').filter({ hasText: name }); if (!await summary.evaluate(element => element.parentElement.open)) await summary.click(); };
  const startStorm = async () => {
    const button = page.getByRole('button', { name: 'Iniciar tormenta', exact: true });
    // A paused storm keeps replacement in its explicit secondary actions.
    if (!await button.isVisible()) await openDetails(/^Más acciones$/);
    await button.click();
  };
  await openDetails(/^Capas$/);
  await openDetails(/^Datos y fuentes oficiales$/);
  const officialToggle = page.getByRole('checkbox', { name: 'Susceptibilidad oficial a inundaciones', exact: true });
  const renderStart = performance.now(); await officialToggle.check();
  await expect(page.locator('[data-reference-id]')).toHaveCount(59);
  report.measurements.base_polygon_load_and_render_ms = performance.now() - renderStart;
  await expect(page.getByText(/CONAGE 2024 — resoluciones/)).toBeVisible();
  await page.screenshot({ path: path.join(directory, 'reference-base-offline.png'), fullPage: true });
  await officialToggle.uncheck(); await expect(page.locator('[data-reference-id]')).toHaveCount(0); await officialToggle.check();
  const pausedAfterLayer = await get(lab.url, '/lab/state', 'LabState');
  assert(pausedAfterLayer.scenario.world_version === baseline.scenario.world_version && !pausedAfterLayer.scenario.data_provenance.geographic_reference, 'Display layer mutated simulation');
  report.checks.independent_layer_and_provenance_without_mutation = true;
  await openDetails(/^Configurar tormenta$/);
  await openDetails(/^Configuración avanzada$/);
  await page.getByRole('checkbox', { name: 'Usar susceptibilidad geográfica como referencia', exact: true }).check();
  await page.getByText('Configurar tormenta', { selector: 'summary', exact: true }).click();
  await startStorm();
  state = await until(() => get(lab.url, '/lab/state', 'LabState'), value => value.run_id !== baseline.run_id && value.scenario.simulation_step >= 1, 'hybrid run');
  await page.getByRole('button', { name: 'Pausar', exact: true }).click();
  state = await until(() => get(lab.url, '/lab/state', 'LabState'), value => value.state === 'paused', 'hybrid pause');
  assert(state.config.seed === baseline.config.seed && stable(state.origins) === stable(baseline.origins), 'Reference changed seed/origins');
  const use = state.scenario.data_provenance.geographic_reference;
  assert(use?.dataset_version === status.dataset_version && use.strength === 0 && use.zones.length === 0, 'No pinned contextual reference metadata');
  assert(state.config.rainfall_profile === baseline.config.rainfall_profile && state.config.rainfall_intensity === baseline.config.rainfall_intensity, 'Reference replaced synthetic rain');
  report.measurements.reference_use = use;
  report.checks.ui_opt_in_pins_version_and_preserves_seed_origins_and_rain = true;
  await page.getByText('Eventos históricos por lluvias · official_observation', { exact: true }).click();
  await expect(page.getByText(/2025-04-14 · MANTA · Deslizamiento/)).toBeVisible();
  assert((await get(lab.url, '/lab/state', 'LabState')).scenario.world_version === state.scenario.world_version, 'Historical event changed road state');
  await page.screenshot({ path: path.join(directory, 'reference-hybrid-and-history.png'), fullPage: true });
  report.checks.historical_events_do_not_close_roads = true;
  const beforeRequests = polygonRequests.length;
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await until(() => get(lab.url, '/lab/state', 'LabState'), value => value.scenario.simulation_step >= state.scenario.simulation_step + 2, 'incremental world steps');
  await page.getByRole('button', { name: 'Pausar', exact: true }).click();
  assert(polygonRequests.length === beforeRequests, 'World polling downloaded static polygons again');
  report.checks.incremental_world_updates_reuse_static_polygons = true;
  await openDetails(/^Configurar tormenta$/);
  await page.getByRole('combobox', { name: /Cobertura de inundación/ }).selectOption('full');
  await page.getByText('Configurar tormenta', { selector: 'summary', exact: true }).click();
  const fullStart = performance.now(); await startStorm();
  state = await until(() => get(lab.url, '/lab/state', 'LabState'), value => value.mode === 'full' && value.scenario.simulation_step >= 1, 'master reference run');
  await page.getByRole('button', { name: 'Pausar', exact: true }).click();
  await expect(page.locator('[data-reference-id]')).toHaveCount(59);
  const fullGraph = await get(lab.url, `/lab/graph?run_id=${state.run_id}`, 'Graph');
  assert(fullGraph.nodes.length === 9179 && fullGraph.edges.length === 13452, 'Master silently reduced');
  report.measurements.master_start_to_pause_and_polygons_ms = performance.now() - fullStart;
  report.measurements.master_dom_nodes = await page.locator('*').count();
  const cdp = await page.context().newCDPSession(page); report.measurements.master_heap_used_bytes = (await cdp.send('Runtime.getHeapUsage')).usedSize;
  await page.screenshot({ path: path.join(directory, 'reference-master-offline.png'), fullPage: true });
  await page.getByTestId('flood-map').screenshot({ path: path.join(directory, 'reference-map-polygons.png') });
  report.checks.master_real_graph_with_reference_polygons = true;
  await page.setViewportSize({ width: 390, height: 844 });
  // Let the existing sidebar finish its responsive transition before measuring.
  await page.waitForTimeout(350);
  report.measurements.mobile_overflow_elements = await page.evaluate(() => Array.from(document.querySelectorAll('body *')).filter(element => element.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(element).position !== 'fixed').slice(0, 10).map(element => ({ tag: element.tagName, class: element.className, right: element.getBoundingClientRect().right })));
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile horizontal overflow');
  await page.screenshot({ path: path.join(directory, 'reference-mobile-390.png'), fullPage: true });
  await page.getByRole('heading', { name: 'Susceptibilidad oficial a inundaciones', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(directory, 'reference-panel-mobile-viewport.png') });
  report.checks.mobile_390_no_overflow = true;
  report.measurements.telemetry = await get(lab.url, '/lab/telemetry', 'LabTelemetry');
  assert(report.measurements.telemetry.reference.queries === 0, 'Offline mode contacted external provider');
  report.checks.offline_simulation_and_telemetry_without_provider_requests = true;
  assert(stable(beforeGraph) === stable(await get(lab.url, '/lab/graph?mode=competition', 'Graph')), 'Base graph mutated');
  await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
  await page.getByRole('link', { name: 'Escape Manta Zombie', exact: true }).click();
  await expect(page.getByRole('img', { name: /^Red de evacuación/ })).toBeVisible();
  assert(stable(initialZombie) === stable(await get(zombie.url, '/estado', 'WorldSnapshot')), 'Zombie original world changed');
  report.checks.zombie_and_base_graph_unchanged = true;
  const empty = await start(labBinary, ['-listen', '127.0.0.1:0', '-origin', origin, '-data-dir', 'data', '-incident-dir', path.join(temporary, 'empty-incidents'), '-reference-cache', path.join(temporary, 'absent-cache'), '-reference-bundle', path.join(temporary, 'absent-bundle')], {}, record => record.event === 'ready');
  assert((await get(empty.url, '/v1/reference/status', 'ReferenceStatus')).availability === 'unavailable', 'Invented missing official copy');
  const emptyMutation = await operator(empty.url); const emptyState = await get(empty.url, '/lab/state', 'LabState');
  await emptyMutation('/lab/runs', { expected_run_id: emptyState.run_id, config: { ...runConfig, interval_ms: 10 } });
  await until(() => get(empty.url, '/lab/state', 'LabState'), value => value.scenario.simulation_step >= 2, 'synthetic run with no official copy');
  report.checks.missing_copy_keeps_synthetic_backend_operational = true;
  report.browser = { errors, failed_requests: failed, normal_cancelled_get_requests: cancelled, http_errors: http, external_requests: external, movement_credential_leaks: secretLeaks, polygon_requests: polygonRequests.length };
  assert(!errors.length && !failed.length && !http.length && !external.length && !secretLeaks.length, 'Unexpected browser errors/traffic');
  report.passed = true;
  await writeFile(path.join(directory, 'references-e2e.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(`MantaSim referencias: ${Object.keys(report.checks).length} checks, 59 polygons / 3463 vertices, 300 and 9179 nodes, offline reference + hybrid simulation, no provider traffic.`);
} catch (error) {
  report.passed = false; report.failure = error instanceof Error ? error.message : String(error);
  await writeFile(path.join(directory, 'references-e2e-failure.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  throw error;
} finally {
  await browser?.close();
  for (const child of children.reverse()) { if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 5000); await exited; clearTimeout(timer); } }
  await rm(temporary, { recursive: true, force: true });
}
