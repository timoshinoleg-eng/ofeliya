import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * OFELIYA — the UTC attribution of the no-damage streak (issue #237).
 *
 * The quest core decides the UTC day with the wall clock, and the no-damage streak is
 * measured in the run clock. A run that crosses the UTC midnight therefore has to split
 * the streak: only the part of the streak that was alive inside the new day belongs to
 * the new day. Before the repair the day rollover took the *last observed* streak as the
 * baseline of the new day, so a whole second of the previous day could be credited to
 * the new one.
 *
 * The reference model below is deliberately independent of the production code. It only
 * knows calendar arithmetic: the streak advances with the run clock, the run clock
 * advances with the wall clock while the game runs, and the part of a streak that
 * belongs to a UTC day is the part of the observation intervals that lies inside it.
 */

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-quest-utc-'));
try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/quests/questRuntime.ts',
      '--target',
      'ES2020',
      '--module',
      'commonjs',
      '--moduleResolution',
      'node',
      '--outDir',
      temp,
      '--strict',
      '--skipLibCheck',
    ],
    { stdio: 'inherit' }
  );
  const { QuestRuntime } = createRequire(import.meta.url)(join(temp, 'questRuntime.js'));
  const { parseQuestSaveData, QUEST_SAVE_VERSION } = createRequire(import.meta.url)(join(temp, 'questState.js'));

  // --- the reference model ----------------------------------------------------------------

  const DAY_MS = 86_400_000;

  /** The UTC day key of an epoch timestamp. */
  function dayKeyOf(atMs) {
    return new Date(atMs).toISOString().slice(0, 10);
  }

  /** The epoch milliseconds of the UTC midnight that starts the given day. */
  function dayStartMs(dayKey) {
    return Date.parse(`${dayKey}T00:00:00.000Z`);
  }

  /** The milliseconds of `[startMs, endMs]` that lie inside the given UTC day. */
  function overlapMs(startMs, endMs, dayKey) {
    const start = dayStartMs(dayKey);
    const from = Math.max(startMs, start);
    const to = Math.min(endMs, start + DAY_MS);
    return Math.max(0, to - from);
  }

  /**
   * The observation intervals of a scenario.
   *
   * Every interval is the wall-clock span between two consecutive samples, together
   * with the streak that advanced over it. The first interval starts at the beginning
   * of the run, where the streak was zero.
   */
  function intervalsOf(runStartAtMs, observations) {
    const intervals = [];
    let previousAtMs = runStartAtMs;
    let previousStreakMs = 0;
    for (const sample of observations) {
      intervals.push({
        startMs: previousAtMs,
        endMs: sample.atMs,
        advanceMs: sample.noDamageMs - previousStreakMs,
      });
      previousAtMs = sample.atMs;
      previousStreakMs = sample.noDamageMs;
    }
    return intervals;
  }

  /**
   * The expected no-damage streak of one UTC day, in whole seconds.
   *
   * The day counter is the longest streak of the day, and the streak was alive for the
   * whole of every observation interval, so the expected value is the total of the
   * overlaps of the intervals with the day. The model is pure calendar arithmetic: it
   * knows nothing about the engine, its baseline or its persisted state.
   *
   * It describes the scenarios in which the run clock and the wall clock advance
   * together, which is the case of every reported scenario. A scenario in which the
   * game was paused carries its own explicit expectation instead, because the streak
   * then advances slower than the wall clock and the calendar alone cannot say where
   * inside the interval it advanced.
   */
  function expectedStreakSeconds(intervals, dayKey) {
    let creditedMs = 0;
    for (const interval of intervals) {
      creditedMs += overlapMs(interval.startMs, interval.endMs, dayKey);
    }
    return Math.floor(creditedMs / 1000);
  }

  /**
   * The expected streak the day starts from: the streak that was already alive when the
   * day began. A run that started inside the day brings no streak with it.
   */
  function expectedStreakAtDayStartSeconds(intervals, dayKey) {
    const start = dayStartMs(dayKey);
    let elapsedMs = 0;
    for (const interval of intervals) {
      elapsedMs += Math.max(0, Math.min(interval.endMs, start) - interval.startMs);
    }
    return Math.round(elapsedMs / 10) / 100;
  }

  // --- the scenario harness ----------------------------------------------------------------

  /**
   * One sample of the no-damage streak.
   *
   * `atMs` is the wall clock of the sample, `timeMs` the run-elapsed time and
   * `noDamageMs` the length of the current streak.
   */
  function sample(atMs, timeMs, noDamageMs, force = false) {
    return { atMs, timeMs, noDamageMs, force };
  }

  /**
   * Runs a scenario and returns the persisted record.
   *
   * The samples are played on a real `QuestRuntime` with an injected clock, so the
   * producer, the idempotency ledger and the engine all take part.
   */
  function runScenario(observations, options = {}) {
    let raw = null;
    const storage = {
      read: () => raw,
      write: (value) => {
        raw = value;
      },
    };
    let now = observations[0].atMs;
    const runtime = new QuestRuntime(storage, { now: () => now });
    runtime.begin(0);
    for (const entry of observations) {
      now = entry.atMs;
      runtime.tick(entry.timeMs, entry.noDamageMs, entry.force);
    }
    runtime.flush();
    return { state: JSON.parse(raw), runtime, storage, raw: () => raw };
  }

  /** The wall clock of the start of the run of a scenario with consistent clocks. */
  function runStartAtMs(observations) {
    return observations[0].atMs - observations[0].timeMs;
  }

  const MIDNIGHT = Date.parse('2026-10-25T00:00:00.000Z');
  const DAY_ONE = '2026-10-24';
  const DAY_TWO = '2026-10-25';

  /**
   * Checks one scenario against the reference model.
   *
   * The day, the streak of the day and the streak the day started from are all derived
   * from the calendar, never from the production code.
   */
  function checkAttribution(label, observations, expectedDayKey) {
    const { state } = runScenario(observations);
    const intervals = intervalsOf(runStartAtMs(observations), observations);
    assert.equal(state.dayKey, expectedDayKey, `${label}: the run belongs to ${expectedDayKey}`);
    assert.equal(
      state.dayMetrics.q_nodmg,
      expectedStreakSeconds(intervals, expectedDayKey),
      `${label}: only the part of the streak inside ${expectedDayKey} is credited`
    );
    assert.equal(
      state.baseline.q_nodmg,
      expectedStreakAtDayStartSeconds(intervals, expectedDayKey),
      `${label}: the day starts from the streak that was alive at the midnight`
    );
    return state;
  }

  // --- case A — the reported reproduction ---------------------------------------------------

  {
    const observations = [
      sample(MIDNIGHT - 800, 59_000, 59_000),
      sample(MIDNIGHT + 300, 60_100, 60_100, true),
    ];
    const state = checkAttribution('case A', observations, DAY_TWO);
    assert.equal(state.dayMetrics.q_nodmg, 0, 'case A: 300 ms is no completed second');
    assert.equal(state.baseline.q_nodmg, 59.8, 'case A: the midnight sees 59.8 s of streak');
    assert.equal(state.streakLast, 60.1, 'case A: the streak itself is untouched');
  }

  // A reset can arrive as a positive sample (e.g. restored/sparse observations).
  // Its value is in seconds at the engine boundary, but progress arithmetic uses ms.
  {
    const { state } = runScenario([
      sample(MIDNIGHT - 800, 59000, 59000, true),
      sample(MIDNIGHT + 300, 60100, 60100, true),
      sample(MIDNIGHT + 2200, 62000, 1200, true),
    ]);
    assert.equal(state.dayMetrics.q_nodmg, 1, 'positive reset streak credits 1.2 seconds as one second');
    assert.equal(state.baseline.q_nodmg, 0, 'positive reset starts a fresh streak');
  }

  // --- case B — a hundred milliseconds into the new day --------------------------------------

  {
    const observations = [
      sample(MIDNIGHT - 100, 59_900, 59_900),
      sample(MIDNIGHT + 100, 60_100, 60_100, true),
    ];
    const state = checkAttribution('case B', observations, DAY_TWO);
    assert.equal(state.dayMetrics.q_nodmg, 0, 'case B: the 100 ms are not a completed second');
  }

  // --- case C — the observation lands exactly on the midnight ---------------------------------

  {
    const observations = [
      sample(MIDNIGHT - 1_000, 59_000, 59_000),
      sample(MIDNIGHT, 60_000, 60_000, true),
    ];
    const state = checkAttribution('case C', observations, DAY_TWO);
    assert.equal(state.dayMetrics.q_nodmg, 0, 'case C: a midnight sample has no elapsed time');
  }

  // --- case D — a second and a half on either side of the midnight ---------------------------

  {
    const observations = [
      sample(MIDNIGHT - 1_500, 58_500, 58_500),
      sample(MIDNIGHT + 1_500, 61_500, 61_500, true),
    ];
    const state = checkAttribution('case D', observations, DAY_TWO);
    assert.equal(state.dayMetrics.q_nodmg, 1, 'case D: 1.5 s of the new day are one second');
  }

  // --- case E — several consecutive samples across the midnight ------------------------------

  {
    const observations = [
      sample(MIDNIGHT - 2_000, 58_000, 58_000),
      sample(MIDNIGHT + 200, 60_200, 60_200, true),
      sample(MIDNIGHT + 1_200, 61_200, 61_200, true),
    ];
    const state = checkAttribution('case E', observations, DAY_TWO);
    assert.equal(state.dayMetrics.q_nodmg, 1, 'case E: the samples add up to the new day');
  }

  // --- the boundary matrix -------------------------------------------------------------------

  /**
   * The boundary matrix of the midnight.
   *
   * Every row is an observation interval that ends at the given offset from the
   * midnight. The expected value comes from the reference model, never from the
   * production code.
   */
  const BOUNDARY_ROWS = [
    { label: '1 ms before the midnight', endOffsetMs: -1 },
    { label: '100 ms before the midnight', endOffsetMs: -100 },
    { label: '999 ms before the midnight', endOffsetMs: -999 },
    { label: 'exactly on the midnight', endOffsetMs: 0 },
    { label: '1 ms after the midnight', endOffsetMs: 1 },
    { label: '100 ms after the midnight', endOffsetMs: 100 },
    { label: '999 ms after the midnight', endOffsetMs: 999 },
    { label: '1.1 s after the midnight', endOffsetMs: 1_100 },
    { label: '3 s after the midnight', endOffsetMs: 3_000 },
  ];

  for (const row of BOUNDARY_ROWS) {
    const observations = [
      sample(MIDNIGHT - 2_000, 58_000, 58_000),
      sample(MIDNIGHT + row.endOffsetMs, 60_000 + row.endOffsetMs, 60_000 + row.endOffsetMs, true),
    ];
    const dayKey = dayKeyOf(MIDNIGHT + row.endOffsetMs);
    checkAttribution(`boundary (${row.label})`, observations, dayKey);
  }

  // --- consecutive ticks of a whole second across the midnight --------------------------------

  {
    const observations = [];
    for (let index = 0; index < 6; index += 1) {
      const atMs = MIDNIGHT - 3_000 + index * 1_000;
      observations.push(sample(atMs, 57_000 + index * 1_000, 57_000 + index * 1_000, index > 0));
    }
    const state = checkAttribution('consecutive whole-second ticks', observations, DAY_TWO);
    assert.equal(state.dayMetrics.q_nodmg, 2, 'consecutive ticks: two whole seconds of the new day');
  }

  // --- a game that was paused across the midnight ---------------------------------------------

  {
    // The run clock and the wall clock do not advance together: the game was paused for
    // three seconds. The streak only advanced 200 ms over the interval, so the new day
    // cannot be credited with more than those 200 ms — and 200 ms are no completed
    // second. The calendar alone cannot say where inside the interval the streak
    // advanced, so this scenario carries its own expectation.
    const observations = [
      sample(MIDNIGHT - 100, 59_900, 59_900),
      sample(MIDNIGHT + 2_900, 60_100, 60_100, true),
    ];
    const { state } = runScenario(observations);
    assert.equal(state.dayKey, DAY_TWO, 'a paused game: the day rolled over');
    assert.equal(
      state.dayMetrics.q_nodmg,
      0,
      'a paused game: the new day gets no whole second out of 200 ms of streak'
    );
  }

  // --- a suppressed sample that is flushed after the midnight ----------------------------------

  {
    // The producer suppresses the samples inside one run second and flushes the
    // suppressed one when the run is hit. The flush happens in the frame the sample was
    // observed in, so the sample and its delivery are less than a frame apart.
    let raw = null;
    const storage = {
      read: () => raw,
      write: (value) => {
        raw = value;
      },
    };
    let now = MIDNIGHT - 1_000;
    const runtime = new QuestRuntime(storage, { now: () => now });
    runtime.begin(0);
    runtime.tick(59_000, 59_000);
    now = MIDNIGHT - 100;
    runtime.tick(59_900, 59_900);
    now = MIDNIGHT + 15;
    runtime.tick(59_900, 0, true);
    runtime.flush();
    const state = JSON.parse(raw);
    assert.equal(state.dayKey, DAY_TWO, 'a flushed sample: the day rolled over');
    assert.equal(
      state.dayMetrics.q_nodmg,
      0,
      'a flushed sample: the 900 ms of the streak before the midnight are not credited'
    );
  }

  // --- a suppressed sample that is flushed by a hit --------------------------------------------

  {
    // The producer suppresses the samples inside one run second and flushes the
    // suppressed one when the run is hit. The flushed sample has to be delivered, and
    // the hit that follows it has to reset the streak — otherwise the streak of the run
    // would keep the value of the sample that was never seen.
    let raw = null;
    const storage = {
      read: () => raw,
      write: (value) => {
        raw = value;
      },
    };
    const now = Date.parse('2026-10-24T12:00:00Z');
    const runtime = new QuestRuntime(storage, { now: () => now });
    runtime.begin(0);
    runtime.tick(100, 100);
    runtime.tick(900, 900);
    runtime.tick(900, 0, true);
    runtime.flush();
    const state = JSON.parse(raw);
    assert.equal(
      state.lastTickTimeMs,
      900,
      'a flushed sample: the suppressed sample was delivered to the core'
    );
    assert.equal(state.streakLast, 0, 'a flushed sample: the hit resets the streak');
  }

  // --- duplicate, stale and invalid input ------------------------------------------------------

  {
    const observations = [
      sample(MIDNIGHT - 800, 59_000, 59_000),
      sample(MIDNIGHT + 300, 60_100, 60_100, true),
    ];
    const { state, runtime, raw } = runScenario(observations);
    assert.equal(state.dayMetrics.q_nodmg, 0, 'duplicate: the baseline of the case A run');

    // An identical sample is not a new observation.
    const before = runtime.snapshot().processedEvents;
    runtime.tick(60_100, 60_100);
    runtime.tick(60_100, 60_100, true);
    assert.equal(
      runtime.snapshot().processedEvents,
      before,
      'duplicate: an identical sample and a duplicate force change nothing'
    );

    // A sample from the past is not an observation either.
    runtime.tick(59_500, 59_500);
    runtime.tick(59_500, 59_500, true);
    assert.equal(
      runtime.snapshot().processedEvents,
      before,
      'stale: a sample from the past is rejected'
    );

    // A broken sample cannot move the streak.
    for (const broken of [Number.NaN, Number.POSITIVE_INFINITY, -1, undefined]) {
      runtime.tick(broken, broken, true);
    }
    assert.equal(
      runtime.snapshot().processedEvents,
      before,
      'invalid: NaN, Infinity, negative and undefined samples are rejected'
    );
    assert.equal(JSON.parse(raw() ?? '{}').dayMetrics.q_nodmg, 0, 'invalid: the streak is untouched');
  }

  // --- the terminal force still flushes the suppressed sample -----------------------------------

  {
    let raw = null;
    const storage = {
      read: () => raw,
      write: (value) => {
        raw = value;
      },
    };
    const now = Date.parse('2026-10-24T12:00:00Z');
    const runtime = new QuestRuntime(storage, { now: () => now });
    runtime.begin(0);
    runtime.tick(900, 900);
    runtime.tick(950, 0, true);
    runtime.tick(60_000, 59_050);
    runtime.tick(60_950, 60_000);
    runtime.tick(60_950, 60_000, true);
    runtime.end(1);
    const state = JSON.parse(raw);
    assert.equal(state.dayMetrics.q_nodmg, 60, 'terminal: the final suppressed sample is flushed');
    assert.equal(state.lastTickTimeMs, 60_950, 'terminal: the last delivered sample is the final one');
    assert.equal(state.streakLast, 60, 'terminal: the streak keeps its 60 real seconds');
  }

  // --- save before the midnight, resume after it -------------------------------------------------

  {
    let raw = null;
    const storage = {
      read: () => raw,
      write: (value) => {
        raw = value;
      },
    };
    let now = MIDNIGHT - 1_000;
    const runtime = new QuestRuntime(storage, { now: () => now });
    runtime.begin(0);
    runtime.tick(59_000, 59_000);
    const checkpoint = runtime.checkpoint();
    const savedAtEpochMs = now;
    runtime.flush();

    now = MIDNIGHT + 1_000;
    const resumed = new QuestRuntime(storage, { now: () => now });
    resumed.begin(0, checkpoint, {
      kills: 0,
      timeMs: 59_000,
      noDamageMs: 59_000,
      savedAtEpochMs,
    });
    resumed.flush();
    const state = JSON.parse(raw);
    assert.equal(state.dayKey, DAY_TWO, 'resume: the day rolls to the new day');
    assert.equal(
      state.dayMetrics.q_nodmg,
      0,
      'resume: the streak of the previous day is not a streak of the new day'
    );
  }

  // --- an old record is still readable ------------------------------------------------------------

  {
    const legacy = JSON.stringify({
      version: 3,
      dayKey: DAY_ONE,
      days: {},
      runMetrics: {},
      dayMetrics: { q_nodmg: 0 },
      baseline: { q_nodmg: 45 },
      seenEventIds: [],
      claimedLifetime: [],
    });
    let raw = legacy;
    const storage = {
      read: () => raw,
      write: (value) => {
        raw = value;
      },
    };
    const now = MIDNIGHT + 500;
    const runtime = new QuestRuntime(storage, { now: () => now });
    runtime.begin(0);
    runtime.tick(0, 0, true);
    runtime.flush();
    const state = JSON.parse(raw);
    assert.equal(state.version, 4, 'migration: a version 3 record is migrated to version 4');
    assert.equal(state.dayKey, DAY_TWO, 'migration: the migrated record rolls into the new day');
    assert.equal(
      state.dayMetrics.q_nodmg,
      0,
      'migration: the migrated streak of the previous day is not a streak of the new day'
    );
  }

  // Optional v4 anchor: old saves, malformed fields and rollback-like normalization.
  // Older v4 readers discard this unknown field on write. Simulate precisely that
  // loss, then exercise the real checkpoint resume path of the upgraded runtime.
  {
    const { runtime, raw } = runScenario([sample(MIDNIGHT - 800, 59000, 59000, true)]);
    const saved = JSON.parse(raw());
    const checkpoint = runtime.checkpoint();
    assert.equal(QUEST_SAVE_VERSION, 4);
    assert.equal(parseQuestSaveData(JSON.stringify(saved), DAY_ONE).lastTickAtMs, MIDNIGHT - 800);
    for (const field of [undefined, null, 'invalid', -1, Number.NaN, Number.POSITIVE_INFINITY, {}, []]) {
      const record = { ...saved, lastTickAtMs: field };
      const parsed = parseQuestSaveData(JSON.stringify(record), DAY_ONE);
      assert.equal(parsed.lastTickAtMs, undefined, 'missing/malformed optional anchor is dropped');
      assert.equal(parsed.lastTickTimeMs, 59000, 'other v4 progress survives normalization');
      let data = JSON.stringify(parsed);
      let now = MIDNIGHT + 300;
      const resumed = new QuestRuntime({ read: () => data, write: value => { data = value; } }, { now: () => now });
      resumed.begin(0, checkpoint, { kills: 0, timeMs: 59000, noDamageMs: 59000, savedAtEpochMs: MIDNIGHT - 800 });
      resumed.flush();
      assert.equal(JSON.parse(data).dayMetrics.q_nodmg, 0, 'upgrade/resume never credits yesterday');
      now += 1000;
      resumed.tick(60000, 60000, true);
      resumed.flush();
      assert.equal(JSON.parse(data).dayMetrics.q_nodmg, 1, 'fresh timeline earns one real second');
      assert.equal(JSON.parse(data).lastTickAtMs, now, 're-upgrade restores the wall-clock anchor');
    }
  }

  console.log('PASS quest UTC attribution across the midnight (reference model), v4 anchor compatibility');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
