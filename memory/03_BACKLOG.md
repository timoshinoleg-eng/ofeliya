# Quest integration backlog — 23.10.2026

1. Разобрать/повторить полный integration-visual-browser: utility20 PASS, motion/Game часть не завершилась за внешний180s; причина пока не доказана. Не ослаблять тест.
2. После отдельного разрешения публикации: hosted CI exact SHA и physical MAX/Telegram safe area/touch/thermal acceptance. Сейчас NOT_RUN.
3. Необязательный компактный HUD — отдельная задача, текущий scope закрывает Menu→Codex→Quests.
4. Известные границы: best-effort localStorage, single-tab local progress, legacy checkpoints без неизвестных RNA/mutation/elite counters; нет reward/server/account sync.

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

Для решения о будущем merge использовать полный набор фактических тестов объединённой версии, повторяемость HUD, semantic comparison #210/#183 и отдельную приёмку Samsung S20+ Telegram/Daily из 14_PREMERGE_VALIDATION. Не считать WSL/desktop браузер проверкой телефона. Не считать неизвестную причину прежнего HUD отказа устранённой. Ниже сохранён исторический backlog обеих веток; его пункты требуют сопоставления с актуальным отчётом.

Base abdb10c19d17de074f2be90e52d59cd9485c5b1b; Daily 500ab50fa3bc2e374f78ce0c3218f63065e8b7e1; B2/B4 cd8612854d28b19ed2e0b49f4451c6c9704a3b74. Все исходные версии доступны в Git parents и в evidence/memory-sources отчёта.

## Исторические добавления Daily #221 (перед общим блоком)

# Daily outbox integration preparation — 20 October 2026

Branch fix/daily-outbox-integration-20261020 is isolated from main abdb10c. Applied audited daily-outbox-fix-v3.patch; added exact-ID settlement of migrated in-flight Daily requests and two behavioral regressions. MAX and Telegram coverage checks two offline tickets, account ownership, refreshed credentials, quota failure, missing Daily acknowledgement, lost response/idempotency, concurrent A/B settlement. Focused29/29 passes on Node22.23.3. Broader validation and publication readiness are recorded externally in OFELIYA_MASTER/12_INTEGRATION_PREP; no publication, merge or deploy authorized.

Storage is bounded8+one Daily and best-effort in restricted WebViews. At failed migration/quota, old ticket is retained and network is returned for the new ticket; cannot promise durable storage when localStorage refuses writes. Real MAX/Telegram device acceptance and hosted CI remain pending.

## Previous context


## Исторические добавления B2/B4 #222 (перед общим блоком)

# Visual upgrade backlog status — 19 October 2026 (updated ×3)

Phase B progress: **B1–B4 DONE** on feat/visual-combat-20261018 (head c672a00): B1 combat feedback, B2 silhouette, B3 rarity hierarchy, B4 boss identity — evidence in AUDIT_2026-10-18/ (REPORT_VISUAL_UPGRADE.md §0.4–§0). Owner acceptance pending (build:max in owner env, device gates, human checks). Remaining, in mandated order:

- **B5 — завершение миграции токенов:** один словарь палитр (hudTokens/visualTokens как источник), устранение inline-наследия. Бой сейчас целиком на COLORS (GameScene 44×, Enemy 31×); B3 закрыл часть UIScene. Рекомендуется следующим — это самый объёмный пункт, стоит резать на подэтапы.
- **B6 — мобильная оптичность:** размеры шрифтов, safe area, hit-area ≥44 px; HiDPI только по замерам.

Метод для каждого пункта: пара «до/после» (одинаковый сид/вьюпорт/состояние; движущееся — видео), перф-замер при правке в игровом цикле, метод доноров с provenance, регрессии после каждого пункта.

## Previous snapshots

## Общая сохранённая история исходного main

# Visual implementation completion — 16 October 2026

Branch visual/completion-20261016 extends verified public7a0d829 (PR216). Implemented distinct Player mutation geometry/combined composition, unified SocialHub and Codex, measured11px scrolling result report with pinned actions, pointer ownership and long-share fit, quieter pause. Existing gameplay/RNG/physics/score/network/assets/service settings are retained. Main integration is not authorized.

Read docs/release/VISUAL_COMPLETION_20261016.md. Root executed rich result/resumed/share/social/error/allCodex browser320/360/390; presentation and TypeScript passed. Independent source and native visual reviews resolved concrete issues and found no remaining P1/P2. Short live100-spawn AI/physics desktop before/after has p95~16.8ms in Canvas/WebGL, explicitly not device FPS. Final exact-head hosted CI/matrix, fresh backup and pinned deployment/readback are still pending; do not claim publication from this snapshot.

The implementation gaps from the earlier Phase1 ledger are addressed in this branch; old pending statements below are historical snapshots. Device MAX/TG/iOS, sustained performance/thermals, newcomer/full-campaign acceptance remain open. Preserve other PRs and private state backups. Companion documentation branch carries final evidence without changing the tested product SHA after publication.

## Previous snapshots
# Mutation art recovery verification backlog — 16 October 2026
Branch fix/mutation-art-recovery-20261016 starts from the verified live visual candidate44c6579 (PR214). Cold-start optional mutation requests can exceed Boot1800ms; fallback previously remained permanent. The scoped fix records canonical texture provenance and recovers only mutation-prism/halo/singularity after first render. Same256px CanvasTexture objects refresh in place; Player/physics/gameplay/assets remain unchanged. Two8000ms attempts/key,750ms backoff; per-game dedup and destruction cancellation. Five module contracts, full presentation and TypeScript passed. Read docs/release/MUTATION_ART_RECOVERY_20261016.md.

Local delayed-image Canvas/WebGL regression passed with sixteen paired actual Player frames and exact packaged pixels. Independent source review found no concrete P1/P2. Remaining before publication: final still-image review, exact-head hosted CI/matrix, fresh private backup and pinned Render Free publication/readback. Owner authorizes continuation/deployment; main merge remains prohibited. Keep PR213/214/215 and other parallel PRs separate. Physical-device/FPS/newcomer acceptance remains open. Update the release document after real results; do not treat this pending snapshot as proof of publication.

## Previous snapshots
# Phase1 remaining acceptance gates — 16 October 2026
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

# Telegram image maintenance follow-up — 2026-10-13

- PR #199: missing webhook helper fixed; new bot image COPY guard verified
  RED/GREEN, including real Node22 Docker imports with network disabled.
  Check full hosted CI on the final PR head before merging with `[skip render]`.
- PR #189 closed with current/archive handoff links; branch preserved.
- Security patch note corrected: equivalent and stricter fixes are in PR #197.
- Render auto-deploy root cause remains open pending working-account access.
  Existing API credential was not found locally; no live GET or setting change
  has been performed in this follow-up. Owner is arranging login. Inspect
  Git-provider connection, repo `timoshinoleg-eng/ofeliya`, main, checksPass,
  buildFilter and deployment history/triggers; do not assume provider validity
  from the repository URL alone. Official Render docs require a connected Git
  provider for auto-deploy; public-URL services require manual deployment:
  https://render.com/docs/deploys#automatic-deploys.
  After an evidence-based minimal fix, validate on the next runtime release.
- Real Samsung S20+ OS/MAX/TG versions, recordings, MAX Android/iOS/Telegram
  acceptance, newcomer study and measured mobile performance remain external.

# Verified review-fix release — 2026-10-13

Runtime source: c0c72fa81690b562e15c1d87580c66af842b3f3b (PR197 merged). Main CI38375891119: build/browser-smoke/production-contract success. Render Free deployment dep-db6vmg4s728c73cv4010 is live in production workspace tea-d8iruouq1p3s73f30a90 (timoshin.oleg@gmail.com). Canonical https://ofeliya.freeveol.dpdns.org/ofeliya/ reports this SHA. Metadata-only commits after this release do not change the published source identity.

Remaining: real MAX Android/iOS and Telegram acceptance, numerical Android/MAX/TG versions on owner's Samsung S20+, newcomer study and mobile frame-time/thermal measurements. test:mobile-evidence stays fail-closed; no fabricated PASS/FPS. Automatic deployment is configured checksPass but did not create this deployment after successful main CI; one pinned API deployment was used. Recheck Git-provider/automatic-trigger behavior on the next code release. No paid infrastructure, DNS/bot identity/secret rotation or keepalive was introduced.

## Historical snapshots (current verified facts above take precedence)

# Current review fixes — 2026-10-13

Branch fix/kimi-review-20261013, based on main26fcc88. User approved the independent review follow-up plan. See docs/release/KIMI_REVIEW_FIXES_20261013.md for contracts, tests and mixed-version policy. Previous handoff is archived under memory/archive/2026-10-13-before-review-fixes/; older state/decisions/backlog remain as historical notes below.

Snapshot gates: final-head CI, production backup/restore and release parity, S20+ Android/MAX/TG numerical versions + real acceptance/performance, MAXiOS, newcomer study. Broad scene refactoring and performance promises require measured evidence. Equivalent and stricter security fixes were merged in PR #197 (`server/request-policy.mjs`, `server/security-regressions.test.mjs`); do not import the old security patch wholesale. PR184 dependency fixes are included; PR #184 was subsequently closed with its branch preserved.

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

# Cutover backlog - 2026-10-11

Completed: dedicated MAX hosting callback; game-relative API/Telegram path
compatibility; new owner-account Render Free service; main/checksPass config;
canonical DNS/TLS; signed profiles/social reads; Telegram prepared sharing;
remote restart restore; full public-file/hash checks; OFELIYA Cloud.ru VM/disk/IP
removal; obsolete Cloud.ru deploy workflow disabled.

Remaining external acceptance: real /start in Telegram and MAX, Mini App
gameplay and save/reopen on owner devices. Automated/synthetic evidence does
not replace those checks. Render idle cold starts remain expected.
Other Cloud.ru workloads and charges require a separate scope; preserved.
The inaccessible old Render preview may be removed by its workspace owner.
Prior PR189 contains historical status and should not overwrite this handoff.

Supabase state access key was rotated in the existing Free project. The new
Render uses the replacement; the old key returns401 for read and writer claim,
so the inaccessible preview cannot steal production persistence. A 24-hour
management token was scoped only to this project and Edge Functions. No keys
are committed. Main CI38158081443 passed all three jobs for runtime d92325b.

## Historical notes

# BACKLOG — OFELIYA: STRAIN ZERO

Обновлено: 2026-10-05. Отмечайте сделанное галочкой; новые пункты добавляйте сюда, а не в чат.

## Control-mode browser smoke (06.10)
- [ ] Root review/publish `fix/control-smoke-preconditions-20261006` and rerun full main CI; focused browser smoke passed locally.

## Deploy CI payload fix (05.10)
- [x] PR #173 merged the file-backed deploy CI payload fix; target branch inherits it from main `b174b40`.
- [x] PR #174 merged targeted CI lookup and Ubuntu 22.04 pin; target branch inherits it from main `18e6f05`.
- [ ] Root review/PR for `fix/deploy-standalone-policy-20261005`, then wait for full main CI at the new SHA before deployment retry. No deploy performed by this task.

## Сейчас (P0)

- [x] Синхронизировать worktree с origin/main — выполнено 28.09 (main @ 480c67b).
- [x] Подтянуть origin/main в `feat/donor-quick-wins` — merge `45712e9` (без конфликтов, запушено).
- [x] Канонический гейт на синхронизированной ветке — пройден 28.09 (9 тестов + release:check + build).
- [x] Тест-цикл B в OpenCode (два прохода, смена модели) — пройден 29.09.
- [x] Внешнее ревью (внешняя модель — `memory/06_REVIEW.md`) + merge PR #151 — выполнено 29.09 (+2-е мнение `space-bunny-free`; пост-ревью правки PR #154). [ ] ChatGPT-вариант ревью — опционально, позже.
- [ ] Внешний релиз-гейт: реальные MAX Android/iOS — 16 пунктов (`RELEASE_VALIDATION.md` §8). Evidence validator реализован 02.10; реальные 16/16 ещё не сняты.
- [x] Merge PR #151: система памяти (квик-вины уже в main через #137) — выполнен 29.09 после внешнего ревью.
- [x] `.gitignore` для служебных каталогов — добавлено 29.09 (13 записей: 9 каталогов + 4 `*.capability.json`).
- [x] Проверить служебные untracked-каталоги (скан 29.09: 13 записей, ~55 файлов — совпадений 0). Исходная запись: - [ ] Проверить служебные untracked-каталоги (`config/`, `skills/`, `.cluster/`, `handoff-system/`, `ofelia-pilot/`, `*.capability.json`) на ключи/секреты перед этапом 3 (правило AGENTS.md — пока только на дисциплине).
- [ ] Балансировка по полным реальным прогонам (9+ минут).

## Далее (P1)

