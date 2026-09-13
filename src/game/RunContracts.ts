import type { AchievementId } from './AchievementSystem';
import type { RunEndReason, StagePhase } from './StageDirector';
import type { StageId } from './StageDefinitions';
import type { EvolutionId } from './UpgradeSystem';

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

export interface RunRecordFlags {
  timeRecord: boolean;
  killsRecord: boolean;
  levelRecord: boolean;
}

export interface RunResult {
  win: boolean;
  reason: RunEndReason;
  timeMs: number;
  kills: number;
  hostCellsInfected: number;
  level: number;
  comboBest: number;
  stageId: StageId;
  stageOrder: number;
  bossesDefeated: number;
  stacks: Record<string, number>;
  evolutions: EvolutionId[];
  newAchievements: AchievementId[];
  records: RunRecordFlags;
}
