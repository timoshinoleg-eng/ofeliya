const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');

const root = path.join(__dirname, '..');
const parent = '7c18a40cc10b47f97c3af515dec36d095f1d2b15';
const atlas = 'bio-cycle-immune-antibody';
const hitAtlas = 'bio-hit-immune-antibody';

class Graphics {
  constructor() {
    this.clearCalls = 0;
    this.commands = [];
    this.visible = true;
  }
  clear() {
    this.clearCalls += 1;
    this.commands = [];
    return this;
  }
  lineStyle(...args) { this.commands.push(['lineStyle', ...args]); return this; }
  strokeCircle(...args) { this.commands.push(['strokeCircle', ...args]); return this; }
  beginPath() { return this; }
  arc(...args) { this.commands.push(['arc', ...args]); return this; }
  strokePath() { return this; }
  moveTo(...args) { this.commands.push(['moveTo', ...args]); return this; }
  lineTo(...args) { this.commands.push(['lineTo', ...args]); return this; }
  closePath() { return this; }
  fillStyle(...args) { this.commands.push(['fillStyle', ...args]); return this; }
  fillCircle(...args) { this.commands.push(['fillCircle', ...args]); return this; }
  fillPath() { return this; }
  strokeTriangle(...args) { this.commands.push(['strokeTriangle', ...args]); return this; }
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
    this.frame = { name: '__BASE' };
    this.width = 128;
    this.height = 128;
    this.active = true;
    this.visible = true;
    this.alpha = 1;
    this.rotation = 0;
    this.tintFill = false;
  }
  preUpdate() {}
  setScale(x, y = x) { this.scaleX = x; this.scaleY = y; return this; }
  setDepth(value) { this.depth = value; return this; }
  setTexture(key, frame) {
    this.texture = { key };
    if (frame !== undefined) this.frame = { name: frame };
    return this;
  }
  setVisible(value) { this.visible = value; return this; }
  setPosition(x, y) { this.x = x; this.y = y; return this; }
  setRotation(value) { this.rotation = value; return this; }
  setAlpha(value) { this.alpha = value; return this; }
  clearTint() { this.tintFill = false; return this; }
  setTintFill() { this.tintFill = true; return this; }
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
globalThis.window = { devicePixelRatio: 4, matchMedia: () => motionQuery };
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

