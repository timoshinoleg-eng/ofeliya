-- ============================================================================
-- Миграция D1: v16 → v17 (монетизация v3, сезонный пропуск). Применять,
-- ТОЛЬКО если база уже создана со схемой v16; свежий деплой — просто
-- worker/schema.sql (D1 в проде ЕЩЁ НЕТ — этот файл нужен для пути
-- апгрейда, если v16 успеет попасть в прод до v17).
--
-- Применение:
--   wrangler d1 execute ofeliya-payments --file=worker/migration-17.sql
--   (добавить --remote для продакшн-базы)
--
-- КЛЮЧЕВЫЕ ШАГИ (порядок важен):
--   1. Снапшот: wrangler d1 export ofeliya-payments --output=backup-v16.sql
--      (или --remote). Без снапшота миграцию не запускать.
--   2. Pre-check (запросы ниже — должны вернуть 0 строк):
--        SELECT version FROM schema_migrations WHERE version='v17';
--      Ненулевой результат → миграция уже применена, НЕ запускать повторно
--      (ALTER TABLE ADD COLUMN без IF NOT EXISTS упадёт на повторном
--      прогоне — это нормально и безопасно, см. ниже).
--   3. Применить файл целиком (все операторы идут последовательно).
--   4. ГЕЙТ СХЕМЫ (P1-3) — ЖЁСТКИЙ: СТОП, если проверка красная.
--      Без триггера гранты ТИХО теряются (платёж paid, кошелёк пуст) —
--      воркер v17 НЕ деплоить и платежи НЕ принимать до зелёного гейта.
--      Локально (файлы схемы, изолированно): npm run check-schema
--      Реальная D1 (только чтение): node worker/scripts/check-schema.mjs
--        --print-commands → выполнить выданные wrangler d1 execute
--        --command и сверить с ожидаемым. Дополнительно вручную:
--        SELECT version FROM schema_migrations;  -- содержит 'v17'
--        -- триггеры пересозданы (проверить тела: apply — есть season_pass,
--        -- guard — RAISE(ABORT) для второй подписки, P2-N1):
--        SELECT sql FROM sqlite_master WHERE type='trigger' AND name='trg_wallet_ledger_apply';
--        SELECT sql FROM sqlite_master WHERE type='trigger' AND name='trg_wallet_ledger_season_pass_guard';
--        -- снапшот гранта у старых заказов полный (0 — backfill сработал):
--        SELECT COUNT(*) FROM orders WHERE grant_season_pass_days IS NULL;
--        -- кошельки не изменились (миграция только добавляет колонку):
--        SELECT user_id, purchased_rna, booster_until_ms, season_pass_until_ms FROM wallets;
--        -- smoke: прогнать worker/scripts/sql-smoke.test.mjs локально
--        -- (триггер season_pass grant/reversal).
--   5. Задеплоить воркер v17 (wrangler deploy) — СТАРЫЙ код воркера (v16)
--      НЕ пишет grant_season_pass_days (NULL), но новый код толерантен:
--      NULL при полном v16-снапшоте трактуется как 0 (см.
--      grantFromOrderSnapshot в worker/src/index.ts). Обратное окно
--      (новый воркер, старая схема) НЕДОПУСТИМО: INSERT заказа упадёт
--      на несуществующей колонке → 502 order-store-failed. Порядок:
--      сначала миграция, потом деплой воркера.
--
-- ROLLBACK: D1 не умеет транзакционный DDL-откат между скриптами.
--   ЕДИНСТВЕННЫЙ безопасный откат — восстановить базу из снапшота
--   шага 1 (и вернуть деплой v16). НО: восстановление в одиночку
--   безопасно ТОЛЬКО при нуле платежей после снапшота — иначе они
--   стираются безвозвратно (Telegram не переотправит: вебхук уже
--   acked). CR-R3-5: платёжный трафик ставится на паузу от создания
--   снапшота до завершения отката; перед восстановлением — полный
--   экспорт живой базы + сверка пост-снапшотных платежей.
--   CR-R4-3: возвраты — ДО восстановления, пока живы v17-хендлер и
--   строки payments (после восстановления /api/admin/refund вернёт
--   not-found: пост-снапшотных строк payments в базе уже нет).
--   CR-R4-4: пропуск и бандлы — ТОЛЬКО возврат (пропуск в v16
--   переприменить нельзя — нет season_pass_until_ms и ветки
--   триггера; у бандлов компоненты делят один charge_id, а v16
--   wallet_ledger и wallet_skins допускают одну строку на
--   charge_id). Остальные гранты — ручное переприменение ПОСЛЕ
--   восстановления. Полная процедура — worker/README_DEPLOY.md §12.
--   Откат ТОЛЬКО
--   воркера на v16 при
--   схеме v17 НЕ БЕЗОПАСЕН (CR5): v17 wallet_ledger не имеет
--   charge-only UNIQUE (UNIQUE — (charge_id, grant_type, skin_id)),
--   а v16-код пишет гранты через INSERT ... ON CONFLICT(charge_id)
--   DO NOTHING — такой INSERT против v17-схемы падает («ON CONFLICT
--   clause does not match any PRIMARY KEY or UNIQUE constraint»,
--   доказано на реальном SQLite в check-schema.test.mjs, тест CR5),
--   и КАЖДАЯ оплата на откаченном воркере уйдёт в 503/потерю гранта.
--   Не откатывайте воркер без отката схемы.
--   ОКНО «миграция → деплой v17»: между шагом 3 и шагом 5 старый
--   воркер v16 уже НЕСОВМЕСТИМ со схемой v17 (тот же ON CONFLICT) —
--   митигация: деплоить v17 НЕМЕДЛЕННО после миграции (шаги 3→5 без
--   паузы) либо заранее поставить платёжный трафик на паузу (вебхук
--   Telegram переотправит позже; ретрай безопасен). После ЛЮБОГО
--   отката: вернуть деплой v16 ТОЛЬКО вместе со снапшотом v16.
--
-- ВАЖНО ПРО ТРИГГЕРЫ: DROP + CREATE TRIGGER ниже — внутри BEGIN...END есть
-- точки с запятой. Если `wrangler d1 execute --file` режет файл наивно
-- по ';' и падает на кусках триггера — это ограничение инструмента:
-- примените КАЖДЫЙ CREATE TRIGGER (от CREATE до END;) отдельно одним
-- --command либо в SQL-консоли дашборда D1. Остальная часть файла
-- применяется --file как обычно. После применения проверьте:
--   SELECT name FROM sqlite_master WHERE type='trigger';
-- должен вернуть trg_wallet_ledger_apply И trg_wallet_ledger_season_pass_guard
-- (guard — P2-N1: без него конкурентная двойная подписка снова возможна).
--
-- ИДЕМПОТЕНТНОСТЬ: все CREATE — IF NOT EXISTS; backfill-UPDATE — с
-- WHERE IS NULL (повторный прогон меняет 0 строк); INSERT — OR IGNORE.
-- Исключение: пять ALTER TABLE ADD COLUMN (у SQLite нет IF NOT EXISTS
-- для ADD COLUMN) — при повторном прогоне упадут с «duplicate column
-- name». Это НОРМАЛЬНО и безопасно: сначала проверь SELECT version FROM
-- schema_migrations — если там уже 'v17', миграцию НЕ запускать.
--
-- ЧАСТИЧНАЯ МИГРАЦИЯ (P2-4): точная процедура восстановления.
-- Файл упал посередине (обрыв соединения, ошибка wrangler) — файл
-- НЕ запускать повторно вслепую: wrangler d1 execute --file НЕ
-- транзакционен между statement'ами, часть шагов уже применена.
--
--   ШАГ 1 — ДИАГНОСТИКА (только чтение, все запросы — SELECT/PRAGMA):
--     a) SELECT version FROM schema_migrations;
--        'v17' есть → файл дошёл до конца (шаг 5 файла), падение —
--        ПОСЛЕ миграции (например, на выводе результата): прогнать
--        гейт (п. 4 «КЛЮЧЕВЫХ ШАГОВ» выше) и идти дальше. 'v17' нет →
--        идти по пунктам ниже.
--     b) PRAGMA table_info(orders); — есть ли grant_season_pass_days,
--        grant_bundle_json и invoice_url (шаг 1 файла применён?).
--     c) PRAGMA table_info(wallets); — есть ли season_pass_until_ms.
--     d) PRAGMA table_info(duplicate_payments); — есть ли status.
--     e) SELECT name FROM sqlite_master WHERE type='table'
--        AND name IN ('subscription_events','wallet_ledger_new','wallet_skins_new');
--     f) PRAGMA index_list('wallet_ledger'); — есть ли UNIQUE-индекс
--        на (charge_id, grant_type, skin_id) (шаг 3 файла применён?).
--     g) SELECT sql FROM sqlite_master WHERE type='trigger'
--        AND name='trg_wallet_ledger_apply'; — триггер есть? тело
--        содержит season_pass (шаг 4 файла применён)?
--
--   ШАГ 2 — РЕШЕНИЕ:
--     - wallet_ledger_new ИЛИ wallet_skins_new существует (п. e) →
--       миграция упала ВНУТРИ пересоздания таблиц (шаг 3/3b файла):
--       ВОССТАНОВИТЬ БАЗУ ИЗ СНАПШОТА шага 0 и прогнать файл заново.
--       Вручную НЕ достраивать: DROP TABLE уже снёс триггер, копия
--       журнала может быть частичной — ручная достройка рискует
--       потерей строк журнала.
--     - Иначе — доработать недостающие шаги ВРУЧНУЮ, по таблице
--       (нумерация — шаги файла, см. комментарии -- N. в теле):
--         шаг 0 (schema_migrations) — идемпотентен, повторить как есть;
--         шаг 1 (5× ALTER) — пропустить УЖЕ добавленные колонки
--           (п. b–d), выполнить только недостающие;
--         шаг 2 (subscription_events + индекс) — идемпотентен
--           (IF NOT EXISTS), повторить как есть;
--         шаг 3 (wallet_ledger) — выполнить ЦЕЛИКОМ как есть, только
--           если п. f показывает СТАРЫЙ UNIQUE (charge_id); если новый
--           UNIQUE уже есть — пропустить целиком;
--         шаг 3b (wallet_skins) — выполнить целиком, только если
--           PRAGMA index_list('wallet_skins') ещё показывает UNIQUE
--           на charge_id (sqlite_autoindex); иначе пропустить;
--         шаг 4 (триггер apply) — идемпотентен (DROP IF EXISTS + CREATE),
--           пересоздать целиком; шаг 4b (guard-триггер P2-N1) — так же,
--           пересоздать целиком (без него гейт check-schema красный);
--         шаг 5 (отметка v17) — INSERT OR IGNORE, выполнить как есть.
--     - При ЛЮБЫХ сомнениях — восстановить из снапшота и начать
--       заново: файл рассчитан на один прогон на чистой v16.
--
--   ШАГ 3 — ГЕЙТ: после ручной доработки ОБЯЗАТЕЛЬНО прогнать гейт
--   (п. 4 «КЛЮЧЕВЫХ ШАГОВ»: npm run check-schema + --print-commands
--   против реальной D1). Красный гейт → восстановить из снапшота,
--   не деплоить воркер.
--   Воркер v17 на частично мигрированной базе НЕДОПУСТИМ: INSERT
--   заказа упадёт на несуществующей колонке (502), а отсутствующий
--   триггер даст ТИХУЮ потерю грантов.
--
-- Что меняется (v16 → v17):
--   - orders: + grant_season_pass_days INTEGER (снапшот дней пропуска,
--     4-е поле гранта; backfill 0 для старых заказов);
--   - orders: + grant_bundle_json TEXT (снапшот компонентов бандла,
--     NULL у одиночных; backfill не нужен);
--   - orders: + invoice_url TEXT (CR-R4-2: URL выданного инвойса,
--     NULL — инвойс ещё не выдавался; ретрай переиспользует URL без
--     повторного createInvoiceLink, пометка invoice_failed — только
--     при NULL; backfill не нужен);
--   - wallets: + season_pass_until_ms INTEGER NOT NULL DEFAULT 0
--     (абсолютный срок пропуска, как booster_until_ms);
--   - duplicate_payments: + status TEXT NOT NULL DEFAULT 'pending'
--     (P1-1: state machine возврата дубликата; существующие строки
--     получают 'pending' — их возвраты ещё не выполнялись);
--   - subscription_events: новая таблица (аудит BotSubscriptionUpdated);
--   - wallet_ledger: UNIQUE(charge_id) → UNIQUE(charge_id, grant_type,
--     skin_id) — ПЕРЕСОЗДАНИЕ таблицы копированием (SQLite не умеет
--     DROP CONSTRAINT; DROP TABLE сносит и триггер — он пересоздаётся
--     шагом 4). Старые NULL skin_id нормализуются в '' при копировании
--     (инвариант нового UNIQUE: skin_id никогда не NULL в журнале);
--   - wallet_skins: UNIQUE с charge_id СНЯТ — пересоздание таблицы
--     (бандл из трёх скинов — три строки с одним charge_id;
--     уникальность держит PK (user_id, skin_id, charge_id));
--   - триггер trg_wallet_ledger_apply пересоздаётся с ветками season_pass
--     (grant: max(текущий, created_at) + amount; reversal: max(created_at,
--     текущий + amount) — политика «время вспять не отматываем»).
--     Пересоздание триггера НЕ меняет wallets (триггер срабатывает только
--     на новые вставки в wallet_ledger).
--   - триггер trg_wallet_ledger_season_pass_guard (P2-N1, раунд 2):
--     BEFORE INSERT, RAISE(ABORT) для НЕ-продлённых season_pass-грантов
--     при активном пропуске (атомарный слой против конкурентной двойной
--     подписки; продления — по derived nonce с ':', дубликатная доставка
--     — по существующему ключу журнала).
-- ============================================================================

