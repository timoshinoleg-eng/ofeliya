# PR #291 — исправление P1 и повторный adversarial-аудит монетизации v3

**PR:** https://github.com/timoshinoleg-eng/ofeliya/pull/291
**Ветка:** `feat/monetization-v3`
**База:** `fea41376b4d5143b12f8445e6f816df0f08967bf` (HEAD на момент первого ревью)
**Дата:** 2026-11-17
**Исходное ревью:** `ofeliya-pr291-deep-review-2026-11-17.md` (Muse, 2026-11-17)
**Метод:** три параллельные ветки исправлений (воркер / клиент / витрина) →
интеграция → второй независимый adversarial-аудит на интегрированном HEAD →
раунд 2 (новые P2) → замечания CodeRabbit review 5941028711 → финальная
верификация координатором. Каждое исправление — с RED-тестом на старом коде
и GREEN после. Пуш — через REST API (`gh-update-branch.py`), история
линеаризована ребейзом (мерджи были чистыми, дерево после ребейза
побайтово совпало с деревом до него).

## 1. Исходные P1: статус

| # | Дефект | Статус | Причина | Файлы | Коммиты |
|---|---|---|---|---|---|
| P1-1 | Возврат nonce_reuse-платежа невозможен (`handleAdminRefund` ищет только `payments`) | ✅ Исправлен | Возврат дубликатов — через тот же `refund_ops` state machine; новый статус `duplicate_payments.status` (`pending`→`refund_requested`→`refunded`); без reversal исходной покупки | `worker/src/index.ts`, `worker/src/sql.ts`, `worker/schema.sql`, `worker/migration-17.sql`, `tests/worker-p1-worker.mjs` | `beceb7c` (+ тесты `173adaa`, `200cb35`) |
| P1-2 | Сервер разрешает параллельные подписки | ✅ Исправлен | Три слоя: invoice 409 `subscription-active`/`subscription-pending`, pre-checkout `ok:false`, отклонение в webhook (заказ `denied`, без гранта) + guard-триггер против конкурентной двойной подписки (см. N1) | `worker/src/index.ts`, `worker/src/sql.ts`, `worker/schema.sql`, `worker/migration-17.sql` | `5b45dbb`, `af02740` |
| P1-3 | Потеря триггера = тихая потеря всех грантов | ✅ Исправлен (код + процедура) | `check-schema.mjs` — гейт схемы на изолированных in-memory БД (сверка текста триггера, колонки, UNIQUE, индексы, функциональный тест); read-back кошелька после грант-батча; runbook-гейт + процедура частичной миграции | `worker/scripts/check-schema.mjs`, `worker/scripts/check-schema.test.mjs`, `worker/scripts/v16-schema.fixture.sql`, `worker/src/index.ts`, `worker/README_DEPLOY.md`, `worker/migration-17.sql` | `91369ff`, `150605c`, `3314d4b` |
| P1-4 | Карточка пропуска нечитаема на 320 и 390 | ✅ Исправлен | Полная переработка витрины: измеренные высоты карточек, описание на всю ширину, статус за разделителем, шапка от измеренной подписи, resize-рестарт; Playwright-тест геометрии (18 кейсов) | `src/scenes/StorefrontScene.ts`, `scripts/storefront-layout-smoke.cjs`, `scripts/storefront-capture.cjs` | `bcc1709`, `4063b58`, `fc33e70`, `1b322ba` |
| P1-5 | Возврат пропуска не отзывает его локально (`max(local, server)`) | ✅ Исправлен | Синк серверно-авторитетен: reversal пропуска в батче → `local := server`; защита от устаревших ответов (курсор не отматывается); fail-open при сетевой ошибке | `src/game/shop/ServerWalletSync.ts`, `tests/server-wallet-sync.mjs` | `65213cb` |

Дополнительно из первого аудита исправлены: P2-1 (fail-closed при дубле
компонентов бандла, `8ebca80`), P2-2 (флаг + `cancelSubscription:true`,
`eca4730`), P2-3 (аудит админ-действий `source='admin'`, `eca4730`), P2-5
(идемпотентный ретрай инвойса, `a449d94`), P2-6 (pre-checkout try/catch +
таймаут 8с, `175cf59`), P2-7 (дедуп `app_open`, `460a3e6`), P2-8 (тег −13% →
−5% в Stars, `fa9d729`).

## 2. Новые находки

### P0 — кнопки покупки витрины были ПОЛНОСТЬЮ МЕРТВЫ (найдено исполнителем P1-4, ПОДТВЕРЖДЕНО вторым аудитом живым воспроизведением)

- **Суть:** scroll-catcher лежал ПОВЕРХ списка, а Phaser `topOnly=true` по
  умолчанию отдаёт тап только верхнему объекту. Тап по видимой кнопке не
  начинал покупку (`state: ready`, `lastBought: null` — зонд на `fea4137`,
  390×844). Дополнительно: в `root` копилось ДВА catcher-прямоугольника
  (утечка ре-рендера), а невидимые (замаскированные) кнопки были
  кликабельны — тап в шапку покупал невидимый товар (`lastBought:
  skin.gilded-prime`), т.к. маска режет только отрисовку, а не хит-тест.
- **Масштаб:** тот же catcher есть в `main 2bd6320`. С каталогом из 6
  товаров кнопки были мертвы только на коротких экранах (`scrollLimit>0`);
  v3 (9 товаров + карточка пропуска) сделала это универсальным. Задел ли
  это реальных пользователей — зависит от `VITE_PAYMENTS_API_URL` на Render
  (Этап 0 не выполнен, env, скорее всего, не настроен — тогда магазин был
  скрыт и P0 никого не задел; проверить можно только в дашборде Render).
- **Исправление:** catcher под списком, wheel — на уровне сцены; инпут
  кнопок гасится, когда их центр вне контентной области; утечка
  hit-rectangle закрыта (`4063b58`). Подтверждено зондами на новом коде:
  видимый тап → покупка, замаскированная кнопка → ничего.

### Новые P2 второго аудита (все исправлены в раунде 2)

