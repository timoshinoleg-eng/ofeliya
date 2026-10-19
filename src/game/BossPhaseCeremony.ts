/**
 * Shared phase-transition ceremony for the pressure-wave boss (B4).
 *
 * One deterministic envelope drives both the world aura (Enemy) and the HUD
 * boss bar (UIScene), so a phase change (armored -> recovery/broken) reads as
 * a single synchronized event instead of two quiet recolors. Pure math: no
 * tweens, no per-frame allocations, no gameplay state.
 */
export const BOSS_PHASE_TRANSITION_MS = 420;

/**
 * Ease-out quad pulse: 1 immediately after the transition, 0 after
 * BOSS_PHASE_TRANSITION_MS. Non-finite or non-positive input is inert.
 */
export function phaseTransitionPulse(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  const t = elapsedMs / BOSS_PHASE_TRANSITION_MS;
  if (t >= 1) return 0;
  const k = 1 - t;
  return k * k;
}
