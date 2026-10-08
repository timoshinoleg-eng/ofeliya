import {
  ADAPTIVE_AUDIO_TUNING,
  AdaptiveMoodTracker,
  bioIntensityForMood,
  pickMusicBedIndexForStage,
  tensionForMood,
  type AdaptiveMood,
  type AdaptiveTuning,
  type DangerInput,
} from './adaptiveAudioMath';

/**
 * Adaptive audio director: an *observer* of gameplay, never an authority.
 *
 * Ownership rules (mirrors the existing "Phaser systems react to returned events" contract):
 *  - `StageDirector` stays the lifecycle authority; this class only consumes its events.
 *  - `Gameplay audio graph ownership` stays in `Sfx` (one AudioContext, mute, user-gesture unlock).
 *    The director talks to a narrow `AdaptiveAudioSink`, which `SfxAdaptiveSink` implements.
 *  - The director itself has no Phaser/WebAudio dependency, so its state model is unit-testable
 *    in plain Node.
 *
 * Music rule: each act keeps ONE deterministic bed chosen from an act-specific pool
 * (`MUSIC_BED_POOLS` in `adaptiveAudioMath`): a Bloodstream pick for act I and a darker
 * Heart pick for act II, both derived from the run seed. OFELIYA's CC0 loops have no proven
 * musical compatibility for mid-run crossfading, so tension stays on the same bed (lowpass
 * openness, gain ducking) plus procedural layers/cues; the act switch at the organ
 * transition is the only sanctioned bed change, and it rides the existing clean-restart path.
 */

export type AdaptiveCueKind =
  | 'stage-start'
  | 'boss-warning'
  | 'boss-spawn'
  | 'stage-transition'
  | 'victory'
  | 'defeat';

export type HeartbeatCueKind = 'telegraph' | 'impact';

/** Everything the director is allowed to do to the audio graph. */
export interface AdaptiveAudioSink {
  /** Start the deterministic run bed (index into the licensed music set). */
  bedStart(bedIndex: number): void;
  /** Stop the bed and release every director-owned node. */
  bedStop(): void;
  /** Drive the existing bio-pulse ambience from danger rather than stage elapsed time. */
  bioPulse(intensity01: number): void;
  /** Optional organ cadence for the bio pulse (0 = derive cadence from intensity). */
  setBioCadence(cadenceMs: number): void;
  /** 0..1 music-bus openness (lowpass). */
  setTension(tension01: number): void;
  /** Temporary music gain reduction, 0..1 depth, for the given hold time. */
  duck(depth01: number, holdMs: number): void;
  /** Short procedural stinger. Must never introduce a new music bed. */
  cue(kind: AdaptiveCueKind): void;
  /** Event-driven heartbeat layer, fired on the real heartbeat telegraph/impact events. */
  heartbeat(kind: HeartbeatCueKind, bossActive: boolean): void;
  /** AudioContext suspend/resume for document visibility. */
  setSuspended(suspended: boolean): void;
  /** Mirrors `Sfx.muted` so the director can skip scheduling while muted. */
  isMuted(): boolean;
}

export interface AdaptiveVisibilityTarget {
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
  readonly hidden?: boolean;
}

export interface AdaptiveAudioDirectorOptions {
  /** Number of licensed beds available (`MUSIC_TRACK_COUNT`). */
  bedCount: number;
  tuning?: AdaptiveTuning;
  /** Defaults to `document` when available; pass a stub in tests. */
  visibility?: AdaptiveVisibilityTarget | null;
}

export class AdaptiveAudioDirector {
  private readonly tracker: AdaptiveMoodTracker;
  private readonly bedding: number;
  private readonly visibility: AdaptiveVisibilityTarget | null;

  private bedIndex = 0;
  private runSeed = '';
  private stageOrder = 1;
  private heartbeatMs = 0;
  private running = false;
  private suspended = false;
  private visibilityBound = false;
  private lastInput: DangerInput = {
    nearbyThreat: 0,
    hpFraction: 1,
    bossActive: false,
    bossHpFraction: 1,
    stageOrder: 1,
  };

  private readonly onVisibilityChange = (): void => {
    this.setSuspended(this.visibility?.hidden === true);
  };

  constructor(
    private readonly sink: AdaptiveAudioSink,
    options: AdaptiveAudioDirectorOptions
  ) {
    this.tracker = new AdaptiveMoodTracker(options.tuning ?? ADAPTIVE_AUDIO_TUNING);
    this.bedding = Math.max(1, Math.floor(options.bedCount) || 1);
    this.visibility =
      options.visibility === undefined
        ? ((globalThis as { document?: AdaptiveVisibilityTarget }).document ?? null)
        : options.visibility;
  }

