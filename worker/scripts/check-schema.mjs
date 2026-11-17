/**
 * check-schema.mjs — D1 release gate (P1-3): проверка схемы платежей.
 *
 * Проблема: если триггер trg_wallet_ledger_apply потерян при деплое схемы
 * (DROP TABLE при пересоздании wallet_ledger сносит триггер, а CREATE
 * TRIGGER не применился), грант-батч успешен (платёж paid, строки в
 * журнале есть), а кошелёк пуст — отказ ТИХИЙ. Этот скрипт — жёсткий гейт
 * деплоя: стоп, если схема не соответствует worker/schema.sql.
 *
 * Что проверяет checkDatabase (структурно, только чтение):
 *  - все 9 таблиц v17 на месте;
 *  - триггер trg_wallet_ledger_apply существует, его текст (нормализованно)
 *    равен тексту из schema.sql, ветки season_pass (grant + reversal) есть;
 *  - колонки v17: orders.grant_season_pass_days, orders.grant_bundle_json,
 *    wallets.season_pass_until_ms, duplicate_payments.status,
 *    subscription_events.source;
 *  - wallet_ledger: UNIQUE(charge_id, grant_type, skin_id) (через
 *    PRAGMA index_list — старый UNIQUE(charge_id) гейт не проходит);
 *  - wallet_skins: PK (user_id, skin_id, charge_id);
 *  - все 6 индексов schema.sql на месте.
 * functionalTriggerTest (ПИШЕТ — только в изолированных базах):
 * вставляет grant-строки (rna/booster/season_pass/skin) и проверяет, что
 * триггер обновил wallets/wallet_skins.
 *
 * Режимы CLI:
 *  - без аргументов: fresh DB из schema.sql + миграция v16→v17 на
 *    реконструированной v16-базе (v16-schema.fixture.sql), обе — в
 *    in-memory базах node:sqlite. НИКОГДА не трогает production D1.
 *    Exit 0 — гейт пройден, 1 — провал.
 *  - --db <path>: read-only структурная проверка существующего файла
 *    (DatabaseSync readOnly; функциональный тест НЕ запускается — он
 *    пишет). Для локальной копии базы, не для продакшн-D1 напрямую.
 *  - --print-commands: read-only SQL для проверки СУЩЕСТВУЮЩЕЙ D1 через
 *    wrangler d1 execute --command (только SELECT/PRAGMA).
 *
 * Тесты: worker/scripts/check-schema.test.mjs
 * (npm run test:check-schema).
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const workerDir = join(here, '..');

export const SCHEMA_SQL = readFileSync(join(workerDir, 'schema.sql'), 'utf8');
export const MIGRATION_17_SQL = readFileSync(join(workerDir, 'migration-17.sql'), 'utf8');
export const V16_SCHEMA_SQL = readFileSync(join(here, 'v16-schema.fixture.sql'), 'utf8');

const TRIGGER_NAME = 'trg_wallet_ledger_apply';

/**
 * Нормализация SQL-текста триггера для сравнения: убираем комментарии,
 * `IF NOT EXISTS` (schema.sql пишет CREATE TRIGGER IF NOT EXISTS, а
 * migration-17.sql — CREATE TRIGGER; семантика одна) и пробелы.
 */
function normalizeTriggerSql(sql) {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\bCREATE\s+TRIGGER\s+IF\s+NOT\s+EXISTS\b/i, 'CREATE TRIGGER')
    .replace(/\s+/g, ' ')
    .replace(/;\s*$/, '')
    .trim();
}

/** Извлекает (нормализованный) текст триггера из SQL-файла; null, если нет. */
export function extractTriggerSql(sqlText) {
  const m = sqlText.match(
    new RegExp(`CREATE\\s+TRIGGER\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${TRIGGER_NAME}\\b[\\s\\S]*?\\bEND\\s*;`, 'i')
  );
  if (!m) return null;
  return normalizeTriggerSql(m[0]);
}

const EXPECTED_TRIGGER_SQL = extractTriggerSql(SCHEMA_SQL);

const REQUIRED_TABLES = [
  'orders',
  'payments',
  'wallets',
  'wallet_ledger',
  'subscription_events',
  'wallet_skins',
  'refund_ops',
  'duplicate_payments',
  'schema_migrations',
];

