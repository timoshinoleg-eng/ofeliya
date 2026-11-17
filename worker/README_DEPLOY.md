# Деплой payments-воркера OFELIYA (Telegram Stars)

Reference backend для `TelegramStarsPaymentProvider` (клиент: `src/game/shop/`).
Всё ниже делает **Mark руками** — агент ничего не деплоит и не хранит секреты.

## 1. Бот в BotFather

1. `@BotFather` → `/newbot` → получи **токен** (никому не показывай).
2. Привяжи Mini App: `/mybots` → выбери бота → **Bot Settings** →
   **Configure Mini App** → **Enable Mini App** → укажи URL, где хостится игра.
   (Либо кнопка меню: **Menu Button** → **Configure menu button** → URL игры.)

## 2. Воркер

```bash
cd worker
npm install          # ставит wrangler + typescript (devDependencies)
cp wrangler.toml.example wrangler.toml   # поправь name при желании

# Секреты (в репозиторий НЕ коммитить):
npx wrangler secret put TELEGRAM_BOT_TOKEN   # токен из шага 1
npx wrangler secret put WEBHOOK_SECRET       # секрет прокси Render→воркер (НЕ TG_WEBHOOK_SECRET)
npx wrangler secret put ADMIN_TOKEN          # отдельный админ-секрет для возвратов/подписок

# D1 — журнал платежей (ОБЯЗАТЕЛЬНО, патч №13):
# без биндинга PAYMENTS_DB воркер отвечает 503 на /api/invoice
# и ok:false на pre_checkout_query (fail-closed всей цепочки).
npx wrangler d1 create ofeliya-payments   # запомнить выданный database_id
npx wrangler d1 execute ofeliya-payments --file=schema.sql --remote
# database_id → в wrangler.toml, [[d1_databases]] (см. wrangler.toml.example)

# ГЕЙТ СХЕМЫ (P1-3) — СТОП, если проверка красная. Без триггера
# trg_wallet_ledger_apply гранты ТИХО теряются: платёж запишется paid,
# а кошелёк останется пустым. Воркер НЕ деплоить до зелёного гейта.
# Локальная проверка файлов схемы (изолированно, D1 не трогает):
# (мы уже внутри worker/ — npm-скрипт check-schema живёт только
# в корневом package.json, здесь прямой вызов скрипта)
node scripts/check-schema.mjs
# Проверка УЖЕ созданной D1 — только чтение (SELECT/PRAGMA):
node scripts/check-schema.mjs --print-commands
# → выполнить выданные wrangler d1 execute --command и сверить
# с ожидаемым (триггер на месте, тело содержит ветки season_pass).

npx wrangler deploy
# → получишь https://ofeliya-payments.<твой-аккаунт>.workers.dev
```

Проверка: `curl https://<worker>/api/health` → `{"ok":true,...}`.

## 3. Webhook бота (продакшн: Render → Worker)

**Не переключать Telegram напрямую на Worker:** у Bot API один webhook.
Прямой Worker URL отключит игровой webhook и команды `/start`/`/help`.
Сначала настрой прокси в Render (`ofeliya-game`):

```bash
OFELIYA_STARS_WORKER_URL=https://<worker>.workers.dev
OFELIYA_STARS_WORKER_SECRET=<тот же WEBHOOK_SECRET, что в Worker>
```

Затем укажи существующий игровой webhook, сохранив **отдельный**
`TG_WEBHOOK_SECRET` Render:

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://ofeliya-game.onrender.com/api/telegram/webhook" \
  -d "secret_token=<TG_WEBHOOK_SECRET>" \
  -d 'allowed_updates=["message","pre_checkout_query","subscription"]'
