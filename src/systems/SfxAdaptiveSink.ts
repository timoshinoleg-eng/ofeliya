import { Sfx } from './Sfx';
import type {
  AdaptiveAudioSink,
  AdaptiveCueKind,
  HeartbeatCueKind,
} from './AdaptiveAudioDirector';

/**
 * Thin adapter between the decision layer and the audio graph.
 *
 * `AdaptiveAudioDirector` owns *when*; `Sfx` owns *how* (single AudioContext, mute state,
 * user-gesture unlock, node lifetime). Keeping the adapter this dumb is what makes the director
 * unit-testable with a fake sink in plain Node.
 */
export class SfxAdaptiveSink implements AdaptiveAudioSink {
  bedStart(bedIndex: number): void {
    Sfx.startBed(bedIndex);
  }

  bedStop(): void {
    Sfx.stopMusic();
  }

  bioPulse(intensity01: number): void {
    Sfx.setRunIntensity(intensity01);
  }

  setBioCadence(cadenceMs: number): void {
    Sfx.setBioCadence(cadenceMs);
  }

  setTension(tension01: number): void {
    Sfx.setMusicTension(tension01);
  }

  duck(depth01: number, holdMs: number): void {
    Sfx.duckMusic(depth01, holdMs);
  }

  cue(kind: AdaptiveCueKind): void {
    Sfx.playCue(kind);
  }

  heartbeat(kind: HeartbeatCueKind, bossActive: boolean): void {
    Sfx.playHeartbeat(kind, bossActive);
  }

  setSuspended(suspended: boolean): void {
    Sfx.setSuspended(suspended);
  }

  isMuted(): boolean {
    return Sfx.muted;
  }
}
