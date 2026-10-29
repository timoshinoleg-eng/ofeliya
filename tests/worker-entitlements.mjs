/**
 * Worker entitlements v2 — журнал платежей и POST /api/verify + /api/entitlements
 * (протокол v2, патч №12; заменяет схему №11: charge:/user:products).
 *
 * Covers:
 * - webhook successful_payment (invoice_payload = raw nonce) → идемпотентная
 *   KV-запись pay:{charge_id} + nonce:{nonce} + user:{id}:journal;
 * - повторный вебхук того же charge_id не дублирует журнал;
 * - unknown order / user mismatch / amount mismatch / invalid → 200 без записи;
 * - pre_checkout: nonce → order → сверка цены (ok:true/false в Bot API);
 *   без KV → ok:true (деградация); невалидный nonce → ok:false;
 * - POST /api/verify → {verified, chargeId, productId} / not_found / mismatch;
 * - POST /api/entitlements → {purchases:[...]} в порядке журнала,
 *   битые pay-записи пропускаются; чужой пользователь → [];
 * - без KV-биндинга → 501 {error:'kv_unavailable'};
 * - плохая initData → 401; плохой nonce → 400;
 * - WEBHOOK_SECRET fail-closed: нет в env → 401, неверный заголовок → 403;
 * - вебхук без KV не падает (только лог, как раньше).
 *
 * Подпись initData считается НЕЗАВИСИМО от кода воркера (node:crypto
 * по схеме из документации Telegram), как в tests/worker-payments.mjs.
 * Компилирует worker/src/index.ts через tsc; KV — in-memory стаб.
 * Никакого реального Cloudflare/KV здесь нет — только код воркера.
 */
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-worker-ent-'));
writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'commonjs' }));
const require = createRequire(import.meta.url);

