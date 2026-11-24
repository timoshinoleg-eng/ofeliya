#!/usr/bin/env node
/**
 * VF-02 UI icon atlas contract (node-only, no browser).
 *
 * Locks: pinned upstream provenance, license copies, deterministic atlas
 * artifacts (PNG dims <= 1024x1024, JSON frame rects, generated iconFrames.ts
 * with the exact UI_ICON_ATLAS_KEY), and the BootScene optional-preload seam
 * (maxRetries=0 / timeout 1800 window) without loosening startup budgets.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'tools', 'icons-src');
const manifest = JSON.parse(readFileSync(join(srcDir, 'manifest.json'), 'utf8'));
const files = JSON.parse(readFileSync(join(srcDir, 'files.json'), 'utf8'));

// 1. Manifest shape: 45-60 icons, pinned sources, default-first variants.
assert.ok(manifest.icons.length >= 45 && manifest.icons.length <= 60, `icon count ${manifest.icons.length} outside 45-60`);
const frames = manifest.icons.map((icon) => icon.frame);
assert.equal(new Set(frames).size, frames.length, 'duplicate frame in manifest');
for (const [id, source] of Object.entries(manifest.sources)) {
  assert.match(source.commit, /^[0-9a-f]{40}$/, `${id} commit not pinned`);
  assert.match(source.baseUrl, new RegExp(source.commit), `${id} baseUrl must embed the pinned commit`);
}
assert.equal(manifest.variants[0].id, 'default', 'default variant must be first');
assert.deepEqual(manifest.variants.map((v) => v.id), ['default', 'host', 'immune', 'danger']);

// 2. Per-file provenance: every icon downloaded verbatim, hashed, URL pinned.
for (const icon of manifest.icons) {
  const rel = `svg/${icon.source}/${icon.path}`;
  const entry = files[rel];
  assert.ok(entry, `files.json missing ${rel}`);
  assert.equal(entry.frame, icon.frame);
  assert.equal(entry.license, manifest.sources[icon.source].license);
  const body = readFileSync(join(srcDir, rel));
  assert.equal(body.length, entry.bytes, `${rel} bytes drifted`);
  assert.equal(createHash('sha256').update(body).digest('hex'), entry.sha256, `${rel} sha256 drifted`);
  assert.ok(entry.upstream.startsWith(manifest.sources[icon.source].baseUrl), `${rel} upstream not pinned`);
  assert.ok(body.toString('utf8').includes('<svg'), `${rel} is not an SVG`);
}
for (const [id, source] of Object.entries(manifest.sources)) {
  assert.ok(existsSync(join(srcDir, source.licenseFile)), `license copy missing for ${id}`);
  const licenseText = readFileSync(join(srcDir, source.licenseFile), 'utf8');
  if (source.license === 'CC0-1.0') assert.match(licenseText, /CC0 1\.0 Universal/);
  if (source.license === 'MIT') assert.match(licenseText, /MIT License/);
}

// 3. Atlas artifacts: PNG dims, JSON frames, generated registry.
const png = readFileSync(join(root, 'public/assets/ui-icons-atlas.png'));
assert.equal(png.readUInt32BE(0), 0x89504e47, 'not a PNG');
const pngW = png.readUInt32BE(16);
const pngH = png.readUInt32BE(20);
assert.ok(pngW <= 1024 && pngH <= 1024, `atlas ${pngW}x${pngH} exceeds 1024x1024`);

const atlas = JSON.parse(readFileSync(join(root, 'public/assets/ui-icons-atlas.json'), 'utf8'));
assert.equal(atlas.meta.image, 'ui-icons-atlas.png');
assert.deepEqual(atlas.meta.size, { w: pngW, h: pngH });
const expectedFrames = manifest.variants.length * manifest.icons.length;
assert.equal(Object.keys(atlas.frames).length, expectedFrames, 'frame count != icons x variants');
for (const icon of manifest.icons) {
  for (const variant of manifest.variants) {
    const name = variant.id === 'default' ? icon.frame : `${icon.frame}.${variant.id}`;
    const frame = atlas.frames[name];
    assert.ok(frame, `missing atlas frame ${name}`);
    assert.equal(frame.frame.w, 52, '48px icon + 2px padding');
    assert.equal(frame.frame.h, 52);
    assert.ok(frame.frame.x >= 0 && frame.frame.y >= 0, `${name} negative origin`);
    assert.ok(frame.frame.x + frame.frame.w <= pngW && frame.frame.y + frame.frame.h <= pngH, `${name} outside image`);
  }
}

const generated = readFileSync(join(root, 'src/ui/generated/iconFrames.ts'), 'utf8');
assert.ok(generated.includes(`export const UI_ICON_ATLAS_KEY = 'ui-icons' as const;`), 'exact atlas key const missing');
const unionBlock = generated.match(/export type UiIconFrame =\n([\s\S]*?);/);
assert.ok(unionBlock, 'UiIconFrame union missing');
const unionFrames = [...unionBlock[1].matchAll(/'([^']+)'/g)].map((match) => match[1]).sort();
assert.deepEqual(unionFrames, [...frames].sort(), 'UiIconFrame union != manifest frames');
assert.ok(generated.includes("UI_ICON_VARIANTS = ['default', 'host', 'immune', 'danger']"), 'variant registry missing');

// 4. build-info consistency with committed artifacts.
const buildInfo = JSON.parse(readFileSync(join(srcDir, 'build-info.json'), 'utf8'));
assert.equal(buildInfo.frames, expectedFrames);
assert.deepEqual(buildInfo.size, { w: pngW, h: pngH });
assert.match(buildInfo.pixelHashFNV1a, /^[0-9a-f]{8}$/);
assert.equal(buildInfo.manifestSha256, createHash('sha256').update(readFileSync(join(srcDir, 'manifest.json'))).digest('hex'));
assert.equal(buildInfo.pngSha256, createHash('sha256').update(png).digest('hex'));
assert.equal(buildInfo.jsonSha256, createHash('sha256').update(readFileSync(join(root, 'public/assets/ui-icons-atlas.json'))).digest('hex'));

// 5. BootScene seam: optional atlas inside the same maxRetries=0 / 1800ms window;
// makeIcons (up-*) and CORE_ART loop must be preserved untouched.
const bootSource = readFileSync(join(root, 'src/scenes/BootScene.ts'), 'utf8');
assert.ok(bootSource.includes('this.load.maxRetries = 0;'), 'maxRetries=0 window removed');
assert.ok(/this\.load\.image\(rawArtKey\(key\), `art\/\$\{key\}\.webp`, \{ responseType: 'blob', timeout: 1800 \}\)/.test(bootSource), 'CORE_ART load policy changed');
assert.ok(bootSource.includes("this.load.atlas(UI_ICON_ATLAS_KEY, 'assets/ui-icons-atlas.png', 'assets/ui-icons-atlas.json'"), 'atlas preload missing');
const atlasLine = bootSource.split('\n').find((line) => line.includes('this.load.atlas('));
assert.ok(atlasLine.includes('timeout: 1800') && atlasLine.split('timeout: 1800').length - 1 >= 2, 'atlas must carry the 1800ms timeout for png+json');
assert.ok(!bootSource.includes('installUiIconFallbacks(this);'), 'fallbacks must be lazy to keep the startup budget');
assert.ok(bootSource.includes("g.generateTexture(`up-${id}`, 40, 40);"), 'makeIcons up-* convention changed');

// 6. Helper: instant procedural up-icon-* fallback for missing texture/frame.
const helperSource = readFileSync(join(root, 'src/ui/uiIcons.ts'), 'utf8');
assert.ok(helperSource.includes("return variant === 'default' ? `up-icon-${frame}` : `up-icon-${frame}-${variant}`;"), 'up-icon-* fallback key missing');
assert.ok(helperSource.includes('scene.textures.createCanvas(key, FALLBACK_SIZE, FALLBACK_SIZE)'), 'instant canvas fallback missing');

console.log(`ui-icon-atlas contract: ${manifest.icons.length} icons, ${expectedFrames} frames, ${pngW}x${pngH}, pixelHash ${buildInfo.pixelHashFNV1a} PASS`);
