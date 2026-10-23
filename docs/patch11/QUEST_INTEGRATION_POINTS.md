# OFELIYA Patch 11 — Stage 2: Quest Core. Integration points

This document is the contract between the quest core (`src/quests/`) and the product.
It names every call site the integration stage has to touch, the exact event to emit
there, and the rules that must not be broken.

Integration update (2026-10-23): GameScene now imports the local QuestRuntime producer,
and Menu → Codex → Quests opens the read-only board. The original design below is
historical where it describes integration as pending. Current event map, checkpoint
semantics and actual PASS/FAIL/NOT_RUN evidence: [scene integration QA](../qa/QUEST_SCENE_INTEGRATION_20261023.md).
The core stays isolated; the boundary adapter is src/quests/questRuntime.ts. There is
no rewardGateway, claim UI or Daily mutation in this integration.

---

## 1. What the quest core is, and what it is not

**It is**

* a catalog of the twelve counter goals of the Muse reference
  (`src/quests/questCatalog.ts`),
* a deterministic daily selection of three of them, seeded by the UTC day, using the
  Muse selection algorithm unchanged,
* a typed event consumer that turns game events into quest progress,
* a versioned, self-contained save record under the Muse storage key,
* a read-only snapshot the HUD can render.

**It is not**

* a second daily source — there is no quest calendar, no quest payout, no quest ticket,
  and the quest core does not read, write or mirror the server Daily;
* a reward system — the only thing a finished quest produces is a *local receipt*
  (`state: 'local_pending'`) that grants nothing. The Muse `reward_rna` tag is
  deliberately **not** taken: the reward table belongs to the server;
* a second copy of a product counter — the lifetime total is **mirrored** from the
  product save through `syncLifetime()`, never counted by the quest core;
* a client-authoritative value path — there is no RNA, no Stars, no balance, no score,
  no shop, no laboratory, no skin, no Telegram Stars anywhere in `src/quests/`.

The quest core imports **nothing** from the product: no scenes, no `SaveSystem`, no
`ScoreClient`, no `DailyMutator`, no `RunCheckpoint`, no `server/*`. The check
`scripts/check-quest-core.mjs` enforces that at the source level.

---

## 2. Module map

| File | Responsibility |
| --- | --- |
| `src/quests/questTypes.ts` | The public type vocabulary: metrics, scopes, modes, events, snapshot, receipt, gateway seam. |
| `src/quests/questCatalog.ts` | The twelve Muse quests, the metric mode map, the metric scope map. Plain data. |
| `src/quests/questRotation.ts` | UTC day keys, the Muse selection of the daily three. |
| `src/quests/questState.ts` | The versioned save record: sanitize, load, migrate. Never throws. |
| `src/quests/questEngine.ts` | The engine: event ingestion, idempotency, completion, receipt, snapshot. |
| `src/quests/questStorage.ts` | The only browser adapter (`localStorage`, key `ofeliya.quests.v1`). |
| `src/quests/index.ts` | The barrel. The integration stage imports from here only. |

---

## 3. The Muse alignment

The quest vocabulary is the Muse reference, so the HUD copy, the analytics event names
and the daily selection are the same on both sides. The Muse reference is
`src/game/quests/content/quests.ink` in the phase 3 retention patch; this catalog is
that content transcribed as data, without inkjs and without the reward.

### 3.1 The catalog

| id | title | description | counter | target | scope |
| --- | --- | --- | --- | --- | --- |
| `slayer_1` | Первая кровь | Уничтожь 50 врагов за один забег | `q_kills` | 50 | run |
| `slayer_2` | Гроза лейкоцитов | Уничтожь 300 врагов за один забег | `q_kills` | 300 | run |
| `slayer_3` | Эпидемия | Уничтожь 1000 врагов за один забег | `q_kills` | 1000 | run |
| `hoarder_1` | Собиратель | Собери 500 РНК за один забег | `q_rna` | 500 | run |
| `hoarder_2` | Жадный штамм | Собери 2000 РНК за один забег | `q_rna` | 2000 | run |
| `survivor_1` | Живучий | Переживи 3 минуты в одном забеге | `q_time` | 180 | run |
| `survivor_2` | Неубиваемый | Переживи 5 минут в одном забеге | `q_time` | 300 | run |
| `ghost` | Невидимка | 60 секунд подряд без урона | `q_nodmg` | 60 | day |
| `mutant_1` | Мутант | Выбери 3 мутации за один забег | `q_mut` | 3 | run |
| `hunter` | Охотник за элитой | Уничтожь 5 элитных врагов за один забег | `q_elites` | 5 | run |
| `marathon` | Марафонец | Заверши 3 забега (суммарно) | `q_runs` | 3 | lifetime |
| `veteran` | Ветеран штамма | Заверши 10 забегов (суммарно) | `q_runs` | 10 | lifetime |

