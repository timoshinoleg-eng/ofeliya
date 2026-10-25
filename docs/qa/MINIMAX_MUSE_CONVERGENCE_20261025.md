# OFELIYA — MiniMax Muse convergence and cross-flow acceptance (2026-10-25)

**Status:** QA candidate — Draft PR, not a release.
**Base:** PR #240 `f3acc38df4aec944820c34cbfffa3e4e23f8deed` (`feat/p11-muse-client-complete-20261024`).
**Branch:** `qa/minimax-muse-convergence-20261025`.
**Base branch of the PR:** `qa/ofeliya-muse-quests-staging-20261023` (the same QA base #240 uses).

This document is the source-to-feature reconciliation of the 16 Muse patch sources against the
shipped OFELIYA client, plus the convergence evidence. It is written from the code, not from a
prior report: every row below was checked against the current implementation and the current test
contracts.

---

## 1. What this branch changes

| Path | Kind | Purpose |
|---|---|---|
| `scripts/muse-convergence-crossflow-smoke.cjs` | new | One real Chromium session that walks platform startup → viewport → Collection → QuestBoard → Game → cosmetics → host lifecycle → platform transfer → cleanup. 29 assertions. |
| `scripts/check-muse-convergence-adversarial.mjs` | new | 11 adversarial contracts that close gaps the shipped Muse suites did not cover. |
| `src/game/collection/ClientCollection.ts` | **product fix** | Bounds the observed-run idempotency ledger (see §5.2). |
| `src/platform/GameHostLifecycle.ts` | **product fix** | Host pause/resume must be synchronous, otherwise a Telegram deactivate/activate cycle can leave the run frozen (see §5.1). |
| `package.json` | wiring | `test:muse-convergence`, `test:muse-convergence-crossflow`. |
| `.github/workflows/ci.yml` | wiring | Adversarial contracts in `build`; cross-flow in `browser-smoke`. |

No gameplay authority, economy, entitlement, payment, Daily or analytics behaviour is touched.

---

## 2. Source-to-feature matrix — all 16 Muse patch sources

Status vocabulary:
`IMPLEMENTED_EQUIVALENT` · `IMPLEMENTED_DIRECT` · `SUPERSEDED_BY_BETTER_EXISTING_SYSTEM` ·
`EXCLUDED_BY_SCOPE` · `MISSING` · `PARTIAL` · `UNKNOWN_REQUIRES_TEST`.

| # | Muse source | Original idea | Current equivalent (this branch) | Where implemented | Test | Status |
|---|---|---|---|---|---|---|
| 1 | `ofeliya-improvements.patch` | 50 ms simulation clamp; raw delta for the quality governor; modal keyboard suppression; DPR texture generation; adaptive biological atlas sizing; mutation artwork invariants; particle frame lookup/cache; hitbox vs visual geometry separation; session-stable texture identity | Same intent, ported to OFELIYA module names. The particle frame cache and hitbox/visual separation already existed in the OFELIYA base and are covered by the presentation suite. | `src/game/ArtMetrics.ts` (`artScale`, `artSourceFactor`), `src/game/StrainZeroTextures.ts`, `src/scenes/GameScene.ts` update prefix, existing `RuntimeQualityGovernor` | `scripts/check-muse-performance.mjs` (`npm run test:muse-client`) | `IMPLEMENTED_EQUIVALENT` |
| 2 | `ofeliya-phase1-juice.patch` | Hit stop; shake; zoom; squash; reward reveal; reduced motion; listener/tween cleanup; VFX budget; **no second timing engine** | `ClientJuice` is a thin preset layer over the existing Phaser tween manager — it adds no clock, no timer of its own, and reuses `prefersReducedMotion`. | `src/ui/ClientJuice.ts`, `src/systems/MotionPreferences.ts`, existing `GameScene.hitStop`/`shake` | `scripts/check-muse-juice.mjs`, `tests/reduced-motion.mjs` (`test:b2b4-fixes`), cross-flow cosmetic check | `IMPLEMENTED_EQUIVALENT` |
| 3 | `ofeliya-phase2-analytics.patch` | Typed feature flags; QA-only overrides; production override rejection; Umami default OFF; script dedup; telemetry privacy; no initData/userId/query/hash/referrer leakage; telemetry never blocks boot | Same intent, with a deliberate narrowing: the Muse patch carried gameplay flags (`events.doubleRna`, `difficulty.earlyGame`, `storefront.variant`, `economy.lab`). OFELIYA keeps **presentation-only** flags and the contract asserts `'events' in flags === false`. | `src/systems/ClientFeatureFlags.ts`, `src/systems/OptionalWebAnalytics.ts`, `src/systems/ClientExperience.ts` | `scripts/check-muse-telemetry.mjs`, `scripts/check-muse-convergence-adversarial.mjs` | `IMPLEMENTED_EQUIVALENT` (narrowed by design) |
| 4 | `ofeliya-phase3-retention.patch` | Quests with a runtime producer; terminal events; save/resume; achievements; UTC visit calendar; cosmetic unlocks; repeated-finish idempotence; no duplicate rewards; no second Daily authority | The Muse catalog had 8 slots; OFELIYA ships 24 observational goals. The Muse `MetaWallet` (a client-side wallet) is **not** ported — the collection exposes counters and cosmetic ownership only. | `src/quests/questCatalog.ts`, `questEngine.ts`, `questRuntime.ts`, `questState.ts`; `src/game/collection/ClientCollection.ts` | `test:quest-core`, `test:quest-runtime`, `test:quest-core-mutations`, `scripts/check-muse-collection.mjs`, cross-flow | `IMPLEMENTED_EQUIVALENT` (the wallet half is `EXCLUDED_BY_SCOPE`, see §7) |
| 5 | `ofeliya-phase4-economy.patch` | Informational lab branches; **no permanent power**; no money; no fake purchase UI; no misleading "paid upgrade" labels | The Lab exists only as an informational tab that states "Урон, здоровье, скорость и награды не меняются." It has no purchase control and writes nothing. | `src/ui/CollectionBoard.ts` (ЛАБОРАТОРИЯ tab, 3 branches) | `scripts/check-muse-collection.mjs` (no reward payloads, no money copy), cross-flow lab check | `IMPLEMENTED_EQUIVALENT` (informational layer); the `LabModifiers`/`LabState` permanent-power layer is `EXCLUDED_BY_SCOPE` |
| 6 | `ofeliya-phase5-skins.patch` | Ownership; locked selection rejection; persistence; mutation visuals; player collision/body invariance; tint reset; generated art fallback; compact UI; pagination; safe-area | Same intent. Four palettes, three of them achievement-earned; selection is rejected unless owned; the palette only changes tint — never the collision body. | `SKIN_CATALOG` / `selectSkin` in `src/game/collection/ClientCollection.ts`; gallery in `src/ui/CollectionBoard.ts`; `cosmeticColor` in `src/systems/ClientExperience.ts`; applied in `src/scenes/GameScene.ts` | `scripts/check-muse-collection.mjs`, cross-flow skin pagination / locked rejection / collision-invariance checks | `IMPLEMENTED_EQUIVALENT` (the `StorefrontScene` half is `EXCLUDED_BY_SCOPE`) |
| 7 | `ofeliya-tma-adapt.patch` | Late SDK; retry; duplicate ready; multicast viewport; safeArea; contentSafeArea; max-per-side merge; theme; closing confirmation; host deactivation pause; host activation resume; manual pause ownership; lifecycle cleanup; Telegram → MAX → Browser transitions | Same intent, but the one-shot adapter selection of the Muse patch is **superseded** by a call-time facade that re-resolves the adapter on every access, so a slow MAX bridge can never be permanently mis-classified as a generic browser. | `src/platform/TelegramBridgeLoader.ts`, `TelegramPlatform.ts`, `TelegramLifecycle.ts`, `TelegramTheme.ts`, `GameHostLifecycle.ts`, `ViewportManager.ts`, `ViewportMath.ts`, `index.ts`, `MaxPlatform.ts`, `BrowserPlatform.ts` | `test:telegram-tma`, `test:telegram-runtime`, `test:viewport`, `tests/platform-lifecycle-browser.mjs` (`test:review-browser`), cross-flow | `IMPLEMENTED_EQUIVALENT` / adapter resolution `SUPERSEDED_BY_BETTER_EXISTING_SYSTEM` |
| 8 | `ofeliya-storefront.patch` | Storefront with real purchases; SKU; product catalogue | Not implemented. OFELIYA has no storefront scene, no product catalogue, no payment provider and no purchase UI of any kind. | — | — | `EXCLUDED_BY_SCOPE` — real purchases and client-authoritative entitlements are forbidden in this phase. See §7. |
| 9 | `ofeliya-telegram-stars.patch` | Telegram Stars; invoices; XTR; worker/D1 write path | Not implemented. No Stars provider, no invoice handling, no worker in this branch. | — | — | `EXCLUDED_BY_SCOPE` — real Stars and real payments. See §7. |
| 10 | `ofeliya-audit-fixes.patch` | Correctness fixes to the quest runtime, the menu and the storefront | The quest/menu half is covered: the runtime is `src/quests/questRuntime.ts` and its audit findings are the F5 work verified here (stale/equal/NaN ticks, terminal force, idempotent end). The storefront half does not exist to fix. | `src/quests/questRuntime.ts` | `test:quest-runtime`, `test:quest-core-mutations`, cross-flow terminal-tick check | `PARTIAL` — quest/menu half `IMPLEMENTED_EQUIVALENT`; storefront half `EXCLUDED_BY_SCOPE` |
| 11 | `ofeliya-post-review-fixes.patch` | Cross-cutting review fixes across achievements, lab, meta-wallet, quests, shop, skins, art, juice, TMA and storage keys | The safe client subset (achievements, lab copy, quests, art, juice, storage keys, TMA) is present and independently re-verified here. The shop and meta-wallet subsets have no counterpart. | as rows 1–7 | as rows 1–7 | `PARTIAL` — safe client subset `IMPLEMENTED_EQUIVALENT`; shop/wallet subset `EXCLUDED_BY_SCOPE` |
| 12 | `ofeliya-review2-fixes.patch` | Umami privacy; shop providers; `PaymentLedger`; shared storage keys; worker entitlements | The Umami privacy and storage-key halves are implemented and *strengthened* here (the launch URL query/hash are proven not to be transmitted). The ledger/provider/worker halves are excluded. | `src/systems/OptionalWebAnalytics.ts`, `src/game/collection/ClientCollection.ts` | `scripts/check-muse-telemetry.mjs`, adversarial contract "the launch URL query and hash are never transmitted" | `PARTIAL` — telemetry/storage halves `IMPLEMENTED_EQUIVALENT`; payment halves `EXCLUDED_BY_SCOPE` |
| 13 | `ofeliya-review3-fixes.patch` | Worker schema, entitlements, payments-trust | Not implemented. No worker, no schema, no entitlement endpoint. | — | — | `EXCLUDED_BY_SCOPE` — requires a new server contract. See §7. |
| 14 | `ofeliya-review4-fixes.patch` | Stars proxy, worker v4, deploy runbook | Not implemented. | — | — | `EXCLUDED_BY_SCOPE` — real Stars path. See §7. |
| 15 | `ofeliya-review5-fixes.patch` | Worker grants, server wallet sync, migration 15 | Not implemented. | — | — | `EXCLUDED_BY_SCOPE` — authoritative wallet is forbidden in this phase. See §7. |
| 16 | `ofeliya-review6-fixes.patch` | Worker v16, D1 ledger, reconcile scripts, patch16 regression battery | Not implemented. No D1 ledger, no reconcile scripts, no worker. | — | — | `EXCLUDED_BY_SCOPE` — D1 ledger and refunds are forbidden in this phase. See §7. |

**Totals over the 16 sources:** 7 implemented (1–7) · 3 partial (10, 11, 12) · 6 excluded (8, 9, 13, 14, 15, 16).
Nothing is `MISSING`, `UNKNOWN_REQUIRES_TEST`, `UNSAFE` or `DUPLICATE`.

---

## 3. Why #239 and #240 diverged, and what was carried over

Both branches fork from `77fd22bdf115f2aa6b26f3b47aba4eddefcf14a7` (the platform line of #236).
#239 is 3 commits ahead / #240 is 11 commits ahead of that base.

| Branch | Unique commits |
|---|---|
| #239 only | `eef471f` F-5 stale ticks · `d25e4f6` terminal no-damage flush · `8e57fb3` combined cross-flow |
| #240 only | `5606ae4` F-5 stale ticks · `e8c5197` terminal no-damage flush · `8e8cf1f`…`f3acc38` (Muse client, collection, platform, telemetry, juice, docs) |

**The two quest fixes are byte-identical across the branches.** The patch bodies hash the same
(`eef471f` == `5606ae4` → `0c3aa94d…`; `d25e4f6` == `e8c5197` → `995fe885…`). A whole-branch
`git diff pr-240…pr-239` shows **no** difference in `src/quests/*`, `scripts/check-quest-*` or
`scripts/quest-scene-smoke.cjs`.

Therefore:

* **Merging or cherry-picking #239 wholesale would have been wrong**: it would re-apply two
  identical patches (duplicate provenance commits) and would have *dropped* the Muse client work,
  because #239's tree lacks `src/game/collection/`, `src/ui/CollectionBoard.ts`,
  `src/systems/ClientFeatureFlags.ts`, `src/systems/OptionalWebAnalytics.ts`,
  `src/ui/ClientJuice.ts` and the `test:muse-client` CI step.
* **The only genuinely unique #239 artifact is `8e57fb3`**: `scripts/p11-combined-crossflow-smoke.cjs`,
  `docs/qa/PATCH11_COMBINED_CROSSFLOW_20261024.md` and one CI step.

**What was carried over:** the *idea* of a single-session combined cross-flow — and only that.
The #239 script itself was not copied: it is a 90-line synthetic harness that drives the quest
engine through module-level seams and never opens the Collection, the cosmetics, the lab, the
host lifecycle or the platform transfer. This branch replaces it with
`scripts/muse-convergence-crossflow-smoke.cjs`, which keeps the one-session property and covers
the whole #240 surface.

**What was intentionally not carried over:** the old file name, the old report, and the old CI
step name, so that the surviving artifact has one owner and one meaning. The provenance of #239
is recorded here and in the commit messages.

---

## 4. Convergence coverage — the 72-point scenario

`scripts/muse-convergence-crossflow-smoke.cjs` walks this in **one** browser session, one page,
one real Phaser game, one real Telegram adapter.

| # | Scenario | Result |
|---|---|---|
| 1–2 | Browser launch; Telegram SDK absent (0 SDK requests at boot) | PASS |
| 3–4 | Two concurrent `ensureTelegramBridge()` with different deadlines, both time out | PASS |
| 5–6 | SDK arrives late; readiness announced exactly once | PASS |
| 7 | Telegram adapter becomes active | PASS |
| 8 | One physical viewport subscription, correct logical multicast | PASS |
| 9 | Initial viewport 390×740 | PASS |
| 10–11 | Telegram virtual viewport → 390×600; Phaser canvas = 390×600 | PASS |
| 12 | A resize recreates the Menu (`MenuScene.onResize` → `scene.restart()`) | PASS |
| 13–14 | Action CTA and legal CTA stay inside the new bounds | PASS |
| 15 | Touch targets stay reachable (action plate 66 px) | PASS |
| 16–17 | Codex opened; Collection opened | PASS |
| 18 | Achievements render the observational catalogue, no money copy | PASS |
| 19–20 | Skins tab pages through all four palettes; locked/owned state correct | PASS |
| 21–22 | Lab is informational; no purchase control, no permanent stats | PASS |
| 23–25 | Close; repeat 10×; listener, resize and back-handler counts stay flat | PASS |
| 26–29 | QuestBoard open/close 5×; back/lifecycle handlers stay flat | PASS |
| 30–31 | Real GameScene; Telegram closing confirmation enabled | PASS |
| 32 | Real kill → exactly one quest kill | PASS |
| 33 | Real RNA pickup → exactly seven quest RNA | PASS |
| 34 | Real mutation chosen **through the real level-up modal** (`nova`/`hp`/`multi`, …) | PASS |
| 35–36 | Real damage resets the no-damage streak to 0 | PASS |
| 37 | A new clean streak | PASS |
| 38 | A suppressed pending sample (`lastTickTimeMs` stays 125000) | PASS |
| 39–40 | Real `finish` → forced terminal tick delivers 125950 and a **60 s** streak (the 59→60 fix) | PASS |
| 41 | Repeated `finish` does not change QuestState | PASS |
| 42 | Repeated `finish` does not add a second collection observation | PASS |
| 43 | Repeated `finish` does not unlock a cosmetic twice | PASS |
| 44 | The Daily/score outbox sentinel is untouched by the Muse Collection | PASS |
| 45–47 | Cosmetic unlocked from an observation, selected, and applied on the next run (via the product's own "play again" control) | PASS |
| 48 | Player appearance changed | PASS |
| 49 | Collision body radius unchanged (11.4–12.1 px, authoritative) | PASS |
| 50 | Mutation silhouette texture still present | PASS |
| 51–52 | Telegram `deactivated` pauses the running game **inside the same browser turn** | PASS |
| 53–54 | Telegram `activated` resumes **only** the host-owned pause, inside the same turn | PASS |
| 55–58 | A manual pause survives `deactivated → activated`; the host never resumes it | PASS |
| 59–61 | Telegram → MAX: MAX viewport applied, Telegram listeners released | PASS |
| 62–63 | MAX → Browser: runs with no Telegram SDK at all | PASS |
| 64–65 | Browser → Telegram: exactly one subscription re-created | PASS |
| 66–70 | Run end disables the closing confirmation; game activation handlers removed; `ViewportManager.destroy` is idempotent; Collection/QuestBoard handlers back to baseline | PASS |
| 71 | No unexpected `pageerror` (0) | PASS |
| 72 | No unexpected console error (only the deliberately unreachable backend 503) | PASS |

Extra hardening added beyond the minimum list: a five-size compact viewport matrix
(320×474 / 320×568 / 390×600 / 390×740 / 390×844), teardown of the Collection **during the
reward-reveal tween**, teardown of the Collection by a **Menu restart underneath it**, and three
repeated MAX/Telegram switching rounds that must never accumulate host subscriptions.

The host-lifecycle phase is measured **inside a single browser turn**. The run itself keeps
playing while the suite walks it — the player auto-fires, killed enemies drop XP gems, and a
collected gem opens the real level-up modal, which legitimately owns the pause and blocks
`UIScene.canResumeFromHost()`. Polling for "paused"/"active" therefore raced the game's own
progression; reading the contract in the turn that produces it removes the race entirely. Three
host contracts are asserted this way: a `deactivated`/`activated` pair inside one turn must never
leave an ownerless pause behind, the host must never take over or release a pause it does not own
(a real level-up modal owns it), and a manual pause must survive the host cycle.

---

## 5. Defects found

### 5.1 P1 — a Telegram deactivate/activate cycle could freeze the run

* **Severity:** P1 (the player is left in a paused, frozen run that nothing can resume; no data
  loss and no paid state, but the session is unrecoverable without a reload).
* **How it was found:** the exact-head CI run `40144635676` failed in `browser-smoke` → step
  *"Combined Muse convergence cross-flow"* → `a Telegram activation must resume the host-owned
  pause`. The failure was reproduced locally with a CPU-throttled Chromium
  (`MUSEFLOW_CPU_THROTTLE=6`) and then traced frame by frame with a per-frame recorder that the
  cross-flow now keeps in `window.__museFrames`.
* **RED:** `scripts/muse-convergence-crossflow-smoke.cjs`, contract *"a same-turn
  deactivate/activate never leaves the run frozen"* — against the original
  `src/platform/GameHostLifecycle.ts` the assertion *“a same-turn deactivated → activated cycle
  must not leave the game paused with no owner”* fails: the game is left `paused` while
  `canResumeFromHost() === true`, i.e. **nobody owns that pause**. The same RED reproduces with
  the Chromium throttled 6×, which is the condition that failed in CI.
* **Root cause:** Phaser 3.90 (`phaser@^3.90.0`) **queues** `ScenePlugin.pause()` / `resume()`
  for the next Scene Manager update (`SceneManager.queueOp`), while `ScenePlugin.isPaused()` and
  `isActive()` read the current state synchronously. `GameHostLifecycle` drove the game through
  the Scene Plugin (`scene.scene.pause('Game')`) but tracked the pause ownership synchronously:
  1. Telegram `deactivated` → the host pauses → the pause is only *queued*, the scene still runs.
  2. Telegram `activated` arrives before the queue is applied → `TelegramLifecycle.resumeIfOwnedByUs()`
     reads `isPaused() === false`, so it **drops the pause token** and returns.
  3. The queued pause is applied on the next frame → the game is paused and **no host or UI owns
     that pause** → the run is frozen: nothing resumes it, and `UIScene.canResumeFromHost()`
     stays `true`, so the host refuses to touch it either.
  The same one-frame gap let the game's own level-up modal take the pause between the host pause
  and the host resume — exactly what the CI failure snapshot showed (`awaitingChoice: true`,
  `modalOpen: true`, `canResumeFromHost: false`).
* **Fix:** `src/platform/GameHostLifecycle.ts` now drives the game through the Scene Manager
  (`scene.sys.game.scene`) instead of the Scene Plugin. The Scene Manager applies `pause` and
  `resume` immediately, so ownership bookkeeping and scene state always agree inside the same
  host event. The product contract is otherwise unchanged: the host still refuses to own a pause
  it did not create, and still refuses to resume while `UIScene.canResumeFromHost()` is `false`.
* **GREEN:** the new contract passes, the whole cross-flow passes (29/29), and it also passes
  with the Chromium throttled 6×. The pre-existing platform contracts pass unchanged:
  `npm run test:telegram-runtime` (the browser platform-lifecycle suite), `npm run test:telegram-tma`,
  `npm run test:muse-client`, `npm run test:viewport`, `npm run test:review-browser`.
* **Regression test:** the cross-flow contracts *"a same-turn deactivate/activate never leaves
  the run frozen"*, *"Telegram deactivated pauses and activated resumes the host-owned pause"* and
  *"the host never takes over or releases a UI-owned pause"*, wired into CI as
  `npm run test:muse-convergence-crossflow`.

### 5.2 P2 — unbounded observed-run ledger in the Muse collection

* **Severity:** P2 (progressive storage growth; no crash, no paid state, no authority change).
* **RED:** `scripts/check-muse-convergence-adversarial.mjs`, case *"the observed run ledger stays
  bounded across many runs"* — after 2000 observed runs the stored
  `ofeliya.collection.v1` record held **2000** entries in `processedRunIds`.
* **Root cause:** `ClientCollection.observeRun()` pushed every run id into
  `state.processedRunIds` with no cap, and `parseState()` restored the list with no cap. The
  ledger is the collection's idempotency key set, so it grew by one UUID per finished run for the
  lifetime of the profile. `persist()` swallows write failures, so the record would eventually
  hit the storage quota and the collection would **silently stop persisting** — the player would
  lose observed progress and earned cosmetics without any error.
* **Fix:** `src/game/collection/ClientCollection.ts` now keeps the newest
  `MAX_OBSERVED_RUN_IDS = 1024` ids, mirroring the convention the quest core already uses for
  its own idempotency ledger (`MAX_REMEMBERED_EVENT_IDS = 1024` in `src/quests/questState.ts`).
  Both the write path and the parse path trim the tail. A duplicate observation can only arrive
  for a run that has just finished, and `GameScene.finish()` already refuses to finish the same
  run twice, so the retained window is orders of magnitude larger than the real duplicate
  horizon.
* **GREEN:** the adversarial case passes (ledger ≤ 1024, stored record ≤ 64 KB, all 2000 runs
  still counted, the newest runs still idempotent), and the pre-existing
  `scripts/check-muse-collection.mjs` contract still passes unchanged.
* **Regression test:** the adversarial case above, wired into CI as `npm run test:muse-convergence`.

### 5.3 Defects that were investigated and found **not** to be defects

These were real hypotheses during the review; each was disproved against the code, so none is
claimed as a fix.

* *The host lifecycle cannot resume after a Telegram deactivate/activate cycle.* — **Partly a
  real defect, and it is fixed in §5.1.** The design intent is correct and unchanged: the host
  refuses to own a pause it did not create (`TelegramLifecycle.pauseIfOwnedByUs` returns early
  when the game is already paused) and `UIScene.canResumeFromHost()` refuses to resume while a
  modal, the game-over overlay, a stage transition or a boss reveal is open. What was wrong was
  the *mechanism*: the host drove the scene through Phaser's deferred Scene Plugin, so the pause
  and the ownership bookkeeping disagreed for one frame and a deactivate/activate pair could
  strand the run in an ownerless pause. A second, separate artefact of the first cross-flow draft
  — restarting the `Game` scene without the `UI` scene, a path the product does not have — was
  also removed: the cross-flow now uses the product's own "play again" control, which restarts
  both scenes (`this.scene.launch('Game'); this.scene.restart();` in `UIScene.showGameOver`).
* *Two `activated` listeners on the Telegram SDK.* — **Not a defect.** One is the lifecycle
  controller, the other is `TelegramPlatform.lockVerticalSwipes`, which is a separate product
  responsibility.
* *A stale `codexOverlay` reference blocks the Codex after a Menu restart.* — **Not a defect.**
  `MenuScene.create()` resets `this.codexOverlay = null`.
* *The evidence PNGs in `docs/qa/quest-evidence/` differ after a local run.* — **Not a product
  defect**, a non-reproducible test artifact. Those files are regenerated by
  `npm run test:quest-scenes` and are byte-different on this machine; they were restored to the
  committed versions and are **not** part of this branch.

---

## 6. Adversarial contracts added

`scripts/check-muse-convergence-adversarial.mjs` — 11 cases. Each one was first checked against
the shipped suites; a case was only written if the gap was real.

| Area | Case | Pre-existing coverage |
|---|---|---|
| Telegram loader | repeated readiness announces the same SDK exactly once | new |
| Telegram loader | a replaced SDK object is announced again | new |
| Telegram loader | a throwing readiness dispatcher cannot break the bridge | new |
| Collection | the visit calendar stays bounded past 31 days | new (only 3 days were covered) |
| Collection | invalid stored visit days are dropped without inflating the streak | new |
| Collection | the UTC day boundary counts exactly one visit per UTC day | new |
| Collection | a backwards visit never lowers the recorded UTC day | new |
| Collection | the observed run ledger stays bounded across many runs | new — **caught a real defect (§5.1)** |
| Telemetry | the launch URL query and hash are never transmitted | strengthened (the existing contract only proved property-level dropping) |
| Quest runtime | a negative timestamp cannot move the quest clock | new |
| Quest runtime | an oversized event id cannot corrupt the processed-event set | new |

Already covered elsewhere and therefore **not** duplicated here: stale/equal/NaN/undefined
timestamps, duplicate force, force without a pending sample, same-time hit, resume, ended save
and old-schema migration (`test:quest-runtime`); malformed storage, future schema, duplicate run
id, locked/unknown skin, unknown mutation id (`scripts/check-muse-collection.mjs`); concurrent
bridge callers, late load, network error and retry (`scripts/check-telegram-late-loader.mjs`);
disabled/malformed telemetry config, duplicate script, script error and retry, property
allow-listing (`scripts/check-muse-telemetry.mjs`).

---

## 7. DEFERRED_SERVER_AND_MONETIZATION

Nothing in this section is implemented in this branch, and nothing in this branch depends on it.

| Deferred item | Existing local groundwork | Reusable as-is | Needs a new server contract | Must not be moved over from the client-authoritative Muse prototype | Later E2E needed |
|---|---|---|---|---|---|
| **Storefront** | `clientFlags()` shape (`skins.gallery`) shows a flag seam; `CollectionBoard` already renders a paginated palette gallery | The gallery layout, the compact safe-area frame and the "owned vs locked" model | Product/SKU catalogue, price list, entitlement endpoint | The Muse `Storefront` was client-authoritative: it decided ownership locally | Storefront → SKU → price → purchase → entitlement → owned palette → applied in game |
| **Telegram Stars** | — | — | XTR invoice flow, `payment_pending`/`payment_ok` handling, refunds | The Muse `TelegramStarsPaymentProvider` trusted the client | Stars invoice → server verification → entitlement → refund path |
| **Worker economy** | — | — | Worker, D1 binding, deploy runbook | Any client-side economy simulation | Worker deploy → grant → balance read-back |
| **Authoritative wallet** | `ClientCollection` deliberately exposes **counters only** — no balance, no currency, no purchase state (`snapshot()` has no wallet key and the contract asserts it) | The "observation without authority" boundary | Wallet schema, ledger entries, reconciliation | The Muse `MetaWallet` was a local balance that the client could edit | Grant → spend → refund → reconcile |
| **D1 ledger** | — | — | D1 schema, migrations 15/16, reconcile scripts | The Muse review4–6 patches assumed a server ledger that does not exist here | Migration → ledger write → grant → reconcile → audit |
| **Refunds** | — | — | Refund records and reconciliation | The client cannot refund itself | Purchase → refund → entitlement revoked → balance restored |
| **Purchase restore** | — | — | Entitlement lookup by account | — | Reinstall → restore → palette re-applied |
| **SKU** | — | — | SKU identity shared by client and server | — | Same SKU rendered identically on both sides |
| **Paid prestige** | — | — | Server-authoritative prestige state | The Muse Lab `LabModifiers` applied permanent power from a client flag | Unlock → apply → visible effect → persists across reinstall |
| **Permanent Lab power** | The Lab tab is already informational-only: it states that damage, health, speed and rewards do not change | The informational branch copy and layout | A server-authoritative Lab contract | `LabState`/`LabModifiers` in the Muse prototype wrote permanent client state | Branch selected → server confirms → permanent effect |

**Rule for the follow-up work:** the Muse prototype is a *client-authoritative* design. It cannot
be lifted into the product as-is; the catalogue, identity, price, grant and refund concepts have
to be re-derived against a server contract, with the client reduced to a renderer of server
state. The OFELIYA boundary that must not be crossed in the meantime is already enforced by the
`test:muse-client` and `test:muse-convergence` contracts: the collection has no wallet, the Lab
has no purchase control, and the feature flags contain no economy or gameplay entries.

---

## 8. Known gaps that are deliberately left open

| Item | State | Why it is not closed here |
|---|---|---|
| Issue #237 — UTC attribution around `23:59:59.200Z → 00:00:00.300Z` can give the new UTC day a whole second of `q_nodmg` | **NOT fixed, NOT masked** | It is a separate quest-time-attribution defect. No algorithm change was made here, and no PASS test was written over it. The fixed F5 terminal-force defect is a different mechanism and is verified separately (cross-flow: forced tick 125000 → 125950, streak exactly 60). |
| Real Telegram WebView on a Samsung S20+ | **NOT_RUN** | A desktop Chromium is not a Mini App WebView. |
| Real MAX WebView | **NOT_RUN** | The MAX bridge in the cross-flow is a synthetic `window.WebApp` stub. |
| Native Telegram close dialog | **NOT_RUN** | The closing-confirmation *contract* is verified (enable on run start, disable on run end); the native dialog needs a real host. |
| Real Android keyboard safe-area transition | **NOT_RUN** | Safe-area arithmetic is unit-tested; the OS transition is not. |
| OS process eviction / background resume | **NOT_RUN** | The visibility/pause contract is verified; the OS behaviour is not. |
| Real Stars, real payments, D1 production, production deploy | **NOT_RUN** | Out of scope for this branch by policy. |
| Windows `test:startup` font/splash timing flake | **Pre-existing environment flake, reproduced identically on the untouched #240 baseline** | Measured on this machine against a clean worktree at the exact #240 HEAD `f3acc38`: three consecutive runs of `npm run test:startup` failed **once** on the baseline (exit=1) and **once** on this branch (exit=1), with the same assertion — `tests/startup-font-timeout.mjs:47`, `font readiness must not block the Mini App startup` (`actual: true, expected: false`): the splash was still on screen 900 ms after load on a loaded machine. The timeout was not weakened and the assertion was not removed. Hosted Ubuntu CI is green. |
| Deferred Scene Plugin pause/resume outside the host lifecycle | **Documented limitation (P3), not changed here** | The fix in §5.1 makes the *host* pause synchronous. The UI still drives its own pauses through Phaser's deferred Scene Plugin (`UIScene.showPauseMenu`, `showLevelUp`, `closePauseMenu`, `VideoInterstitial`). Each of those reads the scene state before acting (`if (this.scene.isPaused('Game')) this.scene.resume('Game')`), which is only safe because a pointer event cannot be handled in the same frame that queued the pause — i.e. input latency is the guard. That is a fragile invariant for a future refactor, but no reachable freeze was demonstrated, so nothing is changed here. |
| Cross-tab collection state | **Documented limitation** | Two tabs writing `ofeliya.collection.v1` is last-writer-wins. It cannot corrupt or grant anything (cosmetic-only, no wallet), and a cross-tab sync would be a design change beyond this QA branch. |

---

## 9. Architecture boundaries — verified, not asserted

| Boundary | How it is proven |
|---|---|
| No second Daily authority | The cross-flow seeds `ofeliya_daily_score_outbox_v1` with a sentinel and asserts it is byte-identical after a full run, after a repeated finish, and after a cosmetic unlock. The collection writes **only** `ofeliya.collection.v1` — asserted by comparing the entire `localStorage` key set before and after. |
| No MetaWallet | `ClientCollection.snapshot()` exposes counters and cosmetic ownership; the contract asserts the public snapshot has no `wallet`/`rna`/`damage`/`hp`/`combatStats`/`reward` key. |
| No server balance change | No server code exists in this branch. The Daily/score outbox is written only by the pre-existing `ScoreClient`. |
| No real Stars | No Stars provider, no invoice, no payment provider, no storefront scene in the tree. |
| No permanent combat strength | The Lab is informational copy only and exposes no purchase control (cross-flow). Skins change tint only; the collision body radius is asserted unchanged. |
| No third-party game engine | No new runtime dependency: `package.json` gains two scripts and nothing else. |
| No second animation/timing runtime | `ClientJuice` uses the existing Phaser tween manager; it registers no timer of its own. |
| RuntimeQualityGovernor intact | `scripts/check-muse-performance.mjs` asserts the governor still sees the **raw** delta while the simulation clamps to 50 ms. |
| Collision geometry unaffected by skins | Cross-flow: the earned palette changes the tint, the authoritative body radius stays inside its production band. |
| No PII/initData in Umami | The tracked payload is a fixed `{website, url:'/ofeliya', title:'OFELIYA', name, data}`; `data-auto-track=false` and `data-exclude-search=true`; the launch URL query/hash, `initData` and user ids are asserted absent from the transmitted payload. |
| Telemetry never required for boot | `createOptionalWebAnalytics` is a no-op without an explicit configuration, and its promise is never awaited by the boot path. |
| QA URL flags inert in production | `resolveClientFlags` only honours `?flag.*=` when the build sets `VITE_QA_TOOLS=1`; the contract asserts production ignores them. |

---

## 10. How to run this branch

```bash
npm ci
npm run test:muse-convergence           # adversarial contracts (no browser needed)
npm run dev -- --host 127.0.0.1        # the cross-flow needs the dev server
npm run test:muse-convergence-crossflow # one Chromium session, 27 assertions
```

The cross-flow honours `OFELIYA_BASE_URL` (default `http://127.0.0.1:5173/`), `CHROME_PATH` and
`MUSEFLOW_EVIDENCE` (a JSON evidence file, default in the system temp directory).
