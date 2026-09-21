// Audio: CC0 samples/music plus a lightweight procedural biological ambience layer.
// SFX — Kenney CC0. Music — OpenGameArt CC0 Music. Binary assets stay outside the JS bundle.
//
// This module owns the single game AudioContext and every long-lived audio node. The adaptive
// audio foundation (`AdaptiveAudioDirector`) is a decision layer only: it drives this module
// through `SfxAdaptiveSink`, so mute, user-gesture unlock and node ownership stay in one place.

import { SaveSystem } from './SaveSystem';
import type { AdaptiveCueKind, HeartbeatCueKind } from './AdaptiveAudioDirector';

export type SfxName =
  | 'shoot' | 'hit' | 'pickup' | 'levelup' | 'hurt' | 'click'
  | 'nova' | 'elite' | 'boss' | 'gameover' | 'victory';

const THROTTLE_MS: Partial<Record<SfxName, number>> = { shoot: 70, hit: 55, pickup: 45 };
const BASE: string = import.meta.env.BASE_URL || './';
const MANIFEST: Record<SfxName, { file: string; vol: number }> = {
  shoot: { file: 'audio/sfx/shoot.ogg', vol: 0.5 },
  hit: { file: 'audio/sfx/hit.ogg', vol: 0.45 },
  pickup: { file: 'audio/sfx/pickup.ogg', vol: 0.5 },
  levelup: { file: 'audio/sfx/levelup.ogg', vol: 0.7 },
  hurt: { file: 'audio/sfx/hurt.ogg', vol: 0.7 },
  click: { file: 'audio/sfx/click.ogg', vol: 0.6 },
  nova: { file: 'audio/sfx/nova.ogg', vol: 0.7 },
  elite: { file: 'audio/sfx/elite.ogg', vol: 0.7 },
  boss: { file: 'audio/sfx/boss.ogg', vol: 0.8 },
  gameover: { file: 'audio/sfx/gameover.ogg', vol: 0.8 },
  victory: { file: 'audio/sfx/victory.ogg', vol: 0.8 },
};
const MUSIC_TRACKS = [
  'audio/music/loop0.ogg', 'audio/music/loop1.ogg', 'audio/music/loop2.ogg',
  'audio/music/loop3.mp3', 'audio/music/loop4.mp3', 'audio/music/loop5.mp3', 'audio/music/loop6.mp3',
];

/** Licensed bed count, consumed by the adaptive director for deterministic bed selection. */
export const MUSIC_TRACK_COUNT = MUSIC_TRACKS.length;

const MUSIC_BASE_GAIN = 0.35;
const MUSIC_TENSION_MIN_HZ = 2_500;
const MUSIC_TENSION_MAX_HZ = 14_000;
/** Neutral openness used when no director is driving the bus (mute/unmute, run teardown). */
const MUSIC_TENSION_NEUTRAL = 0.12;

