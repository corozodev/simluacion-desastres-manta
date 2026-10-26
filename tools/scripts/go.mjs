import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const executable = process.env.GO_BIN || (existsSync('/usr/local/go/bin/go') ? '/usr/local/go/bin/go' : 'go');
const result = spawnSync(executable, process.argv.slice(2), {
  cwd: fileURLToPath(new URL('../../services/evacuation/', import.meta.url)),
  stdio: 'inherit',
  env: process.env,
});
if (result.error) console.error(`Go no disponible: ${result.error.message}. Configura GO_BIN o PATH.`);
process.exit(result.status ?? 1);
