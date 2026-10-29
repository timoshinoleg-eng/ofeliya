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
--   'paid'      — платёж подтверждён Telegram, ожидает локальной выдачи клиентом;
--   'fulfilled' — клиент выдал товар и вызвал POST /api/ack (только учёт);
--   'refunded'  — ТОЛЬКО вручную через SQL (воркер этот статус не выставляет).
--
-- Статусы orders.status:
--   'pending' — инвойс создан, оплата ещё не пришла;
--   'paid'    — платёж по заказу записан (batch в successful_payment);
--   'expired' — вручную/скриптом: окно оплаты истекло без платежа
--               (pre_checkout_query такие заказы отклоняет).
--
-- Возврат денег (refunded) — ручная операция Mark:
--   UPDATE payments SET status='refunded'
--     WHERE charge_id='<telegram_payment_charge_id>';
-- Возврат Stars пользователю делается отдельно через Bot API
-- (refundStarPayment); воркер только помечает запись в журнале.
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
CREATE INDEX IF NOT EXISTS idx_payments_nonce ON payments(nonce);