function compileEnemy(source) {
  const optimized = source.includes('BIO_FRAMES[frame] ?? `bio-${frame}`');
  const expression = optimized
    ? 'BIO_FRAMES[frame] ?? `bio-${frame}`'
    : '`bio-${frame}`';
  const replacement = optimized
    ? 'globalThis.__perf04.prebuilt(frame, BIO_FRAMES)'
    : 'globalThis.__perf04.template(frame)';
  const instrumented = source.replace(expression, replacement);
  assert.notEqual(instrumented, source, 'biological pose instrumentation did not find its target');
  const filename = path.join(root, 'src/game/Enemy.ts');
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod._compile(ts.transpileModule(instrumented, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText, filename);
  return mod.exports.Enemy;
}

const baselineSource = execFileSync(
  'git',
  ['show', `${parent}:src/game/Enemy.ts`],
  { cwd: root, encoding: 'utf8' },
);
const candidateSource = fs.readFileSync(path.join(root, 'src/game/Enemy.ts'), 'utf8');
const BaselineEnemy = compileEnemy(baselineSource);
const CandidateEnemy = compileEnemy(candidateSource);
const ArtMetrics = require(path.join(root, 'src/game/ArtMetrics.ts'));
const BiologicalAnimation = require(path.join(root, 'src/game/BiologicalAnimation.ts'));
const { RunRng } = require(path.join(root, 'src/game/RunRng.ts'));
Module._load = originalLoad;

function counters() {
  return {
    templateExpressions: 0,
    prebuiltLookups: 0,
    mathPow: 0,
    artScale: 0,
    registryGets: 0,
    atlasExists: 0,
    hitAtlasExists: 0,
    densityGetters: 0,
    pressureGetters: 0,
    mathRandom: 0,
  };
}

function resetCounters(target) {
  for (const key of Object.keys(target)) target[key] = 0;
}

function withInstrumentation(target, run) {
  const originalPow = Math.pow;
  const originalRandom = Math.random;
  const originalArtScale = ArtMetrics.artScale;
  const originalInstrument = globalThis.__perf04;
  Math.pow = function(...args) {
    target.mathPow += 1;
    return originalPow(...args);
  };
  Math.random = function(...args) {
    target.mathRandom += 1;
    return originalRandom(...args);
  };
  ArtMetrics.artScale = function(...args) {
    target.artScale += 1;
    return originalArtScale(...args);
  };
  globalThis.__perf04 = {
    template(frame) {
      target.templateExpressions += 1;
      return `bio-${frame}`;
    },
    prebuilt(frame, frames) {
      target.prebuiltLookups += 1;
      return frames[frame] ?? this.template(frame);
    },
  };
  try {
    return run();
  } finally {
    Math.pow = originalPow;
    Math.random = originalRandom;
    ArtMetrics.artScale = originalArtScale;
    if (originalInstrument === undefined) delete globalThis.__perf04;
    else globalThis.__perf04 = originalInstrument;
  }
}

function makeWorld(Enemy, specs, counts) {
  const graphics = [];
  const available = new Set([atlas, hitAtlas]);
  const scene = {
    time: { now: 0 },
    textures: {
      exists(key) {
        if (key === atlas) counts.atlasExists += 1;
        if (key === hitAtlas) counts.hitAtlasExists += 1;
        return available.has(key);
      },
    },
    registry: {
      performanceTier: 'full',
      get(key) {
        counts.registryGets += 1;
        assert.equal(key, 'performanceTier');
        return this.performanceTier;
      },
    },
    add: {
      existing() {},
      graphics() {
        const value = new Graphics();
        graphics.push(value);
        return value;
      },
    },
    physics: {
      add: {
        existing(enemy) {
          enemy.body = {
            velocity: { x: 0, y: 0 },
            setCircle(...args) { this.circle = args; },
            setVelocity(x, y) { this.velocity.x = x; this.velocity.y = y; },
          };
        },
      },
    },
  };
  const gs = {
    player: { x: 390, y: 480, body: { velocity: { x: 12, y: -8 } }, hurtUntil: 0 },
    density: 110,
    pressure: 1.1,
    getCombatVisualDensity() { counts.densityGetters += 1; return this.density; },
    getEnemyPressureMultiplier() { counts.pressureGetters += 1; return this.pressure; },
    isCombatActive() { return true; },
    onBossPhaseChanged() {},
    onAnomalyPhaseChanged() {},
    onPrimeMembraneBreak() {},
    triggerBossPressureWave() {},
    triggerAnomalyBurst() {},
    onEnemyDamaged() {},
    showEnemyHealth() {},
    hideEnemyHealth() {},
    onEnemyDied() {},
  };
  const enemies = specs.map((spec, index) => {
    const x = 20 + (index % 20) * 15;
    const y = 20 + Math.floor(index / 20) * 14;
    const enemy = new Enemy(scene, x, y);
    enemy.activate(gs, spec.kind, x, y, {
      elite: spec.elite ?? false,
      hpScale: 1,
      dmgScale: 1,
      eliteModifier: spec.eliteModifier ?? null,
      textureKey: spec.textureKey,
      bossBehavior: spec.bossBehavior,
      heartbeatMs: spec.heartbeatMs,
    });
    return enemy;
  });
  return { scene, gs, enemies, graphics, available, rng: new RunRng('perf-04-preupdate') };
}

function snapshotGraphics(graphics) {
  if (!graphics) return null;
  return {
    clearCalls: graphics.clearCalls,
    commands: graphics.commands,
    visible: graphics.visible,
    x: graphics.x,
    y: graphics.y,
    rotation: graphics.rotation,
    scaleX: graphics.scaleX,
    scaleY: graphics.scaleY,
    alpha: graphics.alpha,
    depth: graphics.depth,
    blendMode: graphics.blendMode,
  };
}

const nonScalarKeys = new Set([
  'scene', 'gs', 'target', 'body', 'texture', 'frame', 'eliteRing', 'eliteMarker',
  'bossAura', 'roleTelegraph', 'bossTelegraph', 'anomalyTelegraph', 'anomalyAura',
  'dangerEchoScratch',
]);

function snapshotEnemy(enemy) {
  const state = {};
  for (const key of Object.keys(enemy)) {
    if (nonScalarKeys.has(key)) continue;
    const value = enemy[key];
    if (value === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof value)) {
      state[key] = value;
    }
  }
  return {
    state,
    texture: enemy.texture.key,
    pose: enemy.frame.name,
    body: {
      velocity: { ...enemy.body.velocity },
      circle: enemy.body.circle,
    },
    graphics: {
      eliteRing: snapshotGraphics(enemy.eliteRing),
      eliteMarker: snapshotGraphics(enemy.eliteMarker),
      bossAura: snapshotGraphics(enemy.bossAura),
      roleTelegraph: snapshotGraphics(enemy.roleTelegraph),
      bossTelegraph: snapshotGraphics(enemy.bossTelegraph),
      anomalyTelegraph: snapshotGraphics(enemy.anomalyTelegraph),
      anomalyAura: snapshotGraphics(enemy.anomalyAura),
    },
  };
}

