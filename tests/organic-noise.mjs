import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
const require = createRequire(import.meta.url), ts = require('typescript'), modules = new Map();
function load(file) {
  file = resolve(file); if (modules.has(file)) return modules.get(file);
  const m = { exports: {} };
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', code)(name => load(resolve(dirname(file), name.endsWith('.js') ? name : name + '.ts')), m, m.exports);
  modules.set(file, m.exports); return m.exports;
}
Object.defineProperty(globalThis, 'performance', { value: { now: () => 0 }, configurable: true });
let made = 0, pixels;
globalThis.document = { createElement(tag) { assert.equal(tag, 'canvas'); made++; return { getContext() { return { createImageData(w,h) { return { data: new Uint8ClampedArray(w*h*4) }; }, putImageData(image) { pixels = image.data; } }; } }; } };
const { wrapSample, prepareOrganicNoise, applyOrganicNoise, organicBakeMetrics } = load('src/game/OrganicNoise.ts');
const sample = (x,y) => Math.sin(x * 0.12 + y * 0.07);
for (let n = 0; n <= 64; n++) { assert.ok(Math.abs(wrapSample(sample,0,n)-wrapSample(sample,64,n)) < 1e-12); assert.ok(Math.abs(wrapSample(sample,n,0)-wrapSample(sample,n,64)) < 1e-12); }
prepareOrganicNoise(); prepareOrganicNoise(); assert.equal(made,1); assert.equal(pixels.length,64*64*4); assert.ok(new Set(pixels.filter((_,i)=>i%4===0)).size > 8); assert.ok(organicBakeMetrics.ms >= 0);
const calls = [], ctx = {save(){calls.push('save')},restore(){calls.push('restore')},drawImage(...args){calls.push(args)}};
applyOrganicNoise(ctx,100,80);
if (!organicBakeMetrics.skipped) { assert.equal(ctx.globalCompositeOperation,'source-atop'); assert.equal(ctx.globalAlpha,0.055); assert.deepEqual(calls[1].slice(1),[0,0,100,80]); assert.equal(ctx.imageSmoothingEnabled,true); }
console.log('organic noise: wrap endpoints, cache, pixel variation and overlay contracts pass', organicBakeMetrics);