- [x] Реализовать продуктовую funnel-инструментацию и CLI-отчёт (02.10): app_open → run_start → run_60s → boss1 → heart → replay, onboarding timing/exits, D1, referral open → run_start.
- [x] Перестроить first-run tutorial вокруг RNA/мутации/заражения клетки-хозяина; удалить pause как обязательный шаг (02.10).
- [ ] Провести наблюдаемый плейтест новых первых 60 секунд на людях; собрать completion/time/exit reasons, не подменять smoke-тестом.
- [ ] Пройти реальный MAX Daily invite path на двух устройствах: send → open → run_start → result; сохранить evidence.

- [ ] Heart safe-pocket timing — плейтест читаемости; оба боя боссов — по ощущениям, не только технически.
- [ ] Twin-stick эргономика на реальных устройствах.
- [ ] Dense readability 100/150/200 — держать при любых визуальных изменениях.
- [x] Пилот памяти, Honor: тест-цикл B пройден 29.09; [ ] HP — блок A чек-листа (этап 3).
- [ ] Синхронизация двух ноутов: протокол pull/push в ежедневной работе.
- [ ] Правило: числа и ссылки в файлах памяти — только из git-вывода (по итогам 2-го внешнего ревью, 29.09).

## Отложено (не трогать без отдельной миграции)

- Третий орган / дополнительный акт кампании; сложность выше Strained; крупная экспансия Legendary;
  постоянная stat-прокачка; широкая внешняя арт/аудио-пайплайн; крупный рефакторинг или смена рендера.

## Audit follow-up 03.10
- [x] Revalidate D1 elite hitbox: false positive; Phaser scales the Arcade circle from source pixels. Added runtime regression assertion.
- [x] Fix D2 resize with blocking UI: level-up/result overlays now fit the new viewport and scrims remain full-screen; level-up runtime smoke passed.
- [ ] Keep D3 suspended-audio burst as a real-device acceptance check; do not refactor audio without reproduction.
- [ ] Complete real MAX Android/iOS 16/16 evidence gate; browser smoke does not close P0.

## Telegram release
- [x] Add Telegram WebApp SDK/Web origins to production CSP.
- [x] Add dedicated optional Telegram bot service and fail-closed deploy wiring.
- [x] Fix `/start <payload>` dispatch and add regression contract.
- [x] Dedicated Telegram bot identity supplied (`ofeliya_game_bot`); production secret staging pending final deploy gate.
- [ ] Configure BotFather Main Mini App URL to `https://ofeliya.freeveol.dpdns.org/ofeliya/`.
- [ ] Deploy Telegram-enabled main SHA and run real Telegram Android/iOS/Web acceptance.

## Telegram edge rollout
- [x] Diagnose #158 parity rollback: stale host-local Caddyfile.dedicated.
- [x] Add deterministic dedicated-Caddy renderer and CI contract.
- [x] Add validate/reload/restore edge synchronization to deployment.
- [x] Merge hotfix #159 and restore versioned Caddy rollout.\n- [x] Diagnose Cloud.ru Telegram API egress; add explicit reachable endpoint fallback.\n- [ ] Stage production Telegram secret/config after egress PR is green, then deploy and run real Telegram acceptance.

## Telegram webhook release
- [x] Add authenticated /api/telegram/webhook route and inline Bot API response.
- [x] Add webhook/polling deploy mode and fail-closed webhook secret validation.
- [x] Add fast client-side t.me/share/url fallback when outbound prepared-share is disabled.
- [ ] Merge/deploy webhook branch.
- [ ] Register webhook/menu button/commands through a network path that can reach Telegram Bot API.
- [ ] Verify real Telegram /start -> Web App -> initData -> run -> score and challenge share.


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

## Compact Legendary card clipping
- [x] Fix the three Legendary effect panels proven clipped at 320x568 with a bounded conditional third line.
- [x] Update the focused layout probe to identify the expanded panel and keep its text-containment assertion.
- [ ] Root rerun full branch CI/browser review from commit `997b6eee2403505e1a416fd5d2755496c30728e`; no release action is included.


- [ ] Root rerun final focused Legendary probe with mandatory desc/footer fixture checks on `997b6eee2403505e1a416fd5d2755496c30728e` before push.

## Compact Legendary spacing CI
- [x] Add 12px to compact Legendary reward card height only; keep three-card 320x568 stack within y=122..548.
- [x] Include effect/description/footer bounds in focused probe JSON and fail on missing fixtures/intersections.
- [ ] Linux focused regression after run37293956036 reported effect/description overlap; verify the 136px card correction on final candidate `29457d658e309ee87fadffd30c565528a11d6405`.

- [ ] Re-run focused Linux Legendary CI after commit `c01019f0708d9740cfc7a3f84da29bba149eed55`; latest Linux pass predates its viewport-fit guard.
- [ ] Track compact landscape Legendary panel density/layout separately; viewport-fit guard preserves the original 124px card treatment when expansion cannot fit and does not claim a full landscape redesign.

## Release closure (05.10)
- [x] Add `VITE_RELEASE_SHA: ${{ github.sha }}` to the Release Visual Matrix build step (`a32b3f2`) so `stamp-release.mjs` stops aborting that workflow.
- [x] Label the documented `npm run` lists as a quick check subset and name `.github/workflows/ci.yml` as the authoritative gate in `README.md` and `RELEASE_VALIDATION.md`.
- [x] Document `npm run test:mobile-evidence -- PATH`, its 16 required check ids, required fields, the manual requirements it does not cover, and external evidence storage.
- [x] Gitignore only `artifacts/mobile-acceptance.json`.
- [x] Correct the two inaccurate validator claims in README/RELEASE_VALIDATION: 16 is the mandatory minimum, extra `checks[]` rows are permitted and uninspected, and `testedAt` is validated by `Date.parse` rather than strict ISO (`d976778`). Documentation only; validator semantics unchanged.
- [ ] Coordinator/Cline/Hoplite independent review of `a32b3f2`; at most two fix iterations. No Codex reviewer.
- [ ] Verify the Release Visual Matrix workflow actually goes green on GitHub after the env fix — it was never confirmed green locally, since that job needs Ubuntu + Playwright.
- [ ] Remaining report findings stay backlog, out of this bounded scope: no redesign of docs structure, no validator semantics change, no fabricated evidence.
- [ ] Unchanged external gates: real MAX Android/iOS 16/16, Telegram launch/referral/Daily, public `release.json` exact SHA.

## Multi-card Legendary layout regression coverage (05.10)
- [x] Preserve existing single-card Legendary cases and add all distinct two-definition pairs across the three existing viewports.
- [x] Add a clearly labelled synthetic three-Legendary stress case and a 320x520 short-portrait non-expansion guard.
- [x] Assert per-card fixtures and bounds, card separation, measured subtitle gap, fit-guard decision, and visible-text viewport containment.
- [x] Initial root browser run: 87/88 passed; singles and all two-card pairs passed. One synthetic-three 320x480 failure was caused by subtitle overlap in the stress fixture.
- [x] Root rerun with guard fixture at 320x520: 88/88 passed (24 singles, 60 pairs, 3 synthetic-three, 1 guard); short guard stayed at 124px with 9px subtitle gap and no overflow.
- Linux rerun after URL correction: 87/88; the first revised short guard still failed because definition index 3 wraps to three lines. Linux measured all six as `[2,3,2,3,3,2]`; latest fixture correction uses indices 0, 2, and 5. See `work/multicard-linux-plain2.log`; rerun pending.
- [x] Linux probe ran after URL correction: 87/88; all 15 real Legendary pairs across all viewports passed. The only failure was the short synthetic-three guard selecting a 3-line effect against the intended 2-line compact cap on 124px cards (`work/multicard-linux-plain2.log`). This is an unreachable stress content limit, not a trophy defect (trophy offers two). Long-content three-card stress stays on taller heights.
- [ ] Rerun with the short guard using three two-line effects (definitions 0, 2, 5); keep all 15 actual pairs at 320x520 and leave assertions/production UI unchanged. Independent review approved this bounded fixture adjustment. No real-device acceptance claim.
- [x] Linux measurement found short-guard definition index 3 also wraps to 3 lines; measured six single wrap counts are `[2,3,2,3,3,2]` (`work/multicard-linux-plain2.log`).
- [ ] Rerun short guard with measured two-line definitions 0, 2, and 5 (index 5 is last-life-saving Legendary); all other cases remain unchanged. Latest Linux is 87/88; do not claim pass until rerun.

## VO-01 follow-up — 07.10.2026
- [x] Runtime RED before implementation; bounded DEV/QA snapshot and dimensions/input browser assertions.
- [x] Local DEV + QA production renderer 6/6, ordinary production opacity, focused existing checks and builds. Evidence and failures: docs/visual-overhaul/VO01_VALIDATION.md.
- [ ] Coordinator independent review of 582723032b060f690eb59dac933c60834d0969a2. Kimi blocked by invalid API key; failed artifact must not be committed or treated as evidence.
- [ ] Run full Linux CI against the final candidate when authorized; current local builds stamped base d7797bc, not final HEAD.
- [ ] Real MAX Android/iOS/Telegram touch, safe areas, resume and GPU/sharpness acceptance remain external gates.
- [ ] Separate architecture/design for any future overall HiDPI; VO-01 deliberately does not change rendering resolution.

## VO01 fix1 backlog — 07.10.2026
- [x] Real Kimi frozen-diff review imported; invalid-key blocker resolved externally, superseding earlier pending note.
- [x] F1-F5 and requested F6/F8/F10 addressed in c231d60ebcf5748b9a2a2d2c5bbf99ca39adaa5a; focused missing-scenes/QA matrix/production opacity/typecheck passed.
- [ ] Coordinator rereview/accept fix1 and import branch into original pipeline; broader plan remains coordinator-owned.
- [ ] Full Linux CI, slow bridge resize latency, real nonzero safe areas/hidden resume/devices/GPU remain unverified; do not promote local focused evidence to acceptance.


## VO02 combat follow-up — 07.10.2026
- [x] Baked Canvas/WebGL particle frame palette, single death budget grant, directed membrane hits and retained decoration pool implemented in `ddbe943`.
- [x] Focused RED then GREEN8/8; impact budget/runtime quality/telegraphs/typecheck/whitespace checks passed locally.
- [ ] Coordinator real Phaser impact/Canvas/WebGL visual matrix against VO02 candidate; inspect actual frame colors and contact readability under100/150/200 enemies.
- [ ] Coordinator independent Kimi frozen task-range review (`a4d20d1..VO02_HEAD`), scoped fix/re-review before Task3.
- [ ] Coordinator integrate `node tests/vfx-presentation.mjs` into final acceptance commands as appropriate; no new npm script/CI wiring was included in this scoped task.
- [ ] Full branch CI/build and real MAX Android/iOS/Telegram gates remain pending; focused Node adapter checks are not pixel/performance acceptance.


## VO02 Kimi fix1 backlog — 07.10.2026
- [x] Coordinator reported scoped Kimi code PASS/no Critical; all four Important nonblocking test gaps addressed in 04f56f7.
- [x] Focused 12/12 and four meaningful mutation checks; required typecheck/impact/runtime/telegraph checks passed.
- [ ] Coordinator import test+memory commits and rereview/accept the four coverage fixes. Existing production behavior is unchanged; earlier full task browser evidence need not be represented as a worker run.
- [ ] Root real Phaser matrix/impact acceptance and full final branch gates remain coordinator-owned; real MAX Android/iOS/Telegram external gates remain open.


## VO03 organ atmosphere follow-up — 07.10.2026
- [x] Coherent three-band RBC depth, bounded retained pulse and separated Heart visual peaks implemented in `8af0b92`; original static image counts/geometry retained.
- [x] Focused9/9, meaningful four mutation checks, stage/runtime-quality/impact-budget, VFX12/12, typecheck and whitespace checks passed.
- [ ] Coordinator independent Task3 frozen-diff review; remote Kimi currently unavailable, fallback reviewer remains root-owned. Scoped fixes/review before Task4 acceptance.
- [ ] Coordinator real Phaser WebGL/Canvas dense full/reduced screenshots, Heart valley/second peak, compact resize/stage reset/shutdown QA. Worker adapter tests are not raster/GPU evidence.
- [ ] Coordinator integrates focused atmosphere command into final branch acceptance; no scoped npm/CI wiring added.
- [ ] Task5 actor/host high-resolution backing compensation; host shadow source unchanged in Task3. Full final branch build/CI and real MAX Android/iOS/Telegram gates remain open.