function executeFrame(world, time, delta, step) {
  world.scene.time.now = time;
  for (const enemy of world.enemies) enemy.preUpdate(time, delta);
  return {
    step,
    time,
    delta,
    enemies: world.enemies.map(snapshotEnemy),
    rng: world.rng.snapshot(),
  };
}

function runDensitySeries(Enemy, enemyCount, fps) {
  const counts = counters();
  return withInstrumentation(counts, () => {
    const specs = Array.from({ length: enemyCount }, () => ({
      kind: 'swarm',
      textureKey: 'immune-antibody',
    }));
    const world = makeWorld(Enemy, specs, counts);
    resetCounters(counts);
    const frameCount = fps === 60 ? 48 : 24;
    const delta = 1000 / fps;
    const snapshots = [];
    const initialRng = world.rng.snapshot();
    for (let frame = 0; frame < frameCount; frame += 1) {
      snapshots.push(executeFrame(world, (frame + 1) * delta, delta, frame));
      assert.deepStrictEqual(world.rng.snapshot(), initialRng, 'preUpdate consumed gameplay RNG');
    }
    return { counts, snapshots, frameCount };
  });
}

function compareSnapshots(baseline, candidate, label) {
  assert.equal(candidate.length, baseline.length, `${label}: frame count differs`);
  for (let frame = 0; frame < baseline.length; frame += 1) {
    assert.deepStrictEqual(candidate[frame], baseline[frame], `${label}: frame ${frame} differs`);
  }
}