**The durations are in seconds, not milliseconds.** `q_time` and `q_nodmg` hold seconds,
because the Muse targets are written in seconds. The engine converts on the way in.

### 3.2 The counters and where they come from

| counter | meaning | source in the product | scope |
| --- | --- | --- | --- |
| `q_kills` | enemies destroyed in the run | `runState.recordKill()` | run |
| `q_elites` | elite enemies destroyed in the run | `runState.recordKill()` with `e.isElite` | run |
| `q_rna` | RNA collected in the run | `onGemCollected(value)` | run |
| `q_time` | seconds survived in the run | `runState.run.timeMs` | run |
| `q_nodmg` | the longest run of seconds without damage | `runState.stage.noDamageMs` | day |
| `q_mut` | mutations chosen in the run | `chooseUpgrade(id)` | run |
| `q_runs` | runs completed in total | `SaveData.runs`, **mirrored** | lifetime |

The product keeps three of these counters today: the kills (`runState.run.kills`), the
survival time (`runState.run.timeMs`) and the current no-damage streak
(`runState.stage.noDamageMs`). It has **no** elite, RNA or mutation counter — the
mutations are `bump()` stacks and the RNA is converted into XP on the way — so the
quest core counts those three itself, from the event stream, in its own record and
never in `SaveData`. That is a deliberate difference: the product save does not grow a
field for the quest screen.

`q_runs` is the lifetime total. The quest core never counts it — see §6.

### 3.3 The daily selection

The selection is the Muse algorithm, unchanged: an FNV-1a hash of
`ofeliya-quests:<YYYY-MM-DD>` seeds a mulberry32, and a Fisher–Yates pass over the
catalog order picks the first three. The same UTC day therefore selects the same three
quests on the Muse build and on this one; the contract check pins five days as golden
values.

The day key is UTC. The server Daily uses the local calendar; the quest set is a
**rotation of goals**, not a payout, so a per-device set is harmless — and a UTC set
means the three quests cannot be rerolled by moving the clock inside the same UTC day.
The quest day only ever moves forward: a device clock that jumps backwards must not
rewind it, or the quests that were already completed and claimed would re-open.

### 3.4 The storage key and the state vocabulary

The record lives at the Muse key **`ofeliya.quests.v1`**, so a future server migration
can find it at the key the server economy design expects
(`localStorage ofeliya.quests.v1` → `user:{id}:quests`).

The per-day state carries the Muse fields — `best`, `done`, `started` — plus `claimed`,
the local bookkeeping that keeps a receipt one-shot.

```
{
  version: 4,
  dayKey: '2026-10-22',
  days: {
    '2026-10-22': { done: ['slayer_1'], started: ['slayer_1'], best: { slayer_1: 50 }, claimed: ['slayer_1'] }
  },
  runMetrics: { q_kills: 12, q_rna: 0, q_time: 94, q_mut: 1, q_elites: 0 },
  dayMetrics: { q_nodmg: 30 },
  baseline:  { q_kills: 0,  q_rna: 0, q_time: 0,  q_mut: 0, q_elites: 0, q_nodmg: 0 },
  streakLast: 30,
  seenEventIds: ['r1:enemy_killed:7', '…'],
  claimedLifetime: ['veteran']
}
```

* `best` — the highest **progress** each quest reached that day. It is the progress and
  not the raw counter: the counter of a run that crossed the midnight still holds
  yesterday's part. The snapshot exposes it as `snapshot().best`, so the HUD can show
  how the day went after the run metrics were reset by the next run.
* `done` — the quests completed that day. It keeps the completion alive for the whole
  day, across runs.
* `started` — the quests whose progress moved that day.
* `claimed` — the run-scoped quests whose local receipt was issued that day.
* `claimedLifetime` — the lifetime quests whose receipt was ever issued. The lifetime
  quests measure a total that only grows, so a per-day claim would pay the milestone
  out again on every day it is offered. The claim is permanent.
* `runMetrics` — the run-scoped counters, persisted so a resumed run keeps its progress.
* `dayMetrics` — the day-scoped counters: the longest streak of the day, across every
  run of that day. The streak of yesterday is not a streak of today, so it starts from
  zero at the UTC midnight.
