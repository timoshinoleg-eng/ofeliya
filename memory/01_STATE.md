## Comprehension evidence (06.10.2026)

- Local feature branch from main d7797bc; client now emits run-scoped comprehension metadata without gameplay RNG.
- Report uses occurrence time, explicit denominators, firstRun eligibility and separate uncorrelated diagnostics. Old rows cannot establish same-run chains.
- Real signed API → persisted store → report fixtures pass; run identity/resume/bounds helpers and RNG/checkpoint regressions pass. Typecheck and test-configured build passed at e349c55.
- Browser smoke adds resume delivery acknowledgement and stable retry occurrence-time/RNG proof; final execution tracked in current handoff.
- Actual newcomer/device sessions and release acceptance remain pending. Local changes have not been published.

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
