import { execFileSync } from 'node:child_process';
import { readdirSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Mutation check for the quest core.
 *
 * Every guarantee the quest core claims has to be able to fail. Each mutation below
 * breaks exactly one of them on purpose; the contract check must go red for every
 * mutation, otherwise that guarantee is not really covered.
 *
 * The whole run happens in a non-UTC time zone on purpose: the quest core has to be
 * independent of the device time zone, and a local-time regression is only visible when
 * the device is not on UTC.
 */

// Avoid native Windows cpSync overwrite/unlink failures; copy every fixture file.
function copyFixture(source, target) {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name), to = join(target, entry.name);
    if (entry.isDirectory()) copyFixture(from, to);
    else writeFileSync(to, readFileSync(from));
  }
}
const temp = mkdtempSync(join(tmpdir(), 'ofeliya-quest-mutants-'));
const suite = resolve('scripts/check-quest-core.mjs');
const TIME_ZONE = 'Asia/Tokyo';

const MUTATIONS = [
  {name:'F5 accepts stale tick',edits:[{file:'questEngine.ts',find:'event.timeMs <= this.state.lastTickTimeMs',replace:'event.timeMs < -1'}]},
  {name:'F5 accepts equal tick',edits:[{file:'questEngine.ts',find:'event.timeMs <= this.state.lastTickTimeMs',replace:'event.timeMs < this.state.lastTickTimeMs'}]},
  {name:'F5 drops persisted freshness',edits:[{file:'questState.ts',find:"lastTickTimeMs: typeof record.lastTickTimeMs === 'number' && Number.isFinite(record.lastTickTimeMs) && record.lastTickTimeMs >= 0 ? record.lastTickTimeMs : undefined,",replace:"lastTickTimeMs: undefined,"}]},

  {
    // A control. It changes nothing, so the contract check has to keep passing. It proves
    // the harness does not simply fail on every edit.
    name: 'CONTROL: a semantically empty change',
    control: true,
    edits: [
      {
        file: 'questEngine.ts',
        find: 'private duplicateEvents = 0;',
        replace: 'private duplicateEvents = 0; // control',
      },
    ],
  },

  {
    name: 'v3 no-damage migration must seed previous streak from baseline',
    edits: [{
      file: 'questState.ts',
      find: 'streakLast: numberOrZero(record.streakLast ?? baseline.q_nodmg),',
      replace: 'streakLast: numberOrZero(record.streakLast),',
    }],
  },

  // --- the Muse compatibility -----------------------------------------------------------------

  {
    name: 'the daily selection uses another salt',
    edits: [
      {
        file: 'questRotation.ts',
        find: "const SELECTION_SALT = 'ofeliya-quests';",
        replace: "const SELECTION_SALT = 'ofeliya-quest';",
      },
    ],
  },
  {
    name: 'a quest target drifts from the Muse reference',
    edits: [
      {
        file: 'questCatalog.ts',
        find: "    target: 50,\n    family: 'combat',",
        replace: "    target: 51,\n    family: 'combat',",
      },
    ],
  },
  {
    name: 'a quest title drifts from the Muse reference',
    edits: [
      {
        file: 'questCatalog.ts',
        find: "title: 'Первая кровь',",
        replace: "title: 'Первая кровь!',",
      },
    ],
  },
  {
    name: 'the catalog carries a reward',
    edits: [
      {
        file: 'questTypes.ts',
        find: '  readonly target: number;',
        replace: '  readonly target: number;\n  readonly rewardRna?: number;',
      },
      {
        file: 'questCatalog.ts',
        find: "    target: 50,\n    family: 'combat',",
        replace: "    target: 50,\n    rewardRna: 50,\n    family: 'combat',",
      },
    ],
  },
  {
    name: 'a quest is missing from the catalog',
    edits: [
      {
        file: 'questCatalog.ts',
        find: "  {\n    id: 'ghost',",
        replace: "  {\n    id: 'ghost_missing',",
      },
    ],
  },
  {
    name: 'the survival target is written in milliseconds',
    edits: [
      {
        file: 'questCatalog.ts',
        find: "    target: 180,\n    family: 'survival',",
        replace: "    target: 180_000,\n    family: 'survival',",
      },
    ],
  },
  {
    name: 'the quest record leaves the Muse storage key',
    edits: [
      {
        file: 'questStorage.ts',
        find: "export const QUEST_STORAGE_KEY = 'ofeliya.quests.v1';",
        replace: "export const QUEST_STORAGE_KEY = 'ofeliya_quests_v1';",
      },
    ],
  },
  {
    name: 'a Muse record is discarded instead of read',
    edits: [
      {
        file: 'questState.ts',
        find: '    return isMuseDayMap(record)\n      ? fromMuseDayMap(record, fallbackDayKey)\n      : createQuestSaveData(fallbackDayKey);',
        replace: '    return createQuestSaveData(fallbackDayKey);',
      },
    ],
  },
  {
    name: 'the Muse day state is dropped instead of carried over',
    edits: [
      {
        file: 'questState.ts',
        find: '    days[dayKey] = sanitizeDayState(record[dayKey]);',
        replace: '    days[dayKey] = { done: [], started: [], best: {}, claimed: [] };',
      },
    ],
  },

  // --- the rotation -----------------------------------------------------------------------------

  {
    name: 'the day key is taken in local time instead of UTC',
    edits: [
      {
        file: 'questRotation.ts',
        find: '  const year = date.getUTCFullYear();\n  const month = `${date.getUTCMonth() + 1}`.padStart(2, \'0\');\n  const day = `${date.getUTCDate()}`.padStart(2, \'0\');',
        replace: '  const year = date.getFullYear();\n  const month = `${date.getMonth() + 1}`.padStart(2, \'0\');\n  const day = `${date.getDate()}`.padStart(2, \'0\');',
      },
    ],
  },
  {
    name: 'the day key is off by one day',
    edits: [
      {
        file: 'questRotation.ts',
        find: "  const day = `${date.getUTCDate()}`.padStart(2, '0');",
        replace: "  const day = `${date.getUTCDate() + 1}`.padStart(2, '0');",
      },
    ],
  },
  {
    name: 'the daily set has the wrong size',
    edits: [
      {
        file: 'questRotation.ts',
        find: 'export const DAILY_QUEST_COUNT = 3;',
        replace: 'export const DAILY_QUEST_COUNT = 2;',
      },
    ],
  },
  {
    name: 'the daily set is not shuffled',
    edits: [
      {
        file: 'questRotation.ts',
        find: '  for (let index = order.length - 1; index > 0; index -= 1) {',
        replace: '  for (let index = 0; index < 0; index -= 1) {',
      },
    ],
  },
  {
    name: 'the shuffle takes the wrong end of the order',
    edits: [
      {
        file: 'questRotation.ts',
        find: '  return order.slice(0, count);',
        replace: '  return order.slice(order.length - count);',
      },
    ],
  },
  {
    name: 'the seed hash uses another constant',
    edits: [
      {
        file: 'questRotation.ts',
        find: '  let hash = 0x811c9dc5;',
        replace: '  let hash = 0x811c9dc6;',
      },
    ],
  },
  {
    name: 'the random source is not scaled',
    edits: [
      {
        file: 'questRotation.ts',
        find: '    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;',
        replace: '    return ((t ^ (t >>> 14)) >>> 0) % 256;',
      },
    ],
  },

  // --- the counters -----------------------------------------------------------------------------

  {
    name: 'a redelivered event is applied twice',
    edits: [
      {
        file: 'questEngine.ts',
        find: '      if (this.isDuplicate(event.id)) {',
        replace: '      if (false && this.isDuplicate(event.id)) {',
      },
    ],
  },
  {
    name: 'the duplicate is not counted',
    edits: [
      {
        file: 'questEngine.ts',
        find: '        this.duplicateEvents += 1;',
        replace: '        this.duplicateEvents += 0;',
      },
    ],
  },
  {
    name: 'the kill counter counts two kills',
    edits: [
      {
        file: 'questEngine.ts',
        find: "        this.addRunMetric('q_kills', 1);",
        replace: "        this.addRunMetric('q_kills', 2);",
      },
    ],
  },
  {
    name: 'the elite kill is not counted',
    edits: [
      {
        file: 'questEngine.ts',
        find: '        if (event.elite === true) this.addRunMetric(\'q_elites\', 1);',
        replace: '        if (event.elite === true) this.addRunMetric(\'q_elites\', 0);',
      },
    ],
  },
  {
    name: 'the collected RNA is not counted',
    edits: [
      {
        file: 'questEngine.ts',
        find: "        this.addRunMetric('q_rna', finiteOrZero(event.delta));",
        replace: "        this.addRunMetric('q_rna', 0);",
      },
    ],
  },
  {
    name: 'the chosen mutation is not counted',
    edits: [
      {
        file: 'questEngine.ts',
        find: "        this.addRunMetric('q_mut', 1);",
        replace: "        this.addRunMetric('q_mut', 0);",
      },
    ],
  },
  {
    name: 'the survival peak is overwritten instead of kept',
    edits: [
      {
        file: 'questEngine.ts',
        find: '  private peakRunMetric(metric: QuestMetric, value: number): void {\n    if (value <= 0) return;\n    const current = this.state.runMetrics[metric] ?? 0;\n    if (value <= current) return;',
        replace: '  private peakRunMetric(metric: QuestMetric, value: number): void {\n    if (value <= 0) return;\n    const current = this.state.runMetrics[metric] ?? 0;',
      },
    ],
  },
  {
    name: 'the streak of the day is overwritten instead of kept',
    edits: [
      {
        file: 'questEngine.ts',
        find: '    const best = this.state.dayMetrics.q_nodmg ?? 0;\n    if (progress > best) {',
        replace: '    const best = this.state.dayMetrics.q_nodmg ?? 0;\n    if (false && progress > best) {',
      },
    ],
  },
  {
    name: 'the survival counter is not converted to seconds',
    edits: [
      {
        file: 'questEngine.ts',
        find: "        this.peakRunMetric('q_time', Math.floor(finiteOrZero(event.timeMs) / 1000));",
        replace: "        this.peakRunMetric('q_time', Math.floor(finiteOrZero(event.timeMs)));",
      },
    ],
  },
  {
    name: 'the streak counter is not converted to seconds',
    edits: [
      {
        file: 'questEngine.ts',
        find: '        this.trackNoDamageStreak(event.noDamageMs / 1000);',
        replace: '        this.trackNoDamageStreak(event.noDamageMs);',
      },
    ],
  },
  {
    name: 'the streak of the day is not counted at all',
    edits: [
      {
        file: 'questEngine.ts',
        find: '        this.trackNoDamageStreak(event.noDamageMs / 1000);',
        replace: '        // the streak of the day was not tracked',
      },
    ],
  },
  {
    name: 'a new run does not reset the counters',
    edits: [
      {
        file: 'questEngine.ts',
        find: '        this.resetRunMetrics();',
        replace: '        // the counters were not reset',
      },
    ],
  },
  {
    name: 'a new run does not reset the baseline',
    edits: [
      {
        file: 'questEngine.ts',
        find: '        this.state.baseline = zeroScope([...RUN_SCOPED_METRICS, ...DAY_SCOPED_METRICS]);',
        replace: '        // the baseline was not reset',
      },
    ],
  },

  // --- the progress of the day ---------------------------------------------------------------------

  {
    name: 'the progress of the previous day counts towards the goals of the new day',
    edits: [
      {
        file: 'questEngine.ts',
        find: '    const baseline = this.state.baseline[definition.metric] ?? 0;\n    return Math.max(0, value - baseline);',
        replace: '    return value;',
      },
    ],
  },
  {
    name: 'the day rollover does not take the run as the baseline',
    edits: [
      {
        file: 'questEngine.ts',
        find: '    this.state.baseline = { ...this.state.runMetrics };',
        replace: '    this.state.baseline = zeroScope(RUN_SCOPED_METRICS);',
      },
    ],
  },
  {
    name: 'the streak of the day is not reset at the midnight',
    edits: [
      {
        file: 'questEngine.ts',
        find: '    this.state.dayMetrics = zeroScope(DAY_SCOPED_METRICS);',
        replace: '    // the day counters were not reset',
      },
    ],
  },
  {
    name: 'the streak counter is treated as a run counter',
    edits: [
      {
        file: 'questCatalog.ts',
        find: '  q_nodmg: \'day\',',
        replace: '  q_nodmg: \'run\',',
      },
    ],
  },
  {
    name: 'the target is not required for a completion',
    edits: [
      {
        file: 'questEngine.ts',
        find: '    return this.dayProgress(definition) >= definition.target;',
        replace: '    return this.dayProgress(definition) >= 0;',
      },
    ],
  },
  {
    name: 'the completion is not recorded, so the next run loses it',
    edits: [
      {
        file: 'questEngine.ts',
        find: '        day.done.push(definition.id);',
        replace: '        // the completion was not recorded',
      },
    ],
  },
  {
    name: 'the best value of the day is not kept',
    edits: [
      {
        file: 'questEngine.ts',
        find: '        if (reached > best) {',
        replace: '        if (false && reached > best) {',
      },
    ],
  },
  {
    name: 'a quest that moved is not marked as started',
    edits: [
      {
        file: 'questEngine.ts',
        find: '          day.started.push(definition.id);',
        replace: '          // the quest was not started',
      },
    ],
  },

  // --- the day ----------------------------------------------------------------------------------

  {
    name: 'the quest day rolls backwards with the clock',
    edits: [
      {
        file: 'questEngine.ts',
        find: '    if (dayKey < this.state.dayKey) return;',
        replace: '    // the backwards guard was removed',
      },
    ],
  },
  {
    name: 'the active set does not follow the day',
    edits: [
      {
        file: 'questEngine.ts',
        find: '    this.activeQuestIds = this.selectFor(dayKey);',
        replace: '    // the active set was not updated',
      },
    ],
  },
  {
    name: 'a day key from the far future is trusted',
    edits: [
      {
        file: 'questEngine.ts',
        find: '    if (!Number.isFinite(stored) || stored <= limit) return;',
        replace: '    // the clamp of the future day key was removed',
      },
    ],
  },
  {
    name: 'a record of a newer build is overwritten',
    edits: [
      {
        file: 'questEngine.ts',
        find: '    if (!this.storage || this.storageLocked) return;',
        replace: '    if (!this.storage) return;',
      },
    ],
  },
  {
    name: 'the day history is never pruned',
    edits: [
      {
        file: 'questEngine.ts',
        find: '    pruneDayHistory(parsed);',
        replace: '    // the history is never pruned on load',
      },
    ],
  },
  {
    name: 'the day history keeps more days than the window allows',
    edits: [
      {
        file: 'questState.ts',
        find: '  for (const key of keys.slice(-(MAX_DAY_HISTORY - 1))) keep.add(key);',
        replace: '  for (const key of keys) keep.add(key);',
      },
    ],
  },

  // --- the receipt ------------------------------------------------------------------------------

  {
    name: 'a receipt is issued for a quest outside the daily set',
    edits: [
      {
        file: 'questEngine.ts',
        find: '    if (!this.activeQuestIds.includes(questId)) return null;',
        replace: '    // the daily set guard was removed',
      },
    ],
  },
  {
    name: 'the receipt can be issued twice on the same day',
    edits: [
      {
        file: 'questEngine.ts',
        find: '    if (day.claimed.includes(questId)) return null;',
        replace: '    // the day guard was removed',
      },
    ],
  },
  {
    name: 'the lifetime milestone is paid out again on the next day',
    edits: [
      {
        file: 'questEngine.ts',
        find: '      if (this.state.claimedLifetime.includes(questId)) return null;',
        replace: '      // the lifetime guard was removed',
      },
    ],
  },
  {
    name: 'a receipt is issued for a quest that is not complete',
    edits: [
      {
        file: 'questEngine.ts',
        find: '    if (!this.isComplete(definition)) return null;',
        replace: '    // the completion check was removed',
      },
    ],
  },
  {
    name: 'the receipt is not local state',
    edits: [
      {
        file: 'questEngine.ts',
        find: "        state: 'local_pending',",
        replace: "        state: 'server_confirmed' as 'local_pending',",
        all: true,
      },
    ],
  },

  // --- the mirror ---------------------------------------------------------------------------------

  {
    name: 'the mirrored totals are ignored',
    edits: [
      {
        file: 'questEngine.ts',
        find: '    this.lifetime = { completedRuns, synced: true };',
        replace: '    this.lifetime = { completedRuns: 0, synced: true };',
      },
    ],
  },
  {
    name: 'the quest core keeps its own lifetime total',
    edits: [
      {
        file: 'questEngine.ts',
        find: "      case 'run_completed': {",
        replace: "      case 'run_completed': {\n        this.lifetime = { ...this.lifetime, completedRuns: this.lifetime.completedRuns + 1 };",
      },
    ],
  },
  {
    name: 'the mirrored totals are written to the record',
    edits: [
      {
        file: 'questEngine.ts',
        find: '    this.lifetime = { completedRuns, synced: true };',
        replace: '    this.lifetime = { completedRuns, synced: true };\n    (this.state as unknown as Record<string, unknown>).lifetime = { completedRuns };',
      },
    ],
  },

  // --- the record ------------------------------------------------------------------------------------

  {
    name: 'the remembered event ids are unbounded',
    edits: [
      {
        file: 'questEngine.ts',
        find: '    const overflow = this.state.seenEventIds.length - MAX_REMEMBERED_EVENT_IDS;',
        replace: '    const overflow = 0;',
      },
    ],
  },
  {
    name: 'the peak event is remembered, so a redelivery looks like a duplicate',
    edits: [
      {
        file: 'questEngine.ts',
        find: "    const isPeakEvent = event.kind === 'run_tick';",
        replace: "    const isPeakEvent = false;",
      },
    ],
  },
  {
    name: 'a version 1 record is discarded instead of migrated',
    edits: [
      {
        file: 'questState.ts',
        find: '  if (version === 1) {',
        replace: '  if (version === 0) {',
      },
    ],
  },
  {
    name: 'the migrated counters are dropped',
    edits: [
      {
        file: 'questState.ts',
        find: '  metrics.q_kills = numberOrZero(record.run_kills) || numberOrZero(record.day_kills);',
        replace: '  metrics.q_kills = 0;',
      },
    ],
  },
  {
    name: 'the migrated time counter is not converted to seconds',
    edits: [
      {
        file: 'questState.ts',
        find: '  metrics.q_time = Math.floor(\n    (numberOrZero(record.run_time_ms) || numberOrZero(record.day_time_ms)) / 1000\n  );',
        replace: '  metrics.q_time = numberOrZero(record.run_time_ms);',
      },
    ],
  },
  {
    name: 'a damaged save throws instead of being rebuilt',
    edits: [
      {
        file: 'questState.ts',
        find: '  let parsed: unknown;\n  try {\n    parsed = JSON.parse(raw);\n  } catch {\n    return createQuestSaveData(fallbackDayKey);\n  }',
        replace: '  const parsed: unknown = JSON.parse(raw);',
      },
    ],
  },
  {
    name: 'a hostile day key is taken over',
    edits: [
      {
        file: 'questState.ts',
        find: '  const dayKey = isValidDayKey(record.dayKey) ? record.dayKey : fallbackDayKey;',
        replace: '  const dayKey = typeof record.dayKey === \'string\' ? record.dayKey : fallbackDayKey;',
      },
    ],
  },
  {
    name: 'a hostile record is not sanitised',
    edits: [
      {
        file: 'questState.ts',
        find: '  return {\n    version: QUEST_SAVE_VERSION,\n    dayKey,\n    days,\n    runMetrics: sanitizeScopeValues(record.runMetrics, RUN_SCOPED_METRICS),',
        replace: '  return {\n    version: QUEST_SAVE_VERSION,\n    dayKey,\n    days,\n    runMetrics: record.runMetrics as QuestScopeValues,',
      },
    ],
  },
  {
    name: 'a storage that throws takes the engine down',
    edits: [
      {
        file: 'questEngine.ts',
        find: '    try {\n      this.storage.write(raw);\n      this.dirty = false;\n      this.lastWriteAtMs = this.clock.now();\n    } catch {\n      // A failing storage must never break the game loop.\n    }',
        replace: '    this.storage.write(raw);\n    this.dirty = false;\n    this.lastWriteAtMs = this.clock.now();',
      },
    ],
  },
  {
    name: 'the writes are not coalesced, so a burst rewrites the record per event',
    edits: [
      {
        file: 'questEngine.ts',
        find: '    if (!force && elapsed >= 0 && elapsed < PERSIST_COALESCE_MS) return;',
        replace: '    // the coalescing was removed',
      },
    ],
  },
  {
    name: 'the resumed run cannot realign the counters',
    edits: [
      {
        file: 'questEngine.ts',
        find: '    if (this.state.runMetrics.q_kills !== kills) {',
        replace: '    if (false && this.state.runMetrics.q_kills !== kills) {',
      },
    ],
  },

  {
    name: 'the retention window drifts',
    edits: [
      {
        file: 'questState.ts',
        find: 'export const MAX_DAY_HISTORY = 8;',
        replace: 'export const MAX_DAY_HISTORY = 365;',
      },
    ],
  },
  {
    name: 'the idempotency window drifts',
    edits: [
      {
        file: 'questState.ts',
        find: 'export const MAX_REMEMBERED_EVENT_IDS = 1024;',
        replace: 'export const MAX_REMEMBERED_EVENT_IDS = 10_000_000;',
      },
    ],
  },
  {
    name: 'the record version drifts',
    edits: [
      {
        file: 'questState.ts',
        find: 'export const QUEST_SAVE_VERSION = 4;',
        replace: 'export const QUEST_SAVE_VERSION = 5;',
      },
    ],
  },
  {
    name: 'the day skew limit drifts',
    edits: [
      {
        file: 'questEngine.ts',
        find: 'export const MAX_DAY_SKEW_DAYS = 2;',
        replace: 'export const MAX_DAY_SKEW_DAYS = 365;',
      },
    ],
  },
  {
    name: 'the coalescing window drifts',
    edits: [
      {
        file: 'questEngine.ts',
        find: 'export const PERSIST_COALESCE_MS = 1000;',
        replace: 'export const PERSIST_COALESCE_MS = 1;',
      },
    ],
  },
  {
    name: 'the event id is not required',
    edits: [
      {
        file: 'questEngine.ts',
        find: "    if (!event || typeof event.id !== 'string' || event.id.length === 0) {\n      return { accepted: false, duplicate: false, newlyCompleted: [] };\n    }",
        replace: '    // the id is not required',
      },
    ],
  },
  {
    name: 'the resume seam drops the survival time',
    edits: [
      {
        file: 'questEngine.ts',
        find: '    const seconds = Math.floor(timeMs / 1000);\n    // The survival time is a peak of the run: a restored run cannot have survived\n    // longer than the run already did.\n    if (seconds > (this.state.runMetrics.q_time ?? 0)) {\n      this.state.runMetrics.q_time = seconds;\n      changed = true;\n    }',
        replace: '    // the survival time is not realigned',
      },
    ],
  },
  {
    name: 'the streak of the previous day counts towards the goal of the new day',
    edits: [
      {
        file: 'questEngine.ts',
        find: '    this.state.baseline.q_nodmg = this.state.streakLast ?? 0;',
        replace: '    // the streak baseline was not taken',
      },
    ],
  },
  {
    name: 'a broken streak does not start a new one',
    edits: [
      {
        file: 'questEngine.ts',
        find: '      this.state.baseline.q_nodmg = 0;',
        replace: '      // the new streak was not started',
      },
    ],
  },
  {
    name: 'the streak of the day is not tracked',
    edits: [
      {
        file: 'questEngine.ts',
        find: '        this.trackNoDamageStreak(event.noDamageMs / 1000);',
        replace: '        // the streak was not tracked',
      },
    ],
  },
  {
    name: 'the restored run leaves the baseline above the counter',
    edits: [
      {
        file: 'questEngine.ts',
        find: '  private lowerBaseline(metric: QuestMetric, value: number): void {\n    const baseline = this.state.baseline[metric] ?? 0;\n    if (value < baseline) this.state.baseline[metric] = value;\n  }',
        replace: '  private lowerBaseline(metric: QuestMetric, value: number): void {\n    // the baseline was not lowered\n  }',
      },
    ],
  },
  {
    name: 'the restored run lowers the peak of the run',
    edits: [
      {
        file: 'questEngine.ts',
        find: '    if (seconds > (this.state.runMetrics.q_time ?? 0)) {',
        replace: '    if (seconds !== (this.state.runMetrics.q_time ?? 0)) {',
      },
    ],
  },
  {
    name: 'the snapshot does not roll the day',
    edits: [
      {
        file: 'questEngine.ts',
        find: '    // The day can pass while nothing happens, and the HUD asks for the snapshot. The\n    // rotation therefore happens here as well, not only when an event arrives.\n    this.rollDayIfNeeded(this.clock.now());',
        replace: '    // the day was not rolled',
      },
    ],
  },
  {
    name: 'a backwards clock blocks the writes',
    edits: [
      {
        file: 'questEngine.ts',
        find: '    if (!force && elapsed >= 0 && elapsed < PERSIST_COALESCE_MS) return;',
        replace: '    if (!force && elapsed < PERSIST_COALESCE_MS) return;',
      },
    ],
  },
  {
    name: 'a broken clock produces a broken day key',
    edits: [
      {
        file: 'questRotation.ts',
        find: '  if (!Number.isFinite(atMs)) return EPOCH_DAY_KEY;',
        replace: '  // the broken clock guard was removed',
      },
    ],
  },
  {
    name: 'the best value of the day is the raw counter',
    edits: [
      {
        file: 'questEngine.ts',
        find: '      const reached = this.dayProgress(definition);',
        replace: '      const reached = value;',
      },
    ],
  },
  {
    name: 'the quest core performs a request',
    edits: [
      {
        file: 'questEngine.ts',
        find: "  ): Promise<'confirmed' | 'rejected' | 'unavailable'> {\n    if (!this.rewardGateway) return 'unavailable';",
        replace: "  ): Promise<'confirmed' | 'rejected' | 'unavailable'> {\n    void fetch('https://example.invalid').catch(() => undefined);\n    if (!this.rewardGateway) return 'unavailable';",
      },
    ],
  },
  {
    name: 'the quest core reaches for a browser global',
    edits: [
      {
        file: 'questEngine.ts',
        find: '  private markDirty(): void {',
        replace: '  private markDirty(): void {\n    if (typeof window !== \'undefined\') void window;',
      },
    ],
  },
  {
    name: 'the quest core declares a value field',
    edits: [
      {
        file: 'questTypes.ts',
        find: 'export interface QuestLifetimeMirror {',
        replace: 'export interface QuestLifetimeMirror {\n  readonly rewardRna?: number;',
      },
    ],
  },
  {
    name: 'the quest core loads a package',
    edits: [
      {
        file: 'questEngine.ts',
        find: "import type {\n  QuestClock,",
        replace: "import type { ClientOptions } from '@maxhub/max-bot-api';\nimport type {\n  QuestClock,",
      },
    ],
  },
];

