/**
 * QA render comparison — paired, within-run A/B windows for GEMS / ATMO / UI.
 *
 * Enable only in the existing QA-gated GameScene with `?qaCompare=render`.
 * For each group the controller samples the original visibility, flips only that
 * group, then samples the original visibility again. Each window discards 30
 * warmup frames, then measures 120 active rendered frames; each group repeats
 * the A/B/A sequence three times. Object counts and quality tier are recorded
 * with every window because battle state continues to change during the test.
 *
 * Completed windows are written to localStorage. If the player dies (or the
 * player stops the automation with a manual toggle), the current partial window
 * is finalized and persisted before the original visibility selection is
 * restored. No gameplay or production behavior is changed.
 */
import { QA_HIDE_GROUPS, toggleQaHide, type QaHideGroup } from './qaHide';

export const QA_RENDER_COMPARE_PARAM = 'qaCompare';
export const QA_RENDER_COMPARE_VALUE = 'render';
export const QA_RENDER_COMPARE_STORAGE_KEY = 'ofeliya_qa_render_comparison_v2';
export const QA_RENDER_COMPARE_PHASE_FRAMES = 120;
export const QA_RENDER_COMPARE_REPEATS = 3;
export const QA_RENDER_COMPARE_WARMUP_FRAMES = 30;

export function isQaRenderComparisonEnabled(search: string): boolean {
  return new URLSearchParams(search).get(QA_RENDER_COMPARE_PARAM) === QA_RENDER_COMPARE_VALUE;
}

export interface QaRenderCompareCounters {
  enemies: number;
  bullets: number;
  gems: number;
  density: number;
  tier: string;
}

export interface QaRenderCompareSample {
  frameMs: number;
  renderMs: number;
  counters: QaRenderCompareCounters;
}

export type QaRenderCompareCondition = 'baseline-before' | 'opposite' | 'baseline-after';
export type QaRenderCompareStopReason = 'completed' | 'player-death' | 'run-ended' | 'manual-stop';

export interface QaRenderCompareCounterSummary {
  enemiesAvg: number;
  enemiesMax: number;
  bulletsAvg: number;
  bulletsMax: number;
  gemsAvg: number;
  gemsMax: number;
  densityAvg: number;
  densityMax: number;
  tier: string;
}

export interface QaRenderComparePhase {
  index: number;
  repeatIndex: number;
  group: QaHideGroup;
  condition: QaRenderCompareCondition;
  hiddenGroups: QaHideGroup[];
  warmupFrames: number;
  frames: number;
  complete: boolean;
  frameAvgMs: number | null;
  frameMaxMs: number | null;
  frameP95Ms: number | null;
  renderAvgMs: number | null;
  counters: QaRenderCompareCounterSummary | null;
}

export interface QaRenderComparePair {
  group: QaHideGroup;
  repeatCount: number;
  baselineWindows: number;
  oppositeWindows: number;
  originalHidden: boolean;
  oppositeHidden: boolean;
  baselineFrames: number;
  oppositeFrames: number;
  baselineFrameAvgMs: number | null;
  oppositeFrameAvgMs: number | null;
  frameDeltaMs: number | null;
  baselineFrameMaxMs: number | null;
  oppositeFrameMaxMs: number | null;
  frameMaxDeltaMs: number | null;
  baselineFrameP95Ms: number | null;
  oppositeFrameP95Ms: number | null;
  frameP95DeltaMs: number | null;
  baselineRenderAvgMs: number | null;
  oppositeRenderAvgMs: number | null;
  renderDeltaMs: number | null;
}

export interface QaRenderCompareSnapshot {
  schemaVersion: 2;
  status: 'running' | 'complete' | 'interrupted';
  stopReason: QaRenderCompareStopReason | null;
  startedAt: string;
  updatedAt: string;
  phaseFrames: number;
  warmupFrames: number;
  repeats: number;
  plannedPhases: number;
  originalHiddenGroups: QaHideGroup[];
  persistence: 'saved' | 'unavailable';
  phases: QaRenderComparePhase[];
  currentPhase: QaRenderComparePhase | null;
  comparisons: QaRenderComparePair[];
}

export interface QaRenderCompareStorage {
  setItem(key: string, value: string): void;
}

