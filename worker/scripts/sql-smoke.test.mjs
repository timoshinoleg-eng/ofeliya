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
 *  8. grant season_pass → season_pass_until_ms = max(cur, created_at) + мс
 *     (монетизация v3, схема v17);
 *  9. reversal season_pass → не ниже момента возврата;
 * 10. subscription_events существует (аудит BotSubscriptionUpdated).
 * 11. бандл: один charge_id — N строк (rna+booster+skin), кошелёк и
 *     wallet_skins отражают все компоненты;
 * 12. дубликат компонента бандла → changes=0 (UNIQUE составной);
 * 13. reversal бандла: откатывает все компоненты, charge_id построчные
 *     ('rev:<op>:<grant_type>:<skin_id>');
 * 14. три скина с одним charge_id → три строки wallet_skins
 *     (UNIQUE с charge_id снят).
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

const {
  SQL_INSERT_LEDGER_GRANT,
  SQL_INSERT_LEDGER_REVERSAL,
  SQL_INSERT_DUPLICATE_PAYMENT,
  SQL_UPDATE_DUPLICATE_REFUND_REQUESTED,
  SQL_UPDATE_DUPLICATE_REFUNDED_FROM_ANY,
  SQL_INSERT_SUBSCRIPTION_EVENT,
  SQL_INSERT_SUBSCRIPTION_EVENT_ADMIN,
} = await import(join(workerDir, 'src', 'sql.ts'));

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(join(workerDir, 'schema.sql'), 'utf8'));
  return db;
}

function wallet(db, userId) {
  return db
    .prepare('SELECT purchased_rna, booster_until_ms, season_pass_until_ms FROM wallets WHERE user_id=?')
    .get(userId);
}

function grant(db, { userId, chargeId, grantType, amount, skinId, createdAt }) {
  return db
    .prepare(SQL_INSERT_LEDGER_GRANT)
    .run(userId, chargeId, 'grant', grantType, amount, skinId, null, String(amount), createdAt);
}

function reversal(db, { op, origChargeId, createdAt }) {
  // P1-6: reversal требует payments.status='refunded' (EXISTS-guard).
  // Тестовый платёж создаём здесь же.
  // Монетизация v3: первый параметр — голый operationId; SQL сам строит
  // charge_id построчно ('rev:<op>:<grant_type>:<skin_id>').
  db.prepare(
    "INSERT INTO payments (charge_id, user_id, product_id, amount, currency, status, nonce, sku_version, created_at, fulfilled_at) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(charge_id) DO UPDATE SET status='refunded'"
  ).run(origChargeId, 999, 'test.product', 1, 'XTR', 'refunded', 'nonce-' + origChargeId, 2, createdAt, null);
  return db.prepare(SQL_INSERT_LEDGER_REVERSAL).run(op, createdAt, origChargeId, origChargeId, origChargeId);
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
  reversal(db, { op: 'op1', origChargeId: 'r1', createdAt: 2000 });
  assert.equal(wallet(db, 5).purchased_rna, 0);
  // Повторный reversal того же гранта (второй refund): ниже нуля не уходим.
  reversal(db, { op: 'op2', origChargeId: 'r1', createdAt: 3000 });
  assert.equal(wallet(db, 5).purchased_rna, 0);
  db.close();
});

test('reversal booster: не ниже момента возврата', () => {
  const db = freshDb();
  const week = 7 * 86_400_000;
  grant(db, { userId: 6, chargeId: 'b1', grantType: 'booster', amount: week, skinId: null, createdAt: 1000 });
  assert.equal(wallet(db, 6).booster_until_ms, 1000 + week);
  // Возврат «съедает» больше, чем осталось: clamp на created_at reversal.
  reversal(db, { op: 'op1', origChargeId: 'b1', createdAt: 2000 });
  assert.equal(wallet(db, 6).booster_until_ms, 2000);
  db.close();
});

test('reversal skin: гасится только строка своего charge_id', () => {
  const db = freshDb();
  grant(db, { userId: 7, chargeId: 's1', grantType: 'skin', amount: 0, skinId: 'skin.x', createdAt: 1000 });
  grant(db, { userId: 7, chargeId: 's2', grantType: 'skin', amount: 0, skinId: 'skin.x', createdAt: 2000 });
  reversal(db, { op: 'op1', origChargeId: 's1', createdAt: 3000 });
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
  const res = reversal(db, { op: 'op9', origChargeId: 'nope', createdAt: 1000 });
  assert.equal(res.changes, 0);
  assert.equal(wallet(db, 999), undefined);
  db.close();
});

