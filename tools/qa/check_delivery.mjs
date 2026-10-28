// Offline checks for publishable documentation and tracked secret material.
import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const files = [...new Set([...tracked, ...execFileSync('git', ['ls-files', '-z', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)])];
const failures = [];
let checked = 0;
const slug = text => text.toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/\s/g, '-');
for (const name of files.filter(name => name.endsWith('.md'))) {
  let source;
  try { source = await readFile(path.join(root, name), 'utf8'); } catch { continue; } // staged deletions
  const prose = source.replace(/```[^]*?```/g, '').replace(/<!--[^]*?-->/g, '').replace(/`[^`\n]*`/g, '');
  for (const match of prose.matchAll(/!?\[[^\]]*\]\(<?([^\s)>]+)>?(?:\s+"[^"]*")?\)/g)) {
    const target = match[1];
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) continue;
    let file, anchor;
    try { [file, anchor] = target.split('#').map(value => decodeURIComponent(value)); }
    catch { failures.push(`${name}: enlace codificado inválido`); continue; }
    const resolved = file ? path.resolve(path.dirname(path.join(root, name)), file.split('?')[0]) : path.join(root, name);
    try { await stat(resolved); } catch { failures.push(`${name}: falta ${target}`); continue; }
    const repositoryPath = path.relative(root, resolved).split(path.sep).join('/');
    if (!files.some(entry => entry === repositoryPath || entry.startsWith(`${repositoryPath}/`))) {
      failures.push(`${name}: ${target} no forma parte del árbol publicable`);
      continue;
    }
    checked++;
    if (anchor && resolved.endsWith('.md')) {
      const text = await readFile(resolved, 'utf8');
      const ids = new Set(); const counts = new Map();
      for (const heading of text.replace(/```[^]*?```/g, '').matchAll(/^#{1,6}\s+(.+)$/gm)) {
        const id = slug(heading[1]); const count = counts.get(id) || 0;
        ids.add(count ? `${id}-${count}` : id); counts.set(id, count + 1);
      }
      for (const html of text.matchAll(/(?:id|name)=["']([^"']+)["']/g)) ids.add(html[1]);
      if (!ids.has(anchor)) failures.push(`${name}: ancla ausente ${target}`);
    }
  }
}
for (const name of files) {
  if (/(^|\/)\.env(?:\.|$)/.test(name) && !name.endsWith('.example')) failures.push(`${name}: configuración privada versionada`);
  if (/\.(?:pem|key|p12|pfx|jks|keystore)$/.test(name)) failures.push(`${name}: material de credencial versionado`);
  let source;
  try { source = await readFile(path.join(root, name), 'utf8'); } catch { continue; }
  if (source.includes('\0')) continue;
  const patterns = [/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g];
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) failures.push(`${name}:${source.slice(0, match.index).split('\n').length}: posible credencial; revisar sin publicarla`);
}
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`Entrega: ${checked} enlaces locales/anclas correctos; sin .env privados, claves AWS reconocibles ni claves privadas en archivos versionados. La revisión no certifica el historial Git.`);
