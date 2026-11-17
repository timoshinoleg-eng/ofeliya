/**
 * Worker P1/P2 fixes — монетизация v3 (PR #291, deep review 2026-11-17).
 *
 * Covers:
 * - P1-1: возврат duplicate_payments-charge через /api/admin/refund
 *   (execute + mark): исходная покупка цела, грантов нет, повтор —
 *   already:true без второго refundStarPayment, параллельные возвраты —
 *   ровно один вызов Bot API, сбой Bot API → 502 + resume тем же
 *   operationId; 401 без ADMIN_TOKEN, not-found для неизвестного charge.
 * - P1-2: серверный запрет второй подписки: активный пропуск →
 *   invoice 409 subscription-active; второй pending subscription-инвойс →
 *   409 subscription-pending (протухший >24ч не блокирует); оплата
 *   второго инвойса при активном пропуске → без гранта, в
 *   duplicate_payments (reason subscription_active), заказ 'denied';
 *   продление работает; продление отклонённой подписки гранта не даёт;
 *   после истечения покупка снова разрешена; pre_checkout отклоняет
 *   второй инвойс при активном пропуске.
 * - P2-1: бандл с двумя однотипными компонентами — fail-closed
 *   (unknown-product путь: платёж записан, гранта нет); self-test
 *   каталога на уникальность (kind, skinId); grantsForProduct → null
 *   на дубликате компонентов.
 * - P2-2: возврат пропуска → subscriptionStillActive + hint;
 *   cancelSubscription:true → editUserStarSubscription вызван.
 * - P2-3 (попутно): админские правки подписки пишутся в
 *   subscription_events с source='admin'.
 * - P2-5: повтор /api/invoice с тем же nonce (тот же user+product,
 *   pending) → 200 с новым URL; чужой user / оплаченный заказ → 502.
 * - P2-6: падение Bot API на pre-checkout → 503, не 500/throw.
 * - P1-3 (в): read-back после грант-батча: нормальный платёж — без
 *   mismatch-лога; отключённый триггер (стаб disableTrigger) — громкий
 *   stars_grant_readback_mismatch, вебхук всё равно 200.
 *
 * D1 — общий стаб tests/d1-v16-stub.mjs (+duplicate_payments).
 * Bot API — стаб globalThis.fetch с флагами падения.
 */
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { makeD1, seedOrder } from './d1-v16-stub.mjs';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-worker-p1-'));
writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'commonjs' }));
const require = createRequire(import.meta.url);

const assert = (condition, message) => {
  if (!condition) throw new Error(`worker-p1: ${message}`);
};
const eq = (actual, expected, message) =>
  assert(actual === expected, `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

const BOT_TOKEN = 'test-bot-token-p1-0123456789';
const WEBHOOK_SECRET = 'test-webhook-secret-p1-0123456789';
const ADMIN_TOKEN = 'test-admin-token-p1-0123456789';
const USER_ID = 777005;
const OTHER_USER = 777006;
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
    query_id: 'AAE-p1-test',
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
    provider_payment_charge_id: 'prov-p1-1',
  };
  if (isRecurring !== undefined) sp.is_recurring = isRecurring;
  if (isFirstRecurring !== undefined) sp.is_first_recurring = isFirstRecurring;
  return { message: { from: { id: userId }, successful_payment: sp } };
}

function preCheckoutBody(queryId, nonce, opts = {}) {
  const { amount = 35, currency = 'XTR', userId = USER_ID } = opts;
  return {
    pre_checkout_query: {
      id: queryId,
      invoice_payload: nonce,
      currency,
      total_amount: amount,
      from: { id: userId },
    },
  };
}

async function post(handler, path, body, env, headers = {}) {
  const req = new Request(`https://worker.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return handler.fetch(req, env);
}

