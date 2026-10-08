# Independent final release fixture review - 2026-10-08

Reviewed actual uncommitted diff in work/release-fixture-fix against main50c47049. No source changes by reviewer; parent handoff branch/memory preserved.

## Confirmed

No Critical/Important finding in this test-only diff. No original assertions or timeouts were removed or widened.

- Legendary test changes only URL configurability and fixture-only Game.update replacement before scene start. It retains actual Game.create, actual UIScene update/clock/tweens, actual choice/card handlers, chooseUpgrade/consumeLegendaryCeremony, ownership checks, modal/blocking checks, the original4s deadline, and actual Scene pause/resume lifecycle assertions. The frozen update prevents unrelated RNA/progression from opening a new mutation modal after ceremony dismissal.
- This isolation is legitimate for the named choice -> Legendary ceremony -> scene resume contract. It does reduce this test's live-gameplay coverage: gameActive/gamePaused verifies SceneManager lifecycle, not that resumed gameplay simulation advances. It must not be described as full live progression acceptance; other gameplay gates retain that responsibility.
- Cardiac test retains real Game.update and the original phase-one absence, phase-two telegraph, beam visibility, exact14damage and cleanup checks with unchanged8s/2s/1.5s deadlines. New state cleanup mirrors production stage-boundary ordering: clear progression first, then dismiss UI. Added unblocked/Game-active precondition strengthens fixture validity.
- Main attempt3 reported by coordinator had modalOpen/uiBlocked true while Game was active and pendingCeremony null AFTER the close wait passed and100ms elapsed. This directly supports a subsequently opened modal rather than a permanently stuck Legendary ceremony; its specific modal text was not captured, so mutation identity is inferred from the source progression path.

## Limits / validation ownership

Only two browser scripts changed; production UIScene/GameScene/hazard logic is untouched. Reviewer did not rerun browsers. Coordinator owns exact-script local results, fresh PR CI and merged-main CI. Existing thresholds should remain. No deployment acceptance inferred from this review alone.

Verdict: approve bounded fixture correction without assertion weakening. Remaining full live progression and target-device validation are outside these isolated fixtures.

## Cardiac clock isolation follow-up
PR182 initial head e1c058e CI37768249337 passed ceremony but failed Cardiac8s. Diagnostic-only14b6d3c CI37769887253 remains running. A local synthetic sparse RAF35ms plus explicit cooldown240 reproduced the timeout: Game active/notpaused/UI clear, boss phase2, stage2649 versus scene16936, nextTelegraph13575 already due, heartbeat3216 safeIndicator true; zero page errors. This demonstrates the mixed-clock scheduling mechanism, not the exact hosted runner conditions (default cooldown120).

Fixture now uses the real heartbeat.restore with nextImpact=stageTime+60000 and bossWasActive=true, with exact60000 setup assertion. Game.update, real Cardiac scheduler and canSchedule, original4700/850/280 source timing,8s/2s/1.5s browser deadlines, exact14damage and heartbeatClear remain. It intentionally does not validate live heartbeat concurrency; unchanged test:pacing separately tests1980/1981 boundary and exclusion. Native exactscript plus paired synthetic stressed fixture PASS; pacing PASS. Independent Codex source review PASS. Additional Kimi OmniRoute review returned empty content and is NOT approval. Await fresh PR/main CI before deploy.

Final pool-reset review PASS: standard deactivateForStageReset disables inherited bullet/gem physics without XP; resetStage and fixture-only hostCells.update prevent new cell rewards. Setup zero-active assertions strengthen the contract. Hosted diagnostics prove progression pause; paired RNA baseline failed/corrected passed. No production/hazard/deadline/damage changes. Scope excludes live RNA/cell/heartbeat concurrency.

## Dense readability fixture lifecycle recovery
Final6c84b89 CI37771605821 passed Legendary, Cardiac and controls, then dense-readability failed target150/cache150 with allalpha1. Enemy preUpdate reads prior density; Game.update refreshes cache afterward. Original fixed150ms sleep need not contain both real frames.

Density fixture now waits two actual Scene POST_UPDATE frames with cache>=target, bounded1500ms, before unchanged150/200targets/alpha assertions. This replaces a synchronization assumption, NOT an unchanged performance/timing gate. No manual Game/Enemy update or cache writes. Startup accepts an already-paused real Game, resumes then clears progression/UI; new unblocked assertion added. Exact native finalscript PASS; original native Game.active-only wait had stopped at startup30s. Paired sparseRAF240ms with shared corrected startup: old150ms sleep failed cache100/target150/allalpha1; completed-frame wait PASS. This demonstrates synchronization sensitivity, not the exact hosted scheduling. Independent Codex source review PASS. Additional Kimi nonstream diagnostic HTTP504; no routed approval.
