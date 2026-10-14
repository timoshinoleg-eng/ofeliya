// Execute production classes; stub only Phaser rendering/physics boundaries.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

class Sprite {
  preUpdate() {}
  setAlpha() { return this; }
  setRotation() { return this; }
  setScale() { return this; }
  clearTint() { return this; }
  disableBody() { return this; }
}
const originalLoad = Module._load;
Module._load = function(name, ...args) {
  if (name === 'phaser') return {
    Physics: { Arcade: { Sprite } },
    Math: { Clamp: (v, min, max) => Math.min(max, Math.max(min, v)),
      Linear: (a, b, t) => a + (b - a) * t },
  };
  return originalLoad.call(this, name, ...args);
};
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
      esModuleInterop: true },
  }).outputText, filename);
const source = name => require(path.join(__dirname, '..', 'src', name));
const { Enemy } = source('game/Enemy.ts');
const { WaveDirector } = source('game/WaveDirector.ts');
const { BLOODSTREAM_STAGE } = source('game/StageDefinitions.ts');
const { STANDARD_DIFFICULTY } = source('game/DifficultyProfile.ts');
const { RunRng } = source('game/RunRng.ts');
Module._load = originalLoad;

function anomaly(kind = 'radial-burst') {
  const events = [];
  let pressure = 1;
  const enemy = Object.create(Enemy.prototype);
  Object.assign(enemy, {
    hp: 60, maxHp: 100, dmg: 20, speed: 74, radius: 21,
    kind: 'anomaly', active: true, isBoss: false, isElite: false,
    x: 0, y: 0, target: { x: 170, y: 0 },
    knockX: 0, knockY: 0, flashUntil: 0, tintFill: false,
    texture: { key: 'immune-macrophage' }, visualScale: 1.5,
    scene: { time: { now: 0 } }, body: {
      setVelocity(x, y) { events.push({ kind: 'velocity', x, y }); },
    },
    anomalyPhase: 1, anomalyAttackState: 'pursuit', anomalyAttackKind: kind,
    nextAnomalyAttackAt: 0, anomalyAura: null, anomalyTelegraph: null,
    gs: {
      stageDirector: { phase: 'PLAYING' },
      getEnemyPressureMultiplier: () => pressure,
      onAnomalyPhaseChanged() { events.push({ kind: 'phase' }); },
      triggerAnomalyBurst(_enemy, radius, damage) {
        events.push({ kind: 'burst', radius, damage });
      },
    },
    drawAnomalyTelegraph(pacing) {
      events.push({ kind: 'telegraph', radius: pacing.burstRadius });
    },
    updateAnomalyTelegraph() {},
  });
  return { enemy, events, pressure: value => { pressure = value; } };
}