| # | Находка | Исправление | Коммит |
|---|---|---|---|
| N1 | Конкурентная двойная подписка: проверка `season_pass_until_ms` и грант-батч в вебхуке — отдельные вызовы D1; интерливинг даёт `pass=now+60d` | Guard-триггер `RAISE(ABORT)` для не-продлённых `season_pass`-грантов при активном пропуске (продление — по derived nonce `:`; порядок батча UPDATE orders → INSERT payments → INSERT ledger делает JOIN по payments валидным; дубликатная доставка освобождена через NOT EXISTS). Проверено эмпирически, а не рассуждением | `af02740` |
| N2 | Отклонённый платёж: `/api/verify` возвращает `pending` навсегда, клиент врёт «выдадим автоматически», отклонённая подписка продлевается ежемесячно | Verify возвращает `denied`/`duplicate`; клиент снимает pending и показывает «платёж отклонён, возврат оформляется, поддержка /paysupport»; best-effort авто-отмена подписки при отклонении (идемпотентна, провал — только лог + reconcile). Новое событие `purchase_denied` (43 события в sync) | `4acb449` |
| N3 | Возврат бустера не отзывает его локально (близнец P1-5) | Неттинг по событию: `local := max(server, local + amount)` — вычитается ровно возвращённая длительность, миссионный бустер сохраняется. Наивное зеркало P1-5 (`local := server`) было бы неверно: у бустера есть локальные источники | `212bd69` |
| N4 | Прерванный скролл ПОКУПАЕТ: у кнопок нет порога движения, drag 12px с кнопки — покупка | Порог тапа 10px между `pointerdown`/`pointerup`; покрыто Playwright-зондами (drag 12px → нет покупки, drag 70px → скролл, тап → покупка) | `cefebc2` |

### Новые P3 второго аудита

- **N2 (P3):** `check-schema` не проверял `v17` в `schema_migrations` —
  исправлено (`8600767`).
- **N3 (P3):** `storefront-layout-smoke` без per-case catch: один флейк
  убивал все кейсы — исправлено (`9f0cf40`, + ожидание `window.__game`).
- **N7 (P3):** 409 `subscription-active`/`pending` доходили как generic
  `invoice-create-failed` — исправлено (`eb0f0d4`).
- **P3-10 (вырос из P3):** `/api/wallet` молча обрезал ledger на LIMIT 5000 —
  fresh sync мог пропустить недавний reversal и «воскресить» пропуск —
  исправлено пагинацией (`truncated:true`, `since_seq`, курсор = max
  возвращённого id) (`d98587f`).
- **Не исправлены (наблюдения, не блокеры):** N1-read-back слеп к повторной
  покупке уже имеющегося скина; P3-N4 (воркер v17 против схемы эпохи
  `fea4137` — ловится гейтом); P3-N5 (возврат скина не отзывает его
  локально — предсуществующее, задокументировано как политика); P3-N6
  (провал `cancelSubscription` — только лог); P3-N8 (кнопки гасятся по
  центру — наполовину видимая кнопка кликабельна целиком).

### CodeRabbit review 5941028711 (на `fea4137`, все 7 актуальны на `e73566c` — все исправлены)

| # | Замечание | Исправление | Коммит |
|---|---|---|---|
| CR1 (Minor) | Пустая `OFELIYA_SUPPORT_EMAIL` блокирует VITE-fallback (`??` не ловит `''`) | Первое непустое значение; явно переданный `''` = unconfigured | `39cc85d` |
| CR2 (Minor) | `getCollab('constructor')` возвращает унаследованный конструктор | Own-property check (`hasOwnProperty.call`; `Object.hasOwn` недоступен — tsconfig ES2020) | `e4461e2` |
| CR3 (Major) | Покупка пропуска до известного состояния restore | Блокировка покупки пропуска, пока `restoreState` неизвестен; серверный 409 не дублируется | `ad45004` |
| CR4 (Minor) | Тост о награде миссии (depth 62) под QuestBoard (70, дим 0.96) | Опциональный параметр depth в `showMetaToast` (default 62); из claim — 71. Новый браузерный smoke `test:questboard-toast-depth` | `034dc65` |
| CR5 (Major) | Шапка миграции: «откат воркера на v16 безопасен БЕЗ отката схемы» — НЕВЕРНО (v16 `ON CONFLICT(charge_id)` падает без charge-only UNIQUE) | Только восстановление снапшота; окно «миграция → деплой v17» + митигация задокументированы. Исправлены шапка миграции, README_DEPLOY и ранбук Этапа 0 (вне репо). Доказано на реальном SQLite | `d6a96b4` |
| CR6 (Minor) | Комментарий skin-trio: «повторная покупка — no-op» неверен (P3-1) | Текст комментария исправлен (повторная покупка = вторая active-строка) | `ca09232` |
| CR7 (Minor, денежная) | `stars_renewal_amount_mismatch`: продление с неверной суммой только логируется, вернуть Stars невозможно (not-found) | Запись в `duplicate_payments` (reason `renewal_amount_mismatch`, best-effort, вебхук не падает) перед return; возврат по charge_id возможен | `cf6a5a3` |

Неисправленные P2/P3 первого аудита (P2-4 частично смягчён процедурой;
P3-1, P3-2, P3-3, P3-4, P3-5, P3-6, P3-8, P3-9, P3-11, P3-12) перепроверены
вторым аудитом — не выросли в P1, остаются follow-up.

## 3. RED/GREEN-регрессии и тесты

Каждый пункт закрыт по схеме: тест → RED на старом коде → исправление →
GREEN. Подтверждено исполнителями и перепроверено координатором на
интегрированном дереве (HEAD `55abbfc`, до коммита отчёта).

Финальный прогон координатора на интегрированном дереве (всё зелёное):
- `npx tsc --noEmit`, `npm run build` (`VITE_RELEASE_SHA` = полный SHA HEAD).
- 26 node-сьютов: `test:worker-p1`, `test:worker-round2`,
  `test:check-schema` (12/12), `test:client-experience-app-open`,
  `test:worker-season-pass`, `test:worker-bundles`,
  `test:worker-payments-v4`, `test:worker-payments-v5`,
  `test:worker-entitlements`, `test:stars`, `test:patch16-regress` (6/6),
  `test:patch16-scenarios` (16/16), `test:patch16-concurrency` (7/7),
  `test:shop`, `test:server-wallet-sync`, `test:season-quests`,
  `test:invite-collab`, `test:analytics-events` (43 события в sync),
  `test:analytics`, `test:telegram-bot`, `test:feature-flags`, `test:skins`,
  `test:payments-trust`, `test:quest-core`, `test:language`,
  `test:ui-copy`.
- `node worker/scripts/sql-smoke.test.mjs` (23/23),
  `node server/hosting.test.mjs`, `node worker/scripts/reconcile.test.mjs`
  (6/6).
