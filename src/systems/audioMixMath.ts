/** Presentation-only mix policy; no WebAudio, Phaser, save state or gameplay RNG. */
export const MASTER_GAIN = 0.8;
export const MUSIC_GAIN = 0.65;
export const MUSIC_BED_TRIMS = [0.47, 0.37, 0.71, 1.14, 2, 0.32, 0.5] as const;
export const SFX_ROLE_GAINS = {
  shoot: 0.12, hit: 0.16, pickup: 0.28, click: 0.20,
  levelup: 0.50, hurt: 0.55, nova: 0.48, elite: 0.50,
  boss: 0.60, gameover: 0.58, victory: 0.58,
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
