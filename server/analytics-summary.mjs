/**
 * Sprint 0 — product analytics read path.
 *
 * The write path (`POST /api/event`) already validates, pseudonymises and persists
 * product events. What did not exist was any way to READ them back over HTTP: the only
 * reader was the offline script `scripts/analyze-product-funnel.mjs`, which needs
 * filesystem access to the server's own disk.
 *
 * This module is deliberately AGGREGATE-ONLY. It never returns:
 *   - a stored event row,
 *   - an actor hash (the pseudonymised `platform:uid` digest),
 *   - event props (except three fixed, non-identifying keys used to derive counters),
 *   - `initData`, a uid, a name, an avatar or any other raw identity,
 *   - per-row timestamps.
 *
 * The only things it returns are: an event name, a count, the requested time window, an
 * optional platform split, and a small set of funnel counters derived from existing
 * events.
 */

import { timingSafeEqual } from 'node:crypto';

/** Mirrors the webhook secret floor: a short secret is treated as unset (fail closed). */
export const ANALYTICS_SUMMARY_TOKEN_MIN_LENGTH = 16;

/**
 * The product event catalogue the server accepts on write.
 * Kept in sync with `PRODUCT_EVENTS` in `server/index.mjs`; the aggregator uses it as a
 * defence-in-depth allowlist so an unexpected row name can never be echoed back out.
 */
export const ANALYTICS_EVENT_NAMES = Object.freeze([
  'app_open', 'run_start', 'run_60s', 'run_10min', 'boss1', 'heart', 'death',
  'win', 'replay', 'share', 'daily', 'referral',
  'first_enemy_hit', 'first_enemy_kill', 'first_rna_pickup',
  'first_mutation_opened', 'first_mutation_selected',
  'mutation_chosen',
  'host_cell_approached', 'infection_started', 'infection_interrupted',
  'infection_resumed', 'first_lysis', 'second_host_cell_completed_without_hint',
  'onboarding_step', 'onboarding_exit',
  'daily_claimed', 'achievement_unlocked',
  'lab_upgrade_bought', 'prestige_done',
  'skin_granted', 'skin_equipped',
]);

const ANALYTICS_EVENT_NAME_SET = new Set(ANALYTICS_EVENT_NAMES);

/** Accepted `window` values. `all` means the entire retained ring. */
export const ANALYTICS_WINDOWS = Object.freeze({
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  'all': null,
});

const DEFAULT_WINDOW = '24h';
const ALLOWED_PLATFORMS = new Set(['telegram', 'max']);
const ALLOWED_QUERY_KEYS = new Set(['window', 'platform', 'from', 'to']);

/**
 * The ONLY props keys the aggregator ever inspects, and the only values it counts.
 * Each maps to a fixed, non-identifying product state. No other prop is read, and no
 * prop value is ever returned.
 */
const DERIVED_COUNTERS = Object.freeze([
  { event: 'onboarding_step', prop: 'outcome', value: 'completed', counter: 'tutorialCompleted' },
  { event: 'onboarding_exit', prop: 'reason', value: 'skip', counter: 'tutorialSkipped' },
  { event: 'share', prop: 'kind', value: 'challenge', counter: 'challengeShare' },
]);

/**
 * Product-signal gaps: things the product spec asked for that have NO event of their own.
 * They are reported, never invented.
 */
export const ANALYTICS_EVENT_GAPS = Object.freeze([
  { key: 'menu_ready', status: 'ABSENT', derivedFrom: 'app_open', note: 'no dedicated menu-ready event exists' },
  { key: 'run_end', status: 'DERIVED', derivedFrom: 'win + death', note: 'no single run-end event exists; the summary derives it' },
  { key: 'challenge_click', status: 'DERIVED', derivedFrom: 'share (kind=challenge)', note: 'no dedicated challenge-click event exists; the summary derives it' },
  { key: 'tutorial_completed', status: 'DERIVED', derivedFrom: 'onboarding_step (outcome=completed)', note: 'no dedicated tutorial-completed event exists; the summary derives it' },
]);

/**
 * Timing-safe comparison of the operator token.
 *
 * Fails closed: an unset or too-short expected secret rejects every request, exactly
 * like the Telegram webhook secret matcher in `server/telegram-webhook.mjs`.
 */
export function analyticsSummaryTokenMatches(expected, provided) {
  if (typeof expected !== 'string' || expected.length < ANALYTICS_SUMMARY_TOKEN_MIN_LENGTH) return false;
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseEpoch(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 20) return null;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return null;
  return parsed;
}

/**
 * Parse the query string of the read-path endpoint.
 *
 * Strict by design: an unknown parameter is rejected rather than ignored, because a
 * typo in `window` must never silently widen the window to "everything".
 */