* `streakLast` — the length of the current no-damage streak, as it was last seen. The
  quest core sees *how long* the current streak is, not when it began, so this is what
  tells a continuing streak from a broken one. It is persisted, so a reload does not
  restart the count.
* `baseline` — see §5.
* `seenEventIds` — the idempotency key set, bounded at 1024 entries.

The record is versioned (`version: 4`). A record of an older version is migrated, not
discarded; a Muse record (a plain map of day to day state, no version field) is read as
well, so a player who already has one on disk keeps it. A record of a **newer** version
is read as far as it can be and never written back: the newer build owns it.

---

## 4. The event contract

The event kinds and their payloads mirror the Muse runtime hooks one to one, so the
integration is a rename rather than a redesign.

| Event | Muse hook | Payload | Idempotency |
| --- | --- | --- | --- |
| `run_started` | `onRunStart` | `at` | remembered |
| `run_completed` | `onRunEnd` | `at` | remembered |
| `enemy_killed` | `onKill(isElite)` | `at`, `elite?` | remembered |
| `rna_collected` | `onRna(value)` | `at`, `delta` | remembered |
| `mutation_chosen` | `onMutation` | `at` | remembered |
| `run_tick` | `onTick(timeMs, maxNoDamageMs)` | `at`, `timeMs`, `noDamageMs` | not remembered |

Every event carries a stable `id`, and the id is the idempotency key: a redelivered
event is dropped instead of being counted twice. The id **must** be unique per
occurrence, for example `${runId}:enemy_killed:${sequence}`.

`at` is the epoch milliseconds of the occurrence. It is informational: the UTC rotation
runs on the injected clock, not on the event timestamp, so a device with a wrong clock
cannot move the quest day by replaying old events.

`run_tick` is the exception to the idempotency set. It carries the *current value* of a
counter rather than an occurrence, so redelivering it cannot change anything — it is
not remembered, and it does not fill the id window. It is also the one event that
arrives every frame, so it should be emitted **at most once per second** to keep the
peak fresh without flooding the game loop.

Two deliberate differences to the Muse runtime:

* **`noDamageMs` is the current streak**, `runState.stage.noDamageMs`, not the run's
  peak `runState.run.maxNoDamageMs`. The goal is "60 seconds in a row without damage",
  and that is a fact about a streak, not about a high-water mark. With the peak the
  quest core could not tell "a 60 second streak happened today" from "a 60 second
  streak happened before midnight", and the goal would be unreachable for a player
  whose best streak of the run was already longer than the target.
* **The `id` is required.** The Muse runtime has no such field; without it a
  redelivered event would be counted twice.

```ts
import { createQuestEngine, createQuestLocalStorage } from '../quests';

const quests = createQuestEngine({ storage: createQuestLocalStorage() });
```

---

## 5. The progress of the day, and why a run that crosses midnight is not enough

The daily set is a rotation of goals, and the goal of a day has to be earned during that
day. A run that crosses midnight keeps its counters, so the part of the counter that
was reached before the midnight would otherwise finish the goals of the new day for
free — with no action of the player, and in the case of a counter that grows on its own
(the survival time) not even with a run.

The rule:

* a **run-scoped** quest counts the progress that was made during the current day. The
  progress is the counter of the run minus the value it had when the day started. The
  baseline is taken at the UTC midnight and reset when a run starts, so for a run that
  began today the progress is exactly the counter of the run — which is what the Muse
  condition "за один забег" says;
* a **day-scoped** quest (the longest streak without damage) counts the longest streak
  that was *built up* during the day, across every run of that day. The product keeps
  the current streak across the midnight, so a streak that continues into the new day
  only counts for the part that is today, and a streak that breaks starts a new one —
  the whole of a new streak is new;
* a **lifetime** quest counts the mirrored total.

The snapshot carries both numbers: `value` is the counter, `progress` is the part of it
that counts. The HUD shows `progress`.

---

## 6. The lifetime mirror

The lifetime total is never counted by the quest core. The integration stage passes the
value of the product save in:

```ts
quests.syncLifetime({ completedRuns: SaveSystem.get().runs });
```

Call it

* once at start-up, and
* right after `SaveSystem.recordRun(...)` — that is where `runs` really moves.

The mirror is **not persisted**. A persisted copy could go stale, so it is applied again
whenever the product save changes. `snapshot().lifetime.synced` says whether the number
is real yet, so the HUD can hold the value back instead of showing a zero that is not
true.

> The Muse reference sets `q_runs` from `SaveSystem.get().runs` at the start of the run,
> which is one run behind — the count that is visible while the run is still going is
> the count from before it. The mirror closes that hole structurally: the quest core
> never counts runs at all.

