export type ImpactType =
  | 'normal_hit'
  | 'critical_hit'
  | 'player_hit'
  | 'enemy_death'
  | 'elite_spawn'
  | 'elite_death'
  | 'level_up'
  | 'rare_pick'
  | 'legendary_pick'
  | 'lysis'
  | 'heartbeat_warning'
  | 'heartbeat_impact'
  | 'boss_impact'
  | 'boss_phase';

export interface ImpactDecision {
  type: ImpactType;
  priority: number;
  cost: number;
  budgetGranted: boolean;
  hitStopMs: number;
  allowCameraShake: boolean;
  allowFullscreen: boolean;
  intensityScale: number;
}

interface ImpactProfile {
  priority: number;
  cost: number;
  hitStopMs: number;
  wantsShake: boolean;
  wantsFullscreen: boolean;
}

interface BudgetEntry {
  atMs: number;
  cost: number;
  priority: number;
}

const PROFILES: Record<ImpactType, ImpactProfile> = {
  normal_hit: { priority: 1, cost: 1, hitStopMs: 0, wantsShake: false, wantsFullscreen: false },
  critical_hit: { priority: 3, cost: 3, hitStopMs: 12, wantsShake: true, wantsFullscreen: false },
  player_hit: { priority: 4, cost: 4, hitStopMs: 12, wantsShake: true, wantsFullscreen: false },
  enemy_death: { priority: 1, cost: 1, hitStopMs: 0, wantsShake: false, wantsFullscreen: false },
  elite_spawn: { priority: 2, cost: 2, hitStopMs: 0, wantsShake: false, wantsFullscreen: false },
  elite_death: { priority: 3, cost: 4, hitStopMs: 20, wantsShake: true, wantsFullscreen: false },
  level_up: { priority: 2, cost: 2, hitStopMs: 0, wantsShake: false, wantsFullscreen: false },
  rare_pick: { priority: 2, cost: 3, hitStopMs: 0, wantsShake: false, wantsFullscreen: true },
  legendary_pick: { priority: 5, cost: 8, hitStopMs: 220, wantsShake: true, wantsFullscreen: true },
  lysis: { priority: 2, cost: 3, hitStopMs: 0, wantsShake: false, wantsFullscreen: false },
  heartbeat_warning: { priority: 3, cost: 2, hitStopMs: 0, wantsShake: false, wantsFullscreen: false },
  heartbeat_impact: { priority: 4, cost: 4, hitStopMs: 0, wantsShake: true, wantsFullscreen: false },
  boss_impact: { priority: 5, cost: 7, hitStopMs: 18, wantsShake: true, wantsFullscreen: false },
  boss_phase: { priority: 5, cost: 8, hitStopMs: 28, wantsShake: true, wantsFullscreen: true },
};

const BUDGET_WINDOW_MS = 700;
const BUDGET_CAPACITY = 12;
const PROTECTED_PRIORITY = 4;
const SHAKE_COOLDOWN_MS = 100;

/**
 * Central policy for screen-level combat feedback.
 *
 * Gameplay remains authoritative: this class never decides damage, death or collisions. It only
 * decides how much presentation can accompany a semantic event. High-priority gameplay feedback
 * (player hits, heartbeat impacts and boss events) cannot be suppressed by cosmetic budget load.
 */
export class ImpactDirector {
  private lastShakeAt = Number.NEGATIVE_INFINITY;
  private lastShakePriority = 0;
  private fullscreenUntil = 0;
  private fullscreenPriority = 0;
  private budgetEntries: BudgetEntry[] = [];

