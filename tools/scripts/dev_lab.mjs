// Local development only: the competition process and experimental laboratory
// have independent state and private ephemeral movement credentials.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../../', import.meta.url));
const backend = path.join(root, 'services/evacuation');
const go = process.env.GO_BIN || (existsSync('/usr/local/go/bin/go') ? '/usr/local/go/bin/go' : 'go');
const port = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new Error(`${name} debe estar entre 1024 y 65535.`);
  return value;
};
const ports = { web: port('LAB_WEB_PORT', 5173), world: port('LAB_WORLD_PORT', 8080), flood: port('LAB_FLOOD_PORT', 8082) };
if (new Set(Object.values(ports)).size !== 3) throw new Error('Los tres puertos del laboratorio deben ser distintos.');
const origin = `http://127.0.0.1:${ports.web}`;
const temporary = await mkdtemp(path.join(tmpdir(), 'corodev-lab-'));
const children = [];
let stopping = false;
let stopResolve;
const stopped = new Promise(resolve => { stopResolve = resolve; });

const stop = async () => {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  await Promise.race([Promise.all(children.map(child => child.exitCode === null ? once(child, 'exit') : Promise.resolve())), delay(5000)]);
  for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
  stopResolve();
};
process.on('SIGINT', () => { void stop(); });
process.on('SIGTERM', () => { void stop(); });

async function build(command, target) {
  const child = spawn(go, ['build', '-o', target, command], { cwd: backend, stdio: 'inherit' });
  children.push(child);
  if ((await once(child, 'exit'))[0] !== 0) throw new Error(`No se pudo compilar ${command}.`);
}

function launch(executable, args, options) {
  const child = spawn(executable, args, { ...options, stdio: 'inherit' });
  children.push(child);
  child.once('error', error => { console.error(error.message); process.exitCode = 1; void stop(); });
  child.once('exit', code => {
    if (!stopping) { console.error(`Un proceso local terminó (${code ?? 'señal'}).`); process.exitCode = code || 1; void stop(); }
  });
  return child;
}

async function ready(url) {
  for (let attempt = 0; attempt < 160 && !stopping; attempt++) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* Readiness only. */ }
    await delay(100);
  }
  throw new Error(`El servicio local no respondió en ${url}. Revisa si el puerto está ocupado.`);
}

try {
  await Promise.all([
    build('./cmd/server', path.join(temporary, 'world')),
    build('./cmd/flood-lab', path.join(temporary, 'flood-lab')),
  ]);
  if (stopping) throw new Error('Inicio interrumpido.');
  launch(path.join(temporary, 'world'), [], { cwd: backend, env: {
    ...process.env, API_KEY: randomBytes(32).toString('hex'), LISTEN_ADDR: `127.0.0.1:${ports.world}`,
    CORS_ORIGINS: origin, GRAPH_PATH: 'data/manta-v2.json', SCENARIO_PATH: 'scenarios/urban/round1.json',
    INITIAL_ROUND: 'round1', SIM_AUTOSTART: 'true', SIM_INTERVAL: '2s', SIM_CONCURRENCY: '16',
    ENABLE_FULL_MODE: 'false', ENABLE_EXPANDED_MODE: 'false',
    ADMIN_OPERATOR: '', ADMIN_ACCESS_HASH: '', ADMIN_ALLOW_INSECURE_LOOPBACK: 'false',
  } });
  launch(path.join(temporary, 'flood-lab'), ['-listen', `127.0.0.1:${ports.flood}`, '-origin', origin, '-data-dir', 'data', '-incident-dir', process.env.LAB_INCIDENT_DIR || 'private/incidents', '-reference-cache', process.env.LAB_REFERENCE_CACHE || 'private/reference.json', ...(process.env.LAB_REFERENCE_ONLINE === 'true' ? ['-reference-online'] : [])], { cwd: backend, env: process.env });
  await Promise.all([ready(`http://127.0.0.1:${ports.world}/healthz`), ready(`http://127.0.0.1:${ports.flood}/lab/catalog`)]);
  launch(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(ports.web), '--strictPort'], {
    cwd: path.join(root, 'apps/web'), env: {
      ...process.env, VITE_WORLD_API_BASE_URL: `http://127.0.0.1:${ports.world}`,
      VITE_FLOOD_API_BASE_URL: `http://127.0.0.1:${ports.flood}`,
      VITE_INCIDENTS_API_BASE_URL: `http://127.0.0.1:${ports.flood}`,
    },
  });
  await ready(origin);
  console.log(`\nCoroDev: abre ${origin}/escape\nSelecciona «Inundaciones urbanas» para controlar el laboratorio. Ctrl+C cierra los tres procesos.\n`);
  await stopped;
} catch (error) {
  if (!stopping) { console.error(error.message); process.exitCode = 1; }
  await stop();
} finally {
  await rm(temporary, { recursive: true, force: true });
}
