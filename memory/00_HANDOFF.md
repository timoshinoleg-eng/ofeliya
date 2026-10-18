# Visual upgrade Phase B4 (boss identity) — 19 October 2026

Owner said «да» after B3; B4 same day, commit c672a00. Diagnosis: boss had three disconnected dialects — phase aura (armored cyan ring+ticks / recovery gold arcs / broken green), red critical telegraph, plain red HUD strip with no shared vocabulary; phase ceremony only readable by watching the boss. Fix: (1) HUD boss bar adopts aura vocabulary — white hairline frame, 6 segment ticks above bar, red diamond emblem; ticks tinted by live phase via new Enemy.getPhaseMode()/GameScene.getBossPhaseMode() (armored=white, recovery=gold, broken=green) so the recovery reward window reads from HUD; (2) recovery/broken aura modes draw the same 6-tick ring as armored, in mode color. Telegraph contract untouched (test:telegraphs PASS). Evidence: screenshots/b4-before|after-{pursuit,telegraph,recovery,hudbar}(.png|-zoom.png) via scripts/boss-capture.cjs (HUD bar via QA-only wave.boss substitution, documented). tsc, presentation, telegraphs, boss-presentation (9 geometries), mini-boss, wave-events PASS. Control perf 60s after B4: median 20.3 FPS (noise band); boss-specific add <=6 stroke primitives in recovery/broken only. Bundle 430.83 kB = +2.4% vs prod. Donor: prior MIT donor checked — single-color bosses, no phase ceremony, text-only bossBanner; original implementation. Known limits: recovery before/after frames not perfectly synced (state reverts in ~300ms; before shot caught armored — disclosed); cardiac boss untouched. B5 next: token migration completion (combat still on COLORS: GameScene 44x, Enemy 31x).

## Previous snapshots
# Visual upgrade Phase B3 (mutation rarity hierarchy) — 19 October 2026

