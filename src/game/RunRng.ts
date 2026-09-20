export const GAMEPLAY_RNG_STREAMS = [
  'progression',
  'enemy-kind',
  'enemy-spawn',
  'elite',
  'host-cell',
  'loot',
] as const;

export type GameplayRngStream = (typeof GAMEPLAY_RNG_STREAMS)[number];

export interface RunRngSnapshot {
  seed: string;
  states: Record<GameplayRngStream, number>;
}

function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h >>>= 0;
  return h === 0 ? 0x6d2b79f5 : h;
}

function canonicalSeed(raw: string | number): string {
  const value = String(raw).trim();
  if (/^[A-Za-z0-9_-]{1,32}$/.test(value)) return value;
  return hash32(value).toString(16).padStart(8, '0');
}

export function generateRunSeed(): string {
  try {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi?.getRandomValues) {
      const words = new Uint32Array(2);
      cryptoApi.getRandomValues(words);
      return `${words[0].toString(16).padStart(8, '0')}${words[1]
        .toString(16)
        .padStart(8, '0')}`;
    }
  } catch {
    // Restricted WebViews can deny crypto access; fall through to a one-time seed source.
  }
  const fallback = `${Date.now()}:${performance.now()}:${Math.random()}`;
  return hash32(fallback).toString(16).padStart(8, '0');
}

/**
 * Run-wide deterministic gameplay RNG with independent streams.
 *
 * Independence is intentional: adding one progression roll must not move enemy-spawn positions,
 * and changing a cosmetic system must never touch any gameplay stream.
 */
export class RunRng {
  readonly seed: string;
  private readonly states: Record<GameplayRngStream, number>;

  constructor(seed: string | number) {
    this.seed = canonicalSeed(seed);
    this.states = Object.fromEntries(
      GAMEPLAY_RNG_STREAMS.map((stream) => [stream, hash32(`${this.seed}:${stream}`)])
    ) as Record<GameplayRngStream, number>;
  }

  next(stream: GameplayRngStream): number {
    let state = (this.states[stream] + 0x6d2b79f5) >>> 0;
    this.states[stream] = state;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(stream: GameplayRngStream, maxExclusive: number): number {
    if (!Number.isFinite(maxExclusive) || maxExclusive <= 0) return 0;
    return Math.floor(this.next(stream) * Math.floor(maxExclusive));
  }

  range(stream: GameplayRngStream, min: number, max: number): number {
    return min + (max - min) * this.next(stream);
  }

  snapshot(): RunRngSnapshot {
    return {
      seed: this.seed,
      states: { ...this.states },
    };
  }

  restore(snapshot: RunRngSnapshot): void {
    if (snapshot.seed !== this.seed) throw new Error('RunRng snapshot seed mismatch');
    for (const stream of GAMEPLAY_RNG_STREAMS) {
      const state = snapshot.states[stream];
      if (!Number.isInteger(state) || state < 0 || state > 0xffffffff) {
        throw new Error('Invalid RunRng stream state');
      }
      this.states[stream] = state >>> 0;
    }
  }
}