-- 0. Guard-таблица миграций (идемпотентно).
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

-- 1. Снапшот гранта: 4-е поле (ALTER без IF NOT EXISTS — см. шапку).
ALTER TABLE orders ADD COLUMN grant_season_pass_days INTEGER;
ALTER TABLE orders ADD COLUMN grant_bundle_json TEXT;
-- CR-R4-2: URL выданного инвойса (NULL — не выдавался). Ретрай
-- переиспользует его; пометка invoice_failed — только при NULL.
ALTER TABLE orders ADD COLUMN invoice_url TEXT;
ALTER TABLE wallets ADD COLUMN season_pass_until_ms INTEGER NOT NULL DEFAULT 0;
-- P1-1: state machine возврата дубликата ('pending' → 'refund_requested' →
-- 'refunded'); существующие дубликаты получают 'pending' по DEFAULT.
ALTER TABLE duplicate_payments ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';

-- Backfill старых заказов: пропуска у них не было → 0. Идемпотентно
-- (WHERE IS NULL). Без backfill строгая проверка полноты снапшота в
-- grantFromOrderSnapshot всё равно толерантна к NULL в этом поле, но
-- явный 0 чище для аудита.
UPDATE orders SET grant_season_pass_days = 0 WHERE grant_season_pass_days IS NULL;