/** Serialize a render-comparison snapshot for clipboard export and issue reports. */
export function formatQaRenderComparisonReport(snapshot: QaRenderCompareSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

interface PhasePlan {
  group: QaHideGroup;
  repeatIndex: number;
  condition: QaRenderCompareCondition;
  hiddenGroups: QaHideGroup[];
}

interface PhaseAccumulator {
  planIndex: number;
  plan: PhasePlan;
  frames: number;
  warmupFrames: number;
  frameSum: number;
  renderSum: number;
  frameSamples: number[];
  enemySum: number;
  enemyMax: number;
  bulletSum: number;
  bulletMax: number;
  gemSum: number;
  gemMax: number;
  densitySum: number;
  densityMax: number;
  tier: string;
}

export interface QaRenderComparisonOptions {
  applyHidden: (hidden: ReadonlySet<QaHideGroup>) => void;
  onLabel?: (label: string) => void;
  storage?: QaRenderCompareStorage | null;
  phaseFrames?: number;
  repeats?: number;
  warmupFrames?: number;
}

const ordered = (groups: ReadonlySet<QaHideGroup>): QaHideGroup[] =>
  QA_HIDE_GROUPS.filter((group) => groups.has(group));
const rounded = (value: number): number => Math.round(value * 100) / 100;
const average = (sum: number, frames: number): number | null => frames > 0 ? rounded(sum / frames) : null;
const maximum = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  return rounded(values.reduce((max, value) => Math.max(max, value), -Infinity));
};
/** Nearest-rank p95: sorted[ceil(n * 0.95) - 1], with a 1-based rank. */
const percentile95 = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return rounded(sorted[Math.ceil(sorted.length * 0.95) - 1]);
};

export class QaRenderComparison {
  private readonly plan: PhasePlan[];
  private readonly phaseFrames: number;
  private readonly repeats: number;
  private readonly warmupFrames: number;
  private readonly applyHidden: QaRenderComparisonOptions['applyHidden'];
  private readonly onLabel?: QaRenderComparisonOptions['onLabel'];
  private readonly storage: QaRenderCompareStorage | null;
  private readonly originalHiddenGroups: QaHideGroup[];
  private readonly startedAt: string;
  private phases: QaRenderComparePhase[] = [];
  private readonly phaseFrameSamples = new Map<number, number[]>();
  private current: PhaseAccumulator | null = null;
  private status: QaRenderCompareSnapshot['status'] = 'running';
  private stopReason: QaRenderCompareStopReason | null = null;
  private persistence: QaRenderCompareSnapshot['persistence'] = 'unavailable';

  constructor(originalHidden: ReadonlySet<QaHideGroup>, options: QaRenderComparisonOptions) {
    this.originalHiddenGroups = ordered(originalHidden);
    this.phaseFrames = Math.max(1, Math.floor(options.phaseFrames ?? QA_RENDER_COMPARE_PHASE_FRAMES));
    this.repeats = Math.max(1, Math.floor(options.repeats ?? QA_RENDER_COMPARE_REPEATS));
    this.warmupFrames = Math.max(0, Math.floor(options.warmupFrames ?? QA_RENDER_COMPARE_WARMUP_FRAMES));
    this.applyHidden = options.applyHidden;
    this.onLabel = options.onLabel;
    this.storage = options.storage ?? null;
    this.startedAt = new Date().toISOString();

    const original = new Set(this.originalHiddenGroups);
    this.plan = [];
    for (const group of QA_HIDE_GROUPS) {
      const opposite = toggleQaHide(original, group);
      const hiddenGroups = ordered(opposite);
      for (let repeatIndex = 1; repeatIndex <= this.repeats; repeatIndex += 1) {
        this.plan.push({ group, repeatIndex, condition: 'baseline-before', hiddenGroups: [...this.originalHiddenGroups] });
        this.plan.push({ group, repeatIndex, condition: 'opposite', hiddenGroups });
        this.plan.push({ group, repeatIndex, condition: 'baseline-after', hiddenGroups: [...this.originalHiddenGroups] });
      }
    }

    this.startPhase(0);
  }

  get active(): boolean {
    return this.status === 'running';
  }

  /** Receives one measured, rendered frame from QaPerfOverlay. */
  record(sample: QaRenderCompareSample): void {
    const current = this.current;
    if (!this.active || !current) return;
    const { frameMs, renderMs, counters } = sample;
    if (!Number.isFinite(frameMs) || frameMs < 0 || !Number.isFinite(renderMs) || renderMs < 0) return;

    if (current.warmupFrames < this.warmupFrames) {
      current.warmupFrames += 1;
      if (current.warmupFrames === this.warmupFrames) this.emitLabel();
      return;
    }

    current.frames += 1;
    current.frameSum += frameMs;
    current.renderSum += renderMs;
    current.frameSamples.push(frameMs);
    current.enemySum += Math.max(0, counters.enemies);
    current.enemyMax = Math.max(current.enemyMax, counters.enemies);
    current.bulletSum += Math.max(0, counters.bullets);
    current.bulletMax = Math.max(current.bulletMax, counters.bullets);
    current.gemSum += Math.max(0, counters.gems);
    current.gemMax = Math.max(current.gemMax, counters.gems);
    current.densitySum += Math.max(0, counters.density);
    current.densityMax = Math.max(current.densityMax, counters.density);
    current.tier = counters.tier;

