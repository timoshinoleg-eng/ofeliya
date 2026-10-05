# HANDOFF — OFELIYA: STRAIN ZERO — 2026-10-02

> Прочитай этот файл и `01_STATE.md` перед следующей задачей. Факты — из репозитория.

## Текущая задача

Product validation sprint по приоритетам P0–P2: закрыть инструменты реальной mobile acceptance, улучшить первые 60 секунд, сделать продуктовую воронку измеримой и подготовить Daily/referral validation.

## Исходная точка

- `origin/main` перед работой: `4bce5a0bdfd996cbda4447d1eefdfbdb2c9531bc`.
- Рабочая ветка: `feat/product-validation-funnel-20261002`.
- Не путать automated/browser validation с реальной MAX Android/iOS приёмкой: real-device 16/16 пока НЕ пройден.

## Реализовано 02.10

- Tutorial core loop: движение → автоогонь → RNA → мутация → заражение клетки-хозяина; pause больше не tutorial-step.
- UI получает `hostCellsInfected` в `RunSnapshot`, step 5 завершается фактическим заражением.
- Добавлены `onboarding_step`/`onboarding_exit` и продуктовые milestone events: `run_start`, `run_60s`, `boss1`, `heart`, `win/death`, `replay`, успешный `share`, `daily`, referral open.
- Ограничен retry аналитики: после одной повторной попытки событие помечается exhausted на текущий scene generation, чтобы persistent network failure не создавал запрос каждый frame.
- `scripts/analyze-product-funnel.mjs` + `npm run analytics:funnel`: core funnel, onboarding timing/exits, D1, referral open → run_start.
- `scripts/check-mobile-acceptance-evidence.mjs` + `npm run test:mobile-evidence`: строгий 16/16 evidence gate Android/iOS.
- `docs/PRODUCT_VALIDATION_2026-10.md`: процедура P0/P1/P2 и критерии.

## Проверено

- `test:onboarding` ✓
- `test:analytics` ✓
- `server:test` 68/68 ✓
- `test:comprehension` ✓, 6 mobile viewport, текущая ветка на отдельном Vite :5194
- `test:result-actions` ✓ + checkpoint-resume ✓ на текущей ветке
- `test:daily-cta` ✓
- `npx tsc --noEmit` ✓
- production build ✓ при явном `VITE_RELEASE_SHA` base SHA; release guard без SHA ожидаемо fail-closed
- funnel CLI и mobile evidence validator проверены synthetic fixtures; это НЕ реальные продуктовые данные/evidence.

## Следующие обязательные шаги

1. Дождаться/зафиксировать `test:social-hub` текущего прогона, затем финальный diff/check.
2. Commit/push ветки и PR в `main`; дождаться CI.
3. На реальных MAX Android + iOS пройти 16/16 и приложить evidence artifact.
4. Провести небольшой наблюдаемый playtest первых 60 секунд; после появления данных запустить `analytics:funnel` и посмотреть узкие места.
5. Реальный Daily invite test: sender → recipient open → run_start → result.
6. Только после этого оценивать P2 creative по attributable referral opens/started runs, а не просмотрам.

## Важное окружение

На `chatgpt-ops-1` был старый чужой Vite на `:5173`; он давал ложный timeout/старое поведение. Для этой ветки использован отдельный Vite `http://127.0.0.1:5194/`. Не интерпретировать тесты против :5173 как состояние этой ветки.

## 03.10 audit follow-up
- Historical audit commit 53ff997 is far behind current work and must not be treated as current source of truth.
- D1 elite hitbox was revalidated as a false positive and locked by runtime smoke.
- D2 viewport resize for blocking level-up/result overlays has an implementation + regression coverage on PR #157 branch.
- Remaining P0 is still real MAX Android/iOS acceptance evidence.