## VO04 audible mix follow-up — 07.10.2026
- [x] Audible master/music/bed/SFX mix, normalization caching, compressor, authoritative visibility and immutable safe diagnostics in `5c53377`.
- [x] Focused17/17 production TS math/graph lifecycle contracts; required audio/save/RNG+checkpoint/typecheck/whitespace checks passed.
- [ ] Root integrate code/memory commits and run independent frozen Task4 diff review; worker remains available for scoped fixes.
- [ ] Root actual seven-CC0-bed OfflineAudioContext busy sample rendering using production math; establish finite/clipping bounds and audibility evidence separately from boundary tests.
- [ ] Root integration/Phaser QA and final task gates; scoped test command is `node tests/audio-mix.mjs` with no package/CI wiring changes.
- [ ] Task5 high-resolution actor/host backing compensation; final build/CI and real MAX Android/iOS/Telegram external acceptance remain open. No deploy/merge performed.


## VO05 core art recovery follow-up — 07.10.2026
- [x] Recovered saved `fdacc92` core art integration and inherited `346638d` seven generated assets/provenance without regenerating them.
- [x] Verification coverage `3de91b7`: core-art15/15; typecheck, viewport/tokens/impact-budget/runtime-quality/telegraphs/startup-renderer, VFX12/12, atmosphere9/9, save/RNG/checkpoint/stages and whitespace.
- [x] Preserve original untracked timeout-mutant, confirm one targeted finite-XHR assertion fails under1800->0 mutation.
- [ ] Coordinator frozen Task5 scoped review and cherry-pick coverage/memory; implementation `fdacc92` remains unchanged.
- [ ] Coordinator actual browser missing/stalled-image fallback/startup, Phaser body/display/centers across WebGL/Canvas, controls/elite/visual matrix and screenshots; worker adapters do not close these gates.
- [ ] Task6 menu/HUD finish, final branch build/CI, real MAX Android/iOS16/16 and Telegram external acceptance. No merge/deploy performed.


## VO05 stalled-art follow-up — 07.10.2026
- Root actual-browser regression exposed >6000ms stalled startup. Phaser3.90 Loader defaults maxRetries2; File.onError reloads twice, creating3x1800ms windows. Desktop parallel32; Android parallel6 can additionally batch seven assets.
- `9dc9650` sets optional-art retries0 while queueing (restores prior value in finally for unrelated future files) and Boot concurrency max(existing,7). Per-file1800ms timeout unchanged. Core art contract now16/16 includes retry capture/restore and Android6/desktop32 batching policy.
- With root-authorized browser follow-up, actual Chromium Canvas startup available1335ms/missing1102ms/stalled2501ms/Android-UA stalled2673ms, all unchanged6000ms gate. Stalled modes each requested exactly7distinct assets, no retries; Android config default6 and Boot loader7 explicitly confirmed. Private extended copy of root startup test remains untracked for coordinator import.
- Elite fixture now compares actual halfWidth/halfHeight to floor(sourceWorldRadiusX/Y), matching Phaser Body.setCircle/updateBounds; logical tolerance1.01, markers/signatures/centers unchanged. Actual elite script passed against own Vite server with only URL substituted in temporary copy. No physics production changes.
- Typecheck, core16/16, nonbrowser startup-renderer, viewport/tokens/impact-budget and whitespace passed after fix. No push/merge/deploy. Root still owns full geometry/controls/matrix/scoped review and external device gates.

## VO06 Menu/HUD follow-up — 07.10.2026
- [x] Decorative Menu framing/halo and illuminated selector edges; HUD retained bar highlights/hairline implemented8d8d9cd.
- [x] Worker typecheck/tokens/ui-copy/layout-diagnostics/language1584/viewport/Legendary-impact-VFX smoke/whitespace passed.
- [ ] Coordinator integrate code/memory commits, frozen independent Task6 scoped review and any review fixes.
- [ ] Coordinator actual portrait/compact menu/HUD/Legendary/modal-control browser acceptance, screenshots, retained-object/tween teardown. Worker did not run browser.
- [ ] Task7 integrated acceptance/build/review/PR; real MAX Android/iOS16/16 and Telegram external gates remain open. No merge/deploy performed.

## 2026-10-07: Post-overhaul release work

Check hosted PRCI; collect realMAX Android/iOS16-point and Telegram audio-unlock/performance evidence. Track existing fallback-font compactHUD overlap (LinuxDejaVu reproduces baseline; nativeHONOR gatepassed). FullHiDPI renderer experiment and optional music-track/trim array maintenance guard remain separate followups. No current production merge/deploy authorization inferred.

## Current CI checkpoint

- [x] Restore interrupted visual work and create draft PR179.
- [x] Investigate initial hosted CI failures and review test-only fixture fixes.
- [x] Native production QA12-cell matrix and six-viewport comprehension acceptance.
- [ ] Confirm full hosted CI on latest combined PR head before concluding PR validation.
- [ ] Real MAX Android/iOS16-point, Telegram audio unlock/device performance and separate generalHiDPI renderer follow-up remain open. No merge/deploy.

## 2026-10-08 visual residuals
- [x] Hero/antibody local6frame idle deformation with exact76row geometry proof.
- [x] Measured compact combo and boss title/bar overlap fixed;6viewportHUD passed.
- [x] WindowsCyrillic presentation source harness repaired, original54assertions intact.
- [ ] QA-only capped2x framebuffer followup: integrate/retest independently before density activation.
- [ ] Original composed compatible stems and authored charge/hit/death cycles: brief ready, assets not claimed.
- [ ] MAXAndroid/iOS + Telegram real-device audio/input/denseframe-times/thermals acceptance BLOCKED—HUMAN ACCEPTANCE REQUIRED.

## HiDPI QA follow-up (08.10)
- [x] Final integrated logical/backing/input/resize/teardown and multitouch controls.
- [ ] Final hosted dedicated density + existing CI green; exact SHA readback.
- [ ] Actual MAX Android/iOS and Telegram10–15min acceptance including sustained density1x/2x frame-time/thermal/audio/touch evidence.
- [ ] Context/offscreen/mask/postFX tests before HiDPI rollout.
- [ ] Authored compatible music stems and full charge/hit/death/RNA/icon scope; do not mark original visual goal DONE.

## Authorized release recovery (08.10)
- [x] Merge179/180/181 and run freshmainCI/matrix.
- [x] Fixture isolation + exactlocaltests + independentsourcereview.
- [ ] Fresh fixturePR CI, merge, finalmainCI, immutable deploy/publicSHAhashparity.
- [ ] Actual MAX/Telegram device acceptance; fullcreative remaining scope unchanged.

## Cardiac clock isolation follow-up
PR182 initial head e1c058e CI37768249337 passed ceremony but failed Cardiac8s. Diagnostic-only14b6d3c CI37769887253 remains running. A local synthetic sparse RAF35ms plus explicit cooldown240 reproduced the timeout: Game active/notpaused/UI clear, boss phase2, stage2649 versus scene16936, nextTelegraph13575 already due, heartbeat3216 safeIndicator true; zero page errors. This demonstrates the mixed-clock scheduling mechanism, not the exact hosted runner conditions (default cooldown120).

Fixture now uses the real heartbeat.restore with nextImpact=stageTime+60000 and bossWasActive=true, with exact60000 setup assertion. Game.update, real Cardiac scheduler and canSchedule, original4700/850/280 source timing,8s/2s/1.5s browser deadlines, exact14damage and heartbeatClear remain. It intentionally does not validate live heartbeat concurrency; unchanged test:pacing separately tests1980/1981 boundary and exclusion. Native exactscript plus paired synthetic stressed fixture PASS; pacing PASS. Independent Codex source review PASS. Additional Kimi OmniRoute review returned empty content and is NOT approval. Await fresh PR/main CI before deploy.

## Hosted progression cause captured and pool reset
Diagnostic-only14b6d3c CI37769887253 failed with Game inactive/paused, UI modalOpen/uiBlocked, awaitingChoice true, stage149ms, bossactivephase2, hazard disabled/serial0 and no errors. This directly proves a new progression choice paused the updater; it does not identify the individual RNA drop. The only ordinary queued-level source is onGemCollected; stage transition was not occurring.

The fixture now uses production-standard deactivateForStageReset for existing bullets/RNA gems, resets host cells and excludes their update/rewards from this beam contract. It asserts zero active bullets/gems. Paired local inherited-RNA100 fixture: baselinef292dc7 paused atstage33ms/queued3/awaitingChoice and failed8s; corrected fixture PASS. Exact corrected script alsoPASS. Thus no onGemCollected/Game.update/hazard method is stubbed, no assertion or timeout is loosened. Host-cell/RNA integration is outside this scoped beam test; other unchanged gameplay/browser suites cover it. Mixed-clock synthetic finding remains separately documented and was not the captured hosted cause.

## Dense readability fixture lifecycle recovery
Final6c84b89 CI37771605821 passed Legendary, Cardiac and controls, then dense-readability failed target150/cache150 with allalpha1. Enemy preUpdate reads prior density; Game.update refreshes cache afterward. Original fixed150ms sleep need not contain both real frames.

Density fixture now waits two actual Scene POST_UPDATE frames with cache>=target, bounded1500ms, before unchanged150/200targets/alpha assertions. This replaces a synchronization assumption, NOT an unchanged performance/timing gate. No manual Game/Enemy update or cache writes. Startup accepts an already-paused real Game, resumes then clears progression/UI; new unblocked assertion added. Exact native finalscript PASS; original native Game.active-only wait had stopped at startup30s. Paired sparseRAF240ms with shared corrected startup: old150ms sleep failed cache100/target150/allalpha1; completed-frame wait PASS. This demonstrates synchronization sensitivity, not the exact hosted scheduling. Independent Codex source review PASS. Additional Kimi nonstream diagnostic HTTP504; no routed approval.
# 2026-10-11 Migration checklist

- [x] Verify free plans and initial state export; durable adapter/unit checks.
- [ ] Deploy Render and verify signed Telegram API plus restart persistence.
- [ ] Drain/export/import final Cloud.ru state; keep canonical HTTPS domain.
- [ ] Switch Telegram webhook/menu; verify release and asset parity.
- [ ] Independently preserve other workloads then delete all paid Cloud.ru resources.
- [ ] Verify remaining tariff/resource inventory and residual charges.


## 2026-10-11 local cutover follow-up
- [x] Audit54public files, release hashes, remote health and browser game startup.
- [x] Mount existing MAX webhook handlers and test /start/auth/gateway/MAX profile locally.
- [ ] Complete authenticated access to the service Render workspace; available UI awaits GitHub2FA.
- [ ] CI/review/merge hosted MAX correction and deploy from main with dedicated credentials.
- [ ] Bind canonical domain, verify TLS/DNS and both messenger bots/identity/state restart.
- [ ] Retire only verified OFELIYA Cloud.ru resources; do not claim billing stopped before inventory readback.

## Исторические добавления Daily #221 (после общего блока)


## Исторические добавления B2/B4 #222 (после общего блока)

# B2/B4 integration follow-up — 20 October 2026

- [x] Apply B2/B4 CI gate patch and add reduced-motion regression.
- [x] Local focused tests, presentation, tokens/copy, telegraphs, impact budget, strict TypeScript and build.
- [ ] Root browser 16-cell reduced/no-preference and boss fixture QA; root-owned biological pixel gate evaluation.
- [ ] Root independent review and scoped fixes if needed.
- [ ] Hosted exact-head CI and owner release/device acceptance remain separate gates; no merge/push/deploy authorized.

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
# Mutation art recovery verification backlog — 16 October 2026
Branch fix/mutation-art-recovery-20261016 starts from the verified live visual candidate44c6579 (PR214). Cold-start optional mutation requests can exceed Boot1800ms; fallback previously remained permanent. The scoped fix records canonical texture provenance and recovers only mutation-prism/halo/singularity after first render. Same256px CanvasTexture objects refresh in place; Player/physics/gameplay/assets remain unchanged. Two8000ms attempts/key,750ms backoff; per-game dedup and destruction cancellation. Five module contracts, full presentation and TypeScript passed. Read docs/release/MUTATION_ART_RECOVERY_20261016.md.

Local delayed-image Canvas/WebGL regression passed with sixteen paired actual Player frames and exact packaged pixels. Independent source review found no concrete P1/P2. Remaining before publication: final still-image review, exact-head hosted CI/matrix, fresh private backup and pinned Render Free publication/readback. Owner authorizes continuation/deployment; main merge remains prohibited. Keep PR213/214/215 and other parallel PRs separate. Physical-device/FPS/newcomer acceptance remains open. Update the release document after real results; do not treat this pending snapshot as proof of publication.

## Previous snapshots
# Phase1 remaining acceptance gates — 16 October 2026
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

# Telegram image maintenance follow-up — 2026-10-13

- PR #199: missing webhook helper fixed; new bot image COPY guard verified
  RED/GREEN, including real Node22 Docker imports with network disabled.
  Check full hosted CI on the final PR head before merging with `[skip render]`.
