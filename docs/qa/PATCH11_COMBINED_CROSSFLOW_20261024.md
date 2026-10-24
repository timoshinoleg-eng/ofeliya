# OFELIYA Patch 11 — сквозной QA-контракт (2026-10-24)

## Область проверки
Изолированный Draft PR #239, исходный объединённый SHA `d25e4f615b06d2d0302759f7c19c0afefbe5358a`, без production деплоя/merge. Одна реальная сессия Chromium (390x740 → Telegram viewport 390x600), синтетический Telegram SDK, только локальный Vite сервер. Никакой реальной авторизации Telegram, пользовательских данных, Stars или сервера.

## Новый исполняемый тест
`node scripts/p11-combined-crossflow-smoke.cjs` — требует уже запущенный Vite dev server на `127.0.0.1:5173`. В GitHub CI запускается после существующего `test:quest-scenes`, с `NODE_PATH` рабочего пространства.

Проверено в **одном браузерном сеансе**:
1. Два параллельных ensureTelegramBridge (тайм-аут 8/25 мс) при одном задержанном SDK script; оба исходных ожидания false, затем поздний load даёт ровно один ready и Telegram adapter.
2. Resize 390x740 → 390x600; Phaser game.scale.height=600; координаты action CTA полностью внутри canvas; одна реальная подписка SDK viewportChanged.
3. Открытие/закрытие QuestBoard из меню при Telegram bridge.
4. Реальный GameScene, убийство врага ровно 1, pickup РНК ровно 7, выбор мутации ровно 1, damage сбрасывает серию до 0.
5. Завершение забега с подавленным pending tick: lastTickTimeMs 125000 → 125950, серия без урона ровно 60 сек. Повторный finish не изменяет persisted QuestState.
6. Daily score outbox sentinel в localStorage не затронут, нет неожиданных pageerror/console ошибок. Единственный intentional HTTP 503 от мокированного недоступного /api/ endpoint классифицирован как ожидаемая QA-изоляция.

**Локально:** test `PASS`, exit 0 (Windows Chrome; source combined SHA `d25e4f6`, целевые тестовые файлы изменены после этого SHA).
**GitHub Actions:** требуется полный новый run на точном SHA, который включает этот тест. Предыдущий [combined CI #40108105908](https://github.com/timoshinoleg-eng/ofeliya/actions/runs/40108105908) — 3/3 SUCCESS на базовом combined SHA без нового сквозного QA.
**MiniMax:** combined review failed with network error (exit 6), не является одобрением.

## Ограничения и риски
- Не проверен реальный Samsung S20+ Telegram/WebView, MAX WebView и тестовый bot launch; синтетическая реализация Telegram SDK не заменяет реальные host permissions/gesture/back-button/lifecycle.
- UTC subsecond day attribution remains Issue #237; тест идёт в пределах одного дня и не утверждает исправление этого P3.
- Нет реальных backend вызовов, Stars, платежей, wallet, API/webhook. Мокированный API намеренно возвращает 503.
- Результаты старых unit/visual tests не заменяют этот сквозной сценарий; CI должен повторно подтвердить combined build, browser-smoke и production-contract.
- Старые PR #232/#233/#236 и main не изменяются. **NO MERGE / NO DEPLOY.**
