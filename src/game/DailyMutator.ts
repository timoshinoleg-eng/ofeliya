import type { DifficultyProfile } from './DifficultyProfile';

/**
 * Daily mutator (P0-3): one authored global modifier per calendar day on the
 * daily-run path. The choice is a pure hash of the server ticket's dateKey,
 * so every player worldwide gets the identical modifier on a given day and
 * no runtime RNG is consumed (leaderboard fairness + save determinism).
 *
 * Pattern adapted from `ricardo-foundry/canvas-vampire-survivors` (MIT),
 * `src/daily.js`: deterministic per-UTC-day challenge derived from the date
 * string (their stage/boss rotation). OFELIYA rewrites the idea around its
 * own server-issued daily tickets and DifficultyProfile multiplier language;
 * no donor code is copied (the donor's local history/streak parts already
 * exist in OFELIYA as DailyHistory/SocialHub). See THIRD_PARTY_NOTICES.md.
 *
 * Pure module — no Phaser imports — unit-tested in plain Node
 * (`scripts/check-daily-mutator.mjs`).
 */

export interface DailyMutator {
  id: string;
  /** Banner copy (RU). */
  title: string;
  /** One-line readable effect description (RU). */
  subtitle: string;
  color: number;
  /** Applies the authored modifier to a resolved difficulty profile. */
  apply(profile: DifficultyProfile): DifficultyProfile;
}

type MultiplicativeKey = {
  [K in keyof DifficultyProfile]: DifficultyProfile[K] extends number ? K : never;
}[keyof DifficultyProfile];

type AdditiveKey = 'batchBonus' | 'normalEnemyCapBonus' | 'bossMinionBonus';

const clampMul = (value: number, min = 0.05, max = 20): number =>
  Math.min(max, Math.max(min, value));

/**
 * Composes a modifier from multiplicative deltas (existing value × delta)
 * and additive deltas (existing value + delta). Additive fields are the
 * small integer bonuses whose baseline is 0, where multiplication would be
 * a silent no-op.
 */
function withDeltas(
  profile: DifficultyProfile,
  patch: { mul?: Partial<Record<MultiplicativeKey, number>>; add?: Partial<Record<AdditiveKey, number>> }
): DifficultyProfile {
  const next: DifficultyProfile = { ...profile };
  for (const [key, delta] of Object.entries(patch.mul ?? {}) as Array<[MultiplicativeKey, number]>) {
    next[key] = clampMul(next[key] * delta);
  }
  for (const [key, delta] of Object.entries(patch.add ?? {}) as Array<[AdditiveKey, number]>) {
    next[key] = Math.max(0, Math.round(next[key] + delta));
  }
  return next;
}

/**
 * Authored pool. Every entry only re-combines existing DifficultyProfile
 * knobs — no new simulation systems, so dense-combat readability and the
 * 60 fps budget are untouched.
 */
export const DAILY_MUTATORS: readonly DailyMutator[] = [
  {
    id: 'dense-swarm',
    title: 'МУТАТОР ДНЯ · ПЛОТНЫЙ РОЙ',
    subtitle: 'ИММУННЫЕ ВЫХОДЯТ ГУСТЫМИ ВОЛНАМИ',
    color: 0xff9b66,
    apply: (profile) =>
      withDeltas(profile, { mul: { spawnIntervalMultiplier: 0.9 }, add: { batchBonus: 1 } }),
  },
  {
    id: 'frenzy-blood',
    title: 'МУТАТОР ДНЯ · ЛИХОРАДКА КРОВИ',
    subtitle: 'ЭЛИТКИ ЧАЩЕ · ВРАГИ БЫСТРЕЕ',
    color: 0xff4fb5,
    apply: (profile) =>
      withDeltas(profile, { mul: { eliteIntervalMultiplier: 0.75, enemySpeedMultiplier: 1.12 } }),
  },
  {
    id: 'iron-sheath',
    title: 'МУТАТОР ДНЯ · ЖЕЛЕЗНАЯ ОБОЛОЧКА',
    subtitle: 'ВРАГИ КРЕПЧЕ · ИХ УДАРЫ СЛАБЕЕ',
    color: 0x8fe8ff,
    apply: (profile) =>
      withDeltas(profile, { mul: { enemyHpMultiplier: 1.25, enemyDamageMultiplier: 0.9 } }),
  },
  {
    id: 'sparse-lethal',
    title: 'МУТАТОР ДНЯ · РЕДКИЙ, НО МЕТКИЙ',
    subtitle: 'РОЙ РЕЖЕ · КАЖДЫЙ УДАР ОПАСНЕЕ',
    color: 0xff3e5f,
    apply: (profile) =>
      withDeltas(profile, {
        mul: { spawnIntervalMultiplier: 1.15, enemyDamageMultiplier: 1.3, enemyHpMultiplier: 1.1 },
      }),
  },
  {
    id: 'cardiac-stress',
    title: 'МУТАТОР ДНЯ · СЕРДЕЧНЫЙ СТРЕСС',
    subtitle: 'РИТМ ЧАЩЕ · ДАВЛЕНИЕ СИЛЬНЕЕ',
    color: 0xff6b4a,
    apply: (profile) =>
      withDeltas(profile, {
        mul: { heartbeatIntervalMultiplier: 0.85, heartbeatPressureMultiplier: 1.2 },
      }),
  },
  {
    id: 'elite-surge',
    title: 'МУТАТОР ДНЯ · ЭЛИТНЫЙ НАПЛЫВ',
    subtitle: 'ЛИДЕРЫ РОЯ ВЫХОДЯТ ЧАЩЕ · СТАЯ БОЛЬШЕ',
    color: 0xffd56a,
    apply: (profile) =>
      withDeltas(profile, {
        mul: { eliteIntervalMultiplier: 0.6 },
        add: { normalEnemyCapBonus: 30, batchBonus: 1 },
      }),
  },
];

/**
 * FNV-1a 32-bit — small, fast, deterministic across engines. Not crypto:
 * the dateKey is public and the mutator choice needs no secrecy, only
 * stability (same string → same index on every client).
 */
export function hashDateKey(dateKey: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < dateKey.length; i++) {
    h ^= dateKey.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The modifier for a given day. Unknown/malformed dateKeys resolve through
 * the same hash, so the function is total — gameplay code never branches on
 * "no mutator".
 */
export function dailyMutatorForDate(dateKey: string): DailyMutator {
  const safe = typeof dateKey === 'string' && dateKey.length > 0 ? dateKey : '0000-00-00';
  return DAILY_MUTATORS[hashDateKey(safe) % DAILY_MUTATORS.length];
}

/** Convenience: mutator + patched profile in one call. */
export function applyDailyMutator(
  profile: DifficultyProfile,
  dateKey: string
): { mutator: DailyMutator; difficulty: DifficultyProfile } {
  const mutator = dailyMutatorForDate(dateKey);
  return { mutator, difficulty: mutator.apply(profile) };
}

/**
 * Local-calendar date key in the server's `localDateKey` format (YYYY-MM-DD,
 * see server/index.mjs). Used by menu-time UI (SocialHub) that has no server
 * ticket yet; the in-run choice always comes from the ticket's dateKey, and
 * both resolve to the same mutator because they hash the same calendar day.
 */
export function todayDateKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
