import { DAY_SCOPED_METRICS, RUN_SCOPED_METRICS } from './questCatalog';
import { isValidDayKey, utcDayKey } from './questRotation';
import type { QuestId, QuestMetric } from './questTypes';

/**
 * Quest save format, versioning and migration.
 *
 * The quest state is a separate, versioned record under its own storage key. It is not
 * part of `SaveData` and it never touches `ofeliya_save_v1`, so the quest core can
 * neither corrupt nor shadow the product save.
 *
 * The record is shaped after the Muse reference so the daily state can be mapped onto the
 * server snapshot one to one:
 *
 * ```
 * user:{id}:quests  →  { v, updatedAt, day: { best, done, started } }
 * ```
 *
 * The per-day state carries exactly those three Muse fields plus the local `claimed`
 * list, which is the bookkeeping the quest core needs to issue a receipt at most once.
 * The mapping is documented in `docs/patch11/QUEST_INTEGRATION_POINTS.md`.
 */

/**
 * Current quest save format version.
 *
 * - Version 1 was the first format: one active day, a flat list of finished quests.
 * - Version 2 added the `baseline` field that stops a run from completing a quest for
 *   free on the next day.
 * - Version 3 is the Muse-aligned format: the per-day map with the `best` / `done` /
 *   `started` vocabulary, the Muse metric names, the day-scoped counters and the
 *   lifetime claim list.
 * - Version 4 added the streak bookkeeping of the no-damage counter: the last observed
 *   streak and the baseline it is measured against. A version 3 record is read through
 *   the normal path and seeds its last streak from the inherited baseline.
 *   Optional lastTickTimeMs adds elapsed-millisecond freshness to v4 records.
 *
 * A record of a known older version is migrated, never thrown away.
 */
export const QUEST_SAVE_VERSION = 4;

/** The format versions this build can still read. */
export const QUEST_SAVE_MIN_VERSION = 1;

/**
 * Upper bound on remembered event ids, so the record cannot grow without limit.
 *
 * A redelivered event is recognised as long as its id is still inside this window. The
 * integration stage emits the events synchronously from the game loop, so a retry always
 * arrives inside the window; the bound caps the size of the record, it does not tolerate
 * an arbitrarily late delivery.
 */
export const MAX_REMEMBERED_EVENT_IDS = 1024;

/**
 * How many days of history the record keeps.
 *
 * The Muse reference keeps eight days and drops the rest. The history exists so the HUD
 * can show how the last days went; it is not a source of value.
 */
export const MAX_DAY_HISTORY = 8;

/** Metric readings of one scope. Only the metrics of that scope are present. */
export type QuestScopeValues = Partial<Record<QuestMetric, number>>;

/** The state of one UTC day. */
export interface QuestDayState {
  /** The run-scoped quests that were completed on this day. */
  done: QuestId[];
  /** The quests whose progress moved on this day. */
  started: QuestId[];
  /** The best value each quest reached on this day. */
  best: Record<string, number>;
  /** The run-scoped quests whose local receipt was issued on this day. */
  claimed: QuestId[];
}

/** The persisted shape of the quest core. */
export interface QuestSaveData {
  version: number;
  /** UTC day key the active set belongs to. */
  dayKey: string;
  /** The per-day states, newest day last. */
  days: Record<string, QuestDayState>;
  /** Run-scoped metrics, persisted so a resumed run keeps its quest progress. */
  runMetrics: QuestScopeValues;
  /**
   * Day-scoped metrics: the best result of the day, across every run of that day.
   *
   * The streak of yesterday is not a streak of today, so these reset at the UTC
   * midnight and not at the start of a run.
   */
  dayMetrics: QuestScopeValues;
  /**
   * The value every counter had when the current day started, or when the current run
   * started, whichever is later.
   *
   * A quest only completes when the counter improves on this baseline during the
   * current day, so a run that already reached the target before the day started
   * cannot complete today's quest for free.
   *
   * The baseline of the streak counter also moves when the streak breaks: a new streak
   * starts at zero, and the length of the new streak is what counts.
   */
  baseline: QuestScopeValues;
  /**
   * The last observed length of the current no-damage streak, in seconds.
   *
   * The quest core cannot see when a streak began, only how long it has been going. The
   * previous value is what tells a streak that continues from a streak that broke, and
   * it has to survive a reload — otherwise a reload would restart the streak count.
   */
  streakLast: number;
  /** Last accepted run-elapsed millisecond sample; absent in older v4/v3 records. */
  lastTickTimeMs?: number;
  /**
   * The wall clock of the last accepted streak sample, in epoch milliseconds.
   *
   * The UTC day is decided by the wall clock, and a streak sample does not say when it
   * was taken. This timestamp is the anchor that locates the sample inside a UTC day,
   * so the part of a streak that was alive before the midnight is not credited to the
   * new day. It is absent in older records and in the records of a run that was
   * restored from a checkpoint, because a restored run opens a new timeline.
   */
  lastTickAtMs?: number;
  /** Recently processed event ids, used as the idempotency key set. */
  seenEventIds: string[];
  /**
   * The lifetime quests whose local receipt was ever issued.
   *
   * The lifetime quests measure a total that only ever grows, so they would otherwise be
   * completed again on every day they are offered. The claim is therefore permanent, not
   * per day — the difference between a milestone and a daily payout.
   */
  claimedLifetime: QuestId[];
}

