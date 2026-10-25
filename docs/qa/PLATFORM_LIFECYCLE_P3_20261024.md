# OFELIYA Patch 11 — platform lifecycle P3 — 2026-10-24

Isolated clone: `C:\Users\Имярек\Downloads\ofeliya-platform-p3-20261024`.
Branch: `fix/p11-platform-lifecycle-p3-20261024`.
Base: `qa/ofeliya-muse-quests-staging-20261023`, verified remote/local SHA `5a2e04332ee3bc03b9683ef29543b81d121490bd`.
Working tree was clean before edits. PR #233 and its branch were not modified; remote F5 head remained `54067dc5a4f7d9442d2ffc774ce2874bcde1ad03` during final scope verification.

## Causes and fixes

- Issue #234: each caller installed load/error handlers on the same script. A timeout settled its promise but retained a load callback that announced readiness again. One script now owns one load/error pair and a set of active waiters. Each caller retains its own deadline and removes its waiter on timeout; the shared late-load listener remains. Success/error removes both DOM handlers. Error removes the failed tag so retry creates a fresh request. Ready is deduplicated by the actual WebApp object using a WeakSet, including synchronous reentrant probes; a replacement WebApp can announce separately.
- Issue #235: the facade stored one callback, so B replaced A. Each registration now owns a Set entry and an idempotent detach closure; one host subscription fans out to all registrations, isolates callback exceptions, survives adapter transfers and detaches when the Set becomes empty. Browser/MAX continue to use their existing resize/measurement behavior; no invented MAX event API was added.
- ViewportManager: repeated start previously overwrote its detach closure and retry timer. Start is now idempotent, destroy invalidates in-flight sync and blocks subsequent sync until restart, and retry clears its timer reference.
- Actual Chromium resize exposed an additional cause of clipped frames: Phaser RESIZE refresh reads cached `parentSize`, so calling resize immediately after changing host CSS could restore the old dimensions. The manager now refreshes parent bounds before resize. No renderer/config/UI changes.

BackButton, haptics, sharing and concrete Telegram/MAX adapters are unchanged. No quest/Daily/Stars/server/payment/reward/user-data changes. `memory/*` was not rewritten.

## RED evidence before fixes

On base source, new negative tests were added before production edits:

- `node scripts/check-telegram-late-loader.mjs`: exit **1**. Concurrent 8ms/25ms waits both expired, then one late SDK load emitted **2** events, expected **1**. A load while the longer waiter remained also emitted 2. Concurrent error left **2** counterpart handlers, expected **0**.
- `node scripts/check-telegram-tma.mjs`: exit **1**, facade A/B notification delta **[0,1]**, expected **[1,1]**.

After these fixes, the new real browser test independently failed before the parent-bounds repair: `npm.cmd run test:review-browser`, exit **1**, waitForFunction timeout at the unchanged 30000ms ceiling. Diagnostic state: CSS host height **600px**, Phaser and Menu scale **640px**, one Telegram viewport handler, no page errors. The exact 600px assertion passes after refreshing parent bounds; the timeout was not increased.

## GREEN validation

Dependencies: `npm.cmd ci --offline --no-audit --no-fund`, exit 0, 46 packages.
Checks were run sequentially, with no test assertions/timeouts/thresholds removed:

| Command | Result |
| --- | --- |
| `npm.cmd run test:telegram-tma` | exit 0; original TMA contracts plus multicast/transfer/reopen/manager cleanup; loader **6/6 PASS** |
| `npm.cmd run test:telegram-runtime` | exit 0; runtime/launch-hint/link contract PASS |
| `npm.cmd run test:viewport` | exit 0; viewport math PASS |
| `npm.cmd run test:telegram-share` | exit 0; existing prepared-share contract PASS |
| `npm.cmd run test:review-browser` | exit 0; new P11 Chromium scenarios plus all original daily/startup-failure regressions PASS |
| `npx.cmd --no-install tsc --noEmit` | exit 0 |
| `$env:VITE_RELEASE_SHA='5a2e04332ee3bc03b9683ef29543b81d121490bd'; npm.cmd run build` | exit 0, 118 modules; base SHA labels local dirty-tree validation, not an immutable release |
| `git diff --check` | exit 0 |

Build warnings retained: runtime-config.js is not type=module; two Chakra Petch URLs resolve at runtime.

VM tests cover separate caller deadlines, delayed load, network error/retry, counterpart-handler cleanup, replacement SDK readiness, browser/MAX without Telegram launch data, two subscribers/one adapter subscription, A detach preserving B, last detach, throwing subscriber isolation, Browser/Telegram/MAX transfers, multiple managers, repeated start/destroy, restart and invalidated in-flight sync.

Chromium uses real DOM script load/error and the shipped facade/manager, with intercepted SDK/API network and synthetic LocalStorage only. It checks late concurrent SDK readiness once, actual network abort/retry, A/B dispatch, Telegram/MAX/browser transitions, real Phaser and canvas **390x600** after virtual viewport resize, Menu action and lower legal CTA bounds, and no remaining viewport subscription after manager/subscriber cleanup. Reopen is exercised as repeated manager lifecycle; physical Mini App reopen remains untested. Vite/browser are closed by finally blocks.

## Independent MiniMax review

The `codex-minimax-pair` workflow was used. `mmx --version` reported 1.0.28 and OAuth auth status was valid. Only target diff, tests and necessary platform contracts were supplied; no secrets, memory or full repository was sent.

Two M3.1 Flash review attempts (4500 and 12000 output tokens) and one compact M2.7 fallback (8000) returned **stop_reason=max_tokens with no final text**. These are incomplete reviews, not approvals. Raw local responses remain under `.git/p11-minimax*` and are not committed. No unverified model suggestion was applied.

The additional independent local validation is the real Chromium contract suite above, separate from the VM stubs that reproduced #234/#235. Its first failure exposed the actual Phaser parent-cache bug, and it passed after the narrow repair.

## Delivery and limits

First hosted run on `a4c9c84612af6babcaed032d31ae21bc3a109b62`: [40081947705](https://github.com/timoshinoleg-eng/ofeliya/actions/runs/40081947705). Build and production-contract PASS; browser-smoke failed the new action-CTA bounds assertion. Diagnostic scale/host were already 600px. Source inspection confirmed `Menu.onResize` queues `scene.restart()`; the shared ScaleManager changes before the next Menu generation creates its CTA. The browser fixture now waits for the real Menu create event at height 600 before reading CTA objects. It keeps the exact bounds assertion and original 30000ms timeout. Local `test:review-browser` passes with this lifecycle synchronization. This failed first CI run is not hidden or counted as a PASS; final-head CI is tracked separately in PR #236.

Changed files: `src/platform/TelegramBridgeLoader.ts`, `src/platform/index.ts`, `src/platform/ViewportManager.ts`, `scripts/check-telegram-late-loader.mjs`, `scripts/check-telegram-tma.mjs`, `tests/platform-lifecycle-browser.mjs`, `tests/review-regressions.mjs`, this report.

Draft PR targets the QA base only and links Issues #234/#235. Exact head SHA and hosted CI results are recorded in the PR/final handoff after commit; local PASS does not imply hosted CI PASS. No merge/deploy was requested or performed.

Physical Telegram/MAX WebView, keyboard/OS safe-area changes, native close/reopen and device rendering acceptance: **NOT_RUN**. The fixture proves supported event contracts, not all native client implementations. Replacing a WebApp object while an existing Telegram adapter is active is only tested for loader re-announcement; hot-rebinding native adapter visibility/BackButton handlers is outside this patch. No release readiness claim.

**NO MERGE / NO DEPLOY.**