function verifyDensity(enemyCount, fps) {
  const baseline = runDensitySeries(BaselineEnemy, enemyCount, fps);
  const candidate = runDensitySeries(CandidateEnemy, enemyCount, fps);
  const label = `${enemyCount} enemies @ ${fps}fps`;
  compareSnapshots(baseline.snapshots, candidate.snapshots, label);
  const calls = enemyCount * baseline.frameCount;
  assert.equal(baseline.counts.templateExpressions, calls);
  assert.equal(baseline.counts.prebuiltLookups, 0);
  assert.equal(baseline.counts.mathPow, calls);
  assert.equal(candidate.counts.templateExpressions, 0);
  assert.equal(candidate.counts.prebuiltLookups, calls);
  assert.equal(candidate.counts.mathPow, baseline.frameCount);
  for (const key of [
    'artScale', 'registryGets', 'atlasExists', 'hitAtlasExists',
    'densityGetters', 'pressureGetters', 'mathRandom',
  ]) {
    assert.equal(candidate.counts[key], baseline.counts[key], `${label}: ${key} changed`);
  }
  assert.equal(candidate.counts.mathRandom, 0);
  console.log(`COUNTS ${JSON.stringify({
    enemies: enemyCount,
    fps,
    frames: baseline.frameCount,
    baseline: {
      templateExpressions: baseline.counts.templateExpressions,
      mathPow: baseline.counts.mathPow,
      getters: baseline.counts.densityGetters + baseline.counts.pressureGetters,
    },
    candidate: {
      prebuiltLookups: candidate.counts.prebuiltLookups,
      templateExpressions: candidate.counts.templateExpressions,
      mathPow: candidate.counts.mathPow,
      getters: candidate.counts.densityGetters + candidate.counts.pressureGetters,
    },
  })}`);
  console.log(`PASS ${label}: exact per-frame state/RNG parity`);
}

const mixedSpecs = [
  { kind: 'swarm', textureKey: 'immune-antibody' },
  { kind: 'runner', elite: true, eliteModifier: 'frenzied', textureKey: 'immune-antibody' },
  { kind: 'brute', elite: true, eliteModifier: 'regenerator' },
  { kind: 'anomaly' },
  { kind: 'boss', bossBehavior: 'pressure-wave' },
  { kind: 'boss', bossBehavior: 'heartbeat-pulse', heartbeatMs: 920 },
];

function runMixedSeries(Enemy) {
  const counts = counters();
  return withInstrumentation(counts, () => {
    const world = makeWorld(Enemy, mixedSpecs, counts);
    resetCounters(counts);
    const snapshots = [];
    const baseDelta = 1000 / 60;
    const initialRng = world.rng.snapshot();
    for (let step = 0; step < 90; step += 1) {
      if (step >= 44 && step < 48) continue;
      const time = (step + 1) * baseDelta;
      const delta = step === 48 ? baseDelta * 5 : baseDelta;
      world.scene.time.now = time;
      if (step === 10) {
        world.enemies[0].takeDamage(1, 90, -30);
        world.enemies[1].takeDamage(1, -40, 50);
      }
      if (step === 12) world.available.delete(hitAtlas);
      if (step === 14) world.available.add(hitAtlas);
      if (step === 16) world.available.delete(atlas);
      if (step === 18) world.available.add(atlas);
      if (step === 20) {
        world.enemies[4].hp = world.enemies[4].maxHp * 0.4;
        world.enemies[5].hp = world.enemies[5].maxHp * 0.4;
      }
      if (step === 28) {
        motionQuery.matches = true;
        world.scene.registry.performanceTier = 'reduced';
      }
      if (step === 38) {
        motionQuery.matches = false;
        world.scene.registry.performanceTier = 'full';
      }
      if (step === 40) {
        const reused = world.enemies[0];
        reused.deactivateForStageReset();
        reused.activate(world.gs, 'runner', 70, 90, {
          elite: true,
          eliteModifier: 'volatile',
          hpScale: 1,
          dmgScale: 1,
          textureKey: 'immune-antibody',
        });
      }
      snapshots.push(executeFrame(world, time, delta, step));
      assert.deepStrictEqual(world.rng.snapshot(), initialRng, 'mixed series consumed gameplay RNG');
    }
    motionQuery.matches = false;
    return { counts, snapshots };
  });
}

function runMutationSeries(Enemy) {
  const counts = counters();
  return withInstrumentation(counts, () => {
    const world = makeWorld(Enemy, [
      { kind: 'swarm', textureKey: 'immune-antibody' },
      { kind: 'swarm', textureKey: 'immune-antibody' },
    ], counts);
    resetCounters(counts);
    world.scene.time.now = 1000;
    world.enemies[0].preUpdate(1000, 16);
    const first = snapshotEnemy(world.enemies[0]);
    world.gs.density = 200;
    world.gs.pressure = 1.5;
    world.enemies[1].preUpdate(1000, 16);
    const second = snapshotEnemy(world.enemies[1]);
    return { counts, first, second };
  });
}

