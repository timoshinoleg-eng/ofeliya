import { STAGES } from '../game/StageDefinitions';
import { xpForLevel, type RunStateCheckpoint, type StageBuildSnapshot } from '../game/RunState';
import {
  GAMEPLAY_RNG_STREAMS,
  type GameplayRngStream,
  type RunRngSnapshot,
} from '../game/RunRng';
import type { StageDirectorSnapshot, StagePhase } from '../game/StageDirector';
import type { WaveDirectorSnapshot } from '../game/WaveDirector';
import type { HeartbeatPulseSnapshot } from '../game/HeartbeatPulseDirector';
import type { HostCellSystemSnapshot } from './HostCellSystem';
import { UPGRADES, type EvolutionId } from '../game/UpgradeSystem';
import { LEGENDARIES, type LegendaryId } from '../game/LegendarySystem';
import type { DifficultyId } from '../game/DifficultyProfile';
import type { ControlMode } from '../game/ControlMode';
import { SCORE_CAMPAIGN_VERSION, SCORE_RULESET_VERSION } from '../game/RunVersions';

export const RUN_CHECKPOINT_SCHEMA_VERSION = 1;
export const RUN_CHECKPOINT_STORAGE_KEY = 'ofeliya_run_checkpoint_v1';

const SAFE_PHASES = new Set<StagePhase>(['PLAYING', 'BOSS_WARNING']);
const VALID_EVOLUTIONS = new Set<EvolutionId>(['prism', 'halo', 'singularity']);
const VALID_LEGENDARIES = new Set<LegendaryId>(LEGENDARIES.map((def) => def.id));
const STACK_MAX = new Map<string, number>(UPGRADES.map((def) => [def.id, def.max]));
STACK_MAX.set('heal', 99);

export interface RunCheckpointRuntime {
  playerX: number;
  playerY: number;
  lastCarrierUsed: boolean;
  heartbeatBeatIndex: number;
  zeroPointNextInMs: number;
}

export interface RunCheckpointData {
  schemaVersion: 1;
  rulesetVersion: number;
  campaignVersion: number;
  savedAtEpochMs: number;
  runSeed: string;
  difficultyId: DifficultyId;
  controlMode: ControlMode;
  resumed: boolean;
  director: StageDirectorSnapshot;
  runState: RunStateCheckpoint;
  rng: RunRngSnapshot;
  wave: WaveDirectorSnapshot;
  heartbeat: HeartbeatPulseSnapshot;
  hostCells: HostCellSystemSnapshot;
  runtime: RunCheckpointRuntime;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number {
  return finite(value, min, max) && Number.isInteger(value);
}

function nullableFinite(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): boolean {
  return value === null || finite(value, min, max);
}

function stringArrayOf<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  maxLength: number
): value is T[] {
  return (
    Array.isArray(value) &&
    value.length <= maxLength &&
    value.every((item) => typeof item === 'string' && allowed.has(item as T)) &&
    new Set(value).size === value.length
  );
}

function validStacks(value: unknown): value is Record<string, number> {
  if (!record(value)) return false;
  return Object.entries(value).every(([id, count]) => {
    const max = STACK_MAX.get(id);
    return max !== undefined && integer(count, 0, max);
  });
}

function validBuild(value: unknown): value is StageBuildSnapshot {
  if (!record(value)) return false;
  return (
    integer(value.level, 1, 500) &&
    validStacks(value.stacks) &&
    stringArrayOf(value.evolutions, VALID_EVOLUTIONS, VALID_EVOLUTIONS.size)
  );
}

function validStageBuilds(value: unknown): boolean {
  if (!record(value)) return false;
  const stageIds = new Set(STAGES.map((stage) => stage.id));
  return Object.entries(value).every(
    ([id, build]) => stageIds.has(id) && (build === undefined || validBuild(build))
  );
}