- `test:storefront-layout` — 18 кейсов, 0 failures (5 вьюпортов ×
  пропуск активен/неактивен, pending-баннер, resize, mock-покупка,
  тап по замаскированной кнопке, tap-threshold, pass-restore-gating).
- `test:questboard-toast-depth` — тост depth 71 > доски 70.

Новые тесты в PR: `tests/worker-p1-worker.mjs`, `tests/worker-round2.mjs`,
`worker/scripts/check-schema.test.mjs`, `tests/client-experience-app-open.mjs`,
`scripts/storefront-layout-smoke.cjs`, `scripts/storefront-capture.cjs`,
`scripts/questboard-toast-depth-smoke.cjs`; новые npm-скрипты
`test:worker-p1`, `test:worker-round2`, `test:check-schema`,
`check-schema`, `test:client-experience-app-open`,
`test:storefront-layout`, `test:questboard-toast-depth` — все заведены в CI.

Поймано интеграцией (не исполнителями): `purchase_denied` (P2-N2) был
добавлен только в клиентский `ProductEvent` — `test:analytics-events`
падал на рассинхроне 4 списков. Исправлено координатором (`5ed6539`):
событие добавлено в `PRODUCT_EVENTS`, Umami `EVENT_NAMES` и
`ANALYTICS_EVENT_NAMES` (43 в sync).

## 4. Отказы инфраструктуры, конкурентность, идемпотентность

- **Конкурентная доставка:** `patch16-concurrency` (7/7, реальные потоки +
  WAL, 100 redelivery → ровно 1 грант); интерливинг двух платежей второй
  подписки на реальном SQLite (N1: до фикса `pass=now+60d`, после —
  guard-триггер откатывает второй батч); параллельные возвраты дубликата
  (P1-1: один `ok`, второй `already:true`, один `refundStarPayment`).
- **Идемпотентность:** повтор возврата (`already:true`), повторный синк,
  дубликатная доставка бандла/продления (`changes==0` → no-op),
  идемпотентный ретрай инвойса (P2-5).
- **Отказы Bot API:** сбой `refundStarPayment` → возобновление execute;
  падение `answerPreCheckoutQuery` → 503 (P2-6); провал авто-отмены
  подписки → вебхук 200 + громкий лог + reconcile-флаг.
- **Отказы D1 / неполное состояние:** отсутствующий/неправильный/исправный
  триггер (`check-schema.test.mjs` 12/12); read-back mismatch при
  отключённом триггере (громкий лог, вебхук 200); миграция v16→v17 на
  фикстуре; v16-инсерт против v17-схемы падает (доказательство CR5);
  воркер v17 против схемы эпохи `fea4137` — ловится гейтом.
- **Сеть/клиент:** сетевой сбой синка — локальное состояние не меняется
  (fail-open); устаревший ответ (`tip_seq <= курсора`) не применяется;
  пагинация `/api/wallet` на 5001 строке (P3-10).

## 5. Витрина до/после

Матрица скриншотов «после»: 54 файла (5 вьюпортов 320×520 / 320×568 /
360×640 / 390×844 / 412×915 × пропуск активен/неактивен × верх + 3
скролл-позиции, pending-баннер, оверлей успеха, Telegram Stars на 320×568
и 390×844) — в `~/workspace/your_files/store-after-*.png`, глазами
проверены 12 ключевых кадров. Ключевая пара — в репозитории:

![До: 320, пропуск неактивен — описание наезжает на статус](assets/store-320-inactive-BEFORE.png)

![После: 320×568 — описание на всю ширину, статус за разделителем](assets/store-320-inactive-AFTER.png)

## 6. Оставшиеся риски и действия перед включением Stars

Кодовых блокеров не осталось. Остаются шаги, которые невозможно выполнить
без доступа к production-инфраструктуре и живым деньгам (за Mark):

1. **Деплой Этапа 0:** D1-инвентаризация (`wrangler d1 list`, не создавать
   дубликат) → миграция v16→v17 со снапшотом → **жёсткий гейт
   `check-schema`** (триггер, UNIQUE, маркер v17) → деплой воркера v17
   НЕМЕДЛЕННО после миграции (окно «миграция → деплой v17»: v16-воркер
   против v17-схемы роняет гранты; альтернатива — пауза платёжного трафика).
2. **Живые проверки Stars:** первая покупка каждого товара; продление на
   30-й день; возврат + отмена подписки; cold-start Render Free против
   10-секундного pre-checkout; `/paysupport` в Telegram.
3. **Проверить в дашборде Render,** был ли настроен `VITE_PAYMENTS_API_URL`
   до мержа #291 (если да — пользователи Telegram видели мёртвую витрину
   с #258; оценить, нужны ли коммуникации).
4. **Принятые риски (задокументированы):**
   - P1-2/N1: abort батча зависит от ретрая Telegram в denied-путь; если
     ретрай не придёт, платёж виден только через reconcile
     `telegram_without_d1` (та же экспозиция, что у любого 503 сегодня).
   - N2: провал авто-отмены подписки виден только через лог +
     `duplicate_without_refund` в reconcile.
   - P3-10: старый воркер (до фикса) не шлёт `truncated` — runbook:
     воркер обновляется первым.
   - P2-4: миграция по-прежнему нетранзакционна (wrangler) — процедура
     восстановления в шапке, исход проверяется гейтом.
   - Drag, начавшийся на кнопке витрины, по-прежнему не скроллит
     (pre-existing, принято).
   - `restoreState='known'` = «restore попытались», а не «успешно»;
     бэкстоп — серверный 409.
   - Read-back — только детекция, не предотвращение; восстановление —
     вручную из `wallet_ledger`.
5. **Follow-up (не блокеры):** P3-1, P3-2, P3-3, P3-4, P3-5, P3-6, P3-8,
   P3-9, P3-11, P3-12; S20+ acceptance витрины и живого боя.

## 7. Вердикт: READY FOR MERGE

Все пять P1 исправлены и покрыты регрессиями; второй аудит подтвердил
исправления живыми прогонами и не нашёл новых P0/P1; новые P2 (N1–N4) и
все 7 замечаний CodeRabbit закрыты; регрессий не найдено; 26 node-сьютов +
браузерные тесты зелёные локально; CI-шаги подключены. Мердж заметно
УЛУЧШАЕТ production (мёртвые кнопки покупки → рабочие). Мердж сам по себе
платежи не включает (воркер деплоится отдельно).

