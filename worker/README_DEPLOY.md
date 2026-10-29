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

## 10. Admin: двухшаговый возврат (патч №15; было — только пометка, №14)

`POST /api/admin/refund` — ручное разрешение споров. Два РАЗНЫХ действия,
не путать:

```bash
# Шаг 1 — только ПОМЕТИТЬ (возврат уже выполнен вручную через BotFather):
curl -X POST https://<worker>/api/admin/refund \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"chargeId":"<telegram_charge_id>","reason":"manual refund"}'

# Шаг 2 — ВЫПОЛНИТЬ возврат через Telegram (пометка — только после
# подтверждения refundStarPayment):
curl -X POST https://<worker>/api/admin/refund \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"chargeId":"<telegram_charge_id>","reason":"...","execute":true}'
```

- `ADMIN_TOKEN` — отдельный секрет воркера (не bot token!), обязателен;
  без него/при неверном — 401, эндпоинт fail-closed.
- `execute=true` использует тот же `TELEGRAM_BOT_TOKEN` (отдельный
  `OFELIYA_BOT_TOKEN` не нужен); без токена → 503
  `{error:'bot-token-misconfigured'}`; провал `refundStarPayment` → 502
  `{error:'refund-failed'}`, статус НЕ меняется.
- Оба пути: `paid|fulfilled → refunded` + **откат серверного кошелька**
  (РНК вычитается, скин убирается из `skins_json`; время бустера не
  отматывается). Уже материализованное локальное значение на устройстве
  НЕ отзывается (см. «Модель угроз» в `worker/src/index.ts`).
- Идемпотентность: повтор при уже `refunded` → `{ok:true, already:true}`
  (однозначно); не найден → `{ok:false, error:'not-found'}`.
- После refund: `/api/verify` → `{verified:false, reason:'refunded'}`,
  клиентский `restore()` и `/api/entitlements` исключают запись из выдачи —
  перевыдачи не будет; `/api/wallet` больше не содержит откатаный грант.

## 11. Runbook: завиcшие платежи (патч №15, P1-5)

`GET /api/admin/stale-orders?olderThanMin=N` (default 60, кап 1440) —
заказы `pending` и платежи `paid`-без-`fulfilled` старше N минут:

```bash
curl "https://<worker>/api/admin/stale-orders?olderThanMin=60" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
# → {olderThanMin, orders:[{nonce,user_id,product_id,created_at}], unpaidPayments:[...]}
```

Разбор по сценариям:

1. **Заказ `pending`, платежа нет** — пользователь не оплатил (закрыл
   инвойс). Ничего делать не нужно; для чистоты — пометить `expired`
   (SQL в `worker/schema.sql`, раздел чистки).
2. **Заказ `pending`, платёж `paid`, клиент не забрал** — воркер грант
   применил (кошелёк), клиент не синкнулся. Действие: попросить
   пользователя открыть витрину (restore+sync) или сверить
   `/api/wallet` вручную.
3. **Платёж `paid` без кошелька** — не должно случаться (атомарный батч);
   если случилось — смотреть логи `stars_payment_*` и `pre_checkout_slow`.
4. **`pre_checkout_slow` в логах** — цепочка не укладывается в 10 с:
   проверить cold start Render, латентность D1, таймаут прокси (8 с).
   Временно: прямой webhook на воркер (минус хоп), см. §9.
5. **Двойное списание** — сверить `wallet_ledger` по `user_id`: один
   `charge_id` = один грант (UNIQUE). Лишнее — через `/api/admin/refund`
   с `execute:true` (§10).

## 12. Миграция существующей D1 (если база уже создана)

Свежая схема (`worker/schema.sql`) — основной путь: Mark ещё не деплоил.
Если D1 уже существует со схемой патча №13/№14, применить дельту:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_nonce_unique ON payments(nonce);
CREATE TABLE IF NOT EXISTS wallets (
  user_id          INTEGER PRIMARY KEY,
  purchased_rna    INTEGER NOT NULL DEFAULT 0,
  booster_until_ms INTEGER NOT NULL DEFAULT 0,
  skins_json       TEXT NOT NULL DEFAULT '[]',
  updated_at       INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS wallet_ledger (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  charge_id   TEXT NOT NULL UNIQUE,
  kind        TEXT NOT NULL,
  amount_text TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_user ON wallet_ledger(user_id);
```

```bash
wrangler d1 execute ofeliya-payments --file=worker/migration-15.sql  # или вставить SQL выше
```

Важно: платежи, записанные воркером до №15, в `wallets` не попадут
(бэкфилла нет — нельзя отличить уже выданное локально). Их гранты уже
материализованы старыми клиентами локально; новые клиенты увидят
`purchased_rna=0` — это корректно, задвоения не будет.