// --- стаб Bot API ---
const botCalls = [];
const botFail = { refund: false, preCheckout: false, edit: false };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith('https://api.telegram.org/')) {
    const body = JSON.parse(opts.body);
    const method = u.split('/').pop();
    botCalls.push({ url: u, method, body });
    if (method === 'answerPreCheckoutQuery' && botFail.preCheckout) {
      throw new Error('p1-stub: answerPreCheckoutQuery network failure');
    }
    if (method === 'refundStarPayment' && botFail.refund) {
      return new Response(JSON.stringify({ ok: false, description: 'test-fail' }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (method === 'editUserStarSubscription' && botFail.edit) {
      return new Response(JSON.stringify({ ok: false, description: 'test-edit-fail' }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (method === 'createInvoiceLink') {
      return new Response(JSON.stringify({ ok: true, result: `https://t.me/$inv-p1-${botCalls.length}` }), {
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
const refundCalls = () => botCalls.filter((c) => c.method === 'refundStarPayment');
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
  const grants = require(join(temp, 'grants.js'));

  const initData = buildInitData(USER_ID);
  const otherInitData = buildInitData(OTHER_USER);
  const baseEnv = { TELEGRAM_BOT_TOKEN: BOT_TOKEN, WEBHOOK_SECRET };
  const adminEnv = (db) => ({ ...baseEnv, PAYMENTS_DB: db, ADMIN_TOKEN });

  // === P1-1: возврат дубликата (execute) ===
  {
    const db = makeD1();
    const env = { ...baseEnv, PAYMENTS_DB: db, ADMIN_TOKEN };
    await seedOrder(db, 'nonce-p1-dup-1', USER_ID, RNA_ID, 35, { skuVersion: 4, grantRna: 500, grantBoosterDays: 0 });
    await post(handler, '/api/webhook', paymentBody('ch-p1-first', 'nonce-p1-dup-1'), env, secretHeader());
    eq(db.wallets.get(USER_ID).purchased_rna, 500, 'P1-1: original grant applied');
    await post(handler, '/api/webhook', paymentBody('ch-p1-second', 'nonce-p1-dup-1'), env, secretHeader());
    const dup = db.duplicatePayments.get('ch-p1-second');
    assert(dup, 'P1-1: second payment recorded in duplicate_payments');
    eq(dup.reason, 'nonce_reuse', 'P1-1: duplicate reason nonce_reuse');
    eq(dup.status, 'pending', 'P1-1: duplicate status pending');
    eq(db.wallets.get(USER_ID).purchased_rna, 500, 'P1-1: no grant for duplicate');

    botCalls.length = 0;
    const r = await post(
      handler, '/api/admin/refund',
      { chargeId: 'ch-p1-second', reason: 'duplicate', execute: true, operationId: 'op-p1-dup-1' },
      env, adminHeader()
    );
    eq(r.status, 200, 'P1-1: duplicate refund http 200');
    const j = await r.json();
    eq(j.ok, true, 'P1-1: duplicate refund ok:true (was not-found)');
    eq(j.executed, true, 'P1-1: duplicate refund executed:true');
    eq(refundCalls().length, 1, 'P1-1: exactly one refundStarPayment');
    eq(refundCalls()[0].body.telegram_payment_charge_id, 'ch-p1-second', 'P1-1: refund targets duplicate charge');
    eq(refundCalls()[0].body.user_id, USER_ID, 'P1-1: refund user_id from duplicate row');
    eq(db.duplicatePayments.get('ch-p1-second').status, 'refunded', 'P1-1: duplicate status refunded');
    eq(db.refundOps.get('op-p1-dup-1').status, 'completed', 'P1-1: refund op completed');
    // Исходная покупка цела: платёж paid, грант на месте, reversal нет.
    eq(db.payments.get('ch-p1-first').status, 'paid', 'P1-1: original payment still paid');
    eq(db.wallets.get(USER_ID).purchased_rna, 500, 'P1-1: original grant untouched');
    eq([...db.ledger.values()].filter((x) => x.kind === 'reversal').length, 0, 'P1-1: no reversal rows (no grant to reverse)');

    // Повтор возврата — already:true, без второго вызова Bot API.
    const r2 = await post(
      handler, '/api/admin/refund',
      { chargeId: 'ch-p1-second', reason: 'duplicate', execute: true, operationId: 'op-p1-dup-1b' },
      env, adminHeader()
    );
    const j2 = await r2.json();
    eq(j2.ok, true, 'P1-1: repeat refund ok:true');
    eq(j2.already, true, 'P1-1: repeat refund already:true');
    eq(refundCalls().length, 1, 'P1-1: no second refundStarPayment on repeat');
  }

  // === P1-1: параллельные возвраты дубликата ===
  {
    const db = makeD1();
    const env = { ...baseEnv, PAYMENTS_DB: db, ADMIN_TOKEN };
    await seedOrder(db, 'nonce-p1-dup-2', USER_ID, RNA_ID, 35, { skuVersion: 4, grantRna: 500, grantBoosterDays: 0 });
    await post(handler, '/api/webhook', paymentBody('ch-p1-par-1', 'nonce-p1-dup-2'), env, secretHeader());
    await post(handler, '/api/webhook', paymentBody('ch-p1-par-2', 'nonce-p1-dup-2'), env, secretHeader());
    botCalls.length = 0;
    const [ra, rb] = await Promise.all([
      post(handler, '/api/admin/refund', { chargeId: 'ch-p1-par-2', reason: 'a', execute: true, operationId: 'op-p1-par-a' }, env, adminHeader()),
      post(handler, '/api/admin/refund', { chargeId: 'ch-p1-par-2', reason: 'b', execute: true, operationId: 'op-p1-par-b' }, env, adminHeader()),
    ]);
    const ja = await ra.json();
    const jb = await rb.json();
    eq(refundCalls().length, 1, 'P1-1 parallel: exactly one refundStarPayment');
    const oks = [ja, jb].filter((j) => j.ok === true && j.executed === true).length;
    eq(oks, 1, 'P1-1 parallel: exactly one executed:true');
    const other = ja.executed === true ? jb : ja;
    assert(
      (other.ok === true && other.already === true) || other.error === 'refund-in-progress',
      `P1-1 parallel: loser is already:true or 409 refund-in-progress (got ${JSON.stringify(other)})`
    );
    eq(db.duplicatePayments.get('ch-p1-par-2').status, 'refunded', 'P1-1 parallel: duplicate refunded once');
    eq(db.wallets.get(USER_ID).purchased_rna, 500, 'P1-1 parallel: original grant untouched');
  }

  // === P1-1: сбой Bot API → 502 + resume тем же operationId ===
  {
    const db = makeD1();
    const env = { ...baseEnv, PAYMENTS_DB: db, ADMIN_TOKEN };
    await seedOrder(db, 'nonce-p1-dup-3', USER_ID, RNA_ID, 35, { skuVersion: 4, grantRna: 500, grantBoosterDays: 0 });
    await post(handler, '/api/webhook', paymentBody('ch-p1-f1', 'nonce-p1-dup-3'), env, secretHeader());
    await post(handler, '/api/webhook', paymentBody('ch-p1-f2', 'nonce-p1-dup-3'), env, secretHeader());
    botFail.refund = true;
    botCalls.length = 0;
    const r = await post(
      handler, '/api/admin/refund',
      { chargeId: 'ch-p1-f2', reason: 'x', execute: true, operationId: 'op-p1-fail-1' },
      env, adminHeader()
    );
    botFail.refund = false;
    eq(r.status, 502, 'P1-1 fail: Bot API failure → 502');
    eq((await r.json()).error, 'refund-failed', 'P1-1 fail: refund-failed code');
    eq(db.duplicatePayments.get('ch-p1-f2').status, 'refund_requested', 'P1-1 fail: reservation kept');
    eq(db.refundOps.get('op-p1-fail-1').status, 'requested', 'P1-1 fail: op requested (resumable)');
    const r2 = await post(
      handler, '/api/admin/refund',
      { chargeId: 'ch-p1-f2', reason: 'x', execute: true, operationId: 'op-p1-fail-1' },
      env, adminHeader()
    );
    const j2 = await r2.json();
    eq(j2.ok, true, 'P1-1 resume: ok:true');
    eq(j2.executed, true, 'P1-1 resume: executed:true');
    eq(db.duplicatePayments.get('ch-p1-f2').status, 'refunded', 'P1-1 resume: refunded');
    eq(refundCalls().length, 2, 'P1-1 resume: failed call + successful retry (no double success)');
  }

  // === P1-1: mark-путь дубликата + авторизация + not-found ===
  {
    const db = makeD1();
    const env = { ...baseEnv, PAYMENTS_DB: db, ADMIN_TOKEN };
    await seedOrder(db, 'nonce-p1-dup-4', USER_ID, RNA_ID, 35, { skuVersion: 4, grantRna: 500, grantBoosterDays: 0 });
    await post(handler, '/api/webhook', paymentBody('ch-p1-m1', 'nonce-p1-dup-4'), env, secretHeader());
    await post(handler, '/api/webhook', paymentBody('ch-p1-m2', 'nonce-p1-dup-4'), env, secretHeader());

    const noAuth = await post(
      handler, '/api/admin/refund',
      { chargeId: 'ch-p1-m2', reason: 'x', execute: true }, env
    );
    eq(noAuth.status, 401, 'P1-1: duplicate refund without ADMIN_TOKEN → 401');

    const notFound = await post(
      handler, '/api/admin/refund',
      { chargeId: 'ch-p1-nope', reason: 'x', execute: true }, env, adminHeader()
    );
    eq((await notFound.json()).error, 'not-found', 'P1-1: unknown charge → not-found');

    botCalls.length = 0;
    const r = await post(
      handler, '/api/admin/refund',
      { chargeId: 'ch-p1-m2', reason: 'manual via BotFather', confirmExternalRefund: true, operationId: 'op-p1-mark-1' },
      env, adminHeader()
    );
    const j = await r.json();
    eq(j.ok, true, 'P1-1 mark: ok:true');
    eq(j.executed, false, 'P1-1 mark: executed:false');
    eq(refundCalls().length, 0, 'P1-1 mark: no Telegram call');
    eq(db.duplicatePayments.get('ch-p1-m2').status, 'refunded', 'P1-1 mark: duplicate refunded');
    eq(db.wallets.get(USER_ID).purchased_rna, 500, 'P1-1 mark: original grant untouched');

    const noConfirm = await post(
      handler, '/api/admin/refund',
      { chargeId: 'ch-p1-m1', reason: 'x' }, env, adminHeader()
    );
    eq((await noConfirm.json()).error, 'confirm-required', 'P1-1 mark: confirm still required');
  }

  // === P1-2: активный пропуск → invoice 409; обычный товар не затронут ===
  {
    const db = makeD1();
    const env = { ...baseEnv, PAYMENTS_DB: db };
    await buyPass(handler, db, env, 'nonce-p1-p2-1', 'ch-p1-p2-1');
    const r = await post(handler, '/api/invoice', { initData, productId: PASS_ID, nonce: 'nonce-p1-p2-2' }, env);
    eq(r.status, 409, 'P1-2: invoice while pass active → 409');
    eq((await r.json()).error, 'subscription-active', 'P1-2: 409 error code subscription-active');
    assert(!db.orders.has('nonce-p1-p2-2'), 'P1-2: no order written for rejected invoice');
    const rna = await post(handler, '/api/invoice', { initData, productId: RNA_ID, nonce: 'nonce-p1-p2-3' }, env);
    eq(rna.status, 200, 'P1-2: non-subscription invoice unaffected by active pass');
  }

  // === P1-2: один pending subscription order; протухший не блокирует ===
  {
    const db = makeD1();
    const env = { ...baseEnv, PAYMENTS_DB: db };
    // Протухший pending (>24ч) — не блокирует.
    await seedOrder(db, 'nonce-p1-p2-stale', USER_ID, PASS_ID, 250, {
      skuVersion: 4, grantRna: 0, grantBoosterDays: 0, grantSeasonPassDays: 30,
      createdAt: Date.now() - 25 * 3600 * 1000,
    });
    const first = await post(handler, '/api/invoice', { initData, productId: PASS_ID, nonce: 'nonce-p1-p2-fresh' }, env);
    eq(first.status, 200, 'P1-2: stale pending subscription order does not block');
    // Свежий pending — блокирует второй инвойс.
    const second = await post(handler, '/api/invoice', { initData, productId: PASS_ID, nonce: 'nonce-p1-p2-fresh-2' }, env);
    eq(second.status, 409, 'P1-2: second pending subscription invoice → 409');
    eq((await second.json()).error, 'subscription-pending', 'P1-2: 409 error code subscription-pending');
    // Другой пользователь не затронут.
    const alien = await post(handler, '/api/invoice', { initData: otherInitData, productId: PASS_ID, nonce: 'nonce-p1-p2-alien' }, env);
    eq(alien.status, 200, 'P1-2: pending check is per-user');
  }

  // === P1-2: оплата второго инвойса при активном пропуске → без гранта ===
  {
    const db = makeD1();
    const env = { ...baseEnv, PAYMENTS_DB: db, ADMIN_TOKEN };
    // Два pending-инвойса созданы до оплаты первого (гонка / pre-fix
    // состояние — напрямую сидим заказы, invoice-гейт их бы не создал).
    await seedOrder(db, 'nonce-p1-p2-a', USER_ID, PASS_ID, 250, { skuVersion: 4, grantRna: 0, grantBoosterDays: 0, grantSeasonPassDays: 30 });
    await seedOrder(db, 'nonce-p1-p2-b', USER_ID, PASS_ID, 250, { skuVersion: 4, grantRna: 0, grantBoosterDays: 0, grantSeasonPassDays: 30 });
    await post(handler, '/api/webhook', paymentBody('ch-p1-p2-a', 'nonce-p1-p2-a', { amount: 250 }), env, secretHeader());
    const until1 = db.wallets.get(USER_ID).season_pass_until_ms;
    assert(until1 > Date.now(), 'P1-2 webhook: first pass granted');

    const lines = [];
    const origLog = console.log;
    console.log = (...args) => void lines.push(args.join(' '));
    let r2;
    try {
      r2 = await post(handler, '/api/webhook', paymentBody('ch-p1-p2-b', 'nonce-p1-p2-b', { amount: 250 }), env, secretHeader());
    } finally {
      console.log = origLog;
    }
    eq(r2.status, 200, 'P1-2 webhook: second payment → 200 (no retry needed)');
    eq(db.wallets.get(USER_ID).season_pass_until_ms, until1, 'P1-2 webhook: no second grant (no stacking)');
    assert(!db.payments.has('ch-p1-p2-b'), 'P1-2 webhook: denied payment NOT in payments');
    const dup = db.duplicatePayments.get('ch-p1-p2-b');
    assert(dup, 'P1-2 webhook: denied payment in duplicate_payments');
    eq(dup.reason, 'subscription_active', 'P1-2 webhook: duplicate reason subscription_active');
    eq(db.orders.get('nonce-p1-p2-b').status, 'denied', 'P1-2 webhook: second order denied');
    assert(lines.some((l) => l.includes('stars_payment_subscription_active_denied')), 'P1-2 webhook: loud log on denial');
    // Отклонённый платёж можно вернуть через P1-1.
    botCalls.length = 0;
    const rr = await post(
      handler, '/api/admin/refund',
      { chargeId: 'ch-p1-p2-b', reason: 'denied second sub', execute: true, operationId: 'op-p1-p2-ref' },
      env, adminHeader()
    );
    eq((await rr.json()).ok, true, 'P1-2 webhook: denied payment refundable via P1-1');
    eq(db.duplicatePayments.get('ch-p1-p2-b').status, 'refunded', 'P1-2 webhook: denied payment refunded');
    eq(db.wallets.get(USER_ID).season_pass_until_ms, until1, 'P1-2 webhook: refund of denied payment does not touch pass');
  }

  // === P1-2: продление работает; продление отклонённой подписки — нет ===
  {
    const db = makeD1();
    const env = { ...baseEnv, PAYMENTS_DB: db };
    const until0 = await buyPass(handler, db, env, 'nonce-p1-p2-r1', 'ch-p1-p2-r1');
    const rr = await post(
      handler, '/api/webhook',
      paymentBody('ch-p1-p2-r1-ren', 'nonce-p1-p2-r1', { amount: 250, isRecurring: true, isFirstRecurring: false }),
      env, secretHeader()
    );
    eq(rr.status, 200, 'P1-2 renewal: webhook 200');
    const until1 = db.wallets.get(USER_ID).season_pass_until_ms;
    assert(until1 >= until0 + 30 * DAY_MS - 1000, 'P1-2 renewal: extends active pass (+30d)');

    // Отклонённая подписка: заказ denied → её продление гранта не даёт.
    await seedOrder(db, 'nonce-p1-p2-r2', USER_ID, PASS_ID, 250, { skuVersion: 4, grantRna: 0, grantBoosterDays: 0, grantSeasonPassDays: 30 });
    await post(handler, '/api/webhook', paymentBody('ch-p1-p2-r2', 'nonce-p1-p2-r2', { amount: 250 }), env, secretHeader());
    eq(db.orders.get('nonce-p1-p2-r2').status, 'denied', 'P1-2 denied renewal: order denied');
    const before = db.wallets.get(USER_ID).season_pass_until_ms;
    const rren = await post(
      handler, '/api/webhook',
      paymentBody('ch-p1-p2-r2-ren', 'nonce-p1-p2-r2', { amount: 250, isRecurring: true, isFirstRecurring: false }),
      env, secretHeader()
    );
    eq(rren.status, 200, 'P1-2 denied renewal: webhook 200');
    eq(db.wallets.get(USER_ID).season_pass_until_ms, before, 'P1-2 denied renewal: no grant');
    assert(db.duplicatePayments.has('ch-p1-p2-r2-ren'), 'P1-2 denied renewal: renewal charge in duplicate_payments (refundable)');
  }

  // === P1-2: после истечения покупка снова разрешена ===
  {
    const db = makeD1();
    const env = { ...baseEnv, PAYMENTS_DB: db };
    await buyPass(handler, db, env, 'nonce-p1-p2-e1', 'ch-p1-p2-e1');
    // Пропуск истёк (подкручиваем кошелёк в прошлое).
    db.wallets.get(USER_ID).season_pass_until_ms = Date.now() - 1000;
    const r = await post(handler, '/api/invoice', { initData, productId: PASS_ID, nonce: 'nonce-p1-p2-e2' }, env);
    eq(r.status, 200, 'P1-2 expiry: invoice allowed after pass expired');
  }

  // === P1-2: pre_checkout отклоняет второй инвойс при активном пропуске ===
  {
    const db = makeD1();
    const env = { ...baseEnv, PAYMENTS_DB: db };
    await seedOrder(db, 'nonce-p1-p2-pc1', USER_ID, PASS_ID, 250, { skuVersion: 4, grantRna: 0, grantBoosterDays: 0, grantSeasonPassDays: 30 });
    botCalls.length = 0;
    await post(handler, '/api/webhook', preCheckoutBody('q-p1-pc1', 'nonce-p1-p2-pc1', { amount: 250 }), env, secretHeader());
    const a1 = botCalls.find((c) => c.method === 'answerPreCheckoutQuery' && c.body.pre_checkout_query_id === 'q-p1-pc1');
    eq(a1.body.ok, true, 'P1-2 pre_checkout: first invoice ok:true (no active pass)');
    await post(handler, '/api/webhook', paymentBody('ch-p1-p2-pc1', 'nonce-p1-p2-pc1', { amount: 250 }), env, secretHeader());
    await seedOrder(db, 'nonce-p1-p2-pc2', USER_ID, PASS_ID, 250, { skuVersion: 4, grantRna: 0, grantBoosterDays: 0, grantSeasonPassDays: 30 });
    botCalls.length = 0;
    await post(handler, '/api/webhook', preCheckoutBody('q-p1-pc2', 'nonce-p1-p2-pc2', { amount: 250 }), env, secretHeader());
    const a2 = botCalls.find((c) => c.method === 'answerPreCheckoutQuery' && c.body.pre_checkout_query_id === 'q-p1-pc2');
    eq(a2.body.ok, false, 'P1-2 pre_checkout: second invoice ok:false while pass active');
  }

  // === P2-1: бандл с двумя однотипными компонентами — fail-closed ===
  {
    const db = makeD1();
    const env = { ...baseEnv, PAYMENTS_DB: db };
    const dupBundle = JSON.stringify([
      { kind: 'rna', rna: 500 },
      { kind: 'rna', rna: 1000 },
    ]);
    await seedOrder(db, 'nonce-p1-p21', USER_ID, 'bundle.test-dup-rna', 150, {
      skuVersion: 4, grantRna: 0, grantBoosterDays: 0, grantBundleJson: dupBundle,
    });
    const r = await post(handler, '/api/webhook', paymentBody('ch-p1-p21', 'nonce-p1-p21', { amount: 150 }), env, secretHeader());
    eq(r.status, 200, 'P2-1: duplicate-component bundle webhook 200');
    // Fail-closed: платёж записан как paid (unknown-product путь), гранта нет —
    // лучше ручное разрешение, чем молчаливая потеря 1000 РНК.
    eq(db.payments.get('ch-p1-p21').status, 'paid', 'P2-1: payment recorded paid (manual resolution)');
    eq([...db.ledger.values()].filter((x) => x.charge_id === 'ch-p1-p21').length, 0, 'P2-1: no grant rows for ambiguous bundle');
    eq(db.wallets.get(USER_ID)?.purchased_rna ?? 0, 0, 'P2-1: wallet untouched (no partial 500 grant)');

    // Self-test каталога: у всех бандлов компоненты уникальны по (kind, skinId).
    for (const [id, g] of Object.entries(grants.SERVER_GRANTS)) {
      if (!g.bundle) continue;
      const seen = new Set();
      for (const c of g.bundle) {
        const key = `${c.kind}:${c.kind === 'skin' ? c.skinId : ''}`;
        assert(!seen.has(key), `P2-1 catalog self-test: bundle ${id} has duplicate component ${key}`);
        seen.add(key);
      }
    }
    // grantsForProduct fail-closed на дубликате (временная мутация каталога).
    grants.SERVER_GRANTS['bundle.test-dup-tmp'] = {
      title: 'tmp', description: 'tmp', stars: 1, rna: 0, boosterDays: 0, skinId: null, seasonPassDays: 0,
      bundle: [
        { kind: 'rna', rna: 100 },
        { kind: 'rna', rna: 200 },
      ],
    };
    try {
      eq(grants.grantsForProduct('bundle.test-dup-tmp'), null, 'P2-1: grantsForProduct → null on duplicate components');
    } finally {
      delete grants.SERVER_GRANTS['bundle.test-dup-tmp'];
    }
    // Контроль: нормальный бандл по-прежнему резолвится.
    eq(grants.grantsForProduct('bundle.starter-pack').length, 3, 'P2-1: starter pack still resolves to 3 grants');
  }

  // === P2-2: возврат пропуска — флаг + опциональная отмена подписки ===
  {
    const db = makeD1();
    const env = adminEnv(db);
    await buyPass(handler, db, env, 'nonce-p1-p22-1', 'ch-p1-p22-1');
    botCalls.length = 0;
    const r = await post(
      handler, '/api/admin/refund',
      { chargeId: 'ch-p1-p22-1', reason: 'test', execute: true, operationId: 'op-p1-p22-1' },
      env, adminHeader()
    );
    const j = await r.json();
    eq(j.ok, true, 'P2-2: pass refund ok:true');
    eq(j.subscriptionStillActive, true, 'P2-2: refund response flags subscriptionStillActive');
    assert(typeof j.hint === 'string' && j.hint.includes('/api/admin/subscription'), 'P2-2: hint points at /api/admin/subscription');
    eq(editCalls().length, 0, 'P2-2: no editUserStarSubscription without cancelSubscription:true');

    // С cancelSubscription:true — отмена в том же флоу + аудит (P2-3).
    await buyPass(handler, db, env, 'nonce-p1-p22-2', 'ch-p1-p22-2');
    botCalls.length = 0;
    const eventsBefore = db.subscriptionEvents.length;
    const r2 = await post(
      handler, '/api/admin/refund',
      { chargeId: 'ch-p1-p22-2', reason: 'test', execute: true, operationId: 'op-p1-p22-2', cancelSubscription: true },
      env, adminHeader()
    );
    const j2 = await r2.json();
    eq(j2.ok, true, 'P2-2 cancel: refund ok:true');
    eq(editCalls().length, 1, 'P2-2 cancel: editUserStarSubscription called');
    eq(editCalls()[0].body.telegram_payment_charge_id, 'ch-p1-p22-2', 'P2-2 cancel: edit targets refunded charge');
    eq(editCalls()[0].body.is_canceled, true, 'P2-2 cancel: is_canceled=true');
    eq(db.subscriptionEvents.length, eventsBefore + 1, 'P2-3: admin cancel writes audit row');
    eq(db.subscriptionEvents[db.subscriptionEvents.length - 1].source, 'admin', 'P2-3: audit source=admin');
    eq(db.subscriptionEvents[db.subscriptionEvents.length - 1].state, 'canceled', 'P2-3: audit state=canceled');

    // Возврат не-подписки — без флага.
    await seedOrder(db, 'nonce-p1-p22-3', USER_ID, RNA_ID, 35, { skuVersion: 4, grantRna: 500, grantBoosterDays: 0 });
    await post(handler, '/api/webhook', paymentBody('ch-p1-p22-3', 'nonce-p1-p22-3'), env, secretHeader());
    const r3 = await post(
      handler, '/api/admin/refund',
      { chargeId: 'ch-p1-p22-3', reason: 'test', execute: true, operationId: 'op-p1-p22-3' },
      env, adminHeader()
    );
    const j3 = await r3.json();
    eq(j3.ok, true, 'P2-2 non-sub: refund ok:true');
    assert(!('subscriptionStillActive' in j3), 'P2-2 non-sub: no subscription flag for RNA pack');
  }

  // === P2-3: /api/admin/subscription пишет аудит (и резолвит дубликаты) ===
  {
    const db = makeD1();
    const env = adminEnv(db);
    await buyPass(handler, db, env, 'nonce-p1-p23-1', 'ch-p1-p23-1');
    const before = db.subscriptionEvents.length;
    const r = await post(handler, '/api/admin/subscription', { chargeId: 'ch-p1-p23-1', isCanceled: true }, env, adminHeader());
    eq((await r.json()).ok, true, 'P2-3: admin subscription edit ok:true');
    eq(db.subscriptionEvents.length, before + 1, 'P2-3: admin edit writes subscription_events row');
    const ev = db.subscriptionEvents[db.subscriptionEvents.length - 1];
    eq(ev.source, 'admin', 'P2-3: audit source=admin');
    eq(ev.state, 'canceled', 'P2-3: audit state=canceled');
    eq(ev.charge_id, 'ch-p1-p23-1', 'P2-3: audit charge_id');
    eq(ev.nonce, 'nonce-p1-p23-1', 'P2-3: audit nonce from payment');

    // Отклонённая вторая подписка (только в duplicate_payments) — отмена
    // тоже должна резолвиться (иначе админ не может остановить списания).
    await seedOrder(db, 'nonce-p1-p23-2', USER_ID, PASS_ID, 250, { skuVersion: 4, grantRna: 0, grantBoosterDays: 0, grantSeasonPassDays: 30 });
    await post(handler, '/api/webhook', paymentBody('ch-p1-p23-2', 'nonce-p1-p23-2', { amount: 250 }), env, secretHeader());
    assert(db.duplicatePayments.has('ch-p1-p23-2'), 'P2-3 dup: second payment denied to duplicates');
    botCalls.length = 0;
    const r2 = await post(handler, '/api/admin/subscription', { chargeId: 'ch-p1-p23-2', isCanceled: true }, env, adminHeader());
    eq((await r2.json()).ok, true, 'P2-3 dup: admin subscription edit resolves duplicate charge');
    eq(editCalls().length, 1, 'P2-3 dup: editUserStarSubscription called for duplicate charge');
  }

  // === P2-5: идемпотентный повтор /api/invoice ===
  {
    const db = makeD1();
    const env = { ...baseEnv, PAYMENTS_DB: db };
    botCalls.length = 0;
    const first = await post(handler, '/api/invoice', { initData, productId: RNA_ID, nonce: 'nonce-p1-p25-1' }, env);
    eq(first.status, 200, 'P2-5: first invoice 200');
    const firstJ = await first.json();
    assert(firstJ.invoiceUrl, 'P2-5: first invoice has URL');
    const createCalls1 = botCalls.filter((c) => c.method === 'createInvoiceLink').length;
    eq(createCalls1, 1, 'P2-5: one createInvoiceLink');
    // Ретрай с тем же nonce (ответ потерян) — 200 с новым URL, заказ один.
    const retry = await post(handler, '/api/invoice', { initData, productId: RNA_ID, nonce: 'nonce-p1-p25-1' }, env);
    eq(retry.status, 200, 'P2-5: retry same nonce → 200 (was eternal 502)');
    const retryJ = await retry.json();
    assert(retryJ.invoiceUrl, 'P2-5: retry returns invoice URL');
    eq(retryJ.nonce, 'nonce-p1-p25-1', 'P2-5: retry echoes nonce');
    eq(botCalls.filter((c) => c.method === 'createInvoiceLink').length, 2, 'P2-5: createInvoiceLink re-issued on retry');
    eq(db.orders.size, 1, 'P2-5: still one order');
    // Чужой пользователь с тем же nonce — 502 (не раскрываем чужой заказ).
    const alien = await post(handler, '/api/invoice', { initData: otherInitData, productId: RNA_ID, nonce: 'nonce-p1-p25-1' }, env);
    eq(alien.status, 502, 'P2-5: retry by another user → 502');
    eq((await alien.json()).error, 'order-store-failed', 'P2-5: alien retry error code');
    // Другой товар с тем же nonce — 502.
    const otherProduct = await post(handler, '/api/invoice', { initData, productId: 'currency.rna-pack-m', nonce: 'nonce-p1-p25-1' }, env);
    eq(otherProduct.status, 502, 'P2-5: retry with different product → 502');
    // После оплаты ретрай — 502 (заказ уже не pending).
    await post(handler, '/api/webhook', paymentBody('ch-p1-p25-1', 'nonce-p1-p25-1'), env, secretHeader());
    eq(db.orders.get('nonce-p1-p25-1').status, 'paid', 'P2-5: order paid');
    const afterPaid = await post(handler, '/api/invoice', { initData, productId: RNA_ID, nonce: 'nonce-p1-p25-1' }, env);
    eq(afterPaid.status, 502, 'P2-5: retry after payment → 502');
  }

  // === P2-6: падение Bot API на pre-checkout → 503 ===
  {
    const db = makeD1();
    const env = { ...baseEnv, PAYMENTS_DB: db };
    await seedOrder(db, 'nonce-p1-p26-1', USER_ID, RNA_ID, 35, { skuVersion: 4, grantRna: 500, grantBoosterDays: 0 });
    // Контроль: успех — 200.
    botCalls.length = 0;
    const okRes = await post(handler, '/api/webhook', preCheckoutBody('q-p1-p26-ok', 'nonce-p1-p26-1'), env, secretHeader());
    eq(okRes.status, 200, 'P2-6: pre_checkout success → 200');
    const okCall = botCalls.find((c) => c.method === 'answerPreCheckoutQuery' && c.body.pre_checkout_query_id === 'q-p1-p26-ok');
    eq(okCall.body.ok, true, 'P2-6: pre_checkout success answers ok:true');
    // Падение answerPreCheckoutQuery — 503, не throw/500.
    botFail.preCheckout = true;
    let r;
    try {
      r = await post(handler, '/api/webhook', preCheckoutBody('q-p1-p26-fail', 'nonce-p1-p26-1'), env, secretHeader());
    } catch (e) {
      assert(false, `P2-6: pre_checkout Bot API failure must return 503, not throw (got: ${e.message})`);
    } finally {
      botFail.preCheckout = false;
    }
    eq(r.status, 503, 'P2-6: pre_checkout Bot API failure → 503');
    eq((await r.json()).error, 'pre-checkout-failed', 'P2-6: 503 error code pre-checkout-failed');
  }

  // === P1-3 (в): read-back после грант-батча ===
  {
    // Нормальный платёж — mismatch-лога нет (guard от ложных срабатываний).
    const db = makeD1();
    const env = { ...baseEnv, PAYMENTS_DB: db };
    await seedOrder(db, 'nonce-p1-rb-1', USER_ID, RNA_ID, 35, { skuVersion: 4, grantRna: 500, grantBoosterDays: 0 });
    const lines = [];
    const origLog = console.log;
    console.log = (...args) => void lines.push(args.join(' '));
    try {
      await post(handler, '/api/webhook', paymentBody('ch-p1-rb-1', 'nonce-p1-rb-1'), env, secretHeader());
    } finally {
      console.log = origLog;
    }
    eq(db.wallets.get(USER_ID).purchased_rna, 500, 'P1-3 read-back: grant applied');
    assert(!lines.some((l) => l.includes('stars_grant_readback_mismatch')), 'P1-3 read-back: no false mismatch on healthy grant');

    // Отключённый триггер: платёж записан, кошелёк пуст — громкий лог, 200.
    const db2 = makeD1();
    db2.hooks.disableTrigger = true;
    const env2 = { ...baseEnv, PAYMENTS_DB: db2 };
    await seedOrder(db2, 'nonce-p1-rb-2', USER_ID, RNA_ID, 35, { skuVersion: 4, grantRna: 500, grantBoosterDays: 0 });
    const lines2 = [];
    console.log = (...args) => void lines2.push(args.join(' '));
    let r2;
    try {
      r2 = await post(handler, '/api/webhook', paymentBody('ch-p1-rb-2', 'nonce-p1-rb-2'), env2, secretHeader());
    } finally {
      console.log = origLog;
    }
    eq(r2.status, 200, 'P1-3 read-back: webhook still 200 with missing trigger (detection, not breakage)');
    eq(db2.payments.get('ch-p1-rb-2').status, 'paid', 'P1-3 read-back: payment recorded');
    eq(db2.wallets.get(USER_ID)?.purchased_rna ?? 0, 0, 'P1-3 read-back: wallet empty without trigger');
    assert(lines2.some((l) => l.includes('stars_grant_readback_mismatch')), 'P1-3 read-back: loud mismatch log when trigger missing');
  }

  console.log('worker-p1: all assertions passed');
} finally {
  globalThis.fetch = realFetch;
  rmSync(temp, { recursive: true, force: true });
}
