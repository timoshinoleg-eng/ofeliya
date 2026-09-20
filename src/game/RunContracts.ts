[Reading 66 lines from start (total: 66 lines, 0 remaining)]

import type { AchievementId } from './AchievementSystem';
import type { RunEndReason, StagePhase } from './StageDirector';
import type { StageId } from './StageDefinitions';
import type { EvolutionId } from './UpgradeSystem';
import type { DifficultyId } from './DifficultyProfile';
import type { LegendaryId } from './LegendarySystem';
import type { ControlMode } from './ControlMode';

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
  /** Replays/challenges can reproduce gameplay-random decisions from this seed. */
  runSeed: string;
  controlMode: ControlMode;
  /** Local checkpoint resume is intentionally non-canonical for ranked Standard results. */
  resumed: boolean;
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
  legendaryIds: LegendaryId[];
  stageBuilds: Partial<Record<StageId, StageBuildResult>>;
  newAchievements: AchievementId[];
  records: RunRecordFlags;
}

[executed on device: chatgpt-ops-1 (ca22b74b-ed01-4519-b9df-03edbe57a1ba)]