    if (current.frames >= this.phaseFrames) {
      this.commitPhase(current, true);
      this.current = null;
      const nextIndex = current.planIndex + 1;
      if (nextIndex >= this.plan.length) {
        this.status = 'complete';
        this.stopReason = 'completed';
        this.persist();
        this.applyOriginal();
        this.emitLabel();
        return;
      }
      this.startPhase(nextIndex);
      return;
    }

    if (current.frames % 30 === 0) this.emitLabel();
  }

  /** Finalize an interrupted run, save its partial window, then restore settings. */
  finish(reason: Exclude<QaRenderCompareStopReason, 'completed'>): void {
    if (!this.active) return;
    if (this.current && (this.current.frames > 0 || this.current.warmupFrames > 0)) this.commitPhase(this.current, false);
    this.current = null;
    this.status = 'interrupted';
    this.stopReason = reason;
    this.persist();
    this.applyOriginal();
    this.emitLabel();
  }

  snapshot(): QaRenderCompareSnapshot {
    const currentPhase = this.current ? this.summarize(this.current, false) : null;
    return {
      schemaVersion: 2,
      status: this.status,
      stopReason: this.stopReason,
      startedAt: this.startedAt,
      updatedAt: new Date().toISOString(),
      phaseFrames: this.phaseFrames,
      warmupFrames: this.warmupFrames,
      repeats: this.repeats,
      plannedPhases: this.plan.length,
      originalHiddenGroups: [...this.originalHiddenGroups],
      persistence: this.persistence,
      phases: this.phases.map((phase) => ({ ...phase, hiddenGroups: [...phase.hiddenGroups], counters: phase.counters ? { ...phase.counters } : null })),
      currentPhase,
      comparisons: this.comparisonPairs(),
    };
  }

  private startPhase(index: number): void {
    const plan = this.plan[index];
    this.current = {
      planIndex: index,
      plan,
      frames: 0,
      warmupFrames: 0,
      frameSum: 0,
      renderSum: 0,
      frameSamples: [],
      enemySum: 0,
      enemyMax: 0,
      bulletSum: 0,
      bulletMax: 0,
      gemSum: 0,
      gemMax: 0,
      densitySum: 0,
      densityMax: 0,
      tier: '',
    };
    this.applyHidden(new Set(plan.hiddenGroups));
    this.persist();
    this.emitLabel();
  }

  private summarize(accumulator: PhaseAccumulator, complete: boolean): QaRenderComparePhase {
    const frames = accumulator.frames;
    return {
      index: accumulator.planIndex + 1,
      repeatIndex: accumulator.plan.repeatIndex,
      group: accumulator.plan.group,
      condition: accumulator.plan.condition,
      hiddenGroups: [...accumulator.plan.hiddenGroups],
      warmupFrames: accumulator.warmupFrames,
      frames,
      complete,
      frameAvgMs: average(accumulator.frameSum, frames),
      frameMaxMs: maximum(accumulator.frameSamples),
      frameP95Ms: percentile95(accumulator.frameSamples),
      renderAvgMs: average(accumulator.renderSum, frames),
      counters: frames > 0 ? {
        enemiesAvg: average(accumulator.enemySum, frames)!,
        enemiesMax: accumulator.enemyMax,
        bulletsAvg: average(accumulator.bulletSum, frames)!,
        bulletsMax: accumulator.bulletMax,
        gemsAvg: average(accumulator.gemSum, frames)!,
        gemsMax: accumulator.gemMax,
        densityAvg: average(accumulator.densitySum, frames)!,
        densityMax: accumulator.densityMax,
        tier: accumulator.tier,
      } : null,
    };
  }

  private commitPhase(accumulator: PhaseAccumulator, complete: boolean): void {
    const phase = this.summarize(accumulator, complete);
    this.phases.push(phase);
    this.phaseFrameSamples.set(phase.index, [...accumulator.frameSamples]);
  }

