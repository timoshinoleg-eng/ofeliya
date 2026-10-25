# OFELIYA — Sprint 0: readable product analytics

**Date:** 2026-10-26
**Repository:** `timoshinoleg-eng/ofeliya`
**Base commit:** `ce8ecb84ced1afa09870f2f00f9a0328257fd11c` (`origin/main`)
**Branch:** `feat/vnext-analytics-readpath-20261026`
**Draft PR:** `[DRAFT] OFELIYA Sprint 0 — readable product analytics` → base `main`

**Scope:** analytics **read path only**. No product UX, no balance change, no frontend change, no new event, no new dependency, no new database, no monetization.

---

## 1. The problem this solves

The write path already exists and works:

| stage | behaviour | evidence |
|---|---|---|
| client | `POST api/event` with `{platform, initData, event, props}`, same-origin, `credentials: 'same-origin'`, `keepalive: true`, 1,800 ms abort | `src/systems/AnalyticsClient.ts:58-89` |
| server validation | platform ∈ {telegram, max} and event ∈ allowlist, else **400** | `server/index.mjs:1313-1315` |
| server identity | signed `initData` verified per platform, else **403** | `server/index.mjs:1317-1321` |
| server rate limit | per-actor write limit + per-actor analytics limit, else **429** | `server/index.mjs:1323-1329` |
| pseudonymisation | `analyticsActorHash(platform, verified.uid)` = `sha256(platform:uid)` truncated to 24 hex — no raw uid, no `initData`, no names/avatars | `server/index.mjs:407-409` |
| prop sanitation | ≤8 keys, key `^[a-zA-Z0-9_-]{1,32}$`, string ≤80 chars, number rounded to 3 dp, boolean | `server/index.mjs:411-421` |
| storage | `store.analyticsEvents.push({event, platform, actor, props, ts})`, ring trimmed to **20,000** | `server/index.mjs:1331-1340` |
| acknowledgement | **202** | `server/index.mjs:1341-1343` |

**What did not exist: any way to read it back over HTTP.**

- The only HTTP exposure of the data was a **count**: `analyticsEvents: store.analyticsEvents.length` inside the **unauthenticated** `/health` response — `server/index.mjs:1231`.
- The only real reader was the **offline** script `scripts/analyze-product-funnel.mjs:5-7`, which reads `server/data/store.json` (or `ANALYTICS_STORE`) **from the server's own disk**.

Consequence: to answer "how many players reached their first mutation?" an operator had to log into the host and read a file. On any hosted tier without filesystem access, that is impossible.

**Sprint 0 adds exactly one thing: an authenticated GET endpoint that returns aggregates over the existing `store.analyticsEvents`.**

---

## 2. Endpoint contract

```
GET /api/analytics/summary
Header: X-Ofeliya-Analytics-Token: <OFELIYA_ANALYTICS_TOKEN>
```

Also reachable as `GET /ofeliya/api/analytics/summary` — the Render gateway strips the `/ofeliya` prefix and proxies `/api/*` to the score server (`server/hosting.mjs:69-77`), and nginx proxies `location /api/` (`deploy/nginx.conf:52-54`). **No edge or gateway change was needed.**

### 2.1 Query parameters

| parameter | values | default | meaning |
|---|---|---|---|
| `window` | `1h` · `6h` · `24h` · `7d` · `30d` · `all` | `24h` | time window over event `ts` |
| `platform` | `telegram` · `max` | both | platform split |
| `from` | epoch ms integer | — | inclusive lower bound |
| `to` | epoch ms integer | — | inclusive upper bound |

`from`/`to` override `window` and set `window.label` to `custom`. `from` alone ⇒ `to = now`; `to` alone ⇒ `from = 0`.

**Strictness is deliberate.** An **unknown parameter is a 400, not ignored** — a typo like `windw=24h` must never silently widen the window to "everything" and produce a wrong number that looks right. Same for an unsupported `window`/`platform`, a non-integer or negative `from`/`to`, and `from > to`.

### 2.2 Response shape

