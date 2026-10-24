# OFELIYA — Muse safe client completion — 2026-10-24

## Scope and provenance

User-approved scope: all safe client work; server, payments and permanent laboratory power excluded. This is a new combined QA candidate, not a production release.

- QA base: `qa/ofeliya-muse-quests-staging-20261023`, `5a2e04332ee3bc03b9683ef29543b81d121490bd`.
- Isolated clone: `C:\Users\Имярек\Downloads\ofeliya-combined-qa-20261024-codex`.
- New branch: `feat/p11-muse-client-complete-20261024`.
- Platform PR #236 commits retained; quest PR #233 commits replayed with `-x` as `5606ae4` and `e8c5197`. Original branches/PRs remain untouched. No main, production, Render, webhook, server, payment, wallet or memory edits.
- Source: supplied `ofeliya-bundle/OFELIYA_PATCHES_README.md` and 16 patches against old `abdb10c`. Ideas were ported to current contracts, not applied wholesale.

## Source-to-feature matrix (all 16 patches)

| Source | Safe client disposition |
| --- | --- |
| 1 improvements | 50ms simulation delta after raw quality measurement; modal keyboard guard; session-stable adaptive DPR atlas bake; bounded particle-frame cache. |
| 2 phase1 juice | Native Phaser reward reveal, preview squash, quality-gated impact zoom; existing ImpactDirector/Sfx/damage text retain hit-stop, shake and popups. No second tween clock or duplicate feedback engine. |
| 3 phase2 analytics | Small typed flags, QA-only URL overrides; optional explicit-config Umami mirror of existing events. Default no third-party script. No gameplay/economy modifiers. |
| 4 storefront | Excluded payment/shop surface by explicit scope. No mock money/purchase UI presented as usable commerce. |
| 5 Telegram Stars | Excluded provider, invoices, Worker and all monetary state. |
| 6 phase3 retention | Existing integrated quest engine/UI and Daily authority retained; separate 24-goal observational collection, UTC visit calendar/streak, persisted unlocks. No MetaWallet or calendar payouts. Spend/claim goals replaced with clearly named combat observations. |
| 7 phase4 economy | Three research branches rendered as informational collection records. Permanent HP/damage/magnet/income/prestige and Decimal economy excluded. |
| 8 TMA adapt | Existing multicast viewport/final-loader fixes plus version-gated safe/content insets, max-per-side CSS merge, closing confirmation, owned host pause/resume and dark theme harmonization. |
| 9 phase5 skins | Four earned palettes, locked/owned gallery, persistent selection, player tint seam preserving atlas mutation silhouette and collision body. Native generated art retained instead of replacing it with remote/third-party avatar geometry. |
| 10 audit fixes | Current code contracts and regression tests used; stale IDs, duplicate terminal observations, save sanitation, reduced motion and teardown checked. Payment changes excluded. |
| 11 post-review | SDK error/load handler cleanup, stable bake cache, symmetric effect cleanup, content-safe-area max merge included. Store, payout toast, entitlements and prestige excluded. |
| 12 review2 | Lightweight flags without OpenFeature; strict QA override gate. Payment nonce/verify/KV/webhook changes excluded. |
| 13 review3 | QA URL overrides require explicit QA build; no production override. Payment restore/D1/economy changes excluded. |
| 14 review4 | Payment restore/refund/webhook/Render proxy changes excluded in full. |
| 15 review5 | Wallet sync and server-authoritative issuance deliberately excluded; no client-side balance or grant equivalent added. |
| 16 review6 | SQL/ledger/reversal/refund/reconcile/SKU payment stabilization excluded in full. |

## RED → GREEN evidence

New checks were run before their corresponding implementations. Local command output is retained under `.git/muse-qa` or earlier implementation session outputs, not fabricated assertions.

- `check-muse-performance.mjs`: real GameScene update prefix advanced 10000ms instead of 50ms; now clamps simulation while the quality governor observes the raw frame. DPR contracts exercise all bake factors/logical dimensions.
- `check-muse-collection.mjs`: initially absent module; threshold, repeated finish/reload, invalid/future schema and locked skin cases now pass. Subsequent real-catalog negative checks caught unreachable five-evolution goal (campaign has three) and unknown mutation IDs; corrected to five known standard mutation types. Calendar checks caught absent actual visited-day history; 31-day bounded history now records visits without inventing missing dates.
- `check-muse-telemetry.mjs`: absent auto-track disable attribute was `null`, expected `false`. Umami named events include default browser metadata, so manual complete payload uses fixed `/ofeliya` URL/title, sanitized allowlisted values, no launch query/hash/referrer/identity. Script errors clean handlers and allow retry.
- `check-muse-tma.mjs`: missing safe-area seam first failed, then merge/version/lifecycle cases passed. Additional throwing-consumer check failed with `consumer failure`; inset callbacks now reuse the guarded viewport handler.
- `check-muse-theme.mjs`: missing theme module first failed, then dark/light/MAX transfer and cleanup contracts passed.
- `check-muse-juice.mjs`: target destroy during reveal retained one shutdown listener (expected zero); destroy now stops the effect and removes exact listeners. Existing completion/shutdown/reduced/quality/reentry cases pass.
- Chromium: missing Codex collection control first failed; real touch navigation/gallery/lab now pass. Missing Game close-confirmation hook initially returned undefined; actual host pause/manual pause/finish cleanup now pass. Huge frame, cosmetic body radius and duplicate finish assertions use the actual GameScene.
- Browser checks also cover delayed SDK after expired waits, concurrent load/error retry, multicast detach/adapter transfer, CTA bounds and repeated manager teardown. A Menu resize intentionally restarts Menu and destroys its overlays; tests respect that real lifecycle instead of assuming an overlay survives restart.