  private comparisonPairs(): QaRenderComparePair[] {
    return QA_HIDE_GROUPS.flatMap((group) => {
      const phases = this.phases.filter((phase) => phase.group === group);
      const opposites = phases.filter((phase) => phase.condition === 'opposite' && phase.frames > 0);
      if (opposites.length === 0) return [];
      const baselines = phases.filter((phase) =>
        (phase.condition === 'baseline-before' || phase.condition === 'baseline-after') && phase.frames > 0,
      );
      const baselineFrames = baselines.reduce((sum, phase) => sum + phase.frames, 0);
      const oppositeFrames = opposites.reduce((sum, phase) => sum + phase.frames, 0);
      const baselineFrameSamples = baselines.flatMap((phase) => this.phaseFrameSamples.get(phase.index) ?? []);
      const oppositeFrameSamples = opposites.flatMap((phase) => this.phaseFrameSamples.get(phase.index) ?? []);
      const baselineRenderSum = baselines.reduce((sum, phase) => sum + (phase.renderAvgMs ?? 0) * phase.frames, 0);
      const baselineRenderAvgMs = average(baselineRenderSum, baselineFrames);
      const oppositeRenderSum = opposites.reduce((sum, phase) => sum + (phase.renderAvgMs ?? 0) * phase.frames, 0);
      const oppositeRenderAvgMs = average(oppositeRenderSum, oppositeFrames);
      const baselineFrameAvgMs = average(baselineFrameSamples.reduce((sum, value) => sum + value, 0), baselineFrameSamples.length);
      const oppositeFrameAvgMs = average(oppositeFrameSamples.reduce((sum, value) => sum + value, 0), oppositeFrameSamples.length);
      const baselineFrameMaxMs = maximum(baselineFrameSamples);
      const oppositeFrameMaxMs = maximum(oppositeFrameSamples);
      const baselineFrameP95Ms = percentile95(baselineFrameSamples);
      const oppositeFrameP95Ms = percentile95(oppositeFrameSamples);
      return [{
        group,
        repeatCount: this.repeats,
        baselineWindows: baselines.length,
        oppositeWindows: opposites.length,
        originalHidden: this.originalHiddenGroups.includes(group),
        oppositeHidden: opposites[0].hiddenGroups.includes(group),
        baselineFrames,
        oppositeFrames,
        baselineFrameAvgMs,
        oppositeFrameAvgMs,
        frameDeltaMs: baselineFrameAvgMs === null || oppositeFrameAvgMs === null ? null : rounded(oppositeFrameAvgMs - baselineFrameAvgMs),
        baselineFrameMaxMs,
        oppositeFrameMaxMs,
        frameMaxDeltaMs: baselineFrameMaxMs === null || oppositeFrameMaxMs === null ? null : rounded(oppositeFrameMaxMs - baselineFrameMaxMs),
        baselineFrameP95Ms,
        oppositeFrameP95Ms,
        frameP95DeltaMs: baselineFrameP95Ms === null || oppositeFrameP95Ms === null ? null : rounded(oppositeFrameP95Ms - baselineFrameP95Ms),
        baselineRenderAvgMs,
        oppositeRenderAvgMs,
        renderDeltaMs: baselineRenderAvgMs === null || oppositeRenderAvgMs === null ? null : rounded(oppositeRenderAvgMs - baselineRenderAvgMs),
      }];
    });
  }

  private applyOriginal(): void {
    this.applyHidden(new Set(this.originalHiddenGroups));
  }

  private persist(): void {
    if (!this.storage) {
      this.persistence = 'unavailable';
      return;
    }
    try {
      const snapshot = this.snapshot();
      snapshot.persistence = 'saved';
      this.storage.setItem(QA_RENDER_COMPARE_STORAGE_KEY, JSON.stringify(snapshot));
      this.persistence = 'saved';
    } catch {
      this.persistence = 'unavailable';
    }
  }

  private emitLabel(): void {
    if (!this.onLabel) return;
    const persistenceLabel = this.persistence === 'saved' ? 'saved' : '!save';
    if (this.status === 'complete') {
      this.onLabel(`complete ${this.phases.length}/${this.plan.length} ${persistenceLabel}`);
      return;
    }
    if (this.status === 'interrupted') {
      this.onLabel(`${this.stopReason ?? 'stopped'} ${this.phases.length}/${this.plan.length} ${persistenceLabel}`);
      return;
    }
    const current = this.current;
    if (!current) {
      this.onLabel(`starting ${persistenceLabel}`);
      return;
    }
    const side = current.plan.condition === 'opposite' ? 'flip' : 'base';
    const repeat = `r${current.plan.repeatIndex}/${this.repeats}`;
    const progress = current.warmupFrames < this.warmupFrames
      ? `warm ${current.warmupFrames}/${this.warmupFrames}`
      : `${current.frames}/${this.phaseFrames}`;
    this.onLabel(`${current.planIndex + 1}/${this.plan.length} ${repeat} ${current.plan.group} ${side} ${progress} ${persistenceLabel}`);
  }
}
