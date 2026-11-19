# Независимое ревью интеграции сдачи MiniMax — 2026-11-20

База проверки — свежий main 168b9d82e8859e2252d79ac8210f53da38381c2c. Команда git log --first-parent --oneline a894547..HEAD вернула, в порядке влития, #303 a3d99fb, #304 2c64eb3, #305 452b9447, #306 d060f92, #308 3f62c5f, #307 4445c3f и #309 168b9d8. Ссылки на строки в этом отчёте относятся к проверенной базе, если рядом явно не указан другой SHA. Протокол — AGENTS.md и memory/00_HANDOFF.md:113. Сдача и план проверялись в копиях из Downloads/Офелия.

## Вердикт и приоритеты

Содержательные изменения D1 можно начинать на этой базе. Первыми в D1 следует сделать различение LEGIT_DEATH/HARNESS_FAIL и проверку фактического рендерера в отчётах. Перед включением PR-джоба или nightly нужны результаты повторяемых прогонов с явными гейтами и исправление измерения паритета по времени. #308 не требует отката. Победный ролик требует отдельного исправления до приёмки пакета видео.

| Приоритет | Находка | Действие |
| --- | --- | --- |
| P0 | Не выявлен на проверенной базе | — |
| P1 | §3. Победа R2 сохранила вспышку 31,8/255 при лимите 25. Движение также пересекло порог предупреждения | Исправить ролик либо явно принять отклонение, подтвердив результат повторным QC игрового MP4 |
| P2 | §3. Четыре видео не имеют согласованного разрешения и кадрирования | Перекодировать под слоты и обновить доказательства или согласовать новые размеры |
| P2 | §1. Утверждение о безусловном replay на следующем буте слишком сильное. Поздний MAX-сигнал может прийти во время другого retry и быть исчерпан | Уточнить гарантии в памяти. Если нужен автоматический replay сразу при смене bridge, сериализовать с отложенным повторным проходом |
| P2 | §2. Явное VITE_QA_TOOLS=0 даёт ложное срабатывание двух гейтов. В памяти также назван неверный запускаемый в CI скрипт | Согласовать гейт с реальным контрактом сборки и исправить указатель в памяти |
| P2 | §2. run.json записывает webgl при любом реальном renderer. Гейт прогресса смотрит на накопительный хэш со счётчиком кадров | Исправить перед использованием этих полей в гейтах |
| P2 | §4/§6. Дневные награды пока не выдаются. Описание лимита сезонной панели потеряло вариант compact на две строки | Сохранить серверную выдачу как открытый пункт. Уточнить ограничение в памяти и проверить UI до сезонной приёмки |

## 1. Фикс гонки счёта (#308)

**Подтверждено.** git diff 3f62c5f^1 3f62c5f -- src/systems/ScoreClient.ts показывает новый Set в ScoreClient.ts:252, запись outbox и синхронный add до fetch на 430–435 и 500–507, delete в finally на 439 и 558. Оба retry-пути проверяют Set на 567 и 597. Между записью и add нет await. main.ts:495–509 запускает эти пути через boot и одноразовый ofeliya:max-bridge-ready, дополнительно сериализуя стартап-проходы внутри страницы. Прогон node по временным CJS-компиляциям ScoreClient с Map вместо localStorage и удержанным первым mock fetch дал:

| Версия | Standard | Daily MAX |
| --- | --- | --- |
| Первый родитель 3f62c5f | 2 POST, один distinct ID | 2 POST, один distinct ID |
| 168b9d8 | 1 POST | 1 POST |

Воспроизведение на уровне модуля выполнялось через node - (PowerShell here-string). Компиляция как в scripts/check-score-outbox.mjs:42–47, контрольный модуль из git show 3f62c5f^1:src/systems/ScoreClient.ts через TypeScript transpileModule. Для каждой ветки вызваны submitRunScore или submitDailyRunScoreDetailed, затем retryPendingDailySubmission до release первого запроса, затем первый запрос завершён ответом 200. Браузерное событие напрямую в этом опыте не вызывалось. npm run test:score-outbox — 29/29, test:daily-v2 и test:daily-cta — PASS. Существующие тесты не превращают модульный Set в блокировку всех возможных вызовов. Сам retry не добавляет ID в Set. scripts/check-score-outbox.mjs:122–132 даже проверяет пересекающиеся вызовы retry на случай потери ответа. Прямой повтор submit для того же Daily ticket использовал бы прежний ID без проверки Set на входе (ScoreClient.ts:494–502).