## 8. Вердикт: NOT READY FOR LIVE PAYMENTS

Не из-за кода — кодовых блокеров не осталось, — а потому что включение
живых денег требует шагов из §6, которые выполняются только на production-
инфраструктуре: деплой Этапа 0 с гейтом схемы, тест живыми Stars по
каждому товару, продление на 30-й день, возврат + отмена подписки,
cold-start Render Free. До их выполнения платежи включать нельзя.

## 9. Финальный HEAD, коммиты, PR, CI

- **PR:** https://github.com/timoshinoleg-eng/ofeliya/pull/291
- **База:** `fea41376b4d5143b12f8445e6f816df0f08967bf`
- **Локальный HEAD кода (до коммита отчёта):** `e1936384418f683c9c7495133a37049eda8b69bf`
  (линейная история, 37 коммитов; дерево побайтово совпадает с деревом
  мерджей `8bfe0c9` + фиксов)
- **Удалённый HEAD (код, после REST-пуша):**
  `699be90b51af76786d287318e76f0eb129accb42` (дерево сверено с локальным:
  `ff54ce730a8fea64e4263ea845863d34465562bf` — совпадает). REST API
  пересоздаёт коммиты с новыми SHA (нормализация дат GitHub), содержимое
  и порядок сохранены; соответствие локальных и удалённых SHA — в логе
  пуша (`/tmp/push1.log`).
- **Финальный HEAD (с отчётом):** коммит отчёта поверх `699be90` — см.
  историю ветки после пуша отчёта.
- **Дифф к базе:** 50 файлов, +6646/−533

Коммиты (локальные SHA после ребейза; порядок = порядок в ветке):

```
65213cb fix(shop): server-authoritative season pass in wallet sync (P1-5)
460a3e6 fix(analytics): dedupe app_open against the slow MAX bridge (P2-7)
fa9d729 fix(shop): discount tags computed in Stars, not showcase RUB (P2-8)
200cb35 test(worker): d1 stub supports duplicate_payments, pending-order select, denied orders
173adaa test(worker): RED tests for P1-1/P1-2/P1-3/P2-1/P2-2/P2-3/P2-5/P2-6
beceb7c fix(worker): P1-1 refund duplicate_payments charges via admin API
5b45dbb fix(worker): P1-2 server-side ban on second subscription while pass active
8ebca80 fix(worker): P2-1 fail-closed on duplicate bundle components
eca4730 fix(worker): P2-2 refund flags uncancelled subscription; P2-3 admin audit
a449d94 fix(worker): P2-5 idempotent /api/invoice retry on lost response
175cf59 fix(worker): P2-6 guard pre-checkout Bot API call with timeout
91369ff fix(worker): P1-3 grant read-back after grant batch
150605c feat(worker): P1-3 D1 schema gate script (check-schema.mjs)
3699227 feat(worker): reconcile covers duplicate_payments (P1-1/P1-2)
3314d4b docs(worker): P1-3 schema gate + P2-2 two-step refund + P2-4 recovery
bcc1709 test(storefront): add layout geometry smoke (P1-4, RED)
4063b58 fix(storefront): adaptive card layout with measured heights (P1-4)
fc33e70 test(storefront): dismiss success overlay by tap in smoke test
1b322ba test(storefront): add screenshot capture matrix script
0a689f4 ci: wire worker P1 remediation and D1 schema gate contracts
af02740 feat(worker): P2-N1 guard trigger against concurrent double subscription
8600767 fix(worker): P3-N2 check-schema requires v17 marker in schema_migrations
4acb449 fix(payments): P2-N2 denied payments stop returning pending forever
212bd69 fix(client): P2-N3 booster refund revokes locally via event netting
d98587f fix(payments): P3-10 paginate /api/wallet past the 5000-row page
9f0cf40 fix(tests): P3-N3 per-case catch in storefront-layout-smoke
cefebc2 fix(ui): P2-N4 tap threshold — interrupted scroll no longer buys
eb0f0d4 fix(client): P3-N7 surface 409 subscription-active/pending distinctly
39cc85d fix(bot): CR1 empty OFELIYA_SUPPORT_EMAIL no longer blocks VITE fallback
e4461e2 fix(shop): CR2 getCollab requires an own registry property
ad45004 fix(ui): CR3 block season-pass purchase until restore state is known
034dc65 fix(ui): CR4 mission-reward toast renders above the QuestBoard
d6a96b4 fix(docs): CR5 rollback to v16 worker is NOT safe on the v17 schema
ca09232 fix(docs): CR6 correct the skin-trio repurchase comment (P3-1)
cf6a5a3 fix(worker): CR7 mismatched renewal is recorded as duplicate, refundable
5ed6539 fix(analytics): sync purchase_denied (P2-N2) across server/umami/summary allowlists
e193638 docs(memory): P1 remediation state, decisions, backlog, handoff
```

- **CI:** запускается на пуше; статус — в PR (check-runs на финальном HEAD).
  Локально все контракты зелёные (см. §3–§4).

## 10. Раунд 3: CodeRabbit review 5943019617 (на `6f610ae`)

Ревью поступило 2026-11-17T17:05:03Z на HEAD `6f610ae` (после пуша
раунда P1), state COMMENTED, 13 actionable + 1 nitpick. Мердж был
приостановлен владельцем до исправления. Все 14 пунктов сверены с кодом
на `6f610ae` — **ложных срабатываний нет, все 14 подтверждены и
исправлены**, каждое с RED-тестом на старом коде и GREEN после.
Пункты 1–5 были предварительно подтверждены главным агентом чтением
кода; треки перепроверили их независимо.

