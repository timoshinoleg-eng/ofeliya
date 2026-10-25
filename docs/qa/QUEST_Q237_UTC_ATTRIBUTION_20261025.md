# Q-237 — the UTC attribution of the no-damage streak across the midnight

Base: `5725cbed7ff425aa7789d45d98aeaf730a749361` (the exact HEAD of Draft PR #241, branch
`qa/minimax-muse-convergence-20261025`). Branch of this work: `fix/q237-utc-attribution-20261025`.
The base branch of the pull request of this work is the branch of #241, **not** `main`.

Nothing in `src/platform/GameHostLifecycle.ts` and nothing in `src/game/collection/ClientCollection.ts`
was touched. No deployment, no payment, no live user data, no change to `main`.

---

## Existing model — the clock domains

The quest core works with three different values and they must not be mixed.

| value | where it comes from | what it means |
|---|---|---|
| `clock.now()` | the injected `QuestClock` (`Date.now()` in the product) | the **wall clock**. It is the only thing that decides the UTC day. |
| `event.at` | the producer, `QuestRuntime.send()` | the wall clock of the sample as the engine received it. The rotation does **not** run on it. |
| `event.timeMs` | `GameScene.update()` → `runState.run.timeMs` | the **run-elapsed** time of the run, in milliseconds. It only grows while the run grows. |
| `event.noDamageMs` | `GameScene.update()` → `runState.stage.noDamageMs` | the **run-elapsed** time since the last damage: the current streak, not the peak of the run. |

There is **no monotonic clock** in the quest core. The only clock the core reads is the wall clock; the
run-elapsed time is a *value* the producer supplies, and it is the only clock the streak is measured in.
The wall clock is therefore used for the calendar question (which UTC day) and never as a substitute for
the gameplay duration.

The producer emits a `run_tick` when the run second changes, or when the run is hit, or when the run
finishes. Between two emitted samples the streak keeps growing, but the quest core does not see it: it
sees a streak value once per run second.

The day rollover (`QuestEngine.rollDayIfNeeded`) did:

```ts
this.state.baseline = { ...this.state.runMetrics };
this.state.baseline.q_nodmg = this.state.streakLast ?? 0;   // the last OBSERVED streak
this.state.dayMetrics = zeroScope(DAY_SCOPED_METRICS);
```

---

## Root cause

The rollover took the **last observed streak** as the baseline of the new day. The observed streak lags
the physical streak by the length of the last observation interval — up to a whole run second — because
the producer only emits a sample when the run second changes. Everything the streak gained between the
last observation and the midnight was therefore credited to the **new** day.

The precise error is *not* a rounding problem and *not* a wrong day key. It is this:

> **the baseline of the new day was the streak of the last observation instead of the streak that was
> alive at the midnight, so the part of the streak that the run had already earned before the midnight
> was booked into the new day.**

The quest core could not do better, because it had no wall clock for the streak samples: `event.at` was
documented as *informational only* and nothing persisted the wall clock of the last sample. Without it
the core cannot tell **where inside a UTC day** the last sample was taken, and therefore cannot locate
the midnight inside the observation interval.

Case A, exactly as reported in issue #237:

| moment | wall clock | streak |
|---|---|---|
| last observation | `23:59:59.200Z` | `59.000 s` |
| the midnight | `00:00:00.000Z` | `59.800 s` (the physical streak) |
| next observation | `00:00:00.300Z` | `60.100 s` |

Old baseline `59.000 s` → progress `floor((60.100 − 59.000)) = 1` → **one whole second credited to
2026-10-25**, while only **0.300 s** of streak was alive inside that day. The old baseline was `59 s`
instead of the physical `59.8 s` — the wording of issue #237, confirmed on the exact head.

---

## RED evidence

The regression suite `scripts/check-quest-utc-attribution.mjs` was written **before** any production
change and run against the unchanged sources of the base head.

```
$ git stash push -- src/quests
$ node scripts/check-quest-utc-attribution.mjs
AssertionError [ERR_ASSERTION]: case A: only the part of the streak inside 2026-10-25 is credited
1 !== 0
    at checkAttribution (scripts/check-quest-utc-attribution.mjs:182:12)
    at scripts/check-quest-utc-attribution.mjs:202:19
exit 1
```

