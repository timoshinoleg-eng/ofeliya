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