test('двойной reversal одного гранта: второй — 0 строк (NOT EXISTS guard)', () => {
  const db = freshDb();
  grant(db, { userId: 8, chargeId: 'g1', grantType: 'rna', amount: 500, skinId: null, createdAt: 1000 });
  const r1 = reversal(db, { op: 'opA', origChargeId: 'g1', createdAt: 2000 });
  assert.equal(r1.changes, 1);
  assert.equal(wallet(db, 8).purchased_rna, 0);
  // Гонка двух админов: второй reversal того же гранта — no-op, двойного
  // отката нет.
  const r2 = reversal(db, { op: 'opB', origChargeId: 'g1', createdAt: 3000 });
  assert.equal(r2.changes, 0);
  assert.equal(wallet(db, 8).purchased_rna, 0);
  const revCount = db
    .prepare("SELECT COUNT(*) AS c FROM wallet_ledger WHERE kind='reversal'")
    .get().c;
  assert.equal(revCount, 1);
  db.close();
});

test('grant season_pass: max(cur, created_at) + мс, время не сгорает (v17)', () => {
  const db = freshDb();
  const month = 30 * 86_400_000;
  grant(db, { userId: 9, chargeId: 'p1', grantType: 'season_pass', amount: month, skinId: null, createdAt: 1000 });
  assert.equal(wallet(db, 9).season_pass_until_ms, 1000 + month);
  // Продление позже: продлевает от текущего срока, а не от now.
  grant(db, { userId: 9, chargeId: 'p2', grantType: 'season_pass', amount: month, skinId: null, createdAt: 2000 });
  assert.equal(wallet(db, 9).season_pass_until_ms, 1000 + 2 * month);
  // Бустер и пропуск независимы.
  assert.equal(wallet(db, 9).booster_until_ms, 0);
  db.close();
});

test('reversal season_pass: не ниже момента возврата (v17)', () => {
  const db = freshDb();
  const month = 30 * 86_400_000;
  grant(db, { userId: 10, chargeId: 'p1', grantType: 'season_pass', amount: month, skinId: null, createdAt: 1000 });
  assert.equal(wallet(db, 10).season_pass_until_ms, 1000 + month);
  // Возврат «съедает» больше, чем осталось: clamp на created_at reversal.
  reversal(db, { op: 'op1', origChargeId: 'p1', createdAt: 2000 });
  assert.equal(wallet(db, 10).season_pass_until_ms, 2000);
  db.close();
});

test('subscription_events: таблица аудита существует (v17)', () => {
  const db = freshDb();
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='subscription_events'")
    .get();
  assert.equal(row?.name, 'subscription_events');
  db.prepare(
    'INSERT INTO subscription_events (user_id, nonce, charge_id, state, created_at) VALUES (?,?,?,?,?)'
  ).run(11, 'nonce-sp-ev', 'ch-ev', 'canceled', 1000);
  const ev = db
    .prepare('SELECT state, charge_id FROM subscription_events WHERE nonce=?')
    .get('nonce-sp-ev');
  assert.equal(ev.state, 'canceled');
  assert.equal(ev.charge_id, 'ch-ev');
  db.close();
});

test('бандл: один charge_id — N строк, кошелёк и скины (v17)', () => {
  const db = freshDb();
  const week = 7 * 86_400_000;
  const g1 = grant(db, { userId: 11, chargeId: 'b1', grantType: 'rna', amount: 500, skinId: null, createdAt: 1000 });
  const g2 = grant(db, { userId: 11, chargeId: 'b1', grantType: 'booster', amount: week, skinId: null, createdAt: 1000 });
  const g3 = grant(db, { userId: 11, chargeId: 'b1', grantType: 'skin', amount: 0, skinId: 'skin.x', createdAt: 1000 });
  assert.equal(g1.changes, 1);
  assert.equal(g2.changes, 1);
  assert.equal(g3.changes, 1);
  const count = db.prepare("SELECT COUNT(*) AS c FROM wallet_ledger WHERE charge_id='b1'").get().c;
  assert.equal(count, 3);
  assert.equal(wallet(db, 11).purchased_rna, 500);
  assert.equal(wallet(db, 11).booster_until_ms, 1000 + week);
  const skin = db.prepare("SELECT status FROM wallet_skins WHERE user_id=11 AND skin_id='skin.x'").get();
  assert.equal(skin.status, 'active');
  db.close();
});

test('дубликат компонента бандла: changes=0 (v17)', () => {
  const db = freshDb();
  grant(db, { userId: 12, chargeId: 'b2', grantType: 'rna', amount: 500, skinId: null, createdAt: 1000 });
  const dup = grant(db, { userId: 12, chargeId: 'b2', grantType: 'rna', amount: 500, skinId: null, createdAt: 1000 });
  assert.equal(dup.changes, 0);
  assert.equal(wallet(db, 12).purchased_rna, 500);
  // Другой компонент того же charge_id — вставляется.
  const other = grant(db, { userId: 12, chargeId: 'b2', grantType: 'booster', amount: 1000, skinId: null, createdAt: 1000 });
  assert.equal(other.changes, 1);
  db.close();
});

