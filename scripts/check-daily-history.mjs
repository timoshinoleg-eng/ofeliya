// Deterministic smoke for the donor-adapted daily history + share suffix
// (donor: ricardo-foundry/canvas-vampire-survivors src/daily.js, MIT).
//
// Covers: empty history, consecutive-day current streak, gap handling, best
// streak outside the rolling window, month rollover, record/prune by date
// string (not client clock), same-date overwrite, 14-day cutoff boundary, and
// the deterministic Wordle-style share suffix (surrogate-safe tile counting).
//
// All fixtures use LOCAL wall-clock dates (matching server localDateKey):
// no UTC instants, so the asserts are timezone-independent.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-daily-history-'));
const require = createRequire(import.meta.url);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function entry(date, timeMs, overrides = {}) {
  return { date, timeMs, kills: 10, level: 3, win: false, savedAt: 0, ...overrides };
}

// Local-date helpers mirroring the module's localDayKey.
function localDayKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function localDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDayKey(d);
}

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/systems/DailyHistory.ts',
      '--target',
      'ES2020',
      '--module',
      'commonjs',
      '--moduleResolution',
      'node',
      '--rootDir',
      'src',
      '--outDir',
      temp,
      '--skipLibCheck',
      'true',
      '--esModuleInterop',
      'true',
    ],
    { stdio: 'inherit' }
  );

  const {
    buildDailyShareSuffix,
    dailyStreakSummary,
    loadDailyHistory,
    recordDailyResult,
    localDayKey: modLocalDayKey,
    _resetForTests,
  } = require(join(temp, 'systems/DailyHistory.js'));

  // localDayKey is deterministic for local-constructed Dates: sanity-check parity.
  assert(localDayKey(new Date(2026, 1, 10, 12, 0, 0)) === '2026-02-10', 'local fixture helper');
  assert(modLocalDayKey(new Date(2026, 1, 10, 12, 0, 0)) === '2026-02-10', 'module localDayKey');

  // --- empty history ---
  const now = new Date(2026, 1, 10, 12, 0, 0);
  const empty = dailyStreakSummary({}, now);
  assert(empty.current === 0 && empty.best === 0, 'empty history has no streaks');
  assert(empty.days.length === 14, '14-day window');
  assert(empty.days.every((d) => !d.played), 'no played days when empty');
  assert(empty.days[0].date === '2026-02-10', 'window starts today');

  // --- consecutive days ending today ---
  const s1 = dailyStreakSummary(
    {
      '2026-02-10': entry('2026-02-10', 1000),
      '2026-02-09': entry('2026-02-09', 1000),
      '2026-02-08': entry('2026-02-08', 1000),
      '2026-02-06': entry('2026-02-06', 1000),
    },
    now
  );
  assert(s1.current === 3, `current streak 3, got ${s1.current}`);
  assert(s1.best === 3, `best streak 3, got ${s1.best}`);

  // --- a gap breaks the current streak ---
  const s2 = dailyStreakSummary(
    { '2026-02-10': entry('2026-02-10', 5), '2026-02-08': entry('2026-02-08', 5) },
    now
  );
  assert(s2.current === 1, `gap ends current streak, got ${s2.current}`);

  // --- best streak survives outside the 14-day window ---
  const h3 = {};
  for (let i = 0; i < 5; i++) {
    const k = localDayKey(new Date(2026, 0, 1 + i));
    h3[k] = entry(k, 100);
  }
  const s3 = dailyStreakSummary(h3, new Date(2026, 2, 1, 12, 0, 0));
  assert(s3.best === 5, `best streak outside window, got ${s3.best}`);
  assert(s3.current === 0, 'no current streak far from history');

  // --- month rollover counts as consecutive ---
  const s4 = dailyStreakSummary(
    { '2026-01-31': entry('2026-01-31', 1), '2026-02-01': entry('2026-02-01', 1) },
    new Date(2026, 1, 1, 6, 0, 0)
  );
  assert(s4.current === 2 && s4.best === 2, `month rollover consecutive, got ${s4.current}/${s4.best}`);

  // --- record + prune by date string ---
  _resetForTests();
  const today = localDayKey(new Date());
  const tooOld = localDaysAgo(20);
  recordDailyResult(entry(today, 2000, { win: true }));
  recordDailyResult(entry(tooOld, 1000));
  const stored = loadDailyHistory();
  assert(!!stored[today], 'today kept');
  assert(!stored[tooOld], 'entries older than 14 days pruned');

  // --- same-date overwrite: the last write wins ---
  recordDailyResult(entry(today, 9999));
  assert(loadDailyHistory()[today].timeMs === 9999, 'same-date overwrite wins');

  // --- the exact cutoff day survives ---
  _resetForTests();
  const cutoff = localDaysAgo(14);
  recordDailyResult(entry(cutoff, 500));
  recordDailyResult(entry(today, 500));
  assert(!!loadDailyHistory()[cutoff], 'date exactly 14 days back is kept');

  // --- the all-time best survives daily-entry pruning ---
  _resetForTests();
  const NativeDate = globalThis.Date;
  let fixedNow = new NativeDate(2026, 0, 1, 12).getTime();
  class ControlledDate extends NativeDate {
    constructor(...args) {
      if (args.length === 0) super(fixedNow);
      else super(...args);
    }
    static now() {
      return fixedNow;
    }
  }
  try {
    globalThis.Date = ControlledDate;
    for (let i = 0; i < 20; i++) {
      fixedNow = new NativeDate(2026, 0, i + 1, 12).getTime();
      const date = localDayKey(new NativeDate(fixedNow));
      recordDailyResult(entry(date, 1000));
    }
    assert(Object.keys(loadDailyHistory()).length <= 15, 'daily entries remain inside the rolling window');
    assert(dailyStreakSummary().best === 20, `all-time record expected 20, got ${dailyStreakSummary().best}`);
  } finally {
    globalThis.Date = NativeDate;
  }

  // --- share suffix ---
  assert(buildDailyShareSuffix({ timeMs: 1000 }, {}) === '', 'no suffix without history');
  const h6 = {};
  for (let i = 0; i < 7; i++) {
    const k = localDayKey(new Date(2026, 1, 4 + i));
    h6[k] = entry(k, 100 * (i + 1));
  }
  const suffix = buildDailyShareSuffix({ timeMs: 700 }, h6);
  const lines = suffix.split('\n');
  assert(lines.length === 2, 'suffix has a streak line and a tile line');
  assert(lines[0].includes('Серия:'), 'streak line present');
  const tiles = Array.from(lines[1]);
  assert(tiles.length === 7, `seven tiles, got ${tiles.length}`);
  assert(
    tiles.every((t) => ['🟩', '🟨', '🟫', '⬛'].includes(t)),
    'tiles come from the donor palette'
  );

  // --- determinism ---
  assert(buildDailyShareSuffix({ timeMs: 700 }, h6) === suffix, 'suffix is deterministic');

  console.log('daily history smoke: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