## Telegram production pass 03.10
- Work is on `feat/telegram-production-wiring` from main `56476c0`.
- Production wiring can be merged/deployed safely in MAX-only mode; Telegram service is enabled only when dedicated Telegram env is present.
- Remaining external inputs: dedicated Telegram bot token/username and BotFather Main Mini App configuration, followed by real Telegram acceptance.


## 2026-10-05: продолжение Sol6.1 remediation

- Основа origin/main edb1b9a (Telegram webhook), ветка fix/sol61-review-remediation-20261005. Восстановлены R01/R02 и незавершённый R03 из отдельного checkout без изменения исходного каталога.
- R01 wall clock Daily; R02 резерв verified capacity; R03 ID-aware ordinary outbox; R04 reload отложен до завершения Game (internal game reference, production без QA hook).
- R05 outbound defaultoff + explicit Compose env; R06 webhook-compatible SHA floor в workflow/select/rollback и direct deploy; R07 shared polling/webhook direct-link payload и group-safe кнопки.
- R08 onboarding completion callback; R09 analytics actor60/min; R10 credentials scrub+7dayTTL обоих outboxes.
- Независимое GPT-6.1 Sol ревью дополнительно выявило Daily409 blocking, смену uid внутри одной платформы и ack-before-durable. Исправлены terminal Daily409, exact-ID Daily settlement, local ownerId replay guard, fresh-user Daily slot supersession и synchronous atomic flush score/run/start/daily/run до non5xx ответа. Unknown legacy ordinary entries не replay: истекают поTTL, предотвращая присвоение чужому пользователю.
- Проверки: server75, outbox24, новые release4/onboarding/rollback/server-policy/renderedCompose; браузер score/comprehension6viewport. Полный локальный набор43гейта: первый startup5.124s при параллельной браузерной нагрузке и Caddy sh ENOENT; serial startup и Caddy с GitBash PATH прошли. Исходные failures сохранены в evidence.
- Cloud creation недоступен аккаунту; пользователь разрешил local. Deploy/merge не выполнены. Публичный release.json недоступен; текущая productionSHA НЕ подтверждена. Real-device MAX Android/iOS16/16 остаётся открытым.
- Анализ второго вложения: WOFF2 валиден, кириллица отсутствует. Не считать разрешённые словарём ФОРМА МУТАЦИИ/MAX ИЛИ TG/СТАНДАРТ ошибками; предложить небольшой кириллический typography trial, затем RU catalog; fullEN i18n после продуктового решения.

## 2026-10-05 typography experiment handoff
- Isolated checkout `work/ofeliya-typography`, branch `experiment/cyrillic-typography-20261005`, base `4f65c4fa19132283776e6b5dab19cc1fcc583abc`.
- Code/assets commit `dc7fc8ed8d9a00f9f5c7f77937fe45c529be97c1`; Play 400/700 assets and OFL/provenance are included. The game is unchanged unless `VITE_TYPOGRAPHY_EXPERIMENT=play`; system body stack remains current. Standalone specimen: `experiments/typography/index.html`.
- Checks passed: `npx tsc --noEmit`, `npm run test:startup`, Vite builds with and without experiment flag. No browser screenshot or actual MAX device review is claimed.
- Next: root agent runs visual checks from `outputs/typography-experiment.md`, especially title fit, Russian/Ё glyphs, 320px width, and zero Play requests in default Network. Do not merge/deploy or flip default before separate product review.

## Repair update 2026-10-05
- Latest local repair commit: `7e1c9bae15d35ab355c15e05e16567501f6c8d3b`. `config.ts` has no `import.meta`; browser boot calls the opt-in font setter. Release visual workflow sets `VITE_RELEASE_SHA` to `github.sha` for the normal build/stamp.
- Red-to-green `npm run test:save`; typecheck and default/Play stamped builds passed. Nonbrowser package checks 40/41; missing real `artifacts/mobile-acceptance.json` is the only remaining nonbrowser gate and must stay unclaimed.
- Root must rerun browser checks and CI against this SHA. Do not push from this worker.