/** A fresh quest state for the given UTC day. */
export function createQuestSaveData(dayKey: string): QuestSaveData {
  return {
    version: QUEST_SAVE_VERSION,
    dayKey,
    days: {},
    runMetrics: emptyScopeValues(RUN_SCOPED_METRICS),
    dayMetrics: emptyScopeValues(DAY_SCOPED_METRICS),
    baseline: emptyScopeValues([...RUN_SCOPED_METRICS, ...DAY_SCOPED_METRICS]),
    streakLast: 0,
    seenEventIds: [],
    claimedLifetime: [],
  };
}

function emptyScopeValues(metrics: readonly QuestMetric[]): QuestScopeValues {
  const values: QuestScopeValues = {};
  for (const metric of metrics) values[metric] = 0;
  return values;
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function stringList(value: unknown): QuestId[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry === 'string' && entry.length > 0 && entry.length <= 64) seen.add(entry);
  }
  return [...seen];
}

function sanitizeScopeValues(
  value: unknown,
  metrics: readonly QuestMetric[]
): QuestScopeValues {
  const values = emptyScopeValues(metrics);
  if (!value || typeof value !== 'object') return values;
  const record = value as Record<string, unknown>;
  for (const metric of metrics) values[metric] = numberOrZero(record[metric]);
  return values;
}

function sanitizeBest(value: unknown): Record<string, number> {
  const best: Record<string, number> = {};
  if (!value || typeof value !== 'object') return best;
  for (const [questId, raw] of Object.entries(value as Record<string, unknown>)) {
    if (questId.length === 0 || questId.length > 64) continue;
    const reached = numberOrZero(raw);
    if (reached > 0) best[questId] = reached;
  }
  return best;
}

function sanitizeDayState(value: unknown): QuestDayState {
  if (!value || typeof value !== 'object') {
    return { done: [], started: [], best: {}, claimed: [] };
  }
  const record = value as Record<string, unknown>;
  return {
    done: stringList(record.done),
    started: stringList(record.started),
    best: sanitizeBest(record.best),
    claimed: stringList(record.claimed),
  };
}

/**
 * Sanitises a parsed quest record.
 *
 * Every field is validated on read. A hostile or corrupted record can therefore never
 * make the engine throw, and a partially broken record degrades to a partial one instead
 * of being lost.
 */
