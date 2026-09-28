import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const TOKEN = '__OFELIYA_RELEASE__';
const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
// Release identity is security/recovery metadata. Never silently stamp an ambiguous "dev"
// build: callers must provide the exact immutable git SHA they intend to ship/test.
const raw = String(process.env.VITE_RELEASE_SHA || '').trim();
if (!/^[0-9a-f]{40}$/i.test(raw)) {
  throw new Error('VITE_RELEASE_SHA must be an explicit 40-character git SHA');
}
const release = raw.toLowerCase();

for (const relative of ['dist/sw.js', 'dist/runtime-config.js']) {
  const path = resolve(relative);
  const source = readFileSync(path, 'utf8');
  if (!source.includes(TOKEN)) {
    throw new Error(`release token missing from ${relative}`);
  }
  writeFileSync(path, source.replaceAll(TOKEN, release));
}

const sha256 = (relative) =>
  createHash('sha256').update(readFileSync(resolve(relative))).digest('hex');

writeFileSync(
  resolve('dist/release.json'),
  JSON.stringify({
    release,
    version: String(pkg.version || 'unknown'),
    indexSha256: sha256('dist/index.html'),
    serviceWorkerSha256: sha256('dist/sw.js'),
    runtimeConfigSha256: sha256('dist/runtime-config.js'),
  }) + '\n'
);

console.log(`Stamped OFELIYA release ${release}`);