| # | Замечание | Статус | Фикс | Файлы | Коммиты |
|---|---|---|---|---|---|
| 1 | Redelivery первой оплаты пропуска: валидный платёж → duplicate_payments, заказ denied, отмена действующей подписки (Major, деньги) | ✅ Исправлен | Дедуп по charge_id ДО active-pass check: сохранившийся `nonceRow` с тем же charge_id → `stars_payment_duplicate`, no-op; доп. запроса в D1 нет (строка уже прочитана). Настоящий второй платёж по-прежнему отклоняется, продления по-прежнему грантятся | `worker/src/index.ts`, `tests/worker-p1-worker.mjs` | `941179d` (+ RED `11e80b0`) |
| 2 | Падение `createInvoiceLink` оставляет pending-заказ → блок подписки на 24ч (Major, деньги) | ✅ Исправлен | В catch-пути заказ → терминальный `invoice_failed` (best-effort); CHECK на статусы в схеме нет — миграция не нужна; статус задокументирован в `schema.sql`, включён в 30-дневную чистку. Брошенные инвойсы с УДАВШИМСЯ созданием по-прежнему блокируют 24ч. Same-nonce ретрай такой заказ не воскрешает (клиент генерирует свежий nonce на попытку) | `worker/src/index.ts`, `worker/src/sql.ts`, `worker/schema.sql`, `tests/worker-p1-worker.mjs` | `71ee431` (+ RED `11e80b0`) |
| 3 | Гейт схемы не ловит старый UNIQUE(charge_id) на `wallet_skins` при частичной миграции (Major, деньги/гейт) | ✅ Исправлен | `checkDatabase` инспектирует unique-индексы `wallet_skins`, отклоняет любой уникальный индекс ровно по `(charge_id)` (чек `wallet-skins-no-charge-unique`); регрессия строит частичное состояние и доказывает слепоту старого гейта | `worker/scripts/check-schema.mjs`, `worker/scripts/check-schema.test.mjs` | `7826c35` (+ RED `11e80b0`) |
| 4 | Команда гейта `node worker/scripts/...` после `cd worker` — неверный путь (Minor) | ✅ Исправлен | `node scripts/check-schema.mjs --print-commands`; весь README проверен на аналогичные ошибки. Бонус: `npm run check-schema` в том же блоке тоже не работал (скрипта нет в `worker/package.json`) — заменён на прямой `node scripts/check-schema.mjs` | `worker/README_DEPLOY.md` | `7256595` |
| 5 | Откат снапшотом стирает платежи после снапшота (Major, процедура) | ✅ Исправлен | Пауза платёжного трафика от создания снапшота до завершения отката (проверенный рычаг вебхука + оговорка: кодового kill-switch инвойсов нет); перед восстановлением — полный экспорт живой базы + сверка пост-снапшотных платежей; после — возврат либо ручное переприменение гранта (пропуск — только возврат: в v16 нет колонки/ветки). Та же правка — в шапке `migration-17.sql` и в ранбуке Этапа 0 (строка 217) | `worker/README_DEPLOY.md`, `worker/migration-17.sql`, ранбук (вне репо) | `7256595`, `da1223a` |
| 6 | Возврат истёкшей покупки бустера съедал миссионную награду (Major, деньги) | ✅ Исправлен | Неттинг P2-N3 заменён банком заработанного времени: серверный снапшот авторитетен для купленной компоненты, миссионный банк (`MetaWallet.boosterEarnedMs` + `boosterEarnedAnchorMs`) складывается поверх | `src/game/shop/ServerWalletSync.ts`, `src/game/meta/MetaWallet.ts`, `tests/server-wallet-sync.mjs` | `722b6e1` (+ RED `d6f902e`) |
| 7 | Покупка бустера ЗАМЕНЯЛА миссионное время (3+7=7) (Major, деньги) | ✅ Исправлен | Банк персистентен: 3+7=10, повторный синк идемпотентен; ожидание в тесте обновлено с b0+7d на b0+10d | `src/game/shop/ServerWalletSync.ts`, `src/game/meta/MetaWallet.ts`, `tests/server-wallet-sync.mjs` | `722b6e1` (+ RED `d6f902e`) |
| 8 | Stale-ответ воскрешал отозванный бустер (Major, деньги) | ✅ Исправлен | Бустер не трогается при устаревшем ответе, как пропуск. Асимметрия: бустер использует строгий `tip < cursor` (равный tip — та же история, журнал append-only), пропуск сохраняет `<=` по контракту P1-5 §в — задокументировано в коде | `src/game/shop/ServerWalletSync.ts`, `tests/server-wallet-sync.mjs` | `722b6e1` (+ RED `d6f902e`) |
| 9 | Курсор захватывался до сети: двойное начисление РНК, откат курсора (Major, деньги) | ✅ Исправлен | Курсор перечитывается из хранилища непосредственно перед синхронным блоком применения, запись — через свежую карту. Фикс опирается на синхронность блока (без await между перечитыванием и записью) — отмечено комментарием | `src/game/shop/ServerWalletSync.ts`, `tests/server-wallet-sync.mjs` | `e7e8004` (+ RED `cbaab54`) |
| 10 | Resize во время покупки терял гейт (Major) | ✅ Исправлен | Generation token + `inFlightPurchase`, переживающий рестарт: бухгалтерия дорабатывает, UI чужого поколения не трогается, кнопки обновляются по завершении | `src/scenes/StorefrontScene.ts`, `scripts/storefront-layout-smoke.cjs` | `597f512` (+ RED `6297be9`) |
| 11 | Частично замаскированная кнопка покупала (Minor) | ✅ Исправлен | Input включён только когда ВСЯ кнопка внутри контентной области; тап по невидимой части больше не покупает (подтверждено Playwright: до фикса покупал `skin.virulent-magenta`) | `src/scenes/StorefrontScene.ts`, `scripts/storefront-layout-smoke.cjs` | `0de88ad` (+ RED `6aec14d`) |
| 12 | `app_open` помечался seen при полном буфере → сессия без открытия (Minor) | ✅ Исправлен | `appOpenSeen` ставится только после успешной отправки (`track()` вернул true) или принятия в буфер; подавление после принятого `app_open` сохранено | `src/systems/ClientExperience.ts`, `tests/client-experience-app-open.mjs` | `ec73e87` (+ RED `da2f4d1`) |
| 13 | Восстановление инвойса по текущей цене каталога вместо stored (Minor, деньги) | ✅ Исправлен | Ретрай — по `existing.amount_stars`, новые заказы — по-прежнему по каталогу; NULL/битая stored-цена — fail-closed 502 `order-price-invalid` | `worker/src/index.ts`, `tests/worker-p1-worker.mjs` | `fddd4c2` (+ RED `11e80b0`) |
| 14 | Masked-button probe недетерминирован (молчаливый skip) (Nitpick) | ✅ Исправлен | Детерминированный выбор цели: первая карточка, чью кнопку можно поставить центром в середину полосы шапки подбором scroll offset; нет цели или промах — провал кейса, ветки `skipped` больше нет | `scripts/storefront-layout-smoke.cjs` | `9049ef6` |

