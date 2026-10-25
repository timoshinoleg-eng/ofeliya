import {
  DAY_SCOPED_METRICS,
  findQuestDefinition,
  LIFETIME_METRIC_KEYS,
  QUEST_CATALOG,
  QUEST_METRIC_MODES,
  QUEST_METRIC_SCOPES,
  RUN_SCOPED_METRICS,
} from './questCatalog';
import { selectDailyQuests, utcDayKey } from './questRotation';
import {
  createQuestSaveData,
  ensureDayState,
  MAX_REMEMBERED_EVENT_IDS,
  parseQuestSaveData,
  peekQuestSaveVersion,
  pruneDayHistory,
  QUEST_SAVE_VERSION,
  type QuestDayState,
  type QuestSaveData,
  type QuestScopeValues,
} from './questState';
import type {
  QuestClock,
  QuestDefinition,
  QuestEvent,
  QuestId,
  QuestLifetimeMirror,
  QuestLocalReceipt,
  QuestMetric,
  QuestProgress,
  QuestRewardGateway,
  QuestSnapshot,
  QuestStorage,
} from './questTypes';

/** What happened to an ingested event. */
export interface QuestIngestResult {
  /** True when the event was applied. */
  readonly accepted: boolean;
  /** True when the event was dropped because its id was already seen. */
  readonly duplicate: boolean;
  /** The quests that completed with this event. */
  readonly newlyCompleted: readonly QuestId[];
}

export interface QuestEngineOptions {
  /** The catalog to serve. Defaults to the Muse reference catalog. */
  readonly catalog?: readonly QuestDefinition[];
  /** Where the record is persisted. Without it the engine keeps its state in memory. */
  readonly storage?: QuestStorage;
  /** The clock the UTC rotation runs on. */
  readonly clock?: QuestClock;
  /**
   * The future server-side reward check.
   *
   * The quest core never implements or simulates it. With no gateway, a completed quest
   * stays `local_pending` and no value is granted anywhere.
   */
  readonly rewardGateway?: QuestRewardGateway;
}

/**
 * How long writes are coalesced.
 *
 * The events arrive in bursts — a bomb that kills forty enemies in one frame, a tick
 * every frame — and a synchronous `localStorage` write per event would rewrite the
 * whole record dozens of times per second. Writes are therefore coalesced over a
 * second, while the transitions that actually matter — a day roll, a completion, a
 * claim, the start of a run — are written through immediately. `flush()` writes the
 * pending state on demand.
 */
export const PERSIST_COALESCE_MS = 1000;

/**
 * How far ahead of today a stored day key may be before it stops being trusted.
 *
 * A day key that is years ahead — a corrupted record, or a device whose clock was set
 * years ahead when the record was written — would pin the daily rotation to that day
 * forever, because the quest day only ever moves forward. A small forward skew is
 * normal: a player who plays at 23:59 UTC and whose clock is corrected afterwards
 * comes back to a stored day that is one day ahead of the current one.
 */
export const MAX_DAY_SKEW_DAYS = 2;

const systemClock: QuestClock = {
  now: () => Date.now(),
};

function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * The quest core.
 *
 * It consumes a typed event stream, keeps the daily quest state and answers with a
 * read-only snapshot. It never touches the Phaser scenes, the product save, the Daily
 * system or the server, and it never grants value.
 */
export class QuestEngine {
  private readonly clock: QuestClock;
  private readonly storage: QuestStorage | undefined;
  private readonly rewardGateway: QuestRewardGateway | undefined;
  private readonly catalog: readonly QuestDefinition[];

  private state: QuestSaveData;
  private activeQuestIds: QuestId[];
  private lifetime = { completedRuns: 0, synced: false };
  private processedEvents = 0;
  private duplicateEvents = 0;
  private dirty = false;
  private lastWriteAtMs = 0;
  /** A record from a newer build is read, but never overwritten. */
  private storageLocked = false;

