# Daily mutator P0-3 handoff — 2026-10-12

Daily runs now carry one authored global mutator per calendar day (branch
feat/daily-mutator-20261012, PR to main). Pool of 6 in src/game/DailyMutator.ts —
dense-swarm, frenzy-blood, iron-sheath, sparse-lethal, cardiac-stress, elite-surge —
each only re-combining existing DifficultyProfile knobs. Choice is a pure FNV-1a
hash of the server ticket dateKey: identical worldwide, zero runtime RNG (audio has
no RNG to borrow; determinism via seed/hashes only). Presentation reuses the
RunMilestones banner path in GameScene; SocialHub daily button shows today's line
via todayDateKey(). Donor: ricardo-foundry/canvas-vampire-survivors src/daily.js
(MIT, pinned v2.8.0) — recorded in THIRD_PARTY_NOTICES.md; their history/streak
already lives in DailyHistory, not re-imported.

Ruleset bumped 2 → 3 on both sides (server CURRENT_RULESET_VERSION, client
SCORE_RULESET_VERSION; CampaignVersion stays 2). Server stamps tickets v3 and the
daily submit rejects ruleset mismatch with 422, so cached v2 clients fail closed
without a capability flag. RunCheckpoint.validateRunCheckpoint accepts legacy v2
checkpoints (additive change: ordinary runs carry no mutator state, simulation
identical), rejects v1; scripts/check-checkpoint.mjs asserts v2+v3 valid, v1 not.
All test fixtures that simulated the current ruleset moved 2 → 3 (server/test.mjs,
tests/server-policy.mjs, check-daily-v2.mjs, check-daily-cta.mjs,
check-score-outbox.mjs, check-social-client.mjs). New gate:
scripts/check-daily-mutator.mjs (test:daily-mutator) — pool shape, determinism,
apply semantics (no input mutation, add-deltas from zero base), client/server
version parity.

Known pre-existing failures untouched: ui-readability-smoke #187, browser-smoke,
mobile-layout-matrix. QA-only workspace artifacts (qa-*.cjs, visual-qa/, logs,
session-brief.txt) are not committed. Unrelated uncommitted working-tree changes
from the 2026-10-08 security review (CORS allowlist, TRUSTED_PROXY_HOPS, referral
self-check, duel flush, boot-failure reporter) were deliberately left uncommitted
and unstaged — they belong to a separate PR.

Next per roadmap: P0-4 STANDARD elite modifier.

# Free backup and BI follow-up - 2026-10-12

All remaining Cloud.ru paid VMs/disks/IPs, both Quiz backups and two registries
were subsequently deleted with owner confirmation. EvoClaw Lili is stopped.
OFELIYA production remains Render Free with Supabase remote state.

A private gzip snapshot (store/profiles/tg_users) was uploaded to the existing
standard S3 bucket, downloaded and compared exactly. Latest verified revision
28; SHA256 a6cc54bbaad3d5eefa8a596899d7d05a083d0d51790232a42f025b1a5c7bf72d.
Bucket usage is about3.7MB, below the current15GB organizational free tier.
Public bucket access is disabled. No new VM/IP/registry is required.

Owner approved daily Windows backup at20:00 Europe/Moscow, task
OFELIYA-S3-DailyBackup. Trial task exited0 and verified a fresh snapshot.
It requires this computer and a logged-in Windows session; missed runs start
when available. Local work/s3-backup.mjs rejects multiple buckets, truncated
listings, total storage above100MB and backups above2MB. Secrets stay local.

Managed BI service activation remains pending in Cloud.ru. Official API says
Product evobi not active; no BI instance or paid database/SNAT was created.
Do not create paid dependencies: owner authorized only free use. CSV upload
requires an existing database; direct external sources require network review.
Aggregated CSV and offline HTML preview contain no player identifiers. They
represent551 stored events and4 actors, not a current telemetry acceptance test.

# OFELIYA Render production cutover - 2026-10-11

