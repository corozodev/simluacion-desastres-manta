import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// FLUTTER_BIN may be an absolute executable path. Otherwise use Flutter on PATH.
const executable = process.env.FLUTTER_BIN || (process.platform === 'win32' ? 'flutter.bat' : 'flutter');
const result = spawnSync(executable, process.argv.slice(2), {
  cwd: fileURLToPath(new URL('../../apps/mobile/', import.meta.url)),
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});
if (result.error) console.error(`Flutter no disponible: ${result.error.message}. Añade flutter/bin al PATH o configura FLUTTER_BIN.`);
process.exit(result.status ?? 1);