```

**Важно:** Telegram сохраняет старое `allowed_updates`, если параметр
не передан. После добавления `subscription` необходимо явно разрешить
этот тип апдейтов (Bot API 10.2), иначе даже исправленный Render-прокси
не увидит события отмены/сбоя. Пример включает только типы, которые
обрабатывает текущий webhook; перед изменением проверь `getWebhookInfo`,
если бот используется также другими обработчиками.

Воркер проверяет заголовок `X-Telegram-Bot-Api-Secret-Token` с
`WEBHOOK_SECRET`, а игровой сервер независимо проверяет
`TG_WEBHOOK_SECRET`. Оба обязательны, но **не должны совпадать**.
Подробно о прокси и таймауте pre_checkout — §9.

## 4. Клиент игры

```bash
# .env (локально) или env CI:
VITE_PAYMENTS_API_URL=https://<worker>
```

Витрина: `?flag.storefront.variant=telegram` (флаг Фазы 2, без пересборки).
Провайдер сам проверит: Telegram WebApp + initData + бэкенд — иначе «скоро».

### 4.2 Обязательная поддержка платежей Telegram Stars

Официальные требования Telegram к цифровым товарам включают
`/paysupport` и своевременную обработку платёжных обращений.
В `server/telegram-webhook.mjs` и запасном polling-пути реализована
команда `/paysupport`. **Перед включением настоящих платежей** в Render
(`ofeliya-game`) установить `OFELIYA_SUPPORT_EMAIL` — действующий
почтовый ящик для обращений, который владелец разрешил публиковать.
Контакт появится в ответе на команду; без него команда явно сообщает, что
поддержка не настроена (это **release blocker**, не рабочая поддержка).

Проверить в Telegram: отправить боту `/paysupport`, убедиться, что
приходит **действующий** адрес, затем отправить реальное тестовое
обращение и убедиться, что владелец может его обработать. `/help`
должен показывать `/paysupport`. Ответ команды **не является**
подтверждением возврата; для возврата использовать процедуру в §10.

### 4.1 Umami Cloud Hobby (без self-hosted PostgreSQL)

Создай сайт в https://cloud.umami.is/ : Name `OFELIYA`,
Domain `ofeliya-game.onrender.com`. На странице сайта открой
**Edit → Tracking code**. Значения `src` и `data-website-id` копируй
**из своего кабинета** (включая регион US/EU; не угадывай URL).

В **Render → ofeliya-game → Environment** добавь:

```dotenv
VITE_UMAMI_ENABLED=1
VITE_UMAMI_SRC=<полный HTTPS src из Tracking code>
VITE_UMAMI_WEBSITE_ID=<data-website-id из Tracking code>
VITE_PAYMENTS_API_URL=https://<worker>.workers.dev
PAYMENTS_SERVER_ID=ofeliya-d1-v1
```

`VITE_UMAMI_ENABLED=1`, **не `true`**: `src/main.ts` использует
строгое сравнение с `'1'`. Не включай `VITE_PAYMENTS_API_URL` до
успешного smoke D1 и готового webhook; отсутствие этой переменной
оставляет магазин без активного Stars-провайдера. Для веб-аналитики
не нужны bot token, ключи API Umami или персональные Telegram-данные.

После изменения Vite env требуется новая **сборка** Render (переменные
подставляются при build). В Telegram Mini App проверь в дашборде Umami:
`app_open → run_start → death/win → store_viewed → product_view →
purchase_started → purchase_completed/purchase_failed`. Событий
`run_end` и `shop_open` в коде **нет**; они называются
`death | win` и `store_viewed`. События `product_view` и платежей
несут только проверенный публичный `productId`. Счётчик Hobby считает
события и их сохранённые свойства в лимит — следи за Usage.

## 5. Сквозной тест

1. Открой Mini App внутри Telegram (не в браузере — там нет `window.Telegram`).
2. Открой витрину → выбери товар → «Купить».
3. Оплати Stars (для теста BotFather умеет тестовые платежи, либо купи Stars).
4. Ожидаемо: нативный инвойс → `paid` → верификация по nonce
   (`POST /api/verify`) → анимация выдачи (твины сцены),
   событие `purchase_completed` (trackProductEvent), выдача через
   `PaymentLedger.fulfillPurchase` (скины/РНК/бустер, идемпотентно по chargeId).
   Если сервер не подтвердил оплату сразу: баннер «Ожидание подтверждения»,
   допроверка при открытии витрины и кнопкой «Проверить оплату».

## 6. Что НЕ делает этот воркер (осознанно)

- **Серверная выдача entitlements в игровой инвентарь**: заблокирована
  серверным контрактом `scripts/check-profile-client.mjs:162`
  (`'purchase' must never be accepted`). Клиентская выдача уже есть
  (сцена витрины → PaymentLedger.fulfillPurchase → SkinOwnership/MetaWallet).
  Снятие запрета — отдельное решение Mark.
- **Возвраты**: `refundStarPayment` — позже, по мере необходимости.
  В журнале D1 статусы: `'paid'` → `'fulfilled'` (клиент подтверждает
  локальную выдачу через `POST /api/ack`) | `'refunded'` (только вручную
  через SQL — см. §8; воркер его не выставляет). Сам возврат Stars
  пользователю — отдельно через Bot API. Ручная пометка:
  `UPDATE payments SET status='refunded' WHERE charge_id='<id>';`
- **Подписки**: Bot API 8.0 умеет Stars-подписки — отдельный скоуп.

## 7. Каталог цен

Цены живут в **двух** местах и должны совпадать:
- клиент: `src/game/shop/products.ts` (`stars`);
- сервер: `worker/src/grants.ts` (`SERVER_GRANTS`, `stars` + грант).

Сервер — источник истины: цену от клиента воркер игнорирует всегда.
При смене цен/грантов обнови оба файла, **увеличь `GRANTS_VERSION`**
(патч №16, B2 — пишется в `orders.sku_version`/`payments.sku_version`;
старые заказы остаются иммутабельными, дрейф виден в логах
`stars_payment_sku_drift`) и задеплой воркер заново. Правила
синхронизации — в шапке `worker/src/grants.ts`.

## 8. Протокол v5 (патч №16; v3 — патч №13, v4 — №15)

Схема: `worker/schema.sql` — таблицы `orders` (nonce PK, user_id, product_id,
amount_stars, sku_version, status, created_at), `payments` (charge_id PK,
user_id, product_id, amount, currency, status, nonce, sku_version, created_at,
fulfilled_at), `wallets` (триггер ведёт purchased_rna/booster_until_ms;
skins_json deprecated), `wallet_ledger` (id=seq, kind grant|reversal,
grant_type, знаковый amount), `wallet_skins` (владение), `refund_ops`
(state machine возвратов), `schema_migrations` + триггер
`trg_wallet_ledger_apply`.

Эндпоинты:
- `POST /api/invoice {initData, productId, nonce}` → `200 {invoiceUrl, nonce}`.
  `nonce` генерирует клиент, формат `^[A-Za-z0-9_-]{8,64}$`; payload инвойса —
  сырой nonce (лимит Telegram 1–128 байт). **Без D1-биндинга → 503.**
- `POST /api/webhook` — `pre_checkout_query` (payload=nonce → заказ из D1,
  сверка цены; **без DB → `ok:false`**) и `successful_payment` (проверки:
  заказ существует, `from.id == order.user_id`, границы суммы
  `isSafeInteger/1..10_000_000/XTR` fail-closed, `total_amount ===
  order.amount_stars` (заказ иммутабелен) И товар в серверном каталоге;
  запись — **одним атомарным `db.batch()`**: `UPDATE orders → 'paid'` +
  `INSERT OR IGNORE INTO payments` + `INSERT OR IGNORE INTO wallet_ledger`
  (grant — запускает триггер, ведущий кошелёк); дубликат по
  `meta.changes==0`, триггер без вставки не срабатывает). Ошибка batch →
  503 (Telegram переотправит; повтор безопасен).
- `POST /api/verify {initData, nonce}` — **строго**: order.user_id == userId
  И payment.charge_id настоящий (непустой) И payment.user_id == userId
  И payment.product_id == order.product_id → `{verified:true, chargeId,
  productId}` (productId — **серверный**). Order есть, payment нет →
  `{verified:false, reason:'pending'}`. Иначе `'not_found'`/`'mismatch'`.
  Без DB → `501 {error:'db_unavailable'}`.
- `POST /api/entitlements {initData}` →
  `{purchases:[{chargeId, productId, status, createdAt}]}` из D1.
  Без DB → `501`.
- `POST /api/ack {initData, chargeId}` — bookkeeping: `paid`→`fulfilled`
  (только свой charge_id). Клиент зовёт после локальной выдачи.

Статусы журнала: `'paid'` → `'fulfilled'` | `'refunded'` (только вручную).

Чистка старых заказов (у D1 нет TTL как у KV — выполнять периодически):
```sql
-- пометить протухшими заказы старше 24ч без оплаты:
UPDATE orders SET status='expired'
  WHERE status='pending' AND created_at < (strftime('%s','now')*1000 - 86400000);
