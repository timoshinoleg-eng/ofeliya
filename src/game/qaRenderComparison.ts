/**
 * QA render comparison — paired, within-run A/B windows for GEMS / ATMO / UI.
 *
 * Enable only in the existing QA-gated GameScene with `?qaCompare=render`.
 * For each group the controller samples the original visibility, flips only that
 * group, then samples the original visibility again. Each window discards 30
 * warmup frames, then measures 120 active rendered frames. An initial 300-frame
 * warmup precedes round-robin A/B/A cycles for each group, repeated three times.
 * Object counts and quality tier are recorded
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
export const QA_RENDER_COMPARE_PREVIOUS_KEY = 'ofeliya_qa_render_comparison_previous_v2';
export const QA_RENDER_COMPARE_PHASE_FRAMES = 120;
export const QA_RENDER_COMPARE_REPEATS = 3;
export const QA_RENDER_COMPARE_WARMUP_FRAMES = 30;
export const QA_RENDER_COMPARE_INITIAL_WARMUP_FRAMES = 300;

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
  visibilityState?: string;
}

export type QaRenderCompareCondition = 'baseline-before' | 'opposite' | 'baseline-after';
export type QaRenderCompareStopReason = 'completed' | 'player-death' | 'run-ended' | 'manual-stop';

export interface QaRenderCompareCounterSummary {
  enemiesAvg: number;
  enemiesMin: number;
  enemiesMax: number;
  bulletsAvg: number;
  bulletsMin: number;
  bulletsMax: number;
  gemsAvg: number;
  gemsMin: number;
  gemsMax: number;
  densityAvg: number;
  densityMin: number;
  densityMax: number;
  tier: string;
  tiers: string[];
  tierChanged: boolean;
  tierTransitions: { frame: number; from: string; to: string }[];
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
  frameP50Ms: number | null;
  renderAvgMs: number | null;
  renderMaxMs: number | null;
  renderP50Ms: number | null;
  renderP95Ms: number | null;
  longFrames: { frame: number; ms: number; visibilityState: string }[];
  longFrameCount: number;
  longMs: number;
  hiddenMs: number;
  counters: QaRenderCompareCounterSummary | null;
}

export interface QaRenderComparePair {
  group: QaHideGroup;
  comparable: boolean;
  incomparableReasons: string[];
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
  initialWarmupFrames: number;
  initialWarmupCompleted: number;
  metadata: { renderer: string; dpr: number; canvas: { width: number; height: number } } | null;
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
  getItem?(key: string): string | null;
}

export function readSavedQaRenderComparison(storage: QaRenderCompareStorage | null): QaRenderCompareSnapshot | null {
  for (const key of [QA_RENDER_COMPARE_STORAGE_KEY, QA_RENDER_COMPARE_PREVIOUS_KEY]) {
    try {
      const raw = storage?.getItem?.(key);
      if (!raw) continue;
      const result = JSON.parse(raw) as QaRenderCompareSnapshot;
      if (result && Array.isArray(result.phases) && Array.isArray(result.comparisons)) return result;
    } catch { /* Try the previous snapshot. */ }
  }
  return null;
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
  renderSamples: number[];
  longFrames: { frame: number; ms: number; visibilityState: string }[];
  hiddenMs: number;
  hiddenSince: number | null;
  enemySum: number;
  enemyMin: number;
  enemyMax: number;
  bulletSum: number;
  bulletMin: number;
  bulletMax: number;
  gemSum: number;
  gemMin: number;
  gemMax: number;
  densitySum: number;
  densityMin: number;
  densityMax: number;
  tier: string;
  tiers: string[];
  tierTransitions: { frame: number; from: string; to: string }[];
}

