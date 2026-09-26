/**
 * Daily history (donor adaptation).
 *
 * Adapted from `ricardo-foundry/canvas-vampire-survivors` `src/daily.js`
 * (MIT, pinned v2.8.0 @ e616704889e57efc9c1f49098786a95c364008d3):
 * streak summary + Wordle-style tile share suffix. Provenance and license:
 * THIRD_PARTY_NOTICES.md.
 *
 * Presentation-free by project rule (see DailyRunIntent.ts): no Phaser import
 * and no player-facing strings beyond the share suffix produced on request.
 *
 * NOTE: OFELIYA's daily run itself is server-authoritative (DailyRunClient +
 * DailyRunIntent). This module deliberately does NOT reproduce the donor's
 * dailySeed()/dailyChallenge()/cyrb53 — replacing the server ticket flow with
 * a localStorage seed would be a regression. Only the local result history,
 * streak math and share-suffix idea are adapted here.
 */

export interface DailyHistoryEntry {
  /** Local date key 'YYYY-MM-DD' of the daily ticket launch day (server localDateKey). */
  date: string;
  timeMs: number;
  kills: number;
  level: number;
  win: boolean;
  savedAt: number;
}

export interface DailyDayCell {
  date: string;
  played: boolean;
  win: boolean;
  timeMs: number;
  kills: number;
}

export interface DailyStreakSummary {
  current: number;
  best: number;
  days: DailyDayCell[];
}

const STORAGE_KEY = 'ofeliya_daily_history_v1';
const KEEP_DAYS = 14;

function usableLocalStorage(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    const probe = '__ofeliya_daily_probe__';
    localStorage.setItem(probe, probe);
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

let memoryStore: string | null = null;

/**
 * Return the LOCAL wall-clock date as 'YYYY-MM-DD'. OFELIYA's server issues
 * daily tickets with `localDateKey()` (local calendar), so the history and
 * streak window MUST use the same local calendar — otherwise a player in a
 * positive-offset timezone drifts one day across UTC midnight.
 */
export function localDayKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Add one local calendar day to a 'YYYY-MM-DD' string (month/year rollover + DST safe). */
function nextDayKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + 1);
  return localDayKey(dt);
}

export function loadDailyHistory(): Record<string, DailyHistoryEntry> {
  try {
    const raw = usableLocalStorage() ? localStorage.getItem(STORAGE_KEY) : memoryStore;
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, DailyHistoryEntry> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const e = value as Partial<DailyHistoryEntry> | null;
      if (!e || typeof e !== 'object' || typeof e.date !== 'string') continue;
      out[key] = {
        date: e.date,
        timeMs: typeof e.timeMs === 'number' && Number.isFinite(e.timeMs) && e.timeMs >= 0 ? e.timeMs : 0,
        kills: typeof e.kills === 'number' && Number.isFinite(e.kills) && e.kills >= 0 ? e.kills : 0,
        level: typeof e.level === 'number' && Number.isFinite(e.level) && e.level >= 0 ? e.level : 0,
        win: e.win === true,
        savedAt: typeof e.savedAt === 'number' && Number.isFinite(e.savedAt) ? e.savedAt : 0,
      };
    }
    return out;
  } catch {
    return {};
  }
}

function writeDailyHistory(history: Record<string, DailyHistoryEntry>): void {
  try {
    const s = JSON.stringify(history);
    if (usableLocalStorage()) localStorage.setItem(STORAGE_KEY, s);
    else memoryStore = s;
  } catch {
    /* quota / private mode — silently drop */
  }
}

/**
 * Persist one daily run result and prune entries older than KEEP_DAYS
 * calendar days. One entry per date — the most recent write wins.
 *
 * Pruning deliberately compares the stored date string, NOT `savedAt`: a
 * player's clock may skew between runs (donor rationale, kept verbatim).
 */