const REQUIRED_COLUMNS = {
  orders: ['grant_season_pass_days', 'grant_bundle_json'],
  wallets: ['season_pass_until_ms'],
  duplicate_payments: ['status'],
  subscription_events: ['source'],
};

const REQUIRED_INDEXES = [
  'idx_payments_user',
  'idx_payments_nonce_unique',
  'idx_wallet_ledger_user_seq',
  'idx_subscription_events_nonce',
  'idx_refund_ops_charge',
  'idx_duplicate_payments_nonce',
];

function tableColumns(db, table) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);
  } catch {
    return [];
  }
}

/**
 * Структурная проверка базы (только чтение — безопасна для --db).
 * Возвращает { ok, checks: [{ name, ok, detail }] }.
 */
export function checkDatabase(db) {
  const checks = [];
  const push = (name, ok, detail = '') => checks.push({ name, ok, detail });

  const tables = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
  );
  const missingTables = REQUIRED_TABLES.filter((t) => !tables.has(t));
  push(
    'tables',
    missingTables.length === 0,
    missingTables.length ? `missing tables: ${missingTables.join(', ')}` : 'all 9 tables present'
  );

  const triggerRow = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?")
    .get(TRIGGER_NAME);
  push(
    'trigger-exists',
    !!triggerRow,
    triggerRow ? '' : 'trg_wallet_ledger_apply missing — grants would be silently lost'
  );
  if (triggerRow) {
    const live = normalizeTriggerSql(triggerRow.sql);
    push(
      'trigger-text',
      live === EXPECTED_TRIGGER_SQL,
      live === EXPECTED_TRIGGER_SQL ? 'matches schema.sql' : 'trigger body differs from schema.sql'
    );
    const seasonPassCount = (live.match(/season_pass/g) || []).length;
    push(
      'trigger-season-pass',
      seasonPassCount >= 2,
      `season_pass occurrences: ${seasonPassCount} (grant + reversal branches expected)`
    );
  } else {
    push('trigger-text', false, 'no trigger to compare');
    push('trigger-season-pass', false, 'no trigger to compare');
  }

  for (const [table, cols] of Object.entries(REQUIRED_COLUMNS)) {
    const have = tableColumns(db, table);
    const missing = cols.filter((c) => !have.includes(c));
    push(
      `columns:${table}`,
      missing.length === 0,
      missing.length ? `missing: ${missing.join(', ')}` : `${cols.join(', ')} present`
    );
  }

  let ledgerUniqueOk = false;
  try {
    const indexes = db.prepare("PRAGMA index_list('wallet_ledger')").all();
    for (const idx of indexes) {
      if (!idx.unique) continue;
      const cols = db
        .prepare(`PRAGMA index_info('${idx.name}')`)
        .all()
        .sort((a, b) => a.seqno - b.seqno)
        .map((r) => r.name);
      if (cols.join(',') === 'charge_id,grant_type,skin_id') {
        ledgerUniqueOk = true;
        break;
      }
    }
  } catch {
    // Таблица отсутствует — покрыто проверкой tables.
  }
  push(
    'ledger-unique',
    ledgerUniqueOk,
    ledgerUniqueOk
      ? 'UNIQUE(charge_id, grant_type, skin_id) present'
      : 'wallet_ledger lacks UNIQUE(charge_id, grant_type, skin_id)'
  );

  let skinsPkOk = false;
  let skinsPkDetail = '';
  try {
    const pkCols = db
      .prepare("PRAGMA table_info('wallet_skins')")
      .all()
      .filter((r) => r.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((r) => r.name);
    skinsPkOk = pkCols.join(',') === 'user_id,skin_id,charge_id';
    skinsPkDetail = skinsPkOk ? 'PK(user_id, skin_id, charge_id)' : `PK is (${pkCols.join(', ') || 'none'})`;
  } catch {
    skinsPkDetail = 'wallet_skins missing';
  }
  push('wallet-skins-pk', skinsPkOk, skinsPkDetail);

  const indexes = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((r) => r.name)
  );
  const missingIndexes = REQUIRED_INDEXES.filter((i) => !indexes.has(i));
  push(
    'indexes',
    missingIndexes.length === 0,
    missingIndexes.length ? `missing indexes: ${missingIndexes.join(', ')}` : 'all 6 indexes present'
  );

  return { ok: checks.every((c) => c.ok), checks };
}

let functionalRunId = 0;