  constructor(options: QuestEngineOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.storage = options.storage;
    this.rewardGateway = options.rewardGateway;
    this.catalog = options.catalog ?? defaultCatalog();

    const nowMs = this.clock.now();
    const today = utcDayKey(Number.isFinite(nowMs) ? nowMs : 0);
    this.state = this.load(today);
    this.activeQuestIds = this.selectFor(this.state.dayKey);
    this.rollDayIfNeeded(nowMs);
  }

  private load(today: string): QuestSaveData {
    let raw: string | null = null;
    try {
      raw = this.storage?.read() ?? null;
    } catch {
      raw = null;
    }

    const storedVersion = peekQuestSaveVersion(raw);
    if (storedVersion !== undefined && storedVersion > QUEST_SAVE_VERSION) {
      // A record from a newer build. It is read as far as it can be, but it is never
      // written back: the newer build owns it, and overwriting it would drop the
      // fields this build does not know about.
      this.storageLocked = true;
    }

    const parsed = parseQuestSaveData(raw, today);
    this.clampFutureDay(parsed, today);
    pruneDayHistory(parsed);
    this.writeRaw(JSON.stringify(parsed));
    return parsed;
  }

  /**
   * Replaces a stored day key that is too far in the future.
   *
   * The quest day only ever moves forward, so a stored day of 2099 would pin the
   * rotation to 2099 and never heal on its own. The state of the future day is dropped
   * with it: it describes a day the player was never in.
   */
  private clampFutureDay(save: QuestSaveData, today: string): void {
    const limit = Date.parse(`${today}T00:00:00.000Z`) + MAX_DAY_SKEW_DAYS * 86_400_000;
    const stored = Date.parse(`${save.dayKey}T00:00:00.000Z`);
    if (!Number.isFinite(stored) || stored <= limit) return;
    save.dayKey = today;
    for (const dayKey of Object.keys(save.days)) {
      if (dayKey > today) delete save.days[dayKey];
    }
  }

  /** The catalog this engine serves. */
  getCatalog(): readonly QuestDefinition[] {
    return this.catalog;
  }

  /** The quests offered today. */
  activeQuests(): readonly QuestDefinition[] {
    return this.activeQuestIds
      .map((questId) => findQuestDefinition(this.catalog, questId))
      .filter((quest): quest is QuestDefinition => quest !== undefined);
  }

  /**
   * Mirrors the product totals into the quest core.
   *
   * The values are the ones of the product save (`SaveData.runs`). The quest core never
   * counts them itself, so there is exactly one source of truth and the "completed
   * runs lag by one" defect cannot come back. The mirror is not persisted: a persisted
   * copy could go stale, so it is applied again whenever the product save changes.
   */
  syncLifetime(mirror: QuestLifetimeMirror): void {
    const completedRuns = Math.max(0, Math.floor(finiteOrZero(mirror.completedRuns)));
    if (this.lifetime.synced && this.lifetime.completedRuns === completedRuns) return;
    this.lifetime = { completedRuns, synced: true };
    this.evaluateCompletion();
    this.persist(true);
  }

  /**
   * Realigns the run counters with a run that was restored from a checkpoint.
   *
   * The quest record and the product checkpoint are two independent records, so they
   * can disagree — the quest record was lost, or the checkpoint was written earlier or
   * later than the quest record. This seam lets the resume path put the counters back
   * in step without resetting the day baseline.
   *
   * Only the counters the product knows are passed in: the kills and the survival time
   * of the run. The collected RNA, the chosen mutations and the elite kills are counted
   * by the quest core itself, so they come from the quest record.
   */
  syncRunProgress(progress: { kills?: number; timeMs?: number }): void {
    const kills = Math.max(0, Math.floor(finiteOrZero(progress.kills)));
    const timeMs = Math.max(0, Math.floor(finiteOrZero(progress.timeMs)));
    let changed = false;
    if (this.state.runMetrics.q_kills !== kills) {
      this.state.runMetrics.q_kills = kills;
      changed = true;
    }
    const seconds = Math.floor(timeMs / 1000);
    // The survival time is a peak of the run: a restored run cannot have survived
    // longer than the run already did.
    if (seconds > (this.state.runMetrics.q_time ?? 0)) {
      this.state.runMetrics.q_time = seconds;
      changed = true;
    }
    if (!changed) return;
    // The baseline is the value the counter had at the day start. A restored run can be
    // older than the quest record, and a counter below its baseline would need the
    // target plus the baseline to be reached again. The baseline follows the counter
    // down, so the goal stays the target.
    this.lowerBaseline('q_kills', kills);
    this.lowerBaseline('q_time', this.state.runMetrics.q_time ?? 0);
    this.markDirty();
    this.evaluateCompletion();
    this.persist(true);
  }