The whole old-versus-expected table, measured on the **unmodified** base head
(`scripts/check-quest-utc-attribution.mjs` against `5725cbe`):

| case | expected | old actual |
|---|---|---|
| A `23:59:59.200Z → 00:00:00.300Z` | 0 | **1** |
| B `23:59:59.900Z → 00:00:00.100Z` | 0 | 0 (control) |
| C `23:59:59.000Z → 00:00:00.000Z` | 0 | **1** |
| D `23:59:58.500Z → 00:00:01.500Z` | 1 | **3** |
| E three samples across the midnight | 1 | **3** |

The old baseline of case A was `59 s`; the physical streak at the midnight was `59.8 s`. The old
`streakLast` (`60.1`) was already correct — the defect was in the **attribution**, not in the streak.

---

## Reference model

`scripts/check-quest-utc-attribution.mjs` carries its own reference model. It is independent of the
production code: it knows calendar arithmetic only, it never reads the engine's baseline, its
`streakLast` or its persisted state.

```js
// the milliseconds of [startMs, endMs] that lie inside the given UTC day
function overlapMs(startMs, endMs, dayKey) {
  const start = dayStartMs(dayKey);
  return Math.max(0, Math.min(endMs, start + DAY_MS) - Math.max(startMs, start));
}

// the expected no-damage streak of one UTC day, in whole seconds
function expectedStreakSeconds(intervals, dayKey) {
  let creditedMs = 0;
  for (const interval of intervals) creditedMs += overlapMs(interval.startMs, interval.endMs, dayKey);
  return Math.floor(creditedMs / 1000);
}
```

The model rests on two statements of the product, not on the implementation:

1. the streak advances with the run clock, and the run clock advances with the wall clock while the
   game runs — so the streak was alive for the whole of every observation interval;
2. therefore the part of the streak that belongs to a UTC day is the part of the observation intervals
   that lies inside that day.

The model describes the scenarios in which the run clock and the wall clock advance together, which is
the case of every reported scenario and of every row of the boundary matrix. The one scenario in which
they do not advance together — a game that was paused across the midnight — carries its own explicit
expectation, because the calendar alone cannot say *where inside* the interval the streak advanced.

---

## New algorithm

Three changes, all inside the quest core. No new timing engine, no second day counter, no change to the
reward authority, the catalog, the rotation or the storage key.

1. **`QuestSaveData.lastTickAtMs` (new, optional, no version bump)** — the wall clock of the last
   accepted streak sample. It is the anchor of the attribution: it says where inside a UTC day the last
   sample was taken. It is sanitised on read like the other optional fields and is absent in the records
   of version 1–3 and in the records of a restored run.

2. **`QuestEngine.trackNoDamageStreak(current, sampleAtMs)`** — the new parameter is the wall clock of
   the sample. When the observation interval reaches across the midnight of the current day, the day
   starts from the streak that was alive at the midnight instead of from the last observed streak:

   ```ts
   private streakAtDayStart(previousStreakMs, previousAtMs, currentStreakMs, currentAtMs): number | null {
     const dayStart = Date.parse(`${this.state.dayKey}T00:00:00.000Z`);
     if (!Number.isFinite(dayStart)) return null;
     if (!(previousAtMs < dayStart && currentAtMs >= dayStart)) return null;
     const advance = currentStreakMs - previousStreakMs;
     if (advance <= 0) return null;
     const insideDay = currentAtMs - dayStart;
     return currentStreakMs - Math.min(advance, insideDay);
   }
   ```

   `credited = min(advance, insideDay)` is the part of the streak advance that can belong to the new day:
   the advance cannot be larger than the streak that really advanced over the interval, and it cannot be
   larger than the wall-clock time the new day had inside that interval. The baseline of the new day
   becomes `currentStreak − credited`, i.e. the streak that was alive at the midnight.

3. **`resetRunMetrics()` and `restoreRunMetrics()` drop the anchor** — a new run and a run restored from
   a checkpoint open a new timeline, exactly like the existing `lastTickTimeMs` freshness. A restored
   run therefore keeps the deliberate baseline of the restore seam and is never re-split.

