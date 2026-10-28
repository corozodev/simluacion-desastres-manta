import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../../', import.meta.url));
const runtime = path.join(root, '.local/dev.json');
const go = process.env.GO_BIN || (existsSync('/usr/local/go/bin/go') ? '/usr/local/go/bin/go' : 'go');
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error(`Falló ${command} ${args.join(' ')}${result.error ? `: ${result.error.message}` : ''}`);
}
const npm = (...args) => run(process.platform === 'win32' ? 'npm.cmd' : 'npm', args);
async function createConfig(target, contents) {
  try {
    await writeFile(path.join(root, target), contents, { flag: 'wx', mode: 0o600 });
    console.log(`Creado ${target}; valores privados omitidos.`);
  } catch (error) { if (error.code !== 'EEXIST') throw error; console.log(`Conservado ${target}.`); }
}
async function record({ removeStale = false } = {}) {
  let value;
  try { value = JSON.parse(await readFile(runtime, 'utf8')); }
  catch { throw new Error('No hay un entorno local registrado. Ejecuta make dev.'); }
  if (!Number.isInteger(value.pid) || value.pid < 1) throw new Error('Registro local sin PID válido.');
  if (removeStale) {
    try { process.kill(value.pid, 0); }
    catch (error) {
      if (error.code !== 'ESRCH') throw error;
      await unlink(runtime);
      console.log('Retirado registro de proceso terminado; datos conservados.');
      return null;
    }
  }
  for (const name of ['control', 'world', 'flood', 'web']) {
    const url = new URL(value[name]);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/' || url.username || url.password || url.search || url.hash) throw new Error('Registro local inválido; no se enviarán credenciales.');
  }
  if (!Number.isInteger(value.pid) || value.pid < 1 || !/^[a-f0-9]{64}$/.test(value.stopToken) || !value.apiKey) throw new Error('Registro local incompleto.');
  return value;
}
async function request(url, options = {}, expected = 200) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (response.status !== expected) throw new Error(`${new URL(url).pathname}: HTTP ${response.status}, esperado ${expected}.`);
  return response;
}
async function main() {
  switch (process.argv[2] || 'help') {
    case 'help':
      console.log('make setup  Herramientas, npm y configuración local sin sobrescribir\nmake dev    React :5173, sesiones Go :8080 y laboratorio :8082; inicio manual\nmake stop   Detener ese entorno sin eliminar reportes ni volúmenes\nmake test   Pruebas JavaScript y Go\nmake smoke  Health, catálogo, publicados y /paso autenticado del entorno activo\nmake verify Contratos, lint, pruebas/race, HTTP real y builds web/Go\n\nFlutter es opcional: npm run mobile:check, mobile:test y mobile:build.\nGuía: docs/development/local-setup.md.');
      break;
    case 'setup': {
      if (Number(process.versions.node.split('.')[0]) < 22 || (Number(process.versions.node.split('.')[0]) === 22 && Number(process.versions.node.split('.')[1]) < 12)) throw new Error('Se requiere Node >=22.12.');
      run(go, ['version']); run('python3', ['--version']); npm('--version');
      await mkdir(path.join(root, '.local'), { recursive: true, mode: 0o700 });
      const template = await readFile(path.join(root, '.env.example'), 'utf8');
      await createConfig('.env', template.replace(/^API_KEY=.*$/m, `API_KEY=${randomBytes(32).toString('hex')}`));
      await createConfig('apps/web/.env.local', 'VITE_WORLD_API_BASE_URL=http://127.0.0.1:8080\nVITE_FLOOD_API_BASE_URL=http://127.0.0.1:8082\nVITE_INCIDENTS_API_BASE_URL=http://127.0.0.1:8082\nVITE_OSM_TILES_ENABLED=false\n');
      npm('install'); npm('run', 'contracts:generate'); npm('run', 'tokens:generate');
      console.log('Listo: make dev. No requiere AWS ni configuración manual para la demo web.\nOpcionales: LAB_* para puertos/directorios. Configuración AWS y móvil: consultar la guía.');
      break;
    }
    case 'stop': {
      if (!existsSync(runtime)) { console.log('No hay un entorno local registrado.'); break; }
      const value = await record({ removeStale: true });
      if (!value) break;
      try {
        await request(`${value.control}/stop`, { method: 'POST', headers: { Authorization: `Bearer ${value.stopToken}` } }, 202);
      } catch (error) {
        try { process.kill(value.pid, 0); }
        catch (status) { if (status.code === 'ESRCH') { await unlink(runtime); console.log('Retirado registro de proceso terminado; datos conservados.'); break; } throw status; }
        throw new Error(`El proceso registrado sigue vivo y no acepta control local: ${error.message}. Usa Ctrl+C en su terminal; no se detuvieron otros procesos.`, { cause: error });
      }
      for (let attempt = 0; attempt < 100; attempt++) {
        if (!existsSync(runtime)) break;
        const current = JSON.parse(await readFile(runtime, 'utf8').catch(() => '{}'));
        if (current.stopToken !== value.stopToken) break;
        if (attempt === 99) throw new Error('Cierre solicitado, pero el entorno no terminó en 10 s. Revisa su terminal.');
        await delay(100);
      }
      console.log('Entorno local detenido; los reportes se conservan.');
      break;
    }
    case 'smoke': {
      const value = await record();
      await request(`${value.web}/escape`);
      await request(`${value.world}/healthz`);
      await request(`${value.world}/v1/simulations/capabilities`);
      await request(`${value.world}/v1/simulations/published/zombie_outbreak`);
      await request(`${value.flood}/lab/catalog`);
      await request(`${value.flood}/lab/published`);
      const state = await (await request(`${value.world}/estado`)).json();
      if (state.turn !== 0 || state.simulation?.state !== 'idle') throw new Error('El runtime /estado debe permanecer inactivo.');
      const survivor = state.survivors.find(entry => entry.status === 'active');
      if (!survivor) throw new Error('Falta un sobreviviente observable para probar /paso.');
      const body = JSON.stringify({ sobrevivienteId: survivor.id, nodoActual: survivor.current_node, turno: state.turn });
      const headers = { 'Content-Type': 'application/json' };
      await request(`${value.world}/paso`, { method: 'POST', headers, body }, 401);
      const step = await (await request(`${value.world}/paso`, { method: 'POST', headers: { ...headers, 'x-api-key': value.apiKey }, body })).json();
      if (typeof step.siguienteNodo !== 'string' || Object.keys(step).length !== 1) throw new Error('Respuesta /paso inválida.');
      const graph = await (await request(`${value.world}/grafo`)).json();
      if (step.siguienteNodo !== survivor.current_node && !graph.edges.some(edge => !edge.blocked && !state.blocked_edges.includes(edge.id) && ((edge.from === survivor.current_node && edge.to === step.siguienteNodo) || (!edge.directed && edge.to === survivor.current_node && edge.from === step.siguienteNodo)))) throw new Error('/paso no devolvió espera ni vecino transitable.');
      console.log('Smoke local correcto: web, Go, laboratorio, publicados y /paso 401/200 con movimiento válido. Ninguna simulación iniciada.');
      break;
    }
    case 'test':
      npm('test'); npm('run', 'test:backend'); break;
    case 'verify':
      for (const script of ['docs:check', 'check', 'test:backend', 'test:race', 'build:backend', 'graph:test', 'test:contracts:http', 'test:contracts:simulations', 'test:contracts:flood', 'test:spectators:http', 'build:web']) npm('run', script);
      npm('test');
      console.log('Verificación web/Go terminada. Benchmarks, navegador y Flutter se ejecutan aparte: docs/pruebas.md.');
      break;
    default: throw new Error('Comando desconocido. Ejecuta make help.');
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