  /** Restore checkpoint counters without emitting a second run start. Day completions remain historical facts. */
  restoreRunMetrics(values: { kills: number; timeMs: number; rna: number; mutations: number; elites: number }): void {
    this.rollDayIfNeeded(this.clock.now());
    delete this.state.lastTickTimeMs;
    delete this.state.lastTickAtMs;
    const metrics = { q_kills: values.kills, q_time: Math.floor(values.timeMs / 1000),
      q_rna: values.rna, q_mut: values.mutations, q_elites: values.elites };
    for (const metric of RUN_SCOPED_METRICS) {
      const value = Math.max(0, finiteOrZero(metrics[metric as keyof typeof metrics]));
      this.state.runMetrics[metric] = metric === 'q_time' ? Math.max(this.state.runMetrics[metric] ?? 0, value) : value;
      this.lowerBaseline(metric, this.state.runMetrics[metric] ?? 0);
    }
    this.markDirty();
    this.evaluateCompletion();
    this.persist(true);
  }

  restoreNoDamageStreak(noDamageMs: number, previousDay: boolean): void {
    this.rollDayIfNeeded(this.clock.now());
    const current = Math.max(0, finiteOrZero(noDamageMs)) / 1000;
    // A checkpoint rewind is not a damage hit. In particular, yesterday's shorter
    // checkpoint streak must not be mistaken for a new streak earned today.
    this.state.streakLast = current;
    this.state.baseline.q_nodmg = previousDay ? current : Math.min(this.state.baseline.q_nodmg ?? 0, current);
    this.markDirty();
  }

  /** Lowers the baseline of a counter to the value that was restored. */
  private lowerBaseline(metric: QuestMetric, value: number): void {
    const baseline = this.state.baseline[metric] ?? 0;
    if (value < baseline) this.state.baseline[metric] = value;
  }

  /**
   * Applies one game event.
   *
   * The event id is the idempotency key: a redelivered event is dropped instead of being
   * counted twice. The peak events are the exception — they carry the current value of
   * a counter rather than an occurrence, so redelivering them cannot change anything
   * and they are not remembered.
   */
  ingest(event: QuestEvent): QuestIngestResult {
    this.rollDayIfNeeded(this.clock.now());

    if (!event || typeof event.id !== 'string' || event.id.length === 0) {
      return { accepted: false, duplicate: false, newlyCompleted: [] };
    }

    const isPeakEvent = event.kind === 'run_tick';
    if (event.kind === 'run_tick' && (!Number.isFinite(event.timeMs) || event.timeMs < 0 ||
      (this.state.lastTickTimeMs !== undefined && event.timeMs <= this.state.lastTickTimeMs))) {
      return { accepted: false, duplicate: false, newlyCompleted: [] };
    }
    if (!isPeakEvent) {
      if (this.isDuplicate(event.id)) {
        this.duplicateEvents += 1;
        return { accepted: false, duplicate: true, newlyCompleted: [] };
      }
      this.remember(event.id);
    }

    this.applyEvent(event);
    this.processedEvents += 1;

    const newlyCompleted = this.evaluateCompletion();
    this.persist(false);
    return { accepted: true, duplicate: false, newlyCompleted };
  }