export function parseAnalyticsSummaryQuery(searchParams, now = Date.now()) {
  const raw = [];
  for (const [key, value] of searchParams.entries()) raw.push([key, value]);
  for (const [key] of raw) {
    if (!ALLOWED_QUERY_KEYS.has(key)) return { ok: false, error: `unknown query parameter: ${key}` };
  }

  const windowLabel = searchParams.get('window') ?? DEFAULT_WINDOW;
  if (!(windowLabel in ANALYTICS_WINDOWS)) {
    return { ok: false, error: `unsupported window: ${windowLabel}` };
  }

  const platformRaw = searchParams.get('platform');
  let platform = null;
  if (platformRaw !== null) {
    if (!ALLOWED_PLATFORMS.has(platformRaw)) return { ok: false, error: `unsupported platform: ${platformRaw}` };
    platform = platformRaw;
  }

  const fromRaw = searchParams.get('from');
  const toRaw = searchParams.get('to');
  let from;
  let to;
  let label = windowLabel;

  if (fromRaw !== null || toRaw !== null) {
    const parsedFrom = fromRaw === null ? 0 : parseEpoch(fromRaw);
    const parsedTo = toRaw === null ? now : parseEpoch(toRaw);
    if (parsedFrom === null) return { ok: false, error: 'from must be a non-negative integer epoch in milliseconds' };
    if (parsedTo === null) return { ok: false, error: 'to must be a non-negative integer epoch in milliseconds' };
    if (parsedFrom > parsedTo) return { ok: false, error: 'from must not be greater than to' };
    from = parsedFrom;
    to = parsedTo;
    label = 'custom';
  } else {
    const span = ANALYTICS_WINDOWS[windowLabel];
    from = span === null ? 0 : now - span;
    to = now;
  }

  return { ok: true, from, to, label, platform };
}

function emptyFunnel() {
  return {
    appOpen: 0,
    runStart: 0,
    mutationOpened: 0,
    mutationSelected: 0,
    runEnded: 0,
    runWin: 0,
    runDeath: 0,
    replay: 0,
    share: 0,
    tutorialCompleted: 0,
    tutorialSkipped: 0,
    challengeShare: 0,
  };
}

const FUNNEL_COUNTER_BY_EVENT = Object.freeze({
  app_open: 'appOpen',
  run_start: 'runStart',
  first_mutation_opened: 'mutationOpened',
  first_mutation_selected: 'mutationSelected',
  win: 'runWin',
  death: 'runDeath',
  replay: 'replay',
  share: 'share',
});

/**
 * Aggregate the retained analytics ring into a privacy-safe summary.
 *
 * @param {Array<object>} events   the stored rows (already pseudonymised at write time)
 * @param {object} options
 * @param {number} options.from    inclusive lower bound, epoch ms
 * @param {number} options.to      inclusive upper bound, epoch ms
 * @param {string|null} options.platform  'telegram' | 'max' | null for both
 * @param {number} [options.cap]   the ring's maximum retained rows
 * @param {number} [options.now]   clock injection for tests
 */
export function buildAnalyticsSummary(events, options = {}) {
  const {
    from = 0,
    to = Number.MAX_SAFE_INTEGER,
    platform = null,
    cap = 0,
    now = Date.now(),
  } = options;

  const rows = Array.isArray(events) ? events : [];
  const counts = new Map();
  const platformCounts = new Map();
  const funnel = emptyFunnel();

  let total = 0;
  let ignored = 0;
  let oldestTs = null;
  let newestTs = null;

  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) { ignored++; continue; }
    const ts = Number(row.ts);
    if (!Number.isFinite(ts)) { ignored++; continue; }

    // Coverage is measured across the WHOLE retained ring, not the filtered window, so
    // an operator can see when a requested window exceeds what the ring still holds.
    if (oldestTs === null || ts < oldestTs) oldestTs = ts;
    if (newestTs === null || ts > newestTs) newestTs = ts;

    const name = row.event;
    if (typeof name !== 'string' || !ANALYTICS_EVENT_NAME_SET.has(name)) { ignored++; continue; }
    const rowPlatform = row.platform;
    if (rowPlatform !== 'telegram' && rowPlatform !== 'max') { ignored++; continue; }

    if (platform && rowPlatform !== platform) continue;
    if (ts < from || ts > to) continue;

    total++;
    counts.set(name, (counts.get(name) ?? 0) + 1);
    const split = platformCounts.get(name) ?? { telegram: 0, max: 0 };
    split[rowPlatform]++;
    platformCounts.set(name, split);

    const direct = FUNNEL_COUNTER_BY_EVENT[name];
    if (direct) funnel[direct]++;
    for (const rule of DERIVED_COUNTERS) {
      if (name !== rule.event) continue;
      const props = row.props;
      if (!props || typeof props !== 'object') continue;
      if (props[rule.prop] === rule.value) funnel[rule.counter]++;
    }
  }

  funnel.runEnded = funnel.runWin + funnel.runDeath;

  const events_ = [...counts.entries()]
    .map(([event, count]) => ({
      event,
      count,
      platforms: {
        telegram: platformCounts.get(event)?.telegram ?? 0,
        max: platformCounts.get(event)?.max ?? 0,
      },
    }))
    .sort((a, b) => (b.count - a.count) || (a.event < b.event ? -1 : a.event > b.event ? 1 : 0));

  return {
    generatedAt: now,
    window: { label: options.label ?? 'custom', from, to },
    platform,
    totals: { events: total, ignoredRows: ignored },
    coverage: {
      storedEvents: rows.length,
      cap,
      oldestTs,
      newestTs,
    },
    events: events_,
    funnel,
    gaps: ANALYTICS_EVENT_GAPS.map((gap) => ({ ...gap })),
  };
}