export interface QaRenderComparisonOptions {
  applyHidden: (hidden: ReadonlySet<QaHideGroup>) => void;
  onLabel?: (label: string) => void;
  storage?: QaRenderCompareStorage | null;
  phaseFrames?: number;
  repeats?: number;
  warmupFrames?: number;
  initialWarmupFrames?: number;
  now?: () => number;
  visibilityState?: string;
  metadata?: QaRenderCompareSnapshot['metadata'];
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
const median = (values: readonly number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return rounded(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
};

export class QaRenderComparison {
  private readonly plan: PhasePlan[];
  private readonly phaseFrames: number;
  private readonly repeats: number;
  private readonly warmupFrames: number;
  private readonly initialWarmupFrames: number;
  private initialWarmupCompleted = 0;
  private readonly now: () => number;
  private visibilityState: string;
  private readonly metadata: QaRenderCompareSnapshot['metadata'];
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
    this.initialWarmupFrames = Math.max(0, Math.floor(options.initialWarmupFrames ?? QA_RENDER_COMPARE_INITIAL_WARMUP_FRAMES));
    this.now = options.now ?? (() => typeof performance !== 'undefined' ? performance.now() : Date.now());
    this.visibilityState = options.visibilityState ?? 'visible';
    this.metadata = options.metadata ?? null;
    this.applyHidden = options.applyHidden;
    this.onLabel = options.onLabel;
    this.storage = options.storage ?? null;
    this.startedAt = new Date().toISOString();

    // Never overwrite the only previous result unless it was preserved first.
    try {
      const previous = this.storage?.getItem?.(QA_RENDER_COMPARE_STORAGE_KEY);
      if (previous) this.storage?.setItem(QA_RENDER_COMPARE_PREVIOUS_KEY, previous);
    } catch { this.storage = null; }

    const original = new Set(this.originalHiddenGroups);
    this.plan = [];
    for (let repeatIndex = 1; repeatIndex <= this.repeats; repeatIndex += 1) {
      for (const group of QA_HIDE_GROUPS) {
      const opposite = toggleQaHide(original, group);
      const hiddenGroups = ordered(opposite);
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

    if (sample.visibilityState) this.noteVisibility(sample.visibilityState, this.now());
    if (this.initialWarmupCompleted < this.initialWarmupFrames) {
      this.initialWarmupCompleted += 1;
      if (this.initialWarmupCompleted === this.initialWarmupFrames) this.emitLabel();
      return;
    }

    if (current.warmupFrames < this.warmupFrames) {
      current.warmupFrames += 1;
      if (current.warmupFrames === this.warmupFrames) this.emitLabel();
      return;
    }

    current.frames += 1;
    current.frameSum += frameMs;
    current.renderSum += renderMs;
    current.frameSamples.push(frameMs);
    current.renderSamples.push(renderMs);
    if (frameMs >= 80) current.longFrames.push({ frame: current.frames, ms: frameMs, visibilityState: sample.visibilityState ?? this.visibilityState });
    current.enemyMin = Math.min(current.enemyMin, Math.max(0, counters.enemies));
    current.enemySum += Math.max(0, counters.enemies);
    current.enemyMax = Math.max(current.enemyMax, counters.enemies);
    current.bulletSum += Math.max(0, counters.bullets);
    current.bulletMin = Math.min(current.bulletMin, Math.max(0, counters.bullets));
    current.bulletMax = Math.max(current.bulletMax, counters.bullets);
    current.gemSum += Math.max(0, counters.gems);
    current.gemMin = Math.min(current.gemMin, Math.max(0, counters.gems));
    current.gemMax = Math.max(current.gemMax, counters.gems);
    current.densitySum += Math.max(0, counters.density);
    current.densityMin = Math.min(current.densityMin, Math.max(0, counters.density));
    current.densityMax = Math.max(current.densityMax, counters.density);
    if (current.tier && current.tier !== counters.tier) current.tierTransitions.push({ frame: current.frames, from: current.tier, to: counters.tier });
    current.tier = counters.tier;
    if (!current.tiers.includes(counters.tier)) current.tiers.push(counters.tier);

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

  noteVisibility(state: string, at = this.now()): void {
    if (state === this.visibilityState) return;
    const current = this.current;
    if (current?.hiddenSince != null) {
      current.hiddenMs += Math.max(0, at - current.hiddenSince);
      current.hiddenSince = null;
    }
    this.visibilityState = state;
    if (state === 'hidden' && current) current.hiddenSince = at;
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
      initialWarmupFrames: this.initialWarmupFrames,
      initialWarmupCompleted: this.initialWarmupCompleted,
      metadata: this.metadata,
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
      renderSamples: [],
      longFrames: [],
      hiddenMs: 0,
      hiddenSince: this.visibilityState === 'hidden' ? this.now() : null,
      enemySum: 0,
      enemyMin: Infinity,
      enemyMax: 0,
      bulletSum: 0,
      bulletMin: Infinity,
      bulletMax: 0,
      gemSum: 0,
      gemMin: Infinity,
      gemMax: 0,
      densitySum: 0,
      densityMin: Infinity,
      densityMax: 0,
      tier: '',
      tiers: [],
      tierTransitions: [],
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
      frameP50Ms: median(accumulator.frameSamples),
      renderAvgMs: average(accumulator.renderSum, frames),
      renderMaxMs: maximum(accumulator.renderSamples),
      renderP50Ms: median(accumulator.renderSamples),
      renderP95Ms: percentile95(accumulator.renderSamples),
      longFrames: accumulator.longFrames.map((item) => ({ ...item })),
      longFrameCount: accumulator.longFrames.length,
      longMs: rounded(accumulator.longFrames.reduce((sum, item) => sum + item.ms, 0)),
      hiddenMs: rounded(accumulator.hiddenMs + (accumulator.hiddenSince === null ? 0 : Math.max(0, this.now() - accumulator.hiddenSince))),
      counters: frames > 0 ? {
        enemiesAvg: average(accumulator.enemySum, frames)!,
        enemiesMin: accumulator.enemyMin,
        enemiesMax: accumulator.enemyMax,
        bulletsAvg: average(accumulator.bulletSum, frames)!,
        bulletsMin: accumulator.bulletMin,
        bulletsMax: accumulator.bulletMax,
        gemsAvg: average(accumulator.gemSum, frames)!,
        gemsMin: accumulator.gemMin,
        gemsMax: accumulator.gemMax,
        densityAvg: average(accumulator.densitySum, frames)!,
        densityMin: accumulator.densityMin,
        densityMax: accumulator.densityMax,
        tier: accumulator.tier,
        tiers: [...accumulator.tiers],
        tierChanged: accumulator.tiers.length > 1,
        tierTransitions: accumulator.tierTransitions.map((item) => ({ ...item })),
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
      const reasons = new Set<string>();
      let completedRepeats = 0;
      for (const repeatIndex of new Set(phases.map((p) => p.repeatIndex))) {
        const cycle = phases.filter((p) => p.repeatIndex === repeatIndex);
        if (cycle.length !== 3 || cycle.some((p) => !p.complete || !p.counters)) {
          reasons.add('incomplete-cycle');
          continue;
        }
        completedRepeats += 1;
        const counters = cycle.map((p) => p.counters!);
        if (counters.some((c) => c.tierChanged) || new Set(counters.flatMap((c) => c.tiers)).size !== 1) reasons.add('quality-tier-changed');
        if (cycle.some((p) => p.hiddenMs > 0)) reasons.add('page-hidden');
        if (Math.max(...counters.map((c) => c.densityMin)) > Math.min(...counters.map((c) => c.densityMax))) reasons.add('density-ranges-do-not-overlap');
      }
      if (new Set(phases.flatMap((p) => p.counters?.tiers ?? [])).size > 1) reasons.add('quality-tier-changed-between-cycles');
      const comparable = reasons.size === 0 && completedRepeats > 0;
      return [{
        group,
        comparable,
        incomparableReasons: [...reasons],
        repeatCount: completedRepeats,
        baselineWindows: baselines.length,
        oppositeWindows: opposites.length,
        originalHidden: this.originalHiddenGroups.includes(group),
        oppositeHidden: opposites[0].hiddenGroups.includes(group),
        baselineFrames,
        oppositeFrames,
        baselineFrameAvgMs,
        oppositeFrameAvgMs,
        frameDeltaMs: !comparable || baselineFrameAvgMs === null || oppositeFrameAvgMs === null ? null : rounded(oppositeFrameAvgMs - baselineFrameAvgMs),
        baselineFrameMaxMs,
        oppositeFrameMaxMs,
        frameMaxDeltaMs: !comparable || baselineFrameMaxMs === null || oppositeFrameMaxMs === null ? null : rounded(oppositeFrameMaxMs - baselineFrameMaxMs),
        baselineFrameP95Ms,
        oppositeFrameP95Ms,
        frameP95DeltaMs: !comparable || baselineFrameP95Ms === null || oppositeFrameP95Ms === null ? null : rounded(oppositeFrameP95Ms - baselineFrameP95Ms),
        baselineRenderAvgMs,
        oppositeRenderAvgMs,
        renderDeltaMs: !comparable || baselineRenderAvgMs === null || oppositeRenderAvgMs === null ? null : rounded(oppositeRenderAvgMs - baselineRenderAvgMs),
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
    const progress = this.initialWarmupCompleted < this.initialWarmupFrames
      ? `initial ${this.initialWarmupCompleted}/${this.initialWarmupFrames}`
      : current.warmupFrames < this.warmupFrames
      ? `warm ${current.warmupFrames}/${this.warmupFrames}`
      : `${current.frames}/${this.phaseFrames}`;
    this.onLabel(`${current.planIndex + 1}/${this.plan.length} ${repeat} ${current.plan.group} ${side} ${progress} ${persistenceLabel}`);
  }
}