function runSuite(cwd) {
  try {
    execFileSync(process.execPath, [suite], {
      cwd,
      stdio: 'pipe',
      env: { ...process.env, TZ: TIME_ZONE },
    });
    return { ok: true, output: '' };
  } catch (error) {
    const stdout = error.stdout ? error.stdout.toString() : '';
    const stderr = error.stderr ? error.stderr.toString() : '';
    return { ok: false, output: `${stdout}\n${stderr}` };
  }
}

let caught = 0;
let controls = 0;
const failures = [];

try {
  copyFixture(resolve('src/quests'), join(temp, 'src/quests'));
  copyFixture(resolve('scripts'), join(temp, 'scripts'));
  symlinkSync(join(resolve('.'), 'node_modules'), join(temp, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  // A stub of the product save, so a mutation that imports it compiles and the isolation
  // check has to catch it on its own instead of the compiler catching it by accident.
  mkdirSync(join(temp, 'src/systems'), { recursive: true });
  writeFileSync(
    join(temp, 'src/systems/SaveSystem.ts'),
    'export const SaveSystem = { get: () => ({ totalKills: 0, runs: 0 }) };\n'
  );

  const baseline = runSuite(temp);
  if (!baseline.ok) {
    console.error('the unmutated quest core must pass the contract check before any mutation runs');
    console.error(baseline.output);
    process.exit(1);
  }

  for (const mutation of MUTATIONS) {
    // The whole quest core is restored before every mutation. Without this a mutation
    // would inherit the previous mutation's content and would prove nothing at all.
    copyFixture(resolve('src/quests'), join(temp, 'src/quests'));

    const touched = new Map();
    let applicable = true;

    for (const edit of mutation.edits) {
      const path = join(temp, 'src/quests', edit.file);
      const pristine = touched.has(edit.file)
        ? touched.get(edit.file)
        : readFileSync(resolve('src/quests', edit.file), 'utf8').replace(/\r\n/g, '\n');
      if (!pristine.includes(edit.find)) {
        failures.push(`${mutation.name}: the mutation no longer matches the source of ${edit.file}`);
        applicable = false;
        break;
      }
      touched.set(
        edit.file,
        edit.all
          ? pristine.split(edit.find).join(edit.replace)
          : pristine.replace(edit.find, edit.replace)
      );
    }
    if (!applicable) continue;

    for (const [file, content] of touched) {
      writeFileSync(join(temp, 'src/quests', file), content);
    }

    const result = runSuite(temp);

    if (mutation.control) {
      if (result.ok) {
        controls += 1;
      } else {
        failures.push(`${mutation.name}: the control mutation must not change the result`);
      }
      continue;
    }

    if (result.ok) {
      failures.push(`${mutation.name}: the contract check still passed`);
      continue;
    }

    // A compile error is not proof of anything. The mutation has to be caught by the
    // contract check actually running, otherwise the guarantee it stands for is not
    // covered. A TypeScript diagnostic does not count.
    if (/error TS\d+/.test(result.output)) {
      failures.push(
        `${mutation.name}: the contract check failed to compile instead of failing a check`
      );
      continue;
    }

    // A catch has to be a real failed check, not an infrastructure accident: a machine
    // that ran out of memory or a process that was killed would otherwise look like a
    // passing mutation. Only a failed assertion counts.
    if (!/AssertionError/.test(result.output)) {
      failures.push(
        `${mutation.name}: the contract check did not fail a check, it failed in some other way`
      );
      continue;
    }

    caught += 1;
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    console.error(
      `quest core mutations: ${caught}/${MUTATIONS.length - controls} caught, ${failures.length} missed`
    );
    process.exit(1);
  }

  console.log(
    `quest core mutations: ${caught}/${MUTATIONS.length - controls} caught, ` +
      `${controls} control unchanged (time zone ${TIME_ZONE})`
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
