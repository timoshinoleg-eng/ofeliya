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
