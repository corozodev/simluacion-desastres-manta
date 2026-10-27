import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const root = fileURLToPath(new URL('../../', import.meta.url));
const backend = path.join(root, 'services/evacuation');
const temporary = await mkdtemp(path.join(tmpdir(), 'corodev-simulation-contracts-'));
const definitions = JSON.parse(await readFile(path.join(root, 'packages/contracts/generated/schemas.json'), 'utf8'));
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(definitions, 'contract');
const validators = new Map();
const children = [];
let assertions = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message);
  assertions++;
}
function check(name, value) {
  if (!validators.has(name)) validators.set(name, ajv.compile({ $ref: `contract#/definitions/${name}` }));
  const validate = validators.get(name);
  assert(validate(value), `${name}: ${ajv.errorsText(validate.errors)}`);
}
const key = () => randomBytes(24).toString('hex');
const tokenHeaders = token => token ? { Authorization: `Bearer ${token}` } : {};
const logicalState = state => ({
  turn: state.snapshot.turn,
  graph_version: state.snapshot.graph_version,
  survivors: state.snapshot.survivors,
  zombies: state.snapshot.zombies,
  shelters: state.snapshot.shelters,
  blocked_edges: state.snapshot.blocked_edges,
  events: state.snapshot.events,
  results: state.results,
});

