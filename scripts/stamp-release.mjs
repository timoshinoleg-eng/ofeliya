import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TOKEN = '__OFELIYA_RELEASE__';
const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
// Vite compiles src/release.ts from VITE_RELEASE_SHA. Keep post-build stamping on the exact
// same fallback so the bundle, service worker, runtime config and release.json can never disagree.
const raw = String(process.env.VITE_RELEASE_SHA || 'dev').trim();
const release = raw.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 64) || 'dev';

for (const relative of ['dist/sw.js', 'dist/runtime-config.js']) {
  const path = resolve(relative);
  const source = readFileSync(path, 'utf8');
  if (!source.includes(TOKEN)) {
    throw new Error(`release token missing from ${relative}`);
  }
  writeFileSync(path, source.replaceAll(TOKEN, release));
}

writeFileSync(
  resolve('dist/release.json'),
  JSON.stringify({ release, version: String(pkg.version || 'unknown') }) + '\n'
);

console.log(`Stamped OFELIYA release ${release}`);
