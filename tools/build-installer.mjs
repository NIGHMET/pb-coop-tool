// A directly draggable userscript, with no wrapper or extra installation code.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = fs.readFileSync(path.join(root, 'pb-coop-fix.user.js'));
if (!source.toString('utf8').startsWith('// ==UserScript==') || !source.includes('// ==/UserScript==')) {
  throw Error('Missing userscript metadata');
}
const destination = path.join(root, 'artifacts', 'install', 'pb-coop-tool-install.user.js');
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, source);
if (!fs.readFileSync(destination).equals(source)) throw Error('Installer content mismatch');
console.log(JSON.stringify({ installer: destination, bytes: source.length,
  sha256: createHash('sha256').update(source).digest('hex') }, null, 2));
