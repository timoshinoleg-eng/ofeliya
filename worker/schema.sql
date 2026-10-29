-- OFELIYA payments reference backend — Cloudflare D1 schema (патч №16, v16).
--
-- Ключевое изменение v16: выдача гранта — ОДИН атомарный db.batch() из трёх
-- statement'ов (orders→'paid', payments INSERT, wallet_ledger INSERT) + SQL-
-- триггер trg_wallet_ledger_apply, который ведёт wallets/wallet_skins.
-- Патч №15 делал ДВА батча (запись платежа, затем applyGrantBatch с
-- read→calc→write кошелька в JS) + self-heal на случай падения между ними.
-- Это были P0-баги A1/A2: между батчами нет атомарности, а интерактивных
-- транзакций в D1 нет вообще.
--
-- D1-факты, на которых построена схема (проверены по документации):
--  - db.batch() — ОДНА транзакция: при ошибке любого statement весь батч
--    откатывается, частичных коммитов нет. Cloudflare docs (цитата via
--    event-driven.io): «Batched statements are SQL transactions. If a
--    statement in the sequence fails, then an error is returned for that
--    specific statement, and it aborts or rolls back the entire sequence.»
--    https://event-driven.io/en/cloudflare_d1_transactions_and_tradeoffs/
--  - Независимо подтверждено: dev.to/hirodeath «D1 has no BEGIN TRANSACTION»
--    («D1 runs the statements in a batch as one transaction and rolls back
--    the entire batch when a statement fails»)
--    https://dev.to/hirodeath/cloudflare-d1-has-no-begin-transaction-so-i-tested-its-limits-and-batch-api-5813
--    и aicassindra «D1 in depth» («D1 gives you atomicity through batch().
--    The statements in one batch run sequentially as a single SQL
--    transaction; if any statement fails, the whole sequence is rolled
--    back») https://www.aicassindra.com/blogs/cloud/cloudflare_d1.html
--  - Интерактивных транзакций в D1 НЕТ: прочитать строку, решить в JS и
--    записать в той же транзакции нельзя — вся логика решения живёт в SQL
--    (те же источники). Поэтому кошелёк ведёт ТРИГГЕР, а не JS.
--  - Триггеры — ядро SQLite (D1 построен на SQLite, расширения не нужны):
--    https://www.sqlite.org/lang_createtrigger.html
--
-- Создание базы:
--   wrangler d1 create ofeliya-payments
-- Применение схемы:
--   wrangler d1 execute ofeliya-payments --file=worker/schema.sql
-- (или --remote, если запускается из локальной папки с привязкой)
-- Апгрейд существующей базы v15 → v16: worker/migration-16.sql
-- (в шапке файла — шаги, проверки и rollback).
--
-- Статусы payments.status:
--   'paid'      — платёж подтверждён Telegram; грант УЖЕ применён сервером
--                 (атомарный батч + триггер, патч №16);
--   'fulfilled' — клиент применил серверный кошелёк и вызвал POST /api/ack
--                 (только учёт);
--   'refund_requested' — админ начал execute-возврат (патч №16, A5):
--                 бронь перед refundStarPayment; повторный execute с тем же
--                 operation_id продолжает с этого состояния;
--   'refunded'  — ТОЛЬКО через POST /api/admin/refund (двухшаговый с патча
--                 №15, state machine с патча №16); воркер сам этот статус
--                 не выставляет.
--
-- Статусы orders.status:
--   'pending' — инвойс создан, оплата ещё не пришла;
--   'paid'    — платёж по заказу записан (атомарный батч в successful_payment);
--   'expired' — вручную/скриптом: окно оплаты истекло без платежа.
-- Строгий pre_checkout (патч №15, P0-2): ok:true ТОЛЬКО при status='pending'
-- И совпадении from.id с order.user_id. Повторная оплата того же nonce
-- невозможна: после первой оплаты заказ уже 'paid'.
--
-- Серверный кошелёк (источник правды о ПОКУПКАХ) — ведётся ТРИГГЕРОМ:
--   wallets: один ряд на user_id; purchased_rna — append-only сумма выданных
--     РНК (ЦЕЛЫЕ; INTEGER: сложение — атомарным UPDATE в триггере, без
--     read-modify-write гонки; гранты всегда целые);
--     booster_until_ms — абсолютный срок бустера (max(текущий, now) + дни);
--     skins_json — DEPRECATED с патча №16: колонка оставлена для
--     совместимости, триггер её НЕ ведёт; владение скинами — wallet_skins.
--   wallet_ledger: append-only журнал; id — монотонный seq (AUTOINCREMENT);
--     charge_id UNIQUE — идемпотентность выдачи при ретраях Telegram;
--     kind: 'grant' | 'reversal'; grant_type: 'rna' | 'booster' | 'skin';
--     amount — ЗНАКОВЫЙ INTEGER (rna +N/-N; booster +мс/-мс; skin 0);
--     reverses_charge_id — для reversal: какой грант откатываем.
--   wallet_skins: владение скинами; владение = EXISTS строка status='active'.
--     Reversal гасит ТОЛЬКО строку своего charge_id: если тот же скин был
--     выдан дважды (два платежа), второй активный остаётся.
-- Клиент НЕ начисляет сам: POST /api/wallet → дельта по seq (tip_seq).
--
-- Возвраты — state machine в refund_ops (патч №16, A5):
--   mark (execute!==true): требует confirmExternalRefund===true + reason
--     («подтверди, что деньги реально возвращены вне системы»); один батч:
--     refund_ops + payments→'refunded' + reversal в ledger.
--   execute===true: батч1 (refund_ops 'requested' + payments→
--     'refund_requested'), затем refundStarPayment, затем батч2
--     (refund_ops→'completed', payments→'refunded', reversal). Ошибка
--     'already refunded' от Telegram трактуется как подтверждение
--     (идемпотентный повтор без двойного списания). Сетевая ошибка →
--     операция остаётся 'requested' → повтор с тем же operationId
--     продолжает.
-- Refund откатывает СЕРВЕРНЫЙ кошелёк; уже материализованное локальное
-- значение на устройстве НЕ отзывается (см. «Модель угроз» в index.ts).
-- Политика booster-reversal: время вспять не отматываем — ниже момента
-- возврата (created_at reversal-строки) не уходим (см. триггер ниже и
-- README_DEPLOY).
--
-- server_id: воркер отдаёт env.PAYMENTS_SERVER_ID (дефолт 'ofeliya-d1-v1') в
-- POST /api/wallet. Mark должен держать его СТАБИЛЬНЫМ на бэкенд: смена
-- значения = смена серверного источника правды (новая D1 / сброс), клиент
-- по нему детектирует «другой сервер» (см. README_DEPLOY).
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
  -- B2 (патч №16): цена и версия каталога фиксируются в заказе — заказ
  -- иммутабелен; вебхук сверяет sp.total_amount именно с amount_stars.
  amount_stars INTEGER,
  sku_version  INTEGER,
  -- P1-2 (независимый review): снапшот гранта на момент создания инвойса.
  -- Вебхук выдаёт ИМЕННО этот грант, а не текущий каталог: изменение
  -- гранта без смены цены между инвойсом и оплатой не меняет контракт.
  grant_rna           INTEGER,
  grant_booster_days  INTEGER,
  grant_skin_id       TEXT,
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
  -- B2 (патч №16): версия каталога на момент платежа (аудит дрейфа цен).
  sku_version INTEGER,
  created_at INTEGER NOT NULL,
  fulfilled_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_payments_user  ON payments(user_id);