- PR #189 closed with current/archive handoff links; branch preserved.
- Security patch note corrected: equivalent and stricter fixes are in PR #197.
- Render auto-deploy root cause remains open pending working-account access.
  Existing API credential was not found locally; no live GET or setting change
  has been performed in this follow-up. Owner is arranging login. Inspect
  Git-provider connection, repo `timoshinoleg-eng/ofeliya`, main, checksPass,
  buildFilter and deployment history/triggers; do not assume provider validity
  from the repository URL alone. Official Render docs require a connected Git
  provider for auto-deploy; public-URL services require manual deployment:
  https://render.com/docs/deploys#automatic-deploys.
  After an evidence-based minimal fix, validate on the next runtime release.
- Real Samsung S20+ OS/MAX/TG versions, recordings, MAX Android/iOS/Telegram
  acceptance, newcomer study and measured mobile performance remain external.

# Verified review-fix release — 2026-10-13

Runtime source: c0c72fa81690b562e15c1d87580c66af842b3f3b (PR197 merged). Main CI38375891119: build/browser-smoke/production-contract success. Render Free deployment dep-db6vmg4s728c73cv4010 is live in production workspace tea-d8iruouq1p3s73f30a90 (timoshin.oleg@gmail.com). Canonical https://ofeliya.freeveol.dpdns.org/ofeliya/ reports this SHA. Metadata-only commits after this release do not change the published source identity.

Remaining: real MAX Android/iOS and Telegram acceptance, numerical Android/MAX/TG versions on owner's Samsung S20+, newcomer study and mobile frame-time/thermal measurements. test:mobile-evidence stays fail-closed; no fabricated PASS/FPS. Automatic deployment is configured checksPass but did not create this deployment after successful main CI; one pinned API deployment was used. Recheck Git-provider/automatic-trigger behavior on the next code release. No paid infrastructure, DNS/bot identity/secret rotation or keepalive was introduced.

## Historical snapshots (current verified facts above take precedence)

# Current review fixes — 2026-10-13

Branch fix/kimi-review-20261013, based on main26fcc88. User approved the independent review follow-up plan. See docs/release/KIMI_REVIEW_FIXES_20261013.md for contracts, tests and mixed-version policy. Previous handoff is archived under memory/archive/2026-10-13-before-review-fixes/; older state/decisions/backlog remain as historical notes below.

Snapshot gates: final-head CI, production backup/restore and release parity, S20+ Android/MAX/TG numerical versions + real acceptance/performance, MAXiOS, newcomer study. Broad scene refactoring and performance promises require measured evidence. Equivalent and stricter security fixes were merged in PR #197 (`server/request-policy.mjs`, `server/security-regressions.test.mjs`); do not import the old security patch wholesale. PR184 dependency fixes are included; PR #184 was subsequently closed with its branch preserved.

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

# Cutover backlog - 2026-10-11

Completed: dedicated MAX hosting callback; game-relative API/Telegram path
compatibility; new owner-account Render Free service; main/checksPass config;
canonical DNS/TLS; signed profiles/social reads; Telegram prepared sharing;
remote restart restore; full public-file/hash checks; OFELIYA Cloud.ru VM/disk/IP
removal; obsolete Cloud.ru deploy workflow disabled.

Remaining external acceptance: real /start in Telegram and MAX, Mini App
gameplay and save/reopen on owner devices. Automated/synthetic evidence does
not replace those checks. Render idle cold starts remain expected.
Other Cloud.ru workloads and charges require a separate scope; preserved.
The inaccessible old Render preview may be removed by its workspace owner.
Prior PR189 contains historical status and should not overwrite this handoff.

Supabase state access key was rotated in the existing Free project. The new
Render uses the replacement; the old key returns401 for read and writer claim,
so the inaccessible preview cannot steal production persistence. A 24-hour
management token was scoped only to this project and Edge Functions. No keys
are committed. Main CI38158081443 passed all three jobs for runtime d92325b.

## Historical notes

# BACKLOG — OFELIYA: STRAIN ZERO

Обновлено: 2026-10-05. Отмечайте сделанное галочкой; новые пункты добавляйте сюда, а не в чат.

## Control-mode browser smoke (06.10)
- [ ] Root review/publish `fix/control-smoke-preconditions-20261006` and rerun full main CI; focused browser smoke passed locally.

## Deploy CI payload fix (05.10)
- [x] PR #173 merged the file-backed deploy CI payload fix; target branch inherits it from main `b174b40`.
- [x] PR #174 merged targeted CI lookup and Ubuntu 22.04 pin; target branch inherits it from main `18e6f05`.
- [ ] Root review/PR for `fix/deploy-standalone-policy-20261005`, then wait for full main CI at the new SHA before deployment retry. No deploy performed by this task.

## Сейчас (P0)

- [x] Синхронизировать worktree с origin/main — выполнено 28.09 (main @ 480c67b).
- [x] Подтянуть origin/main в `feat/donor-quick-wins` — merge `45712e9` (без конфликтов, запушено).
- [x] Канонический гейт на синхронизированной ветке — пройден 28.09 (9 тестов + release:check + build).
- [x] Тест-цикл B в OpenCode (два прохода, смена модели) — пройден 29.09.
- [x] Внешнее ревью (внешняя модель — `memory/06_REVIEW.md`) + merge PR #151 — выполнено 29.09 (+2-е мнение `space-bunny-free`; пост-ревью правки PR #154). [ ] ChatGPT-вариант ревью — опционально, позже.
- [ ] Внешний релиз-гейт: реальные MAX Android/iOS — 16 пунктов (`RELEASE_VALIDATION.md` §8). Evidence validator реализован 02.10; реальные 16/16 ещё не сняты.
- [x] Merge PR #151: система памяти (квик-вины уже в main через #137) — выполнен 29.09 после внешнего ревью.
- [x] `.gitignore` для служебных каталогов — добавлено 29.09 (13 записей: 9 каталогов + 4 `*.capability.json`).
- [x] Проверить служебные untracked-каталоги (скан 29.09: 13 записей, ~55 файлов — совпадений 0). Исходная запись: - [ ] Проверить служебные untracked-каталоги (`config/`, `skills/`, `.cluster/`, `handoff-system/`, `ofelia-pilot/`, `*.capability.json`) на ключи/секреты перед этапом 3 (правило AGENTS.md — пока только на дисциплине).
- [ ] Балансировка по полным реальным прогонам (9+ минут).

## Далее (P1)

- [x] Реализовать продуктовую funnel-инструментацию и CLI-отчёт (02.10): app_open → run_start → run_60s → boss1 → heart → replay, onboarding timing/exits, D1, referral open → run_start.
- [x] Перестроить first-run tutorial вокруг RNA/мутации/заражения клетки-хозяина; удалить pause как обязательный шаг (02.10).
- [ ] Провести наблюдаемый плейтест новых первых 60 секунд на людях; собрать completion/time/exit reasons, не подменять smoke-тестом.
- [ ] Пройти реальный MAX Daily invite path на двух устройствах: send → open → run_start → result; сохранить evidence.

- [ ] Heart safe-pocket timing — плейтест читаемости; оба боя боссов — по ощущениям, не только технически.
- [ ] Twin-stick эргономика на реальных устройствах.
- [ ] Dense readability 100/150/200 — держать при любых визуальных изменениях.
- [x] Пилот памяти, Honor: тест-цикл B пройден 29.09; [ ] HP — блок A чек-листа (этап 3).
- [ ] Синхронизация двух ноутов: протокол pull/push в ежедневной работе.
- [ ] Правило: числа и ссылки в файлах памяти — только из git-вывода (по итогам 2-го внешнего ревью, 29.09).

## Отложено (не трогать без отдельной миграции)

- Третий орган / дополнительный акт кампании; сложность выше Strained; крупная экспансия Legendary;
  постоянная stat-прокачка; широкая внешняя арт/аудио-пайплайн; крупный рефакторинг или смена рендера.

## Audit follow-up 03.10
- [x] Revalidate D1 elite hitbox: false positive; Phaser scales the Arcade circle from source pixels. Added runtime regression assertion.
- [x] Fix D2 resize with blocking UI: level-up/result overlays now fit the new viewport and scrims remain full-screen; level-up runtime smoke passed.
- [ ] Keep D3 suspended-audio burst as a real-device acceptance check; do not refactor audio without reproduction.
- [ ] Complete real MAX Android/iOS 16/16 evidence gate; browser smoke does not close P0.

## Telegram release
- [x] Add Telegram WebApp SDK/Web origins to production CSP.
- [x] Add dedicated optional Telegram bot service and fail-closed deploy wiring.
- [x] Fix `/start <payload>` dispatch and add regression contract.
- [x] Dedicated Telegram bot identity supplied (`ofeliya_game_bot`); production secret staging pending final deploy gate.
- [ ] Configure BotFather Main Mini App URL to `https://ofeliya.freeveol.dpdns.org/ofeliya/`.
- [ ] Deploy Telegram-enabled main SHA and run real Telegram Android/iOS/Web acceptance.

## Telegram edge rollout
- [x] Diagnose #158 parity rollback: stale host-local Caddyfile.dedicated.
- [x] Add deterministic dedicated-Caddy renderer and CI contract.
- [x] Add validate/reload/restore edge synchronization to deployment.
- [x] Merge hotfix #159 and restore versioned Caddy rollout.\n- [x] Diagnose Cloud.ru Telegram API egress; add explicit reachable endpoint fallback.\n- [ ] Stage production Telegram secret/config after egress PR is green, then deploy and run real Telegram acceptance.

## Telegram webhook release
- [x] Add authenticated /api/telegram/webhook route and inline Bot API response.
- [x] Add webhook/polling deploy mode and fail-closed webhook secret validation.
- [x] Add fast client-side t.me/share/url fallback when outbound prepared-share is disabled.
- [ ] Merge/deploy webhook branch.
- [ ] Register webhook/menu button/commands through a network path that can reach Telegram Bot API.
- [ ] Verify real Telegram /start -> Web App -> initData -> run -> score and challenge share.


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

## Compact Legendary card clipping
- [x] Fix the three Legendary effect panels proven clipped at 320x568 with a bounded conditional third line.
- [x] Update the focused layout probe to identify the expanded panel and keep its text-containment assertion.
- [ ] Root rerun full branch CI/browser review from commit `997b6eee2403505e1a416fd5d2755496c30728e`; no release action is included.


- [ ] Root rerun final focused Legendary probe with mandatory desc/footer fixture checks on `997b6eee2403505e1a416fd5d2755496c30728e` before push.

## Compact Legendary spacing CI
- [x] Add 12px to compact Legendary reward card height only; keep three-card 320x568 stack within y=122..548.
- [x] Include effect/description/footer bounds in focused probe JSON and fail on missing fixtures/intersections.
- [ ] Linux focused regression after run37293956036 reported effect/description overlap; verify the 136px card correction on final candidate `29457d658e309ee87fadffd30c565528a11d6405`.

- [ ] Re-run focused Linux Legendary CI after commit `c01019f0708d9740cfc7a3f84da29bba149eed55`; latest Linux pass predates its viewport-fit guard.
- [ ] Track compact landscape Legendary panel density/layout separately; viewport-fit guard preserves the original 124px card treatment when expansion cannot fit and does not claim a full landscape redesign.

## Release closure (05.10)
- [x] Add `VITE_RELEASE_SHA: ${{ github.sha }}` to the Release Visual Matrix build step (`a32b3f2`) so `stamp-release.mjs` stops aborting that workflow.
- [x] Label the documented `npm run` lists as a quick check subset and name `.github/workflows/ci.yml` as the authoritative gate in `README.md` and `RELEASE_VALIDATION.md`.
- [x] Document `npm run test:mobile-evidence -- PATH`, its 16 required check ids, required fields, the manual requirements it does not cover, and external evidence storage.
- [x] Gitignore only `artifacts/mobile-acceptance.json`.
- [x] Correct the two inaccurate validator claims in README/RELEASE_VALIDATION: 16 is the mandatory minimum, extra `checks[]` rows are permitted and uninspected, and `testedAt` is validated by `Date.parse` rather than strict ISO (`d976778`). Documentation only; validator semantics unchanged.
- [ ] Coordinator/Cline/Hoplite independent review of `a32b3f2`; at most two fix iterations. No Codex reviewer.
- [ ] Verify the Release Visual Matrix workflow actually goes green on GitHub after the env fix — it was never confirmed green locally, since that job needs Ubuntu + Playwright.
- [ ] Remaining report findings stay backlog, out of this bounded scope: no redesign of docs structure, no validator semantics change, no fabricated evidence.
- [ ] Unchanged external gates: real MAX Android/iOS 16/16, Telegram launch/referral/Daily, public `release.json` exact SHA.

