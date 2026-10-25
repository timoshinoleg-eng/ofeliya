# PR244 independent final gate - 2026-10-25

Original de6a74afd80607e6df24801a819d7e6cfa60af4f is BLOCK: P2 mutation gate falsely classifies omitted pre-hit flush as equivalent. Real offset streak reaches q_nodmg60; the permitted mutant records59. Narrow tests-only repair on review/codex-pr244-final-gate-20261025; report docs/qa/CODEX_PR244_FINAL_GATE_20261025.md. UTC14/14 +2 equivalent +control passed; exact candidate CI40181931371 is genuinely green but cannot prove the false equivalence. Lifecycle and UTC/units historical RED/GREEN independently reproduced. Keep native memory failures and base-reproduced startup font assertion distinct from product findings. No merge/deploy. Next: Draft follow-up into #244 branch, new exact-head full CI and release decision. Physical native close inconclusive, eviction/MAX NOT_RUN.

---

# Final convergence state — 25.10.2026

#241 5725cbed + #243 5ba7652 + exact #242 cherry-pick3bc9ef5; no changed-file intersection. Lifecycle remains exact#242. Additional confirmed P2: positive reset streak seconds divided as milliseconds, fixed edb8d0d with Runtime regression. UTC anchor v4/rollback-like resume checks pass; actual#241 parser probe preserves known fields and drops optional anchor. See final convergence report and PR for exact validation state.

---

# PR #241 independent gate — 25.10.2026

Review base `5725cbed7ff425aa7789d45d98aeaf730a749361`; original exact-head workflows verified success, tested merge tree equals head tree. Independent host RED/GREEN and ledger eviction evidence are in `docs/qa/CODEX_PR241_GATE_20261025.md`.
Product follow-up only adds resize binding/cleanup to GameHostLifecycle; crossflow now proves restored lifecycle/close confirmation and exact handler removal, rather than comparing a missing handler with itself. Original product RED and patched GREEN retained externally. Full results and remaining gates are in the report; do not infer all tests passed from this handoff.

---

# Quest scene integration — 23.10.2026

На feat/quest-scene-integration-20261023 от 66fc1a9 добавлены локальный typed producer, GameScene события, checkpoint metadata и read-only Menu→Codex→Quests. SaveSystem/Daily/outbox/Player/UIScene/Joystick/physics/RNG/server не изменены. Persistence использует существующие lifecycle listeners. Полная карта, tests/exit codes, screenshots и непройденные browser gates: docs/qa/QUEST_SCENE_INTEGRATION_20261023.md. Физический WebView и hosted CI NOT_RUN. Никаких публикаций.

---

# Stage16 video CI continuation

Stage16 video CI stabilization, 2026-10-20. Tested code 761fc01562165955e0b213bcb1d77b8f135f45f7, base c01a1ec1f0e5b89c4af59b5fae60bee9f89791ee.
Confirmed mixed driver/product timing false positives on unchanged main and combined. Product VideoInterstitial unchanged. Video smoke now separately checks exact requested/controlled-clock3200ms, browser pointerdown to first rendered Game+UI active frame with clock>0 within3900ms (stall2600), shared Playwright wait4300/2800. Full event traces retain transport/startup/timer/finish/create/render/poll phases; driver elapsed remains diagnostic. Raw expected-failure controls: delayed6400 clock and disabled browser cap both exit1 with verified reasons. Five final sequential cap repeats after heavy predecessor passed.
Full available CI browser command set plus strict biological rendered pixels: {'NOT_RUN': 3, 'PASS': 48}; child codes inspected, runner not treated as blanketPASS. Hosted new SHA and optional parallel CI runtime NOT_RUN. Historical HUD cause remains unresolved despite local HUDPASS. Physical SamsungS20+ NOT_RUN; use stage15 acceptance plans. Server product and prior fixture/UI/B2/B4/HUD components byte-identical; server full suite not needlessly rerun (stage15 evidence retained).
Default workflow remains serial browser-smoke25min plus mandatory video clock gate. Separate optional CI branch ci/browser-smoke-split-candidate-20261020 has47 exact gates split21+26, isolated setup/build/Vite/artifacts and fail-closed original browser-smoke aggregator; groups25min, aggregator5min. Optional workflow not executed on GitHub; saved earlier hosted cd861 succeeded16:59, local duration does not prove hosted timeout.
No push, merge, deploy, production or existing PR writes. Do not push combined branch into PR221/222. Publication plan separates Daily server, B2B4/UI, harness/video/CI and four memory histories. Reports external16_VIDEO_CI_STABILIZATION; this docs update retains earlier recorded history.

---

## Previous recorded history (retained)

# Stage15 local integration continuation

Stage15 integration fixes, 2026-10-20. Tested code 2720a2e9dcb226c37be621218508a739030ba0c1 on isolated combined base 2f3f0ee580fd5d6c795ee8e04d91984a6be9d97c.
Harness: pre-first-update XP isolation for mechanic scenarios, real natural mutation/resume gate, true touch video diagnostics, assertions/timeouts preserved. UI: compact gap4px with11/12px floor, reduced-motion Menu and visible static lowHP. Server: exact verified Daily receipt after ticket compaction, owner/platform/run/submission/hash bound, no duplicate score.
Targets24/24 PASS (seven scenarios x3 plus natural x3). Core56 PASS plus initial rollback FAIL from missing local origin/main; after local ref restoration rollback PASS. Full server:test76+all sub-suites PASS. Browser final {'NOT_RUN': 3, 'PASS': 49, 'FAIL': 1}. Video cap remains FAIL3999>3900 in full run despite3 targeted PASS; product timer defect unproven. Do not weaken cap/HUD predicates/timeouts. Docker image/runtime7 NOT_RUN; physical S20+ NOT_RUN. Historical HUD cause unresolved even if repeated tests pass.
Reports/evidence live in external stage15 folder; physical checklist07 andDaily09. No push, published-branch rebase, GitHub merge, deploy or production actions authorized/performed. Remaining publication/CI and mobile acceptance need owner's separate decision. Do not push combined branch directly into either PR; transplant scoped commits only after permission. PR220 timeout25 already included once.

---

## Previous recorded history (retained)

# Консолидированная локальная модель интеграции — 20 октября 2026

В объединённом коде сохранены Daily outbox/owner/idempotency изменения #221 и B1–B4/motion/HUD diagnostics/CI budget изменения #222. Общий browser-smoke budget 25 минут; HUD predicate и 15000ms не менялись. Модель интеграции и её проверки локальны. Готовность точного кандидата устанавливается по фактическим логам 14_PREMERGE_VALIDATION, а не по прежнему успеху отдельных PR.

Base abdb10c19d17de074f2be90e52d59cd9485c5b1b; Daily 500ab50fa3bc2e374f78ce0c3218f63065e8b7e1; B2/B4 cd8612854d28b19ed2e0b49f4451c6c9704a3b74. Все исходные версии доступны в Git parents и в evidence/memory-sources отчёта.

## Исторические добавления Daily #221 (перед общим блоком)

# Daily outbox integration preparation — 20 October 2026

Branch fix/daily-outbox-integration-20261020 is isolated from main abdb10c. Applied audited daily-outbox-fix-v3.patch; added exact-ID settlement of migrated in-flight Daily requests and two behavioral regressions. MAX and Telegram coverage checks two offline tickets, account ownership, refreshed credentials, quota failure, missing Daily acknowledgement, lost response/idempotency, concurrent A/B settlement. Focused29/29 passes on Node22.23.3. Broader validation and publication readiness are recorded externally in OFELIYA_MASTER/12_INTEGRATION_PREP; no publication, merge or deploy authorized.

Storage is bounded8+one Daily and best-effort in restricted WebViews. At failed migration/quota, old ticket is retained and network is returned for the new ticket; cannot promise durable storage when localStorage refuses writes. Real MAX/Telegram device acceptance and hosted CI remain pending.

## Previous context


## Исторические добавления B2/B4 #222 (перед общим блоком)

# Visual upgrade Phase B4 state — 19 October 2026

Branch head c672a00 (B4 on B1+B2+B3). Bundle 430.83 kB vs prod 420.85 kB (+2.4%). Boss identity system: HUD bar frame + 6 phase-tinted ticks + diamond emblem; Enemy.getPhaseMode()/GameScene.getBossPhaseMode() (armored/recovery/broken); recovery/broken aura modes now draw the armored 6-tick vocabulary. Telegraph contract untouched. Tests PASS: tsc, presentation, telegraphs, boss-presentation, mini-boss, wave-events. Control perf 60s: median 20.3 FPS (noise). Evidence: screenshots/b4-* (driver scripts/boss-capture.cjs, wave.boss QA substitution for bar). Donor: none (prior donor bosses single-color, no phase ceremony). B1–B3 facts below remain valid.

## Previous snapshots
# Visual upgrade Phase B3 state — 19 October 2026