  private applyEvent(event: QuestEvent): void {
    switch (event.kind) {
      case 'run_started': {
        // A new run starts from zero, so the baseline is zero as well: every counter of
        // the run has to be earned inside that run.
        this.resetRunMetrics();
        this.state.baseline = zeroScope([...RUN_SCOPED_METRICS, ...DAY_SCOPED_METRICS]);
        this.markDirty();
        this.persist(true);
        break;
      }
      case 'run_completed': {
        // The counters of a finished run stay where they are — they are the result the
        // quest screen shows. The lifetime total is not touched here: it is mirrored
        // from the product save, and the integration applies the mirror right after
        // `SaveSystem.recordRun`, which is where the run counter really moves.
        break;
      }
      case 'enemy_killed': {
        this.addRunMetric('q_kills', 1);
        if (event.elite === true) this.addRunMetric('q_elites', 1);
        break;
      }
      case 'rna_collected': {
        this.addRunMetric('q_rna', finiteOrZero(event.delta));
        break;
      }
      case 'mutation_chosen': {
        this.addRunMetric('q_mut', 1);
        break;
      }
      case 'run_tick': {
        this.state.lastTickTimeMs = event.timeMs;
        this.markDirty();
        this.peakRunMetric('q_time', Math.floor(finiteOrZero(event.timeMs) / 1000));
        if (Number.isFinite(event.noDamageMs) && event.noDamageMs >= 0) {
          this.trackNoDamageStreak(event.noDamageMs / 1000, event.at);
        }
        // The wall clock of the sample is the anchor of the next attribution: it says
        // where inside a UTC day the streak was seen.
        if (Number.isFinite(event.at)) this.state.lastTickAtMs = event.at;
        else delete this.state.lastTickAtMs;
        break;
      }
      default:
        break;
    }
  }

  /**
   * Issues the local receipt of a finished quest.
   *
   * The receipt is local UI state. It grants nothing, and it is issued at most once per
   * quest per day. The lifetime quests measure a total that only grows, so for them the
   * receipt is issued at most once ever — otherwise a milestone would pay out again on
   * every day it is offered.
   *
   * Only a quest of the current daily set can be claimed: a receipt for a quest the
   * player was never offered would spend the one-shot claim of a goal that was not on
   * the board.
   */
  claimLocalReward(questId: QuestId): QuestLocalReceipt | null {
    if (!this.activeQuestIds.includes(questId)) return null;
    const definition = findQuestDefinition(this.catalog, questId);
    if (!definition) return null;
    if (!this.isComplete(definition)) return null;

    const day = this.dayState();
    if (QUEST_METRIC_SCOPES[definition.metric] === 'lifetime') {
      if (this.state.claimedLifetime.includes(questId)) return null;
      this.state.claimedLifetime.push(questId);
      this.markDirty();
      this.persist(true);
      return {
        questId,
        dayKey: this.state.dayKey,
        issuedAt: this.clock.now(),
        state: 'local_pending',
      };
    }

    if (day.claimed.includes(questId)) return null;
    day.claimed.push(questId);
    this.markDirty();
    this.persist(true);
    return {
      questId,
      dayKey: this.state.dayKey,
      issuedAt: this.clock.now(),
      state: 'local_pending',
    };
  }

  /**
   * Asks the server-side reward check about a completed quest.
   *
   * With no gateway configured the answer is `unavailable` — the quest core does not
   * simulate a server it does not have.
   */
  async verifyWithServer(
    questId: QuestId
  ): Promise<'confirmed' | 'rejected' | 'unavailable'> {
    if (!this.rewardGateway) return 'unavailable';
    try {
      return await this.rewardGateway.verifyQuestCompletion(questId, this.state.dayKey);
    } catch {
      return 'unavailable';
    }
  }