function validRunState(value: unknown, director: StageDirectorSnapshot): value is RunStateCheckpoint {
  if (!record(value) || !record(value.run) || !record(value.stage)) return false;
  const run = value.run;
  const stage = value.stage;
  const stageDef = STAGES.find((candidate) => candidate.id === director.stageId);
  if (!stageDef) return false;

  const scalarRun =
    finite(run.timeMs, 0, 24 * 60 * 60 * 1000) &&
    integer(run.kills, 0, 10_000_000) &&
    integer(run.hostCellsInfected, 0, 1_000_000) &&
    integer(run.comboBest, 0, 1_000_000) &&
    finite(run.maxNoDamageMs, 0, 24 * 60 * 60 * 1000) &&
    integer(run.bossesDefeated, 0, STAGES.length) &&
    integer(run.currentStageOrder, 1, STAGES.length) &&
    integer(run.highestStageOrder, run.currentStageOrder as number, STAGES.length) &&
    integer(run.legendaryPity, 0, 1_000_000) &&
    integer(run.legendaryOffersSeen, 0, 1_000_000) &&
    integer(run.highestLevel, 1, 500);
  if (!scalarRun) return false;

  if (
    run.currentStageOrder !== stageDef.order ||
    stage.id !== stageDef.id ||
    stage.order !== stageDef.order
  ) {
    return false;
  }

  if (!record(run.bossClearTimesMs)) return false;
  const bossIds = new Set(STAGES.map((item) => item.boss.id));
  if (
    !Object.entries(run.bossClearTimesMs).every(
      ([id, time]) => bossIds.has(id) && finite(time, 0, run.timeMs as number)
    )
  ) {
    return false;
  }

  if (
    !stringArrayOf(run.evolutionsSeen, VALID_EVOLUTIONS, VALID_EVOLUTIONS.size) ||
    !stringArrayOf(run.legendaryIds, VALID_LEGENDARIES, 2) ||
    !validStageBuilds(run.stageBuilds)
  ) {
    return false;
  }

  const scalarStage =
    finite(stage.timeMs, 0, stageDef.durationMs) &&
    integer(stage.level, 1, 500) &&
    finite(stage.xp, 0, 1_000_000) &&
    finite(stage.xpNext, 1, 1_000_000) &&
    integer(stage.kills, 0, run.kills as number) &&
    integer(stage.hostCellsInfected, 0, run.hostCellsInfected as number) &&
    integer(stage.combo, 0, 1_000_000) &&
    finite(stage.comboTimer, 0, 60_000) &&
    finite(stage.noDamageMs, 0, 24 * 60 * 60 * 1000) &&
    finite(stage.hp, Number.EPSILON, 1_000_000) &&
    finite(stage.maxHp, 1, 1_000_000) &&
    finite(stage.damageMul, Number.EPSILON, 10_000) &&
    finite(stage.fireRateMul, Number.EPSILON, 10_000) &&
    finite(stage.speedMul, Number.EPSILON, 10_000) &&
    finite(stage.magnetMul, Number.EPSILON, 10_000) &&
    integer(stage.projectiles, 1, 100) &&
    integer(stage.pierce, 0, 100) &&
    integer(stage.orbitBlades, 0, 100) &&
    integer(stage.novaLevel, 0, 100) &&
    finite(stage.regen, 0, 1_000) &&
    finite(stage.infectionSpeedMul, Number.EPSILON, 10_000) &&
    finite(stage.infectionRadiusMul, Number.EPSILON, 10_000) &&
    finite(stage.lysisDamageMul, Number.EPSILON, 10_000) &&
    finite(stage.lysisRadiusMul, Number.EPSILON, 10_000) &&
    finite(stage.lysisRnaBonus, 0, 1_000);
  if (!scalarStage) return false;

  if (
    (stage.hp as number) > (stage.maxHp as number) ||
    (stage.timeMs as number) > (run.timeMs as number) ||
    stage.xpNext !== xpForLevel(stage.level as number) ||
    !validStacks(stage.stacks) ||
    !stringArrayOf(stage.evolutions, VALID_EVOLUTIONS, VALID_EVOLUTIONS.size)
  ) {
    return false;
  }

  const seen = new Set(run.evolutionsSeen as EvolutionId[]);
  if (!(stage.evolutions as EvolutionId[]).every((id) => seen.has(id))) return false;

  const warningAt = Math.max(0, stageDef.durationMs - stageDef.bossWarningLeadMs);
  if (director.phase === 'PLAYING' && (stage.timeMs as number) >= stageDef.durationMs) return false;
  if (
    director.phase === 'BOSS_WARNING' &&
    ((stage.timeMs as number) < warningAt || (stage.timeMs as number) >= stageDef.durationMs)
  ) {
    return false;
  }

  return true;
}

function validDirector(value: unknown): value is StageDirectorSnapshot {
  if (!record(value)) return false;
  const stage = STAGES.find((candidate) => candidate.id === value.stageId);
  return (
    !!stage &&
    SAFE_PHASES.has(value.phase as StagePhase) &&
    value.runStarted === true &&
    integer(value.milestoneIndex, 0, stage.milestones.length)
  );
}

function validRng(value: unknown, seed: string): value is RunRngSnapshot {
  if (!record(value) || value.seed !== seed || !record(value.states)) return false;
  const states = value.states;
  return GAMEPLAY_RNG_STREAMS.every((stream: GameplayRngStream) =>
    integer(states[stream], 0, 0xffffffff)
  );
}

function validWave(value: unknown): value is WaveDirectorSnapshot {
  return (
    record(value) &&
    finite(value.spawnAcc, 0, 10_000_000) &&
    integer(value.spawnedElites, 0, 1_000_000) &&
    finite(value.minionAcc, 0, 10_000_000)
  );
}