/**
 * ФАКТИЧЕСКИЙ тест триггера: вставляет grant-строки (rna/booster/
 * season_pass/skin) и проверяет, что wallets/wallet_skins обновились.
 * ПИШЕТ в базу — запускать ТОЛЬКО на изолированных тестовых базах,
 * никогда на --db и никогда на production D1.
 */
export function functionalTriggerTest(db) {
  functionalRunId += 1;
  const userId = 900000 + functionalRunId;
  const now = Date.now();
  const run = `check-${functionalRunId}`;
  const failures = [];
  try {
    const insert = db.prepare(
      'INSERT INTO wallet_ledger (user_id, charge_id, kind, grant_type, amount, skin_id, reverses_charge_id, amount_text, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)'
    );
    insert.run(userId, `${run}-rna`, 'grant', 'rna', 100, '', 'check-schema', now);
    insert.run(userId, `${run}-booster`, 'grant', 'booster', 86400000, '', 'check-schema', now);
    insert.run(userId, `${run}-pass`, 'grant', 'season_pass', 2592000000, '', 'check-schema', now);
    insert.run(userId, `${run}-skin`, 'grant', 'skin', 0, 'skin.check', 'check-schema', now);
  } catch (e) {
    return { ok: false, detail: `grant inserts failed: ${e.message}` };
  }
  const wallet = db
    .prepare('SELECT purchased_rna, booster_until_ms, season_pass_until_ms FROM wallets WHERE user_id=?')
    .get(userId);
  if (!wallet) return { ok: false, detail: 'wallet row was not created by the trigger' };
  if (wallet.purchased_rna !== 100) failures.push(`rna: expected 100, got ${wallet.purchased_rna}`);
  if (wallet.booster_until_ms !== now + 86400000) {
    failures.push(`booster: expected ${now + 86400000}, got ${wallet.booster_until_ms}`);
  }
  if (wallet.season_pass_until_ms !== now + 2592000000) {
    failures.push(`season_pass: expected ${now + 2592000000}, got ${wallet.season_pass_until_ms}`);
  }
  const skin = db
    .prepare("SELECT status FROM wallet_skins WHERE user_id=? AND skin_id='skin.check'")
    .get(userId);
  if (!skin || skin.status !== 'active') failures.push('skin: no active wallet_skins row');
  return failures.length === 0
    ? { ok: true, detail: 'rna/booster/season_pass/skin grants applied by trigger' }
    : { ok: false, detail: failures.join('; ') };
}

/** Свежая in-memory база из schema.sql. */
export function buildFreshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA_SQL);
  return { db, cleanup: () => db.close() };
}

/**
 * Реконструированная v16-база (v16-schema.fixture.sql) с сид-данными:
 * кошелёк user 42 (500 РНК после триггера), 2 строки журнала (одна с
 * NULL skin_id — миграция должна нормализовать в ''), дубликат
 * 'v16-dup-1' (миграция должна дать ему status='pending').
 */
export function buildV16Db() {
  const db = new DatabaseSync(':memory:');
  db.exec(V16_SCHEMA_SQL);
  const now = Date.now();
  db.prepare(
    'INSERT INTO wallets (user_id, purchased_rna, booster_until_ms, skins_json, updated_at) VALUES (42, 0, 0, ?, ?)'
  ).run('[]', now);
  db.prepare(
    "INSERT INTO wallet_ledger (user_id, charge_id, kind, grant_type, amount, skin_id, reverses_charge_id, amount_text, created_at) VALUES (42, 'v16-charge-1', 'grant', 'rna', 500, NULL, NULL, 'v16-seed', ?)"
  ).run(now);
  db.prepare(
    "INSERT INTO wallet_ledger (user_id, charge_id, kind, grant_type, amount, skin_id, reverses_charge_id, amount_text, created_at) VALUES (42, 'v16-charge-2', 'grant', 'booster', 259200000, '', NULL, 'v16-seed', ?)"
  ).run(now);
  db.prepare(
    "INSERT INTO duplicate_payments (charge_id, nonce, user_id, product_id, amount, currency, reason, created_at) VALUES ('v16-dup-1', 'v16-nonce-1', 42, 'currency.rna-pack-s', 35, 'XTR', 'nonce_reuse', ?)"
  ).run(now);
  return { db, cleanup: () => db.close() };
}

