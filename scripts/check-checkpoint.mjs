import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-checkpoint-'));
const require = createRequire(import.meta.url);
const sourcePath = (path) => resolve(path).split(sep).join('/');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const entry = join(temp, 'checkpoint-entry.ts');
  const bundle = join(temp, 'checkpoint-entry.cjs');
  writeFileSync(
    entry,
    [
      `export { RunCheckpoint, RUN_CHECKPOINT_STORAGE_KEY, validateRunCheckpoint } from '${sourcePath('src/systems/RunCheckpoint.ts')}';`,
      `export { RunState } from '${sourcePath('src/game/RunState.ts')}';`,
      `export { RunRng } from '${sourcePath('src/game/RunRng.ts')}';`,
      `export { StageDirector } from '${sourcePath('src/game/StageDirector.ts')}';`,
      `export { STAGES } from '${sourcePath('src/game/StageDefinitions.ts')}';`,
      `export { HeartbeatPulseDirector } from '${sourcePath('src/game/HeartbeatPulseDirector.ts')}';`,
    ].join('\n')
  );
  buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundle,
    logLevel: 'warning',
  });

  const storage = new Map();
  global.localStorage = {
    getItem(key) {
      return storage.get(key) ?? null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    },
  };

  const {
    RunCheckpoint,
    RUN_CHECKPOINT_STORAGE_KEY,
    validateRunCheckpoint,
    RunState,
    RunRng,
    StageDirector,
    STAGES,
    HeartbeatPulseDirector,
  } = require(bundle);

  const director = new StageDirector(STAGES);
  director.startRun();
  const state = new RunState(director.currentStage);
  const rng = new RunRng('checkpoint-unit-seed');
  for (const stream of Object.keys(rng.snapshot().states)) {
    rng.next(stream);
    rng.next(stream);
  }
  const heartbeat = new HeartbeatPulseDirector();

  const checkpoint = {
    schemaVersion: 1,
    rulesetVersion: 3,
    campaignVersion: 2,
    savedAtEpochMs: Date.now(),
    runSeed: rng.seed,
    difficultyId: 'standard',
    controlMode: 'dual-move',
    resumed: false,
    director: director.snapshot(),
    runState: state.snapshotForCheckpoint(),
    rng: rng.snapshot(),
    wave: { spawnAcc: 0, spawnedElites: 0, minionAcc: 0, waveEventIndex: 0, anomalySpawned: false },
    heartbeat: heartbeat.snapshot(),
    hostCells: {
      spawnAcc: 0,
      firstSpawned: false,
      cells: Array.from({ length: 6 }, () => ({
        active: false,
        infection: 0,
        x: 0,
        y: 0,
        spawnedAgoMs: 0,
      })),
    },
    runtime: {
      playerX: 195,
      playerY: 422,
      lastCarrierUsed: false,
      heartbeatBeatIndex: 0,
      zeroPointNextInMs: 0,
    },
  };

  assert(validateRunCheckpoint(checkpoint), 'valid checkpoint rejected');
  assert(RunCheckpoint.save(checkpoint), 'valid checkpoint was not persisted');
  assert(RunCheckpoint.load()?.runSeed === rng.seed, 'persisted checkpoint did not round-trip');

  // Produced by the real pre-wave release (6a5cf5be), not a current fixture
  // with selected fields deleted. Preserve all six historical stream states.
  const preWave = JSON.parse(readFileSync('tests/pre-wave-checkpoint.fixture.json', 'utf8'));
  assert(validateRunCheckpoint(preWave), 'real pre-wave v2 checkpoint rejected');
  storage.set(RUN_CHECKPOINT_STORAGE_KEY, JSON.stringify(preWave));
  assert(RunCheckpoint.load(), 'real pre-wave checkpoint was removed from storage');
  const oldRng = new RunRng(preWave.runSeed);
  oldRng.restore(preWave.rng);
  const freshRng = new RunRng(preWave.runSeed);
  for (const stream of ['wave-event', 'anomaly']) {
    assert(oldRng.next(stream) === freshRng.next(stream), `new ${stream} stream not derived from seed`);
  }
  for (const [stream, oldState] of Object.entries(preWave.rng.states)) {
    assert(oldRng.snapshot().states[stream] === oldState, `migration shifted historical ${stream}`);
  }
  const partialLegacy = structuredClone(preWave);
  delete partialLegacy.rng.states.loot;
  assert(validateRunCheckpoint(partialLegacy) === null, 'legacy checkpoint accepted missing original stream');

  // Additive migration: a checkpoint written before the mini-boss stream/flag
  // existed must still validate (RunRng.restore re-derives the missing stream).
  const legacyPreAnomaly = structuredClone(checkpoint);
  legacyPreAnomaly.rulesetVersion = 2;
  delete legacyPreAnomaly.rng.states.anomaly;
  delete legacyPreAnomaly.wave.anomalySpawned;
  assert(validateRunCheckpoint(legacyPreAnomaly), 'pre-anomaly checkpoint rejected');
  const migratedRng = new RunRng(rng.seed);
  migratedRng.restore(legacyPreAnomaly.rng);
  assert(migratedRng.next('anomaly') === new RunRng(rng.seed).next('anomaly'), 'legacy anomaly migration changed the seeded continuation');
  for (const stream of Object.keys(checkpoint.rng.states).filter((key) => key !== 'anomaly')) {
    assert(migratedRng.next(stream) === rng.next(stream), `legacy migration changed historical ${stream} continuation`);
  }

  for (const stream of Object.keys(checkpoint.rng.states)) {
    const missing = structuredClone(checkpoint);
    delete missing.rng.states[stream];
    assert(validateRunCheckpoint(missing) === null, `current checkpoint accepted missing RNG stream ${stream}`);
    if (stream !== 'anomaly') {
      missing.rulesetVersion = 2;
      delete missing.wave.anomalySpawned;
      assert(validateRunCheckpoint(missing) === null, `legacy checkpoint accepted missing historical RNG stream ${stream}`);
    }
    for (const invalid of [-1, 0.5, 0x100000000, NaN, Infinity, null, '1']) {
      const corrupted = structuredClone(checkpoint);
      corrupted.rng.states[stream] = invalid;
      assert(validateRunCheckpoint(corrupted) === null, `checkpoint accepted invalid ${stream} state ${invalid}`);
    }
  }
  const emptyRng = structuredClone(checkpoint);
  emptyRng.rng.states = {};
  assert(validateRunCheckpoint(emptyRng) === null, 'checkpoint accepted empty RNG state');
  const nonLegacyAnomaly = structuredClone(checkpoint);
  nonLegacyAnomaly.rulesetVersion = 2;
  delete nonLegacyAnomaly.rng.states.anomaly;
  assert(validateRunCheckpoint(nonLegacyAnomaly) === null, 'post-anomaly checkpoint accepted missing anomaly state');

  // Ruleset tolerance (P0-3, v2 → v3 daily mutator): ordinary-run checkpoints
  // carry no mutator state and stay resumable; anything older than v2 is not.
  const legacyRuleset = structuredClone(checkpoint);
  legacyRuleset.rulesetVersion = 2;
  assert(validateRunCheckpoint(legacyRuleset), 'legacy ruleset v2 checkpoint rejected');
  const obsoleteRuleset = structuredClone(checkpoint);
  obsoleteRuleset.rulesetVersion = 1;
  assert(validateRunCheckpoint(obsoleteRuleset) === null, 'obsolete ruleset v1 checkpoint accepted');

  const impossible = structuredClone(checkpoint);
  impossible.runState.stage.hp = impossible.runState.stage.maxHp + 1;
  assert(validateRunCheckpoint(impossible) === null, 'impossible HP checkpoint accepted');

  const incompatibleCampaign = structuredClone(checkpoint);
  incompatibleCampaign.campaignVersion = 999;
  assert(validateRunCheckpoint(incompatibleCampaign) === null, 'incompatible campaign accepted');

  const incompatibleSchema = structuredClone(checkpoint);
  incompatibleSchema.schemaVersion = 999;
  storage.set(RUN_CHECKPOINT_STORAGE_KEY, JSON.stringify(incompatibleSchema));
  assert(RunCheckpoint.load() === null, 'unknown schema did not fall back safely');
  assert(!storage.has(RUN_CHECKPOINT_STORAGE_KEY), 'unknown schema checkpoint was not removed');

  storage.set(RUN_CHECKPOINT_STORAGE_KEY, '{ definitely-not-json');
  assert(RunCheckpoint.load() === null, 'corrupted JSON did not fall back safely');
  assert(!storage.has(RUN_CHECKPOINT_STORAGE_KEY), 'corrupted checkpoint was not removed');

  const bossPhase = structuredClone(checkpoint);
  bossPhase.director.phase = 'BOSS_ACTIVE';
  assert(validateRunCheckpoint(bossPhase) === null, 'unsafe boss-active checkpoint accepted');

  const modalHeartbeat = structuredClone(checkpoint);
  modalHeartbeat.heartbeat.telegraphedImpactAtMs = 12_000;
  assert(validateRunCheckpoint(modalHeartbeat) === null, 'heartbeat atomic window checkpoint accepted');

  console.log('checkpoint schema/validation smoke: ok');
} finally {
  delete global.localStorage;
  rmSync(temp, { recursive: true, force: true });
}
