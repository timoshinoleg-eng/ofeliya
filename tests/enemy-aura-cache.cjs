const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

class Graphics {
  constructor() {
    this.clearCalls = 0;
    this.circles = [];
    this.styles = [];
    this.visible = true;
  }
  clear() {
    this.clearCalls += 1;
    this.circles = [];
    this.styles = [];
    return this;
  }
  lineStyle(width, color, alpha) {
    this.currentLine = { width, color, alpha };
    this.styles.push(this.currentLine);
    return this;
  }
  strokeCircle(x, y, radius) {
    this.circles.push({ x, y, radius, ...this.currentLine });
    return this;
  }
  beginPath() { return this; }
  arc() { return this; }
  strokePath() { return this; }
  moveTo() { return this; }
  lineTo() { return this; }
  fillStyle() { return this; }
  fillCircle() { return this; }
  setDepth(value) { this.depth = value; return this; }
  setBlendMode(value) { this.blendMode = value; return this; }
  setVisible(value) { this.visible = value; return this; }
  setPosition(x, y) { this.x = x; this.y = y; return this; }
  setRotation(value) { this.rotation = value; return this; }
  setScale(x, y = x) { this.scaleX = x; this.scaleY = y; return this; }
  setAlpha(value) { this.alpha = value; return this; }
}

class Sprite {
  constructor(scene, x, y, textureKey) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.texture = { key: textureKey };
    this.width = 128;
    this.height = 128;
    this.active = true;
  }
  preUpdate() {}
  setScale(x, y = x) { this.scaleX = x; this.scaleY = y; return this; }
  setDepth(value) { this.depth = value; return this; }
  setTexture(key) { this.texture = { key }; return this; }
  setVisible(value) { this.visible = value; return this; }
  setPosition(x, y) { this.x = x; this.y = y; return this; }
  setRotation(value) { this.rotation = value; return this; }
  setAlpha(value) { this.alpha = value; return this; }
  clearTint() { return this; }
  setTintFill() { return this; }
  enableBody(_reset, x, y, active, visible) {
    this.x = x;
    this.y = y;
    this.active = active;
    this.visible = visible;
    return this;
  }
  disableBody() { this.active = false; this.visible = false; return this; }
}

const motionQuery = { matches: false };
const originalWindow = globalThis.window;
globalThis.window = { matchMedia: () => motionQuery };
const originalLoad = Module._load;
Module._load = function(name, ...args) {
  if (name === 'phaser') return {
    Physics: { Arcade: { Sprite } },
    Math: {
      Clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
      Linear: (a, b, t) => a + (b - a) * t,
    },
    BlendModes: { ADD: 1, NORMAL: 0 },
  };
  return originalLoad.call(this, name, ...args);
};
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'),
  { compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  } },
).outputText, filename);

const root = path.join(__dirname, '..');
const { Enemy } = require(path.join(root, 'src/game/Enemy.ts'));
const { COLORS } = require(path.join(root, 'src/game/config.ts'));
const { BOSS_PHASE_TRANSITION_MS } = require(path.join(root, 'src/game/BossPhaseCeremony.ts'));
Module._load = originalLoad;

function makeEnemy(kind) {
  const graphics = [];
  const scene = {
    time: { now: 0 },
    add: {
      existing() {},
      graphics() {
        const g = new Graphics();
        graphics.push(g);
        return g;
      },
    },
    physics: {
      add: {
        existing(enemy) {
          enemy.body = { setCircle() {}, setVelocity() {} };
        },
      },
    },
  };
  const enemy = new Enemy(scene, 0, 0);
  enemy.activate(
    { player: { x: 100, y: 100 } },
    kind,
    40,
    60,
    { elite: false, hpScale: 1, dmgScale: 1, bossBehavior: 'pressure-wave' },
  );
  return { enemy, scene, graphics };
}

function transitionCircles(graphics) {
  return graphics.circles.filter(circle => circle.width === 2.5 && circle.color === COLORS.white);
}

