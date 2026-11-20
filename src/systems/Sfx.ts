// Audio: CC0 samples/music plus a lightweight procedural biological ambience layer.
// SFX — Kenney CC0. Music — OpenGameArt CC0 Music. Binary assets stay outside the JS bundle.
//
// This module owns the single game AudioContext and every long-lived audio node. The adaptive
// audio foundation (`AdaptiveAudioDirector`) is a decision layer only: it drives this module
// through `SfxAdaptiveSink`, so mute, user-gesture unlock and node ownership stay in one place.
//
// Procedural fallback SFX (every SfxName when its sample is missing, and
// always for 'kill') are synthesized with ZzFX (1.4.0, MIT) through
// `ZzfxSynth`/`zzfxPresets`: only ZZFX.buildSamples is used, and the samples
// play through this module's context and sfxGain, so mute, volume, throttle
// and routing are unchanged. ZZFX.play/playSamples are never called — they
// would bypass master gain via ZzFX's own module-level context, which stays
// dormant (constructed at import, never started or connected).

import { SaveSystem } from './SaveSystem';
import { RELEASE_SHA } from '../release';
import type { AdaptiveCueKind, HeartbeatCueKind } from './AdaptiveAudioDirector';
import {
  MASTER_GAIN, MUSIC_GAIN, MUSIC_BED_TRIMS, SFX_ROLE_GAINS,
  scanNormalizationTrim, musicGainForDuck, perceptualVolumeGain, nextVolumeStep,
} from './audioMixMath';
import { CPLUS_BED_SOURCES, isCPlusStinger, type CPlusBedRole } from './cplusAudioMath';
import { ZZFX_PRESETS } from './zzfxPresets';
import { buildZzfxSamples, ZZFX_SAMPLE_RATE } from './ZzfxSynth';

export type SfxName =
  | 'shoot' | 'hit' | 'pickup' | 'pickup2' | 'pickup3' | 'levelup' | 'hurt' | 'click'
  | 'nova' | 'elite' | 'boss' | 'bossphase' | 'gameover' | 'victory'
  | 'infect' | 'lysis' | 'kill';

const THROTTLE_MS: Partial<Record<SfxName, number>> = {
  shoot: 70, hit: 55, pickup: 45, pickup2: 45, pickup3: 45, infect: 140, lysis: 200,
  kill: 70,
};
const BASE: string = import.meta.env.BASE_URL || './';

function audioAssetUrl(file: string): string {
  const separator = file.includes('?') ? '&' : '?';
  return `${BASE}${file}${separator}v=${encodeURIComponent(RELEASE_SHA)}`;
}

/**
 * Sample manifest. Partial on purpose: 'kill' is procedural-only (see the
 * fallback preset below) — no unverified sample enters the repository, and
 * load() returns null for names without an entry instead of fetching.
 * check-audio-assets only scans audio/... path references, so a
 * procedural-only name does not disturb the manifest 1:1 contract.
 */
