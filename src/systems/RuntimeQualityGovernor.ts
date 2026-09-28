export type RuntimeQualityLevel = 'low' | 'balanced' | 'full';

export interface RuntimeQualityProfile {
  level: RuntimeQualityLevel;
  particleScale: number;
  ambientScale: number;
}

export interface RuntimeQualitySnapshot extends RuntimeQualityProfile {
  baselineFrameMs: number | null;
  p50FrameMs: number;
  p90FrameMs: number;
  p95FrameMs: number;
  estimatedFps: number;
  overBudgetStreakMs: number;
  underBudgetStreakMs: number;
  cooldownRemainingMs: number;
  ignoredSuspensionFrames: number;
}

export interface RuntimeQualityGovernorConfig {
  initialLevel: RuntimeQualityLevel;
  minLevel: RuntimeQualityLevel;
  maxLevel: RuntimeQualityLevel;
  sampleWindow: number;
  warmupSamples: number;
  evaluationIntervalMs: number;
  degradeRatio: number;
  severeRatio: number;
  upgradeRatio: number;
  degradeStreakRequiredMs: number;
  upgradeStreakRequiredMs: number;
  cooldownMs: number;
  suspensionDeltaMs: number;
  baselineMinMs: number;
  baselineMaxMs: number;
}

export const RUNTIME_QUALITY_PROFILES: Record<RuntimeQualityLevel, RuntimeQualityProfile> = {
  low: {
    level: 'low',
    particleScale: 0.55,
    ambientScale: 0.5,
  },
  balanced: {
    level: 'balanced',
    particleScale: 0.78,
    ambientScale: 0.75,
  },
  full: {
    level: 'full',
    particleScale: 1,
    ambientScale: 1,
  },
};

export const DEFAULT_RUNTIME_QUALITY_CONFIG: RuntimeQualityGovernorConfig = {
  initialLevel: 'full',
  minLevel: 'low',
  maxLevel: 'full',
  sampleWindow: 90,
  warmupSamples: 45,
  evaluationIntervalMs: 500,
  degradeRatio: 1.28,
  severeRatio: 1.65,
  upgradeRatio: 1.08,
  degradeStreakRequiredMs: 900,
  upgradeStreakRequiredMs: 4_500,
  cooldownMs: 2_200,
  suspensionDeltaMs: 80,
  baselineMinMs: 14,
  baselineMaxMs: 34,
};

const LEVELS: RuntimeQualityLevel[] = ['low', 'balanced', 'full'];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function levelIndex(level: RuntimeQualityLevel): number {
  return LEVELS.indexOf(level);
}

/**
 * Presentation-only adaptive quality governor.
 *
 * It learns the device/shell's own frame-time baseline first, so a stable 30 fps Mini App shell is
 * not mistaken for a struggling 60 fps device. Tier changes only alter cosmetic density; gameplay
 * simulation, telegraphs, damage and RNG remain outside this class.
 */
export class RuntimeQualityGovernor {
  private readonly config: RuntimeQualityGovernorConfig;
  private readonly samples: number[];
  private sampleCount = 0;
  private writeIndex = 0;
  private level: RuntimeQualityLevel;
  private baselineFrameMs: number | null = null;
  private lastEvaluationAtMs: number | null = null;
  private lastTierChangeAtMs = Number.NEGATIVE_INFINITY;
  private overBudgetStreakMs = 0;
  private underBudgetStreakMs = 0;
  private ignoredSuspensionFrames = 0;

  constructor(config: Partial<RuntimeQualityGovernorConfig> = {}) {
    this.config = {
      ...DEFAULT_RUNTIME_QUALITY_CONFIG,
      ...config,
    };
    const size = Math.max(20, Math.floor(this.config.sampleWindow));
    this.samples = new Array<number>(size).fill(16.67);
    this.level = this.clampLevel(this.config.initialLevel);
  }

  get profile(): RuntimeQualityProfile {
    return RUNTIME_QUALITY_PROFILES[this.level];
  }