## Multi-card Legendary layout regression coverage (05.10)
- [x] Preserve existing single-card Legendary cases and add all distinct two-definition pairs across the three existing viewports.
- [x] Add a clearly labelled synthetic three-Legendary stress case and a 320x520 short-portrait non-expansion guard.
- [x] Assert per-card fixtures and bounds, card separation, measured subtitle gap, fit-guard decision, and visible-text viewport containment.
- [x] Initial root browser run: 87/88 passed; singles and all two-card pairs passed. One synthetic-three 320x480 failure was caused by subtitle overlap in the stress fixture.
- [x] Root rerun with guard fixture at 320x520: 88/88 passed (24 singles, 60 pairs, 3 synthetic-three, 1 guard); short guard stayed at 124px with 9px subtitle gap and no overflow.
- Linux rerun after URL correction: 87/88; the first revised short guard still failed because definition index 3 wraps to three lines. Linux measured all six as `[2,3,2,3,3,2]`; latest fixture correction uses indices 0, 2, and 5. See `work/multicard-linux-plain2.log`; rerun pending.
- [x] Linux probe ran after URL correction: 87/88; all 15 real Legendary pairs across all viewports passed. The only failure was the short synthetic-three guard selecting a 3-line effect against the intended 2-line compact cap on 124px cards (`work/multicard-linux-plain2.log`). This is an unreachable stress content limit, not a trophy defect (trophy offers two). Long-content three-card stress stays on taller heights.
- [ ] Rerun with the short guard using three two-line effects (definitions 0, 2, 5); keep all 15 actual pairs at 320x520 and leave assertions/production UI unchanged. Independent review approved this bounded fixture adjustment. No real-device acceptance claim.
- [x] Linux measurement found short-guard definition index 3 also wraps to 3 lines; measured six single wrap counts are `[2,3,2,3,3,2]` (`work/multicard-linux-plain2.log`).
- [ ] Rerun short guard with measured two-line definitions 0, 2, and 5 (index 5 is last-life-saving Legendary); all other cases remain unchanged. Latest Linux is 87/88; do not claim pass until rerun.

## VO-01 follow-up — 07.10.2026
- [x] Runtime RED before implementation; bounded DEV/QA snapshot and dimensions/input browser assertions.
- [x] Local DEV + QA production renderer 6/6, ordinary production opacity, focused existing checks and builds. Evidence and failures: docs/visual-overhaul/VO01_VALIDATION.md.
- [ ] Coordinator independent review of 582723032b060f690eb59dac933c60834d0969a2. Kimi blocked by invalid API key; failed artifact must not be committed or treated as evidence.
- [ ] Run full Linux CI against the final candidate when authorized; current local builds stamped base d7797bc, not final HEAD.
- [ ] Real MAX Android/iOS/Telegram touch, safe areas, resume and GPU/sharpness acceptance remain external gates.
- [ ] Separate architecture/design for any future overall HiDPI; VO-01 deliberately does not change rendering resolution.

## VO01 fix1 backlog — 07.10.2026
- [x] Real Kimi frozen-diff review imported; invalid-key blocker resolved externally, superseding earlier pending note.
- [x] F1-F5 and requested F6/F8/F10 addressed in c231d60ebcf5748b9a2a2d2c5bbf99ca39adaa5a; focused missing-scenes/QA matrix/production opacity/typecheck passed.
- [ ] Coordinator rereview/accept fix1 and import branch into original pipeline; broader plan remains coordinator-owned.
- [ ] Full Linux CI, slow bridge resize latency, real nonzero safe areas/hidden resume/devices/GPU remain unverified; do not promote local focused evidence to acceptance.


## VO02 combat follow-up — 07.10.2026
- [x] Baked Canvas/WebGL particle frame palette, single death budget grant, directed membrane hits and retained decoration pool implemented in `ddbe943`.
- [x] Focused RED then GREEN8/8; impact budget/runtime quality/telegraphs/typecheck/whitespace checks passed locally.
- [ ] Coordinator real Phaser impact/Canvas/WebGL visual matrix against VO02 candidate; inspect actual frame colors and contact readability under100/150/200 enemies.
- [ ] Coordinator independent Kimi frozen task-range review (`a4d20d1..VO02_HEAD`), scoped fix/re-review before Task3.
- [ ] Coordinator integrate `node tests/vfx-presentation.mjs` into final acceptance commands as appropriate; no new npm script/CI wiring was included in this scoped task.
- [ ] Full branch CI/build and real MAX Android/iOS/Telegram gates remain pending; focused Node adapter checks are not pixel/performance acceptance.


## VO02 Kimi fix1 backlog — 07.10.2026
- [x] Coordinator reported scoped Kimi code PASS/no Critical; all four Important nonblocking test gaps addressed in 04f56f7.
- [x] Focused 12/12 and four meaningful mutation checks; required typecheck/impact/runtime/telegraph checks passed.
- [ ] Coordinator import test+memory commits and rereview/accept the four coverage fixes. Existing production behavior is unchanged; earlier full task browser evidence need not be represented as a worker run.
- [ ] Root real Phaser matrix/impact acceptance and full final branch gates remain coordinator-owned; real MAX Android/iOS/Telegram external gates remain open.


## VO03 organ atmosphere follow-up — 07.10.2026
- [x] Coherent three-band RBC depth, bounded retained pulse and separated Heart visual peaks implemented in `8af0b92`; original static image counts/geometry retained.
- [x] Focused9/9, meaningful four mutation checks, stage/runtime-quality/impact-budget, VFX12/12, typecheck and whitespace checks passed.
- [ ] Coordinator independent Task3 frozen-diff review; remote Kimi currently unavailable, fallback reviewer remains root-owned. Scoped fixes/review before Task4 acceptance.
- [ ] Coordinator real Phaser WebGL/Canvas dense full/reduced screenshots, Heart valley/second peak, compact resize/stage reset/shutdown QA. Worker adapter tests are not raster/GPU evidence.
- [ ] Coordinator integrates focused atmosphere command into final branch acceptance; no scoped npm/CI wiring added.
- [ ] Task5 actor/host high-resolution backing compensation; host shadow source unchanged in Task3. Full final branch build/CI and real MAX Android/iOS/Telegram gates remain open.


## VO04 audible mix follow-up — 07.10.2026
- [x] Audible master/music/bed/SFX mix, normalization caching, compressor, authoritative visibility and immutable safe diagnostics in `5c53377`.
- [x] Focused17/17 production TS math/graph lifecycle contracts; required audio/save/RNG+checkpoint/typecheck/whitespace checks passed.
- [ ] Root integrate code/memory commits and run independent frozen Task4 diff review; worker remains available for scoped fixes.
- [ ] Root actual seven-CC0-bed OfflineAudioContext busy sample rendering using production math; establish finite/clipping bounds and audibility evidence separately from boundary tests.
- [ ] Root integration/Phaser QA and final task gates; scoped test command is `node tests/audio-mix.mjs` with no package/CI wiring changes.
- [ ] Task5 high-resolution actor/host backing compensation; final build/CI and real MAX Android/iOS/Telegram external acceptance remain open. No deploy/merge performed.


## VO05 core art recovery follow-up — 07.10.2026
- [x] Recovered saved `fdacc92` core art integration and inherited `346638d` seven generated assets/provenance without regenerating them.
- [x] Verification coverage `3de91b7`: core-art15/15; typecheck, viewport/tokens/impact-budget/runtime-quality/telegraphs/startup-renderer, VFX12/12, atmosphere9/9, save/RNG/checkpoint/stages and whitespace.
- [x] Preserve original untracked timeout-mutant, confirm one targeted finite-XHR assertion fails under1800->0 mutation.
- [ ] Coordinator frozen Task5 scoped review and cherry-pick coverage/memory; implementation `fdacc92` remains unchanged.
- [ ] Coordinator actual browser missing/stalled-image fallback/startup, Phaser body/display/centers across WebGL/Canvas, controls/elite/visual matrix and screenshots; worker adapters do not close these gates.
- [ ] Task6 menu/HUD finish, final branch build/CI, real MAX Android/iOS16/16 and Telegram external acceptance. No merge/deploy performed.


## VO05 stalled-art follow-up — 07.10.2026
- Root actual-browser regression exposed >6000ms stalled startup. Phaser3.90 Loader defaults maxRetries2; File.onError reloads twice, creating3x1800ms windows. Desktop parallel32; Android parallel6 can additionally batch seven assets.
- `9dc9650` sets optional-art retries0 while queueing (restores prior value in finally for unrelated future files) and Boot concurrency max(existing,7). Per-file1800ms timeout unchanged. Core art contract now16/16 includes retry capture/restore and Android6/desktop32 batching policy.
- With root-authorized browser follow-up, actual Chromium Canvas startup available1335ms/missing1102ms/stalled2501ms/Android-UA stalled2673ms, all unchanged6000ms gate. Stalled modes each requested exactly7distinct assets, no retries; Android config default6 and Boot loader7 explicitly confirmed. Private extended copy of root startup test remains untracked for coordinator import.
- Elite fixture now compares actual halfWidth/halfHeight to floor(sourceWorldRadiusX/Y), matching Phaser Body.setCircle/updateBounds; logical tolerance1.01, markers/signatures/centers unchanged. Actual elite script passed against own Vite server with only URL substituted in temporary copy. No physics production changes.
- Typecheck, core16/16, nonbrowser startup-renderer, viewport/tokens/impact-budget and whitespace passed after fix. No push/merge/deploy. Root still owns full geometry/controls/matrix/scoped review and external device gates.

## VO06 Menu/HUD follow-up — 07.10.2026
- [x] Decorative Menu framing/halo and illuminated selector edges; HUD retained bar highlights/hairline implemented8d8d9cd.
- [x] Worker typecheck/tokens/ui-copy/layout-diagnostics/language1584/viewport/Legendary-impact-VFX smoke/whitespace passed.
- [ ] Coordinator integrate code/memory commits, frozen independent Task6 scoped review and any review fixes.
- [ ] Coordinator actual portrait/compact menu/HUD/Legendary/modal-control browser acceptance, screenshots, retained-object/tween teardown. Worker did not run browser.
- [ ] Task7 integrated acceptance/build/review/PR; real MAX Android/iOS16/16 and Telegram external gates remain open. No merge/deploy performed.

## 2026-10-07: Post-overhaul release work

Check hosted PRCI; collect realMAX Android/iOS16-point and Telegram audio-unlock/performance evidence. Track existing fallback-font compactHUD overlap (LinuxDejaVu reproduces baseline; nativeHONOR gatepassed). FullHiDPI renderer experiment and optional music-track/trim array maintenance guard remain separate followups. No current production merge/deploy authorization inferred.

## Current CI checkpoint

- [x] Restore interrupted visual work and create draft PR179.
- [x] Investigate initial hosted CI failures and review test-only fixture fixes.
- [x] Native production QA12-cell matrix and six-viewport comprehension acceptance.
- [ ] Confirm full hosted CI on latest combined PR head before concluding PR validation.
- [ ] Real MAX Android/iOS16-point, Telegram audio unlock/device performance and separate generalHiDPI renderer follow-up remain open. No merge/deploy.

## 2026-10-08 visual residuals
- [x] Hero/antibody local6frame idle deformation with exact76row geometry proof.
- [x] Measured compact combo and boss title/bar overlap fixed;6viewportHUD passed.
- [x] WindowsCyrillic presentation source harness repaired, original54assertions intact.
- [ ] QA-only capped2x framebuffer followup: integrate/retest independently before density activation.
- [ ] Original composed compatible stems and authored charge/hit/death cycles: brief ready, assets not claimed.
- [ ] MAXAndroid/iOS + Telegram real-device audio/input/denseframe-times/thermals acceptance BLOCKED—HUMAN ACCEPTANCE REQUIRED.

## HiDPI QA follow-up (08.10)
- [x] Final integrated logical/backing/input/resize/teardown and multitouch controls.
- [ ] Final hosted dedicated density + existing CI green; exact SHA readback.
- [ ] Actual MAX Android/iOS and Telegram10–15min acceptance including sustained density1x/2x frame-time/thermal/audio/touch evidence.
- [ ] Context/offscreen/mask/postFX tests before HiDPI rollout.
- [ ] Authored compatible music stems and full charge/hit/death/RNA/icon scope; do not mark original visual goal DONE.

## Authorized release recovery (08.10)
- [x] Merge179/180/181 and run freshmainCI/matrix.
- [x] Fixture isolation + exactlocaltests + independentsourcereview.
- [ ] Fresh fixturePR CI, merge, finalmainCI, immutable deploy/publicSHAhashparity.
- [ ] Actual MAX/Telegram device acceptance; fullcreative remaining scope unchanged.

## Cardiac clock isolation follow-up
PR182 initial head e1c058e CI37768249337 passed ceremony but failed Cardiac8s. Diagnostic-only14b6d3c CI37769887253 remains running. A local synthetic sparse RAF35ms plus explicit cooldown240 reproduced the timeout: Game active/notpaused/UI clear, boss phase2, stage2649 versus scene16936, nextTelegraph13575 already due, heartbeat3216 safeIndicator true; zero page errors. This demonstrates the mixed-clock scheduling mechanism, not the exact hosted runner conditions (default cooldown120).

