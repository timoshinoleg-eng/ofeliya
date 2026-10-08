// Audio: CC0 samples/music plus a lightweight procedural biological ambience layer.
// SFX — Kenney CC0. Music — OpenGameArt CC0 Music. Binary assets stay outside the JS bundle.
//
// This module owns the single game AudioContext and every long-lived audio node. The adaptive
// audio foundation (`AdaptiveAudioDirector`) is a decision layer only: it drives this module
// through `SfxAdaptiveSink`, so mute, user-gesture unlock and node ownership stay in one place.

import { SaveSystem } from './SaveSystem';
import { RELEASE_SHA } from '../release';
import type { AdaptiveCueKind, HeartbeatCueKind } from './AdaptiveAudioDirector';
import {
  MASTER_GAIN, MUSIC_GAIN, MUSIC_BED_TRIMS, SFX_ROLE_GAINS,
  scanNormalizationTrim, musicGainForDuck,
} from './audioMixMath';

export type SfxName =
  | 'shoot' | 'hit' | 'pickup' | 'pickup2' | 'pickup3' | 'levelup' | 'hurt' | 'click'
  | 'nova' | 'elite' | 'boss' | 'bossphase' | 'gameover' | 'victory'
  | 'infect' | 'lysis';

const THROTTLE_MS: Partial<Record<SfxName, number>> = {
  shoot: 70, hit: 55, pickup: 45, pickup2: 45, pickup3: 45, infect: 140, lysis: 200,
};
const BASE: string = import.meta.env.BASE_URL || './';

function audioAssetUrl(file: string): string {
  const separator = file.includes('?') ? '&' : '?';
  return `${BASE}${file}${separator}v=${encodeURIComponent(RELEASE_SHA)}`;
}

const MANIFEST: Record<SfxName, { file: string }> = {
  shoot: { file: 'audio/sfx/shoot.ogg' },
  hit: { file: 'audio/sfx/hit.ogg' },
  pickup: { file: 'audio/sfx/pickup.ogg' },
  pickup2: { file: 'audio/sfx/pickup2.mp3' },
  pickup3: { file: 'audio/sfx/pickup3.mp3' },
  levelup: { file: 'audio/sfx/levelup.ogg' },
  hurt: { file: 'audio/sfx/hurt.ogg' },
  click: { file: 'audio/sfx/click.ogg' },
  nova: { file: 'audio/sfx/nova.ogg' },
  elite: { file: 'audio/sfx/elite.ogg' },
  boss: { file: 'audio/sfx/boss.ogg' },
  bossphase: { file: 'audio/sfx/bossphase.mp3' },
  gameover: { file: 'audio/sfx/gameover.ogg' },
  victory: { file: 'audio/sfx/victory.ogg' },
  infect: { file: 'audio/sfx/infect.mp3' },
  lysis: { file: 'audio/sfx/lysis.mp3' },
};
const PICKUP_VARIANTS: readonly SfxName[] = ['pickup', 'pickup2', 'pickup3'];
const MUSIC_TRACKS = [
  'audio/music/loop0.ogg', 'audio/music/loop1.ogg', 'audio/music/loop2.ogg',
  'audio/music/loop3.mp3', 'audio/music/loop4.mp3', 'audio/music/loop5.mp3', 'audio/music/loop6.mp3',
];

/** Licensed bed count, consumed by the adaptive director for deterministic bed selection. */
export const MUSIC_TRACK_COUNT = MUSIC_TRACKS.length;

const MUSIC_TENSION_MIN_HZ = 2_500;
const MUSIC_TENSION_MAX_HZ = 14_000;
/** Neutral openness used when no director is driving the bus (mute/unmute, run teardown). */
const MUSIC_TENSION_NEUTRAL = 0.12;

