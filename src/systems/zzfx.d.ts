// Type declaration for the zzfx package (1.4.0, MIT), which ships no types.
// Only buildSamples is declared: Sfx must never call ZZFX.play/playSamples,
// which would bypass the game's own AudioContext and master gain.
declare module 'zzfx' {
  export const ZZFX: {
    volume: number;
    sampleRate: number;
    buildSamples: (...params: number[]) => Float32Array;
  };
}
