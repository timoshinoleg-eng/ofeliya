import { COLORS, type EnemyKind } from './config';

export type StageId = string;
export type StageAmbientProfile = 'bloodstream' | 'heart';
export type StageBossBehavior = 'pressure-wave' | 'heartbeat-pulse';
export type StageSignatureMechanic = 'none' | 'heartbeat-pulse';

export interface StageThemeDefinition {
  backgroundColor: number;
  plasmaTexture: string;
  structureTexture?: string;
  accentColor: number;
  dangerColor: number;
  particleTint: number;
  ambientProfile: StageAmbientProfile;
  heartbeatMs: number;
}

export interface StageDifficultyProfile {
  enemyHpPerMinute: number;
  enemyDamagePerMinute: number;
  bossHpScale: number;
  bossDamageScale: number;
}

export interface StageBossDefinition {
  id: string;
  name: string;
  enemyKind: 'boss';
  textureKey: string;
  behavior: StageBossBehavior;
}

export interface StageMilestoneDefinition {
  id: string;
  atMs: number;
  title: string;
  subtitle: string;
  color: number;
}

export interface StageOpeningSpawn {
  kind: Exclude<EnemyKind, 'boss'>;
  angle: number;
  radius: number;
}

export interface StageWaveProfile {
  spawnIntervalStartMs: number;
  spawnIntervalEndMs: number;
  batchEveryMs: number;
  maxBatchSize: number;
  eliteEveryMs: number;
  normalEnemyCap: number;
  bossPhaseSpawnMultiplier: number;
  bossMinionIntervalMs: number;
  bossMinionCount: number;
  bossMinionRadius: number;
  openingSpawns: readonly StageOpeningSpawn[];
  pickKind: (stageTimeMs: number, random: number) => Exclude<EnemyKind, 'boss'>;
}

export interface StageDefinition {
  id: StageId;
  order: number;
  name: string;
  durationMs: number;
  bossWarningLeadMs: number;
  theme: StageThemeDefinition;
  difficulty: StageDifficultyProfile;
  waves: StageWaveProfile;
  boss: StageBossDefinition;
  signatureMechanic: StageSignatureMechanic;
  milestones: readonly StageMilestoneDefinition[];
}

export const BLOODSTREAM_STAGE: StageDefinition = {
  id: 'bloodstream',
  order: 1,
  name: 'КРОВОТОК',
  durationMs: 5 * 60 * 1000,
  // Eight-second warning keeps the boss readable before combat locks into the boss phase.
  bossWarningLeadMs: 8_000,
  theme: {
    backgroundColor: COLORS.bg,
    plasmaTexture: 'blood-plasma',
    accentColor: COLORS.magenta,
    dangerColor: COLORS.red,
    particleTint: 0xffa2b6,
    ambientProfile: 'bloodstream',
    heartbeatMs: 0,
  },
  difficulty: {
    enemyHpPerMinute: 0.42,
    enemyDamagePerMinute: 0.12,
    bossHpScale: 1,
    bossDamageScale: 1,
  },
  waves: {
    spawnIntervalStartMs: 1150,
    spawnIntervalEndMs: 330,
    batchEveryMs: 45_000,
    maxBatchSize: 5,
    eliteEveryMs: 120_000,
    normalEnemyCap: 240,
    bossPhaseSpawnMultiplier: 0.35,
    bossMinionIntervalMs: 12_000,
    bossMinionCount: 6,
    bossMinionRadius: 130,
    openingSpawns: [
      { kind: 'swarm', angle: -0.28, radius: 150 },
      { kind: 'swarm', angle: 2.1, radius: 205 },
      { kind: 'swarm', angle: 3.9, radius: 235 },
    ],
    pickKind: (stageTimeMs, random) => {
      if (stageTimeMs < 90_000) return 'swarm';
      if (stageTimeMs < 120_000) return random < 0.78 ? 'swarm' : 'runner';
      if (stageTimeMs < 180_000) {
        return random < 0.6 ? 'swarm' : random < 0.9 ? 'runner' : 'brute';
      }
      return random < 0.48 ? 'swarm' : random < 0.79 ? 'runner' : 'brute';
    },
  },
  boss: {
    id: 'immune-prime',
    name: 'ИММУННЫЙ ПРАЙМ',
    enemyKind: 'boss',
    textureKey: 'immune-prime',
    behavior: 'pressure-wave',
  },
  signatureMechanic: 'none',
  milestones: [
    {
      id: 'rna-detected',
      atMs: 15_000,
      title: 'ЧУЖЕРОДНАЯ РНК ОБНАРУЖЕНА',
      subtitle: 'ИММУНИТЕТ НАЧИНАЕТ ПОИСК',
      color: COLORS.cyan,
    },
    {
      id: 'immune-response',
      atMs: 45_000,
      title: 'ИММУННЫЙ ОТВЕТ АКТИВИРОВАН',
      subtitle: 'АНТИТЕЛА МОБИЛИЗОВАНЫ',
      color: COLORS.orange,
    },
    {
      id: 't-cell-response',
      atMs: 90_000,
      title: 'T-КЛЕТКИ ПОДКЛЮЧЕНЫ',
      subtitle: 'ОХОТА НА ШТАММ УСКОРЯЕТСЯ',
      color: COLORS.purple,
    },
    {
      id: 'adaptive-immunity',
      atMs: 120_000,
      title: 'АДАПТИВНЫЙ ИММУНИТЕТ',
      subtitle: 'NK-КЛЕТКИ В ПОИСКЕ',
      color: COLORS.gold,
    },
    {
      id: 'systemic-response',
      atMs: 180_000,
      title: 'СИСТЕМНЫЙ ОТВЕТ',
      subtitle: 'КРОВОТОК НЕСТАБИЛЕН',
      color: COLORS.magenta,
    },
    {
      id: 'critical-immune-response',
      atMs: 240_000,
      title: 'КРИТИЧЕСКАЯ ИММУННАЯ РЕАКЦИЯ',
      subtitle: 'ДО ИММУННОГО ПРАЙМА — 01:00',
      color: COLORS.red,
    },
  ],
};

