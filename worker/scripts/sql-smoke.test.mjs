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
 * 15. CR-R4-2: orders.invoice_url — запись выданного инвойса,
 *     условная пометка invoice_failed (только при invoice_url IS NULL)
 *     и оживление заказа из invoice_failed при поздней записи URL.
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
  SQL_INSERT_ORDER,
  SQL_UPDATE_ORDER_INVOICE_FAILED,
  SQL_UPDATE_ORDER_INVOICE_ISSUED,
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
  // P2-N1: второй season_pass-грант тому же пользователю при активном
  // пропуске — только продление (derived nonce с ':'), иначе guard
  // RAISE(ABORT). Здесь моделируем именно продление: payments-строка
  // с derived nonce, как её пишет recordSubscriptionRenewal.
  pay(db, { chargeId: 'p2', nonce: 'nonce-p1:r:p2', userId: 9, createdAt: 2000 });
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

/**
 * P2-N1 (раунд 2): конкурентная двойная подписка. JS-проверка активного
 * пропуска в recordSuccessfulPayment и грант-батч — отдельные вызовы D1:
 * два параллельных платежа второй подписки оба читают pass=0 и оба
 * выдают грант (аудит воспроизвёл интерливингом: payments=2, pass=+60д).
 * Guard — BEFORE INSERT триггер trg_wallet_ledger_season_pass_guard
 * (worker/schema.sql + worker/migration-17.sql): RAISE(ABORT) для
 * НЕ-продлённых season_pass-грантов при активном пропуске. Продление
 * отличается по payments.nonce: derived `${nonce}:r:${chargeId}` содержит
 * ':', обычный nonce — нет (NONCE_RE). INSERT payments идёт в батче
 * РАНЬШЕ INSERT ledger (recordSuccessfulPayment / recordSubscriptionRenewal).
 */
function pay(db, { chargeId, nonce, userId, createdAt }) {
  db.prepare(
    'INSERT INTO payments (charge_id, user_id, product_id, amount, currency, status, nonce, sku_version, created_at, fulfilled_at) ' +
      "VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(charge_id) DO NOTHING"
  ).run(chargeId, userId, 'season-pass.basic-30d', 250, 'XTR', 'paid', nonce, 4, createdAt, null);
}

test('guard: второй первый платёж пропуска при активном — ABORT, батч откатывается (P2-N1)', () => {
  const db = freshDb();
  const month = 30 * 86_400_000;
  const now = Date.now();
  // Первый платёж: грант применён.
  pay(db, { chargeId: 'n1-ch-1', nonce: 'n1-nonce-1', userId: 21, createdAt: now });
  grant(db, { userId: 21, chargeId: 'n1-ch-1', grantType: 'season_pass', amount: month, skinId: null, createdAt: now });
  assert.equal(wallet(db, 21).season_pass_until_ms, now + month);
  // Второй первый платёж (другой заказ, другой charge_id) при активном
  // пропуске — production-батч в одной транзакции: платёж + грант.
  // Guard обязан уронить батч целиком (платёж тоже откатывается).
  db.exec('BEGIN IMMEDIATE');
  let aborted = null;
  try {
    pay(db, { chargeId: 'n1-ch-2', nonce: 'n1-nonce-2', userId: 21, createdAt: now });
    grant(db, { userId: 21, chargeId: 'n1-ch-2', grantType: 'season_pass', amount: month, skinId: null, createdAt: now });
    db.exec('COMMIT');
  } catch (e) {
    aborted = e;
    db.exec('ROLLBACK');
  }
  assert.ok(aborted, 'second first-payment grant must ABORT while pass is active');
  assert.match(String(aborted.message), /already active/, 'guard error message');
  assert.equal(wallet(db, 21).season_pass_until_ms, now + month, 'pass not extended by denied grant');
  assert.equal(
    db.prepare('SELECT COUNT(*) AS c FROM payments WHERE charge_id=?').get('n1-ch-2').c,
    0,
    'batch rolled back: no payment row for denied grant'
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS c FROM wallet_ledger WHERE grant_type='season_pass' AND user_id=21").get().c,
    1,
    'exactly one season_pass grant row'
  );
  db.close();
});

test('guard: продление (derived nonce) при активном пропуске — разрешено (P2-N1)', () => {
  const db = freshDb();
  const month = 30 * 86_400_000;
  const now = Date.now();
  pay(db, { chargeId: 'n1r-ch-1', nonce: 'n1r-nonce-1', userId: 22, createdAt: now });
  grant(db, { userId: 22, chargeId: 'n1r-ch-1', grantType: 'season_pass', amount: month, skinId: null, createdAt: now });
  // Продление: тот же nonce с суффиксом ':r:<chargeId>' (recordSubscriptionRenewal).
  pay(db, { chargeId: 'n1r-ch-1r', nonce: 'n1r-nonce-1:r:n1r-ch-1r', userId: 22, createdAt: now });
  const res = grant(db, { userId: 22, chargeId: 'n1r-ch-1r', grantType: 'season_pass', amount: month, skinId: null, createdAt: now });
  assert.equal(res.changes, 1, 'renewal grant inserted');
  assert.equal(wallet(db, 22).season_pass_until_ms, now + 2 * month, 'renewal extends the pass');
  db.close();
});