async function start(binary, overrides = {}) {
  const logs = [];
  const child = spawn(binary, [], {
    cwd: backend, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env, API_KEY: key(), LISTEN_ADDR: '127.0.0.1:0',
      SIM_AUTOSTART: 'false', ENABLE_FULL_MODE: 'false',
      SIM_MAX_ACTIVE: '2', SIM_MAX_FULL_ACTIVE: '1', SIM_MAX_RETAINED: '8',
      SIM_IDLE_TTL: '30s', SIM_PAUSED_TTL: '30s', SIM_COMPLETED_TTL: '30s',
      SIM_MAX_WALL_TIME: '30s', SIM_RATE_LIMIT_PER_MINUTE: '10000',
      SIM_CREATE_LIMIT_PER_MINUTE: '1000', CORS_ORIGINS: 'http://localhost:5173',
      ...overrides,
    },
  });
  children.push(child);
  let baseURL;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Simulation backend readiness timed out')), 15000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Simulation backend exited: ${code}`)); });
    let buffer = '';
    child.stdout.on('data', data => {
      const text = data.toString(); logs.push(text); buffer += text;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        try {
          const record = JSON.parse(line);
          if (record.msg === 'backend ready') {
            clearTimeout(timer); baseURL = record.url; resolve();
          }
        } catch { /* Inspect only structured readiness records. */ }
      }
    });
    child.stderr.on('data', data => { logs.push(data.toString()); });
  });
  async function request(route, options = {}) {
    const { token, body, idempotencyKey, expected = 200, schema, ...init } = options;
    const response = await fetch(baseURL + route, {
      ...init, signal: AbortSignal.timeout(5000),
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...tokenHeaders(token), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        ...init.headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    assert(response.status === expected, `${route}: expected HTTP ${expected}, received ${response.status}`);
    if (expected === 304 || expected === 204) {
      assert((await response.text()) === '', `${expected} response must have no body`);
      return { response };
    }
    const value = await response.json();
    if (expected >= 400) {
      check('ErrorResponse', value);
      assert(value.error.requestId === response.headers.get('x-request-id'), 'Error request ID mismatch');
    } else if (schema) check(schema, value);
    return { response, value };
  }
  const create = (body, idempotencyKey = key(), expected = 201) => request('/v1/simulations', {
    method: 'POST', body, idempotencyKey, expected, schema: expected === 201 ? 'SimulationCreated' : undefined,
  });
  const session = (created, suffix = '', options = {}) => request(`/v1/simulations/${created.simulation_id}${suffix}`, {
    token: created.access_token, ...options,
  });
  async function completed(created) {
    for (let attempt = 0; attempt < 150; attempt++) {
      const { value } = await session(created, '/state', { schema: 'SimulationState' });
      if (value.status === 'COMPLETED') return (await session(created, '/results', { schema: 'SimulationResults' })).value;
      assert(value.status === 'RUNNING', `Unexpected status while waiting for completion: ${value.status}`);
      await delay(100);
    }
    throw new Error('Simulation did not complete within 15 seconds');
  }
  return { child, logs, baseURL, request, create, session, completed };
}

try {
  const go = process.env.GO_BIN || (existsSync('/usr/local/go/bin/go') ? '/usr/local/go/bin/go' : 'go');
  const binary = path.join(temporary, 'server');
  const build = spawn(go, ['build', '-o', binary, './cmd/server'], { cwd: backend, stdio: ['ignore', 'inherit', 'inherit'] });
  const [code] = await once(build, 'exit');
  assert(code === 0, `Go build exited ${code}`);
  const api = await start(binary);
  await api.request('/healthz', { schema: 'HealthResponse' });
  const { value: graph } = await api.request('/grafo', { schema: 'Graph' });
  const { value: capabilities } = await api.request('/v1/simulations/capabilities', { schema: 'SimulationCapabilities' });
  const { value: idle } = await api.request('/estado', { schema: 'WorldSnapshot' });
  await delay(1150);
  const { value: stillIdle } = await api.request('/estado', { schema: 'WorldSnapshot' });
  assert(idle.turn === 0 && stillIdle.turn === 0, 'Boot or observation automatically advanced the legacy world');
  assert(!api.logs.join('').includes('simulation_created'), 'Read-only boot created a session');
  assert(capabilities.scenarios.every(scenario => scenario.available), 'Existing engines should be available');
  assert(capabilities.graph_profiles.find(profile => profile.id === 'BASE')?.nodes === 300, 'Default graph is not the 300-node profile');
  assert(capabilities.graph_profiles.find(profile => profile.id === 'FULL_MANTA')?.available === false, 'Disabled full mode was advertised available');
  const { response: preflight } = await api.request('/v1/simulations', {
    method: 'OPTIONS', expected: 204,
    headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Authorization, Idempotency-Key' },
  });
  assert(preflight.headers.get('access-control-allow-origin') === 'http://localhost:5173', 'Allowed origin was not returned');
  assert(preflight.headers.get('access-control-allow-headers')?.includes('Authorization'), 'Private bearer header missing from CORS');
  await api.request('/v1/simulations/capabilities', { headers: { Origin: 'https://unexpected.invalid' }, expected: 403 });

  const config = { scenario: 'zombie_outbreak', graph_profile: 'BASE', seed: 20261026, max_ticks: 3, tick_interval_ms: 1000, config: { survivors: 8, refuge_ids: [] } };
  check('SimulationCreateRequest', config);
  await api.request('/v1/simulations', { method: 'POST', body: config, expected: 400 });
  for (const invalid of [
    { ...config, tick_interval_ms: 1 }, { ...config, max_ticks: 151 },
    { ...config, graph_profile: 'FULL_MANTA' }, { ...config, secret: 'unexpected' },
    { ...config, config: { survivors: 201 } }, { ...config, config: { refuge_ids: ['missing-refuge'] } },
    { ...config, config: { refuge_ids: [graph.shelters[0].id, graph.shelters[0].id] } },
  ]) await api.create(invalid, key(), 400);
  const idempotencyKey = key();
  const [{ value: first }, { value: replay }] = await Promise.all([api.create(config, idempotencyKey), api.create(config, idempotencyKey)]);
  assert(first.simulation_id === replay.simulation_id && first.access_token === replay.access_token, 'Concurrent idempotent creation duplicated the run or credential');
  assert(first.config.refuge_ids.length > 0, 'Empty refuge input did not normalize to graph defaults');
  await api.create({ ...config, seed: 7 }, idempotencyKey, 409);
  for (const suffix of ['', '/state', '/results', '/pause', '/resume', '/cancel', '/restart']) {
    await api.request(`/v1/simulations/${first.simulation_id}${suffix}`, {
      ...(suffix && !['/state', '/results'].includes(suffix) ? { method: 'POST' } : {}), expected: 401,
    });
  }
  await api.request(`/v1/simulations/${first.simulation_id}/state?access_token=${first.access_token}`, { expected: 401 });
  await api.session(first, '', { token: key(), expected: 401 });
  await api.request(`/v1/simulations/${'0'.repeat(32)}`, { token: first.access_token, expected: 404 });
  const { value: paused } = await api.session(first, '/pause', { method: 'POST', schema: 'SimulationMetadata' });
  assert(paused.status === 'PAUSED', 'Pause failed');
  const { value: pausedAgain } = await api.session(first, '/pause', { method: 'POST', schema: 'SimulationMetadata' });
  assert(pausedAgain.tick === paused.tick, 'Repeated pause advanced the run');
  const { value: second } = await api.create({ ...config, seed: 99 });
  await api.session(second, '/pause', { method: 'POST', schema: 'SimulationMetadata' });
  await api.session(first, '/state', { token: second.access_token, expected: 401 });
  await api.create(config, key(), 503);
  const { value: pausedState, response: pausedResponse } = await api.session(first, '/state', { schema: 'SimulationState' });
  assert(!('access_token' in pausedState) && !('graph' in pausedState) && !('nodes' in pausedState), 'Snapshot leaked credentials or static topology');
  assert(pausedState.snapshot.survivors.length === 8 && pausedState.snapshot.graph_version === graph.version, 'Snapshot lost config/graph identity');
  const etag = pausedResponse.headers.get('etag');
  assert(Boolean(etag), 'Private snapshot lacks ETag');
  await api.session(first, '/state', { headers: { 'If-None-Match': etag }, expected: 304 });
  await api.session(first, '/state', { token: second.access_token, headers: { 'If-None-Match': etag }, expected: 401 });
  await delay(1150);
  const { value: afterPause } = await api.session(first, '/state', { schema: 'SimulationState' });
  assert(afterPause.tick === pausedState.tick && isDeepStrictEqual(logicalState(afterPause), logicalState(pausedState)), 'Paused state advanced or another session mutated it');
  await api.session(first, '/results', { expected: 409 });
  await api.session(second, '/cancel', { method: 'POST', schema: 'SimulationMetadata' });
  await api.session(second, '/cancel', { method: 'POST', schema: 'SimulationMetadata' });
  await api.session(second, '/resume', { method: 'POST', expected: 409 });
  const { value: cancelledResults } = await api.session(second, '/results', { schema: 'SimulationResults' });
  assert(cancelledResults.status === 'CANCELLED', 'Cancelled result was not retained');
  await api.session(first, '/resume', { method: 'POST', schema: 'SimulationMetadata' });
  await api.session(first, '/resume', { method: 'POST', schema: 'SimulationMetadata' });
  const final = await api.completed(first);
  await api.session(first, '/resume', { method: 'POST', expected: 409 });
  const restartKey = key();
  const { value: restarted } = await api.session(first, '/restart', { method: 'POST', idempotencyKey: restartKey, expected: 201, schema: 'SimulationCreated' });
  const { value: restartReplay } = await api.session(first, '/restart', { method: 'POST', idempotencyKey: restartKey, expected: 201, schema: 'SimulationCreated' });
  assert(restarted.simulation_id !== first.simulation_id && restarted.access_token !== first.access_token, 'Restart reused session identity or secret');
  assert(restarted.simulation_id === restartReplay.simulation_id && restarted.access_token === restartReplay.access_token, 'Restart retry duplicated a run');
  assert(restarted.seed === first.seed && isDeepStrictEqual(restarted.config, first.config), 'Restart changed immutable configuration');
  const restartedFinal = await api.completed(restarted);
  assert(isDeepStrictEqual(logicalState(final), logicalState(restartedFinal)), 'Pause/resume changed deterministic logical results');
  const { value: retainedFinal } = await api.session(first, '/results', { schema: 'SimulationResults' });
  assert(isDeepStrictEqual(logicalState(final), logicalState(retainedFinal)), 'Restart changed retained historical result');
  const { value: flood } = await api.create({ ...config, scenario: 'urban_flood', config: { survivors: 8, rainfall_intensity: 1 } });
  const floodFinal = await api.completed(flood);
  assert(floodFinal.snapshot.scenario_type === 'urban_flood' && floodFinal.scenario_state?.scenario_type === 'urban_flood', 'Real flood engine was not integrated');
  assert(floodFinal.snapshot.zombies.length === 0 && floodFinal.results.bitten === 0, 'Flood result acquired zombie outcomes');
  assert(floodFinal.scenario_state.evacuation_metrics.total_agents === 8, 'Flood metrics were not isolated');
  for (const credential of [first.access_token, second.access_token, restarted.access_token, flood.access_token]) {
    assert(!api.logs.join('').includes(credential), 'Session credential appeared in backend logs');
  }

  const short = await start(binary, { SIM_PAUSED_TTL: '100ms', SIM_COMPLETED_TTL: '3s' });
  const { value: expiring } = await short.create(config);
  await short.session(expiring, '/pause', { method: 'POST', schema: 'SimulationMetadata' });
  await delay(1300);
  await short.session(expiring, '/state', { expected: 410 });
  const { value: freshAfterExpiry } = await short.create(config);
  await short.session(freshAfterExpiry, '/cancel', { method: 'POST', schema: 'SimulationMetadata' });

  const fullAPI = await start(binary, { ENABLE_FULL_MODE: 'true' });
  const { value: fullCapabilities } = await fullAPI.request('/v1/simulations/capabilities', { schema: 'SimulationCapabilities' });
  const fullProfile = fullCapabilities.graph_profiles.find(profile => profile.id === 'FULL_MANTA');
  assert(fullProfile?.available && fullProfile.nodes === 9179 && fullProfile.edges === 13452, 'Full graph availability/topology mismatch');
  const fullConfig = { ...config, graph_profile: 'FULL_MANTA', tick_interval_ms: 5000, config: { survivors: 2 } };
  const { value: fullRun } = await fullAPI.create(fullConfig);
  await fullAPI.session(fullRun, '/pause', { method: 'POST', schema: 'SimulationMetadata' });
  await fullAPI.create(fullConfig, key(), 503);
  const { value: alongsideFull } = await fullAPI.create(config);
  const { value: fullState } = await fullAPI.session(fullRun, '/state', { schema: 'SimulationState' });
  assert(fullState.graph_version === fullProfile.graph_version && fullState.snapshot.survivors.length === 2, 'Full session lost identity or population');
  await fullAPI.session(fullRun, '/cancel', { method: 'POST', schema: 'SimulationMetadata' });
  await fullAPI.session(alongsideFull, '/cancel', { method: 'POST', schema: 'SimulationMetadata' });
  const metricsResponse = await fetch(`${fullAPI.baseURL}/metrics`, { signal: AbortSignal.timeout(5000) });
  assert(metricsResponse.status === 200 && metricsResponse.headers.get('content-type')?.startsWith('text/plain'), 'Metrics transport mismatch');
  const metrics = await metricsResponse.text();
  assert(metrics.includes('manta_simulation_retained_sessions') && metrics.includes('manta_simulation_rejected_total'), 'Aggregate operational metrics missing');
  assert(!metrics.includes(fullRun.simulation_id) && !metrics.includes(fullRun.access_token), 'Prometheus metrics revealed session identity');

  const constrained = await start(binary, { ENABLE_FULL_MODE: 'true', SIM_MAX_MEMORY_MB: '32', SIM_MAX_ACTIVE: '1', SIM_MAX_RETAINED: '2' });
  await constrained.create(fullConfig, key(), 503);
  for (let retained = 0; retained < 2; retained++) {
    const { value: run } = await constrained.create(config);
    await constrained.session(run, '/cancel', { method: 'POST', schema: 'SimulationMetadata' });
    await delay(50);
  }
  await constrained.create(config, key(), 503);

  const limited = await start(binary, { SIM_RATE_LIMIT_PER_MINUTE: '2' });
  await limited.request('/v1/simulations/capabilities', { schema: 'SimulationCapabilities', headers: { 'X-Forwarded-For': '192.0.2.1' } });
  await limited.request('/v1/simulations/capabilities', { schema: 'SimulationCapabilities', headers: { 'X-Forwarded-For': '192.0.2.2' } });
  const { response: rateResponse } = await limited.request('/v1/simulations/capabilities', { expected: 429, headers: { 'X-Forwarded-For': '192.0.2.3' } });
  assert(rateResponse.headers.get('retry-after') === '60', 'Rate rejection omitted Retry-After');

  console.log(`FASE 5 HTTP Go real: ${assertions} aserciones correctas; arranque sin ejecución, contratos JSON Schema, auth/CORS, idempotencia concurrente, cupos global/full/retención/memoria, aislamiento, ETag, controles, determinismo, flood real, TTL, métricas y rate limit sin confiar en X-Forwarded-For.`);
} finally {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'); child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      await exited; clearTimeout(timer);
    }
  }
  await rm(temporary, { recursive: true, force: true });
}
