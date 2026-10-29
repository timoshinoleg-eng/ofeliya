Juice port CI fix 2: шаг build падал на scripts/check-muse-performance.mjs — скрипт исполняет реальный префикс GameScene.update() (до 'if (len > 0.1)') на фейковом объекте, а первой строкой префикса теперь стал this.juice.update(). Исправлено добавлением juice:{update(){}} в фейк (как и остальные стабы: maybeCompleteBossDefeatCeremony, runtimeQuality) — смысл теста (governor/modal-keyboard/DPR) не менялся.

Juice port CI fix: шаг build падал на tests/reduced-motion.mjs — статический паттерн требовал литерал cameras.main.shake в пределах 100 символов после гарда prefersReducedMotion, а shake() теперь делегирует в juice.screenShake. Контракт сохранён, а не ослаблен: гард по-прежнему первым в shake() подавляет любой вызов актуатора, а juice.screenShake → cameras.main.shake доказан juice-driver тестом. Паттерн расширен до (cameras.main.shake|juice.screenShake) с окном 300 (комментарий в shake() длиннее старого окна).

Juice port: часы группы — собственные (performance.now), а не время сцены Phaser (см. шапку Juice.ts и тест): иначе твины стартовали бы с задержкой на boot-offset, а hitStop-дип замедлял бы собственное восстановление через timeScale сцены. В стеке Juice.update(time) принимал время сцены и браузером не проверялся — в main это исправлено, сигнатура update(timeMs?) с опциональным временем только для тестов. SHUTDOWN-хендлер GameScene НЕ тронут: он явно запрещает трогать scene-системы при shutdown; reset Juice живёт только в create-блоке (create пересобирает подсистемы каждый забег, старый clock уничтожается со сценой — утечки дипа нет). prefersReducedMotion-гард в shake() сохранён (main-доступность не регрессирует; в стеке гарда не было). Церемония боссов (B2/B4) не тронута ни строкой: швы — update-топ, hitStop-хвост, shake-делегация, create/reset — всё вне церемонии; сама церемония timeScale/shake/zoom не использует (проверено чтением кода).

Stars port: провайдер читает window.Telegram.WebApp напрямую (guarded, structural-тип), а не импортирует TelegramPlatform — shop-модули компилируются Node-тестами standalone; дублирования платформы нет: это тот же объект WebApp, интерфейс которого объявлен в TelegramPlatform.ts (openInvoice добавлен туда). recordStarsSpent — в провайдере на 'paid', а не в сцене: трата — свойство платежа, а не гранта; mock не пишет (звёзд не тратит); покрыто Node-тестом (paid → starsSpent, cancelled → без изменений). Авто-детект витрины (hidden + TG + backend → Stars) — осознанное исключение из fail-closed по дизайну стека: финальный гейт — isAvailable() провайдера; без бэкенда/инит-даты витрина недоступна. В CI/dev без VITE_PAYMENTS_API_URL поведение не меняется (чип не рисуется, сцена fail-closed).

Storefront port: в стеке выдачи не было (только анимация + запись в провайдере + аналитика) — в main выдача делается сразу через существующие механизмы, иначе «Выдано» врало бы. Бустер реализован здесь же (boosterUntilMs + множитель в spawnGem), а не отложен: post-review-патч партии 4 (booster→boosterUntilMs) при порте найдёт его уже wired — сверить семантику, не дублировать. SkinCatalog: SHOP_CATALOG — источник id/title/seed/palette; rarity и stars остаются галерейными аннотациями до партии Stars (у витрины партии 3 нет ни rarity, ни XTR-цен — только RUB). StorefrontScene без Juice осознанно: витрина не зависит от game-feel движка забега (прецедент LabOverlays/SkinGallery — твины). События воронки — через trackProductEvent (серверный allowlist), а не umami: в main фаннел идёт этим путём (run_10min/mutation_chosen). Серверный allowlist PRODUCT_EVENTS расширен аддитивно (+4 события) — это требование теста check-analytics-events, а не изменение score/profile-контракта.

Phase 5 port: витрины в main нет — SkinCatalog задаёт 3 шоп-скина inline (ТЕ ЖЕ значения, что в shop/products.ts стека: seed/palette/title/stars 100/100/250, productId = id товара); партия 3 при порте витрины переключает каталог на SHOP_CATALOG. Juice НЕ трогать (партия 4): анимации галереи/тоста — обычные твины сцены (прецедент LabOverlays). Кнопка КУПИТЬ и переход в Storefront НЕ портированы: shopVisible=false + TODO, шоп-скины показывают цену и «СКОРО»; ханк StorefrontScene (grantSkin(id,'purchase') при purchase_completed) — follow-up партии 3, шов не выдуман. Аналитика: UmamiAnalytics стека в main нет — skin_granted/skin_equipped идут через trackClientEvent (no-op без конфигурации, как umami без websiteId); 4 списка sync (32 события). Player: текстура скина заменяет bio-цикл, но hit-flash атлас выигрывает во время hit-кадров (фидбэк урона); тинт коллекции при активном скине гасится до белого (иначе палитра удваивалась бы: тинт × SVG тех же цветов); пока текстура печётся — bio-цикл + тинт коллекции. Два пути выбора скинов сосуществуют (не унифицировать в этом порте — семантическое решение за Mark): коллекция shells → тинт (ClientCollection.selectedSkinId), галерея → DiceBear-текстура (SkinOwnership.equippedId); при экипированном скине галереи текстура выигрывает, при дефолтном — тинт коллекции.
Menu redesign: сетка 3×2 вместо третьей строки — третья строка стоит 48px фиксированной высоты, которых нет в compact (resume+record 320×568: art ровно 64.0 при видимых strain/tagline; добавление строки прячет brand-текст или роняет hero ниже пола; resume+challenge+record2 ушёл бы ниже 40). Три колонки стоят 0px вертикали; лейблы влезают измерением (Liberation Sans Bold = метрики Arial; DejaVu-fallback — шире, но в пределах пола guard 0.72). Compact nav 12→11px (пол readability-контракта для compact — 11px; 10px уронило CI на ui-readability-smoke, это не ослабление, а соблюдение существующего порога). Бейдж кодекса: сдвиг label влево по измеренным ширинам (зазор ≥4px), guard для сдвинутого label не применяется (короткий, фит не нужен). Флаг economy.lab гейтит тап лаборатории (как collection.enabled гейтит коллекцию) — видимая ячейка при выключенном флаге не делает ничего. Заглушка штаммов — модалка без логики скинов; purchase→grant — follow-up партии 3.
Phase 4 port: Decimal (break_infinity.js) НЕ портировать — магнитуды экономики (~1,1e8 макс.) на 7 порядков ниже MAX_SAFE_INTEGER; утверждение стека «float теряет целые уже на ур. ~15» неверно (2.5^15 ≈ 9e5 — точное целое). Порт на plain numbers: costForLevel — целое (Math.round), grantMetaRna — floor после множителя. Juice НЕ трогать (партия 4): анимации панели — обычные твины сцены. grantMetaRna — единственная точка начисления дохода meta-RNA (daily claim, награды достижений); квесты main грантов не дают — не трогать. Престиж — только мета-доход (+10%/престиж), боевой баланс не трогается; lifetime-счётчики при престиже не сбрасываются. Точка входа в меню НЕ добавлена: все варианты проверены вычислением layout и отклонены (полоса 44px ломает hero resume 320×568 — art 67.6, запас 3.6px; док 4 таба — перекрытие лейблов ~9px; сетка 3×2 — «ЛАБОРАТОРИЯ» не влезает в ячейку; чип сверху — конфликт с заголовком/бейджем). Решение о точке входа — за Mark; панель showLabPanel готова к подключению. Модификаторы забега — только на fresh run (resume: чекпоинт уже содержит запечённые значения).
Phase 3 port: квесты inkjs не портируются — main src/quests/ уже содержит те же 12 квестов без inkjs, а награды квестов по архитектуре main принадлежат серверу (QuestRewardGateway, без реализации); клиентский грант за квесты не вводится. DailyCalendar стека не портируется — переписан как UI-обёртка над серверным daily по решению Mark: стрик/сыгранность из DailyHistory (локальные дни, не UTC), claim только после забега дня, дублирование наград исключено записью claim. Грант daily-награды пока локальный (MetaWallet) — серверного claim нет; когда появится — модуль станет тонким клиентом. evo_5 → evo_3: в игре 3 эволюции, порог 5 недостижим даже в стеке. Модалка daily: ✕ во всех состояниях (в стеке в состоянии claim закрыть было нельзя) — автопоказ повторяется при следующем входе в меню, пока не забрано. Счётчик questsCompleted — diff снапшота квестов на конце забега (не трогаем ядро src/quests/). stars_500 → грант скина skin.gilded-prime только записывается (ofeliya.ach-skins.v1), применение — Фаза 5.
TMA port: поведение TMA уже в main (subscribeViewportChange, TelegramLifecycle/GameHostLifecycle, installTelegramTheme) — не дублировать API стека ради имён. Портируется только то, чего нет: чистый компаратор isTelegramVersionAtLeast как экспорт (fallback isVersionAtLeast; malformed → false, строже стека). Не портируются: onViewportChanged/onSafeAreaChanged (сырые, без фильтра unstable — хуже subscribeViewportChange), resolveSafeAreaInsets (слабее mergeSafeAreaInsets), adapter-методы closing/activated/theme (дубли TelegramLifecycle/TelegramTheme), openInvoice (Stars, не TMA).
Phase 2 port: геймплейные флаги — отдельным модулем src/game/FeatureFlags.ts (micro-flags, ноль зависимостей), а НЕ в ClientFeatureFlags: тот резолвер — presentation-only по архитектурному решению main, запиненному тестом check-muse-telemetry.mjs («gameplay flags must not exist» — первая попытка портировать флаги туда уронила CI на этом тесте). Umami-клиент не дублируется: в main уже есть OptionalWebAnalytics, новые WebEvent-имена не вводятся — фаннел идёт через существующий trackProductEvent. storefront.variant — stub в FeatureFlags до порта витрины (там появится первый читатель). run_ended не добавляется: win/death + derived run_end покрывают.

A11Y follow-up: share menu action callbacks between pointer and keyboard; keep DOM focus within legal dialog and restore it on close.
HUD follow-up: cache retained bar geometry and redraw affected fills when values change; invalidate on layout.

PR249 convergence 2026-10-27: notification tap waits for settled card; legal and diagnostics have disjoint 44px targets and actual touch coverage; FIFO/action assertions retained. EASY visual uses redesign locators and falls back to existing compact description if full copy overflows. Current CI and exact HEAD status in PR249. No merge/deploy.

UX CI follow-up: new ordering/touch tests PASS; legacy mobile matrix uses center alignment for wrapped footer labels, retaining spacing/overflow guards. No runtime delta. Exact final SHA CI required.

UX follow-up: EASY248 c615ab7 resolves prior share-label P2; source-only limits remain. UX250 first CI Daily fixture failure reproduced and presentation initialization relocated; final exact-head checks tracked in PR.

# Verified UX decisions — 2026-10-26
Use run-owned FIFO for system surfaces; tutorial yields presentation only. Preserve notice display time across suspension; startup resumes after mutation. Obsolete stage notices cancel atomically at stage boundary; terminal result/shutdown closes queue. Footer wraps measured labels only when needed and uses custom44px hit areas; legal/version occupy disjoint bottom-row targets. No result-HUD change, no instrumentation, difficulty or validator change. See docs/qa/VERIFIED_UX_FIXES_20261026.md.

---

# PR244 independent final gate - 2026-10-25

Original de6a74afd80607e6df24801a819d7e6cfa60af4f is BLOCK: P2 mutation gate falsely classifies omitted pre-hit flush as equivalent. Real offset streak reaches q_nodmg60; the permitted mutant records59. Narrow tests-only repair on review/codex-pr244-final-gate-20261025; report docs/qa/CODEX_PR244_FINAL_GATE_20261025.md. UTC14/14 +2 equivalent +control passed; exact candidate CI40181931371 is genuinely green but cannot prove the false equivalence. Lifecycle and UTC/units historical RED/GREEN independently reproduced. Keep native memory failures and base-reproduced startup font assertion distinct from product findings. No merge/deploy. Next: Draft follow-up into #244 branch, new exact-head full CI and release decision. Physical native close inconclusive, eviction/MAX NOT_RUN.

---

# Final convergence decisions — 25.10.2026

Preserve linear #241 -> #243 -> #242 provenance; do not merge source branches. Expand existing crossflow rather than add a third harness. Keep product delta to proven P2 unit repair; do not redesign Collection eviction. Preserve full86+13 mutation matrices and equivalent controls. Exact combined-head hosted CI is mandatory; physical WebViews remain separate NOT_RUN gate. Report final immutable SHA/CI identity in Draft PR to avoid document self-hash recursion.

---

# PR #241 gate decisions — 25.10.2026

- A lifecycle transfer must restore Game pause/close subscriptions as well as viewport listeners. Reuse the existing idempotent binder on resize and detach it on shutdown/finish.
- Treat 1024 run IDs as a finite duplicate horizon. An evicted replay can cross cumulative cosmetic thresholds; no authoritative rewards/score/payment effects exist. No cap rewrite without an ordinary reachable old-result replay.
- Record synthetic-transfer scope explicitly. Native remount and physical WebView behavior remain acceptance evidence to collect; do not relabel a synthetic finding as observed native failure.
- Keep broad console error filters, swallowed/retried modal errors and direct DESTROY-without-SHUTDOWN cleanup as separate P3 observations. No unrelated product churn in this fix.

---

# Quest integration decisions — 23.10.2026

- Engine принадлежит GameScene producer; UI читает отдельный storage-backed view только в остановленном Menu. Singleton/новый глобальный event bus не понадобились. Для будущего одновременного HUD потребуется отдельный readonly subscription contract.
- RNA — фактически собранный combat XP pickup; UI notify не источник. Elite определяется только e.isElite, тип врага передаётся отдельно.
- Optional checkpoint.quest хранит run identity и дополнительные counters, без schema/score/ruleset bump. Невалидный payload не ломает gameplay resume. Новый delivery timeline при rollback исключает false dedup, day completion остаётся историческим фактом.
- Resume вчерашнего shorter streak переустанавливает baseline без фиктивного сегодняшнего прогресса.
- Только menu board, без HUD churn/наград/claim/Daily grant. Runtime terminal marker не является серверной reward receipt.

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

Порядок модели: текущий main, затем #221, затем #222. Четыре memory конфликта согласованы без выбора только одной стороны: общий исходный блок сохранён один раз, все добавления обеих сторон сохранены отдельно. Игровые файлы не исправляются ради слияния. Старые #210/#183 не применяются целиком; #220 дублирует timeout-only изменение. Дальнейшие GitHub merge/push/deploy запрещены без разрешения владельца.

Base abdb10c19d17de074f2be90e52d59cd9485c5b1b; Daily 500ab50fa3bc2e374f78ce0c3218f63065e8b7e1; B2/B4 cd8612854d28b19ed2e0b49f4451c6c9704a3b74. Все исходные версии доступны в Git parents и в evidence/memory-sources отчёта.

## Исторические добавления Daily #221 (перед общим блоком)

# Daily outbox integration preparation — 20 October 2026

Branch fix/daily-outbox-integration-20261020 is isolated from main abdb10c. Applied audited daily-outbox-fix-v3.patch; added exact-ID settlement of migrated in-flight Daily requests and two behavioral regressions. MAX and Telegram coverage checks two offline tickets, account ownership, refreshed credentials, quota failure, missing Daily acknowledgement, lost response/idempotency, concurrent A/B settlement. Focused29/29 passes on Node22.23.3. Broader validation and publication readiness are recorded externally in OFELIYA_MASTER/12_INTEGRATION_PREP; no publication, merge or deploy authorized.

