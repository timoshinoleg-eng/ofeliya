import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-difficulty-'));
const require = createRequire(import.meta.url);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertDeepEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message}\n  actual:   ${a}\n  expected: ${b}`);
}

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/game/DifficultyProfile.ts',
      'src/game/HeartbeatPulseDirector.ts',
      '--target',
      'ES2020',
      '--module',
      'commonjs',
      '--moduleResolution',
      'node',
      '--rootDir',
      'src',
      '--outDir',
      temp,
      '--skipLibCheck',
      'true',
      '--esModuleInterop',
      'true',
    ],
    { stdio: 'inherit' }
  );

  const {
    EASY_DIFFICULTY,
    STANDARD_DIFFICULTY,
    STRAINED_DIFFICULTY,
    DIFFICULTY_PROFILES,
    DIFFICULTY_ORDER,
    RANKED_DIFFICULTY_ID,
    getDifficultyProfile,
    isDifficultyId,
    isRankedDifficulty,
    isScoreSubmittable,
    nextDifficultyId,
    pickEliteModifier,
    heartbeatProfileForDifficulty,
  } = require(join(temp, 'game/DifficultyProfile.js'));
  const {
    HEARTBEAT_PULSE_PROFILE,
  } = require(join(temp, 'game/HeartbeatPulseDirector.js'));

  // --- Difficulty enumeration -------------------------------------------------
  assertDeepEqual(
    [...DIFFICULTY_ORDER],
    ['easy', 'standard', 'strained'],
    'difficulty order drifted from ЛЁГКИЙ → СТАНДАРТ → НАПРЯЖЕНИЕ'
  );
  assertDeepEqual(
    Object.keys(DIFFICULTY_PROFILES).sort(),
    ['easy', 'standard', 'strained'],
    'difficulty registry does not expose exactly the three tiers'
  );
  for (const id of DIFFICULTY_ORDER) {
    assert(DIFFICULTY_PROFILES[id].id === id, `profile ${id} does not identify itself`);
    assert(typeof DIFFICULTY_PROFILES[id].label === 'string' && DIFFICULTY_PROFILES[id].label.length > 0, `${id}: empty label`);
    assert(typeof DIFFICULTY_PROFILES[id].shortLabel === 'string' && DIFFICULTY_PROFILES[id].shortLabel.length > 0, `${id}: empty shortLabel`);
    assert(typeof DIFFICULTY_PROFILES[id].description === 'string' && DIFFICULTY_PROFILES[id].description.length > 0, `${id}: empty description`);
  }

  assert(getDifficultyProfile('unknown').id === 'standard', 'unknown difficulty did not fail safe');
  assert(getDifficultyProfile(undefined).id === 'standard', 'undefined difficulty did not fail safe');
  assert(getDifficultyProfile(null).id === 'standard', 'null difficulty did not fail safe');
  assert(getDifficultyProfile('easy').id === 'easy', 'Easy profile lookup failed');
  assert(getDifficultyProfile('strained').id === 'strained', 'Strained profile lookup failed');
  assert(getDifficultyProfile('standard').id === 'standard', 'Standard profile lookup failed');

  assert(isDifficultyId('easy') === true, 'easy must be a known difficulty id');
  assert(isDifficultyId('standard') === true, 'standard must be a known difficulty id');
  assert(isDifficultyId('strained') === true, 'strained must be a known difficulty id');
  assert(isDifficultyId('brutal') === false, 'unknown id must not be accepted');
  assert(isDifficultyId(42) === false, 'non-string id must not be accepted');

  // --- Selector cycle ---------------------------------------------------------
  assert(nextDifficultyId('easy') === 'standard', 'difficulty cycle did not advance Easy → Standard');
  assert(nextDifficultyId('standard') === 'strained', 'difficulty cycle did not advance Standard → Strained');
  assert(nextDifficultyId('strained') === 'easy', 'difficulty cycle did not advance Strained → Easy');
  // The cycle must visit every tier exactly once and return to the start.
  const walked = [DIFFICULTY_ORDER[0]];
  for (let i = 1; i < DIFFICULTY_ORDER.length; i += 1) {
    walked.push(nextDifficultyId(walked[walked.length - 1]));
  }
  assertDeepEqual(walked, ['easy', 'standard', 'strained'], 'selector cycle order drifted');
  assert(nextDifficultyId(walked[walked.length - 1]) === 'easy', 'selector cycle did not wrap around');

  // --- Ranking contract -------------------------------------------------------
  assert(RANKED_DIFFICULTY_ID === 'standard', 'the ranked tier must remain Standard');
  assert(isRankedDifficulty('standard') === true, 'Standard must be ranked');
  assert(isRankedDifficulty('easy') === false, 'Easy must never be ranked');
  assert(isRankedDifficulty('strained') === false, 'Strained must never be ranked');
  // Strained keeps its historic contract: submitted, never ranked. Easy is never submitted.
  assert(isScoreSubmittable('standard') === true, 'Standard must stay score-submittable');
  assert(isScoreSubmittable('strained') === true, 'Strained score submission behaviour changed');
  assert(isScoreSubmittable('easy') === false, 'Easy must never be submitted to the score endpoint');

  // --- Standard must not drift ------------------------------------------------
  assertDeepEqual(
    STANDARD_DIFFICULTY,
    {
      id: 'standard',
      label: 'СТАНДАРТ',
      shortLabel: 'СТАНДАРТ',
      description: 'Базовый ритм кампании',
      enemyHpMultiplier: 1,
      enemyDamageMultiplier: 1,
      enemySpeedMultiplier: 1,
      spawnIntervalMultiplier: 1,
      batchBonus: 0,
      eliteIntervalMultiplier: 1,
      normalEnemyCapBonus: 0,
      bossHpMultiplier: 1,
      bossDamageMultiplier: 1,
      bossSpeedMultiplier: 1,
      bossMinionIntervalMultiplier: 1,
      bossMinionBonus: 0,
      threatCapStart: null,
      threatCapEnd: null,
      eliteModifiers: [],
      mutators: [],
      heartbeatIntervalMultiplier: 1,
      heartbeatPressureMultiplier: 1,
    },
    'Standard profile drifted'
  );

  // --- The existing harder tier must not drift --------------------------------
  assertDeepEqual(
    STRAINED_DIFFICULTY,
    {
      id: 'strained',
      label: 'НАПРЯЖЕНИЕ',
      shortLabel: 'НАПРЯЖЕНИЕ',
      description: 'Особые клетки мутируют · давление растёт',
      enemyHpMultiplier: 1.08,
      enemyDamageMultiplier: 1.12,
      enemySpeedMultiplier: 1.06,
      spawnIntervalMultiplier: 0.84,
      batchBonus: 1,
      eliteIntervalMultiplier: 0.68,
      normalEnemyCapBonus: 20,
      bossHpMultiplier: 1.12,
      bossDamageMultiplier: 1.15,
      bossSpeedMultiplier: 1.08,
      bossMinionIntervalMultiplier: 0.78,
      bossMinionBonus: 2,
      threatCapStart: 42,
      threatCapEnd: 82,
      eliteModifiers: ['regenerator', 'frenzied', 'volatile'],
      mutators: ['adaptive-elites', 'accelerated-heartbeat'],
      heartbeatIntervalMultiplier: 0.78,
      heartbeatPressureMultiplier: 1.12,
    },
    'Strained profile drifted'
  );

  assert(STANDARD_DIFFICULTY.enemyHpMultiplier === 1, 'Standard HP multiplier drifted');
  assert(STANDARD_DIFFICULTY.enemyDamageMultiplier === 1, 'Standard damage multiplier drifted');
  assert(STANDARD_DIFFICULTY.enemySpeedMultiplier === 1, 'Standard speed multiplier drifted');
  assert(STANDARD_DIFFICULTY.spawnIntervalMultiplier === 1, 'Standard spawn cadence drifted');
  assert(STANDARD_DIFFICULTY.batchBonus === 0, 'Standard batch size drifted');
  assert(STANDARD_DIFFICULTY.eliteIntervalMultiplier === 1, 'Standard elite cadence drifted');
  assert(STANDARD_DIFFICULTY.bossHpMultiplier === 1, 'Standard boss HP drifted');
  assert(STANDARD_DIFFICULTY.bossDamageMultiplier === 1, 'Standard boss damage drifted');
  assert(STANDARD_DIFFICULTY.bossMinionBonus === 0, 'Standard boss minions drifted');
  assert(STANDARD_DIFFICULTY.threatCapStart === null, 'Standard unexpectedly gained threat cap');
  assert(STANDARD_DIFFICULTY.eliteModifiers.length === 0, 'Standard unexpectedly gained elite affixes');

  const standardHeart = heartbeatProfileForDifficulty(STANDARD_DIFFICULTY);
  assert(
    JSON.stringify(standardHeart) === JSON.stringify(HEARTBEAT_PULSE_PROFILE),
    'Standard heartbeat behavior drifted'
  );

  assert(STRAINED_DIFFICULTY.spawnIntervalMultiplier < 1, 'Strained waves are not faster');
  assert(STRAINED_DIFFICULTY.eliteIntervalMultiplier < 1, 'Strained elites are not more frequent');
  assert(STRAINED_DIFFICULTY.batchBonus > 0, 'Strained batch composition did not change');
  assert(STRAINED_DIFFICULTY.bossMinionBonus > 0, 'Strained boss phase did not gain pressure');
  assert(STRAINED_DIFFICULTY.threatCapStart > 0, 'Strained threat budget missing');
  assert(STRAINED_DIFFICULTY.eliteModifiers.length === 3, 'Strained elite affix set drifted');

  assert(pickEliteModifier(STRAINED_DIFFICULTY, () => 0) === 'regenerator', 'regenerator selection failed');
  assert(pickEliteModifier(STRAINED_DIFFICULTY, () => 0.4) === 'frenzied', 'frenzied selection failed');
  assert(pickEliteModifier(STRAINED_DIFFICULTY, () => 0.9) === 'volatile', 'volatile selection failed');
  assert(pickEliteModifier(STANDARD_DIFFICULTY, () => 0) === null, 'Standard received an elite affix');

  const strainedHeart = heartbeatProfileForDifficulty(STRAINED_DIFFICULTY);
  assert(
    strainedHeart.intervalMs < HEARTBEAT_PULSE_PROFILE.intervalMs,
    'Strained Heart interval was not accelerated'
  );
  assert(
    strainedHeart.bossIntervalMs < HEARTBEAT_PULSE_PROFILE.bossIntervalMs,
    'Strained boss heartbeat interval was not accelerated'
  );
  assert(
    strainedHeart.pressureMultiplier > HEARTBEAT_PULSE_PROFILE.pressureMultiplier,
    'Strained Heart pressure did not increase'
  );

  // --- Easy profile ------------------------------------------------------------
  assert(EASY_DIFFICULTY.id === 'easy', 'Easy profile id drifted');
  assert(EASY_DIFFICULTY.label === 'ЛЁГКИЙ', 'Easy UI label must be ЛЁГКИЙ');
  assert(EASY_DIFFICULTY.shortLabel === 'ЛЁГКИЙ', 'Easy short label must be ЛЁГКИЙ');
  assert(
    typeof EASY_DIFFICULTY.description === 'string' && EASY_DIFFICULTY.description.length > 0,
    'Easy needs a visible description'
  );

  // 1. Incoming damage is the first lever.
  assert(EASY_DIFFICULTY.enemyDamageMultiplier < 1, 'Easy must reduce incoming enemy damage');
  assert(EASY_DIFFICULTY.bossDamageMultiplier < 1, 'Easy must reduce incoming boss damage');
  // 2. Spawn pressure.
  assert(EASY_DIFFICULTY.spawnIntervalMultiplier > 1, 'Easy must slow the spawn cadence');
  assert(EASY_DIFFICULTY.batchBonus < 0, 'Easy must shrink the spawn batch');
  assert(EASY_DIFFICULTY.normalEnemyCapBonus < 0, 'Easy must lower the enemy cap');
  // 3. Elite pressure.
  assert(EASY_DIFFICULTY.eliteIntervalMultiplier > 1, 'Easy must make elites rarer');
  assert(EASY_DIFFICULTY.eliteModifiers.length === 0, 'Easy must not hand out elite affixes');
  assert(EASY_DIFFICULTY.mutators.length === 0, 'Easy must not carry difficulty mutators');
  // 4. Slight speed relaxation.
  assert(EASY_DIFFICULTY.enemySpeedMultiplier < 1, 'Easy must relax enemy speed slightly');
  assert(EASY_DIFFICULTY.enemySpeedMultiplier >= 0.85, 'Easy enemy speed relaxation must stay slight');
  // Boss minions follow the same spawn-pressure rule.
  assert(EASY_DIFFICULTY.bossMinionIntervalMultiplier > 1, 'Easy must slow boss minions');
  assert(EASY_DIFFICULTY.bossMinionBonus < 0, 'Easy must spawn fewer boss minions');
  // Heartbeat: fewer decisions, softer pressure.
  assert(EASY_DIFFICULTY.heartbeatIntervalMultiplier > 1, 'Easy must slow the heartbeat');
  assert(EASY_DIFFICULTY.heartbeatPressureMultiplier < 1, 'Easy must soften the heartbeat');

  // Easy must not become god mode: no player damage buff, no boss removal.
  assert(EASY_DIFFICULTY.enemyHpMultiplier === 1, 'Easy must not change enemy HP');
  assert(EASY_DIFFICULTY.bossHpMultiplier === 1, 'Easy must not change boss HP');
  assert(EASY_DIFFICULTY.threatCapStart !== null && EASY_DIFFICULTY.threatCapEnd !== null, 'Easy needs a threat ceiling');
  assert(
    EASY_DIFFICULTY.threatCapStart > 0 && EASY_DIFFICULTY.threatCapEnd > EASY_DIFFICULTY.threatCapStart,
    'Easy threat ceiling must be a positive ramp'
  );

  // Every numeric knob must stay finite and usable.
  for (const key of [
    'enemyHpMultiplier', 'enemyDamageMultiplier', 'enemySpeedMultiplier',
    'spawnIntervalMultiplier', 'eliteIntervalMultiplier', 'bossHpMultiplier',
    'bossDamageMultiplier', 'bossSpeedMultiplier', 'bossMinionIntervalMultiplier',
    'heartbeatIntervalMultiplier', 'heartbeatPressureMultiplier',
  ]) {
    assert(Number.isFinite(EASY_DIFFICULTY[key]) && EASY_DIFFICULTY[key] > 0, `Easy ${key} must be positive`);
  }
  for (const key of ['batchBonus', 'normalEnemyCapBonus', 'bossMinionBonus']) {
    assert(Number.isInteger(EASY_DIFFICULTY[key]), `Easy ${key} must be an integer`);
  }

  // --- Ordering: Easy is gentler than Standard, Standard is gentler than Strained
  assert(
    EASY_DIFFICULTY.enemyDamageMultiplier < STANDARD_DIFFICULTY.enemyDamageMultiplier &&
      STANDARD_DIFFICULTY.enemyDamageMultiplier < STRAINED_DIFFICULTY.enemyDamageMultiplier,
    'enemy damage must order Easy < Standard < Strained'
  );
  assert(
    EASY_DIFFICULTY.bossDamageMultiplier < STANDARD_DIFFICULTY.bossDamageMultiplier &&
      STANDARD_DIFFICULTY.bossDamageMultiplier < STRAINED_DIFFICULTY.bossDamageMultiplier,
    'boss damage must order Easy < Standard < Strained'
  );
  assert(
    EASY_DIFFICULTY.spawnIntervalMultiplier > STANDARD_DIFFICULTY.spawnIntervalMultiplier &&
      STANDARD_DIFFICULTY.spawnIntervalMultiplier > STRAINED_DIFFICULTY.spawnIntervalMultiplier,
    'spawn cadence must order Easy > Standard > Strained'
  );
  assert(
    EASY_DIFFICULTY.eliteIntervalMultiplier > STANDARD_DIFFICULTY.eliteIntervalMultiplier &&
      STANDARD_DIFFICULTY.eliteIntervalMultiplier > STRAINED_DIFFICULTY.eliteIntervalMultiplier,
    'elite cadence must order Easy > Standard > Strained'
  );
  assert(
    EASY_DIFFICULTY.enemySpeedMultiplier < STANDARD_DIFFICULTY.enemySpeedMultiplier &&
      STANDARD_DIFFICULTY.enemySpeedMultiplier < STRAINED_DIFFICULTY.enemySpeedMultiplier,
    'enemy speed must order Easy < Standard < Strained'
  );
  assert(
    EASY_DIFFICULTY.bossMinionIntervalMultiplier > STANDARD_DIFFICULTY.bossMinionIntervalMultiplier &&
      STANDARD_DIFFICULTY.bossMinionIntervalMultiplier > STRAINED_DIFFICULTY.bossMinionIntervalMultiplier,
    'boss minion cadence must order Easy > Standard > Strained'
  );
  assert(
    EASY_DIFFICULTY.heartbeatIntervalMultiplier > STANDARD_DIFFICULTY.heartbeatIntervalMultiplier &&
      STANDARD_DIFFICULTY.heartbeatIntervalMultiplier > STRAINED_DIFFICULTY.heartbeatIntervalMultiplier,
    'heartbeat cadence must order Easy > Standard > Strained'
  );
  // The threat ceiling must stay strictly below the harder tier's ceiling.
  assert(
    EASY_DIFFICULTY.threatCapStart < STRAINED_DIFFICULTY.threatCapStart &&
      EASY_DIFFICULTY.threatCapEnd < STRAINED_DIFFICULTY.threatCapEnd,
    'Easy threat ceiling must stay below the Strained ceiling'
  );

  // --- Heartbeat scheduling ----------------------------------------------------
  const impactCount = (profile) => {
    const heart = heartbeatProfileForDifficulty(profile);
    let count = 0;
    for (let at = heart.firstImpactAtMs; at < 240_000; at += heart.intervalMs) count += 1;
    return count;
  };
  const easyImpacts = impactCount(EASY_DIFFICULTY);
  const standardImpacts = impactCount(STANDARD_DIFFICULTY);
  const strainedImpacts = impactCount(STRAINED_DIFFICULTY);
  assert(easyImpacts < standardImpacts, 'Easy must create fewer heartbeat decisions than Standard');
  assert(standardImpacts < strainedImpacts, 'Strained must create more heartbeat decisions than Standard');
  assert(easyImpacts > 0, 'Easy must keep the heartbeat mechanic alive');

  console.log('difficulty deterministic smoke: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
