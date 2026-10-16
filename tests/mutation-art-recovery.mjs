import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
const require = createRequire(import.meta.url), ts = require('typescript');
const cache = new Map();
function load(file) {
  file = resolve(file); if (cache.has(file)) return cache.get(file);
  const m = { exports: {} };
  const source = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'module', 'exports', source)(name => load(resolve(dirname(file), name + '.ts')), m, m.exports);
  cache.set(file, m.exports); return m.exports;
}
const { trackMutationArtSource, startMutationArtRecovery } = load('src/game/MutationArtRecovery.ts');
const keys = ['mutation-prism', 'mutation-halo', 'mutation-singularity'];
const prior = Object.fromEntries(['Image','document','setTimeout','clearTimeout'].map(k => [k, globalThis[k]]));
let images, timers, serial;
class FakeImage {
  naturalWidth = 512; naturalHeight = 512;
  set src(url) { this.url = url; if (url) images.push(this); }
  get src() { return this.url; }
  succeed() { this.onload?.(); }
  fail() { this.onerror?.(); }
}
function texture() {
  const ops = [], canvas = { width: 256, height: 256 };
  const context = { save(){}, restore(){}, setTransform(){}, clearRect(){ ops.push('clear'); }, drawImage(){ ops.push('draw'); } };
  return { ops, getSourceImage: () => canvas, getContext: () => context, refresh(){ ops.push('refresh'); } };
}
function fixture(states = [false, false, false]) {
  images = []; timers = new Map(); serial = 0;
  globalThis.Image = FakeImage;
  globalThis.document = { baseURI: 'https://game.example/ofeliya/', createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage(){} }) }) };
  globalThis.setTimeout = (fn, ms) => { const id = ++serial; timers.set(id, { fn, ms }); return id; };
  globalThis.clearTimeout = id => timers.delete(id);
  const map = new Map(keys.map((key, i) => { const t = texture(); if (states[i] !== undefined) trackMutationArtSource(key, t, states[i]); return [key, t]; }));
  const events = new EventEmitter(), game = { events, textures: { exists: key => map.has(key), get: key => map.get(key) } };
  return { game, map, events };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const runTimers = ms => { for (const [id, job] of [...timers]) if (job.ms === ms) { timers.delete(id); job.fn(); } };
let count = 0;
async function test(name, fn) { await fn(); count++; console.log('PASS ' + name); }
try {
  await test('no network before first render; duplicate starts and scene restarts share one recovery', async () => {
    const f = fixture(); startMutationArtRecovery(f.game); startMutationArtRecovery(f.game);
    assert.equal(images.length, 0); f.events.emit('postrender'); await flush();
    assert.equal(images.length, 3); assert.ok(images.every(i => i.src.startsWith('https://game.example/ofeliya/art/')));
    startMutationArtRecovery(f.game); f.events.emit('postrender'); assert.equal(images.length, 3);
    f.events.emit('destroy'); await flush(); assert.equal(timers.size, 0);
  });
  await test('packaged and unknown textures are untouched; late art refreshes same bounded canvas object', async () => {
    const f = fixture([false, true, undefined]), original = f.map.get(keys[0]);
    startMutationArtRecovery(f.game); f.events.emit('postrender'); await flush();
    assert.equal(images.length, 1); images[0].succeed(); await flush();
    assert.equal(f.map.get(keys[0]), original); assert.deepEqual(original.ops, ['clear','draw','refresh']);
    assert.deepEqual(original.getSourceImage(), { width: 256, height: 256 });
    assert.deepEqual(f.map.get(keys[1]).ops, []); assert.deepEqual(f.map.get(keys[2]).ops, []);
    assert.equal(timers.size, 0); assert.equal(f.events.listenerCount('destroy'), 0);
  });
  await test('failure/timeout retain fallback, retry once only, and release all timers/listeners', async () => {
    const f = fixture(); startMutationArtRecovery(f.game); f.events.emit('postrender'); await flush();
    runTimers(8000); await flush(); assert.equal(images.length, 3);
    runTimers(750); await flush(); assert.equal(images.length, 6);
    for (const image of images.slice(3)) image.fail(); await flush();
    assert.equal(timers.size, 0); assert.equal(f.events.listenerCount('destroy'), 0);
    for (const t of f.map.values()) assert.deepEqual(t.ops, []);
    startMutationArtRecovery(f.game); f.events.emit('postrender'); assert.equal(images.length, 6);
  });
  await test('game destruction cancels requests and prevents late decode from altering existing sprites', async () => {
    const f = fixture(); startMutationArtRecovery(f.game); f.events.emit('postrender'); await flush();
    const callbacks = images.map(image => image.onload); f.events.emit('destroy'); await flush();
    for (const callback of callbacks) callback?.(); await flush();
    assert.equal(timers.size, 0); for (const t of f.map.values()) assert.deepEqual(t.ops, []);
    assert.equal(f.events.listenerCount('postrender'), 0); assert.equal(f.events.listenerCount('destroy'), 0);
  });
  await test('replaced textures and superseded provenance are never overwritten by a late response', async () => {
    const f = fixture(); startMutationArtRecovery(f.game); f.events.emit('postrender'); await flush();
    const original = f.map.get(keys[0]); f.map.set(keys[0], texture());
    trackMutationArtSource(keys[1], f.map.get(keys[1]), true);
    for (const image of images) image.succeed(); await flush();
    assert.deepEqual(original.ops, []); assert.deepEqual(f.map.get(keys[0]).ops, []);
    assert.deepEqual(f.map.get(keys[1]).ops, []); assert.deepEqual(f.map.get(keys[2]).ops, ['clear','draw','refresh']);
  });
} finally { for (const [key, value] of Object.entries(prior)) if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
console.log(`mutation art recovery: ${count} contracts passed`);
