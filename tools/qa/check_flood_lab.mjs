// Real local Go + React + Chromium verification for the experimental laboratory.
// No AWS calls, privileged browser credentials, or raster-tile prefetching.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
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
const temporary = await mkdtemp(path.join(tmpdir(), 'corodev-flood-lab-'));
const directory = process.env.FLOOD_LAB_EVIDENCE_DIR || path.join(root, 'deploy/evidence-private/phase4b-20261026');
const origin = 'http://127.0.0.1:5179';
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
async function until(callback, predicate, label, timeout = 30000) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    const value = await callback();
    if (predicate(value)) return value;
    await delay(50);
  }
  throw new Error(`Timed out: ${label}`);
}
async function build(command, target) {
  const go = process.env.GO_BIN || (existsSync('/usr/local/go/bin/go') ? '/usr/local/go/bin/go' : 'go');
  const child = spawn(go, ['build', '-o', target, command], { cwd: backend, stdio: ['ignore', 'inherit', 'inherit'] });
  if ((await once(child, 'exit'))[0] !== 0) throw new Error(`Build failed: ${command}`);
}
async function start(binary, args, env, readiness) {
  const child = spawn(binary, args, { cwd: backend, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  children.push(child);
  child.stderr.resume();
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('Local server readiness timed out')), 15000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Local server exited: ${code}`)); });
    child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      for (let newline; (newline = buffer.indexOf('\n')) >= 0;) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        try {
          const record = JSON.parse(line);
          if (readiness(record)) { clearTimeout(timer); resolve(record.url); }
        } catch { /* Read only structured lifecycle records. */ }
      }
    });
  });
}
const report = {
  phase: '4B', recorded_at: new Date().toISOString(),
  source: 'Local real Go HTTP, React and Chromium; not AWS or a hydrological validation',
  raster_tiles: 'Disabled during headless QA; screenshots show real OSM street vectors from the checked-in graph.',
  checks: {}, browser: {},
};
try {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const labBinary = path.join(temporary, 'flood-lab'), zombieBinary = path.join(temporary, 'zombie');
  await build('./cmd/flood-lab', labBinary);
  await build('./cmd/server', zombieBinary);
  const lab = await start(labBinary, ['-listen', '127.0.0.1:0', '-origin', origin, '-data-dir', 'data', '-incident-dir', path.join(temporary, 'incidents')], {}, record => record.event === 'ready');
  const zombie = await start(zombieBinary, [], {
    API_KEY: randomBytes(32).toString('hex'), LISTEN_ADDR: '127.0.0.1:0', SIM_AUTOSTART: 'false', CORS_ORIGINS: origin,
  }, record => record.msg === 'backend ready');
  const get = async (route, schema) => {
    const response = await fetch(`${lab}${route}`, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
    return check(schema, await response.json());
  };
  const catalog = await get('/lab/catalog', 'LabCatalog');
  const initial = await get('/lab/state', 'LabState');
  if (initial.state !== 'idle' || initial.mode !== 'competition' || initial.scenario.simulation_step !== 0) throw new Error('Laboratory initial state is not the official idle graph');
  const presets = new Map(catalog.modes.map(mode => [mode.id, mode]));
  if (presets.get('competition')?.nodes !== 300 || presets.get('competition')?.edges !== 383 || presets.get('full')?.nodes !== 9179 || presets.get('full')?.edges !== 13452 || presets.has('expanded')) throw new Error('Laboratory graph identities disagree with reviewed data');
  report.checks.reviewed_base_and_master_graphs = true;
  const unauthorized = await fetch(`${lab}/lab/actions`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'pause', expected_run_id: initial.run_id }) });
  if (![401, 403].includes(unauthorized.status)) throw new Error('Laboratory accepted a mutation without a session and CSRF');
  check('ErrorResponse', await unauthorized.json());
  report.checks.mutations_require_session_origin_csrf = true;
  const sessionResponse = await fetch(`${lab}/lab/session`, { headers: { Origin: origin } });
  const session = check('LabSession', await sessionResponse.json());
  const cookie = sessionResponse.headers.get('set-cookie')?.split(';')[0];
  if (!cookie || !session.authenticated || !session.csrf_token) throw new Error('Local laboratory did not issue its session');
  async function mutate(route, body, schema = 'LabState') {
    const response = await fetch(`${lab}${route}`, {
      method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf_token },
      body: JSON.stringify(body), signal: AbortSignal.timeout(120000),
    });
    const value = await response.json();
    if (!response.ok) { check('ErrorResponse', value); throw new Error(`${route}: HTTP ${response.status} ${value.error.code}`); }
    return check(schema, value);
  }
  const valid = await mutate('/lab/candidates/validate', { mode: 'competition', candidates: catalog.original_shelters }, 'LabCandidateValidation');
  if (!valid.valid || valid.candidates.length !== 4) throw new Error('Original four shelters did not validate');
  if ((await mutate('/lab/candidates/validate', { mode: 'competition', candidates: catalog.original_shelters.slice(0, 3) }, 'LabCandidateValidation')).valid) throw new Error('An incomplete set of three shelters was accepted');
  const duplicate = structuredClone(catalog.original_shelters);
  duplicate[1] = { ...duplicate[1], lat: duplicate[0].lat, lng: duplicate[0].lng };
  if ((await mutate('/lab/candidates/validate', { mode: 'competition', candidates: duplicate }, 'LabCandidateValidation')).valid) throw new Error('Duplicate snapped shelter nodes were accepted');
  const distant = structuredClone(catalog.original_shelters);
  distant[0] = { ...distant[0], lat: 0, lng: 0 };
  if ((await mutate('/lab/candidates/validate', { mode: 'competition', candidates: distant }, 'LabCandidateValidation')).valid) throw new Error('An unreachable far-away candidate was accepted');
  report.checks.candidate_count_duplicate_and_far_snap_validation = true;
  const baseGraph = await get('/lab/graph?mode=competition', 'Graph');
  const originalNodes = new Set(valid.candidates.map(candidate => candidate.node_id));
  let alternatives;
  for (let offset = 0; offset + 4 <= baseGraph.nodes.length; offset += 4) {
    const chosen = baseGraph.nodes.filter(node => !originalNodes.has(node.id)).slice(offset, offset + 4).map((node, i) => ({ id: `C-${i + 1}`, label: `Candidato experimental ${i + 1}`, lat: node.lat, lng: node.lng, capacity: 60 }));
    if (chosen.length !== 4) break;
    const validation = await mutate('/lab/candidates/validate', { mode: 'competition', candidates: chosen }, 'LabCandidateValidation');
    if (validation.valid) { alternatives = chosen; break; }
  }
  if (!alternatives) throw new Error('Could not establish four actual alternative street nodes');

  if (!process.argv.includes('--api-only')) {
    const web = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5179', '--strictPort'], {
      cwd: path.join(root, 'apps/web'), stdio: 'ignore', env: { ...process.env, VITE_WORLD_API_BASE_URL: zombie, VITE_FLOOD_API_BASE_URL: lab, VITE_OSM_TILES_ENABLED: 'false' },
    });
    children.push(web);
    await until(async () => {
      if (web.exitCode !== null) throw new Error('Vite exited before readiness');
      try { return (await fetch(origin, { signal: AbortSignal.timeout(500) })).ok; } catch { return false; }
    }, Boolean, 'Vite readiness');
    browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = [], failedRequests = [], cancelledRequests = [], httpErrors = [], credentialLeaks = [], rasterRequests = [];
    await page.route(/https?:\/\/[^/]*tile\.openstreetmap\.org\//, route => { rasterRequests.push(route.request().url()); return route.abort(); });
    page.on('pageerror', error => errors.push(error.message));
    page.on('requestfailed', request => {
      if (request.url().startsWith(lab) || request.url().startsWith(zombie)) {
        const record = { path: new URL(request.url()).pathname, failure: request.failure()?.errorText };
        if (record.failure === 'net::ERR_ABORTED') cancelledRequests.push(record);
        else failedRequests.push(record);
      }
    });
    page.on('request', request => { if (request.headers()['x-api-key']) credentialLeaks.push(new URL(request.url()).pathname); });
    page.on('response', response => {
      if ((response.url().startsWith(lab) || response.url().startsWith(zombie)) && response.status() >= 400) httpErrors.push({ path: new URL(response.url()).pathname, status: response.status() });
    });
    await page.goto(`${origin}/escape`);
    await expect(page.getByRole('heading', { name: 'Escape de Manta Zombie' })).toBeVisible();
    await expect(page.getByRole('img', { name: /Red de evacuación/ })).toBeVisible();
    await page.getByRole('combobox', { name: 'Escenarios', exact: true }).selectOption({ label: 'Inundaciones urbanas' });
    await expect(page.getByText('SIMULACIÓN — DATOS SINTÉTICOS', { exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: /^Red urbana de inundación simulada/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Iniciar tormenta', exact: true })).toBeEnabled();
    report.checks.scenario_switch_and_synthetic_label = true;
    for (const label of ['Exposición a inundación', 'Calles transitables', 'Calles con precaución', 'Calles bloqueadas', 'Rutas de evacuación', 'Agentes', 'Refugios', 'Novedades georreferenciadas']) {
      const checkbox = page.getByRole('checkbox', { name: label, exact: true });
      await expect(checkbox).toBeVisible();
      const wasChecked = await checkbox.isChecked();
      await checkbox.click(); await expect(checkbox).toBeChecked({ checked: !wasChecked });
      await checkbox.click(); await expect(checkbox).toBeChecked({ checked: wasChecked });
    }
    report.checks.eight_independent_layer_controls = true;
    await page.getByRole('button', { name: 'Eliminar candidato 4', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Validar cuatro candidatos', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Restaurar candidato 4', exact: true }).click();
    await page.getByRole('button', { name: 'Elegir candidato 1 en el mapa', exact: true }).click();
    const candidateMap = page.getByTestId('flood-map');
    await candidateMap.scrollIntoViewIfNeeded();
    const candidateMapBounds = await candidateMap.boundingBox();
    if (!candidateMapBounds) throw new Error('Cannot select a refuge on the displayed map');
    await candidateMap.click({ position: { x: candidateMapBounds.width * .4, y: candidateMapBounds.height * .4 } });
    await expect(page.getByLabel('Latitud del candidato 1', { exact: true })).not.toHaveValue(String(catalog.original_shelters[0].lat));
    const candidateOneLat = await page.getByLabel('Latitud del candidato 1', { exact: true }).inputValue();
    const candidateOneLng = await page.getByLabel('Longitud del candidato 1', { exact: true }).inputValue();
    await page.getByLabel('Latitud del candidato 2', { exact: true }).fill(candidateOneLat);
    await page.getByLabel('Longitud del candidato 2', { exact: true }).fill(candidateOneLng);
    const rejectedResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/lab/candidates/validate' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Validar cuatro candidatos', exact: true }).click();
    if ((await (await rejectedResponse).json()).valid) throw new Error('UI accepted duplicate custom refuge coordinates');
    await expect(page.getByText('Corrige los candidatos rechazados antes de iniciar o comparar.', { exact: true })).toBeVisible();
    report.checks.ui_map_pick_remove_restore_and_reject_candidates = true;
    for (let i = 0; i < alternatives.length; i++) {
      await page.getByLabel(`Nombre del candidato ${i + 1}`, { exact: true }).fill(alternatives[i].label);
      await page.getByLabel(`Latitud del candidato ${i + 1}`, { exact: true }).fill(String(alternatives[i].lat));
      await page.getByLabel(`Longitud del candidato ${i + 1}`, { exact: true }).fill(String(alternatives[i].lng));
      await page.getByLabel(`Capacidad del candidato ${i + 1}`, { exact: true }).fill('60');
    }
    await page.getByRole('radio', { name: 'Usar cuatro refugios personalizados', exact: true }).check();
    const validatedResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/lab/candidates/validate' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Validar cuatro candidatos', exact: true }).click();
    if (!(await (await validatedResponse).json()).valid) throw new Error('UI did not submit its four valid custom candidates');
    await page.getByLabel('Cantidad de agentes').fill('20');
    await page.getByLabel('Semilla de inundación').fill('42');
    await page.getByLabel('Duración simulada').fill('80');
    await page.getByLabel('Velocidad de reproducción').selectOption('25');
    const startResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/lab/runs' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Iniciar tormenta', exact: true }).click();
    let state = check('LabState', await (await startResponse).json());
    if (state.config.seed !== 42 || state.config.agents !== 20 || state.config.simulation_duration !== 80 || state.config.interval_ms !== 25 || state.config.shelters.some((shelter, i) => shelter.lat !== alternatives[i].lat || shelter.lng !== alternatives[i].lng)) throw new Error('Visual controls did not configure the authoritative backend');
    state = await until(() => get('/lab/state', 'LabState'), state => state.scenario.simulation_step >= 2, 'First real flood steps');
    await page.getByRole('button', { name: 'Pausar', exact: true }).click();
    state = await until(() => get('/lab/state', 'LabState'), state => state.state === 'paused', 'Pause acknowledgement');
    const pausedStep = state.scenario.simulation_step;
    await delay(350);
    if ((await get('/lab/state', 'LabState')).scenario.simulation_step !== pausedStep) throw new Error('Pause stopped polling but not the simulator');
    report.checks.pause_ack_stops_backend_clock = true;
    const initialOrigins = state.origins;
    const map = page.getByTestId('flood-map');
    const roadPoint = await map.evaluate(svg => {
      const markers = Array.from(svg.querySelectorAll('.flood-agent, .flood-candidate, .flood-shelter')).map(marker => ({
        x: Number(marker.getAttribute('cx') ?? marker.getAttribute('x')) + (marker.tagName === 'rect' ? 6 : 0),
        y: Number(marker.getAttribute('cy') ?? marker.getAttribute('y')) + (marker.tagName === 'rect' ? 6 : 0),
      }));
      const d = svg.querySelector('path[data-road-state="passable"]')?.getAttribute('d') ?? '';
      const points = Array.from(d.matchAll(/([ML])([-\d.]+),([-\d.]+)/g), match => ({ command: match[1], x: Number(match[2]), y: Number(match[3]) }));
      const segments = points.slice(1).flatMap((point, i) => {
        if (point.command !== 'L') return [];
        const before = points[i], center = { x: (point.x + before.x) / 2, y: (point.y + before.y) / 2 };
        const length = Math.hypot(point.x - before.x, point.y - before.y);
        return length > 8 && markers.every(marker => Math.hypot(center.x - marker.x, center.y - marker.y) > 20) ? [{ ...center, length }] : [];
      });
      return segments.sort((a, b) => b.length - a.length)[0];
    });
    if (!roadPoint) throw new Error('Street layer lacks an unobstructed OSM segment for inspection');
    await map.scrollIntoViewIfNeeded();
    const bounds = await map.boundingBox();
    const view = (await map.getAttribute('viewBox')).split(' ').map(Number);
    if (!bounds) throw new Error('Flood map has no visible bounds');
    await map.click({ position: { x: (roadPoint.x - view[0]) / view[2] * bounds.width, y: (roadPoint.y - view[1]) / view[3] * bounds.height } });
    await expect(page.locator('.flood-edge-details')).toBeVisible();
    const routeAgent = state.scenario.agents.find(agent => agent.state === 'moving' && agent.planned_route.length > 1);
    if (!routeAgent) throw new Error('Paused fixture has no moving agent with a published route');
    await page.getByRole('button', { name: `Ver ruta de inundación de ${routeAgent.id}`, exact: true }).click();
    await expect(page.locator('.flood-agent-detail')).toBeVisible();
    await expect(map.locator('[data-layer="routes"]')).not.toHaveAttribute('d', '');
    report.browser.inspected_route_agent = routeAgent.id;
    report.checks.edge_click_and_agent_route_inspection = true;
    await page.screenshot({ path: path.join(directory, 'flood-desktop-paused.png'), fullPage: true });
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await until(() => get('/lab/state', 'LabState'), next => next.scenario.simulation_step > pausedStep && next.scenario.evacuation_metrics.blocked_edges > 0, 'Resume advances backend and rain closes streets');
    await page.getByRole('button', { name: 'Pausar', exact: true }).click();
    state = await until(() => get('/lab/state', 'LabState'), state => state.state === 'paused', 'Pause before replay');
    await expect(page.getByTestId('flood-map').locator('path[data-road-state="blocked"]')).not.toHaveAttribute('d', '');
    await page.screenshot({ path: path.join(directory, 'flood-desktop-exposure.png'), fullPage: true });
    report.checks.rain_evolution_blocks_visible_streets = true;
    const runBeforeReset = state.run_id;
    await page.getByRole('button', { name: 'Reiniciar', exact: true }).click();
    state = await until(() => get('/lab/state', 'LabState'), next => next.run_id !== runBeforeReset && next.state === 'idle', 'Restart resets authoritative clock');
    if (state.scenario.simulation_step !== 0 || JSON.stringify(state.origins) !== JSON.stringify(initialOrigins)) throw new Error('Restart did not reset the same experiment');
    const previousRun = state.run_id;
    await page.getByRole('button', { name: 'Repetir misma seed', exact: true }).click();
    state = await until(() => get('/lab/state', 'LabState'), next => next.run_id !== previousRun, 'Same-seed replay');
    if (state.config.seed !== 42 || JSON.stringify(state.origins) !== JSON.stringify(initialOrigins)) throw new Error('Same-seed replay changed exact geographical origins');
    report.checks.resume_and_same_seed_replay = true;
    await page.getByRole('button', { name: 'Reiniciar', exact: true }).click();
    await until(() => get('/lab/state', 'LabState'), next => next.state === 'idle', 'Reset before comparison');
    await page.getByRole('button', { name: 'Comparar A/B', exact: true }).click();
    state = await until(() => get('/lab/state', 'LabState'), next => next.comparison?.state === 'finished', 'A/B real backend completion', 120000);
    checkComparison(state.comparison, 20);
    report.checks.ui_original_vs_four_alternative_shelters = true;
    report.comparison = state.comparison;
    await page.screenshot({ path: path.join(directory, 'flood-comparison-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Flood UI overflows a 390px viewport');
    await page.keyboard.press('Escape');
    await expect.poll(async () => {
      const sidebar = await page.locator('aside.sidebar').boundingBox();
      return !sidebar || sidebar.x + sidebar.width <= 1;
    }).toBe(true);
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); window.scrollTo(0, 0); });
    await page.screenshot({ path: path.join(directory, 'flood-mobile-viewport.png'), fullPage: false });
    await page.screenshot({ path: path.join(directory, 'flood-mobile.png'), fullPage: true });
    await page.locator('.flood-map-card').screenshot({ path: path.join(directory, 'flood-mobile-map.png') });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.getByRole('button', { name: 'Reiniciar', exact: true }).click();
    await until(() => get('/lab/state', 'LabState'), next => next.state === 'idle', 'Reset before master run');
    await page.getByRole('radio', { name: 'Conservar cuatro refugios originales', exact: true }).check();
    await page.getByLabel('Cobertura de inundación').selectOption('full');
    await expect(page.getByRole('img', { name: /^Red urbana de inundación simulada/ })).toBeVisible();
    await expect(page.locator('.flood-map-attribution')).toContainText('13.452');
    const startMaster = performance.now();
    await page.getByRole('button', { name: 'Iniciar tormenta', exact: true }).click();
    state = await until(() => get('/lab/state', 'LabState'), next => next.mode === 'full', 'Master graph used by the engine', 120000);
    const masterGraphResponse = await fetch(`${lab}/lab/graph?run_id=${state.run_id}`, { signal: AbortSignal.timeout(30000) });
    const masterText = await masterGraphResponse.text();
    const masterGraph = check('Graph', JSON.parse(masterText));
    if (masterGraph.nodes.length !== 9179 || masterGraph.edges.length !== 13452 || state.graph_version !== masterGraph.version) throw new Error('Master selection changed only the drawn geometry');
    const originCoordinates = origins => origins.map(({ id, lat, lng }) => ({ id, lat, lng }));
    if (JSON.stringify(originCoordinates(state.origins)) !== JSON.stringify(originCoordinates(initialOrigins))) throw new Error('Switching graph changed geographical agent origins');
    report.browser.master_origin_snap_distance_max_m = Math.max(...state.origins.map(origin => origin.snap_distance_m));
    await page.getByRole('button', { name: 'Pausar', exact: true }).click();
    await until(() => get('/lab/state', 'LabState'), next => next.state === 'paused', 'Master pause acknowledgement');
    await expect(page.locator('.flood-map-attribution')).toContainText('13.452');
    await expect(page.getByTestId('flood-map').locator('path[data-road-state="passable"]')).not.toHaveAttribute('d', '');
    report.browser.master_start_to_paused_ms = performance.now() - startMaster;
    report.browser.master_payload_bytes = Buffer.byteLength(masterText);
    report.browser.master_nodes = masterGraph.nodes.length;
    report.browser.master_edges = masterGraph.edges.length;
    report.browser.master_dom_nodes = await page.locator('*').count();
    if (report.browser.master_dom_nodes > 10000) throw new Error('Master flood map created unbounded individual road DOM objects');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const metrics = await cdp.send('Performance.getMetrics');
    report.browser.master_js_heap_used_bytes = metrics.metrics.find(metric => metric.name === 'JSHeapUsedSize')?.value;
    await page.screenshot({ path: path.join(directory, 'flood-master-desktop.png'), fullPage: true });
    report.checks.master_changes_real_engine_and_keeps_compact_dom = true;
    await page.getByRole('combobox', { name: 'Escenarios', exact: true }).selectOption({ label: 'Apocalipsis zombi' });
    await expect(page.getByRole('heading', { name: 'Escape de Manta Zombie' })).toBeVisible();
    await expect(page.getByRole('img', { name: /Red de evacuación/ })).toBeVisible();
    if ((await (await fetch(`${zombie}/estado`)).json()).graph_version !== (await (await fetch(`${zombie}/grafo`)).json()).version) throw new Error('Flood laboratory changed the zombie graph');
    report.checks.return_to_zombie_preserves_world = true;
    report.browser.javascript_errors = errors;
    report.browser.failed_api_requests = failedRequests;
    report.browser.api_http_errors = httpErrors;
    report.browser.cancelled_queries_during_run_switch = cancelledRequests;
    report.browser.movement_credentials_sent = credentialLeaks.length;
    report.browser.raster_tile_requests = rasterRequests.length;
    report.browser.screenshots = ['flood-desktop-paused.png', 'flood-desktop-exposure.png', 'flood-comparison-desktop.png', 'flood-mobile.png', 'flood-mobile-viewport.png', 'flood-mobile-map.png', 'flood-master-desktop.png'];
    if (errors.length || failedRequests.length || httpErrors.length || credentialLeaks.length || rasterRequests.length) throw new Error(`Browser errors=${errors.length}, failed API requests=${failedRequests.length}, API HTTP errors=${httpErrors.length}, leaked movement keys=${credentialLeaks.length}, raster requests=${rasterRequests.length}`);
  } else {
    const config = { ...catalog.default_config, shelters: alternatives, agents: 8, simulation_duration: 20, interval_ms: 10 };
    let state = await mutate('/lab/runs', { config, expected_run_id: initial.run_id });
    await until(() => get('/lab/state', 'LabState'), next => next.scenario.simulation_step > 0, 'API first step');
    state = await mutate('/lab/actions', { action: 'pause', expected_run_id: state.run_id });
    const paused = state.scenario.simulation_step;
    await delay(100);
    if ((await get('/lab/state', 'LabState')).scenario.simulation_step !== paused) throw new Error('API pause did not stop the simulator');
    state = await mutate('/lab/comparisons', { config, expected_run_id: state.run_id });
    state = await until(() => get('/lab/state', 'LabState'), next => next.comparison?.state === 'finished', 'API A/B completion');
    checkComparison(state.comparison, 8);
    report.comparison = state.comparison;
    report.checks.api_pause_and_comparison = true;
  }
  report.passed = true;
  await writeFile(path.join(directory, 'browser-lab.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.passed = false;
  report.failure = error instanceof Error ? error.message : String(error);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(path.join(directory, 'browser-lab-failure.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  throw error;
} finally {
  if (browser) await browser.close();
  for (const child of children.reverse()) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'); child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      await exited; clearTimeout(timer);
    }
  }
  await rm(temporary, { recursive: true, force: true });
}

function checkComparison(comparison, total) {
  if (comparison?.state !== 'finished' || comparison.results.length !== 2) throw new Error('Comparison did not return two completed measured strategies');
  const [a, b] = comparison.results;
  if (new Set(comparison.results.map(result => result.strategy)).size !== 2 || a.origins_hash !== b.origins_hash || a.config_hash !== b.config_hash || a.seed !== b.seed || a.mode !== b.mode || a.total_agents !== total || b.total_agents !== total) throw new Error('A/B changed variables besides shelter strategy');
  for (const result of comparison.results) {
    if (result.evacuation_metrics.total_agents !== total || Math.abs(result.evacuated_percentage - 100 * result.evacuation_metrics.evacuated_agents / total) > 1e-9) throw new Error('Comparison used different percentage denominators');
  }
}