  request(type: ImpactType, now: number, fullscreenDurationMs = 0): ImpactDecision {
    const safeNow = Number.isFinite(now) ? Math.max(0, now) : 0;
    const profile = PROFILES[type];
    this.pruneBudget(safeNow);

    const used = this.budgetEntries.reduce((sum, entry) => sum + entry.cost, 0);
    const protectedEvent = profile.priority >= PROTECTED_PRIORITY;
    const budgetGranted = protectedEvent || used + profile.cost <= BUDGET_CAPACITY;

    // Protected events may exceed the rolling cap, but their cost is still recorded. That makes
    // subsequent low-priority cosmetics yield until the window clears instead of creating spam.
    if (budgetGranted) {
      this.budgetEntries.push({
        atMs: safeNow,
        cost: profile.cost,
        priority: profile.priority,
      });
    }

    const allowCameraShake =
      budgetGranted &&
      profile.wantsShake &&
      this.acquireShake(safeNow, profile.priority, SHAKE_COOLDOWN_MS);

    const allowFullscreen =
      budgetGranted &&
      profile.wantsFullscreen &&
      this.acquireFullscreenWithPriority(safeNow, fullscreenDurationMs, profile.priority);

    const degraded = !budgetGranted;
    return {
      type,
      priority: profile.priority,
      cost: profile.cost,
      budgetGranted,
      hitStopMs: degraded && profile.priority < 3 ? 0 : profile.hitStopMs,
      allowCameraShake,
      allowFullscreen,
      intensityScale: degraded ? 0 : protectedEvent ? 1 : Math.max(0.55, 1 - used / BUDGET_CAPACITY),
    };
  }

  /** Backwards-compatible lookup for call sites that have not moved to semantic request(). */
  hitStopMs(type: ImpactType): number {
    return PROFILES[type].hitStopMs;
  }

  /**
   * Backwards-compatible shake gate. Semantic request() should be preferred because it can let a
   * boss/player event pre-empt a low-priority cooldown.
   */
  allowCameraShake(now: number, cooldownMs = SHAKE_COOLDOWN_MS): boolean {
    return this.acquireShake(now, 1, cooldownMs);
  }

  /**
   * Backwards-compatible fullscreen lease. Semantic request() should be preferred for priority.
   */
  acquireFullscreen(now: number, durationMs: number): boolean {
    return this.acquireFullscreenWithPriority(now, durationMs, 1);
  }

  get debugState(): {
    budgetUsed: number;
    budgetCapacity: number;
    windowMs: number;
    lastShakePriority: number;
    fullscreenPriority: number;
  } {
    return {
      budgetUsed: this.budgetEntries.reduce((sum, entry) => sum + entry.cost, 0),
      budgetCapacity: BUDGET_CAPACITY,
      windowMs: BUDGET_WINDOW_MS,
      lastShakePriority: this.lastShakePriority,
      fullscreenPriority: this.fullscreenPriority,
    };
  }

  reset(): void {
    this.lastShakeAt = Number.NEGATIVE_INFINITY;
    this.lastShakePriority = 0;
    this.fullscreenUntil = 0;
    this.fullscreenPriority = 0;
    this.budgetEntries = [];
  }

  private pruneBudget(now: number): void {
    const cutoff = now - BUDGET_WINDOW_MS;
    this.budgetEntries = this.budgetEntries.filter((entry) => entry.atMs > cutoff);
  }

  private acquireShake(now: number, priority: number, cooldownMs: number): boolean {
    const safeNow = Number.isFinite(now) ? Math.max(0, now) : 0;
    const elapsed = safeNow - this.lastShakeAt;
    if (elapsed < cooldownMs && priority <= this.lastShakePriority) return false;
    this.lastShakeAt = safeNow;
    this.lastShakePriority = priority;
    return true;
  }

  private acquireFullscreenWithPriority(
    now: number,
    durationMs: number,
    priority: number
  ): boolean {
    const safeNow = Number.isFinite(now) ? Math.max(0, now) : 0;
    if (safeNow < this.fullscreenUntil && priority <= this.fullscreenPriority) return false;
    this.fullscreenUntil = safeNow + Math.max(0, durationMs);
    this.fullscreenPriority = priority;
    return true;
  }
}