Canonical URL remains https://ofeliya.freeveol.dpdns.org/ofeliya/.
Production now runs on Render Free service srv-db5ro5vlk1mc73b0v0eg
(ofeliya-game, owner tea-d8iruouq1p3s73f30a90, Frankfurt), tracking main
with checksPass automatic deployment. Verified runtime release: d92325b1c83259fbbebd4e02331826fd98982a5e.
PR190 restores the dedicated MAX webhook; PR191 proxies /ofeliya/api/*
to the internal API, preserving game-relative requests and the Telegram webhook.

Canonical HTTPS, release hashes, all54 public files, health, signed MAX/Telegram
profiles, daily/friends/referral reads, both protected webhook handlers and
Telegram prepared sharing passed. Existing67 scores remain in Supabase remote
state; restart verification restored them with persistence healthy. Both bot
identities, Mini App links, canonical webhook URLs and secrets are retained.
Browser menu/start/mutation passed without console errors. Synthetic signed and
webhook checks are not actual Telegram/MAX device acceptance or a real /start.

Cloud.ru chatgpt-ofeliya-1 (32488dbc-e3e1-45f2-97f4-0249fdc8fd11), its
30GB disk dfef9b54-a44b-477b-838e-374eec72e0c5 and public IP resource
c7dc7d8b-d494-4f14-ac68-7261bdf2a8ac were removed after stopping the VM
and rechecking canonical Render. Each GET now returns404. Other three VMs,
disks, addresses and two Quiz backups were preserved. This does not assert
zero account-wide Cloud.ru charges; unrelated paid resources remain.

Render Free idle cold starts remain a platform limitation. No keepalive bypass.
The previous ofeliya-telegram Render preview belongs to another inaccessible
workspace and is not production. Global memory and production secrets are not
in this repository. Prior PR189 historical status remains unmerged.

Next verification: real Telegram/MAX /start, Mini App gameplay and save/reopen
on the owner's devices. Historical Cloud.ru instructions below are archived
context, not current deployment targets. See PROJECT_IDENTITY.md and deploy/RENDER.md.


Render build filters ignore only `memory/**`, `PROJECT_IDENTITY.md` and
`deploy/RENDER.md`; documentation updates do not redeploy the runtime.
The retired Cloud.ru deployment workflow is disabled.

Supabase state access key was rotated in the existing Free project. The new
Render uses the replacement; the old key returns401 for read and writer claim,
so the inaccessible preview cannot steal production persistence. A 24-hour
management token was scoped only to this project and Edge Functions. No keys
are committed. Main CI38158081443 passed all three jobs for runtime d92325b.

## Historical notes

# OFELIYA Render cutover continuation - 2026-10-11

Branch codex/render-cutover-completion-20261011 mounts the existing dedicated MAX
bot handlers on the Node hosting gateway without polling or changing subscriptions.
Dedicated MAX credentials are mapped to score/profile authentication. New real
HTTP webhook authentication, /start and gateway/profile tests run in server:test.
No gameplay, score version or campaign changes. See deploy/RENDER.md.

Live Render release: fb54e0b4b71d51cea143f1e4b5546e3ffc123fab. Health reports
remote persistence healthy, revision8,67scores/551analytics events. All54 checked
public files match; six text files differ only in Windows CRLF vs deployed LF.
HTML/runtime-config/service-worker hashes exactly match the public release marker.
Browser menu/start/mutation reached; this is not messenger/device acceptance.
Unauthenticated Telegram webhook returns403. MAX webhook returns405 because it
is not mounted in the current deployment. This correction is NOT deployed yet.

Cloudflare record d685ca1fcef5dbcf8f5167f54552dc1a still points canonical domain
to176.108.241.28; old public release a1e540c49225d9b627f44c291e5a67f3f27c49e7.
Existing Render key belongs to tea-d8iruouq1p3s73f30a90; OFELIYA service
srv-db5oaad9fdbs73dic4fg belongs to tea-d3efqm15pdvs739533i0.
User said they signed into another Render account; available browser remained at
GitHub two-factor verification. User was asked to complete it themselves; never
request OTPs in chat. Direct SSH to old VM timed out; bastion key auth failed.
No DNS, production secret, webhook, subscription or Cloud.ru resource changed.

Local75server tests, durable restore/fencing checks, MAX bot checks, hosted HTTP
/start/authentication/gateway/MAX-profile tests, Telegram runtime/bot policy,
identity isolation and TypeScript passed. Hosted CI and deployment remain pending.

User permits leaving old player data behind. Complete domain binding/TLS, main
deployment, both messenger credentials/bots and durable restart checks before
retiring OFELIYA Cloud.ru resources. Preserve unrelated workloads. Prior PR189
archive/status notes remain unmerged. Secrets stay outside git.

## Previous handoff

# OFELIYA Render migration handoff — 2026-10-11

User authorized migration to Render Free and subsequent removal of paid Cloud.ru
resources after preservation/verification. BotKeep is blocked by503capacity.
Branch codex/render-migration-20261011 adds one Node hosting entrypoint and durable
snapshot adapter. Supabase project gihizzpuzcuctitvwavz is restored under a verified
free org; private state schema and authenticated Edge Function are deployed, with
an initial67scores/4profiles snapshot. Final cutover/export has NOT occurred yet.
Read deploy/RENDER.md. No gameplay, ruleset or campaign changes. Existing75server
checks and durable unit checks pass. New Render deployment, final capture, domain/
Telegram switch, restart verification and Cloud.ru deletion remain pending.
Secrets remain outside git; never expose production.env or state key.

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

## Mini-boss P0-2 handoff — 2026-10-12

Branch `feat/anomaly-prime-20261012` off main (5ceb9402). Mini-boss АНОМАЛИЯ-ПРАЙМ
(bloodstream, atMs 150000) and КАРДИАЛЬНАЯ АНОМАЛИЯ (heart, atMs 80000). New clean module
`src/game/AnomalyPrime.ts`: MiniBossDefinition, two-phase pacing (phase 2 below 55% HP,
faster telegraphs/strikes/cooldowns), strict radial-burst ↔ charge-dash alternation (no RNG),
vulnerability windows (telegraph ×0.9, recovery ×1.3), schedule validation
(validateMiniBossSchedule vs wave events + boss window, called from StageDirector),
restore derivation miniBossSpawnedByStageTime. Enemy kind `anomaly` (config ENEMY_DEFS,
purple), Enemy.ts behaviour branch (aura, telegraphs via combat telegraph primitives only,
velocity-override charge commit guard ≥70px), WaveDirector.updateMiniBoss (suppresses wave
events while anomaly lives, threat cost 2.5, snapshot flag anomalySpawned),
GameScene announceMiniBoss/onAnomalySpawned/onAnomalyPhaseChanged/triggerAnomalyBurst
(full player-damage pipeline)/onAnomalyDefeated (12 gems via `loot` stream), checkpoints
suppressed while anomalyInProgress. RNG: additive stream `anomaly` (position only); attack
alternation deterministic; validRng tolerates missing streams so legacy checkpoints restore.
New gate `test:mini-boss` (scripts/check-mini-boss.mjs). check-stages.mjs synthetic fixtures
now set miniBoss: undefined (spread stages kept real miniBoss otherwise). No new analytics
events (ProductEvent is a closed server contract). Gates green: tsc --noEmit, check-stages,
check-wave-events, check-mini-boss, check-rng, check-checkpoint, audio-mix 20/20.
Donor: giovanneluna/poke-survivors EnemyBehaviors.ts (MIT) — Math.random/tween-tint NOT
reproduced; recorded in THIRD_PARTY_NOTICES.md. Pre-existing main failures unchanged
(ui-readability-smoke #187, browser-smoke, mobile-layout-matrix). Merge only after explicit
owner approval. Next: P0-3 per roadmap.

## Wave events P0-1 handoff — 2026-10-12

PR #193 (`feat/wave-events-20261011`) opened; merge conflict with main resolved manually
(package.json + 00_HANDOFF.md taken from main, wave-events additions re-applied).
Authored wave events: WaveEvents.ts (encircle/flank-wedge/swarm-surge + validateWaveEvents + pendingWaveEventIndex),
3 events per stage in StageDefinitions, WaveDirector.updateWaveEvents/fireWaveEvent via new RunRng stream `wave-event`,
RunCheckpoint optional `waveEventIndex`, GameScene.announceWaveEvent telegraph (drawRadialCombatTelegraph, depth 13).
Gates green on exact remote state (verified byte-identical via blob SHA): tsc --noEmit, check-wave-events, check-stages,
audio-mix 20/20, check-rng, check-checkpoint. Fixed mid-flight: an earlier push had corrupted completeBossDefeat guard
(BOSS_DEFEATED -> BOSS_ACTIVE) and once pushed an empty StageDirector.ts; both corrected, final blob ddbd732c.
Donor: giovanneluna/poke-survivors (MIT) recorded in THIRD_PARTY_NOTICES.md. Pre-existing main failures unchanged
(ui-readability-smoke #187, browser-smoke, mobile-layout-matrix).