class SfxImpl {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  /** Lowpass that the adaptive director opens as danger rises. */
  private musicFilter: BiquadFilterNode | null = null;
  /** Procedural layer bus (stingers, heartbeat, bio) — shares the music tension filter. */
  private layerBus: GainNode | null = null;
  private lastAt: Partial<Record<SfxName, number>> = {};
  private buffers: Partial<Record<SfxName, AudioBuffer>> = {};
  private loading: Partial<Record<SfxName, Promise<AudioBuffer | null>>> = {};
  private musicSrc: AudioBufferSourceNode | null = null;
  private musicBuf: AudioBuffer | null = null;
  private musicAbort: AbortController | null = null;
  private musicRequestId = 0;
  private musicWanted = false;
  /** Deterministic bed index. Replaces the previous per-lifecycle `Math.random()` track pick. */
  private bedIndex = 0;
  private musicTension = MUSIC_TENSION_NEUTRAL;

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
    const d = Math.max(0, Math.min(1, Number.isFinite(depth) ? depth : 0));
    const hold = Number.isFinite(holdMs) ? Math.max(0, holdMs) / 1000 : 0;
    const target = Math.max(0.02, MUSIC_BASE_GAIN * (1 - d));
    const t = ctx.currentTime;
    try {
      gain.gain.cancelScheduledValues(t);
      gain.gain.setTargetAtTime(target, t, 0.08);
      gain.gain.setTargetAtTime(MUSIC_BASE_GAIN, t + Math.max(0.05, hold), 0.35);
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
      gain.gain.setValueAtTime(MUSIC_BASE_GAIN, ctx.currentTime);
    } catch {
      /* no-op */
    }
  }

  /** Document-visibility suspend. Resuming is a no-op while muted (master gain already 0). */
  setSuspended(suspended: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      if (suspended) void ctx.suspend();
      else void ctx.resume();
    } catch {
      /* WebViews can reject suspend/resume during teardown. */
    }
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
    this.cancelMusicLoad();
  }

  private applyGain(): void { if (this.master) this.master.gain.value = this.muted ? 0 : 0.5; }

  private ensure(): AudioContext | null {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.5;
        this.master.connect(this.ctx.destination);
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
        this.musicGain.gain.value = MUSIC_BASE_GAIN;
        this.musicGain.connect(this.musicFilter);

        this.layerBus = this.ctx.createGain();
        this.layerBus.gain.value = 1;
        this.layerBus.connect(this.musicFilter);
      } catch { return null; }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private ensureBioAmbience(): void {
    if (this.bioOsc || this.muted || !this.musicWanted) return;
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
    const p = fetch(BASE + MANIFEST[name].file)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((ab) => ctx.decodeAudioData(ab))
      .then((buf) => { this.buffers[name] = buf; return buf; })
      .catch(() => null);
    this.loading[name] = p;
    void p.then(() => { if (this.loading[name] === p) delete this.loading[name]; });
    return p;
  }

  private playBuf(buf: AudioBuffer, out: GainNode, vol: number): void {
    const ctx = this.ctx; if (!ctx) return;
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
      case 'gameover':
        this.blip(380, 190, 0.32, 'triangle', 0.07);
        this.blip(260, 110, 0.44, 'triangle', 0.07, 0.26); break;
      case 'victory': [440, 554, 659, 880].forEach((f, i) => this.blip(f, f * 1.05, 0.14, 'sine', 0.065, i * 0.12)); break;
    }
  }

  play(name: SfxName): void {
    if (this.muted) return;
    const gap = THROTTLE_MS[name];
    if (gap) { const now = performance.now(); const last = this.lastAt[name] ?? -1e9;
      if (now - last < gap) return; this.lastAt[name] = now; }
    const buf = this.buffers[name];
    if (buf && this.ctx && this.sfxGain && this.ctx.state === 'running') {
      this.playBuf(buf, this.sfxGain, MANIFEST[name].vol); return;
    }
    if (!this.loading[name]) void this.load(name);
    this.fallback(name);
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
    const ctx = this.ensure(); if (!ctx || !out) return;
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
    osc.onended = () => {
      try { osc.disconnect(); } catch { /* no-op */ }
      try { gain.disconnect(); } catch { /* no-op */ }
      osc.onended = null;
    };
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
    const requestId = ++this.musicRequestId; const controller = new AbortController();
    this.musicAbort = controller;
    const track = MUSIC_TRACKS[this.bedIndex] ?? MUSIC_TRACKS[0];
    void fetch(BASE + track, { signal: controller.signal })
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((ab) => ctx.decodeAudioData(ab))
      .then((buf) => {
        if (requestId !== this.musicRequestId || !this.musicWanted || this.muted) return;
        this.musicBuf = buf; this.spawnMusic();
      })
      .catch(() => {})
      .finally(() => { if (requestId === this.musicRequestId && this.musicAbort === controller) this.musicAbort = null; });
  }

  private spawnMusic(): void {
    if (!this.musicWanted || this.muted || !this.ctx || !this.musicBuf || !this.musicGain || this.musicSrc) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    const src = this.ctx.createBufferSource(); src.buffer = this.musicBuf; src.loop = true;
    src.connect(this.musicGain); src.start(); this.musicSrc = src;
  }

  private stopCurrentMusicSource(): void {
    if (!this.musicSrc) return;
    try { this.musicSrc.stop(); } catch { /* already stopped */ }
    try { this.musicSrc.disconnect(); } catch { /* no-op */ }
    this.musicSrc = null;
  }

  stopMusic(): void {
    this.musicWanted = false; this.cancelMusicLoad(); this.musicBuf = null; this.stopBioAmbience();
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