Fixture now uses the real heartbeat.restore with nextImpact=stageTime+60000 and bossWasActive=true, with exact60000 setup assertion. Game.update, real Cardiac scheduler and canSchedule, original4700/850/280 source timing,8s/2s/1.5s browser deadlines, exact14damage and heartbeatClear remain. It intentionally does not validate live heartbeat concurrency; unchanged test:pacing separately tests1980/1981 boundary and exclusion. Native exactscript plus paired synthetic stressed fixture PASS; pacing PASS. Independent Codex source review PASS. Additional Kimi OmniRoute review returned empty content and is NOT approval. Await fresh PR/main CI before deploy.

## Hosted progression cause captured and pool reset
Diagnostic-only14b6d3c CI37769887253 failed with Game inactive/paused, UI modalOpen/uiBlocked, awaitingChoice true, stage149ms, bossactivephase2, hazard disabled/serial0 and no errors. This directly proves a new progression choice paused the updater; it does not identify the individual RNA drop. The only ordinary queued-level source is onGemCollected; stage transition was not occurring.

The fixture now uses production-standard deactivateForStageReset for existing bullets/RNA gems, resets host cells and excludes their update/rewards from this beam contract. It asserts zero active bullets/gems. Paired local inherited-RNA100 fixture: baselinef292dc7 paused atstage33ms/queued3/awaitingChoice and failed8s; corrected fixture PASS. Exact corrected script alsoPASS. Thus no onGemCollected/Game.update/hazard method is stubbed, no assertion or timeout is loosened. Host-cell/RNA integration is outside this scoped beam test; other unchanged gameplay/browser suites cover it. Mixed-clock synthetic finding remains separately documented and was not the captured hosted cause.

## Dense readability fixture lifecycle recovery
Final6c84b89 CI37771605821 passed Legendary, Cardiac and controls, then dense-readability failed target150/cache150 with allalpha1. Enemy preUpdate reads prior density; Game.update refreshes cache afterward. Original fixed150ms sleep need not contain both real frames.

Density fixture now waits two actual Scene POST_UPDATE frames with cache>=target, bounded1500ms, before unchanged150/200targets/alpha assertions. This replaces a synchronization assumption, NOT an unchanged performance/timing gate. No manual Game/Enemy update or cache writes. Startup accepts an already-paused real Game, resumes then clears progression/UI; new unblocked assertion added. Exact native finalscript PASS; original native Game.active-only wait had stopped at startup30s. Paired sparseRAF240ms with shared corrected startup: old150ms sleep failed cache100/target150/allalpha1; completed-frame wait PASS. This demonstrates synchronization sensitivity, not the exact hosted scheduling. Independent Codex source review PASS. Additional Kimi nonstream diagnostic HTTP504; no routed approval.
# 2026-10-11 Migration checklist

- [x] Verify free plans and initial state export; durable adapter/unit checks.
- [ ] Deploy Render and verify signed Telegram API plus restart persistence.
- [ ] Drain/export/import final Cloud.ru state; keep canonical HTTPS domain.
- [ ] Switch Telegram webhook/menu; verify release and asset parity.
- [ ] Independently preserve other workloads then delete all paid Cloud.ru resources.
- [ ] Verify remaining tariff/resource inventory and residual charges.


## 2026-10-11 local cutover follow-up
- [x] Audit54public files, release hashes, remote health and browser game startup.
- [x] Mount existing MAX webhook handlers and test /start/auth/gateway/MAX profile locally.
- [ ] Complete authenticated access to the service Render workspace; available UI awaits GitHub2FA.
- [ ] CI/review/merge hosted MAX correction and deploy from main with dedicated credentials.
- [ ] Bind canonical domain, verify TLS/DNS and both messenger bots/identity/state restart.
- [ ] Retire only verified OFELIYA Cloud.ru resources; do not claim billing stopped before inventory readback.


### B2/B4 parent history (verbatim)
# Visual upgrade backlog status — 19 October 2026 (updated ×3)

Phase B progress: **B1–B4 DONE** on feat/visual-combat-20261018 (head c672a00): B1 combat feedback, B2 silhouette, B3 rarity hierarchy, B4 boss identity — evidence in AUDIT_2026-10-18/ (REPORT_VISUAL_UPGRADE.md §0.4–§0). Owner acceptance pending (build:max in owner env, device gates, human checks). Remaining, in mandated order:

- **B5 — завершение миграции токенов:** один словарь палитр (hudTokens/visualTokens как источник), устранение inline-наследия. Бой сейчас целиком на COLORS (GameScene 44×, Enemy 31×); B3 закрыл часть UIScene. Рекомендуется следующим — это самый объёмный пункт, стоит резать на подэтапы.
- **B6 — мобильная оптичность:** размеры шрифтов, safe area, hit-area ≥44 px; HiDPI только по замерам.

Метод для каждого пункта: пара «до/после» (одинаковый сид/вьюпорт/состояние; движущееся — видео), перф-замер при правке в игровом цикле, метод доноров с provenance, регрессии после каждого пункта.

## Previous snapshots
# Visual implementation completion — 16 October 2026

Branch visual/completion-20261016 extends verified public7a0d829 (PR216). Implemented distinct Player mutation geometry/combined composition, unified SocialHub and Codex, measured11px scrolling result report with pinned actions, pointer ownership and long-share fit, quieter pause. Existing gameplay/RNG/physics/score/network/assets/service settings are retained. Main integration is not authorized.

Read docs/release/VISUAL_COMPLETION_20261016.md. Root executed rich result/resumed/share/social/error/allCodex browser320/360/390; presentation and TypeScript passed. Independent source and native visual reviews resolved concrete issues and found no remaining P1/P2. Short live100-spawn AI/physics desktop before/after has p95~16.8ms in Canvas/WebGL, explicitly not device FPS. Final exact-head hosted CI/matrix, fresh backup and pinned deployment/readback are still pending; do not claim publication from this snapshot.

The implementation gaps from the earlier Phase1 ledger are addressed in this branch; old pending statements below are historical snapshots. Device MAX/TG/iOS, sustained performance/thermals, newcomer/full-campaign acceptance remain open. Preserve other PRs and private state backups. Companion documentation branch carries final evidence without changing the tested product SHA after publication.

## Previous snapshots
# Mutation art recovery verification backlog — 16 October 2026
Branch fix/mutation-art-recovery-20261016 starts from the verified live visual candidate44c6579 (PR214). Cold-start optional mutation requests can exceed Boot1800ms; fallback previously remained permanent. The scoped fix records canonical texture provenance and recovers only mutation-prism/halo/singularity after first render. Same256px CanvasTexture objects refresh in place; Player/physics/gameplay/assets remain unchanged. Two8000ms attempts/key,750ms backoff; per-game dedup and destruction cancellation. Five module contracts, full presentation and TypeScript passed. Read docs/release/MUTATION_ART_RECOVERY_20261016.md.

Local delayed-image Canvas/WebGL regression passed with sixteen paired actual Player frames and exact packaged pixels. Independent source review found no concrete P1/P2. Remaining before publication: final still-image review, exact-head hosted CI/matrix, fresh private backup and pinned Render Free publication/readback. Owner authorizes continuation/deployment; main merge remains prohibited. Keep PR213/214/215 and other parallel PRs separate. Physical-device/FPS/newcomer acceptance remains open. Update the release document after real results; do not treat this pending snapshot as proof of publication.

## Previous snapshots
# Phase1 remaining acceptance gates — 16 October 2026
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

# Telegram image maintenance follow-up — 2026-10-13

- PR #199: missing webhook helper fixed; new bot image COPY guard verified
  RED/GREEN, including real Node22 Docker imports with network disabled.
  Check full hosted CI on the final PR head before merging with `[skip render]`.
- PR #189 closed with current/archive handoff links; branch preserved.
- Security patch note corrected: equivalent and stricter fixes are in PR #197.
- Render auto-deploy root cause remains open pending working-account access.
  Existing API credential was not found locally; no live GET or setting change
  has been performed in this follow-up. Owner is arranging login. Inspect
  Git-provider connection, repo `timoshinoleg-eng/ofeliya`, main, checksPass,
  buildFilter and deployment history/triggers; do not assume provider validity
  from the repository URL alone. Official Render docs require a connected Git
  provider for auto-deploy; public-URL services require manual deployment:
  https://render.com/docs/deploys#automatic-deploys.
  After an evidence-based minimal fix, validate on the next runtime release.
- Real Samsung S20+ OS/MAX/TG versions, recordings, MAX Android/iOS/Telegram
  acceptance, newcomer study and measured mobile performance remain external.

# Verified review-fix release — 2026-10-13

Runtime source: c0c72fa81690b562e15c1d87580c66af842b3f3b (PR197 merged). Main CI38375891119: build/browser-smoke/production-contract success. Render Free deployment dep-db6vmg4s728c73cv4010 is live in production workspace tea-d8iruouq1p3s73f30a90 (timoshin.oleg@gmail.com). Canonical https://ofeliya.freeveol.dpdns.org/ofeliya/ reports this SHA. Metadata-only commits after this release do not change the published source identity.

Remaining: real MAX Android/iOS and Telegram acceptance, numerical Android/MAX/TG versions on owner's Samsung S20+, newcomer study and mobile frame-time/thermal measurements. test:mobile-evidence stays fail-closed; no fabricated PASS/FPS. Automatic deployment is configured checksPass but did not create this deployment after successful main CI; one pinned API deployment was used. Recheck Git-provider/automatic-trigger behavior on the next code release. No paid infrastructure, DNS/bot identity/secret rotation or keepalive was introduced.

## Historical snapshots (current verified facts above take precedence)

# Current review fixes — 2026-10-13

Branch fix/kimi-review-20261013, based on main26fcc88. User approved the independent review follow-up plan. See docs/release/KIMI_REVIEW_FIXES_20261013.md for contracts, tests and mixed-version policy. Previous handoff is archived under memory/archive/2026-10-13-before-review-fixes/; older state/decisions/backlog remain as historical notes below.

Snapshot gates: final-head CI, production backup/restore and release parity, S20+ Android/MAX/TG numerical versions + real acceptance/performance, MAXiOS, newcomer study. Broad scene refactoring and performance promises require measured evidence. Equivalent and stricter security fixes were merged in PR #197 (`server/request-policy.mjs`, `server/security-regressions.test.mjs`); do not import the old security patch wholesale. PR184 dependency fixes are included; PR #184 was subsequently closed with its branch preserved.

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

# Cutover backlog - 2026-10-11

Completed: dedicated MAX hosting callback; game-relative API/Telegram path
compatibility; new owner-account Render Free service; main/checksPass config;
canonical DNS/TLS; signed profiles/social reads; Telegram prepared sharing;
remote restart restore; full public-file/hash checks; OFELIYA Cloud.ru VM/disk/IP
removal; obsolete Cloud.ru deploy workflow disabled.

Remaining external acceptance: real /start in Telegram and MAX, Mini App
gameplay and save/reopen on owner devices. Automated/synthetic evidence does
not replace those checks. Render idle cold starts remain expected.
Other Cloud.ru workloads and charges require a separate scope; preserved.
The inaccessible old Render preview may be removed by its workspace owner.
Prior PR189 contains historical status and should not overwrite this handoff.

Supabase state access key was rotated in the existing Free project. The new
Render uses the replacement; the old key returns401 for read and writer claim,
so the inaccessible preview cannot steal production persistence. A 24-hour
management token was scoped only to this project and Edge Functions. No keys
are committed. Main CI38158081443 passed all three jobs for runtime d92325b.

## Historical notes

# BACKLOG — OFELIYA: STRAIN ZERO

Обновлено: 2026-10-05. Отмечайте сделанное галочкой; новые пункты добавляйте сюда, а не в чат.

## Control-mode browser smoke (06.10)
- [ ] Root review/publish `fix/control-smoke-preconditions-20261006` and rerun full main CI; focused browser smoke passed locally.

## Deploy CI payload fix (05.10)
- [x] PR #173 merged the file-backed deploy CI payload fix; target branch inherits it from main `b174b40`.
- [x] PR #174 merged targeted CI lookup and Ubuntu 22.04 pin; target branch inherits it from main `18e6f05`.
- [ ] Root review/PR for `fix/deploy-standalone-policy-20261005`, then wait for full main CI at the new SHA before deployment retry. No deploy performed by this task.

## Сейчас (P0)