---

## 7. The call sites

`src/scenes/GameScene.ts` is **not** touched by this stage. These are the places the
integration stage has to write to, with the line numbers of the current `main`.

| Line | Place | Event |
| --- | --- | --- |
| `:315` | `this.resumed = resume !== null` | `run_started` — only for a fresh run, not for a resumed one |
| `:634` | `this.runState.tick(delta)` | `run_tick` — at most once per second |
| `:891` | `this.runState.recordKill(COMBO.windowMs)` | `enemy_killed` with `elite: e.isElite` |
| `:1237` | `onGemCollected(value)` | `rna_collected` with `delta: value` |
| `:1254` | `chooseUpgrade(id)` | `mutation_chosen` — only when a choice was really applied |
| `:2371` | `SaveSystem.recordRun(...)` | `run_completed`, then `syncLifetime(...)` |

Notes per call site:

* **`run_started`** — a resumed run must not reset the counters, or the quest progress
  of the resumed run would be lost. `this.resumed` tells the two apart.
* **`run_tick`** — `timeMs` is `this.runState.run.timeMs` and `noDamageMs` is
  `this.runState.stage.noDamageMs` (the current streak, not the peak). The engine
  converts both to seconds. Emit it at most once per second; a `run_tick` is not
  remembered, so a redelivery is harmless. Emit the streak **while it is running** —
  a streak that is only reported at its end cannot be told apart from a streak that
  was broken and restarted.
* **`enemy_killed`** — the elite flag is `e.isElite`. An elite kill counts as a kill
  **and** as an elite.
* **`rna_collected`** — `value` is the RNA of the pickup. The engine adds it to
  `q_rna`.
* **`mutation_chosen`** — emit it only when an upgrade was really applied. **Do not
  use the return value of `chooseUpgrade` for that**: it returns `this.awaitingChoice`
  for a stale or fabricated id, which is `true` while the choice overlay is open, and
  it returns `false` at the end when there is no further choice queued — neither means
  "not applied". Use `acceptChoiceClick(id)`, or the same test the method itself uses —
  but **evaluate it before `chooseUpgrade` is called**: `chooseUpgrade` re-rolls and
  then clears `pendingChoices`, so a test taken after the call looks at the *next*
  choices, finds nothing, and the mutation is never counted at all. The safe shape is

  ```ts
  if (this.acceptChoiceClick(id)) {
    this.chooseUpgrade(id);
    quests.ingest({ id: `${runId}:mutation_chosen:${n}`, kind: 'mutation_chosen', at: Date.now() });
  }
  ```
* **`run_completed`** — the engine does not count anything here. The lifetime total
  moves in the product save, so the mirror is applied right after `recordRun`.

A run that ends without `run_completed` (a page reload in the middle of a run) leaves
the run counters where they were; the next `run_started` resets them.

### 7.1 The resume path

The quest record and the product checkpoint are two independent records, so they can
disagree: the quest record was lost, or the checkpoint was written earlier or later
than the quest record. The resume path realigns the two counters the product knows:

```ts
quests.syncRunProgress({ kills: run.kills, timeMs: run.timeMs });
```

This sets the kill counter and the survival time to the values of the restored run. The
survival time is a peak, so a restored run never lowers it. The day baseline follows the
counter down, so a checkpoint that is older than the quest record cannot leave the
baseline above the counter — the goal stays the target and not the target plus the
baseline.

The other counters (the collected RNA, the chosen mutations, the elite kills) are only
known to the quest core, so they come from the quest record — a lost quest record loses
them, and the quest has to be earned again.

---

## 8. The receipt and the future server check

```ts
const receipt = quests.claimLocalReward('slayer_1');
// { questId, dayKey, issuedAt, state: 'local_pending' } | null
```

The receipt is local UI state. It grants nothing, and it is issued at most once per
quest per day — for the lifetime quests at most once ever. A quest that is not part of
the current daily set has no receipt: the receipt would spend the one-shot claim of a
goal that was not on the board.

The future server check is a seam, not an implementation:

```ts
interface QuestRewardGateway {
  verifyQuestCompletion(questId: string, dayKey: string): Promise<'confirmed' | 'rejected' | 'unavailable'>;
}
```

With no gateway, `verifyWithServer()` answers `unavailable`. The quest core does not
simulate a server it does not have.

### 8.1 The mapping onto the server snapshot

The server economy design puts the daily quest state on the server as

```
user:{id}:quests  →  { v, updatedAt, day: { best, done, started } }
```