**Подтверждено отдельно по дуэли.** rg -n 'SCORE_OUTBOX|DAILY_OUTBOX|ofeliya_score_outbox|ofeliya_daily_score_outbox' src нашёл ключи и запись только в ScoreClient. UIScene.ts:2259 и :2561 переиспользует preVideoDuelAttempt, когда он уже создан. DuelClient.ts:58 и :131–148 вызывает fetch через postJson на /api/duel/{id}/attempt, без score-outbox. Эта гонка стартап-ретрая на дуэль не распространяется. Надёжность дуэли при потере ответа за рамками этого вывода.

**Подтверждено с условиями.** Во втором прогоне node - та же Map переживала удаление ScoreClient из require.cache и повторный require, первая доставка оставалась незавершённой. Standard и Daily — по два POST с исходным ID. Ответ 200 с корректным ack, 409, 410, 422 убирал запись в обоих путях. Mock network оставлял запись в обоих. Источники — ScoreClient.ts:347–393, :563–632, scripts/check-score-outbox.mjs:77–120 и :314–341. Для живого Daily 403 даёт denied с сохранением записи, прочий не-OK, разбор JSON и транспортные сбои также сохраняют её. Особый случай — 200 с валидным DTO, но без dailyRunAccepted=true. Живой submit сообщает rejected и сохраняет запись (ScoreClient.ts:529–555). Replay требует явного ack и трактует отсутствие ack как retry. Это синтетическая эмуляция смены контекста, с фиктивной сетью и сохранённым хранилищем.

**Опровергнуто как универсальная гарантия.** На следующем boot запись доступна только при успешной записи и сохранении localStorage. Очередь ограничена восемью записями, возраст — семь суток для записей с меткой времени. Для messenger нужны прежние platform/owner и свежий initData. При временном сбое Daily общий outbox пропускается, при временном сбое первой общей записи текущий проход прекращается. ScoreClient.ts:86–165, :470–501, :563–609. Из index.html:39, src/platform/index.ts:82 и src/main.ts:495–509 также следует узкое окно. Если boot успел пропустить Daily MAX до готовности bridge и завис на браузерной записи общего outbox, то один MAX event в это время вернётся на guard и не поставит второй проход. После завершения браузерной записи повторного входа в Daily уже нет. Это вывод по потоку управления, без оценки частоты на реальном MAX.

**Подтверждено.** Двойной HTTP POST после unload допустим, даже если сервер уже принял первый запрос. Контекст клиента может исчезнуть после серверного commit, пока клиент ещё ждёт сеть или response.json и до settle. Вероятность выше при уходе с экрана сразу после завершения забега и медленном ответе. Численная частота неизвестна. Повторный POST и двойная запись счёта имеют разные условия. server/index.mjs:1683–1763 возвращает accepted receipt для закрытого Daily по ID/hash, а после compaction ticket ищет сохранённую строку по platform/uid/dailyRunId/submissionId/hash. Standard на :1783–1808 ищет прежний score по platform/uid/submissionId, сверяет hash и возвращает прежний результат или 409 для другого payload. После await readBody на :1638 до мутаций score/ticket на :1859–1871 нет асинхронной паузы. Сохранение перед отправкой успешного ответа — :1191. Команда node server/test.mjs завершилась с 0, в частности прошли score submissionId retries return the same score without creating a duplicate и Daily V2: accepted receipts survive ticket compaction and remain owner/payload/run bound. Граница гарантии — поддерживаемый контракт, тот же авторизованный владелец и доступная запись/квитанция в том же хранилище. Клиентский гард устраняет лишнюю отправку в одном контексте. Целостность при повторной доставке защищена и сервером.

## 2. Конструкция харнесса (#307)