Storage is bounded8+one Daily and best-effort in restricted WebViews. At failed migration/quota, old ticket is retained and network is returned for the new ticket; cannot promise durable storage when localStorage refuses writes. Real MAX/Telegram device acceptance and hosted CI remain pending.

## Previous context


## Исторические добавления B2/B4 #222 (перед общим блоком)

# Visual upgrade Phase B4 decisions — 19 October 2026

1. Shape vocabulary shared, semantics preserved: HUD adopts the aura's ring/tick/diamond language, but the critical telegraph stays untouched — its red language is a combat contract (test:telegraphs), not identity chrome.
2. Phase color mirrored in HUD via new getters (Enemy.getPhaseMode, GameScene.getBossPhaseMode) rather than extending the run snapshot: additive-free, no checkpoint/save shape risk.
3. Recovery/broken auras get the armored 6-tick ring so all phases read as one system; cardiac (heartbeat) boss deliberately excluded — it has its own visual language and different behavior contract.
4. QA-only wave.boss substitution used for the HUD bar capture (documented) because the real wave boss needs minutes of play; the substitution exercises the identical render path.
5. Perf handled by bound argument (<=6 stroke primitives in recovery/broken windows) plus a control 60s combat run — boss-specific perf harness deemed disproportionate.

## Previous snapshots
# Visual upgrade Phase B3 decisions — 19 October 2026