The local record maps onto it one to one — the current day, three of the four Muse
fields:

| server | local |
| --- | --- |
| `day.best` | `days[dayKey].best` |
| `day.done` | `days[dayKey].done` |
| `day.started` | `days[dayKey].started` |
| `v` | `version` |
| `updatedAt` | — (the server stamps it) |

`claimed` is local bookkeeping and has no server counterpart.

### 8.2 The grant contract, and the `ref` that has to carry the day

The server economy design grants a reward with `event: 'quest_completed'` and a `ref`
that is the idempotency key. For a daily quest the quest id alone is **not** enough:
the same quest is offered on every day it is selected, so the idempotency key has to
include the day.

```
ref = `${dayKey}:${questId}`      // e.g. "2026-10-22:slayer_1"
```

The server whitelists the quest ids and grants the reward of the day. Until that
contract exists, the receipt stays `local_pending` and nothing is granted.

---

## 9. The storage rules

* The key is `ofeliya.quests.v1`. It never collides with the product save
  `ofeliya_save_v1`.
* The engine writes the record when the state changes. The event writes are coalesced
  over one second (`PERSIST_COALESCE_MS`), so a burst of events never rewrites the
  whole record once per event; the transitions that matter — a day roll, a completion, a
  claim, the start of a run — are written through immediately.
* `flush()` writes the pending state on demand. Call it on `pagehide` and on
  `visibilitychange` so a closed tab does not lose the last second.
* A record is repaired field by field: a broken field is replaced, a broken record is
  rebuilt. It never throws into the game loop. A storage that throws is tolerated: the
  engine keeps working in memory.
* A stored day key that is more than two days ahead of today is not trusted: the quest
  day only moves forward, so a day of 2099 would pin the rotation to 2099 and never
  heal. The day is clamped back to today and the state of the future day is dropped.
* A record of a newer format version is read as far as it can be and never written
  back, so a downgrade of the app does not destroy the fields of the newer build.

---

## 10. The checklist for the integration stage

- [ ] `run_started` is emitted for a fresh run only, not for a resumed one.
- [ ] `run_tick` is emitted at most once per second, with `runState.run.timeMs` and
      `runState.stage.noDamageMs` (the current streak, not the peak).
- [ ] `enemy_killed` carries the elite flag.
- [ ] `rna_collected` carries the RNA of the pickup.
- [ ] `mutation_chosen` is emitted only when an upgrade was really applied — tested
      with `acceptChoiceClick(id)` **before** `chooseUpgrade` is called, never with the
      return value of `chooseUpgrade` and never with a test that runs after it.
- [ ] `run_tick` reports the **current** no-damage streak while it is running, at
      least once a second. A streak that is only reported at its end cannot be told
      apart from a streak that was broken and restarted.
- [ ] `run_completed` is emitted at the end of a run, and `syncLifetime()` is called
      right after `SaveSystem.recordRun(...)`.
- [ ] `syncLifetime()` is also called at start-up.
- [ ] `syncRunProgress()` is called when a run was restored from a checkpoint.
- [ ] Every event id is unique per occurrence and stable across a retry.
- [ ] `flush()` is called on `pagehide` and on `visibilitychange`.
- [ ] The HUD reads `snapshot()` and nothing else, and shows `progress`, not `value`.
- [ ] The HUD does not pay anything. The receipt is local state.
- [ ] The server contract with `ref = ${dayKey}:${questId}` exists **before** any reward
      is shown to the player.

---

## 11. What is deliberately not taken from the Muse reference

| Muse element | Why not |
| --- | --- |
| `reward_rna` on every quest | A client-side value grant. The server owns the reward table. |
| `addRna(rewardRna)` on completion | Same. The quest core grants nothing. |
| inkjs and the compiled `.ink` story | A dependency for counter goals that need no branching narrative. It would also collide with the integration diff. |
| The client-side `DailyCalendar` | A second daily source next to the server Daily. |
| The 24 achievements of the phase 3 patch | Out of scope for the quest core. |
| The per-day claim of a lifetime quest | The lifetime quests would be paid out again every day they are offered. The claim is permanent here. |
| The run's peak as the no-damage counter | The peak cannot tell "a streak of today" from "a streak of yesterday", and it makes the goal unreachable for a player whose best streak was already longer than the target. |
| The event id (there is none) | Without it a redelivered event is counted twice. The id is the idempotency key. |

Everything the Muse reference gets right — the quest ids, the titles, the descriptions,
the counters, the units, the daily rotation, the storage key, the `best` / `done` /
`started` vocabulary — is kept.
