// Звук: процедурный WebAudio-синтез (фолбэк) + готовые SFX и музыка (CC0).
// SFX — Kenney CC0 (https://kenney.nl). Музыка — коллекция CC0 Music на OpenGameArt
// (https://opengameart.org/content/cc0-music-0). Ассеты (public/audio/*) грузятся по сети и
// декодируются лениво, НЕ входят в JS-бандл. Лицензия CC0 1.0 — атрибуция не требуется.

import { SaveSystem } from './SaveSystem';

export type SfxName =
  | 'shoot'
  | 'hit'
  | 'pickup'
  | 'levelup'
  | 'hurt'
  | 'click'
  | 'nova'
  | 'elite'
  | 'boss'
  | 'gameover'
  | 'victory';

const THROTTLE_MS: Partial<Record<SfxName, number>> = {
  shoot: 70,
  hit: 55,
  pickup: 45,
};

const BASE: string = import.meta.env.BASE_URL || './';

// Маппинг событий на файлы Kenney (vol — относительная громкость проигрывания).
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

// Фоновая музыка: треки из CC0-коллекции OpenGameArt (электроника/эмбиент/эпик).
// Случайный трек на каждый забег; кандидаты для прослушивания, потом сократим до 2–3 лучших.
const MUSIC_TRACKS: string[] = [
  'audio/music/loop0.ogg',
  'audio/music/loop1.ogg',
  'audio/music/loop2.ogg',
  'audio/music/loop3.mp3',
  'audio/music/loop4.mp3',
  'audio/music/loop5.mp3',
  'audio/music/loop6.mp3',
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
  muted = SaveSystem.get().muted;

  setMuted(m: boolean): void {
    this.muted = m;
    SaveSystem.update({ muted: m });
    this.applyGain();
  }

  toggle(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  private applyGain(): void {
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
  }

  private ensure(): AudioContext | null {
    if (!this.ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private load(name: SfxName): Promise<AudioBuffer | null> {
    if (this.buffers[name]) return Promise.resolve(this.buffers[name] ?? null);
    if (this.loading[name]) return this.loading[name] as Promise<AudioBuffer | null>;
    const ctx = this.ensure();
    if (!ctx) return Promise.resolve(null);
    const url = BASE + MANIFEST[name].file;
    const p = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((ab) => ctx.decodeAudioData(ab))
      .then((buf) => {
        this.buffers[name] = buf;
        return buf;
      })
      .catch(() => null);
    this.loading[name] = p;
    return p;
  }

  private playBuf(buf: AudioBuffer, out: GainNode, vol: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(g);
    g.connect(out);
    src.start();
  }

  // Процедурный фолбэк — тот же синтез, что был раньше, на случай недоступности ассета.
  private fallback(name: SfxName): void {
    const ctx = this.ensure();
    if (!ctx || !this.sfxGain) return;
    switch (name) {
      case 'shoot':
        this.blip(900, 480, 0.06, 'square', 0.035);
        break;
      case 'hit':
        this.blip(260, 120, 0.05, 'triangle', 0.05);
        break;
      case 'pickup':
        this.blip(680, 1020, 0.07, 'sine', 0.05);
        break;
      case 'hurt':
        this.blip(180, 70, 0.18, 'sawtooth', 0.12);
        break;
      case 'levelup':
        this.blip(520, 520, 0.09, 'square', 0.06);
        this.blip(660, 660, 0.09, 'square', 0.06, 0.09);
        this.blip(880, 880, 0.14, 'square', 0.07, 0.18);
        break;
      case 'click':
        this.blip(500, 500, 0.04, 'square', 0.05);
        break;
      case 'nova':
        this.blip(320, 60, 0.25, 'sawtooth', 0.07);
        break;
      case 'elite':
        this.blip(160, 95, 0.3, 'sawtooth', 0.09);
        break;
      case 'boss':
        this.blip(90, 55, 0.7, 'sawtooth', 0.14);
        this.blip(120, 70, 0.7, 'square', 0.06, 0.1);
        break;
      case 'gameover':
        this.blip(440, 220, 0.3, 'square', 0.08);
        this.blip(330, 165, 0.3, 'square', 0.08, 0.25);
        this.blip(220, 110, 0.5, 'square', 0.09, 0.5);
        break;
      case 'victory':
        [523, 659, 784, 1046].forEach((f, i) => this.blip(f, f, 0.14, 'square', 0.07, i * 0.12));
        break;
    }
  }

  play(name: SfxName): void {
    if (this.muted) return;
    const gap = THROTTLE_MS[name];
    if (gap) {
      const now = performance.now();
      const last = this.lastAt[name] ?? -1e9;
      if (now - last < gap) return;
      this.lastAt[name] = now;
    }
    const buf = this.buffers[name];
    if (buf && this.ctx && this.sfxGain && this.ctx.state === 'running') {
      this.playBuf(buf, this.sfxGain, MANIFEST[name].vol);
      return;
    }
    // Ассет ещё не готов — грузим в фоне, а сейчас даём процедурный звук для отклика.
    if (!this.loading[name]) void this.load(name);
    this.fallback(name);
  }

  private blip(
    f0: number,
    f1: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    delay = 0
  ): void {
    const ctx = this.ensure();
    if (!ctx || !this.sfxGain) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(1, f0), t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.sfxGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // --- музыка ---

  startMusic(): void {
    const ctx = this.ensure();
    if (!ctx || !this.musicGain) return;
    if (this.musicSrc) return;
    const track = MUSIC_TRACKS[Math.floor(Math.random() * MUSIC_TRACKS.length)];
    fetch(BASE + track)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((ab) => ctx.decodeAudioData(ab))
      .then((buf) => {
        this.musicBuf = buf;
        this.spawnMusic();
      })
      .catch(() => {
        /* музыка опциональна — тихий отказ */
      });
  }

  private spawnMusic(): void {
    if (!this.ctx || !this.musicBuf || !this.musicGain || this.musicSrc) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    const src = this.ctx.createBufferSource();
    src.buffer = this.musicBuf;
    src.loop = true;
    src.connect(this.musicGain);
    src.start();
    this.musicSrc = src;
  }

  stopMusic(): void {
    if (this.musicSrc) {
      try {
        this.musicSrc.stop();
      } catch {
        /* уже остановлен */
      }
      this.musicSrc.disconnect();
      this.musicSrc = null;
    }
  }
}

export const Sfx = new SfxImpl();
