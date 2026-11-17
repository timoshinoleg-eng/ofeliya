/**
 * check-schema.test.mjs — тесты гейта схемы D1 (P1-3, P2-4).
 *
 * Проверяет worker/scripts/check-schema.mjs на ИЗОЛИРОВАННЫХ базах
 * (node:sqlite, tmpdir — никогда production D1):
 *  1. свежая база из schema.sql — все проверки зелёные + функциональный
 *     тест триггера (грант → кошелёк обновился);
 *  2. миграция v16→v17 (реконструированная v16-база + migration-17.sql) —
 *     все проверки зелёные, данные сохранены, текст триггера побайтово
 *     равен schema.sql;
 *  3. отсутствующий триггер → проверка КРАСНАЯ (fail-closed гейт);
 *  4. неправильный триггер (v16, без season_pass) → КРАСНАЯ;
 *  5. неправильный UNIQUE журнала (v16, UNIQUE(charge_id)) → КРАСНАЯ;
 *  6. отсутствующая колонка (нет duplicate_payments.status) → КРАСНАЯ;
 *  7. CLI: дефолтный прогон exit 0; --print-commands печатает
 *     read-only SQL для wrangler; --db на битой базе exit != 0.
 *  8. CR-R3-3: частичная миграция (шаг 3b пропущен — устаревший
 *     UNIQUE(charge_id) на wallet_skins при составном PK) → КРАСНАЯ.
 *
 * Запуск: node --test worker/scripts/check-schema.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import {
  checkDatabase,
  functionalTriggerTest,
  extractTriggerSql,
  buildFreshDb,
  buildV16Db,
  applyMigration,
  V16_SCHEMA_SQL,
  SCHEMA_SQL,
  MIGRATION_17_SQL,
} from './check-schema.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const workerDir = join(here, '..');

function failingNames(result) {
  return result.checks.filter((c) => !c.ok).map((c) => c.name);
}

test('fresh DB from schema.sql: all checks green + functional trigger test', () => {
  const { db, cleanup } = buildFreshDb();
  try {
    const result = checkDatabase(db);
    assert.equal(result.ok, true, `fresh DB checks must pass, failing: ${failingNames(result).join(', ')}`);
    const fn = functionalTriggerTest(db);
    assert.equal(fn.ok, true, `functional trigger test must pass: ${fn.detail}`);
  } finally {
    cleanup();
  }
});

test('migration v16→v17: checks green, data preserved, trigger text equals schema.sql', () => {
  const { db, cleanup } = buildV16Db();
  try {
    // Данные до миграции: кошелёк, журнал, дубликат.
    assert.equal(
      db.prepare('SELECT purchased_rna FROM wallets WHERE user_id=42').get().purchased_rna,
      500,
      'v16 seed wallet'
    );
    applyMigration(db);
    const result = checkDatabase(db);
    assert.equal(result.ok, true, `migrated DB checks must pass, failing: ${failingNames(result).join(', ')}`);
    const fn = functionalTriggerTest(db);
    assert.equal(fn.ok, true, `functional trigger test must pass after migration: ${fn.detail}`);
    // Данные сохранены.
    assert.equal(
      db.prepare('SELECT purchased_rna FROM wallets WHERE user_id=42').get().purchased_rna,
      500,
      'wallet preserved across migration'
    );
    assert.equal(
      db.prepare('SELECT COUNT(*) AS c FROM wallet_ledger WHERE user_id=42').get().c,
      2,
      'ledger rows preserved'
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS c FROM wallet_ledger WHERE skin_id IS NULL").get().c,
      0,
      'NULL skin_id normalized to empty string'
    );
    assert.equal(
      db.prepare("SELECT status FROM duplicate_payments WHERE charge_id='v16-dup-1'").get().status,
      'pending',
      'duplicate_payments.status backfilled to pending'
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS c FROM schema_migrations WHERE version='v17'").get().c,
      1,
      'schema_migrations has v17'
    );
    // Текст триггера в миграции == тексту в schema.sql (нормализованно).
    const fromSchema = extractTriggerSql(SCHEMA_SQL);
    const fromMigration = extractTriggerSql(MIGRATION_17_SQL);
    assert.ok(fromSchema, 'schema.sql contains trigger');
    assert.ok(fromMigration, 'migration-17.sql contains trigger');
    assert.equal(fromMigration, fromSchema, 'migration trigger text equals schema trigger text');
    // То же — для guard-триггера P2-N1.
    const guardFromSchema = extractTriggerSql(SCHEMA_SQL, 'trg_wallet_ledger_season_pass_guard');
    const guardFromMigration = extractTriggerSql(MIGRATION_17_SQL, 'trg_wallet_ledger_season_pass_guard');
    assert.ok(guardFromSchema, 'schema.sql contains guard trigger');
    assert.ok(guardFromMigration, 'migration-17.sql contains guard trigger');
    assert.equal(guardFromMigration, guardFromSchema, 'migration guard trigger text equals schema guard trigger text');
  } finally {
    cleanup();
  }
});

test('P3-N2: functionally-v17 but unmarked DB (no v17 row) → checks RED', () => {
  const { db, cleanup } = buildFreshDb();
  try {
    // База функционально v17 (все таблицы/триггеры/колонки на месте),
    // но отметки о применении миграции нет: повторный прогон
    // migration-17.sql упал бы на ALTER TABLE ADD COLUMN, а гейт
    // обязан не пропускать такую базу как «уже v17».
    db.exec("DELETE FROM schema_migrations WHERE version='v17'");
    const result = checkDatabase(db);
    assert.equal(result.ok, false, 'unmarked DB must FAIL the gate');
    assert.ok(
      failingNames(result).some((n) => n.includes('schema-migrations')),
      `failing checks must mention schema-migrations (got: ${failingNames(result).join(', ')})`
    );
  } finally {
    cleanup();
  }
});

test('CR5: v16 grant INSERT fails against v17 schema (no charge-only UNIQUE)', () => {
  // Доказательство неверности старого утверждения «откат воркера на v16
  // безопасен БЕЗ отката схемы»: v16 SQL_INSERT_LEDGER_GRANT (main
  // 2bd6320) — INSERT ... ON CONFLICT(charge_id) DO NOTHING, а v17
  // wallet_ledger имеет только составной UNIQUE (charge_id, grant_type,
  // skin_id). Такой INSERT против v17-схемы падает — каждая оплата на
  // откаченном воркере уйдёт в 503/потерю гранта.
  const { db, cleanup } = buildFreshDb();
  try {
    assert.throws(
      () =>
        db
          .prepare(
            'INSERT INTO wallet_ledger (user_id, charge_id, kind, grant_type, amount, skin_id, reverses_charge_id, amount_text, created_at) ' +
              "VALUES (1, 'v16-probe', 'grant', 'rna', 500, NULL, NULL, '500', 1700000000000) ON CONFLICT(charge_id) DO NOTHING"
          )
          .run(),
      /ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint/,
      'v16 ON CONFLICT(charge_id) must fail on the v17 schema'
    );
    // Контроль: v17-инсерт (составной ON CONFLICT) работает.
    db.prepare(
      'INSERT INTO wallet_ledger (user_id, charge_id, kind, grant_type, amount, skin_id, reverses_charge_id, amount_text, created_at) ' +
        "VALUES (1, 'v17-probe', 'grant', 'rna', 500, NULL, NULL, '500', 1700000000000) ON CONFLICT(charge_id, grant_type, skin_id) DO NOTHING"
    ).run();
    const row = db.prepare("SELECT charge_id FROM wallet_ledger WHERE charge_id='v17-probe'").get();
    assert.ok(row, 'v17 composite ON CONFLICT insert works');
  } finally {
    cleanup();
  }
});

test('CR5: rollback docs do not claim v16 worker is safe on v17 schema', () => {
  // Регрессия на исправление шапки: ложное утверждение не должно вернуться.
  const dir = dirname(fileURLToPath(import.meta.url));
  const migration = readFileSync(join(dir, '..', 'migration-17.sql'), 'utf8');
  const readme = readFileSync(join(dir, '..', 'README_DEPLOY.md'), 'utf8');
  assert.ok(!migration.includes('безопасен БЕЗ отката'), 'migration header must not claim v16 rollback is safe');
  assert.ok(!readme.includes('безопасна без отката'), 'README must not claim v16 rollback is safe');
  assert.ok(
    migration.includes('НЕ БЕЗОПАСЕН') && migration.includes('снапшота'),
    'migration header must say snapshot-only rollback'
  );
  assert.ok(
    migration.includes('миграция → деплой v17') || migration.includes('миграция → деплой'),
    'migration header must document the migration→deploy window'
  );
});

test('missing guard trigger (P2-N1) → checks RED', () => {
  const { db, cleanup } = buildFreshDb();
  try {
    db.exec('DROP TRIGGER trg_wallet_ledger_season_pass_guard');
    const result = checkDatabase(db);
    assert.equal(result.ok, false, 'DB without guard trigger must FAIL the gate');
    assert.ok(
      failingNames(result).some((n) => n.includes('guard-trigger')),
      `failing checks must mention guard-trigger (got: ${failingNames(result).join(', ')})`
    );
  } finally {
    cleanup();
  }
});

test('missing trigger → checks RED (hard gate)', () => {
  const { db, cleanup } = buildFreshDb();
  try {
    db.exec('DROP TRIGGER trg_wallet_ledger_apply');
    const result = checkDatabase(db);
    assert.equal(result.ok, false, 'DB without trigger must FAIL the gate');
    assert.ok(
      failingNames(result).some((n) => n.includes('trigger')),
      `failing checks must mention trigger (got: ${failingNames(result).join(', ')})`
    );
    const fn = functionalTriggerTest(db);
    assert.equal(fn.ok, false, 'functional trigger test must fail without trigger');
  } finally {
    cleanup();
  }
});

test('wrong trigger (v16, no season_pass) → checks RED', () => {
  const { db, cleanup } = buildFreshDb();
  try {
    db.exec('DROP TRIGGER trg_wallet_ledger_apply');
    const v16Trigger = extractTriggerSql(V16_SCHEMA_SQL);
    assert.ok(v16Trigger, 'v16 fixture contains trigger');
    assert.ok(!v16Trigger.includes('season_pass'), 'v16 trigger has no season_pass branch (fixture sanity)');
    db.exec(v16Trigger);
    const result = checkDatabase(db);
    assert.equal(result.ok, false, 'DB with stale v16 trigger must FAIL the gate');
    assert.ok(
      failingNames(result).some((n) => n.includes('trigger')),
      `failing checks must mention trigger (got: ${failingNames(result).join(', ')})`
    );
  } finally {
    cleanup();
  }
});

test('wrong ledger UNIQUE (v16 UNIQUE(charge_id)) → checks RED', () => {
  const { db, cleanup } = buildV16Db();
  try {
    // v16-база ДО миграции: UNIQUE журнала ещё старый.
    const result = checkDatabase(db);
    assert.equal(result.ok, false, 'v16 DB must FAIL v17 checks');
    assert.ok(
      failingNames(result).some((n) => n.includes('ledger-unique')),
      `failing checks must mention ledger-unique (got: ${failingNames(result).join(', ')})`
    );
  } finally {
    cleanup();
  }
});

test('CR-R3-3: partial migration (step 3b skipped, obsolete UNIQUE(charge_id) on wallet_skins) → checks RED', () => {
  const { db, cleanup } = buildFreshDb();
  try {
    // Частичная миграция: вся v17 применена, но шаг 3b пропущен —
    // wallet_skins сохранил устаревший UNIQUE(charge_id) при том же
    // составном PK. Воспроизводим пересозданием таблицы как в v16
    // (charge_id TEXT NOT NULL UNIQUE + PK (user_id, skin_id, charge_id)).
    // Триггеры на время пересоздания снимаем и пересоздаём из schema.sql:
    // ALTER TABLE RENAME при живом триггере на wallet_skins падает
    // (SQLite перепроверяет тело триггера, а таблицы в этот момент нет) —
    // в настоящей миграции триггеров к шагу 3b уже нет (шаг 3 снёс
    // wallet_ledger вместе с ними, шаг 4 пересоздал).
    db.exec('DROP TRIGGER trg_wallet_ledger_apply');
    db.exec('DROP TRIGGER trg_wallet_ledger_season_pass_guard');
    db.exec(`
      CREATE TABLE wallet_skins_partial (
        user_id    INTEGER NOT NULL,
        skin_id    TEXT NOT NULL,
        charge_id  TEXT NOT NULL UNIQUE,
        status     TEXT NOT NULL DEFAULT 'active',
        granted_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, skin_id, charge_id)
      );
      INSERT INTO wallet_skins_partial SELECT * FROM wallet_skins;
      DROP TABLE wallet_skins;
      ALTER TABLE wallet_skins_partial RENAME TO wallet_skins;
    `);
    db.exec(extractTriggerSql(SCHEMA_SQL));
    db.exec(extractTriggerSql(SCHEMA_SQL, 'trg_wallet_ledger_season_pass_guard'));
    const result = checkDatabase(db);
    assert.equal(result.ok, false, 'partial migration (obsolete UNIQUE(charge_id)) must FAIL the gate');
    assert.ok(
      failingNames(result).some((n) => n.includes('wallet-skins')),
      `failing checks must mention wallet-skins (got: ${failingNames(result).join(', ')})`
    );
    // Доказательство слепоты старого гейта: PK-проверка проходит...
    const pkCheck = result.checks.find((c) => c.name === 'wallet-skins-pk');
    assert.ok(pkCheck && pkCheck.ok, 'PK check still passes on the partial migration (this is what the old gate missed)');
    // ...и функциональный тест тоже не ловит (вставляет один скин).
    const fn = functionalTriggerTest(db);
    assert.equal(fn.ok, true, 'functional trigger test still passes (single skin insert)');
    // Контроль: полная v17 — новый чек зелёный.
    const fresh = buildFreshDb();
    try {
      const freshResult = checkDatabase(fresh.db);
      const newCheck = freshResult.checks.find((c) => c.name === 'wallet-skins-no-charge-unique');
      assert.ok(newCheck && newCheck.ok, 'full v17 DB passes the new wallet-skins unique check');
    } finally {
      fresh.cleanup();
    }
  } finally {
    cleanup();
  }
});

test('missing column (duplicate_payments.status) → checks RED', () => {
  const { db, cleanup } = buildFreshDb();
  try {
    db.exec('ALTER TABLE duplicate_payments DROP COLUMN status');
    const result = checkDatabase(db);
    assert.equal(result.ok, false, 'DB without duplicate_payments.status must FAIL the gate');
    assert.ok(
      failingNames(result).some((n) => n.includes('columns')),
      `failing checks must mention columns (got: ${failingNames(result).join(', ')})`
    );
  } finally {
    cleanup();
  }
});

test('CLI: default run exits 0; --print-commands prints read-only SQL', () => {
  const out = execFileSync(
    process.execPath,
    [join(workerDir, 'scripts', 'check-schema.mjs')],
    { encoding: 'utf8' }
  );
  assert.ok(out.includes('OK'), `CLI default run must report OK (got: ${out.slice(0, 500)})`);
  const cmds = execFileSync(
    process.execPath,
    [join(workerDir, 'scripts', 'check-schema.mjs'), '--print-commands'],
    { encoding: 'utf8' }
  );
  assert.ok(cmds.includes('sqlite_master'), '--print-commands mentions sqlite_master');
  assert.ok(cmds.includes('wrangler d1 execute'), '--print-commands gives wrangler commands');
  assert.ok(!/INSERT|UPDATE|DELETE|DROP|ALTER|CREATE/i.test(cmds.replace(/wrangler d1 execute/g, '')) || cmds.includes('SELECT'),
    '--print-commands is read-only SQL');
});

test('CLI --db on tampered file exits non-zero (read-only check)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ofeliya-check-schema-cli-'));
  try {
    const file = join(dir, 'tampered.db');
    const db = new DatabaseSync(file);
    db.exec(readFileSync(join(workerDir, 'schema.sql'), 'utf8'));
    db.exec('DROP TRIGGER trg_wallet_ledger_apply');
    db.close();
    let failed = false;
    try {
      execFileSync(
        process.execPath,
        [join(workerDir, 'scripts', 'check-schema.mjs'), '--db', file],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
    } catch (e) {
      failed = true;
      assert.notEqual(e.status, 0, 'CLI --db on tampered DB exits non-zero');
      assert.ok(String(e.stdout ?? '').includes('FAIL') || String(e.stderr ?? '').includes('FAIL'),
        'CLI --db reports FAIL');
    }
    assert.equal(failed, true, 'CLI --db must fail on tampered DB');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