1. Non-word tier signal chosen (pips + frame strength) over text badges: new visible words would burden the copy catalog/language guard and still need parsing; pips read pre-attentively and need no localization.
2. Existing VISUAL tokens (host/rare/warning) reused; no new palette entries — keeps B5 migration surface from growing.
3. Legacy hexes (COLORS.gold, #ffe066) migrated to VISUAL.warning inside the card flow as part of B3 since the hierarchy touched exactly those lines — partial B5 contribution, documented as such.
4. Synthetic-def capture driver (mutation-cards-capture.cjs) chosen over organic level-ups: identical defs in both builds give a true pair; balance/RNG untouched.
5. No perf run per standard: modal-scoped objects, nothing in the game loop; bundle gate (+2.1%) substitutes.
6. Donor convention satisfied by documented absence: prior MIT donor has no rarity system; implementation original.

## Previous snapshots
# Visual upgrade Phase B2 decisions — 19 October 2026

1. Root cause chosen over cosmetic patch: playerHalo rendered below enemies (depth 7.5 < 10) — fix = new layer at depth 11 above the swarm, not tweaking halo alpha/radius.
2. Layer order preserves identity marks: clearing at 11 stays below elite markers (12), enemy health (13), bullets (14), player (15); only the swarm mass and its auras are dimmed. Accepted tradeoff: telegraphs (8) inside r≤52 pocket dim — their actionable range is far larger than the pocket.
3. playerGlow added after isolation probe showed the virion body is a dark gear that would read only by hurt-flash luck on the dark clearing; glow is 3-step soft disc (≤3 extra primitives), same density gate.
4. No donor code: searched prior MIT donor repo for a player-visibility mechanism; none exists; implementation original, documented in DONOR_PROVENANCE to satisfy the donor-method convention.
5. Measurement protocol extended (annulus 30-40px, core luminance) because ring 16-26px after the fix measures player's own cosmetics, not the surround — old metric alone would mislead.
6. Commit separation kept: B2 is one functional-visual commit; evidence/analyzer scripts stay outside the repo (workspace AUDIT dir), only the B2 code is committed.

## Previous snapshots
# Visual upgrade Phase B1 decisions — 19 October 2026

1. Donor for B1 = own PR #183 (commit 0e3269c), adapted by isolated port (`git show`), not merged — branch predates the 16.10 main convergence (#213–#217) and a merge would reintroduce superseded structure.
2. Scope cut from donor: documentation/CI files/video artifacts not ported (out of visual scope; fresh evidence generated instead); cardiac-hazard hit point left at donor default (donor itself passed no direction there).
3. Two donor defects fixed in adaptation: swapped Phaser renderer constants (CANVAS=1, WEBGL=2) and smoke waits assuming vfx.biologicalGhosts on builds where it doesn't exist (guards enable baseline evidence capture).
4. Commits separated by concern (atlas+tests / hit reaction / death collapse / test infra); `[skip render]` on the infra commit; local git identity Kimi <kimi@moonshot.local> in the worktree only.
5. Balance is off-limits: hit reaction and death collapse are visual-only; damage/HP/enemy counts untouched. Performance budget: any new in-loop VFX requires paired measurement (done: no regression).
6. Phase A mislabeled renderer is corrected in evidence docs rather than silently rewritten — own error stated explicitly.
7. No merge/push/deploy; production accessed read-only (GET). Next phases B2–B6 await owner decision; B2 recommended (measurements ready).

## Previous snapshots

## Общая сохранённая история исходного main

# Visual implementation completion — 16 October 2026

Branch visual/completion-20261016 extends verified public7a0d829 (PR216). Implemented distinct Player mutation geometry/combined composition, unified SocialHub and Codex, measured11px scrolling result report with pinned actions, pointer ownership and long-share fit, quieter pause. Existing gameplay/RNG/physics/score/network/assets/service settings are retained. Main integration is not authorized.

Read docs/release/VISUAL_COMPLETION_20261016.md. Root executed rich result/resumed/share/social/error/allCodex browser320/360/390; presentation and TypeScript passed. Independent source and native visual reviews resolved concrete issues and found no remaining P1/P2. Short live100-spawn AI/physics desktop before/after has p95~16.8ms in Canvas/WebGL, explicitly not device FPS. Final exact-head hosted CI/matrix, fresh backup and pinned deployment/readback are still pending; do not claim publication from this snapshot.

The implementation gaps from the earlier Phase1 ledger are addressed in this branch; old pending statements below are historical snapshots. Device MAX/TG/iOS, sustained performance/thermals, newcomer/full-campaign acceptance remain open. Preserve other PRs and private state backups. Companion documentation branch carries final evidence without changing the tested product SHA after publication.

## Previous snapshots
# Mutation art recovery decisions — 16 October 2026
Branch fix/mutation-art-recovery-20261016 starts from the verified live visual candidate44c6579 (PR214). Cold-start optional mutation requests can exceed Boot1800ms; fallback previously remained permanent. The scoped fix records canonical texture provenance and recovers only mutation-prism/halo/singularity after first render. Same256px CanvasTexture objects refresh in place; Player/physics/gameplay/assets remain unchanged. Two8000ms attempts/key,750ms backoff; per-game dedup and destruction cancellation. Five module contracts, full presentation and TypeScript passed. Read docs/release/MUTATION_ART_RECOVERY_20261016.md.

Local delayed-image Canvas/WebGL regression passed with sixteen paired actual Player frames and exact packaged pixels. Independent source review found no concrete P1/P2. Remaining before publication: final still-image review, exact-head hosted CI/matrix, fresh private backup and pinned Render Free publication/readback. Owner authorizes continuation/deployment; main merge remains prohibited. Keep PR213/214/215 and other parallel PRs separate. Physical-device/FPS/newcomer acceptance remains open. Update the release document after real results; do not treat this pending snapshot as proof of publication.

## Previous snapshots
# Phase1 presentation and verification decisions — 16 October 2026
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

# Telegram bot image follow-up decisions — 2026-10-13

Keep the runtime code change limited to the bot image's missing helper COPY
and its existing contract guard. Scope the guard to the bot stage and actual
COPY source/destination pairs so comments or later stages cannot mask omissions.
Do not import other sections of the old security patch: PR #197 supersedes them.

Close superseded PR #189 while preserving its branch and linking current memory.
Do not deploy this maintenance package. After final-head PR CI passes, use a
merge commit message with `[skip render]`, without skipping CI. Render documents
this phrase at https://render.com/docs/deploys#skipping-an-auto-deploy.
Do not infer live provider/trigger state from old notes or use the MCP connector
for the other workspace; authenticated production-account inspection remains
necessary. Verify any eventual automatic-trigger fix on the next runtime release.

# Verified review-fix release — 2026-10-13

Runtime source: c0c72fa81690b562e15c1d87580c66af842b3f3b (PR197 merged). Main CI38375891119: build/browser-smoke/production-contract success. Render Free deployment dep-db6vmg4s728c73cv4010 is live in production workspace tea-d8iruouq1p3s73f30a90 (timoshin.oleg@gmail.com). Canonical https://ofeliya.freeveol.dpdns.org/ofeliya/ reports this SHA. Metadata-only commits after this release do not change the published source identity.

Deploy only the exact successful main CI source; preserve old ticket/outbox contracts and platform-aware identities. Use /ready as the Render health probe. Pin manual recovery deploys after checking the queue to prevent duplicate instances/writer claims. Native phone gates remain external. Docs-only updates are ignored by Render and retain runtime source c0c72fa81690b562e15c1d87580c66af842b3f3b.

## Historical snapshots (current verified facts above take precedence)

# Current review fixes — 2026-10-13

Branch fix/kimi-review-20261013, based on main26fcc88. User approved the independent review follow-up plan. See docs/release/KIMI_REVIEW_FIXES_20261013.md for contracts, tests and mixed-version policy. Previous handoff is archived under memory/archive/2026-10-13-before-review-fixes/; older state/decisions/backlog remain as historical notes below.

Decisions: keep ruleset3/campaign2; old tickets immutable; old explicitv2 scores/grants/duels fail closed, ordinaryv2 checkpoints resumed/unranked; remote registry has one webhook owner and explicit durable ACK; public XFF trust defaults0; no paid services or production mutation during branch verification.

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

# Render cutover decisions - 2026-10-11

Use the account the owner signed into: tea-d8iruouq1p3s73f30a90. The old Render
preview is in another inaccessible workspace and is not production. Preserve
the canonical domain, bot identities, secrets and webhook paths through DNS.
Host the existing dedicated MAX SDK handlers without polling/subscription
changes, and proxy /ofeliya/api/* so relative game requests reach the API.
Keep Supabase remote persistence; Render's ephemeral files are not authoritative.
Enable Telegram outbound prepared sharing on Render after live verification.

Owner permits skipping final old-player data transfer. Existing67scores were
retained; no claim is made that all final Cloud.ru player changes were imported.
Retire only the dedicated OFELIYA Cloud.ru VM/disk/IP after new hosting checks.
Ignore only memory/**, PROJECT_IDENTITY.md and deploy/RENDER.md in Render build
filters; documentation updates do not redeploy gameplay. Future runtime changes
continue through main/checksPass. No keepalive or paid upgrade is introduced.

Supabase state access key was rotated in the existing Free project. The new
Render uses the replacement; the old key returns401 for read and writer claim,
so the inaccessible preview cannot steal production persistence. A 24-hour
management token was scoped only to this project and Edge Functions. No keys
are committed. Main CI38158081443 passed all three jobs for runtime d92325b.

## Historical notes

# DECISIONS — OFELIYA: STRAIN ZERO

Формат: `[дата] Решение — причина. Статус.`
Перенесённые решения помечены источником (документы репо). Новые решения добавляются сюда после каждой сессии.

- [2026-10-06] The control-mode smoke freezes only the Game instance update before startup and asserts UI unblocked/modal-free state before synthetic pointer routing — the original failure was a valid `uiBlocked` rejection during automatic mutation choices, not a TwinStick production defect. Production unchanged; reviewer approved; root owns CI follow-up.

- [2026-10-05] The deploy script loads its compatibility gate from fetched `origin/main` rather than a sibling path — the bastion executes an extracted standalone script from `/tmp`; keep helper policy centralized, fail closed on missing/empty policy, and retain all SHA/floor guards. Review/PR and fresh main CI pending.

- [2026-10-05] Deployment CI lookup uses the workflow-specific `ci.yml` runs endpoint filtered by exact SHA and run identity, with a pinned Ubuntu 22.04 runner and bounded diagnostic summaries — the prior broad runs query did not yield the independently verified exact-SHA green run; root cause remains unproven. Retain all fail-closed predicates. Review/publish pending.

- [2026-10-05] Deploy CI reads the Actions runs payload from a temporary file, not an environment variable — large responses exceed Linux argument/environment limits before Node starts; retain all five successful-main-CI identity criteria and fail closed. Implemented in `fix/deploy-ci-payload-20261005`; review/publish by root pending.

- [2026-09-20] Исторические спринт-документы — не источник истины; при конфликте правят `STRAIN_ZERO_PRODUCT_BIBLE.md` и `ARCHITECTURE_NOTES.md`. Причина: устаревшие планы создавали ложные требования. Действует. *(источник: PLAN.md)*
- [2026-09-20] Кампания двухактовая: КРОВОТОК → IMMUNE PRIME → СЕРДЦЕ → CARDIAC TITAN; старый концепт 3–5 минут не использовать. Действует. *(источник: PLAN.md)*
- [ранее] Renderer остаётся Phaser-only — без GSAP / Matter.js / tsParticles / второго рендера. Причина: мобильная производительность и предсказуемость. Действует. *(источник: ARCHITECTURE_NOTES.md)*
- [ранее] Codex/mastery — информационный прогресс, не даёт постоянной силы. Причина: мета не должна ломать баланс забегов. Действует. *(источник: RELEASE_VALIDATION.md)*
- [ранее] Профиль игрока V1 — отдельный `profiles.json`, advisory-only, без billing; запись синхронная (tmp+rename). Причина: rollback-safety при откатах. Действует. *(источник: ARCHITECTURE_NOTES.md)*
- [2026-09-28] [пилот] Память проекта = файлы репозитория (`memory/`), чат — не источник истины; протокол: вход 3 файла / выход 4 файла. Причина: устранить потери контекста между сессиями и инструментами. На проверке пилотом.
- [2026-09-28] Пилот на Honor признан рабочим: OmniRoute ↔ OpenCode ↔ context-mode ↔ скиллы проверены живыми прогонами; ветка приёмки синхронизируется с main и проходит канонический гейт до merge. Действует.
- [2026-09-29] Квик-вины доставлены в main (PR #137, merge `5b74f66`); `feat/donor-quick-wins` = main + система памяти (+269, 6 файлов) — регрессий кода в ветке нет (подтверждено двумя проходами ревью и smoke-прогонами). Действует.
- [2026-09-29] Ревью-проходы пилота выполняются на отдельном комбо `BACKGROUND-REVIEW`; смена модели внутри одной сессии OpenCode сохраняет контекст (проверено на тест-цикле B). Действует.
- [2026-09-29] Служебные локальные каталоги (`.agents/`, `.openclaw/`, `.opencode/`, `.cluster/`, `config/`, `handoff-system/`, `ofelia-pilot/`, `skills/`, `*.capability.json`) в коммиты не включать; кандидаты на `.gitignore` — отдельной задачей. Действует.
- [2026-09-29] Внешнее ревью прогона приёмки выполнено внешней моделью (`nvidia/nemotron-3-ultra`, OpenRouter) — полноценный внешний прогон; ChatGPT-вариант отложен по решению Олега. Результат — `memory/06_REVIEW.md`. Действует.
- [2026-09-29] Второе внешнее мнение (`space-bunny-free`) применено: пост-ревью правки памяти (PR #154) — актуализация ссылок/метрик, worktree переведён на `main`. Правило: числа и ссылки в памяти — только из git-вывода. Действует.
- [2026-10-02] P0 mobile acceptance считается пройденной только при 16/16 воспроизводимых evidence-записях Android/iOS (device, MAX client version, timestamp, evidence); browser/CI и устное «работает» не заменяют real-device gate. Действует.
- [2026-10-02] First-run onboarding обучает продуктовым механикам, а не служебной паузе: движение → автоогонь → RNA → мутация → заражение клетки-хозяина. Действует.
- [2026-10-02] Продуктовые решения измеряются по verified actor funnel `app_open → run_start → run_60s → boss1 → heart → replay`, D1 и referral open → run_start; share-click/views сами по себе не являются итоговой метрикой. Действует.

## Telegram deployment isolation 03.10
- Telegram is an optional dedicated production profile, not a replacement for or credential-sharing extension of the MAX bot.
- Any partial Telegram configuration fails deployment closed. MAX-only deployment remains valid with all Telegram values empty.
- Telegram bot and score server may share only the OFELIYA persistent data volume needed for referral/user state; bot identities/tokens remain separate.

## Versioned edge policy 03.10
- Production Caddy site/TLS wrapper may stay host-local, but OFELIYA route/security policy must be rendered from versioned deploy/Caddyfile.ofeliya on every release.
- Edge changes are validated before activation; reload failure restores the previous local dedicated file and fails the deployment.

## Telegram Bot API mode 04.10
- Cloud.ru production default is webhook, not long polling, because outbound Telegram API routing is not sufficiently reliable.
- Keep long polling as an explicit fallback mode only for hosts with verified outbound Telegram API connectivity.
- Never disable Telegram TLS verification. Webhook authenticity is independently protected by TG_WEBHOOK_SECRET.


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

## Legendary card wrapping at 320px (05.10)
- Allocate room by measured copy wrapping at the actual card width: allow 3 lines and a bounded taller panel only for compact Legendary effects that need line 3. Keep fixed card height, preserve the copy, and leave other cards at existing 2-line limits. Do not globally shrink UI typography to solve this edge case.

- Three-line panel uses center-y=21 to clear the Legendary footer at y=43; center-y=31 was rejected after review showed overlap. Focused probe fails on missing description/footer or any intersection.

## Compact Legendary card vertical budget (05.10)
- If compact Legendary effect text needs 3 lines, allocate space in the reward modal's card height (136px vs ordinary compact 124px) so the longer effect plate clears both description and footer. Keep the badge at y=6..48 relative to card, footer beginning at y=49; do not reduce type size or edit copy.
- Keep the Linux visual gate early in CI and emit measured effect/description/footer rectangles so remaining intersections are diagnosable.

## Viewport gate for compact Legendary expansion
- Increase compact Legendary card height only when the proposed entire stack clears the actual subtitle bounds plus the card gap and stays above the viewport bottom margin. This preserves the portrait 320x568 fix while denying expansion when the group cannot fit, including short landscape.

## Release workflow stamp guard (05.10)
- Every workflow that runs `npm run build` must pass an explicit 40-character `VITE_RELEASE_SHA`. `scripts/stamp-release.mjs` deliberately throws rather than stamping an ambiguous dev build, so a missing env is a build failure, not a silent fallback. The Release Visual Matrix workflow was the one remaining build step without it; it now uses `${{ github.sha }}`, matching the `ci.yml` build gate. Do not relax the stamp guard to make a workflow pass.

## Release documentation honesty (05.10)
- The documented `npm run` lists in `README.md` and `RELEASE_VALIDATION.md` are an explicitly labelled quick check subset, not the release gate. `.github/workflows/ci.yml` is the authoritative complete gate; on divergence `ci.yml` wins. Do not present a local short-list run as release validation.
- State plainly in the release docs that passing CI does not imply real MAX Android/iOS or Telegram acceptance: automated gates run against a mocked MAX bridge in a desktop browser and cannot produce native client behavior, real signed `initData`, real haptics/audio unlock, real restart lifecycles, real deployment values, or real network/thermal conditions.
- Document `npm run test:mobile-evidence -- PATH` with its 16 required check ids and the five required per-check fields, and separately list the manual requirements it does not cover. Keep the existing 16-point manual matrix unchanged and complete.
- Describe the validator by what it enforces, not by a total row count. It iterates only its own `required` array, so 16 is the mandatory minimum; extra `checks[]` rows are permitted and uninspected, and a `pass` does not certify them. `testedAt` is validated with `Date.parse`, so ISO 8601 is a readability recommendation rather than an enforced format. Never write "exactly 16" or "checks only these" for a validator with that shape.
- Real-device acceptance evidence lives outside the repository in external release-evidence storage; the repo records only the path or URL. Gitignore the single local convenience file `artifacts/mobile-acceptance.json` rather than the whole `artifacts/` directory, so no unrelated artifact is silently hidden or removed.

## Probe coverage contract: multi-card Legendary
- Keep actual trophy coverage tied to the production contract of two guaranteed Legendary choices. A three-Legendary fixture is explicitly synthetic stress coverage and must not be described as a reachable trophy offer.
- For every card, find its own effect, plate, description, and footer under that card's container. Do not reuse global text matches across cards; this can make duplicate footer labels hide per-card defects.
- The expanded-height assertion must follow the same geometry as production: proposed stack top below measured subtitle bottom plus gap, and stack bottom above viewport bottom margin. Also assert card-to-card separation and visible-text viewport bounds.
- Keep failures visible. Syntax/static checks do not establish browser layout correctness; root browser run and independent review remain required.

- First browser run for the expanded probe passed 87/88: all single and two-choice pair scenarios passed; only the synthetic three-card fixture at 320x480 overlapped the subtitle. Move that fixture to 320x520 so the compact stack can fit while the expanded proposal fails the lower viewport guard; rerun passed 88/88: 24 singles, 60 pairs, 3 synthetic-three scenarios, and 1 short-portrait guard. At 320x520 the guard retained 124px cards with a 9px subtitle gap and no overflow. Independent review and Linux CI are still pending. This was a fixture-boundary correction, not a production layout change or weakened assertion.

- The first Linux CI attempt failed before the probe ran: its fallback URL pointed to 127.0.0.1:5197 while CI serves Vite on 5173 (connection refused at work/multicard-linux-plain.log:190). Restore 5173 as the default and preserve OFELIYA_URL for local overrides. Classify this as probe/CI URL wiring, not a layout assertion failure; rerun Linux CI before claiming it passes.

- Linux run of the expanded browser probe passed 87/88 after fixing the fallback port. All 15 real definition pairs across every tested viewport, including 320x520, passed. The only failure was the synthetic three-choice short-height fixture: one 3-line effect met the intended 2-line cap on 124px compact cards. This is an unreachable synthetic content/layout combination (trophy contract is two choices), while the longer 3-card stress case remains at taller heights. Use only 2-line effects in the 320x520 guard to isolate height-fit logic; keep all 15 actual pairs there. No production UI change and no relaxed assertion. Rerun pending.

- Linux wrap measurements showed the previous 320x520 short guard still included a 3-line effect: definition index 3. The six measured counts are `[2,3,2,3,3,2]`. Use indices 0, 2, and 5 for this guard; index 5 is the last-life-saving Legendary. Base the selection on measured wrapping, not inferred string length. Keep all other scenarios/assertions unchanged; latest Linux status is 87/88 and rerun is pending.

## VO-01 decisions — 07.10.2026
- Diagnostics only, no overall DPR/framebuffer multiplier. Use existing DEV/release-matrix-QA gate and detached on-demand readback, never timers or history.
- Snapshot fixed Menu/Game/UI scope, bounded recursive visible Text sampling, numeric geometry/resolution only; no content/identity/user fields.
- Phaser Text style.resolution and TextureSource.resolution are independent observed facts. Production renderer tests use numeric renderer.type because constructor names are minified.
- Browser fixture freezes Game.update before start and pauses physics after ready to isolate logical camera mapping from collision shake. Production controls/gameplay stay untouched; existing multitouch suite is separate evidence.
- Kimi failed invocation is not a review. Coordinator owns frozen candidate review; no other workers, push, merge or deploy.

## VO01 fix1 decisions — 07.10.2026
- Diagnostic snapshot returns a stable empty scene record when a canonical key is missing. Focused test removes actual Phaser scenes, avoiding mocks.
- Ordinary production means PROD without VITE_RELEASE_MATRIX_QA=1; both literal hook string absence across JS chunks and behavioral opacity required. Existing build-time gate remains unchanged.
- Preserve pre-start update freeze based on validated control-smoke lifecycle; narrow dimensions/input evidence, no progression/performance claim. Destroy nested Text/container before later samples.
- Scene pause/resume plus already-visible handler dispatch only; no actual hidden transition acceptance. Intrinsic size expectations explicitly baseline-specific.
- Successful Kimi text-only review supersedes failed invocation artifact; coordinator owns final acceptance.


## VO02 combat decisions — 07.10.2026
- Use baked palette atlas frames instead of tint or TextureSource.resolution compensation: Phaser3.90 Canvas particles ignore tint/resolution. Preserve all gameplay art/source dimensions for Task5.
- Retain exactly four emitters; two death silhouettes split one existing VfxBudget grant rather than taking independent full requests. Nearest RGB palette preserves unlisted event colors approximately; known colors map exactly. Particle RNG remains Phaser cosmetic RNG, no gameplay RNG use.
- Retain a lazy circle pool full12/reduced6, reserves3/2 for important feedback. Preemption cancels prior tweens, resets circle geometry/style/transforms and guards late completion by generation. If all slots are important, newest important feedback replaces oldest. Gameplay warning geometry lives outside VfxSystem and is unaffected.
- Keep ordinary hit feedback local and globally throttled; surface spray and short contact ring improve legibility without camera shake. Do not alter hitStop/ImpactDirector policy.
- Focused tests execute production TS modules with rendering-boundary adapters and real EventEmitter3; they establish calls/policy/recipes, not pixel parity or real-phone performance. Root-owned browser and Kimi review are still required.


## VO02 Kimi fix1 coverage decisions — 07.10.2026
- Resolve reviewer test gaps with boundary tests, no speculative production rewrite. Existing sort `Number(false)-Number(true)` correctly puts ordinary entries before important; Q2 interpretation does not warrant changing it.
- Exercise a stale callback despite cancellation, then permit new ordinary traffic to prove replacement remains active through public allocation behavior. Assert current completion releases visibility normally.
- Tie fixture is literal RGB(242,246,244): hand-checked squared distances 237 to white/immune, all other palette distances > 10,000. Expect white as first declaration-order tie winner, with both spark/chip frames; no duplicate nearest-color loop in tests.
- Mutation verification modifies production source strings only in the temporary loader memory, never tracked source: wrong shedding, absent serial guard, <= tie update and disabled ordinary cap each fail the corresponding new case. Regression additions passed existing code; do not describe their mutation RED as preimplementation feature RED.


## VO03 organ atmosphere decisions — 07.10.2026
- Keep logical background256px geometry and existing keys. Bake periodic sine flow and0.5-slope Heart fibres; broad warm detail stays below gameplay without postFX. Leave actor, host shadow and combat atlas dimensions/recipes to their existing owners.
- Allocate all three RBC bands at construction (full8/4/2, reduced4/3/1). Proportional visible budget preserves at least one per available band; Heart uses ceil(runtimeBudget/2), subject to the same three-band floor, preventing quality/stage switches from removing near depth.
- Retain one pulse Rectangle behind gameplay. Clamp composite alpha<=.075 and decay by actual elapsed milliseconds, separate from movement's50ms clamp. Split elapsed time at pending190ms second beat to preserve overlay decay with large frame intervals; store only latest pending numeric schedule and cancel on stage/reset/shutdown.
- Separate the cosmetic Heart envelope from authoritative heartbeat logic: first exp(-phase*14), second absent beforephase.22 then .52*exp(-(phase-.22)*18). Do not alter real heartbeat, director or AI timers.
- Focused test adapters record Phaser/Canvas calls while production logic and real EventEmitter3 execute. Four in-memory source mutations verify gate/decay/band/cancellation coverage. Root browser screenshots/independent review remain separate evidence.


## VO04 mix and lifecycle decisions — 07.10.2026
- Place per-bed loudness correction on a dedicated retained gain, separate from .65 music bus duck automation. Route all buses through .8master and one configured compressor. Keep existing procedural stinger/heartbeat filter and direct bio path.
- Cache decoded SFX normalization at successful load; role gain is its only event coefficient, replacing legacy manifest vol. Invalid/nonfinite samples or silent/empty data use trim1; bounded boost max12. Existing fallback oscillators and event throttles retain their values.
- Store desired deterministic bed independently from decoded fallback index. Diagnostics return frozen snapshots of actual node values and lifecycle booleans; decoded actual index is null before success/after stop. Emit bounded generic decode errors instead of arbitrary environment error messages.
- Visibility owns suspension even before AudioContext exists; also check document.hidden because director binds its listener after bedStart and teardown calls setSuspended(false). Never resume/spawn while hidden; cache legitimate hidden decode for visible restart. Recheck visibility after asynchronous resume to prevent pending resume overriding hide.
- Call ctx.resume() inside the gesture callback stack; deduplicate its pending promise and rearm one listener per event after failure. Keep manual pause from suspending shared UI audio. Stop outstanding adaptive layer tones on run teardown while leaving SFX transient cleanup on ended.
- Focused WebAudio adapter must distinguish scheduled oscillator stop from immediate teardown; otherwise live-node lifecycle assertions are vacuous. Restart tests assert bio plus four live layer oscillators before explicit cleanup. Browser/sample/device acceptance remains coordinator-owned.


## VO05 core art recovery decisions — 07.10.2026
- Resume saved `fdacc92` rather than repeat asset generation or replace stable implementation. Keep canonical logical metrics and bounded4x backing explicit; do not use TextureSource.resolution to compensate sprite/body geometry.
- Extend coverage at Boot loader/canonical-key and create-sequencing boundaries; validate generated asset byte hashes against recorded provenance. XHR completion and Phaser body rounding require separate actual browser acceptance.
- Retain intentional untracked `.vo05-mutant.mjs` unchanged; its finite-timeout failure is coverage evidence, not a tracked feature or failing production gate. Coverage additions were green on existing implementation; no claim of new feature RED.
- Keep recovered changes scoped to Task5 tests/memory; no unnecessary source rewrite, package/CI wiring, browser operation or deployment. Coordinator owns root integration/scoped review and actual Phaser checks.


## VO05 stalled-art follow-up — 07.10.2026
- Root actual-browser regression exposed >6000ms stalled startup. Phaser3.90 Loader defaults maxRetries2; File.onError reloads twice, creating3x1800ms windows. Desktop parallel32; Android parallel6 can additionally batch seven assets.
- `9dc9650` sets optional-art retries0 while queueing (restores prior value in finally for unrelated future files) and Boot concurrency max(existing,7). Per-file1800ms timeout unchanged. Core art contract now16/16 includes retry capture/restore and Android6/desktop32 batching policy.
- With root-authorized browser follow-up, actual Chromium Canvas startup available1335ms/missing1102ms/stalled2501ms/Android-UA stalled2673ms, all unchanged6000ms gate. Stalled modes each requested exactly7distinct assets, no retries; Android config default6 and Boot loader7 explicitly confirmed. Private extended copy of root startup test remains untracked for coordinator import.
- Elite fixture now compares actual halfWidth/halfHeight to floor(sourceWorldRadiusX/Y), matching Phaser Body.setCircle/updateBounds; logical tolerance1.01, markers/signatures/centers unchanged. Actual elite script passed against own Vite server with only URL substituted in temporary copy. No physics production changes.
- Typecheck, core16/16, nonbrowser startup-renderer, viewport/tokens/impact-budget and whitespace passed after fix. No push/merge/deploy. Root still owns full geometry/controls/matrix/scoped review and external device gates.

## VO06 restrained framing decisions — 07.10.2026
- Reuse existing BORDER/PANEL/ROLE tokens without modifying frozen recipes. Specimen radius=min(82,H*.105) keeps circular decoration below title/copy; low-alpha warm plate and pink halo are behind hero, with fixed geometry and alpha-only animation.
- Add panel illumination as static noninteractive hairlines inside existing selector bounds; preserve every text/touch callback and launch-once guard.
- Draw highlights inside the retained XP/HP/boss Graphics (3px side inset,2px top inset,2px height), so existing hide/pulse/cinematic handling applies automatically. Leave fill/text updates immediate and geometry unchanged.
- No new implementation-mirroring test for cosmetic decoration. Existing non-browser contracts establish unrelated token/copy/math stability; root actual Phaser acceptance must assess visible layout, teardown and pixel quality.

## 2026-10-07: Recovery and acceptance decisions

Preserve saved implementations rather than restart. Disable optional-art retries only while queueing and restore prior policy. Freeze live progression in density-capture fixture, preserving Sprite.preUpdate/rendering and all assertions. Isolate font900ms gate from optional art; separate real artstartup6sec evidence. Keep general1xcanvas and compensated4xart; a fullHiDPI renderer is outside this contained presentation change.

## Hosted CI determinism decisions

Use real production tier override before test modules load, restoring global storage descriptor. Sample real production animation at shared1000ms, seed only creation cosmetics and restore Math.random. Prepare lazy group sprites idempotently; explicitly apply existing depthSort before exact ordered input snapshots. Require finite poses, retained windup telegraphs, before/after stability and same-tier renderer input equality; preserve raster thresholds. Scope lysis-radius spy to actual lysis rather than unrelated hit rings; assert complete108/150 array and original damage bounds. These are fixture corrections, not gameplay/rendering changes.

## 2026-10-08 presentation continuation rulings
Ruling: keep canonical art and bake only two6frame atlases at boot; equal source frame size/factor4 preserves physics. No gameplayRNG or new per-frame objects. Ruling: cap combo pulse by availableHPgutter and compact numbers; separate boss title/bar within unchangedplate and preserve input targets. Ruling: portable filesystem paths in testsource loaders, assertions unchanged. Ruling: HiDPI production default stays1x; followup QA-only proof until device/performance/context/offscreen evidence. Kimi route connectivity is separate from a successful review: use available authenticated direct fallback when OmniRoute timeout/empty response prevents review.

- [2026-10-08] Keep density2 explicit DEV/release-matrix-only, maximum2x/4Mpx and static/runtime1x fallback, pinned Phaser3.90 internals. Quadrupled framebuffer area requires device evidence before rollout; preserve logical input/camera/body geometry. No automatic production activation.

- [2026-10-08] Isolate Legendary ceremony from autonomous progression by freezing fixture Game.update, while preserving real UI/choice/Scene lifecycle. Keep Cardiac real updater and explicitly clear initial progression/UI. Do not claim the isolated ceremony tests resumed gameplay simulation; other gameplay contracts cover it.

## Cardiac clock isolation follow-up
PR182 initial head e1c058e CI37768249337 passed ceremony but failed Cardiac8s. Diagnostic-only14b6d3c CI37769887253 remains running. A local synthetic sparse RAF35ms plus explicit cooldown240 reproduced the timeout: Game active/notpaused/UI clear, boss phase2, stage2649 versus scene16936, nextTelegraph13575 already due, heartbeat3216 safeIndicator true; zero page errors. This demonstrates the mixed-clock scheduling mechanism, not the exact hosted runner conditions (default cooldown120).

Fixture now uses the real heartbeat.restore with nextImpact=stageTime+60000 and bossWasActive=true, with exact60000 setup assertion. Game.update, real Cardiac scheduler and canSchedule, original4700/850/280 source timing,8s/2s/1.5s browser deadlines, exact14damage and heartbeatClear remain. It intentionally does not validate live heartbeat concurrency; unchanged test:pacing separately tests1980/1981 boundary and exclusion. Native exactscript plus paired synthetic stressed fixture PASS; pacing PASS. Independent Codex source review PASS. Additional Kimi OmniRoute review returned empty content and is NOT approval. Await fresh PR/main CI before deploy.

## Hosted progression cause captured and pool reset
Diagnostic-only14b6d3c CI37769887253 failed with Game inactive/paused, UI modalOpen/uiBlocked, awaitingChoice true, stage149ms, bossactivephase2, hazard disabled/serial0 and no errors. This directly proves a new progression choice paused the updater; it does not identify the individual RNA drop. The only ordinary queued-level source is onGemCollected; stage transition was not occurring.

The fixture now uses production-standard deactivateForStageReset for existing bullets/RNA gems, resets host cells and excludes their update/rewards from this beam contract. It asserts zero active bullets/gems. Paired local inherited-RNA100 fixture: baselinef292dc7 paused atstage33ms/queued3/awaitingChoice and failed8s; corrected fixture PASS. Exact corrected script alsoPASS. Thus no onGemCollected/Game.update/hazard method is stubbed, no assertion or timeout is loosened. Host-cell/RNA integration is outside this scoped beam test; other unchanged gameplay/browser suites cover it. Mixed-clock synthetic finding remains separately documented and was not the captured hosted cause.

## Dense readability fixture lifecycle recovery
Final6c84b89 CI37771605821 passed Legendary, Cardiac and controls, then dense-readability failed target150/cache150 with allalpha1. Enemy preUpdate reads prior density; Game.update refreshes cache afterward. Original fixed150ms sleep need not contain both real frames.

Density fixture now waits two actual Scene POST_UPDATE frames with cache>=target, bounded1500ms, before unchanged150/200targets/alpha assertions. This replaces a synchronization assumption, NOT an unchanged performance/timing gate. No manual Game/Enemy update or cache writes. Startup accepts an already-paused real Game, resumes then clears progression/UI; new unblocked assertion added. Exact native finalscript PASS; original native Game.active-only wait had stopped at startup30s. Paired sparseRAF240ms with shared corrected startup: old150ms sleep failed cache100/target150/allalpha1; completed-frame wait PASS. This demonstrates synchronization sensitivity, not the exact hosted scheduling. Independent Codex source review PASS. Additional Kimi nonstream diagnostic HTTP504; no routed approval.
# 2026-10-11 Free hosting persistence

Use Render Free for one HTTP process and existing free Supabase for a private JSON
snapshot. Do not place authoritative state only on Render's ephemeral filesystem
or on Render Free Postgres (30dayexpiry). Restore before listening; acknowledge
mutations only after durable commit; fence old deploys with a writer generation.
BotKeep creation returned503NoAvailability despite expanded key permissions.


## 2026-10-11 cutover completeness
User permits skipping old player-data migration. Preserve the canonical origin
and deploy both Telegram and dedicated MAX handlers before old hosting retirement.
Preview hosting startup must never modify MAX subscriptions or begin polling.
Keep unrelated Cloud.ru workloads separate from OFELIYA retirement.

## Исторические добавления Daily #221 (после общего блока)


## Исторические добавления B2/B4 #222 (после общего блока)

# B2/B4 integration decisions — 20 October 2026

1. Reused PR #210's `MotionPreferences` cached media query policy in `src/systems/`; it is live-updating and avoids allocating/checking matchMedia each frame.
2. Reduced-motion only removes decorative camera and boss identity motion. Boss phase colors, HUD phase ticks, attack warning timing/shape, and Danger Echo remain available/actionable.
3. Applied review's CI gate patch; extended existing B2/B4 gate with reduced-motion regression instead of creating a parallel command.
4. Root owns browser/pixel adaptation in `scripts/biological-impact-smoke.cjs`; no edits by this worker. No commit until root review.

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
# Mutation art recovery decisions — 16 October 2026
Branch fix/mutation-art-recovery-20261016 starts from the verified live visual candidate44c6579 (PR214). Cold-start optional mutation requests can exceed Boot1800ms; fallback previously remained permanent. The scoped fix records canonical texture provenance and recovers only mutation-prism/halo/singularity after first render. Same256px CanvasTexture objects refresh in place; Player/physics/gameplay/assets remain unchanged. Two8000ms attempts/key,750ms backoff; per-game dedup and destruction cancellation. Five module contracts, full presentation and TypeScript passed. Read docs/release/MUTATION_ART_RECOVERY_20261016.md.

Local delayed-image Canvas/WebGL regression passed with sixteen paired actual Player frames and exact packaged pixels. Independent source review found no concrete P1/P2. Remaining before publication: final still-image review, exact-head hosted CI/matrix, fresh private backup and pinned Render Free publication/readback. Owner authorizes continuation/deployment; main merge remains prohibited. Keep PR213/214/215 and other parallel PRs separate. Physical-device/FPS/newcomer acceptance remains open. Update the release document after real results; do not treat this pending snapshot as proof of publication.

## Previous snapshots
# Phase1 presentation and verification decisions — 16 October 2026
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

# Telegram bot image follow-up decisions — 2026-10-13

Keep the runtime code change limited to the bot image's missing helper COPY
and its existing contract guard. Scope the guard to the bot stage and actual
COPY source/destination pairs so comments or later stages cannot mask omissions.
Do not import other sections of the old security patch: PR #197 supersedes them.

Close superseded PR #189 while preserving its branch and linking current memory.
Do not deploy this maintenance package. After final-head PR CI passes, use a
merge commit message with `[skip render]`, without skipping CI. Render documents
this phrase at https://render.com/docs/deploys#skipping-an-auto-deploy.
Do not infer live provider/trigger state from old notes or use the MCP connector
for the other workspace; authenticated production-account inspection remains
necessary. Verify any eventual automatic-trigger fix on the next runtime release.

# Verified review-fix release — 2026-10-13

Runtime source: c0c72fa81690b562e15c1d87580c66af842b3f3b (PR197 merged). Main CI38375891119: build/browser-smoke/production-contract success. Render Free deployment dep-db6vmg4s728c73cv4010 is live in production workspace tea-d8iruouq1p3s73f30a90 (timoshin.oleg@gmail.com). Canonical https://ofeliya.freeveol.dpdns.org/ofeliya/ reports this SHA. Metadata-only commits after this release do not change the published source identity.

Deploy only the exact successful main CI source; preserve old ticket/outbox contracts and platform-aware identities. Use /ready as the Render health probe. Pin manual recovery deploys after checking the queue to prevent duplicate instances/writer claims. Native phone gates remain external. Docs-only updates are ignored by Render and retain runtime source c0c72fa81690b562e15c1d87580c66af842b3f3b.

## Historical snapshots (current verified facts above take precedence)

# Current review fixes — 2026-10-13

Branch fix/kimi-review-20261013, based on main26fcc88. User approved the independent review follow-up plan. See docs/release/KIMI_REVIEW_FIXES_20261013.md for contracts, tests and mixed-version policy. Previous handoff is archived under memory/archive/2026-10-13-before-review-fixes/; older state/decisions/backlog remain as historical notes below.

Decisions: keep ruleset3/campaign2; old tickets immutable; old explicitv2 scores/grants/duels fail closed, ordinaryv2 checkpoints resumed/unranked; remote registry has one webhook owner and explicit durable ACK; public XFF trust defaults0; no paid services or production mutation during branch verification.

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

# Render cutover decisions - 2026-10-11

Use the account the owner signed into: tea-d8iruouq1p3s73f30a90. The old Render
preview is in another inaccessible workspace and is not production. Preserve
the canonical domain, bot identities, secrets and webhook paths through DNS.
Host the existing dedicated MAX SDK handlers without polling/subscription
changes, and proxy /ofeliya/api/* so relative game requests reach the API.
Keep Supabase remote persistence; Render's ephemeral files are not authoritative.
Enable Telegram outbound prepared sharing on Render after live verification.

Owner permits skipping final old-player data transfer. Existing67scores were
retained; no claim is made that all final Cloud.ru player changes were imported.
Retire only the dedicated OFELIYA Cloud.ru VM/disk/IP after new hosting checks.
Ignore only memory/**, PROJECT_IDENTITY.md and deploy/RENDER.md in Render build
filters; documentation updates do not redeploy gameplay. Future runtime changes
continue through main/checksPass. No keepalive or paid upgrade is introduced.

Supabase state access key was rotated in the existing Free project. The new
Render uses the replacement; the old key returns401 for read and writer claim,
so the inaccessible preview cannot steal production persistence. A 24-hour
management token was scoped only to this project and Edge Functions. No keys
are committed. Main CI38158081443 passed all three jobs for runtime d92325b.

## Historical notes

# DECISIONS — OFELIYA: STRAIN ZERO

Формат: `[дата] Решение — причина. Статус.`
Перенесённые решения помечены источником (документы репо). Новые решения добавляются сюда после каждой сессии.

- [2026-10-06] The control-mode smoke freezes only the Game instance update before startup and asserts UI unblocked/modal-free state before synthetic pointer routing — the original failure was a valid `uiBlocked` rejection during automatic mutation choices, not a TwinStick production defect. Production unchanged; reviewer approved; root owns CI follow-up.

- [2026-10-05] The deploy script loads its compatibility gate from fetched `origin/main` rather than a sibling path — the bastion executes an extracted standalone script from `/tmp`; keep helper policy centralized, fail closed on missing/empty policy, and retain all SHA/floor guards. Review/PR and fresh main CI pending.

- [2026-10-05] Deployment CI lookup uses the workflow-specific `ci.yml` runs endpoint filtered by exact SHA and run identity, with a pinned Ubuntu 22.04 runner and bounded diagnostic summaries — the prior broad runs query did not yield the independently verified exact-SHA green run; root cause remains unproven. Retain all fail-closed predicates. Review/publish pending.

- [2026-10-05] Deploy CI reads the Actions runs payload from a temporary file, not an environment variable — large responses exceed Linux argument/environment limits before Node starts; retain all five successful-main-CI identity criteria and fail closed. Implemented in `fix/deploy-ci-payload-20261005`; review/publish by root pending.

- [2026-09-20] Исторические спринт-документы — не источник истины; при конфликте правят `STRAIN_ZERO_PRODUCT_BIBLE.md` и `ARCHITECTURE_NOTES.md`. Причина: устаревшие планы создавали ложные требования. Действует. *(источник: PLAN.md)*
- [2026-09-20] Кампания двухактовая: КРОВОТОК → IMMUNE PRIME → СЕРДЦЕ → CARDIAC TITAN; старый концепт 3–5 минут не использовать. Действует. *(источник: PLAN.md)*
- [ранее] Renderer остаётся Phaser-only — без GSAP / Matter.js / tsParticles / второго рендера. Причина: мобильная производительность и предсказуемость. Действует. *(источник: ARCHITECTURE_NOTES.md)*
- [ранее] Codex/mastery — информационный прогресс, не даёт постоянной силы. Причина: мета не должна ломать баланс забегов. Действует. *(источник: RELEASE_VALIDATION.md)*
- [ранее] Профиль игрока V1 — отдельный `profiles.json`, advisory-only, без billing; запись синхронная (tmp+rename). Причина: rollback-safety при откатах. Действует. *(источник: ARCHITECTURE_NOTES.md)*
- [2026-09-28] [пилот] Память проекта = файлы репозитория (`memory/`), чат — не источник истины; протокол: вход 3 файла / выход 4 файла. Причина: устранить потери контекста между сессиями и инструментами. На проверке пилотом.
- [2026-09-28] Пилот на Honor признан рабочим: OmniRoute ↔ OpenCode ↔ context-mode ↔ скиллы проверены живыми прогонами; ветка приёмки синхронизируется с main и проходит канонический гейт до merge. Действует.
- [2026-09-29] Квик-вины доставлены в main (PR #137, merge `5b74f66`); `feat/donor-quick-wins` = main + система памяти (+269, 6 файлов) — регрессий кода в ветке нет (подтверждено двумя проходами ревью и smoke-прогонами). Действует.
- [2026-09-29] Ревью-проходы пилота выполняются на отдельном комбо `BACKGROUND-REVIEW`; смена модели внутри одной сессии OpenCode сохраняет контекст (проверено на тест-цикле B). Действует.
- [2026-09-29] Служебные локальные каталоги (`.agents/`, `.openclaw/`, `.opencode/`, `.cluster/`, `config/`, `handoff-system/`, `ofelia-pilot/`, `skills/`, `*.capability.json`) в коммиты не включать; кандидаты на `.gitignore` — отдельной задачей. Действует.
- [2026-09-29] Внешнее ревью прогона приёмки выполнено внешней моделью (`nvidia/nemotron-3-ultra`, OpenRouter) — полноценный внешний прогон; ChatGPT-вариант отложен по решению Олега. Результат — `memory/06_REVIEW.md`. Действует.
- [2026-09-29] Второе внешнее мнение (`space-bunny-free`) применено: пост-ревью правки памяти (PR #154) — актуализация ссылок/метрик, worktree переведён на `main`. Правило: числа и ссылки в памяти — только из git-вывода. Действует.
- [2026-10-02] P0 mobile acceptance считается пройденной только при 16/16 воспроизводимых evidence-записях Android/iOS (device, MAX client version, timestamp, evidence); browser/CI и устное «работает» не заменяют real-device gate. Действует.
- [2026-10-02] First-run onboarding обучает продуктовым механикам, а не служебной паузе: движение → автоогонь → RNA → мутация → заражение клетки-хозяина. Действует.
- [2026-10-02] Продуктовые решения измеряются по verified actor funnel `app_open → run_start → run_60s → boss1 → heart → replay`, D1 и referral open → run_start; share-click/views сами по себе не являются итоговой метрикой. Действует.

## Telegram deployment isolation 03.10
- Telegram is an optional dedicated production profile, not a replacement for or credential-sharing extension of the MAX bot.
- Any partial Telegram configuration fails deployment closed. MAX-only deployment remains valid with all Telegram values empty.
- Telegram bot and score server may share only the OFELIYA persistent data volume needed for referral/user state; bot identities/tokens remain separate.

## Versioned edge policy 03.10
- Production Caddy site/TLS wrapper may stay host-local, but OFELIYA route/security policy must be rendered from versioned deploy/Caddyfile.ofeliya on every release.
- Edge changes are validated before activation; reload failure restores the previous local dedicated file and fails the deployment.

## Telegram Bot API mode 04.10
- Cloud.ru production default is webhook, not long polling, because outbound Telegram API routing is not sufficiently reliable.
- Keep long polling as an explicit fallback mode only for hosts with verified outbound Telegram API connectivity.
- Never disable Telegram TLS verification. Webhook authenticity is independently protected by TG_WEBHOOK_SECRET.


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

## Legendary card wrapping at 320px (05.10)
- Allocate room by measured copy wrapping at the actual card width: allow 3 lines and a bounded taller panel only for compact Legendary effects that need line 3. Keep fixed card height, preserve the copy, and leave other cards at existing 2-line limits. Do not globally shrink UI typography to solve this edge case.

- Three-line panel uses center-y=21 to clear the Legendary footer at y=43; center-y=31 was rejected after review showed overlap. Focused probe fails on missing description/footer or any intersection.

## Compact Legendary card vertical budget (05.10)
- If compact Legendary effect text needs 3 lines, allocate space in the reward modal's card height (136px vs ordinary compact 124px) so the longer effect plate clears both description and footer. Keep the badge at y=6..48 relative to card, footer beginning at y=49; do not reduce type size or edit copy.
- Keep the Linux visual gate early in CI and emit measured effect/description/footer rectangles so remaining intersections are diagnosable.

## Viewport gate for compact Legendary expansion
- Increase compact Legendary card height only when the proposed entire stack clears the actual subtitle bounds plus the card gap and stays above the viewport bottom margin. This preserves the portrait 320x568 fix while denying expansion when the group cannot fit, including short landscape.

## Release workflow stamp guard (05.10)
- Every workflow that runs `npm run build` must pass an explicit 40-character `VITE_RELEASE_SHA`. `scripts/stamp-release.mjs` deliberately throws rather than stamping an ambiguous dev build, so a missing env is a build failure, not a silent fallback. The Release Visual Matrix workflow was the one remaining build step without it; it now uses `${{ github.sha }}`, matching the `ci.yml` build gate. Do not relax the stamp guard to make a workflow pass.

## Release documentation honesty (05.10)
- The documented `npm run` lists in `README.md` and `RELEASE_VALIDATION.md` are an explicitly labelled quick check subset, not the release gate. `.github/workflows/ci.yml` is the authoritative complete gate; on divergence `ci.yml` wins. Do not present a local short-list run as release validation.
- State plainly in the release docs that passing CI does not imply real MAX Android/iOS or Telegram acceptance: automated gates run against a mocked MAX bridge in a desktop browser and cannot produce native client behavior, real signed `initData`, real haptics/audio unlock, real restart lifecycles, real deployment values, or real network/thermal conditions.
- Document `npm run test:mobile-evidence -- PATH` with its 16 required check ids and the five required per-check fields, and separately list the manual requirements it does not cover. Keep the existing 16-point manual matrix unchanged and complete.
- Describe the validator by what it enforces, not by a total row count. It iterates only its own `required` array, so 16 is the mandatory minimum; extra `checks[]` rows are permitted and uninspected, and a `pass` does not certify them. `testedAt` is validated with `Date.parse`, so ISO 8601 is a readability recommendation rather than an enforced format. Never write "exactly 16" or "checks only these" for a validator with that shape.
- Real-device acceptance evidence lives outside the repository in external release-evidence storage; the repo records only the path or URL. Gitignore the single local convenience file `artifacts/mobile-acceptance.json` rather than the whole `artifacts/` directory, so no unrelated artifact is silently hidden or removed.

## Probe coverage contract: multi-card Legendary
- Keep actual trophy coverage tied to the production contract of two guaranteed Legendary choices. A three-Legendary fixture is explicitly synthetic stress coverage and must not be described as a reachable trophy offer.
- For every card, find its own effect, plate, description, and footer under that card's container. Do not reuse global text matches across cards; this can make duplicate footer labels hide per-card defects.
- The expanded-height assertion must follow the same geometry as production: proposed stack top below measured subtitle bottom plus gap, and stack bottom above viewport bottom margin. Also assert card-to-card separation and visible-text viewport bounds.
- Keep failures visible. Syntax/static checks do not establish browser layout correctness; root browser run and independent review remain required.

- First browser run for the expanded probe passed 87/88: all single and two-choice pair scenarios passed; only the synthetic three-card fixture at 320x480 overlapped the subtitle. Move that fixture to 320x520 so the compact stack can fit while the expanded proposal fails the lower viewport guard; rerun passed 88/88: 24 singles, 60 pairs, 3 synthetic-three scenarios, and 1 short-portrait guard. At 320x520 the guard retained 124px cards with a 9px subtitle gap and no overflow. Independent review and Linux CI are still pending. This was a fixture-boundary correction, not a production layout change or weakened assertion.

- The first Linux CI attempt failed before the probe ran: its fallback URL pointed to 127.0.0.1:5197 while CI serves Vite on 5173 (connection refused at work/multicard-linux-plain.log:190). Restore 5173 as the default and preserve OFELIYA_URL for local overrides. Classify this as probe/CI URL wiring, not a layout assertion failure; rerun Linux CI before claiming it passes.

- Linux run of the expanded browser probe passed 87/88 after fixing the fallback port. All 15 real definition pairs across every tested viewport, including 320x520, passed. The only failure was the synthetic three-choice short-height fixture: one 3-line effect met the intended 2-line cap on 124px compact cards. This is an unreachable synthetic content/layout combination (trophy contract is two choices), while the longer 3-card stress case remains at taller heights. Use only 2-line effects in the 320x520 guard to isolate height-fit logic; keep all 15 actual pairs there. No production UI change and no relaxed assertion. Rerun pending.

- Linux wrap measurements showed the previous 320x520 short guard still included a 3-line effect: definition index 3. The six measured counts are `[2,3,2,3,3,2]`. Use indices 0, 2, and 5 for this guard; index 5 is the last-life-saving Legendary. Base the selection on measured wrapping, not inferred string length. Keep all other scenarios/assertions unchanged; latest Linux status is 87/88 and rerun is pending.

## VO-01 decisions — 07.10.2026
- Diagnostics only, no overall DPR/framebuffer multiplier. Use existing DEV/release-matrix-QA gate and detached on-demand readback, never timers or history.
- Snapshot fixed Menu/Game/UI scope, bounded recursive visible Text sampling, numeric geometry/resolution only; no content/identity/user fields.
- Phaser Text style.resolution and TextureSource.resolution are independent observed facts. Production renderer tests use numeric renderer.type because constructor names are minified.
- Browser fixture freezes Game.update before start and pauses physics after ready to isolate logical camera mapping from collision shake. Production controls/gameplay stay untouched; existing multitouch suite is separate evidence.
- Kimi failed invocation is not a review. Coordinator owns frozen candidate review; no other workers, push, merge or deploy.

## VO01 fix1 decisions — 07.10.2026
- Diagnostic snapshot returns a stable empty scene record when a canonical key is missing. Focused test removes actual Phaser scenes, avoiding mocks.
- Ordinary production means PROD without VITE_RELEASE_MATRIX_QA=1; both literal hook string absence across JS chunks and behavioral opacity required. Existing build-time gate remains unchanged.
- Preserve pre-start update freeze based on validated control-smoke lifecycle; narrow dimensions/input evidence, no progression/performance claim. Destroy nested Text/container before later samples.
- Scene pause/resume plus already-visible handler dispatch only; no actual hidden transition acceptance. Intrinsic size expectations explicitly baseline-specific.
- Successful Kimi text-only review supersedes failed invocation artifact; coordinator owns final acceptance.


## VO02 combat decisions — 07.10.2026
- Use baked palette atlas frames instead of tint or TextureSource.resolution compensation: Phaser3.90 Canvas particles ignore tint/resolution. Preserve all gameplay art/source dimensions for Task5.
- Retain exactly four emitters; two death silhouettes split one existing VfxBudget grant rather than taking independent full requests. Nearest RGB palette preserves unlisted event colors approximately; known colors map exactly. Particle RNG remains Phaser cosmetic RNG, no gameplay RNG use.
- Retain a lazy circle pool full12/reduced6, reserves3/2 for important feedback. Preemption cancels prior tweens, resets circle geometry/style/transforms and guards late completion by generation. If all slots are important, newest important feedback replaces oldest. Gameplay warning geometry lives outside VfxSystem and is unaffected.
- Keep ordinary hit feedback local and globally throttled; surface spray and short contact ring improve legibility without camera shake. Do not alter hitStop/ImpactDirector policy.
- Focused tests execute production TS modules with rendering-boundary adapters and real EventEmitter3; they establish calls/policy/recipes, not pixel parity or real-phone performance. Root-owned browser and Kimi review are still required.


## VO02 Kimi fix1 coverage decisions — 07.10.2026
- Resolve reviewer test gaps with boundary tests, no speculative production rewrite. Existing sort `Number(false)-Number(true)` correctly puts ordinary entries before important; Q2 interpretation does not warrant changing it.
- Exercise a stale callback despite cancellation, then permit new ordinary traffic to prove replacement remains active through public allocation behavior. Assert current completion releases visibility normally.
- Tie fixture is literal RGB(242,246,244): hand-checked squared distances 237 to white/immune, all other palette distances > 10,000. Expect white as first declaration-order tie winner, with both spark/chip frames; no duplicate nearest-color loop in tests.
- Mutation verification modifies production source strings only in the temporary loader memory, never tracked source: wrong shedding, absent serial guard, <= tie update and disabled ordinary cap each fail the corresponding new case. Regression additions passed existing code; do not describe their mutation RED as preimplementation feature RED.


## VO03 organ atmosphere decisions — 07.10.2026
- Keep logical background256px geometry and existing keys. Bake periodic sine flow and0.5-slope Heart fibres; broad warm detail stays below gameplay without postFX. Leave actor, host shadow and combat atlas dimensions/recipes to their existing owners.
- Allocate all three RBC bands at construction (full8/4/2, reduced4/3/1). Proportional visible budget preserves at least one per available band; Heart uses ceil(runtimeBudget/2), subject to the same three-band floor, preventing quality/stage switches from removing near depth.
- Retain one pulse Rectangle behind gameplay. Clamp composite alpha<=.075 and decay by actual elapsed milliseconds, separate from movement's50ms clamp. Split elapsed time at pending190ms second beat to preserve overlay decay with large frame intervals; store only latest pending numeric schedule and cancel on stage/reset/shutdown.
- Separate the cosmetic Heart envelope from authoritative heartbeat logic: first exp(-phase*14), second absent beforephase.22 then .52*exp(-(phase-.22)*18). Do not alter real heartbeat, director or AI timers.
- Focused test adapters record Phaser/Canvas calls while production logic and real EventEmitter3 execute. Four in-memory source mutations verify gate/decay/band/cancellation coverage. Root browser screenshots/independent review remain separate evidence.


## VO04 mix and lifecycle decisions — 07.10.2026
- Place per-bed loudness correction on a dedicated retained gain, separate from .65 music bus duck automation. Route all buses through .8master and one configured compressor. Keep existing procedural stinger/heartbeat filter and direct bio path.
- Cache decoded SFX normalization at successful load; role gain is its only event coefficient, replacing legacy manifest vol. Invalid/nonfinite samples or silent/empty data use trim1; bounded boost max12. Existing fallback oscillators and event throttles retain their values.
- Store desired deterministic bed independently from decoded fallback index. Diagnostics return frozen snapshots of actual node values and lifecycle booleans; decoded actual index is null before success/after stop. Emit bounded generic decode errors instead of arbitrary environment error messages.
- Visibility owns suspension even before AudioContext exists; also check document.hidden because director binds its listener after bedStart and teardown calls setSuspended(false). Never resume/spawn while hidden; cache legitimate hidden decode for visible restart. Recheck visibility after asynchronous resume to prevent pending resume overriding hide.
- Call ctx.resume() inside the gesture callback stack; deduplicate its pending promise and rearm one listener per event after failure. Keep manual pause from suspending shared UI audio. Stop outstanding adaptive layer tones on run teardown while leaving SFX transient cleanup on ended.
- Focused WebAudio adapter must distinguish scheduled oscillator stop from immediate teardown; otherwise live-node lifecycle assertions are vacuous. Restart tests assert bio plus four live layer oscillators before explicit cleanup. Browser/sample/device acceptance remains coordinator-owned.


## VO05 core art recovery decisions — 07.10.2026
- Resume saved `fdacc92` rather than repeat asset generation or replace stable implementation. Keep canonical logical metrics and bounded4x backing explicit; do not use TextureSource.resolution to compensate sprite/body geometry.
- Extend coverage at Boot loader/canonical-key and create-sequencing boundaries; validate generated asset byte hashes against recorded provenance. XHR completion and Phaser body rounding require separate actual browser acceptance.
- Retain intentional untracked `.vo05-mutant.mjs` unchanged; its finite-timeout failure is coverage evidence, not a tracked feature or failing production gate. Coverage additions were green on existing implementation; no claim of new feature RED.
- Keep recovered changes scoped to Task5 tests/memory; no unnecessary source rewrite, package/CI wiring, browser operation or deployment. Coordinator owns root integration/scoped review and actual Phaser checks.


## VO05 stalled-art follow-up — 07.10.2026
- Root actual-browser regression exposed >6000ms stalled startup. Phaser3.90 Loader defaults maxRetries2; File.onError reloads twice, creating3x1800ms windows. Desktop parallel32; Android parallel6 can additionally batch seven assets.
- `9dc9650` sets optional-art retries0 while queueing (restores prior value in finally for unrelated future files) and Boot concurrency max(existing,7). Per-file1800ms timeout unchanged. Core art contract now16/16 includes retry capture/restore and Android6/desktop32 batching policy.
- With root-authorized browser follow-up, actual Chromium Canvas startup available1335ms/missing1102ms/stalled2501ms/Android-UA stalled2673ms, all unchanged6000ms gate. Stalled modes each requested exactly7distinct assets, no retries; Android config default6 and Boot loader7 explicitly confirmed. Private extended copy of root startup test remains untracked for coordinator import.
- Elite fixture now compares actual halfWidth/halfHeight to floor(sourceWorldRadiusX/Y), matching Phaser Body.setCircle/updateBounds; logical tolerance1.01, markers/signatures/centers unchanged. Actual elite script passed against own Vite server with only URL substituted in temporary copy. No physics production changes.
- Typecheck, core16/16, nonbrowser startup-renderer, viewport/tokens/impact-budget and whitespace passed after fix. No push/merge/deploy. Root still owns full geometry/controls/matrix/scoped review and external device gates.

## VO06 restrained framing decisions — 07.10.2026
- Reuse existing BORDER/PANEL/ROLE tokens without modifying frozen recipes. Specimen radius=min(82,H*.105) keeps circular decoration below title/copy; low-alpha warm plate and pink halo are behind hero, with fixed geometry and alpha-only animation.
- Add panel illumination as static noninteractive hairlines inside existing selector bounds; preserve every text/touch callback and launch-once guard.
- Draw highlights inside the retained XP/HP/boss Graphics (3px side inset,2px top inset,2px height), so existing hide/pulse/cinematic handling applies automatically. Leave fill/text updates immediate and geometry unchanged.
- No new implementation-mirroring test for cosmetic decoration. Existing non-browser contracts establish unrelated token/copy/math stability; root actual Phaser acceptance must assess visible layout, teardown and pixel quality.

## 2026-10-07: Recovery and acceptance decisions

Preserve saved implementations rather than restart. Disable optional-art retries only while queueing and restore prior policy. Freeze live progression in density-capture fixture, preserving Sprite.preUpdate/rendering and all assertions. Isolate font900ms gate from optional art; separate real artstartup6sec evidence. Keep general1xcanvas and compensated4xart; a fullHiDPI renderer is outside this contained presentation change.

## Hosted CI determinism decisions

Use real production tier override before test modules load, restoring global storage descriptor. Sample real production animation at shared1000ms, seed only creation cosmetics and restore Math.random. Prepare lazy group sprites idempotently; explicitly apply existing depthSort before exact ordered input snapshots. Require finite poses, retained windup telegraphs, before/after stability and same-tier renderer input equality; preserve raster thresholds. Scope lysis-radius spy to actual lysis rather than unrelated hit rings; assert complete108/150 array and original damage bounds. These are fixture corrections, not gameplay/rendering changes.

## 2026-10-08 presentation continuation rulings
Ruling: keep canonical art and bake only two6frame atlases at boot; equal source frame size/factor4 preserves physics. No gameplayRNG or new per-frame objects. Ruling: cap combo pulse by availableHPgutter and compact numbers; separate boss title/bar within unchangedplate and preserve input targets. Ruling: portable filesystem paths in testsource loaders, assertions unchanged. Ruling: HiDPI production default stays1x; followup QA-only proof until device/performance/context/offscreen evidence. Kimi route connectivity is separate from a successful review: use available authenticated direct fallback when OmniRoute timeout/empty response prevents review.

- [2026-10-08] Keep density2 explicit DEV/release-matrix-only, maximum2x/4Mpx and static/runtime1x fallback, pinned Phaser3.90 internals. Quadrupled framebuffer area requires device evidence before rollout; preserve logical input/camera/body geometry. No automatic production activation.

- [2026-10-08] Isolate Legendary ceremony from autonomous progression by freezing fixture Game.update, while preserving real UI/choice/Scene lifecycle. Keep Cardiac real updater and explicitly clear initial progression/UI. Do not claim the isolated ceremony tests resumed gameplay simulation; other gameplay contracts cover it.

## Cardiac clock isolation follow-up
PR182 initial head e1c058e CI37768249337 passed ceremony but failed Cardiac8s. Diagnostic-only14b6d3c CI37769887253 remains running. A local synthetic sparse RAF35ms plus explicit cooldown240 reproduced the timeout: Game active/notpaused/UI clear, boss phase2, stage2649 versus scene16936, nextTelegraph13575 already due, heartbeat3216 safeIndicator true; zero page errors. This demonstrates the mixed-clock scheduling mechanism, not the exact hosted runner conditions (default cooldown120).

Fixture now uses the real heartbeat.restore with nextImpact=stageTime+60000 and bossWasActive=true, with exact60000 setup assertion. Game.update, real Cardiac scheduler and canSchedule, original4700/850/280 source timing,8s/2s/1.5s browser deadlines, exact14damage and heartbeatClear remain. It intentionally does not validate live heartbeat concurrency; unchanged test:pacing separately tests1980/1981 boundary and exclusion. Native exactscript plus paired synthetic stressed fixture PASS; pacing PASS. Independent Codex source review PASS. Additional Kimi OmniRoute review returned empty content and is NOT approval. Await fresh PR/main CI before deploy.

## Hosted progression cause captured and pool reset
Diagnostic-only14b6d3c CI37769887253 failed with Game inactive/paused, UI modalOpen/uiBlocked, awaitingChoice true, stage149ms, bossactivephase2, hazard disabled/serial0 and no errors. This directly proves a new progression choice paused the updater; it does not identify the individual RNA drop. The only ordinary queued-level source is onGemCollected; stage transition was not occurring.

The fixture now uses production-standard deactivateForStageReset for existing bullets/RNA gems, resets host cells and excludes their update/rewards from this beam contract. It asserts zero active bullets/gems. Paired local inherited-RNA100 fixture: baselinef292dc7 paused atstage33ms/queued3/awaitingChoice and failed8s; corrected fixture PASS. Exact corrected script alsoPASS. Thus no onGemCollected/Game.update/hazard method is stubbed, no assertion or timeout is loosened. Host-cell/RNA integration is outside this scoped beam test; other unchanged gameplay/browser suites cover it. Mixed-clock synthetic finding remains separately documented and was not the captured hosted cause.

## Dense readability fixture lifecycle recovery
Final6c84b89 CI37771605821 passed Legendary, Cardiac and controls, then dense-readability failed target150/cache150 with allalpha1. Enemy preUpdate reads prior density; Game.update refreshes cache afterward. Original fixed150ms sleep need not contain both real frames.

Density fixture now waits two actual Scene POST_UPDATE frames with cache>=target, bounded1500ms, before unchanged150/200targets/alpha assertions. This replaces a synchronization assumption, NOT an unchanged performance/timing gate. No manual Game/Enemy update or cache writes. Startup accepts an already-paused real Game, resumes then clears progression/UI; new unblocked assertion added. Exact native finalscript PASS; original native Game.active-only wait had stopped at startup30s. Paired sparseRAF240ms with shared corrected startup: old150ms sleep failed cache100/target150/allalpha1; completed-frame wait PASS. This demonstrates synchronization sensitivity, not the exact hosted scheduling. Independent Codex source review PASS. Additional Kimi nonstream diagnostic HTTP504; no routed approval.
# 2026-10-11 Free hosting persistence

Use Render Free for one HTTP process and existing free Supabase for a private JSON
snapshot. Do not place authoritative state only on Render's ephemeral filesystem
or on Render Free Postgres (30dayexpiry). Restore before listening; acknowledge
mutations only after durable commit; fence old deploys with a writer generation.
BotKeep creation returned503NoAvailability despite expanded key permissions.


## 2026-10-11 cutover completeness
User permits skipping old player-data migration. Preserve the canonical origin
and deploy both Telegram and dedicated MAX handlers before old hosting retirement.
Preview hosting startup must never modify MAX subscriptions or begin polling.
Keep unrelated Cloud.ru workloads separate from OFELIYA retirement.


### B2/B4 parent history (verbatim)
# Visual upgrade Phase B4 decisions — 19 October 2026

1. Shape vocabulary shared, semantics preserved: HUD adopts the aura's ring/tick/diamond language, but the critical telegraph stays untouched — its red language is a combat contract (test:telegraphs), not identity chrome.
2. Phase color mirrored in HUD via new getters (Enemy.getPhaseMode, GameScene.getBossPhaseMode) rather than extending the run snapshot: additive-free, no checkpoint/save shape risk.
3. Recovery/broken auras get the armored 6-tick ring so all phases read as one system; cardiac (heartbeat) boss deliberately excluded — it has its own visual language and different behavior contract.
4. QA-only wave.boss substitution used for the HUD bar capture (documented) because the real wave boss needs minutes of play; the substitution exercises the identical render path.
5. Perf handled by bound argument (<=6 stroke primitives in recovery/broken windows) plus a control 60s combat run — boss-specific perf harness deemed disproportionate.

## Previous snapshots
# Visual upgrade Phase B3 decisions — 19 October 2026

1. Non-word tier signal chosen (pips + frame strength) over text badges: new visible words would burden the copy catalog/language guard and still need parsing; pips read pre-attentively and need no localization.
2. Existing VISUAL tokens (host/rare/warning) reused; no new palette entries — keeps B5 migration surface from growing.
3. Legacy hexes (COLORS.gold, #ffe066) migrated to VISUAL.warning inside the card flow as part of B3 since the hierarchy touched exactly those lines — partial B5 contribution, documented as such.
4. Synthetic-def capture driver (mutation-cards-capture.cjs) chosen over organic level-ups: identical defs in both builds give a true pair; balance/RNG untouched.
5. No perf run per standard: modal-scoped objects, nothing in the game loop; bundle gate (+2.1%) substitutes.
6. Donor convention satisfied by documented absence: prior MIT donor has no rarity system; implementation original.

## Previous snapshots
# Visual upgrade Phase B2 decisions — 19 October 2026

1. Root cause chosen over cosmetic patch: playerHalo rendered below enemies (depth 7.5 < 10) — fix = new layer at depth 11 above the swarm, not tweaking halo alpha/radius.
2. Layer order preserves identity marks: clearing at 11 stays below elite markers (12), enemy health (13), bullets (14), player (15); only the swarm mass and its auras are dimmed. Accepted tradeoff: telegraphs (8) inside r≤52 pocket dim — their actionable range is far larger than the pocket.
3. playerGlow added after isolation probe showed the virion body is a dark gear that would read only by hurt-flash luck on the dark clearing; glow is 3-step soft disc (≤3 extra primitives), same density gate.
4. No donor code: searched prior MIT donor repo for a player-visibility mechanism; none exists; implementation original, documented in DONOR_PROVENANCE to satisfy the donor-method convention.
5. Measurement protocol extended (annulus 30-40px, core luminance) because ring 16-26px after the fix measures player's own cosmetics, not the surround — old metric alone would mislead.
6. Commit separation kept: B2 is one functional-visual commit; evidence/analyzer scripts stay outside the repo (workspace AUDIT dir), only the B2 code is committed.

## Previous snapshots
# Visual upgrade Phase B1 decisions — 19 October 2026

1. Donor for B1 = own PR #183 (commit 0e3269c), adapted by isolated port (`git show`), not merged — branch predates the 16.10 main convergence (#213–#217) and a merge would reintroduce superseded structure.
2. Scope cut from donor: documentation/CI files/video artifacts not ported (out of visual scope; fresh evidence generated instead); cardiac-hazard hit point left at donor default (donor itself passed no direction there).
3. Two donor defects fixed in adaptation: swapped Phaser renderer constants (CANVAS=1, WEBGL=2) and smoke waits assuming vfx.biologicalGhosts on builds where it doesn't exist (guards enable baseline evidence capture).
4. Commits separated by concern (atlas+tests / hit reaction / death collapse / test infra); `[skip render]` on the infra commit; local git identity Kimi <kimi@moonshot.local> in the worktree only.
5. Balance is off-limits: hit reaction and death collapse are visual-only; damage/HP/enemy counts untouched. Performance budget: any new in-loop VFX requires paired measurement (done: no regression).
6. Phase A mislabeled renderer is corrected in evidence docs rather than silently rewritten — own error stated explicitly.
7. No merge/push/deploy; production accessed read-only (GET). Next phases B2–B6 await owner decision; B2 recommended (measurements ready).

## Previous snapshots
# Visual implementation completion — 16 October 2026

Branch visual/completion-20261016 extends verified public7a0d829 (PR216). Implemented distinct Player mutation geometry/combined composition, unified SocialHub and Codex, measured11px scrolling result report with pinned actions, pointer ownership and long-share fit, quieter pause. Existing gameplay/RNG/physics/score/network/assets/service settings are retained. Main integration is not authorized.

Read docs/release/VISUAL_COMPLETION_20261016.md. Root executed rich result/resumed/share/social/error/allCodex browser320/360/390; presentation and TypeScript passed. Independent source and native visual reviews resolved concrete issues and found no remaining P1/P2. Short live100-spawn AI/physics desktop before/after has p95~16.8ms in Canvas/WebGL, explicitly not device FPS. Final exact-head hosted CI/matrix, fresh backup and pinned deployment/readback are still pending; do not claim publication from this snapshot.

The implementation gaps from the earlier Phase1 ledger are addressed in this branch; old pending statements below are historical snapshots. Device MAX/TG/iOS, sustained performance/thermals, newcomer/full-campaign acceptance remain open. Preserve other PRs and private state backups. Companion documentation branch carries final evidence without changing the tested product SHA after publication.

## Previous snapshots
# Mutation art recovery decisions — 16 October 2026
Branch fix/mutation-art-recovery-20261016 starts from the verified live visual candidate44c6579 (PR214). Cold-start optional mutation requests can exceed Boot1800ms; fallback previously remained permanent. The scoped fix records canonical texture provenance and recovers only mutation-prism/halo/singularity after first render. Same256px CanvasTexture objects refresh in place; Player/physics/gameplay/assets remain unchanged. Two8000ms attempts/key,750ms backoff; per-game dedup and destruction cancellation. Five module contracts, full presentation and TypeScript passed. Read docs/release/MUTATION_ART_RECOVERY_20261016.md.

Local delayed-image Canvas/WebGL regression passed with sixteen paired actual Player frames and exact packaged pixels. Independent source review found no concrete P1/P2. Remaining before publication: final still-image review, exact-head hosted CI/matrix, fresh private backup and pinned Render Free publication/readback. Owner authorizes continuation/deployment; main merge remains prohibited. Keep PR213/214/215 and other parallel PRs separate. Physical-device/FPS/newcomer acceptance remains open. Update the release document after real results; do not treat this pending snapshot as proof of publication.

## Previous snapshots
# Phase1 presentation and verification decisions — 16 October 2026
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

# Telegram bot image follow-up decisions — 2026-10-13

Keep the runtime code change limited to the bot image's missing helper COPY
and its existing contract guard. Scope the guard to the bot stage and actual
COPY source/destination pairs so comments or later stages cannot mask omissions.
Do not import other sections of the old security patch: PR #197 supersedes them.

Close superseded PR #189 while preserving its branch and linking current memory.
Do not deploy this maintenance package. After final-head PR CI passes, use a
merge commit message with `[skip render]`, without skipping CI. Render documents
this phrase at https://render.com/docs/deploys#skipping-an-auto-deploy.
Do not infer live provider/trigger state from old notes or use the MCP connector
for the other workspace; authenticated production-account inspection remains
necessary. Verify any eventual automatic-trigger fix on the next runtime release.

# Verified review-fix release — 2026-10-13

Runtime source: c0c72fa81690b562e15c1d87580c66af842b3f3b (PR197 merged). Main CI38375891119: build/browser-smoke/production-contract success. Render Free deployment dep-db6vmg4s728c73cv4010 is live in production workspace tea-d8iruouq1p3s73f30a90 (timoshin.oleg@gmail.com). Canonical https://ofeliya.freeveol.dpdns.org/ofeliya/ reports this SHA. Metadata-only commits after this release do not change the published source identity.

Deploy only the exact successful main CI source; preserve old ticket/outbox contracts and platform-aware identities. Use /ready as the Render health probe. Pin manual recovery deploys after checking the queue to prevent duplicate instances/writer claims. Native phone gates remain external. Docs-only updates are ignored by Render and retain runtime source c0c72fa81690b562e15c1d87580c66af842b3f3b.

## Historical snapshots (current verified facts above take precedence)

# Current review fixes — 2026-10-13

Branch fix/kimi-review-20261013, based on main26fcc88. User approved the independent review follow-up plan. See docs/release/KIMI_REVIEW_FIXES_20261013.md for contracts, tests and mixed-version policy. Previous handoff is archived under memory/archive/2026-10-13-before-review-fixes/; older state/decisions/backlog remain as historical notes below.

Decisions: keep ruleset3/campaign2; old tickets immutable; old explicitv2 scores/grants/duels fail closed, ordinaryv2 checkpoints resumed/unranked; remote registry has one webhook owner and explicit durable ACK; public XFF trust defaults0; no paid services or production mutation during branch verification.

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

# Render cutover decisions - 2026-10-11

Use the account the owner signed into: tea-d8iruouq1p3s73f30a90. The old Render
preview is in another inaccessible workspace and is not production. Preserve
the canonical domain, bot identities, secrets and webhook paths through DNS.
Host the existing dedicated MAX SDK handlers without polling/subscription
changes, and proxy /ofeliya/api/* so relative game requests reach the API.
Keep Supabase remote persistence; Render's ephemeral files are not authoritative.
Enable Telegram outbound prepared sharing on Render after live verification.

Owner permits skipping final old-player data transfer. Existing67scores were
retained; no claim is made that all final Cloud.ru player changes were imported.
Retire only the dedicated OFELIYA Cloud.ru VM/disk/IP after new hosting checks.
Ignore only memory/**, PROJECT_IDENTITY.md and deploy/RENDER.md in Render build
filters; documentation updates do not redeploy gameplay. Future runtime changes
continue through main/checksPass. No keepalive or paid upgrade is introduced.

Supabase state access key was rotated in the existing Free project. The new
Render uses the replacement; the old key returns401 for read and writer claim,
so the inaccessible preview cannot steal production persistence. A 24-hour
management token was scoped only to this project and Edge Functions. No keys
are committed. Main CI38158081443 passed all three jobs for runtime d92325b.

## Historical notes

# DECISIONS — OFELIYA: STRAIN ZERO

Формат: `[дата] Решение — причина. Статус.`
Перенесённые решения помечены источником (документы репо). Новые решения добавляются сюда после каждой сессии.

- [2026-10-06] The control-mode smoke freezes only the Game instance update before startup and asserts UI unblocked/modal-free state before synthetic pointer routing — the original failure was a valid `uiBlocked` rejection during automatic mutation choices, not a TwinStick production defect. Production unchanged; reviewer approved; root owns CI follow-up.

- [2026-10-05] The deploy script loads its compatibility gate from fetched `origin/main` rather than a sibling path — the bastion executes an extracted standalone script from `/tmp`; keep helper policy centralized, fail closed on missing/empty policy, and retain all SHA/floor guards. Review/PR and fresh main CI pending.

- [2026-10-05] Deployment CI lookup uses the workflow-specific `ci.yml` runs endpoint filtered by exact SHA and run identity, with a pinned Ubuntu 22.04 runner and bounded diagnostic summaries — the prior broad runs query did not yield the independently verified exact-SHA green run; root cause remains unproven. Retain all fail-closed predicates. Review/publish pending.

- [2026-10-05] Deploy CI reads the Actions runs payload from a temporary file, not an environment variable — large responses exceed Linux argument/environment limits before Node starts; retain all five successful-main-CI identity criteria and fail closed. Implemented in `fix/deploy-ci-payload-20261005`; review/publish by root pending.

- [2026-09-20] Исторические спринт-документы — не источник истины; при конфликте правят `STRAIN_ZERO_PRODUCT_BIBLE.md` и `ARCHITECTURE_NOTES.md`. Причина: устаревшие планы создавали ложные требования. Действует. *(источник: PLAN.md)*
- [2026-09-20] Кампания двухактовая: КРОВОТОК → IMMUNE PRIME → СЕРДЦЕ → CARDIAC TITAN; старый концепт 3–5 минут не использовать. Действует. *(источник: PLAN.md)*
- [ранее] Renderer остаётся Phaser-only — без GSAP / Matter.js / tsParticles / второго рендера. Причина: мобильная производительность и предсказуемость. Действует. *(источник: ARCHITECTURE_NOTES.md)*
- [ранее] Codex/mastery — информационный прогресс, не даёт постоянной силы. Причина: мета не должна ломать баланс забегов. Действует. *(источник: RELEASE_VALIDATION.md)*
- [ранее] Профиль игрока V1 — отдельный `profiles.json`, advisory-only, без billing; запись синхронная (tmp+rename). Причина: rollback-safety при откатах. Действует. *(источник: ARCHITECTURE_NOTES.md)*
- [2026-09-28] [пилот] Память проекта = файлы репозитория (`memory/`), чат — не источник истины; протокол: вход 3 файла / выход 4 файла. Причина: устранить потери контекста между сессиями и инструментами. На проверке пилотом.
- [2026-09-28] Пилот на Honor признан рабочим: OmniRoute ↔ OpenCode ↔ context-mode ↔ скиллы проверены живыми прогонами; ветка приёмки синхронизируется с main и проходит канонический гейт до merge. Действует.
- [2026-09-29] Квик-вины доставлены в main (PR #137, merge `5b74f66`); `feat/donor-quick-wins` = main + система памяти (+269, 6 файлов) — регрессий кода в ветке нет (подтверждено двумя проходами ревью и smoke-прогонами). Действует.
- [2026-09-29] Ревью-проходы пилота выполняются на отдельном комбо `BACKGROUND-REVIEW`; смена модели внутри одной сессии OpenCode сохраняет контекст (проверено на тест-цикле B). Действует.
- [2026-09-29] Служебные локальные каталоги (`.agents/`, `.openclaw/`, `.opencode/`, `.cluster/`, `config/`, `handoff-system/`, `ofelia-pilot/`, `skills/`, `*.capability.json`) в коммиты не включать; кандидаты на `.gitignore` — отдельной задачей. Действует.
- [2026-09-29] Внешнее ревью прогона приёмки выполнено внешней моделью (`nvidia/nemotron-3-ultra`, OpenRouter) — полноценный внешний прогон; ChatGPT-вариант отложен по решению Олега. Результат — `memory/06_REVIEW.md`. Действует.
- [2026-09-29] Второе внешнее мнение (`space-bunny-free`) применено: пост-ревью правки памяти (PR #154) — актуализация ссылок/метрик, worktree переведён на `main`. Правило: числа и ссылки в памяти — только из git-вывода. Действует.
- [2026-10-02] P0 mobile acceptance считается пройденной только при 16/16 воспроизводимых evidence-записях Android/iOS (device, MAX client version, timestamp, evidence); browser/CI и устное «работает» не заменяют real-device gate. Действует.
- [2026-10-02] First-run onboarding обучает продуктовым механикам, а не служебной паузе: движение → автоогонь → RNA → мутация → заражение клетки-хозяина. Действует.
- [2026-10-02] Продуктовые решения измеряются по verified actor funnel `app_open → run_start → run_60s → boss1 → heart → replay`, D1 и referral open → run_start; share-click/views сами по себе не являются итоговой метрикой. Действует.

## Telegram deployment isolation 03.10
- Telegram is an optional dedicated production profile, not a replacement for or credential-sharing extension of the MAX bot.
- Any partial Telegram configuration fails deployment closed. MAX-only deployment remains valid with all Telegram values empty.
- Telegram bot and score server may share only the OFELIYA persistent data volume needed for referral/user state; bot identities/tokens remain separate.

## Versioned edge policy 03.10
- Production Caddy site/TLS wrapper may stay host-local, but OFELIYA route/security policy must be rendered from versioned deploy/Caddyfile.ofeliya on every release.
- Edge changes are validated before activation; reload failure restores the previous local dedicated file and fails the deployment.

## Telegram Bot API mode 04.10
- Cloud.ru production default is webhook, not long polling, because outbound Telegram API routing is not sufficiently reliable.
- Keep long polling as an explicit fallback mode only for hosts with verified outbound Telegram API connectivity.
- Never disable Telegram TLS verification. Webhook authenticity is independently protected by TG_WEBHOOK_SECRET.


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

## Legendary card wrapping at 320px (05.10)
- Allocate room by measured copy wrapping at the actual card width: allow 3 lines and a bounded taller panel only for compact Legendary effects that need line 3. Keep fixed card height, preserve the copy, and leave other cards at existing 2-line limits. Do not globally shrink UI typography to solve this edge case.

- Three-line panel uses center-y=21 to clear the Legendary footer at y=43; center-y=31 was rejected after review showed overlap. Focused probe fails on missing description/footer or any intersection.

## Compact Legendary card vertical budget (05.10)
- If compact Legendary effect text needs 3 lines, allocate space in the reward modal's card height (136px vs ordinary compact 124px) so the longer effect plate clears both description and footer. Keep the badge at y=6..48 relative to card, footer beginning at y=49; do not reduce type size or edit copy.
- Keep the Linux visual gate early in CI and emit measured effect/description/footer rectangles so remaining intersections are diagnosable.

## Viewport gate for compact Legendary expansion
- Increase compact Legendary card height only when the proposed entire stack clears the actual subtitle bounds plus the card gap and stays above the viewport bottom margin. This preserves the portrait 320x568 fix while denying expansion when the group cannot fit, including short landscape.

## Release workflow stamp guard (05.10)
- Every workflow that runs `npm run build` must pass an explicit 40-character `VITE_RELEASE_SHA`. `scripts/stamp-release.mjs` deliberately throws rather than stamping an ambiguous dev build, so a missing env is a build failure, not a silent fallback. The Release Visual Matrix workflow was the one remaining build step without it; it now uses `${{ github.sha }}`, matching the `ci.yml` build gate. Do not relax the stamp guard to make a workflow pass.

## Release documentation honesty (05.10)
- The documented `npm run` lists in `README.md` and `RELEASE_VALIDATION.md` are an explicitly labelled quick check subset, not the release gate. `.github/workflows/ci.yml` is the authoritative complete gate; on divergence `ci.yml` wins. Do not present a local short-list run as release validation.
- State plainly in the release docs that passing CI does not imply real MAX Android/iOS or Telegram acceptance: automated gates run against a mocked MAX bridge in a desktop browser and cannot produce native client behavior, real signed `initData`, real haptics/audio unlock, real restart lifecycles, real deployment values, or real network/thermal conditions.
- Document `npm run test:mobile-evidence -- PATH` with its 16 required check ids and the five required per-check fields, and separately list the manual requirements it does not cover. Keep the existing 16-point manual matrix unchanged and complete.
- Describe the validator by what it enforces, not by a total row count. It iterates only its own `required` array, so 16 is the mandatory minimum; extra `checks[]` rows are permitted and uninspected, and a `pass` does not certify them. `testedAt` is validated with `Date.parse`, so ISO 8601 is a readability recommendation rather than an enforced format. Never write "exactly 16" or "checks only these" for a validator with that shape.
- Real-device acceptance evidence lives outside the repository in external release-evidence storage; the repo records only the path or URL. Gitignore the single local convenience file `artifacts/mobile-acceptance.json` rather than the whole `artifacts/` directory, so no unrelated artifact is silently hidden or removed.

## Probe coverage contract: multi-card Legendary
- Keep actual trophy coverage tied to the production contract of two guaranteed Legendary choices. A three-Legendary fixture is explicitly synthetic stress coverage and must not be described as a reachable trophy offer.
- For every card, find its own effect, plate, description, and footer under that card's container. Do not reuse global text matches across cards; this can make duplicate footer labels hide per-card defects.
- The expanded-height assertion must follow the same geometry as production: proposed stack top below measured subtitle bottom plus gap, and stack bottom above viewport bottom margin. Also assert card-to-card separation and visible-text viewport bounds.
- Keep failures visible. Syntax/static checks do not establish browser layout correctness; root browser run and independent review remain required.

- First browser run for the expanded probe passed 87/88: all single and two-choice pair scenarios passed; only the synthetic three-card fixture at 320x480 overlapped the subtitle. Move that fixture to 320x520 so the compact stack can fit while the expanded proposal fails the lower viewport guard; rerun passed 88/88: 24 singles, 60 pairs, 3 synthetic-three scenarios, and 1 short-portrait guard. At 320x520 the guard retained 124px cards with a 9px subtitle gap and no overflow. Independent review and Linux CI are still pending. This was a fixture-boundary correction, not a production layout change or weakened assertion.

- The first Linux CI attempt failed before the probe ran: its fallback URL pointed to 127.0.0.1:5197 while CI serves Vite on 5173 (connection refused at work/multicard-linux-plain.log:190). Restore 5173 as the default and preserve OFELIYA_URL for local overrides. Classify this as probe/CI URL wiring, not a layout assertion failure; rerun Linux CI before claiming it passes.

- Linux run of the expanded browser probe passed 87/88 after fixing the fallback port. All 15 real definition pairs across every tested viewport, including 320x520, passed. The only failure was the synthetic three-choice short-height fixture: one 3-line effect met the intended 2-line cap on 124px compact cards. This is an unreachable synthetic content/layout combination (trophy contract is two choices), while the longer 3-card stress case remains at taller heights. Use only 2-line effects in the 320x520 guard to isolate height-fit logic; keep all 15 actual pairs there. No production UI change and no relaxed assertion. Rerun pending.

- Linux wrap measurements showed the previous 320x520 short guard still included a 3-line effect: definition index 3. The six measured counts are `[2,3,2,3,3,2]`. Use indices 0, 2, and 5 for this guard; index 5 is the last-life-saving Legendary. Base the selection on measured wrapping, not inferred string length. Keep all other scenarios/assertions unchanged; latest Linux status is 87/88 and rerun is pending.

## VO-01 decisions — 07.10.2026
- Diagnostics only, no overall DPR/framebuffer multiplier. Use existing DEV/release-matrix-QA gate and detached on-demand readback, never timers or history.
- Snapshot fixed Menu/Game/UI scope, bounded recursive visible Text sampling, numeric geometry/resolution only; no content/identity/user fields.
- Phaser Text style.resolution and TextureSource.resolution are independent observed facts. Production renderer tests use numeric renderer.type because constructor names are minified.
- Browser fixture freezes Game.update before start and pauses physics after ready to isolate logical camera mapping from collision shake. Production controls/gameplay stay untouched; existing multitouch suite is separate evidence.
- Kimi failed invocation is not a review. Coordinator owns frozen candidate review; no other workers, push, merge or deploy.

## VO01 fix1 decisions — 07.10.2026
- Diagnostic snapshot returns a stable empty scene record when a canonical key is missing. Focused test removes actual Phaser scenes, avoiding mocks.
- Ordinary production means PROD without VITE_RELEASE_MATRIX_QA=1; both literal hook string absence across JS chunks and behavioral opacity required. Existing build-time gate remains unchanged.
- Preserve pre-start update freeze based on validated control-smoke lifecycle; narrow dimensions/input evidence, no progression/performance claim. Destroy nested Text/container before later samples.
- Scene pause/resume plus already-visible handler dispatch only; no actual hidden transition acceptance. Intrinsic size expectations explicitly baseline-specific.
- Successful Kimi text-only review supersedes failed invocation artifact; coordinator owns final acceptance.


## VO02 combat decisions — 07.10.2026
- Use baked palette atlas frames instead of tint or TextureSource.resolution compensation: Phaser3.90 Canvas particles ignore tint/resolution. Preserve all gameplay art/source dimensions for Task5.
- Retain exactly four emitters; two death silhouettes split one existing VfxBudget grant rather than taking independent full requests. Nearest RGB palette preserves unlisted event colors approximately; known colors map exactly. Particle RNG remains Phaser cosmetic RNG, no gameplay RNG use.
- Retain a lazy circle pool full12/reduced6, reserves3/2 for important feedback. Preemption cancels prior tweens, resets circle geometry/style/transforms and guards late completion by generation. If all slots are important, newest important feedback replaces oldest. Gameplay warning geometry lives outside VfxSystem and is unaffected.
- Keep ordinary hit feedback local and globally throttled; surface spray and short contact ring improve legibility without camera shake. Do not alter hitStop/ImpactDirector policy.
- Focused tests execute production TS modules with rendering-boundary adapters and real EventEmitter3; they establish calls/policy/recipes, not pixel parity or real-phone performance. Root-owned browser and Kimi review are still required.


## VO02 Kimi fix1 coverage decisions — 07.10.2026
- Resolve reviewer test gaps with boundary tests, no speculative production rewrite. Existing sort `Number(false)-Number(true)` correctly puts ordinary entries before important; Q2 interpretation does not warrant changing it.
- Exercise a stale callback despite cancellation, then permit new ordinary traffic to prove replacement remains active through public allocation behavior. Assert current completion releases visibility normally.
- Tie fixture is literal RGB(242,246,244): hand-checked squared distances 237 to white/immune, all other palette distances > 10,000. Expect white as first declaration-order tie winner, with both spark/chip frames; no duplicate nearest-color loop in tests.
- Mutation verification modifies production source strings only in the temporary loader memory, never tracked source: wrong shedding, absent serial guard, <= tie update and disabled ordinary cap each fail the corresponding new case. Regression additions passed existing code; do not describe their mutation RED as preimplementation feature RED.


## VO03 organ atmosphere decisions — 07.10.2026
- Keep logical background256px geometry and existing keys. Bake periodic sine flow and0.5-slope Heart fibres; broad warm detail stays below gameplay without postFX. Leave actor, host shadow and combat atlas dimensions/recipes to their existing owners.
- Allocate all three RBC bands at construction (full8/4/2, reduced4/3/1). Proportional visible budget preserves at least one per available band; Heart uses ceil(runtimeBudget/2), subject to the same three-band floor, preventing quality/stage switches from removing near depth.
- Retain one pulse Rectangle behind gameplay. Clamp composite alpha<=.075 and decay by actual elapsed milliseconds, separate from movement's50ms clamp. Split elapsed time at pending190ms second beat to preserve overlay decay with large frame intervals; store only latest pending numeric schedule and cancel on stage/reset/shutdown.
- Separate the cosmetic Heart envelope from authoritative heartbeat logic: first exp(-phase*14), second absent beforephase.22 then .52*exp(-(phase-.22)*18). Do not alter real heartbeat, director or AI timers.
- Focused test adapters record Phaser/Canvas calls while production logic and real EventEmitter3 execute. Four in-memory source mutations verify gate/decay/band/cancellation coverage. Root browser screenshots/independent review remain separate evidence.


## VO04 mix and lifecycle decisions — 07.10.2026
- Place per-bed loudness correction on a dedicated retained gain, separate from .65 music bus duck automation. Route all buses through .8master and one configured compressor. Keep existing procedural stinger/heartbeat filter and direct bio path.
- Cache decoded SFX normalization at successful load; role gain is its only event coefficient, replacing legacy manifest vol. Invalid/nonfinite samples or silent/empty data use trim1; bounded boost max12. Existing fallback oscillators and event throttles retain their values.
- Store desired deterministic bed independently from decoded fallback index. Diagnostics return frozen snapshots of actual node values and lifecycle booleans; decoded actual index is null before success/after stop. Emit bounded generic decode errors instead of arbitrary environment error messages.
- Visibility owns suspension even before AudioContext exists; also check document.hidden because director binds its listener after bedStart and teardown calls setSuspended(false). Never resume/spawn while hidden; cache legitimate hidden decode for visible restart. Recheck visibility after asynchronous resume to prevent pending resume overriding hide.
- Call ctx.resume() inside the gesture callback stack; deduplicate its pending promise and rearm one listener per event after failure. Keep manual pause from suspending shared UI audio. Stop outstanding adaptive layer tones on run teardown while leaving SFX transient cleanup on ended.
- Focused WebAudio adapter must distinguish scheduled oscillator stop from immediate teardown; otherwise live-node lifecycle assertions are vacuous. Restart tests assert bio plus four live layer oscillators before explicit cleanup. Browser/sample/device acceptance remains coordinator-owned.


## VO05 core art recovery decisions — 07.10.2026
- Resume saved `fdacc92` rather than repeat asset generation or replace stable implementation. Keep canonical logical metrics and bounded4x backing explicit; do not use TextureSource.resolution to compensate sprite/body geometry.
- Extend coverage at Boot loader/canonical-key and create-sequencing boundaries; validate generated asset byte hashes against recorded provenance. XHR completion and Phaser body rounding require separate actual browser acceptance.
- Retain intentional untracked `.vo05-mutant.mjs` unchanged; its finite-timeout failure is coverage evidence, not a tracked feature or failing production gate. Coverage additions were green on existing implementation; no claim of new feature RED.
- Keep recovered changes scoped to Task5 tests/memory; no unnecessary source rewrite, package/CI wiring, browser operation or deployment. Coordinator owns root integration/scoped review and actual Phaser checks.


## VO05 stalled-art follow-up — 07.10.2026
- Root actual-browser regression exposed >6000ms stalled startup. Phaser3.90 Loader defaults maxRetries2; File.onError reloads twice, creating3x1800ms windows. Desktop parallel32; Android parallel6 can additionally batch seven assets.
- `9dc9650` sets optional-art retries0 while queueing (restores prior value in finally for unrelated future files) and Boot concurrency max(existing,7). Per-file1800ms timeout unchanged. Core art contract now16/16 includes retry capture/restore and Android6/desktop32 batching policy.
- With root-authorized browser follow-up, actual Chromium Canvas startup available1335ms/missing1102ms/stalled2501ms/Android-UA stalled2673ms, all unchanged6000ms gate. Stalled modes each requested exactly7distinct assets, no retries; Android config default6 and Boot loader7 explicitly confirmed. Private extended copy of root startup test remains untracked for coordinator import.
- Elite fixture now compares actual halfWidth/halfHeight to floor(sourceWorldRadiusX/Y), matching Phaser Body.setCircle/updateBounds; logical tolerance1.01, markers/signatures/centers unchanged. Actual elite script passed against own Vite server with only URL substituted in temporary copy. No physics production changes.
- Typecheck, core16/16, nonbrowser startup-renderer, viewport/tokens/impact-budget and whitespace passed after fix. No push/merge/deploy. Root still owns full geometry/controls/matrix/scoped review and external device gates.

## VO06 restrained framing decisions — 07.10.2026
- Reuse existing BORDER/PANEL/ROLE tokens without modifying frozen recipes. Specimen radius=min(82,H*.105) keeps circular decoration below title/copy; low-alpha warm plate and pink halo are behind hero, with fixed geometry and alpha-only animation.
- Add panel illumination as static noninteractive hairlines inside existing selector bounds; preserve every text/touch callback and launch-once guard.
- Draw highlights inside the retained XP/HP/boss Graphics (3px side inset,2px top inset,2px height), so existing hide/pulse/cinematic handling applies automatically. Leave fill/text updates immediate and geometry unchanged.
- No new implementation-mirroring test for cosmetic decoration. Existing non-browser contracts establish unrelated token/copy/math stability; root actual Phaser acceptance must assess visible layout, teardown and pixel quality.

## 2026-10-07: Recovery and acceptance decisions

Preserve saved implementations rather than restart. Disable optional-art retries only while queueing and restore prior policy. Freeze live progression in density-capture fixture, preserving Sprite.preUpdate/rendering and all assertions. Isolate font900ms gate from optional art; separate real artstartup6sec evidence. Keep general1xcanvas and compensated4xart; a fullHiDPI renderer is outside this contained presentation change.

## Hosted CI determinism decisions

Use real production tier override before test modules load, restoring global storage descriptor. Sample real production animation at shared1000ms, seed only creation cosmetics and restore Math.random. Prepare lazy group sprites idempotently; explicitly apply existing depthSort before exact ordered input snapshots. Require finite poses, retained windup telegraphs, before/after stability and same-tier renderer input equality; preserve raster thresholds. Scope lysis-radius spy to actual lysis rather than unrelated hit rings; assert complete108/150 array and original damage bounds. These are fixture corrections, not gameplay/rendering changes.

## 2026-10-08 presentation continuation rulings
Ruling: keep canonical art and bake only two6frame atlases at boot; equal source frame size/factor4 preserves physics. No gameplayRNG or new per-frame objects. Ruling: cap combo pulse by availableHPgutter and compact numbers; separate boss title/bar within unchangedplate and preserve input targets. Ruling: portable filesystem paths in testsource loaders, assertions unchanged. Ruling: HiDPI production default stays1x; followup QA-only proof until device/performance/context/offscreen evidence. Kimi route connectivity is separate from a successful review: use available authenticated direct fallback when OmniRoute timeout/empty response prevents review.

- [2026-10-08] Keep density2 explicit DEV/release-matrix-only, maximum2x/4Mpx and static/runtime1x fallback, pinned Phaser3.90 internals. Quadrupled framebuffer area requires device evidence before rollout; preserve logical input/camera/body geometry. No automatic production activation.

- [2026-10-08] Isolate Legendary ceremony from autonomous progression by freezing fixture Game.update, while preserving real UI/choice/Scene lifecycle. Keep Cardiac real updater and explicitly clear initial progression/UI. Do not claim the isolated ceremony tests resumed gameplay simulation; other gameplay contracts cover it.

## Cardiac clock isolation follow-up
PR182 initial head e1c058e CI37768249337 passed ceremony but failed Cardiac8s. Diagnostic-only14b6d3c CI37769887253 remains running. A local synthetic sparse RAF35ms plus explicit cooldown240 reproduced the timeout: Game active/notpaused/UI clear, boss phase2, stage2649 versus scene16936, nextTelegraph13575 already due, heartbeat3216 safeIndicator true; zero page errors. This demonstrates the mixed-clock scheduling mechanism, not the exact hosted runner conditions (default cooldown120).

Fixture now uses the real heartbeat.restore with nextImpact=stageTime+60000 and bossWasActive=true, with exact60000 setup assertion. Game.update, real Cardiac scheduler and canSchedule, original4700/850/280 source timing,8s/2s/1.5s browser deadlines, exact14damage and heartbeatClear remain. It intentionally does not validate live heartbeat concurrency; unchanged test:pacing separately tests1980/1981 boundary and exclusion. Native exactscript plus paired synthetic stressed fixture PASS; pacing PASS. Independent Codex source review PASS. Additional Kimi OmniRoute review returned empty content and is NOT approval. Await fresh PR/main CI before deploy.

## Hosted progression cause captured and pool reset
Diagnostic-only14b6d3c CI37769887253 failed with Game inactive/paused, UI modalOpen/uiBlocked, awaitingChoice true, stage149ms, bossactivephase2, hazard disabled/serial0 and no errors. This directly proves a new progression choice paused the updater; it does not identify the individual RNA drop. The only ordinary queued-level source is onGemCollected; stage transition was not occurring.

The fixture now uses production-standard deactivateForStageReset for existing bullets/RNA gems, resets host cells and excludes their update/rewards from this beam contract. It asserts zero active bullets/gems. Paired local inherited-RNA100 fixture: baselinef292dc7 paused atstage33ms/queued3/awaitingChoice and failed8s; corrected fixture PASS. Exact corrected script alsoPASS. Thus no onGemCollected/Game.update/hazard method is stubbed, no assertion or timeout is loosened. Host-cell/RNA integration is outside this scoped beam test; other unchanged gameplay/browser suites cover it. Mixed-clock synthetic finding remains separately documented and was not the captured hosted cause.

## Dense readability fixture lifecycle recovery
Final6c84b89 CI37771605821 passed Legendary, Cardiac and controls, then dense-readability failed target150/cache150 with allalpha1. Enemy preUpdate reads prior density; Game.update refreshes cache afterward. Original fixed150ms sleep need not contain both real frames.

Density fixture now waits two actual Scene POST_UPDATE frames with cache>=target, bounded1500ms, before unchanged150/200targets/alpha assertions. This replaces a synchronization assumption, NOT an unchanged performance/timing gate. No manual Game/Enemy update or cache writes. Startup accepts an already-paused real Game, resumes then clears progression/UI; new unblocked assertion added. Exact native finalscript PASS; original native Game.active-only wait had stopped at startup30s. Paired sparseRAF240ms with shared corrected startup: old150ms sleep failed cache100/target150/allalpha1; completed-frame wait PASS. This demonstrates synchronization sensitivity, not the exact hosted scheduling. Independent Codex source review PASS. Additional Kimi nonstream diagnostic HTTP504; no routed approval.
# 2026-10-11 Free hosting persistence

Use Render Free for one HTTP process and existing free Supabase for a private JSON
snapshot. Do not place authoritative state only on Render's ephemeral filesystem
or on Render Free Postgres (30dayexpiry). Restore before listening; acknowledge
mutations only after durable commit; fence old deploys with a writer generation.
BotKeep creation returned503NoAvailability despite expanded key permissions.


## 2026-10-11 cutover completeness
User permits skipping old player-data migration. Preserve the canonical origin
and deploy both Telegram and dedicated MAX handlers before old hosting retirement.
Preview hosting startup must never modify MAX subscriptions or begin polling.
Keep unrelated Cloud.ru workloads separate from OFELIYA retirement.
# B2/B4 integration decisions — 20 October 2026

1. Reused PR #210's `MotionPreferences` cached media query policy in `src/systems/`; it is live-updating and avoids allocating/checking matchMedia each frame.
2. Reduced-motion only removes decorative camera and boss identity motion. Boss phase colors, HUD phase ticks, attack warning timing/shape, and Danger Echo remain available/actionable.
3. Applied review's CI gate patch; extended existing B2/B4 gate with reduced-motion regression instead of creating a parallel command.
4. Root owns browser/pixel adaptation in `scripts/biological-impact-smoke.cjs`; no edits by this worker. No commit until root review.

Root validation: actual Canvas/WebGL echo matrix 16/16 passed at320/390/768/1080 with both motion preferences; world/HUD phase and live-preference checks4/4 passed. Adapted repo41 two-postrender/native-decoded screenshot pixel check without pngjs; strict3-cell impact passed, WebGL idle0/hit3982 white pixels. Negative control clearing tint fails as expected. Independent source review found no actionable P1/P2. Final-head full tests/build are tracked externally in12_INTEGRATION_PREP.
