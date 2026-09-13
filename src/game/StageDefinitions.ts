import { COLORS, type EnemyKind } from './config';

export type StageId = string;

export interface StageThemeDefinition {
  backgroundColor: number;
  plasmaTexture: string;
  accentColor: number;
  dangerColor: number;
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
  milestones: readonly StageMilestoneDefinition[];
}

const BLOODSTREAM: StageDefinition = {
  id: 'bloodstream',
  order: 1,
  name: 'КРОВОТОК',
  durationMs: 5 * 60 * 1000,
  // Stage 1 keeps its current direct boss spawn. PR 2 will turn on the warning ceremony.
  bossWarningLeadMs: 0,
  theme: {
    backgroundColor: COLORS.bg,
    plasmaTexture: 'blood-plasma',
    accentColor: COLORS.magenta,
    dangerColor: COLORS.red,
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
  boss: { id: 'immune-prime', name: 'IMMUNE PRIME', enemyKind: 'boss' },
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
      subtitle: 'ДО IMMUNE PRIME — 01:00',
      color: COLORS.red,
    },
  ],
};

export const STAGES: readonly StageDefinition[] = [BLOODSTREAM];

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
