/**
 * Public surface of the OFELIYA quest core.
 *
 * The integration stage imports from this module only. Nothing here reaches into the
 * Phaser scenes, the product save, the server or the Daily system.
 *
 * The quest vocabulary — the ids, the titles, the descriptions, the counter names and
 * the targets — is the Muse reference. The reward table is not: the server owns the
 * rewards, and the quest core grants nothing.
 */
export type {
  QuestClock,
  QuestDefinition,
  QuestEvent,
  QuestEventKind,
  QuestId,
  QuestLifetimeMirror,
  QuestLocalReceipt,
  QuestMetric,
  QuestMetricMode,
  QuestMetricScope,
  QuestProgress,
  QuestRewardGateway,
  QuestSnapshot,
  QuestStorage,
} from './questTypes';

export {
  QUEST_CATALOG,
  QUEST_METRIC_MODES,
  QUEST_METRIC_SCOPES,
  DAY_SCOPED_METRICS,
  LIFETIME_METRIC_KEYS,
  LIFETIME_METRICS,
  RUN_SCOPED_METRICS,
  findQuestDefinition,
} from './questCatalog';

export {
  DAILY_QUEST_COUNT,
  isValidDayKey,
  nextUtcMidnightMs,
  selectDailyQuests,
  utcDayKey,
} from './questRotation';

export {
  MAX_DAY_HISTORY,
  MAX_REMEMBERED_EVENT_IDS,
  QUEST_SAVE_MIN_VERSION,
  QUEST_SAVE_VERSION,
  createQuestSaveData,
  ensureDayState,
  parseQuestSaveData,
  peekQuestSaveVersion,
  pruneDayHistory,
  sanitizeQuestSaveData,
  type QuestDayState,
  type QuestSaveData,
  type QuestScopeValues,
} from './questState';

export {
  QuestEngine,
  createQuestEngine,
  metricModeOf,
  metricScopeOf,
  MAX_DAY_SKEW_DAYS,
  PERSIST_COALESCE_MS,
  type QuestEngineOptions,
  type QuestIngestResult,
} from './questEngine';

export { createQuestLocalStorage, QUEST_STORAGE_KEY } from './questStorage';