-- 2. Аудит BotSubscriptionUpdated (идемпотентно).
CREATE TABLE IF NOT EXISTS subscription_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  nonce      TEXT NOT NULL,
  charge_id  TEXT,
  state      TEXT NOT NULL,
  -- P2-3: источник записи — 'telegram' (BotSubscriptionUpdated) или
  -- 'admin' (POST /api/admin/subscription / refund cancelSubscription).
  source     TEXT NOT NULL DEFAULT 'telegram',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscription_events_nonce ON subscription_events(nonce);

-- 3. wallet_ledger: UNIQUE(charge_id) → UNIQUE(charge_id, grant_type,
-- skin_id) — пересоздание таблицы копированием (см. шапку). DROP TABLE
-- сносит триггер — он пересоздаётся шагом 4. Старые NULL skin_id → ''.
CREATE TABLE wallet_ledger_new (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL,
  charge_id         TEXT NOT NULL,
  kind              TEXT NOT NULL,
  grant_type        TEXT NOT NULL,
  amount            INTEGER NOT NULL DEFAULT 0,
  skin_id           TEXT,
  reverses_charge_id TEXT,
  amount_text       TEXT NOT NULL DEFAULT '',
  created_at        INTEGER NOT NULL,
  UNIQUE (charge_id, grant_type, skin_id)
);
INSERT INTO wallet_ledger_new (id, user_id, charge_id, kind, grant_type, amount, skin_id, reverses_charge_id, amount_text, created_at)
  SELECT id, user_id, charge_id, kind, grant_type, amount, COALESCE(skin_id, ''), reverses_charge_id, amount_text, created_at FROM wallet_ledger;
