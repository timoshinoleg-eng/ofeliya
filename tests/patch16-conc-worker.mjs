/**
 * patch16-conc-worker — worker thread для tests/patch16-concurrency.mjs.
 *
 * Чистый JS (без типов): SQL-константы и параметры задач приходят через
 * workerData от главного потока (главный импортирует worker/src/sql.ts
 * напрямую через node type stripping — единый источник правды, без копий).
 * Каждый воркер открывает СВОЁ соединение к файловому SQLite (WAL),
 * выполняет задачи последовательно; старт — по барьеру 'start'.
 *
 * Задача {type:'grant'} — ТОЧНЫЙ production-батч successful_payment
 * (3 statement'а, тот же порядок bind'ов, что в worker/src/index.ts):
 *   1. SQL_UPDATE_ORDER_PAID
 *   2. SQL_INSERT_PAYMENT
 *   3. SQL_INSERT_LEDGER_GRANT  (запускает trg_wallet_ledger_apply)
 * в одной транзакции (эквивалент D1 db.batch()).
 * Задача {type:'refund-mark'} — батч mark-возврата (refund_ops +
 * payments→'refunded' + reversal, тоже одна транзакция).
 */
import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';

const { dbPath, sql } = workerData;

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode=WAL');
db.exec('PRAGMA busy_timeout=15000');
db.exec('PRAGMA synchronous=NORMAL');

const cache = new Map();
function stmt(key, text) {
  let s = cache.get(key);
  if (!s) {
    s = db.prepare(text);
    cache.set(key, s);
  }
  return s;
}

function txn(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  }
}

/** Production-батч: порядок statement'ов и bind'ов — 1:1 с recordSuccessfulPayment. */
function runGrant(t) {
  return txn(() => {
    const r1 = stmt('uop', sql.SQL_UPDATE_ORDER_PAID).run(t.nonce);
    const r2 = stmt('ip', sql.SQL_INSERT_PAYMENT).run(
      t.chargeId, t.userId, t.productId, t.amount, 'XTR', 'paid', t.nonce, t.skuVersion, t.now, null
    );
    const r3 = stmt('ilg', sql.SQL_INSERT_LEDGER_GRANT).run(
      t.userId, t.chargeId, 'grant', t.kind, t.ledgerAmount, t.skinId, null, t.amountText, t.now
    );
    return { changes: [Number(r1.changes), Number(r2.changes), Number(r3.changes)] };
  });
}

/** Mark-возврат: один батч (журнал + статус + reversal через триггер). */
function runRefundMark(t) {
  return txn(() => {
    const r1 = stmt('iro', sql.SQL_INSERT_REFUND_OP).run(
      t.operationId, t.chargeId, t.userId, 'mark', 'completed', t.reason, null, t.now, t.now
    );
    const r2 = stmt('upr', sql.SQL_UPDATE_PAYMENT_REFUNDED).run(t.chargeId);
    const r3 = stmt('ilr', sql.SQL_INSERT_LEDGER_REVERSAL).run(t.revChargeId, t.now, t.chargeId, t.chargeId, t.chargeId);
    return { changes: [Number(r1.changes), Number(r2.changes), Number(r3.changes)] };
  });
}

parentPort.on('message', (msg) => {
  if (msg !== 'start') return;
  const results = [];
  for (const t of workerData.tasks) {
    try {
      const r = t.type === 'grant' ? runGrant(t) : runRefundMark(t);
      results.push({ ok: true, name: t.name, ...r });
    } catch (e) {
      results.push({ ok: false, name: t.name, error: String((e && e.message) || e) });
    }
  }
  parentPort.postMessage({ done: true, results });
});
