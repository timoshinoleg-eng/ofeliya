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
npx wrangler secret put WEBHOOK_SECRET       # придумай строку, напр. openssl rand -hex 32

# D1 — журнал платежей (ОБЯЗАТЕЛЬНО, патч №13):
# без биндинга PAYMENTS_DB воркер отвечает 503 на /api/invoice
# и ok:false на pre_checkout_query (fail-closed всей цепочки).
npx wrangler d1 create ofeliya-payments   # запомнить выданный database_id
npx wrangler d1 execute ofeliya-payments --file=worker/schema.sql --remote
# database_id → в wrangler.toml, [[d1_databases]] (см. wrangler.toml.example)

npx wrangler deploy
# → получишь https://ofeliya-payments.<твой-аккаунт>.workers.dev
```

Проверка: `curl https://<worker>/api/health` → `{"ok":true,...}`.

## 3. Webhook бота

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://<worker>/api/webhook" \
  -d "secret_token=<WEBHOOK_SECRET>"
```

Воркер сверяет заголовок `X-Telegram-Bot-Api-Secret-Token` с `WEBHOOK_SECRET`.
Без `WEBHOOK_SECRET` в env воркер отвечает **401 fail-closed** (патч №12):
молчаливого отключения проверки больше нет — секрет обязателен.

## 4. Клиент игры

```bash
# .env (локально) или env CI:
VITE_PAYMENTS_API_URL=https://<worker>
```

Витрина: `?flag.storefront.variant=telegram` (флаг Фазы 2, без пересборки).
Провайдер сам проверит: Telegram WebApp + initData + бэкенд — иначе «скоро».

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
- сервер: `worker/src/index.ts` (`SERVER_PRODUCTS`).

Сервер — источник истины: цену от клиента воркер игнорирует всегда.
При смене цен обнови оба файла (и задеплой воркер заново).

## 8. Протокол v3 (патч №13) — журнал на D1

Схема: `worker/schema.sql` — таблицы `orders` (nonce PK, user_id, product_id,
status, created_at) и `payments` (charge_id PK, user_id, product_id, amount,
currency, status, nonce, created_at, fulfilled_at) + индексы.

Эндпоинты:
- `POST /api/invoice {initData, productId, nonce}` → `200 {invoiceUrl, nonce}`.
  `nonce` генерирует клиент, формат `^[A-Za-z0-9_-]{8,64}$`; payload инвойса —
  сырой nonce (лимит Telegram 1–128 байт). **Без D1-биндинга → 503.**
- `POST /api/webhook` — `pre_checkout_query` (payload=nonce → заказ из D1,
  сверка цены; **без DB → `ok:false`**) и `successful_payment` (проверки:
  заказ существует, `from.id == order.user_id`, `(amount, currency)` совпадают
  с серверным каталогом; запись — **одним атомарным `db.batch()`**:
  `INSERT OR IGNORE INTO payments` + `UPDATE orders → 'paid'`; дубликат по
  `meta.changes==0`). Ошибка batch → 500 (Telegram переотправит; повтор
  безопасен).
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
При `setWebhook` для платёжного бота указывай именно URL воркера.