DROP TABLE wallet_ledger;
ALTER TABLE wallet_ledger_new RENAME TO wallet_ledger;
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_user_seq ON wallet_ledger(user_id, id);

-- 3b. wallet_skins: снять UNIQUE с charge_id (бандл из трёх скинов —
-- три строки с одним charge_id; уникальность держит PK).
CREATE TABLE wallet_skins_new (
  user_id    INTEGER NOT NULL,
  skin_id    TEXT NOT NULL,
  charge_id  TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active',
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, skin_id, charge_id)
);
INSERT INTO wallet_skins_new (user_id, skin_id, charge_id, status, granted_at)
  SELECT user_id, skin_id, charge_id, status, granted_at FROM wallet_skins;
DROP TABLE wallet_skins;
ALTER TABLE wallet_skins_new RENAME TO wallet_skins;

-- 4. Триггер — ПЕРЕСОЗДАТЬ с ветками season_pass (полный текст — как в
-- worker/schema.sql; DROP нужен, т.к. CREATE TRIGGER IF NOT EXISTS не
-- обновляет существующий триггер).
DROP TRIGGER IF EXISTS trg_wallet_ledger_apply;
CREATE TRIGGER trg_wallet_ledger_apply
AFTER INSERT ON wallet_ledger
BEGIN
  INSERT OR IGNORE INTO wallets(user_id, purchased_rna, booster_until_ms, season_pass_until_ms, skins_json, updated_at)
  VALUES (NEW.user_id, 0, 0, 0, '[]', NEW.created_at);

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

  UPDATE wallets
     SET season_pass_until_ms = max(season_pass_until_ms, NEW.created_at) + NEW.amount,
         updated_at = NEW.created_at
   WHERE user_id = NEW.user_id
     AND NEW.kind = 'grant' AND NEW.grant_type = 'season_pass';

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

  UPDATE wallets
     SET season_pass_until_ms = max(NEW.created_at, season_pass_until_ms + NEW.amount),
         updated_at = NEW.created_at
   WHERE user_id = NEW.user_id
     AND NEW.kind = 'reversal' AND NEW.grant_type = 'season_pass';

  UPDATE wallet_skins
     SET status = 'reversed'
   WHERE charge_id = NEW.reverses_charge_id
     AND status = 'active'
     AND NEW.kind = 'reversal' AND NEW.grant_type = 'skin';
