// ZzFX synth bridge (donor core, part B; zzfx 1.4.0, MIT).
//
// Only ZZFX.buildSamples is used, and only as a pure sample generator: the
// returned Float32Array is played through Sfx's own AudioContext and sfxGain
// (see Sfx.fallback), so mute, user volume, throttles and the single audible
// graph are unchanged. ZZFX.play / ZZFX.playSamples are deliberately never
// called: they would play through ZzFX's own module-level AudioContext and
// bypass the game's master gain. That context still exists as a dormant
// object once this module is imported (the library constructs it at import
// time); it is never started, connected or resumed, and produces no sound.
import { ZZFX } from 'zzfx';
import type { ZzfxTone } from './zzfxPresets';

/** Sample rate ZzFX generates at; buffers are created at this rate so pitch holds on any context. */
export const ZZFX_SAMPLE_RATE = 44100;

const SHAPE_CODE: Record<ZzfxTone['shape'], number> = {
  sine: 0,
  triangle: 1,
  sawtooth: 2,
  square: 5,
};

/**
 * Positional ZzFX parameter array for one preset tone, in the library's
 * order: volume, randomness, frequency, attack, sustain, release, shape,
 * shapeCurve, slide, deltaSlide, pitchJump, pitchJumpTime, repeatTime,
 * noise, modulation, bitCrush, delay, sustainVolume, decay, tremolo, filter.
 * Slide derivation (from the 1.4.0 source): the per-sample frequency step is
 * slide*500*PI2/rate^2, so over `dur` seconds the sweep is slide*500*dur Hz.
 */
export function zzfxParamsFor(tone: ZzfxTone): number[] {
  return [
    tone.vol,
    0, // randomness: old blips were deterministic
    tone.f0,
    0, // attack: library substitutes a 9-sample minimum, no click
    0, // sustain
    tone.dur, // release: the whole tone length
    SHAPE_CODE[tone.shape],
    1, // shapeCurve: identity for sine/triangle/saw, 0.5 duty for square
    (tone.f1 - tone.f0) / (500 * tone.dur), // slide
    0, // deltaSlide
    0, // pitchJump
    0, // pitchJumpTime
    0, // repeatTime
    0, // noise
    0, // modulation
    0, // bitCrush
    0, // delay: ZzFX delay is an echo, NOT a start offset (Sfx schedules that)
    1, // sustainVolume
    0, // decay
    0, // tremolo
    0, // filter
  ];
}

/** Raw ZzFX samples for one preset tone, at ZZFX_SAMPLE_RATE. */
export function buildZzfxSamples(tone: ZzfxTone): Float32Array {
  return ZZFX.buildSamples(...zzfxParamsFor(tone));
}
