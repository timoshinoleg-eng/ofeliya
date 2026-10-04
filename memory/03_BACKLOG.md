# BACKLOG — OFELIYA: STRAIN ZERO

Обновлено: 2026-10-02. Отмечайте сделанное галочкой; новые пункты добавляйте сюда, а не в чат.

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
