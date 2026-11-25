#!/usr/bin/env node
/**
 * Fetches the VF-02 UI icon sources from pinned public upstream commits.
 *
 * - Reads tools/icons-src/manifest.json (pinned commit + path per source).
 * - Downloads each outline SVG verbatim into tools/icons-src/svg/<source>/<path>.
 * - Copies both upstream LICENSE files into tools/icons-src/licenses/.
 * - Writes tools/icons-src/files.json with per-file bytes/sha256/upstream URL.
 *
 * Fails loudly on any non-200, non-SVG body, duplicate frame or path drift.
 * Usage: node scripts/fetch-icon-sources.mjs
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'tools', 'icons-src');
const manifest = JSON.parse(readFileSync(join(srcDir, 'manifest.json'), 'utf8'));

async function fetchVerified(url, { expectSvg = true } = {}) {
  const res = await fetch(url, { redirect: 'error' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const body = Buffer.from(await res.arrayBuffer());
  const text = body.toString('utf8');
  if (expectSvg && !text.includes('<svg')) throw new Error(`response is not an SVG: ${url}`);
  if (!expectSvg && body.length < 100) throw new Error(`suspiciously small license body: ${url}`);
  return body;
}

const files = {};
const seenFrames = new Set();
const errors = [];

for (const icon of manifest.icons) {
  if (seenFrames.has(icon.frame)) errors.push(`duplicate frame: ${icon.frame}`);
  seenFrames.add(icon.frame);
  const source = manifest.sources[icon.source];
  if (!source) {
    errors.push(`unknown source ${icon.source} for frame ${icon.frame}`);
    continue;
  }
  const url = `${source.baseUrl}/${icon.path}`;
  try {
    const body = await fetchVerified(url);
    const rel = join('svg', icon.source, icon.path);
    const dest = join(srcDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, body);
    files[rel.split('\\').join('/')] = {
      frame: icon.frame,
      source: icon.source,
      license: source.license,
      upstream: url,
      bytes: body.length,
      sha256: createHash('sha256').update(body).digest('hex'),
    };
    console.log(`ok ${icon.frame} <- ${icon.source}/${icon.path} (${body.length} bytes)`);
  } catch (error) {
    errors.push(`${icon.frame}: ${error.message}`);
  }
}

for (const [id, source] of Object.entries(manifest.sources)) {
  const url = `https://raw.githubusercontent.com/${source.repo}/${source.commit}/LICENSE`;
  try {
    const body = await fetchVerified(url, { expectSvg: false });
    const rel = source.licenseFile;
    const dest = join(srcDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, body);
    files[rel] = {
      source: id,
      license: source.license,
      upstream: url,
      bytes: body.length,
      sha256: createHash('sha256').update(body).digest('hex'),
    };
    console.log(`ok license ${id} (${body.length} bytes)`);
  } catch (error) {
    errors.push(`license ${id}: ${error.message}`);
  }
}

writeFileSync(join(srcDir, 'files.json'), JSON.stringify(files, null, 2) + '\n');

if (errors.length) {
  console.error('\nFAILED:');
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}
console.log(`\n${manifest.icons.length} icons + ${Object.keys(manifest.sources).length} licenses fetched and hashed.`);