-- удалить протухшие старше 30 дней (история payments не трогается):
DELETE FROM orders
  WHERE status='expired' AND created_at < (strftime('%s','now')*1000 - 2592000000);
```

## 9. Интеграция с существующим webhook сервера

Не путать с игровым сервером: `server/index.mjs` уже имеет свой
Telegram webhook (`POST /api/telegram/webhook`, секрет проверяется
отдельно, обрабатывает private start). Воркер оплат — независимый
сервис со своим секретом (`WEBHOOK_SECRET`) и своим URL
(`https://<worker>/api/webhook`); общий обработчик им не нужен.
Для существующего игрового бота `setWebhook` должен указывать URL **Render**,
который пересылает Stars-апдейты воркеру. Прямой URL воркера допустим
только для отдельного бота без игровых команд.

### Статус: прокси реализован (патч №14)

Вариант (а) теперь не только описан, но и реализован:
`server/stars-proxy.mjs` (`isStarsUpdate` / `forwardStarsUpdate`, таймаут 8 с,
fail-closed) подключён в `server/index.mjs` в `POST /api/telegram/webhook`
сразу после проверки секрета: Stars-апдейты уходят на воркер,
остальные — в существующий игровой хендлер.

Включение — через env Render:

```bash
OFELIYA_STARS_WORKER_URL=https://<worker>.workers.dev
OFELIYA_STARS_WORKER_SECRET=<тот же WEBHOOK_SECRET, что у воркера>
```

Без `OFELIYA_STARS_WORKER_URL`/`OFELIYA_STARS_WORKER_SECRET` Stars-апдейты
получают 503 (fail-closed: Telegram переотправит апдейт, когда прокси
настроят); не-Stars апдейты идут как раньше.

Патч №15 (P0-1, фикс аудита №5): прокси **сам** добавляет `/api/webhook`
(`normalizeWorkerUrl` в `server/stars-proxy.mjs`); голый URL выше —
правильный и рекомендуемый. Полный путь
`https://<worker>.workers.dev/api/webhook` тоже принимается и не
дублируется. Раньше прокси POSTил на голый URL → 404; больше не так.
`WEBHOOK_SECRET` обязателен с обеих сторон; секрет воркера **не равен**
`TG_WEBHOOK_SECRET` (разные секреты — разные blast radius).

Важно: воркер + D1 остаются standalone-альтернативой. Если `setWebhook`
направить **напрямую на воркер** (`/api/webhook`), игровой `POST
/api/telegram/webhook` на Render перестанет получать апдейты бота
(команды `/start`/`/help`) — Bot API держит один URL на бота. Варианты:

| | setWebhook → Render + прокси | setWebhook → воркер напрямую |
|---|---|---|
| Игровые команды бота | работают | **не работают** (нужен отдельный бот/путь) |
| Платёжный журнал | D1 воркера | D1 воркера |
| Сетевой хоп для Stars | +1 (Render→воркер) | 0 |
| Риск для игрового сервера | минимальный (прокси изолирован) | ноль (не трогаем) |

### Рекомендация

**Прокси (Render + воркер)** — основной путь: игровой webhook и команды бота
сохраняются, платёжный журнал — в D1 воркера (атомарные батчи, протокол v3),
риск для score-контракта минимален. Прямой webhook на воркер — только если
игровые команды бота не нужны вообще.

**Риск на Render Free:** бесплатный Web Service уходит в sleep после
15 минут без входящего трафика и может запускаться около минуты
(официальная документация Render). При холодном старте цепочка
Telegram → Render → Worker не может уложиться в 10-секундный лимит
`pre_checkout_query`. Перед включением реальных оплат проверь реальный
pre_checkout **после периода простоя**. Если не проходит — нужен
always-on хост для webhook или Worker-first маршрутизация (с прокси
неплатёжных апдейтов обратно в Render); простое повторение покупки
не устраняет архитектурный риск.

