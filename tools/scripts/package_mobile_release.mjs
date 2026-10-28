// Package already verified local clients and build both Go entrypoints.
// This prepares files only: it neither publishes nor restarts a remote service.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const destination = path.join(root, 'deploy/releases/mantasim-mobile-local');
const apk = path.join(root, 'apps/mobile/build/app/outputs/flutter-apk/app-debug.apk');
const web = path.join(root, 'apps/web/dist');
if (!existsSync(apk) || !existsSync(path.join(web, 'index.html'))) throw new Error('Ejecuta primero npm run build:web y npm run mobile:build.');
await mkdir(path.join(destination, 'bin'), { recursive: true });
const go = process.env.GO_BIN || (existsSync('/usr/local/go/bin/go') ? '/usr/local/go/bin/go' : 'go');
for (const name of ['server', 'flood-lab']) {
  const child = spawn(go, ['build', '-trimpath', '-o', path.join(destination, 'bin', name), `./cmd/${name}`], { cwd: path.join(root, 'services/evacuation'), stdio: 'inherit', env: { ...process.env, CGO_ENABLED: '0', GOOS: 'linux', GOARCH: 'amd64' } });
  if ((await once(child, 'exit'))[0] !== 0) throw new Error(`No pudo compilarse ${name}.`);
}
// cp to a fresh versioned directory is not a deployment. Remove no user files.
const build = path.join(destination, `artifacts-${Date.now()}`);
await mkdir(build);
await cp(web, path.join(build, 'web'), { recursive: true });
await cp(apk, path.join(build, 'mantasim-android-debug.apk'));
await cp(path.join(destination, 'bin'), path.join(build, 'bin'), { recursive: true });
await cp(path.join(root, 'services/evacuation/data'), path.join(build, 'data'), { recursive: true });
await cp(path.join(root, 'services/evacuation/scenarios'), path.join(build, 'scenarios'), { recursive: true });
await cp(path.join(root, 'packages/contracts/openapi.yaml'), path.join(build, 'openapi.yaml'));
await cp(path.join(root, 'packages/contracts/generated/schemas.json'), path.join(build, 'schemas.json'));
await cp(path.join(root, 'apps/mobile/README.md'), path.join(build, 'README-android.md'));
const validation = path.join(root, 'deploy/validation-phase7-mobile.json');
if (existsSync(validation)) await cp(validation, path.join(build, 'validation-phase7-mobile.json'));
await writeFile(path.join(build, 'LEEME.txt'), 'Artefactos locales; no desplegados. Android debug no es un release firmado para tiendas.\nIncluye grafos/escenarios versionados. Ejecutar bin/server y bin/flood-lab desde esta carpeta; conservar el directorio ciudadano privado existente por separado.\nNunca copiar credenciales de desarrollo. El backend requiere API_KEY fuera del paquete.\nEl laboratorio escucha loopback:8082; el servidor usa FLOOD_LAB_UPSTREAM=http://127.0.0.1:8082.\nPublicar /mobile y el APK requiere autorización y una URL real. No ejecutar reinicios remotos sin autorización.\n');
const files = [];
async function hashes(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await hashes(file);
    else { const data = await readFile(file); files.push({ path: path.relative(build, file), bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') }); }
  }
}
await hashes(build);
await writeFile(path.join(build, 'manifest.json'), JSON.stringify({ prepared_at: new Date().toISOString(), deployed: false, backend_platform: 'linux/amd64', android: 'debug', files }, null, 2) + '\n');
await writeFile(path.join(destination, 'latest.json'), JSON.stringify({ directory: build, deployed: false }, null, 2) + '\n');
console.log(`Artefactos preparados en ${build}; manifest.json contiene tamaños y SHA-256. Sin publicación ni despliegue.`);
