/**
 * Worker round 2 — монетизация v3 (PR #291, второй аудит 2026-11-17).
 *
 * Covers (worker-side; клиентская сторона — в telegram-stars.mjs и
 * server-wallet-sync.mjs):
 * - P2-N1: конкурентная двойная подписка. Guard-триггер
 *   trg_wallet_ledger_season_pass_guard (BEFORE INSERT, RAISE(ABORT)):
 *   production-батч второго первого платежа при активном пропуске
 *   падает целиком (платёж не записан, заказ pending); ретрай вебхука
 *   уходит в denied-путь (duplicate_payments + заказ 'denied');
 *   продление своей подписки продолжает работать.
 *   Настоящая гонка двух батчей — в tests/patch16-concurrency.mjs (g)
 *   (реальный SQLite, worker_threads): стаб D1 не эмулирует
 *   конкурентные транзакции (snapshot/restore на батч), поэтому
 *   интерливинг через вебхук здесь не гоняется — только последствия
 *   (guard-abort → 503-эквивалент → retry → denied).
 * - P2-N2: отклонённый платёж — /api/verify возвращает 'denied' для
 *   denied-заказов и 'duplicate' для charge из duplicate_payments
 *   (раньше — вечный 'pending'); отклонение подписки в вебхуке —
 *   best-effort editUserStarSubscription (отмена), провал отмены —
 *   громкий лог, вебхук всё равно 200.
 * - P3-10: /api/wallet — флаг truncated:true при достижении LIMIT 5000
 *   (клиент пагинирует с since_seq = max возвращённого id).
 *
 * D1 — общий стаб tests/d1-v16-stub.mjs (+ эмуляция guard-триггера).
 * Bot API — стаб globalThis.fetch с флагами падения.
 */
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { makeD1, seedLedgerBulk, seedOrder } from './d1-v16-stub.mjs';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-worker-round2-'));
writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'commonjs' }));
const require = createRequire(import.meta.url);

const assert = (condition, message) => {
  if (!condition) throw new Error(`worker-round2: ${message}`);
};
const eq = (actual, expected, message) =>
  assert(actual === expected, `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

const BOT_TOKEN = 'test-bot-token-r2-0123456789';
const WEBHOOK_SECRET = 'test-webhook-secret-r2-0123456789';
const ADMIN_TOKEN = 'test-admin-token-r2-0123456789';
const USER_ID = 777005;
const PASS_ID = 'season-pass.basic-30d';
const RNA_ID = 'currency.rna-pack-s';
const DAY_MS = 86_400_000;

function signInitData(fields) {
  const keys = Object.keys(fields).sort();
  const dataCheckString = keys.map((k) => `${k}=${fields[k]}`).join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  return createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
}

function buildInitData(userId) {
  const now = Math.floor(Date.now() / 1000);
  const fields = {
    auth_date: String(now),
    query_id: 'AAE-r2-test',
    user: JSON.stringify({ id: userId, first_name: 'Test' }),
  };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) params.set(k, v);
  params.set('hash', signInitData(fields));
  return params.toString();
}

function paymentBody(chargeId, nonce, opts = {}) {
  const { userId = USER_ID, amount = 35, isRecurring, isFirstRecurring } = opts;
  const sp = {
    currency: 'XTR',
    total_amount: amount,
    invoice_payload: nonce,
    telegram_payment_charge_id: chargeId,
    provider_payment_charge_id: 'prov-r2-1',
  };
  if (isRecurring !== undefined) sp.is_recurring = isRecurring;
  if (isFirstRecurring !== undefined) sp.is_first_recurring = isFirstRecurring;
  return { message: { from: { id: userId }, successful_payment: sp } };
}

async function post(handler, path, body, env, headers = {}) {
  const req = new Request(`https://worker.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return handler.fetch(req, env);
}

async function postJson(handler, path, body, env, headers = {}) {
  const r = await post(handler, path, body, env, headers);
  return { status: r.status, json: await r.json().catch(() => null) };
}