The producer was **not** changed. The wall clock of a sample is the moment the engine received it, and
the day rotation runs on the same clock at the same instant; mixing an observation time of one sample
with a delivery time of another would book a sample into a day the core had already left.

---

## Temporal boundary table

`input` is the observation interval, `expected` is the reference model, `old actual` is the base head
`5725cbe`, `new actual` is this branch. The counter is the no-damage streak of the **new** UTC day in
whole seconds.

| input | expected | old actual | new actual |
|---|---|---|---|
| A `23:59:59.200Z → 00:00:00.300Z` | 0 | 1 | **0** |
| B `23:59:59.900Z → 00:00:00.100Z` | 0 | 0 | **0** |
| C `23:59:59.000Z → 00:00:00.000Z` | 0 | 1 | **0** |
| D `23:59:58.500Z → 00:00:01.500Z` | 1 | 3 | **1** |
| E `23:59:58.000 → 00:00:00.200 → 00:00:01.200` | 1 | 3 | **1** |
| end = midnight − 999 ms | 0 (day 1) | 0 | **0** |
| end = midnight − 100 ms | 0 (day 1) | 0 | **0** |
| end = midnight − 1 ms | 0 (day 1) | 0 | **0** |
| end = midnight exactly | 0 | 2 | **0** |
| end = midnight + 1 ms | 0 | 2 | **0** |
| end = midnight + 100 ms | 0 | 2 | **0** |
| end = midnight + 999 ms | 0 | 2 | **0** |
| end = midnight + 1.1 s | 1 | 3 | **1** |
| end = midnight + 3 s | 3 | 5 | **3** |
| six consecutive whole-second ticks across the midnight | 2 | 3 | **2** |
| the run clock paused for 3 s across the midnight (200 ms of streak) | 0 | 0 | **0** |
| a suppressed sample flushed by a hit 15 ms after the midnight | 0 | 1 | **0** |

The baseline of the new day follows the same rule. Case A: the old baseline was `59 s` (the last
observed streak), the new baseline is `59.8 s` — the physical streak duration at the midnight, which is
what issue #237 asked for.

---

## F5 compatibility

The F-5 repair of PR #233 (the terminal force) is a **different** defect and is untouched:

* F-5: the producer suppressed the last sample inside a run second, so the terminal force had to
  deliver exactly that pending sample — the streak had to end at 60 and never fall back to 59.
* #237: the day rollover credited the part of the streak that was already earned before the midnight
  to the new day.

They meet in one place: the terminal force and the rollover can happen in the same observation. The
repair does not touch the producer's pending-sample logic, the `force` flag, the trusted damage reset
or the engine's freshness guard. The contracts that pinned F-5 still hold on this branch:

* `npm run test:quest-runtime` — including `terminal force preserves 60 real seconds (not 59)` and
  `terminal force delivers exactly one tick` — **PASS**;
* `npm run test:quest-core` — the day streaks, the day rollover and the day progress — **PASS**;
* the adversarial gate of this branch runs the producer suite next to the attribution suite, so a
  mutation that breaks the terminal force is caught here as well (see below).

The F-5 sequence `begin; 900/900; forced 950/0; 60000/59050; 60950/60000; forced 60950/60000; end`
still ends with `q_nodmg = 60` and `lastTickTimeMs = 60950`.

---

## Save / resume

* **Save before the midnight, resume after it.** The restore seam (`restoreNoDamageStreak`) decides
  the baseline of the new day from the checkpoint itself: a checkpoint of the previous day brings no
  streak into the new day, so the new day starts from the restored streak and the restored streak is
  not credited to it. The anchor is dropped by `restoreRunMetrics`, so the first sample after the
  restore is never re-split. Covered by the `resume` case of the suite: `dayMetrics.q_nodmg = 0`.
* **A partial interval.** A run that is saved and resumed in the same UTC day keeps its streak; the
  baseline follows the restored value down (`min(baseline, restored)`), exactly as before.
* **An ended save.** An ended checkpoint cannot be reactivated; the resume path of the producer is
  unchanged and covered by `npm run test:quest-runtime`.