class SfxImpl {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  /** Licensed bed loudness correction only; adaptive ducking remains on musicGain. */
  private bedTrim: GainNode | null = null;
  /** Lowpass that the adaptive director opens as danger rises. */
  private musicFilter: BiquadFilterNode | null = null;
  /** Procedural stingers/heartbeat share the filter; the retained bio pulse feeds master. */
  private layerBus: GainNode | null = null;
  private lastAt: Partial<Record<SfxName, number>> = {};
  private pickupCursor = 0;
  private buffers: Partial<Record<SfxName, AudioBuffer>> = {};
  private bufferTrims: Partial<Record<SfxName, number>> = {};
  private loading: Partial<Record<SfxName, Promise<AudioBuffer | null>>> = {};
  private musicSrc: AudioBufferSourceNode | null = null;
  private musicBuf: AudioBuffer | null = null;
  private musicAbort: AbortController | null = null;
  private musicRequestId = 0;
  private musicWanted = false;
  /** Retained even before context creation; hidden pages must never be gesture-resumed. */
  private suspended = typeof document !== 'undefined' && document.hidden === true;
  /** Deduplicates WebAudio resume attempts across SFX/music during WebView lifecycle changes. */
  private audioResume: Promise<boolean> | null = null;
  /** One-shot user-gesture retry used when MAX/Android suspends WebAudio around video playback. */
  private musicUnlockHandler: (() => void) | null = null;
  private lastMusicError: string | null = null;
  /** Deterministic bed index. Replaces the previous per-lifecycle `Math.random()` track pick. */
  private bedIndex = 0;
  private actualBedIndex: number | null = null;
  private musicTension = MUSIC_TENSION_NEUTRAL;
  private layerTones = new Set<() => void>();

  // One persistent oscillator is cheaper than spawning heartbeat nodes every beat. Gain remains
  // virtually silent between pulses; setRunIntensity only schedules a short envelope.
  private bioOsc: OscillatorNode | null = null;
  private bioGain: GainNode | null = null;
  private lastBioPulseAt = -1e9;
  private runIntensity = 0;
  /** Organ-locked bio cadence (Heart stage). 0 = derive the cadence from intensity. */
  private bioCadenceMs = 0;

  muted = SaveSystem.get().muted;

  setMuted(m: boolean): void {
    this.muted = m;
    SaveSystem.update({ muted: m });
    this.applyGain();
    if (m) {
      this.stopBioAmbience();
      this.resetMusicDuck();
      this.disarmMusicUnlockRetry();
      if (!this.musicSrc) this.cancelMusicLoad();
    } else if (this.musicWanted) {
      this.startMusic();
      this.ensureBioAmbience();
    }
  }

  toggle(): boolean { this.setMuted(!this.muted); return this.muted; }

  /**
   * 0..1 tension. Safe to call every frame.
   *
   * Driven by real danger (nearby hostile pressure, HP loss, boss state) from
   * `AdaptiveAudioDirector` — not by stage elapsed time.
   */
  setRunIntensity(intensity: number): void {
    this.runIntensity = Math.max(0, Math.min(1, intensity));
    if (!this.musicWanted || this.muted) return;
    this.ensureBioAmbience();
    const ctx = this.ctx;
    const gain = this.bioGain;
    if (!ctx || !gain) return;

    const nowMs = performance.now();
    const beatEveryMs = this.bioCadenceMs > 0 ? this.bioCadenceMs : 920 - this.runIntensity * 410;
    if (nowMs - this.lastBioPulseAt < beatEveryMs) return;
    this.lastBioPulseAt = nowMs;

    const t = ctx.currentTime;
    const peak = 0.018 + this.runIntensity * 0.026;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    gain.gain.exponentialRampToValueAtTime(peak * 0.5, t + 0.21);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
  }

  /**
   * Lock the bio pulse to an organ rhythm (Heart: `theme.heartbeatMs`), or 0 to derive it from
   * danger. Presentation only: no gameplay timing is read or changed.
   */
  setBioCadence(cadenceMs: number): void {
    this.bioCadenceMs = Number.isFinite(cadenceMs) && cadenceMs > 0
      ? Math.max(300, Math.min(3000, cadenceMs))
      : 0;
    this.lastBioPulseAt = -1e9;
  }