const assert = (condition, message) => {
  if (!condition) throw new Error(`worker-entitlements: ${message}`);
};
const eq = (actual, expected, message) =>
  assert(actual === expected, `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

// Тестовый токен (фиктивный, только для подписи в этом тесте).
const BOT_TOKEN = 'test-bot-token-123456';

function signInitData(fields) {
  const keys = Object.keys(fields).sort();
  const dataCheckString = keys.map((k) => `${k}=${fields[k]}`).join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  return createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
}

function buildInitData(userId) {
  const fields = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'AAE-test-entitlements',
    user: JSON.stringify({ id: userId, first_name: 'Test' }),
  };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) params.set(k, v);
  params.set('hash', signInitData(fields));
  return params.toString();
}

/** In-memory KV-стаб с интерфейсом воркера (get/put, options игнорируются). */
function makeKv() {
  const map = new Map();
  return {
    map,
    async get(key) {
      return map.has(key) ? map.get(key) : null;
    },
    async put(key, value, _options) {
      map.set(key, value);
    },
  };
}

function webhookBody({ userId, nonce, chargeId, stars, currency = 'XTR' }) {
  return {
    message: {
      from: { id: userId },
      successful_payment: {
        currency,
        total_amount: stars,
        invoice_payload: nonce,
        telegram_payment_charge_id: chargeId,
        provider_payment_charge_id: chargeId ? `provider-${chargeId}` : undefined,
      },
    },
  };
}

function preCheckoutBody({ nonce, stars, currency = 'XTR' }) {
  return {
    pre_checkout_query: {
      id: 'q-1',
      invoice_payload: nonce,
      currency,
      total_amount: stars,
    },
  };
}

async function post(worker, env, path, body, headers = {}) {
  const res = await worker.fetch(
    new Request(`https://worker.test${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
    env
  );
  let json = null;
  try {
    json = await res.json();
  } catch {
    // не-JSON ответ (например, plain 401/403) — страховка
  }
  return { status: res.status, json };
}

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'worker/src/index.ts',
      '--target',
      'ES2021',
      '--module',
      'commonjs',
      '--moduleResolution',
      'node',
      '--outDir',
      temp,
      '--skipLibCheck',
      'true',
      '--esModuleInterop',
      'true',
    ],
    { stdio: 'pipe' }
  );

  const worker = require(join(temp, 'index.js')).default;
  const kv = makeKv();
  const SECRET = 'test-webhook-secret';
  const env = { TELEGRAM_BOT_TOKEN: BOT_TOKEN, WEBHOOK_SECRET: SECRET, PAYMENTS: kv };
  const hookHeaders = { 'x-telegram-bot-api-secret-token': SECRET };

  // Seed orders (как если бы /api/invoice их записал).
  await kv.put(
    'order:nonce-001',
    JSON.stringify({ userId: 777001, productId: 'skin.virulent-magenta', createdAt: Date.now() })
  );
  await kv.put(
    'order:nonce-002',
    JSON.stringify({ userId: 777001, productId: 'booster.rna-x2-7d', createdAt: Date.now() })
  );

  // --- webhook → KV-запись v2 ---
  const first = await post(
    worker,
    env,
    '/api/webhook',
    webhookBody({ userId: 777001, nonce: 'nonce-001', chargeId: 'charge-test-1', stars: 100 }),
    hookHeaders
  );
  eq(first.status, 200, 'webhook ok');
  const payRaw = await kv.get('pay:charge-test-1');
  assert(payRaw !== null, 'pay key written');
  const pay = JSON.parse(payRaw);
  eq(pay.productId, 'skin.virulent-magenta', 'pay stores product');
  eq(pay.userId, 777001, 'pay stores user');
  eq(pay.amount, 100, 'pay stores amount');
  eq(pay.currency, 'XTR', 'pay stores currency');
  eq(pay.status, 'paid', 'pay status paid');
  eq(pay.nonce, 'nonce-001', 'pay stores nonce');
  eq(await kv.get('nonce:nonce-001'), 'charge-test-1', 'nonce index written');
  eq(await kv.get('user:777001:journal'), JSON.stringify(['charge-test-1']), 'journal written');

  // --- повторный вебхук не дублирует ---
  await post(
    worker,
    env,
    '/api/webhook',
    webhookBody({ userId: 777001, nonce: 'nonce-001', chargeId: 'charge-test-1', stars: 100 }),
    hookHeaders
  );
  eq(await kv.get('user:777001:journal'), JSON.stringify(['charge-test-1']), 'duplicate webhook does not duplicate');

  // --- второй товар того же пользователя дописывается ---
  await post(
    worker,
    env,
    '/api/webhook',
    webhookBody({ userId: 777001, nonce: 'nonce-002', chargeId: 'charge-test-2', stars: 75 }),
    hookHeaders
  );
  eq(
    await kv.get('user:777001:journal'),
    JSON.stringify(['charge-test-1', 'charge-test-2']),
    'second charge appended to journal'
  );

  // --- негативные вебхуки: 200, но без записи ---
  const neg = [
    ['unknown order', webhookBody({ userId: 777001, nonce: 'nonce-unknown', chargeId: 'charge-neg-1', stars: 100 }), 'pay:charge-neg-1'],
    ['user mismatch', webhookBody({ userId: 555000, nonce: 'nonce-001', chargeId: 'charge-neg-2', stars: 100 }), 'pay:charge-neg-2'],
    ['amount mismatch', webhookBody({ userId: 777001, nonce: 'nonce-001', chargeId: 'charge-neg-3', stars: 50 }), 'pay:charge-neg-3'],
    ['invalid (no chargeId)', webhookBody({ userId: 777001, nonce: 'nonce-001', chargeId: undefined, stars: 100 }), 'pay:undefined'],
  ];
  for (const [label, body, key] of neg) {
    const res = await post(worker, env, '/api/webhook', body, hookHeaders);
    eq(res.status, 200, `negative webhook still 200 (${label})`);
    eq(await kv.get(key), null, `negative webhook writes nothing (${label})`);
  }
  eq(
    await kv.get('user:777001:journal'),
    JSON.stringify(['charge-test-1', 'charge-test-2']),
    'journal unchanged by negative webhooks'
  );

  // --- pre_checkout: сверка по order ---
  const realFetch = globalThis.fetch;
  const botCalls = [];
  globalThis.fetch = async (_url, init) => {
    botCalls.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ ok: true, result: true }) };
  };
  try {
    let res = await post(worker, env, '/api/webhook', preCheckoutBody({ nonce: 'nonce-001', stars: 100 }), hookHeaders);
    eq(res.status, 200, 'pre_checkout ok');
    eq(botCalls[botCalls.length - 1].ok, true, 'pre_checkout correct price → ok:true');
    res = await post(worker, env, '/api/webhook', preCheckoutBody({ nonce: 'nonce-001', stars: 50 }), hookHeaders);
    eq(botCalls[botCalls.length - 1].ok, false, 'pre_checkout wrong price → ok:false');
    res = await post(worker, env, '/api/webhook', preCheckoutBody({ nonce: 'x', stars: 100 }), hookHeaders);
    eq(botCalls[botCalls.length - 1].ok, false, 'pre_checkout invalid nonce → ok:false');
    // Без KV — деградация ok:true.
    res = await post(
      worker,
      { TELEGRAM_BOT_TOKEN: BOT_TOKEN, WEBHOOK_SECRET: SECRET },
      '/api/webhook',
      preCheckoutBody({ nonce: 'nonce-001', stars: 100 }),
      hookHeaders
    );
    eq(botCalls[botCalls.length - 1].ok, true, 'pre_checkout without KV → ok:true');
  } finally {
    globalThis.fetch = realFetch;
  }

  // --- /api/verify ---
  let v = await post(worker, env, '/api/verify', { initData: buildInitData(777001), nonce: 'nonce-001' });
  eq(v.status, 200, 'verify ok');
  eq(v.json.verified, true, 'verify true for recorded payment');
  eq(v.json.chargeId, 'charge-test-1', 'verify returns chargeId');
  eq(v.json.productId, 'skin.virulent-magenta', 'verify returns productId');
  v = await post(worker, env, '/api/verify', { initData: buildInitData(777001), nonce: 'nonce-missing' });
  eq(v.json.verified, false, 'verify false for unknown nonce');
  eq(v.json.reason, 'not_found', 'verify not_found reason');
  v = await post(worker, env, '/api/verify', { initData: buildInitData(555000), nonce: 'nonce-001' });
  eq(v.json.verified, false, 'verify false for other user');
  eq(v.json.reason, 'mismatch', 'verify mismatch reason');
  v = await post(worker, env, '/api/verify', { initData: buildInitData(777001), nonce: 'x' });
  eq(v.status, 400, 'verify bad nonce → 400');
  v = await post(worker, env, '/api/verify', { initData: 'garbage', nonce: 'nonce-001' });
  eq(v.status, 401, 'verify bad initData → 401');

  // --- /api/entitlements → {purchases} в порядке журнала ---
  // Битый pay-запис в журнале пропускается.
  await kv.put('user:777001:journal', JSON.stringify(['charge-test-1', 'charge-broken', 'charge-test-2']));
  await kv.put('pay:charge-broken', '{not json');
  const ent = await post(worker, env, '/api/entitlements', { initData: buildInitData(777001) });
  eq(ent.status, 200, 'entitlements ok');
  eq(ent.json.purchases.length, 2, 'broken pay record skipped');
  eq(ent.json.purchases[0].chargeId, 'charge-test-1', 'entitlements order 1');
  eq(ent.json.purchases[0].productId, 'skin.virulent-magenta', 'entitlements product 1');
  eq(ent.json.purchases[0].status, 'paid', 'entitlements status 1');
  assert(typeof ent.json.purchases[0].createdAt === 'number', 'entitlements createdAt 1');
  eq(ent.json.purchases[1].chargeId, 'charge-test-2', 'entitlements order 2');
  eq(ent.json.purchases[1].productId, 'booster.rna-x2-7d', 'entitlements product 2');

  // --- чужой пользователь — пустой журнал, не чужие товары ---
  const other = await post(worker, env, '/api/entitlements', { initData: buildInitData(555000) });
  eq(other.status, 200, 'entitlements ok for unknown user');
  eq(JSON.stringify(other.json.purchases), JSON.stringify([]), 'unknown user has no purchases');

  // --- без KV-биндинга → 501 ---
  const noKvEnv = { TELEGRAM_BOT_TOKEN: BOT_TOKEN, WEBHOOK_SECRET: SECRET };
  const noKvVerify = await post(worker, noKvEnv, '/api/verify', { initData: buildInitData(777001), nonce: 'nonce-001' });
  eq(noKvVerify.status, 501, 'verify without KV → 501');
  eq(noKvVerify.json.error, 'kv_unavailable', 'verify 501 error code');
  const noKvEnt = await post(worker, noKvEnv, '/api/entitlements', { initData: buildInitData(777001) });
  eq(noKvEnt.status, 501, 'entitlements without KV → 501');

  // --- плохая initData → 401 ---
  const bad = await post(worker, env, '/api/entitlements', { initData: 'garbage' });
  eq(bad.status, 401, 'bad initData → 401');

  // --- WEBHOOK_SECRET fail-closed ---
  const noSecret = await post(
    worker,
    { TELEGRAM_BOT_TOKEN: BOT_TOKEN, PAYMENTS: kv },
    '/api/webhook',
    webhookBody({ userId: 777001, nonce: 'nonce-001', chargeId: 'charge-neg-4', stars: 100 }),
    hookHeaders
  );
  eq(noSecret.status, 401, 'webhook without WEBHOOK_SECRET → 401 fail-closed');
  const wrongSecret = await post(
    worker,
    env,
    '/api/webhook',
    webhookBody({ userId: 777001, nonce: 'nonce-001', chargeId: 'charge-neg-5', stars: 100 }),
    { 'x-telegram-bot-api-secret-token': 'wrong' }
  );
  eq(wrongSecret.status, 403, 'webhook wrong secret → 403');
  const noHeader = await post(
    worker,
    env,
    '/api/webhook',
    webhookBody({ userId: 777001, nonce: 'nonce-001', chargeId: 'charge-neg-6', stars: 100 })
  );
  eq(noHeader.status, 403, 'webhook missing secret header → 403');

  // --- вебхук без KV не падает (только лог, как раньше) ---
  const noKvHook = await post(
    worker,
    { TELEGRAM_BOT_TOKEN: BOT_TOKEN, WEBHOOK_SECRET: SECRET },
    '/api/webhook',
    webhookBody({ userId: 777001, nonce: 'nonce-001', chargeId: 'charge-test-3', stars: 100 }),
    hookHeaders
  );
  eq(noKvHook.status, 200, 'webhook without KV still ok');

  console.log('worker-entitlements: OK');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
