/**
 * QA deterministic-mode flag — module-level switch, pure, node-testable.
 *
 * What: one boolean, default false. Production never sets it: the only
 * writer is the test-only autonomous harness
 * (`src/test-support/installAutonomousHarness.ts`), which raises it when
 * synthetic stepping starts (`enterSteppedMode`) and clears it on
 * `resume()` to wall-clock. DEV/QA builds only — the harness module
 * itself is gated in main.ts and eliminated from production bundles.
 *
 * Why: Juice.hitStop dips scene.time.timeScale / world.timeScale from
 * wall-clock tweens (tween.js on performance.now), so in a stepped run
 * the dip spans a wall-time amount regardless of how fast frames are
 * pumped — replay/time-parity legs diverge (review §2.4/§6.1 of
 * docs/reviews/autonomous-campaign-harness-implementation-2026-11-18.md).
 * While this flag is set, Juice.hitStop skips the dip entirely; the hard
 * GameScene.hitStop() freeze (scene-time based, deterministic on its own)
 * is NOT touched. Production behaviour is unchanged: the flag is never
 * raised outside the harness.
 *
 * This module never reads build-time env flags or the URL: the gate
 * lives in the caller (main.ts harness install), exactly like qaHide.ts,
 * so the pure parts stay node-testable.
 */

let enabled = false;

/** Raise/clear the flag. Called only by the autonomous harness. */
export function setQaDeterministic(value: boolean): void {
  enabled = Boolean(value);
}

/** True while the harness drives the game with synthetic stepping. */
export function isQaDeterministic(): boolean {
  return enabled;
}