  /** 0..1 music-bus openness: closed/calm → open/aggressive. */
  setMusicTension(tension: number): void {
    const value = Math.max(0, Math.min(1, Number.isFinite(tension) ? tension : 0));
    this.musicTension = value;
    const ctx = this.ctx;
    const filter = this.musicFilter;
    if (!ctx || !filter) return;
    const hz = MUSIC_TENSION_MIN_HZ * Math.pow(MUSIC_TENSION_MAX_HZ / MUSIC_TENSION_MIN_HZ, value);
    try {
      filter.frequency.setTargetAtTime(hz, ctx.currentTime, 0.25);
    } catch {
      /* Node already released during teardown. */
    }
  }

  /** Temporary music gain reduction to let stingers/heartbeat read. */
  duckMusic(depth: number, holdMs: number): void {
    const ctx = this.ctx;
    const gain = this.musicGain;
    if (!ctx || !gain) return;
    const hold = Number.isFinite(holdMs) ? Math.max(0, holdMs) / 1000 : 0;
    const target = musicGainForDuck(depth);
    const t = ctx.currentTime;
    try {
      gain.gain.cancelScheduledValues(t);
      gain.gain.setTargetAtTime(target, t, 0.08);
      gain.gain.setTargetAtTime(MUSIC_GAIN, t + Math.max(0.05, hold), 0.35);
    } catch {
      /* Node already released during teardown. */
    }
  }

  private resetMusicDuck(): void {
    const ctx = this.ctx;
    const gain = this.musicGain;
    if (!ctx || !gain) return;
    try {
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setValueAtTime(MUSIC_GAIN, ctx.currentTime);
    } catch {
      /* no-op */
    }
  }

