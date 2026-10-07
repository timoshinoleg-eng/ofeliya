import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const EventEmitter = require('eventemitter3');
const cache = new Map();
// Phaser needs a DOM. This adapter records our calls at the rendering boundary; policy,
// budgeting, pooling, texture recipe and contact transforms execute their real TS code.
const phaser = { BlendModes: { ADD: 1 }, Math: { Clamp: (v, a, b) => Math.max(a, Math.min(b, v)) } };
function load(path) {
  path = new URL(path, `file://${process.cwd()}/`).pathname;
  if (cache.has(path)) return cache.get(path);
  const module = { exports: {} }; cache.set(path, module.exports);
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText;
  const localRequire = name => name === 'phaser' ? phaser : load(new URL(`${name}.ts`, new URL(path, `file://${process.cwd()}/`)).pathname);
  new Function('require', 'module', 'exports', code)(localRequire, module, module.exports);
  cache.set(path, module.exports); return module.exports;
}
const { COLORS } = load('src/game/config.ts');
const { PERFORMANCE } = load('src/systems/PerformanceProfile.ts');
const { VfxSystem } = load('src/systems/VfxSystem.ts');
function fixture() {
  const particles = [], circles = [], tweens = [];
  const scene = { time: { now: 1000 }, events: new EventEmitter(), add: {
    particles(x, y, texture, config) {
      const emitter = { texture, config, frame: config.frame, angle: config.angle, dead: false, emitted: [],
        setDepth() { return this; }, setParticleTint() { return this; },
        setEmitterFrame(v) { this.frame = v; return this; },
        setEmitterAngle(v) { this.angle = v; return this; },
        emitParticleAt(x, y, count) { this.emitted.push({ x, y, count, frame: this.frame, angle: this.angle }); },
        destroy() { this.dead = true; },
      }; particles.push(emitter); return emitter;
    },
    circle(x, y, radius, color, alpha) {
      const circle = { x, y, radius, fillColor: color, fillAlpha: alpha, visible: true, scaleX: 1, scaleY: 1, alpha: 1, dead: false,
        setDepth() { return this; }, setBlendMode() { return this; },
        setPosition(x, y) { this.x = x; this.y = y; return this; },
        setRadius(v) { this.radius = v; return this; },
        setFillStyle(color, alpha) { this.fillColor = color; this.fillAlpha = alpha; return this; },
        setStrokeStyle(width, color, alpha) { this.stroke = { width, color, alpha }; return this; },
        setScale(v) { this.scaleX = this.scaleY = v; return this; },
        setAlpha(v) { this.alpha = v; return this; },
        setVisible(v) { this.visible = v; return this; },
        destroy() { this.dead = true; this.visible = false; },
      }; circles.push(circle); return circle;
    },
  }, tweens: {
    add(config) { tweens.push(config); return config; },
    killTweensOf(target) { for (let i = tweens.length - 1; i >= 0; i--) if (tweens[i].targets === target) tweens.splice(i, 1); },
  } };
  return { scene, particles, circles, tweens, vfx: new VfxSystem(scene) };
}
const failures = [];
function test(name, fn) { try { fn(); console.log(`PASS ${name}`); } catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.message}`); } }
// Breaks caught: tint-only rendering, repeated independently budgeted death requests,
// direction/position leaking between emissions, unbounded decorations, missing cancellation.
test('baked frame selection changes visible particle source for green / gold / cyan events', () => {
  const f = fixture(); f.vfx.pickup(10, 20); f.vfx.legendary(10, 20); f.vfx.nova(10, 20, 100);
  assert.equal(f.particles.length, 4);
  assert.equal(f.particles[2].texture, 'combat-particles');
  assert.equal(f.particles[2].emitted[0].frame, 'spark-green');
  assert.equal(f.particles[3].emitted[0].frame, 'spark-gold');
  assert.equal(f.particles[3].emitted[1].frame, 'spark-cyan');
});
test('directed surface spray resets to centered radial emission for legacy contacts', () => {
  const f = fixture(); f.vfx.hit(100, 80, COLORS.cyan, { x: 1, y: 0 }, 20);
  assert.equal(f.particles[1].emitted[0].x, 80); assert.equal(f.particles[1].emitted[0].y, 80);
  assert.deepEqual(f.particles[1].emitted[0].angle, { min: 142, max: 218 });
  f.scene.time.now += 100; f.vfx.hit(100, 80, COLORS.red);
  assert.equal(f.particles[1].emitted[1].x, 100);
  assert.deepEqual(f.particles[1].emitted[1].angle, { min: 0, max: 360 });
  assert.equal(f.particles[1].emitted[1].frame, 'spark-red');
});
test('death chips and sparks split one grant, respecting reserve after saturated ordinary traffic', () => {
  const f = fixture();
  for (let i = 0; i < 80; i++) f.vfx.kill(0, 0, COLORS.cyan);
  const emitted = () => f.particles.flatMap(p => p.emitted).reduce((sum, e) => sum + e.count, 0);
  assert.equal(emitted(), 280);
  f.vfx.kill(0, 0, COLORS.red, 'boss', undefined, 42);
  assert.equal(emitted(), 310);
  assert.ok(f.particles[0].emitted.some(e => e.frame === 'chip-cyan'));
  assert.ok(f.particles[0].emitted.some(e => e.frame === 'spark-cyan'));
  for (let i = 0; i < 50; i++) f.vfx.legendary(0, 0);
  assert.equal(emitted(), 350);
});
test('decorations reserve important feedback, preempt and reuse fully reset circles', () => {
  const f = fixture(); for (let i = 0; i < 100; i++) f.vfx.pickup(i, 0);
  assert.equal(f.circles.length, 9);
  f.vfx.singularity(90, 80, 100); assert.equal(f.circles.length, 12);
  for (let i = 0; i < 100; i++) f.vfx.legendary(150, 160);
  assert.equal(f.circles.length, 12); assert.ok(f.circles.every(c => !c.dead));
  for (const t of [...f.tweens]) t.onComplete();
  f.tweens.length = 0;
  f.vfx.pickup(7, 8);
  const active = f.circles.filter(c => c.visible);
  assert.equal(active.length, 1); assert.equal(active[0].radius, 12);
  assert.equal(active[0].scaleX, 1); assert.equal(active[0].scaleY, 1);
  assert.equal(active[0].x, 7); assert.equal(active[0].y, 8);
  assert.equal(active[0].stroke.color, COLORS.green); assert.equal(active[0].alpha, 1);
});
test('runtime reduction bounds existing and future decoration then shutdown cancels all resources', () => {
  const f = fixture(); for (let i = 0; i < 20; i++) f.vfx.legendary(0, 0);
  f.vfx.setRuntimeQualityScale(.45);
  assert.equal(f.circles.filter(c => !c.dead).length, 6);
  for (let i = 0; i < 50; i++) f.vfx.singularity(0, 0, 80);
  assert.equal(f.circles.filter(c => !c.dead).length, 6);
  f.scene.events.emit('shutdown');
  assert.ok(f.particles.every(p => p.dead)); assert.ok(f.circles.every(c => c.dead));
  assert.equal(f.tweens.length, 0);
  f.vfx.destroy(); f.vfx.pickup(0, 0); f.vfx.legendary(0, 0);
  assert.equal(f.circles.filter(c => !c.dead).length, 0);
});
test('static reduced tier protects two slots and never exceeds six retained decorations', () => {
  const previous = { ...PERFORMANCE };
  Object.assign(PERFORMANCE, { tier: 'reduced', vfxScale: .58, combatParticleBudget: 150, burstParticleBudget: 220 });
  try {
    const f = fixture();
    for (let i = 0; i < 30; i++) f.vfx.pickup(0, 0);
    assert.equal(f.circles.length, 4);
    for (let i = 0; i < 30; i++) f.vfx.singularity(0, 0, 80);
    assert.equal(f.circles.length, 6);
    const total = f.particles.flatMap(p => p.emitted).reduce((sum, e) => sum + e.count, 0);
    assert.equal(total, 220);
    f.vfx.destroy();
  } finally { Object.assign(PERFORMANCE, previous); }
});
test('nearest palette fallback and zero/invalid direction keep legacy emission finite', () => {
  const f = fixture();
  f.vfx.hit(100, 80, 0x8fe7ff, { x: 0, y: 0 }, 30);
  assert.equal(f.particles[1].emitted[0].frame, 'spark-cyan');
  assert.equal(f.particles[1].emitted[0].x, 100);
  f.scene.time.now += 100;
  f.vfx.hit(100, 80, COLORS.gold, { x: NaN, y: 1 }, Infinity);
  assert.deepEqual(f.particles[1].emitted[1].angle, { min: 0, max: 360 });
  assert.equal(f.particles[1].emitted[1].x, 100);
  assert.equal(f.particles[1].emitted[1].y, 80);
  f.vfx.kill(100, 80, COLORS.red, 'boss', { x: 1, y: 0 }, 42);
  f.vfx.kill(100, 80, COLORS.cyan);
  assert.deepEqual(f.particles[0].emitted.at(-1).angle, { min: 0, max: 360 });
});
test('atlas baking stores distinct colored spark and chip frames without resizing gameplay art', () => {
  const { ensureStrainZeroTextures } = load('src/game/StrainZeroTextures.ts');
  const textures = new Map();
  const scene = { textures: { exists: key => textures.has(key), createCanvas(key, width, height) {
    const colors = [];
    const gradient = () => ({ addColorStop(offset, color) { colors.push(color); } });
    const ctx = new Proxy({ colors, createRadialGradient: gradient, createLinearGradient: gradient }, {
      get(target, key) { return key in target ? target[key] : () => {}; },
      set(target, key, value) { if (key === 'strokeStyle' || key === 'fillStyle') colors.push(value); target[key] = value; return true; },
    });
    const texture = { width, height, colors, frames: [], getContext: () => ctx, refresh() {}, add(...args) { this.frames.push(args); } };
    textures.set(key, texture); return texture;
  } } };
  ensureStrainZeroTextures(scene);
  const atlas = textures.get('combat-particles'); assert.ok(atlas);
  assert.ok(atlas.frames.some(f => f[0] === 'spark-green'));
  assert.ok(atlas.frames.some(f => f[0] === 'chip-cyan'));
  assert.ok(atlas.colors.includes('#7fffa1')); assert.ok(atlas.colors.includes('#8fe8ff'));
  assert.equal(atlas.frames.length, 20);
  assert.deepEqual(atlas.frames.find(f => f[0] === 'chip-cyan'), ['chip-cyan', 0, 20, 20, 20, 20]);
  assert.equal(textures.get('virus-player').width, 56);
  assert.equal(textures.get('viral-particle').width, 22);
  const before = textures.size; ensureStrainZeroTextures(scene); assert.equal(textures.size, before);
});
if (failures.length) throw new Error(`${failures.length} VFX contracts failed`);
console.log('VFX presentation contracts: ok');