```jsonc
{
  "ok": true,
  "generatedAt": 1792976000000,
  "window": { "label": "24h", "from": 1792889600000, "to": 1792976000000 },
  "platform": null,                       // or "telegram" | "max"
  "totals": { "events": 42, "ignoredRows": 0 },
  "coverage": { "storedEvents": 42, "cap": 20000, "oldestTs": 1792889600000, "newestTs": 1792976000000 },
  "events": [
    { "event": "app_open", "count": 12, "platforms": { "telegram": 10, "max": 2 } }
  ],
  "funnel": {
    "appOpen": 12, "runStart": 9, "mutationOpened": 8, "mutationSelected": 8,
    "runEnded": 7, "runWin": 3, "runDeath": 4, "replay": 2, "share": 3,
    "tutorialCompleted": 6, "tutorialSkipped": 1, "challengeShare": 2
  },
  "gaps": [ { "key": "menu_ready", "status": "ABSENT", "derivedFrom": "app_open", "note": "…" } ],
  "persistence": { "mode": "local", "dirty": false, "lastFlushAt": 1792976000000 }
}
```

`events` is sorted by count desc, then event name asc — deterministic output, stable diffs.

### 2.3 Status codes

| condition | status |
|---|---|
| valid request + valid token | **200** |
| missing / wrong / too-short configured token | **403** |
| malformed query (unknown param, bad window/platform/from/to) | **400** |
| any other method | 404 via the existing fallback (`server/index.mjs:2039`) |

---

## 3. Authentication — and an honest note about the "existing stats/admin auth pattern"

**There is no existing stats/admin auth pattern in this repository.** The complete set of inbound secret checks before this change was:

| pattern | where | use |
|---|---|---|
| `X-Telegram-Bot-Api-Secret-Token` vs `TG_WEBHOOK_SECRET`, timing-safe, ≥16 chars | `server/telegram-webhook.mjs:17-24` | Telegram webhook only |
| `Authorization: Bearer` vs `OFELIYA_STATE_TOKEN` | `server/durable-state.mjs:17-21` | **outbound** durable-state writer only |
| `TG_BOT_TOKEN` / `MAX_BOT_TOKEN` / `VK_SECURE_KEY` | `server/index.mjs:447-496` | initData HMAC (player identity, not admin) |

`/health` — the only stats-shaped surface — is **unauthenticated** and exposes counts only.

**What I did:** the new endpoint follows the repository's established secret-handling **idiom** exactly — a dedicated env secret, a dedicated request header, a length floor, a timing-safe comparison, and **fail-closed** when unset — modelled on `telegramWebhookSecretMatches` (`server/telegram-webhook.mjs:17-24`). The matcher lives in the new module and is unit-tested independently.

