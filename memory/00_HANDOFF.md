# Production deployment verified — 2026-10-14

Owner explicitly authorized production deployment after the maintenance package.
Published source is `a0faa496ce9c7770d27c549684c6c41000df947f`, whose exact-main
CI38525751420 passed build, browser-smoke and production-contract.
Render deploy `dep-db7l3j7avr4c738l7mqg` succeeded and became Live at
12:57:19 Europe/Moscow; duration 50.1 seconds. Trigger: manual Dashboard,
Deploy latest commit. No pinned-commit action or service configuration change.

Public release.json matches that source. HTML, sw.js and runtime-config.js
SHA256 hashes match the marker, independently checked by Luna and repeated by
parent. /ready and /health return200; MAX and Telegram configured, remote
persistence healthy and clean. Before/after: scores73, analyticsEvents615,
runGrants1, dailyRuns1; remote revision123→124 across startup. No synthetic
production entities or user messages were created by this verification.

Render Events now includes Deploy skipped for `a0faa49` after the repository
access correction: GitHub events reach Render, while the merge intentionally
contained [skip render]. This does not prove successful automatic deployment;
observe a normal next code release with no skip phrase and exact successful CI.
Real S20+/MAX Android/iOS/Telegram and mobile-performance gates remain open.
Keep future documentation merges on branches/PRs with full green CI and
[skip render], without a CI skip phrase. Historical runtime identities below
are superseded by this deployment. No further production deployment is needed
for this documentation update.

## Previous snapshots (current release above takes precedence)

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
