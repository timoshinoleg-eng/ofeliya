/**
 * Onboarding state machine (donor adaptation).
 *
 * Adapted from `ricardo-foundry/canvas-vampire-survivors` `src/tutorial.js`
 * (MIT, pinned v2.8.0 @ e616704889e57efc9c1f49098786a95c364008d3).
 * Provenance and license: THIRD_PARTY_NOTICES.md.
 *
 * Presentation-free by project rule (see DailyRunIntent.ts): no Phaser import
 * and no player-facing strings. Step copy lives in the UI layer (UIScene).
 *
 * Five steps walk a new player through the core verbs:
 *   1. move       — hold a non-zero move vector for thresholdSeconds
 *   2. autoAttack — accumulate gameplay time (no event required)
 *   3. pickup     — collect at least one biomass pickup (notified by UI)
 *   4. levelUp    — accept one mutation choice (notified by UI)
 *   5. pause      — open the pause menu (notified by UI)
 *
 * The sequence advances when the per-step objective is met. Counters reset on
 * every transition. The host persists `tutorialDone` via SaveSystem when the
 * machine finishes or is skipped.
 */

export type OnboardingStepId = 'move' | 'autoAttack' | 'pickup' | 'levelUp' | 'pause';

export interface OnboardingStep {
  id: OnboardingStepId;
  /** Seconds of accumulated progress required (time-based steps). */
  thresholdSeconds?: number;
  /** Notified-event count required (event-based steps). */
  thresholdCount?: number;
}

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  // Counted as done once the player has held a non-zero move vector for
  // ~0.4 s of game time. Prevents a stuck key/joystick from advancing instantly.
  { id: 'move', thresholdSeconds: 0.4 },
  // Auto-attack accumulates gameplay time rather than requiring an event,
  // so a player not yet near an enemy is never rushed past the prompt.
  { id: 'autoAttack', thresholdSeconds: 1.5 },
  { id: 'pickup', thresholdCount: 1 },
  { id: 'levelUp', thresholdCount: 1 },
  { id: 'pause', thresholdCount: 1 },
];

/** Deadband below which a move vector counts as "not moving". */
const MOVE_DEADZONE = 0.05;

export class OnboardingState {
  active = false;
  completed = false;
  skipped = false;

  private stepIndex = 0;
  private moveSeconds = 0;
  private autoAttackSeconds = 0;
  private pickups = 0;
  private levelUps = 0;
  private pauses = 0;

  /** Activate the state machine — call once when the player opts in. */
  start(): void {
    this.active = true;
    this.stepIndex = 0;
    this.completed = false;
    this.skipped = false;
    this.resetCounters();
  }

  /** Permanently end the tutorial without finishing every step. */
  skip(): void {
    if (!this.active) return;
    this.active = false;
    this.skipped = true;
  }

  /** Cleanly finish the machine — host should persist `tutorialDone=true`. */
  finish(): void {
    if (!this.active) return;
    this.active = false;
    this.completed = true;
  }

  private resetCounters(): void {
    this.moveSeconds = 0;
    this.autoAttackSeconds = 0;
    this.pickups = 0;
    this.levelUps = 0;
    this.pauses = 0;
  }

  get currentStep(): OnboardingStep | null {
    if (!this.active) return null;
    return ONBOARDING_STEPS[this.stepIndex] ?? null;
  }

  /** Advance to the next step, finishing after the last. Returns new step id or null. */
  advance(): OnboardingStepId | null {
    if (!this.active) return null;
    this.stepIndex += 1;
    this.resetCounters();
    if (this.stepIndex >= ONBOARDING_STEPS.length) {
      this.finish();
      return null;
    }
    return ONBOARDING_STEPS[this.stepIndex].id;
  }

  /**
   * Per-frame tick. `dt` in seconds; `moveVec` is the player's input vector.
   * Event-based steps ignore tick entirely (donor semantics).
   */
  tick(dt: number, moveVec?: { x: number; y: number } | null): void {
    if (!this.active || !Number.isFinite(dt) || dt <= 0) return;
    const step = this.currentStep;
    if (!step) return;
    if (step.id === 'move') {
      if (moveVec && (Math.abs(moveVec.x) > MOVE_DEADZONE || Math.abs(moveVec.y) > MOVE_DEADZONE)) {
        this.moveSeconds += dt;
        if (step.thresholdSeconds !== undefined && this.moveSeconds >= step.thresholdSeconds) {
          this.advance();
        }
      }
      return;
    }
    if (step.id === 'autoAttack') {
      this.autoAttackSeconds += dt;
      if (step.thresholdSeconds !== undefined && this.autoAttackSeconds >= step.thresholdSeconds) {
        this.advance();
      }
    }
    // pickup/levelUp/pause wait for explicit notifications; tick is a no-op.
  }

  /** Notify the machine that the player collected a biomass pickup. */
  notifyPickup(): void {
    if (!this.advanceIfCurrent('pickup', () => (this.pickups += 1))) return;
  }

  /** Notify the machine of a mutation-choice event. */
  notifyLevelUp(): void {
    if (!this.advanceIfCurrent('levelUp', () => (this.levelUps += 1))) return;
  }

  /** Notify the machine that the player opened the pause menu. */
  notifyPause(): void {
    if (!this.advanceIfCurrent('pause', () => (this.pauses += 1))) return;
  }

  private advanceIfCurrent(id: OnboardingStepId, bump: () => void): boolean {
    if (!this.active) return false;
    const step = this.currentStep;
    if (!step || step.id !== id) return false;
    bump();
    if (step.thresholdCount !== undefined) {
      const count = id === 'pickup' ? this.pickups : id === 'levelUp' ? this.levelUps : this.pauses;
      if (count >= step.thresholdCount) this.advance();
    }
    return true;
  }

  /** Total number of steps (handy for "x / N" labels in the UI). */
  static get TOTAL_STEPS(): number {
    return ONBOARDING_STEPS.length;
  }
}