/** Second live campaign stage, entered transactionally after Bloodstream boss defeat. */
export const HEART_STAGE: StageDefinition = {
  id: 'heart',
  order: 2,
  name: 'СЕРДЦЕ',
  durationMs: 4 * 60 * 1000,
  bossWarningLeadMs: 8_000,
  theme: {
    backgroundColor: 0x16060d,
    plasmaTexture: 'heart-plasma',
    structureTexture: 'cardiac-fiber',
    accentColor: 0xff6b4a,
    dangerColor: 0xff315e,
    particleTint: 0xffb36b,
    ambientProfile: 'heart',
    heartbeatMs: 900,
  },
  difficulty: {
    enemyHpPerMinute: 0.52,
    enemyDamagePerMinute: 0.16,
    bossHpScale: 1.35,
    bossDamageScale: 1.2,
  },
  waves: {
    spawnIntervalStartMs: 950,
    spawnIntervalEndMs: 290,
    batchEveryMs: 38_000,
    maxBatchSize: 6,
    eliteEveryMs: 90_000,
    normalEnemyCap: 240,
    bossPhaseSpawnMultiplier: 0.4,
    bossMinionIntervalMs: 10_000,
    bossMinionCount: 7,
    bossMinionRadius: 145,
    openingSpawns: [
      { kind: 'runner', angle: 0.2, radius: 170 },
      { kind: 'swarm', angle: 2.4, radius: 215 },
      { kind: 'brute', angle: 4.3, radius: 255 },
    ],
    pickKind: (stageTimeMs, random) => {
      if (stageTimeMs < 60_000) {
        return random < 0.48 ? 'swarm' : random < 0.86 ? 'runner' : 'brute';
      }
      if (stageTimeMs < 150_000) {
        return random < 0.36 ? 'swarm' : random < 0.78 ? 'runner' : 'brute';
      }
      return random < 0.28 ? 'swarm' : random < 0.68 ? 'runner' : 'brute';
    },
  },
  boss: {
    id: 'cardiac-titan',
    name: 'КАРДИАЛЬНЫЙ ТИТАН',
    enemyKind: 'boss',
    textureKey: 'cardiac-titan',
    behavior: 'heartbeat-pulse',
  },
  signatureMechanic: 'heartbeat-pulse',
  milestones: [
    {
      id: 'myocardium-entered',
      atMs: 20_000,
      title: 'МИОКАРД ДОСТИГНУТ',
      subtitle: 'СРЕДА СОКРАЩАЕТСЯ ВМЕСТЕ С РИТМОМ',
      color: 0xff8a65,
    },
    {
      id: 'rhythm-locked',
      atMs: 75_000,
      title: 'СЕРДЕЧНЫЙ РИТМ СИНХРОНИЗИРОВАН',
      subtitle: 'ИММУННЫЕ КЛЕТКИ УСКОРЯЮТСЯ В ТАКТ',
      color: 0xffb36b,
    },
    {
      id: 'cardiac-pressure',
      atMs: 150_000,
      title: 'ДАВЛЕНИЕ РАСТЁТ',
      subtitle: 'СОКРАЩЕНИЯ СТАНОВЯТСЯ ЧАЩЕ',
      color: 0xff6b4a,
    },
    {
      id: 'titan-approach',
      atMs: 210_000,
      title: 'КАРДИАЛЬНЫЙ СТРАЖ ПРОБУЖДАЕТСЯ',
      subtitle: 'ДО КАРДИАЛЬНОГО ТИТАНА — 00:30',
      color: 0xff315e,
    },
  ],
};

// Live campaign order. StageDirector validates contiguous order and owns all transitions.
export const STAGES: readonly StageDefinition[] = [BLOODSTREAM_STAGE, HEART_STAGE];

export function getStageById(id: StageId): StageDefinition | undefined {
  return STAGES.find((stage) => stage.id === id);
}

export function getStageByOrder(order: number): StageDefinition | undefined {
  return STAGES.find((stage) => stage.order === order);
}

export function nextStage(stage: StageDefinition): StageDefinition | undefined {
  return getStageByOrder(stage.order + 1);
}

export function difficultyForStage(
  stage: StageDefinition,
  stageTimeMs: number
): { hpScale: number; dmgScale: number } {
  const minutes = Math.max(0, stageTimeMs) / 60_000;
  return {
    hpScale: 1 + minutes * stage.difficulty.enemyHpPerMinute,
    dmgScale: 1 + minutes * stage.difficulty.enemyDamagePerMinute,
  };
}