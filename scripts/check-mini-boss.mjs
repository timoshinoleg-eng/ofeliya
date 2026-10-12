import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-mini-boss-'));
const require = createRequire(import.meta.url);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/game/AnomalyPrime.ts',
      'src/game/StageDefinitions.ts',
      'src/game/StageDirector.ts',
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
    ANOMALY_ATTACK_PACING,
    ANOMALY_FIGHT_RESERVE_MS,
    ANOMALY_PHASE_TWO_HP_FRACTION,
    ANOMALY_VULNERABILITY,
    anomalyAttackPacing,
    anomalyDamageMultiplier,
    anomalyPhaseForHpFraction,
    miniBossSpawnedByStageTime,
    nextAnomalyAttack,
    validateMiniBossSchedule,
  } = require(join(temp, 'game/AnomalyPrime.js'));
  const { STAGES, BLOODSTREAM_STAGE, HEART_STAGE } = require(
    join(temp, 'game/StageDefinitions.js')
  );
  const { StageDirector } = require(join(temp, 'game/StageDirector.js'));

  // StageDirector constructor validates the live schedule (mini-boss + wave events together).
  const director = new StageDirector(STAGES);
  assert(director.currentStage.id === 'bloodstream', 'stage order changed');

  for (const stage of [BLOODSTREAM_STAGE, HEART_STAGE]) {
    const miniBoss = stage.miniBoss;
    assert(miniBoss, `${stage.id}: mini-boss schedule missing`);
    assert(miniBoss.atMs > 0 && miniBoss.atMs < stage.durationMs, `${stage.id}: bad atMs`);
    assert(
      miniBoss.atMs <= stage.durationMs - Math.max(stage.bossWarningLeadMs, 10_000) - ANOMALY_FIGHT_RESERVE_MS,
      `${stage.id}: mini-boss window reaches into the boss window`
    );
    assert(
      !/[\u0000-\u001f]/.test(miniBoss.title + miniBoss.subtitle + miniBoss.name),
      `${miniBoss.id}: control chars in copy`
    );
    // The reserved fight window must not swallow any wave-event telegraph or burst.
    const windowStart = miniBoss.atMs - miniBoss.telegraphMs;
    const windowEnd = miniBoss.atMs + ANOMALY_FIGHT_RESERVE_MS;
    for (const event of stage.waveEvents ?? []) {
      assert(
        event.atMs - event.telegraphMs < windowStart || event.atMs - event.telegraphMs >= windowEnd,
        `${stage.id}: ${event.id} telegraph starts inside the mini-boss window`
      );
      assert(
        event.atMs < windowStart || event.atMs >= windowEnd,
        `${stage.id}: ${event.id} burst lands inside the mini-boss window`
      );
    }
  }

  // Mid-run placement: the beat must actually break the middle of the run.
  assert(
    BLOODSTREAM_STAGE.miniBoss.atMs > BLOODSTREAM_STAGE.durationMs * 0.4 &&
      BLOODSTREAM_STAGE.miniBoss.atMs < BLOODSTREAM_STAGE.durationMs * 0.6,
    'Bloodstream mini-boss is not a mid-run beat'
  );
  assert(
    HEART_STAGE.miniBoss.atMs > HEART_STAGE.durationMs * 0.25 &&
      HEART_STAGE.miniBoss.atMs < HEART_STAGE.durationMs * 0.55,
    'Heart mini-boss is not a mid-run beat'
  );

  // Phase pacing: enrage quickens every timer and enlarges both attacks.
  const p1 = anomalyAttackPacing(1);
  const p2 = anomalyAttackPacing(2);
  assert(
    p2.telegraphMs < p1.telegraphMs &&
      p2.recoveryMs < p1.recoveryMs &&
      p2.cooldownMs < p1.cooldownMs,
    'phase 2 must quicken the attack cycle'
  );
  assert(p2.burstRadius > p1.burstRadius, 'phase 2 burst must grow');
  assert(p2.chargeSpeedMultiplier > p1.chargeSpeedMultiplier, 'phase 2 charge must speed up');
  assert(
    ANOMALY_ATTACK_PACING.initialDelayMs >= 1_000,
    'opening attack arrives before the player can read the spawn'
  );

  // Vulnerability hierarchy mirrors the boss language: recovery > pursuit > telegraph.
  assert(
    anomalyDamageMultiplier('recovery') === ANOMALY_VULNERABILITY.recoveryMultiplier,
    'recovery multiplier mismatch'
  );
  assert(
    anomalyDamageMultiplier('telegraph') === ANOMALY_VULNERABILITY.telegraphMultiplier,
    'telegraph multiplier mismatch'
  );
  assert(anomalyDamageMultiplier('pursuit') === 1 && anomalyDamageMultiplier('strike') === 1, 'neutral states must stay neutral');
  assert(
    ANOMALY_VULNERABILITY.recoveryMultiplier > 1 &&
      ANOMALY_VULNERABILITY.telegraphMultiplier < 1,
    'vulnerability hierarchy inverted'
  );

  // Phase threshold and deterministic alternation.
  assert(anomalyPhaseForHpFraction(ANOMALY_PHASE_TWO_HP_FRACTION + 0.01) === 1, 'phase 1 boundary wrong');
  assert(anomalyPhaseForHpFraction(ANOMALY_PHASE_TWO_HP_FRACTION) === 2, 'phase 2 boundary wrong');
  assert(nextAnomalyAttack(null) === 'radial-burst', 'first attack must be radial burst');
  let attack = nextAnomalyAttack(null);
  for (let i = 0; i < 8; i++) {
    attack = nextAnomalyAttack(attack);
    assert(attack === (i % 2 === 0 ? 'charge-dash' : 'radial-burst'), 'alternation broke');
  }

  // Restore derivation: pending before the spawn moment, consumed after it.
  const miniBoss = BLOODSTREAM_STAGE.miniBoss;
  assert(miniBossSpawnedByStageTime(miniBoss, 0) === false, 'restore at t=0 spawned');
  assert(
    miniBossSpawnedByStageTime(miniBoss, miniBoss.atMs - 1) === false,
    'restore just before spawn moment'
  );
  assert(
    miniBossSpawnedByStageTime(miniBoss, miniBoss.atMs) === true,
    'restore at spawn moment did not consume the beat'
  );
  assert(miniBossSpawnedByStageTime(undefined, 0) === true, 'no mini-boss must be a no-op');

  // Schedule validation rejects overlaps and malformed beats.
  const events = BLOODSTREAM_STAGE.waveEvents;
  let rejected = false;
  try {
    validateMiniBossSchedule(
      { ...miniBoss, atMs: events[1].atMs - 5_000 },
      events,
      BLOODSTREAM_STAGE.durationMs,
      BLOODSTREAM_STAGE.bossWarningLeadMs
    );
  } catch {
    rejected = true;
  }
  assert(rejected, 'mini-boss overlapping a wave event was accepted');

  rejected = false;
  try {
    validateMiniBossSchedule(
      { ...miniBoss, atMs: BLOODSTREAM_STAGE.durationMs - 15_000 },
      events,
      BLOODSTREAM_STAGE.durationMs,
      BLOODSTREAM_STAGE.bossWarningLeadMs
    );
  } catch {
    rejected = true;
  }
  assert(rejected, 'mini-boss reaching into the boss window was accepted');

  rejected = false;
  try {
    validateMiniBossSchedule(
      { ...miniBoss, telegraphMs: 300 },
      events,
      BLOODSTREAM_STAGE.durationMs,
      BLOODSTREAM_STAGE.bossWarningLeadMs
    );
  } catch {
    rejected = true;
  }
  assert(rejected, 'sub-600ms telegraph was accepted');

  rejected = false;
  try {
    validateMiniBossSchedule(
      { ...miniBoss, title: '' },
      events,
      BLOODSTREAM_STAGE.durationMs,
      BLOODSTREAM_STAGE.bossWarningLeadMs
    );
  } catch {
    rejected = true;
  }
  assert(rejected, 'mini-boss missing copy was accepted');

  console.log('mini-boss: schedule, pacing, vulnerability and restore derivation OK');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