  /**
   * Records one active-gameplay frame. Returns true only when the presentation tier changes.
   * Large background/resume deltas are ignored so tab switches cannot force a quality downgrade.
   */
  recordFrame(frameDeltaMs: number, nowMs: number): boolean {
    if (!Number.isFinite(frameDeltaMs) || frameDeltaMs <= 0) return false;
    const safeNow = Number.isFinite(nowMs) ? Math.max(0, nowMs) : 0;
    if (frameDeltaMs >= this.config.suspensionDeltaMs) {
      this.ignoredSuspensionFrames += 1;
      // Do not let time spent backgrounded count toward upgrade/degrade dwell on the next frame.
      if (this.lastEvaluationAtMs !== null) this.lastEvaluationAtMs = safeNow;
      this.overBudgetStreakMs = 0;
      this.underBudgetStreakMs = 0;
      return false;
    }

    const sample = clamp(frameDeltaMs, 4, this.config.suspensionDeltaMs - 0.001);
    this.samples[this.writeIndex] = sample;
    this.writeIndex = (this.writeIndex + 1) % this.samples.length;
    if (this.sampleCount < this.samples.length) this.sampleCount += 1;

    if (this.baselineFrameMs === null && this.sampleCount >= this.config.warmupSamples) {
      const p50 = this.percentiles().p50;
      this.baselineFrameMs = clamp(
        p50,
        this.config.baselineMinMs,
        this.config.baselineMaxMs
      );
    }

    if (this.lastEvaluationAtMs === null) {
      this.lastEvaluationAtMs = safeNow;
      return false;
    }
    const elapsedSinceEvaluation = Math.max(0, safeNow - this.lastEvaluationAtMs);
    if (elapsedSinceEvaluation < this.config.evaluationIntervalMs) return false;
    this.lastEvaluationAtMs = safeNow;

    if (this.baselineFrameMs === null) return false;

    const { p50, p90, p95 } = this.percentiles();
    const baseline = Math.max(1, this.baselineFrameMs);
    const overBudget = p90 / baseline >= this.config.degradeRatio;
    const severeOverload = p95 / baseline >= this.config.severeRatio;
    const comfortablyUnderBudget =
      p90 / baseline <= this.config.upgradeRatio &&
      p95 / baseline <= Math.max(this.config.upgradeRatio + 0.1, 1.16);

    // A cleaner sustained window may refine an initially pessimistic baseline downward. Never
    // raise the baseline from load; that would teach the governor that jank is normal.
    if (comfortablyUnderBudget && p50 < this.baselineFrameMs) {
      this.baselineFrameMs = clamp(
        this.baselineFrameMs * 0.94 + p50 * 0.06,
        this.config.baselineMinMs,
        this.config.baselineMaxMs
      );
    }

    if (overBudget || severeOverload) {
      this.overBudgetStreakMs += severeOverload
        ? elapsedSinceEvaluation * 1.6
        : elapsedSinceEvaluation;
      this.underBudgetStreakMs = 0;
    } else if (comfortablyUnderBudget) {
      this.underBudgetStreakMs += elapsedSinceEvaluation;
      this.overBudgetStreakMs = Math.max(
        0,
        this.overBudgetStreakMs - elapsedSinceEvaluation * 0.5
      );
    } else {
      this.overBudgetStreakMs = Math.max(
        0,
        this.overBudgetStreakMs - elapsedSinceEvaluation * 0.5
      );
      this.underBudgetStreakMs = Math.max(
        0,
        this.underBudgetStreakMs - elapsedSinceEvaluation * 0.5
      );
    }

    const cooldownRemaining = Math.max(
      0,
      this.config.cooldownMs - (safeNow - this.lastTierChangeAtMs)
    );

    if (
      this.overBudgetStreakMs >= this.config.degradeStreakRequiredMs &&
      levelIndex(this.level) > levelIndex(this.config.minLevel) &&
      (cooldownRemaining <= 0 || severeOverload)
    ) {
      this.level = this.clampLevel(LEVELS[levelIndex(this.level) - 1]);
      this.lastTierChangeAtMs = safeNow;
      this.overBudgetStreakMs = 0;
      this.underBudgetStreakMs = 0;
      return true;
    }

    if (
      this.underBudgetStreakMs >= this.config.upgradeStreakRequiredMs &&
      levelIndex(this.level) < levelIndex(this.config.maxLevel) &&
      cooldownRemaining <= 0
    ) {
      this.level = this.clampLevel(LEVELS[levelIndex(this.level) + 1]);
      this.lastTierChangeAtMs = safeNow;
      this.overBudgetStreakMs = 0;
      this.underBudgetStreakMs = 0;
      return true;
    }

    return false;
  }

  getSnapshot(nowMs = 0): RuntimeQualitySnapshot {
    const { p50, p90, p95 } = this.percentiles();
    const profile = this.profile;
    const cooldownRemainingMs = Math.max(
      0,
      this.config.cooldownMs -
        (Math.max(0, Number.isFinite(nowMs) ? nowMs : 0) - this.lastTierChangeAtMs)
    );
    return {
      ...profile,
      baselineFrameMs: this.baselineFrameMs,
      p50FrameMs: p50,
      p90FrameMs: p90,
      p95FrameMs: p95,
      estimatedFps: 1000 / Math.max(1, p50),
      overBudgetStreakMs: this.overBudgetStreakMs,
      underBudgetStreakMs: this.underBudgetStreakMs,
      cooldownRemainingMs,
      ignoredSuspensionFrames: this.ignoredSuspensionFrames,
    };
  }

  reset(): void {
    this.sampleCount = 0;
    this.writeIndex = 0;
    this.samples.fill(16.67);
    this.level = this.clampLevel(this.config.initialLevel);
    this.baselineFrameMs = null;
    this.lastEvaluationAtMs = null;
    this.lastTierChangeAtMs = Number.NEGATIVE_INFINITY;
    this.overBudgetStreakMs = 0;
    this.underBudgetStreakMs = 0;
    this.ignoredSuspensionFrames = 0;
  }

  private clampLevel(level: RuntimeQualityLevel): RuntimeQualityLevel {
    const min = levelIndex(this.config.minLevel);
    const max = levelIndex(this.config.maxLevel);
    const target = levelIndex(level);
    const lower = Math.min(min, max);
    const upper = Math.max(min, max);
    return LEVELS[clamp(target, lower, upper)] ?? 'low';
  }

  private percentiles(): { p50: number; p90: number; p95: number } {
    if (this.sampleCount === 0) return { p50: 16.67, p90: 16.67, p95: 16.67 };
    const active = this.samples.slice(0, this.sampleCount).sort((a, b) => a - b);
    const pick = (ratio: number) =>
      active[Math.min(active.length - 1, Math.floor((active.length - 1) * ratio))] ??
      16.67;
    return {
      p50: pick(0.5),
      p90: pick(0.9),
      p95: pick(0.95),
    };
  }
}