/** Применяет migration-17.sql к базе (тестовой, in-memory). */
export function applyMigration(db) {
  db.exec(MIGRATION_17_SQL);
}

/* ------------------------------------------------------------------ */
/* CLI                                                                  */
/* ------------------------------------------------------------------ */

const READONLY_COMMANDS = [
  "SELECT name, sql FROM sqlite_master WHERE type='trigger' AND name='trg_wallet_ledger_apply';",
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;",
  "SELECT name FROM sqlite_master WHERE type='index' ORDER BY name;",
  'PRAGMA table_info(orders);',
  'PRAGMA table_info(wallets);',
  'PRAGMA table_info(duplicate_payments);',
  'PRAGMA table_info(subscription_events);',
  "PRAGMA index_list('wallet_ledger');",
  "PRAGMA index_list('wallet_skins');",
  'SELECT version FROM schema_migrations ORDER BY version;',
];

function printCommands() {
  console.log('# Read-only schema checks for an EXISTING D1 database (P1-3 gate).');
  console.log('# Run from the repo root; add --remote for the production database.');
  console.log('# All statements are SELECT/PRAGMA — nothing is written.');
  for (const sql of READONLY_COMMANDS) {
    console.log(`wrangler d1 execute ofeliya-payments --command ${JSON.stringify(sql)}`);
  }
  console.log('# Expected: trigger trg_wallet_ledger_apply present, body contains');
  console.log('# season_pass branches (grant + reversal); wallet_ledger has a UNIQUE');
  console.log('# index on (charge_id, grant_type, skin_id); columns');
  console.log('# orders.grant_season_pass_days, orders.grant_bundle_json,');
  console.log('# wallets.season_pass_until_ms, duplicate_payments.status,');
  console.log('# subscription_events.source present.');
}

function printChecks(result) {
  for (const c of result.checks) {
    console.log(`  ${c.ok ? 'OK  ' : 'FAIL'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  }
}

function reportSuite(title, result, fnResult) {
  console.log(`\n== ${title} ==`);
  printChecks(result);
  console.log(`  ${fnResult.ok ? 'OK  ' : 'FAIL'} functional-trigger — ${fnResult.detail}`);
  const ok = result.ok && fnResult.ok;
  console.log(`${ok ? 'OK' : 'FAIL'}: ${title}`);
  return ok;
}

function runDefault() {
  console.log('check-schema: D1 schema gate (P1-3) — isolated in-memory databases, never production D1.');
  let allOk = true;
  const fresh = buildFreshDb();
  try {
    allOk = reportSuite('fresh DB from schema.sql', checkDatabase(fresh.db), functionalTriggerTest(fresh.db)) && allOk;
  } finally {
    fresh.cleanup();
  }
  const v16 = buildV16Db();
  try {
    applyMigration(v16.db);
    allOk =
      reportSuite('migrated DB (v16 + migration-17.sql)', checkDatabase(v16.db), functionalTriggerTest(v16.db)) &&
      allOk;
  } finally {
    v16.cleanup();
  }
  console.log(allOk ? '\nOK: schema gate passed' : '\nFAIL: schema gate failed');
  return allOk ? 0 : 1;
}

function runDbFile(path) {
  console.log(`check-schema: read-only structural check of ${path} (functional trigger test skipped — it writes).`);
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const result = checkDatabase(db);
    printChecks(result);
    console.log(result.ok ? 'OK: schema gate passed' : 'FAIL: schema gate failed');
    return result.ok ? 0 : 1;
  } finally {
    db.close();
  }
}

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('Usage: node worker/scripts/check-schema.mjs [--db <path>] [--print-commands]');
    console.log('  (no args)        fresh + migrated in-memory suites (never production D1)');
    console.log('  --db <path>      read-only structural check of a local SQLite file');
    console.log('  --print-commands print read-only wrangler d1 execute commands for an existing D1');
    return 0;
  }
  if (argv.includes('--print-commands')) {
    printCommands();
    return 0;
  }
  const dbIdx = argv.indexOf('--db');
  if (dbIdx !== -1) {
    const path = argv[dbIdx + 1];
    if (!path) {
      console.error('FAIL: --db requires a path');
      return 2;
    }
    return runDbFile(path);
  }
  return runDefault();
}

const isMain =
  process.argv[1] &&
  (resolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith('/check-schema.mjs'));
if (isMain) process.exitCode = main(process.argv.slice(2));
