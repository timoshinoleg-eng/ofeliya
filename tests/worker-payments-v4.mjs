/**
 * Worker payments v4 — патч №14 (четвёртый аудит).
 *
 * Covers:
 * - P0-2: webhook successful_payment при недоступной D1 → 503
 *   (fail-closed; раньше было 200 "log only" — оплата терялась).
 *   Telegram ретраит не-200 апдейты; батч идемпотентен.
 * - P0-2: webhook 200 на НЕВАЛИДНОМ платеже (плохой nonce) — ретрай
 *   не поможет, платёж невалиден.
 * - P0-3: /api/verify для status='refunded' → {verified:false, reason:'refunded'}.
 * - E-c: POST /api/admin/refund — 401 без/без верного ADMIN_TOKEN
 *   (fail-closed), 200 + смена статуса, идемпотентный повтор
 *   (патч №15: {ok:true, already:true}), verify после refund → refunded.
 * - E-a: unknown-product в webhook → 200 + запись 'paid' в журнале
 *   (не silent-skip), fulfilled НЕ ставится.
 *
 * Патч №15: стаб расширен серверным кошельком (wallets + wallet_ledger),
 * backstop nonce-reuse и двухшаговым refund (SELECT платежа/журнала,
 * откат кошелька).
 *
 * D1 — in-memory стаб (копия из worker-entitlements.mjs + кейс refunded).
 */
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { makeD1, seedOrder } from './d1-v16-stub.mjs';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-worker-v4-'));
writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'commonjs' }));
const require = createRequire(import.meta.url);