function validHeartbeat(value: unknown): value is HeartbeatPulseSnapshot {
  return (
    record(value) &&
    finite(value.nextImpactAtMs, 0, 24 * 60 * 60 * 1000) &&
    nullableFinite(value.telegraphedImpactAtMs, 0, 24 * 60 * 60 * 1000) &&
    nullableFinite(value.pressureUntilMs, 0, 24 * 60 * 60 * 1000) &&
    typeof value.pressureBoss === 'boolean' &&
    typeof value.bossWasActive === 'boolean'
  );
}

function validHostCells(value: unknown): value is HostCellSystemSnapshot {
  if (
    !record(value) ||
    !finite(value.spawnAcc, 0, 10_000_000) ||
    typeof value.firstSpawned !== 'boolean' ||
    !Array.isArray(value.cells) ||
    value.cells.length !== 6
  ) {
    return false;
  }
  return value.cells.every(
    (slot) =>
      record(slot) &&
      typeof slot.active === 'boolean' &&
      finite(slot.infection, 0, 1) &&
      finite(slot.x, -10_000_000, 10_000_000) &&
      finite(slot.y, -10_000_000, 10_000_000) &&
      finite(slot.spawnedAgoMs, 0, 24 * 60 * 60 * 1000)
  );
}

function validRuntime(value: unknown): value is RunCheckpointRuntime {
  return (
    record(value) &&
    finite(value.playerX, -10_000_000, 10_000_000) &&
    finite(value.playerY, -10_000_000, 10_000_000) &&
    typeof value.lastCarrierUsed === 'boolean' &&
    integer(value.heartbeatBeatIndex, 0, 1_000_000) &&
    finite(value.zeroPointNextInMs, 0, 60_000)
  );
}

function migrateBoundary(value: unknown): unknown {
  if (!record(value)) return null;
  if (value.schemaVersion === RUN_CHECKPOINT_SCHEMA_VERSION) return value;
  return null;
}

export function isCheckpointSafePhase(phase: StagePhase): boolean {
  return SAFE_PHASES.has(phase);
}

export function validateRunCheckpoint(raw: unknown): RunCheckpointData | null {
  const value = migrateBoundary(raw);
  if (!record(value)) return null;

  if (
    value.schemaVersion !== RUN_CHECKPOINT_SCHEMA_VERSION ||
    value.rulesetVersion !== SCORE_RULESET_VERSION ||
    value.campaignVersion !== SCORE_CAMPAIGN_VERSION ||
    !finite(value.savedAtEpochMs, 1, 9_999_999_999_999) ||
    typeof value.runSeed !== 'string' ||
    !/^[A-Za-z0-9_-]{1,32}$/.test(value.runSeed) ||
    (value.difficultyId !== 'standard' && value.difficultyId !== 'strained') ||
    (value.controlMode !== 'one-hand' && value.controlMode !== 'two-hand') ||
    typeof value.resumed !== 'boolean' ||
    !validDirector(value.director) ||
    !validRunState(value.runState, value.director) ||
    !validRng(value.rng, value.runSeed) ||
    !validWave(value.wave) ||
    !validHeartbeat(value.heartbeat) ||
    !validHostCells(value.hostCells) ||
    !validRuntime(value.runtime)
  ) {
    return null;
  }

  if (
    value.heartbeat.telegraphedImpactAtMs !== null ||
    value.heartbeat.pressureUntilMs !== null ||
    value.heartbeat.bossWasActive
  ) {
    return null;
  }

  return value as unknown as RunCheckpointData;
}

function removeStoredCheckpoint(): void {
  try {
    localStorage.removeItem(RUN_CHECKPOINT_STORAGE_KEY);
  } catch {
    // Storage restrictions must never trap startup in a crash loop.
  }
}

export const RunCheckpoint = {
  load(): RunCheckpointData | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(RUN_CHECKPOINT_STORAGE_KEY);
      if (!raw) return null;
      const parsed = validateRunCheckpoint(JSON.parse(raw));
      if (!parsed) removeStoredCheckpoint();
      return parsed;
    } catch {
      removeStoredCheckpoint();
      return null;
    }
  },

  save(data: RunCheckpointData): boolean {
    if (typeof localStorage === 'undefined') return false;
    const valid = validateRunCheckpoint(data);
    if (!valid) return false;
    try {
      localStorage.setItem(RUN_CHECKPOINT_STORAGE_KEY, JSON.stringify(valid));
      return true;
    } catch {
      return false;
    }
  },

  clear(): void {
    if (typeof localStorage === 'undefined') return;
    removeStoredCheckpoint();
  },
};
