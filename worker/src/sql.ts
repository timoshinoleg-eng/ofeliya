/**
 * sql.ts — все МУТИРУЮЩИЕ SQL-операторы воркера (патч №16).
 *
 * Зачем отдельный файл: атомарный платёж — это ОДИН db.batch() из
 * нескольких statement'ов, и тексты этих statement'ов должны быть единым
 * источником правды (код + тесты + документация). SELECT-запросы чтения
 * оставлены в index.ts рядом с хендлерами.
 *
 * Формат — ТОЛЬКО erasable TypeScript: `export const` со строками, никаких
 * enum/типов/импортов в runtime-позициях. Файл должен импортироваться через
 * `node --experimental-strip-types` в тестах без транспиляции:
 *   node --experimental-strip-types worker/scripts/sql-smoke.test.mjs
 *
 * Плейсхолдеры — позиционные `?` (совместимы и с D1, и с node:sqlite).
 *
 * D1-факты, на которых построена схема (источники зафиксированы):
 *  - db.batch() — ОДНА транзакция: statements выполняются последовательно;
 *    при ошибке любого statement весь батч откатывается, частичных коммитов
 *    нет. Cloudflare docs (цитата via event-driven.io):
 *    «Batched statements are SQL transactions. If a statement in the sequence
 *    fails, then an error is returned for that specific statement, and it
 *    aborts or rolls back the entire sequence.»
 *    https://event-driven.io/en/cloudflare_d1_transactions_and_tradeoffs/
 *  - То же независимо подтверждено: dev.to/hirodeath
 *    «D1 runs the statements in a batch as one transaction and rolls back
 *    the entire batch when a statement fails»
 *    https://dev.to/hirodeath/cloudflare-d1-has-no-begin-transaction-so-i-tested-its-limits-and-batch-api-5813
 *    и aicassindra «D1 has no BEGIN TRANSACTION»:
 *    «D1 gives you atomicity through batch(). The statements in one batch run
 *    sequentially as a single SQL transaction; if any statement fails,
 *    the whole sequence is rolled back»
 *    https://www.aicassindra.com/blogs/cloud/cloudflare_d1.html
 *  - Интерактивных транзакций в D1 НЕТ: прочитать строку, решить в JS и
 *    записать в той же транзакции нельзя — вся логика решения должна жить
 *    в SQL (те же источники). Поэтому выдача гранта — AFTER INSERT триггер
 *    на wallet_ledger, а не read→calc→write в JS (как было в патче №15).
 *  - Триггеры — ядро SQLite (D1 построен на SQLite, расширения не нужны):
 *    https://www.sqlite.org/lang_createtrigger.html
 */

/** Заказ: 'pending' → 'paid'. Гейт status='pending' — повторная оплата невозможна. */
export const SQL_UPDATE_ORDER_PAID =
  "UPDATE orders SET status='paid' WHERE nonce=? AND status='pending'";

/**
 * P1-2: заказ отклонённой подписки → терминальный статус 'denied'.
 * Только из 'pending' (первая оплата отклонённой подписки приходит,
 * пока заказ ещё pending). Продления denied-заказа не грантятся
 * (гейт в recordSuccessfulPayment). Pre_checkout отклоняет не-pending
 * заказы, поэтому 'denied' заодно блокирует оплату старых инвойсов.
 */
export const SQL_UPDATE_ORDER_DENIED =
  "UPDATE orders SET status='denied' WHERE nonce=? AND status='pending'";

/**
 * CR-R3-2: заказ, чей инвойс НЕ создан (createInvoiceLink упал), —
 * терминальный статус 'invoice_failed'. Без этого свежий pending-заказ
 * подписки блокировал гейт freshPendingSub на 24ч, хотя инвойса нет и
 * оплачивать нечего. Только из 'pending' (гонка с оплатой невозможна:
 * инвойса нет — pre_checkout его не пропустит, но гейт бесплатный).
 * Статус задокументирован в worker/schema.sql; CHECK на orders.status
 * нет — миграция не нужна. Чистка — как 'expired' (30 дней, см.
 * schema.sql). Same-nonce ретрай (P2-5) такой заказ не воскрешает:
 * клиент генерирует свежий nonce на каждую попытку, а P2-5 нужен для
 * потерянных ответов при УДАВШЕМСЯ создании инвойса (заказ pending).
 */
export const SQL_UPDATE_ORDER_INVOICE_FAILED =
  "UPDATE orders SET status='invoice_failed' WHERE nonce=? AND status='pending'";

/**
 * Запись платежа. ON CONFLICT(charge_id) DO NOTHING — дубликатная доставка
 * вебхука превращается в no-op (meta.changes==0 → детект дубликата в JS),
 * триггер при этом НЕ срабатывает (вставки не было) → ноль доп. начисления.
 * Колонки: (charge_id, user_id, product_id, amount, currency, status, nonce,
 * sku_version, created_at, fulfilled_at).
 */