const assert = (condition, message) => {
  if (!condition) throw new Error(`worker-payments-v4: ${message}`);
};
const eq = (actual, expected, message) =>
  assert(actual === expected, `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

const BOT_TOKEN = '123456:TEST-BOT-TOKEN-aaaaaaaaaaaaaaaaaaaaaaaa';
const WEBHOOK_SECRET = 'test-webhook-secret-16+chars';
const ADMIN_TOKEN = 'test-admin-token-16+chars!!';
const USER_ID = 777003;

function signInitData(fields) {
  const keys = Object.keys(fields).sort();
  const dataCheckString = keys.map((k) => `${k}=${fields[k]}`).join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  return createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
}

function buildInitData(fields) {
  const hash = signInitData(fields);
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) params.set(k, v);
  params.set('hash', hash);
  return params.toString();
}

function paymentBody(chargeId, nonce, { productId = 'skin.virulent-magenta', userId = USER_ID, amount = 100, currency = 'XTR' } = {}) {
  return {
    message: {
      from: { id: userId },
      successful_payment: {
        currency,
        total_amount: amount,
        invoice_payload: nonce,
        telegram_payment_charge_id: chargeId,
        provider_payment_charge_id: 'prov-1',
      },
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

const secretHeader = () => ({ 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET });
const adminHeader = () => ({ authorization: `Bearer ${ADMIN_TOKEN}` });

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

  const now = Math.floor(Date.now() / 1000);
  const initData = buildInitData({
    auth_date: String(now),
    query_id: 'AAE-v4-test',
    user: JSON.stringify({ id: USER_ID, first_name: 'Test' }),
  });
  const baseEnv = { TELEGRAM_BOT_TOKEN: BOT_TOKEN };

  // --- P0-2: webhook 503 без D1-биндинга (fail-closed) ---
  {
    const env = { ...baseEnv, WEBHOOK_SECRET };
    const res = await post(handler, '/api/webhook', paymentBody('ch-v4-nodb', 'nonce-v4-nodb-1'), env, secretHeader());
    eq(res.status, 503, 'webhook → 503 without PAYMENTS_DB');
    eq((await res.json()).error, 'db_unavailable', 'db_unavailable code');
  }

  // --- P0-2: webhook 503 при сбое D1; 200 на невалидном платеже ---
  {
    const db = makeD1();
    const env = { ...baseEnv, WEBHOOK_SECRET, PAYMENTS_DB: db };
    await seedOrder(db, 'nonce-v4-fail-1', USER_ID, 'skin.virulent-magenta', 100);
    db._failNext = true; // инжекция сбоя записи
    const res = await post(handler, '/api/webhook', paymentBody('ch-v4-fail', 'nonce-v4-fail-1'), env, secretHeader());
    eq(res.status, 503, 'webhook → 503 on D1 write failure');
    eq(db.payments.has('ch-v4-fail'), false, 'failed write left no partial record');

    // Невалидный платёж (плохой nonce) — 200: ретрай не поможет.
    const bad = await post(handler, '/api/webhook', paymentBody('ch-v4-bad', 'bad nonce!!'), env, secretHeader());
    eq(bad.status, 200, 'invalid payment → 200 (no retry help)');
  }

  // --- E-a: unknown-product → 200 + запись 'paid' (не silent-skip) ---
  {
    const db = makeD1();
    const env = { ...baseEnv, WEBHOOK_SECRET, PAYMENTS_DB: db };
    // Заказ с товаром вне каталога (каталог сменился после создания инвойса).
    await seedOrder(db, 'nonce-v4-unknown-1', USER_ID, 'skin.removed-legacy', 50);
    const res = await post(
      handler, '/api/webhook',
      paymentBody('ch-v4-unknown', 'nonce-v4-unknown-1', { productId: 'skin.removed-legacy', amount: 50 }),
      env, secretHeader()
    );
    eq(res.status, 200, 'unknown product → 200');
    const pay = db.payments.get('ch-v4-unknown');
    assert(!!pay, 'unknown product recorded in journal');
    eq(pay.status, 'paid', 'unknown product stays paid (no fulfilled mark)');
    eq(pay.product_id, 'skin.removed-legacy', 'product id preserved for manual resolution');
  }

  // --- P0-3 + E-c: refunded исключён из verify; admin-эндпоинт ---
  {
    const db = makeD1();
    const envNoAdmin = { ...baseEnv, WEBHOOK_SECRET, PAYMENTS_DB: db };
    const env = { ...envNoAdmin, ADMIN_TOKEN };

    // 401: без токена / чужой токен / ADMIN_TOKEN не настроен.
    const r1 = await post(handler, '/api/admin/refund', { chargeId: 'x' }, envNoAdmin, adminHeader());
    eq(r1.status, 401, 'admin refund → 401 without ADMIN_TOKEN configured');
    const r2 = await post(handler, '/api/admin/refund', { chargeId: 'x' }, env, { authorization: 'Bearer wrong' });
    eq(r2.status, 401, 'admin refund → 401 on wrong token');
    const r3 = await post(handler, '/api/admin/refund', { chargeId: 'x' }, env);
    eq(r3.status, 401, 'admin refund → 401 without header');

    // Создаём оплаченный платёж через webhook.
    await seedOrder(db, 'nonce-v4-refund-1', USER_ID, 'skin.virulent-magenta', 100);
    const wh = await post(handler, '/api/webhook', paymentBody('ch-v4-refund', 'nonce-v4-refund-1'), env, secretHeader());
    eq(wh.status, 200, 'payment recorded');
    eq(db.payments.get('ch-v4-refund').status, 'paid', 'payment paid');

    // До refund: verify → true.
    const v1 = await post(handler, '/api/verify', { initData, nonce: 'nonce-v4-refund-1' }, env);
    eq((await v1.json()).verified, true, 'verify true before refund');

    // Refund через admin-эндпоинт.
    const rf = await post(handler, '/api/admin/refund', { chargeId: 'ch-v4-refund', reason: 'test', confirmExternalRefund: true, operationId: 'op-v4-1' }, env, adminHeader());
    eq(rf.status, 200, 'admin refund → 200');
    eq((await rf.json()).ok, true, 'admin refund ok:true');
    eq(db.payments.get('ch-v4-refund').status, 'refunded', 'status → refunded');

    // Идемпотентный повтор (патч №15, P1-4: однозначный {ok:true, already:true}).
    const rf2 = await post(handler, '/api/admin/refund', { chargeId: 'ch-v4-refund' }, env, adminHeader());
    const rf2j = await rf2.json();
    eq(rf2j.ok, true, 'repeat refund → ok:true');
    eq(rf2j.already, true, 'repeat refund → already:true');

    // P0-3: verify после refund → false/refunded.
    const v2 = await post(handler, '/api/verify', { initData, nonce: 'nonce-v4-refund-1' }, env);
    const v2j = await v2.json();
    eq(v2j.verified, false, 'verify refunded → false');
    eq(v2j.reason, 'refunded', 'verify refunded reason');
  }

  console.log('worker-payments-v4: all assertions passed');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
