import type { HeartbeatPulseProfile } from './HeartbeatPulseDirector';
import { HEARTBEAT_PULSE_PROFILE } from './HeartbeatPulseDirector';

export type DifficultyId = 'easy' | 'standard' | 'strained';
export type EliteModifierId = 'regenerator' | 'frenzied' | 'volatile';
export type DifficultyMutatorId = 'adaptive-elites' | 'accelerated-heartbeat';

export interface DifficultyProfile {
  id: DifficultyId;
  label: string;
  shortLabel: string;
  description: string;
  enemyHpMultiplier: number;
  enemyDamageMultiplier: number;
  enemySpeedMultiplier: number;
  spawnIntervalMultiplier: number;
  batchBonus: number;
  eliteIntervalMultiplier: number;
  normalEnemyCapBonus: number;
  bossHpMultiplier: number;
  bossDamageMultiplier: number;
  bossSpeedMultiplier: number;
  bossMinionIntervalMultiplier: number;
  bossMinionBonus: number;
  threatCapStart: number | null;
  threatCapEnd: number | null;
  eliteModifiers: readonly EliteModifierId[];
  mutators: readonly DifficultyMutatorId[];
  heartbeatIntervalMultiplier: number;
  heartbeatPressureMultiplier: number;
}

/**
 * Beginner-friendly tier. It reduces INCOMING pressure only: enemy HP and boss HP
 * stay identical to Standard so the player's damage output, the kill rate and the
 * mutation cadence remain the real ones. Nothing here grants permanent progression,
 * invulnerability or extra player damage.
 */
export const EASY_DIFFICULTY: DifficultyProfile = {
  id: 'easy',
  label: 'ЛЁГКИЙ',
  shortLabel: 'ЛЁГКИЙ',
  // Two short lines keep the copy inside the Menu selector panel at every
  // width: "a more relaxed mode for the basics" — controls and mechanics.
  description: 'Более спокойный\nрежим для основ',
  // Damage is the first thing a beginner meets: halving it roughly doubles the
  // number of mistakes the player can absorb before the run ends.
  enemyHpMultiplier: 1,
  enemyDamageMultiplier: 0.55,
  enemySpeedMultiplier: 0.92,
  // Slower waves and one enemy less per batch keep the field readable.
  spawnIntervalMultiplier: 1.25,
  batchBonus: -1,
  eliteIntervalMultiplier: 1.6,
  normalEnemyCapBonus: -20,
  // Bosses stay real fights: same HP, softer hits, slower approach.
  bossHpMultiplier: 1,
  bossDamageMultiplier: 0.6,
  bossSpeedMultiplier: 0.95,
  bossMinionIntervalMultiplier: 1.35,
  bossMinionBonus: -2,
  // A hard ceiling on simultaneous threat. The field degrades to cheap swarm units
  // instead of emptying out, so the player is never left without a target.
  threatCapStart: 26,
  threatCapEnd: 52,
  eliteModifiers: [],
  mutators: [],
  // Fewer heartbeat decisions in the Heart stage.
  heartbeatIntervalMultiplier: 1.2,
  heartbeatPressureMultiplier: 0.85,
};

export const STANDARD_DIFFICULTY: DifficultyProfile = {
  id: 'standard',
  label: 'СТАНДАРТ',
  shortLabel: 'СТАНДАРТ',
  description: 'Базовый ритм кампании',
  enemyHpMultiplier: 1,
  enemyDamageMultiplier: 1,
  enemySpeedMultiplier: 1,
  spawnIntervalMultiplier: 1,
  batchBonus: 0,
  eliteIntervalMultiplier: 1,
  normalEnemyCapBonus: 0,
  bossHpMultiplier: 1,
  bossDamageMultiplier: 1,
  bossSpeedMultiplier: 1,
  bossMinionIntervalMultiplier: 1,
  bossMinionBonus: 0,
  threatCapStart: null,
  threatCapEnd: null,
  eliteModifiers: [],
  mutators: [],
  heartbeatIntervalMultiplier: 1,
  heartbeatPressureMultiplier: 1,
};

export const STRAINED_DIFFICULTY: DifficultyProfile = {
  id: 'strained',
  label: 'НАПРЯЖЕНИЕ',
  shortLabel: 'НАПРЯЖЕНИЕ',
  description: 'Особые клетки мутируют · давление растёт',
  enemyHpMultiplier: 1.08,
  enemyDamageMultiplier: 1.12,
  enemySpeedMultiplier: 1.06,
  spawnIntervalMultiplier: 0.84,
  batchBonus: 1,
  eliteIntervalMultiplier: 0.68,
  normalEnemyCapBonus: 20,
  bossHpMultiplier: 1.12,
  bossDamageMultiplier: 1.15,
  bossSpeedMultiplier: 1.08,
  bossMinionIntervalMultiplier: 0.78,
  bossMinionBonus: 2,
  threatCapStart: 42,
  threatCapEnd: 82,
  eliteModifiers: ['regenerator', 'frenzied', 'volatile'],
  mutators: ['adaptive-elites', 'accelerated-heartbeat'],
  heartbeatIntervalMultiplier: 0.78,
  heartbeatPressureMultiplier: 1.12,
};