`pre_checkout_query` требует ответа ≤ 10 с **от отправки Telegram** — это
бюджет всей цепочки: Telegram → Render → прокси (таймаут 8 с) → воркер →
D1 → `answerPreCheckoutQuery` через Bot API. Воркер замеряет латентность и
пишет `pre_checkout_slow` в лог при > 7 с — это сигнал, что цепочка слишком
медленная (см. runbook §11).

Честно про ретраи (патч №15, P1-5): 503 при сбое D1 — правильный ответ, и
Bot API действительно переотправляет неуспешные webhook-апдейты, но
гарантирует лишь «разумное число попыток», а не доставку через произвольное
время. Уже истёкший `pre_checkout` ретрай не спасёт: пользователь увидит
«Товар недоступен», заказ останется `pending` — разгребать через
`/api/admin/stale-orders` (§11). Двойной `successful_payment` безопасен
(идемпотентность по `charge_id` + `wallet_ledger`).

## 10. Admin: state machine возвратов (патч №16, A5; двухшаговый с №15)

`POST /api/admin/refund` — ручное разрешение споров. Два РАЗНЫХ действия,
не путать:

```bash
# ПОМЕТИТЬ (возврат уже выполнен вручную через BotFather/поддержку):
# требует confirmExternalRefund:true + reason, иначе 400 {error:'confirm-required'}
curl -X POST https://<worker>/api/admin/refund \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"chargeId":"<telegram_charge_id>","reason":"manual refund via BotFather","confirmExternalRefund":true}'

# ВЫПОЛНИТЬ возврат через Telegram (пометка — только после
# подтверждения refundStarPayment):
curl -X POST https://<worker>/api/admin/refund \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"chargeId":"<telegram_charge_id>","reason":"...","execute":true}'
```

- `ADMIN_TOKEN` — отдельный секрет воркера (не bot token!), обязателен;
  без него/при неверном — 401, эндпоинт fail-closed.
- **mark** (`execute!==true`): один атомарный батч — запись в `refund_ops`
  (`action='mark'`, `status='completed'`) + `payments→'refunded'` +
  reversal-строка в `wallet_ledger` (триггер откатывает кошелёк). Без
  `confirmExternalRefund:true` и `reason` — 400: легко было бы пометить
  refund, не вернув деньги (грант откатится, а Stars останутся у игрока).
- **execute** (`execute:true`): батч1 — `refund_ops` (`status='requested'`)
  + `payments→'refund_requested'` (бронь перед внешним вызовом); затем
  `refundStarPayment`; затем батч2 — `refund_ops→'completed'`
  (+`telegram_confirmed_at`), `payments→'refunded'`, reversal. Ошибка
  `already refunded` от Telegram = подтверждение (идемпотентный повтор).
  Сетевая ошибка → операция остаётся `'requested'` → **повторить с тем же
  `operationId`** — продолжит без двойного списания.
- `operationId` — опционален; можно прислать свой (UNIQUE), иначе
  `crypto.randomUUID()`. Чужой operationId на другой chargeId →
  400 `{error:'operation-id-mismatch'}`.
- `execute=true` использует тот же `TELEGRAM_BOT_TOKEN` (отдельный
  `OFELIYA_BOT_TOKEN` не нужен); без токена → 503
  `{error:'bot-token-misconfigured'}`; провал `refundStarPayment` → 502
  `{error:'refund-failed'}`, статус НЕ меняется (остаётся `'requested'`).
- Откат серверного кошелька — reversal-строкой в журнале (применяет
  триггер `trg_wallet_ledger_apply`, атомарно в том же батче):
  РНК вычитается (не ниже 0), скин гасится в `wallet_skins` (только строка
  своего charge_id), **время бустера не отматывается** — политика «время
  вспять не отматываем, ниже момента возврата не уходим» (см. ниже).
  Уже материализованное локальное значение на устройстве НЕ отзывается
  (см. «Модель угроз» в `worker/src/index.ts`).
- Идемпотентность: уже `refunded` → `{ok:true, already:true}`;
  не найден → `{ok:false, error:'not-found'}`.
- После refund: `/api/verify` → `{verified:false, reason:'refunded'}`,
  клиентский `restore()` и `/api/entitlements` исключают запись из выдачи —
  перевыдачи не будет; `/api/wallet` больше не содержит откатанный грант.
- Журнал админа = таблица `refund_ops` (operation_id, charge_id, reason,
  статусы, timestamps). Секреты в логи не пишутся (аудит — патч №16, D).

### Возврат дубликата (P1-1)

Дубликатные платежи (`duplicate_payments`: гонка двух pre_checkout —
`reason='nonce_reuse'`, или отклонённая вторая подписка —
`reason='subscription_active'`, см. §11) возвращаются ТЕМ ЖЕ эндпоинтом
и тем же state machine (`refund_ops` + бронь, идемпотентный повтор,
возобновление execute). Отличия:

- ответ помечен `{duplicate:true}`;
- reversal-строки в журнале НЕТ — у дубликата не было гранта;
- исходная законная покупка НЕ трогается (её грант и статус целы);
- состояние дубликата: `pending` → `refund_requested` → `refunded`
  (колонка `duplicate_payments.status`).

`reconcile.mjs` находит зависшие дубликаты автоматически
(`duplicate_without_refund`, §11).