Branch head 8164f5f (B3 on top of B1+B2). Bundle 429.68 kB vs prod 420.85 kB (+2.1%). Rarity hierarchy on choice cards: tier pips (1/2/3) + graduated frame, VISUAL.host/rare/warning tokens; card-flow legacy hex (COLORS.gold, #ffe066) migrated to VISUAL.warning. Modal-scoped only, no per-frame cost, no copy changes. Tests PASS: tsc, tokens, language (1597 literals), ui-copy, legendary, layout-diagnostics, presentation. Paired captures: screenshots/b3-before|after-{mixed,common-rare,legendary}.png (driver scripts/mutation-cards-capture.cjs with synthetic defs). Donor: none (prior MIT donor has no rarity system). B1/B2 facts below remain valid.

## Previous snapshots
# Visual upgrade Phase B2 state — 19 October 2026

Branch feat/visual-combat-20261018 head 27f914d (B2 on top of B1). Bundle 429.35 kB vs prod 420.85 kB (+2.0%). Silhouette paired (182 enemies, seed 424242): coreLum 62.4→195.2, rgbDelta 48.1→144.4, annulusCalm 0.558→0.687. Perf 60s paired: Canvas median 60.5/60.5 (min 56.0/56.4), WebGL-SwiftShader 22.2/21.2 (noise band ±2). tsc clean; impact-budget, runtime-quality, test:presentation PASS. Layers: silhouetteClearing depth 11 (over enemies 10, under elite 12/health 13/bullets 14/player 15), playerGlow depth 14.5; both gated visualEnemyDensity≥110, ramp 110-200. Evidence in AUDIT_2026-10-18/: screenshots/silhouette-b2-*, iso-*, b2-*-zoom; evidence/silhouette-b2-*.json, perf-combat-b2-*.json; scripts/analyze-silhouette-b2.py, silhouette-video.cjs. B1 facts below remain valid.

## Previous snapshots
# Visual upgrade Phase B1 state — 19 October 2026

Facts (measured 2026-10-18/19, workspace AUDIT_2026-10-18/): origin/main = abdb10c = production. Branch feat/visual-combat-20261018: 91891f7 atlas+tests, 7d2aac2 hit reaction, 81049f2 death collapse, 7be28d6 smoke driver + notices; head 7be28d6. Bundle 428.56 kB vs 420.85 kB prod (+1.8%). Paired 60 s combat perf: WebGL-SwiftShader median 19.8 (before) / 19.3 (after), min 18.4/18.1; true Canvas (?renderer=canvas, type=1) median 59.1/59.5, min 54.4/56.2; enemiesMax 19/21 and 32/26 (seed variance). Impact smoke 3 cells: before 21 contract deviations, after 0 (strict). tsc clean; listed presentation/contract suites PASS. browser-smoke legal failure reproduces on untouched abdb10c (pre-existing, local build lacks release env). build:max not run (owner env only).

Correction of 18.10 measurements: combat/silhouette/loading runs labeled Canvas were WebGL-SwiftShader (type=2) — driver label bug; plain headless launches WebGL. True Canvas first measured in B1.

## Previous snapshots

## Общая сохранённая история исходного main

# Visual implementation completion — 16 October 2026

Branch visual/completion-20261016 extends verified public7a0d829 (PR216). Implemented distinct Player mutation geometry/combined composition, unified SocialHub and Codex, measured11px scrolling result report with pinned actions, pointer ownership and long-share fit, quieter pause. Existing gameplay/RNG/physics/score/network/assets/service settings are retained. Main integration is not authorized.

Read docs/release/VISUAL_COMPLETION_20261016.md. Root executed rich result/resumed/share/social/error/allCodex browser320/360/390; presentation and TypeScript passed. Independent source and native visual reviews resolved concrete issues and found no remaining P1/P2. Short live100-spawn AI/physics desktop before/after has p95~16.8ms in Canvas/WebGL, explicitly not device FPS. Final exact-head hosted CI/matrix, fresh backup and pinned deployment/readback are still pending; do not claim publication from this snapshot.

The implementation gaps from the earlier Phase1 ledger are addressed in this branch; old pending statements below are historical snapshots. Device MAX/TG/iOS, sustained performance/thermals, newcomer/full-campaign acceptance remain open. Preserve other PRs and private state backups. Companion documentation branch carries final evidence without changing the tested product SHA after publication.

## Previous snapshots
# Mutation art recovery state — 16 October 2026
Branch fix/mutation-art-recovery-20261016 starts from the verified live visual candidate44c6579 (PR214). Cold-start optional mutation requests can exceed Boot1800ms; fallback previously remained permanent. The scoped fix records canonical texture provenance and recovers only mutation-prism/halo/singularity after first render. Same256px CanvasTexture objects refresh in place; Player/physics/gameplay/assets remain unchanged. Two8000ms attempts/key,750ms backoff; per-game dedup and destruction cancellation. Five module contracts, full presentation and TypeScript passed. Read docs/release/MUTATION_ART_RECOVERY_20261016.md.

Local delayed-image Canvas/WebGL regression passed with sixteen paired actual Player frames and exact packaged pixels. Independent source review found no concrete P1/P2. Remaining before publication: final still-image review, exact-head hosted CI/matrix, fresh private backup and pinned Render Free publication/readback. Owner authorizes continuation/deployment; main merge remains prohibited. Keep PR213/214/215 and other parallel PRs separate. Physical-device/FPS/newcomer acceptance remains open. Update the release document after real results; do not treat this pending snapshot as proof of publication.

## Previous snapshots
# Phase1 visual candidate state — 16 October 2026
Phase0/1 product work is on visual/phase1-ui-20261015, based on main aba70324. Open PR213 contains world art; dependent PR214 contains menu/HUD/mutation/boss/result presentation. Source head d5cae44 is followed by a test-only comprehension synchronization fix: wait for the actual boss reveal to finish before host-lesson assertions. This preserves production behavior and every gameplay assertion. Independent review found no actionable issue in this test delta. Presentation contracts, TypeScript and whitespace checks passed on continuation. Full browser rerun and exact new-head CI must be recorded before publication.

Owner authorized deployment after candidate validation; main merge remains prohibited. Refresh the private pre-deployment backup, deploy the exact green pushed SHA on the existing Render Free service, and verify live SHA/assets/browser/state preservation. Until then production remains the separately verified 30a534f release. Final release/readback evidence belongs in companion PR215 (docs/frontend-overhaul-20261015), starting at FRONTEND_OVERHAUL_PROGRESS.md. Do not deploy the documentation branch.

PR204/207/208/209/210/212 remain separate integration work. Physical MAX/Telegram/iOS, phone readability/input/FPS/thermals, full campaign and newcomer acceptance remain open; later visual phases are not claimed complete. Preserve all prior work and do not infer phone acceptance from desktop fixtures.

## Previous snapshots
# Review follow-ups — 2026-10-15

Branch fix/review-followups-20261015 starts from main30a534f. Owner asked to continue remaining review recommendations. Four targeted follow-ups: Boot/Menu startup recovery now waits for the first usable Menu frame and catches scene exceptions/stalls; CI builds the actual telegram-bot target and imports it with networking disabled and a deadline; registry mirror-write failures lower health until a successful write; profile migration publishes a staged candidate only after its atomic disk write.

RED→GREEN: actual Phaser scene-create failure; registry health on injected disk failure; failed migration remaining claimable and invisible to signed reads. Local server75 plus security/durable/hosting suites, TypeScript, bot contract, startup browser cases and prior review-browser scenarios pass. Independent Luna review found no P1/P2. The final extended startup check, production build and exact-head hosted CI must still be recorded in the PR. Local Docker Desktop could not start; actual image import remains pending hosted CI.

Previous package PR202/203 is merged and was verified published on 14 October: exact main30a534fbf1656979c20434d4f4d724eea69c385f, all three main CI jobs succeeded, Render deploy dep-db7ndmm7bikc73d860lg automatically triggered new_commit and live. Public56 files/API/browser checks passed; all73 scores, existing profiles/registry preserved, Free and /ready retained. Those are prior-release facts, not proof of this branch being live. Physical S20+/MAX/TG, iOS, FPS/newcomer gates remain open. Other agents' open PRs are untouched; recheck main before integration.

## Previous snapshots

# Legacy mini-boss warning follow-up — 2026-10-14

PR202 merged as9a6d327 after green PR CI38559170274. Before publication, an additional
legacy checkpoint edge was found: pre-mini-boss saves can lie inside its new warning.
Follow-up consumes that restored encounter, matching the wave-warning policy; saves
before the warning still get the complete mini-boss warning. Actual production-method
regression observed warning+spawn before the fix, then no partial replay; future warning
remains full. Main CI38560367835 was cancelled to hold publication for this fix.
Run final exact-head/main CI and verify runtime identity; do not treat cancelled CI as PASS.

# Review48 P2 fixes — 2026-10-14

Owner approved four fixes in order: pre-wave checkpoint migration, anomaly lifecycle,
wave warning resume, proxy rate isolation. Implementation branch fix/review48-p2-20261014
starts at a0faa496. Tests reproduced each defect before its fix.

Implemented: real base6a5cf5be fixture retained; only additive missing streams derived
for legacy v2, original six streams mandatory. Anomaly state machine and damage use
combat-phase authority. New saves are suppressed during pending wave warnings; old
mid-warning snapshots consume that event without redrawing RNG or short warnings.
Verified actor counters are separated from anonymous counters and proxy backstop;
anonymous retries/churn cannot drain or evict signed budgets. XFF remains untrusted
unless the explicit connecting proxy policy permits it.

Local evidence: checkpoint/RNG, anomaly-runtime6/6, actual Phaser lifecycle (frozen HP,
transition reaches Heart, normal damage retained, real safe/pending save wiring),
proxy HTTP flood +20,001-key eviction regression, TypeScript and existing browser
review regressions passed. Server core75 + security/durable/hosting suites passed;
final post-review suite/build and exact-head hosted CI must be recorded in PR.
Independent whole-branch reviewer found actor-map eviction; corrected with separate
signed counters and watched its regression fail then pass. Remaining native device,
FPS/newcomer gates are open. Startup scene-boundary and telegram-bot CI build gaps
are P3 follow-ups, outside these four fixes.

Production known at task start: Render Free a0faa496, manual deployment
 dep-db7l3j7avr4c738l7mqg. This source change has not yet been published. On release,
verify exact SHA, backup, readiness/hash parity; observe auto trigger before manual
fallback because GitHub repository access was corrected. No secrets, DNS, bot identity,
paid resources or real user messages changed by implementation.

## Previous snapshot

# Render investigation — 2026-10-14

PR #199 is merged as `51b910a0e8031ca477daf701ca1de1b31023cf01`.
Final PR CI [38441586488](https://github.com/timoshinoleg-eng/ofeliya/actions/runs/38441586488)
and main CI [38443697280](https://github.com/timoshinoleg-eng/ofeliya/actions/runs/38443697280)
passed build, browser-smoke and production-contract. Merge used `[skip render]`.

Authenticated dashboard inspection used `timoshin.oleg@gmail.com` and service
`srv-db5ro5vlk1mc73b0v0eg`. Visible settings: GitHub repository
`timoshinoleg-eng/ofeliya`, branch `main`, empty root directory, Auto Deploy
`After CI Checks Pass`; no included build paths; ignored paths `memory/**`,
`PROJECT_IDENTITY.md`, `deploy/RENDER.md`; health check `/ready`.
The account has GitHub login `timoshinoleg-eng`. These are UI observations,
not proof that GitHub events/checks reach Render successfully.

The live `c0c72fa` deployment `dep-db6vmg4s728c73cv4010` and four earlier
entries show trigger API; the initial deployment shows First Deploy.
GitHub installation `88263801` was active but restricted to only
`junior_middle_it` and `coder_survival`; `ofeliya` was missing from selected
repositories. This is a concrete integration access defect, consistent with
missing automatic deployment events; historical webhook delivery was not inspected.
With explicit owner approval, only `timoshinoleg-eng/ofeliya` was added and Save
clicked. GitHub redirected to Render with `setup_action=update`. Reopening the
installation confirmed three saved repositories, including ofeliya, and disabled
Save/Cancel controls. Other repository grants and the permission set were preserved.
No API key was created or recovered; no manual deployment, service setting or
production data was changed. A fresh service Events check after Save still
showed 35 entries, no new deployment and live source `c0c72fa`.

Repository access is corrected; end-to-end automatic deployment is not yet
verified. The maintenance merge's `[skip render]` deliberately suppresses that
commit, so it cannot validate the fix. Historical trigger attribution remains
unproven beyond the observed access defect.
On the next authorized runtime release, use a commit affecting included paths
without a Render skip phrase, confirm all checks on the exact main SHA, then
observe a Render automatic deployment of that SHA before manual/API fallback.
If absent, inspect events, repository grants and GitHub event/check delivery.
Reference: https://render.com/docs/deploys and https://render.com/docs/monorepo-support.

## Previous snapshots (current findings above take precedence)

# Telegram image and maintenance verification — 2026-10-13

PR #199 fixes the latent dedicated `telegram-bot` image dependency omission
on branch `fix/telegram-bot-image-20261013`, based on main `f48c143`.
`bot.mjs:23` imports `telegram-webhook.mjs` at module scope. The old bot stage
copied only bot.mjs and telegram-api.mjs. RED `d9fb1c7` fails the added COPY
guard; GREEN `360c05b` passes after copying the missing helper. The guard scopes
COPY source/destination checks to the bot stage and is already wired into CI.
Both actual Docker images build; with `--network none`, the old Node22 image
import fails with `ERR_MODULE_NOT_FOUND` and the fixed one succeeds. Local
server tests (75 core plus all additional suites) and TypeScript/Vite build pass.
Existing CI builds runtime/score/static, not telegram-bot; contrary external
handoff text is inaccurate. No workflow expansion was made in this package.

PR #189 closed with a supersession comment linking current and archived handoff.
Remote branch `codex/render-migration-handoff-20261011` still exists. The stale
security-patch backlog claim is corrected: PR #197 already includes equivalent
and stricter policy/security regressions. The backup patch must not be applied
wholesale.

Render live investigation is pending authenticated working-account access.
No Render API credential was found in process environment, Documents/Codex,
repository, Desktop or the checked local config/credential stores. This is an
access limitation, not evidence about Render's provider or trigger. No settings
or production data were changed. The prior release facts below are historical
evidence, not a fresh authenticated API check in this follow-up.

# Verified review-fix release — 2026-10-13

Runtime source: c0c72fa81690b562e15c1d87580c66af842b3f3b (PR197 merged). Main CI38375891119: build/browser-smoke/production-contract success. Render Free deployment dep-db6vmg4s728c73cv4010 is live in production workspace tea-d8iruouq1p3s73f30a90 (timoshin.oleg@gmail.com). Canonical https://ofeliya.freeveol.dpdns.org/ofeliya/ reports this SHA. Metadata-only commits after this release do not change the published source identity.

Measured:56 public files match a local build using current production VITE values;47 exact and9 differing only in carriage-return line endings. Remote HTML/runtime-config/SW hashes match their release marker exactly. /ready200 aggregates configured MAX/TG and healthy API; Render healthCheckPath is /ready. Eight synthetic signed profile/social reads and both webhook auth gates passed; no test scores or fake registrations were written. Browser menu and actual touch start reached the first mutation without page errors/CSP violations, QA hooks absent. This is desktop Chromium, not a real phone.

Private S3 backup revision78 (13094bytes) was downloaded and verified; isolated restore started the new server with71scores and validated registry. Published state preserved all baseline scores/profiles/registrations. After a Render restart, revision80→81, all71scores and existing profiles/registry remained. source-map-js1.2.2 is merged; superseded draftPR184 is closed, branch preserved.

## Historical snapshots (current verified facts above take precedence)

# Current review fixes — 2026-10-13

Branch fix/kimi-review-20261013, based on main26fcc88. User approved the independent review follow-up plan. See docs/release/KIMI_REVIEW_FIXES_20261013.md for contracts, tests and mixed-version policy. Previous handoff is archived under memory/archive/2026-10-13-before-review-fixes/; older state/decisions/backlog remain as historical notes below.

Confirmed: local TypeScript/QA build, server75/75 plus migration/security/durable suites, browser startup/lifecycle/CSP, gameplay gates and npm audit zero. Hosted CI/deploy/device evidence pending.

## Historical notes (snapshot-specific; current facts above take precedence)

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

# Production state - 2026-10-11

OFELIYA is live on Render Free ofeliya-game (srv-db5ro5vlk1mc73b0v0eg),
Frankfurt, main/checksPass, canonical https://ofeliya.freeveol.dpdns.org/ofeliya/.
Runtime d92325b1c83259fbbebd4e02331826fd98982a5e includes merged PR190/191.
MAX/TG protected callbacks and /ofeliya/api/* work; prepared Telegram sharing
returned200. Remote Supabase state is healthy; restart restored67scores,
551events, and existing profiles. All54 assets and release hashes passed.

Cloud.ru OFELIYA VM,30GB disk and IP are deleted (GET404 for each); its deploy
workflow is disabled. Other three VMs, their resources and two Quiz backups
were preserved. Account-wide Cloud.ru charges are not claimed to be zero.
Real Telegram/MAX device /start and save/reopen remain external acceptance.
See memory/00_HANDOFF.md for verified IDs and evidence limits.

Supabase state access key was rotated in the existing Free project. The new
Render uses the replacement; the old key returns401 for read and writer claim,
so the inaccessible preview cannot steal production persistence. A 24-hour
management token was scoped only to this project and Edge Functions. No keys
are committed. Main CI38158081443 passed all three jobs for runtime d92325b.

## Historical notes

# STATE — OFELIYA: STRAIN ZERO

Обновлено: 2026-10-05. Только факты; решения — в `02_DECISIONS.md`.

## Control smoke precondition (06.10)

- Main `3a04868` browser smoke failed the synthetic recycled pointer test while a live level-up mutation modal had `uiBlocked=true`; both down callbacks correctly rejected input, leaving ids `-1` and vectors zero.
- Test-only Game update freeze is installed before scene start for all three control modes; active UI is explicitly required to be modal-free and unblocked.
- Focused `control-mode-smoke.cjs` passed locally; production code was not changed.

## Standalone deploy compatibility policy (05.10)

- Production run `37370394631` reached the server, passed CI/release floors, then failed because a helper sibling was absent from the selected script extraction directory `/tmp`; automatic rollback to `edb1b9a...` succeeded and public release marker confirmed it.
- `deploy/deploy-cloudru.sh` now reads the compatibility helper from fetched `origin/main` into a variable, rejects failed, empty, or whitespace-only loads, and pipes the policy to `bash -s`; no dependency on script location remains.
- The three CI jobs use `ubuntu-22.04`. Existing rollback contract test now executes the actual deploy guard for valid, old, invalid, missing-helper, and empty-helper cases.

## Targeted deploy CI lookup (05.10)

- Deploy job now uses `ubuntu-22.04` and requests workflow-specific `ci.yml` runs filtered by exact release SHA, main branch, push event, completed status, and up to 100 results.
- The inline validator retains all five acceptance predicates; missing matches report counts and up to five same-SHA run identity/status summaries.
- Root reported hosted runner acquisition failures for prior deploy/main-CI attempts; exact-SHA CI run `37360675706` was independently confirmed green for main SHA `42b9f30a3feb8f219faf41014f0bfdd6bf27b5dd`.

## Deploy workflow payload (05.10)

- Branch `fix/deploy-ci-payload-20261005` is based on main `42b9f30a3feb8f219faf41014f0bfdd6bf27b5dd`.
- Deploy run `37362076056` failed before bastion access because the large Actions runs JSON was passed as an environment variable, exceeding Linux `MAX_ARG_STRLEN` and preventing Node startup (exit 126).
- The successful-main-CI workflow step now reads its JSON payload from a temporary file while preserving its five run identity checks and fail-closed behavior.

## Репозиторий

- GitHub: `https://github.com/timoshinoleg-eng/ofeliya`
- Ветки: `main` (актуально); `feat/donor-quick-wins` @ `e5b6658` — историческая (не обновляется; актуальный код — в `main`); `fix/audit-blockers`, `backup/audit-blockers-0ecbf3c` — архив.
- Remote (02.10): `origin/main` @ `4bce5a0bdfd996cbda4447d1eefdfbdb2c9531bc`; рабочая ветка этой сессии — `feat/product-validation-funnel-20261002` от указанного main.
- Worktrees (локально): `…\work\ofeliya-audit` (main), `…\work\ofeliya-audit-fixes` — переведён на состояние `origin/main` (`808d866`); локальная ветка трекает `origin/main`.
- Приёмка: PR #151 (`dc71cb2`), PR #152 (`2df55bb`, `06_REVIEW.md`), PR #153 (`808d866`, финал) смержены 29.09; пост-ревью правки — PR #154. Система памяти — в `main`.

## Продукт

- OFELIYA: STRAIN ZERO, `v0.4.1-rc.1` (по локальной копии от 26.09), portrait roguelite-survivor для MAX Mini Apps.
- Кампания: КРОВОТОК → IMMUNE PRIME → СЕРДЦЕ → CARDIAC TITAN (≈9+ мин до боссов).
- Стандарт/Strained сложности; Legendary ≤2 за прогон; trusted score backend.

## Гейты

- CI: build gate + browser gate (`ci.yml`); `release-visual-matrix.yml` (100/150/200 × WebGL/Canvas × full/reduced).
- Внешний гейт: реальные MAX Android/iOS — 16 пунктов (`RELEASE_VALIDATION.md` §8). **Не пройден.**

## Инфраструктура и прод

- Деплой: Cloud.ru (`deploy/deploy-cloudru.sh`, `compose.production.yml`, `Caddyfile.ofeliya`, `nginx.conf`).
- Ремарка: зелёный CI означает консистентность репозитория, не «на VM крутится именно этот коммит» — проверять отдельно.

## Инструменты (пилот)

- Ноут 1 (Honor): OpenCode (основной), Cline (запасной), Codex desktop.
- Ноут 2 (HP): OpenCode (второй), Cline (запасной).
- ChatGPT web: Project «Офелия» — внешний ревьюер (обычный чат, не Work).
- Память: `memory/` в репозитории; контекст: плагин context-mode (проверен: v1.0.169 отвечает в сессии); доп. слой: cross-agent-memory MCP.
- Пилот, статус 28.09.2026: этап 0 — архив копий; этап 1 — память в репо; этап 2 (Honor) — OmniRoute сервер работает, OpenCode → комбо `omniroute/OFELIYA-CODE` (живой тест ✓), скиллы gamedev 74+router (единый источник `~/.agents/skills`), Superpowers установлен плагином. Этап 4 (ночь 28→29.09, Honor): тест-цикл B пройден — OpenCode 1.18.33 (ctx stats ✓, память без пересказов ✓, смена модели OFELIYA-CODE → BACKGROUND-REVIEW с сохранением контекста ✓); smoke-тесты onboarding/daily-history/comprehension зелёные; ревью 3/3 подтверждено + коррекция (регрессий в UIScene нет).
- Дальше: этап 3 — HP (блок A чек-листа); ChatGPT-вариант ревью — опционально.

## Product validation 02.10

- First-run onboarding перестроен на реальный core loop: движение → автоогонь → RNA → мутация → заражение клетки-хозяина; шаг «пауза» удалён из tutorial.
- В `RunSnapshot` добавлен `hostCellsInfected`, чтобы UI мог завершать onboarding по реальному заражению.
- Аналитика дополнена событиями `run_start`, `run_60s`, `boss1`, `heart`, `win/death`, `replay`, успешный `share`, запуск `daily`, referral-open, `onboarding_step`, `onboarding_exit`.
- Добавлен CLI `analytics:funnel`: unique-actor funnel, first-60s timing/exits, D1 и referral open → run_start.
- Добавлен формальный 16-пунктовый evidence validator `test:mobile-evidence` и документ `docs/PRODUCT_VALIDATION_2026-10.md`. Реальная Android/iOS приёмка всё ещё НЕ выполнена: валидатор проверен только на синтетическом fixture.
- Проверки ветки: `test:onboarding` ✓, `test:analytics` ✓, `server:test` 68/68 ✓, `test:comprehension` ✓ на 6 viewport при запуске текущей ветки на :5194, `test:result-actions` + checkpoint-resume ✓ на текущей ветке, `test:daily-cta` ✓; production build ✓ при явном `VITE_RELEASE_SHA` текущего base SHA.

## Открытые вопросы / риски

- Баланс полных прогонов и Heart timing — только через плейтест (CI не решает).
- Термика/перформанс на целевых телефонах — внешний гейт.
- PR #151/#152: merge выполнены; CI был зелёный (build/browser-smoke/production-contract).

## Audit revalidation 03.10
- Rechecked v2 audit findings D1/D2 against the current PR #157 branch, not historical commit 53ff997.
- D1 (elite collision radius) is a false positive: Phaser Arcade setCircle() uses source pixels and scales the actual body; runtime smoke now asserts collisionRadius ~= Enemy.radius for elite scale 1.45.
- D2 (blocking overlays on viewport rotation/resize) is fixed in UIScene: level-up and result overlays retain their source viewport, scale into the new viewport, and expand the scrim to cover it.
- Regression coverage: mutation-choice smoke checks 390x844 -> 568x320 with an open level-up modal; existing mobile-layout matrix checks result resize. Real Android/iOS MAX acceptance is still required.

## Telegram production wiring 03.10
- Branch `feat/telegram-production-wiring` prepares the current shared OFELIYA frontend/backend for Telegram production without changing MAX ownership.
- Telegram CSP/Web embedding, optional fail-closed deploy env, dedicated long-polling bot service, shared referral data volume, and deploy parity checks are implemented.
- Telegram remains disabled on production until `TG_BOT_TOKEN` + `VITE_TG_BOT_USERNAME` are supplied; BotFather Main Mini App must target the canonical OFELIYA URL.
- Fixed Telegram `/start <payload>` long-polling dispatch to parse the original message text.

## Telegram edge rollout fix 03.10
- First production rollout of #158 correctly failed public parity and rolled application containers back to 56476c0: nginx had Telegram CSP, but local Caddyfile.dedicated remained MAX-only.
- Hotfix branch fix/telegram-edge-caddy-rollout versions the edge route policy through a renderer and safe Caddy validate/reload path with local-config restoration on failure.

## Telegram webhook production fallback 04.10
- Cloud.ru Docker outbound TLS to Telegram Bot API is unreliable even with the reachable pinned IP; do not treat an Up long-poll container as acceptance.
- Production path now supports Telegram webhook at /api/telegram/webhook with X-Telegram-Bot-Api-Secret-Token validation.
- Webhook responses return inline sendMessage methods with a Web App launch button, so /start and /help require no outbound Telegram API call.
- When outbound Bot API is disabled, prepared-share fails locally and the client falls back to t.me/share/url without a 3.5s timeout.


## 2026-10-05: продолжение Sol6.1 remediation

- Основа origin/main edb1b9a (Telegram webhook), ветка fix/sol61-review-remediation-20261005. Восстановлены R01/R02 и незавершённый R03 из отдельного checkout без изменения исходного каталога.
- R01 wall clock Daily; R02 резерв verified capacity; R03 ID-aware ordinary outbox; R04 reload отложен до завершения Game (internal game reference, production без QA hook).
- R05 outbound defaultoff + explicit Compose env; R06 webhook-compatible SHA floor в workflow/select/rollback и direct deploy; R07 shared polling/webhook direct-link payload и group-safe кнопки.
- R08 onboarding completion callback; R09 analytics actor60/min; R10 credentials scrub+7dayTTL обоих outboxes.
- Независимое GPT-6.1 Sol ревью дополнительно выявило Daily409 blocking, смену uid внутри одной платформы и ack-before-durable. Исправлены terminal Daily409, exact-ID Daily settlement, local ownerId replay guard, fresh-user Daily slot supersession и synchronous atomic flush score/run/start/daily/run до non5xx ответа. Unknown legacy ordinary entries не replay: истекают поTTL, предотвращая присвоение чужому пользователю.
- Проверки: server75, outbox24, новые release4/onboarding/rollback/server-policy/renderedCompose; браузер score/comprehension6viewport. Полный локальный набор43гейта: первый startup5.124s при параллельной браузерной нагрузке и Caddy sh ENOENT; serial startup и Caddy с GitBash PATH прошли. Исходные failures сохранены в evidence.
- Cloud creation недоступен аккаунту; пользователь разрешил local. Deploy/merge не выполнены. Публичный release.json недоступен; текущая productionSHA НЕ подтверждена. Real-device MAX Android/iOS16/16 остаётся открытым.
- Анализ второго вложения: WOFF2 валиден, кириллица отсутствует. Не считать разрешённые словарём ФОРМА МУТАЦИИ/MAX ИЛИ TG/СТАНДАРТ ошибками; предложить небольшой кириллический typography trial, затем RU catalog; fullEN i18n после продуктового решения.


## 2026-10-05: делегированные UI follow-up

Ветка refactor/ui-copy-layout-followup-20261005 собрана поверх PR168 HEAD4f65c4f. PR168 остаётся отдельным remediation пакетом, его CI прошёл; merge/deploy не выполнены.

Space Bunny через OpenCode (opencode/space-bunny-free) создал типизированные варианты control labels и каталог rarity/build-summary: исходный code7a7d08e, здесь cherry-pickd63b80c. Существующие RU strings и поведение сохранены; full/compact/tiny намеренно различаются. Upgrade-id completeness контролируется runtime контрактом, не исчерпывающим TS union.

GPT-6 Sol создал рекурсивный диагностический collector для видимого текста в Container и18Legendary regression cases: исходныйcodeea086d1, здесь4f5cbfc. Production UI/Legendary layout не переделывался: actualPhaser18cases без overflow, max2lines. Matrix fixture теперь учитывает автоматический startuplevel-up pause и проверяет checkpointsave явно.

GPT-6 Luna независимо проверил обе задачи; no functional findings. Coordinator подключил новые Node/browser gates кCI и закрепил равные stackcounts в golden test. Browser suite budget15мин вместо10 из-за дополнительной18-case проверки, пороги assertions не увеличены.

Локальная отдельная приёмка: catalog/language/tsc; layout diagnostics; Legendary18/18; mobile matrix320x568,360x640,360x760,390x844,412x915 + restart-safe resume/result resize. Итоговый CI этой ветки нужно смотреть по headSHA draftPR, не переносить результат PR168.

Шрифтовой prototype находится отдельно в PR169: opt-inPlay400/700, no productiondefaultflip. CI обнаружил import.meta/CommonJS regression и отсутствие releaseSHA в visualworkflow; автор исправляет отдельно. Не считать старый Play CI зелёным.

Текущее второе мнение: MAX ИЛИ TG прямо разрешён languageBible100; PR168 меняетUIScene;452/419 без методики не новый замер; T-КИЛЛЕР/T-КЛЕТКИ действительно расходятся вproductBible. Имена/редкости/юридические тексты/fulli18n не изменять без продуктового решения.

Внешние релиз-гейты: реальные MAX Android/iOS16/16, TG launch/referral/Daily и publicrelease.json exactSHA остаются неподтверждёнными. Не выполнять merge/deploy автоматически.

## Legendary compact-card clipping fix (05.10)

- Linux layout evidence at 320x568 showed three Legendary effect strings wrapping to three lines while UIScene capped the badge text at two. `UIScene.ts` now measures wrapping and grants a third line only to a compact Legendary effect that needs it; its plate expands to 42px and shifts upward to center y=21, ending at y=42 before the footer starts at y=43; card height stays 124px. Other card effects keep their prior 2-line limit and plate size. Copy and `UiCopy` imports are unchanged.
- Focused layout probe now accepts the bounded 42px effect plate while still comparing actual text bounds against it. Root reports the 18-case Windows browser probe passed on this exact working diff. Local typecheck, `test:legendary`, `test:mutation-copy`, and `test:tokens` passed.
- Code commits `340f38b7f8f2be2fc9be49c6b06cf49d45151d2e` and overlap correction `997b6eee2403505e1a416fd5d2755496c30728e`; root owns final probe rerun and full branch CI. No push/merge/deploy here.


## Final Legendary geometry and probe guard
- Corrected candidate `997b6eee2403505e1a416fd5d2755496c30728e` supersedes the earlier center-y=31 version, which overlapped the footer. The compact three-line panel is now center-y=21, bounds y=0..42; the Legendary footer begins y=43. Probe now requires description/footer fixtures and rejects text-bound intersections.
- Root reports the browser 18-case check plus desc/footer intersections pass on the corrected geometry. The stricter fixture-presence probe guard was added afterward; root should rerun it against final HEAD before push. No push from this worker.

## Compact Legendary description spacing follow-up (05.10)
- After Linux showed effect/description overlap, compact Legendary reward cards now use height 136px (other compact level-up cards remain 124px). At 320x568, three cards span y=122..548. The effect plate remains 42px high at local y=6..48; footer starts local y=49, and description moves up to local y=-22. No effect font-size, copy, or gameplay changes.
- Focused probe JSON now includes effect, description, and footer bounds and rejects missing fixture text or intersections. Root's Windows 18-case verification passed on this change. Typecheck plus Legendary, mutation-copy, and token checks passed. Focused Linux CI is pending; earlier Linux result showed description overlap.
- Code commit `29457d658e309ee87fadffd30c565528a11d6405`; root workflow-order commit `04392af` runs the focused layout gate early. Root is handling push and Linux CI.

## Release closure: visual matrix stamp + gate documentation (05.10)

- Отдельный bounded checkout поверх `1d6bb37` (ветка release closure). Коммит `a32b3f2`.
- Подтверждённый дефект: `.github/workflows/release-visual-matrix.yml` задавал `VITE_RELEASE_MATRIX_QA=1`, но не `VITE_RELEASE_SHA`, поэтому `scripts/stamp-release.mjs` падал со `VITE_RELEASE_SHA must be an explicit 40-character git SHA`. Добавлена строка `VITE_RELEASE_SHA: ${{ github.sha }}` — тот же источник, что и в `ci.yml`.
- Документация: `RELEASE_VALIDATION.md` и `README.md` теперь различают документированный quick check list (подмножество) и авторитетный полный гейт (`.github/workflows/ci.yml` + visual matrix workflow). Явно зафиксировано, что зелёный CI не означает приёмку на реальных MAX/iOS/Telegram клиентах.
- Задокументирован `npm run test:mobile-evidence -- PATH`: 16 обязательных id (8 Android + 8 iOS), пять обязательных полей на запись, и перечень требований, которые валидатор НЕ проверяет и которые остаются ручными (BackButton, haptics, audio unlock, restart-циклы, boss pacing, Heart timing, twin-stick ergonomics, реальные legal values, trusted score с подписанным `initData`). Существующая ручная матрица §8 не изменена.
- `.gitignore`: добавлено ровно одно правило `artifacts/mobile-acceptance.json`. Проверено, что `artifacts/other.json` остаётся видимым для git; tracked paths под `artifacts/` отсутствуют.
- Локальные проверки: `npm ci` 0; `git diff --check` 0; `npm run test:tokens` 0 (`ui tokens contract: ok`); `npm run build` при `VITE_RELEASE_MATRIX_QA=1` и `VITE_RELEASE_SHA=$(git rev-parse HEAD)` — 0, `Stamped OFELIYA release 1d6bb37...`. Валидатор evidence не запускался: реальных device evidence нет.
- Реальные MAX Android/iOS 16/16, Telegram launch/referral/Daily и public `release.json` exact SHA остаются неподтверждёнными. Push/merge/deploy не выполнялись.

## Уточнение описания mobile-evidence валидатора (05.10)

- Коммит `d976778`, только README.md и RELEASE_VALIDATION.md. Семантика валидатора не менялась.
- Первая формулировка была неточной в двух местах. Проверено чтением `scripts/check-mobile-acceptance-evidence.mjs` и запуском на синтетических fixture: exit 0 при 16 обязательных id; exit 0 при тех же 16 плюс две дополнительные строки; exit 0 при `testedAt: "October 5, 2026"`; exit 1 при 15 обязательных id (даже с лишней строкой); exit 1 при `testedAt: "not-a-date"`.
- Итог: 16 id — это обязательный минимум, а не точное и исчерпывающее число. Валидатор итерирует только по своему массиву `required`, поэтому дополнительные строки `checks[]` разрешены и не инспектируются — `pass` их не подтверждает.
- `testedAt` проверяется через `Date.parse`, то есть принимается любое разбираемое значение даты/времени; ISO 8601 рекомендуется для читаемости, но не является требованием.

## Viewport-guarded Legendary card expansion (05.10)
- Final code commit `c01019f0708d9740cfc7a3f84da29bba149eed55` only selects 136px compact Legendary cards when the proposed full stack fits below the measured subtitle plus one card gap and above the bottom one-gap margin. Otherwise compact cards stay at the original 124px and their effects stay capped at two lines. At 320x568 the three-card stack fits; at 568x320 it does not expand.
- Probe emits card, effect, description, and footer bounds and asserts full text, required fixtures, panel containment, and no effect/description/footer intersection. Root reports the supplemental 18-case two-reward probe passed across 320x568, 568x320, and 390x740 on the fit guard. Typecheck and static Legendary/copy/token checks passed. Focused Linux run `37293956036` passed the earlier description-spacing version; root owns the final Linux run after this viewport guard.

## 2026-10-05: многокарточный Legendary probe
- `scripts/legendary-layout-probe.cjs` обновлён в `a4fd334f1f1b319d5a6016026a6689ef757eaceb`.
- Оставлены одиночные карточки; добавлены 15 distinct pairs actual Legendary definitions на viewports 320x568, 360x640, 390x740, synthetic three-Legendary layout fixture на этих размерах и guard fixture на 320x520.
- Per-card checks локализованы в родительском Phaser container. Первый browser run: 87/88; single и pair cases прошли. Один synthetic-three 320x480 failure вызван subtitle overlap на стрессовом fixture; его скорректировали до 320x520 для проверки compact-fit / expanded-no-fit guard. Повторный browser run прошёл 88/88 (24 singles, 60 pairs, 3 synthetic-three, 1 guard); short fixture 320x520 сохранил 124px cards, 9px subtitle gap, no overflow. Независимое review выполняется; Linux CI и real-device validation остаются pending. Первый Linux CI остановился до проверок из-за default URL 5197 вместо workflow Vite port 5173 (connection refused, `work/multicard-linux-plain.log:190`); probe default исправлен, rerun pending.

## 2026-10-05 Linux probe follow-up
- Linux run after restoring CI's port-5173 fallback executed 88 cases: 87 passed. All 15 actual Legendary pairs across each viewport and all single-card scenarios passed. The sole failure was the synthetic three-card short guard at 320x520, where a three-line effect reached the deliberate compact 2-line cap on 124px cards (`work/multicard-linux-plain2.log`).
- This is a stress-fixture content limit, not evidence of a trophy issue: the actual guaranteed trophy offers two cards. The taller synthetic long-effect stress case remains; the short guard now chooses definitions 0, 2, and 5, with effects fitting within two lines, while retaining all actual pairs at 320x520. Browser rerun and independent review pending. Linux build/test suite and device acceptance are not claimed passed.

The next Linux run exposed that short-guard index 3 also wraps to three lines. Measured wrap counts for the six definitions are `[2,3,2,3,3,2]`; the fixture now selects indices 0, 2, and 5 (index 5 is the last-life-saving Legendary), all measured at two lines. The 320x520 guard isolates height fitting; no Linux pass is claimed until rerun.

## VO-01 diagnostics-first — 07.10.2026
- Branch visual/vo-01-render-clarity-20261007, base d7797bc67bbda063d2fc3de68026101b0b061121, code/tests/docs 582723032b060f690eb59dac933c60834d0969a2.
- Runtime RED observed: Menu ready, __renderSnapshot undefined. Added bounded on-demand snapshot under existing DEV/QA gate; ordinary production runtime opacity passed.
- DEV and QA production browser 6/6 each: WebGL/Canvas DPR1/2/3, Menu/Game/two resizes/resume; local buffer remains CSS/logical size, no general HiDPI enabled. Text style/source resolutions recorded independently.
- Local startup, viewport, control modes/CDP multitouch, layout diagnostics, typecheck, ordinary + QA builds, tokens, runtime-quality, challenge, language checks passed. Builds stamped base SHA, not new code HEAD. Full commands/intermediate failures/warnings in docs/visual-overhaul/VO01_VALIDATION.md.
- Separate npm ci created ordinary local node_modules (Phaser 3.90.0), not a shared junction. npm/esbuild/git sandbox failures required approved escalation retries. No gate weakening or config/auth/route/skill changes.
- Kimi invalid API key artifact excluded; independent review coordinator-owned and pending. Local work/ evidence, .vo01-npm-cache and failed Kimi artifact intentionally untracked. No full CI/device acceptance/publication.

## VO01 Kimi fix round1 — 07.10.2026
- c231d60ebcf5748b9a2a2d2c5bbf99ca39adaa5a addresses F1-F5, F6/F8/F10. Successful text-only Kimi review now committed as docs/visual-overhaul/VO01_KIMI_REVIEW.md; old invalid-key artifact overwritten. External credential recovery was coordinator work; no auth touched here.
- Missing-scene runtime test observed null.cameras RED then GREEN. QA matrix 6/6, ordinary production static hook absence and runtime opacity, typecheck and builds passed. Actual commands/failures in VO01_VALIDATION.md. Builds stamped preceding 6204e33, not c231d60.
- Nested test objects destroyed; progression freeze remains fixture-only. Visible handler dispatch is not hidden transition. RESIZE intrinsic=CSS assertions pin current baseline, no HiDPI enabled.
- Original pipeline coordinator owns branch import/review/acceptance and broader plan. No additional workers, publication, configs/auth/routing changes; local cache/evidence excluded.


## VO02 combat presentation — 07.10.2026
- Branch `visual/vo02-combat-20261007`, base `a4d20d1`; code/tests `ddbe943`. Existing four retained emitters now select baked spark/chip frames from one 200x40 Canvas atlas (10 palette colors, 20 frames), providing renderer-independent event colors.
- Bullet-hit presentation receives existing normalized velocity and victim radius; directed spray originates at the incoming membrane surface. Legacy three-argument calls stay centered/radial. Death presentation receives radius only. Gameplay damage/knockback/event ordering, actor/projectile sources, Joystick, ImpactDirector, VfxBudget and disabled camera postFX are unchanged.
- Death chips and sparks share one token grant; 40% rounded down become chips. All VfxSystem circles are retained in a full12/reduced6 pool, including singularity core/collapse and delayed rings. Ordinary traffic reserves3/2 slots; important feedback preempts oldest ordinary then oldest important. Runtime scale<=.65 trims to6 immediately. Completion hides/reuses; explicit destroy and scene shutdown cancel tweens and reclaim circles/four emitters idempotently.
- Focused Node boundary contracts 8/8 passed; `test:impact-budget`, `test:runtime-quality`, `test:telegraphs`, `npx tsc --noEmit`, `git diff --check` passed. Six focused contracts were observed RED before implementation. No browser was run by this worker; coordinator owns real Phaser Canvas/WebGL and matrix acceptance plus independent Kimi review. This is focused task validation, not final release acceptance.


## VO02 Kimi fix1 tests — 07.10.2026
- Coordinator reports Kimi scoped code-correctness PASS, no Critical findings, four Important nonblocking coverage gaps. Worker verified current production behavior and added only test cases in `04f56f7c849a01d11b508fcfd5e67bdd89c1a1d1`; production source unchanged.
- New coverage: mixed ordinary/important runtime shedding retains all six important effects; important preemption cancels old tween and manually injected stale completion neither hides nor releases replacement; far black/white palette selection and genuine white/immune nearest tie; ordinary pool saturation blocks a hit ring while hit particles retain separate shared-budget accounting.
- Focused contracts now 12/12, plus typecheck/impact-budget/runtime-quality/telegraphs/whitespace exit0. Four isolated in-memory production mutations each failed its intended new test; temporary runner removed. No browser/independent rereview performed by worker.


## VO03 organ atmosphere — 07.10.2026
- Branch `visual/vo03-organ-atmosphere-20261007`, base `b3dec2f`, code/tests `8af0b92`. Full14/4/24 and reduced8/2/12 image pools unchanged; RBC depth bands full8/4/2 and reduced4/3/1, depths-26/-14/-8 with coherent scale/alpha/parallax. Runtime/Heart selection retains all available bands; Heart takes about half budget with minimum3.
- Three existing256px atmosphere backgrounds now bake periodic broad warm vessel flow and oblique Heart fibres. Actor/host/projectile/combat atlas sources unchanged; postFX disabled. Task5 backing compensation remains pending.
- One retained Rectangle replaces every transient flash; depth-6 alpha<=.075, elapsed-ms exponential decay. Single numeric190ms second beat is replaced by newer heartbeat and canceled at stage/shutdown. Visual envelope second peak starts onlyphase>=.22; no gameplay heartbeat/director/AI files changed. Repeated destroy and calls after shutdown are safe.
- Focused contracts9/9 (8 initial RED plus recipe RED), four mutation checks, stages/runtime-quality/impact-budget, VFX12/12, typecheck/whitespace exit0. Initial tuple/reduce type errors corrected. Existing npm http-proxy warning persists. Worker ran no browser or independent review; root owns those gates.


## VO04 audible audio mix — 07.10.2026
- Branch `visual/vo04-audio-20261007`, base `c247ba4`, code/tests/architecture `5c53377`. Pure production `audioMixMath` master.8/music.65, seven bed trims [.47,.37,.71,1.14,2,.32,.5], SFX role gains replace old manifest volumes. Decoded SFX all-channel peak scan once/cache, min(12,.63/peak), silent/invalid1; shoot/hit/pickup throttles unchanged.
- One shared master compressor threshold-8/knee6/ratio4/attack.003/release.12. Separate bed trim before music/duck/filter; procedural layer filter and direct-to-master bio topology preserved. No gameplay/RNG/Joystick/score/save/campaign or AdaptiveAudioDirector decision changes.
- Visibility flag retained before context creation, document hidden fallback, source/resume guards and pending-resume resuspension. Existing abort/request-ID cancellation and gesture retries retained; resume called synchronously within gesture stack. Adaptive transient tones now reclaim on run teardown as well as ended; SFX unaffected by stopMusic.
- Immutable identity-free diagnostics distinguish wanted/loading/actually-playing and decoded actual fallback index from requested deterministic selection; generic error text avoids raw URL/error payloads.
- Focused17/17 production TS math/WebAudio boundary contracts passed; initial13/14 expected RED plus existing throttle PASS. Required audio/save/RNG+checkpoint/typecheck/whitespace checks exit0. Existing npm http-proxy warning persists; no package/lock changes. Worker performed no browser, sample DSP rendering, subagents or independent review; root owns those acceptance steps.


## VO05 recovered core art verification — 07.10.2026
- Saved implementation `fdacc92` retained unchanged on `visual/vo05-art-20261007`; existing generated seven-WebP asset/provenance commit `346638d` is in ancestor history.
- Seven canonical bounded4x backings share ArtMetrics compensation; raw images bake then release after refresh. Boot missing-key preload timeout1800ms and procedural fallback retain logical geometry; all hero/enemy/host scale consumers compensate backing factor. Noncore projectile/RNA/organ/combat sources are unchanged.
- Recovery coverage `3de91b7` adds individual canonical preload guards, production Boot.create fallback ordering for no/partial raw results, and seven exact provenance/hash checks. Core art15/15, typecheck, viewport/tokens/impact-budget/runtime-quality/telegraphs, nonbrowser startup-renderer, VFX12/12, atmosphere9/9, save/RNG+checkpoint/stages and whitespace passed.
- Existing untracked timeout-mutant file retained untouched; it intentionally fails finite-XHR timeout assertion after1800->0 mutation (other11original cases pass). No package/lock/CI changes and no production rewrite required.
- Actual stalled-XHR/engine physics and raster/browser controls/elite/matrix remain root-owned. No browser, push/merge/deploy; final build/CI and real-device MAX/TG gates remain open.


## VO05 stalled-art follow-up — 07.10.2026
- Root actual-browser regression exposed >6000ms stalled startup. Phaser3.90 Loader defaults maxRetries2; File.onError reloads twice, creating3x1800ms windows. Desktop parallel32; Android parallel6 can additionally batch seven assets.
- `9dc9650` sets optional-art retries0 while queueing (restores prior value in finally for unrelated future files) and Boot concurrency max(existing,7). Per-file1800ms timeout unchanged. Core art contract now16/16 includes retry capture/restore and Android6/desktop32 batching policy.
- With root-authorized browser follow-up, actual Chromium Canvas startup available1335ms/missing1102ms/stalled2501ms/Android-UA stalled2673ms, all unchanged6000ms gate. Stalled modes each requested exactly7distinct assets, no retries; Android config default6 and Boot loader7 explicitly confirmed. Private extended copy of root startup test remains untracked for coordinator import.
- Elite fixture now compares actual halfWidth/halfHeight to floor(sourceWorldRadiusX/Y), matching Phaser Body.setCircle/updateBounds; logical tolerance1.01, markers/signatures/centers unchanged. Actual elite script passed against own Vite server with only URL substituted in temporary copy. No physics production changes.
- Typecheck, core16/16, nonbrowser startup-renderer, viewport/tokens/impact-budget and whitespace passed after fix. No push/merge/deploy. Root still owns full geometry/controls/matrix/scoped review and external device gates.

## VO06 Menu/HUD finish — 07.10.2026
- Branch `visual/vo06-ui-20261007`, base20f3b48; decorative implementation8d8d9cd changes only MenuScene/UIScene.
- Menu retains two specimen Graphics/one alpha tween and two static noninteractive selector edges behind existing text/hero/input. HUD90px plate gains a hairline; highlights reuse existing fill Graphics and inherit visibility/fades/pulses.
- Existing health/RNA text/fill timing, launch-once guard, callbacks and input/text geometry remain unchanged. No package/token/gameplay changes.
- Worker passed typecheck, tokens, ui-copy, layout-diagnostics, language1584, viewport, Legendary/impact/VFX smoke and whitespace. No browser evidence provided; coordinator owns browser and scoped review.

## 2026-10-07: Recovered visual overhaul integration

Tasks1–6 recovered/completed; seven generated local core assets, bounded art fallback, compensated geometry and Menu/HUD finish integrated. Final evidence/reviews in docs/visual-overhaul/VALIDATION_20261007.md. NativeHONOR HUD, rollback and Compose passed; real-device MAX/Telegram acceptance remains open. No merge/deploy.

## Hosted CI fixture recovery

PR179 created. Initial hosted failures investigated: Node22 hardware selected reduced in an implicit-full VFX test; uncontrolled RAF phases/random cosmetic placement caused QA parity flakiness; global ring spy included new16px hit ring after lysis108/150. Test-only fixes preserve production behavior and all thresholds. Independent reviews PASS after lazy-sprite and deferred-depth-sort corrections. Native production QA12 cases PASS; comprehension all6viewports PASS. Latest combined head hosted rerun pending. Original failures retained in CI_FIXTURE_REVIEW_20261007.md. No merge/deploy.

## 2026-10-08 continuation facts
Six-frame hero/antibody atlas adds ~1.68MiB RGBA backing plus GPU and uses three poses under reduced/runtime-low. Actual76Phaserbody/display/center rows match original baseline. Combo9999 peak and boss label/bar overlap reproduced and fixed; native6viewportHUD rerun passed. Original54contracts plus biological,12dense renderer/tier cases,4artstartup, audio8restart/0leaks and production-opacity passed. Exact-head build/hosted checks tracked in publication. No merge/deploy; real phones and full soundtrack/charge/death remain unavailable/incomplete. See continuation acceptance and VO traceability.

## Verified HiDPI QA continuation (08.10)
PR180 four exact-head hosted checks PASS at231b38d. QA-only capped2x actual adapter passes local six renderer/DPR cells/fourviewports, paired201actor Text/camera/input/resize, controls and teardown. Production default1x; no phone/offscreen/context acceptance. Source review Codex fallback PASS; additional Kimi403quota blocked.

## Release fixture correction (08.10)
User-authorized179/180/181 merged tomain50c47049. Main CI37763374322 threefailedattempts retained. Two fixture-only scripts corrected without production/timeout/assertion relaxation; exact localPASS, independent source reviewPASS. Fresh hosted checks/deploypending.

## Cardiac clock isolation follow-up
PR182 initial head e1c058e CI37768249337 passed ceremony but failed Cardiac8s. Diagnostic-only14b6d3c CI37769887253 remains running. A local synthetic sparse RAF35ms plus explicit cooldown240 reproduced the timeout: Game active/notpaused/UI clear, boss phase2, stage2649 versus scene16936, nextTelegraph13575 already due, heartbeat3216 safeIndicator true; zero page errors. This demonstrates the mixed-clock scheduling mechanism, not the exact hosted runner conditions (default cooldown120).

Fixture now uses the real heartbeat.restore with nextImpact=stageTime+60000 and bossWasActive=true, with exact60000 setup assertion. Game.update, real Cardiac scheduler and canSchedule, original4700/850/280 source timing,8s/2s/1.5s browser deadlines, exact14damage and heartbeatClear remain. It intentionally does not validate live heartbeat concurrency; unchanged test:pacing separately tests1980/1981 boundary and exclusion. Native exactscript plus paired synthetic stressed fixture PASS; pacing PASS. Independent Codex source review PASS. Additional Kimi OmniRoute review returned empty content and is NOT approval. Await fresh PR/main CI before deploy.

## Hosted progression cause captured and pool reset
Diagnostic-only14b6d3c CI37769887253 failed with Game inactive/paused, UI modalOpen/uiBlocked, awaitingChoice true, stage149ms, bossactivephase2, hazard disabled/serial0 and no errors. This directly proves a new progression choice paused the updater; it does not identify the individual RNA drop. The only ordinary queued-level source is onGemCollected; stage transition was not occurring.

The fixture now uses production-standard deactivateForStageReset for existing bullets/RNA gems, resets host cells and excludes their update/rewards from this beam contract. It asserts zero active bullets/gems. Paired local inherited-RNA100 fixture: baselinef292dc7 paused atstage33ms/queued3/awaitingChoice and failed8s; corrected fixture PASS. Exact corrected script alsoPASS. Thus no onGemCollected/Game.update/hazard method is stubbed, no assertion or timeout is loosened. Host-cell/RNA integration is outside this scoped beam test; other unchanged gameplay/browser suites cover it. Mixed-clock synthetic finding remains separately documented and was not the captured hosted cause.

## Dense readability fixture lifecycle recovery
Final6c84b89 CI37771605821 passed Legendary, Cardiac and controls, then dense-readability failed target150/cache150 with allalpha1. Enemy preUpdate reads prior density; Game.update refreshes cache afterward. Original fixed150ms sleep need not contain both real frames.

Density fixture now waits two actual Scene POST_UPDATE frames with cache>=target, bounded1500ms, before unchanged150/200targets/alpha assertions. This replaces a synchronization assumption, NOT an unchanged performance/timing gate. No manual Game/Enemy update or cache writes. Startup accepts an already-paused real Game, resumes then clears progression/UI; new unblocked assertion added. Exact native finalscript PASS; original native Game.active-only wait had stopped at startup30s. Paired sparseRAF240ms with shared corrected startup: old150ms sleep failed cache100/target150/allalpha1; completed-frame wait PASS. This demonstrates synchronization sensitivity, not the exact hosted scheduling. Independent Codex source review PASS. Additional Kimi nonstream diagnostic HTTP504; no routed approval.
# 2026-10-11 Render migration

Authorized target: Render Free with durable state in existing free Supabase.
Initial export:67scores,4profiles,Telegram user list preserved. Source production
SHAa1e540c49225d9b627f44c291e5a67f3f27c49e7. New hosting entrypoint and durable
adapter tested; no production traffic switched yet. See deploy/RENDER.md.


## 2026-10-11 local cutover continuation
Render public release fb54e0b verified against all54public files and release
hashes; remote revision8 healthy. Canonical DNS still Cloud.ru/a1e540c. Existing
Render key cannot access service workspace; available UI awaits GitHub2FA.
MAX webhook missing in current Render deployment (405), corrected locally with
existing handlers and credential mapping; new HTTP/auth/profile tests passed.
No production settings or Cloud.ru resources changed. See latest00_HANDOFF.

## Исторические добавления Daily #221 (после общего блока)


## Исторические добавления B2/B4 #222 (после общего блока)

# B2/B4 integration follow-up — 20 October 2026

Local edits on `feat/b2b4-integration-20261020`, base SHA `07552995892a83df24665ebc5ff5867809d30042`: CI workflow invokes `test:b2b4-fixes`; that script now includes reduced-motion regression. Cached `src/systems/MotionPreferences.ts` follows current media query preference without per-frame query allocation. `GameScene.shake` respects reduce; `Enemy` pressure-wave and heartbeat auras keep phase identity static; `UIScene` suppresses transition pulse but retains mode color; danger echo and actionable warning rendering remain unchanged. Commands: `npm ci` exit 0; `npm run test:b2b4-fixes` exit 0 (900/900 geometry plus B4 and motion tests); `npm run test:presentation` exit 0; tokens/UI-copy, telegraphs/impact-budget exit 0; `npx tsc --noEmit` exit 0; `npm run build` exit 0 with explicit `VITE_RELEASE_SHA=07552995892a83df24665ebc5ff5867809d30042`. Build warns about runtime-config script and unresolved font URLs as before. Actual browser QA pending root. No commit/push/merge/deploy.

Root validation: actual Canvas/WebGL echo matrix 16/16 passed at320/390/768/1080 with both motion preferences; world/HUD phase and live-preference checks4/4 passed. Adapted repo41 two-postrender/native-decoded screenshot pixel check without pngjs; strict3-cell impact passed, WebGL idle0/hit3982 white pixels. Negative control clearing tint fails as expected. Independent source review found no actionable P1/P2. Final-head full tests/build are tracked externally in12_INTEGRATION_PREP.


## Stage 17 local integration provenance (2026-10-21)
Scoped PR branches deliberately exclude shared memory. Historical snapshots below preserve both parent histories; these snapshots are historical, not current status. Current reports: 17_SCOPED_PR_PREPARATION. No remote merge or publication.

### Daily parent history (verbatim)
# Daily outbox integration preparation — 20 October 2026

Branch fix/daily-outbox-integration-20261020 is isolated from main abdb10c. Applied audited daily-outbox-fix-v3.patch; added exact-ID settlement of migrated in-flight Daily requests and two behavioral regressions. MAX and Telegram coverage checks two offline tickets, account ownership, refreshed credentials, quota failure, missing Daily acknowledgement, lost response/idempotency, concurrent A/B settlement. Focused29/29 passes on Node22.23.3. Broader validation and publication readiness are recorded externally in OFELIYA_MASTER/12_INTEGRATION_PREP; no publication, merge or deploy authorized.

Storage is bounded8+one Daily and best-effort in restricted WebViews. At failed migration/quota, old ticket is retained and network is returned for the new ticket; cannot promise durable storage when localStorage refuses writes. Real MAX/Telegram device acceptance and hosted CI remain pending.

## Previous context

# Visual implementation completion — 16 October 2026

Branch visual/completion-20261016 extends verified public7a0d829 (PR216). Implemented distinct Player mutation geometry/combined composition, unified SocialHub and Codex, measured11px scrolling result report with pinned actions, pointer ownership and long-share fit, quieter pause. Existing gameplay/RNG/physics/score/network/assets/service settings are retained. Main integration is not authorized.

Read docs/release/VISUAL_COMPLETION_20261016.md. Root executed rich result/resumed/share/social/error/allCodex browser320/360/390; presentation and TypeScript passed. Independent source and native visual reviews resolved concrete issues and found no remaining P1/P2. Short live100-spawn AI/physics desktop before/after has p95~16.8ms in Canvas/WebGL, explicitly not device FPS. Final exact-head hosted CI/matrix, fresh backup and pinned deployment/readback are still pending; do not claim publication from this snapshot.

The implementation gaps from the earlier Phase1 ledger are addressed in this branch; old pending statements below are historical snapshots. Device MAX/TG/iOS, sustained performance/thermals, newcomer/full-campaign acceptance remain open. Preserve other PRs and private state backups. Companion documentation branch carries final evidence without changing the tested product SHA after publication.

## Previous snapshots
# Mutation art recovery state — 16 October 2026
Branch fix/mutation-art-recovery-20261016 starts from the verified live visual candidate44c6579 (PR214). Cold-start optional mutation requests can exceed Boot1800ms; fallback previously remained permanent. The scoped fix records canonical texture provenance and recovers only mutation-prism/halo/singularity after first render. Same256px CanvasTexture objects refresh in place; Player/physics/gameplay/assets remain unchanged. Two8000ms attempts/key,750ms backoff; per-game dedup and destruction cancellation. Five module contracts, full presentation and TypeScript passed. Read docs/release/MUTATION_ART_RECOVERY_20261016.md.

Local delayed-image Canvas/WebGL regression passed with sixteen paired actual Player frames and exact packaged pixels. Independent source review found no concrete P1/P2. Remaining before publication: final still-image review, exact-head hosted CI/matrix, fresh private backup and pinned Render Free publication/readback. Owner authorizes continuation/deployment; main merge remains prohibited. Keep PR213/214/215 and other parallel PRs separate. Physical-device/FPS/newcomer acceptance remains open. Update the release document after real results; do not treat this pending snapshot as proof of publication.

## Previous snapshots
# Phase1 visual candidate state — 16 October 2026
Phase0/1 product work is on visual/phase1-ui-20261015, based on main aba70324. Open PR213 contains world art; dependent PR214 contains menu/HUD/mutation/boss/result presentation. Source head d5cae44 is followed by a test-only comprehension synchronization fix: wait for the actual boss reveal to finish before host-lesson assertions. This preserves production behavior and every gameplay assertion. Independent review found no actionable issue in this test delta. Presentation contracts, TypeScript and whitespace checks passed on continuation. Full browser rerun and exact new-head CI must be recorded before publication.

Owner authorized deployment after candidate validation; main merge remains prohibited. Refresh the private pre-deployment backup, deploy the exact green pushed SHA on the existing Render Free service, and verify live SHA/assets/browser/state preservation. Until then production remains the separately verified 30a534f release. Final release/readback evidence belongs in companion PR215 (docs/frontend-overhaul-20261015), starting at FRONTEND_OVERHAUL_PROGRESS.md. Do not deploy the documentation branch.

PR204/207/208/209/210/212 remain separate integration work. Physical MAX/Telegram/iOS, phone readability/input/FPS/thermals, full campaign and newcomer acceptance remain open; later visual phases are not claimed complete. Preserve all prior work and do not infer phone acceptance from desktop fixtures.

## Previous snapshots
# Review follow-ups — 2026-10-15

Branch fix/review-followups-20261015 starts from main30a534f. Owner asked to continue remaining review recommendations. Four targeted follow-ups: Boot/Menu startup recovery now waits for the first usable Menu frame and catches scene exceptions/stalls; CI builds the actual telegram-bot target and imports it with networking disabled and a deadline; registry mirror-write failures lower health until a successful write; profile migration publishes a staged candidate only after its atomic disk write.

RED→GREEN: actual Phaser scene-create failure; registry health on injected disk failure; failed migration remaining claimable and invisible to signed reads. Local server75 plus security/durable/hosting suites, TypeScript, bot contract, startup browser cases and prior review-browser scenarios pass. Independent Luna review found no P1/P2. The final extended startup check, production build and exact-head hosted CI must still be recorded in the PR. Local Docker Desktop could not start; actual image import remains pending hosted CI.

Previous package PR202/203 is merged and was verified published on 14 October: exact main30a534fbf1656979c20434d4f4d724eea69c385f, all three main CI jobs succeeded, Render deploy dep-db7ndmm7bikc73d860lg automatically triggered new_commit and live. Public56 files/API/browser checks passed; all73 scores, existing profiles/registry preserved, Free and /ready retained. Those are prior-release facts, not proof of this branch being live. Physical S20+/MAX/TG, iOS, FPS/newcomer gates remain open. Other agents' open PRs are untouched; recheck main before integration.

## Previous snapshots

# Legacy mini-boss warning follow-up — 2026-10-14

PR202 merged as9a6d327 after green PR CI38559170274. Before publication, an additional
legacy checkpoint edge was found: pre-mini-boss saves can lie inside its new warning.
Follow-up consumes that restored encounter, matching the wave-warning policy; saves
before the warning still get the complete mini-boss warning. Actual production-method
regression observed warning+spawn before the fix, then no partial replay; future warning
remains full. Main CI38560367835 was cancelled to hold publication for this fix.
Run final exact-head/main CI and verify runtime identity; do not treat cancelled CI as PASS.

# Review48 P2 fixes — 2026-10-14

Owner approved four fixes in order: pre-wave checkpoint migration, anomaly lifecycle,
wave warning resume, proxy rate isolation. Implementation branch fix/review48-p2-20261014
starts at a0faa496. Tests reproduced each defect before its fix.

Implemented: real base6a5cf5be fixture retained; only additive missing streams derived
for legacy v2, original six streams mandatory. Anomaly state machine and damage use
combat-phase authority. New saves are suppressed during pending wave warnings; old
mid-warning snapshots consume that event without redrawing RNG or short warnings.
Verified actor counters are separated from anonymous counters and proxy backstop;
anonymous retries/churn cannot drain or evict signed budgets. XFF remains untrusted
unless the explicit connecting proxy policy permits it.

Local evidence: checkpoint/RNG, anomaly-runtime6/6, actual Phaser lifecycle (frozen HP,
transition reaches Heart, normal damage retained, real safe/pending save wiring),
proxy HTTP flood +20,001-key eviction regression, TypeScript and existing browser
review regressions passed. Server core75 + security/durable/hosting suites passed;
final post-review suite/build and exact-head hosted CI must be recorded in PR.
Independent whole-branch reviewer found actor-map eviction; corrected with separate
signed counters and watched its regression fail then pass. Remaining native device,
FPS/newcomer gates are open. Startup scene-boundary and telegram-bot CI build gaps
are P3 follow-ups, outside these four fixes.

Production known at task start: Render Free a0faa496, manual deployment
 dep-db7l3j7avr4c738l7mqg. This source change has not yet been published. On release,
verify exact SHA, backup, readiness/hash parity; observe auto trigger before manual
fallback because GitHub repository access was corrected. No secrets, DNS, bot identity,
paid resources or real user messages changed by implementation.

## Previous snapshot

# Render investigation — 2026-10-14

PR #199 is merged as `51b910a0e8031ca477daf701ca1de1b31023cf01`.
Final PR CI [38441586488](https://github.com/timoshinoleg-eng/ofeliya/actions/runs/38441586488)
and main CI [38443697280](https://github.com/timoshinoleg-eng/ofeliya/actions/runs/38443697280)
passed build, browser-smoke and production-contract. Merge used `[skip render]`.

Authenticated dashboard inspection used `timoshin.oleg@gmail.com` and service
`srv-db5ro5vlk1mc73b0v0eg`. Visible settings: GitHub repository
`timoshinoleg-eng/ofeliya`, branch `main`, empty root directory, Auto Deploy
`After CI Checks Pass`; no included build paths; ignored paths `memory/**`,
`PROJECT_IDENTITY.md`, `deploy/RENDER.md`; health check `/ready`.
The account has GitHub login `timoshinoleg-eng`. These are UI observations,
not proof that GitHub events/checks reach Render successfully.

The live `c0c72fa` deployment `dep-db6vmg4s728c73cv4010` and four earlier
entries show trigger API; the initial deployment shows First Deploy.
GitHub installation `88263801` was active but restricted to only
`junior_middle_it` and `coder_survival`; `ofeliya` was missing from selected
repositories. This is a concrete integration access defect, consistent with
missing automatic deployment events; historical webhook delivery was not inspected.
With explicit owner approval, only `timoshinoleg-eng/ofeliya` was added and Save
clicked. GitHub redirected to Render with `setup_action=update`. Reopening the
installation confirmed three saved repositories, including ofeliya, and disabled
Save/Cancel controls. Other repository grants and the permission set were preserved.
No API key was created or recovered; no manual deployment, service setting or
production data was changed. A fresh service Events check after Save still
showed 35 entries, no new deployment and live source `c0c72fa`.

Repository access is corrected; end-to-end automatic deployment is not yet
verified. The maintenance merge's `[skip render]` deliberately suppresses that
commit, so it cannot validate the fix. Historical trigger attribution remains
unproven beyond the observed access defect.
On the next authorized runtime release, use a commit affecting included paths
without a Render skip phrase, confirm all checks on the exact main SHA, then
observe a Render automatic deployment of that SHA before manual/API fallback.
If absent, inspect events, repository grants and GitHub event/check delivery.
Reference: https://render.com/docs/deploys and https://render.com/docs/monorepo-support.

## Previous snapshots (current findings above take precedence)

# Telegram image and maintenance verification — 2026-10-13

PR #199 fixes the latent dedicated `telegram-bot` image dependency omission
on branch `fix/telegram-bot-image-20261013`, based on main `f48c143`.
`bot.mjs:23` imports `telegram-webhook.mjs` at module scope. The old bot stage
copied only bot.mjs and telegram-api.mjs. RED `d9fb1c7` fails the added COPY
guard; GREEN `360c05b` passes after copying the missing helper. The guard scopes
COPY source/destination checks to the bot stage and is already wired into CI.
Both actual Docker images build; with `--network none`, the old Node22 image
import fails with `ERR_MODULE_NOT_FOUND` and the fixed one succeeds. Local
server tests (75 core plus all additional suites) and TypeScript/Vite build pass.
Existing CI builds runtime/score/static, not telegram-bot; contrary external
handoff text is inaccurate. No workflow expansion was made in this package.

PR #189 closed with a supersession comment linking current and archived handoff.
Remote branch `codex/render-migration-handoff-20261011` still exists. The stale
security-patch backlog claim is corrected: PR #197 already includes equivalent
and stricter policy/security regressions. The backup patch must not be applied
wholesale.

Render live investigation is pending authenticated working-account access.
No Render API credential was found in process environment, Documents/Codex,
repository, Desktop or the checked local config/credential stores. This is an
access limitation, not evidence about Render's provider or trigger. No settings
or production data were changed. The prior release facts below are historical
evidence, not a fresh authenticated API check in this follow-up.

# Verified review-fix release — 2026-10-13

Runtime source: c0c72fa81690b562e15c1d87580c66af842b3f3b (PR197 merged). Main CI38375891119: build/browser-smoke/production-contract success. Render Free deployment dep-db6vmg4s728c73cv4010 is live in production workspace tea-d8iruouq1p3s73f30a90 (timoshin.oleg@gmail.com). Canonical https://ofeliya.freeveol.dpdns.org/ofeliya/ reports this SHA. Metadata-only commits after this release do not change the published source identity.

Measured:56 public files match a local build using current production VITE values;47 exact and9 differing only in carriage-return line endings. Remote HTML/runtime-config/SW hashes match their release marker exactly. /ready200 aggregates configured MAX/TG and healthy API; Render healthCheckPath is /ready. Eight synthetic signed profile/social reads and both webhook auth gates passed; no test scores or fake registrations were written. Browser menu and actual touch start reached the first mutation without page errors/CSP violations, QA hooks absent. This is desktop Chromium, not a real phone.

Private S3 backup revision78 (13094bytes) was downloaded and verified; isolated restore started the new server with71scores and validated registry. Published state preserved all baseline scores/profiles/registrations. After a Render restart, revision80→81, all71scores and existing profiles/registry remained. source-map-js1.2.2 is merged; superseded draftPR184 is closed, branch preserved.

## Historical snapshots (current verified facts above take precedence)

# Current review fixes — 2026-10-13

Branch fix/kimi-review-20261013, based on main26fcc88. User approved the independent review follow-up plan. See docs/release/KIMI_REVIEW_FIXES_20261013.md for contracts, tests and mixed-version policy. Previous handoff is archived under memory/archive/2026-10-13-before-review-fixes/; older state/decisions/backlog remain as historical notes below.

Confirmed: local TypeScript/QA build, server75/75 plus migration/security/durable suites, browser startup/lifecycle/CSP, gameplay gates and npm audit zero. Hosted CI/deploy/device evidence pending.

## Historical notes (snapshot-specific; current facts above take precedence)

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

# Production state - 2026-10-11

OFELIYA is live on Render Free ofeliya-game (srv-db5ro5vlk1mc73b0v0eg),
Frankfurt, main/checksPass, canonical https://ofeliya.freeveol.dpdns.org/ofeliya/.
Runtime d92325b1c83259fbbebd4e02331826fd98982a5e includes merged PR190/191.
MAX/TG protected callbacks and /ofeliya/api/* work; prepared Telegram sharing
returned200. Remote Supabase state is healthy; restart restored67scores,
551events, and existing profiles. All54 assets and release hashes passed.

Cloud.ru OFELIYA VM,30GB disk and IP are deleted (GET404 for each); its deploy
workflow is disabled. Other three VMs, their resources and two Quiz backups
were preserved. Account-wide Cloud.ru charges are not claimed to be zero.
Real Telegram/MAX device /start and save/reopen remain external acceptance.
See memory/00_HANDOFF.md for verified IDs and evidence limits.

Supabase state access key was rotated in the existing Free project. The new
Render uses the replacement; the old key returns401 for read and writer claim,
so the inaccessible preview cannot steal production persistence. A 24-hour
management token was scoped only to this project and Edge Functions. No keys
are committed. Main CI38158081443 passed all three jobs for runtime d92325b.

## Historical notes

# STATE — OFELIYA: STRAIN ZERO

Обновлено: 2026-10-05. Только факты; решения — в `02_DECISIONS.md`.

## Control smoke precondition (06.10)

- Main `3a04868` browser smoke failed the synthetic recycled pointer test while a live level-up mutation modal had `uiBlocked=true`; both down callbacks correctly rejected input, leaving ids `-1` and vectors zero.
- Test-only Game update freeze is installed before scene start for all three control modes; active UI is explicitly required to be modal-free and unblocked.
- Focused `control-mode-smoke.cjs` passed locally; production code was not changed.

## Standalone deploy compatibility policy (05.10)

- Production run `37370394631` reached the server, passed CI/release floors, then failed because a helper sibling was absent from the selected script extraction directory `/tmp`; automatic rollback to `edb1b9a...` succeeded and public release marker confirmed it.
- `deploy/deploy-cloudru.sh` now reads the compatibility helper from fetched `origin/main` into a variable, rejects failed, empty, or whitespace-only loads, and pipes the policy to `bash -s`; no dependency on script location remains.
- The three CI jobs use `ubuntu-22.04`. Existing rollback contract test now executes the actual deploy guard for valid, old, invalid, missing-helper, and empty-helper cases.

## Targeted deploy CI lookup (05.10)

- Deploy job now uses `ubuntu-22.04` and requests workflow-specific `ci.yml` runs filtered by exact release SHA, main branch, push event, completed status, and up to 100 results.
- The inline validator retains all five acceptance predicates; missing matches report counts and up to five same-SHA run identity/status summaries.
- Root reported hosted runner acquisition failures for prior deploy/main-CI attempts; exact-SHA CI run `37360675706` was independently confirmed green for main SHA `42b9f30a3feb8f219faf41014f0bfdd6bf27b5dd`.

## Deploy workflow payload (05.10)

- Branch `fix/deploy-ci-payload-20261005` is based on main `42b9f30a3feb8f219faf41014f0bfdd6bf27b5dd`.
- Deploy run `37362076056` failed before bastion access because the large Actions runs JSON was passed as an environment variable, exceeding Linux `MAX_ARG_STRLEN` and preventing Node startup (exit 126).
- The successful-main-CI workflow step now reads its JSON payload from a temporary file while preserving its five run identity checks and fail-closed behavior.

## Репозиторий

- GitHub: `https://github.com/timoshinoleg-eng/ofeliya`
- Ветки: `main` (актуально); `feat/donor-quick-wins` @ `e5b6658` — историческая (не обновляется; актуальный код — в `main`); `fix/audit-blockers`, `backup/audit-blockers-0ecbf3c` — архив.
- Remote (02.10): `origin/main` @ `4bce5a0bdfd996cbda4447d1eefdfbdb2c9531bc`; рабочая ветка этой сессии — `feat/product-validation-funnel-20261002` от указанного main.
- Worktrees (локально): `…\work\ofeliya-audit` (main), `…\work\ofeliya-audit-fixes` — переведён на состояние `origin/main` (`808d866`); локальная ветка трекает `origin/main`.
- Приёмка: PR #151 (`dc71cb2`), PR #152 (`2df55bb`, `06_REVIEW.md`), PR #153 (`808d866`, финал) смержены 29.09; пост-ревью правки — PR #154. Система памяти — в `main`.

## Продукт

- OFELIYA: STRAIN ZERO, `v0.4.1-rc.1` (по локальной копии от 26.09), portrait roguelite-survivor для MAX Mini Apps.
- Кампания: КРОВОТОК → IMMUNE PRIME → СЕРДЦЕ → CARDIAC TITAN (≈9+ мин до боссов).
- Стандарт/Strained сложности; Legendary ≤2 за прогон; trusted score backend.

## Гейты

- CI: build gate + browser gate (`ci.yml`); `release-visual-matrix.yml` (100/150/200 × WebGL/Canvas × full/reduced).
- Внешний гейт: реальные MAX Android/iOS — 16 пунктов (`RELEASE_VALIDATION.md` §8). **Не пройден.**

## Инфраструктура и прод

- Деплой: Cloud.ru (`deploy/deploy-cloudru.sh`, `compose.production.yml`, `Caddyfile.ofeliya`, `nginx.conf`).
- Ремарка: зелёный CI означает консистентность репозитория, не «на VM крутится именно этот коммит» — проверять отдельно.

## Инструменты (пилот)

- Ноут 1 (Honor): OpenCode (основной), Cline (запасной), Codex desktop.
- Ноут 2 (HP): OpenCode (второй), Cline (запасной).
- ChatGPT web: Project «Офелия» — внешний ревьюер (обычный чат, не Work).
- Память: `memory/` в репозитории; контекст: плагин context-mode (проверен: v1.0.169 отвечает в сессии); доп. слой: cross-agent-memory MCP.
- Пилот, статус 28.09.2026: этап 0 — архив копий; этап 1 — память в репо; этап 2 (Honor) — OmniRoute сервер работает, OpenCode → комбо `omniroute/OFELIYA-CODE` (живой тест ✓), скиллы gamedev 74+router (единый источник `~/.agents/skills`), Superpowers установлен плагином. Этап 4 (ночь 28→29.09, Honor): тест-цикл B пройден — OpenCode 1.18.33 (ctx stats ✓, память без пересказов ✓, смена модели OFELIYA-CODE → BACKGROUND-REVIEW с сохранением контекста ✓); smoke-тесты onboarding/daily-history/comprehension зелёные; ревью 3/3 подтверждено + коррекция (регрессий в UIScene нет).
- Дальше: этап 3 — HP (блок A чек-листа); ChatGPT-вариант ревью — опционально.

## Product validation 02.10

- First-run onboarding перестроен на реальный core loop: движение → автоогонь → RNA → мутация → заражение клетки-хозяина; шаг «пауза» удалён из tutorial.
- В `RunSnapshot` добавлен `hostCellsInfected`, чтобы UI мог завершать onboarding по реальному заражению.
- Аналитика дополнена событиями `run_start`, `run_60s`, `boss1`, `heart`, `win/death`, `replay`, успешный `share`, запуск `daily`, referral-open, `onboarding_step`, `onboarding_exit`.
- Добавлен CLI `analytics:funnel`: unique-actor funnel, first-60s timing/exits, D1 и referral open → run_start.
- Добавлен формальный 16-пунктовый evidence validator `test:mobile-evidence` и документ `docs/PRODUCT_VALIDATION_2026-10.md`. Реальная Android/iOS приёмка всё ещё НЕ выполнена: валидатор проверен только на синтетическом fixture.
- Проверки ветки: `test:onboarding` ✓, `test:analytics` ✓, `server:test` 68/68 ✓, `test:comprehension` ✓ на 6 viewport при запуске текущей ветки на :5194, `test:result-actions` + checkpoint-resume ✓ на текущей ветке, `test:daily-cta` ✓; production build ✓ при явном `VITE_RELEASE_SHA` текущего base SHA.

## Открытые вопросы / риски

- Баланс полных прогонов и Heart timing — только через плейтест (CI не решает).
- Термика/перформанс на целевых телефонах — внешний гейт.
- PR #151/#152: merge выполнены; CI был зелёный (build/browser-smoke/production-contract).

## Audit revalidation 03.10
- Rechecked v2 audit findings D1/D2 against the current PR #157 branch, not historical commit 53ff997.
- D1 (elite collision radius) is a false positive: Phaser Arcade setCircle() uses source pixels and scales the actual body; runtime smoke now asserts collisionRadius ~= Enemy.radius for elite scale 1.45.
- D2 (blocking overlays on viewport rotation/resize) is fixed in UIScene: level-up and result overlays retain their source viewport, scale into the new viewport, and expand the scrim to cover it.
- Regression coverage: mutation-choice smoke checks 390x844 -> 568x320 with an open level-up modal; existing mobile-layout matrix checks result resize. Real Android/iOS MAX acceptance is still required.

## Telegram production wiring 03.10
- Branch `feat/telegram-production-wiring` prepares the current shared OFELIYA frontend/backend for Telegram production without changing MAX ownership.
- Telegram CSP/Web embedding, optional fail-closed deploy env, dedicated long-polling bot service, shared referral data volume, and deploy parity checks are implemented.
- Telegram remains disabled on production until `TG_BOT_TOKEN` + `VITE_TG_BOT_USERNAME` are supplied; BotFather Main Mini App must target the canonical OFELIYA URL.
- Fixed Telegram `/start <payload>` long-polling dispatch to parse the original message text.

## Telegram edge rollout fix 03.10
- First production rollout of #158 correctly failed public parity and rolled application containers back to 56476c0: nginx had Telegram CSP, but local Caddyfile.dedicated remained MAX-only.
- Hotfix branch fix/telegram-edge-caddy-rollout versions the edge route policy through a renderer and safe Caddy validate/reload path with local-config restoration on failure.

## Telegram webhook production fallback 04.10
- Cloud.ru Docker outbound TLS to Telegram Bot API is unreliable even with the reachable pinned IP; do not treat an Up long-poll container as acceptance.
- Production path now supports Telegram webhook at /api/telegram/webhook with X-Telegram-Bot-Api-Secret-Token validation.
- Webhook responses return inline sendMessage methods with a Web App launch button, so /start and /help require no outbound Telegram API call.
- When outbound Bot API is disabled, prepared-share fails locally and the client falls back to t.me/share/url without a 3.5s timeout.


## 2026-10-05: продолжение Sol6.1 remediation

- Основа origin/main edb1b9a (Telegram webhook), ветка fix/sol61-review-remediation-20261005. Восстановлены R01/R02 и незавершённый R03 из отдельного checkout без изменения исходного каталога.
- R01 wall clock Daily; R02 резерв verified capacity; R03 ID-aware ordinary outbox; R04 reload отложен до завершения Game (internal game reference, production без QA hook).
- R05 outbound defaultoff + explicit Compose env; R06 webhook-compatible SHA floor в workflow/select/rollback и direct deploy; R07 shared polling/webhook direct-link payload и group-safe кнопки.
- R08 onboarding completion callback; R09 analytics actor60/min; R10 credentials scrub+7dayTTL обоих outboxes.
- Независимое GPT-6.1 Sol ревью дополнительно выявило Daily409 blocking, смену uid внутри одной платформы и ack-before-durable. Исправлены terminal Daily409, exact-ID Daily settlement, local ownerId replay guard, fresh-user Daily slot supersession и synchronous atomic flush score/run/start/daily/run до non5xx ответа. Unknown legacy ordinary entries не replay: истекают поTTL, предотвращая присвоение чужому пользователю.
- Проверки: server75, outbox24, новые release4/onboarding/rollback/server-policy/renderedCompose; браузер score/comprehension6viewport. Полный локальный набор43гейта: первый startup5.124s при параллельной браузерной нагрузке и Caddy sh ENOENT; serial startup и Caddy с GitBash PATH прошли. Исходные failures сохранены в evidence.
- Cloud creation недоступен аккаунту; пользователь разрешил local. Deploy/merge не выполнены. Публичный release.json недоступен; текущая productionSHA НЕ подтверждена. Real-device MAX Android/iOS16/16 остаётся открытым.
- Анализ второго вложения: WOFF2 валиден, кириллица отсутствует. Не считать разрешённые словарём ФОРМА МУТАЦИИ/MAX ИЛИ TG/СТАНДАРТ ошибками; предложить небольшой кириллический typography trial, затем RU catalog; fullEN i18n после продуктового решения.


## 2026-10-05: делегированные UI follow-up

Ветка refactor/ui-copy-layout-followup-20261005 собрана поверх PR168 HEAD4f65c4f. PR168 остаётся отдельным remediation пакетом, его CI прошёл; merge/deploy не выполнены.

Space Bunny через OpenCode (opencode/space-bunny-free) создал типизированные варианты control labels и каталог rarity/build-summary: исходный code7a7d08e, здесь cherry-pickd63b80c. Существующие RU strings и поведение сохранены; full/compact/tiny намеренно различаются. Upgrade-id completeness контролируется runtime контрактом, не исчерпывающим TS union.

GPT-6 Sol создал рекурсивный диагностический collector для видимого текста в Container и18Legendary regression cases: исходныйcodeea086d1, здесь4f5cbfc. Production UI/Legendary layout не переделывался: actualPhaser18cases без overflow, max2lines. Matrix fixture теперь учитывает автоматический startuplevel-up pause и проверяет checkpointsave явно.

GPT-6 Luna независимо проверил обе задачи; no functional findings. Coordinator подключил новые Node/browser gates кCI и закрепил равные stackcounts в golden test. Browser suite budget15мин вместо10 из-за дополнительной18-case проверки, пороги assertions не увеличены.

Локальная отдельная приёмка: catalog/language/tsc; layout diagnostics; Legendary18/18; mobile matrix320x568,360x640,360x760,390x844,412x915 + restart-safe resume/result resize. Итоговый CI этой ветки нужно смотреть по headSHA draftPR, не переносить результат PR168.

Шрифтовой prototype находится отдельно в PR169: opt-inPlay400/700, no productiondefaultflip. CI обнаружил import.meta/CommonJS regression и отсутствие releaseSHA в visualworkflow; автор исправляет отдельно. Не считать старый Play CI зелёным.

Текущее второе мнение: MAX ИЛИ TG прямо разрешён languageBible100; PR168 меняетUIScene;452/419 без методики не новый замер; T-КИЛЛЕР/T-КЛЕТКИ действительно расходятся вproductBible. Имена/редкости/юридические тексты/fulli18n не изменять без продуктового решения.

Внешние релиз-гейты: реальные MAX Android/iOS16/16, TG launch/referral/Daily и publicrelease.json exactSHA остаются неподтверждёнными. Не выполнять merge/deploy автоматически.

## Legendary compact-card clipping fix (05.10)

- Linux layout evidence at 320x568 showed three Legendary effect strings wrapping to three lines while UIScene capped the badge text at two. `UIScene.ts` now measures wrapping and grants a third line only to a compact Legendary effect that needs it; its plate expands to 42px and shifts upward to center y=21, ending at y=42 before the footer starts at y=43; card height stays 124px. Other card effects keep their prior 2-line limit and plate size. Copy and `UiCopy` imports are unchanged.
- Focused layout probe now accepts the bounded 42px effect plate while still comparing actual text bounds against it. Root reports the 18-case Windows browser probe passed on this exact working diff. Local typecheck, `test:legendary`, `test:mutation-copy`, and `test:tokens` passed.
- Code commits `340f38b7f8f2be2fc9be49c6b06cf49d45151d2e` and overlap correction `997b6eee2403505e1a416fd5d2755496c30728e`; root owns final probe rerun and full branch CI. No push/merge/deploy here.


## Final Legendary geometry and probe guard
- Corrected candidate `997b6eee2403505e1a416fd5d2755496c30728e` supersedes the earlier center-y=31 version, which overlapped the footer. The compact three-line panel is now center-y=21, bounds y=0..42; the Legendary footer begins y=43. Probe now requires description/footer fixtures and rejects text-bound intersections.
- Root reports the browser 18-case check plus desc/footer intersections pass on the corrected geometry. The stricter fixture-presence probe guard was added afterward; root should rerun it against final HEAD before push. No push from this worker.

## Compact Legendary description spacing follow-up (05.10)
- After Linux showed effect/description overlap, compact Legendary reward cards now use height 136px (other compact level-up cards remain 124px). At 320x568, three cards span y=122..548. The effect plate remains 42px high at local y=6..48; footer starts local y=49, and description moves up to local y=-22. No effect font-size, copy, or gameplay changes.
- Focused probe JSON now includes effect, description, and footer bounds and rejects missing fixture text or intersections. Root's Windows 18-case verification passed on this change. Typecheck plus Legendary, mutation-copy, and token checks passed. Focused Linux CI is pending; earlier Linux result showed description overlap.
- Code commit `29457d658e309ee87fadffd30c565528a11d6405`; root workflow-order commit `04392af` runs the focused layout gate early. Root is handling push and Linux CI.

## Release closure: visual matrix stamp + gate documentation (05.10)

- Отдельный bounded checkout поверх `1d6bb37` (ветка release closure). Коммит `a32b3f2`.
- Подтверждённый дефект: `.github/workflows/release-visual-matrix.yml` задавал `VITE_RELEASE_MATRIX_QA=1`, но не `VITE_RELEASE_SHA`, поэтому `scripts/stamp-release.mjs` падал со `VITE_RELEASE_SHA must be an explicit 40-character git SHA`. Добавлена строка `VITE_RELEASE_SHA: ${{ github.sha }}` — тот же источник, что и в `ci.yml`.
- Документация: `RELEASE_VALIDATION.md` и `README.md` теперь различают документированный quick check list (подмножество) и авторитетный полный гейт (`.github/workflows/ci.yml` + visual matrix workflow). Явно зафиксировано, что зелёный CI не означает приёмку на реальных MAX/iOS/Telegram клиентах.
- Задокументирован `npm run test:mobile-evidence -- PATH`: 16 обязательных id (8 Android + 8 iOS), пять обязательных полей на запись, и перечень требований, которые валидатор НЕ проверяет и которые остаются ручными (BackButton, haptics, audio unlock, restart-циклы, boss pacing, Heart timing, twin-stick ergonomics, реальные legal values, trusted score с подписанным `initData`). Существующая ручная матрица §8 не изменена.
- `.gitignore`: добавлено ровно одно правило `artifacts/mobile-acceptance.json`. Проверено, что `artifacts/other.json` остаётся видимым для git; tracked paths под `artifacts/` отсутствуют.
- Локальные проверки: `npm ci` 0; `git diff --check` 0; `npm run test:tokens` 0 (`ui tokens contract: ok`); `npm run build` при `VITE_RELEASE_MATRIX_QA=1` и `VITE_RELEASE_SHA=$(git rev-parse HEAD)` — 0, `Stamped OFELIYA release 1d6bb37...`. Валидатор evidence не запускался: реальных device evidence нет.
- Реальные MAX Android/iOS 16/16, Telegram launch/referral/Daily и public `release.json` exact SHA остаются неподтверждёнными. Push/merge/deploy не выполнялись.

## Уточнение описания mobile-evidence валидатора (05.10)

- Коммит `d976778`, только README.md и RELEASE_VALIDATION.md. Семантика валидатора не менялась.
- Первая формулировка была неточной в двух местах. Проверено чтением `scripts/check-mobile-acceptance-evidence.mjs` и запуском на синтетических fixture: exit 0 при 16 обязательных id; exit 0 при тех же 16 плюс две дополнительные строки; exit 0 при `testedAt: "October 5, 2026"`; exit 1 при 15 обязательных id (даже с лишней строкой); exit 1 при `testedAt: "not-a-date"`.
- Итог: 16 id — это обязательный минимум, а не точное и исчерпывающее число. Валидатор итерирует только по своему массиву `required`, поэтому дополнительные строки `checks[]` разрешены и не инспектируются — `pass` их не подтверждает.
- `testedAt` проверяется через `Date.parse`, то есть принимается любое разбираемое значение даты/времени; ISO 8601 рекомендуется для читаемости, но не является требованием.

## Viewport-guarded Legendary card expansion (05.10)
- Final code commit `c01019f0708d9740cfc7a3f84da29bba149eed55` only selects 136px compact Legendary cards when the proposed full stack fits below the measured subtitle plus one card gap and above the bottom one-gap margin. Otherwise compact cards stay at the original 124px and their effects stay capped at two lines. At 320x568 the three-card stack fits; at 568x320 it does not expand.
- Probe emits card, effect, description, and footer bounds and asserts full text, required fixtures, panel containment, and no effect/description/footer intersection. Root reports the supplemental 18-case two-reward probe passed across 320x568, 568x320, and 390x740 on the fit guard. Typecheck and static Legendary/copy/token checks passed. Focused Linux run `37293956036` passed the earlier description-spacing version; root owns the final Linux run after this viewport guard.

## 2026-10-05: многокарточный Legendary probe
- `scripts/legendary-layout-probe.cjs` обновлён в `a4fd334f1f1b319d5a6016026a6689ef757eaceb`.
- Оставлены одиночные карточки; добавлены 15 distinct pairs actual Legendary definitions на viewports 320x568, 360x640, 390x740, synthetic three-Legendary layout fixture на этих размерах и guard fixture на 320x520.
- Per-card checks локализованы в родительском Phaser container. Первый browser run: 87/88; single и pair cases прошли. Один synthetic-three 320x480 failure вызван subtitle overlap на стрессовом fixture; его скорректировали до 320x520 для проверки compact-fit / expanded-no-fit guard. Повторный browser run прошёл 88/88 (24 singles, 60 pairs, 3 synthetic-three, 1 guard); short fixture 320x520 сохранил 124px cards, 9px subtitle gap, no overflow. Независимое review выполняется; Linux CI и real-device validation остаются pending. Первый Linux CI остановился до проверок из-за default URL 5197 вместо workflow Vite port 5173 (connection refused, `work/multicard-linux-plain.log:190`); probe default исправлен, rerun pending.

## 2026-10-05 Linux probe follow-up
- Linux run after restoring CI's port-5173 fallback executed 88 cases: 87 passed. All 15 actual Legendary pairs across each viewport and all single-card scenarios passed. The sole failure was the synthetic three-card short guard at 320x520, where a three-line effect reached the deliberate compact 2-line cap on 124px cards (`work/multicard-linux-plain2.log`).
- This is a stress-fixture content limit, not evidence of a trophy issue: the actual guaranteed trophy offers two cards. The taller synthetic long-effect stress case remains; the short guard now chooses definitions 0, 2, and 5, with effects fitting within two lines, while retaining all actual pairs at 320x520. Browser rerun and independent review pending. Linux build/test suite and device acceptance are not claimed passed.

The next Linux run exposed that short-guard index 3 also wraps to three lines. Measured wrap counts for the six definitions are `[2,3,2,3,3,2]`; the fixture now selects indices 0, 2, and 5 (index 5 is the last-life-saving Legendary), all measured at two lines. The 320x520 guard isolates height fitting; no Linux pass is claimed until rerun.

## VO-01 diagnostics-first — 07.10.2026
- Branch visual/vo-01-render-clarity-20261007, base d7797bc67bbda063d2fc3de68026101b0b061121, code/tests/docs 582723032b060f690eb59dac933c60834d0969a2.
- Runtime RED observed: Menu ready, __renderSnapshot undefined. Added bounded on-demand snapshot under existing DEV/QA gate; ordinary production runtime opacity passed.
- DEV and QA production browser 6/6 each: WebGL/Canvas DPR1/2/3, Menu/Game/two resizes/resume; local buffer remains CSS/logical size, no general HiDPI enabled. Text style/source resolutions recorded independently.
- Local startup, viewport, control modes/CDP multitouch, layout diagnostics, typecheck, ordinary + QA builds, tokens, runtime-quality, challenge, language checks passed. Builds stamped base SHA, not new code HEAD. Full commands/intermediate failures/warnings in docs/visual-overhaul/VO01_VALIDATION.md.
- Separate npm ci created ordinary local node_modules (Phaser 3.90.0), not a shared junction. npm/esbuild/git sandbox failures required approved escalation retries. No gate weakening or config/auth/route/skill changes.
- Kimi invalid API key artifact excluded; independent review coordinator-owned and pending. Local work/ evidence, .vo01-npm-cache and failed Kimi artifact intentionally untracked. No full CI/device acceptance/publication.

## VO01 Kimi fix round1 — 07.10.2026
- c231d60ebcf5748b9a2a2d2c5bbf99ca39adaa5a addresses F1-F5, F6/F8/F10. Successful text-only Kimi review now committed as docs/visual-overhaul/VO01_KIMI_REVIEW.md; old invalid-key artifact overwritten. External credential recovery was coordinator work; no auth touched here.
- Missing-scene runtime test observed null.cameras RED then GREEN. QA matrix 6/6, ordinary production static hook absence and runtime opacity, typecheck and builds passed. Actual commands/failures in VO01_VALIDATION.md. Builds stamped preceding 6204e33, not c231d60.
- Nested test objects destroyed; progression freeze remains fixture-only. Visible handler dispatch is not hidden transition. RESIZE intrinsic=CSS assertions pin current baseline, no HiDPI enabled.
- Original pipeline coordinator owns branch import/review/acceptance and broader plan. No additional workers, publication, configs/auth/routing changes; local cache/evidence excluded.


## VO02 combat presentation — 07.10.2026
- Branch `visual/vo02-combat-20261007`, base `a4d20d1`; code/tests `ddbe943`. Existing four retained emitters now select baked spark/chip frames from one 200x40 Canvas atlas (10 palette colors, 20 frames), providing renderer-independent event colors.
- Bullet-hit presentation receives existing normalized velocity and victim radius; directed spray originates at the incoming membrane surface. Legacy three-argument calls stay centered/radial. Death presentation receives radius only. Gameplay damage/knockback/event ordering, actor/projectile sources, Joystick, ImpactDirector, VfxBudget and disabled camera postFX are unchanged.
- Death chips and sparks share one token grant; 40% rounded down become chips. All VfxSystem circles are retained in a full12/reduced6 pool, including singularity core/collapse and delayed rings. Ordinary traffic reserves3/2 slots; important feedback preempts oldest ordinary then oldest important. Runtime scale<=.65 trims to6 immediately. Completion hides/reuses; explicit destroy and scene shutdown cancel tweens and reclaim circles/four emitters idempotently.
- Focused Node boundary contracts 8/8 passed; `test:impact-budget`, `test:runtime-quality`, `test:telegraphs`, `npx tsc --noEmit`, `git diff --check` passed. Six focused contracts were observed RED before implementation. No browser was run by this worker; coordinator owns real Phaser Canvas/WebGL and matrix acceptance plus independent Kimi review. This is focused task validation, not final release acceptance.


## VO02 Kimi fix1 tests — 07.10.2026
- Coordinator reports Kimi scoped code-correctness PASS, no Critical findings, four Important nonblocking coverage gaps. Worker verified current production behavior and added only test cases in `04f56f7c849a01d11b508fcfd5e67bdd89c1a1d1`; production source unchanged.
- New coverage: mixed ordinary/important runtime shedding retains all six important effects; important preemption cancels old tween and manually injected stale completion neither hides nor releases replacement; far black/white palette selection and genuine white/immune nearest tie; ordinary pool saturation blocks a hit ring while hit particles retain separate shared-budget accounting.
- Focused contracts now 12/12, plus typecheck/impact-budget/runtime-quality/telegraphs/whitespace exit0. Four isolated in-memory production mutations each failed its intended new test; temporary runner removed. No browser/independent rereview performed by worker.


## VO03 organ atmosphere — 07.10.2026
- Branch `visual/vo03-organ-atmosphere-20261007`, base `b3dec2f`, code/tests `8af0b92`. Full14/4/24 and reduced8/2/12 image pools unchanged; RBC depth bands full8/4/2 and reduced4/3/1, depths-26/-14/-8 with coherent scale/alpha/parallax. Runtime/Heart selection retains all available bands; Heart takes about half budget with minimum3.
- Three existing256px atmosphere backgrounds now bake periodic broad warm vessel flow and oblique Heart fibres. Actor/host/projectile/combat atlas sources unchanged; postFX disabled. Task5 backing compensation remains pending.
- One retained Rectangle replaces every transient flash; depth-6 alpha<=.075, elapsed-ms exponential decay. Single numeric190ms second beat is replaced by newer heartbeat and canceled at stage/shutdown. Visual envelope second peak starts onlyphase>=.22; no gameplay heartbeat/director/AI files changed. Repeated destroy and calls after shutdown are safe.
- Focused contracts9/9 (8 initial RED plus recipe RED), four mutation checks, stages/runtime-quality/impact-budget, VFX12/12, typecheck/whitespace exit0. Initial tuple/reduce type errors corrected. Existing npm http-proxy warning persists. Worker ran no browser or independent review; root owns those gates.


## VO04 audible audio mix — 07.10.2026
- Branch `visual/vo04-audio-20261007`, base `c247ba4`, code/tests/architecture `5c53377`. Pure production `audioMixMath` master.8/music.65, seven bed trims [.47,.37,.71,1.14,2,.32,.5], SFX role gains replace old manifest volumes. Decoded SFX all-channel peak scan once/cache, min(12,.63/peak), silent/invalid1; shoot/hit/pickup throttles unchanged.
- One shared master compressor threshold-8/knee6/ratio4/attack.003/release.12. Separate bed trim before music/duck/filter; procedural layer filter and direct-to-master bio topology preserved. No gameplay/RNG/Joystick/score/save/campaign or AdaptiveAudioDirector decision changes.
- Visibility flag retained before context creation, document hidden fallback, source/resume guards and pending-resume resuspension. Existing abort/request-ID cancellation and gesture retries retained; resume called synchronously within gesture stack. Adaptive transient tones now reclaim on run teardown as well as ended; SFX unaffected by stopMusic.
- Immutable identity-free diagnostics distinguish wanted/loading/actually-playing and decoded actual fallback index from requested deterministic selection; generic error text avoids raw URL/error payloads.
- Focused17/17 production TS math/WebAudio boundary contracts passed; initial13/14 expected RED plus existing throttle PASS. Required audio/save/RNG+checkpoint/typecheck/whitespace checks exit0. Existing npm http-proxy warning persists; no package/lock changes. Worker performed no browser, sample DSP rendering, subagents or independent review; root owns those acceptance steps.


## VO05 recovered core art verification — 07.10.2026
- Saved implementation `fdacc92` retained unchanged on `visual/vo05-art-20261007`; existing generated seven-WebP asset/provenance commit `346638d` is in ancestor history.
- Seven canonical bounded4x backings share ArtMetrics compensation; raw images bake then release after refresh. Boot missing-key preload timeout1800ms and procedural fallback retain logical geometry; all hero/enemy/host scale consumers compensate backing factor. Noncore projectile/RNA/organ/combat sources are unchanged.
- Recovery coverage `3de91b7` adds individual canonical preload guards, production Boot.create fallback ordering for no/partial raw results, and seven exact provenance/hash checks. Core art15/15, typecheck, viewport/tokens/impact-budget/runtime-quality/telegraphs, nonbrowser startup-renderer, VFX12/12, atmosphere9/9, save/RNG+checkpoint/stages and whitespace passed.
- Existing untracked timeout-mutant file retained untouched; it intentionally fails finite-XHR timeout assertion after1800->0 mutation (other11original cases pass). No package/lock/CI changes and no production rewrite required.
- Actual stalled-XHR/engine physics and raster/browser controls/elite/matrix remain root-owned. No browser, push/merge/deploy; final build/CI and real-device MAX/TG gates remain open.


## VO05 stalled-art follow-up — 07.10.2026
- Root actual-browser regression exposed >6000ms stalled startup. Phaser3.90 Loader defaults maxRetries2; File.onError reloads twice, creating3x1800ms windows. Desktop parallel32; Android parallel6 can additionally batch seven assets.
- `9dc9650` sets optional-art retries0 while queueing (restores prior value in finally for unrelated future files) and Boot concurrency max(existing,7). Per-file1800ms timeout unchanged. Core art contract now16/16 includes retry capture/restore and Android6/desktop32 batching policy.
- With root-authorized browser follow-up, actual Chromium Canvas startup available1335ms/missing1102ms/stalled2501ms/Android-UA stalled2673ms, all unchanged6000ms gate. Stalled modes each requested exactly7distinct assets, no retries; Android config default6 and Boot loader7 explicitly confirmed. Private extended copy of root startup test remains untracked for coordinator import.
- Elite fixture now compares actual halfWidth/halfHeight to floor(sourceWorldRadiusX/Y), matching Phaser Body.setCircle/updateBounds; logical tolerance1.01, markers/signatures/centers unchanged. Actual elite script passed against own Vite server with only URL substituted in temporary copy. No physics production changes.
- Typecheck, core16/16, nonbrowser startup-renderer, viewport/tokens/impact-budget and whitespace passed after fix. No push/merge/deploy. Root still owns full geometry/controls/matrix/scoped review and external device gates.

## VO06 Menu/HUD finish — 07.10.2026
- Branch `visual/vo06-ui-20261007`, base20f3b48; decorative implementation8d8d9cd changes only MenuScene/UIScene.
- Menu retains two specimen Graphics/one alpha tween and two static noninteractive selector edges behind existing text/hero/input. HUD90px plate gains a hairline; highlights reuse existing fill Graphics and inherit visibility/fades/pulses.
- Existing health/RNA text/fill timing, launch-once guard, callbacks and input/text geometry remain unchanged. No package/token/gameplay changes.
- Worker passed typecheck, tokens, ui-copy, layout-diagnostics, language1584, viewport, Legendary/impact/VFX smoke and whitespace. No browser evidence provided; coordinator owns browser and scoped review.

## 2026-10-07: Recovered visual overhaul integration

Tasks1–6 recovered/completed; seven generated local core assets, bounded art fallback, compensated geometry and Menu/HUD finish integrated. Final evidence/reviews in docs/visual-overhaul/VALIDATION_20261007.md. NativeHONOR HUD, rollback and Compose passed; real-device MAX/Telegram acceptance remains open. No merge/deploy.

## Hosted CI fixture recovery

PR179 created. Initial hosted failures investigated: Node22 hardware selected reduced in an implicit-full VFX test; uncontrolled RAF phases/random cosmetic placement caused QA parity flakiness; global ring spy included new16px hit ring after lysis108/150. Test-only fixes preserve production behavior and all thresholds. Independent reviews PASS after lazy-sprite and deferred-depth-sort corrections. Native production QA12 cases PASS; comprehension all6viewports PASS. Latest combined head hosted rerun pending. Original failures retained in CI_FIXTURE_REVIEW_20261007.md. No merge/deploy.

## 2026-10-08 continuation facts
Six-frame hero/antibody atlas adds ~1.68MiB RGBA backing plus GPU and uses three poses under reduced/runtime-low. Actual76Phaserbody/display/center rows match original baseline. Combo9999 peak and boss label/bar overlap reproduced and fixed; native6viewportHUD rerun passed. Original54contracts plus biological,12dense renderer/tier cases,4artstartup, audio8restart/0leaks and production-opacity passed. Exact-head build/hosted checks tracked in publication. No merge/deploy; real phones and full soundtrack/charge/death remain unavailable/incomplete. See continuation acceptance and VO traceability.

## Verified HiDPI QA continuation (08.10)
PR180 four exact-head hosted checks PASS at231b38d. QA-only capped2x actual adapter passes local six renderer/DPR cells/fourviewports, paired201actor Text/camera/input/resize, controls and teardown. Production default1x; no phone/offscreen/context acceptance. Source review Codex fallback PASS; additional Kimi403quota blocked.

## Release fixture correction (08.10)
User-authorized179/180/181 merged tomain50c47049. Main CI37763374322 threefailedattempts retained. Two fixture-only scripts corrected without production/timeout/assertion relaxation; exact localPASS, independent source reviewPASS. Fresh hosted checks/deploypending.

## Cardiac clock isolation follow-up
PR182 initial head e1c058e CI37768249337 passed ceremony but failed Cardiac8s. Diagnostic-only14b6d3c CI37769887253 remains running. A local synthetic sparse RAF35ms plus explicit cooldown240 reproduced the timeout: Game active/notpaused/UI clear, boss phase2, stage2649 versus scene16936, nextTelegraph13575 already due, heartbeat3216 safeIndicator true; zero page errors. This demonstrates the mixed-clock scheduling mechanism, not the exact hosted runner conditions (default cooldown120).

Fixture now uses the real heartbeat.restore with nextImpact=stageTime+60000 and bossWasActive=true, with exact60000 setup assertion. Game.update, real Cardiac scheduler and canSchedule, original4700/850/280 source timing,8s/2s/1.5s browser deadlines, exact14damage and heartbeatClear remain. It intentionally does not validate live heartbeat concurrency; unchanged test:pacing separately tests1980/1981 boundary and exclusion. Native exactscript plus paired synthetic stressed fixture PASS; pacing PASS. Independent Codex source review PASS. Additional Kimi OmniRoute review returned empty content and is NOT approval. Await fresh PR/main CI before deploy.

## Hosted progression cause captured and pool reset
Diagnostic-only14b6d3c CI37769887253 failed with Game inactive/paused, UI modalOpen/uiBlocked, awaitingChoice true, stage149ms, bossactivephase2, hazard disabled/serial0 and no errors. This directly proves a new progression choice paused the updater; it does not identify the individual RNA drop. The only ordinary queued-level source is onGemCollected; stage transition was not occurring.

The fixture now uses production-standard deactivateForStageReset for existing bullets/RNA gems, resets host cells and excludes their update/rewards from this beam contract. It asserts zero active bullets/gems. Paired local inherited-RNA100 fixture: baselinef292dc7 paused atstage33ms/queued3/awaitingChoice and failed8s; corrected fixture PASS. Exact corrected script alsoPASS. Thus no onGemCollected/Game.update/hazard method is stubbed, no assertion or timeout is loosened. Host-cell/RNA integration is outside this scoped beam test; other unchanged gameplay/browser suites cover it. Mixed-clock synthetic finding remains separately documented and was not the captured hosted cause.

## Dense readability fixture lifecycle recovery
Final6c84b89 CI37771605821 passed Legendary, Cardiac and controls, then dense-readability failed target150/cache150 with allalpha1. Enemy preUpdate reads prior density; Game.update refreshes cache afterward. Original fixed150ms sleep need not contain both real frames.

Density fixture now waits two actual Scene POST_UPDATE frames with cache>=target, bounded1500ms, before unchanged150/200targets/alpha assertions. This replaces a synchronization assumption, NOT an unchanged performance/timing gate. No manual Game/Enemy update or cache writes. Startup accepts an already-paused real Game, resumes then clears progression/UI; new unblocked assertion added. Exact native finalscript PASS; original native Game.active-only wait had stopped at startup30s. Paired sparseRAF240ms with shared corrected startup: old150ms sleep failed cache100/target150/allalpha1; completed-frame wait PASS. This demonstrates synchronization sensitivity, not the exact hosted scheduling. Independent Codex source review PASS. Additional Kimi nonstream diagnostic HTTP504; no routed approval.
# 2026-10-11 Render migration

Authorized target: Render Free with durable state in existing free Supabase.
Initial export:67scores,4profiles,Telegram user list preserved. Source production
SHAa1e540c49225d9b627f44c291e5a67f3f27c49e7. New hosting entrypoint and durable
adapter tested; no production traffic switched yet. See deploy/RENDER.md.


## 2026-10-11 local cutover continuation
Render public release fb54e0b verified against all54public files and release
hashes; remote revision8 healthy. Canonical DNS still Cloud.ru/a1e540c. Existing
Render key cannot access service workspace; available UI awaits GitHub2FA.
MAX webhook missing in current Render deployment (405), corrected locally with
existing handlers and credential mapping; new HTTP/auth/profile tests passed.
No production settings or Cloud.ru resources changed. See latest00_HANDOFF.


### B2/B4 parent history (verbatim)
# Visual upgrade Phase B4 state — 19 October 2026

Branch head c672a00 (B4 on B1+B2+B3). Bundle 430.83 kB vs prod 420.85 kB (+2.4%). Boss identity system: HUD bar frame + 6 phase-tinted ticks + diamond emblem; Enemy.getPhaseMode()/GameScene.getBossPhaseMode() (armored/recovery/broken); recovery/broken aura modes now draw the armored 6-tick vocabulary. Telegraph contract untouched. Tests PASS: tsc, presentation, telegraphs, boss-presentation, mini-boss, wave-events. Control perf 60s: median 20.3 FPS (noise). Evidence: screenshots/b4-* (driver scripts/boss-capture.cjs, wave.boss QA substitution for bar). Donor: none (prior donor bosses single-color, no phase ceremony). B1–B3 facts below remain valid.

## Previous snapshots
# Visual upgrade Phase B3 state — 19 October 2026

Branch head 8164f5f (B3 on top of B1+B2). Bundle 429.68 kB vs prod 420.85 kB (+2.1%). Rarity hierarchy on choice cards: tier pips (1/2/3) + graduated frame, VISUAL.host/rare/warning tokens; card-flow legacy hex (COLORS.gold, #ffe066) migrated to VISUAL.warning. Modal-scoped only, no per-frame cost, no copy changes. Tests PASS: tsc, tokens, language (1597 literals), ui-copy, legendary, layout-diagnostics, presentation. Paired captures: screenshots/b3-before|after-{mixed,common-rare,legendary}.png (driver scripts/mutation-cards-capture.cjs with synthetic defs). Donor: none (prior MIT donor has no rarity system). B1/B2 facts below remain valid.

## Previous snapshots
# Visual upgrade Phase B2 state — 19 October 2026

Branch feat/visual-combat-20261018 head 27f914d (B2 on top of B1). Bundle 429.35 kB vs prod 420.85 kB (+2.0%). Silhouette paired (182 enemies, seed 424242): coreLum 62.4→195.2, rgbDelta 48.1→144.4, annulusCalm 0.558→0.687. Perf 60s paired: Canvas median 60.5/60.5 (min 56.0/56.4), WebGL-SwiftShader 22.2/21.2 (noise band ±2). tsc clean; impact-budget, runtime-quality, test:presentation PASS. Layers: silhouetteClearing depth 11 (over enemies 10, under elite 12/health 13/bullets 14/player 15), playerGlow depth 14.5; both gated visualEnemyDensity≥110, ramp 110-200. Evidence in AUDIT_2026-10-18/: screenshots/silhouette-b2-*, iso-*, b2-*-zoom; evidence/silhouette-b2-*.json, perf-combat-b2-*.json; scripts/analyze-silhouette-b2.py, silhouette-video.cjs. B1 facts below remain valid.

## Previous snapshots
# Visual upgrade Phase B1 state — 19 October 2026

Facts (measured 2026-10-18/19, workspace AUDIT_2026-10-18/): origin/main = abdb10c = production. Branch feat/visual-combat-20261018: 91891f7 atlas+tests, 7d2aac2 hit reaction, 81049f2 death collapse, 7be28d6 smoke driver + notices; head 7be28d6. Bundle 428.56 kB vs 420.85 kB prod (+1.8%). Paired 60 s combat perf: WebGL-SwiftShader median 19.8 (before) / 19.3 (after), min 18.4/18.1; true Canvas (?renderer=canvas, type=1) median 59.1/59.5, min 54.4/56.2; enemiesMax 19/21 and 32/26 (seed variance). Impact smoke 3 cells: before 21 contract deviations, after 0 (strict). tsc clean; listed presentation/contract suites PASS. browser-smoke legal failure reproduces on untouched abdb10c (pre-existing, local build lacks release env). build:max not run (owner env only).

Correction of 18.10 measurements: combat/silhouette/loading runs labeled Canvas were WebGL-SwiftShader (type=2) — driver label bug; plain headless launches WebGL. True Canvas first measured in B1.

## Previous snapshots
# Visual implementation completion — 16 October 2026

Branch visual/completion-20261016 extends verified public7a0d829 (PR216). Implemented distinct Player mutation geometry/combined composition, unified SocialHub and Codex, measured11px scrolling result report with pinned actions, pointer ownership and long-share fit, quieter pause. Existing gameplay/RNG/physics/score/network/assets/service settings are retained. Main integration is not authorized.

Read docs/release/VISUAL_COMPLETION_20261016.md. Root executed rich result/resumed/share/social/error/allCodex browser320/360/390; presentation and TypeScript passed. Independent source and native visual reviews resolved concrete issues and found no remaining P1/P2. Short live100-spawn AI/physics desktop before/after has p95~16.8ms in Canvas/WebGL, explicitly not device FPS. Final exact-head hosted CI/matrix, fresh backup and pinned deployment/readback are still pending; do not claim publication from this snapshot.

The implementation gaps from the earlier Phase1 ledger are addressed in this branch; old pending statements below are historical snapshots. Device MAX/TG/iOS, sustained performance/thermals, newcomer/full-campaign acceptance remain open. Preserve other PRs and private state backups. Companion documentation branch carries final evidence without changing the tested product SHA after publication.

## Previous snapshots
# Mutation art recovery state — 16 October 2026
Branch fix/mutation-art-recovery-20261016 starts from the verified live visual candidate44c6579 (PR214). Cold-start optional mutation requests can exceed Boot1800ms; fallback previously remained permanent. The scoped fix records canonical texture provenance and recovers only mutation-prism/halo/singularity after first render. Same256px CanvasTexture objects refresh in place; Player/physics/gameplay/assets remain unchanged. Two8000ms attempts/key,750ms backoff; per-game dedup and destruction cancellation. Five module contracts, full presentation and TypeScript passed. Read docs/release/MUTATION_ART_RECOVERY_20261016.md.

Local delayed-image Canvas/WebGL regression passed with sixteen paired actual Player frames and exact packaged pixels. Independent source review found no concrete P1/P2. Remaining before publication: final still-image review, exact-head hosted CI/matrix, fresh private backup and pinned Render Free publication/readback. Owner authorizes continuation/deployment; main merge remains prohibited. Keep PR213/214/215 and other parallel PRs separate. Physical-device/FPS/newcomer acceptance remains open. Update the release document after real results; do not treat this pending snapshot as proof of publication.

## Previous snapshots
# Phase1 visual candidate state — 16 October 2026
Phase0/1 product work is on visual/phase1-ui-20261015, based on main aba70324. Open PR213 contains world art; dependent PR214 contains menu/HUD/mutation/boss/result presentation. Source head d5cae44 is followed by a test-only comprehension synchronization fix: wait for the actual boss reveal to finish before host-lesson assertions. This preserves production behavior and every gameplay assertion. Independent review found no actionable issue in this test delta. Presentation contracts, TypeScript and whitespace checks passed on continuation. Full browser rerun and exact new-head CI must be recorded before publication.

Owner authorized deployment after candidate validation; main merge remains prohibited. Refresh the private pre-deployment backup, deploy the exact green pushed SHA on the existing Render Free service, and verify live SHA/assets/browser/state preservation. Until then production remains the separately verified 30a534f release. Final release/readback evidence belongs in companion PR215 (docs/frontend-overhaul-20261015), starting at FRONTEND_OVERHAUL_PROGRESS.md. Do not deploy the documentation branch.

PR204/207/208/209/210/212 remain separate integration work. Physical MAX/Telegram/iOS, phone readability/input/FPS/thermals, full campaign and newcomer acceptance remain open; later visual phases are not claimed complete. Preserve all prior work and do not infer phone acceptance from desktop fixtures.

## Previous snapshots
# Review follow-ups — 2026-10-15

Branch fix/review-followups-20261015 starts from main30a534f. Owner asked to continue remaining review recommendations. Four targeted follow-ups: Boot/Menu startup recovery now waits for the first usable Menu frame and catches scene exceptions/stalls; CI builds the actual telegram-bot target and imports it with networking disabled and a deadline; registry mirror-write failures lower health until a successful write; profile migration publishes a staged candidate only after its atomic disk write.

RED→GREEN: actual Phaser scene-create failure; registry health on injected disk failure; failed migration remaining claimable and invisible to signed reads. Local server75 plus security/durable/hosting suites, TypeScript, bot contract, startup browser cases and prior review-browser scenarios pass. Independent Luna review found no P1/P2. The final extended startup check, production build and exact-head hosted CI must still be recorded in the PR. Local Docker Desktop could not start; actual image import remains pending hosted CI.

Previous package PR202/203 is merged and was verified published on 14 October: exact main30a534fbf1656979c20434d4f4d724eea69c385f, all three main CI jobs succeeded, Render deploy dep-db7ndmm7bikc73d860lg automatically triggered new_commit and live. Public56 files/API/browser checks passed; all73 scores, existing profiles/registry preserved, Free and /ready retained. Those are prior-release facts, not proof of this branch being live. Physical S20+/MAX/TG, iOS, FPS/newcomer gates remain open. Other agents' open PRs are untouched; recheck main before integration.

## Previous snapshots

# Legacy mini-boss warning follow-up — 2026-10-14

PR202 merged as9a6d327 after green PR CI38559170274. Before publication, an additional
legacy checkpoint edge was found: pre-mini-boss saves can lie inside its new warning.
Follow-up consumes that restored encounter, matching the wave-warning policy; saves
before the warning still get the complete mini-boss warning. Actual production-method
regression observed warning+spawn before the fix, then no partial replay; future warning
remains full. Main CI38560367835 was cancelled to hold publication for this fix.
Run final exact-head/main CI and verify runtime identity; do not treat cancelled CI as PASS.

# Review48 P2 fixes — 2026-10-14

Owner approved four fixes in order: pre-wave checkpoint migration, anomaly lifecycle,
wave warning resume, proxy rate isolation. Implementation branch fix/review48-p2-20261014
starts at a0faa496. Tests reproduced each defect before its fix.

Implemented: real base6a5cf5be fixture retained; only additive missing streams derived
for legacy v2, original six streams mandatory. Anomaly state machine and damage use
combat-phase authority. New saves are suppressed during pending wave warnings; old
mid-warning snapshots consume that event without redrawing RNG or short warnings.
Verified actor counters are separated from anonymous counters and proxy backstop;
anonymous retries/churn cannot drain or evict signed budgets. XFF remains untrusted
unless the explicit connecting proxy policy permits it.

Local evidence: checkpoint/RNG, anomaly-runtime6/6, actual Phaser lifecycle (frozen HP,
transition reaches Heart, normal damage retained, real safe/pending save wiring),
proxy HTTP flood +20,001-key eviction regression, TypeScript and existing browser
review regressions passed. Server core75 + security/durable/hosting suites passed;
final post-review suite/build and exact-head hosted CI must be recorded in PR.
Independent whole-branch reviewer found actor-map eviction; corrected with separate
signed counters and watched its regression fail then pass. Remaining native device,
FPS/newcomer gates are open. Startup scene-boundary and telegram-bot CI build gaps
are P3 follow-ups, outside these four fixes.

Production known at task start: Render Free a0faa496, manual deployment
 dep-db7l3j7avr4c738l7mqg. This source change has not yet been published. On release,
verify exact SHA, backup, readiness/hash parity; observe auto trigger before manual
fallback because GitHub repository access was corrected. No secrets, DNS, bot identity,
paid resources or real user messages changed by implementation.

## Previous snapshot

# Render investigation — 2026-10-14

PR #199 is merged as `51b910a0e8031ca477daf701ca1de1b31023cf01`.
Final PR CI [38441586488](https://github.com/timoshinoleg-eng/ofeliya/actions/runs/38441586488)
and main CI [38443697280](https://github.com/timoshinoleg-eng/ofeliya/actions/runs/38443697280)
passed build, browser-smoke and production-contract. Merge used `[skip render]`.

Authenticated dashboard inspection used `timoshin.oleg@gmail.com` and service
`srv-db5ro5vlk1mc73b0v0eg`. Visible settings: GitHub repository
`timoshinoleg-eng/ofeliya`, branch `main`, empty root directory, Auto Deploy
`After CI Checks Pass`; no included build paths; ignored paths `memory/**`,
`PROJECT_IDENTITY.md`, `deploy/RENDER.md`; health check `/ready`.
The account has GitHub login `timoshinoleg-eng`. These are UI observations,
not proof that GitHub events/checks reach Render successfully.

The live `c0c72fa` deployment `dep-db6vmg4s728c73cv4010` and four earlier
entries show trigger API; the initial deployment shows First Deploy.
GitHub installation `88263801` was active but restricted to only
`junior_middle_it` and `coder_survival`; `ofeliya` was missing from selected
repositories. This is a concrete integration access defect, consistent with
missing automatic deployment events; historical webhook delivery was not inspected.
With explicit owner approval, only `timoshinoleg-eng/ofeliya` was added and Save
clicked. GitHub redirected to Render with `setup_action=update`. Reopening the
installation confirmed three saved repositories, including ofeliya, and disabled
Save/Cancel controls. Other repository grants and the permission set were preserved.
No API key was created or recovered; no manual deployment, service setting or
production data was changed. A fresh service Events check after Save still
showed 35 entries, no new deployment and live source `c0c72fa`.

Repository access is corrected; end-to-end automatic deployment is not yet
verified. The maintenance merge's `[skip render]` deliberately suppresses that
commit, so it cannot validate the fix. Historical trigger attribution remains
unproven beyond the observed access defect.
On the next authorized runtime release, use a commit affecting included paths
without a Render skip phrase, confirm all checks on the exact main SHA, then
observe a Render automatic deployment of that SHA before manual/API fallback.
If absent, inspect events, repository grants and GitHub event/check delivery.
Reference: https://render.com/docs/deploys and https://render.com/docs/monorepo-support.

## Previous snapshots (current findings above take precedence)

# Telegram image and maintenance verification — 2026-10-13

PR #199 fixes the latent dedicated `telegram-bot` image dependency omission
on branch `fix/telegram-bot-image-20261013`, based on main `f48c143`.
`bot.mjs:23` imports `telegram-webhook.mjs` at module scope. The old bot stage
copied only bot.mjs and telegram-api.mjs. RED `d9fb1c7` fails the added COPY
guard; GREEN `360c05b` passes after copying the missing helper. The guard scopes
COPY source/destination checks to the bot stage and is already wired into CI.
Both actual Docker images build; with `--network none`, the old Node22 image
import fails with `ERR_MODULE_NOT_FOUND` and the fixed one succeeds. Local
server tests (75 core plus all additional suites) and TypeScript/Vite build pass.
Existing CI builds runtime/score/static, not telegram-bot; contrary external
handoff text is inaccurate. No workflow expansion was made in this package.

PR #189 closed with a supersession comment linking current and archived handoff.
Remote branch `codex/render-migration-handoff-20261011` still exists. The stale
security-patch backlog claim is corrected: PR #197 already includes equivalent
and stricter policy/security regressions. The backup patch must not be applied
wholesale.

Render live investigation is pending authenticated working-account access.
No Render API credential was found in process environment, Documents/Codex,
repository, Desktop or the checked local config/credential stores. This is an
access limitation, not evidence about Render's provider or trigger. No settings
or production data were changed. The prior release facts below are historical
evidence, not a fresh authenticated API check in this follow-up.

# Verified review-fix release — 2026-10-13

Runtime source: c0c72fa81690b562e15c1d87580c66af842b3f3b (PR197 merged). Main CI38375891119: build/browser-smoke/production-contract success. Render Free deployment dep-db6vmg4s728c73cv4010 is live in production workspace tea-d8iruouq1p3s73f30a90 (timoshin.oleg@gmail.com). Canonical https://ofeliya.freeveol.dpdns.org/ofeliya/ reports this SHA. Metadata-only commits after this release do not change the published source identity.

Measured:56 public files match a local build using current production VITE values;47 exact and9 differing only in carriage-return line endings. Remote HTML/runtime-config/SW hashes match their release marker exactly. /ready200 aggregates configured MAX/TG and healthy API; Render healthCheckPath is /ready. Eight synthetic signed profile/social reads and both webhook auth gates passed; no test scores or fake registrations were written. Browser menu and actual touch start reached the first mutation without page errors/CSP violations, QA hooks absent. This is desktop Chromium, not a real phone.

Private S3 backup revision78 (13094bytes) was downloaded and verified; isolated restore started the new server with71scores and validated registry. Published state preserved all baseline scores/profiles/registrations. After a Render restart, revision80→81, all71scores and existing profiles/registry remained. source-map-js1.2.2 is merged; superseded draftPR184 is closed, branch preserved.

## Historical snapshots (current verified facts above take precedence)

# Current review fixes — 2026-10-13

Branch fix/kimi-review-20261013, based on main26fcc88. User approved the independent review follow-up plan. See docs/release/KIMI_REVIEW_FIXES_20261013.md for contracts, tests and mixed-version policy. Previous handoff is archived under memory/archive/2026-10-13-before-review-fixes/; older state/decisions/backlog remain as historical notes below.

Confirmed: local TypeScript/QA build, server75/75 plus migration/security/durable suites, browser startup/lifecycle/CSP, gameplay gates and npm audit zero. Hosted CI/deploy/device evidence pending.

## Historical notes (snapshot-specific; current facts above take precedence)

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

# Production state - 2026-10-11

OFELIYA is live on Render Free ofeliya-game (srv-db5ro5vlk1mc73b0v0eg),
Frankfurt, main/checksPass, canonical https://ofeliya.freeveol.dpdns.org/ofeliya/.
Runtime d92325b1c83259fbbebd4e02331826fd98982a5e includes merged PR190/191.
MAX/TG protected callbacks and /ofeliya/api/* work; prepared Telegram sharing
returned200. Remote Supabase state is healthy; restart restored67scores,
551events, and existing profiles. All54 assets and release hashes passed.

Cloud.ru OFELIYA VM,30GB disk and IP are deleted (GET404 for each); its deploy
workflow is disabled. Other three VMs, their resources and two Quiz backups
were preserved. Account-wide Cloud.ru charges are not claimed to be zero.
Real Telegram/MAX device /start and save/reopen remain external acceptance.
See memory/00_HANDOFF.md for verified IDs and evidence limits.

Supabase state access key was rotated in the existing Free project. The new
Render uses the replacement; the old key returns401 for read and writer claim,
so the inaccessible preview cannot steal production persistence. A 24-hour
management token was scoped only to this project and Edge Functions. No keys
are committed. Main CI38158081443 passed all three jobs for runtime d92325b.

## Historical notes

# STATE — OFELIYA: STRAIN ZERO

Обновлено: 2026-10-05. Только факты; решения — в `02_DECISIONS.md`.

## Control smoke precondition (06.10)

- Main `3a04868` browser smoke failed the synthetic recycled pointer test while a live level-up mutation modal had `uiBlocked=true`; both down callbacks correctly rejected input, leaving ids `-1` and vectors zero.
- Test-only Game update freeze is installed before scene start for all three control modes; active UI is explicitly required to be modal-free and unblocked.
- Focused `control-mode-smoke.cjs` passed locally; production code was not changed.

## Standalone deploy compatibility policy (05.10)

- Production run `37370394631` reached the server, passed CI/release floors, then failed because a helper sibling was absent from the selected script extraction directory `/tmp`; automatic rollback to `edb1b9a...` succeeded and public release marker confirmed it.
- `deploy/deploy-cloudru.sh` now reads the compatibility helper from fetched `origin/main` into a variable, rejects failed, empty, or whitespace-only loads, and pipes the policy to `bash -s`; no dependency on script location remains.
- The three CI jobs use `ubuntu-22.04`. Existing rollback contract test now executes the actual deploy guard for valid, old, invalid, missing-helper, and empty-helper cases.

## Targeted deploy CI lookup (05.10)

- Deploy job now uses `ubuntu-22.04` and requests workflow-specific `ci.yml` runs filtered by exact release SHA, main branch, push event, completed status, and up to 100 results.
- The inline validator retains all five acceptance predicates; missing matches report counts and up to five same-SHA run identity/status summaries.
- Root reported hosted runner acquisition failures for prior deploy/main-CI attempts; exact-SHA CI run `37360675706` was independently confirmed green for main SHA `42b9f30a3feb8f219faf41014f0bfdd6bf27b5dd`.

## Deploy workflow payload (05.10)

- Branch `fix/deploy-ci-payload-20261005` is based on main `42b9f30a3feb8f219faf41014f0bfdd6bf27b5dd`.
- Deploy run `37362076056` failed before bastion access because the large Actions runs JSON was passed as an environment variable, exceeding Linux `MAX_ARG_STRLEN` and preventing Node startup (exit 126).
- The successful-main-CI workflow step now reads its JSON payload from a temporary file while preserving its five run identity checks and fail-closed behavior.

## Репозиторий

- GitHub: `https://github.com/timoshinoleg-eng/ofeliya`
- Ветки: `main` (актуально); `feat/donor-quick-wins` @ `e5b6658` — историческая (не обновляется; актуальный код — в `main`); `fix/audit-blockers`, `backup/audit-blockers-0ecbf3c` — архив.
- Remote (02.10): `origin/main` @ `4bce5a0bdfd996cbda4447d1eefdfbdb2c9531bc`; рабочая ветка этой сессии — `feat/product-validation-funnel-20261002` от указанного main.
- Worktrees (локально): `…\work\ofeliya-audit` (main), `…\work\ofeliya-audit-fixes` — переведён на состояние `origin/main` (`808d866`); локальная ветка трекает `origin/main`.
- Приёмка: PR #151 (`dc71cb2`), PR #152 (`2df55bb`, `06_REVIEW.md`), PR #153 (`808d866`, финал) смержены 29.09; пост-ревью правки — PR #154. Система памяти — в `main`.

## Продукт

- OFELIYA: STRAIN ZERO, `v0.4.1-rc.1` (по локальной копии от 26.09), portrait roguelite-survivor для MAX Mini Apps.
- Кампания: КРОВОТОК → IMMUNE PRIME → СЕРДЦЕ → CARDIAC TITAN (≈9+ мин до боссов).
- Стандарт/Strained сложности; Legendary ≤2 за прогон; trusted score backend.

## Гейты

- CI: build gate + browser gate (`ci.yml`); `release-visual-matrix.yml` (100/150/200 × WebGL/Canvas × full/reduced).
- Внешний гейт: реальные MAX Android/iOS — 16 пунктов (`RELEASE_VALIDATION.md` §8). **Не пройден.**

## Инфраструктура и прод

- Деплой: Cloud.ru (`deploy/deploy-cloudru.sh`, `compose.production.yml`, `Caddyfile.ofeliya`, `nginx.conf`).
- Ремарка: зелёный CI означает консистентность репозитория, не «на VM крутится именно этот коммит» — проверять отдельно.

## Инструменты (пилот)

- Ноут 1 (Honor): OpenCode (основной), Cline (запасной), Codex desktop.
- Ноут 2 (HP): OpenCode (второй), Cline (запасной).
- ChatGPT web: Project «Офелия» — внешний ревьюер (обычный чат, не Work).
- Память: `memory/` в репозитории; контекст: плагин context-mode (проверен: v1.0.169 отвечает в сессии); доп. слой: cross-agent-memory MCP.
- Пилот, статус 28.09.2026: этап 0 — архив копий; этап 1 — память в репо; этап 2 (Honor) — OmniRoute сервер работает, OpenCode → комбо `omniroute/OFELIYA-CODE` (живой тест ✓), скиллы gamedev 74+router (единый источник `~/.agents/skills`), Superpowers установлен плагином. Этап 4 (ночь 28→29.09, Honor): тест-цикл B пройден — OpenCode 1.18.33 (ctx stats ✓, память без пересказов ✓, смена модели OFELIYA-CODE → BACKGROUND-REVIEW с сохранением контекста ✓); smoke-тесты onboarding/daily-history/comprehension зелёные; ревью 3/3 подтверждено + коррекция (регрессий в UIScene нет).
- Дальше: этап 3 — HP (блок A чек-листа); ChatGPT-вариант ревью — опционально.

## Product validation 02.10

- First-run onboarding перестроен на реальный core loop: движение → автоогонь → RNA → мутация → заражение клетки-хозяина; шаг «пауза» удалён из tutorial.
- В `RunSnapshot` добавлен `hostCellsInfected`, чтобы UI мог завершать onboarding по реальному заражению.
- Аналитика дополнена событиями `run_start`, `run_60s`, `boss1`, `heart`, `win/death`, `replay`, успешный `share`, запуск `daily`, referral-open, `onboarding_step`, `onboarding_exit`.
- Добавлен CLI `analytics:funnel`: unique-actor funnel, first-60s timing/exits, D1 и referral open → run_start.
- Добавлен формальный 16-пунктовый evidence validator `test:mobile-evidence` и документ `docs/PRODUCT_VALIDATION_2026-10.md`. Реальная Android/iOS приёмка всё ещё НЕ выполнена: валидатор проверен только на синтетическом fixture.
- Проверки ветки: `test:onboarding` ✓, `test:analytics` ✓, `server:test` 68/68 ✓, `test:comprehension` ✓ на 6 viewport при запуске текущей ветки на :5194, `test:result-actions` + checkpoint-resume ✓ на текущей ветке, `test:daily-cta` ✓; production build ✓ при явном `VITE_RELEASE_SHA` текущего base SHA.

## Открытые вопросы / риски

- Баланс полных прогонов и Heart timing — только через плейтест (CI не решает).
- Термика/перформанс на целевых телефонах — внешний гейт.
- PR #151/#152: merge выполнены; CI был зелёный (build/browser-smoke/production-contract).

## Audit revalidation 03.10
- Rechecked v2 audit findings D1/D2 against the current PR #157 branch, not historical commit 53ff997.
- D1 (elite collision radius) is a false positive: Phaser Arcade setCircle() uses source pixels and scales the actual body; runtime smoke now asserts collisionRadius ~= Enemy.radius for elite scale 1.45.
- D2 (blocking overlays on viewport rotation/resize) is fixed in UIScene: level-up and result overlays retain their source viewport, scale into the new viewport, and expand the scrim to cover it.
- Regression coverage: mutation-choice smoke checks 390x844 -> 568x320 with an open level-up modal; existing mobile-layout matrix checks result resize. Real Android/iOS MAX acceptance is still required.

## Telegram production wiring 03.10
- Branch `feat/telegram-production-wiring` prepares the current shared OFELIYA frontend/backend for Telegram production without changing MAX ownership.
- Telegram CSP/Web embedding, optional fail-closed deploy env, dedicated long-polling bot service, shared referral data volume, and deploy parity checks are implemented.
- Telegram remains disabled on production until `TG_BOT_TOKEN` + `VITE_TG_BOT_USERNAME` are supplied; BotFather Main Mini App must target the canonical OFELIYA URL.
- Fixed Telegram `/start <payload>` long-polling dispatch to parse the original message text.

## Telegram edge rollout fix 03.10
- First production rollout of #158 correctly failed public parity and rolled application containers back to 56476c0: nginx had Telegram CSP, but local Caddyfile.dedicated remained MAX-only.
- Hotfix branch fix/telegram-edge-caddy-rollout versions the edge route policy through a renderer and safe Caddy validate/reload path with local-config restoration on failure.

## Telegram webhook production fallback 04.10
- Cloud.ru Docker outbound TLS to Telegram Bot API is unreliable even with the reachable pinned IP; do not treat an Up long-poll container as acceptance.
- Production path now supports Telegram webhook at /api/telegram/webhook with X-Telegram-Bot-Api-Secret-Token validation.
- Webhook responses return inline sendMessage methods with a Web App launch button, so /start and /help require no outbound Telegram API call.
- When outbound Bot API is disabled, prepared-share fails locally and the client falls back to t.me/share/url without a 3.5s timeout.


## 2026-10-05: продолжение Sol6.1 remediation

- Основа origin/main edb1b9a (Telegram webhook), ветка fix/sol61-review-remediation-20261005. Восстановлены R01/R02 и незавершённый R03 из отдельного checkout без изменения исходного каталога.
- R01 wall clock Daily; R02 резерв verified capacity; R03 ID-aware ordinary outbox; R04 reload отложен до завершения Game (internal game reference, production без QA hook).
- R05 outbound defaultoff + explicit Compose env; R06 webhook-compatible SHA floor в workflow/select/rollback и direct deploy; R07 shared polling/webhook direct-link payload и group-safe кнопки.
- R08 onboarding completion callback; R09 analytics actor60/min; R10 credentials scrub+7dayTTL обоих outboxes.
- Независимое GPT-6.1 Sol ревью дополнительно выявило Daily409 blocking, смену uid внутри одной платформы и ack-before-durable. Исправлены terminal Daily409, exact-ID Daily settlement, local ownerId replay guard, fresh-user Daily slot supersession и synchronous atomic flush score/run/start/daily/run до non5xx ответа. Unknown legacy ordinary entries не replay: истекают поTTL, предотвращая присвоение чужому пользователю.
- Проверки: server75, outbox24, новые release4/onboarding/rollback/server-policy/renderedCompose; браузер score/comprehension6viewport. Полный локальный набор43гейта: первый startup5.124s при параллельной браузерной нагрузке и Caddy sh ENOENT; serial startup и Caddy с GitBash PATH прошли. Исходные failures сохранены в evidence.
- Cloud creation недоступен аккаунту; пользователь разрешил local. Deploy/merge не выполнены. Публичный release.json недоступен; текущая productionSHA НЕ подтверждена. Real-device MAX Android/iOS16/16 остаётся открытым.
- Анализ второго вложения: WOFF2 валиден, кириллица отсутствует. Не считать разрешённые словарём ФОРМА МУТАЦИИ/MAX ИЛИ TG/СТАНДАРТ ошибками; предложить небольшой кириллический typography trial, затем RU catalog; fullEN i18n после продуктового решения.


## 2026-10-05: делегированные UI follow-up

Ветка refactor/ui-copy-layout-followup-20261005 собрана поверх PR168 HEAD4f65c4f. PR168 остаётся отдельным remediation пакетом, его CI прошёл; merge/deploy не выполнены.

Space Bunny через OpenCode (opencode/space-bunny-free) создал типизированные варианты control labels и каталог rarity/build-summary: исходный code7a7d08e, здесь cherry-pickd63b80c. Существующие RU strings и поведение сохранены; full/compact/tiny намеренно различаются. Upgrade-id completeness контролируется runtime контрактом, не исчерпывающим TS union.

GPT-6 Sol создал рекурсивный диагностический collector для видимого текста в Container и18Legendary regression cases: исходныйcodeea086d1, здесь4f5cbfc. Production UI/Legendary layout не переделывался: actualPhaser18cases без overflow, max2lines. Matrix fixture теперь учитывает автоматический startuplevel-up pause и проверяет checkpointsave явно.

GPT-6 Luna независимо проверил обе задачи; no functional findings. Coordinator подключил новые Node/browser gates кCI и закрепил равные stackcounts в golden test. Browser suite budget15мин вместо10 из-за дополнительной18-case проверки, пороги assertions не увеличены.

Локальная отдельная приёмка: catalog/language/tsc; layout diagnostics; Legendary18/18; mobile matrix320x568,360x640,360x760,390x844,412x915 + restart-safe resume/result resize. Итоговый CI этой ветки нужно смотреть по headSHA draftPR, не переносить результат PR168.

Шрифтовой prototype находится отдельно в PR169: opt-inPlay400/700, no productiondefaultflip. CI обнаружил import.meta/CommonJS regression и отсутствие releaseSHA в visualworkflow; автор исправляет отдельно. Не считать старый Play CI зелёным.

Текущее второе мнение: MAX ИЛИ TG прямо разрешён languageBible100; PR168 меняетUIScene;452/419 без методики не новый замер; T-КИЛЛЕР/T-КЛЕТКИ действительно расходятся вproductBible. Имена/редкости/юридические тексты/fulli18n не изменять без продуктового решения.

Внешние релиз-гейты: реальные MAX Android/iOS16/16, TG launch/referral/Daily и publicrelease.json exactSHA остаются неподтверждёнными. Не выполнять merge/deploy автоматически.

## Legendary compact-card clipping fix (05.10)

- Linux layout evidence at 320x568 showed three Legendary effect strings wrapping to three lines while UIScene capped the badge text at two. `UIScene.ts` now measures wrapping and grants a third line only to a compact Legendary effect that needs it; its plate expands to 42px and shifts upward to center y=21, ending at y=42 before the footer starts at y=43; card height stays 124px. Other card effects keep their prior 2-line limit and plate size. Copy and `UiCopy` imports are unchanged.
- Focused layout probe now accepts the bounded 42px effect plate while still comparing actual text bounds against it. Root reports the 18-case Windows browser probe passed on this exact working diff. Local typecheck, `test:legendary`, `test:mutation-copy`, and `test:tokens` passed.
- Code commits `340f38b7f8f2be2fc9be49c6b06cf49d45151d2e` and overlap correction `997b6eee2403505e1a416fd5d2755496c30728e`; root owns final probe rerun and full branch CI. No push/merge/deploy here.


## Final Legendary geometry and probe guard
- Corrected candidate `997b6eee2403505e1a416fd5d2755496c30728e` supersedes the earlier center-y=31 version, which overlapped the footer. The compact three-line panel is now center-y=21, bounds y=0..42; the Legendary footer begins y=43. Probe now requires description/footer fixtures and rejects text-bound intersections.
- Root reports the browser 18-case check plus desc/footer intersections pass on the corrected geometry. The stricter fixture-presence probe guard was added afterward; root should rerun it against final HEAD before push. No push from this worker.

## Compact Legendary description spacing follow-up (05.10)
- After Linux showed effect/description overlap, compact Legendary reward cards now use height 136px (other compact level-up cards remain 124px). At 320x568, three cards span y=122..548. The effect plate remains 42px high at local y=6..48; footer starts local y=49, and description moves up to local y=-22. No effect font-size, copy, or gameplay changes.
- Focused probe JSON now includes effect, description, and footer bounds and rejects missing fixture text or intersections. Root's Windows 18-case verification passed on this change. Typecheck plus Legendary, mutation-copy, and token checks passed. Focused Linux CI is pending; earlier Linux result showed description overlap.
- Code commit `29457d658e309ee87fadffd30c565528a11d6405`; root workflow-order commit `04392af` runs the focused layout gate early. Root is handling push and Linux CI.

## Release closure: visual matrix stamp + gate documentation (05.10)

- Отдельный bounded checkout поверх `1d6bb37` (ветка release closure). Коммит `a32b3f2`.
- Подтверждённый дефект: `.github/workflows/release-visual-matrix.yml` задавал `VITE_RELEASE_MATRIX_QA=1`, но не `VITE_RELEASE_SHA`, поэтому `scripts/stamp-release.mjs` падал со `VITE_RELEASE_SHA must be an explicit 40-character git SHA`. Добавлена строка `VITE_RELEASE_SHA: ${{ github.sha }}` — тот же источник, что и в `ci.yml`.
- Документация: `RELEASE_VALIDATION.md` и `README.md` теперь различают документированный quick check list (подмножество) и авторитетный полный гейт (`.github/workflows/ci.yml` + visual matrix workflow). Явно зафиксировано, что зелёный CI не означает приёмку на реальных MAX/iOS/Telegram клиентах.
- Задокументирован `npm run test:mobile-evidence -- PATH`: 16 обязательных id (8 Android + 8 iOS), пять обязательных полей на запись, и перечень требований, которые валидатор НЕ проверяет и которые остаются ручными (BackButton, haptics, audio unlock, restart-циклы, boss pacing, Heart timing, twin-stick ergonomics, реальные legal values, trusted score с подписанным `initData`). Существующая ручная матрица §8 не изменена.
- `.gitignore`: добавлено ровно одно правило `artifacts/mobile-acceptance.json`. Проверено, что `artifacts/other.json` остаётся видимым для git; tracked paths под `artifacts/` отсутствуют.
- Локальные проверки: `npm ci` 0; `git diff --check` 0; `npm run test:tokens` 0 (`ui tokens contract: ok`); `npm run build` при `VITE_RELEASE_MATRIX_QA=1` и `VITE_RELEASE_SHA=$(git rev-parse HEAD)` — 0, `Stamped OFELIYA release 1d6bb37...`. Валидатор evidence не запускался: реальных device evidence нет.
- Реальные MAX Android/iOS 16/16, Telegram launch/referral/Daily и public `release.json` exact SHA остаются неподтверждёнными. Push/merge/deploy не выполнялись.

## Уточнение описания mobile-evidence валидатора (05.10)

- Коммит `d976778`, только README.md и RELEASE_VALIDATION.md. Семантика валидатора не менялась.
- Первая формулировка была неточной в двух местах. Проверено чтением `scripts/check-mobile-acceptance-evidence.mjs` и запуском на синтетических fixture: exit 0 при 16 обязательных id; exit 0 при тех же 16 плюс две дополнительные строки; exit 0 при `testedAt: "October 5, 2026"`; exit 1 при 15 обязательных id (даже с лишней строкой); exit 1 при `testedAt: "not-a-date"`.
- Итог: 16 id — это обязательный минимум, а не точное и исчерпывающее число. Валидатор итерирует только по своему массиву `required`, поэтому дополнительные строки `checks[]` разрешены и не инспектируются — `pass` их не подтверждает.
- `testedAt` проверяется через `Date.parse`, то есть принимается любое разбираемое значение даты/времени; ISO 8601 рекомендуется для читаемости, но не является требованием.

## Viewport-guarded Legendary card expansion (05.10)
- Final code commit `c01019f0708d9740cfc7a3f84da29bba149eed55` only selects 136px compact Legendary cards when the proposed full stack fits below the measured subtitle plus one card gap and above the bottom one-gap margin. Otherwise compact cards stay at the original 124px and their effects stay capped at two lines. At 320x568 the three-card stack fits; at 568x320 it does not expand.
- Probe emits card, effect, description, and footer bounds and asserts full text, required fixtures, panel containment, and no effect/description/footer intersection. Root reports the supplemental 18-case two-reward probe passed across 320x568, 568x320, and 390x740 on the fit guard. Typecheck and static Legendary/copy/token checks passed. Focused Linux run `37293956036` passed the earlier description-spacing version; root owns the final Linux run after this viewport guard.

## 2026-10-05: многокарточный Legendary probe
- `scripts/legendary-layout-probe.cjs` обновлён в `a4fd334f1f1b319d5a6016026a6689ef757eaceb`.
- Оставлены одиночные карточки; добавлены 15 distinct pairs actual Legendary definitions на viewports 320x568, 360x640, 390x740, synthetic three-Legendary layout fixture на этих размерах и guard fixture на 320x520.
- Per-card checks локализованы в родительском Phaser container. Первый browser run: 87/88; single и pair cases прошли. Один synthetic-three 320x480 failure вызван subtitle overlap на стрессовом fixture; его скорректировали до 320x520 для проверки compact-fit / expanded-no-fit guard. Повторный browser run прошёл 88/88 (24 singles, 60 pairs, 3 synthetic-three, 1 guard); short fixture 320x520 сохранил 124px cards, 9px subtitle gap, no overflow. Независимое review выполняется; Linux CI и real-device validation остаются pending. Первый Linux CI остановился до проверок из-за default URL 5197 вместо workflow Vite port 5173 (connection refused, `work/multicard-linux-plain.log:190`); probe default исправлен, rerun pending.

## 2026-10-05 Linux probe follow-up
- Linux run after restoring CI's port-5173 fallback executed 88 cases: 87 passed. All 15 actual Legendary pairs across each viewport and all single-card scenarios passed. The sole failure was the synthetic three-card short guard at 320x520, where a three-line effect reached the deliberate compact 2-line cap on 124px cards (`work/multicard-linux-plain2.log`).
- This is a stress-fixture content limit, not evidence of a trophy issue: the actual guaranteed trophy offers two cards. The taller synthetic long-effect stress case remains; the short guard now chooses definitions 0, 2, and 5, with effects fitting within two lines, while retaining all actual pairs at 320x520. Browser rerun and independent review pending. Linux build/test suite and device acceptance are not claimed passed.

The next Linux run exposed that short-guard index 3 also wraps to three lines. Measured wrap counts for the six definitions are `[2,3,2,3,3,2]`; the fixture now selects indices 0, 2, and 5 (index 5 is the last-life-saving Legendary), all measured at two lines. The 320x520 guard isolates height fitting; no Linux pass is claimed until rerun.

## VO-01 diagnostics-first — 07.10.2026
- Branch visual/vo-01-render-clarity-20261007, base d7797bc67bbda063d2fc3de68026101b0b061121, code/tests/docs 582723032b060f690eb59dac933c60834d0969a2.
- Runtime RED observed: Menu ready, __renderSnapshot undefined. Added bounded on-demand snapshot under existing DEV/QA gate; ordinary production runtime opacity passed.
- DEV and QA production browser 6/6 each: WebGL/Canvas DPR1/2/3, Menu/Game/two resizes/resume; local buffer remains CSS/logical size, no general HiDPI enabled. Text style/source resolutions recorded independently.
- Local startup, viewport, control modes/CDP multitouch, layout diagnostics, typecheck, ordinary + QA builds, tokens, runtime-quality, challenge, language checks passed. Builds stamped base SHA, not new code HEAD. Full commands/intermediate failures/warnings in docs/visual-overhaul/VO01_VALIDATION.md.
- Separate npm ci created ordinary local node_modules (Phaser 3.90.0), not a shared junction. npm/esbuild/git sandbox failures required approved escalation retries. No gate weakening or config/auth/route/skill changes.
- Kimi invalid API key artifact excluded; independent review coordinator-owned and pending. Local work/ evidence, .vo01-npm-cache and failed Kimi artifact intentionally untracked. No full CI/device acceptance/publication.

## VO01 Kimi fix round1 — 07.10.2026
- c231d60ebcf5748b9a2a2d2c5bbf99ca39adaa5a addresses F1-F5, F6/F8/F10. Successful text-only Kimi review now committed as docs/visual-overhaul/VO01_KIMI_REVIEW.md; old invalid-key artifact overwritten. External credential recovery was coordinator work; no auth touched here.
- Missing-scene runtime test observed null.cameras RED then GREEN. QA matrix 6/6, ordinary production static hook absence and runtime opacity, typecheck and builds passed. Actual commands/failures in VO01_VALIDATION.md. Builds stamped preceding 6204e33, not c231d60.
- Nested test objects destroyed; progression freeze remains fixture-only. Visible handler dispatch is not hidden transition. RESIZE intrinsic=CSS assertions pin current baseline, no HiDPI enabled.
- Original pipeline coordinator owns branch import/review/acceptance and broader plan. No additional workers, publication, configs/auth/routing changes; local cache/evidence excluded.


## VO02 combat presentation — 07.10.2026
- Branch `visual/vo02-combat-20261007`, base `a4d20d1`; code/tests `ddbe943`. Existing four retained emitters now select baked spark/chip frames from one 200x40 Canvas atlas (10 palette colors, 20 frames), providing renderer-independent event colors.
- Bullet-hit presentation receives existing normalized velocity and victim radius; directed spray originates at the incoming membrane surface. Legacy three-argument calls stay centered/radial. Death presentation receives radius only. Gameplay damage/knockback/event ordering, actor/projectile sources, Joystick, ImpactDirector, VfxBudget and disabled camera postFX are unchanged.
- Death chips and sparks share one token grant; 40% rounded down become chips. All VfxSystem circles are retained in a full12/reduced6 pool, including singularity core/collapse and delayed rings. Ordinary traffic reserves3/2 slots; important feedback preempts oldest ordinary then oldest important. Runtime scale<=.65 trims to6 immediately. Completion hides/reuses; explicit destroy and scene shutdown cancel tweens and reclaim circles/four emitters idempotently.
- Focused Node boundary contracts 8/8 passed; `test:impact-budget`, `test:runtime-quality`, `test:telegraphs`, `npx tsc --noEmit`, `git diff --check` passed. Six focused contracts were observed RED before implementation. No browser was run by this worker; coordinator owns real Phaser Canvas/WebGL and matrix acceptance plus independent Kimi review. This is focused task validation, not final release acceptance.


## VO02 Kimi fix1 tests — 07.10.2026
- Coordinator reports Kimi scoped code-correctness PASS, no Critical findings, four Important nonblocking coverage gaps. Worker verified current production behavior and added only test cases in `04f56f7c849a01d11b508fcfd5e67bdd89c1a1d1`; production source unchanged.
- New coverage: mixed ordinary/important runtime shedding retains all six important effects; important preemption cancels old tween and manually injected stale completion neither hides nor releases replacement; far black/white palette selection and genuine white/immune nearest tie; ordinary pool saturation blocks a hit ring while hit particles retain separate shared-budget accounting.
- Focused contracts now 12/12, plus typecheck/impact-budget/runtime-quality/telegraphs/whitespace exit0. Four isolated in-memory production mutations each failed its intended new test; temporary runner removed. No browser/independent rereview performed by worker.


## VO03 organ atmosphere — 07.10.2026
- Branch `visual/vo03-organ-atmosphere-20261007`, base `b3dec2f`, code/tests `8af0b92`. Full14/4/24 and reduced8/2/12 image pools unchanged; RBC depth bands full8/4/2 and reduced4/3/1, depths-26/-14/-8 with coherent scale/alpha/parallax. Runtime/Heart selection retains all available bands; Heart takes about half budget with minimum3.
- Three existing256px atmosphere backgrounds now bake periodic broad warm vessel flow and oblique Heart fibres. Actor/host/projectile/combat atlas sources unchanged; postFX disabled. Task5 backing compensation remains pending.
- One retained Rectangle replaces every transient flash; depth-6 alpha<=.075, elapsed-ms exponential decay. Single numeric190ms second beat is replaced by newer heartbeat and canceled at stage/shutdown. Visual envelope second peak starts onlyphase>=.22; no gameplay heartbeat/director/AI files changed. Repeated destroy and calls after shutdown are safe.
- Focused contracts9/9 (8 initial RED plus recipe RED), four mutation checks, stages/runtime-quality/impact-budget, VFX12/12, typecheck/whitespace exit0. Initial tuple/reduce type errors corrected. Existing npm http-proxy warning persists. Worker ran no browser or independent review; root owns those gates.


## VO04 audible audio mix — 07.10.2026
- Branch `visual/vo04-audio-20261007`, base `c247ba4`, code/tests/architecture `5c53377`. Pure production `audioMixMath` master.8/music.65, seven bed trims [.47,.37,.71,1.14,2,.32,.5], SFX role gains replace old manifest volumes. Decoded SFX all-channel peak scan once/cache, min(12,.63/peak), silent/invalid1; shoot/hit/pickup throttles unchanged.
- One shared master compressor threshold-8/knee6/ratio4/attack.003/release.12. Separate bed trim before music/duck/filter; procedural layer filter and direct-to-master bio topology preserved. No gameplay/RNG/Joystick/score/save/campaign or AdaptiveAudioDirector decision changes.
- Visibility flag retained before context creation, document hidden fallback, source/resume guards and pending-resume resuspension. Existing abort/request-ID cancellation and gesture retries retained; resume called synchronously within gesture stack. Adaptive transient tones now reclaim on run teardown as well as ended; SFX unaffected by stopMusic.
- Immutable identity-free diagnostics distinguish wanted/loading/actually-playing and decoded actual fallback index from requested deterministic selection; generic error text avoids raw URL/error payloads.
- Focused17/17 production TS math/WebAudio boundary contracts passed; initial13/14 expected RED plus existing throttle PASS. Required audio/save/RNG+checkpoint/typecheck/whitespace checks exit0. Existing npm http-proxy warning persists; no package/lock changes. Worker performed no browser, sample DSP rendering, subagents or independent review; root owns those acceptance steps.


## VO05 recovered core art verification — 07.10.2026
- Saved implementation `fdacc92` retained unchanged on `visual/vo05-art-20261007`; existing generated seven-WebP asset/provenance commit `346638d` is in ancestor history.
- Seven canonical bounded4x backings share ArtMetrics compensation; raw images bake then release after refresh. Boot missing-key preload timeout1800ms and procedural fallback retain logical geometry; all hero/enemy/host scale consumers compensate backing factor. Noncore projectile/RNA/organ/combat sources are unchanged.
- Recovery coverage `3de91b7` adds individual canonical preload guards, production Boot.create fallback ordering for no/partial raw results, and seven exact provenance/hash checks. Core art15/15, typecheck, viewport/tokens/impact-budget/runtime-quality/telegraphs, nonbrowser startup-renderer, VFX12/12, atmosphere9/9, save/RNG+checkpoint/stages and whitespace passed.
- Existing untracked timeout-mutant file retained untouched; it intentionally fails finite-XHR timeout assertion after1800->0 mutation (other11original cases pass). No package/lock/CI changes and no production rewrite required.
- Actual stalled-XHR/engine physics and raster/browser controls/elite/matrix remain root-owned. No browser, push/merge/deploy; final build/CI and real-device MAX/TG gates remain open.


## VO05 stalled-art follow-up — 07.10.2026
- Root actual-browser regression exposed >6000ms stalled startup. Phaser3.90 Loader defaults maxRetries2; File.onError reloads twice, creating3x1800ms windows. Desktop parallel32; Android parallel6 can additionally batch seven assets.
- `9dc9650` sets optional-art retries0 while queueing (restores prior value in finally for unrelated future files) and Boot concurrency max(existing,7). Per-file1800ms timeout unchanged. Core art contract now16/16 includes retry capture/restore and Android6/desktop32 batching policy.
- With root-authorized browser follow-up, actual Chromium Canvas startup available1335ms/missing1102ms/stalled2501ms/Android-UA stalled2673ms, all unchanged6000ms gate. Stalled modes each requested exactly7distinct assets, no retries; Android config default6 and Boot loader7 explicitly confirmed. Private extended copy of root startup test remains untracked for coordinator import.
- Elite fixture now compares actual halfWidth/halfHeight to floor(sourceWorldRadiusX/Y), matching Phaser Body.setCircle/updateBounds; logical tolerance1.01, markers/signatures/centers unchanged. Actual elite script passed against own Vite server with only URL substituted in temporary copy. No physics production changes.
- Typecheck, core16/16, nonbrowser startup-renderer, viewport/tokens/impact-budget and whitespace passed after fix. No push/merge/deploy. Root still owns full geometry/controls/matrix/scoped review and external device gates.

## VO06 Menu/HUD finish — 07.10.2026
- Branch `visual/vo06-ui-20261007`, base20f3b48; decorative implementation8d8d9cd changes only MenuScene/UIScene.
- Menu retains two specimen Graphics/one alpha tween and two static noninteractive selector edges behind existing text/hero/input. HUD90px plate gains a hairline; highlights reuse existing fill Graphics and inherit visibility/fades/pulses.
- Existing health/RNA text/fill timing, launch-once guard, callbacks and input/text geometry remain unchanged. No package/token/gameplay changes.
- Worker passed typecheck, tokens, ui-copy, layout-diagnostics, language1584, viewport, Legendary/impact/VFX smoke and whitespace. No browser evidence provided; coordinator owns browser and scoped review.

## 2026-10-07: Recovered visual overhaul integration

Tasks1–6 recovered/completed; seven generated local core assets, bounded art fallback, compensated geometry and Menu/HUD finish integrated. Final evidence/reviews in docs/visual-overhaul/VALIDATION_20261007.md. NativeHONOR HUD, rollback and Compose passed; real-device MAX/Telegram acceptance remains open. No merge/deploy.

## Hosted CI fixture recovery

PR179 created. Initial hosted failures investigated: Node22 hardware selected reduced in an implicit-full VFX test; uncontrolled RAF phases/random cosmetic placement caused QA parity flakiness; global ring spy included new16px hit ring after lysis108/150. Test-only fixes preserve production behavior and all thresholds. Independent reviews PASS after lazy-sprite and deferred-depth-sort corrections. Native production QA12 cases PASS; comprehension all6viewports PASS. Latest combined head hosted rerun pending. Original failures retained in CI_FIXTURE_REVIEW_20261007.md. No merge/deploy.

## 2026-10-08 continuation facts
Six-frame hero/antibody atlas adds ~1.68MiB RGBA backing plus GPU and uses three poses under reduced/runtime-low. Actual76Phaserbody/display/center rows match original baseline. Combo9999 peak and boss label/bar overlap reproduced and fixed; native6viewportHUD rerun passed. Original54contracts plus biological,12dense renderer/tier cases,4artstartup, audio8restart/0leaks and production-opacity passed. Exact-head build/hosted checks tracked in publication. No merge/deploy; real phones and full soundtrack/charge/death remain unavailable/incomplete. See continuation acceptance and VO traceability.

## Verified HiDPI QA continuation (08.10)
PR180 four exact-head hosted checks PASS at231b38d. QA-only capped2x actual adapter passes local six renderer/DPR cells/fourviewports, paired201actor Text/camera/input/resize, controls and teardown. Production default1x; no phone/offscreen/context acceptance. Source review Codex fallback PASS; additional Kimi403quota blocked.

## Release fixture correction (08.10)
User-authorized179/180/181 merged tomain50c47049. Main CI37763374322 threefailedattempts retained. Two fixture-only scripts corrected without production/timeout/assertion relaxation; exact localPASS, independent source reviewPASS. Fresh hosted checks/deploypending.

## Cardiac clock isolation follow-up
PR182 initial head e1c058e CI37768249337 passed ceremony but failed Cardiac8s. Diagnostic-only14b6d3c CI37769887253 remains running. A local synthetic sparse RAF35ms plus explicit cooldown240 reproduced the timeout: Game active/notpaused/UI clear, boss phase2, stage2649 versus scene16936, nextTelegraph13575 already due, heartbeat3216 safeIndicator true; zero page errors. This demonstrates the mixed-clock scheduling mechanism, not the exact hosted runner conditions (default cooldown120).

Fixture now uses the real heartbeat.restore with nextImpact=stageTime+60000 and bossWasActive=true, with exact60000 setup assertion. Game.update, real Cardiac scheduler and canSchedule, original4700/850/280 source timing,8s/2s/1.5s browser deadlines, exact14damage and heartbeatClear remain. It intentionally does not validate live heartbeat concurrency; unchanged test:pacing separately tests1980/1981 boundary and exclusion. Native exactscript plus paired synthetic stressed fixture PASS; pacing PASS. Independent Codex source review PASS. Additional Kimi OmniRoute review returned empty content and is NOT approval. Await fresh PR/main CI before deploy.

## Hosted progression cause captured and pool reset
Diagnostic-only14b6d3c CI37769887253 failed with Game inactive/paused, UI modalOpen/uiBlocked, awaitingChoice true, stage149ms, bossactivephase2, hazard disabled/serial0 and no errors. This directly proves a new progression choice paused the updater; it does not identify the individual RNA drop. The only ordinary queued-level source is onGemCollected; stage transition was not occurring.

The fixture now uses production-standard deactivateForStageReset for existing bullets/RNA gems, resets host cells and excludes their update/rewards from this beam contract. It asserts zero active bullets/gems. Paired local inherited-RNA100 fixture: baselinef292dc7 paused atstage33ms/queued3/awaitingChoice and failed8s; corrected fixture PASS. Exact corrected script alsoPASS. Thus no onGemCollected/Game.update/hazard method is stubbed, no assertion or timeout is loosened. Host-cell/RNA integration is outside this scoped beam test; other unchanged gameplay/browser suites cover it. Mixed-clock synthetic finding remains separately documented and was not the captured hosted cause.

## Dense readability fixture lifecycle recovery
Final6c84b89 CI37771605821 passed Legendary, Cardiac and controls, then dense-readability failed target150/cache150 with allalpha1. Enemy preUpdate reads prior density; Game.update refreshes cache afterward. Original fixed150ms sleep need not contain both real frames.

Density fixture now waits two actual Scene POST_UPDATE frames with cache>=target, bounded1500ms, before unchanged150/200targets/alpha assertions. This replaces a synchronization assumption, NOT an unchanged performance/timing gate. No manual Game/Enemy update or cache writes. Startup accepts an already-paused real Game, resumes then clears progression/UI; new unblocked assertion added. Exact native finalscript PASS; original native Game.active-only wait had stopped at startup30s. Paired sparseRAF240ms with shared corrected startup: old150ms sleep failed cache100/target150/allalpha1; completed-frame wait PASS. This demonstrates synchronization sensitivity, not the exact hosted scheduling. Independent Codex source review PASS. Additional Kimi nonstream diagnostic HTTP504; no routed approval.
# 2026-10-11 Render migration

Authorized target: Render Free with durable state in existing free Supabase.
Initial export:67scores,4profiles,Telegram user list preserved. Source production
SHAa1e540c49225d9b627f44c291e5a67f3f27c49e7. New hosting entrypoint and durable
adapter tested; no production traffic switched yet. See deploy/RENDER.md.


## 2026-10-11 local cutover continuation
Render public release fb54e0b verified against all54public files and release
hashes; remote revision8 healthy. Canonical DNS still Cloud.ru/a1e540c. Existing
Render key cannot access service workspace; available UI awaits GitHub2FA.
MAX webhook missing in current Render deployment (405), corrected locally with
existing handlers and credential mapping; new HTTP/auth/profile tests passed.
No production settings or Cloud.ru resources changed. See latest00_HANDOFF.
# B2/B4 integration follow-up — 20 October 2026

Local edits on `feat/b2b4-integration-20261020`, base SHA `07552995892a83df24665ebc5ff5867809d30042`: CI workflow invokes `test:b2b4-fixes`; that script now includes reduced-motion regression. Cached `src/systems/MotionPreferences.ts` follows current media query preference without per-frame query allocation. `GameScene.shake` respects reduce; `Enemy` pressure-wave and heartbeat auras keep phase identity static; `UIScene` suppresses transition pulse but retains mode color; danger echo and actionable warning rendering remain unchanged. Commands: `npm ci` exit 0; `npm run test:b2b4-fixes` exit 0 (900/900 geometry plus B4 and motion tests); `npm run test:presentation` exit 0; tokens/UI-copy, telegraphs/impact-budget exit 0; `npx tsc --noEmit` exit 0; `npm run build` exit 0 with explicit `VITE_RELEASE_SHA=07552995892a83df24665ebc5ff5867809d30042`. Build warns about runtime-config script and unresolved font URLs as before. Actual browser QA pending root. No commit/push/merge/deploy.

Root validation: actual Canvas/WebGL echo matrix 16/16 passed at320/390/768/1080 with both motion preferences; world/HUD phase and live-preference checks4/4 passed. Adapted repo41 two-postrender/native-decoded screenshot pixel check without pngjs; strict3-cell impact passed, WebGL idle0/hit3982 white pixels. Negative control clearing tint fails as expected. Independent source review found no actionable P1/P2. Final-head full tests/build are tracked externally in12_INTEGRATION_PREP.
