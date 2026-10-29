-- ============================================================================
-- Миграция D1: v15 → v16 (патч №16). Применять, ТОЛЬКО если база уже создана
-- со схемой патча №15; свежий деплой — просто worker/schema.sql.
--
-- Применение:
--   wrangler d1 execute ofeliya-payments --file=worker/migration-16.sql
--   (добавить --remote для продакшн-базы)
--
-- КЛЮЧЕВЫЕ ШАГИ (порядок важен):
--   1. Снапшот: wrangler d1 export ofeliya-payments --output=backup-v15.sql
--      (или --remote). Без снапшота миграцию не запускать.
--   2. Pre-check (запросы ниже — должны вернуть 0 строк):
--        SELECT nonce, COUNT(*) c FROM payments
--          GROUP BY nonce HAVING c > 1;
--        SELECT charge_id, COUNT(*) c FROM wallet_ledger
--          GROUP BY charge_id HAVING c > 1;
--      Ненулевой результат → стоп, разбираться вручную (UNIQUE-индексы
--      патча №15 должны были это исключить, но проверить дешевле).
--   3. Применить файл целиком (все операторы идут последовательно).
--   4. Проверки после (должны выполняться):
--        SELECT version FROM schema_migrations;  -- содержит 'v16'
--        -- сверка кошельков: триггер НЕ должен был изменить wallets
--        -- (миграция только переносит формат, суммы те же):
--        SELECT user_id, purchased_rna, booster_until_ms FROM wallets;
--        -- сравнить с суммами из журнала вручную на 2–3 пользователях:
--        SELECT user_id, SUM(CASE WHEN grant_type='rna' THEN amount ELSE 0 END)
--          FROM wallet_ledger WHERE kind='grant' GROUP BY user_id;
--        -- владение скинами перенесено:
--        SELECT user_id, skin_id, status FROM wallet_skins;
--        -- smoke: вставить тестовый грант и откатить (см. ниже «Проверки»),
--        -- либо прогнать worker/scripts/sql-smoke.test.mjs локально.
--   5. Задеплоить воркер v16 (wrangler deploy) — СТАРЫЙ код воркера (v15)
--      НЕ совместим с новой схемой (пишет kind='rna' вместо kind='grant'):
--      деплой и миграция — атомарная пара, окно между ними держать
--      минимальным, платежи в это окно — через reconcile (см. ниже).
--
-- ROLLBACK: D1 не умеет транзакционный DDL-откат между скриптами.
--   Вариант 1 (чистый): восстановить базу из снапшота шага 1
--     (Time Travel / PITR на платных тарифах, либо d1 execute backup-v15.sql
--     в пустую базу + перепривязка).
--   Вариант 2 (вперёд): чинить данные вручную — журнал wallet_ledger
--     append-only, гранты не теряются; wallets пересчитывается из журнала
--     запросом из шага 4.
--   После ЛЮБОГО отката: вернуть деплой воркера v15.
--
-- ВАЖНО ПРО ТРИГГЕР: CREATE TRIGGER ниже — ОДИН statement, но внутри
-- BEGIN...END есть точки с запятой. Если `wrangler d1 execute --file`
-- режет файл наивно по ';' и падает на кусках триггера — это ограничение
-- инструмента, а не ошибка миграции: примените ВЕСЬ CREATE TRIGGER
-- (от CREATE до END;) отдельно одним --command (одной строкой-командой)
-- либо вставьте его в SQL-консоль дашборда D1. Остальная часть файла
-- применяется --file как обычно. После применения проверьте:
--   SELECT name FROM sqlite_master WHERE type='trigger';
-- должен вернуть trg_wallet_ledger_apply.
--
-- ИДЕМПОТЕНТНОСТЬ: все CREATE — IF NOT EXISTS; все backfill-UPDATE —
-- с WHERE IS NULL / WHERE grant_type IS NULL (повторный прогон меняет
-- 0 строк); INSERT — OR IGNORE. Исключение: три ALTER TABLE ADD COLUMN
-- (у SQLite нет IF NOT EXISTS для ADD COLUMN) — при повторном прогоне
-- упадут с «duplicate column name». Это НОРМАЛЬНО и безопасно: сначала
-- проверь SELECT version FROM schema_migrations — если там уже 'v16',
-- миграцию НЕ запускать.
--
-- Что меняется (v15 → v16):
--   - orders/payments: + amount_stars, sku_version (B2; backfill для старых
--     строк: цены каталога v15 зафиксированы ниже);
--   - wallet_ledger: + grant_type, amount (знаковый INTEGER), skin_id,
--     reverses_charge_id; kind: 'rna'|'booster'|'skin' → 'grant'
--     (grant_type хранит старый kind); старые booster-строки: amount =
--     дни*86400000 (мс, как пишет триггер); skin: amount=0, skin_id=...
--   - wallet_skins: backfill из старых skin-строк журнала через json-массив
--     больше не нужен — напрямую из wallet_ledger (guard: refunded-платежи
--     исключаются — их скины уже отозваны);
--   - refund_ops, schema_migrations: новые таблицы;
--   - триггер trg_wallet_ledger_apply создаётся ПОСЛЕ переноса данных.
--     (Триггер на таблицу со старым форматом создал бы неверные применения.)
-- ============================================================================