export const DIFFICULTY_PROFILES: Record<DifficultyId, DifficultyProfile> = {
  easy: EASY_DIFFICULTY,
  standard: STANDARD_DIFFICULTY,
  strained: STRAINED_DIFFICULTY,
};

/**
 * Selector order, easiest first. The Menu selector cycles through this list.
 * Existing modes keep their own ids and their own tuning — only the cycle changes.
 */
export const DIFFICULTY_ORDER: readonly DifficultyId[] = ['easy', 'standard', 'strained'];

/**
 * The only difficulty that owns a ranked place. Every other tier is unranked and
 * must never reach a leaderboard, a duel contract or the Daily board.
 */
export const RANKED_DIFFICULTY_ID: DifficultyId = 'standard';

export const DIFFICULTY_STORAGE_KEY = 'ofeliya_difficulty_v1';

export function isDifficultyId(value: unknown): value is DifficultyId {
  return typeof value === 'string' && (DIFFICULTY_ORDER as readonly string[]).includes(value);
}

/** True only for the ranked Standard tier. */
export function isRankedDifficulty(id: DifficultyId): boolean {
  return id === RANKED_DIFFICULTY_ID;
}

/**
 * True when a run of this difficulty may be posted to the score endpoint.
 *
 * Standard is the ranked tier. Strained keeps its historic contract: the server
 * accepts it but never ranks it. Easy is never posted at all, so it can neither
 * claim a place nor contaminate any server-side board.
 */
export function isScoreSubmittable(id: DifficultyId): boolean {
  return id !== 'easy';
}

export function getDifficultyProfile(id: unknown): DifficultyProfile {
  if (id === 'easy') return EASY_DIFFICULTY;
  if (id === 'strained') return STRAINED_DIFFICULTY;
  return STANDARD_DIFFICULTY;
}

export function nextDifficultyId(id: DifficultyId): DifficultyId {
  const index = DIFFICULTY_ORDER.indexOf(id);
  // An unknown id fails safe to Standard, never to the new beginner tier.
  if (index < 0) return 'standard';
  return DIFFICULTY_ORDER[(index + 1) % DIFFICULTY_ORDER.length] ?? 'standard';
}

export function readDifficultySelection(): DifficultyId {
  if (typeof localStorage === 'undefined') return 'standard';
  try {
    const stored = localStorage.getItem(DIFFICULTY_STORAGE_KEY);
    // A stored value from an older build ('standard'/'strained') stays valid.
    // Anything unknown fails safe to Standard.
    return isDifficultyId(stored) ? stored : 'standard';
  } catch {
    return 'standard';
  }
}

export function writeDifficultySelection(id: DifficultyId): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(DIFFICULTY_STORAGE_KEY, id);
  } catch {
    // A blocked WebView storage backend must never prevent a run from starting.
  }
}

export function pickEliteModifier(
  profile: DifficultyProfile,
  random: () => number = Math.random
): EliteModifierId | null {
  if (profile.eliteModifiers.length === 0) return null;
  const index = Math.min(
    profile.eliteModifiers.length - 1,
    Math.floor(Math.max(0, Math.min(0.999999, random())) * profile.eliteModifiers.length)
  );
  return profile.eliteModifiers[index] ?? null;
}

export function heartbeatProfileForDifficulty(profile: DifficultyProfile): HeartbeatPulseProfile {
  return {
    ...HEARTBEAT_PULSE_PROFILE,
    firstImpactAtMs: Math.round(
      HEARTBEAT_PULSE_PROFILE.firstImpactAtMs * profile.heartbeatIntervalMultiplier
    ),
    intervalMs: Math.round(
      HEARTBEAT_PULSE_PROFILE.intervalMs * profile.heartbeatIntervalMultiplier
    ),
    bossIntervalMs: Math.round(
      HEARTBEAT_PULSE_PROFILE.bossIntervalMs * profile.heartbeatIntervalMultiplier
    ),
    bossFirstImpactDelayMs: Math.round(
      HEARTBEAT_PULSE_PROFILE.bossFirstImpactDelayMs * profile.heartbeatIntervalMultiplier
    ),
    pressureMultiplier:
      1 + (HEARTBEAT_PULSE_PROFILE.pressureMultiplier - 1) * profile.heartbeatPressureMultiplier,
    bossPressureMultiplier:
      1 + (HEARTBEAT_PULSE_PROFILE.bossPressureMultiplier - 1) * profile.heartbeatPressureMultiplier,
  };
}