**Подтверждено.** gh pr diff 307 -R timoshinoleg-eng/ofeliya --name-only вернул 33 пути, фильтр ^\.github/workflows/ — 0. git diff --name-only 3f62c5f 4445c3f -- .github/workflows — пусто. В git ls-tree -r --name-only 4445c3f .github/workflows нет campaign-nightly.yml. Два конкретных blocker’а из D1-autonomous-campaign-harness-review.md:190–191 исключены из интегрированного дерева. Семантика статуса раннера осталась открытой (scripts/autonomous-campaign.cjs:2208–2215).

**Подтверждено.** main.ts:410–420 содержит DEV || VITE_QA_TOOLS === '1' и динамический import. При незаданных VITE_QA_TOOLS и VITE_RELEASE_MATRIX_QA, с VITE_RELEASE_SHA=168b9d82e8859e2252d79ac8210f53da38381c2c, npm run build выполнил tsc --noEmit, vite build и stamp-release. npm run test:harness-absent → harness absent: ok (2 chunks scanned), npm run test:bundle-shape → bundle shape: ok (js-chunks=2). Фактическая CI-команда — test:bundle-shape в .github/workflows/ci.yml:263. Она проверяет те же строки через scripts/check-build-shape.mjs:26–36. Самостоятельный скрипт scripts/check-harness-absent.mjs:11–29 зарегистрирован в package.json:122.

**Опровергнуто для явного VITE_QA_TOOLS=0.** При таком значении npm run build проходит, оба гейта завершаются с AssertionError по подстроке VITE_QA_TOOLS. Команда rg -o '.{0,70}VITE_QA_TOOLS.{0,70}' dist/review-qa0/assets -g '*.js' показала эту строку в объекте Vite env со значением "0". Отдельный поиск __ofeliyaTest|installAutonomousHarness|test-support по тем же JS не дал совпадений. Это ложный сигнал гейта, утечка Test API этим опытом опровергнута.

**Подтверждено с границей.** git grep по src/test-support для списка setHp/killBoss/setStage/finish/spawnEnemy/skipStage/grantRNA и localStorage дал только вводный комментарий о запретах. Ручная сверка экспортируемого объекта installAutonomousHarness.ts:924–938 и write-sites показала POST_STEP наблюдение и копирование данных для state/log (:376–444, :570–650). Нет подмены score, вызова finish или прямой записи в RunState. Вызовы с побочными эффектами включают очистку Daily intent в registry при старте (:687–711), обычный выбор игрового улучшения, поглощение церемонии с закрытием UI/возобновлением сцены, и commit уже начатого перехода (:822–862). Раннер отдельно сеет профиль через localStorage и снимает snapshot (scripts/autonomous-campaign.cjs:649–653, :767–771). У браузерного API и обвязки разные полномочия.

**Опровергнуто буквально про сцены и дефолт RNG.** git diff 3f62c5f 4445c3f -- src/scenes src/systems/ScoreClient.ts показывает только GameScene.ts:1097, :1121, :1609, :2119 — четыре замены closure на объект RunRng. ScoreClient в #307 не менялся. docs/reviews/autonomous-campaign-harness-implementation-2026-11-18.md:20 это оговаривает, а строка 26 перечисляет изменения неполно. git diff 3f62c5f 4445c3f -- src/game показывает удаление значений по умолчанию = Math.random из DifficultyProfile.ts:210–218, EvolutionSystem.ts:81–86, UpgradeSystem.ts:244–247, LegendarySystem.ts:172–208. Один вызов Math.random в RunRng.ts:50–51 — прежний аварийный источник нового seed; комментарий для allowlist добавлен. Реальные игровые call sites уже передавали elite/progression closures. Ветки и порядок расхода этих потоков сохранены по диффу. npm run test:no-math-random, test:rng, test:legendary — PASS. Первичная детерминированная проверка difficulty прошла, составная команда остановилась на ERR_UNSUPPORTED_ESM_URL_SCHEME при импорте абсолютного Windows-пути. Совпадение RNG-вызовов не доказывает детерминизм длинной кампании.