test('guard: дубликатная доставка первого гранта — no-op, не ABORT (P2-N1)', () => {
  const db = freshDb();
  const month = 30 * 86_400_000;
  const now = Date.now();
  pay(db, { chargeId: 'n1d-ch-1', nonce: 'n1d-nonce-1', userId: 23, createdAt: now });
  grant(db, { userId: 23, chargeId: 'n1d-ch-1', grantType: 'season_pass', amount: month, skinId: null, createdAt: now });
  // Повторная доставка того же charge_id: ON CONFLICT DO NOTHING.
  // BEFORE-триггер срабатывает и для конфликтующей строки — guard обязан
  // пропускать уже существующий ключ, иначе ретрай Telegram ушёл бы в
  // вечный 503 вместо no-op.
  const dup = grant(db, { userId: 23, chargeId: 'n1d-ch-1', grantType: 'season_pass', amount: month, skinId: null, createdAt: now });
  assert.equal(dup.changes, 0, 'duplicate delivery is a no-op');
  assert.equal(wallet(db, 23).season_pass_until_ms, now + month, 'pass not extended by duplicate');
  db.close();
});

test('guard: после истечения пропуска новый первый платёж — разрешён (P2-N1)', () => {
  const db = freshDb();
  const month = 30 * 86_400_000;
  const now = Date.now();
  pay(db, { chargeId: 'n1e-ch-1', nonce: 'n1e-nonce-1', userId: 24, createdAt: now });
  grant(db, { userId: 24, chargeId: 'n1e-ch-1', grantType: 'season_pass', amount: month, skinId: null, createdAt: now });
  // Покупка после истечения (created_at гранта позже срока пропуска).
  const later = now + 31 * 86_400_000;
  pay(db, { chargeId: 'n1e-ch-2', nonce: 'n1e-nonce-2', userId: 24, createdAt: later });
  const res = grant(db, { userId: 24, chargeId: 'n1e-ch-2', grantType: 'season_pass', amount: month, skinId: null, createdAt: later });
  assert.equal(res.changes, 1, 'post-expiry first payment granted');
  assert.equal(wallet(db, 24).season_pass_until_ms, later + month);
  db.close();
});

test('guard: reversal пропуска и гранты других видов не блокируются (P2-N1)', () => {
  const db = freshDb();
  const month = 30 * 86_400_000;
  const now = Date.now();
  pay(db, { chargeId: 'n1x-ch-1', nonce: 'n1x-nonce-1', userId: 25, createdAt: now });
  grant(db, { userId: 25, chargeId: 'n1x-ch-1', grantType: 'season_pass', amount: month, skinId: null, createdAt: now });
  // РНК-грант при активном пропуске — не трогается guard'ом.
  const rna = grant(db, { userId: 25, chargeId: 'n1x-rna', grantType: 'rna', amount: 500, skinId: null, createdAt: now });
  assert.equal(rna.changes, 1, 'rna grant unaffected by the guard');
  // Reversal пропуска — не грант, guard не применяется.
  reversal(db, { op: 'n1x-op', origChargeId: 'n1x-ch-1', createdAt: now });
  assert.equal(wallet(db, 25).season_pass_until_ms, now, 'reversal applied (floor: moment of return)');
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

test('CR-R4-2: invoice_url — store, условная пометка invoice_failed, revive (real SQLite)', () => {
  const db = freshDb();
  const order = (nonce) =>
    db.prepare('SELECT status, invoice_url FROM orders WHERE nonce=?').get(nonce);
  const insertOrder = (nonce) =>
    db
      .prepare(SQL_INSERT_ORDER)
      .run(nonce, 42, 'currency.rna-pack-s', 35, 4, 500, 0, null, 0, null, 1000);

  // (a) Первая попытка без выданного инвойса — по-прежнему терминальна
  // (регрессия на CR-R3-2): пометка проходит, invoice_url NULL.
  insertOrder('r4-a');
  assert.equal(order('r4-a').invoice_url, null);
  const markA = db.prepare(SQL_UPDATE_ORDER_INVOICE_FAILED).run('r4-a');
  assert.equal(markA.changes, 1, 'first-attempt failure still marks invoice_failed');
  assert.equal(order('r4-a').status, 'invoice_failed');

  // (b) Инвойс выдан — пометка no-op: заказ остаётся pending, URL жив.
  insertOrder('r4-b');
  const storeB = db
    .prepare(SQL_UPDATE_ORDER_INVOICE_ISSUED)
    .run('https://t.me/$inv-r4-b', 'r4-b');
  assert.equal(storeB.changes, 1, 'issued URL stored');
  assert.equal(order('r4-b').invoice_url, 'https://t.me/$inv-r4-b');
  assert.equal(order('r4-b').status, 'pending');
  const markB = db.prepare(SQL_UPDATE_ORDER_INVOICE_FAILED).run('r4-b');
  assert.equal(markB.changes, 0, 'failed retry does not mark an order with an issued invoice');
  assert.equal(order('r4-b').status, 'pending');

  // (c) Конкурентный близнец пометил заказ раньше, чем успел записаться
  // URL, — поздняя запись оживляет заказ обратно в pending.
  insertOrder('r4-c');
  db.prepare(SQL_UPDATE_ORDER_INVOICE_FAILED).run('r4-c');
  assert.equal(order('r4-c').status, 'invoice_failed');
  db.prepare(SQL_UPDATE_ORDER_INVOICE_ISSUED).run('https://t.me/$inv-r4-c', 'r4-c');
  assert.equal(order('r4-c').status, 'pending', 'late store revives invoice_failed order');
  assert.equal(order('r4-c').invoice_url, 'https://t.me/$inv-r4-c');

  // (d) Терминальные статусы запись URL не трогает (оплаченный заказ
  // не воскресает; pre_checkout требует pending).
  insertOrder('r4-d');
  db.prepare("UPDATE orders SET status='paid' WHERE nonce='r4-d'").run();
  db.prepare(SQL_UPDATE_ORDER_INVOICE_ISSUED).run('https://t.me/$inv-r4-d', 'r4-d');
  assert.equal(order('r4-d').status, 'paid', 'paid order is not revived by a late store');
  db.close();
});