export function sanitizeQuestSaveData(
  value: unknown,
  fallbackDayKey: string
): QuestSaveData {
  const base = createQuestSaveData(fallbackDayKey);
  if (!value || typeof value !== 'object') return base;
  const record = value as Record<string, unknown>;

  const dayKey = isValidDayKey(record.dayKey) ? record.dayKey : fallbackDayKey;

  const days: Record<string, QuestDayState> = {};
  if (record.days && typeof record.days === 'object') {
    for (const [key, dayState] of Object.entries(record.days as Record<string, unknown>)) {
      if (!isValidDayKey(key)) continue;
      days[key] = sanitizeDayState(dayState);
    }
  }

  const baseline = sanitizeScopeValues(record.baseline, [
    ...RUN_SCOPED_METRICS,
    ...DAY_SCOPED_METRICS,
  ]);
  return {
    version: QUEST_SAVE_VERSION,
    dayKey,
    days,
    runMetrics: sanitizeScopeValues(record.runMetrics, RUN_SCOPED_METRICS),
    dayMetrics: sanitizeScopeValues(record.dayMetrics, DAY_SCOPED_METRICS),
    baseline,
    // v3 persisted the no-damage baseline but not the last observed streak.
    // Seed last from that baseline, or a new clean streak can never reset it.
    streakLast: numberOrZero(record.streakLast ?? baseline.q_nodmg),
    lastTickTimeMs: typeof record.lastTickTimeMs === 'number' && Number.isFinite(record.lastTickTimeMs) && record.lastTickTimeMs >= 0 ? record.lastTickTimeMs : undefined,
    lastTickAtMs: typeof record.lastTickAtMs === 'number' && Number.isFinite(record.lastTickAtMs) && record.lastTickAtMs >= 0 ? record.lastTickAtMs : undefined,
    seenEventIds: stringList(record.seenEventIds).slice(-MAX_REMEMBERED_EVENT_IDS),
    claimedLifetime: stringList(record.claimedLifetime),
  };
}

/**
 * Reads the format version of a persisted record without interpreting it.
 *
 * A record of a newer format than this build understands is read as far as it can be,
 * but it is never written back: the newer build owns it, and overwriting it would drop
 * the fields this build does not know about.
 */
