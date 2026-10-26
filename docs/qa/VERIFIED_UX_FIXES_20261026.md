# Verified onboarding and touch UX fixes — 2026-10-26

Branch feat/verified-ux-fixes-20261026, based directly on fetched main ce8ecb84ced1afa09870f2f00f9a0328257fd11c. Not based on MiniMax EASY. Runtime ownership excludes difficulty/profile tuning, difficulty selector, score semantics, analytics PR247, server/bot/webhooks and deployment.

## A. Root cause and RED

GameScene intro/achievement and RunMilestones independently occupied the same screen band as UIScene tutorial (center158, panel126..190 at390×740). Scene ordering overrides local depth, so raising depth cannot arbitrate. Actual browser baseline RED: startup and tutorial simultaneously visible; music target52×13 versus TOUCH.min44. Logs red-notifications.log and red-footer.log retained locally.

## B. Arbitration

New run-owned NotificationRegion: one active system surface, FIFO queue, per-run logical-key dedup, stale-completion guards, suspension and terminal cleanup. Tutorial presentation temporarily yields while the region is occupied; tutorial state/input/progression rules are unchanged. Startup, achievements and milestone banners use it; UI context hints, modals, boss reveal, paused/background state suspend surfaces **and their display time**, not gameplay. Game clock remains authoritative. Startup survives its opening mutation instead of being permanently cancelled. Existing context hints retain priority. Stage reset atomically cancels obsolete stage banners; result/shutdown discards run-local surfaces, with achievements still retained in result data. No old queue leaks into retry.

Reduced motion keeps new achievement/milestone translation static; decorative milestone pulse is suppressed. No animation package or renderer added. First mutation XP/timing/pool and tutorial completion semantics are unchanged. In particular, the previously observed step4-on-open behavior is outside this sprint and remains unchanged.

New tests cover startup+step1, all5 steps with achievement then authored immune response, duplicates, eventual delivery, stale callbacks, context/boss/mutation suspension, background/resume, result boundary and both motion modes. Comprehension regression now requires intro retained-but-hidden, rather than permanently destroyed; host teaching must still have no overlapping startup surface.

## C. Footer

FooterTouchTargets measures actual text, sets custom Phaser hit rectangles explicitly (setInteractive alone only enables an existing input), minimum44×44. Recomputes after volume/mute text changes; wraps only when measured widths cannot fit. Five utilities keep their order, fonts and visual role. Legal/support and diagnostic version gesture share a bottom row with disjoint44px-high targets. On compact resume layouts the utility band clears the existing new-run control; Phaser's safe canvas remains the boundary. Difficulty selector/CTA hierarchy not edited.

Actual touch at expanded target edges outside visible labels exercises music, sound, effects, Summary, Codex, legal and the5-tap diagnostic gesture. Full volume cycle, both mute states, disjoint bounds and valid checkpoint resume are checked at320×568,390×740,768×1024,1080×1920. New regression scripts are wired into CI and capture upload; not merely local tests. Old synthetic unit assertions requiring hit height to equal tiny text height were replaced by real-Phaser geometry/action coverage.

## D. Compact result HUD

**NO_CHANGE.** Focused320×568 Canvas and WebGL review retains95% scrim. Background timer geometrically lies behind the two-line title, but only a faint contribution remains and foreground glyphs are readable. No concrete new readability regression demonstrated. Header/frame/HUD opacity/layout unchanged. Local result-hud-review.json and paired PNGs capture the decision; this is a focused visual judgment, not a human study.

## E. Validation

Evidence directory (untracked): evidence/verified-ux-20261026/.

- RED baseline notification overlap and13px music target.
- GREEN notification queue unit + ordering browser (5steps, both motion modes, context/boss/modal/background/result/startup-resume).
- GREEN footer geometry matrix (4sizes ×2motion) and real-action fresh/resume matrix (4sizes, all7controls, volume/mute cycle).
- GREEN onboarding, presentation, integration visual contracts/browser, review-browser, startup/viewport/renderer, TMA, viewport math, reduced motion, control/multitouch, mutation choice integrity, result real-touch/checkpoint reload, comprehension across6mobile sizes, TypeScript and diff check.
- Gameplay guards: difficulty, pacing, duel, save, RNG/checkpoint, Daily v2 and Telegram runtime pass; protected runtime files show no diff.
- Production build PASS with explicit40-character release SHA; final committed HEAD is rebuilt and hosted status recorded in delivery/PR. No deploy.

An initial resource-constrained attempt failed with Windows native/esbuild out-of-memory; initial startup font assertion also failed. After memory pressure cleared, sequential review-browser and full startup passed without startup code/test changes. Initial failure messages are preserved in infrastructure-incidents.md and raw ordering.log; final suite logs are separate. Original review-browser/startup log paths were reused by final runs; no claim that their original full logs survived. No pre-existing flake repair was added. Legacy local browser scripts with hardcoded5173 are executed through an untracked adapter substituting localhost5190 and allowing bundled Chromium on Windows; assertions are unchanged. New tracked scripts support an explicit base URL and system Chrome on Linux CI.

## F. EASY independent review

See EASY_CONTRACT_REVIEW_20261026.md. Latest independent source review is PR248 c615ab7d26d92ef162485c2fed0f46a54ce40a9a. The earlier fresh-EASY share-label P2 is resolved there: shared run-mode label now names EASY correctly. No remaining confirmed product defect in this source review. Standard/harder tuning, unranked score allowlist, Standard-only duels, Daily Standard, checkpoint compatibility and retry identity hold by source. Its hosted checks passed separately; signed adversarial HTTP and physical Telegram/MAX behavior were not independently executed. No EASY branch edits or merge approval.

## G. MAX freshness

See MAX_FRESHNESS_REVIEW_20261026.md. Shared validator server/index.mjs447/469 accepts24h for MAX andTG. MAX docs recommend1h. Narrowing the shared literal would alter Telegram too. Long-running/paused MAX sessions, checkpoint returns and delayed score/outbox flows can carry old authentic launch data; compatibility-neutral hardening is not established. No validator patch in this UX PR. Separate recommended platform-scoped design/test matrix supplied, with no signature/dedup/token fallback weakening. No new analytics events are necessary for either UX fix and none added.

## H. Change boundaries

Runtime: src/ui/NotificationRegion.ts, FooterTouchTargets.ts; GameScene presentation/lifecycle wiring; UIScene presentation visibility; RunMilestones presentation; MenuScene footer only.

Tests/CI: notification-region unit; verified-ux, notification-ordering and footer-actions browser scripts; updated comprehension and integration-visual contracts; CI hooks/artifact paths. Assessment docs and repository handoff/state/decisions/backlog carry review/validation context. Evidence, downloaded PR diff and scratch runners remain untracked and are not committed.

## I. Delivery gate

Independent read-only source review resolved the intro-cancellation and missing-CI coverage findings. No remaining confirmed product issue in the reviewed UX source; executable browser verification performed by primary agent. Draft PR only after local gates; final HEAD and exact-head hosted check results reported separately. No merge/deploy authority inferred.

Safety: no difficulty changes, no Standard balance change, no analytics changes, no EASY branch edits, no production changes, no deploy, no merge.

CI follow-up: first hosted run40289925830 failed in the Daily source-extraction fixture because notification-region initialization had been inserted into its gameplay-only create-prefix. Reproduced locally RED; moved presentation initialization beside RunMilestones, after that prefix, without changing difficulty code or weakening assertions. Daily gate GREEN. Full build-job gates and notification ordering rerun before follow-up delivery; hosted final status belongs to the exact delivered HEAD.
