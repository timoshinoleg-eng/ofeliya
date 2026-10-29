++ b/worker/schema.sql
-- OFELIYA payments reference backend — Cloudflare D1 schema (патч №13).
--
-- Журнал платежей переехал с Cloudflare KV (патч №11/№12) на D1, потому что
-- KV писал платёж тремя последовательными put'ами (pay:{charge} →
-- nonce:{nonce} → user:{id}:journal): частичный сбой между записями плюс
-- повторная доставка вебхука = потерянный платёж (у KV нет транзакций,
-- eventual consistency). D1 делает запись платежа атомарно через batch().
--
-- Создание базы:
--   wrangler d1 create ofeliya-payments
-- Применение схемы:
--   wrangler d1 execute ofeliya-payments --file=worker/schema.sql
-- (или --remote, если запускается из локальной папки с привязкой)
--
-- Статусы payments.status:
--   'paid'      — платёж подтверждён Telegram; грант УЖЕ применён сервером
--                 (атомарный батч, патч №15);
--   'fulfilled' — клиент применил серверный кошелёк и вызвал POST /api/ack
--                 (только учёт);
--   'refunded'  — ТОЛЬКО вручную: POST /api/admin/refund (патч №14 E-c,
--                 двухшаговый с патча №15: execute=true = реальный возврат
--                 через refundStarPayment) с ADMIN_TOKEN; воркер сам этот
--                 статус не выставляет.
--
-- Статусы orders.status:
--   'pending' — инвойс создан, оплата ещё не пришла;
--   'paid'    — платёж по заказу записан (batch в successful_payment);
--   'expired' — вручную/скриптом: окно оплаты истекло без платежа.
-- Строгий pre_checkout (патч №15, P0-2): ok:true ТОЛЬКО при status='pending'
-- И совпадении from.id с order.user_id. Повторная оплата того же nonce
-- невозможна: после первой оплаты заказ уже 'paid'.
--
-- Серверный кошелёк (патч №15, P0-3) — источник правды о ПОКУПКАХ:
--   wallets: один ряд на user_id; purchased_rna — append-only сумма выданных
--     РНК (ЦЕЛЫЕ; INTEGER, не Decimal-строка: сложение — атомарным UPSERT в
--     SQL без read-modify-write гонки; гранты всегда целые);
--     booster_until_ms — абсолютный срок бустера (max(текущий, now) + дни);
--     skins_json — аддитивное множество выданных скинов (JSON-массив).
--   wallet_ledger: append-only журнал грантов; charge_id UNIQUE —
--     идемпотентность выдачи при ретраях Telegram.
-- Клиент НЕ начисляет сам: POST /api/wallet → дельта по watermark
-- (см. src/game/shop/ServerWalletSync.ts).
--
-- Возврат денег (refunded) — ручная операция Mark, двухшаговая (патч №15):
--   # 1. Только пометить (возврат выполнен вручную через BotFather):
--   curl -X POST https://<worker>/api/admin/refund \
--     -H "Authorization: Bearer $ADMIN_TOKEN" \
--     -H 'content-type: application/json' \
--     -d '{"chargeId":"<telegram_payment_charge_id>","reason":"..."}'
--   # 2. Выполнить возврат через Telegram (пометка — только после
--   #    подтверждения refundStarPayment):
--   curl -X POST https://<worker>/api/admin/refund \
--     -H "Authorization: Bearer $ADMIN_TOKEN" \
--     -H 'content-type: application/json' \
--     -d '{"chargeId":"<telegram_payment_charge_id>","execute":true}'
-- Повторный вызов при уже 'refunded' → {ok:true, already:true}.
-- Refund откатывает СЕРВЕРНЫЙ кошелёк (rna вычитается, скин убирается из
-- skins_json; бустер-время не отматывается); уже материализованное локальное
-- значение на устройстве НЕ отзывается (см. «Модель угроз» в index.ts).
--
-- Чистка старых заказов без платежей (у D1 нет TTL как у KV):
--   -- 1. пометить протухшими заказы старше 24 часов без оплаты:
--   UPDATE orders SET status='expired'
--     WHERE status='pending'
--       AND created_at < (strftime('%s','now')*1000 - 86400000);
--   -- 2. удалить протухшие старше 30 дней (история платежей не трогается):
--   DELETE FROM orders
--     WHERE status='expired'
--       AND created_at < (strftime('%s','now')*1000 - 2592000000);

CREATE TABLE IF NOT EXISTS orders (
  nonce       TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  product_id TEXT    NOT NULL,
  status     TEXT    NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  charge_id   TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  product_id TEXT    NOT NULL,
  amount     INTEGER NOT NULL,
  currency   TEXT    NOT NULL,
  status     TEXT    NOT NULL DEFAULT 'paid',
  nonce      TEXT,
  created_at INTEGER NOT NULL,
  fulfilled_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_payments_user  ON payments(user_id);
-- Патч №15 (P0-2): один nonce — один платёж. Backstop повторного
-- использования заказа (основной гейт — строгий pre_checkout).
-- NULL-nonce допускаются кратно (SQLite), в практике nonce всегда есть.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_nonce_unique ON payments(nonce);

-- Серверный кошелёк (патч №15, P0-3): что сервер выдал этому user_id.
-- purchased_rna — INTEGER (атомарный UPSERT), не Decimal-строка.
CREATE TABLE IF NOT EXISTS wallets (
  user_id          INTEGER PRIMARY KEY,
  purchased_rna    INTEGER NOT NULL DEFAULT 0,
  booster_until_ms INTEGER NOT NULL DEFAULT 0,
  skins_json       TEXT NOT NULL DEFAULT '[]',
  updated_at       INTEGER NOT NULL
);

-- Append-only журнал грантов; charge_id UNIQUE — идемпотентность выдачи.
CREATE TABLE IF NOT EXISTS wallet_ledger (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  charge_id   TEXT NOT NULL UNIQUE,
  kind        TEXT NOT NULL,   -- 'rna' | 'booster' | 'skin'
  amount_text TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_user ON wallet_ledger(user_id);