END;

-- 4b. Guard конкурентной двойной подписки (P2-N1, раунд 2) — полный
-- текст, как в worker/schema.sql (триггер новый для v17: в v16 его не
-- было, DROP IF EXISTS — идемпотентность повторного прогона шага).
-- BEFORE INSERT: RAISE(ABORT) для НЕ-продлённых season_pass-грантов при
-- активном пропуске (продление — по payments.nonce с ':', дубликатная
-- доставка — по существующему ключу журнала; см. комментарий в schema.sql).
DROP TRIGGER IF EXISTS trg_wallet_ledger_season_pass_guard;
CREATE TRIGGER trg_wallet_ledger_season_pass_guard
BEFORE INSERT ON wallet_ledger
BEGIN
  SELECT RAISE(ABORT, 'season pass already active for user')
   WHERE NEW.kind = 'grant' AND NEW.grant_type = 'season_pass'
     AND NOT EXISTS (
       SELECT 1 FROM wallet_ledger
        WHERE charge_id = NEW.charge_id AND grant_type = NEW.grant_type
          AND skin_id = COALESCE(NEW.skin_id, '')
     )
     AND EXISTS (
       SELECT 1 FROM wallets
        WHERE user_id = NEW.user_id AND season_pass_until_ms > NEW.created_at
     )
     AND NOT EXISTS (
       SELECT 1 FROM payments
        WHERE charge_id = NEW.charge_id AND instr(nonce, ':') > 0
     );
END;

-- 5. Отметка о применении (идемпотентно).
INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('v17', strftime('%s','now')*1000);
