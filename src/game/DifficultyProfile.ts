import type { HeartbeatPulseProfile } from './HeartbeatPulseDirector';
import { HEARTBEAT_PULSE_PROFILE } from './HeartbeatPulseDirector';

export type DifficultyId = 'standard' | 'strained';
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

export const STANDARD_DIFFICULTY: DifficultyProfile = {
  id: 'standard',
  label: 'СТАНДАРТ',
  shortLabel: 'STANDARD',
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
  shortLabel: 'STRAINED',
  description: 'Элиты мутируют · давление растёт',
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
  standard: STANDARD_DIFFICULTY,
  strained: STRAINED_DIFFICULTY,
};

export const DIFFICULTY_STORAGE_KEY = 'ofeliya_difficulty_v1';

export function getDifficultyProfile(id: unknown): DifficultyProfile {
  return id === 'strained' ? STRAINED_DIFFICULTY : STANDARD_DIFFICULTY;
}

export function nextDifficultyId(id: DifficultyId): DifficultyId {
  return id === 'standard' ? 'strained' : 'standard';
}

export function readDifficultySelection(): DifficultyId {
  if (typeof localStorage === 'undefined') return 'standard';
  try {
    return localStorage.getItem(DIFFICULTY_STORAGE_KEY) === 'strained' ? 'strained' : 'standard';
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
  if (profile.id === 'standard') return { ...HEARTBEAT_PULSE_PROFILE };
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