export const SQL_INSERT_PAYMENT =
  'INSERT INTO payments ' +
  '(charge_id, user_id, product_id, amount, currency, status, nonce, sku_version, created_at, fulfilled_at) ' +
  'VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(charge_id) DO NOTHING';

/**
 * Грант в журнале. Именно ЭТА вставка запускает триггер
 * trg_wallet_ledger_apply (см. worker/schema.sql), который ведёт wallets и
 * wallet_skins. Колонки: (user_id, charge_id, kind='grant', grant_type,
 * amount, skin_id, reverses_charge_id=NULL, amount_text, created_at).
 * amount — знаковый INTEGER: rna +N; booster +мс; skin 0.
 * Монетизация v3 (бандлы): один charge_id — N строк (по компоненту).
 * UNIQUE журнала — (charge_id, grant_type, skin_id); skin_id нормализуется
 * COALESCE(?, '') при вставке, иначе NULL в UNIQUE не конфликтовал бы
 * (SQLite считает NULL отличными друг от друга — дубликатная доставка
 * компонента 'rna' прошла бы дважды). ON CONFLICT — по тому же ключу.
 */
export const SQL_INSERT_LEDGER_GRANT =
  'INSERT INTO wallet_ledger ' +
  "(user_id, charge_id, kind, grant_type, amount, skin_id, reverses_charge_id, amount_text, created_at) " +
  "VALUES (?,?,?,?,?,COALESCE(?,''),?,?,?) ON CONFLICT(charge_id, grant_type, skin_id) DO NOTHING";

/** Создание заказа (B2): цена, версия каталога и СНАПШОТ ГРАНТА фиксируются
 *  в заказе (иммутабельно, P1-2). Параметры:
 *  (nonce, user_id, product_id, amount_stars, sku_version,
 *   grant_rna, grant_booster_days, grant_skin_id, grant_season_pass_days,
 *   grant_bundle_json, created_at). Монетизация v3: + grant_season_pass_days
 *  (пропуск) и grant_bundle_json (бандл: JSON-массив BundleComponent,
 *  NULL у одиночных товаров). */
export const SQL_INSERT_ORDER =
  'INSERT INTO orders (nonce, user_id, product_id, amount_stars, sku_version, ' +
  'grant_rna, grant_booster_days, grant_skin_id, grant_season_pass_days, grant_bundle_json, status, created_at) ' +
  "VALUES (?,?,?,?,?,?,?,?,?,?, 'pending',?)";

/**
 * Аудит-строка BotSubscriptionUpdated (монетизация v3): состояние подписки
 * по апдейту Telegram. Параметры: (user_id, nonce, charge_id, state,
 * created_at). nonce — invoice_payload апдейта (им же резолвится заказ);
 * charge_id резолвится из payments по nonce (NULL, если платёж ещё не
 * записан). Доступ НЕ гейтится этой таблицей — только датой
 * wallets.season_pass_until_ms; таблица — аудит + админ-видимость.
 */
export const SQL_INSERT_SUBSCRIPTION_EVENT =
  'INSERT INTO subscription_events (user_id, nonce, charge_id, state, created_at) ' +
  'VALUES (?,?,?,?,?)';

/**
 * Аудит админской правки подписки (P2-3): та же таблица subscription_events,
 * но source='admin' — расследование «кто отменил подписку» отличает
 * действие админа от апдейта Telegram. Параметры: (user_id, nonce,
 * charge_id, state, source, created_at). state здесь только
 * 'canceled' | 'active' (isCanceled true/false).
 */
export const SQL_INSERT_SUBSCRIPTION_EVENT_ADMIN =
  'INSERT INTO subscription_events (user_id, nonce, charge_id, state, source, created_at) ' +
  'VALUES (?,?,?,?,?,?)';

/** Журнал возвратов: новая операция (mark/execute). operation_id — PK. */
export const SQL_INSERT_REFUND_OP =
  'INSERT INTO refund_ops ' +
  '(operation_id, charge_id, user_id, action, status, reason, telegram_confirmed_at, created_at, updated_at) ' +
  'VALUES (?,?,?,?,?,?,?,?,?)';

/** Платёж → 'refunded' (mark) или 'refund_requested' (execute, шаг 1). */
export const SQL_UPDATE_PAYMENT_REFUNDED =
  "UPDATE payments SET status='refunded' WHERE charge_id=? AND status IN ('paid','fulfilled')";

/** Платёж → 'refund_requested' (execute, шаг 1: бронь перед refundStarPayment). */
export const SQL_UPDATE_PAYMENT_REFUND_REQUESTED =
  "UPDATE payments SET status='refund_requested' WHERE charge_id=? AND status IN ('paid','fulfilled')";

