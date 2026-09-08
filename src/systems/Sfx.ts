// Простейший синтез звука через WebAudio — без аудиофайлов и лицензионных рисков.
// AudioContext создаётся лениво по первому вызову (после пользовательского жеста).

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

class SfxImpl {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private lastAt: Partial<Record<SfxName, number>> = {};
  muted = SaveSystem.get().muted;

  setMuted(m: boolean): void {
    this.muted = m;
    SaveSystem.update({ muted: m });
  }

  toggle(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
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
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private blip(f0: number, f1: number, dur: number, type: OscillatorType, vol: number, delay = 0): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(1, f0), t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
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
}

export const Sfx = new SfxImpl();