### Возврат пропуска: ОБЯЗАТЕЛЬНЫЙ двухшаговый процесс (P2-2)

`refundStarPayment` НЕ отменяет подписку Telegram: деньги вернутся,
а продления продолжат списываться каждый месяц. Поэтому возврат
сезонного пропуска — всегда ДВА шага:

1. **Возврат денег** — `POST /api/admin/refund` как обычно. Ответ для
   subscription-товара содержит флаг:
   `{subscriptionStillActive:true, hint:"refundStarPayment does not
   cancel the Telegram subscription — ..."}` — напоминание о шаге 2.
2. **Отмена подписки** — один из двух вариантов:
   - отдельным вызовом: `POST /api/admin/subscription`
     `{"chargeId":"<telegram_charge_id>","isCanceled":true}`
     (отмена продления; текущий период действует до конца);
   - или сразу в refund: добавить `"cancelSubscription":true` —
     воркер вызовет `editUserStarSubscription` в том же флоу.
     Успех → `{subscriptionCanceled:true, subscriptionStillActive:false}`;
     провал отмены → возврат всё равно `ok:true`, но с флагом
     `{subscriptionCancelFailed:true}` — повторить шаг 2 отдельно.

Админские действия с подписками пишутся в `subscription_events` с
`source='admin'` (P2-3) — видно, кто и когда отменил подписку.
Отклонённая вторая подписка (P1-2) живёт только в `duplicate_payments` —
её тоже можно отменить через `/api/admin/subscription` по её charge_id
(и вернуть деньги через refund дубликата, см. выше).

### Политика booster-reversal (зафиксирована)

Возврат НЕ отматывает время бустера вспять: триггер ставит
`booster_until_ms = max(момент_возврата, booster_until_ms − срок_гранта)`.
Игрок, купивший бустер и сразу получивший refund, не теряет «уже
прожитое» время — но и не уходит ниже момента возврата. Это осознанная
политика (не баг): честно зафиксирована здесь и в `worker/schema.sql`.

## 11. Runbook: зависшие платежи (патч №15, P1-5; сверка — №16, B1)

`GET /api/admin/stale-orders?olderThanMin=N` (default 60, кап 1440) —
заказы `pending` и платежи `paid`-без-`fulfilled` старше N минут:

```bash
curl "https://<worker>/api/admin/stale-orders?olderThanMin=60" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
# → {olderThanMin, orders:[{nonce,user_id,product_id,created_at}], unpaidPayments:[...]}
```

### Сверка: worker/scripts/reconcile.mjs (патч №16, B1)

Read-only сверка трёх источников (D1-дампы + Telegram). НИЧЕГО не меняет:
никаких авто-списаний/возвратов/начислений — только отчёт, exit 1 при
расхождениях.

```bash
# 1. Дампы из D1 (пример; orders/ledger/refund_ops/duplicate_payments — аналогичными SELECT):
wrangler d1 execute ofeliya-payments --remote \
  --command "SELECT charge_id,user_id,product_id,amount,currency,status,nonce,sku_version,created_at FROM payments" \
  --json > /tmp/payments.json
wrangler d1 execute ofeliya-payments --remote \
  --command "SELECT charge_id,nonce,user_id,product_id,amount,currency,reason,status,created_at FROM duplicate_payments" \
  --json > /tmp/duplicates.json
# payments.json — объект {payments:[...], orders:[...], refund_ops:[...], duplicate_payments:[...]}
# (допускается голый массив = payments; duplicate_payments можно дописать
# в тот же файл под своим ключом — без него дубликаты не сверяются,
# а их Telegram-транзакции ложно помечаются telegram_without_d1)

# 2. Запуск (без токена — только D1-внутренние проверки):
node worker/scripts/reconcile.mjs --dump /tmp/payments.json --ledger /tmp/ledger.json

# 3. С токеном — плюс кросс-чек с Telegram (getStarTransactions,
#    пагинация offset/limit по https://core.telegram.org/bots/api#getstartransactions):
node worker/scripts/reconcile.mjs --dump /tmp/payments.json --ledger /tmp/ledger.json \
  --bot-token "$TELEGRAM_BOT_TOKEN" --stuck-min 120
```

Проверки: `paid_without_grant` (потерянный грант), `refunded_without_reversal`,
`duplicate_nonce`/`duplicate_charge_id`, `stuck_refund_op` (`'requested'`
старше порога), `stale_pending_order`, `duplicate_without_refund`
(дубликат `'pending'` старше порога без завершённого возврата — P1-1),
`grant_without_payment`, `reversal_without_grant`,
`overlapping_season_pass_grants` (первый платёж пропуска при активном —
P2-N1, guard должен был не дать), `telegram_without_d1`
(платёж Telegram без D1 — главный кейс; дубликаты из `duplicate_payments`
считаются «в D1», а не потерянными), `d1_without_telegram` (warning:
история Telegram может быть неполной). Тест со стабом Telegram HTTP:
`node --test worker/scripts/reconcile.test.mjs`.

Разбор по сценариям:

1. **Заказ `pending`, платежа нет** — пользователь не оплатил (закрыл
   инвойс). Ничего делать не нужно; для чистоты — пометить `expired`
   (SQL в `worker/schema.sql`, раздел чистки).
2. **Заказ `pending`, платёж `paid`, клиент не забрал** — воркер грант
   применил (кошелёк), клиент не синкнулся. Действие: попросить
   пользователя открыть витрину (restore+sync) или сверить
   `/api/wallet` вручную.
