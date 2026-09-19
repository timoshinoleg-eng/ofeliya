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
    STANDARD_DIFFICULTY,
    STRAINED_DIFFICULTY,
    getDifficultyProfile,
    nextDifficultyId,
    pickEliteModifier,
    heartbeatProfileForDifficulty,
  } = require(join(temp, 'game/DifficultyProfile.js'));
  const {
    HEARTBEAT_PULSE_PROFILE,
  } = require(join(temp, 'game/HeartbeatPulseDirector.js'));

  assert(getDifficultyProfile('unknown').id === 'standard', 'unknown difficulty did not fail safe');
  assert(getDifficultyProfile('strained').id === 'strained', 'Strained profile lookup failed');
  assert(nextDifficultyId('standard') === 'strained', 'difficulty toggle did not enter Strained');
  assert(nextDifficultyId('strained') === 'standard', 'difficulty toggle did not return Standard');

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

  console.log('difficulty deterministic smoke: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