**Вопросы к гейтам D1.** По rg в .github/workflows ни test:no-math-random, ни run-level determinism gates не вызываются. Хэш в installAutonomousHarness.ts:407–444 включает runTick в накопительную последовательность; scripts/autonomous-campaign.cjs:1584–1604 пытается детектировать остановку по совпадению хэшей. Хэш меняется даже при неизменных игровых полях, пока приходят POST_STEP и растёт счётчик. Кроме того, rg -n 'renderer:' scripts/autonomous-campaign.cjs вернул :2274 renderer: 'webgl' независимо от фактического режима, который main.ts:352 уже умеет различать. Перед сравнением серий нужны достоверный renderer и отдельная проверяемая метрика прогресса. Принятый seeded RNG можно сохранить при этой работе.

## 3. Видео (#305)

**Подтверждено.** git diff --name-only 452b944^1 452b944 показывает пять прежних путей MP4, обновлённые VideoInterstitial.ts, manifest и PREP. Команда git diff --exit-code 452b944^1 452b944 -- public/video/02_bloodstream_to_heart.mp4 вернула 0. Совпали SHA-256 и bytes для всех 6 файлов. Округлённые durations соответствуют VideoInterstitial.ts:23–30 и manifest. По git grep tailHoldSec/blackTail/video-manifest.json в src, public, scripts у этих полей нет runtime-потребителя. VideoInterstitial.ts:139 использует objectFit: cover, а :203 вычисляет таймер по локальному VIDEO_ASSETS. Hold подтверждён декодированием.

| Слот | Длительность, мс | Фактический размер | Одинаковых кадров в конце | Вспышка / движение / яркость хвоста |
| --- | ---: | --- | ---: | --- |
| startIntro | 3167 | 768×1344 | 22 | 16,6 / 34,7 / 18,9 |
| defeat | 3167 | 768×1344 | 22 | 5,4 / 28,2 / 43,3 |
| immunePrimeIntro | 4958 | 768×1344 | 11 | 2,2 / 3,7 / 31,8 |
| cardiacTitanIntro | 4958 | 768×1344 | 11 | 2,8 / 7,1 / 30,4 |
| victory | 5167 | 720×1280 | 1 | **31,8 / 42,1 / 48,1** |
| bloodstreamToHeart (прежний) | 7417 | 540×960 | 1 | 29,4 / 45,4 / 28,5 |

Замер — ffprobe -v error -select_streams v:0 -show_entries stream=width,height,nb_frames,duration,profile,has_b_frames -of json FILE и отдельно -show_entries frame=width,height, сгруппировано по размеру каждого кадра. ffmpeg -v error -i FILE -map 0:v:0 -f framemd5 - для одинаковых последних кадров. Для яркости и движения — ffmpeg -v error -i FILE -vf fps=4,scale=64:112,format=gray -f rawvideo -. По блокам 7168 байт посчитаны максимум разницы средних яркостей соседних кадров, максимум средней абсолютной попиксельной разницы соседних кадров и средняя яркость последних четырёх кадров. Алгоритм сверен с видео-раннером сдачи video/_prompts/run_video_batch.py:440–483 без запуска генерации. Все пять новых потоков — H.264 Constrained Baseline без B-frames.

**Опровергнуто.** В итоговом victory при 0,50 с скачок 31,8 превышает 25, движение 42,1 выше порога предупреждения 40. Хвост светлее 8. Это согласуется с числом для R2 в status.md:69 и противоречит безоговорочному QC в VIDEO_STAGE4_PREP.md:48. R1 с 35,6 отдельно забракован в status.md:56. Утверждение об устранении вспышки заменой R1 на R2 не выдерживает правила по измеряемому порогу. Неизменённый bloodstreamToHeart также превышает два порога по той же методике. Это фон, а не регрессия #305.

**Опровергнуто.** memory/00_HANDOFF.md:3, memory/01_STATE.md:7 и чек-лист video/INTEGRATION-CHECKLIST.md:13–16 указывают 540×960 для start/defeat и 720×1280 для двух боссов. ffprobe вернул 768×1344 на каждом кадре всех четырёх. Иное соотношение сторон и большее число пикселей означают другое кадрирование через cover и потенциально более дорогой декод. Вклад в мобильные задержки не измерялся.

## 4. Декабрьский контент (#303)

