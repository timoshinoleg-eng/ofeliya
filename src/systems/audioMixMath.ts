/** Presentation-only mix policy; no WebAudio, Phaser, save state or gameplay RNG. */
export const MASTER_GAIN = 0.8;
export const MUSIC_GAIN = 0.65;
/**
 * Licensed-bed loudness correction. Every bed is mastered to −14 LUFS / −1 dBTP
 * (see tools/audio/master_audio.py and public/audio/audio-manifest.json), so no
 * per-bed correction is needed anymore. The trim node stays in the graph as the
 * anchored place for future beds that ship outside the mastering contract.
 */
export const MUSIC_BED_TRIMS = [1, 1, 1, 1, 1, 1, 1] as const;
export const SFX_ROLE_GAINS = {
  shoot: 0.12, hit: 0.16, pickup: 0.28, pickup2: 0.28, pickup3: 0.28, click: 0.20,
  levelup: 0.50, hurt: 0.55, nova: 0.48, elite: 0.50,
  boss: 0.60, bossphase: 0.62, gameover: 0.58, victory: 0.58,
  infect: 0.42, lysis: 0.62,
} as const;

export function normalizationTrimForPeak(peak: number): number {
  return Number.isFinite(peak) && peak > 0 ? Math.min(12, 0.63 / peak) : 1;
}

/** Scan each decoded SFX once at the load boundary, including every channel. */
export function scanNormalizationTrim(buffer: {
  readonly numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}): number {
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      if (!Number.isFinite(sample)) return 1;
      peak = Math.max(peak, Math.abs(sample));
    }
  }
  return normalizationTrimForPeak(peak);
}

/** Existing duck floor/timing are preserved, independently of the decoded bed trim. */
export function musicGainForDuck(depth: number): number {
  const d = Math.max(0, Math.min(1, Number.isFinite(depth) ? depth : 0));
  return Math.max(0.02, MUSIC_GAIN * (1 - d));
}

/**
 * Perceptual volume curve for the user volume settings. A plain linear gain makes the
 * bottom half of the slider feel dead; the power curve keeps audible steps across the
 * whole range (0.5 → ≈ −9.6 dB, 0.25 → ≈ −24 dB). 0 stays exactly silent.
 */
export function perceptualVolumeGain(volume01: number): number {
  const v = Math.max(0, Math.min(1, Number.isFinite(volume01) ? volume01 : 1));
  return Math.pow(v, 1.6);
}

/** Volume settings UI steps (tap-to-cycle), percent scale. */
export const VOLUME_STEPS = [100, 75, 50, 25, 0] as const;

/** Next step in the tap cycle; wraps to the top after 0. */
export function nextVolumeStep(volume01: number): number {
  const pct = Math.round(Math.max(0, Math.min(1, volume01)) * 100);
  const idx = VOLUME_STEPS.indexOf(pct as (typeof VOLUME_STEPS)[number]);
  const effIdx = idx === -1 ? 0 : idx; // unknown value behaves as full volume
  const next = VOLUME_STEPS[(effIdx + 1) % VOLUME_STEPS.length];
  return next / 100;
}
