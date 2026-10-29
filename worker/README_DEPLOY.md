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
# 1. Дампы из D1 (пример; orders/ledger/refund_ops — аналогичными SELECT):
wrangler d1 execute ofeliya-payments --remote \
  --command "SELECT charge_id,user_id,product_id,amount,currency,status,nonce,sku_version,created_at FROM payments" \
  --json > /tmp/payments.json
# payments.json — объект {payments:[...], orders:[...], refund_ops:[...]}
# (допускается голый массив = payments)

# 2. Запуск (без токена — только D1-внутренние проверки):
node worker/scripts/reconcile.mjs --dump /tmp/payments.json --ledger /tmp/ledger.json

# 3. С токеном — плюс кросс-чек с Telegram (getStarTransactions,
#    пагинация offset/limit по https://core.telegram.org/bots/api#getstartransactions):
node worker/scripts/reconcile.mjs --dump /tmp/payments.json --ledger /tmp/ledger.json \
  --bot-token "$TELEGRAM_BOT_TOKEN" --stuck-min 120
```

Проверки: `paid_without_grant` (потерянный грант), `refunded_without_reversal`,
`duplicate_nonce`/`duplicate_charge_id`, `stuck_refund_op` (`'requested'`
старше порога), `stale_pending_order`, `grant_without_payment`,
`reversal_without_grant`, `telegram_without_d1` (платёж Telegram без D1 —
главный кейс), `d1_without_telegram` (warning: история Telegram может быть
неполной). Тест со стабом Telegram HTTP:
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
