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
      `export * from '${sourcePath('src/game/UiCopy.ts')}';`,
      `export { RunCheckpoint, RUN_CHECKPOINT_STORAGE_KEY, validateRunCheckpoint } from '${sourcePath('src/systems/RunCheckpoint.ts')}';`,
      `export { SaveSystem } from '${sourcePath('src/systems/SaveSystem.ts')}';`,
      `export { submitRunScore, buildScoreSubmission, beginRunCapability } from '${sourcePath('src/systems/ScoreClient.ts')}';`,
      `export { createFixedSeedDuel, submitDuelAttempt } from '${sourcePath('src/systems/DuelClient.ts')}';`,
      `export { requestDailyRunDetailed } from '${sourcePath('src/systems/DailyRunClient.ts')}';`,
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
  const realFetch = globalThis.fetch;
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
    RESULT_MODE_CHIP,
    buildShareText,
    RunCheckpoint,
    RUN_CHECKPOINT_STORAGE_KEY,
    validateRunCheckpoint,
    SaveSystem,
    submitRunScore,
    beginRunCapability,
    createFixedSeedDuel,
    submitDuelAttempt,
    requestDailyRunDetailed,
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

  // The ranking state of a run is expressed by the chip the result shows: only
  // a fresh Standard run carries the ranked chip, every other mode is a
  // training run.
  assertEqual(RESULT_MODE_CHIP.easy, 'ЛЁГКИЙ · Тренировка', 'an Easy run must never claim a ranked place');
  assertEqual(RESULT_MODE_CHIP.ranked, 'СТАНДАРТ · В зачёт рейтинга', 'a fresh Standard run must still claim a ranked place');
  assertEqual(RESULT_MODE_CHIP.practice, 'Тренировка (продолженный забег)', 'a resumed Standard run must not be ranked');
  assertEqual(RESULT_MODE_CHIP.daily, 'ЗАБЕГ ДНЯ · СТАНДАРТ', 'a Daily Standard run must not be ranked');
  assertEqual(RESULT_MODE_CHIP.duel, 'ДУЭЛЬ · СТАНДАРТ', 'a Duel Standard run must not be ranked');

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

  // A Duel contract must never be created from an Easy result — and the client
  // must not even try: a request to the duel endpoint would already leak the
  // Easy run to the competitive contract path.
  fetchCalls.length = 0;
  const easyDuel = await createFixedSeedDuel(
    makeResult({ difficultyId: 'easy', win: true }),
    { kind: 'max', initData: 'signed-easy-token' }
  );
  assertEqual(easyDuel, null, 'an Easy result created a ranked Duel contract');
  assertEqual(
    fetchCalls.filter((call) => call.url.includes('api/duel')).length,
    0,
    'an Easy result reached the Duel endpoint'
  );
  assertEqual(fetchCalls.length, 0, 'an Easy result must not issue any request');

  // A Duel attempt from an Easy result must be refused client-side too.
  fetchCalls.length = 0;
  const easyDuelAttempt = await submitDuelAttempt(
    'duel-challenge-0123456789',
    makeResult({ difficultyId: 'easy', win: true }),
    { kind: 'max', initData: 'signed-easy-token' }
  );
  assertEqual(easyDuelAttempt, null, 'an Easy result submitted a Duel attempt');
  assertEqual(
    fetchCalls.filter((call) => call.url.includes('api/duel')).length,
    0,
    'an Easy result reached the Duel attempt endpoint'
  );

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

  // The same contract, proven against the running server rather than the source.
  global.fetch = realFetch;
  const serverDataDir = mkdtempSync(join(tmpdir(), 'ofeliya-easy-server-'));
  process.env.DATA_DIR = serverDataDir;
  process.env.PORT = '0';
  process.env.WRITE_RATE_LIMIT = '1000';
  const { server: scoreServer } = await import(resolve('server/index.mjs'));
  await new Promise((resolve) => scoreServer.once('listening', resolve));
  const serverBase = `http://127.0.0.1:${scoreServer.address().port}`;
  const serverPayload = (difficultyId) => ({
    rulesetVersion: 3,
    campaignVersion: 2,
    difficultyId,
    completionStage: 'bloodstream',
    runSeed: 'easy-contract-seed',
    controlMode: 'one-hand',
    bossesDefeated: 0,
    boss1ClearMs: null,
    hostCellsInfected: 1,
    win: false,
    timeMs: 1000,
    kills: 1,
    level: 1,
    daily: false,
    resumed: false,
  });
  const easyPost = await fetch(`${serverBase}/api/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'browser',
      anonId: 'anon-easy-contract',
      payload: serverPayload('easy'),
    }),
  });
  assertEqual(easyPost.status, 422, 'the server must reject an Easy score payload');
  const standardPost = await fetch(`${serverBase}/api/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'browser',
      anonId: 'anon-standard-contract',
      payload: serverPayload('standard'),
    }),
  });
  assertEqual(standardPost.status, 200, 'the server must still accept a Standard score payload');
  const shadowBoard = await fetch(`${serverBase}/api/top?period=all&includeUnverified=1`).then((r) => r.json());
  const shadowTiers = (shadowBoard.top || []).map((row) => row.difficultyId);
  assert(
    !shadowTiers.includes('easy'),
    `an Easy score reached a server-side board: ${shadowTiers.join(', ')}`
  );
  await new Promise((resolve) => scoreServer.close(resolve));
  rmSync(serverDataDir, { recursive: true, force: true });

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

  // ...and the client must actually refuse a non-Standard ticket it is handed.
  global.fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        ticket: {
          runId: 'daily-run-id-02',
          runSeed: 'aabbccddeeff0022',
          dateKey: '2026-10-26',
          issuedAt: Date.now(),
          expiresAt: Date.now() + 600_000,
          difficultyId: 'easy',
          rulesetVersion: 3,
          campaignVersion: 2,
        },
      }),
    };
  };
  const easyTicket = await requestDailyRunDetailed({ kind: 'max', initData: 'signed-daily-token' });
  assertEqual(easyTicket.ticket, null, 'a Daily ticket for the Easy tier was accepted');
  assert(
    easyTicket.status !== 'ok',
    `a Daily ticket for the Easy tier returned status "${easyTicket.status}"`
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

  // An Easy WIN must not feed the difficulty-specific clear counters either.
  const easyWin = SaveSystem.recordRun(
    true,
    600_000,
    900,
    40,
    [],
    { difficultyId: 'easy', boss1ClearMs: 120_000 },
    false
  );
  assertEqual(easyWin.timeRecord, false, 'an Easy win claimed a time record');
  const afterEasyWin = SaveSystem.get();
  assertEqual(afterEasyWin.standardCampaignClears, 0, 'an Easy win incremented the Standard clear counter');
  assertEqual(afterEasyWin.strainedCampaignClears, 0, 'an Easy win incremented the Strained clear counter');
  assertEqual(afterEasyWin.bestStrainedCampaignClearMs, 0, 'an Easy win touched the Strained best time');
  assertEqual(afterEasyWin.bestCampaignClearMs, 0, 'an Easy win touched the ranked campaign record');

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
  assertEqual(RESULT_MODE_CHIP.easy, 'ЛЁГКИЙ · Тренировка', 'the Easy result chip is wrong');
  assertEqual(RESULT_MODE_CHIP.practice, 'Тренировка (продолженный забег)', 'the resumed Easy result chip is wrong');
  // Existing chips must not drift.
  assertEqual(RESULT_MODE_CHIP.ranked, 'СТАНДАРТ · В зачёт рейтинга', 'the Standard result chip drifted');
  assertEqual(RESULT_MODE_CHIP.strained, 'НАПРЯЖЕНИЕ · Тренировка', 'the Strained result chip drifted');
  assertEqual(RESULT_MODE_CHIP.daily, 'ЗАБЕГ ДНЯ · СТАНДАРТ', 'the Daily result chip drifted');
  assertEqual(RESULT_MODE_CHIP.duel, 'ДУЭЛЬ · СТАНДАРТ', 'the Duel result chip drifted');
  // No chip may carry the internal ranking flag.
  for (const chip of Object.values(RESULT_MODE_CHIP)) {
    assert(!chip.toLowerCase().includes('вне рейтинга'), 'a result chip must not use the internal ranking flag');
  }
  // The Easy chip must read as a normal mode, never as a failure or a penalty.
  const easyLabel = RESULT_MODE_CHIP.easy;
  for (const forbidden of ['ШТРАФ', 'ПРОВАЛ', 'ОШИБКА', 'ЗАБАНЕН', 'ДИСКВАЛ']) {
    assert(!easyLabel.includes(forbidden), `the Easy result chip must not read as a penalty (${forbidden})`);
  }

  // The shared result text must never name a tier the player did not run, and
  // must never carry the internal ranking flag.
  const easyShare = buildShareText({ win: false, time: '00:26', kills: 18, infected: 2 });
  assert(!easyShare.includes('НАПРЯЖЕНИЕ'), 'the Easy share text names the wrong mode');
  assert(!easyShare.toLowerCase().includes('вне рейтинга'), 'the share text must not carry the internal ranking flag');
  assert(easyShare.startsWith('OFELIYA'), 'the share text must start with the product name');
  assert(easyShare.includes('@ofeliya_game_bot'), 'the share text must name the bot');
  const dailyShare = buildShareText({ win: false, time: '00:26', kills: 18, infected: 2, suffix: ' Ежедневный забег.' });
  assert(dailyShare.includes('Ежедневный забег.'), 'the Daily share text drifted');

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