-- 0. Guard-таблица миграций (идемпотентно).
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

-- 1. B2: SKU-колонки (ALTER без IF NOT EXISTS — см. шапку про повторный прогон).
ALTER TABLE orders ADD COLUMN amount_stars INTEGER;
ALTER TABLE orders ADD COLUMN sku_version INTEGER;
ALTER TABLE payments ADD COLUMN sku_version INTEGER;
-- P1-2 (review): снапшот гранта в заказе.
ALTER TABLE orders ADD COLUMN grant_rna INTEGER;
ALTER TABLE orders ADD COLUMN grant_booster_days INTEGER;
ALTER TABLE orders ADD COLUMN grant_skin_id TEXT;

-- Backfill старых заказов: цены каталога v15 (зафиксированы в
-- worker/src/grants.ts на момент патча №15; серверный каталог — истина).
UPDATE orders
   SET amount_stars = CASE product_id
         WHEN 'skin.virulent-magenta' THEN 100
         WHEN 'skin.abyssal-teal' THEN 100
         WHEN 'skin.gilded-prime' THEN 250
         WHEN 'booster.rna-x2-7d' THEN 75
         WHEN 'currency.rna-pack-s' THEN 35
         WHEN 'currency.rna-pack-m' THEN 100
         ELSE NULL END,
       sku_version = 1
 WHERE amount_stars IS NULL;

UPDATE payments SET sku_version = 1 WHERE sku_version IS NULL;

-- Backfill снапшота гранта для старых заказов (каталог v15):
-- NULL остаётся NULL → вебхук использует legacy fallback (текущий каталог).
UPDATE orders
   SET grant_rna = CASE product_id
         WHEN 'currency.rna-pack-s' THEN 500
         WHEN 'currency.rna-pack-m' THEN 1500
         ELSE 0 END,
       grant_booster_days = CASE product_id
         WHEN 'booster.rna-x2-7d' THEN 7
         ELSE 0 END,
       grant_skin_id = CASE product_id
         WHEN 'skin.virulent-magenta' THEN 'skin.virulent-magenta'
         WHEN 'skin.abyssal-teal' THEN 'skin.abyssal-teal'
         WHEN 'skin.gilded-prime' THEN 'skin.gilded-prime'
         ELSE NULL END
 WHERE grant_rna IS NULL AND grant_booster_days IS NULL AND grant_skin_id IS NULL;

-- 2. Новые таблицы v16 (идемпотентно).
CREATE TABLE IF NOT EXISTS refund_ops (
  operation_id         TEXT PRIMARY KEY,
  charge_id            TEXT NOT NULL,
  user_id              INTEGER NOT NULL,
  action               TEXT NOT NULL,
  status               TEXT NOT NULL,
  reason               TEXT,
  telegram_confirmed_at INTEGER,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refund_ops_charge ON refund_ops(charge_id);

CREATE TABLE IF NOT EXISTS wallet_skins (
  user_id    INTEGER NOT NULL,
  skin_id    TEXT NOT NULL,
  charge_id  TEXT NOT NULL UNIQUE,
  status     TEXT NOT NULL DEFAULT 'active',
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, skin_id, charge_id)
);