export function peekQuestSaveVersion(raw: string | null): number | undefined {
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return undefined;
    const version = (parsed as Record<string, unknown>).version;
    return typeof version === 'number' && Number.isFinite(version) ? version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads a persisted record and brings it to the current format.
 *
 * Three input shapes are understood:
 *
 * 1. A current record — returned as is.
 * 2. A version 1 or 2 record of this subsystem — migrated field by field.
 * 3. A Muse reference record — a map of day key to `{ done, started, best }` with no
 *    version field. The days are carried over, because the storage key is shared with
 *    the Muse build and a player may have a Muse record on disk.
 *
 * Anything else yields a fresh record.
 */
export function parseQuestSaveData(
  raw: string | null,
  fallbackDayKey: string
): QuestSaveData {
  if (typeof raw !== 'string' || raw.length === 0) {
    return createQuestSaveData(fallbackDayKey);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return createQuestSaveData(fallbackDayKey);
  }

  if (!parsed || typeof parsed !== 'object') {
    return createQuestSaveData(fallbackDayKey);
  }

  const record = parsed as Record<string, unknown>;
  const version = typeof record.version === 'number' ? record.version : undefined;

  if (version === undefined) {
    return isMuseDayMap(record)
      ? fromMuseDayMap(record, fallbackDayKey)
      : createQuestSaveData(fallbackDayKey);
  }

  if (version > QUEST_SAVE_VERSION) {
    // A record from a newer build. The day map is the only part that can be read
    // without guessing, and the run metrics are dropped rather than misread.
    return sanitizeQuestSaveData(record, fallbackDayKey);
  }

  if (version === 1) {
    return fromLegacyV1(record, fallbackDayKey);
  }

  if (version === 2) {
    return fromLegacyV2(record, fallbackDayKey);
  }

  return sanitizeQuestSaveData(record, fallbackDayKey);
}

/**
 * True when the record looks like a Muse reference record.
 *
 * A Muse record is a plain map of day key to day state. It has no version field, and
 * every value is an object with the Muse day fields.
 */
function isMuseDayMap(record: Record<string, unknown>): boolean {
  const entries = Object.entries(record);
  if (entries.length === 0) return false;
  return entries.every(
    ([key, value]) =>
      isValidDayKey(key) &&
      !!value &&
      typeof value === 'object' &&
      !Array.isArray(value)
  );
}

/** Converts a Muse reference record into the current format. */
function fromMuseDayMap(
  record: Record<string, unknown>,
  fallbackDayKey: string
): QuestSaveData {
  const days: Record<string, QuestDayState> = {};
  const dayKeys = Object.keys(record)
    .filter(isValidDayKey)
    .sort();
  for (const dayKey of dayKeys) {
    days[dayKey] = sanitizeDayState(record[dayKey]);
  }
  const dayKey = dayKeys.length > 0 ? dayKeys[dayKeys.length - 1] : fallbackDayKey;
  return {
    version: QUEST_SAVE_VERSION,
    dayKey,
    days,
    runMetrics: emptyScopeValues(RUN_SCOPED_METRICS),
    dayMetrics: emptyScopeValues(DAY_SCOPED_METRICS),
    baseline: emptyScopeValues([...RUN_SCOPED_METRICS, ...DAY_SCOPED_METRICS]),
    streakLast: 0,
    seenEventIds: [],
    claimedLifetime: [],
  };
}

/**
 * Migrates a version 1 record.
 *
 * Version 1 kept one active day with a flat completion list and used the first metric
 * vocabulary. Only the counters that still exist keep their value; the old quest ids
 * are dropped, because the catalog they referred to no longer exists. The record itself
 * is never thrown away.
 */
function fromLegacyV1(
  record: Record<string, unknown>,
  fallbackDayKey: string
): QuestSaveData {
  const dayKey = isValidDayKey(record.dayKey) ? record.dayKey : fallbackDayKey;
  const runMetrics = migrateLegacyMetrics(record.runMetrics);
  const baseline = migrateLegacyMetrics(record.baseline);

  return {
    version: QUEST_SAVE_VERSION,
    dayKey,
    days: {
      [dayKey]: {
        done: stringList(record.completedQuestIds),
        started: [],
        best: sanitizeBest(record.completedValues),
        claimed: stringList(record.claimedQuestIds),
      },
    },
    runMetrics,
    dayMetrics: emptyScopeValues(DAY_SCOPED_METRICS),
    baseline,
    streakLast: numberOrZero(baseline.q_nodmg),
    seenEventIds: stringList(record.seenEventIds).slice(-MAX_REMEMBERED_EVENT_IDS),
    claimedLifetime: [],
  };
}

/** Migrates a version 2 record: version 1 plus the baseline field. */
function fromLegacyV2(
  record: Record<string, unknown>,
  fallbackDayKey: string
): QuestSaveData {
  return fromLegacyV1(record, fallbackDayKey);
}

/**
 * Maps the old metric names onto the Muse ones.
 *
 * The two counters that survive keep their value; the time counters are converted from
 * milliseconds to seconds, because the Muse targets are written in seconds.
 */
function migrateLegacyMetrics(value: unknown): QuestScopeValues {
  const record = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const metrics = emptyScopeValues(RUN_SCOPED_METRICS);
  metrics.q_kills = numberOrZero(record.run_kills) || numberOrZero(record.day_kills);
  metrics.q_time = Math.floor(
    (numberOrZero(record.run_time_ms) || numberOrZero(record.day_time_ms)) / 1000
  );
  metrics.q_nodmg = Math.floor(
    (numberOrZero(record.run_no_damage_ms) || numberOrZero(record.day_no_damage_ms)) / 1000
  );
  metrics.q_rna = numberOrZero(record.run_rna);
  metrics.q_mut = numberOrZero(record.run_mutations);
  metrics.q_elites = numberOrZero(record.run_elites);
  return metrics;
}

/** The state of a day, created empty when it does not exist yet. */
export function ensureDayState(
  save: QuestSaveData,
  dayKey: string
): QuestDayState {
  const existing = save.days[dayKey];
  if (existing) return existing;
  const created: QuestDayState = { done: [], started: [], best: {}, claimed: [] };
  save.days[dayKey] = created;
  return created;
}

/**
 * Drops the day history that falls out of the retention window.
 *
 * At most `MAX_DAY_HISTORY` days are kept, and the active day is always one of them —
 * even when it is not the newest key, in which case the oldest day is dropped instead.
 */
export function pruneDayHistory(save: QuestSaveData): void {
  const keys = Object.keys(save.days)
    .filter(isValidDayKey)
    .sort();
  const keep = new Set<string>([save.dayKey]);
  for (const key of keys.slice(-(MAX_DAY_HISTORY - 1))) keep.add(key);
  for (const key of keys) {
    if (!keep.has(key)) delete save.days[key];
  }
}

/** The UTC day key of an epoch timestamp. */
export function dayKeyOf(atMs: number): string {
  return utcDayKey(atMs);
}
