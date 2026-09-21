/**
 * Deterministic, side-effect-free math for the adaptive audio foundation.
 *
 * HARD CONTRACT: this module stays pure — no Phaser, no WebAudio, no DOM, no timers, no globals.
 * It is compiled and unit-tested in plain Node (`npm run test:audio`), which is what makes the
 * audio mood reproducible enough to debug on a device without a musical ear in the loop.
 *
 * Nothing in here is allowed to consume gameplay RNG. Gameplay randomness lives in RunRng and its
 * consumption order is part of the deterministic-run contract; audio therefore derives its own
 * non-gameplay stream from the run seed via an independent hash (`pickMusicBedIndex`).
 *
 * Reference note: the asymmetric attack/release smoothing and the "gated mood with separate
 * enter/exit bounds" pattern were informed by the MIT-licensed Wild Haggis Survivors music engine
 * (`src/systems/music/Conductor.ts`, `src/systems/music/musicMath.ts`) as a *design reference*.
 * No donor source code was copied; everything below is written for OFELIYA's own stage model.
 */

export type AdaptiveMood =
  | 'calm'
  | 'pressure'
  | 'danger'
  | 'critical'
  | 'boss'
  | 'transition'
  | 'ended';

export const ADAPTIVE_MOODS: readonly AdaptiveMood[] = [
  'calm',
  'pressure',
  'danger',
  'critical',
  'boss',
  'transition',
  'ended',
];

/** Enemy classes that contribute to nearby pressure. Mirrors config's EnemyKind minus the boss. */
export type ThreatKind = 'swarm' | 'runner' | 'brute' | 'boss';

export interface DangerInput {
  /** Distance-weighted hostile pressure around the player, already normalized to 0..1. */
  nearbyThreat: number;
  /** Player HP as a fraction of the stage maximum (0..1). */
  hpFraction: number;
  bossActive: boolean;
  /** Boss HP fraction (1 when there is no live boss). */
  bossHpFraction: number;
  /** 1-based campaign stage order; used only as a small context bias. */
  stageOrder: number;
}

export interface AdaptiveTuning {
  readonly threatWeight: number;
  readonly hpLossWeight: number;
  readonly bossWeight: number;
  /** Total weighted threat that reads as "fully surrounded". */
  readonly threatSaturation: number;
  readonly scanRadius: number;
  readonly stageBiasPerOrder: number;
  readonly stageBiasMax: number;
  readonly lowHpFraction: number;
  readonly attackTauMs: number;
  readonly releaseTauMs: number;
  readonly updateIntervalMs: number;
  readonly moodDwellMs: number;
  readonly maxStepMs: number;
  readonly criticalEnter: number;
  readonly criticalExit: number;
  readonly dangerEnter: number;
  readonly dangerExit: number;
  readonly pressureEnter: number;
  readonly pressureExit: number;
}

/**
 * Calibrated against the existing stage model (config.JUICE.lowHpFraction = 0.3,
 * WEAPON.range = 380 px, 240-enemy normal cap). The scan radius is intentionally inside the
 * auto-attack range: only enemies that can actually reach the player read as pressure.
 *
 * Band calibration was derived from the reachable danger range of each channel, so every input can
 * actually move the mood on its own:
 *   fully surrounded, full HP   → 0.62  ≈ dangerEnter   (surrounded alone is a danger moment)
 *   low HP alone                → 0.27  → pressure
 *   low HP + half a swarm       → 0.58  → critical (low HP only upgrades near the danger bound)
 *   fresh boss on an empty map  → 0.18  → pressure, and the mood takes `boss` regardless
 *   everything at once          → clamped to 1
 */
export const ADAPTIVE_AUDIO_TUNING: AdaptiveTuning = {
  threatWeight: 0.62,
  hpLossWeight: 0.38,
  bossWeight: 0.3,
  threatSaturation: 24,
  scanRadius: 280,
  stageBiasPerOrder: 0.06,
  stageBiasMax: 0.06,
  lowHpFraction: 0.3,
  attackTauMs: 350,
  releaseTauMs: 2200,
  updateIntervalMs: 120,
  moodDwellMs: 1500,
  maxStepMs: 250,
  criticalEnter: 0.76,
  criticalExit: 0.6,
  dangerEnter: 0.6,
  dangerExit: 0.44,
  pressureEnter: 0.24,
  pressureExit: 0.2,
};

export interface MoodContext {
  bossActive: boolean;
  hpFraction: number;
  sinceChangeMs: number;
  forced: 'transition' | 'ended' | null;
}

