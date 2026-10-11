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