-- Патч №15 (P0-2): один nonce — один платёж. Backstop повторного
-- использования заказа (основной гейт — строгий pre_checkout).
-- NULL-nonce допускаются кратно (SQLite), в практике nonce всегда есть.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_nonce_unique ON payments(nonce);

-- Серверный кошелёк: ведётся ТРИГГЕРОМ trg_wallet_ledger_apply (ниже).
-- purchased_rna / booster_until_ms — INTEGER, атомарные UPDATE в триггере.
-- skins_json — DEPRECATED с патча №16 (триггер не ведёт; владение скинами —
-- wallet_skins). Колонка НЕ удаляется: старые бэкапы/инструменты могут
-- её читать; новые записи получают '[]'.
CREATE TABLE IF NOT EXISTS wallets (
  user_id          INTEGER PRIMARY KEY,
  purchased_rna    INTEGER NOT NULL DEFAULT 0,
  booster_until_ms INTEGER NOT NULL DEFAULT 0,
  skins_json       TEXT NOT NULL DEFAULT '[]',
  updated_at       INTEGER NOT NULL
);

-- Append-only журнал грантов и возвратов. id — монотонный seq (клиент
-- синкается по нему: /api/wallet → since_seq/tip_seq). charge_id UNIQUE —
-- идемпотентность выдачи при ретраях Telegram: дубликатная доставка даёт
-- ON CONFLICT DO NOTHING → вставки нет → триггер не срабатывает → ноль
-- доп. начисления.
CREATE TABLE IF NOT EXISTS wallet_ledger (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL,
  charge_id         TEXT NOT NULL UNIQUE,
  kind              TEXT NOT NULL,   -- 'grant' | 'reversal'
  grant_type        TEXT NOT NULL,   -- 'rna' | 'booster' | 'skin'
  amount            INTEGER NOT NULL DEFAULT 0,  -- знаковый: rna ±N; booster ±мс; skin 0
  skin_id           TEXT,            -- для grant_type='skin'
  reverses_charge_id TEXT,           -- для kind='reversal': какой грант откатываем
  amount_text       TEXT NOT NULL DEFAULT '',    -- аудит-совместимость (v15)
  created_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_user_seq ON wallet_ledger(user_id, id);

-- Владение скинами (патч №16). Владение = EXISTS строка status='active'.
-- PK включает charge_id: один скин может быть выдан дважды (два платежа) —
-- reversal гасит только строку своего charge_id.
CREATE TABLE IF NOT EXISTS wallet_skins (
  user_id    INTEGER NOT NULL,
  skin_id    TEXT NOT NULL,
  charge_id  TEXT NOT NULL UNIQUE,
  status     TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'reversed'
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, skin_id, charge_id)
);