Пропущенных пунктов нет. Новых P0/P1 в раунде 3 не найдено.

### RED/GREEN (раунд 3)

- Воркер (изолированный откат каждого фикса): без CR-R3-1 —
  `redelivered charge NOT in duplicate_payments` падает; без CR-R3-2 —
  `expected 200, got 409`; без CR-R3-13 — `expected 50, got 35`; без
  CR-R3-3 — гейт пропускает частичную миграцию.
- Клиент: 6 — возврат срезал 1 день награды (b0+5d → b0+4d); 7 — 3+7
  давало 7; 8 — откат сервера возвращал бустер b0 → b0+7d; 9 — два
  конкурентных синка начисляли РНК дважды (500 → 1000), курсор
  откатывался 3 → 1; 10 — Playwright: после resize вторая покупка
  начиналась, завершение первой переписывало UI новой генерации;
  11 — Playwright: тап по невидимой части реально купил
  `skin.virulent-magenta`; 12 — 48 событий + `app_open` → 0 открытий.
- Доки/тесты: хрупкость probe подтверждена пробником геометрии
  (полоса шапки 77 px, шаг центров 157–225 px — в полосу случайно
  попадала только одна кнопка).

### Оговорки и принятые решения (раунд 3)

- Банк бустера — длительность, а не окно: модель «3+7=10» складывает
  полное миссионное время даже при перекрытии с купленным окном
  (семантика ревью); полное истечение (local <= now) банк обнуляет.
- Мок-гранты vs строгий пересчёт: локальное время из неизвестных
  синку источников (QA-мок, `grantPurchase`) сохраняется веткой без
  событий бустера; батч с событиями бустера пересчитывает строго
  (серверно-авторитетно). Комбинация «мок-грант + реальный возврат»
  сотрёт мок-время — только QA-путь, принято осознанно.
- Кодового kill-switch для остановки новых инвойсов не существует —
  пауза трафика опирается на прокси-рычаг вебхука + окно минимальной
  активности + пост-проверку (follow-up в 03_BACKLOG.md).
- Попутное наблюдение (не баг): в тесте CR-R3-3 `ALTER TABLE … RENAME`
  падает, пока жив триггер на удаляемую таблицу; настоящая миграция
  избегает этого порядком шагов (шаг 3 сносит `wallet_ledger` с
  триггерами до шага 3b).

### Верификация интегрированного дерева (раунд 3)

- `tsc --noEmit` — чистый; `vite build` + stamp — зелёный.
- Node-сьюты: **101/103** зелёных; 2 красных — только окружение:
  `test:telegram-compose` (нет docker в VM — `spawnSync('docker')`
  даёт `status: null`) и `test:mobile-evidence` (нет
  `artifacts/mobile-acceptance.json`) — оба не связаны с раундом 3.
- `sql-smoke` 23/23, `reconcile` 6/6, `hosting` — зелёные.
- `test:storefront-layout` (Playwright, интегрированный скрипт) —
  **20/20, 0 failures**, 0 вхождений `skipped`; новые кейсы
  `partially-masked-button-tap` и `resize-during-purchase` зелёные.
- `test:check-schema` — 13/13 (вкл. новый чек
  `wallet-skins-no-charge-unique`).

### CI: флейк crossflow (не регрессия раунда 3)

Первый CI на `d5c51ed` (run 44143141804) уронил browser-smoke на шаге 8
(`test:muse-convergence-crossflow`, Phase 1): `sdkRequests` был 0 вместо 1
после двух конкурентных `ensureTelegramBridge(8/25)`. Расследование:
локально тот же код — падение 1 раз, затем 3/3 зелёных без изменений;
база `6f610ae` локально зелёная; решающее доказательство — run 44142985719
на `131a156` (тот же код, что `d5c51ed`, отличается только docs-коммитом
с SHA) завершился success, включая browser-smoke. Раунд 3 не трогает ни
загрузчик SDK (`src/platform/TelegramBridgeLoader.ts`), ни этот тест.
Причина — гонка тайминга: скрипт добавляется синхронно, но браузер на
медленной машине (SwiftShader, кадры ~100 мс) диспатчит запрос позже
25-миллисекундного окна, а тест утверждал счётчик сразу после
`Promise.all`. Фикс — только тест (`df8e4da`): ограниченное ожидание
(до 2 с) появления запроса до утверждения `=== 1`; контракт «один общий
запрос» не ослаблен.

### Вердикты (подтверждены после раунда 3)

- **READY FOR MERGE** — все 5 P1 (§1), все пункты раунда 2 (§2) и все
  14 замечаний CodeRabbit review 5943019617 исправлены и покрыты
  регрессиями; новых P0/P1 не найдено.
- **NOT READY FOR LIVE PAYMENTS** — без изменений относительно §8:
  остаются Этап 0, живые тесты Stars, продление на 30-й день.

### Коммиты раунда 3 (поверх `6f610ae`, remote SHA; история линеаризована ребейзом перед REST-пушем, дерево идентично)

```
11e80b0 test(worker): CR-R3 RED — redelivery dedup, invoice-failure gate, stored price, skins UNIQUE
941179d fix(worker): CR-R3-1 dedup redelivered season-pass payment before active-pass check
71ee431 fix(worker): CR-R3-2 mark order invoice_failed when createInvoiceLink fails
fddd4c2 fix(worker): CR-R3-13 rebuild recovered invoice at the stored order price
7826c35 fix(worker): CR-R3-3 schema gate rejects obsolete UNIQUE(charge_id) on wallet_skins
da2f4d1 test(client): CR-R3-12 dropped app_open at full buffer must fall back
ec73e87 fix(client): CR-R3-12 mark app_open seen only after accept
d6f902e test(client): CR-R3-6/7/8 booster bank scenarios (RED)
722b6e1 fix(client): CR-R3-6/7/8 booster earned bank replaces event netting
cbaab54 test(client): CR-R3-9 concurrent syncs must not double-apply (RED)
e7e8004 fix(client): CR-R3-9 re-read persisted cursor before applying a response
6aec14d test(client): CR-R3-11 partially-masked button tap must not buy (RED)
0de88ad fix(client): CR-R3-11 disable input unless the whole button is in view
6297be9 test(client): CR-R3-10 resize during purchase must keep the gate (RED)
597f512 fix(client): CR-R3-10 keep the purchase gate across resize
7256595 fix(docs): CR-R3-4/5 deploy README — schema-gate paths after cd worker, rollback must preserve post-snapshot payments
9049ef6 test(storefront): CR-R3-14 make masked-button probe deterministic
da1223a fix(docs): CR-R3-5 migration-17 rollback header — snapshot restore alone loses post-snapshot payments
7f096e0 docs(memory): CodeRabbit round 3 state, decisions, backlog, handoff
131a156 docs(reviews): CodeRabbit round 3 report (review 5943019617, PR #291)
```

