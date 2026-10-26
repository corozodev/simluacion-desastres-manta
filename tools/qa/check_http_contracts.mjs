import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const root = fileURLToPath(new URL('../../', import.meta.url));
const backend = path.join(root, 'services/evacuation');
const urban = process.argv.includes('--urban');
const schema = JSON.parse(await readFile(path.join(root, 'packages/contracts/generated/schemas.json'), 'utf8'));
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(schema, 'contract');
const check = (name, value) => {
  const validate = ajv.compile({ $ref: `contract#/definitions/${name}` });
  if (!validate(value)) throw new Error(`${name}: ${ajv.errorsText(validate.errors)}`);
};
const temporary = await mkdtemp(path.join(tmpdir(), 'corodev-contracts-'));
let server;
let web;
let browser;
try {
  const go = process.env.GO_BIN || (existsSync('/usr/local/go/bin/go') ? '/usr/local/go/bin/go' : 'go');
  const binary = path.join(temporary, 'server');
  const build = spawn(go, ['build', '-o', binary, './cmd/server'], { cwd: backend, stdio: ['ignore', 'inherit', 'inherit'] });
  const [buildCode] = await once(build, 'exit');
  if (buildCode !== 0) throw new Error(`Go build exited ${buildCode}`);
  const key = randomBytes(32).toString('hex');
  server = spawn(binary, [], {
    cwd: backend,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, API_KEY: key, LISTEN_ADDR: '127.0.0.1:0', SIM_INTERVAL: '1h', SIM_TURNS: '150', SCENARIO_PATH: urban ? 'scenarios/urban/round1.json' : 'scenarios/round1.json', GRAPH_PATH: urban ? 'data/manta-v2.json' : 'data/manta-v1.json', CORS_ORIGINS: 'http://localhost:5173,http://127.0.0.1:5174' },
  });
  const ready = new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('Backend readiness timed out')), 10000);
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Backend exited ${code}`)); });
    server.once('error', error => { clearTimeout(timer); reject(error); });
    server.stdout.on('data', data => {
      buffer += data.toString();
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        try {
          const record = JSON.parse(line);
          if (record.msg === 'backend ready') { clearTimeout(timer); resolve(record.url); }
        } catch { /* Only structured readiness output is relevant. */ }
      }
    });
    // Consume stderr without printing process configuration or credentials.
    server.stderr.resume();
  });
  const baseUrl = await ready;
  const get = async (route, name) => {
    const response = await fetch(`${baseUrl}${route}`, { signal: AbortSignal.timeout(2000) });
    if (response.status !== 200) throw new Error(`${route}: HTTP ${response.status}`);
    const body = await response.json(); check(name, body); return body;
  };
  await get('/healthz', 'HealthResponse');
  const graph = await get('/grafo', 'Graph');
  let state;
  // The first turn publishes a decision snapshot, then final state. Wait for a
  // successful request count so the 1h interval provides a stable final snapshot.
  for (let attempt = 0; attempt < 100; attempt++) {
    state = await get('/estado', 'WorldSnapshot');
    if (state.turn === 1 && state.metrics.requests_success > 0) break;
    await delay(20);
  }
  if (state?.turn !== 1 || state.metrics.requests_success === 0) throw new Error('First HTTP simulation turn did not finish');
  if (urban) {
    if (graph.spawn_zones?.length !== 4 || !graph.edges.every(edge => edge.geometry?.length >= 2)) throw new Error('Urban graph lacks verified zones or real geometries');
    for (const survivor of state.survivors) {
      if (!graph.spawn_zones.some(zone => zone.id === survivor.spawn_zone_id)) throw new Error('Urban survivor lacks a valid origin zone');
    }
    for (const shelter of state.shelters) {
      if (shelter.reserved === undefined || shelter.available === undefined || shelter.occupancy + shelter.reserved + shelter.available !== shelter.capacity) throw new Error('Incoherent urban shelter reservations');
    }
  }
  const survivor = state.survivors.find(entry => entry.status === 'active');
  if (!survivor) throw new Error('No active survivor for contract test');
  const request = { sobrevivienteId: survivor.id, nodoActual: survivor.current_node, turno: state.turn };
  check('StepRequest', request);
  const post = (body, credential) => fetch(`${baseUrl}/paso`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(credential ? { 'x-api-key': credential } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(2000) });
  const response = await post(request, key);
  if (response.status !== 200) throw new Error(`/paso: HTTP ${response.status}`);
  const decision = await response.json(); check('StepResponse', decision);
  const traversable = decision.siguienteNodo === survivor.current_node || graph.edges.some(edge => !edge.blocked && !state.blocked_edges.includes(edge.id) && ((edge.from === survivor.current_node && edge.to === decision.siguienteNodo) || (!edge.directed && edge.to === survivor.current_node && edge.from === decision.siguienteNodo)));
  if (!traversable) throw new Error('Decision did not contain a traversable adjacent node');
  for (const [body, credential, expected] of [[request, undefined, 401], [{ ...request, turno: state.turn + 1 }, key, 409], [{ ...request, turno: 'invalid' }, key, 400]]) {
    const error = await post(body, credential);
    if (error.status !== expected) throw new Error(`Expected HTTP ${expected}, received ${error.status}`);
    const envelope = await error.json(); check('ErrorResponse', envelope);
    if (envelope.error.requestId !== error.headers.get('x-request-id')) throw new Error('Request ID mismatch');
  }
  console.log(`Contrato HTTP Go correcto: healthz, grafo (${graph.nodes.length} nodos), estado, paso autenticado y errores 400/401/409.`);
  if (process.argv.includes('--flutter')) {
    const flutter = spawn(process.env.FLUTTER_BIN || 'flutter', ['test', '--dart-define=RUN_WORLD_HTTP_TESTS=true', `--dart-define=EXPECT_URBAN_WORLD=${urban}`, `--dart-define=WORLD_API_BASE_URL=${baseUrl}`, 'test/world_http_integration_test.dart'], {
      cwd: path.join(root, 'apps/mobile'), stdio: 'inherit',
    });
    const [code] = await once(flutter, 'exit');
    if (code !== 0) throw new Error(`Flutter HTTP integration exited ${code}`);
  }
  if (process.argv.includes('--browser')) {
    const { chromium } = await import('@playwright/test');
    web = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5174', '--strictPort'], {
      cwd: path.join(root, 'apps/web'),
      stdio: 'ignore',
      env: { ...process.env, VITE_API_MODE: 'mock', VITE_API_BASE_URL: 'http://localhost:3001', VITE_WORLD_API_BASE_URL: baseUrl },
    });
    let webReady = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (web.exitCode !== null) throw new Error(`Vite exited ${web.exitCode}`);
      try { const response = await fetch('http://127.0.0.1:5174', { signal: AbortSignal.timeout(500) }); if (response.ok) { webReady = true; break; } } catch { /* Wait for Vite to accept connections. */ }
      await delay(50);
    }
    if (!webReady) throw new Error('Vite did not start on port 5174');
    browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const credentialLeaks = [], demoHealthRequests = [];
    page.on('request', request => {
      if (request.url().startsWith(baseUrl) && request.headers()['x-api-key']) credentialLeaks.push(request.url());
      if (new URL(request.url()).pathname === '/health') demoHealthRequests.push(request.url());
    });
    await page.goto('http://127.0.0.1:5174/escape');
    await page.getByRole('img', { name: /Red de evacuación y posiciones observables/ }).waitFor();
    await page.getByText(`${graph.source} · ${graph.nodes.length} nodos · ${graph.edges.length} aristas`, { exact: true }).waitFor();
    const map = page.getByRole('img', { name: /Red de evacuación y posiciones observables/ });
    const initialView = await map.getAttribute('viewBox');
    await page.getByRole('button', { name: 'Acercar mapa', exact: true }).click();
    if (await map.getAttribute('viewBox') === initialView) throw new Error('Map zoom did not change viewport');
    const zoomedView = await map.getAttribute('viewBox');
    await page.getByRole('button', { name: 'Mover mapa al este', exact: true }).click();
    if (await map.getAttribute('viewBox') === zoomedView) throw new Error('Map pan did not change viewport');
    await page.getByRole('button', { name: 'Restablecer mapa', exact: true }).click();
    if (await map.getAttribute('viewBox') !== initialView) throw new Error('Map reset did not restore viewport');
    await page.getByRole('searchbox', { name: 'Buscar por ID' }).fill(survivor.id);
    await page.getByRole('cell', { name: survivor.id, exact: true }).waitFor();
    await page.getByText('Refugio asignado:', { exact: false }).waitFor();
    if (urban && await page.locator('.escape-spawn-zone').count() !== 4) throw new Error('Urban spawn polygons missing in browser');
    await page.setViewportSize({ width: 390, height: 844 });
    if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error('Escape page overflows mobile viewport');
    if (credentialLeaks.length) throw new Error('Browser sent movement credentials');
    if (demoHealthRequests.length) throw new Error('Escape connection incorrectly queried the demo health API');
    console.log(`React navegador correcto: ${urban ? 'Manta v2' : 'Manta v1'}, geometrías, zoom/desplazamiento, búsqueda y ruta; viewport móvil sin desborde ni credenciales.`);
  }
} finally {
  if (browser) await browser.close();
  for (const process of [web, server]) {
    if (process && process.exitCode === null && process.signalCode === null) {
      const exited = once(process, 'exit');
      process.kill('SIGTERM');
      const timer = setTimeout(() => process.kill('SIGKILL'), 5000);
      await exited;
      clearTimeout(timer);
    }
  }
  await rm(temporary, { recursive: true, force: true });
}