test('reversal бандла: все компоненты, charge_id построчные (v17)', () => {
  const db = freshDb();
  const week = 7 * 86_400_000;
  grant(db, { userId: 13, chargeId: 'b3', grantType: 'rna', amount: 500, skinId: null, createdAt: 1000 });
  grant(db, { userId: 13, chargeId: 'b3', grantType: 'booster', amount: week, skinId: null, createdAt: 1000 });
  grant(db, { userId: 13, chargeId: 'b3', grantType: 'skin', amount: 0, skinId: 'skin.y', createdAt: 1000 });
  const res = reversal(db, { op: 'op-bundle', origChargeId: 'b3', createdAt: 2000 });
  assert.equal(res.changes, 3);
  assert.equal(wallet(db, 13).purchased_rna, 0);
  assert.equal(wallet(db, 13).booster_until_ms, 2000);
  const skin = db.prepare("SELECT status FROM wallet_skins WHERE user_id=13 AND skin_id='skin.y'").get();
  assert.equal(skin.status, 'reversed');
  const revIds = db
    .prepare("SELECT charge_id FROM wallet_ledger WHERE kind='reversal' ORDER BY charge_id")
    .all()
    .map((r) => r.charge_id);
  assert.deepEqual(revIds, [
    'rev:op-bundle:booster:',
    'rev:op-bundle:rna:',
    'rev:op-bundle:skin:skin.y',
  ]);
  // Повторный reversal того же платежа — 0 строк.
  const res2 = reversal(db, { op: 'op-bundle-2', origChargeId: 'b3', createdAt: 3000 });
  assert.equal(res2.changes, 0);
  db.close();
});

test('три скина с одним charge_id: три строки wallet_skins (v17)', () => {
  const db = freshDb();
  grant(db, { userId: 14, chargeId: 'trio', grantType: 'skin', amount: 0, skinId: 'skin.a', createdAt: 1000 });
  grant(db, { userId: 14, chargeId: 'trio', grantType: 'skin', amount: 0, skinId: 'skin.b', createdAt: 1000 });
  grant(db, { userId: 14, chargeId: 'trio', grantType: 'skin', amount: 0, skinId: 'skin.c', createdAt: 1000 });
  const rows = db
    .prepare("SELECT skin_id, status FROM wallet_skins WHERE user_id=14 ORDER BY skin_id")
    .all();
  assert.deepEqual(
    rows.map((r) => [r.skin_id, r.status]),
    [
      ['skin.a', 'active'],
      ['skin.b', 'active'],
      ['skin.c', 'active'],
    ]
  );
  // Возврат бандла гасит все три скина одной операцией.
  reversal(db, { op: 'op-trio', origChargeId: 'trio', createdAt: 2000 });
  const active = db
    .prepare("SELECT COUNT(*) AS c FROM wallet_skins WHERE user_id=14 AND status='active'")
    .get().c;
  assert.equal(active, 0);
  db.close();
});

test('duplicate_payments: status state machine (P1-1)', () => {
  const db = freshDb();
  const ins = db.prepare(SQL_INSERT_DUPLICATE_PAYMENT).run(
    'dup-1', 'nonce-dup-1', 15, 'currency.rna-pack-s', 35, 'XTR', 'nonce_reuse', 1000
  );
  assert.equal(ins.changes, 1);
  const status = () => db.prepare('SELECT status FROM duplicate_payments WHERE charge_id=?').get('dup-1').status;
  assert.equal(status(), 'pending');
  // Повторная вставка того же charge_id — no-op.
  const dup = db.prepare(SQL_INSERT_DUPLICATE_PAYMENT).run(
    'dup-1', 'nonce-dup-1', 15, 'currency.rna-pack-s', 35, 'XTR', 'nonce_reuse', 1000
  );
  assert.equal(dup.changes, 0);
  // Бронь execute-возврата: только из pending.
  const req = db.prepare(SQL_UPDATE_DUPLICATE_REFUND_REQUESTED).run('dup-1');
  assert.equal(req.changes, 1);
  assert.equal(status(), 'refund_requested');
  const req2 = db.prepare(SQL_UPDATE_DUPLICATE_REFUND_REQUESTED).run('dup-1');
  assert.equal(req2.changes, 0, 'second reservation is a no-op (concurrent refund loses)');
  // Завершение: из refund_requested → refunded.
  const fin = db.prepare(SQL_UPDATE_DUPLICATE_REFUNDED_FROM_ANY).run('dup-1');
  assert.equal(fin.changes, 1);
  assert.equal(status(), 'refunded');
  db.close();
});

test('subscription_events: source telegram by default, admin on admin insert (P2-3)', () => {
  const db = freshDb();
  db.prepare(SQL_INSERT_SUBSCRIPTION_EVENT).run(16, 'nonce-src-1', 'ch-src-1', 'canceled', 1000);
  const tg = db.prepare('SELECT source FROM subscription_events WHERE nonce=?').get('nonce-src-1');
  assert.equal(tg.source, 'telegram');
  db.prepare(SQL_INSERT_SUBSCRIPTION_EVENT_ADMIN).run(16, 'nonce-src-2', 'ch-src-2', 'canceled', 'admin', 2000);
  const adm = db.prepare('SELECT source, state FROM subscription_events WHERE nonce=?').get('nonce-src-2');
  assert.equal(adm.source, 'admin');
  assert.equal(adm.state, 'canceled');
  db.close();
});