/** Execute, шаг 2: операция завершена (идемпотентно по operation_id). */
export const SQL_COMPLETE_REFUND_OP =
  'UPDATE refund_ops SET status=\'completed\', telegram_confirmed_at=?, updated_at=? WHERE operation_id=?';

/** Execute, шаг 2: платёж → 'refunded' (из любого пред-статуса refund-флоу). */
export const SQL_UPDATE_PAYMENT_REFUNDED_FROM_ANY =
  "UPDATE payments SET status='refunded' WHERE charge_id=? AND status IN ('paid','fulfilled','refund_requested')";

/**
 * Дубликатный платёж (P1-1/P1-2): второй successful_payment на тот же nonce
 * (гонка двух pre_checkout) или отклонённая вторая подписка. ON CONFLICT
 * DO NOTHING — повторная доставка того же charge_id не плодит строк.
 * Колонки: (charge_id, nonce, user_id, product_id, amount, currency,
 * reason, created_at); reason: 'nonce_reuse' | 'subscription_active'.
 * status — state machine возврата дубликата (зеркало payments, P1-1):
 * 'pending' → 'refund_requested' → 'refunded'; гранта у дубликата нет,
 * поэтому reversal-строки не нужны — только статус + refund_ops.
 */
export const SQL_INSERT_DUPLICATE_PAYMENT =
  'INSERT INTO duplicate_payments ' +
  '(charge_id, nonce, user_id, product_id, amount, currency, reason, created_at) ' +
  'VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(charge_id) DO NOTHING';

/** Дубликат → 'refund_requested' (execute, шаг 1: бронь перед refundStarPayment). */
export const SQL_UPDATE_DUPLICATE_REFUND_REQUESTED =
  "UPDATE duplicate_payments SET status='refund_requested' WHERE charge_id=? AND status='pending'";

/** Дубликат → 'refunded' (mark: только из 'pending'). */
export const SQL_UPDATE_DUPLICATE_REFUNDED_FROM_PENDING =
  "UPDATE duplicate_payments SET status='refunded' WHERE charge_id=? AND status='pending'";

/** Дубликат → 'refunded' (execute, шаг 2: из любого пред-статуса refund-флоу). */
export const SQL_UPDATE_DUPLICATE_REFUNDED_FROM_ANY =
  "UPDATE duplicate_payments SET status='refunded' WHERE charge_id=? AND status IN ('pending','refund_requested')";

/**
 * Reversal-строка в журнале: копирует grant-строку с отрицательным amount и
 * ссылкой reverses_charge_id. Если grant-строки нет (unknown-product) —
 * вставляется 0 строк: это ок, откатывать нечего. NOT EXISTS-guard: один
 * грант — максимум один reversal (защита от гонки двух конкурентных
 * refund-вызовов: второй батч увидит уже закоммиченный reversal первого и
 * вставит 0 строк вместо двойного отката). Триггер применяет reversal
 * к wallets/wallet_skins (см. worker/schema.sql).
 * P1-6: EXISTS-guard по payments.status='refunded' — reversal применяется
 * ТОЛЬКО если платёж действительно переведён в 'refunded' этим батчем
 * (защита от TOCTOU-гонки: mark во время чужого execute).
 * Монетизация v3 (бандлы): один charge_id — N grant-строк; SELECT
 * возвращает N строк и вставляет N reversal-строк (по одной на компонент).
 * charge_id reversal выводится ПОСТРОЧНО из гранта:
 * 'rev:' || op || ':' || grant_type || ':' || coalesce(skin_id,'') —
 * иначе все N строк получили бы один charge_id и нарушили UNIQUE
 * (charge_id, grant_type, skin_id) при двух компонентах одного вида.
 * skin_id копируется нормализованным (COALESCE — для строк, записанных
 * до миграции-17 с NULL).
 * Параметры: (operation_id, created_at, orig_charge_id, orig_charge_id,
 * orig_charge_id). Первый параметр — ГОЛЫЙ operationId (раньше —
 * готовый 'rev:<op>'): префикс 'rev:' добавляет SQL.
 */
export const SQL_INSERT_LEDGER_REVERSAL =
  'INSERT INTO wallet_ledger ' +
  '(user_id, charge_id, kind, grant_type, amount, skin_id, reverses_charge_id, amount_text, created_at) ' +
  "SELECT user_id, 'rev:' || ? || ':' || grant_type || ':' || COALESCE(skin_id, ''), 'reversal', grant_type, -amount, COALESCE(skin_id, ''), charge_id, " +
  "'reversal-of:' || charge_id, ? FROM wallet_ledger WHERE charge_id=? AND kind='grant' " +
  "AND NOT EXISTS (SELECT 1 FROM wallet_ledger WHERE reverses_charge_id=? AND kind='reversal') " +
  "AND EXISTS (SELECT 1 FROM payments WHERE charge_id=? AND status='refunded')";