3. **Платёж `paid` без grant-строки** — не должно случаться (один атомарный
   батч + триггер, патч №16); если случилось — смотреть логи
   `stars_payment_*` и `pre_checkout_slow`, затем `reconcile.mjs`.
4. **`pre_checkout_slow` в логах** — цепочка не укладывается в 10 с:
   проверить cold start Render, латентность D1, таймаут прокси (8 с).
   Временно: прямой webhook на воркер (минус хоп), см. §9.
5. **Двойное списание** — сверить `wallet_ledger` по `user_id`: один
   `charge_id` = один грант (UNIQUE). Лишнее — через `/api/admin/refund`
   с `execute:true` (§10).
6. **Операция refund зависла в `'requested'`** — повторить execute с тем же
   `operationId` (§10); `reconcile.mjs` находит такие автоматически.
7. **Дубликат (P1-1/P1-2)** — деньги списаны, гранта нет: `reason='nonce_reuse'`
   (гонка двух pre_checkout) или `'subscription_active'` (вторая подписка
   при активном пропуске — заказ переведён в `'denied'`, продления этой
   подписки тоже отклоняются). Действие: вернуть через
   `/api/admin/refund` с `execute:true` (§10, возврат дубликата); для
   второй подписки — ОБЯЗАТЕЛЬНО отменить её продления
   (`POST /api/admin/subscription {chargeId, isCanceled:true}` или
   `cancelSubscription:true` в refund), иначе списания продолжатся
   ежемесячно. `reconcile.mjs` находит зависшие дубликаты
   (`duplicate_without_refund`).
8. **`stars_grant_readback_mismatch` в логах (P1-3)** — грант-батч
   прошёл, а кошелёк не изменился: триггер `trg_wallet_ledger_apply`
   потерян или сломан. СТОП: не принимать платежи, прогнать гейт схемы
   (§2, `npm run check-schema` + `--print-commands` против реальной D1),
   восстановить триггер из `worker/schema.sql` (весь `CREATE TRIGGER` —
   одним `--command`), затем пересчитать пострадавшие кошельки из
   `wallet_ledger` вручную (гранты в журнале целы — батч их записал).

## 12. Миграция существующей D1 (если база уже создана)

Свежая схема (`worker/schema.sql`) — основной путь: Mark ещё не деплоил.
Если D1 уже существует со схемой патча №15, применить дельту v16:

```bash
# 0. Снапшот ОБЯЗАТЕЛЕН:
wrangler d1 export ofeliya-payments --remote --output=backup-v15.sql
# 1. Pre-check (должны вернуть 0 строк):
wrangler d1 execute ofeliya-payments --remote --command \
  "SELECT nonce, COUNT(*) c FROM payments GROUP BY nonce HAVING c > 1"
wrangler d1 execute ofeliya-payments --remote --command \
  "SELECT charge_id, COUNT(*) c FROM wallet_ledger GROUP BY charge_id HAVING c > 1"
# 2. Миграция:
wrangler d1 execute ofeliya-payments --remote --file=worker/migration-16.sql
# 3. Проверки:
wrangler d1 execute ofeliya-payments --remote --command \
  "SELECT version FROM schema_migrations"  # → v16
wrangler d1 execute ofeliya-payments --remote --command \
  "SELECT name FROM sqlite_master WHERE type='trigger'"  # → trg_wallet_ledger_apply
# 4. Деплой воркера v16 СРАЗУ: старый код (v15) несовместим с новой схемой
#    (пишет kind='rna' вместо kind='grant').
```

Полный runbook (шаги, проверки, rollback) — в шапке `worker/migration-16.sql`.
Важно про триггер: `CREATE TRIGGER` — один statement с `;` внутри
`BEGIN...END`; если `wrangler d1 execute --file` режет файл наивно по `;`,
примените триггер отдельно одним `--command` (весь текст от `CREATE` до
`END;`) или через SQL-консоль дашборда D1.

Что делает миграция: `orders`/`payments` += `amount_stars`, `sku_version`
(B2, backfill ценами каталога v15); `wallet_ledger`: `kind` → `'grant'` +
`grant_type`/`amount`/`skin_id` (формат v16); `wallet_skins` — backfill из
skin-грантов (refunded исключены); новые таблицы `refund_ops`,
`schema_migrations`; триггер `trg_wallet_ledger_apply` — после переноса
данных. Кошелёк `wallets` миграцией НЕ меняется (только формат строк).

Важно: платежи, записанные воркером до №15, в `wallets` не попадут
(бэкфилла нет — нельзя отличить уже выданное локально). Их гранты уже
материализованы старыми клиентами локально; новые клиенты увидят
`purchased_rna=0` — это корректно, задвоения не будет.

### Миграция v16 → v17 (монетизация v3) + гейт схемы (P1-3, P2-4)

Порядок — строго такой (обратное окно «новый воркер, старая схема»
НЕДОПУСТИМО: INSERT заказа упадёт на несуществующей колонке):

