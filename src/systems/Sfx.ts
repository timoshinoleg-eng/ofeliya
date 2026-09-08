// Audio: CC0 samples/music plus a lightweight procedural biological ambience layer.
// SFX — Kenney CC0. Music — OpenGameArt CC0 Music. Binary assets stay outside the JS bundle.

import { SaveSystem } from './SaveSystem';

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

class SfxImpl {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private lastAt: Partial<Record<SfxName, number>> = {};
  private buffers: Partial<Record<SfxName, AudioBuffer>> = {};
  private loading: Partial<Record<SfxName, Promise<AudioBuffer | null>>> = {};
  private musicSrc: AudioBufferSourceNode | null = null;
  private musicBuf: AudioBuffer | null = null;
  private musicAbort: AbortController | null = null;
  private musicRequestId = 0;
  private musicWanted = false;

  // One persistent oscillator is cheaper than spawning heartbeat nodes every beat. Gain remains
  // virtually silent between pulses; setRunIntensity only schedules a short envelope.
  private bioOsc: OscillatorNode | null = null;
  private bioGain: GainNode | null = null;
  private lastBioPulseAt = -1e9;
  private runIntensity = 0;

  muted = SaveSystem.get().muted;

  setMuted(m: boolean): void {
    this.muted = m;
    SaveSystem.update({ muted: m });
    this.applyGain();
    if (m) {
      this.stopBioAmbience();
      if (!this.musicSrc) this.cancelMusicLoad();
    } else if (this.musicWanted) {
      this.startMusic();
      this.ensureBioAmbience();
    }
  }

  toggle(): boolean { this.setMuted(!this.muted); return this.muted; }

  /** 0..1 immune-response progress. Safe to call every frame. */
  setRunIntensity(progress: number): void {
    this.runIntensity = Math.max(0, Math.min(1, progress));
    if (!this.musicWanted || this.muted) return;
    this.ensureBioAmbience();
    const ctx = this.ctx;
    const gain = this.bioGain;
    if (!ctx || !gain) return;

    const nowMs = performance.now();
    const beatEveryMs = 920 - this.runIntensity * 410;
    if (nowMs - this.lastBioPulseAt < beatEveryMs) return;
    this.lastBioPulseAt = nowMs;

    const t = ctx.currentTime;
    const peak = 0.018 + this.runIntensity * 0.026;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    // A softer second ventricular pulse gives a biological feel without a sampled heartbeat.
    gain.gain.exponentialRampToValueAtTime(peak * 0.5, t + 0.21);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
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
        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = 0.35;
        this.musicGain.connect(this.master);
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
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain(); g.gain.value = vol; src.connect(g); g.connect(out); src.start();
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
    const ctx = this.ensure(); if (!ctx || !this.sfxGain) return;
    const t0 = ctx.currentTime + delay; const osc = ctx.createOscillator(); const g = ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(Math.max(1, f0), t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(this.sfxGain); osc.start(t0); osc.stop(t0 + dur + 0.02);
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
    const track = MUSIC_TRACKS[Math.floor(Math.random() * MUSIC_TRACKS.length)];
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

  stopMusic(): void {
    this.musicWanted = false; this.cancelMusicLoad(); this.musicBuf = null; this.stopBioAmbience();
    if (this.musicSrc) {
      try { this.musicSrc.stop(); } catch { /* already stopped */ }
      this.musicSrc.disconnect(); this.musicSrc = null;
    }
  }

  private cancelMusicLoad(): void {
    this.musicRequestId += 1;
    if (this.musicAbort) { try { this.musicAbort.abort(); } catch { /* no-op */ } this.musicAbort = null; }
  }
}

export const Sfx = new SfxImpl();
