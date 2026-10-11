# OFELIYA Render migration handoff — 2026-10-11

PR188 merged after all three CI jobs passed (run38141623083). Main SHA
 dee02a4852d27e10a47d2a6612210f1aaa94f90c. No gameplay/ruleset changes.
Render Free service srv-db5oaad9fdbs73dic4fg in workspace
tea-d3efqm15pdvs739533i0 (aurum1984@ya.ru):
https://ofeliya-telegram.onrender.com/ofeliya/ . Branch remains
codex/render-migration-20261011 until account API access can change it to main.
Supabase free project gihizzpuzcuctitvwavz restores initial67scores/4profiles/
551analytics events; signed Telegram profile and sleep/wake restore passed.
Private state authentication and server-only database privileges are verified.

BLOCKER: existing Render API key belongs to tea-d8iruouq1p3s73f30a90
(timoshin.oleg@gmail.com), not the service workspace. Custom domain/branch
settings require a matching API key or signed-in Render session. Browser shows
sign-in screen. Never expose credentials; do not ask for passwords in chat.
Canonical ofeliya.freeveol.dpdns.org still points to176.108.241.28. Existing
Telegram webhook/menu and Cloud.ru production remain unchanged. Final drain/
export/import, canonical domain switch and Cloud.ru paid-resource deletion are
NOT done. User already authorized these actions after preservation; no repeated
approval needed. See deploy/RENDER.md.

Independent verified backups are saved: ofeliya-migration-20261011.tar.gz
(70,569,845bytes SHA2567d8427945596603ff1bee3520b7a0c1f88228bd6779858a84aadc302fbd2f91a),
quizbattle-migration-20261011.tar.gz including PostgreSQL dump (83,528,245bytes,
SHA25694e76ce50b2b3d0f13d7ee52f3ed0cead8cf72113ffcd9acd779eba7100d1424),
ops-migration-20261011.tar.gz preserves worktree files (674,113,920bytes,
SHA2566a0a5910853e17f31732d62de707e31ce094d70c7151c3e4b12535694f7584f8).
Ops archive excludes reproducible node_modules/.git/cache/.local dependencies.
Do not infer preservation of stopped quiz-battle-web-1 disk or historical
Cloud.ru snapshots from these archives. Inspect those before destructive cleanup.
Cloud.ru AI Agents, Container Apps/Jobs, Foundation Models inference, EvoClaw and
MCP servers show no deployments/charges. Paid VM/disks/IP/backups/registry remain.
Only this session's unused176.123.162.196 IP was released. Preserve free evo-claw
Object Storage bucket. Secrets stay outside git.

## Previous release fixture handoff — 2026-10-08

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