Privacy rationale: [Umami tracker configuration](https://docs.umami.is/docs/tracker-configuration) and [tracker functions](https://docs.umami.is/docs/tracker-functions). Complete custom payloads avoid default URL/referrer fields. Optional script readiness never blocks boot; stalled optional script readiness can remain pending, with analytics disabled by default.

## Independent review

Luna implemented isolated modules and cross-reviewed collection/telemetry/TMA integration. Confirmed unreachable mutation criterion and optional telemetry default-metadata concern were independently verified and fixed. Final read-only review confirmed the tween target-destroy leak; regression is RED/GREEN. A proposed missing Menu visit hook was disproved against current dirty source and withdrawn; it is not counted as a defect. Final corrected review found no confirmed material terminal-persistence or telemetry privacy issue.

MiniMax CLI 1.0.28 had valid local OAuth. A bounded review received only Telegram loader/facade diff and necessary contracts. The valid request returned `stop_reason=max_tokens`, 6000 output tokens (5999 thinking), no final text. **MiniMax review is incomplete, not approval.** Local raw evidence remains `.git/muse-qa/minimax-review.json`. Additional independent validation uses real Chromium load/error events and shipped scenes, separate from VM contracts.

## Validation and delivery

Sequential local and exact-head hosted results are recorded below after the final checks. No existing assertions, timeouts, thresholds or mutation controls were weakened.

## Remaining limits

- Physical Telegram/MAX WebView, OS keyboard/safe-area transitions, native close dialog, background process eviction and device visual acceptance remain NOT_RUN. Synthetic SDK Chromium contracts cannot prove native implementation behavior.
- Cosmetic state is local, separate from existing game saves, and is not a server-authoritative wallet. Clearing browser storage clears collection; cross-tab simultaneous writes are not transactional. Processed run IDs remain retained for lifetime idempotence and can grow over long play histories.
- UTC calendar uses device UTC days only for local observations, without payout. Existing server Daily authority is unchanged. Existing quest UTC/day-boundary follow-up Issue #237 remains a separate gate.
- Optional Umami is default-disabled; no production tracker or new environment secret was configured. Theme accepts dark Telegram backgrounds only and restores previous styling after teardown.
- No release readiness or device acceptance claimed. NO MERGE / NO DEPLOY.

## Local configuration and checks

No environment files were changed. Collection, skin gallery and enhanced juice default on; telemetry defaults off. QA builds may explicitly set `VITE_QA_TOOLS=1` and use only the known cosmetic query keys `flag.collection.enabled`, `flag.skins.gallery`, `flag.juice.enhanced`, `flag.telemetry.web` with `true`/`false`. Production ignores these query overrides. Optional analytics additionally requires explicit `VITE_UMAMI_SRC` (HTTPS) and `VITE_UMAMI_WEBSITE_ID`; `VITE_UMAMI_ENABLED=1` enables it independently of QA. No identity, URL query/hash or arbitrary event/property values are forwarded.

Local sequential results to this point:

| Command | Result |
| --- | --- |
| `npm.cmd run test:muse-client` | PASS all six focused contract scripts, including follow-up RED/GREEN fixes |
| `npm.cmd run test:quest-core` | PASS |
| `npm.cmd run test:quest-runtime` | PASS persistence/resume/duplicate/UTC/terminal/restart/throttle |
| `npm.cmd run test:quest-core-mutations` | PASS 86/86 caught, 1 unchanged control, Asia/Tokyo |
| `npm.cmd run test:quest-scenes` via controlled local Vite | PASS actual GameScene/Enemy/Gem/choice/damage/end and board x10 at 320/390/768/1080; pre-existing evidence PNG bytes restored |
| `npm.cmd run test:telegram-tma` | PASS original contracts plus six late-loader cases |
| `npm.cmd run test:telegram-runtime` | PASS |
| `npm.cmd run test:viewport` | PASS |
| `npm.cmd run test:telegram-share` | PASS |
| `npm.cmd run test:save` | PASS |
| `npm.cmd run test:rng` | PASS RNG/checkpoint |
| `npm.cmd run test:presentation` | PASS art/VFX/atmosphere/audio/biological animation+impact/boss/recovery/social contracts |
| `npm.cmd run test:impact-budget` | PASS |
| `npm.cmd run test:runtime-quality` | PASS |
| `npm.cmd run test:language` | PASS |
| `npm.cmd run test:analytics` | PASS existing authenticated client contract |
| `npx.cmd --no-install tsc --noEmit` | PASS |

**Additional local startup gate failure (not hidden):** `npm.cmd run test:startup` twice failed its pre-existing font test's splash assertion after 900ms. No deadline/assertion/source was changed. Diagnostic marks show fonts timed out in about 711ms, then Phaser construction ~249ms and texture creation ~120ms; splash subsequently disappears and Menu becomes ready. An in-memory Vite baseline probe serving the unchanged source from PR #236 head `77fd22b` reproduced the same assertion (Phaser ~206ms, textures ~135ms). This is a local baseline timing failure, not evidence that fonts remain awaited forever, and is not counted as PASS. Hosted exact-head startup remains an independent required result. Raw probe scripts/logs remain local under `.git/muse-qa`; the repo startup test is unchanged.

Additional final local gates: `npm.cmd run test:review-browser` PASS all platform/Muse/Daily/startup-error scenarios, including SDK arriving after timeout in an active game; `npm.cmd run release:check` PASS with synthetic CI identity/config only; `npm.cmd run build` PASS; `npm.cmd run test:bundle-shape` PASS; `git diff --check` PASS. Pre-commit build used the then-current Git label `34b08c5` on the dirty integration tree; this is compilation evidence only, not an immutable release artifact. Exact committed SHA is checked by hosted CI and the final handoff.

New integration/repair files: `.github/workflows/ci.yml`, `package.json`, `scripts/check-muse-collection.mjs`, `scripts/check-muse-juice.mjs`, `scripts/check-muse-telemetry.mjs`, `scripts/check-muse-tma.mjs`, `scripts/check-muse-theme.mjs`, `src/game/Player.ts`, `src/game/collection/ClientCollection.ts`, `src/main.ts`, `src/platform/GameHostLifecycle.ts`, `src/platform/TelegramPlatform.ts`, `src/platform/TelegramTheme.ts`, `src/scenes/GameScene.ts`, `src/scenes/MenuScene.ts`, `src/scenes/UIScene.ts`, `src/systems/AnalyticsClient.ts`, `src/systems/ClientExperience.ts`, `src/systems/OptionalWebAnalytics.ts`, `src/ui/ClientJuice.ts`, `src/ui/CollectionBoard.ts`, `tests/muse-client-browser.mjs`, `tests/platform-lifecycle-browser.mjs`, `tests/review-regressions.mjs`, this report and the implementation ledger. Earlier logical commits add the phase-0 art/performance contracts, collection/flags/TMA/juice modules, plus unchanged provenance replays of #233/#236; the PR Files view provides the complete combined-base diff.

## Follow-up regressions before final CI

First hosted CI on `3dad8b6d7a40b0bd5b0f16c7e4f98ad5b776f5a4`: [40130492493](https://github.com/timoshinoleg-eng/ofeliya/actions/runs/40130492493). Build and production-contract passed, including the new focused scripts. Browser startup/font contracts passed on Ubuntu. Browser-smoke then **failed** unchanged `test:art-startup`: critical mutation canvases were 128px under DPR1, while late recovery's exact packaged-pixel contract requires 256px. This was a real compatibility regression introduced by adapting all core art. Fixed `artSourceFactor` to retain factor4 for the three critical mutation emblems only; actor/biological animation art remains DPR-adaptive. Added a focused all-DPR invariant, observed RED `2 !== 4`, then GREEN. Existing startup/art tests and their thresholds were not changed. Full `test:art-startup` subsequently PASS: available/missing/stalled/Android-stalled plus actual Canvas and WebGL late recovery, same texture/source identity and exact packaged pixels.

A further Chromium negative test at **320×474** reproduced the last skin button overlapping Close. Collection now derives page size from available height for both goal and skin tabs, keeps all four skins reachable through paging, and compresses lab branch spacing above its status. Expanded real-touch browser suite passed with the exact non-overlap/reachability assertions. Existing Menu resize semantics intentionally destroy the open board through scene restart; the browser check verifies cleanup, then reopens at the new size. No extra resize handler is needed. Independent Luna review confirmed the compact paging math/cleanup; a proposed missing resize listener was rejected against the existing Menu restart contract.

Release Visual Matrix [40130492469](https://github.com/timoshinoleg-eng/ofeliya/actions/runs/40130492469) and Density QA [40130492486](https://github.com/timoshinoleg-eng/ofeliya/actions/runs/40130492486) passed on the first SHA. They do not substitute for CI on the follow-up SHA. Final exact-head run links/results are maintained in Draft PR #240 and the final handoff to avoid a self-referential documentation commit loop.