const cases = [
  ['anomaly redraws only for mode/radius changes while transforms stay animated', () => {
    const { enemy } = makeEnemy('anomaly');
    const aura = enemy.anomalyAura;
    assert.equal(aura.clearCalls, 1);
    enemy.updateAnomalyAura(100);
    const firstRotation = aura.rotation;
    enemy.updateAnomalyAura(116);
    enemy.updateAnomalyAura(132);
    assert.equal(aura.clearCalls, 1, 'steady anomaly frames retessellated retained geometry');
    assert.notEqual(aura.rotation, firstRotation, 'aura rotation stopped with geometry caching');
    assert.equal(aura.visible, true);

    enemy.anomalyAttackState = 'telegraph';
    enemy.updateAnomalyAura(148);
    assert.equal(aura.clearCalls, 2, 'telegraph mode did not invalidate anomaly geometry');
    assert.ok(aura.styles.some(style => style.color === COLORS.gold));
    enemy.updateAnomalyAura(164);
    assert.equal(aura.clearCalls, 2);

    enemy.radius += 12;
    enemy.updateAnomalyAura(180);
    assert.equal(aura.clearCalls, 3, 'radius change did not invalidate anomaly geometry');
    const expectedRadius = Math.max(46, enemy.radius + 30);
    assert.ok(aura.circles.some(circle => circle.radius === expectedRadius + 9));
    enemy.updateAnomalyAura(196);
    assert.equal(aura.clearCalls, 3);

    enemy.anomalyAttackState = 'recovery';
    enemy.anomalyPhase = 2;
    enemy.updateAnomalyAura(212);
    assert.equal(aura.clearCalls, 4, 'recovery mode did not invalidate anomaly geometry');
    assert.equal(aura.rotation, 212 * 0.0016, 'phase 2 rotation rate changed');
    assert.equal(aura.alpha, 0.72);
    const recoveryRotation = aura.rotation;
    const recoveryScale = aura.scaleX;
    enemy.updateAnomalyAura(228);
    assert.equal(aura.clearCalls, 4);
    assert.notEqual(aura.rotation, recoveryRotation, 'phase 2 steady rotation stopped');
    assert.notEqual(aura.scaleX, recoveryScale, 'recovery scale pulse stopped');

    enemy.anomalyAttackState = 'pursuit';
    enemy.updateAnomalyAura(244);
    assert.equal(aura.clearCalls, 5, 'return to pursuit retained recovery geometry');
    assert.equal(aura.rotation, 244 * 0.0016);
    assert.equal(aura.scaleX, 1 + Math.sin(244 * 0.005) * 0.025);
  }],
  ['prime steady frames are retained and transition pulse rebuilds then stops cleanly', () => {
    const { enemy, scene } = makeEnemy('boss');
    const aura = enemy.bossAura;
    assert.equal(aura.clearCalls, 1);
    scene.time.now = 1000;
    enemy.updatePrimeAura(1000);
    const firstRotation = aura.rotation;
    enemy.updatePrimeAura(1016);
    enemy.updatePrimeAura(1032);
    assert.equal(aura.clearCalls, 1, 'steady prime frames retessellated retained geometry');
    assert.notEqual(aura.rotation, firstRotation, 'prime rotation stopped with geometry caching');

    enemy.bossAttackState = 'recovery';
    scene.time.now = 2000;
    enemy.updatePrimeAura(2000);
    assert.equal(aura.clearCalls, 2, 'authoritative phase change did not redraw prime geometry');
    assert.ok(aura.styles.some(style => style.color === COLORS.gold));
    assert.equal(transitionCircles(aura).length, 0, 'zero envelope must not draw a transition ring');

    scene.time.now = 2030;
    enemy.updatePrimeAura(2030);
    assert.equal(aura.clearCalls, 3);
    assert.equal(transitionCircles(aura).length, 1, 'active transition ring is missing');
    const firstPulseRadius = transitionCircles(aura)[0].radius;
    scene.time.now = 2060;
    enemy.updatePrimeAura(2060);
    assert.equal(aura.clearCalls, 4, 'active pulse must rebuild its changing geometry');
    assert.equal(transitionCircles(aura).length, 1, 'transition rings accumulated across frames');
    assert.notEqual(transitionCircles(aura)[0].radius, firstPulseRadius, 'transition ring did not expand');

    scene.time.now = 2000 + BOSS_PHASE_TRANSITION_MS;
    enemy.updatePrimeAura(scene.time.now);
    assert.equal(aura.clearCalls, 5, 'final pulse frame left stale ring geometry behind');
    assert.equal(transitionCircles(aura).length, 0, 'transition ring remained after its timing window');
    enemy.updatePrimeAura(scene.time.now + 16);
    assert.equal(aura.clearCalls, 5, 'post-pulse steady frames redrew the aura');

    enemy.radius += 10;
    enemy.updatePrimeAura(scene.time.now + 32);
    assert.equal(aura.clearCalls, 6, 'prime radius change did not invalidate geometry');

    enemy.bossPhase = 2;
    enemy.bossAttackState = 'pursuit';
    enemy.primeBrokenUntil = scene.time.now + 1000;
    scene.time.now += 64;
    enemy.updatePrimeAura(scene.time.now);
    assert.equal(aura.clearCalls, 7, 'broken damage window did not redraw');
    assert.ok(aura.styles.some(style => style.color === COLORS.green));
    assert.equal(aura.alpha, 0.94);
    assert.equal(aura.rotation, scene.time.now * 0.00085);
    assert.equal(aura.scaleX, 1 + Math.sin(scene.time.now * 0.012) * 0.065);

    enemy.primeBrokenUntil = scene.time.now - 1;
    enemy.updatePrimeAura(scene.time.now);
    assert.equal(aura.clearCalls, 8, 'return to armored retained broken geometry');
    assert.ok(aura.styles.some(style => style.color === COLORS.cyan));
    assert.equal(transitionCircles(aura).length, 0);
    assert.equal(aura.rotation, -scene.time.now * 0.00045);

    scene.time.now += 30;
    enemy.updatePrimeAura(scene.time.now);
    assert.equal(aura.clearCalls, 9, 'return-to-armored pulse did not redraw');
    assert.equal(transitionCircles(aura).length, 1);
    scene.time.now += BOSS_PHASE_TRANSITION_MS;
    enemy.updatePrimeAura(scene.time.now);
    assert.equal(aura.clearCalls, 10, 'return-to-armored pulse left stale geometry');
    assert.equal(transitionCircles(aura).length, 0);
  }],
  ['reduced motion suppresses and removes the pulse without steady redraws', () => {
    const { enemy, scene } = makeEnemy('boss');
    const aura = enemy.bossAura;
    enemy.bossAttackState = 'recovery';
    scene.time.now = 2000;
    enemy.updatePrimeAura(2000);
    scene.time.now = 2030;
    enemy.updatePrimeAura(2030);
    assert.equal(transitionCircles(aura).length, 1);

    motionQuery.matches = true;
    scene.time.now = 2060;
    enemy.updatePrimeAura(2060);
    assert.equal(transitionCircles(aura).length, 0, 'reduced motion retained an active pulse ring');
    assert.equal(aura.rotation, 0);
    assert.equal(aura.scaleX, 1);
    assert.equal(aura.alpha, 0.72);
    const clears = aura.clearCalls;
    enemy.updatePrimeAura(2076);
    enemy.updatePrimeAura(2092);
    assert.equal(aura.clearCalls, clears, 'reduced-motion steady frames redrew the aura');
    motionQuery.matches = false;
  }],
  ['deactivation and pooled reactivation invalidate both aura caches and stale pulses', () => {
    const { enemy, scene } = makeEnemy('anomaly');
    const anomalyAura = enemy.anomalyAura;
    enemy.anomalyAttackState = 'telegraph';
    enemy.updateAnomalyAura(100);
    assert.equal(anomalyAura.clearCalls, 2);
    enemy.deactivateForStageReset();
    assert.equal(enemy.anomalyAuraCacheMode, null);
    assert.equal(enemy.primeAuraCacheMode, null);
    assert.equal(anomalyAura.visible, false);

    enemy.activate(
      { player: { x: 100, y: 100 } }, 'anomaly', 10, 20,
      { elite: false, hpScale: 1, dmgScale: 1 },
    );
    assert.equal(anomalyAura.clearCalls, 3, 'pooled anomaly reused stale cached geometry');
    assert.equal(anomalyAura.visible, true);
    assert.ok(anomalyAura.styles.every(style => style.color !== COLORS.gold));
    enemy.updateAnomalyAura(116);
    assert.equal(anomalyAura.clearCalls, 3);

    enemy.deactivateForStageReset();
    enemy.activate(
      { player: { x: 100, y: 100 } }, 'boss', 10, 20,
      { elite: false, hpScale: 1, dmgScale: 1, bossBehavior: 'pressure-wave' },
    );
    const bossAura = enemy.bossAura;
    assert.equal(bossAura.clearCalls, 1);
    enemy.bossAttackState = 'recovery';
    scene.time.now = 3000;
    enemy.updatePrimeAura(3000);
    scene.time.now = 3030;
    enemy.updatePrimeAura(3030);
    assert.equal(transitionCircles(bossAura).length, 1);
    enemy.deactivateForStageReset();
    assert.equal(enemy.primeAuraPulseDrawn, false);

    scene.time.now = 4000;
    enemy.activate(
      { player: { x: 100, y: 100 } }, 'boss', 10, 20,
      { elite: false, hpScale: 1, dmgScale: 1, bossBehavior: 'pressure-wave' },
    );
    assert.equal(bossAura.clearCalls, 4, 'pooled boss did not rebuild its static aura');
    assert.equal(transitionCircles(bossAura).length, 0, 'pooled boss revived the previous lifetime pulse');
    enemy.updatePrimeAura(4016);
    assert.equal(bossAura.clearCalls, 4);
    assert.equal(transitionCircles(bossAura).length, 0);
  }],
  ['direct pooled kind changes rebuild hidden auras and never revive a pulse', () => {
    const { enemy, scene } = makeEnemy('boss');
    const bossAura = enemy.bossAura;
    enemy.bossAttackState = 'recovery';
    scene.time.now = 2000;
    enemy.updatePrimeAura(2000);
    scene.time.now = 2030;
    enemy.updatePrimeAura(2030);
    assert.equal(transitionCircles(bossAura).length, 1);

    scene.time.now = 4000;
    enemy.activate(
      { player: { x: 100, y: 100 } }, 'anomaly', 10, 20,
      { elite: false, hpScale: 1, dmgScale: 1 },
    );
    const anomalyAura = enemy.anomalyAura;
    assert.equal(bossAura.visible, false);
    assert.equal(enemy.primeAuraPulseDrawn, false);
    assert.equal(anomalyAura.clearCalls, 1);
    assert.equal(anomalyAura.visible, true);
    enemy.updateAnomalyAura(4016);
    assert.equal(anomalyAura.clearCalls, 1);

    scene.time.now = 5000;
    enemy.activate(
      { player: { x: 100, y: 100 } }, 'boss', 10, 20,
      { elite: false, hpScale: 1, dmgScale: 1, bossBehavior: 'heartbeat-pulse' },
    );
    assert.equal(anomalyAura.visible, false);
    assert.equal(transitionCircles(bossAura).length, 0, 'cardiac reuse retained prime pulse geometry');
    assert.equal(bossAura.blendMode, 1);

    scene.time.now = 6000;
    enemy.activate(
      { player: { x: 100, y: 100 } }, 'boss', 10, 20,
      { elite: false, hpScale: 1, dmgScale: 1, bossBehavior: 'pressure-wave' },
    );
    assert.equal(transitionCircles(bossAura).length, 0, 'prime reuse retained cardiac or pulse geometry');
    assert.equal(bossAura.blendMode, 0);
    const clears = bossAura.clearCalls;
    enemy.updatePrimeAura(6000);
    assert.equal(bossAura.clearCalls, clears);
  }],
];

let failures = 0;
try {
  for (const [name, run] of cases) {
    try {
      run();
      console.log(`PASS ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`FAIL ${name}: ${error.stack}`);
    }
  }
} finally {
  motionQuery.matches = false;
  Module._load = originalLoad;
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
}
if (failures) process.exitCode = 1;
else console.log(`Enemy aura cache: ${cases.length}/${cases.length} regression cases PASS`);