```js
export function analyticsSummaryTokenMatches(expected, provided) {
  if (typeof expected !== 'string' || expected.length < ANALYTICS_SUMMARY_TOKEN_MIN_LENGTH) return false;
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

**New env var:** `OFELIYA_ANALYTICS_TOKEN` (≥16 chars). Unset ⇒ the endpoint rejects **every** request with 403. It is **never required** for the game to run, and it is never logged.

**Deliberately not done:** reusing `TG_WEBHOOK_SECRET` (semantically a webhook credential), reusing `OFELIYA_STATE_TOKEN` (an outbound writer credential — leaking it into an inbound header would be a security smell), or shipping the endpoint unauthenticated.

---

## 4. Privacy guarantees

The endpoint returns **aggregates only**. It never returns:

| never returned | why |
|---|---|
| a stored event row | the response is built by counting, never by copying rows |
| the actor hash | `analyticsActorHash` output is used only as a grouping key that is never emitted |
| `initData`, uid, first name, avatar | not stored on the row in the first place, and never read by the aggregator |
| event `props` | only three **fixed, non-identifying** keys are inspected, and only to derive counters — see below |
| per-row `ts` | only `coverage.oldestTs` / `coverage.newestTs` (extrema, not a timeline) |

**The three derived counters.** The product spec asks for a "tutorial completion" and a "challenge click" counter. Neither has its own event, and **the task forbids inventing one**. Instead the aggregator inspects exactly three `(event, prop, value)` triples that the client already sends, and counts matches:

| derived counter | source event | prop | value | client call site |
|---|---|---|---|---|
| `tutorialCompleted` | `onboarding_step` | `outcome` | `completed` | `src/scenes/UIScene.ts:1228-1232` |
| `tutorialSkipped` | `onboarding_exit` | `reason` | `skip` | `src/scenes/UIScene.ts:1304-1308` |
| `challengeShare` | `share` | `kind` | `challenge` | `src/scenes/UIScene.ts:2651` |

Any other prop value is ignored entirely. A prop value that exists only in a row never reaches the response — proven by a test that seeds a row-only marker value and asserts it is absent from the serialised summary.

**Unknown event names are ignored, not echoed.** The aggregator carries its own allowlist (`ANALYTICS_EVENT_NAMES`, mirroring `PRODUCT_EVENTS`) and counts an unrecognised row as `totals.ignoredRows`. A corrupt or unexpected name can never be reflected back to the caller.

**`gaps` is a frozen constant**, not data — it is the list of product signals that have **no** event of their own.

---

## 5. Persistence semantics — is the 250 ms window worth fixing?

**Question asked:** does a 2xx really return before the flush, is the crash window ~250 ms, does it matter, and can the read path work with it?

### 5.1 The measured model

`/api/event` → `saveStoreBestEffort()` → `saveStore()` → `storeDirty = true` + `scheduleStoreFlush()` → `setTimeout(flushStoreNow, STORE_SAVE_DELAY_MS)` — `server/index.mjs:367-375`, `:352-365`.

`STORE_SAVE_DELAY_MS` defaults to **250 ms** and is overridable by env; `STORE_SAVE_RETRY_MS = max(250, delay)` — `server/index.mjs:322-327`.

`send()` forces a flush only for `POST` requests whose path is in `['/api/score','/api/run/start','/api/daily/run','/api/duel']` or matches the duel event/attempt regex — `/api/event` is **not** in that list — `server/index.mjs:1168-1169`.

**Two modes:**

| mode | `/api/event` 202 is returned |
|---|---|
| **local file** (no durable state) | **before** the disk write ⇒ crash window = `STORE_SAVE_DELAY_MS` (250 ms) + the write itself |
| **durable state configured** | `durable` is truthy ⇒ the `send()` condition is true ⇒ `flushStoreNow()` runs, then `await durable.flush(stateSnapshot)` — **after** the snapshot is committed ⇒ **no crash window** |

### 5.2 Does it matter? — **No. This is P3. Left as-is.**

1. **It is a documented, deliberate scoping decision, not an oversight.** The `send()` comment says it outright: *"Acknowledged scores and issued/consumed capabilities must survive process exit. Analytics retains debounced persistence; disk errors reach the request's 500 path."* — `server/index.mjs:1162-1163`. Scores and capabilities are forced; analytics is deliberately not.
2. **The event is in memory immediately.** The push to `store.analyticsEvents` happens before the response is written. The window only matters if the **process dies** between the 202 and the disk write.
3. **Telemetry tolerates loss; scores do not.** A lost analytics row costs one data point. A lost acknowledged score costs a player their rank. The repo's asymmetry is correct.
4. **Fixing it would be a regression.** Forcing an fsync on the hottest write path would couple every analytics write to disk latency and add write amplification for a best-effort stream.
5. **Durable mode already has no window.**

**Verdict: `P3` — no change made to the write path.** The task said "if this is P3, leave it". It is.

### 5.3 Can the read path work with the current model? — **Yes, and it is unaffected.**

The summary is served from the **live in-memory ring**, not from disk. Therefore:

- A read sees every event that has been **accepted**, with **zero** delay — the 250 ms debounce is irrelevant to reads.
- The only exposure is the crash case above: after a crash, up to ~250 ms of accepted events may be missing from the **file**, and therefore from the ring after restart. (The ring is restored from the file at boot.)
- The read path **states its own semantics honestly**: `persistence: { mode, dirty, lastFlushAt }` tells the operator whether the ring is ahead of disk, and `coverage: { storedEvents, cap, oldestTs, newestTs }` tells them whether the requested window actually extends beyond what the ring still holds (the ring is capped at 20,000 and trims the oldest).

**This is why the read path needs no write-path change at all.**

---

## 6. Events the summary supports, and the gaps

| requested signal | status | source |
|---|---|---|
| app open | ✅ `app_open` | `src/main.ts:259` |
| menu ready | ⚠️ **ABSENT** — no such event; `app_open` is the closest proxy | gap reported in `gaps` |
| run started | ✅ `run_start` | — |
| mutation opened | ✅ `first_mutation_opened` | `src/scenes/GameScene.ts:851` |
| mutation chosen | ✅ `first_mutation_selected` | — |
| run ended | ⚠️ **DERIVED** — `win` + `death`; no single `run_end` event | `src/scenes/GameScene.ts:2467` |
| retry | ✅ `replay` | `src/scenes/UIScene.ts:2589` |
| challenge click | ⚠️ **DERIVED** — `share` with `kind=challenge`; no dedicated event | `src/scenes/UIScene.ts:2651` |
| tutorial completion | ⚠️ **DERIVED** — `onboarding_step` with `outcome=completed`; no dedicated event | `src/scenes/UIScene.ts:1228` |

**No event was created.** The three gaps are reported in the response (`gaps[]`) and in §9 below.

---

## 7. Files changed

| file | change | lines |
|---|---|---|
| `server/analytics-summary.mjs` | **NEW** — pure helpers: token matcher, strict query parser, aggregator, gap list | +288 |
| `server/index.mjs` | env read, module import, one GET route | +36 / −0 |
| `tests/analytics-readpath.test.mjs` | **NEW** — 13 tests (9 unit + 4 HTTP-level) | +420 |
| `scripts/check-server-image-modules.mjs` | **NEW** — production-image module contract guard | +150 |
| `deploy/Dockerfile` | **NEW** — `COPY server/analytics-summary.mjs` into the `score` stage | +1 |
| `package.json` | `test:analytics-readpath`, `test:server-image`; `server:test` chain extended | +2 / −1 |
| `.github/workflows/ci.yml` | new CI step "Analytics read path contract" — **could not be pushed, see §8.4** | +3 (local only) |

No client file, no game file, no config, no dependency, no lockfile change.

---

## 7.1 ⚠ A real defect the production-contract gate caught

**The first CI run on this branch FAILED** — run `40241321105`, job `production-contract`, step 18 *"Smoke production score image runtime"*.

**Root cause — mine.** `deploy/Dockerfile` does **not** copy the whole `server/` tree. The `score` stage copies the individual modules it needs:

```dockerfile
COPY --chown=node:node server/index.mjs          ./server/index.mjs
COPY --chown=node:node server/durable-state.mjs   ./server/durable-state.mjs
COPY --chown=node:node server/telegram-users.mjs  ./server/telegram-users.mjs
COPY --chown=node:node server/request-policy.mjs  ./server/request-policy.mjs
COPY --chown=node:node server/telegram-share.mjs  ./server/telegram-share.mjs
COPY --chown=node:node server/telegram-api.mjs    ./server/telegram-api.mjs
COPY --chown=node:node server/telegram-webhook.mjs ./server/telegram-webhook.mjs
```

Adding a module to `server/` therefore does **not** add it to the image. `server/index.mjs` imported `./analytics-summary.mjs`, which was absent from the image ⇒ the container would have died with `ERR_MODULE_NOT_FOUND` ⇒ the smoke step failed.

**Blast radius, checked precisely:**

| deployment | affected? | why |
|---|---|---|
| Render (the live production host) | **NO** | `deploy/RENDER.md:36` — `Start: node server/hosting.mjs`, run from the repository checkout, where the whole `server/` tree is present |
| Docker `score` stage / Cloud.ru compose | **YES** | `deploy/compose.production.yml:79-85` builds `target: score` and runs `node server/index.mjs` |
| `telegram-bot` stage | NO | its closure is `{bot.mjs, telegram-api.mjs, telegram-webhook.mjs}`, all present |
| `runtime` stage | NO | copies the whole `bot/` directory |

**Fix:** one line in `deploy/Dockerfile`:

```dockerfile
COPY --chown=node:node server/analytics-summary.mjs ./server/analytics-summary.mjs
```

### 7.2 The permanent guard

A missing COPY line is invisible until an image is built and booted — the slowest, most expensive possible place to find out. `scripts/check-server-image-modules.mjs` turns it into a **sub-second static check**:

1. parse `deploy/Dockerfile` into stages (name, COPY sources, CMD);
2. for every stage whose CMD runs a local `.mjs` entrypoint, resolve that file's **transitive closure of relative imports**;
3. assert every required module is covered by that stage's COPY sources (exact file, or a directory copy that contains it).

**RED → GREEN, demonstrated:**

| tree state | result |
|---|---|
| guard vs the **unfixed** Dockerfile | **EXIT=1** — `[server-image] stage "score" (CMD server/index.mjs) does not COPY server/analytics-summary.mjs — the image would fail with ERR_MODULE_NOT_FOUND` |
| guard vs the **fixed** Dockerfile | **EXIT=0** — `[server-image] OK — 2 image stage(s), 9 imported module(s) all present in deploy/Dockerfile` |

The guard is placed **first** in the `server:test` chain, so a missing module fails in under a second instead of after a 15-minute image build. The CI job that failed (`production-contract`) already runs `npm run server:test` as its first step — **so the guard is in CI without any workflow change**, which also solves the ci.yml permission problem for the new test (§8.4).

---

---

## 8. Tests

### 8.1 RED → GREEN, demonstrated

The HTTP-level tests were proved to detect the absence of the feature by reverting `server/index.mjs` (route removed) while keeping the module and the tests:

| tree state | result |
|---|---|
| `server/index.mjs` reverted (`git stash push server/index.mjs`) | **3 HTTP tests FAIL** — `not ok 10`, `not ok 12`, `not ok 13`; 10 pass (the 9 module-level tests still pass because the module exists) |
| restored (`git stash pop`) | **13/13 pass** |

```
$ node tests/analytics-readpath.test.mjs
ok 1  - token matcher fails closed and compares in constant time
ok 2  - query parser is strict: unknown parameters are rejected, never ignored
ok 3  - aggregator over an empty store returns an empty, well-formed summary
ok 4  - aggregator ignores unknown event names instead of echoing them back
ok 5  - aggregator filters by window and by platform
ok 6  - aggregator derives funnel counters from existing events only
ok 7  - aggregator reports the ring cap and survives a full ring
ok 8  - aggregator never emits actors, props or raw identities
ok 9  - gap list names the absent events and never invents them
ok 10 - HTTP: unauthenticated read is rejected, authenticated read returns aggregates
ok 11 - HTTP: the summary never exposes raw identities, props or initData
ok 12 - HTTP: window filtering, platform filtering and malformed queries behave
ok 13 - HTTP: the endpoint fails closed when no operator token is configured
# tests 13 / # pass 13 / # fail 0
```

### 8.2 Coverage against the required matrix

| required | where | how |
|---|---|---|
| unauthenticated read rejected | test 10, test 13 | no header → **403**; wrong token → **403**; token unset → **403** |
| authenticated aggregate works | test 10 | 200 + exact counts for all 11 funnel counters + `coverage.cap === 20000` |
| raw identities never exposed | test 8, test 11 | asserts the response contains no actor hash, no uid, no prop value, no `"actor"`, no `"props"`, no `initData` — and that a row-only prop marker never appears |
| window filtering | test 5, test 12 | `from=0&to=1` → 0 events; `window=24h` → all; unit-level from/to/platform matrix |
| unknown event | test 4 | unknown name → ignored, counted in `ignoredRows`, **not** present anywhere in the payload |
| empty store | test 3 | totals 0, `events: []`, `oldestTs: null`, `newestTs: null` |
| event caps | test 7 | 20,001 synthetic rows → `coverage.cap === 20000`, `storedEvents === 20001`, correct counts, `oldestTs`/`newestTs` correct; HTTP test asserts the endpoint reports the server's real cap |
| malformed query | test 2, test 12 | unknown param, bad window, bad platform, non-integer `from`, negative `to`, `from > to` → **400** |
| existing analytics write unchanged | test 10 | all 10 writes still **202**; `/health` count goes 0 → 10 and stays 10; bad event still **400**; bad `initData` still **403** |
| existing gameplay/backend tests unchanged | §8.3 | full `server:test` suite green |

### 8.3 Verification battery

| command | result |
|---|---|
| `npm run test:server-image` (the new guard) | **PASS** — 2 stages, 9 modules |
| `npm run server:test` (now = guard + existing suites + the read-path tests) | **PASS** |
| `npm run test:analytics` | PASS |
| `npm run test:analytics-readpath` | PASS (13/13) |
| `npm run test:server-policy` | PASS |
| `npm run test:isolation` | PASS |
| `node scripts/check-deploy-contract.mjs` | PASS |
| `node scripts/check-max-rc-production.mjs` | PASS |
| `npm run build` (tsc --noEmit && vite build && stamp-release) | PASS |
| `git diff --check` | PASS |

### 8.4 Hosted CI

| run | head | result |
|---|---|---|
| `40241321105` | `603a01345b` | **FAILURE** — `production-contract` step 18 *"Smoke production score image runtime"*, root-caused in §7.1 and fixed |

The `build` job (55/55 steps) and the `browser-smoke` job (56/56 steps) were **green** on that same run — the failure was isolated to the production image.

### 8.5 The ci.yml limitation, and how it was worked around

`.github/workflows/ci.yml` **cannot be pushed from the connected GitHub App** — both `push_files` and `create_or_update_file` are rejected for paths under `.github/workflows/` (a `workflows` scope limit, reproduced three times; identical payloads for every other path succeed). There is no low-level git-data tool to work around it.

**Workaround applied:** both the new test **and** the new image guard were wired into **`npm run server:test`**, which the `production-contract` CI job already runs as its first step (`Score server tests`). Both therefore execute in hosted CI **with no workflow edit at all**:

- `scripts/check-server-image-modules.mjs` — placed **first**, so a missing production module fails in under a second;
- `tests/analytics-readpath.test.mjs` — appended to the chain.

The local `ci.yml` still contains the explicit `Analytics read path contract` step for clarity; it is simply redundant now and can be dropped or kept at the owner's discretion.

---

## 9. Remaining missing events — NOT created in this branch

Per the brief, these are **gaps, reported not invented**:

| missing event | why it matters | what it would need |
|---|---|---|
| `menu_ready` | "did the player reach the menu?" is currently approximated by `app_open` | a client emit at menu-ready + a server allowlist entry |
| `run_end` | `win` + `death` is a correct decomposition but not a first-class signal | one client emit on run termination |
| `challenge_click` | the challenge CTA is only observable as `share` with `kind=challenge` | a dedicated emit on the CTA press |
| `tutorial_completed` | currently derived from `onboarding_step` + `outcome=completed` | a dedicated emit |

**Adding any of these touches the client event catalogue and the server allowlist — a product decision, deliberately out of scope here.**

Also still missing from the product surface (reported by the audit, unchanged by this branch): a **menu_ready**-equivalent, an **achievement-granted** event, a **quest-completed** event, and any event for **menu navigation depth**.

---

## 10. SAFETY

- **No production deploy.** No Render change, no production configuration, no deploy.
- **No Telegram/MAX configuration change.** No BotFather change, no webhook change, no bot token touched.
- **No monetization.** No Stars, no Storefront, no ledger, no entitlement.
- **No product UX change.** No mutation balance, first-mutation timing, tutorial/result UI, menu, gameplay, `SaveSystem`, Daily behaviour, payment or monetization code was touched. The client is byte-identical to `ce8ecb84`.
- **No merge.** Draft PR only.
- **No new dependency, no new SDK, no external analytics vendor, no new database, no frontend change.**
- **No production secret exposed.** The new `OFELIYA_ANALYTICS_TOKEN` is optional, unset by default, never logged, and fails closed.
- **Main checkout untouched.** The work happens in a dedicated worktree at `/workspace/ofeliya-wt-readpath`; `/workspace/ofeliya` remains on `main` at `ce8ecb84` with a clean `git status`.