**Подтверждено.** src/game/shop/seasonQuests.ts:144–214 — free season.runs-25, season.kills-400, season.rna-6000, season.bosses-4 с выплатами 300 + 250 + 400 + 450 = 1400 РНК. Paid season.kills-2400 и season.mutations-60 дают 1000 РНК и 3 дня бустера. :258–261 определяют границу месяца по UTC; :214 оставляет v1 для неизвестного месяца. :399–425 выдаёт валюту и срочный бустер, без гранта постоянных игровых статов. npm run test:season-quests → season-quests: ok, включая UTC, фолбэк и декабрьский бюджет.

**Подтверждено.** git show a894547:src/quests/questCatalog.ts и rg '^    id:' src/quests/questCatalog.ts дают 12 до интеграции, 18 всего и 18 уникальных сейчас. :132–179 добавляет purge_150, hoard_1200, endurance_240, chimera_5, alpha_9, bulwark_105. npm run test:quest-core и test:quest-runtime — PASS, включая запрет value-полей по scripts/check-quest-core.mjs:273–276.

**Вопросы по выдаче и UI.** В src/quests/questRuntime.ts:42 движок создаётся без rewardGateway. src/quests/questEngine.ts:56–60 и :383–395 оставляет квитанцию local_pending. По git grep -n QuestRewardGateway -- src server worker совпадения есть только в клиентских файлах, рабочего серверного gateway для квестов нет. Поэтому «награды только серверные» описывает контракт, фактической выдачи по новым квестам нет. У сезонного трека отдельная локальная выдача. QuestBoard.ts:136–148 показывает первые 3 строки, в compact первые 2. При четырёх claimable free-миссиях оставшиеся появляются вслед за клеймом и пересортировкой.

## 5. Неизменные запреты

**Подтверждено.** Для каждого из семи merge SHA команда git diff --name-only SHA^1 SHA с фильтром Joystick.ts|check-profile-client.mjs|RunVersions.ts не дала совпадений. Это покрывает и строку scripts/check-profile-client.mjs:162. git diff a894547 HEAD -- package.json показывает только добавление scripts, package-lock.json не менялся в диапазоне. package.json:165–166 содержит прежние @tweenjs/tween.js и phaser. Новый runtime renderer или GSAP/Matter.js/tsParticles среди изменённых файлов и зависимостей отсутствует. RunVersions.ts:5–6 и server/index.mjs:100–101 сохраняют ruleset 3 / campaign 2. Дифф #308 касается outbox, не меняет формат score; сервер в диапазоне семи PR не менялся.

## 6. Точность памяти (#304/#306/#309)

**Подтверждено.** git diff --name-only SHA^1 SHA на 2c64eb3, d060f92, 168b9d8 показал ровно четыре файла memory/ для каждого. git log --first-parent --oneline a894547..HEAD подтверждает порядок и merge SHA. Выборочно gh pr view 309 --json mergeCommit,statusCheckRollup показал 168b9d8… и SUCCESS build / production-contract / browser-smoke / CodeRabbit. memory/00_HANDOFF.md:1 и memory/01_STATE.md:3 верно указывают порядок #308 → #307 и покрытие исходной гонки. memory/00_HANDOFF.md:5 и memory/01_STATE.md:11 согласуются с §4 по бюджету и каталогу. memory/03_BACKLOG.md:1, :3, :5, :13, :17 и план сохраняют D1, вторые ракурсы, трейлер 2K/R3, серверные вознаграждения, деплой и прогон S20+.

**Опровергнуто или требует уточнения.**

- memory/00_HANDOFF.md:3 и memory/01_STATE.md:7 дают неверные размеры четырёх роликов и неквалифицированное «QC-одобрено». memory/02_DECISIONS.md:7 описывает scale+center-crop всего пакета. Контроль по ffprobe на всех кадрах и замер R2 — в §3. Документы о хвостах и duration совпадают с измерениями.
- memory/00_HANDOFF.md:1, memory/01_STATE.md:3, memory/02_DECISIONS.md:3 называют check-harness-absent.mjs как CI-шаг. CI фактически запускает другой скрипт с теми же проверками по строкам. Доказательство и пограничная сборка с VITE_QA_TOOLS=0 — в §2.
- memory/02_DECISIONS.md:3 обещает replay на следующем boot без оговорок. Условия, возможный пропуск после позднего bridge и серверная идемпотентность — в §1.
- memory/03_BACKLOG.md:5 описывает лимит QuestBoard как три строки. На компактной высоте их две, см. §4. Отметку ENOTEMPTY в memory/03_BACKLOG.md:1 следует читать как исторический сбой. На текущем кириллическом пути npm run test:season-quests вышел с 0.
- VIDEO_STAGE4_PREP.md:58 называет manifest источником runtime. Он синхронизирован как каталог и контроль целостности, runtime берёт duration и URL из VideoInterstitial.ts. Строка 62 со старым «MP4 binaries are not yet committed» опровергнута git ls-tree 168b9d8 public/video/ и хэшами §3.

