import type { QuestDefinition, QuestId } from './questTypes';

/**
 * Daily quest selection.
 *
 * The selection is deterministic in the UTC day key: every client, every device and every
 * restart inside the same UTC day resolves to the same three quests. That is what makes
 * the set safe to reason about — it is not a client-side lottery, and it cannot be
 * rerolled by reinstalling or by moving the clock backwards and forwards within the day.
 *
 * This is a *goal* rotation, not a reward schedule. It creates no second daily source:
 * the server Daily remains the only daily payout authority, and the quest core grants
 * nothing at all.
 *
 * The algorithm is the Muse reference, unchanged: an FNV-1a hash of `ofeliya-quests:<day>`
 * seeds a mulberry32, and a Fisher–Yates pass picks the first three of the catalog. The
 * same day therefore selects the same three quests on the Muse build and on this one.
 */

/** Number of quests offered per UTC day. */
export const DAILY_QUEST_COUNT = 3;

/** The day key used when the clock does not hold a usable time. */
const EPOCH_DAY_KEY = '1970-01-01';

/**
 * Salt for the daily selection.
 *
 * This is the Muse reference salt. Changing it reshuffles the schedule for every future
 * day at once, so it is treated as a format constant rather than a tunable — and it is
 * also the compatibility contract with the Muse build.
 */
const SELECTION_SALT = 'ofeliya-quests';

/** FNV-1a over the UTF-16 code units of the string. */
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32 — small, fast and fully deterministic across engines. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * UTC day key in `YYYY-MM-DD` form.
 *
 * The key is derived from the epoch milliseconds in UTC, so the rotation happens exactly
 * at 00:00:00 UTC regardless of the device time zone.
 */
export function utcDayKey(atMs: number): string {
  // A clock that is not a number must not produce a broken day key: the key is
  // compared as a string and persisted, and a key like "NaN-NaN-NaN" would never be
  // recognised as a day again.
  if (!Number.isFinite(atMs)) return EPOCH_DAY_KEY;
  const date = new Date(atMs);
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Epoch milliseconds of the next UTC midnight after `atMs`. */
export function nextUtcMidnightMs(atMs: number): number {
  const date = new Date(atMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

/**
 * Selects the daily quests for a UTC day.
 *
 * The result is a pure function of the day key and the catalog, so it is stable across
 * restarts and identical on every client. The catalog is shuffled with a seeded
 * Fisher–Yates pass and the first `DAILY_QUEST_COUNT` entries are taken.
 */
export function selectDailyQuests(
  dayKey: string,
  catalog: readonly QuestDefinition[]
): QuestId[] {
  if (catalog.length === 0) return [];
  const count = Math.min(DAILY_QUEST_COUNT, catalog.length);

  const order = catalog.map((quest) => quest.id);
  const random = createRandom(hashString(`${SELECTION_SALT}:${dayKey}`));

  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const held = order[index];
    order[index] = order[swap];
    order[swap] = held;
  }

  return order.slice(0, count);
}

/**
 * True when `dayKey` is a well-formed UTC day key.
 *
 * Used to reject a corrupted save before it can drive the selection.
 */
export function isValidDayKey(dayKey: unknown): dayKey is string {
  if (typeof dayKey !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return false;
  const parsed = Date.parse(`${dayKey}T00:00:00.000Z`);
  return Number.isFinite(parsed) && utcDayKey(parsed) === dayKey;
}