- **CI:** запускается на пуше; статус — в PR (check-runs на
  финальном HEAD). Локально все контракты зелёные (см. выше).

### Примечание о SHA в §1 и §9

SHA коммитов в таблицах §1 и §9 — локальные, до ребейза и REST-пуша
раунда P1: GitHub пересоздал коммиты с новыми SHA. Карта соответствия
локальных и удалённых SHA жила в `/tmp/push1.log` и больше недоступна;
актуальные SHA — в истории ветки на GitHub (HEAD `6f610ae` и ниже).

## 11. Раунд 4: CodeRabbit review 5944088831 (follow-up на код раунда 3)

Ревью поступило 2026-11-17T18:14:51Z на промежуточный HEAD раунда 3
`d5c51ed`, state COMMENTED, 5 actionable. К моменту его появления PR #291
был уже готов к мерджу (CI 4/4 на `9d2bb4b`); мердж НЕ был приостановлен:
ревью не блокирующее, P0/P1-класса замечаний в нём нет (проверено главным
агентом чтением всех 5 комментариев до мерджа). Все 5 пунктов исправлены
отдельным follow-up раундом 4 на новой ветке
`fix/coderabbit-round4-291` от main `e65635f` (merge commit PR #291).
Каждый пункт сверен с кодом на `e65635f` — **ложных срабатываний нет,
все 5 подтверждены и исправлены**; кодовые — с RED-тестом на старом коде
и GREEN после.

| # | Замечание | Статус | Фикс | Файлы | Коммиты |
|---|---|---|---|---|---|
| 1 | Банк бустера добавляет ПОЛНУЮ миссионную длительность без учёта прошедшего времени: миссия 3д в T + покупка 7д в T+1 → T+11 вместо T+10 (Major, деньги) | ✅ Исправлен | Elapsed-aware учёт (решение владельца, см. ниже): остаток `anchor > now ? bank : max(0, anchor + bank − now)`; `computed = max(серверный срок, now) + remaining` при остатке > 0; при принятии пересчёта персистятся остаток и его якорь; исчерпанный остаток обнуляет банк. Якорь 0 при живом банке (легаси раунда 3) мигрируется как `local − bank` | `src/game/shop/ServerWalletSync.ts`, `src/game/meta/MetaWallet.ts`, `tests/server-wallet-sync.mjs` | `6942b40` (+ RED `0acdbc6`) |
| 2 | Безусловный `invoice_failed` при провале ретрая инвалидирует инвойс, уже выданный ранней same-nonce попыткой (Minor, деньги) | ✅ Исправлен | Маркер выдачи `orders.invoice_url TEXT` (NULL = не выдавался): после успешного `createInvoiceLink` атомарный UPDATE записывает URL и CASE-ем оживляет заказ из `invoice_failed` обратно в `pending`; same-nonce ретрай переиспользует сохранённый URL без повторного вызова Telegram; `invoice_failed` — только при `invoice_url IS NULL`. Закрывает оба конкурентных порядка. Схема обновлена синхронно: `schema.sql` + `migration-17.sql` + гейт `check-schema.mjs` (реальная D1 ещё не существует, изменение до деплоя допустимо) | `worker/src/index.ts`, `worker/src/sql.ts`, `worker/schema.sql`, `worker/migration-17.sql`, `worker/scripts/check-schema.mjs`, `tests/worker-p1-worker.mjs`, `tests/d1-v16-stub.mjs`, `tests/worker-payments.mjs`, `tests/patch16-regress.mjs`, `worker/scripts/sql-smoke.test.mjs` | `28e15df` (+ RED `222b288`) |
| 3 | Возвраты пост-снапшотных платежей — ПОСЛЕ восстановления снапшота, когда refund уже даёт not-found (Major, процедура) | ✅ Исправлен | Порядок изменён: возвраты — ДО восстановления, пока живы v17-хендлер и строки `payments`; после restore — только ручное переприменение грантов НЕ-пропусков/НЕ-бандлов. Пропуск — только возврат до restore, двухшаговый (§10: деньги + отмена подписки, оба шага до restore). Та же правка — в шапке `migration-17.sql` и в ранбуке Этапа 0 (строка 217) | `worker/README_DEPLOY.md`, `worker/migration-17.sql`, ранбук (вне репо) | `d37ad40` |
| 4 | Реплей компонентов бандла напрямую в v16 (Major, процедура) | ✅ Исправлен | Бандлы при откате — только возврат, как пропуск; прямой реплей запрещён без валидированной процедуры конверсии (v16 ledger — одна строка на `charge_id`, `wallet_skins.charge_id` UNIQUE). Та же правка — в шапке `migration-17.sql` и в ранбуке (строка 217) | `worker/README_DEPLOY.md`, `worker/migration-17.sql`, ранбук (вне репо) | `d37ad40` |
| 5 | 5-секундный таймер в resize-тесте: корректно завершённая покупка может уронить тест (Minor, тест) | ✅ Исправлен | Явный release-сигнал (`window.__releasePurchase`): покупка висит pending через gate assertions, релиз — только после них; затем тест явно ждёт завершения (поллинг лейбла кнопки, таймаут 10 с) перед проверкой entitlement и повторной покупкой. Фиксированный `sleep(5000)` удалён | `scripts/storefront-layout-smoke.cjs` | `66980a6` |

Пропущенных пунктов нет. Новых P0/P1 в раунде 4 не найдено.

### Семантическое решение по банку бустера (пункт 1)

Трек раунда 3 сознательно выбрал «банк — длительность, а не окно»
(решение 4 в `memory/02_DECISIONS.md`, §10 «Оговорки»). Раунд 4
проверил, есть ли у этой модели продуктовое обоснование: в
`STRAIN_ZERO_PRODUCT_BIBLE.md` слово «booster» не встречается вообще;
единственные источники длительность-модели — сам трек раунда 3.
Продуктового дизайн-указателя нет — это был выбор исполнителя, а не
решение дизайна. Владелец принял решение: **elapsed-aware учёт**
(остаток + anchor, T+10). Переплата времени в пользу игрока — тоже баг,
хоть и мягкий. Строка §10 «Оговорки» («Банк бустера — длительность,
а не окно») тем самым **superseded** — это историческая запись раунда 3,
она не правится задним числом.

### RED/GREEN (раунд 4)

- Пункт 1: RED (§4g) — `expected 1795813739984, got 1795900139984`
  (ровно +1 день, 86 400 000 мс); GREEN — T+10, персист остатка 2д +
  якоря T+8д, идемпотентность повторного синка, покупка в T+9д
  (1д остатка → T+17д), легаси-состояние с якорем 0 (без строки
  миграции награда терялась целиком). Регрессии CR-R3-6/7/8 зелёные.
  Бустерные секции 4a–4g идут с замороженным `Date.now` (иначе точные
  ожидания разъезжаются на миллисекунды реального времени между claim
  и синком — следствие elapsed-семантики, а не флейк).
- Пункт 2: RED — seq `expected 200, got 502` (ретрай не переиспользовал
  URL); оба конкурентных порядка — `expected "pending", got
  "invoice_failed"`; GREEN — `worker-p1: all assertions passed`,
  ретрай возвращает ТОТ ЖЕ URL при 1 вызове Telegram; регрессия CR-R3-2
  (первая попытка без инвойса → `invoice_failed`) сохранена. Сценарий 15
  в sql-smoke на реальном SQLite: store / условная пометка / revive /
  paid не трогается (24/24).
- Пункт 5: RED — временная задержка 5000→50 мс, кейс
  `resize-during-purchase` — 5 failures, первый ровно по механизму
  («кнопка — '149 ₽' вместо '···'»); GREEN — явный release-сигнал,
  один кейс 3/3, полный `test:storefront-layout` 3/3 прогонов ok.
- Пункты 3/4 (доки): верифицированы чтением кода — v16-хендлер
  (`2bd6320:worker/src/index.ts:1181`) возвращает `not-found` без
  строки `payments`; v16-схема (`v16-schema.fixture.sql:173,190`)
  — `UNIQUE(charge_id)` на `wallet_ledger` и `wallet_skins`;
  v16-код — `ON CONFLICT(charge_id) DO NOTHING`.

### Оговорки и принятые решения (раунд 4)

- Поздний синк после возврата: `base = max(серверный срок, now)`
  вместо голого серверного срока — при будущем хвосте и давнем возврате
  старый код давал срок в прошлом и награда терялась из-за позднего
  синка; теперь хвост стартует от now. В духе CR-R3-6 («возврат не
  съедает награду»), в бриф явно не входило — задокументировано
  комментарием в коде.
- Попутно закрыта латентная странность: при серверном сроке 0 и будущем
  хвосте старый код считал `computed = 0 + bank` (эпоха 1970); теперь
  `now + остаток`.
- Намеренное изменение поведения P2-5: same-nonce ретрай теперь
  возвращает ТОТ ЖЕ URL вместо нового (1 вызов Telegram вместо 2).
  Разрешено брифом пункта 2 («ретрай может переиспользовать
  сохранённый URL»), тесты обновлены.
- Остаточный риск: запись `invoice_url` — best-effort с громким логом
  `invoice_url_store_error`; при ошибке D1 ретрай деградирует до
  поведения до CR-R4-2 (re-issue + условная пометка по NULL). Денег
  не теряется, только старый баг в этом редком кейсе.
- Строка §10 «Оговорки» про банк бустера superseded (см. семантическое
  решение выше).

### Верификация интегрированного дерева (раунд 4)

- `tsc --noEmit` — чистый; `vite build` + stamp — зелёный.
- Полный прогон всех 128 `test:*`: **120 зелёных**. 5 падений —
  предсуществующие: `video`, `comprehension`,
  `integration-visual-browser`, `quest-scenes`,
  `difficulty-comparison-browser` падают так же на чистом base
  `e65635f` (отдельный worktree, тот же dev-сервер) — таймауты
  `waitForFunction` / контекст на медленной VM, раунд 4 эти области
  не трогает. 3 падения — только окружение: `visual-matrix` (нет
  pngjs), `telegram-compose` (нет docker), `mobile-evidence` (нет
  `artifacts/mobile-acceptance.json`) — те же причины, что в раундах
  P1/3. Первый прогон без dev-сервера дал 16 ложных падений
  (`ERR_CONNECTION_REFUSED` на 5173) — повтор с сервером их закрыл;
  `biological-impact-smoke` требует `OFELIYA_BASE_URL` (по умолчанию
  порт 4175) и зелёный против dev-сервера (3 cells, 0 deviations).
- `sql-smoke` 24/24 (было 23, +1 CR-R4-2), `reconcile` 6/6,
  `check-schema` 13/13 (миграция v16→v17 на node:sqlite проходит,
  гейт видит `invoice_url`).
- `test:storefront-layout` — 3/3 прогонов ok (0 failures).
- `test:server-wallet-sync`, `test:shop` (4/4), `test:skins` —
  зелёные; все воркер-сьюты + patch16 (6/6, 16/16, 7/7) — зелёные.

### Вердикты (подтверждены после раунда 4)

- **READY FOR MERGE** — все 5 замечаний CodeRabbit review 5944088831
  исправлены и покрыты регрессиями; новых P0/P1 не найдено.
- **NOT READY FOR LIVE PAYMENTS** — без изменений относительно §8:
  остаются Этап 0, живые тесты Stars, продление на 30-й день.

### Коммиты раунда 4 (поверх `e65635f`, remote SHA; пуш — REST-хелпером, дерево побайтово совпало с локальным)

```
222b288 test(worker): RED — failed retry must not invalidate an issued invoice (CR-R4-2)
28e15df fix(worker): preserve issued invoice when a retry fails (CR-R4-2)
d37ad40 docs(worker): refunds before snapshot restore; bundles refund-only on rollback (CR-R4-3/4)
0acdbc6 test(server-wallet-sync): RED CR-R4-1 elapsed-aware booster bank (T+10, not T+11)
6942b40 fix(client): CR-R4-1 elapsed-aware booster earned bank (T+10, not T+11)
66980a6 test(storefront-layout): CR-R4-5 explicit release signal for resize-during-purchase
```

- **CI:** запускается на пуше; статус — в PR (check-runs на
  финальном HEAD). Локально все контракты зелёные (см. выше).