export interface AdaptiveMoodStatus {
  mood: AdaptiveMood;
  /** Smoothed danger actually driving the mix (0..1). */
  danger: number;
  /** Instantaneous danger before smoothing (0..1). */
  rawDanger: number;
  transitions: number;
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

/**
 * Per-enemy pressure weight: role cost scaled by proximity inside `scanRadius`.
 * Bosses are excluded (they are modelled explicitly through `bossActive`).
 */
export function enemyThreatWeight(
  kind: ThreatKind,
  elite: boolean,
  distancePx: number,
  scanRadius: number = ADAPTIVE_AUDIO_TUNING.scanRadius
): number {
  if (!Number.isFinite(distancePx) || distancePx < 0) return 0;
  if (scanRadius <= 0 || distancePx >= scanRadius) return 0;
  const base = kind === 'brute' ? 3 : kind === 'runner' ? 1.5 : kind === 'boss' ? 0 : 1;
  const weight = base + (elite ? 7 : 0);
  return weight * (1 - distancePx / scanRadius);
}

export function normalizeNearbyThreat(
  totalWeight: number,
  saturation: number = ADAPTIVE_AUDIO_TUNING.threatSaturation
): number {
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) return 0;
  if (!Number.isFinite(saturation) || saturation <= 0) return 0;
  return clamp01(totalWeight / saturation);
}

/** Weighted danger blend. Deliberately free of any stage-elapsed-time term. */
export function computeDanger(
  input: DangerInput,
  tuning: AdaptiveTuning = ADAPTIVE_AUDIO_TUNING
): number {
  const threat = clamp01(input.nearbyThreat);
  const hpLoss = 1 - clamp01(input.hpFraction);
  const bossPressure = input.bossActive
    ? 0.6 + 0.4 * (1 - clamp01(input.bossHpFraction))
    : 0;
  const stageBias = Math.min(
    tuning.stageBiasMax,
    Math.max(0, input.stageOrder - 1) * tuning.stageBiasPerOrder
  );
  return clamp01(
    tuning.threatWeight * threat +
      tuning.hpLossWeight * hpLoss +
      tuning.bossWeight * bossPressure +
      stageBias
  );
}

/** Frame-rate independent exponential approach. `tauMs` is the 63% time constant. */
export function expApproach(
  current: number,
  target: number,
  dtMs: number,
  tauMs: number
): number {
  if (!Number.isFinite(current)) return Number.isFinite(target) ? target : 0;
  if (!Number.isFinite(target)) return current;
  if (!Number.isFinite(dtMs) || dtMs <= 0 || !Number.isFinite(tauMs) || tauMs <= 0) return current;
  const alpha = 1 - Math.exp(-dtMs / tauMs);
  return current + (target - current) * alpha;
}

/**
 * Asymmetric smoothing: danger rises fast (attack) and falls slowly (release) so a momentary
 * lull between waves can never yank the mix, and a real swarm arrival is heard immediately.
 */
export function smoothDanger(
  current: number,
  target: number,
  dtMs: number,
  tuning: AdaptiveTuning = ADAPTIVE_AUDIO_TUNING
): number {
  const tau = target >= current ? tuning.attackTauMs : tuning.releaseTauMs;
  return clamp01(expApproach(current, target, dtMs, tau));
}

export function moodRank(mood: AdaptiveMood): number {
  switch (mood) {
    case 'calm':
      return 0;
    case 'pressure':
      return 1;
    case 'danger':
    case 'boss':
    case 'transition':
      return 2;
    case 'critical':
    case 'ended':
      return 3;
    default:
      return 0;
  }
}

/**
 * Pure mood transition. Hysteresis has three parts:
 *  1. separate enter/exit bounds per band;
 *  2. a "hold" rule that keeps the current band while its exit bound still holds — but never
 *     blocks escalation (a swarm arriving mid-lull still upgrades immediately);
 *  3. a minimum dwell time that blocks *downgrades* only.
 */
export function nextAdaptiveMood(
  current: AdaptiveMood,
  danger: number,
  context: MoodContext,
  tuning: AdaptiveTuning = ADAPTIVE_AUDIO_TUNING
): AdaptiveMood {
  if (context.forced) return context.forced;

  const d = clamp01(danger);
  const lowHp = clamp01(context.hpFraction) <= tuning.lowHpFraction;

  const enterCritical = d >= tuning.criticalEnter || (lowHp && d >= tuning.dangerExit);
  const escalation: AdaptiveMood = enterCritical
    ? 'critical'
    : context.bossActive
      ? 'boss'
      : d >= tuning.dangerEnter
        ? 'danger'
        : d >= tuning.pressureEnter
          ? 'pressure'
          : 'calm';

  const held: AdaptiveMood | null =
    current === 'critical'
      ? d >= tuning.criticalExit || lowHp
        ? 'critical'
        : null
      : current === 'boss'
        ? context.bossActive
          ? 'boss'
          : null
        : current === 'danger'
          ? d >= tuning.dangerExit
            ? 'danger'
            : null
          : current === 'pressure'
            ? d >= tuning.pressureExit
              ? 'pressure'
              : null
            : null;

  const candidate: AdaptiveMood =
    held !== null && moodRank(held) >= moodRank(escalation) ? held : escalation;

  if (moodRank(candidate) < moodRank(current) && context.sinceChangeMs < tuning.moodDwellMs) {
    return current;
  }
  return candidate;
}

