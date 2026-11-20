/**
 * C+ v4 audio director — an opt-in alternative bed set for QA sessions.
 *
 * Ownership rules (same contract as `AdaptiveAudioDirector`):
 *
 *  - `StageDirector` stays the lifecycle authority; this module only consumes
 *    its events.
 *  - `Sfx` stays the owner of the audio graph. This module never touches
 *    WebAudio: it asks the sink for a bed and the sink calls `Sfx`.
 *  - The production adaptive system (`AdaptiveAudioDirector`) is untouched.
 *    In a C+ session it keeps doing what it already does — danger-driven
 *    tension filter, ducking, procedural bio pulse, cue stingers — and only
 *    the *bed* is replaced.
 *
 * Why the beds live here instead of inside `AdaptiveAudioDirector`:
 * the boss music needs new switching triggers (boss spawn / boss clear), and
 * the production director deliberately keeps one bed per act. Rewriting it
 * would put the running game at risk for a feature that is still under
 * evaluation, so the new behaviour is an isolated module behind an explicit
 * opt-in.
 */

import { Sfx } from './Sfx';
import { SfxAdaptiveSink } from './SfxAdaptiveSink';
import type { AdaptiveAudioSink, AdaptiveCueKind, HeartbeatCueKind } from './AdaptiveAudioDirector';
import {
  cPlusEnabled,
  planCPlusBed,
  type CPlusBedRole,
  type CPlusMusicState,
} from './cplusAudioMath';

/** Everything the C+ director is allowed to ask the audio graph to do. */
export interface CPlusAudioSink {
  /** Cross-fade a bed in. `fadeMs` = 0 starts it immediately. */
  bedStart(role: CPlusBedRole, fadeMs: number): void;
  /** Release the C+ bed and every node it owns. */
  bedStop(): void;
  /** Play a one-shot run-end stinger over the current mix. */
  stinger(role: CPlusBedRole): void;
}

/** Sink backed by the real `Sfx` graph. */
export class SfxCPlusSink implements CPlusAudioSink {
  bedStart(role: CPlusBedRole, fadeMs: number): void {
    Sfx.startCPlusBed(role, fadeMs);
  }

  bedStop(): void {
    Sfx.stopCPlusBed();
  }

  stinger(role: CPlusBedRole): void {
    Sfx.playCPlusStinger(role);
  }
}

/**
 * Adaptive sink for a C+ session.
 *
 * Everything the production director does — danger-driven tension, ducking,
 * the procedural bio pulse, cue stingers — is forwarded untouched. Only the
 * *bed* is suppressed: in a C+ session the C+ beds own the music slot, so the
 * licensed CC0 bed must not load and must not sound together with them.
 */
export class CPlusAdaptiveSink implements AdaptiveAudioSink {
  constructor(private readonly inner: SfxAdaptiveSink = new SfxAdaptiveSink()) {}

  /** The C+ director owns the bed; the production bed never starts. */
  bedStart(_bedIndex: number): void {
    /* intentionally empty */
  }

  bedStop(): void {
    this.inner.bedStop();
  }

  bioPulse(intensity01: number): void {
    this.inner.bioPulse(intensity01);
  }

  setBioCadence(cadenceMs: number): void {
    this.inner.setBioCadence(cadenceMs);
  }

  setTension(tension01: number): void {
    this.inner.setTension(tension01);
  }

  duck(depth01: number, holdMs: number): void {
    this.inner.duck(depth01, holdMs);
  }

  cue(kind: AdaptiveCueKind): void {
    this.inner.cue(kind);
  }

  heartbeat(kind: HeartbeatCueKind, bossActive: boolean): void {
    this.inner.heartbeat(kind, bossActive);
  }

  setSuspended(suspended: boolean): void {
    this.inner.setSuspended(suspended);
  }

  isMuted(): boolean {
    return this.inner.isMuted();
  }
}

export interface CPlusAudioDirectorOptions {
  sink?: CPlusAudioSink;
  /** Force the mode on/off. `undefined` reads the URL/localStorage flag. */
  enabled?: boolean;
}

export class CPlusAudioDirector {
  private readonly sink: CPlusAudioSink;
  private readonly enabled: boolean;
  private role: CPlusBedRole | null = null;
  private state: CPlusMusicState = 'bloodstream';
  private running = false;

  constructor(options: CPlusAudioDirectorOptions = {}) {
    this.sink = options.sink ?? new SfxCPlusSink();
    this.enabled = options.enabled ?? cPlusEnabled();
  }

  /** Whether this session uses the C+ beds at all. */
  get active(): boolean {
    return this.enabled;
  }

  /** Begin a run: the act-I bed. */
  start(stageOrder: number): void {
    if (!this.enabled) return;
    this.running = true;
    this.apply({ kind: 'run-start', stageOrder });
  }

  /** Stage started (including the first stage of a run). */
  setStage(stageOrder: number): void {
    if (!this.enabled || !this.running) return;
    this.apply({ kind: 'act-change', stageOrder });
  }

  /** The stage boss spawned: switch to that boss's bed. */
  onBossSpawn(stageId: string): void {
    if (!this.enabled || !this.running) return;
    this.apply({ kind: 'boss-spawn', stageId });
  }

  /** The boss is gone: fall back to the act bed of the current stage. */
  onBossClear(stageOrder: number): void {
    if (!this.enabled || !this.running) return;
    this.apply({ kind: 'boss-clear', stageOrder });
  }

  /** Run end: play the result stinger over the ducked bed. */
  onRunEnd(win: boolean): void {
    if (!this.enabled || !this.running) return;
    this.apply({ kind: 'run-end', win });
  }

  /** Teardown: release the bed. */
  stop(): void {
    if (!this.enabled) return;
    this.running = false;
    this.role = null;
    this.sink.bedStop();
  }

  get debugState(): {
    enabled: boolean;
    running: boolean;
    role: CPlusBedRole | null;
    state: CPlusMusicState;
  } {
    return { enabled: this.enabled, running: this.running, role: this.role, state: this.state };
  }

  private apply(
    event:
      | { readonly kind: 'run-start'; readonly stageOrder: number }
      | { readonly kind: 'act-change'; readonly stageOrder: number }
      | { readonly kind: 'boss-spawn'; readonly stageId: string }
      | { readonly kind: 'boss-clear'; readonly stageOrder: number }
      | { readonly kind: 'run-end'; readonly win: boolean }
  ): void {
    const plan = planCPlusBed(this.role, event);
    if (!plan) {
      this.state = this.nextState(event);
      return;
    }
    this.role = plan.role;
    this.state = this.nextState(event);
    if (plan.reason === 'run-end') {
      this.sink.stinger(plan.role);
      return;
    }
    this.sink.bedStart(plan.role, plan.fadeMs);
  }

  private nextState(
    event:
      | { readonly kind: 'run-start'; readonly stageOrder: number }
      | { readonly kind: 'act-change'; readonly stageOrder: number }
      | { readonly kind: 'boss-spawn'; readonly stageId: string }
      | { readonly kind: 'boss-clear'; readonly stageOrder: number }
      | { readonly kind: 'run-end'; readonly win: boolean }
  ): CPlusMusicState {
    switch (event.kind) {
      case 'run-start':
      case 'act-change':
      case 'boss-clear':
        return event.stageOrder >= 2 ? 'heart' : 'bloodstream';
      case 'boss-spawn':
        return event.stageId === 'heart'
          ? 'cardiac-titan'
          : event.stageId === 'bloodstream'
            ? 'immune-prime'
            : this.state;
      case 'run-end':
        return 'ended';
      default:
        return this.state;
    }
  }
}
