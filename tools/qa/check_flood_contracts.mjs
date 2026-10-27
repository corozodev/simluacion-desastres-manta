import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const root = fileURLToPath(new URL('../../', import.meta.url));
const backend = path.join(root, 'services/evacuation');
const temporary = await mkdtemp(path.join(tmpdir(), 'corodev-flood-contracts-'));
const definitions = JSON.parse(await readFile(path.join(root, 'packages/contracts/generated/schemas.json'), 'utf8'));
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(definitions, 'contract');
const validators = new Map();
function check(name, value) {
  if (!validators.has(name)) validators.set(name, ajv.compile({ $ref: `contract#/definitions/${name}` }));
  const validate = validators.get(name);
  if (!validate(value)) throw new Error(`${name}: ${ajv.errorsText(validate.errors)}`);
}

let server;
try {
  const go = process.env.GO_BIN || (existsSync('/usr/local/go/bin/go') ? '/usr/local/go/bin/go' : 'go');
  const binary = path.join(temporary, 'flood-server');
  const build = spawn(go, ['build', '-o', binary, './cmd/flood-server'], { cwd: backend, stdio: ['ignore', 'inherit', 'inherit'] });
  const [code] = await once(build, 'exit');
  if (code !== 0) throw new Error(`flood-server build exited ${code}`);
  const scenarioFile = path.join(temporary, 'scenario.json');
  await writeFile(scenarioFile, JSON.stringify({
    name: 'Synthetic local HTTP contract check', scenario_type: 'urban_flood',
    seed: 20261026, turns: 6, survivors: 8, concurrency: 4, events: [],
    flood: { simulation_duration: 6, time_step: 1, rainfall_profile: 'constant', rainfall_intensity: 1, flood_growth_rate: .4, drainage_factor: .05 },
  }));
  const key = randomBytes(32).toString('hex');
  server = spawn(binary, ['-listen', '127.0.0.1:0', '-interval', '0', '-scenario', scenarioFile], {
    cwd: backend, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, API_KEY: key },
  });
  let readyResolve, completeResolve;
  const ready = new Promise(resolve => { readyResolve = resolve; });
  const complete = new Promise(resolve => { completeResolve = resolve; });
  let startupFailure;
  const failed = new Promise((_, reject) => { startupFailure = reject; });
  server.once('error', startupFailure);
  server.once('exit', code => startupFailure(new Error(`flood-server exited before verification: ${code}`)));
  let buffer = '';
  server.stdout.on('data', chunk => {
    buffer += chunk.toString();
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      try {
        const record = JSON.parse(line);
        if (record.event === 'ready') readyResolve(record.url);
        if (record.event === 'complete') completeResolve(record.scenario);
      } catch { /* Only structured lifecycle records are relevant. */ }
    }
  });
  // Consume stderr without echoing configuration or credentials into reports.
  server.stderr.resume();
  const timer = setTimeout(() => startupFailure(new Error('flood-server readiness or completion timed out')), 15000);
  let baseURL, completed;
  try {
    baseURL = await Promise.race([ready, failed]);
    completed = await Promise.race([complete, failed]);
  } finally {
    clearTimeout(timer);
  }
  check('ScenarioSnapshot', completed);
  async function get(route, name) {
    const response = await fetch(baseURL + route, { signal: AbortSignal.timeout(3000) });
    if (response.status !== 200) throw new Error(`${route}: HTTP ${response.status}`);
    const value = await response.json(); check(name, value); return value;
  }
  const state = await get('/estado', 'WorldSnapshot');
  const overlay = await get('/v1/scenario', 'ScenarioSnapshot');
  const graph = await get('/grafo', 'Graph');
  await get('/healthz', 'HealthResponse');
  if (state.turn !== 6 || overlay.simulation_step !== state.turn || overlay.world_version !== state.world_version || overlay.graph_version !== graph.version || overlay.evacuation_metrics.total_agents !== 8) throw new Error('Scenario and legacy snapshots disagree');
  if (state.scenario_type !== 'urban_flood' || 'flood_zones' in state || 'agents' in state) throw new Error('Legacy state must retain a compact scenario marker');
  if (state.metrics.bitten !== 0 || state.zombies.length || state.metrics.requests_invalid || state.metrics.requests_timeout) throw new Error('Flood run introduced zombie outcomes or failed movement HTTP');
  if (!overlay.road_conditions.some(road => road.state === 'blocked')) throw new Error('Contract fixture did not exercise dynamic road closure');
  for (const road of overlay.road_conditions) {
    if (road.state === 'blocked' && !state.blocked_edges.includes(road.edge_id)) throw new Error('Road overlay disagrees with shared blocked-edge state');
  }
  const original = JSON.parse(await readFile(path.join(backend, 'data/manta-v2.json'), 'utf8'));
  // The historical Go transport omits bridge:false; that omission is unrelated
  // to flood and has the same meaning as the explicit source-data value.
  const edgesWithDefaults = edges => edges.map(edge => ({ ...edge, bridge: edge.bridge ?? false }));
  if (!isDeepStrictEqual(graph.nodes, original.nodes) || !isDeepStrictEqual(edgesWithDefaults(graph.edges), edgesWithDefaults(original.edges))) throw new Error('Flood modified static street geography');
  const active = state.survivors.find(agent => agent.status === 'active');
  if (!active) throw new Error('Contract fixture requires an active agent for movement validation');
  if (active) {
    const request = { sobrevivienteId: active.id, nodoActual: active.current_node, turno: state.turn };
    check('StepRequest', request);
    const response = await fetch(baseURL + '/paso', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key },
      body: JSON.stringify(request), signal: AbortSignal.timeout(3000),
    });
    if (response.status !== 200) throw new Error(`/paso: HTTP ${response.status}`);
    const decision = await response.json(); check('StepResponse', decision);
    if (Object.keys(decision).length !== 1) throw new Error('Movement response gained fields');
    const legal = decision.siguienteNodo === active.current_node || graph.edges.some(edge => !edge.blocked && !state.blocked_edges.includes(edge.id) && ((edge.from === active.current_node && edge.to === decision.siguienteNodo) || (!edge.directed && edge.to === active.current_node && edge.from === decision.siguienteNodo)));
    if (!legal) throw new Error('Flood returned an illegal movement');
  }
  const badMethod = await fetch(baseURL + '/v1/scenario', { method: 'POST', signal: AbortSignal.timeout(3000) });
  if (badMethod.status !== 405) throw new Error('Scenario endpoint accepted mutation');
  const envelope = await badMethod.json(); check('ErrorResponse', envelope);
  if (envelope.error.requestId !== badMethod.headers.get('x-request-id')) throw new Error('Scenario error lost its request ID');
  console.log(`Contratos flood Go reales correctos: escenario completo (${overlay.simulation_step} pasos), JSON Schema, overlay dinámico, estado compacto, grafo estático y /paso autenticado.`);
} finally {
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = once(server, 'exit');
    server.kill('SIGTERM');
    const timer = setTimeout(() => server.kill('SIGKILL'), 5000);
    await exited;
    clearTimeout(timer);
  }
  await rm(temporary, { recursive: true, force: true });
}