* **Old schema migration.** The new field is optional and the save version stays **4** — no version
  bump, no migration. A version 1, 2 or 3 record is read through the normal path, the field is absent,
  the first sample after the read has no anchor and is not split. Covered by the `migration` case of the
  suite and by the migration cases of `npm run test:quest-core`.

---

## Clock assumptions

What the system assumes, and what it does not promise:

| assumption | status |
|---|---|
| The wall clock decides the UTC day. | Supported and unchanged. The rotation runs on the injected clock. |
| The streak advances with the run clock, and the run clock advances with the wall clock while the game runs. | **Assumed by the attribution.** It holds for a running game. |
| A normal observation interval crosses at most one midnight. | **Proved**: the producer emits a sample at most once per run second, so an interval that reaches across a midnight is at most one run second long. A longer interval (a paused game, a moved clock) can only be located worse; the whole of the advance that fits into the new day is then credited to it. |
| The wall clock of a sample and the moment it was observed differ by less than one frame. | **Assumed**: the producer flushes a suppressed sample on the damage hook or on the terminal tick of the same frame. |
| The system clock moved backwards. | **Not supported, and deliberately unchanged.** The day only ever moves forward; a backwards clock does not rewind the quest day. The attribution is not affected: the day key does not move back, so there is no midnight to split. |
| The system clock moved forwards by hours. | **Not supported.** The rollover happens at the first sample after the jump; the interval then reaches across more than one midnight and cannot be located better than "the new day". The core does not pretend to support a clock jump — the pre-existing `MAX_DAY_SKEW_DAYS` clamp and the forward-only day stay as they are. |
| The session elapsed time keeps running while the wall clock jumps. | **Not supported.** The streak advance over a long interval is credited to the new day up to the wall-clock time the new day had inside it. |

Nothing was added to *support* a clock jump: no second clock, no smoothing, no drift correction.

---

## Performance

* One extra optional number in the quest record (`lastTickAtMs`), one comparison and one subtraction
  per **streak sample** — that is once per run second, not once per frame.
* The split touches a single UTC midnight: `Date.parse(dayKey + 'T00:00:00.000Z')` and one comparison.
  There is **no** loop over the days, **no** history, **no** unbounded growth of the record.
* No allocation on the hot path: no array, no object, no string building per sample.
* Complexity: **O(1)** time and **O(1)** memory per sample.

---

## Mutation / adversarial results

Two gates. The existing quest core gate keeps its baseline, and a new adversarial gate covers the
attribution that this repair added.

**`npm run test:quest-core-mutations`** — the existing gate of the quest core, unchanged except for
the three mutation patterns that name the new call signature of `trackNoDamageStreak`:

```
quest core mutations: 86/86 caught, 1 control unchanged (time zone Asia/Tokyo)
```

**`npm run test:quest-utc-attribution-mutations`** — new. It runs the attribution suite *and* the
producer suite (the F-5 contracts) against a mutated copy of the quest core, in `Asia/Tokyo`:

```
quest UTC attribution mutations: 13/13 caught, 3 equivalent, 1 control unchanged (time zone Asia/Tokyo)
```

The 13 killed mutants cover: the midnight boundary (`>=` → `>`), the day bucket (the day before and the
day after), the swapped interval ends, the missing split, the missing cap of the advance, the rounding
(`floor` → `ceil`, `floor` → `round`), the anchor that is not persisted and the anchor that is never
read, the terminal sample that is delivered twice, and the forced sample that may replace the pending
one.

Three mutants are **provably equivalent** and the gate proves it by requiring that they do *not* change
the result:

| mutant | why it cannot be observed |
|---|---|
| the midnight boundary is inclusive (`<` → `<=`) | a streak never advances faster than the wall clock, so when the previous sample sits exactly on the midnight the whole of the interval lies in the new day and the split credits the same advance as the rollover baseline would. |
| a streak that did not advance is still split (`<= 0` → `< 0`) | a streak that did not advance is credited zero seconds by the rollover baseline as well. |
| the final suppressed sample is omitted | a suppressed sample lies inside one run second of the sample before it, so it can never carry a whole second of its own, and the producer's own freshness guard already rejects the samples the flush would have rejected. The difference cannot reach the counter through the producer. |

