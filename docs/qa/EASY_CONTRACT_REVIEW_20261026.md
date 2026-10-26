# EASY mode — independent contract review (2026-10-26)

Base: ce8ecb84ced1afa09870f2f00f9a0328257fd11c. Read-only architecture review; no EASY implementation or branch edits. At initial inspection no open EASY PR was available. Recheck before integration. This document is a review checklist, not approval of MiniMax work.

## Required proof on the eventual exact EASY PR head

| Contract | Current seam / required test |
|---|---|
| Standard unchanged | DifficultyProfile STANDARD_DIFFICULTY and all effective multipliers, wave/boss/heartbeat/threat behavior, starting HP/weapons/XP remain byte/value equivalent; seeded Standard regression before/after. Changes to shared defaults must not silently retune Standard. |
| Harder unchanged | Existing strained profile, elite modifiers, mutators and selectors' routing preserved; compare actual effective parameters, not just labels. |
| EASY explicitly unranked | Add explicit ID end to end. Server index.mjs DIFFICULTY_IDS/normalizeScoreContract must accept intended unranked representation; rankedEligible remains exact Standard-only positive allowlist. Verified identity alone must not imply ranked. |
| No leaderboard contamination | Test EASY result through signed TG/MAX and browser submissions, stored ranked=false and absence from top/daily stats/profile ranked records. Reject a Standard runGrant attached to an EASY result. Preserve old unverified and legacy-score boundaries. |
| No duel contamination | DuelClient.createFixedSeedDuel, server /api/duel creation/attempt contract and run capabilities must remain Standard-only. A fixed-seed EASY result cannot masquerade as a Standard duel. Current duel records already have ranked=false; the requirement is preserving their Standard gameplay contract, not adding ranked EASY duels. |
| Save/checkpoint compatibility | RunCheckpoint.ts:338 currently accepts only standard/strained. New EASY checkpoint must validate and retain EASY through F5/stage transition. Old Standard/strained and legacy checkpoints still load; malformed IDs fail safely. Do not change schema/ruleset versions unnecessarily. SaveSystem/profile preferences and localStorage selection must round-trip EASY, not fall through to Standard. |
| Restart preserves EASY | UIScene result retry normally retains registry difficulty; only duel rematch forces Standard. Test death→retry and win→retry, plus pause/menu→resume, on actual Phaser instances. Both stages retain EASY. |
| Daily unchanged | DailyRunIntent.launchDailyRun explicitly forces Standard and ticket seed. EASY menu selection cannot alter daily intent/ticket/result path, daily difficulty, checkpoint policy or outbox. Return-to-menu behavior must not corrupt saved difficulty preference. |
| Same TG/MAX frontend | No separate difficulty build flag or host-specific balance. Run identical signed-host fixtures and browser cases; platform differences remain in adapters/auth, not effective EASY or Standard parameters. |
| Labels/contracts | getDifficultyProfile/readDifficultySelection currently collapse unknown IDs to Standard; UIScene labels have Standard-versus-Strained ternaries. Every new-ID fallback must be reviewed. No unknown EASY result may be labelled/routed Standard accidentally. |

Relevant current callsites: DifficultyProfile.ts (ID union, get/next/read/write); GameScene.create and resetStage progression; RunCheckpoint validation; RunContracts; SaveSystem.recordRun; UIScene standardFresh/duelCreatable/result retry; ScoreClient.beginRunCapability and buildRunEndPayload; DuelClient; DailyRunIntent; server normalizeScoreContract, resolveRunGrant, ranked eligibility and compare/top filters.

A satisfactory review needs actual exact-head RED/GREEN and hosted checks. Client labels or an EASY smoke alone do not prove ranking isolation. These UX changes do not implement or approve difficulty. MenuScene changes here are confined to footer layout; its difficulty selector block is untouched. UIScene notifications and eventual EASY result labels may share a file but are separate ownership hunks.