const cases = [
  ['resume never re-plans an in-flight warning from advanced RNG', () => {
    const def = BLOODSTREAM_STAGE.waveEvents[1];
    const future = { ...def, id: 'future-resume', atMs: def.atMs + 5000 };
    const stage = { ...BLOODSTREAM_STAGE, waveEvents: [def, future] };
    const events = [];
    const scene = { player: { x: 100, y: 200 }, runState: { stage: { timeMs: def.atMs - def.telegraphMs } },
      announceWaveEvent(d) { events.push({ id: d.id, at: this.runState.stage.timeMs }); } };
    const rng = new RunRng('resume-warning');
    const wave = new WaveDirector(scene, {}, stage, STANDARD_DIFFICULTY,
      () => 0.5, () => 0.5, () => rng.next('wave-event'));
    wave.updateWaveEvents(scene.runState.stage.timeMs);
    assert.equal(wave.waveEventInProgress, true, 'pending wave must prohibit a new checkpoint');
    const snapshot = wave.snapshot(), rngSnapshot = rng.snapshot();
    scene.runState.stage.timeMs = def.atMs - 100;
    const restored = new WaveDirector(scene, {}, stage, STANDARD_DIFFICULTY,
      () => 0.5, () => 0.5, () => rng.next('wave-event'));
    restored.restore(stage, snapshot);
    events.length = 0;
    restored.fireWaveEvent = () => events.push({ fired: true, at: scene.runState.stage.timeMs });
    restored.updateWaveEvents(scene.runState.stage.timeMs);
    assert.deepEqual(events, [], 'restored stale warning was re-announced');
    assert.deepEqual(rng.snapshot(), rngSnapshot, 'restore consumed advanced RNG a second time');
    scene.runState.stage.timeMs = def.atMs;
    restored.updateWaveEvents(scene.runState.stage.timeMs);
    assert.deepEqual(events, [], 'in-flight restored event must be consumed');
    scene.runState.stage.timeMs = future.atMs - future.telegraphMs;
    restored.updateWaveEvents(scene.runState.stage.timeMs);
    scene.runState.stage.timeMs = future.atMs;
    restored.updateWaveEvents(scene.runState.stage.timeMs);
    assert.equal(events[0].id, future.id);
    assert.equal(events[1].at - events[0].at, future.telegraphMs);
    assert.equal(restored.waveEventInProgress, false);
  }],
  ['radial attack keeps its announced radius/damage through recovery', () => {
    const { enemy, events } = anomaly();
    enemy.updateAnomalyBehavior(1000, 170, 1, 0);
    enemy.hp = 54;
    enemy.dmg = 99;
    enemy.updateAnomalyBehavior(1400, 170, 1, 0);
    enemy.updateAnomalyBehavior(1820, 170, 1, 0);
    assert.equal(enemy.anomalyPhase, 1, 'phase must stay committed during strike');
    assert.deepEqual(events.find(e => e.kind === 'burst'),
      { kind: 'burst', radius: 150, damage: 14 });
    enemy.updateAnomalyBehavior(2040, 170, 1, 0);
    assert.equal(enemy.anomalyStateUntil, 2990, 'committed recovery duration changed');
    enemy.updateAnomalyBehavior(2990, 170, 1, 0);
    enemy.updateAnomalyBehavior(3000, 170, 1, 0);
    assert.equal(enemy.anomalyPhase, 2, 'phase two must become available next cycle');
    enemy.updateAnomalyBehavior(10000, 170, 1, 0);
    assert.equal(enemy.anomalyStateUntil, 10640, 'next attack must use phase two pacing');
  }],
  ['dash keeps announced speed/duration when HP and Heart pressure change', () => {
    const { enemy, events, pressure } = anomaly('charge-dash');
    enemy.updateAnomalyBehavior(1000, 170, 1, 0);
    enemy.hp = 54;
    pressure(1.4);
    enemy.preUpdate(1820, 16);
    const velocity = events.find(e => e.kind === 'velocity');
    assert.equal(velocity.x, 74 * 3.6);
    assert.equal(velocity.y, 0);
    assert.equal(enemy.anomalyStateUntil, 2280, 'dash duration changed after telegraph');
  }],
  ['expired waves suppressed by anomaly are skipped; future warning stays complete', () => {
    const expired = BLOODSTREAM_STAGE.waveEvents[1];
    const future = BLOODSTREAM_STAGE.waveEvents[2];
    const events = [];
    let clock = expired.atMs + 20000;
    const scene = { player: { x: 0, y: 0 }, runState: { stage: { timeMs: clock } },
      announceWaveEvent(def, telegraph) {
        events.push({ kind: 'announce', id: def.id, at: clock, duration: telegraph.durationMs });
      } };
    const wave = new WaveDirector(scene, {},
      { ...BLOODSTREAM_STAGE, waveEvents: [expired, future] }, STANDARD_DIFFICULTY,
      () => 0.5, () => 0.5, () => 0.5);
    wave.fireWaveEvent = () => events.push({ kind: 'spawn', at: clock });
    wave.anomaly = { active: true };
    wave.updateWaveEvents(clock);
    wave.anomaly = null;
    wave.updateWaveEvents(clock);
    clock += 16;
    wave.updateWaveEvents(clock);
    assert.deepEqual(events, [], 'expired event appeared with one-frame warning');
    assert.equal(wave.snapshot().waveEventIndex, 1);
    clock = future.atMs - future.telegraphMs;
    wave.updateWaveEvents(clock);
    clock = future.atMs - 1;
    wave.updateWaveEvents(clock);
    assert.equal(events.length, 1, 'future event fired before its full warning');
    clock = future.atMs;
    wave.updateWaveEvents(clock);
    assert.equal(events[0].id, future.id);
    assert.equal(events[1].at - events[0].at, future.telegraphMs);
  }],
  ['anomaly death inside a missed warning does not release a shortened telegraph', () => {
    const def = BLOODSTREAM_STAGE.waveEvents[1];
    const events = [];
    const scene = { player: { x: 0, y: 0 },
      runState: { stage: { timeMs: def.atMs - 500 } },
      announceWaveEvent() { events.push('announce'); } };
    const wave = new WaveDirector(scene, {},
      { ...BLOODSTREAM_STAGE, waveEvents: [def] }, STANDARD_DIFFICULTY,
      () => 0.5, () => 0.5, () => 0.5);
    wave.anomaly = { active: true };
    wave.updateWaveEvents(def.atMs - 500);
    wave.anomaly = null;
    wave.fireWaveEvent = () => events.push('spawn');
    wave.updateWaveEvents(def.atMs - 400);
    wave.updateWaveEvents(def.atMs);
    assert.deepEqual(events, []);
    assert.equal(wave.snapshot().waveEventIndex, 1);
  }],
  ['stage reset discards a pooled anomaly attack commitment', () => {
    const { enemy } = anomaly('charge-dash');
    enemy.updateAnomalyBehavior(1000, 170, 1, 0);
    enemy.deactivateForStageReset();
    assert.equal(enemy.anomalyCommittedPacing, null);
    assert.equal(enemy.anomalyCommittedDashSpeed, 0);
    assert.equal(enemy.anomalyCommittedDamage, 0);
    assert.equal(enemy.anomalyAttackState, 'pursuit');
    assert.equal(enemy.anomalyPhase, 1);
  }],
];
let failures = 0;
for (const [name, run] of cases) {
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`); }
}
if (failures) process.exitCode = 1;