  /** The read-only state of the quest core. */
  snapshot(): QuestSnapshot {
    // The day can pass while nothing happens, and the HUD asks for the snapshot. The
    // rotation therefore happens here as well, not only when an event arrives.
    this.rollDayIfNeeded(this.clock.now());
    const progress: QuestProgress[] = this.activeQuests().map((definition) => ({
      questId: definition.id,
      value: this.metricValue(definition.metric),
      progress: this.dayProgress(definition),
      target: definition.target,
      complete: this.isComplete(definition),
      claimed: this.isClaimed(definition),
    }));

    return {
      dayKey: this.state.dayKey,
      activeQuestIds: [...this.activeQuestIds],
      progress,
      best: { ...this.dayState().best },
      lifetime: {
        completedRuns: this.lifetime.completedRuns,
        synced: this.lifetime.synced,
      },
      processedEvents: this.processedEvents,
      duplicateEvents: this.duplicateEvents,
    };
  }

  /** Writes the pending state to the storage. */
  flush(): void {
    this.persist(true);
  }

  private selectFor(dayKey: string): QuestId[] {
    return selectDailyQuests(dayKey, this.catalog);
  }

  /**
   * Rolls the daily set over when the UTC day changed.
   *
   * The day key only ever moves forward. A device clock that jumps backwards — a time
   * zone correction, an NTP correction, a wrong manual setting — must not rewind the
   * quest day: that would wipe the progress of the day and re-open quests that were
   * already completed and claimed, which would let the same quest be completed twice on
   * the same UTC day.
   */
  private rollDayIfNeeded(nowMs: number): void {
    if (!Number.isFinite(nowMs)) return;
    const dayKey = utcDayKey(nowMs);
    if (dayKey === this.state.dayKey) return;
    if (dayKey < this.state.dayKey) return;

    // The run that crosses midnight keeps its progress, so the new day starts from the
    // values the run has reached so far. Only the progress made during the new day
    // counts towards the goals of the new day.
    this.state.baseline = { ...this.state.runMetrics };
    // The day-scoped counters start from zero: the streak of yesterday is not a streak
    // of today. The baseline of the streak is the length it has at this moment, so a
    // streak that continues over the midnight only counts for the part that is today.
    this.state.baseline.q_nodmg = this.state.streakLast ?? 0;
    this.state.dayMetrics = zeroScope(DAY_SCOPED_METRICS);
    this.state.dayKey = dayKey;
    ensureDayState(this.state, dayKey);
    pruneDayHistory(this.state);
    this.activeQuestIds = this.selectFor(dayKey);
    this.markDirty();
    this.persist(true);
  }

  private dayState(): QuestDayState {
    return ensureDayState(this.state, this.state.dayKey);
  }

  private isDuplicate(eventId: string): boolean {
    return this.state.seenEventIds.includes(eventId);
  }

  private remember(eventId: string): void {
    this.state.seenEventIds.push(eventId);
    const overflow = this.state.seenEventIds.length - MAX_REMEMBERED_EVENT_IDS;
    if (overflow > 0) this.state.seenEventIds.splice(0, overflow);
    this.markDirty();
  }

  private resetRunMetrics(): void {
    delete this.state.lastTickTimeMs;
    delete this.state.lastTickAtMs;
    for (const metric of RUN_SCOPED_METRICS) this.state.runMetrics[metric] = 0;
    this.markDirty();
  }

  private addRunMetric(metric: QuestMetric, delta: number): void {
    if (delta <= 0) return;
    const current = this.state.runMetrics[metric] ?? 0;
    this.state.runMetrics[metric] = current + delta;
    this.markDirty();
  }

  private peakRunMetric(metric: QuestMetric, value: number): void {
    if (value <= 0) return;
    const current = this.state.runMetrics[metric] ?? 0;
    if (value <= current) return;
    this.state.runMetrics[metric] = value;
    this.markDirty();
  }

