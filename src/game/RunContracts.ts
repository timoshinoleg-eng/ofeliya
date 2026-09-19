import type { AchievementId } from './AchievementSystem';
import type { RunEndReason, StagePhase } from './StageDirector';
import type { StageId } from './StageDefinitions';
import type { EvolutionId } from './UpgradeSystem';
import type { DifficultyId } from './DifficultyProfile';
import type { LegendaryId } from './LegendarySystem';

export interface RunSnapshot {
  hp: number;
  maxHp: number;
  level: number;
  xp: number;
  xpNext: number;
  timeMs: number;
  stageTimeMs: number;
  kills: number;
  combo: number;
  bossHp: number;
  bossMax: number;
  bossName: string;
  stageId: StageId;
  stageOrder: number;
  stageName: string;
  phase: StagePhase;
}

export interface StageBuildResult {
  level: number;
  stacks: Record<string, number>;
  evolutions: EvolutionId[];
  legendaryIds: LegendaryId[];
  stageBuilds: Partial<Record<StageId, StageBuildResult>>;
}

export interface RunRecordFlags {
  timeRecord: boolean;
  killsRecord: boolean;
  levelRecord: boolean;
}

export interface RunResult {
  win: boolean;
  reason: RunEndReason;
  difficultyId: DifficultyId;
  timeMs: number;
  kills: number;
  hostCellsInfected: number;
  level: number;
  highestLevel: number;
  comboBest: number;
  stageId: StageId;
  stageOrder: number;
  bossesDefeated: number;
  /** Run-wide time when IMMUNE PRIME was defeated; 0 means it was not defeated. */
  boss1ClearMs: number;
  stacks: Record<string, number>;
  evolutions: EvolutionId[];
  newAchievements: AchievementId[];
  records: RunRecordFlags;
}