const MANIFEST: Partial<Record<SfxName, { file: string }>> = {
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
  /** User music volume between the tension filter and master; ducking stays on musicGain. */
  private musicUserGain: GainNode | null = null;
  /** Licensed bed loudness correction only; adaptive ducking remains on musicGain. */
  private bedTrim: GainNode | null = null;
  /** Lowpass that the adaptive director opens as danger rises. */
  private musicFilter: BiquadFilterNode | null = null;
  /** Procedural stingers/heartbeat share the filter; the retained bio pulse feeds musicUserGain. */
  private layerBus: GainNode | null = null;
  private lastAt: Partial<Record<SfxName, number>> = {};
  private pickupCursor = 0;
  /** Family-level pickup throttle: the round-robin cycles names, so per-name gaps can't rate-limit it. */
  private lastPickupFamilyAt = -1e9;
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

  // --- C+ v4 beds (opt-in test set) -------------------------------------
  // The C+ beds live in their own slot of the same graph: bedTrim -> musicGain
  // -> tension filter. They never replace a production bed unless the session
  // explicitly asks for them, and they are always released by stopMusic().
  private cplusRole: CPlusBedRole | null = null;
  private cplusSrc: AudioBufferSourceNode | null = null;
  private cplusGain: GainNode | null = null;
  private cplusBuffers: Partial<Record<CPlusBedRole, AudioBuffer>> = {};
  private cplusBedAbort: AbortController | null = null;
  private cplusBedRequestId = 0;
  private cplusStingerAbort: AbortController | null = null;
  private cplusStingerRequestId = 0;
  /** Outgoing beds remain owned until their fade completes or teardown stops them. */
  private cplusFadingBeds = new Set<{ src: AudioBufferSourceNode; gain: GainNode }>();
  private cplusActive = false;
  /** Live run-end stinger, so a fast restart can cut it. */
  private cplusStingerSrc: AudioBufferSourceNode | null = null;
  private cplusStingerGain: GainNode | null = null;
  /** Run-end stinger requested while muted; played when the sound comes back. */
  private cplusPendingStinger: CPlusBedRole | null = null;

  // One persistent oscillator is cheaper than spawning heartbeat nodes every beat. Gain remains
  // virtually silent between pulses; setRunIntensity only schedules a short envelope.
  private bioOsc: OscillatorNode | null = null;
  private bioGain: GainNode | null = null;
  private lastBioPulseAt = -1e9;
  private runIntensity = 0;
  /** Organ-locked bio cadence (Heart stage). 0 = derive the cadence from intensity. */
  private bioCadenceMs = 0;

  muted = SaveSystem.get().muted;
  /** User music volume 0..1; lives between the tension filter and master. */
  private musicUserVol = SaveSystem.get().musicVolume;
  /** User SFX volume 0..1; applied straight on the SFX bus. */
  private sfxUserVol = SaveSystem.get().sfxVolume;

  setMusicVolume(volume01: number): number {
    this.musicUserVol = Math.max(0, Math.min(1, Number.isFinite(volume01) ? volume01 : 1));
    SaveSystem.update({ musicVolume: this.musicUserVol });
    if (this.musicUserGain) this.musicUserGain.gain.value = perceptualVolumeGain(this.musicUserVol);
    return this.musicUserVol;
  }

  setSfxVolume(volume01: number): number {
    this.sfxUserVol = Math.max(0, Math.min(1, Number.isFinite(volume01) ? volume01 : 1));
    SaveSystem.update({ sfxVolume: this.sfxUserVol });
    if (this.sfxGain) this.sfxGain.gain.value = perceptualVolumeGain(this.sfxUserVol);
    return this.sfxUserVol;
  }

  /** Tap-to-cycle helpers for the settings row; return the new 0..1 value. */
  bumpMusicVolume(): number { return this.setMusicVolume(nextVolumeStep(this.musicUserVol)); }
  bumpSfxVolume(): number { return this.setSfxVolume(nextVolumeStep(this.sfxUserVol)); }

  getMusicVolume(): number { return this.musicUserVol; }
  getSfxVolume(): number { return this.sfxUserVol; }

  setMuted(m: boolean): void {
    this.muted = m;
    SaveSystem.update({ muted: m });
    this.applyGain();
    if (m) {
      this.stopBioAmbience();
      this.resetMusicDuck();
      this.disarmMusicUnlockRetry();
      if (!this.musicSrc) this.cancelMusicLoad();
    } else {
      // The outcome signal has to be read *before* the bed is resumed:
      // resuming an uncached bed starts a new bed, and a new bed drops a
      // pending signal - the Victory/Defeat cue would be lost.
      const pending = this.cplusPendingStinger;
      if (this.musicWanted) {
        this.startMusic();
        this.ensureBioAmbience();
      }
      // A run-end signal requested while muted is delivered now, so the
      // outcome is not lost. This must not depend on `musicWanted`: the bed
      // may already be stopped while the result screen is still up.
      if (pending) {
        this.cplusPendingStinger = null;
        this.startCPlusStingerAudible(pending);
      }
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
    // A production bed and a C+ bed are mutually exclusive: the licensed CC0
    // bed must never sound together with the C+ test set.
    this.stopCPlusBed();
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
        musicUser: this.musicUserGain?.gain.value ?? perceptualVolumeGain(this.musicUserVol),
        bedTrim: this.bedTrim?.gain.value ?? 1,
        sfx: this.sfxGain?.gain.value ?? perceptualVolumeGain(this.sfxUserVol),
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
        this.sfxGain.gain.value = perceptualVolumeGain(this.sfxUserVol);
        this.sfxGain.connect(this.master);

        // One bounded lowpass on the music layer: the adaptive director opens it with danger.
        this.musicFilter = this.ctx.createBiquadFilter();
        this.musicFilter.type = 'lowpass';
        this.musicFilter.frequency.value =
          MUSIC_TENSION_MIN_HZ *
          Math.pow(MUSIC_TENSION_MAX_HZ / MUSIC_TENSION_MIN_HZ, this.musicTension);
        this.musicFilter.Q.value = 0.9;
        this.musicUserGain = this.ctx.createGain();
        this.musicUserGain.gain.value = perceptualVolumeGain(this.musicUserVol);
        this.musicFilter.connect(this.musicUserGain);
        this.musicUserGain.connect(this.master);

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
      // The pulse belongs to the music bed (gated on musicWanted), so it must obey
      // the user music volume like the streamed loops — routing it straight to master
      // let it play at full level with music set to 0%.
      gain.connect(this.musicUserGain ?? this.master);
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
    // Procedural-only names (currently 'kill') have no sample: the fallback
    // preset below plays and no fetch is attempted, so kills never spam 404s.
    const entry = MANIFEST[name];
    if (!entry) return Promise.resolve(null);
    const p = fetch(audioAssetUrl(entry.file))
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

  private playBuf(buf: AudioBuffer, out: GainNode, vol: number, when = 0): void {
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
    src.start(ctx.currentTime + when);
  }

  /**
   * Procedural fallback: every SfxName plays its ZzFX preset table. Presets
   * carry the old blip parameters 1:1 (frequencies, durations, volumes,
   * start delays); only the envelope curve differs (ZzFX ADSR vs exponential
   * decay). Samples are generated with ZZFX.buildSamples and played through
   * this module's context and sfxGain, so mute, volume, throttle and the
   * suspended/running guards behave exactly as the oscillator path did.
   * Multi-tone names schedule each tone at its preset delay on the shared
   * clock — ZzFX's own `delay` parameter is an echo, never a start offset.
   */
  private fallback(name: SfxName): void {
    const ctx = this.ensure(); if (!ctx || !this.sfxGain) return;
    if (this.muted || this.isSuspended() || ctx.state !== 'running') return;
    for (const tone of ZZFX_PRESETS[name]) {
      const samples = buildZzfxSamples(tone);
      const buf = ctx.createBuffer(1, samples.length, ZZFX_SAMPLE_RATE);
      buf.getChannelData(0).set(samples);
      // Samples already carry the preset volume; the bus gain stays at 1.
      this.playBuf(buf, this.sfxGain, 1, tone.delay);
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
   * Family-level throttle: the round-robin cycles pickup/pickup2/pickup3, so the per-name
   * throttles alone would let three rapid pickups sound within one 45ms window.
   */
  playPickupVariant(): void {
    const now = performance.now();
    if (now - this.lastPickupFamilyAt < (THROTTLE_MS.pickup ?? 0)) return;
    this.lastPickupFamilyAt = now;
    this.play(PICKUP_VARIANTS[this.pickupCursor % PICKUP_VARIANTS.length]);
    this.pickupCursor += 1;
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
    if (this.cplusActive) {
      // The C+ bed owns the music slot: re-create its source instead of
      // loading a licensed production bed.
      this.ensureBioAmbience();
      this.resumeCPlusBed();
      return;
    }
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

  /**
   * C+ v4 bed (opt-in). The bed is cross-faded over `fadeMs` so an act or
   * boss switch never clicks. The production bed is released first: in a C+
   * session the licensed CC0 bed and the C+ bed must never sound together.
   *
   * The requested role is recorded *before* the mute check. Unmuting has to
   * resume the bed the run is actually on, not the one that happened to be
   * requested when the game was silent.
   */
  startCPlusBed(role: CPlusBedRole, fadeMs = 700): void {
    this.cplusRole = role;
    this.cplusActive = true;
    this.musicWanted = true;
    // A new bed replaces the previous run's outcome signal.
    this.stopCPlusStinger();
    // The licensed bed and the C+ bed are mutually exclusive: the production
    // source is released before the C+ bed is started, cached or not.
    this.stopCurrentMusicSource();
    this.musicBuf = null;
    this.actualBedIndex = null;
    this.cancelMusicLoad();
    // A pending C+ load for the previous role must not survive this switch -
    // not even while muted: when it resolves it overwrites `cplusRole` with
    // the old bed, and unmuting would then resume the wrong music.
    this.cancelCPlusLoad();
    if (this.muted) {
      // A boss/act switch while a previous bed was playing and then muted
      // must not resurrect the old source on unmute.
      this.stopCPlusBedSources();
      return;
    }
    this.startCPlusBedAudible(role, fadeMs);
  }

  /** Audible part of `startCPlusBed`: cached buffer, or a fresh load. */
  private startCPlusBedAudible(role: CPlusBedRole, fadeMs: number): void {
    const cached = this.cplusBuffers[role];
    if (cached) {
      // A cached bed supersedes whatever was still loading for another role.
      this.cancelCPlusLoad();
      this.swapCPlusBed(cached, role, fadeMs);
      return;
    }
    const ctx = this.ensure();
    if (!ctx) return;
    // Cancel the previous load FIRST: `cancelCPlusLoad` bumps the generation
    // counter, so assigning the new id before the cancel would immediately
    // mark the new request as stale and nothing would ever be fetched.
    this.cancelCPlusLoad();
    const requestId = ++this.cplusBedRequestId;
    const controller = new AbortController();
    this.cplusBedAbort = controller;
    void this.loadCPlusBed(ctx, role, requestId, controller, fadeMs).finally(() => {
      if (this.cplusBedAbort === controller) this.cplusBedAbort = null;
    });
  }

  /**
   * One-shot C+ stinger (run end). Plays through the layer bus, so the
   * run-end music duck does not swallow the outcome signal.
   *
   * While muted the stinger is remembered, not played: the outcome signal has
   * to reach the player when the sound comes back, and it must never survive
   * into the next run.
   */
  playCPlusStinger(role: CPlusBedRole): void {
    this.cplusPendingStinger = role;
    if (this.muted) return;
    this.cplusPendingStinger = null;
    this.startCPlusStingerAudible(role);
  }

  private startCPlusStingerAudible(role: CPlusBedRole): void {
    this.cancelCPlusStingerLoad();
    const ctx = this.ensure();
    const out = this.layerBus ?? this.musicGain;
    if (!ctx || !out) return;
    const cached = this.cplusBuffers[role];
    if (cached) {
      this.playCPlusBuffer(cached, out);
      return;
    }
    // Stingers and beds load independently: a pending result signal must not
    // abort the bed that is resuming after mute or visibility restoration.
    const requestId = ++this.cplusStingerRequestId;
    const controller = new AbortController();
    this.cplusStingerAbort = controller;
    void this.loadCPlusStinger(ctx, role, requestId, controller).finally(() => {
      if (this.cplusStingerAbort === controller) this.cplusStingerAbort = null;
    });
  }

  private async loadCPlusBed(
    ctx: AudioContext,
    role: CPlusBedRole,
    requestId: number,
    controller: AbortController,
    fadeMs: number
  ): Promise<void> {
    for (const file of CPLUS_BED_SOURCES[role]) {
      if (this.cplusStale('bed', requestId, controller)) return;
      const result = await this.fetchCPlus(ctx, file, requestId, controller, 'bed');
      if (result.kind === 'stale') return;
      // A fetch or decode failure is not a cancellation: try the next
      // candidate so the MP3 fallback still works on iOS.
      if (result.kind === 'failed') continue;
      this.cplusBuffers[role] = result.buffer;
      this.swapCPlusBed(result.buffer, role, fadeMs);
      return;
    }
    console.warn('[OFELIYA audio] unable to load a C+ bed', { role });
  }

  private async loadCPlusStinger(
    ctx: AudioContext,
    role: CPlusBedRole,
    requestId: number,
    controller: AbortController
  ): Promise<void> {
    for (const file of CPLUS_BED_SOURCES[role]) {
      if (this.cplusStale('stinger', requestId, controller)) return;
      const result = await this.fetchCPlus(ctx, file, requestId, controller, 'stinger');
      if (result.kind === 'stale') return;
      if (result.kind === 'failed') continue;
      this.cplusBuffers[role] = result.buffer;
      const out = this.layerBus ?? this.musicGain;
      if (!out) return;
      this.playCPlusBuffer(result.buffer, out);
      return;
    }
    console.warn('[OFELIYA audio] unable to load a C+ stinger', { role });
  }

  /** True when this request was aborted or superseded by a newer one. */
  private cplusStale(kind: 'bed' | 'stinger', requestId: number, controller: AbortController): boolean {
    const latest = kind === 'bed' ? this.cplusBedRequestId : this.cplusStingerRequestId;
    return controller.signal.aborted || requestId !== latest;
  }

  /**
   * Fetch + decode one C+ candidate.
   *
   * The result distinguishes a *failure* (the file is missing or the WebView
   * cannot decode it — the caller should try the next candidate) from a
   * *stale* request (aborted or superseded — the caller must stop).
   */
  private async fetchCPlus(
    ctx: AudioContext,
    file: string,
    requestId: number,
    controller: AbortController,
    requestKind: 'bed' | 'stinger'
  ): Promise<
    { kind: 'ok'; buffer: AudioBuffer } | { kind: 'failed' } | { kind: 'stale' }
  > {
    try {
      const response = await fetch(audioAssetUrl(file), { signal: controller.signal });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
      if (this.cplusStale(requestKind, requestId, controller)) return { kind: 'stale' };
      return { kind: 'ok', buffer };
    } catch {
      if (this.cplusStale(requestKind, requestId, controller)) return { kind: 'stale' };
      return { kind: 'failed' };
    }
  }

  /** Cross-fade the C+ bed into the music bus. */
  private swapCPlusBed(buffer: AudioBuffer, role: CPlusBedRole, fadeMs: number): void {
    const ctx = this.ctx;
    const trim = this.bedTrim;
    if (!ctx || !trim) return;
    const now = ctx.currentTime;
    const fade = Math.max(0.01, fadeMs / 1000);

    const oldSrc = this.cplusSrc;
    const oldGain = this.cplusGain;
    if (oldSrc && oldGain) {
      const outgoing = { src: oldSrc, gain: oldGain };
      this.cplusFadingBeds.add(outgoing);
      oldSrc.onended = () => {
        this.cplusFadingBeds.delete(outgoing);
        try { oldSrc.disconnect(); oldGain.disconnect(); } catch { /* no-op */ }
      };
      oldGain.gain.cancelScheduledValues(now);
      oldGain.gain.setValueAtTime(oldGain.gain.value, now);
      oldGain.gain.linearRampToValueAtTime(0, now + fade);
      try { oldSrc.stop(now + fade + 0.02); } catch { /* already stopped */ }
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = !isCPlusStinger(role);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.linearRampToValueAtTime(1, now + fade);
    src.connect(gain);
    gain.connect(trim);
    src.onended = () => {
      if (this.cplusSrc === src) {
        this.cplusSrc = null;
        this.cplusGain = null;
      }
      try { src.disconnect(); gain.disconnect(); } catch { /* no-op */ }
    };
    src.start();

    this.cplusSrc = src;
    this.cplusGain = gain;
    this.cplusRole = role;
    this.cplusActive = true;
  }

  /**
   * Play a decoded C+ buffer as a one-shot through the layer bus.
   *
   * The source is registered so it can be stopped: a run-end signal must not
   * survive a fast restart into the next run's music.
   */
  private playCPlusBuffer(buffer: AudioBuffer, out: GainNode): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 1;
    src.connect(gain);
    gain.connect(out);
    src.onended = () => {
      try { src.disconnect(); gain.disconnect(); } catch { /* no-op */ }
      if (this.cplusStingerSrc === src) {
        this.cplusStingerSrc = null;
        this.cplusStingerGain = null;
      }
    };
    src.start();
    this.cplusStingerSrc = src;
    this.cplusStingerGain = gain;
  }

  /** Stop a live C+ stinger and drop a pending one. */
  private stopCPlusStinger(): void {
    this.cancelCPlusStingerLoad();
    this.cplusPendingStinger = null;
    const src = this.cplusStingerSrc;
    const gain = this.cplusStingerGain;
    this.cplusStingerSrc = null;
    this.cplusStingerGain = null;
    if (src) {
      try { src.onended = null; src.stop(); } catch { /* already stopped */ }
      try { src.disconnect(); } catch { /* no-op */ }
    }
    if (gain) {
      try { gain.disconnect(); } catch { /* no-op */ }
    }
  }

  /** Re-create the C+ bed source after a context suspend/resume. */
  private resumeCPlusBed(): void {
    const role = this.cplusRole;
    if (!role) return;
    // Resuming the current bed is not a new bed: an outcome signal that was
    // requested while muted has to survive the resume, otherwise the
    // Victory/Defeat cue is silently dropped.
    // This is a resume, not a new run or act. Do not cancel a concurrently
    // loading outcome stinger, or clear the saved run-end notification.
    if (this.cplusSrc) return;
    const cached = this.cplusBuffers[role];
    if (cached) {
      this.cancelCPlusLoad();
      this.swapCPlusBed(cached, role, 0);
    } else if (!this.cplusBedAbort) {
      this.startCPlusBedAudible(role, 0);
    }
  }

  /** Release the C+ bed. Used by the fast-restart path. */
  stopCPlusBed(): void {
    this.cancelCPlusLoad();
    this.cplusActive = false;
    this.cplusRole = null;
    this.stopCPlusStinger();
    this.stopCPlusBedSources();
  }

  /** Stop active and fading music sources without changing the requested role. */
  private stopCPlusBedSources(): void {
    const src = this.cplusSrc;
    const gain = this.cplusGain;
    this.cplusSrc = null;
    this.cplusGain = null;
    if (src) {
      try { src.onended = null; src.stop(); } catch { /* already stopped */ }
      try { src.disconnect(); } catch { /* no-op */ }
    }
    if (gain) {
      try { gain.disconnect(); } catch { /* no-op */ }
    }
    for (const faded of this.cplusFadingBeds) {
      try { faded.src.onended = null; faded.src.stop(); } catch { /* already stopped */ }
      try { faded.src.disconnect(); faded.gain.disconnect(); } catch { /* no-op */ }
    }
    this.cplusFadingBeds.clear();
  }

  private cancelCPlusLoad(): void {
    this.cplusBedRequestId += 1;
    if (this.cplusBedAbort) {
      try { this.cplusBedAbort.abort(); } catch { /* no-op */ }
      this.cplusBedAbort = null;
    }
  }

  private cancelCPlusStingerLoad(): void {
    this.cplusStingerRequestId += 1;
    if (this.cplusStingerAbort) {
      try { this.cplusStingerAbort.abort(); } catch { /* no-op */ }
      this.cplusStingerAbort = null;
    }
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
    this.stopCPlusBed();
    this.resetMusicDuck();
  }

  private cancelMusicLoad(): void {
    this.musicRequestId += 1;
    if (this.musicAbort) { try { this.musicAbort.abort(); } catch { /* no-op */ } this.musicAbort = null; }
  }
}

export const Sfx = new SfxImpl();
