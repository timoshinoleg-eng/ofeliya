# STATE — OFELIYA: STRAIN ZERO

Обновлено: 2026-10-02. Только факты; решения — в `02_DECISIONS.md`.

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