  /**
   * Tracks the no-damage streak of the day.
   *
   * The quest core sees the length of the current streak, not when it began. A streak
   * that continues over the midnight therefore counts only for the part that happened
   * today, and a streak that breaks starts a new one — the length of the new streak is
   * what counts from then on.
   *
   * The value of the day is the longest such streak of the day, so a broken streak does
   * not lower it.
   *
   * `sampleAtMs` is the wall clock of the sample. It is the anchor of the attribution:
   * the streak of a day is the part of the streak that was alive inside that day.
   */
  private trackNoDamageStreak(current: number, sampleAtMs: number): void {
    const previous = this.state.streakLast ?? 0;
    let progress: number;
    if (current < previous) {
      // The streak broke. A new streak starts at zero, so the whole of it is new.
      this.state.baseline.q_nodmg = 0;
      progress = Math.round(current * 1000);
    } else {
      // The sample can have reached across the midnight of the current day. The day
      // then starts from the streak that was alive at the midnight itself, not from the
      // last streak that was observed before it.
      const dayStart = this.streakAtDayStart(
        Math.round(previous * 1000),
        this.state.lastTickAtMs ?? Number.NaN,
        Math.round(current * 1000),
        sampleAtMs
      );
      if (dayStart !== null) this.state.baseline.q_nodmg = dayStart / 1000;
      progress = Math.round(current * 1000) - Math.round((this.state.baseline.q_nodmg ?? 0) * 1000);
    }
    this.state.streakLast = current;
    // Convert both operands to milliseconds before subtracting and rounding.
    progress = Math.floor(progress / 1000);
    if (progress <= 0) {
      this.markDirty();
      return;
    }
    const best = this.state.dayMetrics.q_nodmg ?? 0;
    if (progress > best) {
      this.state.dayMetrics.q_nodmg = progress;
      this.markDirty();
    }
  }

  /**
   * The streak the current UTC day starts from, when the observation reached across the
   * midnight of that day.
   *
   * The streak advances with the run clock, and the run clock advances with the wall
   * clock while the game runs. The wall clock decides the UTC day, so the part of an
   * observation interval that lies inside a UTC day is the part of the streak that
   * belongs to it: the streak can only be credited to the new day for the part of the
   * interval that lies in it.
   *
   * The interval of a normal observation is one run second long, so it can reach
   * across at most one midnight. A longer interval — a paused game, a device whose
   * clock was moved — cannot be located better than that, and the whole of the advance
   * that fits into the new day is credited to it.
   *
   * Returns null when the interval did not reach across the midnight, in which case
   * the baseline of the day stays in force.
   */
  private streakAtDayStart(
    previousStreakMs: number,
    previousAtMs: number,
    currentStreakMs: number,
    currentAtMs: number
  ): number | null {
    const dayStart = Date.parse(`${this.state.dayKey}T00:00:00.000Z`);
    if (!Number.isFinite(dayStart)) return null;
    if (!(previousAtMs < dayStart && currentAtMs >= dayStart)) return null;
    const advance = currentStreakMs - previousStreakMs;
    if (advance <= 0) return null;
    // The observation is at or after the midnight, so the part of the interval that
    // lies in the new day is `insideDay`. An observation exactly on the midnight has
    // no elapsed time in the new day at all.
    const insideDay = currentAtMs - dayStart;
    return currentStreakMs - Math.min(advance, insideDay);
  }

  /** The current reading of a metric. */
  private metricValue(metric: QuestMetric): number {
    const scope = QUEST_METRIC_SCOPES[metric];
    if (scope === 'lifetime') {
      const key = LIFETIME_METRIC_KEYS[metric as keyof typeof LIFETIME_METRIC_KEYS];
      if (!key) return 0;
      return this.lifetime[key] ?? 0;
    }
    if (scope === 'day') return this.state.dayMetrics[metric] ?? 0;
    return this.state.runMetrics[metric] ?? 0;
  }

  /**
   * The progress that counts towards the goal.
   *
   * For a run-scoped counter this is the part of the value that was reached during the
   * current day: the counter of a run that crossed midnight still holds yesterday's
   * progress, and that progress does not finish today's goals. For a day-scoped counter
   * and for the lifetime counter the value is the progress already.
   */
  private dayProgress(definition: QuestDefinition): number {
    const scope = QUEST_METRIC_SCOPES[definition.metric];
    if (scope !== 'run') return this.metricValue(definition.metric);
    const value = this.metricValue(definition.metric);
    const baseline = this.state.baseline[definition.metric] ?? 0;
    return Math.max(0, value - baseline);
  }

