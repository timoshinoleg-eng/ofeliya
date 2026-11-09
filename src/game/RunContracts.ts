import type { AchievementId } from './AchievementSystem';
import type { RunEndReason, StagePhase } from './StageDirector';
import type { StageId } from './StageDefinitions';
import type { EvolutionId } from './UpgradeSystem';
import type { DifficultyId } from './DifficultyProfile';
import type { LegendaryId } from './LegendarySystem';
import type { ControlMode } from './ControlMode';
import type { NewCodexEntry } from './runCodexOpenings';
import type { DailyResultBranch } from './DailyRunIntent';
import type { DuelChallengeSnapshot } from './Duel';
import type { ChallengePayload } from './Challenge';

export interface RunSnapshot {
  hp: number;
  maxHp: number;
  level: number;
  xp: number;
  xpNext: number;
  timeMs: number;
  stageTimeMs: number;
  kills: number;
  hostCellsInfected: number;
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
  /**
   * Entries this run opened in the Codex for the first time. Snapshot taken
   * in `GameScene.finish` before `SaveSystem.recordRun` merged the run's
   * choices into the save; a re-show reuses this snapshot, never recomputes
   * it (after the merge the diff would be empty). Achievements are not
   * openings and are not part of this list.
   */
  newCodexEntries: NewCodexEntry[];
  stageBuilds: Partial<Record<StageId, StageBuildResult>>;
  newAchievements: AchievementId[];
  records: RunRecordFlags;
}

/**
 * A finished run kept alive across the Codex transition, so the result
 * screen can be re-shown from the Menu without starting the Game scene.
 * Written at the opening-row tap (and only there), before the Game scene
 * is stopped: the Game SHUTDOWN handler removes `runResult` from the
 * registry, so the re-show cannot read it back.
 *
 * `dailyBranch` is the branch resolved at the first render. The first
 * render clears the daily intent and ticket (`clearDailyIntent`), so a
 * re-show cannot re-resolve the branch from the registry: without the
 * snapshot a daily result would re-render as a ranked standard one.
 *
 * `duelChallenge` and `challengeTarget` are snapshotted for the same
 * reason: the Menu's `create()` resets both when it starts after the
 * Codex transition (`duelChallenge` to null, `challengeTarget` to the
 * incoming link, usually null). Without them the re-shown result could
 * not offer a duel rematch or a challenge share. The snapshot is a
 * render-only fact — it never re-runs `finish`, `recordRun`, the score
 * submit, or the video interstitial.
 */
export interface LastRunResult {
  result: RunResult;
  dailyBranch: DailyResultBranch;
  duelChallenge: DuelChallengeSnapshot | null;
  challengeTarget: ChallengePayload | null;
}