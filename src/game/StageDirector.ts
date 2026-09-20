[Reading 177 lines from start (total: 177 lines, 0 remaining)]

import type { StageDefinition, StageMilestoneDefinition } from './StageDefinitions';

export type StagePhase =
  | 'STAGE_START'
  | 'PLAYING'
  | 'BOSS_WARNING'
  | 'BOSS_ACTIVE'
  | 'BOSS_DEFEATED'
  | 'STAGE_TRANSITION'
  | 'RUN_ENDED';

export type RunEndReason = 'defeat' | 'campaign-complete' | 'abandoned';

export interface StageDirectorSnapshot {
  stageId: string;
  phase: StagePhase;
  milestoneIndex: number;
  runStarted: boolean;
}

export type StageDirectorEvent =
  | { type: 'stage-started'; stage: StageDefinition }
  | { type: 'milestone'; stage: StageDefinition; milestone: StageMilestoneDefinition }
  | { type: 'boss-warning'; stage: StageDefinition }
  | { type: 'boss-spawn-requested'; stage: StageDefinition }
  | { type: 'boss-defeated'; stage: StageDefinition }
  | { type: 'stage-transition-requested'; from: StageDefinition; to: StageDefinition }
  | { type: 'run-ended'; stage: StageDefinition; reason: RunEndReason };

/** Pure lifecycle authority. Phaser systems react to returned events, never infer transitions. */
export class StageDirector {
  private readonly stages: readonly StageDefinition[];
  private stageIndex = 0;
  private milestoneIndex = 0;
  private runStarted = false;

  phase: StagePhase = 'STAGE_START';

  constructor(stages: readonly StageDefinition[]) {
    if (stages.length === 0) throw new Error('StageDirector requires at least one stage');
    const orders = new Set<number>();
    const ids = new Set<string>();
    for (const stage of stages) {
      if (orders.has(stage.order)) throw new Error(`Duplicate stage order: ${stage.order}`);
      if (ids.has(stage.id)) throw new Error(`Duplicate stage id: ${stage.id}`);
      if (!Number.isFinite(stage.durationMs) || stage.durationMs <= 0) {
        throw new Error(`Invalid duration for stage: ${stage.id}`);
      }
      if (stage.bossWarningLeadMs < 0 || stage.bossWarningLeadMs > stage.durationMs) {
        throw new Error(`Invalid boss warning for stage: ${stage.id}`);
      }
      let lastMilestoneMs = -1;
      for (const milestone of stage.milestones) {
        if (
          milestone.atMs < lastMilestoneMs ||
          milestone.atMs < 0 ||
          milestone.atMs > stage.durationMs
        ) {
          throw new Error(`Invalid milestone order for stage: ${stage.id}`);
        }
        lastMilestoneMs = milestone.atMs;
      }
      orders.add(stage.order);
      ids.add(stage.id);
    }
    this.stages = [...stages].sort((a, b) => a.order - b.order);
    this.stages.forEach((stage, index) => {
      if (stage.order !== index + 1) throw new Error(`Missing stage order: ${index + 1}`);
    });
  }

  get currentStage(): StageDefinition {
    return this.stages[this.stageIndex];
  }

  startRun(): StageDirectorEvent[] {
    if (this.runStarted) return [];
    this.runStarted = true;
    return this.startStage();
  }

  startStage(): StageDirectorEvent[] {
    if (this.phase !== 'STAGE_START') return [];
    this.phase = 'PLAYING';
    return [{ type: 'stage-started', stage: this.currentStage }];
  }

  update(stageTimeMs: number): StageDirectorEvent[] {
    if (this.phase !== 'PLAYING' && this.phase !== 'BOSS_WARNING') return [];
    const events: StageDirectorEvent[] = [];
    const stage = this.currentStage;

    while (
      this.milestoneIndex < stage.milestones.length &&
      stageTimeMs >= stage.milestones[this.milestoneIndex].atMs
    ) {
      events.push({
        type: 'milestone',
        stage,
        milestone: stage.milestones[this.milestoneIndex],
      });
      this.milestoneIndex += 1;
    }

    const warningAtMs = Math.max(0, stage.durationMs - stage.bossWarningLeadMs);
    if (this.phase === 'PLAYING' && stage.bossWarningLeadMs > 0 && stageTimeMs >= warningAtMs) {
      this.phase = 'BOSS_WARNING';
      events.push({ type: 'boss-warning', stage });
    }

    if (stageTimeMs >= stage.durationMs) {
      this.phase = 'BOSS_ACTIVE';
      events.push({ type: 'boss-spawn-requested', stage });
    }
    return events;
  }

  bossDefeated(): StageDirectorEvent[] {
    if (this.phase !== 'BOSS_ACTIVE') return [];
    const stage = this.currentStage;
    this.phase = 'BOSS_DEFEATED';
    return [{ type: 'boss-defeated', stage }];
  }

  completeBossDefeat(): StageDirectorEvent[] {
    if (this.phase !== 'BOSS_DEFEATED') return [];
    const stage = this.currentStage;
    const next = this.stages[this.stageIndex + 1];
    if (!next) {
      this.phase = 'RUN_ENDED';
      return [{ type: 'run-ended', stage, reason: 'campaign-complete' }];
    }

    this.phase = 'STAGE_TRANSITION';
    return [{ type: 'stage-transition-requested', from: stage, to: next }];
  }

  completeTransition(): StageDirectorEvent[] {
    if (this.phase !== 'STAGE_TRANSITION' || !this.stages[this.stageIndex + 1]) return [];
    this.stageIndex += 1;
    this.milestoneIndex = 0;
    this.phase = 'STAGE_START';
    return [];
  }

  endRun(reason: RunEndReason): StageDirectorEvent[] {
    if (this.phase === 'RUN_ENDED') return [];
    this.phase = 'RUN_ENDED';
    return [{ type: 'run-ended', stage: this.currentStage, reason }];
  }

  snapshot(): StageDirectorSnapshot {
    return {
      stageId: this.currentStage.id,
      phase: this.phase,
      milestoneIndex: this.milestoneIndex,
      runStarted: this.runStarted,
    };
  }

  restore(snapshot: StageDirectorSnapshot): void {
    const index = this.stages.findIndex((stage) => stage.id === snapshot.stageId);
    if (index < 0) throw new Error('Unknown checkpoint stage');
    const stage = this.stages[index];
    if (
      !Number.isInteger(snapshot.milestoneIndex) ||
      snapshot.milestoneIndex < 0 ||
      snapshot.milestoneIndex > stage.milestones.length
    ) {
      throw new Error('Invalid checkpoint milestone index');
    }
    this.stageIndex = index;
    this.milestoneIndex = snapshot.milestoneIndex;
    this.phase = snapshot.phase;
    this.runStarted = snapshot.runStarted;
  }
}

[executed on device: chatgpt-ops-1 (ca22b74b-ed01-4519-b9df-03edbe57a1ba)]