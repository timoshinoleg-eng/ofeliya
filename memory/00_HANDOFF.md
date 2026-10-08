# OFELIYA review follow-up handoff — 2026-10-09

## Current verified status

Base main is `716292b78c5b2e53485170bcb8a4cc2780f9df04` (PR #182 merged).
GitHub API confirms CI run `37775488149`: build, browser-smoke and production-contract succeeded.
Deploy run `37777242773` succeeded: rollout and public HTTPS parity smoke passed; rollback and
the final failure step were skipped. These are historical deployment facts, not current phone acceptance.
On 2026-10-09 a direct public `release.json` request from the review environment failed to connect;
current public SHA/hash parity is therefore unverified here, not proven down for players.

Working branch: `fix/review-followup-20261009`. Scope: lockfile-only source-map-js 1.2.1 -> 1.2.2,
correct this handoff, and document capacity/acceptance follow-up in
`docs/release/REVIEW_FOLLOWUP_20261009.md`. Validation results and the eventual PR are recorded in
`memory/01_STATE.md`. This branch has not been merged or deployed.

Kimi T4 and T6 are contradicted by this base: scores already cap at 20,000 with a 2,000 verified
reserve; `saveStore()` coalesces writes with default 250ms delay; rollback explicitly fails the
deployment workflow. Rate-limit buckets remain per-process. Keep mobile-evidence fail-closed.

User has Samsung S20+ and reports the latest MAX; numeric Android/MAX versions and real recordings are still pending.
iOS and Telegram device acceptance remain open. Open PR #177 contains run-scoped comprehension
reporting and is not merged; do not describe its report as deployed or modify that branch in this task.
PR #183 is parallel combat presentation work and is outside this follow-up.

Next: inspect this branch's diff/validation, review the PR and run its CI. Separately collect actual
Android evidence, check live release identity, obtain a read-only production capacity snapshot and
verify analytics delivery before observing 5-8 newcomer sessions. Never infer device acceptance
or successful publication from CI, a draft JSON, or these historical workflow results.

## Historical fixture investigation — 2026-10-08

The text below records the pre-merge investigation. Its statements about pending CI/deployment
describe that earlier point in time; the current status above supersedes them.

User explicitly authorized merge/deploy. PR179/180/181 merged preserving branches/history; main50c47049. Required main CI37763374322 failed3attempts before deploy: Legendary close timeout,Cardiac timeout,then subsequentmodal after Legendary close. No deployment performed.

This branch corrects only browser fixture ownership: Legendary freezes Game.update (real UI/clocks/choice handlers/Scene lifecycle retained); Cardiac clears initial progression/UI and retains real hazard updater. All original assertions/timeouts remain; stronger unblocked precondition added. Exactscripts locallyPASS dev5192; independent source reviewPASS. Read docs/visual-overhaul/RELEASE_FIXTURE_ISOLATION_20261008.md and RELEASE_FIXTURE_REVIEW_20261008.md. FreshPR/main CI required, then deploy immutable finalmain SHA through deploy-cloudru.yml and verify publicrelease+hashparity. No HiDPI production activation.

Parent docs/release-handoff-20261008 worktree has four dirty release memory files preserved. MAXAndroid/iOS and Telegram physical acceptance still unverified; full soundtrack/charge/hit/death remain partial. Reviewer confirms source/tests only; do not infer phoneFPS from headless.

## Cardiac clock isolation follow-up
PR182 initial head e1c058e CI37768249337 passed ceremony but failed Cardiac8s. Diagnostic-only14b6d3c CI37769887253 remains running. A local synthetic sparse RAF35ms plus explicit cooldown240 reproduced the timeout: Game active/notpaused/UI clear, boss phase2, stage2649 versus scene16936, nextTelegraph13575 already due, heartbeat3216 safeIndicator true; zero page errors. This demonstrates the mixed-clock scheduling mechanism, not the exact hosted runner conditions (default cooldown120).

Fixture now uses the real heartbeat.restore with nextImpact=stageTime+60000 and bossWasActive=true, with exact60000 setup assertion. Game.update, real Cardiac scheduler and canSchedule, original4700/850/280 source timing,8s/2s/1.5s browser deadlines, exact14damage and heartbeatClear remain. It intentionally does not validate live heartbeat concurrency; unchanged test:pacing separately tests1980/1981 boundary and exclusion. Native exactscript plus paired synthetic stressed fixture PASS; pacing PASS. Independent Codex source review PASS. Additional Kimi OmniRoute review returned empty content and is NOT approval. Await fresh PR/main CI before deploy.

## Hosted progression cause captured and pool reset
Diagnostic-only14b6d3c CI37769887253 failed with Game inactive/paused, UI modalOpen/uiBlocked, awaitingChoice true, stage149ms, bossactivephase2, hazard disabled/serial0 and no errors. This directly proves a new progression choice paused the updater; it does not identify the individual RNA drop. The only ordinary queued-level source is onGemCollected; stage transition was not occurring.

The fixture now uses production-standard deactivateForStageReset for existing bullets/RNA gems, resets host cells and excludes their update/rewards from this beam contract. It asserts zero active bullets/gems. Paired local inherited-RNA100 fixture: baselinef292dc7 paused atstage33ms/queued3/awaitingChoice and failed8s; corrected fixture PASS. Exact corrected script alsoPASS. Thus no onGemCollected/Game.update/hazard method is stubbed, no assertion or timeout is loosened. Host-cell/RNA integration is outside this scoped beam test; other unchanged gameplay/browser suites cover it. Mixed-clock synthetic finding remains separately documented and was not the captured hosted cause.

## Dense readability fixture lifecycle recovery
Final6c84b89 CI37771605821 passed Legendary, Cardiac and controls, then dense-readability failed target150/cache150 with allalpha1. Enemy preUpdate reads prior density; Game.update refreshes cache afterward. Original fixed150ms sleep need not contain both real frames.

Density fixture now waits two actual Scene POST_UPDATE frames with cache>=target, bounded1500ms, before unchanged150/200targets/alpha assertions. This replaces a synchronization assumption, NOT an unchanged performance/timing gate. No manual Game/Enemy update or cache writes. Startup accepts an already-paused real Game, resumes then clears progression/UI; new unblocked assertion added. Exact native finalscript PASS; original native Game.active-only wait had stopped at startup30s. Paired sparseRAF240ms with shared corrected startup: old150ms sleep failed cache100/target150/allalpha1; completed-frame wait PASS. This demonstrates synchronization sensitivity, not the exact hosted scheduling. Independent Codex source review PASS. Additional Kimi nonstream diagnostic HTTP504; no routed approval.
