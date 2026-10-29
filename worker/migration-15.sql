-- Миграция D1: патч №13/№14 → №15 (применять, только если база уже создана
-- со старой схемой; свежий деплой — просто worker/schema.sql).
-- Применение:
--   wrangler d1 execute ofeliya-payments --file=worker/migration-15.sql
-- Все операторы идемпотентны (IF NOT EXISTS).

-- P0-2: один nonce — один платёж (backstop повторного использования заказа).
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_nonce_unique ON payments(nonce);

-- P0-3: серверный кошелёк (источник правды о покупках).
CREATE TABLE IF NOT EXISTS wallets (
  user_id          INTEGER PRIMARY KEY,
  purchased_rna    INTEGER NOT NULL DEFAULT 0,
  booster_until_ms INTEGER NOT NULL DEFAULT 0,
  skins_json       TEXT NOT NULL DEFAULT '[]',
  updated_at       INTEGER NOT NULL
);

-- P0-3: append-only журнал грантов (charge_id UNIQUE — идемпотентность).
CREATE TABLE IF NOT EXISTS wallet_ledger (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  charge_id   TEXT NOT NULL UNIQUE,
  kind        TEXT NOT NULL,
  amount_text TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_user ON wallet_ledger(user_id);