function runPoses(Enemy, values) {
  const counts = counters();
  return withInstrumentation(counts, () => {
    const world = makeWorld(Enemy, [{ kind: 'swarm', textureKey: 'immune-antibody' }], counts);
    resetCounters(counts);
    const originalFrameAt = BiologicalAnimation.biologicalFrameAt;
    const poses = [];
    try {
      values.forEach((value, index) => {
        BiologicalAnimation.biologicalFrameAt = () => value;
        world.scene.time.now = 2000 + index * 16;
        world.enemies[0].preUpdate(2000 + index * 16, 16);
        poses.push(world.enemies[0].frame.name);
      });
    } finally {
      BiologicalAnimation.biologicalFrameAt = originalFrameAt;
    }
    return { counts, poses };
  });
}

try {
  verifyDensity(140, 60);
  verifyDensity(140, 30);
  verifyDensity(260, 60);
  verifyDensity(260, 30);

  const mixedBaseline = runMixedSeries(BaselineEnemy);
  const mixedCandidate = runMixedSeries(CandidateEnemy);
  compareSnapshots(mixedBaseline.snapshots, mixedCandidate.snapshots, 'mixed lifecycle');
  assert.ok(mixedCandidate.counts.mathPow < mixedBaseline.counts.mathPow);
  assert.ok(mixedCandidate.counts.templateExpressions < mixedBaseline.counts.templateExpressions);
  assert.equal(mixedCandidate.counts.densityGetters, mixedBaseline.counts.densityGetters);
  assert.equal(mixedCandidate.counts.pressureGetters, mixedBaseline.counts.pressureGetters);
  console.log('PASS mixed hits, 30/60-style deltas, pause/resume, bosses/elites, reduced motion, texture remove/re-add, pool reuse');

  const mutationBaseline = runMutationSeries(BaselineEnemy);
  const mutationCandidate = runMutationSeries(CandidateEnemy);
  assert.deepStrictEqual(mutationCandidate.first, mutationBaseline.first);
  assert.deepStrictEqual(mutationCandidate.second, mutationBaseline.second);
  for (const key of ['artScale', 'registryGets', 'atlasExists', 'hitAtlasExists', 'densityGetters', 'pressureGetters', 'mathRandom']) {
    assert.equal(mutationCandidate.counts[key], mutationBaseline.counts[key]);
  }
  assert.notEqual(mutationCandidate.first.state.alpha, mutationCandidate.second.state.alpha);
  assert.notEqual(
    mutationCandidate.first.body.velocity.x,
    mutationCandidate.second.body.velocity.x,
  );
  assert.equal(mutationBaseline.counts.mathPow, 2);
  assert.equal(mutationCandidate.counts.mathPow, 1);
  console.log('PASS same-frame density/pressure mutations remain enemy-local');

  const frameValues = [0, 1, 2, 3, 4, 5, NaN, Infinity, -Infinity, -1, 6, 0.5, undefined];
  const baselinePoses = runPoses(BaselineEnemy, frameValues);
  const candidatePoses = runPoses(CandidateEnemy, frameValues);
  const expected = frameValues.map(frame => `bio-${frame}`);
  assert.deepStrictEqual(baselinePoses.poses, expected);
  assert.deepStrictEqual(candidatePoses.poses, expected);
  assert.equal(candidatePoses.counts.prebuiltLookups, frameValues.length);
  assert.equal(candidatePoses.counts.templateExpressions, frameValues.length - 6);
  console.log('PASS six prebuilt frames and exact NaN/unusual-frame template fallback');

  console.log('Enemy preUpdate cache: baseline/candidate fixture PASS');
} finally {
  motionQuery.matches = false;
  Module._load = originalLoad;
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
}
