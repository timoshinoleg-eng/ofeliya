/**
 * EASY difficulty contracts.
 *
 * Covers the beginner tier end to end: selection and persistence, checkpoint
 * resume, the unranked contract, Daily isolation, old-save compatibility and
 * the result-screen label.
 *
 * The gates here are behavioural: they run the real production modules
 * (bundled with esbuild) against a stubbed WebView storage and a stubbed
 * network, so a passing run means the shipped code behaves this way.
 */
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-easy-difficulty-'));
const require = createRequire(import.meta.url);
const sourcePath = (path) => resolve(path).split(sep).join('/');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
  }
}

try {
  const entry = join(temp, 'easy-entry.ts');
  const bundle = join(temp, 'easy-entry.cjs');
  writeFileSync(
    entry,
    [
      `export * from '${sourcePath('src/game/DifficultyProfile.ts')}';`,
      `export * from '${sourcePath('src/game/RunModeLabel.ts')}';`,
      `export { RunCheckpoint, RUN_CHECKPOINT_STORAGE_KEY, validateRunCheckpoint } from '${sourcePath('src/systems/RunCheckpoint.ts')}';`,
      `export { SaveSystem } from '${sourcePath('src/systems/SaveSystem.ts')}';`,
      `export { submitRunScore, buildScoreSubmission, beginRunCapability } from '${sourcePath('src/systems/ScoreClient.ts')}';`,
      `export { createFixedSeedDuel } from '${sourcePath('src/systems/DuelClient.ts')}';`,
      `export { launchDailyRun, readDailyIntent, resolveDailyResultBranch } from '${sourcePath('src/game/DailyRunIntent.ts')}';`,
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

  // --- Stubbed WebView storage -------------------------------------------------
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

  // --- Stubbed network ---------------------------------------------------------
  const fetchCalls = [];
  global.fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        rank: null,
        ranked: false,
        rulesetVersion: 3,
        campaignVersion: 2,
      }),
    };
  };

  const api = require(bundle);
  const {
    EASY_DIFFICULTY,
    STANDARD_DIFFICULTY,
    STRAINED_DIFFICULTY,
    DIFFICULTY_ORDER,
    DIFFICULTY_STORAGE_KEY,
    RANKED_DIFFICULTY_ID,
    getDifficultyProfile,
    isDifficultyId,
    isRankedDifficulty,
    isScoreSubmittable,
    nextDifficultyId,
    readDifficultySelection,
    writeDifficultySelection,
    runModeLabel,
    isRankedResult,
    RunCheckpoint,
    RUN_CHECKPOINT_STORAGE_KEY,
    validateRunCheckpoint,
    SaveSystem,
    submitRunScore,
    beginRunCapability,
    createFixedSeedDuel,
    launchDailyRun,
    readDailyIntent,
    resolveDailyResultBranch,
    RunState,
    RunRng,
    StageDirector,
    STAGES,
    HeartbeatPulseDirector,
  } = api;

  // ===========================================================================
  // 1. EASY selection and persistence
  // ===========================================================================
  storage.delete(DIFFICULTY_STORAGE_KEY);
  assertEqual(readDifficultySelection(), 'standard', 'a fresh install must not silently become Easy');
  assertEqual(readDifficultySelection(), 'standard', 'the default for new users must stay Standard');

  writeDifficultySelection('easy');
  assertEqual(storage.get(DIFFICULTY_STORAGE_KEY), 'easy', 'Easy selection was not persisted');
  assertEqual(readDifficultySelection(), 'easy', 'Easy selection was not restored');

  // An existing selection survives untouched — no automatic migration.
  writeDifficultySelection('standard');
  assertEqual(readDifficultySelection(), 'standard', 'an existing Standard selection must stay Standard');
  writeDifficultySelection('strained');
  assertEqual(readDifficultySelection(), 'strained', 'an existing Strained selection must stay Strained');

  // Old saves keep working: a value written by an older build is still valid.
  storage.set(DIFFICULTY_STORAGE_KEY, 'strained');
  assertEqual(readDifficultySelection(), 'strained', 'a legacy stored selection must still load');
  storage.set(DIFFICULTY_STORAGE_KEY, 'standard');
  assertEqual(readDifficultySelection(), 'standard', 'a legacy Standard selection must still load');

  // Corrupted storage fails safe to Standard, never to Easy.
  for (const broken of ['', 'easy-ish', 'EASY', 'null', '{}']) {
    storage.set(DIFFICULTY_STORAGE_KEY, broken);
    assertEqual(readDifficultySelection(), 'standard', `corrupted selection "${broken}" must fail safe to Standard`);
  }
  storage.delete(DIFFICULTY_STORAGE_KEY);

  // The selector cycle must reach every tier and come back.
  const cycle = [];
  let cursor = 'easy';
  for (let i = 0; i < 3; i += 1) {
    cycle.push(cursor);
    cursor = nextDifficultyId(cursor);
  }
  assertEqual(cycle.join('>'), 'easy>standard>strained', 'the selector cycle must go ЛЁГКИЙ → СТАНДАРТ → НАПРЯЖЕНИЕ');
  assertEqual(cursor, 'easy', 'the selector cycle must wrap back to Easy');

  // ===========================================================================
  // 2. EASY persistence through checkpoint + resume
  // ===========================================================================
  const director = new StageDirector(STAGES);
  director.startRun();
  const state = new RunState(director.currentStage);
  const rng = new RunRng('easy-difficulty-checkpoint-seed');
  for (const stream of Object.keys(rng.snapshot().states)) {
    rng.next(stream);
    rng.next(stream);
  }
  const heartbeat = new HeartbeatPulseDirector();

  const buildCheckpoint = (difficultyId) => ({
    schemaVersion: 1,
    rulesetVersion: 3,
    campaignVersion: 2,
    savedAtEpochMs: Date.now(),
    runSeed: rng.seed,
    difficultyId,
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
      cells: Array.from({ length: 6 }, () => ({ active: false, infection: 0, x: 0, y: 0, spawnedAgoMs: 0 })),
    },
    runtime: {
      playerX: 195,
      playerY: 422,
      lastCarrierUsed: false,
      heartbeatBeatIndex: 0,
      zeroPointNextInMs: 0,
    },
  });

  const easyCheckpoint = buildCheckpoint('easy');
  assert(validateRunCheckpoint(easyCheckpoint), 'an Easy checkpoint was rejected');
  assert(RunCheckpoint.save(easyCheckpoint), 'an Easy checkpoint was not persisted');
  const loadedEasy = RunCheckpoint.load();
  assert(loadedEasy, 'the Easy checkpoint did not round-trip');
  assertEqual(loadedEasy.difficultyId, 'easy', 'the resumed checkpoint lost its Easy difficulty');

  // A resumed Easy run must keep its tier: the checkpoint is authoritative.
  assertEqual(getDifficultyProfile(loadedEasy.difficultyId).id, 'easy', 'resume resolved the wrong difficulty');

  // Legacy checkpoints must still validate.
  assert(validateRunCheckpoint(buildCheckpoint('standard')), 'a legacy Standard checkpoint was rejected');
  assert(validateRunCheckpoint(buildCheckpoint('strained')), 'a legacy Strained checkpoint was rejected');

  // An unknown difficulty must fail closed.
  assertEqual(validateRunCheckpoint(buildCheckpoint('brutal')), null, 'an unknown difficulty checkpoint was accepted');
  assertEqual(validateRunCheckpoint(buildCheckpoint('')), null, 'an empty difficulty checkpoint was accepted');

  // A real historical checkpoint fixture must keep working unchanged.
  const preWave = JSON.parse(readFileSync('tests/pre-wave-checkpoint.fixture.json', 'utf8'));
  assert(validateRunCheckpoint(preWave), 'the real pre-wave checkpoint was rejected');

  // ===========================================================================
  // 3. The unranked contract
  // ===========================================================================
  assertEqual(RANKED_DIFFICULTY_ID, 'standard', 'the ranked tier must remain Standard');
  assertEqual(isRankedDifficulty('easy'), false, 'Easy must never be ranked');
  assertEqual(isRankedDifficulty('standard'), true, 'Standard must stay ranked');
  assertEqual(isRankedDifficulty('strained'), false, 'Strained must never be ranked');
  assertEqual(isScoreSubmittable('easy'), false, 'Easy must never be submitted');
  assertEqual(isScoreSubmittable('standard'), true, 'Standard must stay submitted');
  assertEqual(isScoreSubmittable('strained'), true, 'Strained submission behaviour changed');

  assertEqual(
    isRankedResult({ difficultyId: 'easy', resumed: false, daily: false, duel: false }),
    false,
    'an Easy run must never claim a ranked place'
  );
  assertEqual(
    isRankedResult({ difficultyId: 'standard', resumed: false, daily: false, duel: false }),
    true,
    'a fresh Standard run must still claim a ranked place'
  );
  assertEqual(
    isRankedResult({ difficultyId: 'standard', resumed: true, daily: false, duel: false }),
    false,
    'a resumed Standard run must not be ranked'
  );
  assertEqual(
    isRankedResult({ difficultyId: 'standard', resumed: false, daily: true, duel: false }),
    false,
    'a Daily Standard run must not be ranked'
  );
  assertEqual(
    isRankedResult({ difficultyId: 'standard', resumed: false, daily: false, duel: true }),
    false,
    'a Duel Standard run must not be ranked'
  );

  // ===========================================================================
  // 4. Score submission is skipped for Easy
  // ===========================================================================
  const makeResult = (overrides = {}) => ({
    win: false,
    reason: 'death',
    difficultyId: 'standard',
    runSeed: 'easy-score-seed',
    controlMode: 'dual-move',
    resumed: false,
    timeMs: 30_000,
    kills: 12,
    hostCellsInfected: 1,
    level: 3,
    highestLevel: 3,
    comboBest: 4,
    stageId: 'bloodstream',
    stageOrder: 1,
    bossesDefeated: 0,
    boss1ClearMs: 0,
    stacks: {},
    evolutions: [],
    legendaryIds: [],
    stageBuilds: {},
    newAchievements: [],
    records: { timeRecord: false, killsRecord: false, levelRecord: false },
    ...overrides,
  });
  const browserPlatform = { kind: 'browser', initData: undefined, getUser: () => undefined };

  fetchCalls.length = 0;
  const easyResponse = await submitRunScore(makeResult({ difficultyId: 'easy' }), browserPlatform);
  assertEqual(easyResponse, null, 'an Easy run returned a score response');
  assertEqual(fetchCalls.length, 0, 'an Easy run must not reach the score endpoint at all');

  // Standard and Strained keep their existing submission behaviour.
  fetchCalls.length = 0;
  await submitRunScore(makeResult({ difficultyId: 'standard' }), browserPlatform);
  assertEqual(fetchCalls.length, 1, 'a Standard run must still submit its score');
  assertEqual(fetchCalls[0].body.payload.difficultyId, 'standard', 'the Standard payload changed');

  fetchCalls.length = 0;
  await submitRunScore(makeResult({ difficultyId: 'strained' }), browserPlatform);
  assertEqual(fetchCalls.length, 1, 'a Strained run must keep submitting its score');
  assertEqual(fetchCalls[0].body.payload.difficultyId, 'strained', 'the Strained payload changed');

  // The run-start capability is a ranked-only artefact.
  fetchCalls.length = 0;
  const easyGrant = await beginRunCapability(
    { kind: 'max', initData: 'signed-easy-token' },
    { runSeed: 'easy-capability-seed', controlMode: 'dual-move', difficultyId: 'easy' }
  );
  assertEqual(easyGrant, null, 'an Easy run requested a ranked run capability');
  assertEqual(fetchCalls.length, 0, 'an Easy run must not request a run capability');

  // A Duel contract must never be created from an Easy result.
  const easyDuel = await createFixedSeedDuel(
    makeResult({ difficultyId: 'easy', win: true }),
    { kind: 'max', initData: 'signed-easy-token' }
  );
  assertEqual(easyDuel, null, 'an Easy result created a ranked Duel contract');

  // --- Server-side backstop ---------------------------------------------------
  // The server must not know the Easy tier, so any Easy payload that ever
  // reaches it is rejected outright instead of being ranked.
  const serverSource = readFileSync(resolve('server/index.mjs'), 'utf8');
  const serverDifficulties = serverSource.match(/const DIFFICULTY_IDS = new Set\(\[([^\]]*)\]\)/);
  assert(serverDifficulties, 'server DIFFICULTY_IDS contract not found');
  assert(
    !serverDifficulties[1].includes("'easy'"),
    'the server must not accept the Easy tier — an Easy payload has to be rejected, never ranked'
  );
  assert(
    /rankedEligible: payload\.difficultyId === 'standard'/.test(serverSource),
    'the server must keep ranking only Standard results'
  );

  // ===========================================================================
  // 5. Daily stays unchanged
  // ===========================================================================
  const registryValues = new Map();
  const registry = {
    get: (key) => registryValues.get(key),
    set: (key, value) => registryValues.set(key, value),
    remove: (key) => registryValues.delete(key),
  };
  global.fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        ticket: {
          runId: 'daily-run-id-01',
          runSeed: 'aabbccddeeff0011',
          dateKey: '2026-10-26',
          issuedAt: Date.now(),
          expiresAt: Date.now() + 600_000,
          difficultyId: 'standard',
          rulesetVersion: 3,
          campaignVersion: 2,
        },
      }),
    };
  };
  const dailyStatus = await launchDailyRun({ registry, platform: { kind: 'max', initData: 'signed-daily-token' } });
  assertEqual(dailyStatus, 'ok', 'the Daily launch contract changed');
  assertEqual(registry.get('difficultyId'), 'standard', 'a Daily run must always run Standard');
  assert(readDailyIntent(registry), 'the Daily intent marker was not written');

  // The Daily ticket itself is Standard-only.
  const dailySource = readFileSync(resolve('src/systems/DailyRunClient.ts'), 'utf8');
  assert(
    /difficultyId: 'standard'/.test(dailySource),
    'the Daily ticket must stay Standard-only'
  );
  assert(
    /ticket\.difficultyId !== 'standard'/.test(dailySource),
    'a non-Standard Daily ticket must be rejected'
  );

  // Daily result branch semantics are unchanged.
  assertEqual(
    resolveDailyResultBranch({ resumed: false, dailyIntent: null, ticket: null, runSeed: 'x', now: 1 }),
    'inactive',
    'the Daily result branch changed for ordinary runs'
  );

  // ===========================================================================
  // 6. Old save compatibility
  // ===========================================================================
  // The save schema never gained an Easy-specific field, so legacy saves load
  // unchanged and Easy runs simply do not feed the competitive counters.
  const save = SaveSystem.get();
  assert(typeof save.runs === 'number', 'the save schema changed');
  assert('standardCampaignClears' in save, 'the Standard clear counter disappeared');
  assert('strainedCampaignClears' in save, 'the Strained clear counter disappeared');
  assert(!('easyCampaignClears' in save), 'an Easy-only counter must not be added to the save schema');

  // A fresh Easy run must not touch the ranked personal records.
  SaveSystem.update({ bestSurvivalMs: 120_000, bestKills: 500, bestLevel: 20, runs: 10 });
  const easyRecords = SaveSystem.recordRun(
    false,
    300_000,
    900,
    40,
    [],
    { difficultyId: 'easy' },
    false
  );
  const afterEasy = SaveSystem.get();
  assertEqual(afterEasy.bestSurvivalMs, 120_000, 'an Easy run overwrote the survival record');
  assertEqual(afterEasy.bestKills, 500, 'an Easy run overwrote the kills record');
  assertEqual(afterEasy.bestLevel, 20, 'an Easy run overwrote the level record');
  assertEqual(easyRecords.timeRecord, false, 'an Easy run claimed a time record');
  assertEqual(easyRecords.killsRecord, false, 'an Easy run claimed a kills record');
  assertEqual(easyRecords.levelRecord, false, 'an Easy run claimed a level record');
  assertEqual(afterEasy.runs, 11, 'an Easy run must still count as a played run');
  assertEqual(afterEasy.totalKills, 900, 'an Easy run must still count its kills');
  assertEqual(afterEasy.standardCampaignClears, 0, 'an Easy win must not count as a Standard clear');
  assertEqual(afterEasy.strainedCampaignClears, 0, 'an Easy win must not count as a Strained clear');

  // Standard and Strained records keep their existing behaviour.
  const standardRecords = SaveSystem.recordRun(
    false,
    200_000,
    700,
    30,
    [],
    { difficultyId: 'standard' },
    true
  );
  assertEqual(standardRecords.timeRecord, true, 'a ranked Standard run stopped setting records');
  assertEqual(SaveSystem.get().bestSurvivalMs, 200_000, 'a ranked Standard run stopped updating the survival record');

  const strainedRecords = SaveSystem.recordRun(
    true,
    400_000,
    1000,
    50,
    [],
    { difficultyId: 'strained' },
    false
  );
  assertEqual(strainedRecords.timeRecord, false, 'a Strained run must not set the Standard survival record');
  const afterStrained = SaveSystem.get();
  assertEqual(afterStrained.strainedCampaignClears, 1, 'a Strained win stopped counting its own clear');
  assertEqual(afterStrained.bestStrainedCampaignClearMs, 400_000, 'a Strained win stopped keeping its own best time');
  assertEqual(afterStrained.standardCampaignClears, 0, 'a Strained win must not count as a Standard clear');

  // ===========================================================================
  // 7. Result label
  // ===========================================================================
  assertEqual(
    runModeLabel({ difficultyId: 'easy', resumed: false, daily: false, duel: false, ranked: false }),
    'РЕЖИМ: ЛЁГКИЙ · вне рейтинга',
    'the Easy result label is wrong'
  );
  assertEqual(
    runModeLabel({ difficultyId: 'easy', resumed: true, daily: false, duel: false, ranked: false }),
    'РЕЖИМ: ЛЁГКИЙ · ВОЗОБНОВЛЁН · ВНЕ РЕЙТИНГА',
    'the resumed Easy result label is wrong'
  );
  // Existing labels must not drift.
  assertEqual(
    runModeLabel({ difficultyId: 'standard', resumed: false, daily: false, duel: false, ranked: true }),
    'РЕЖИМ: СТАНДАРТ · рейтинговый',
    'the Standard result label drifted'
  );
  assertEqual(
    runModeLabel({ difficultyId: 'strained', resumed: false, daily: false, duel: false, ranked: false }),
    'РЕЖИМ: НАПРЯЖЕНИЕ · вне рейтинга',
    'the Strained result label drifted'
  );
  assertEqual(
    runModeLabel({ difficultyId: 'standard', resumed: true, daily: false, duel: false, ranked: false }),
    'РЕЖИМ: СТАНДАРТ · ВОЗОБНОВЛЁН · ВНЕ РЕЙТИНГА',
    'the resumed Standard result label drifted'
  );
  assertEqual(
    runModeLabel({ difficultyId: 'standard', resumed: false, daily: true, duel: false, ranked: false }),
    'РЕЖИМ: СТАНДАРТ · ежедневный забег',
    'the Daily result label drifted'
  );
  assertEqual(
    runModeLabel({ difficultyId: 'standard', resumed: false, daily: false, duel: true, ranked: false }),
    'РЕЖИМ: ДУЭЛЬ · СТАНДАРТ · ВНЕ РЕЙТИНГА',
    'the Duel result label drifted'
  );
  // The Easy label must read as a normal mode, never as a failure or a penalty.
  const easyLabel = runModeLabel({ difficultyId: 'easy', resumed: false, daily: false, duel: false, ranked: false });
  for (const forbidden of ['ШТРАФ', 'ПРОВАЛ', 'ОШИБКА', 'ЗАБАНЕН', 'ДИСКВАЛ']) {
    assert(!easyLabel.includes(forbidden), `the Easy result label must not read as a penalty (${forbidden})`);
  }

  // ===========================================================================
  // 8. The selector exposes the tier
  // ===========================================================================
  const menuSource = readFileSync(resolve('src/scenes/MenuScene.ts'), 'utf8');
  assert(menuSource.includes('nextDifficultyId'), 'the Menu selector no longer cycles the difficulty');
  assert(
    !/nextDifficultyId\([^)]*\)[\s\S]{0,400}?profile\.id === 'strained'\s*\?\s*'сложнее'\s*:\s*'базовый'/.test(menuSource),
    'the Menu selector still hardcodes a two-mode description'
  );

  console.log('easy difficulty contracts: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