One mutant of the existing core gate was **not** repeated here on purpose: the weakening of the engine's
freshness guard (`event.timeMs <= lastTickTimeMs`) is unreachable through the producer — the producer
never sends an equal or older sample — and it is already covered by `npm run test:quest-core-mutations`.

---

## Regression

Every command below was run on this branch. The exit code is the exit code of the command.

| command | exit | result |
|---|---|---|
| `npm run test:quest-utc-attribution` | 0 | PASS — the reference model of the attribution (2 s) |
| `npm run test:quest-utc-attribution-mutations` | 0 | PASS — 13/13 caught, 3 equivalent, 1 control unchanged (61 s) |
| `npm run test:quest-core` | 0 | PASS (3 s) |
| `npm run test:quest-core-mutations` | 0 | PASS — **86/86 caught, 1 control unchanged** (216 s) |
| `npm run test:quest-runtime` | 0 | PASS — F-5 terminal force, resume, duplicates (3 s) |
| `npm run test:streaks` | 0 | PASS — the run-wide no-damage streak |
| `npm run test:save` | 0 | PASS — save migration |
| `npm run test:muse-client` | 0 | PASS (5 s) |
| `npm run test:muse-convergence` | 0 | PASS — 11/11 (2 s) |
| `npx tsc --noEmit` | 0 | PASS (11 s) |
| `VITE_RELEASE_SHA=<40 sha> npm run build` | 0 | PASS — 127 modules, 15.8 s |
| `npm run test:bundle-shape` | 0 | PASS — vendor 1 481 786 B, largest app 486 057 B, 2 js chunks |
| `git diff --check` | 0 | PASS |

### The two browser suites of this sandbox

`npm run test:quest-scenes` and `npm run test:muse-convergence-crossflow` **fail in this sandbox — on the
unmodified base head as well, with the identical assertion**. They are environment failures of the
sandbox, not regressions of this branch:

| suite | assertion | on the base head `5725cbe` | on this branch |
|---|---|---|---|
| `test:quest-scenes` | `page.waitForFunction` timeout at `scripts/quest-scene-smoke.cjs:110` — the UTC rollover refresh of the open board at the 768 viewport (320 and 390 pass) | **fails, identical** | **fails, identical** |
| `test:muse-convergence-crossflow` | `the collection reveal tween must be in flight ({"total":10,"onBoard":0,"boardAlpha":1})` | **fails, identical** | **fails, identical** |

Both were measured with the same Chromium build
(`/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome`, `CHROME_PATH`) against the same local
Vite dev server, with the branch and the stashed base measured one after the other. The crossflow
failure is in the Collection phase, and `src/game/collection/ClientCollection.ts` was not touched. The
hosted CI of the base head was green, so the difference is the sandbox, not the branch. The evidence
PNGs that the scene suite rewrites were restored byte for byte
(`git checkout -- docs/qa/quest-evidence/`).

---

## Remaining risks

* The old day loses at most **one second** of its streak best: the rollover clears the day counter and
  the part of the streak that was alive between the last observation and the midnight is booked into the
  new day. This is the pre-existing behaviour of the rollover and was not changed by this repair.
* The attribution assumes that the run clock and the wall clock advance together. A game that was paused
  across the midnight cannot be located better than "the new day" — the engine credits the new day with
  the advance that fits into it and never more than the streak that really advanced.
* The system clock moved forwards by hours is not supported and was not made supported. The forward-only
  day and the `MAX_DAY_SKEW_DAYS` clamp are unchanged.
* The wall clock of a sample and the moment it was observed differ by less than one frame. A producer
  that flushed a suppressed sample much later would move the sample across a midnight; the attribution
  would then place it in the day it was delivered to.
* No physical device, Telegram WebView or MAX WebView acceptance was run: the evidence is the host
  Chromium of `test:quest-scenes` and the hosted CI of the pull request.
* The reward authority, the server economy, the Daily system, the Collection and the platform lifecycle
  were not touched and are not covered by this repair.

---

## Safety

`GameHostLifecycle untouched` · `ClientCollection untouched` · `PR #241 untouched` · `main unchanged` ·
`production unchanged` · `no deploy` · `no payments` · `no live user data`