export function recordDailyResult(entry: DailyHistoryEntry): void {
  if (!entry || typeof entry.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) return;
  const history = loadDailyHistory();
  history[entry.date] = { ...entry };
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - KEEP_DAYS);
  const cutoff = localDayKey(cutoffDate);
  for (const key of Object.keys(history)) {
    const day = key.slice(0, 10);
    if (day < cutoff) delete history[key];
  }
  writeDailyHistory(history);
}

/**
 * Streak summary. Any recorded day counts as played (stages don't differ —
 * OFELIYA has one daily ladder). Builds a sorted unique-date list, counts the
 * trailing run of consecutive calendar days ending today as `current`, and the
 * longest consecutive run anywhere as `best` (so the badge stays correct as
 * days roll out of the window). `days` is a 14-day calendar newest-first,
 * ready to render.
 */
export function dailyStreakSummary(
  history?: Record<string, DailyHistoryEntry>,
  now: Date = new Date()
): DailyStreakSummary {
  const all = history ?? loadDailyHistory();
  // Collapse to one record per date (best timeMs wins) so the streak answers
  // "did the player play that day at all?".
  const byDate = new Map<string, DailyHistoryEntry>();
  for (const e of Object.values(all)) {
    if (!e || typeof e.date !== 'string') continue;
    const prev = byDate.get(e.date);
    if (!prev || (e.timeMs || 0) > (prev.timeMs || 0)) byDate.set(e.date, e);
  }
  const days: DailyDayCell[] = [];
  for (let i = 0; i < KEEP_DAYS; i++) {
    const key = localDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i));
    const entry = byDate.get(key);
    days.push({
      date: key,
      played: !!entry,
      win: entry?.win === true,
      timeMs: entry?.timeMs ?? 0,
      kills: entry?.kills ?? 0,
    });
  }
  let current = 0;
  for (const day of days) {
    if (day.played) current += 1;
    else break;
  }
  let best = 0;
  let run = 0;
  let prevKey: string | null = null;
  const sortedKeys = Array.from(byDate.keys()).sort();
  for (const key of sortedKeys) {
    if (prevKey && nextDayKey(prevKey) === key) run += 1;
    else run = 1;
    if (run > best) best = run;
    prevKey = key;
  }
  return { current, best, days };
}

function tileFor(value: number, median: number): string {
  if (median <= 0) return value > 0 ? '🟩' : '⬛';
  const r = value / median;
  if (r >= 1.5) return '🟩';
  if (r >= 1.0) return '🟨';
  if (r >= 0.5) return '🟫';
  return '⬛';
}

/**
 * Wordle-style share suffix (donor idea, adapted). Encodes the player's own
 * last 7 recorded daily days as emoji tiles relative to the median time of
 * the recorded history — fully offline and deterministic from local history.
 * Returns two lines: streak/record line + tile line.
 *
 * Tiles are multi-code-unit emoji: any string cutting must go through
 * Array.from (user-perceived characters), never raw slice — donor rationale.
 */
export function buildDailyShareSuffix(
  entry?: { timeMs: number },
  history?: Record<string, DailyHistoryEntry>
): string {
  const all = history ?? loadDailyHistory();
  const entries = Object.values(all).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const times = entries.map((e) => e.timeMs || 0).filter((t) => t > 0);
  times.sort((a, b) => a - b);
  const median = times.length
    ? times[Math.floor(times.length / 2)]
    : entry?.timeMs && entry.timeMs > 0
      ? entry.timeMs
      : 0;

  const recent = entries.slice(-7);
  const tiles = recent.map((e) => tileFor(e.timeMs || 0, median));
  while (tiles.length < 7) tiles.push('⬛');
  const tileLine = tiles.slice(0, 7).join('');

  const summary = dailyStreakSummary(all);
  if (summary.current <= 0 && summary.best <= 0) return '';
  const streakLine = `Серия: ${summary.current} дн. · Рекорд: ${summary.best}`;
  return `${streakLine}\n${tileLine}`;
}

/** Test hook: reset in-memory fallback store. */
export function _resetForTests(): void {
  memoryStore = null;
  try {
    if (usableLocalStorage()) localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