Owner said «да» after B2; B3 executed same day, commit 8164f5f. Diagnosis reproduced with controlled synthetic choice defs (driver scripts/mutation-cards-capture.cjs): tier signal was only an 11-12px header word + 3px rail — cards indistinguishable at a glance (b3-before-mixed.png). Fix (UIScene choice modal only): tier pips in card header band (1 common / 2 rare / 3 legendary+evolution, VISUAL.host/rare/warning colors) + graduated frame (rare 1.2px stroke, legendary 2.2px + warning wash; common quiet); migrated card-flow legacy palette (COLORS.gold wash, #ffe066 x2) to VISUAL.warning tokens. No new words (language guard 1597 literals PASS), zero per-frame cost (modal-lifetime objects). Bundle 429.68 kB = +2.1% vs prod. tsc, tokens, language, ui-copy, legendary, layout-diagnostics, presentation PASS. Donor search: canvas-vampire-survivors has no rarity system at all (data.js/ui.js) — original implementation. Human glance test on device remains owner-side. B4 next: boss identity system (HUD + phase ceremony consistency).

## Previous snapshots
# Visual upgrade Phase B2 (silhouette readability) — 19 October 2026

Owner said «продолжай» after B1 report; B2 executed same day on feat/visual-combat-20261018, commit 27f914d on top of B1 stack (head before: 353fd06). Measured diagnosis: existing playerHalo (depth 7.5) renders BELOW enemies (depth 10), so at 150-200 enemies the dark bubble is fully hidden; baseline frame at 182 enemies (seed 424242): core luminance 62, core↔ring delta 48 — player readable only by hurt-flash luck. Player body is a dark gear (isolation probe iso-*.png). Fix (visual-only, density-gated ≥110, ramp 110-200, ≤6 primitives/frame): silhouetteClearing Graphics at depth 11 (dark pocket ABOVE enemy mass, below elite markers 12 / health bars 13 / bullets 14 / player 15) + playerGlow at depth 14.5 (3-step light pool under the dark virion). Result: core luminance 195, delta 144, annulus calm 0.687. Perf paired 60s: true Canvas 60.5→60.5 median, WebGL-SwiftShader within noise; bundle 429.35 kB = +2.0% vs prod (limit 5%). impact-budget/runtime-quality/presentation PASS. Paired evidence: screenshots/silhouette-b2-before|after(.png/.webm), iso-*.png, b2-*-zoom.png; perf jsons perf-combat-b2-*; analyzer scripts/analyze-silhouette-b2.py; driver scripts/silhouette-video.cjs. Donor: none — searched canvas-vampire-survivors (prior MIT donor), no player-visibility mechanism exists there (effects.js = flash/ring/burst only); implementation original per project layer conventions. Documented in evidence/DONOR_PROVENANCE.md (B2 section). Known accepted tradeoff: role/boss telegraphs (depth 8) inside the r≤52 pocket are dimmed — actionable telegraph range is far larger. Human 5-second findability test on a real device remains owner-side.

B3 next: rarity hierarchy of mutations (flat cards, legacy-palette accents per UIScene audit).

## Previous snapshots
# Visual upgrade Phase B1 (combat feedback pilot) — 19 October 2026

Branch feat/visual-combat-20261018 (worktree worktrees/visual-combat-20261018) starts at origin/main abdb10c (= production). Owner approved Phase A audit (18.10) and Phase B execution. Pilot B1 ports the combat-feedback core of own stale PR #183 (commit 0e3269c) by adaptation, not merge: BiologicalImpact hit-deform atlas (24 frames, 3 speed tiers, 180 ms hold, BootScene load, ArtMetrics bio-hit-*), directional hit reaction (Enemy.takeDamage → biologicalHitAt/Direction, Player.markHurt; GameScene passes directions in 4 of 5 points, cardiac hazard left at donor default) and VfxSystem.biologicalDeath ghost pool (collapse 180/120 ms, cap 4 / 2 at density≥150, full skip ≥150). Commits: 91891f7 (atlas+tests), 7d2aac2 (hit reaction), 81049f2 (death collapse), 7be28d6 (smoke driver port + THIRD_PARTY_NOTICES provenance). Balance untouched (damage/HP/enemy counts); Joystick.ts untouched; no new dependencies; Phaser only.

Gates: tsc clean; biological-impact/biological-animation/vfx-presentation/core-art/atmosphere/boss-presentation/mutation-art-recovery/social-hub/tokens-contract/checkpoint-resume/impact-budget/runtime-quality/visual-completion/startup-art-fallback all PASS; browser-smoke legal-config failure confirmed pre-existing on untouched abdb10c (local build lacks release env — not a B1 regression). Bundle 428.56 kB vs prod 420.85 kB = +1.8% (limit 5%). Paired perf 60 s: WebGL-SwiftShader 19.8→19.3 median, true Canvas 59.1→59.5 — no measurable regression. Impact smoke: baseline abdb10c 21 contract deviations (all 3 cells), branch strict 0 deviations; paired screenshots/videos in workspace AUDIT_2026-10-18/screenshots/impact-before|after/.

Correction to Phase A: its combat numbers labeled "Canvas" were actually WebGL-SwiftShader (swapped ternary in perf driver; Phaser CANVAS=1/WEBGL=2); true Canvas first measured in B1 (~59 FPS). Both evidence docs corrected.

Owner-side open items: build:max + release-env smokes (require owner env), device gates, playtest of the branch. B2 (silhouette readability at 150+ enemies; halo insufficient per 99.3% ring occupancy measurement) is the next highest-value item and its measurements already exist. No merge/push/deploy performed; merge to main remains prohibited without owner authorization.

Read AUDIT_2026-10-18/REPORT_VISUAL_UPGRADE.md and evidence/DONOR_PROVENANCE.md for the full pilot record.

## Previous snapshots
# Visual implementation completion — 16 October 2026

Branch visual/completion-20261016 extends verified public7a0d829 (PR216). Implemented distinct Player mutation geometry/combined composition, unified SocialHub and Codex, measured11px scrolling result report with pinned actions, pointer ownership and long-share fit, quieter pause. Existing gameplay/RNG/physics/score/network/assets/service settings are retained. Main integration is not authorized.

Read docs/release/VISUAL_COMPLETION_20261016.md. Root executed rich result/resumed/share/social/error/allCodex browser320/360/390; presentation and TypeScript passed. Independent source and native visual reviews resolved concrete issues and found no remaining P1/P2. Short live100-spawn AI/physics desktop before/after has p95~16.8ms in Canvas/WebGL, explicitly not device FPS. Final exact-head hosted CI/matrix, fresh backup and pinned deployment/readback are still pending; do not claim publication from this snapshot.

The implementation gaps from the earlier Phase1 ledger are addressed in this branch; old pending statements below are historical snapshots. Device MAX/TG/iOS, sustained performance/thermals, newcomer/full-campaign acceptance remain open. Preserve other PRs and private state backups. Companion documentation branch carries final evidence without changing the tested product SHA after publication.

## Previous snapshots
# Mutation art recovery continuation — 16 October 2026
Branch fix/mutation-art-recovery-20261016 starts from the verified live visual candidate44c6579 (PR214). Cold-start optional mutation requests can exceed Boot1800ms; fallback previously remained permanent. The scoped fix records canonical texture provenance and recovers only mutation-prism/halo/singularity after first render. Same256px CanvasTexture objects refresh in place; Player/physics/gameplay/assets remain unchanged. Two8000ms attempts/key,750ms backoff; per-game dedup and destruction cancellation. Five module contracts, full presentation and TypeScript passed. Read docs/release/MUTATION_ART_RECOVERY_20261016.md.

Local delayed-image Canvas/WebGL regression passed with sixteen paired actual Player frames and exact packaged pixels. Independent source review found no concrete P1/P2. Remaining before publication: final still-image review, exact-head hosted CI/matrix, fresh private backup and pinned Render Free publication/readback. Owner authorizes continuation/deployment; main merge remains prohibited. Keep PR213/214/215 and other parallel PRs separate. Physical-device/FPS/newcomer acceptance remains open. Update the release document after real results; do not treat this pending snapshot as proof of publication.

## Previous snapshots
# Phase1 visual candidate continuation — 16 October 2026
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

# Telegram bot image follow-up — 2026-10-13

PR #199 (`fix/telegram-bot-image-20261013`) starts from main `f48c143`.
RED `d9fb1c7`: the existing `test:telegram-bot` fails because the bot image
does not COPY its module-scope `telegram-webhook.mjs` dependency. GREEN
`360c05b`: COPY added and the same guard passes. Real `node:22-alpine` images
were built locally: the old image fails its network-disabled import with
`ERR_MODULE_NOT_FOUND`; the fixed image imports successfully without polling.
`server:test` (75 core checks plus the additional suites) and TypeScript/Vite
build pass. Hosted CI results must be checked on the final PR head before merge.

CI already runs the guard, but does NOT currently build `--target telegram-bot`:
it builds runtime, score and static. The external handoff's contrary statement
was independently disproved. Only Dockerfile and the existing bot guard changed
in code; the rest of the legacy security patch remains superseded by PR #197.
PR #189 is closed with links to current/archived memory; its branch is preserved.

Render investigation: no working-account API credential is available in the
current environment or the local credential locations checked. No authenticated
Render GET has been made in this follow-up, so current provider/branch/filters
and the missing automatic trigger's cause remain unverified. Owner is arranging
Render login. Use the production account/service below, never the other MCP
workspace. Check Git-provider connection, repo/branch, checksPass, filters and
deployment triggers when access is available. Preserve settings until a cause
is established; verify automatic deployment on the next runtime release.

Do not deploy this package. Use a merge commit containing `[skip render]` (and
no CI-skip phrase) after the final PR CI passes; this prevents an incidental
auto-deploy while preserving main CI. Production runtime identity remains the
release below. Physical S20+/MAX Android/iOS/Telegram acceptance is still open.

# Verified review-fix release — 2026-10-13

Runtime source: c0c72fa81690b562e15c1d87580c66af842b3f3b (PR197 merged). Main CI38375891119: build/browser-smoke/production-contract success. Render Free deployment dep-db6vmg4s728c73cv4010 is live in production workspace tea-d8iruouq1p3s73f30a90 (timoshin.oleg@gmail.com). Canonical https://ofeliya.freeveol.dpdns.org/ofeliya/ reports this SHA. Metadata-only commits after this release do not change the published source identity.

Measured:56 public files match a local build using current production VITE values;47 exact and9 differing only in carriage-return line endings. Remote HTML/runtime-config/SW hashes match their release marker exactly. /ready200 aggregates configured MAX/TG and healthy API; Render healthCheckPath is /ready. Eight synthetic signed profile/social reads and both webhook auth gates passed; no test scores or fake registrations were written. Browser menu and actual touch start reached the first mutation without page errors/CSP violations, QA hooks absent. This is desktop Chromium, not a real phone.

Private S3 backup revision78 (13094bytes) was downloaded and verified; isolated restore started the new server with71scores and validated registry. Published state preserved all baseline scores/profiles/registrations. After a Render restart, revision80→81, all71scores and existing profiles/registry remained. source-map-js1.2.2 is merged; superseded draftPR184 is closed, branch preserved.

Remaining: real MAX Android/iOS and Telegram acceptance, numerical Android/MAX/TG versions on owner's Samsung S20+, newcomer study and mobile frame-time/thermal measurements. test:mobile-evidence stays fail-closed; no fabricated PASS/FPS. Automatic deployment is configured checksPass but did not create this deployment after successful main CI; one pinned API deployment was used. Recheck Git-provider/automatic-trigger behavior on the next code release. No paid infrastructure, DNS/bot identity/secret rotation or keepalive was introduced.

Next: collect device evidence on the published source, not the old d92325b. Use existing direct Render API access; connector aurum1984@ya.ru refers to another workspace. Secrets remain in local credential files, never in this repository. Retired Cloud.ru instructions are historical. See deploy/RENDER.md and docs/release/KIMI_REVIEW_FIXES_20261013.md; that latter document records pre-release implementation evidence.