// --- стаб Bot API ---
const botCalls = [];
const botFail = { edit: false };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith('https://api.telegram.org/')) {
    const body = JSON.parse(opts.body);
    const method = u.split('/').pop();
    botCalls.push({ url: u, method, body });
    if (method === 'editUserStarSubscription' && botFail.edit) {
      return new Response(JSON.stringify({ ok: false, description: 'test-edit-fail' }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (method === 'createInvoiceLink') {
      return new Response(JSON.stringify({ ok: true, result: `https://t.me/$inv-r2-${botCalls.length}` }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: true, result: true }), {
      headers: { 'content-type': 'application/json' },
    });
  }
  return realFetch(url, opts);
};

const secretHeader = () => ({ 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET });
const adminHeader = () => ({ authorization: `Bearer ${ADMIN_TOKEN}` });
const editCalls = () => botCalls.filter((c) => c.method === 'editUserStarSubscription');

/** Покупка пропуска: seed заказа + оплата. Возвращает until. */
async function buyPass(handler, db, env, nonce, chargeId, userId = USER_ID) {
  await seedOrder(db, nonce, userId, PASS_ID, 250, { skuVersion: 4, grantRna: 0, grantBoosterDays: 0, grantSeasonPassDays: 30 });
  const r = await post(handler, '/api/webhook', paymentBody(chargeId, nonce, { userId, amount: 250 }), env, secretHeader());
  eq(r.status, 200, `buyPass ${nonce} webhook 200`);
  return db.wallets.get(userId).season_pass_until_ms;
}

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'worker/src/index.ts',
      'worker/src/grants.ts',
      'worker/src/sql.ts',
      '--target',
      'ES2021',
      '--module',
      'commonjs',
      '--moduleResolution',
      'node',
      '--strict',
      'true',
      '--outDir',
      temp,
      '--skipLibCheck',
      'true',
    ],
    { stdio: 'pipe' }
  );

  const worker = require(join(temp, 'index.js'));
  const handler = worker.default;
  assert(handler && typeof handler.fetch === 'function', 'worker exports default.fetch');
  const sql = require(join(temp, 'sql.js'));

  const initData = buildInitData(USER_ID);
  const baseEnv = { TELEGRAM_BOT_TOKEN: BOT_TOKEN, WEBHOOK_SECRET };
  const adminEnv = (db) => ({ ...baseEnv, PAYMENTS_DB: db, ADMIN_TOKEN });

  // === P2-N1: guard-триггер роняет батч второго первого платежа ===
  {
    const db = makeD1();
    const env = adminEnv(db);
    const until1 = await buyPass(handler, db, env, 'r2-n1-nonce-1', 'r2-n1-ch-1');
    assert(until1 > Date.now(), 'P2-N1: first pass bought and active');
    // Второй заказ (как у конкурентного платежа — JS-проверка в гонке
    // его пропустила бы: оба вебхука читают pass=0 до коммита первого).
    await seedOrder(db, 'r2-n1-nonce-2', USER_ID, PASS_ID, 250, { skuVersion: 4, grantRna: 0, grantBoosterDays: 0, grantSeasonPassDays: 30 });
    // Production-батч recordSuccessfulPayment (те же statement'ы и
    // порядок, что в воркере) напрямую: guard обязан уронить его.
    const now = Date.now();
    let aborted = null;
    try {
      await db.batch([
        db.prepare(sql.SQL_UPDATE_ORDER_PAID).bind('r2-n1-nonce-2'),
        db.prepare(sql.SQL_INSERT_PAYMENT).bind(
          'r2-n1-ch-2', USER_ID, PASS_ID, 250, 'XTR', 'paid', 'r2-n1-nonce-2', 4, now, null
        ),
        db.prepare(sql.SQL_INSERT_LEDGER_GRANT).bind(
          USER_ID, 'r2-n1-ch-2', 'grant', 'season_pass', 30 * DAY_MS, null, null, '30 days', now
        ),
      ]);
    } catch (e) {
      aborted = e;
    }
    assert(aborted, 'P2-N1: second first-payment batch must ABORT (guard)');
    assert(/already active/.test(String(aborted.message)), `P2-N1: guard error message (got: ${aborted.message})`);
    assert(!db.payments.has('r2-n1-ch-2'), 'P2-N1: batch rolled back — no payment row');
    eq(db.orders.get('r2-n1-nonce-2')?.status, 'pending', 'P2-N1: batch rolled back — order still pending');
    eq(db.wallets.get(USER_ID).season_pass_until_ms, until1, 'P2-N1: pass not extended by aborted batch');
    // Ретрай Telegram (тот же successful_payment) уходит в denied-путь:
    // JS-проверка теперь видит активный пропуск.
    botCalls.length = 0;
    const retry = await post(handler, '/api/webhook', paymentBody('r2-n1-ch-2', 'r2-n1-nonce-2', { amount: 250 }), env, secretHeader());
    eq(retry.status, 200, 'P2-N1: retry webhook 200 (denied path, not 503 loop)');
    const dup = db.duplicatePayments.get('r2-n1-ch-2');
    assert(dup, 'P2-N1: retried payment recorded in duplicate_payments');
    eq(dup.reason, 'subscription_active', 'P2-N1: duplicate reason subscription_active');
    eq(db.orders.get('r2-n1-nonce-2')?.status, 'denied', 'P2-N1: order denied on retry');
    eq(db.wallets.get(USER_ID).season_pass_until_ms, until1, 'P2-N1: pass still not extended');
    // Продление СВОЕЙ подписки продолжает работать (guard его не трогает).
    const ren = await post(
      handler, '/api/webhook',
      paymentBody('r2-n1-ch-1r', 'r2-n1-nonce-1', { amount: 250, isRecurring: true, isFirstRecurring: false }),
      env, secretHeader()
    );
    eq(ren.status, 200, 'P2-N1: renewal webhook 200');
    eq(
      db.wallets.get(USER_ID).season_pass_until_ms,
      until1 + 30 * DAY_MS,
      'P2-N1: renewal extends the pass by 30d'
    );
    // Последовательный второй платёж после истечения — разрешён (guard
    // не блокирует repurchase; JS-гейт тоже пропускает).
    db.wallets.get(USER_ID).season_pass_until_ms = Date.now() - 1000;
    await seedOrder(db, 'r2-n1-nonce-3', USER_ID, PASS_ID, 250, { skuVersion: 4, grantRna: 0, grantBoosterDays: 0, grantSeasonPassDays: 30 });
    const rep = await post(handler, '/api/webhook', paymentBody('r2-n1-ch-3', 'r2-n1-nonce-3', { amount: 250 }), env, secretHeader());
    eq(rep.status, 200, 'P2-N1: post-expiry repurchase webhook 200');
    assert(db.wallets.get(USER_ID).season_pass_until_ms > Date.now(), 'P2-N1: post-expiry repurchase granted');
  }

  // === P2-N2 (a): verify отклонённого заказа — 'denied', не вечный 'pending' ===
  {
    const db = makeD1();
    const env = adminEnv(db);
    await buyPass(handler, db, env, 'r2-n2-nonce-1', 'r2-n2-ch-1');
    // Вторая подписка при активном пропуске → denied-путь.
    await seedOrder(db, 'r2-n2-nonce-2', USER_ID, PASS_ID, 250, { skuVersion: 4, grantRna: 0, grantBoosterDays: 0, grantSeasonPassDays: 30 });
    const pay = await post(handler, '/api/webhook', paymentBody('r2-n2-ch-2', 'r2-n2-nonce-2', { amount: 250 }), env, secretHeader());
    eq(pay.status, 200, 'P2-N2: denied payment webhook 200');
    eq(db.orders.get('r2-n2-nonce-2')?.status, 'denied', 'P2-N2: order denied');
    const v = await postJson(handler, '/api/verify', { initData, nonce: 'r2-n2-nonce-2' }, env);
    eq(v.status, 200, 'P2-N2: verify 200');
    eq(v.json?.verified, false, 'P2-N2: denied order not verified');
    eq(v.json?.reason, 'denied', 'P2-N2: verify reason denied (was: pending forever)');
    // Обычный pending-заказ (оплаты не было) — по-прежнему 'pending'.
    await seedOrder(db, 'r2-n2-nonce-3', USER_ID, RNA_ID, 35, { skuVersion: 4, grantRna: 500, grantBoosterDays: 0 });
    const vPending = await postJson(handler, '/api/verify', { initData, nonce: 'r2-n2-nonce-3' }, env);
    eq(vPending.json?.reason, 'pending', 'P2-N2: unpaid order still pending');
    // Дубликат без платежа и без denied-статуса заказа (UPDATE denied
    // упал, но duplicate_payments записан) — 'duplicate'.
    await seedOrder(db, 'r2-n2-nonce-4', USER_ID, RNA_ID, 35, { skuVersion: 4, grantRna: 500, grantBoosterDays: 0 });
    db.duplicatePayments.set('r2-n2-ch-dup', {
      charge_id: 'r2-n2-ch-dup', nonce: 'r2-n2-nonce-4', user_id: USER_ID, product_id: RNA_ID,
      amount: 35, currency: 'XTR', reason: 'nonce_reuse', status: 'pending', created_at: Date.now(),
    });
    const vDup = await postJson(handler, '/api/verify', { initData, nonce: 'r2-n2-nonce-4' }, env);
    eq(vDup.json?.verified, false, 'P2-N2: duplicate not verified');
    eq(vDup.json?.reason, 'duplicate', 'P2-N2: verify reason duplicate');
  }

  // === P2-N2 (в): отклонение подписки — best-effort отмена в вебхуке ===
  {
    const db = makeD1();
    const env = adminEnv(db);
    await buyPass(handler, db, env, 'r2-n2c-nonce-1', 'r2-n2c-ch-1');
    await seedOrder(db, 'r2-n2c-nonce-2', USER_ID, PASS_ID, 250, { skuVersion: 4, grantRna: 0, grantBoosterDays: 0, grantSeasonPassDays: 30 });
    botCalls.length = 0;
    const pay = await post(handler, '/api/webhook', paymentBody('r2-n2c-ch-2', 'r2-n2c-nonce-2', { amount: 250 }), env, secretHeader());
    eq(pay.status, 200, 'P2-N2(c): denied payment webhook 200');
    const edits = editCalls();
    eq(edits.length, 1, 'P2-N2(c): editUserStarSubscription called once on denial');
    eq(edits[0].body.user_id, USER_ID, 'P2-N2(c): cancel targets the payer');
    eq(edits[0].body.telegram_payment_charge_id, 'r2-n2c-ch-2', 'P2-N2(c): cancel targets the denied charge');
    eq(edits[0].body.is_canceled, true, 'P2-N2(c): cancel, not restore');
    // Аудит отмены — в subscription_events (source='auto').
    const audit = db.subscriptionEvents.find((e) => e.charge_id === 'r2-n2c-ch-2');
    assert(audit, 'P2-N2(c): auto-cancel audited in subscription_events');
    eq(audit.state, 'canceled', 'P2-N2(c): audit state canceled');
    eq(audit.source, 'auto', 'P2-N2(c): audit source auto (not admin)');
    // Провал отмены: вебхук всё равно 200 + громкий лог, платёж — в
    // duplicate_payments (reconcile-флаг duplicate_without_refund).
    const db2 = makeD1();
    const env2 = adminEnv(db2);
    await buyPass(handler, db2, env2, 'r2-n2c-nonce-3', 'r2-n2c-ch-3');
    await seedOrder(db2, 'r2-n2c-nonce-4', USER_ID, PASS_ID, 250, { skuVersion: 4, grantRna: 0, grantBoosterDays: 0, grantSeasonPassDays: 30 });
    botFail.edit = true;
    const lines = [];
    const origLog = console.log;
    console.log = (...args) => void lines.push(args.join(' '));
    let pay2;
    try {
      pay2 = await post(handler, '/api/webhook', paymentBody('r2-n2c-ch-4', 'r2-n2c-nonce-4', { amount: 250 }), env2, secretHeader());
    } finally {
      console.log = origLog;
      botFail.edit = false;
    }
    eq(pay2.status, 200, 'P2-N2(c): webhook 200 even when auto-cancel fails');
    assert(
      lines.some((l) => l.includes('stars_subscription_cancel_failed')),
      'P2-N2(c): loud log on auto-cancel failure'
    );
    assert(db2.duplicatePayments.has('r2-n2c-ch-4'), 'P2-N2(c): denied payment still recorded (reconcile flag)');
    // Продление отклонённой подписки: denied-гейт тоже пытается отменить
    // (первая отмена могла провалиться; вызов идемпотентен).
    const db3 = makeD1();
    const env3 = adminEnv(db3);
    await buyPass(handler, db3, env3, 'r2-n2c-nonce-5', 'r2-n2c-ch-5');
    await seedOrder(db3, 'r2-n2c-nonce-6', USER_ID, PASS_ID, 250, { skuVersion: 4, grantRna: 0, grantBoosterDays: 0, grantSeasonPassDays: 30 });
    await post(handler, '/api/webhook', paymentBody('r2-n2c-ch-6', 'r2-n2c-nonce-6', { amount: 250 }), env3, secretHeader());
    eq(db3.orders.get('r2-n2c-nonce-6')?.status, 'denied', 'P2-N2(c): second order denied');
    botCalls.length = 0;
    const renew = await post(handler, '/api/webhook', paymentBody('r2-n2c-ch-6r', 'r2-n2c-nonce-6', { amount: 250, isRecurring: true, isFirstRecurring: false }), env3, secretHeader());
    eq(renew.status, 200, 'P2-N2(c): renewal of denied subscription webhook 200');
    eq(editCalls().length, 1, 'P2-N2(c): denied-order gate re-attempts cancel on renewal');
    eq(editCalls()[0].body.telegram_payment_charge_id, 'r2-n2c-ch-6r', 'P2-N2(c): cancel targets the renewal charge');
    assert(db3.duplicatePayments.has('r2-n2c-ch-6r'), 'P2-N2(c): renewal recorded as duplicate');
  }

  // === P3-10: /api/wallet — truncated:true при >5000 строк ===
  {
    const db = makeD1();
    const env = adminEnv(db);
    const bulkRows = (n) =>
      Array.from({ length: n }, (_, i) => ({
        user_id: USER_ID, charge_id: `bulk-${i + 1}`, kind: 'grant', grant_type: 'rna', amount: 1,
      }));
    await seedLedgerBulk(db, bulkRows(5001));
    const w1 = await postJson(handler, '/api/wallet', { initData, since_seq: 0 }, env);
    eq(w1.status, 200, 'P3-10: wallet 200');
    eq(w1.json?.ledger?.length, 5000, 'P3-10: first page = 5000 events');
    eq(w1.json?.truncated, true, 'P3-10: truncated:true on first page (was: absent)');
    eq(w1.json?.tip_seq, 5001, 'P3-10: tip_seq is the real tip');
    const w2 = await postJson(handler, '/api/wallet', { initData, since_seq: 5000 }, env);
    eq(w2.json?.ledger?.length, 1, 'P3-10: second page = 1 event');
    eq(w2.json?.truncated, false, 'P3-10: truncated:false on last page');
    eq(w2.json?.ledger?.[0]?.seq, 5001, 'P3-10: last event seq 5001');
    // Ровно 5000 строк — не truncated.
    const db2 = makeD1();
    const env2 = adminEnv(db2);
    await seedLedgerBulk(db2, bulkRows(5000));
    const w3 = await postJson(handler, '/api/wallet', { initData, since_seq: 0 }, env2);
    eq(w3.json?.ledger?.length, 5000, 'P3-10: exactly 5000 rows returned');
    eq(w3.json?.truncated, false, 'P3-10: exactly 5000 rows not truncated');
  }

  // === CR7: продление с неверной суммой — duplicate_payments, возврат возможен ===
  {
    const db = makeD1();
    const env = adminEnv(db);
    const until1 = await buyPass(handler, db, env, 'r2-cr7-nonce-1', 'r2-cr7-ch-1');
    assert(until1 > Date.now(), 'CR7: first pass bought and active');
    // Продление с неверной суммой (200 вместо 250): гранта нет, но деньги
    // списаны Telegram — платёж должен быть возвращаем через /api/admin/refund.
    const ren = await post(
      handler, '/api/webhook',
      paymentBody('r2-cr7-ch-1r', 'r2-cr7-nonce-1', { amount: 200, isRecurring: true, isFirstRecurring: false }),
      env, secretHeader()
    );
    eq(ren.status, 200, 'CR7: mismatch renewal webhook 200');
    eq(db.wallets.get(USER_ID).season_pass_until_ms, until1, 'CR7: mismatched renewal grants nothing');
    assert(!db.payments.has('r2-cr7-ch-1r'), 'CR7: no payment row for mismatched renewal');
    const dup = db.duplicatePayments.get('r2-cr7-ch-1r');
    assert(dup, 'CR7: mismatched renewal recorded in duplicate_payments');
    eq(dup.reason, 'renewal_amount_mismatch', 'CR7: duplicate reason renewal_amount_mismatch');
    eq(dup.amount, 200, 'CR7: duplicate amount is the charged amount');
    // Возврат по charge_id возможен (до фикса: not-found).
    const ref = await post(
      handler, '/api/admin/refund',
      { chargeId: 'r2-cr7-ch-1r', execute: true, confirmExternalRefund: true },
      env, adminHeader()
    );
    const refj = await ref.json();
    eq(ref.status, 200, 'CR7: refund of mismatched renewal → 200');
    eq(refj.ok, true, 'CR7: refund ok:true');
    eq(db.duplicatePayments.get('r2-cr7-ch-1r').status, 'refunded', 'CR7: duplicate status → refunded');
  }

  console.log('worker-round2: all assertions passed');
} catch (e) {
  console.error(e.stack || e);
  process.exit(1);
} finally {
  globalThis.fetch = realFetch;
}
