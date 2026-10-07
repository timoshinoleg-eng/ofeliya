import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const EventEmitter = require('eventemitter3');
const cache = new Map();
const phaser = { BlendModes: { ADD: 1 }, Math: {
  Clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
  FloatBetween: (min, max) => (min + max) / 2,
} };
// Phaser's DOM-dependent rendering boundary is recorded; the real system, stage,
// performance profile and pure math execute unchanged. Raster quality belongs to browser QA.
function load(path) {
  path = new URL(path, `file://${process.cwd()}/`).pathname;
  if (cache.has(path)) return cache.get(path);
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText;
  const localRequire = name => name === 'phaser' ? phaser : load(new URL(`${name}.ts`, `file://${path}`).pathname);
  new Function('require', 'module', 'exports', code)(localRequire, module, module.exports);
  cache.set(path, module.exports); return module.exports;
}
const { AtmosphereSystem } = load('src/systems/AtmosphereSystem.ts');
const { PERFORMANCE } = load('src/systems/PerformanceProfile.ts');
const { BLOODSTREAM_STAGE, HEART_STAGE } = load('src/game/StageDefinitions.ts');
function fixture(reduced = false) {
  Object.assign(PERFORMANCE, { tier: reduced ? 'reduced' : 'full', ambientErythrocytes: reduced ? 8 : 14,
    ambientHostCells: reduced ? 2 : 4, ambientParticles: reduced ? 12 : 24 });
  const objects = [], tweens = [], timers = [];
  function add(kind, x, y, width, height, texture, color, alpha) {
    const o = { kind, x, y, width, height, texture, fillColor: color, fillAlpha: alpha ?? 1,
      alpha: 1, visible: true, depth: 0, rotation: 0, scaleX: 1, scaleY: 1, destroys: 0,
      setOrigin() { return this; }, setScrollFactor() { return this; }, setBlendMode() { return this; },
      setDepth(v) { this.depth = v; return this; }, setAlpha(v) { this.alpha = v; return this; },
      setScale(v) { this.scaleX = this.scaleY = v; return this; },
      setRotation(v) { this.rotation = v; return this; }, setVisible(v) { this.visible = v; return this; },
      setTexture(v) { this.texture = v; return this; }, setTint(v) { this.tint = v; return this; },
      clearTint() { this.tint = undefined; return this; },
      setPosition(x, y) { this.x = x; this.y = y; return this; },
      setSize(w, h) { this.width = w; this.height = h; return this; },
      setFillStyle(color, alpha = 1) { this.fillColor = color; this.fillAlpha = alpha; return this; },
      destroy() { this.destroys++; this.visible = false; },
    }; objects.push(o); return o;
  }
  const scene = { scale: { width: 390, height: 844 }, events: new EventEmitter(),
    cameras: { main: { scrollX: 0, scrollY: 0 } }, textures: { exists: () => true },
    sys: { isActive: () => true }, add: {
      tileSprite: (x, y, w, h, texture) => add('tile', x, y, w, h, texture),
      image: (x, y, texture) => add('image', x, y, 0, 0, texture),
      rectangle: (x, y, w, h, color, alpha) => add('rectangle', x, y, w, h, undefined, color, alpha),
    }, tweens: { add: c => tweens.push(c) }, time: { delayedCall: (delay, fn) => timers.push({ delay, fn }) },
  };
  const atmosphere = new AtmosphereSystem(scene);
  atmosphere.setStage(BLOODSTREAM_STAGE);
  return { atmosphere, scene, objects, tweens, timers, rbc: objects.filter(o => o.texture === 'erythrocyte'),
    hosts: objects.filter(o => o.texture === 'host-cell-shadow'), particles: objects.filter(o => o.texture === 'spark') };
}
const failures = [];
function test(name, fn) { try { fn(); console.log(`PASS ${name}`); } catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.message}`); } }
const depths = [-26, -14, -8];
const bands = (f, visible = false) => depths.map(depth => f.rbc.filter(o => o.depth === depth && (!visible || o.visible)).length);
// Regressions caught: anticipatory second envelope, dt-clamped decay, transient flash/timer
// allocation, prefix-only layer shedding, stale stage pulses, non-idempotent resource teardown.
test('Heart envelope has a valley before a separate weaker second beat', () => {
  const { heartBeatEnvelope } = load('src/systems/atmosphereMath.ts');
  assert.equal(heartBeatEnvelope(0), 1);
  assert.ok(heartBeatEnvelope(.21) < .06);
  assert.equal(heartBeatEnvelope(.22), .52);
  assert.ok(heartBeatEnvelope(.4) < .04);
  assert.equal(heartBeatEnvelope(NaN), 0);
  const f = fixture(); f.atmosphere.setStage(HEART_STAGE);
  f.atmosphere.update(0, 0, 900 * .21, HEART_STAGE.durationMs);
  const structure = f.objects.find(o => o.texture === 'cardiac-fiber');
  const valley = structure.alpha;
  f.atmosphere.update(0, 0, 900 * .22, HEART_STAGE.durationMs);
  assert.ok(structure.alpha - valley > .09, 'real system must use separated envelope');
});
test('full and reduced pools have coherent depth, scale, opacity and parallax bands', () => {
  for (const reduced of [false, true]) {
    const f = fixture(reduced);
    assert.deepEqual(bands(f), reduced ? [4, 3, 1] : [8, 4, 2]);
    assert.equal(f.hosts.length, reduced ? 2 : 4); assert.equal(f.particles.length, reduced ? 12 : 24);
    const ranges = [[.55, .85, .16, .24, .025, .045], [.95, 1.4, .23, .34, .07, .1], [1.6, 2.1, .08, .14, .14, .18]];
    const initialX = f.rbc.map(o => o.x);
    f.scene.cameras.main.scrollX = 100; f.atmosphere.update(0, 0, 0, 300000);
    for (const [i, o] of f.rbc.entries()) {
      const [s0, s1, a0, a1, p0, p1] = ranges[depths.indexOf(o.depth)];
      assert.ok(o.scaleX >= s0 && o.scaleX <= s1);
      assert.ok(o.alpha >= a0 * .88 && o.alpha <= a1);
      const parallax = (initialX[i] - o.x) / 100;
      assert.ok(parallax >= p0 && parallax <= p1);
    }
    assert.ok(f.objects.every(o => o.depth < 0), 'all atmosphere stays behind gameplay');
  }
});
test('quality and Heart selection retain every available band within the visible budget', () => {
  for (const reduced of [false, true]) {
    const f = fixture(reduced);
    for (const scale of [1, .8, .65, .45]) {
      f.atmosphere.setRuntimeQualityScale(scale);
      assert.ok(bands(f, true).every(n => n >= 1));
      const bloodCount = f.rbc.filter(o => o.visible).length;
      assert.equal(bloodCount, Math.ceil(f.rbc.length * scale));
      f.atmosphere.setStage(HEART_STAGE);
      assert.ok(bands(f, true).every(n => n >= 1));
      assert.equal(f.rbc.filter(o => o.visible).length, Math.max(3, Math.ceil(bloodCount / 2)));
      f.atmosphere.setStage(BLOODSTREAM_STAGE);
    }
    f.atmosphere.setRuntimeQualityScale(NaN); assert.equal(f.atmosphere.debugRuntimeQualityScale, .45);
    f.atmosphere.setRuntimeQualityScale(10); assert.equal(f.rbc.filter(o => o.visible).length, f.rbc.length);
  }
});
test('1000 repeated pulses and updates reuse a single alpha-limited rectangle without timers or tweens', () => {
  const f = fixture(); const count = f.objects.length;
  assert.equal(f.objects.filter(o => o.kind === 'rectangle').length, 1);
  for (let i = 0; i < 1000; i++) {
    f.atmosphere.heartbeatPulse(0xff0000, .4);
    f.atmosphere.update(i * 16, 16, i * 16, 300000);
  }
  assert.equal(f.objects.length, count); assert.equal(f.tweens.length, 0); assert.equal(f.timers.length, 0);
  const overlay = f.objects.find(o => o.kind === 'rectangle');
  assert.equal(overlay.depth, -6); assert.ok(overlay.alpha * overlay.fillAlpha <= .075);
});
test('overlay decay is frame-rate independent including long update intervals', () => {
  const { decayAtmospherePulse } = load('src/systems/atmosphereMath.ts');
  let alpha = .075;
  for (let i = 0; i < 60; i++) alpha = decayAtmospherePulse(alpha, 1000 / 60);
  assert.ok(Math.abs(alpha - decayAtmospherePulse(.075, 1000)) < 1e-12);
  function after(deltas) { const f = fixture(); f.atmosphere.pulse(0x123456, .3);
    let t = 0; for (const delta of deltas) f.atmosphere.update(t += delta, delta, t, 300000);
    return f.objects.find(o => o.kind === 'rectangle').alpha;
  }
  assert.ok(Math.abs(after(Array(60).fill(1000 / 60)) - after([1000])) < 1e-12);
});
test('latest delayed second pulse replaces prior scheduling and respects exact elapsed decay', () => {
  function after(deltas) { const f = fixture(); f.atmosphere.heartbeatPulse(0x123456, .3);
    let t = 0; for (const delta of deltas) f.atmosphere.update(t += delta, delta, t, 300000);
    return f.objects.find(o => o.kind === 'rectangle').alpha;
  }
  assert.ok(Math.abs(after(Array(20).fill(20)) - after([400])) < 1e-12);
  const f = fixture(); f.atmosphere.heartbeatPulse(0xff0000, .3); f.atmosphere.update(100, 100, 100, 300000);
  f.atmosphere.heartbeatPulse(0x00ff00, .3); f.atmosphere.update(200, 100, 200, 300000);
  const overlay = f.objects.find(o => o.kind === 'rectangle');
  const at100 = overlay.alpha;
  f.atmosphere.update(290, 90, 290, 300000);
  assert.ok(overlay.alpha > at100, 'second pulse is due only 190ms after latest heartbeat');
  assert.equal(overlay.fillColor, 0x00ff00);
});
test('stage switch cancels pending visual heartbeat and resets overlay', () => {
  const f = fixture(); f.atmosphere.heartbeatPulse(0x123456, .3);
  f.atmosphere.setStage(HEART_STAGE); f.atmosphere.update(400, 400, 400, 240000);
  const overlay = f.objects.find(o => o.kind === 'rectangle'); assert.equal(overlay.alpha, 0);
  assert.equal(f.objects.find(o => o.kind === 'tile').texture, 'heart-plasma');
});
test('resize adjusts all retained screen layers and shutdown destroys each resource exactly once', () => {
  const f = fixture(); f.scene.scale.width = 320; f.scene.scale.height = 520; f.atmosphere.resize();
  assert.ok(f.objects.filter(o => o.kind !== 'image').every(o => o.width === 320 && o.height === 520));
  f.atmosphere.heartbeatPulse(0x123456, .3); f.scene.events.emit('shutdown');
  f.atmosphere.destroy(); f.atmosphere.update(1000, 1000, 1000, 300000);
  f.atmosphere.pulse(); f.atmosphere.heartbeatPulse(0x123456); f.atmosphere.resize(); f.atmosphere.setStage(HEART_STAGE);
  assert.ok(f.objects.every(o => o.destroys === 1));
  assert.equal(f.tweens.length, 0); assert.equal(f.timers.length, 0);
});
test('baked organ sources preserve 256px geometry with broad vessel flow and oblique Heart fibres', () => {
  const recipes = new Map();
  const scene = { textures: {
    exists: () => false,
    createCanvas(key, width, height) {
      const paths = []; let path = [];
      const context = new Proxy({
        createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }),
        beginPath() { path = []; }, moveTo(x, y) { path.push([x, y]); }, lineTo(x, y) { path.push([x, y]); },
        stroke() { paths.push({ points: [...path], width: context.lineWidth, color: context.strokeStyle }); },
      }, { get(target, name) { return name in target ? target[name] : () => {}; } });
      recipes.set(key, { width, height, paths });
      return { getContext: () => context, refresh() {}, add() {} };
    },
  } };
  load('src/game/StrainZeroTextures.ts').ensureStrainZeroTextures(scene);
  for (const key of ['blood-plasma', 'heart-plasma', 'cardiac-fiber']) {
    assert.equal(recipes.get(key).width, 256); assert.equal(recipes.get(key).height, 256);
  }
  const broad = recipes.get('blood-plasma').paths.filter(p => p.width >= 28 && p.points.length >= 20);
  assert.ok(broad.length >= 3, 'broad coherent flow must be baked rather than thin scattered circles');
  const fibres = recipes.get('cardiac-fiber').paths.filter(p => p.points.length >= 20);
  assert.ok(fibres.length >= 8);
  for (const p of fibres) {
    const first = p.points[0], last = p.points.at(-1);
    assert.ok(Math.abs((last[1] - first[1]) / (last[0] - first[0]) - .5) < .02, 'fibres share oblique orientation');
  }
  // This task changes no actor, host, projectile or combat atlas backing geometry.
  assert.deepEqual([recipes.get('virus-player').width, recipes.get('virus-player').height], [56, 56]);
  assert.deepEqual([recipes.get('combat-particles').width, recipes.get('combat-particles').height], [200, 40]);
});
if (failures.length) { console.error(`${failures.length} atmosphere contracts failed`); process.exitCode = 1; }
else console.log('atmosphere presentation contracts: 9/9');