## Comparison with actual EASY Draft PR #248

Reviewed exact head **007f3521692e2cb14ce870c3d9583f6c0c6e0b26**, base ce8ecb84ced1afa09870f2f00f9a0328257fd11c, without checkout/branch edits or executing its test claims. https://github.com/timoshinoleg-eng/ofeliya/pull/248 . Independent source reviewer and root separately traced the runtime diff.

| Checklist | Source review result |
|---|---|
|Standard/strained balance|PASS by source: both existing profile objects and gameplay consumers unchanged; no independent seeded execution of PR head claimed|
|EASY unranked/no leaderboard|PASS by source: ScoreClient.ts:401 returns before network/outbox; current server rejects explicit EASY payload with422 (not storage ranked=false); normal capability remains Standard-only|
|Direct signed/server input|Explicit EASY rejected before runGrant resolution; identical token-validation boundary for MAX/TG. Actual signed HTTP adversarial cases not independently run|
|Duels|Client create/attempt and server require Standard; EASY plain result share creates no duel|
|Checkpoint/save|Validator now accepts EASY via isDifficultyId; old IDs remain; checkpoint difficulty wins over registry; Standard/strained clear counters remain gated|
|Retry|Registry retains EASY except explicit duel rematch Standard reset. Actual victory/death/retry on PR head not independently run|
|Daily|Launcher/ticket force Standard; non-Standard daily submission rejected; stored ordinary preference not overwritten by launch|
|TG/MAX frontend parity|No host-specific balance branches added; native/signed runtime cases not independently run|
|Mode labels|**FAIL, P2 below**|

### Confirmed P2: EASY result shared as Strained

PR-head src/scenes/UIScene.ts:2631–2639 retains modeShare's final fallback **Режим: НАПРЯЖЕНИЕ.** For fresh EASY, ranked=false, daily/duel absent and resumed=false, so this fallback is used. Since duelCreatable=false, line2666 sends that text through PlatformBridge.shareResult. Trigger: normal EASY run, defeat or victory, then ПОДЕЛИТЬСЯ РЕЗУЛЬТАТОМ. RunModeLabel corrects on-screen labels but does not cover this share path. This is a concrete label mismatch; no ranking contamination established by it. Not fixed in UX branch.

Coverage limits in PR tests: browser server rejection exists, but signed EASY score/duel requests and Standard-grant+EASY are not established by actual HTTP tests. A clear-counter test invokes recordRun(false,...) for EASY, so its Easy-win wording does not prove win behavior. Server cloud preference allowlist still omits EASY; current migration client does not submit difficulty at all, so a complete cloud-preference round-trip is not implemented/proved. These are qualification points, not invented server exploits.

Disposition: no merge approval; fix P2 and verify exact-head contract/runtime gates in MiniMax branch. No comment/message was posted and no EASY code was edited here.

### Latest-head readback

PR248 advanced to **869aa35808b7e82bad77813f72aa205fb55535c4** during this review. Independently checked delta from007f352: only scripts/difficulty-comparison-smoke.cjs changed; runtime/server diff is empty. The source checklist and share-label P2 therefore still apply to869aa35. New comparison policy steers toward a moving point around initial position with actual-position feedback; old browser outcomes must not be transferred to this new input policy. No updated browser execution was performed here.

## Latest review supersedes earlier open P2

PR248 head c615ab7d26d92ef162485c2fed0f46a54ce40a9a independently reviewed by source. Earlier share-label P2 RESOLVED: RunModeLabel supplies the actual EASY mode; fresh EASY displays ЛЁГКИЙ. Positive score allowlist, Standard-only duel guard and neutral EASY score status are present. Standard/harder tuning and server rules unchanged. Hosted build/browser/production-contract success was observed separately. No new confirmed product defect. Signed Telegram/MAX adversarial HTTP, native retry/F5/stage transitions and latest neutral-status visual fit remain unverified by this source-only review. No merge approval or branch edits.