```bash
# 0. Снапшот ОБЯЗАТЕЛЕН:
wrangler d1 export ofeliya-payments --remote --output=backup-v16.sql
# 1. Pre-check: миграция ещё не применена (0 строк):
wrangler d1 execute ofeliya-payments --remote --command \
  "SELECT version FROM schema_migrations WHERE version='v17'"
# 2. Локальный гейт файлов схемы (изолированно, D1 не трогает):
npm run check-schema
# 3. Миграция:
wrangler d1 execute ofeliya-payments --remote --file=worker/migration-17.sql
# 4. ГЕЙТ РЕАЛЬНОЙ D1 — только чтение, СТОП при красном:
node worker/scripts/check-schema.mjs --print-commands
# → выполнить выданные команды и сверить: триггер на месте, тело
#    содержит ветки season_pass, guard-триггер
#    trg_wallet_ledger_season_pass_guard на месте (P2-N1 — без него
#    конкурентная двойная подписка снова возможна), UNIQUE журнала —
#    (charge_id, grant_type, skin_id), колонки v17 на месте.
# 5. Деплой воркера v17 — ТОЛЬКО после зелёного гейта.
```

**Частичная миграция (P2-4)** — если файл упал посередине (обрыв
соединения, ошибка wrangler): НЕ запускать файл повторно вслепую
(четыре `ALTER TABLE ADD COLUMN` упадут с `duplicate column name` —
это нормально, но не показатель прогресса). Точная процедура — в шапке
`worker/migration-17.sql`; коротко:

1. Диагностика (только чтение): `SELECT version FROM schema_migrations`
   (`v17` есть = файл дошёл до конца); `PRAGMA table_info(orders)` /
   `table_info(wallets)` / `table_info(duplicate_payments)` (какие
   колонки уже добавлены); `SELECT name FROM sqlite_master WHERE
   type='table' AND name='subscription_events'`; `PRAGMA
   index_list('wallet_ledger')` (новый UNIQUE?); `SELECT sql FROM
   sqlite_master WHERE type='trigger'` (триггер с season_pass?).
2. Если `wallet_ledger_new` или `wallet_skins_new` существует в
   `sqlite_master` — миграция упала ВНУТРИ пересоздания таблиц:
   **восстановить базу из снапшота шага 0 и прогнать файл заново**.
   Вручную не достраивать: триггер в этот момент уже снесён, копия
   журнала может быть частичной.
3. В остальных случаях — доработать недостающие шаги вручную по таблице
   шагов в шапке миграции (шаги 0/2/5 идемпотентны — безопасно
   повторить; шаг 1 — пропустить уже добавленные колонки; шаг 4 —
   пересоздать триггер целиком, шаг 4b — guard-триггер P2-N1),
   затем прогнать гейт шага 4.
4. При ЛЮБЫХ сомнениях — восстановить из снапшота и начать заново:
   файл рассчитан на один прогон на чистой v16.

Откат ТОЛЬКО воркера на v16 при схеме v17 НЕ БЕЗОПАСЕН (CR5): v17
wallet_ledger не имеет charge-only UNIQUE, а v16-код пишет гранты
через `INSERT ... ON CONFLICT(charge_id) DO NOTHING` — такой INSERT
против v17-схемы падает, и каждая оплата на откаченном воркере уйдёт
в 503/потерю гранта (доказано на реальном SQLite в
check-schema.test.mjs, тест CR5). Единственный безопасный откат —
восстановить базу из снапшота шага 0 и вернуть деплой v16. НО
восстановление снапшота в одиночку безопасно ТОЛЬКО если после
снапшота не было принято ни одного платежа: восстановление стирает
все платежи, принятые после снапшота (записи `payments`, строки
`wallet_ledger`, скины, события подписок), а Telegram их НЕ
переотправит — вебхук уже acked 200. Поэтому (CR-R3-5):

- Платёжный трафик ДОЛЖЕН стоять на паузе с момента создания
  снапшота и до завершения отката (либо до подтверждения, что v17
  работает и откат не нужен). Пауза вебхука: временно очистить
  `OFELIYA_STARS_WORKER_URL` в Render — stars-proxy отвечает 503
  (`server/index.mjs`), и Telegram ретраит апдейты после
  восстановления прокси, ничего не теряется. Кодового kill-switch
  для новых инвойсов нет (клиент ходит в воркер напрямую), поэтому
  паузу делать в окно минимальной активности и ОБЯЗАТЕЛЬНО
  проверять пост-снапшотную активность перед восстановлением
  (шаг 2 ниже) — пауза вебхука сама по себе новые покупки
  не блокирует.
- Если паузы не было или её покрытие не гарантировано — ПЕРЕД
  восстановлением сохранить и сверить пост-снапшотные платежи
  (время снапшота зафиксировать в мс: `date +%s%3N` перед
  экспортом; `created_at` в D1 — INTEGER мс):
  1. Полный экспорт живой базы: `wrangler d1 export
     ofeliya-payments --remote --output=backup-pre-rollback.sql`
     — в нём все платежи после снапшота.
  2. Перечислить их: `SELECT charge_id,user_id,product_id,amount,
     status,created_at FROM payments WHERE created_at > <мс
     снапшота>` (аналогично — `wallet_ledger`,
     `subscription_events`, `refund_ops` за тот же период).
     Ноль строк = пост-снапшотных платежей нет, восстанавливать
     можно сразу.
  3. Сверка с Telegram: `node worker/scripts/reconcile.mjs
     --dump ... --ledger ... --bot-token "$TELEGRAM_BOT_TOKEN"`
     (§11) — найти `telegram_without_d1` и `paid_without_grant`.
