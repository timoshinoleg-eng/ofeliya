import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-pacing-'));
const require = createRequire(import.meta.url);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function impactSchedule(profile, durationMs) {
  const impacts = [];
  for (let at = profile.firstImpactAtMs; at < durationMs; at += profile.intervalMs) {
    impacts.push(at);
  }
  return impacts;
}

function waveSnapshot(stage, difficulty, atMs) {
  const progress = Math.max(0, Math.min(1, atMs / stage.durationMs));
  const baseInterval =
    stage.waves.spawnIntervalStartMs +
    (stage.waves.spawnIntervalEndMs - stage.waves.spawnIntervalStartMs) * progress;
  const intervalMs = baseInterval * difficulty.spawnIntervalMultiplier;
  const batchSize = Math.min(
    stage.waves.maxBatchSize + difficulty.batchBonus,
    1 + Math.floor(atMs / stage.waves.batchEveryMs) + difficulty.batchBonus
  );
  return {
    atMs,
    intervalMs: Math.round(intervalMs),
    batchSize,
    eliteEveryMs: Math.round(stage.waves.eliteEveryMs * difficulty.eliteIntervalMultiplier),
  };
}

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/game/StageDefinitions.ts',
      'src/game/HeartbeatPulseDirector.ts',
      'src/game/HeartPacing.ts',
      'src/game/BossPacing.ts',
      'src/game/BossVulnerability.ts',
      'src/game/DifficultyProfile.ts',
      'src/game/RunState.ts',
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

  const { BLOODSTREAM_STAGE, HEART_STAGE, STAGES } = require(join(temp, 'game/StageDefinitions.js'));
  const { HEARTBEAT_PULSE_PROFILE } = require(join(temp, 'game/HeartbeatPulseDirector.js'));
  const {
    HEART_SAFE_POCKET,
    heartSafePocketMinTravel,
  } = require(join(temp, 'game/HeartPacing.js'));
  const {
    BOSS_PHASE_TWO_HP_FRACTION,
    PRIME_ATTACK_PACING,
    primeAttackCycleMs,
  } = require(join(temp, 'game/BossPacing.js'));
  const {
    PRIME_VULNERABILITY,
  } = require(join(temp, 'game/BossVulnerability.js'));
  const {
    STANDARD_DIFFICULTY,
    STRAINED_DIFFICULTY,
    heartbeatProfileForDifficulty,
  } = require(join(temp, 'game/DifficultyProfile.js'));
  const { xpForLevel } = require(join(temp, 'game/RunState.js'));
  const {
    ENEMY_DEFS,
    PLAYER,
    PROGRESSION,
    WEAPON,
  } = require(join(temp, 'game/config.js'));

  const campaignPreBossMs = STAGES.reduce((sum, stage) => sum + stage.durationMs, 0);
  assert(campaignPreBossMs === 540_000, 'two-act pre-boss timeline must remain 09:00');

  assert(
    BLOODSTREAM_STAGE.durationMs === 300_000 && HEART_STAGE.durationMs === 240_000,
    'stage duration contract drifted'
  );

  const maxOpeningRadius = Math.max(
    ...BLOODSTREAM_STAGE.waves.openingSpawns.map((spawn) => spawn.radius)
  );
  assert(
    maxOpeningRadius < WEAPON.range,
    'opening Bloodstream enemies moved outside base auto-attack range'
  );

  const openingSwarm = ENEMY_DEFS.swarm;
  const baseShotsToKill = Math.ceil(openingSwarm.hp / WEAPON.damage);
  const nominalOpeningKillMs =
    Math.max(0, baseShotsToKill - 1) * WEAPON.fireIntervalMs +
    (maxOpeningRadius / WEAPON.bulletSpeed) * 1000;
  assert(
    nominalOpeningKillMs < 4_000,
    'base opening first-kill budget no longer fits the <=4s product target'
  );
  assert(
    PROGRESSION.firstKillXpFloor >= xpForLevel(1),
    'first kill no longer guarantees the first mutation threshold after pickup'
  );

  const telegraphMovementBudget =
    PLAYER.speed * (HEARTBEAT_PULSE_PROFILE.telegraphLeadMs / 1000);
  const normalMinTravel = heartSafePocketMinTravel(false);
  const bossMinTravel = heartSafePocketMinTravel(true);
  assert(
    HEART_SAFE_POCKET.normal.offset <= telegraphMovementBudget,
    'normal Heart pocket center is unreachable at base movement speed'
  );
  assert(
    HEART_SAFE_POCKET.boss.offset <= telegraphMovementBudget,
    'boss Heart pocket center is unreachable at base movement speed'
  );
  assert(
    bossMinTravel * 2 <= telegraphMovementBudget,
    'boss Heart safe-pocket lost its base-speed reachability margin'
  );
  assert(normalMinTravel <= bossMinTravel, 'normal Heart pocket became harder than boss pocket');

  const standardHeart = heartbeatProfileForDifficulty(STANDARD_DIFFICULTY);
  const strainedHeart = heartbeatProfileForDifficulty(STRAINED_DIFFICULTY);
  const standardHeartImpacts = impactSchedule(standardHeart, HEART_STAGE.durationMs);
  const strainedHeartImpacts = impactSchedule(strainedHeart, HEART_STAGE.durationMs);
  assert(standardHeartImpacts.length >= 12, 'Standard Heart became too sparse');
  assert(
    strainedHeartImpacts.length > standardHeartImpacts.length,
    'Strained Heart no longer creates more timing decisions'
  );
  assert(
    strainedHeart.bossIntervalMs < standardHeart.bossIntervalMs,
    'Strained CARDIAC TITAN heartbeat is not accelerated'
  );

  const phase1CycleMs = primeAttackCycleMs(1);
  const phase2CycleMs = primeAttackCycleMs(2);
  assert(
    BOSS_PHASE_TWO_HP_FRACTION > 0.45 && BOSS_PHASE_TWO_HP_FRACTION < 0.6,
    'boss phase-2 threshold left the calibrated mid-fight band'
  );
  assert(
    phase2CycleMs < phase1CycleMs * 0.75,
    'IMMUNE PRIME phase 2 no longer meaningfully accelerates attack cadence'
  );
  assert(
    PRIME_ATTACK_PACING.phase1.telegraphMs >= 500 &&
      PRIME_ATTACK_PACING.phase2.telegraphMs >= 500,
    'IMMUNE PRIME telegraph became too short for the current mobile readability contract'
  );
  assert(
    PRIME_VULNERABILITY.membraneBreakMsPhase1 >= 2_000 &&
      PRIME_VULNERABILITY.membraneBreakMsPhase2 >= 1_500,
    'IMMUNE PRIME lysis punish window became too short'
  );

  const report = {
    campaign: {
      bloodstreamMs: BLOODSTREAM_STAGE.durationMs,
      heartMs: HEART_STAGE.durationMs,
      preBossTotalMs: campaignPreBossMs,
    },
    firstSession: {
      maxOpeningRadius,
      baseWeaponRange: WEAPON.range,
      baseShotsToKillOpeningSwarm: baseShotsToKill,
      nominalOpeningKillMs: Math.round(nominalOpeningKillMs),
      firstKillXpFloor: PROGRESSION.firstKillXpFloor,
      firstLevelXp: xpForLevel(1),
    },
    heart: {
      telegraphLeadMs: HEARTBEAT_PULSE_PROFILE.telegraphLeadMs,
      baseMovementBudgetPx: Math.round(telegraphMovementBudget),
      normalPocket: {
        ...HEART_SAFE_POCKET.normal,
        minTravelPx: normalMinTravel,
      },
      bossPocket: {
        ...HEART_SAFE_POCKET.boss,
        minTravelPx: bossMinTravel,
      },
      standard: {
        firstImpactAtMs: standardHeart.firstImpactAtMs,
        intervalMs: standardHeart.intervalMs,
        preBossImpactCount: standardHeartImpacts.length,
        bossIntervalMs: standardHeart.bossIntervalMs,
      },
      strained: {
        firstImpactAtMs: strainedHeart.firstImpactAtMs,
        intervalMs: strainedHeart.intervalMs,
        preBossImpactCount: strainedHeartImpacts.length,
        bossIntervalMs: strainedHeart.bossIntervalMs,
      },
    },
    immunePrime: {
      phase2AtHpFraction: BOSS_PHASE_TWO_HP_FRACTION,
      initialAttackDelayMs: PRIME_ATTACK_PACING.initialDelayMs,
      phase1CycleMs,
      phase2CycleMs,
      phase1TelegraphMs: PRIME_ATTACK_PACING.phase1.telegraphMs,
      phase2TelegraphMs: PRIME_ATTACK_PACING.phase2.telegraphMs,
      membraneBreakMsPhase1: PRIME_VULNERABILITY.membraneBreakMsPhase1,
      membraneBreakMsPhase2: PRIME_VULNERABILITY.membraneBreakMsPhase2,
    },
    waveSnapshots: {
      standardBloodstream: [0, 60_000, 120_000, 180_000, 240_000, 300_000].map((at) =>
        waveSnapshot(BLOODSTREAM_STAGE, STANDARD_DIFFICULTY, at)
      ),
      strainedBloodstream: [0, 60_000, 120_000, 180_000, 240_000, 300_000].map((at) =>
        waveSnapshot(BLOODSTREAM_STAGE, STRAINED_DIFFICULTY, at)
      ),
      standardHeart: [0, 60_000, 120_000, 180_000, 240_000].map((at) =>
        waveSnapshot(HEART_STAGE, STANDARD_DIFFICULTY, at)
      ),
      strainedHeart: [0, 60_000, 120_000, 180_000, 240_000].map((at) =>
        waveSnapshot(HEART_STAGE, STRAINED_DIFFICULTY, at)
      ),
    },
  };

  console.log('campaign pacing contract: ok');
  console.log(JSON.stringify(report, null, 2));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