  /** Document-visibility suspend. A visible WebView also retries a blocked music bed. */
  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
    // A director teardown may call false while the document is still hidden.
    if (this.isSuspended()) this.disarmMusicUnlockRetry();
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.isSuspended()) {
      try {
        void ctx.suspend().catch(() => {});
      } catch {
        /* WebViews can reject suspend during teardown. */
      }
      return;
    }
    void this.resumeAudioContext().then((running) => {
      if (!this.musicWanted || this.muted || this.isSuspended()) return;
      if (running) { this.ensureBioAmbience(); this.startMusic(); }
      else this.armMusicUnlockRetry();
    });
  }

  /** Deterministic run bed. Same run seed → same bed; never a random per-lifecycle pick. */
  startBed(index: number): void {
    this.setBedIndex(index);
    this.setMusicTension(MUSIC_TENSION_NEUTRAL);
    this.resetMusicDuck();
    this.startMusic();
  }

  private setBedIndex(index: number): void {
    const next = Math.max(0, Math.min(MUSIC_TRACK_COUNT - 1, Math.floor(index) || 0));
    if (next === this.bedIndex) return;
    this.bedIndex = next;
    // A bed change only happens at run start, so a clean restart is correct and cheap.
    this.stopCurrentMusicSource();
    this.musicBuf = null;
    this.actualBedIndex = null;
    this.cancelMusicLoad();
  }

  private applyGain(): void { if (this.master) this.master.gain.value = this.muted ? 0 : MASTER_GAIN; }

  private isSuspended(): boolean {
    return this.suspended || (typeof document !== 'undefined' && document.hidden === true);
  }

  /** Safe, immutable mix/lifecycle snapshot; no platform identity or raw exception text. */
  get debugAudioState() {
    return Object.freeze({
      contextState: this.ctx?.state ?? 'unavailable',
      muted: this.muted,
      suspended: this.isSuspended(),
      musicWanted: this.musicWanted,
      loading: this.musicAbort !== null,
      playing: this.musicSrc !== null && this.ctx?.state === 'running' && !this.muted && !this.isSuspended(),
      actualBedIndex: this.actualBedIndex,
      gains: Object.freeze({
        master: this.master?.gain.value ?? (this.muted ? 0 : MASTER_GAIN),
        music: this.musicGain?.gain.value ?? MUSIC_GAIN,
        bedTrim: this.bedTrim?.gain.value ?? 1,
        sfx: this.sfxGain?.gain.value ?? 1,
      }),
      lastLoadError: this.lastMusicError,
    });
  }

  private ensure(): AudioContext | null {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : MASTER_GAIN;
        this.compressor = this.ctx.createDynamicsCompressor();
        this.compressor.threshold.value = -8;
        this.compressor.knee.value = 6;
        this.compressor.ratio.value = 4;
        this.compressor.attack.value = 0.003;
        this.compressor.release.value = 0.12;
        this.master.connect(this.compressor);
        this.compressor.connect(this.ctx.destination);
        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = 1;
        this.sfxGain.connect(this.master);

        // One bounded lowpass on the music layer: the adaptive director opens it with danger.
        this.musicFilter = this.ctx.createBiquadFilter();
        this.musicFilter.type = 'lowpass';
        this.musicFilter.frequency.value =
          MUSIC_TENSION_MIN_HZ *
          Math.pow(MUSIC_TENSION_MAX_HZ / MUSIC_TENSION_MIN_HZ, this.musicTension);
        this.musicFilter.Q.value = 0.9;
        this.musicFilter.connect(this.master);

        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = MUSIC_GAIN;
        this.musicGain.connect(this.musicFilter);

        this.bedTrim = this.ctx.createGain();
        this.bedTrim.gain.value = 1;
        this.bedTrim.connect(this.musicGain);

        this.layerBus = this.ctx.createGain();
        this.layerBus.gain.value = 1;
        this.layerBus.connect(this.musicFilter);
        if (this.isSuspended()) void this.ctx.suspend().catch(() => {});
      } catch { return null; }
    }
    if (this.ctx.state === 'suspended' && !this.isSuspended()) void this.resumeAudioContext();
    return this.ctx;
  }

  /**
   * Resume the shared AudioContext without leaking rejected promises. MAX/Android WebViews can
   * suspend WebAudio after an HTML-video/visibility transition even though the context was already
   * unlocked by the menu tap.
   */
  private resumeAudioContext(): Promise<boolean> {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'closed' || this.isSuspended()) return Promise.resolve(false);
    if (ctx.state === 'running') return Promise.resolve(true);
    if (this.audioResume) return this.audioResume;

    // Call resume inside the gesture stack, rather than defer it to a microtask.
    let resume: Promise<void>;
    try { resume = ctx.resume(); } catch { return Promise.resolve(false); }
    const pending = resume
      .then(async () => {
        if (this.isSuspended()) {
          await ctx.suspend();
          return false;
        }
        return ctx.state === 'running';
      })
      .catch(() => false);
    this.audioResume = pending;
    void pending.finally(() => {
      if (this.audioResume === pending) this.audioResume = null;
    });
    return pending;
  }

  /**
   * If a WebView rejects resume outside a user activation, retry on the next real gesture instead
   * of leaving music permanently silent while procedural SFX continue to work.
   */
  private armMusicUnlockRetry(): void {
    if (this.musicUnlockHandler || !this.musicWanted || this.muted || this.isSuspended() || typeof window === 'undefined') return;
    const retry = (): void => {
      this.disarmMusicUnlockRetry();
      void this.resumeAudioContext().then((running) => {
        if (!this.musicWanted || this.muted || this.isSuspended()) return;
        if (running) this.spawnMusic();
        else this.armMusicUnlockRetry();
      });
    };
    this.musicUnlockHandler = retry;
    window.addEventListener('pointerdown', retry, true);
    window.addEventListener('touchend', retry, true);
    window.addEventListener('keydown', retry, true);
  }

  private disarmMusicUnlockRetry(): void {
    const retry = this.musicUnlockHandler;
    if (!retry || typeof window === 'undefined') return;
    window.removeEventListener('pointerdown', retry, true);
    window.removeEventListener('touchend', retry, true);
    window.removeEventListener('keydown', retry, true);
    this.musicUnlockHandler = null;
  }

  private ensureBioAmbience(): void {
    if (this.bioOsc || this.muted || !this.musicWanted || this.isSuspended()) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 48 + this.runIntensity * 8;
      gain.gain.value = 0.0001;
      osc.connect(gain);
      gain.connect(this.master);
      osc.start();
      this.bioOsc = osc;
      this.bioGain = gain;
      this.lastBioPulseAt = -1e9;
    } catch { this.bioOsc = null; this.bioGain = null; }
  }

  private stopBioAmbience(): void {
    if (this.bioOsc) {
      try { this.bioOsc.stop(); } catch { /* already stopped */ }
      try { this.bioOsc.disconnect(); } catch { /* no-op */ }
    }
    try { this.bioGain?.disconnect(); } catch { /* no-op */ }
    this.bioOsc = null;
    this.bioGain = null;
    this.lastBioPulseAt = -1e9;
  }

  private load(name: SfxName): Promise<AudioBuffer | null> {
    if (this.buffers[name]) return Promise.resolve(this.buffers[name] ?? null);
    if (this.loading[name]) return this.loading[name] as Promise<AudioBuffer | null>;
    const ctx = this.ensure();
    if (!ctx) return Promise.resolve(null);
    const p = fetch(audioAssetUrl(MANIFEST[name].file))
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((ab) => ctx.decodeAudioData(ab))
      .then((buf) => {
        this.bufferTrims[name] = scanNormalizationTrim(buf);
        this.buffers[name] = buf;
        return buf;
      })
      .catch(() => null);
    this.loading[name] = p;
    void p.then(() => { if (this.loading[name] === p) delete this.loading[name]; });
    return p;
  }

  private playBuf(buf: AudioBuffer, out: GainNode, vol: number): void {
    const ctx = this.ctx; if (!ctx || this.muted || this.isSuspended() || ctx.state !== 'running') return;
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    src.buffer = buf;
    gain.gain.value = vol;
    src.connect(gain);
    gain.connect(out);
    src.onended = () => {
      try { src.disconnect(); } catch { /* no-op */ }
      try { gain.disconnect(); } catch { /* no-op */ }
      src.onended = null;
    };
    src.start();
  }

  private fallback(name: SfxName): void {
    const ctx = this.ensure(); if (!ctx || !this.sfxGain) return;
    switch (name) {
      case 'shoot': this.blip(760, 410, 0.055, 'triangle', 0.03); break;
      case 'hit': this.blip(230, 105, 0.05, 'triangle', 0.045); break;
      case 'pickup': this.blip(620, 980, 0.075, 'sine', 0.05); break;
      case 'pickup2': this.blip(720, 1180, 0.07, 'sine', 0.05); break;
      case 'pickup3': this.blip(540, 880, 0.08, 'triangle', 0.05); break;
      case 'hurt': this.blip(165, 62, 0.2, 'sawtooth', 0.11); break;
      case 'levelup':
        this.blip(420, 540, 0.09, 'sine', 0.055);
        this.blip(610, 760, 0.11, 'sine', 0.055, 0.08);
        this.blip(820, 1040, 0.14, 'sine', 0.06, 0.17); break;
      case 'click': this.blip(480, 520, 0.035, 'sine', 0.04); break;
      case 'nova': this.blip(290, 52, 0.28, 'sawtooth', 0.065); break;
      case 'elite': this.blip(145, 82, 0.32, 'sawtooth', 0.08); break;
      case 'boss':
        this.blip(78, 45, 0.78, 'sawtooth', 0.13);
        this.blip(108, 62, 0.72, 'sine', 0.055, 0.1); break;
      case 'bossphase':
        this.blip(64, 40, 0.5, 'sawtooth', 0.12);
        this.blip(64, 40, 0.5, 'sawtooth', 0.12, 0.42);
        this.blip(130, 260, 0.9, 'triangle', 0.05, 0.1); break;
      case 'infect':
        this.blip(300, 520, 0.28, 'sine', 0.045);
        this.blip(520, 760, 0.3, 'sine', 0.035, 0.12); break;
      case 'lysis':
        this.blip(420, 60, 0.22, 'square', 0.07);
        this.blip(180, 46, 0.34, 'sawtooth', 0.08, 0.04); break;
      case 'gameover':
        this.blip(380, 190, 0.32, 'triangle', 0.07);
        this.blip(260, 110, 0.44, 'triangle', 0.07, 0.26); break;
      case 'victory': [440, 554, 659, 880].forEach((f, i) => this.blip(f, f * 1.05, 0.14, 'sine', 0.065, i * 0.12)); break;
    }
  }

  play(name: SfxName): void {
    if (this.muted || this.isSuspended()) return;
    const gap = THROTTLE_MS[name];
    if (gap) { const now = performance.now(); const last = this.lastAt[name] ?? -1e9;
      if (now - last < gap) return; this.lastAt[name] = now; }
    const buf = this.buffers[name];
    if (buf && this.ctx && this.sfxGain && this.ctx.state === 'running') {
      this.playBuf(buf, this.sfxGain, SFX_ROLE_GAINS[name] * (this.bufferTrims[name] ?? 1)); return;
    }
    if (!this.loading[name]) void this.load(name);
    this.fallback(name);
  }

  /**
   * RNA pickup round-robin: cycles the licensed pickup and its two generated variants so
   * rapid collection never turns into a machine-gun of one identical blip. Cursor-only —
   * audio presentation must not consume gameplay RNG.
   */
  playPickupVariant(): void {
    this.play(PICKUP_VARIANTS[this.pickupCursor % PICKUP_VARIANTS.length]);
    this.pickupCursor += 1;
  }

  private blip(f0: number, f1: number, dur: number, type: OscillatorType, vol: number, delay = 0): void {
    this.tone(f0, f1, dur, type, vol, delay, this.sfxGain);
  }

  /**
   * One transient oscillator on the given output. Every node is stopped and disconnected on
   * `ended`, which is what keeps restart/menu cycles from growing the audio graph.
   */
  private tone(
    f0: number,
    f1: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    delay: number,
    out: AudioNode | null
  ): void {
    const ctx = this.ensure(); if (!ctx || !out || this.muted || this.isSuspended() || ctx.state !== 'running') return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(1, f0), t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(out);
    const cleanup = (): void => {
      try { osc.disconnect(); } catch { /* no-op */ }
      try { gain.disconnect(); } catch { /* no-op */ }
      osc.onended = null;
      this.layerTones.delete(stop);
    };
    const stop = (): void => {
      try { osc.stop(); } catch { /* already stopped */ }
      cleanup();
    };
    osc.onended = cleanup;
    if (out !== this.sfxGain) this.layerTones.add(stop);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /**
   * Procedural adaptive stingers. Deliberately built from the existing blip synthesis rather than
   * new audio files: no unverified asset enters the repository for V1.
   *
   * `victory`/`defeat` intentionally emit no tones — GameScene already plays the licensed
   * `victory`/`gameover` SFX on run end, and doubling them would be a regression.
   */
  playCue(kind: AdaptiveCueKind): void {
    if (this.muted) return;
    const out = this.layerBus ?? this.musicGain;
    if (!out) return;
    switch (kind) {
      case 'stage-start':
        this.tone(330, 440, 0.16, 'sine', 0.05, 0, out);
        this.tone(495, 660, 0.22, 'sine', 0.05, 0.16, out);
        break;
      case 'boss-warning':
        // Riser: reads as an incoming threat well before the boss exists on screen.
        this.tone(86, 392, 1.05, 'sawtooth', 0.075, 0, out);
        this.tone(172, 700, 1.05, 'triangle', 0.03, 0.05, out);
        break;
      case 'boss-spawn':
        this.tone(120, 46, 0.5, 'sawtooth', 0.11, 0, out);
        this.tone(240, 90, 0.4, 'square', 0.045, 0.02, out);
        break;
      case 'stage-transition':
        this.tone(660, 440, 0.36, 'sine', 0.055, 0, out);
        this.tone(440, 312, 0.5, 'sine', 0.05, 0.28, out);
        break;
      case 'victory':
      case 'defeat':
        break;
    }
  }

  /** Event-driven heartbeat layer: aligns with the real telegraph/impact pulse timing. */
  playHeartbeat(kind: HeartbeatCueKind, bossActive: boolean): void {
    if (this.muted) return;
    const out = this.layerBus ?? this.musicGain;
    if (!out) return;
    if (kind === 'telegraph') {
      this.tone(1180, 1320, 0.07, 'sine', 0.035, 0, out);
      return;
    }
    const boost = bossActive ? 1.25 : 1;
    this.tone(72, 38, 0.2, 'sine', 0.1 * boost, 0, out);
    this.tone(144, 60, 0.12, 'triangle', 0.04 * boost, 0, out);
  }

  startMusic(): void {
    this.musicWanted = true;
    if (this.muted) return;
    this.ensureBioAmbience();
    if (this.musicSrc) return;
    if (this.musicBuf) { this.spawnMusic(); return; }
    if (this.musicAbort) return;
    const ctx = this.ensure(); if (!ctx || !this.musicGain) return;
    const requestId = ++this.musicRequestId;
    const controller = new AbortController();
    this.musicAbort = controller;
    void this.loadMusicBed(ctx, requestId, controller).finally(() => {
      if (requestId === this.musicRequestId && this.musicAbort === controller) this.musicAbort = null;
    });
  }

  /**
   * Decode the deterministic bed first, then walk the licensed set only if that asset/codec fails.
   * A single bad file must not turn the whole run silent in one WebView implementation.
   */
  private async loadMusicBed(
    ctx: AudioContext,
    requestId: number,
    controller: AbortController
  ): Promise<void> {
    const preferredBed = this.bedIndex;

    for (let offset = 0; offset < MUSIC_TRACK_COUNT; offset += 1) {
      if (controller.signal.aborted || requestId !== this.musicRequestId) return;
      const trackIndex = (preferredBed + offset) % MUSIC_TRACK_COUNT;
      const track = MUSIC_TRACKS[trackIndex] ?? MUSIC_TRACKS[0];
      try {
        const response = await fetch(audioAssetUrl(track), { signal: controller.signal });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
        if (
          controller.signal.aborted ||
          requestId !== this.musicRequestId ||
          !this.musicWanted ||
          this.muted
        ) return;
        if (trackIndex !== preferredBed) {
          console.warn('[OFELIYA audio] preferred music bed failed; using licensed fallback', {
            preferredBed,
            fallbackBed: trackIndex,
          });
        }
        this.actualBedIndex = trackIndex;
        if (this.bedTrim) this.bedTrim.gain.value = MUSIC_BED_TRIMS[trackIndex];
        this.musicBuf = buffer;
        this.lastMusicError = null;
        this.spawnMusic();
        return;
      } catch {
        if (controller.signal.aborted || requestId !== this.musicRequestId) return;
      }
    }

    // Diagnostics must not leak arbitrary URL/query/error payloads from the environment.
    this.lastMusicError = 'Unable to decode a licensed music bed';
    console.warn('[OFELIYA audio] unable to load any licensed music bed', {
      preferredBed,
      error: this.lastMusicError,
    });
  }

  private spawnMusic(): void {
    if (!this.musicWanted || this.muted || this.isSuspended() || !this.ctx || !this.musicBuf || !this.bedTrim || this.musicSrc) return;
    if (this.ctx.state !== 'running') {
      void this.resumeAudioContext().then((running) => {
        if (!this.musicWanted || this.muted || this.isSuspended() || this.musicSrc) return;
        if (running) this.spawnMusic();
        else this.armMusicUnlockRetry();
      });
      return;
    }
    this.disarmMusicUnlockRetry();
    const src = this.ctx.createBufferSource();
    src.buffer = this.musicBuf;
    src.loop = true;
    this.bedTrim.gain.value = this.actualBedIndex === null ? 1 : MUSIC_BED_TRIMS[this.actualBedIndex];
    src.connect(this.bedTrim);
    src.start();
    this.musicSrc = src;
  }

  private stopCurrentMusicSource(): void {
    if (!this.musicSrc) return;
    try { this.musicSrc.stop(); } catch { /* already stopped */ }
    try { this.musicSrc.disconnect(); } catch { /* no-op */ }
    this.musicSrc = null;
  }

  stopMusic(): void {
    this.musicWanted = false;
    this.disarmMusicUnlockRetry();
    this.cancelMusicLoad();
    this.musicBuf = null;
    this.actualBedIndex = null;
    if (this.bedTrim) this.bedTrim.gain.value = 1;
    this.lastMusicError = null;
    this.stopBioAmbience();
    for (const stop of this.layerTones) stop();
    this.setBioCadence(0);
    this.stopCurrentMusicSource();
    this.resetMusicDuck();
  }

  private cancelMusicLoad(): void {
    this.musicRequestId += 1;
    if (this.musicAbort) { try { this.musicAbort.abort(); } catch { /* no-op */ } this.musicAbort = null; }
  }
}

export const Sfx = new SfxImpl();