  /** Begin a run: deterministic act-I bed for this run seed, nothing else changes. */
  start(runSeed: string, stageOrder: number, heartbeatMs: number): void {
    this.runSeed = typeof runSeed === 'string' && runSeed.length > 0 ? runSeed : 'ofeliya';
    this.bedIndex = pickMusicBedIndexForStage(this.runSeed, stageOrder, this.bedding);
    this.tracker.reset();
    this.running = true;
    this.suspended = false;
    this.stageOrder = stageOrder;
    this.heartbeatMs = heartbeatMs;
    this.lastInput = { ...this.lastInput, stageOrder };
    this.sink.bedStart(this.bedIndex);
    this.sink.setBioCadence(heartbeatMs);
    this.bindVisibility();
  }

  /**
   * Stage-started (including the first stage of a run). Releases any transition hold.
   * An act change (Bloodstream -> Heart) is the one sanctioned bed switch: the new bed is
   * deterministically derived from the same run seed, and the transition duck/stinger
   * has already fired from `onStageTransition`.
   */
  setStage(stageOrder: number, heartbeatMs: number): void {
    this.stageOrder = stageOrder;
    this.heartbeatMs = heartbeatMs;
    this.lastInput = { ...this.lastInput, stageOrder };
    this.tracker.releaseTransition();
    const nextBed = pickMusicBedIndexForStage(this.runSeed, stageOrder, this.bedding);
    if (nextBed !== this.bedIndex) {
      this.bedIndex = nextBed;
      this.sink.bedStart(nextBed);
    }
    this.sink.setBioCadence(heartbeatMs);
    this.sink.cue('stage-start');
  }

  /** Throttled danger update. Safe to call every frame; the caller also throttles the scan. */
  update(input: DangerInput, dtMs: number): void {
    this.lastInput = input;
    this.tracker.update(input, dtMs);
    const status = this.tracker.status;
    if (this.sink.isMuted()) return;
    this.sink.bioPulse(bioIntensityForMood(status.mood, status.danger));
    this.sink.setTension(tensionForMood(status.mood, status.danger));
  }

  /** `boss-warning` — distinct riser + temporary bed dip, before the boss exists. */
  onBossWarning(): void {
    if (this.sink.isMuted()) return;
    this.sink.duck(0.4, 1800);
    this.sink.cue('boss-warning');
  }

  /** `boss-spawn-requested` — hard impact cue and instant tension, still on the same bed. */
  onBossSpawn(): void {
    if (this.sink.isMuted()) return;
    this.sink.duck(0.55, 700);
    this.sink.cue('boss-spawn');
    this.sink.setTension(tensionForMood('boss', 1));
  }

  /** `stage-transition-requested` — frozen transaction: hold mood, duck, stinger. */
  onStageTransition(): void {
    this.tracker.holdTransition();
    if (this.sink.isMuted()) return;
    this.sink.duck(0.6, 2200);
    this.sink.cue('stage-transition');
    this.sink.setTension(tensionForMood('transition', 0));
  }

  /**
   * Heartbeat telegraph/impact. Fired from the real `HeartbeatPulseDirector` events, so the layer
   * is aligned with the existing gameplay timing instead of guessing at a rhythm.
   */
  onHeartbeat(kind: HeartbeatCueKind, bossActive: boolean): void {
    if (this.sink.isMuted()) return;
    if (kind === 'impact') this.sink.duck(0.22, 240);
    this.sink.heartbeat(kind, bossActive);
  }

  /** `run-ended` — terminal mood, deep duck so the result stinger reads. */
  onRunEnd(win: boolean): void {
    this.tracker.forceEnded();
    if (this.sink.isMuted()) return;
    this.sink.duck(0.6, 30_000);
    this.sink.cue(win ? 'victory' : 'defeat');
  }

  /** Full teardown: detach the visibility listener and release every director-owned node. */
  stop(): void {
    this.unbindVisibility();
    this.running = false;
    this.suspended = false;
    this.sink.setSuspended(false);
    this.sink.bioPulse(0);
    this.sink.setBioCadence(0);
    this.sink.bedStop();
    this.tracker.reset();
  }

  private setSuspended(suspended: boolean): void {
    if (!this.running || this.suspended === suspended) return;
    this.suspended = suspended;
    this.sink.setSuspended(suspended);
  }

  private bindVisibility(): void {
    if (this.visibilityBound || !this.visibility) return;
    this.visibility.addEventListener('visibilitychange', this.onVisibilityChange);
    this.visibilityBound = true;
  }

  private unbindVisibility(): void {
    if (!this.visibilityBound || !this.visibility) return;
    this.visibility.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.visibilityBound = false;
  }

  get mood(): AdaptiveMood {
    return this.tracker.currentMood;
  }

  get debugState(): {
    mood: AdaptiveMood;
    danger: number;
    rawDanger: number;
    transitions: number;
    bed: number;
    stageOrder: number;
    running: boolean;
    suspended: boolean;
    lastInput: DangerInput;
  } {
    const status = this.tracker.status;
    return {
      mood: status.mood,
      danger: Number(status.danger.toFixed(4)),
      rawDanger: Number(status.rawDanger.toFixed(4)),
      transitions: status.transitions,
      bed: this.bedIndex,
      stageOrder: this.stageOrder,
      running: this.running,
      suspended: this.suspended,
      lastInput: this.lastInput,
    };
  }
}