- [x] Синхронизировать worktree с origin/main — выполнено 28.09 (main @ 480c67b).
- [x] Подтянуть origin/main в `feat/donor-quick-wins` — merge `45712e9` (без конфликтов, запушено).
- [x] Канонический гейт на синхронизированной ветке — пройден 28.09 (9 тестов + release:check + build).
- [x] Тест-цикл B в OpenCode (два прохода, смена модели) — пройден 29.09.
- [x] Внешнее ревью (внешняя модель — `memory/06_REVIEW.md`) + merge PR #151 — выполнено 29.09 (+2-е мнение `space-bunny-free`; пост-ревью правки PR #154). [ ] ChatGPT-вариант ревью — опционально, позже.
- [ ] Внешний релиз-гейт: реальные MAX Android/iOS — 16 пунктов (`RELEASE_VALIDATION.md` §8). Evidence validator реализован 02.10; реальные 16/16 ещё не сняты.
- [x] Merge PR #151: система памяти (квик-вины уже в main через #137) — выполнен 29.09 после внешнего ревью.
- [x] `.gitignore` для служебных каталогов — добавлено 29.09 (13 записей: 9 каталогов + 4 `*.capability.json`).
- [x] Проверить служебные untracked-каталоги (скан 29.09: 13 записей, ~55 файлов — совпадений 0). Исходная запись: - [ ] Проверить служебные untracked-каталоги (`config/`, `skills/`, `.cluster/`, `handoff-system/`, `ofelia-pilot/`, `*.capability.json`) на ключи/секреты перед этапом 3 (правило AGENTS.md — пока только на дисциплине).
- [ ] Балансировка по полным реальным прогонам (9+ минут).

## Далее (P1)

- [x] Реализовать продуктовую funnel-инструментацию и CLI-отчёт (02.10): app_open → run_start → run_60s → boss1 → heart → replay, onboarding timing/exits, D1, referral open → run_start.
- [x] Перестроить first-run tutorial вокруг RNA/мутации/заражения клетки-хозяина; удалить pause как обязательный шаг (02.10).
- [ ] Провести наблюдаемый плейтест новых первых 60 секунд на людях; собрать completion/time/exit reasons, не подменять smoke-тестом.
- [ ] Пройти реальный MAX Daily invite path на двух устройствах: send → open → run_start → result; сохранить evidence.

- [ ] Heart safe-pocket timing — плейтест читаемости; оба боя боссов — по ощущениям, не только технически.
- [ ] Twin-stick эргономика на реальных устройствах.
- [ ] Dense readability 100/150/200 — держать при любых визуальных изменениях.
- [x] Пилот памяти, Honor: тест-цикл B пройден 29.09; [ ] HP — блок A чек-листа (этап 3).
- [ ] Синхронизация двух ноутов: протокол pull/push в ежедневной работе.
- [ ] Правило: числа и ссылки в файлах памяти — только из git-вывода (по итогам 2-го внешнего ревью, 29.09).

## Отложено (не трогать без отдельной миграции)

- Третий орган / дополнительный акт кампании; сложность выше Strained; крупная экспансия Legendary;
  постоянная stat-прокачка; широкая внешняя арт/аудио-пайплайн; крупный рефакторинг или смена рендера.

## Audit follow-up 03.10
- [x] Revalidate D1 elite hitbox: false positive; Phaser scales the Arcade circle from source pixels. Added runtime regression assertion.
- [x] Fix D2 resize with blocking UI: level-up/result overlays now fit the new viewport and scrims remain full-screen; level-up runtime smoke passed.
- [ ] Keep D3 suspended-audio burst as a real-device acceptance check; do not refactor audio without reproduction.
- [ ] Complete real MAX Android/iOS 16/16 evidence gate; browser smoke does not close P0.

## Telegram release
- [x] Add Telegram WebApp SDK/Web origins to production CSP.
- [x] Add dedicated optional Telegram bot service and fail-closed deploy wiring.
- [x] Fix `/start <payload>` dispatch and add regression contract.
- [x] Dedicated Telegram bot identity supplied (`ofeliya_game_bot`); production secret staging pending final deploy gate.
- [ ] Configure BotFather Main Mini App URL to `https://ofeliya.freeveol.dpdns.org/ofeliya/`.
- [ ] Deploy Telegram-enabled main SHA and run real Telegram Android/iOS/Web acceptance.

## Telegram edge rollout
- [x] Diagnose #158 parity rollback: stale host-local Caddyfile.dedicated.
- [x] Add deterministic dedicated-Caddy renderer and CI contract.
- [x] Add validate/reload/restore edge synchronization to deployment.
- [x] Merge hotfix #159 and restore versioned Caddy rollout.\n- [x] Diagnose Cloud.ru Telegram API egress; add explicit reachable endpoint fallback.\n- [ ] Stage production Telegram secret/config after egress PR is green, then deploy and run real Telegram acceptance.

## Telegram webhook release
- [x] Add authenticated /api/telegram/webhook route and inline Bot API response.
- [x] Add webhook/polling deploy mode and fail-closed webhook secret validation.
- [x] Add fast client-side t.me/share/url fallback when outbound prepared-share is disabled.
- [ ] Merge/deploy webhook branch.
- [ ] Register webhook/menu button/commands through a network path that can reach Telegram Bot API.
- [ ] Verify real Telegram /start -> Web App -> initData -> run -> score and challenge share.


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

## Compact Legendary card clipping
- [x] Fix the three Legendary effect panels proven clipped at 320x568 with a bounded conditional third line.
- [x] Update the focused layout probe to identify the expanded panel and keep its text-containment assertion.
- [ ] Root rerun full branch CI/browser review from commit `997b6eee2403505e1a416fd5d2755496c30728e`; no release action is included.


- [ ] Root rerun final focused Legendary probe with mandatory desc/footer fixture checks on `997b6eee2403505e1a416fd5d2755496c30728e` before push.

## Compact Legendary spacing CI
- [x] Add 12px to compact Legendary reward card height only; keep three-card 320x568 stack within y=122..548.
- [x] Include effect/description/footer bounds in focused probe JSON and fail on missing fixtures/intersections.
- [ ] Linux focused regression after run37293956036 reported effect/description overlap; verify the 136px card correction on final candidate `29457d658e309ee87fadffd30c565528a11d6405`.

- [ ] Re-run focused Linux Legendary CI after commit `c01019f0708d9740cfc7a3f84da29bba149eed55`; latest Linux pass predates its viewport-fit guard.
- [ ] Track compact landscape Legendary panel density/layout separately; viewport-fit guard preserves the original 124px card treatment when expansion cannot fit and does not claim a full landscape redesign.

## Release closure (05.10)
- [x] Add `VITE_RELEASE_SHA: ${{ github.sha }}` to the Release Visual Matrix build step (`a32b3f2`) so `stamp-release.mjs` stops aborting that workflow.
- [x] Label the documented `npm run` lists as a quick check subset and name `.github/workflows/ci.yml` as the authoritative gate in `README.md` and `RELEASE_VALIDATION.md`.
- [x] Document `npm run test:mobile-evidence -- PATH`, its 16 required check ids, required fields, the manual requirements it does not cover, and external evidence storage.
- [x] Gitignore only `artifacts/mobile-acceptance.json`.
- [x] Correct the two inaccurate validator claims in README/RELEASE_VALIDATION: 16 is the mandatory minimum, extra `checks[]` rows are permitted and uninspected, and `testedAt` is validated by `Date.parse` rather than strict ISO (`d976778`). Documentation only; validator semantics unchanged.
- [ ] Coordinator/Cline/Hoplite independent review of `a32b3f2`; at most two fix iterations. No Codex reviewer.
- [ ] Verify the Release Visual Matrix workflow actually goes green on GitHub after the env fix — it was never confirmed green locally, since that job needs Ubuntu + Playwright.
- [ ] Remaining report findings stay backlog, out of this bounded scope: no redesign of docs structure, no validator semantics change, no fabricated evidence.
- [ ] Unchanged external gates: real MAX Android/iOS 16/16, Telegram launch/referral/Daily, public `release.json` exact SHA.

## Multi-card Legendary layout regression coverage (05.10)
- [x] Preserve existing single-card Legendary cases and add all distinct two-definition pairs across the three existing viewports.
- [x] Add a clearly labelled synthetic three-Legendary stress case and a 320x520 short-portrait non-expansion guard.
- [x] Assert per-card fixtures and bounds, card separation, measured subtitle gap, fit-guard decision, and visible-text viewport containment.
- [x] Initial root browser run: 87/88 passed; singles and all two-card pairs passed. One synthetic-three 320x480 failure was caused by subtitle overlap in the stress fixture.
- [x] Root rerun with guard fixture at 320x520: 88/88 passed (24 singles, 60 pairs, 3 synthetic-three, 1 guard); short guard stayed at 124px with 9px subtitle gap and no overflow.
- Linux rerun after URL correction: 87/88; the first revised short guard still failed because definition index 3 wraps to three lines. Linux measured all six as `[2,3,2,3,3,2]`; latest fixture correction uses indices 0, 2, and 5. See `work/multicard-linux-plain2.log`; rerun pending.
- [x] Linux probe ran after URL correction: 87/88; all 15 real Legendary pairs across all viewports passed. The only failure was the short synthetic-three guard selecting a 3-line effect against the intended 2-line compact cap on 124px cards (`work/multicard-linux-plain2.log`). This is an unreachable stress content limit, not a trophy defect (trophy offers two). Long-content three-card stress stays on taller heights.
- [ ] Rerun with the short guard using three two-line effects (definitions 0, 2, 5); keep all 15 actual pairs at 320x520 and leave assertions/production UI unchanged. Independent review approved this bounded fixture adjustment. No real-device acceptance claim.
- [x] Linux measurement found short-guard definition index 3 also wraps to 3 lines; measured six single wrap counts are `[2,3,2,3,3,2]` (`work/multicard-linux-plain2.log`).
- [ ] Rerun short guard with measured two-line definitions 0, 2, and 5 (index 5 is last-life-saving Legendary); all other cases remain unchanged. Latest Linux is 87/88; do not claim pass until rerun.

## VO-01 follow-up — 07.10.2026
- [x] Runtime RED before implementation; bounded DEV/QA snapshot and dimensions/input browser assertions.
- [x] Local DEV + QA production renderer 6/6, ordinary production opacity, focused existing checks and builds. Evidence and failures: docs/visual-overhaul/VO01_VALIDATION.md.
- [ ] Coordinator independent review of 582723032b060f690eb59dac933c60834d0969a2. Kimi blocked by invalid API key; failed artifact must not be committed or treated as evidence.
- [ ] Run full Linux CI against the final candidate when authorized; current local builds stamped base d7797bc, not final HEAD.
- [ ] Real MAX Android/iOS/Telegram touch, safe areas, resume and GPU/sharpness acceptance remain external gates.
- [ ] Separate architecture/design for any future overall HiDPI; VO-01 deliberately does not change rendering resolution.

## VO01 fix1 backlog — 07.10.2026
- [x] Real Kimi frozen-diff review imported; invalid-key blocker resolved externally, superseding earlier pending note.
- [x] F1-F5 and requested F6/F8/F10 addressed in c231d60ebcf5748b9a2a2d2c5bbf99ca39adaa5a; focused missing-scenes/QA matrix/production opacity/typecheck passed.
- [ ] Coordinator rereview/accept fix1 and import branch into original pipeline; broader plan remains coordinator-owned.
- [ ] Full Linux CI, slow bridge resize latency, real nonzero safe areas/hidden resume/devices/GPU remain unverified; do not promote local focused evidence to acceptance.


## VO02 combat follow-up — 07.10.2026
- [x] Baked Canvas/WebGL particle frame palette, single death budget grant, directed membrane hits and retained decoration pool implemented in `ddbe943`.
- [x] Focused RED then GREEN8/8; impact budget/runtime quality/telegraphs/typecheck/whitespace checks passed locally.
- [ ] Coordinator real Phaser impact/Canvas/WebGL visual matrix against VO02 candidate; inspect actual frame colors and contact readability under100/150/200 enemies.
- [ ] Coordinator independent Kimi frozen task-range review (`a4d20d1..VO02_HEAD`), scoped fix/re-review before Task3.
- [ ] Coordinator integrate `node tests/vfx-presentation.mjs` into final acceptance commands as appropriate; no new npm script/CI wiring was included in this scoped task.
- [ ] Full branch CI/build and real MAX Android/iOS/Telegram gates remain pending; focused Node adapter checks are not pixel/performance acceptance.


## VO02 Kimi fix1 backlog — 07.10.2026
- [x] Coordinator reported scoped Kimi code PASS/no Critical; all four Important nonblocking test gaps addressed in 04f56f7.
- [x] Focused 12/12 and four meaningful mutation checks; required typecheck/impact/runtime/telegraph checks passed.
- [ ] Coordinator import test+memory commits and rereview/accept the four coverage fixes. Existing production behavior is unchanged; earlier full task browser evidence need not be represented as a worker run.
- [ ] Root real Phaser matrix/impact acceptance and full final branch gates remain coordinator-owned; real MAX Android/iOS/Telegram external gates remain open.