/**
 * Deterministic bed choice. Uses an independent FNV-1a hash of the run seed, so the same run
 * always gets the same bed and audio never touches RunRng's gameplay consumption order.
 */
export function pickMusicBedIndex(seed: string, trackCount: number): number {
  if (!Number.isFinite(trackCount) || trackCount <= 0) return 0;
  const source = `${seed}:ofeliya-adaptive-audio-bed`;
  let h = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) {
    h ^= source.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % Math.floor(trackCount);
}

const MOOD_TENSION: Record<AdaptiveMood, number> = {
  calm: 0.12,
  pressure: 0.38,
  danger: 0.66,
  critical: 0.95,
  boss: 0.86,
  transition: 0.22,
  ended: 0.18,
};

const MOOD_BIO_FLOOR: Record<AdaptiveMood, number> = {
  calm: 0,
  pressure: 0.28,
  danger: 0.58,
  critical: 0.9,
  boss: 0.8,
  transition: 0.12,
  ended: 0,
};

/** 0..1 lowpass openness for the music bus: closed/calm → open/aggressive. */
export function tensionForMood(
  mood: AdaptiveMood,
  danger: number,
  _tuning: AdaptiveTuning = ADAPTIVE_AUDIO_TUNING
): number {
  return clamp01(MOOD_TENSION[mood] * 0.75 + clamp01(danger) * 0.25);
}

/** 0..1 bio-pulse intensity: danger-driven with a floor so each mood stays legible. */
export function bioIntensityForMood(
  mood: AdaptiveMood,
  danger: number,
  tuning: AdaptiveTuning = ADAPTIVE_AUDIO_TUNING
): number {
  return clamp01(Math.max(clamp01(danger), MOOD_BIO_FLOOR[mood]));
}

/**
 * Pure mood tracker: the whole adaptive state model, with no audio side effects attached.
 * `AdaptiveAudioDirector` owns one of these and forwards its output to the audio sink.
 */
export class AdaptiveMoodTracker {
  private mood: AdaptiveMood = 'calm';
  private smoothed = 0;
  private raw = 0;
  private elapsedMs = 0;
  private lastEvalMs = 0;
  private moodSinceMs = 0;
  private transitionCount = 0;
  private forced: 'transition' | 'ended' | null = null;

  constructor(private readonly tuning: AdaptiveTuning = ADAPTIVE_AUDIO_TUNING) {}

  reset(): void {
    this.mood = 'calm';
    this.smoothed = 0;
    this.raw = 0;
    this.elapsedMs = 0;
    this.lastEvalMs = 0;
    this.moodSinceMs = 0;
    this.transitionCount = 0;
    this.forced = null;
  }

  /** Stage transitions are a frozen transaction: hold the mood until `releaseTransition`. */
  holdTransition(): void {
    this.applyForced('transition');
  }

  releaseTransition(): void {
    if (this.forced !== 'transition') return;
    this.forced = null;
    this.moodSinceMs = this.elapsedMs;
  }

  forceEnded(): void {
    this.applyForced('ended');
  }

  private applyForced(mood: 'transition' | 'ended'): void {
    this.forced = mood;
    if (this.mood !== mood) {
      this.mood = mood;
      this.moodSinceMs = this.elapsedMs;
      this.transitionCount += 1;
    }
  }

  /**
   * Feed one frame. Safe to call every frame: evaluation is throttled internally while the
   * smoothing itself stays frame-rate independent.
   */
  update(input: DangerInput, dtMs: number): void {
    const dt = Number.isFinite(dtMs) ? Math.max(0, Math.min(dtMs, this.tuning.maxStepMs)) : 0;
    this.elapsedMs += dt;
    this.raw = computeDanger(input, this.tuning);
    this.smoothed = smoothDanger(this.smoothed, this.raw, dt, this.tuning);

    if (
      this.forced !== null ||
      this.elapsedMs - this.lastEvalMs >= this.tuning.updateIntervalMs ||
      this.lastEvalMs === 0
    ) {
      this.lastEvalMs = this.elapsedMs;
      const next = nextAdaptiveMood(
        this.mood,
        this.smoothed,
        {
          bossActive: input.bossActive,
          hpFraction: input.hpFraction,
          sinceChangeMs: this.elapsedMs - this.moodSinceMs,
          forced: this.forced,
        },
        this.tuning
      );
      if (next !== this.mood) {
        this.mood = next;
        this.moodSinceMs = this.elapsedMs;
        this.transitionCount += 1;
      }
    }
  }

  get currentMood(): AdaptiveMood {
    return this.mood;
  }

  get status(): AdaptiveMoodStatus {
    return {
      mood: this.mood,
      danger: this.smoothed,
      rawDanger: this.raw,
      transitions: this.transitionCount,
    };
  }
}
