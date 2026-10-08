import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function load(path) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function('module', 'exports', code)(module, module.exports);
  return module.exports;
}
const { BIOLOGICAL_FRAMES, biologicalAtlasKey, biologicalFrameAt, bakeBiologicalFrame, ensureBiologicalAnimations } = load('src/game/BiologicalAnimation.ts');
const { artSourceFactor, artScale } = load('src/game/ArtMetrics.ts');
const started = performance.now();
for (const [key, size] of [['virus-player', 224], ['immune-antibody', 152]]) {
  const source = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    source[i] = x; source[i + 1] = y; source[i + 2] = 180;
    source[i + 3] = Math.hypot(x - size / 2, y - size / 2) < size * .45 ? 255 : 0;
  }
  const original = source.slice();
  assert.deepEqual(bakeBiologicalFrame(source, size, size, 0, key), source, 'neutral frame preserves original pixels');
  const first = bakeBiologicalFrame(source, size, size, 1, key);
  assert.deepEqual(first, bakeBiologicalFrame(source, size, size, 1, key), 'cycle deterministic');
  assert.notDeepEqual(first, source, 'interior changes beyond actor transforms');
  assert.deepEqual(source, original, 'canonical pixels not mutated');
  for (let frame = 0; frame < BIOLOGICAL_FRAMES; frame++) {
    const result = bakeBiologicalFrame(source, size, size, frame, key);
    assert.equal(result.length, source.length);
    for (let x = 0; x < size; x++) {
      assert.equal(result[x * 4 + 3], 0, 'transparent top boundary remains clear');
      assert.equal(result[((size - 1) * size + x) * 4 + 3], 0);
    }
  }
  assert.equal(artSourceFactor(biologicalAtlasKey(key)), 4);
  assert.equal(size * artScale(biologicalAtlasKey(key), 1), size / 4);
}
assert.deepEqual(Array.from({ length: 6 }, (_, i) => biologicalFrameAt(i * 120)), [0, 1, 2, 3, 4, 5]);
assert.deepEqual(Array.from({ length: 6 }, (_, i) => biologicalFrameAt(i * 240, 0, true)), [0, 2, 4, 0, 2, 4]);
assert.equal(biologicalFrameAt(720), 0);
assert.equal(biologicalFrameAt(-100), 0);

// Execute production boot bake against Canvas/Phaser I/O adapters, including failure cleanup.
const entries = new Map(), frames = [], uploads = [];
for (const [key, size] of [['virus-player', 224], ['immune-antibody', 152]]) entries.set(key, {
  get: () => ({ cutWidth: size, cutHeight: size }),
  getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray(size * size * 4) }) }),
});
const scene = { textures: {
  exists: key => entries.has(key), get: key => entries.get(key), remove: key => entries.delete(key),
  createCanvas(key, width, height) {
    const texture = { getContext: () => ({
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: (image, x, y) => uploads.push([key, image.data.length, x, y]),
    }), add: (...args) => frames.push([key, ...args]), refresh: () => { texture.refreshed = true; } };
    entries.set(key, texture); return texture;
  },
} };
ensureBiologicalAnimations(scene);
assert.equal(frames.length, 12);
for (const [key, name, index, x, y, width, height] of frames) {
  assert.equal(index, 0); assert.equal(y, 0); assert.equal(width, height);
  assert.equal(x, Number(name.slice(4)) * width);
  assert.equal(width, key.includes('virus-player') ? 224 : 152);
  assert.equal(entries.get(key).refreshed, true);
}
ensureBiologicalAnimations(scene);
assert.equal(frames.length, 12, 'repeated boot does not allocate atlases');
entries.delete('bio-cycle-virus-player');
scene.textures.createCanvas = (key) => { entries.set(key, { getContext() { throw new Error('Canvas unavailable'); } }); return entries.get(key); };
ensureBiologicalAnimations(scene);
assert.equal(entries.has('bio-cycle-virus-player'), false, 'partial atlas removed on failure');
assert.equal(entries.has('virus-player'), true, 'canonical fallback survives failure');
console.log(`biological animation: deterministic pixels, 12 invariant frames, bounded fallback PASS; desktop Node bake audit ${(performance.now() - started).toFixed(1)}ms (not mobile timing)`);