-- 3. Новые колонки wallet_ledger (ALTER — см. шапку про повторный прогон).
ALTER TABLE wallet_ledger ADD COLUMN grant_type TEXT;
ALTER TABLE wallet_ledger ADD COLUMN amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE wallet_ledger ADD COLUMN skin_id TEXT;
ALTER TABLE wallet_ledger ADD COLUMN reverses_charge_id TEXT;

-- Перенос формата v15 → v16. WHERE grant_type IS NULL делает UPDATE
-- идемпотентным: повторный прогон трогает 0 строк. Триггера ещё нет —
-- wallets не меняются (только формат строк журнала).
UPDATE wallet_ledger
   SET grant_type = kind,
       kind = 'grant',
       amount = CASE kind
                  WHEN 'rna' THEN CAST(amount_text AS INTEGER)
                  WHEN 'booster' THEN CAST(amount_text AS INTEGER) * 86400000
                  ELSE 0
                END,
       skin_id = CASE WHEN kind = 'skin' THEN amount_text END
 WHERE grant_type IS NULL;

-- 4. Backfill wallet_skins из skin-грантов журнала (идемпотентно:
-- OR IGNORE по UNIQUE(charge_id)). Guard от повторного прогона не нужен
-- сверх OR IGNORE. Исключаем charge_id с payments.status='refunded' —
-- их скины уже отозваны через skins_json в v15, активными их считать нельзя.
INSERT OR IGNORE INTO wallet_skins (user_id, skin_id, charge_id, status, granted_at)
SELECT l.user_id, l.skin_id, l.charge_id, 'active', l.created_at
  FROM wallet_ledger l
 WHERE l.kind = 'grant'
   AND l.grant_type = 'skin'
   AND l.skin_id IS NOT NULL
   AND NOT EXISTS (
         SELECT 1 FROM payments p
          WHERE p.charge_id = l.charge_id AND p.status = 'refunded'
       );

-- 5. Индекс (user_id, id) для синка по seq (идемпотентно).
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_user_seq ON wallet_ledger(user_id, id);

-- 6. Триггер — ПОСЛЕ переноса данных (см. шапку, п. «Что меняется»).
-- Полный текст и документация семантики — в worker/schema.sql.
CREATE TRIGGER IF NOT EXISTS trg_wallet_ledger_apply
AFTER INSERT ON wallet_ledger
BEGIN
  INSERT OR IGNORE INTO wallets(user_id, purchased_rna, booster_until_ms, skins_json, updated_at)
  VALUES (NEW.user_id, 0, 0, '[]', NEW.created_at);

  UPDATE wallets
     SET purchased_rna = purchased_rna + NEW.amount,
         updated_at = NEW.created_at
   WHERE user_id = NEW.user_id
     AND NEW.kind = 'grant' AND NEW.grant_type = 'rna';

  UPDATE wallets
     SET booster_until_ms = max(booster_until_ms, NEW.created_at) + NEW.amount,
         updated_at = NEW.created_at
   WHERE user_id = NEW.user_id
     AND NEW.kind = 'grant' AND NEW.grant_type = 'booster';

  INSERT OR IGNORE INTO wallet_skins(user_id, skin_id, charge_id, status, granted_at)
  SELECT NEW.user_id, NEW.skin_id, NEW.charge_id, 'active', NEW.created_at
   WHERE NEW.kind = 'grant' AND NEW.grant_type = 'skin';

  UPDATE wallets
     SET purchased_rna = max(0, purchased_rna + NEW.amount),
         updated_at = NEW.created_at
   WHERE user_id = NEW.user_id
     AND NEW.kind = 'reversal' AND NEW.grant_type = 'rna';

  UPDATE wallets
     SET booster_until_ms = max(NEW.created_at, booster_until_ms + NEW.amount),
         updated_at = NEW.created_at
   WHERE user_id = NEW.user_id
     AND NEW.kind = 'reversal' AND NEW.grant_type = 'booster';

  UPDATE wallet_skins
     SET status = 'reversed'
   WHERE charge_id = NEW.reverses_charge_id
     AND status = 'active'
     AND NEW.kind = 'reversal' AND NEW.grant_type = 'skin';
END;

-- 7. Отметка о применении (идемпотентно).
INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('v16', strftime('%s','now')*1000);