-- Журнал возвратов — state machine (патч №16, A5). Секреты (токены) сюда
-- НЕ пишутся: только charge_id, operation_id, reason (обрезан до 200),
-- статусы и timestamps.
CREATE TABLE IF NOT EXISTS refund_ops (
  operation_id         TEXT PRIMARY KEY,
  charge_id            TEXT NOT NULL,
  user_id              INTEGER NOT NULL,
  action               TEXT NOT NULL,  -- 'mark' | 'execute'
  status               TEXT NOT NULL,  -- 'requested' | 'telegram_confirmed' |
                                      -- 'grant_reversed' | 'completed' | 'failed'
  reason               TEXT,
  telegram_confirmed_at INTEGER,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refund_ops_charge ON refund_ops(charge_id);

-- P1-5 (независимый review): дубликатные платежи — второй successful_payment
-- на тот же nonce (гонка двух pre_checkout). Деньги списаны Telegram, но
-- заказ уже оплачен: записываем платёж БЕЗ гранта (видим + возвращаем
-- вручную через /api/admin/refund), громкий лог. UNIQUE(nonce) в payments
-- не даёт вставить сюда — поэтому отдельная таблица.
CREATE TABLE IF NOT EXISTS duplicate_payments (
  charge_id  TEXT PRIMARY KEY,
  nonce      TEXT NOT NULL,
  user_id    INTEGER NOT NULL,
  product_id TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  currency   TEXT NOT NULL,
  reason     TEXT NOT NULL,  -- 'nonce_reuse'
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_duplicate_payments_nonce ON duplicate_payments(nonce);

-- Учёт применённых миграций (записывает migration-16.sql; свежий деплой
-- по этому файлу — тоже v16).
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

-- Триггер выдачи/возврата (патч №16, A1). Срабатывает на КАЖДУЮ вставку в
-- wallet_ledger — внутри того же батча/транзакции, что и сама вставка
-- (атомарно: либо платёж+грант+кошелёк, либо ничего).
--
-- Порядок важен: сначала гарантируем строку wallets (INSERT OR IGNORE),
-- затем применяем изменения. Все UPDATE/INSERT имеют WHERE-гейты по
-- NEW.kind/NEW.grant_type: для чужой ветки условие ложно → 0 строк.
--
-- Семантика (зеркало выдачи до патча №16, теперь — в SQL, а не в JS):
--  - rna grant:      purchased_rna += amount (плоско, без бонусов);
--  - booster grant:  booster_until_ms = max(текущий, момент выдачи) + amount
--                    (время не сгорает; amount в мс);
--  - skin grant:     аддитивное множество в wallet_skins (OR IGNORE);
--  - rna reversal:   purchased_rna = max(0, purchased_rna + amount),
--                    amount отрицательный → ниже нуля не уходим;
--  - booster reversal: booster_until_ms = max(момент возврата,
--                    booster_until_ms + amount) — ПОЛИТИКА: время вспять не
--                    отматываем, ниже момента возврата не уходим
--                    (задокументировано в README_DEPLOY);
--  - skin reversal:  гасим ТОЛЬКО строку charge_id=reverses_charge_id
--                    (владение сохраняется при других активных выдачах).
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