## 7. Полнота против плана

**Подтверждено частично.** По ПЛАН-ДОРАБОТКИ-OFELIYA-2026-11-19.md:19–42, :48–71 и итоговой сдаче (ОТЧЁТ-OFELIYA-2026-11-18.md:27–41) интеграция A, C1/C2 и D1 core имеется, а C3 подготовлен отдельным ЭТАП-4-ПУБЛИКАЦИЯ.md. Вторые ракурсы оставлены на отдельный PR. Две незапущенные генерации из-за 402 отмечены в status.md:182–184 и в memory/03_BACKLOG.md:3. Ручная публикация C3 после деплоя, деплой и телефонный прогон перечислены в плане :62, :75–87. D2-perf-profiling-second-opinion.md:12–30 явно оговаривает замену отсутствующего первоисточника. :55–85 фиксирует пропуск строки в классификации #301 и невоспроизводимый процент. gh pr view 301 --json state,headRefOid → OPEN, 19e5807e02d2645dbf1fab54508e47faa32039e9. Старый head 69f5436e из плана требует сверки при принятии решения.

**Опровергнуто целиком.** Формулировка «всё разблокированное сделано» слишком сильна. У этапа 1 есть невыполненные размерный и измеряемый QC-критерии (план :21–42, §3 этого ревью). Зелёный CI и наличие пяти файлов этих критериев не подтверждают. У этапа 6 принятие решения об оптимизации зависит от телефона. Выдача дневных наград и лимит QuestBoard записаны открытыми.

**Подтверждено для набора B.** Get-FileHash -Algorithm SHA256 и ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 FILE по трём JPEG из ПАБЛИК-НАБОР-B дали 3/3 по MANIFEST.csv:5–7:

| Файл | Размер | SHA-256 |
| --- | --- | --- |
| ofeliya-channel-banner.jpg | 2720×1536 | a09e4086edb9d7afdaf6cc7d6608ffbf1f7dfe7d3727806239607a90a1856b7c |
| ofeliya-shorts-thumbnail.jpg | 1536×2720 | 6eff2d60ec35fb503197f13a0f87525c47ead18006d323965f2a1c47ba6839bd |
| ofeliya-telegram-post.jpg | 2048×2048 | a63802af0d22fe4b635d4a20ac51a2a848220fa9cf2fbc995f5fb190d02d5f17 |

## Unverified

- Реальный reload в Telegram/MAX WebView, частота потерянных ответов и пропуска MAX-ready, крайние случаи системной очистки localStorage. Проверены моковый свежий модуль, локальный сервер и поток управления, без устройства и production.
- End-to-end запуск дуэли, фактическое многорепличное хранилище, live Render/воркер/D1 и живые транзакции. Доказательства ограничены ветками клиента и локальным Node-сервером.
- Исторические цифры длинных прогонов D1, 1x/4x и повторяемость до победы, полный повтор CodeRabbit. Статические выводы и локальные RNG/контрактные тесты этих результатов не заменяют.
- Полный test:difficulty на Windows остановился после первой проверки из-за схемы пути. Исторические 85/86 quest mutation tests и browser smoke тех PR отдельно не воспроизводились в этом локальном проходе.
- Устройство S20+, физический кадринг и цена декода, визуальная приемлемость вспышки, точные моменты событий брифа, независимая покадровая атрибуция каждого источника после lossy encode. Замеры §3 достаточны для опровержения численных клеймов.
- Точный баланс/план MiniMax и текущий статус ручного деплоя/публикации. Проверено наличие документированного отложения, без обращения к аккаунтам.
