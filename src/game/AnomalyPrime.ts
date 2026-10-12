/**
 * Authored mid-run mini-boss («АНОМАЛИЯ-ПРАЙМ»): schedule validation, attack-cycle
 * pacing and vulnerability math. Pure module — no Phaser imports — so the whole
 * contract is unit-testable in plain Node (`scripts/check-mini-boss.mjs`).
 *
 * Design adapted from `giovanneluna/poke-survivors` (MIT),
 * `src/systems/EnemyBehaviors.ts`: the named per-enemy behavior state machines
 * (charger walk/pause/charge, rammer idle/aim/charge/recover, berserker sub-50%
 * enrage). OFELIYA rewrites the ideas around its own stage lifecycle, run-seeded
 * deterministic RNG and combat telegraph language; the donor's `Math.random`
 * teleports and tween tint cues are deliberately NOT reproduced. See
 * THIRD_PARTY_NOTICES.md.
 */

export type AnomalyAttackKind = 'radial-burst' | 'charge-dash';

/** Authored mini-boss beat, one per stage, living fully inside the PLAYING phase. */
export interface MiniBossDefinition {
  id: string;
  /** Stage time when the anomaly spawns. The warning leads it by `telegraphMs`. */
  atMs: number;
  telegraphMs: number;
  name: string;
  /** Banner copy, shown through the same presentation path as milestones/wave events. */
  title: string;
  subtitle: string;
  color: number;
}

export type AnomalyPhase = 1 | 2;
export type AnomalyAttackState = 'pursuit' | 'telegraph' | 'strike' | 'recovery';

export interface AnomalyPhasePacing {
  telegraphMs: number;
  /** radial-burst damage window (charge-dash uses `chargeMs` instead). */
  strikeMs: number;
  recoveryMs: number;
  cooldownMs: number;
  burstRadius: number;
  chargeSpeedMultiplier: number;
  chargeMs: number;
  damageMultiplier: number;
}

/** Phase two threshold mirrors the boss language: sub-55% HP enrages the anomaly. */
export const ANOMALY_PHASE_TWO_HP_FRACTION = 0.55;

export const ANOMALY_ATTACK_PACING = {
  initialDelayMs: 1_400,
  phase1: {
    telegraphMs: 820,
    strikeMs: 220,
    recoveryMs: 950,
    cooldownMs: 2_700,
    burstRadius: 150,
    chargeSpeedMultiplier: 3.6,
    chargeMs: 460,
    damageMultiplier: 0.7,
  },
  phase2: {
    telegraphMs: 640,
    strikeMs: 200,
    recoveryMs: 720,
    cooldownMs: 1_900,
    burstRadius: 185,
    chargeSpeedMultiplier: 4.2,
    chargeMs: 520,
    damageMultiplier: 0.85,
  },
} as const;

export function anomalyPhaseForHpFraction(hpFraction: number): AnomalyPhase {
  const safe = Number.isFinite(hpFraction) ? hpFraction : 1;
  return safe <= ANOMALY_PHASE_TWO_HP_FRACTION ? 2 : 1;
}

export function anomalyAttackPacing(phase: AnomalyPhase): AnomalyPhasePacing {
  return phase >= 2 ? ANOMALY_ATTACK_PACING.phase2 : ANOMALY_ATTACK_PACING.phase1;
}

/**
 * Authored strict alternation: radial burst and charge dash swap every cycle, so
 * the fight pattern is fully deterministic and consumes no gameplay RNG.
 */
export function nextAnomalyAttack(previous: AnomalyAttackKind | null): AnomalyAttackKind {
  return previous === 'radial-burst' ? 'charge-dash' : 'radial-burst';
}

export const ANOMALY_VULNERABILITY = {
  /** Armored while winding up: trading hits into the telegraph is discouraged. */
  telegraphMultiplier: 0.9,
  /** Punish window after every attack, same readability contract as PRIME. */
  recoveryMultiplier: 1.3,
} as const;

export function anomalyDamageMultiplier(state: AnomalyAttackState): number {
  if (state === 'recovery') return ANOMALY_VULNERABILITY.recoveryMultiplier;
  if (state === 'telegraph') return ANOMALY_VULNERABILITY.telegraphMultiplier;
  return 1;
}

/** Upper bound of the reserved fight window used for schedule clearance checks. */
export const ANOMALY_FIGHT_RESERVE_MS = 40_000;

/**
 * Schedule invariant: the whole beat (warning + reserved fight window) must fit
 * inside PLAYING, clear of the boss window and of every authored wave event's
 * telegraph-to-burst span.
 */
export function validateMiniBossSchedule(
  miniBoss: MiniBossDefinition | undefined,
  events: readonly { id: string; atMs: number; telegraphMs: number }[],
  stageDurationMs: number,
  bossWarningLeadMs: number
): void {
  if (!miniBoss) return;
  if (!miniBoss.id || !miniBoss.name || !miniBoss.title || !miniBoss.subtitle) {
    throw new Error(`Mini-boss missing identity/copy: ${miniBoss.id}`);
  }
  if (
    !Number.isFinite(miniBoss.atMs) ||
    miniBoss.atMs <= 0 ||
    !Number.isFinite(miniBoss.telegraphMs) ||
    miniBoss.telegraphMs < 600 ||
    miniBoss.telegraphMs > 5_000 ||
    miniBoss.atMs - miniBoss.telegraphMs < 0
  ) {
    throw new Error(`Invalid mini-boss schedule: ${miniBoss.id}`);
  }
  const bossWindowAtMs = stageDurationMs - Math.max(bossWarningLeadMs, 10_000);
  if (miniBoss.atMs + ANOMALY_FIGHT_RESERVE_MS > bossWindowAtMs) {
    throw new Error(`Mini-boss collides with the boss window: ${miniBoss.id}`);
  }
  for (const event of events) {
    const eventTelegraphStartMs = event.atMs - event.telegraphMs;
    const windowStartMs = miniBoss.atMs - miniBoss.telegraphMs;
    const windowEndMs = miniBoss.atMs + ANOMALY_FIGHT_RESERVE_MS;
    if (eventTelegraphStartMs >= windowStartMs && eventTelegraphStartMs < windowEndMs) {
      throw new Error(`Mini-boss collides with wave event telegraph: ${miniBoss.id} vs ${event.id}`);
    }
    if (event.atMs >= windowStartMs && event.atMs < windowEndMs) {
      throw new Error(`Mini-boss collides with wave event burst: ${miniBoss.id} vs ${event.id}`);
    }
  }
}

/**
 * Restore derivation. Checkpoints are suppressed from the warning until the
 * anomaly's death, so a restored run can only ever be in one of two states:
 * before the spawn moment (false — the beat plays normally) or after it
 * (true — the beat is never replayed or duplicated).
 */
export function miniBossSpawnedByStageTime(
  miniBoss: MiniBossDefinition | undefined,
  stageTimeMs: number
): boolean {
  if (!miniBoss) return true;
  const t = Number.isFinite(stageTimeMs) ? Math.max(0, stageTimeMs) : 0;
  return t >= miniBoss.atMs;
}