  /**
   * Whether a quest is complete right now.
   *
   * A run-scoped quest counts the progress that was made during the current day, so a
   * run that crossed midnight cannot finish the next day's quest for free. A day-scoped
   * quest counts the best result of the day, and a lifetime quest counts the mirrored
   * total.
   */
  private isComplete(definition: QuestDefinition): boolean {
    const day = this.dayState();
    if (day.done.includes(definition.id)) return true;
    return this.dayProgress(definition) >= definition.target;
  }

  private isClaimed(definition: QuestDefinition): boolean {
    if (QUEST_METRIC_SCOPES[definition.metric] === 'lifetime') {
      return this.state.claimedLifetime.includes(definition.id);
    }
    return this.dayState().claimed.includes(definition.id);
  }

  /**
   * Recomputes the completion state of the active quests.
   *
   * The daily state keeps the best value each quest reached and which quests have moved
   * at all, so the HUD can show the day even after the run metrics were reset by the
   * next run.
   */
  private evaluateCompletion(): QuestId[] {
    const day = this.dayState();
    const newlyCompleted: QuestId[] = [];

    for (const definition of this.activeQuests()) {
      const value = this.metricValue(definition.metric);
      // The best value of the day is the progress of the day, not the raw counter: the
      // raw counter of a run that crossed the midnight still holds yesterday's part.
      const reached = this.dayProgress(definition);
      if (reached > 0) {
        const best = day.best[definition.id] ?? 0;
        if (reached > best) {
          day.best[definition.id] = reached;
          this.markDirty();
        }
        if (!day.started.includes(definition.id)) {
          day.started.push(definition.id);
          this.markDirty();
        }
      }

      if (this.isComplete(definition) && !day.done.includes(definition.id)) {
        day.done.push(definition.id);
        newlyCompleted.push(definition.id);
        this.markDirty();
      }
    }

    if (newlyCompleted.length > 0) this.persist(true);
    return newlyCompleted;
  }

  private markDirty(): void {
    this.dirty = true;
  }

  private writeRaw(raw: string): void {
    if (!this.storage || this.storageLocked) return;
    try {
      this.storage.write(raw);
      this.dirty = false;
      this.lastWriteAtMs = this.clock.now();
    } catch {
      // A failing storage must never break the game loop.
    }
  }

  /**
   * Writes the state to the storage.
   *
   * The events arrive in bursts, and a synchronous write per event would rewrite the
   * whole record dozens of times per second, so their writes are coalesced over
   * `PERSIST_COALESCE_MS`. The transitions that matter — a day roll, a completion, a
   * claim, the start of a run — are written through immediately.
   */
  private persist(force: boolean): void {
    if (!this.storage || this.storageLocked) return;
    if (!this.dirty && !force) return;
    const nowMs = this.clock.now();
    const elapsed = nowMs - this.lastWriteAtMs;
    // A clock that jumps backwards makes the elapsed time negative. The write must not
    // be blocked by that: the state would stay unpersisted until the clock catches up.
    if (!force && elapsed >= 0 && elapsed < PERSIST_COALESCE_MS) return;
    this.writeRaw(JSON.stringify(this.state));
  }
}

function zeroScope(metrics: readonly QuestMetric[]): QuestScopeValues {
  const values: QuestScopeValues = {};
  for (const metric of metrics) values[metric] = 0;
  return values;
}

function defaultCatalog(): readonly QuestDefinition[] {
  return QUEST_CATALOG;
}

export function createQuestEngine(options: QuestEngineOptions = {}): QuestEngine {
  return new QuestEngine(options);
}

/** The mode a metric moves in, exposed for the integration stage. */
export function metricModeOf(metric: QuestMetric): 'accumulate' | 'peak' {
  return QUEST_METRIC_MODES[metric];
}

/** The scope a metric is measured in, exposed for the integration stage. */
export function metricScopeOf(metric: QuestMetric): 'run' | 'day' | 'lifetime' {
  return QUEST_METRIC_SCOPES[metric];
}
