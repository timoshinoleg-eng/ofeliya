import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  const heartbeat = new HeartbeatPulseDirector();

  const checkpoint = {
    schemaVersion: 1,
    rulesetVersion: 2,
    campaignVersion: 2,
    savedAtEpochMs: Date.now(),
    runSeed: rng.seed,
    difficultyId: 'standard',
    controlMode: 'dual-move',
    resumed: false,
    director: director.snapshot(),
    runState: state.snapshotForCheckpoint(),
    rng: rng.snapshot(),
    wave: { spawnAcc: 0, spawnedElites: 0, minionAcc: 0 },
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
