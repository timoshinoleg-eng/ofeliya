/**
 * sql-smoke.test.mjs — дымовой тест SQL патча №16 (node --test, zero deps).
 *
 * Проверяет НАСТОЯЩИЕ артефакты: worker/schema.sql (схема + триггер
 * trg_wallet_ledger_apply) и worker/src/sql.ts (тексты statement'ов батча)
 * на реальном SQLite (node:sqlite). D1 построен на SQLite, триггеры —
 * ядро SQLite (https://www.sqlite.org/lang_createtrigger.html), поэтому
 * семантика триггера здесь == семантике в D1.
 *
 * Сценарии:
 *  1. grant rna → wallets.purchased_rna вырос;
 *  2. grant booster → booster_until_ms = max(cur, created_at) + мс;
 *  3. grant skin → строка active в wallet_skins;
 *  4. дубликатная вставка (ON CONFLICT DO NOTHING) → changes=0,
 *     триггер не сработал, кошелёк не изменился;
 *  5. reversal rna → откат с полом max(0, …);
 *  6. reversal booster → не ниже момента возврата (политика «время вспять
 *     не отматываем», зафиксирована в README_DEPLOY);
 *  7. reversal skin → гасится только строка своего charge_id (второй
 *     активный грант того же скина сохраняет владение).
 *
 * Запуск: node --experimental-strip-types --test worker/scripts/sql-smoke.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const here = dirname(fileURLToPath(import.meta.url));
const workerDir = join(here, '..');

const { SQL_INSERT_LEDGER_GRANT, SQL_INSERT_LEDGER_REVERSAL } = await import(
  join(workerDir, 'src', 'sql.ts')
);

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(join(workerDir, 'schema.sql'), 'utf8'));
  return db;
}

function wallet(db, userId) {
  return db
    .prepare('SELECT purchased_rna, booster_until_ms FROM wallets WHERE user_id=?')
    .get(userId);
}

function grant(db, { userId, chargeId, grantType, amount, skinId, createdAt }) {
  return db
    .prepare(SQL_INSERT_LEDGER_GRANT)
    .run(userId, chargeId, 'grant', grantType, amount, skinId, null, String(amount), createdAt);
}

function reversal(db, { revChargeId, origChargeId, createdAt }) {
  // P1-6: reversal требует payments.status='refunded' (EXISTS-guard).
  // Тестовый платёж создаём здесь же.
  db.prepare(
    "INSERT INTO payments (charge_id, user_id, product_id, amount, currency, status, nonce, sku_version, created_at, fulfilled_at) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(charge_id) DO UPDATE SET status='refunded'"
  ).run(origChargeId, 999, 'test.product', 1, 'XTR', 'refunded', 'nonce-' + origChargeId, 2, createdAt, null);
  return db.prepare(SQL_INSERT_LEDGER_REVERSAL).run(revChargeId, createdAt, origChargeId, origChargeId, origChargeId);
}

test('grant rna: purchased_rna растёт плоско', () => {
  const db = freshDb();
  grant(db, { userId: 1, chargeId: 'ch1', grantType: 'rna', amount: 500, skinId: null, createdAt: 1000 });
  assert.equal(wallet(db, 1).purchased_rna, 500);
  grant(db, { userId: 1, chargeId: 'ch2', grantType: 'rna', amount: 1500, skinId: null, createdAt: 2000 });
  assert.equal(wallet(db, 1).purchased_rna, 2000);
  db.close();
});

test('grant booster: max(cur, created_at) + мс, время не сгорает', () => {
  const db = freshDb();
  const week = 7 * 86_400_000;
  grant(db, { userId: 2, chargeId: 'b1', grantType: 'booster', amount: week, skinId: null, createdAt: 1000 });
  assert.equal(wallet(db, 2).booster_until_ms, 1000 + week);
  // Второй грант позже: продлевает от текущего срока, а не от now.
  grant(db, { userId: 2, chargeId: 'b2', grantType: 'booster', amount: week, skinId: null, createdAt: 2000 });
  assert.equal(wallet(db, 2).booster_until_ms, 1000 + 2 * week);
  db.close();
});

test('grant skin: владение = EXISTS active', () => {
  const db = freshDb();
  grant(db, { userId: 3, chargeId: 's1', grantType: 'skin', amount: 0, skinId: 'skin.x', createdAt: 1000 });
  const row = db
    .prepare("SELECT status FROM wallet_skins WHERE user_id=? AND skin_id='skin.x'")
    .get(3);
  assert.equal(row.status, 'active');
  db.close();
});

test('дубликатная вставка: changes=0, триггер не срабатывает', () => {
  const db = freshDb();
  grant(db, { userId: 4, chargeId: 'd1', grantType: 'rna', amount: 500, skinId: null, createdAt: 1000 });
  assert.equal(wallet(db, 4).purchased_rna, 500);
  const dup = grant(db, { userId: 4, chargeId: 'd1', grantType: 'rna', amount: 500, skinId: null, createdAt: 1000 });
  assert.equal(dup.changes, 0);
  assert.equal(wallet(db, 4).purchased_rna, 500);
  const ledgerCount = db
    .prepare('SELECT COUNT(*) AS c FROM wallet_ledger WHERE charge_id=?')
    .get('d1').c;
  assert.equal(ledgerCount, 1);
  db.close();
});

test('reversal rna: откат с полом max(0, …)', () => {
  const db = freshDb();
  grant(db, { userId: 5, chargeId: 'r1', grantType: 'rna', amount: 500, skinId: null, createdAt: 1000 });
  reversal(db, { revChargeId: 'rev:op1', origChargeId: 'r1', createdAt: 2000 });
  assert.equal(wallet(db, 5).purchased_rna, 0);
  // Повторный reversal того же гранта (второй refund): ниже нуля не уходим.
  reversal(db, { revChargeId: 'rev:op2', origChargeId: 'r1', createdAt: 3000 });
  assert.equal(wallet(db, 5).purchased_rna, 0);
  db.close();
});

test('reversal booster: не ниже момента возврата', () => {
  const db = freshDb();
  const week = 7 * 86_400_000;
  grant(db, { userId: 6, chargeId: 'b1', grantType: 'booster', amount: week, skinId: null, createdAt: 1000 });
  assert.equal(wallet(db, 6).booster_until_ms, 1000 + week);
  // Возврат «съедает» больше, чем осталось: clamp на created_at reversal.
  reversal(db, { revChargeId: 'rev:op1', origChargeId: 'b1', createdAt: 2000 });
  assert.equal(wallet(db, 6).booster_until_ms, 2000);
  db.close();
});

test('reversal skin: гасится только строка своего charge_id', () => {
  const db = freshDb();
  grant(db, { userId: 7, chargeId: 's1', grantType: 'skin', amount: 0, skinId: 'skin.x', createdAt: 1000 });
  grant(db, { userId: 7, chargeId: 's2', grantType: 'skin', amount: 0, skinId: 'skin.x', createdAt: 2000 });
  reversal(db, { revChargeId: 'rev:op1', origChargeId: 's1', createdAt: 3000 });
  const rows = db
    .prepare("SELECT charge_id, status FROM wallet_skins WHERE user_id=7 ORDER BY charge_id")
    .all();
  assert.deepEqual(
    rows.map((r) => [r.charge_id, r.status]),
    [
      ['s1', 'reversed'],
      ['s2', 'active'],
    ]
  );
  // Владение сохраняется: есть активная строка.
  const active = db
    .prepare("SELECT COUNT(*) AS c FROM wallet_skins WHERE user_id=7 AND skin_id='skin.x' AND status='active'")
    .get().c;
  assert.equal(active, 1);
  db.close();
});

test('reversal без grant-строки: 0 строк, кошелёк не тронут', () => {
  const db = freshDb();
  const res = reversal(db, { revChargeId: 'rev:op9', origChargeId: 'nope', createdAt: 1000 });
  assert.equal(res.changes, 0);
  assert.equal(wallet(db, 999), undefined);
  db.close();
});

test('двойной reversal одного гранта: второй — 0 строк (NOT EXISTS guard)', () => {
  const db = freshDb();
  grant(db, { userId: 8, chargeId: 'g1', grantType: 'rna', amount: 500, skinId: null, createdAt: 1000 });
  const r1 = reversal(db, { revChargeId: 'rev:opA', origChargeId: 'g1', createdAt: 2000 });
  assert.equal(r1.changes, 1);
  assert.equal(wallet(db, 8).purchased_rna, 0);
  // Гонка двух админов: второй reversal того же гранта — no-op, двойного
  // отката нет.
  const r2 = reversal(db, { revChargeId: 'rev:opB', origChargeId: 'g1', createdAt: 3000 });
  assert.equal(r2.changes, 0);
  assert.equal(wallet(db, 8).purchased_rna, 0);
  const revCount = db
    .prepare("SELECT COUNT(*) AS c FROM wallet_ledger WHERE kind='reversal'")
    .get().c;
  assert.equal(revCount, 1);
  db.close();
});
