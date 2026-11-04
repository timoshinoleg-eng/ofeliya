// ZzFX preset table for the procedural SFX fallback (donor core, part B).
//
// Every entry transcribes one old oscillator blip from Sfx.fallback 1:1:
// same start/end frequencies (f0/f1), duration (dur), waveform (shape),
// peak volume (vol) and start delay (delay). The only intentional change is
// the envelope curve: ZzFX uses its ADSR release over `dur`, the old code
// used an exponential gain decay over the same duration. Timbre stays close;
// exact sample identity is neither claimed nor needed.
//
// ZzFX parameter semantics used by ZzfxSynth (verified against the 1.4.0
// source): shape 0 sine / 1 triangle / 2 sawtooth / 5 square (duty 0.5 at
// shapeCurve 1); slide is applied per sample as slide*500*PI2/rate^2, so a
// sweep from f0 to f1 over `dur` seconds needs slide = (f1-f0)/(500*dur).
// Randomness is 0 everywhere: the old blips were deterministic, and kill
// spam must not gain per-play pitch jitter.
//
// This file holds data only: no zzfx import, so node contract tests can
// read it without an AudioContext.
import type { SfxName } from './Sfx';

export type ZzfxShape = 'sine' | 'triangle' | 'sawtooth' | 'square';

export interface ZzfxTone {
  f0: number;
  f1: number;
  dur: number;
  shape: ZzfxShape;
  vol: number;
  delay: number;
}

const t = (f0: number, f1: number, dur: number, shape: ZzfxShape, vol: number, delay = 0): ZzfxTone =>
  ({ f0, f1, dur, shape, vol, delay });

export const ZZFX_PRESETS: Record<SfxName, readonly ZzfxTone[]> = {
  shoot: [t(760, 410, 0.055, 'triangle', 0.03)],
  hit: [t(230, 105, 0.05, 'triangle', 0.045)],
  kill: [t(300, 90, 0.09, 'triangle', 0.05)],
  pickup: [t(620, 980, 0.075, 'sine', 0.05)],
  pickup2: [t(720, 1180, 0.07, 'sine', 0.05)],
  pickup3: [t(540, 880, 0.08, 'triangle', 0.05)],
  levelup: [
    t(420, 540, 0.09, 'sine', 0.055),
    t(610, 760, 0.11, 'sine', 0.055, 0.08),
    t(820, 1040, 0.14, 'sine', 0.06, 0.17),
  ],
  hurt: [t(165, 62, 0.2, 'sawtooth', 0.11)],
  click: [t(480, 520, 0.035, 'sine', 0.04)],
  nova: [t(290, 52, 0.28, 'sawtooth', 0.065)],
  elite: [t(145, 82, 0.32, 'sawtooth', 0.08)],
  boss: [
    t(78, 45, 0.78, 'sawtooth', 0.13),
    t(108, 62, 0.72, 'sine', 0.055, 0.1),
  ],
  bossphase: [
    t(64, 40, 0.5, 'sawtooth', 0.12),
    t(64, 40, 0.5, 'sawtooth', 0.12, 0.42),
    t(130, 260, 0.9, 'triangle', 0.05, 0.1),
  ],
  gameover: [
    t(380, 190, 0.32, 'triangle', 0.07),
    t(260, 110, 0.44, 'triangle', 0.07, 0.26),
  ],
  victory: [
    t(440, 462, 0.14, 'sine', 0.065),
    t(554, 581.7, 0.14, 'sine', 0.065, 0.12),
    t(659, 691.95, 0.14, 'sine', 0.065, 0.24),
    t(880, 924, 0.14, 'sine', 0.065, 0.36),
  ],
  infect: [
    t(300, 520, 0.28, 'sine', 0.045),
    t(520, 760, 0.3, 'sine', 0.035, 0.12),
  ],
  lysis: [
    t(420, 60, 0.22, 'square', 0.07),
    t(180, 46, 0.34, 'sawtooth', 0.08, 0.04),
  ],
};