## VO03 organ atmosphere follow-up — 07.10.2026
- [x] Coherent three-band RBC depth, bounded retained pulse and separated Heart visual peaks implemented in `8af0b92`; original static image counts/geometry retained.
- [x] Focused9/9, meaningful four mutation checks, stage/runtime-quality/impact-budget, VFX12/12, typecheck and whitespace checks passed.
- [ ] Coordinator independent Task3 frozen-diff review; remote Kimi currently unavailable, fallback reviewer remains root-owned. Scoped fixes/review before Task4 acceptance.
- [ ] Coordinator real Phaser WebGL/Canvas dense full/reduced screenshots, Heart valley/second peak, compact resize/stage reset/shutdown QA. Worker adapter tests are not raster/GPU evidence.
- [ ] Coordinator integrates focused atmosphere command into final branch acceptance; no scoped npm/CI wiring added.
- [ ] Task5 actor/host high-resolution backing compensation; host shadow source unchanged in Task3. Full final branch build/CI and real MAX Android/iOS/Telegram gates remain open.


## VO04 audible mix follow-up — 07.10.2026
- [x] Audible master/music/bed/SFX mix, normalization caching, compressor, authoritative visibility and immutable safe diagnostics in `5c53377`.
- [x] Focused17/17 production TS math/graph lifecycle contracts; required audio/save/RNG+checkpoint/typecheck/whitespace checks passed.
- [ ] Root integrate code/memory commits and run independent frozen Task4 diff review; worker remains available for scoped fixes.
- [ ] Root actual seven-CC0-bed OfflineAudioContext busy sample rendering using production math; establish finite/clipping bounds and audibility evidence separately from boundary tests.
- [ ] Root integration/Phaser QA and final task gates; scoped test command is `node tests/audio-mix.mjs` with no package/CI wiring changes.
- [ ] Task5 high-resolution actor/host backing compensation; final build/CI and real MAX Android/iOS/Telegram external acceptance remain open. No deploy/merge performed.


## VO05 core art recovery follow-up — 07.10.2026
- [x] Recovered saved `fdacc92` core art integration and inherited `346638d` seven generated assets/provenance without regenerating them.
- [x] Verification coverage `3de91b7`: core-art15/15; typecheck, viewport/tokens/impact-budget/runtime-quality/telegraphs/startup-renderer, VFX12/12, atmosphere9/9, save/RNG/checkpoint/stages and whitespace.
- [x] Preserve original untracked timeout-mutant, confirm one targeted finite-XHR assertion fails under1800->0 mutation.
- [ ] Coordinator frozen Task5 scoped review and cherry-pick coverage/memory; implementation `fdacc92` remains unchanged.
- [ ] Coordinator actual browser missing/stalled-image fallback/startup, Phaser body/display/centers across WebGL/Canvas, controls/elite/visual matrix and screenshots; worker adapters do not close these gates.
- [ ] Task6 menu/HUD finish, final branch build/CI, real MAX Android/iOS16/16 and Telegram external acceptance. No merge/deploy performed.


## VO05 stalled-art follow-up — 07.10.2026
- Root actual-browser regression exposed >6000ms stalled startup. Phaser3.90 Loader defaults maxRetries2; File.onError reloads twice, creating3x1800ms windows. Desktop parallel32; Android parallel6 can additionally batch seven assets.
- `9dc9650` sets optional-art retries0 while queueing (restores prior value in finally for unrelated future files) and Boot concurrency max(existing,7). Per-file1800ms timeout unchanged. Core art contract now16/16 includes retry capture/restore and Android6/desktop32 batching policy.
- With root-authorized browser follow-up, actual Chromium Canvas startup available1335ms/missing1102ms/stalled2501ms/Android-UA stalled2673ms, all unchanged6000ms gate. Stalled modes each requested exactly7distinct assets, no retries; Android config default6 and Boot loader7 explicitly confirmed. Private extended copy of root startup test remains untracked for coordinator import.
- Elite fixture now compares actual halfWidth/halfHeight to floor(sourceWorldRadiusX/Y), matching Phaser Body.setCircle/updateBounds; logical tolerance1.01, markers/signatures/centers unchanged. Actual elite script passed against own Vite server with only URL substituted in temporary copy. No physics production changes.
- Typecheck, core16/16, nonbrowser startup-renderer, viewport/tokens/impact-budget and whitespace passed after fix. No push/merge/deploy. Root still owns full geometry/controls/matrix/scoped review and external device gates.

## VO06 Menu/HUD follow-up — 07.10.2026
- [x] Decorative Menu framing/halo and illuminated selector edges; HUD retained bar highlights/hairline implemented8d8d9cd.
- [x] Worker typecheck/tokens/ui-copy/layout-diagnostics/language1584/viewport/Legendary-impact-VFX smoke/whitespace passed.
- [ ] Coordinator integrate code/memory commits, frozen independent Task6 scoped review and any review fixes.
- [ ] Coordinator actual portrait/compact menu/HUD/Legendary/modal-control browser acceptance, screenshots, retained-object/tween teardown. Worker did not run browser.
- [ ] Task7 integrated acceptance/build/review/PR; real MAX Android/iOS16/16 and Telegram external gates remain open. No merge/deploy performed.

## 2026-10-07: Post-overhaul release work

Check hosted PRCI; collect realMAX Android/iOS16-point and Telegram audio-unlock/performance evidence. Track existing fallback-font compactHUD overlap (LinuxDejaVu reproduces baseline; nativeHONOR gatepassed). FullHiDPI renderer experiment and optional music-track/trim array maintenance guard remain separate followups. No current production merge/deploy authorization inferred.

## Current CI checkpoint

- [x] Restore interrupted visual work and create draft PR179.
- [x] Investigate initial hosted CI failures and review test-only fixture fixes.
- [x] Native production QA12-cell matrix and six-viewport comprehension acceptance.
- [ ] Confirm full hosted CI on latest combined PR head before concluding PR validation.
- [ ] Real MAX Android/iOS16-point, Telegram audio unlock/device performance and separate generalHiDPI renderer follow-up remain open. No merge/deploy.

## 2026-10-08 visual residuals
- [x] Hero/antibody local6frame idle deformation with exact76row geometry proof.
- [x] Measured compact combo and boss title/bar overlap fixed;6viewportHUD passed.
- [x] WindowsCyrillic presentation source harness repaired, original54assertions intact.
- [ ] QA-only capped2x framebuffer followup: integrate/retest independently before density activation.
- [ ] Original composed compatible stems and authored charge/hit/death cycles: brief ready, assets not claimed.
- [ ] MAXAndroid/iOS + Telegram real-device audio/input/denseframe-times/thermals acceptance BLOCKED—HUMAN ACCEPTANCE REQUIRED.

## HiDPI QA follow-up (08.10)
- [x] Final integrated logical/backing/input/resize/teardown and multitouch controls.
- [ ] Final hosted dedicated density + existing CI green; exact SHA readback.
- [ ] Actual MAX Android/iOS and Telegram10–15min acceptance including sustained density1x/2x frame-time/thermal/audio/touch evidence.
- [ ] Context/offscreen/mask/postFX tests before HiDPI rollout.
- [ ] Authored compatible music stems and full charge/hit/death/RNA/icon scope; do not mark original visual goal DONE.

## Authorized release recovery (08.10)
- [x] Merge179/180/181 and run freshmainCI/matrix.
- [x] Fixture isolation + exactlocaltests + independentsourcereview.
- [ ] Fresh fixturePR CI, merge, finalmainCI, immutable deploy/publicSHAhashparity.
- [ ] Actual MAX/Telegram device acceptance; fullcreative remaining scope unchanged.

## Cardiac clock isolation follow-up
PR182 initial head e1c058e CI37768249337 passed ceremony but failed Cardiac8s. Diagnostic-only14b6d3c CI37769887253 remains running. A local synthetic sparse RAF35ms plus explicit cooldown240 reproduced the timeout: Game active/notpaused/UI clear, boss phase2, stage2649 versus scene16936, nextTelegraph13575 already due, heartbeat3216 safeIndicator true; zero page errors. This demonstrates the mixed-clock scheduling mechanism, not the exact hosted runner conditions (default cooldown120).

Fixture now uses the real heartbeat.restore with nextImpact=stageTime+60000 and bossWasActive=true, with exact60000 setup assertion. Game.update, real Cardiac scheduler and canSchedule, original4700/850/280 source timing,8s/2s/1.5s browser deadlines, exact14damage and heartbeatClear remain. It intentionally does not validate live heartbeat concurrency; unchanged test:pacing separately tests1980/1981 boundary and exclusion. Native exactscript plus paired synthetic stressed fixture PASS; pacing PASS. Independent Codex source review PASS. Additional Kimi OmniRoute review returned empty content and is NOT approval. Await fresh PR/main CI before deploy.

## Hosted progression cause captured and pool reset
Diagnostic-only14b6d3c CI37769887253 failed with Game inactive/paused, UI modalOpen/uiBlocked, awaitingChoice true, stage149ms, bossactivephase2, hazard disabled/serial0 and no errors. This directly proves a new progression choice paused the updater; it does not identify the individual RNA drop. The only ordinary queued-level source is onGemCollected; stage transition was not occurring.

The fixture now uses production-standard deactivateForStageReset for existing bullets/RNA gems, resets host cells and excludes their update/rewards from this beam contract. It asserts zero active bullets/gems. Paired local inherited-RNA100 fixture: baselinef292dc7 paused atstage33ms/queued3/awaitingChoice and failed8s; corrected fixture PASS. Exact corrected script alsoPASS. Thus no onGemCollected/Game.update/hazard method is stubbed, no assertion or timeout is loosened. Host-cell/RNA integration is outside this scoped beam test; other unchanged gameplay/browser suites cover it. Mixed-clock synthetic finding remains separately documented and was not the captured hosted cause.

## Dense readability fixture lifecycle recovery
Final6c84b89 CI37771605821 passed Legendary, Cardiac and controls, then dense-readability failed target150/cache150 with allalpha1. Enemy preUpdate reads prior density; Game.update refreshes cache afterward. Original fixed150ms sleep need not contain both real frames.

Density fixture now waits two actual Scene POST_UPDATE frames with cache>=target, bounded1500ms, before unchanged150/200targets/alpha assertions. This replaces a synchronization assumption, NOT an unchanged performance/timing gate. No manual Game/Enemy update or cache writes. Startup accepts an already-paused real Game, resumes then clears progression/UI; new unblocked assertion added. Exact native finalscript PASS; original native Game.active-only wait had stopped at startup30s. Paired sparseRAF240ms with shared corrected startup: old150ms sleep failed cache100/target150/allalpha1; completed-frame wait PASS. This demonstrates synchronization sensitivity, not the exact hosted scheduling. Independent Codex source review PASS. Additional Kimi nonstream diagnostic HTTP504; no routed approval.
# 2026-10-11 Migration checklist

- [x] Verify free plans and initial state export; durable adapter/unit checks.
- [ ] Deploy Render and verify signed Telegram API plus restart persistence.
- [ ] Drain/export/import final Cloud.ru state; keep canonical HTTPS domain.
- [ ] Switch Telegram webhook/menu; verify release and asset parity.
- [ ] Independently preserve other workloads then delete all paid Cloud.ru resources.
- [ ] Verify remaining tariff/resource inventory and residual charges.


## 2026-10-11 local cutover follow-up
- [x] Audit54public files, release hashes, remote health and browser game startup.
- [x] Mount existing MAX webhook handlers and test /start/auth/gateway/MAX profile locally.
- [ ] Complete authenticated access to the service Render workspace; available UI awaits GitHub2FA.
- [ ] CI/review/merge hosted MAX correction and deploy from main with dedicated credentials.
- [ ] Bind canonical domain, verify TLS/DNS and both messenger bots/identity/state restart.
- [ ] Retire only verified OFELIYA Cloud.ru resources; do not claim billing stopped before inventory readback.
# B2/B4 integration follow-up — 20 October 2026

- [x] Apply B2/B4 CI gate patch and add reduced-motion regression.
- [x] Local focused tests, presentation, tokens/copy, telegraphs, impact budget, strict TypeScript and build.
- [ ] Root browser 16-cell reduced/no-preference and boss fixture QA; root-owned biological pixel gate evaluation.
- [ ] Root independent review and scoped fixes if needed.
- [ ] Hosted exact-head CI and owner release/device acceptance remain separate gates; no merge/push/deploy authorized.

Root validation: actual Canvas/WebGL echo matrix 16/16 passed at320/390/768/1080 with both motion preferences; world/HUD phase and live-preference checks4/4 passed. Adapted repo41 two-postrender/native-decoded screenshot pixel check without pngjs; strict3-cell impact passed, WebGL idle0/hit3982 white pixels. Negative control clearing tint fails as expected. Independent source review found no actionable P1/P2. Final-head full tests/build are tracked externally in12_INTEGRATION_PREP.
