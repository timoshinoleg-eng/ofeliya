# OFELIYA — интеграция квестов со сценами, 23.10.2026

Ветка: feat/quest-scene-integration-20261023. Проверены чистый status и точный исходный HEAD 66fc1a953409b90ed63b9acc9f9f55278b96c77f (#231). Дополнительных cherry-pick, смены веток, push, merge, deploy, webhook, production API и платёжных операций не было.

## Реализация и карта событий

| Событие | Авторитетный источник | Защита / смысл |
|---|---|---|
| run_started | GameScene.create после создания/восстановления RunState | Только новый забег; requestedResume проходит validateRunCheckpoint и не генерирует start |
| enemy_killed | onEnemyDied после recordKill | Enemy.takeDamage сначала деактивирует тело; total run.kills отсекает повтор producer; enemyKind=e.kind, elite=e.isElite (boss сам по себе не elite) |
| rna_collected | onGemCollected сразу после addXp(value) | Считается собранный XP/RNA pickup, включая лизис/мини-босса, только после collect; notifyRnaPickup не источник |
| mutation_chosen | chooseUpgrade после успешного def.apply | Невалидный/stale id не считается; preview/reroll не считаются; принятые обычные/critical/legendary выборы считаются |
| run_tick | GameScene.update сразу после RunState.tick | run.timeMs и текущий stage.noDamageMs, не maxNoDamageMs; смена целой секунды, без нового текста на каждом frame |
| damage reset | Все пять resetNoDamage: контакт, volatile elite, boss pressure wave, cardiac beam, anomaly burst | Немедленный tick со streak=0; не повторяет урон на iframe |
| run_completed | finish после SaveSystem.recordRun | Сначала фактическое обновление SaveData.runs, затем mirror, terminal id и flush; повтор finish защищён существующим runResult и producer ended |
| persistence | safe checkpoint / pagehide / hidden / SHUTDOWN | Существующие lifecycle listeners использованы повторно; собственных window/document listeners producer не создаёт |

Source anchors: GameScene.ts:315 (begin), :642 (tick), :902 (kill), :1253 (pickup), :1274 (choice), :1986 (checkpoint flush), :2403 (terminal).

QuestRuntime владеет QuestEngine без rewardGateway. Engine/producer не импортируют Daily, ScoreClient, SaveSystem, Phaser или сервер. UI зеркалит только SaveSystem.get().runs. Награды, balance, Stars, permanent power и вызовы claimLocalReward/verifyWithServer из интеграции отсутствуют. Завершение остаётся локальным, не подтверждённым сервером (local_pending); claim UI отсутствует.

ID забега независим от gameplay RNG. Delivery timeline меняется при restore, чтобы discarded checkpoint-future event IDs не подавляли повторно заработанные pickups. IDs помещаются в 64-символьный persisted core лимит. Terminal ID стабилен для забега, ended хранится вместе с quest record, а не зависит от bounded recent-event window.

К RunCheckpointData schema=1 добавлен необязательный quest payload (id, kills, rna, mutations, elites, ended); ruleset/campaign/score версии неизменны. Невалидный optional payload отбрасывается без отказа от валидного gameplay checkpoint. При resume восстанавливаются именно checkpoint counters, включая откат более нового quest record. Day done/best сохраняют исторический факт уже достигнутой цели; текущие run counters восстанавливаются отдельно. Вчерашний более короткий checkpoint streak не трактуется как свежий streak сегодняшнего дня. Legacy checkpoint без quest payload даёт только подтверждённые kills/time/current streak; RNA/mutations/elites начинаются с нуля, их прошлые значения не выдумываются.

Quest record остаётся v4 под ofeliya.quests.v1; additive runtime metadata сохраняется атомарно с engine JSON через storage adapter. Core v3→v4 migration сохранена и проверена с producer. SaveData и Daily storage не мигрируются.

## UI

Вход: **Меню → КОДЕКС → КВЕСТЫ · локальный прогресс** (нижняя строка, touch target 44px). Доска показывает три цели, описание, текущий прогресс/target, «Выполнено · локально» и «Обновление в 00:00 UTC». Закрытие: кнопка высотой 44px и platform Back. Доска блокирует нижнее меню; resize/shutdown удаляют timer/handler/root. Один scene timer проверяет UTC день раз в секунду; display/text пересоздаются только при смене дня.

Phaser frame уже ограничен существующим ViewportManager safe area; собственные поля 12px по горизонтали / 16px по вертикали, panel cap 420×540. В браузере проверены 320×568, 390×844, 768×1024, 1080×1920 и реальный touch вход. Новых анимаций/артов/эмиттеров/HUD-объектов нет. UIScene, Player, Joystick, physics, RNG, governor, Daily и server source не изменены. HUD сознательно не добавлен: выбран разрешённый узкий вариант menu surface.

Скриншоты реального локального Phaser: [320](quest-evidence/quests-320.png), [390](quest-evidence/quests-390.png), [768](quest-evidence/quests-768.png), [1080](quest-evidence/quests-1080.png). Просмотрен 320px кадр. Это desktop headless, не физический WebView. Видео не создавалось.

## Проверки

Результаты команд и exit codes сохраняются в quest-evidence/validation.json и отдельных logs/JSON. PASS означает конкретную указанную проверку, не production readiness.

| Команда | Exit / результат |
|---|---|
| npm ci | 0 |
| npm run test:quest-core | 0 / PASS |
| npm run test:quest-core-mutations | 0 / 83/83 mutations, 1 unchanged control, Asia/Tokyo |
| npm run test:quest-runtime | 0 / PASS |
| npm run test:quest-scenes | 0 / PASS, четыре размера |
| npx tsc --noEmit | 0 / PASS |
| npm run build, VITE_RELEASE_SHA=HEAD | 0 / PASS; index455.80kB, gzip134.04kB; до коммита SHA66fc1a9, dirty candidate hashes сохранены |
| npm run test:b2b4-fixes | 0 / PASS, включая 900/900 geometry |
| test:daily-v2, test:score-outbox, test:daily-history, test:daily-cta, test:daily-preview | каждый 0 / PASS |
| npm run test:rng | исходный TMP: 1 (sandbox esbuild Access denied); workspace TMP + CommonJS boundary: 0 / PASS RNG и checkpoint |
| npm run test:streaks | исходный TMP: 1 (та же sandbox ошибка); workspace TMP: 0 / PASS |
| test:integration-visual, test:layout-diagnostics | каждый 0 / PASS |
| test:viewport, test:runtime-quality, test:impact-budget | каждый 0 / PASS |
| node scripts/browser-smoke.cjs | 0 / PASS, неизменённый исходный smoke |
| node scripts/integration-visual-smoke.cjs | НЕ PASS: ETIMEDOUT внешнего runner180s; utility20 PASS, motion reduce PASS, no-preference не завершён |
| git diff --check | 0 / PASS |
| physical MAX / Telegram WebView, hosted CI | NOT_RUN |
| build:max / публикационный RC | NOT_RUN (не публикационная задача) |

Первый npx tsc --noEmit также дал exit1 TS2345 для выведенного literal color type в QuestBoard; исправлена явная аннотация string, финальный typecheck exit0.

RED→GREEN: первоначальный runtime тест завершился exit1 из-за отсутствующего producer. Дополнительные assertions воспроизвели exit1 для checkpoint-future RNA dedup (7 вместо14) и вчерашнего shorter streak (50 вместо0); обе реализации исправлены, те же assertions GREEN. Проверяются reload, повтор terminal, restart, UTC, v3→v4, restricted storage и отсутствие claims.

Browser test вызывает реальные Enemy.takeDamage (включая второй удар по уже мёртвому), Gem.collect дважды, chooseUpgrade со stale повтором, onPlayerHit и finish дважды; отдельно notifyRnaPickup не меняет quest RNA. Первый реальный Game.update/postupdate обязателен. Доска открывается touch десять раз на размер; shutdown listeners не растут. Три actual fresh→Menu→resume→Menu цикла на размер сохраняют run identity, не создают run_started и не увеличивают pagehide/visibility listeners. Daily outbox sentinel сохраняется. Открытая доска не пересоздаёт display list внутри дня и обновляется при UTC rollover. Повреждённый optional checkpoint.quest также проверен реальным resume. Отдельный390 no-preference прогон целевого теста PASS. Другие четыре damage seams проверены по source; отдельный behavioral browser сценарий для каждого hazard не заявляется.

### Ограничения среды и сохранённые неуспешные попытки

Две первые сборки exit1: Windows VirtualAlloc errno1455 / esbuild cannot allocate memory. Отдельная сборка после остановки dev/browser процессов, GOMAXPROCS=2 — PASS; minification/typecheck/thresholds не менялись. Первые browser прогоны с несколькими тяжёлыми задачами дали Target crashed / stall; частичные прогоны не выданы за полный PASS. Общие smoke были прерваны (exit1) после stall на старте Game. Диагностический запуск с одними progress markers (без изменения проверок) затем прошёл на исходных трёх файлах 66fc1a9 и на candidate; оба JSON сохранены. Конкретная причина первоначального stall не доказана.

Первый автоматический сборщик logs использовал Windows PowerShell npm.ps1 и упёрся в ExecutionPolicy (exit1); повтор через npm.cmd/npx.cmd прошёл без изменения policy. Для esbuild tests временный каталог размещён в .tmp-browser-smoke/quest-tmp с package.json type=commonjs; тестовые assertions/таймауты не изменялись. Это harness настройка, не исправление продукта.

Предпочтительный autoglm-browser-agent отсутствовал в доступных tools/skills; использован локальный Playwright. New quest smoke находит Windows Chrome или Linux Chrome через CHROME_PATH/список путей; существующие smokes запускались без ослабления проверок.

## Ревью и оставшиеся гейты

Прочитаны оба внешних Markdown review. MINIMAX_QUEST_SCENES_REVIEW.md — завершённый end_turn, но сам текст ограничивает выводы предоставленными фрагментами. MINIMAX_QUEST_REVIEW.md — provisional/max_tokens, не approval. Все рекомендации сверены с текущими seams; MiniMax не ревьюил итоговый diff этой задачи. Отдельное новое независимое model review не заявляется.

Storage best-effort: quota/запрет localStorage не гарантируют durable resume. Нет межвкладочной транзакционности, device/account sync или серверного подтверждения квестов. Уже достигнутое day completion не отменяется откатом checkpoint. Full device FPS/thermal/art acceptance и естественное прохождение кампании не доказаны этими fixtures.

Следующий блокер: незавершённый полный integration-visual-browser (оба запуска с исходным и native Chrome path закончились внешним ETIMEDOUT). Причина не установлена; отдельный focused no-preference390 PASS не заменяет весь gate. Далее нужны hosted CI на будущем опубликованном SHA и физическая MAX/Telegram приёмка. Публикация запрещена этой задачей. Дополнительный HUD остаётся отдельным необязательным scope.

## Воспроизведение окружения

Для Vite/build установлены только dummy legal env: VITE_MAX_BOT_NAME=ofeliya_ci_bot; VITE_DEVELOPER_LEGAL_NAME=CI Test Developer; VITE_DEVELOPER_REGISTRATION=CI-REG-1; VITE_DEVELOPER_ADDRESS=CI Test Address; VITE_SUPPORT_EMAIL=qa@example.test. Release SHA брался git rev-parse HEAD. Сборка до коммита штампует исходный66fc1a9 при dirty candidate tree; это не опубликованный RC и не утверждение о final-head hosted CI. Финальные source hashes находятся в quest-evidence/source-manifest.json.

Финальная проверка перед локальным коммитом: quest-core exit0; quest-runtime exit0; quest-core-mutations exit0 (83/83 + control); focused scenes exit0 (все четыре ширины + отдельный390 no-preference); npx tsc exit0; npm build exit0; diff --check exit0. Build warnings про runtime-config.js и font URL сохранены, настройки/порог проверок не менялись. Четыре project memory файла обновлены.

## Post-commit preservation verification (2026-10-23)

Codex detected that the previous commit replaced historical handoff context with a compact quest summary. Follow-up preserved the complete original 612-line handoff (base 66fc1a9) and full 21-line quest summary (7b5c435) as byte-exact substrings in memory/00_HANDOFF.md.
Historical sha256: 4febee31573c5974ee24e838f11dd4e4671dd287a5de563dd84919ce0b7143de; 70956 bytes.
Quest section sha256: 35fac3ed0b2196b43b1b8bd24fadd8c355ba7e03a138bc121f18fbbe9bed8f9e; 3625 bytes.
No gameplay source changed in preservation follow-up. Full integration-visual-browser ETIMEDOUT remains unresolved. MiniMax post-review was based on excerpts and proves no general absence of defects. Second Codex audit session ended without final report; preservation was independently verified.
