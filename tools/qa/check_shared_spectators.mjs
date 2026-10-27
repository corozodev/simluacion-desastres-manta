// Real HTTP acceptance and measured spectator load. All state comes from Go.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const root = fileURLToPath(new URL('../../', import.meta.url));
const backend = path.join(root, 'services/evacuation');
const temporary = await mkdtemp(path.join(tmpdir(), 'mantasim-spectators-'));
const evidence = process.env.SPECTATOR_EVIDENCE_DIR || path.join(root, 'deploy/evidence-private/shared-spectators');
const origin = 'http://localhost:5173';
const children = [];
const report = { recorded_at: new Date().toISOString(), source: 'Local Linux, real Go HTTP; not an EC2 capacity test', checks: [], load: [] };
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(JSON.parse(await readFile(path.join(root, 'packages/contracts/generated/schemas.json'), 'utf8')), 'contract');
const validators = new Map();
function check(name, value) {
  if (!validators.has(name)) validators.set(name, ajv.compile({ $ref: `contract#/definitions/${name}` }));
  const validate = validators.get(name);
  assert.ok(validate(value), `${name}: ${ajv.errorsText(validate.errors)}`);
  return value;
}
async function build(command, target) {
  const go = process.env.GO_BIN || (existsSync('/usr/local/go/bin/go') ? '/usr/local/go/bin/go' : 'go');
  const child = spawn(go, ['build', '-o', target, command], { cwd: backend, stdio: 'inherit' });
  assert.equal((await once(child, 'exit'))[0], 0, `Build ${command}`);
}
async function start(binary, args, env, readiness) {
  const child = spawn(binary, args, { cwd: backend, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  children.push(child);
  child.stderr.resume();
  const url = await new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('Server readiness timeout')), 20000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}`)); });
    child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      for (let index; (index = buffer.indexOf('\n')) >= 0;) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        try { const record = JSON.parse(line); if (readiness(record)) { clearTimeout(timer); resolve(record.url); } } catch { /* Never print credentials or runtime logs. */ }
      }
    });
  });
  return { url, child };
}
async function request(base, route, schema, options = {}) {
  const { body, status = 200, headers, ...init } = options;
  const response = await fetch(base + route, { ...init, signal: AbortSignal.timeout(15000), headers: { Origin: origin, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal(response.status, status, `${route}: HTTP ${response.status}, expected ${status}`);
  assert.ok(response.headers.get('x-request-id'), `${route}: request ID`);
  if (status === 304) { assert.equal(await response.text(), ''); return { response }; }
  const value = await response.json();
  check(status >= 400 ? 'ErrorResponse' : schema, value);
  return { value, response };
}
async function until(callback, predicate, label) {
  const deadline = performance.now() + 20000;
  while (performance.now() < deadline) { const value = await callback(); if (predicate(value)) return value; await delay(100); }
  throw new Error(`Timeout: ${label}`);
}
function noPrivate(value) {
  const text = JSON.stringify(value);
  for (const forbidden of ['access_token', 'tokenHash', 'prng', '"nodes":', '"edges":']) assert.ok(!text.includes(forbidden), `Public state excludes ${forbidden}`);
  assert.ok(!(value.simulation?.snapshot.zombies ?? []).some(zombie => zombie.type === 'sleeper' && !zombie.awake), 'Sleeping sleepers stay private');
}
const publicRoute = '/v1/simulations/published/zombie_outbreak';
async function proc(pid) {
  try {
    const [stat, status] = await Promise.all([readFile(`/proc/${pid}/stat`, 'utf8'), readFile(`/proc/${pid}/status`, 'utf8')]);
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return { cpu_ticks: Number(fields[11]) + Number(fields[12]), rss_kib: Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0) };
  } catch { return undefined; }
}
async function load(server, count, route, schema) {
  const ticksPerSecond = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim());
  const before = await proc(server.child.pid);
  const started = performance.now();
  const timings = [], payloads = [], versions = new Set();
  const etags = Array(count).fill('');
  let unchanged = 0, errors = 0, firstTick, lastTick;
  // Nominal viewer cadence: one request per two seconds per viewer, no overlap.
  for (let round = 0; round < 3; round++) {
    const roundAt = performance.now();
    await Promise.all(Array.from({ length: count }, async (_, index) => {
      const startAt = performance.now();
      try {
        const response = await fetch(server.url + route, { headers: { Origin: origin, ...(etags[index] ? { 'If-None-Match': etags[index] } : {}) }, signal: AbortSignal.timeout(15000) });
        const bytes = Buffer.from(await response.arrayBuffer());
        assert.ok(response.status === 200 || response.status === 304, `Spectator HTTP ${response.status}`);
        timings.push(performance.now() - startAt); payloads.push(bytes.length);
        if (response.status === 304) { unchanged++; return; }
        const value = check(schema, JSON.parse(bytes.toString())); noPrivate(value);
        const tick = value.simulation?.tick ?? value.scenario?.simulation_step;
        firstTick ??= tick; lastTick = tick;
        versions.add(value.simulation?.simulation_id ?? value.run_id);
        etags[index] = response.headers.get('etag') ?? '';
      } catch { errors++; }
    }));
    await delay(Math.max(0, 2000 - (performance.now() - roundAt)));
  }
  const elapsed = performance.now() - started;
  const after = await proc(server.child.pid);
  timings.sort((a, b) => a - b);
  const percentile = fraction => timings[Math.min(timings.length - 1, Math.floor(timings.length * fraction))];
  const measured = { scenario: schema === 'LabState' ? 'urban_flood' : 'zombie_outbreak', spectators: count, requests: count * 3, cadence_ms: 2000, measured_ms: elapsed, requests_per_second: count * 3 / (elapsed / 1000), p50_ms: percentile(.5), p95_ms: percentile(.95), p99_ms: percentile(.99), mean_payload_bytes: payloads.reduce((a, b) => a + b, 0) / payloads.length, max_payload_bytes: Math.max(...payloads), responses_304: unchanged, errors, observed_ids: versions.size, first_tick: firstTick, last_tick: lastTick, process_rss_kib: after?.rss_kib, process_cpu_percent_one_core: before && after ? (after.cpu_ticks - before.cpu_ticks) / ticksPerSecond / (elapsed / 1000) * 100 : undefined };
  report.load.push(measured);
  assert.equal(errors, 0, 'No spectator HTTP/schema failures'); assert.equal(versions.size, 1, 'All spectators share one existing run');
}
try {
  await mkdir(evidence, { recursive: true, mode: 0o700 });
  const worldBinary = path.join(temporary, 'world'), floodBinary = path.join(temporary, 'flood');
  await build('./cmd/server', worldBinary); await build('./cmd/flood-lab', floodBinary);
  const world = await start(worldBinary, [], { API_KEY: randomBytes(32).toString('hex'), LISTEN_ADDR: '127.0.0.1:0', CORS_ORIGINS: origin, SIM_AUTOSTART: 'false', SIM_RATE_LIMIT_PER_MINUTE: '1000', SIM_CREATE_LIMIT_PER_MINUTE: '100', SIM_MAX_ACTIVE: '3', SIM_COMPLETED_TTL: '5m', SIM_IDLE_TTL: '5m' }, record => record.msg === 'backend ready');
  const flood = await start(floodBinary, ['-listen', '127.0.0.1:0', '-origin', origin, '-incident-dir', path.join(temporary, 'incidents'), '-reference-cache', path.join(temporary, 'reference.json')], {}, record => record.event === 'ready');
  assert.equal((await request(world.url, publicRoute, 'PublishedSimulation')).value.availability, 'none');
  let initialFlood = (await request(flood.url, '/lab/published', 'LabState')).value;
  assert.equal(initialFlood.state, 'idle');
  const creationKey = randomUUID();
  const input = { scenario: 'zombie_outbreak', graph_profile: 'BASE', seed: 123, max_ticks: 150, tick_interval_ms: 1000, config: { survivors: 80 } };
  const created = (await request(world.url, '/v1/simulations', 'SimulationCreated', { method: 'POST', headers: { 'Idempotency-Key': creationKey }, body: input, status: 201 })).value;
  const auth = { Authorization: `Bearer ${created.access_token}` };
  await until(async () => (await request(world.url, publicRoute, 'PublishedSimulation')).value, value => value.simulation.tick >= 2, 'late zombie join');
  await request(world.url, `/v1/simulations/${created.simulation_id}/pause`, 'SimulationMetadata', { method: 'POST', headers: auth });
  const shared = await request(world.url, publicRoute, 'PublishedSimulation');
  const privateState = (await request(world.url, `/v1/simulations/${created.simulation_id}/state`, 'SimulationState', { headers: auth })).value;
  assert.equal(shared.value.simulation.status, 'PAUSED');
  assert.deepEqual(shared.value.simulation.snapshot, privateState.snapshot);
  noPrivate(shared.value);
  await request(world.url, publicRoute, 'PublishedSimulation', { headers: { 'If-None-Match': shared.response.headers.get('etag') }, status: 304 });
  const independent = (await request(world.url, '/v1/simulations/published/urban_flood', 'PublishedSimulation')).value;
  assert.equal(independent.availability, 'none');
  report.checks.push('Late zombie join at current tick, anonymous paused snapshot equals authenticated controller; ETag 304; scenario isolation and no private data');
  await request(world.url, `/v1/simulations/${created.simulation_id}/resume`, 'SimulationMetadata', { method: 'POST', headers: auth });
  for (const spectators of [1, 10, 50]) await load(world, spectators, publicRoute, 'PublishedSimulation');
  await request(world.url, `/v1/simulations/${created.simulation_id}/cancel`, 'SimulationMetadata', { method: 'POST', headers: auth });
  const final = (await request(world.url, publicRoute, 'PublishedSimulation')).value;
  assert.equal(final.simulation.status, 'CANCELLED'); assert.ok(final.simulation.results);
  const replacement = (await request(world.url, '/v1/simulations', 'SimulationCreated', { method: 'POST', headers: { 'Idempotency-Key': randomUUID() }, body: { ...input, max_ticks: 2 }, status: 201 })).value;
  assert.equal((await request(world.url, publicRoute, 'PublishedSimulation')).value.simulation.simulation_id, replacement.simulation_id);
  await request(world.url, '/v1/simulations', 'SimulationCreated', { method: 'POST', headers: { 'Idempotency-Key': creationKey }, body: input, status: 201 });
  assert.equal((await request(world.url, publicRoute, 'PublishedSimulation')).value.simulation.simulation_id, replacement.simulation_id, 'Idempotent replay never republishes old run');
  await until(async () => (await request(world.url, publicRoute, 'PublishedSimulation')).value, value => value.simulation.status === 'COMPLETED', 'final zombie results');
  report.checks.push('Cancellation retains final results; new ID replaces reference; old idempotency replay cannot republish; natural completion retained');

  const catalog = (await request(flood.url, '/lab/catalog', 'LabCatalog')).value;
  const floodConfig = { ...catalog.default_config, agents: 80, interval_ms: 1000, simulation_duration: 150 };
  const running = (await request(flood.url, '/lab/runs', 'LabState', { method: 'POST', body: { config: floodConfig, expected_run_id: initialFlood.run_id } })).value;
  await request(flood.url, '/lab/runs', 'LabState', { method: 'POST', body: { config: floodConfig, expected_run_id: initialFlood.run_id }, status: 409 });
  const lateFlood = await until(async () => (await request(flood.url, '/lab/published', 'LabState')).value, value => value.scenario.simulation_step >= 2, 'late flood join');
  assert.equal(lateFlood.run_id, running.run_id); assert.deepEqual(lateFlood.timeline, []);
  await request(flood.url, '/lab/actions', 'LabState', { method: 'POST', body: { action: 'pause', expected_run_id: running.run_id } });
  const floodPaused = (await request(flood.url, '/lab/published', 'LabState')).value;
  assert.equal(floodPaused.state, 'paused');
  const graph = (await request(flood.url, `/lab/graph?run_id=${running.run_id}`, 'Graph')).value;
  assert.equal(graph.version, floodPaused.graph_version);
  const incidentGraph = (await request(flood.url, '/lab/graph?mode=full', 'Graph')).value;
  const edge = incidentGraph.edges.find(value => value.geometry?.length >= 2);
  const position = { lat: (edge.geometry[0].lat + edge.geometry[1].lat) / 2, lng: (edge.geometry[0].lng + edge.geometry[1].lng) / 2 };
  const incident = (await request(flood.url, '/v1/incidents', 'Incident', { method: 'POST', headers: { 'Idempotency-Key': randomUUID() }, status: 201, body: { incident_type: 'flooded_road', edge_id_hint: edge.id, latitude: position.lat, longitude: position.lng, description: 'Reporte ciudadano de prueba local; no describe una incidencia real.', severity_reported: 'moderate', road_passability_reported: 'restricted', event_time: new Date().toISOString(), location_method: 'manual' } })).value;
  assert.equal(incident.verification_status, 'pending'); assert.equal(incident.source_type, 'citizen');
  assert.deepEqual((await request(flood.url, '/lab/published', 'LabState')).value.scenario, floodPaused.scenario, 'Pending report cannot mutate flood graph');
  await request(flood.url, `/lab/incidents/${incident.incident_id}/status`, 'Incident', { method: 'POST', body: { verification_status: 'verified', note: 'No authorization' }, status: 401 });
  if (process.argv.includes('--flutter')) {
    const flutter = spawn(process.execPath, [path.join(root, 'tools/scripts/flutter.mjs'), 'test',
      '--dart-define=RUN_PUBLISHED_HTTP_TESTS=true', '--dart-define=RUN_INCIDENT_HTTP_TESTS=true',
      `--dart-define=WORLD_API_BASE_URL=${world.url}`, `--dart-define=FLOOD_API_BASE_URL=${flood.url}`, `--dart-define=INCIDENTS_API_BASE_URL=${flood.url}`,
      `--dart-define=EXPECTED_ZOMBIE_ID=${replacement.simulation_id}`, `--dart-define=EXPECTED_FLOOD_ID=${running.run_id}`,
      `--dart-define=INCIDENT_TEST_LATITUDE=${position.lat}`, `--dart-define=INCIDENT_TEST_LONGITUDE=${position.lng}`, `--dart-define=INCIDENT_TEST_EDGE_ID=${edge.id}`,
      'test/published_http_integration_test.dart', 'test/world_incidents_http_integration_test.dart'], { cwd: root, stdio: 'inherit', env: process.env });
    assert.equal((await once(flutter, 'exit'))[0], 0, 'Flutter observes shared runs and posts a real idempotent citizen report');
    assert.deepEqual((await request(flood.url, '/lab/published', 'LabState')).value.scenario, floodPaused.scenario, 'Flutter report does not mutate the paused simulation');
    report.checks.push('Flutter repositories use the same published IDs and real current snapshots; real citizen POST/replay/read/list passes without changing the simulation');
  }
  await request(flood.url, '/lab/actions', 'LabState', { method: 'POST', body: { action: 'resume', expected_run_id: running.run_id } });
  for (const spectators of [1, 10, 50]) await load(flood, spectators, '/lab/published', 'LabState');
  await request(flood.url, '/lab/actions', 'LabState', { method: 'POST', body: { action: 'restart', expected_run_id: running.run_id } });
  initialFlood = (await request(flood.url, '/lab/published', 'LabState')).value;
  assert.equal(initialFlood.state, 'idle');
  const fastFlood = (await request(flood.url, '/lab/runs', 'LabState', { method: 'POST', body: { config: { ...floodConfig, simulation_duration: 4, interval_ms: 0 }, expected_run_id: initialFlood.run_id } })).value;
  const finished = await until(async () => (await request(flood.url, '/lab/published', 'LabState')).value, value => value.state === 'finished', 'final flood');
  assert.equal(finished.run_id, fastFlood.run_id); assert.ok(finished.scenario.evacuation_metrics);
  report.checks.push('Anonymous flood start/pause/resume/restart; stale create returns 409; late join and final retained; real citizen report pending and cannot mutate simulation; moderation remains authenticated');
  report.result = 'PASS';
  console.log(JSON.stringify({ result: report.result, checks: report.checks, load: report.load, evidence: path.join(evidence, 'report.json') }, null, 2));
} catch (error) {
  report.result = 'FAIL'; report.error = error.message; console.error(error); process.exitCode = 1;
} finally {
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    const exited = once(child, 'exit'); child.kill('SIGTERM'); const timeout = setTimeout(() => child.kill('SIGKILL'), 5000); await exited; clearTimeout(timeout);
  }
  await rm(temporary, { recursive: true, force: true });
}