- ПОСЛЕ восстановления каждый пост-снапшотный платёж либо
  вернуть покупателю (`charge_id` — из сохранённого экспорта,
  `/api/admin/refund`, §10), либо переприменить грант вручную:
  повторный INSERT сохранённых строк `wallet_ledger` в порядке
  `id` (триггер `trg_wallet_ledger_apply` сам пересчитает
  кошельки и `wallet_skins`) + соответствующие строки
  `payments`/`orders` (только колонки v16). Пропуск
  (`grant_type='season_pass'`) переприменить в v16 НЕЛЬЗЯ: в v16
  нет ни колонки `season_pass_until_ms`, ни ветки триггера —
  такие платежи только возвращать. После — повторная сверка
  `reconcile.mjs`: расхождений быть не должно.
- Только после сохранения/сверки — восстанавливать снапшот и
  возвращать деплой v16.

Окно «миграция → деплой v17» (старый воркер уже несовместим с новой
схемой) закрывается немедленным деплоем v17 после миграции либо
паузой платёжного трафика — см. шапку migration-17.sql.

## 13. Протокол v5 (патч №16) — что изменилось

- **Один атомарный батч** в `successful_payment`: `UPDATE orders→'paid'` +
  `INSERT OR IGNORE INTO payments` + `INSERT OR IGNORE INTO wallet_ledger`
  (grant). Кошелёк ведёт **SQL-триггер** `trg_wallet_ledger_apply`
  (см. `worker/schema.sql`): интерактивных транзакций в D1 нет, поэтому
  read→calc→write в JS (`applyGrantBatch`, патч №15) удалён вместе с
  self-heal — при двух батчах между ними не было атомарности (P0 A1/A2).
- `wallet_ledger`: `kind='grant'|'reversal'`, `grant_type`, знаковый `amount`,
  `id` — монотонный seq. Скины — в `wallet_skins` (`active`/`reversed`);
  `wallets.skins_json` — deprecated (колонка оставлена, триггер её не ведёт).
- **SKU**: `GRANTS_VERSION=2` (`worker/src/grants.ts`); заказ иммутабелен
  (`amount_stars`+`sku_version`); вебхук сверяет `sp.total_amount` с заказом
  И каталогом; границы `isSafeInteger`, `1..10_000_000`, `XTR` — fail-closed.
  При изменении цен/грантов — увеличить `GRANTS_VERSION` и синхронизировать
  с `src/game/shop/products.ts` (см. §7).
- `POST /api/wallet {initData, since_seq?}` →
  `{ok, user_id, server_id, schema_version:2, purchased_rna, booster_until_ms,
  skins[], ledger[], tip_seq, ledger_tip}` (legacy).
- Возвраты — state machine в `refund_ops` (§10).
- `PAYMENTS_SERVER_ID` (env, дефолт `'ofeliya-d1-v1'`) → `server_id` в
  `/api/wallet`. **Mark должен держать его стабильным**: смена значения =
  смена серверного источника правды (новая D1/сброс); клиент по нему
  детектирует «другой сервер». Менять только осознанно.

## 14. Безопасность воркера (аудит, патч №16, D)

- **CORS**: `access-control-allow-origin: '*'` — осознанно. Воркер не
  использует cookie/credentials: каждый запрос авторизуется отдельно
  (initData HMAC / `ADMIN_TOKEN` / `X-Telegram-Bot-Api-Secret-Token`),
  поэтому `'*'` не открывает ничего нового. `'authorization'` добавлен в
  `allow-headers` (иначе браузерные админ-панели не проходят preflight
  с Bearer-токеном). Сужение origin — deployment-решение Mark.
- **Лимит тела**: 256 КБ на `/api/webhook` и `/api/invoice`
  (`MAX_BODY_BYTES` в `worker/src/index.ts`, проверка по `content-length`,
  best-effort; 413 при превышении). Telegram-апдейты — единицы КБ.
- **Rate limiting**: честная оценка — кодовый per-IP лимитер в воркере
  НЕ работает между изолятами Cloudflare (каждый запрос может попасть в
  другой изолят без общей памяти), поэтому «наивный Map-лимитер» был бы
  театром. Правильный уровень — **Cloudflare dashboard**: WAF Rate Limiting
  Rules на `/api/*` (см. runbook ниже). В коде не строить.
- **Секреты в логах**: аудит `logEvent` — логируются только charge_id,
  nonce, user_id, reason (обрезан до 200), статусы. Токены, `initData`,
  `WEBHOOK_SECRET`/`ADMIN_TOKEN`/`TELEGRAM_BOT_TOKEN` в логи НЕ попадают —
  проверено по всем вызовам (включая новый refund-флоу).
- **Без D1 — отказ в оплате**: `/api/invoice` → 503, `pre_checkout` →
  `ok:false`, `successful_payment` → 503 (Telegram переотправит),
  `/api/verify|entitlements|ack|wallet` → 501. Fail-closed всей цепочки.
- **QA/mock не трогают реальные начисления**: mock-провайдер и `?flag.` —
  только клиент (`VITE_QA_TOOLS`-гейт); воркер QA-обходов не имеет:
  грант выдаётся только по настоящему `successful_payment` от Telegram.

### Runbook: WAF rate limiting (Cloudflare dashboard)

1. Security → WAF → Rate limiting rules → Create rule.
2. Rule: `http.request.uri.path starts_with "/api/"`, характеристики —
   `ip.src`; лимиты: `/api/invoice` — 10 req/min/IP; `/api/webhook` —
   исключить IP Telegram (`149.154.160.0/20`, `91.108.4.0/22`) или лимит
   60 req/min/IP; `/api/admin/*` — 5 req/min/IP.
3. Действие при превышении: Block (10 мин) или Managed Challenge.
4. Проверка: `curl` серией запросов → 429 от Cloudflare (не от воркера).
