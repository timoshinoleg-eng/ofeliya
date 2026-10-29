/**
 * Worker entitlements v3 — журнал платежей в Cloudflare D1
 * (протокол v3, патч №13; полностью заменяет схему №12 на KV).
 *
 * Covers:
 * - webhook successful_payment (invoice_payload = raw nonce) → ОДИН
 *   db.batch(): INSERT OR IGNORE INTO payments + UPDATE orders → 'paid';
 * - повторный вебхук того же charge_id: meta.changes==0 → duplicate, журнал
 *   не дублируется (атомарно, без гонки);
 * - batch failure → 503 {ok:false, error:'db_unavailable'} (патч №14, P0-2;
 *   Telegram redelivers; retry безопасен через OR IGNORE), повтор после
 *   починки записывает; webhook без D1 → тоже 503 fail-closed;
 * - negative webhooks: unknown order / user mismatch / amount mismatch /
 *   currency mismatch / invalid → 200 без записи;
 * - pre_checkout: nonce → order → сверка цены (ok:true/false в Bot API);
 *   без D1 → ok:false (fail-closed; деградация ok:true из №12 убрана);
 *   expired order → ok:false; патч №15 (P0-2): ok:true ТОЛЬКО при
 *   status='pending' И from.id == order.user_id (чужой/оплаченный — отказ);
 *   серверная выдача: successful_payment пишет кошелёк + журнал (wallets,
 *   wallet_ledger в стабе);
 * - POST /api/verify СТРОГО: order + payment + сверка
 *   (charge_id/userId/productId) → {verified, chargeId, productId} /
 *   pending (order есть, payment нет) / not_found / mismatch;
 * - POST /api/entitlements → {purchases:[...]} ORDER BY created_at ASC,
 *   статус passthrough paid/fulfilled/refunded, иначе 'paid'; поля
 *   products НЕТ (наследие v1 удалено);
 * - POST /api/ack: paid→fulfilled (только свой charge_id, только из
 *   'paid') → {ok:true/false}; повтор/ чужой/ плохой chargeId;
 * - без PAYMENTS_DB: webhook 503 fail-closed (патч №14), invoice 503
 *   db_unavailable, verify/entitlements/ack 501 db_unavailable;
 * - плохая initData → 401; плохой nonce → 400; WEBHOOK_SECRET fail-closed
 *   (нет в env → 401, неверный заголовок → 403).
 *
 * Подпись initData считается НЕЗАВИСИМО от кода воркера (node:crypto
 * по схеме из документации Telegram), как в tests/worker-payments.mjs.
 * Компилирует worker/src/index.ts через tsc; D1 — in-memory стаб
 * (prepare/bind/run/first/all/batch по точным SQL-строкам воркера).
 * Никакого реального Cloudflare/D1 здесь нет — только код воркера.
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

/**
 * In-memory D1-стаб. Узнаёт SQL по точным строкам воркера
 * (нормализация пробелов), иначе бросает — стаб не должен молча
 * проглатывать неизвестный запрос.
 */
function makeD1() {
  const orders = new Map(); // nonce → {user_id, product_id, status, created_at}
  const payments = new Map(); // charge_id → row
  // Патч №15: серверный кошелёк (wallets) + журнал грантов (wallet_ledger).
  const wallets = new Map(); // user_id → row
  const ledger = new Map(); // charge_id → row
  let failNext = false;
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const runSql = (sql, params) => {
    if (failNext) {
      failNext = false;
      throw new Error('d1 injected failure');
    }
    if (sql.startsWith('INSERT INTO orders')) {
      const [nonce, userId, productId, status, createdAt] = params;
      if (orders.has(nonce)) throw new Error('UNIQUE constraint failed: orders.nonce');
      orders.set(nonce, { user_id: userId, product_id: productId, status, created_at: createdAt });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('INSERT OR IGNORE INTO payments')) {
      const [chargeId, userId, productId, amount, currency, status, nonce, createdAt, fulfilledAt] =
        params;
      if (payments.has(chargeId)) return { meta: { changes: 0 } };
      payments.set(chargeId, {
        charge_id: chargeId,
        user_id: userId,
        product_id: productId,
        amount,
        currency,
        status,
        nonce,
        created_at: createdAt,
        fulfilled_at: fulfilledAt,
      });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("UPDATE orders SET status='paid'")) {
      const [nonce] = params;
      const o = orders.get(nonce);
      if (o && o.status === 'pending') {
        o.status = 'paid';
        return { meta: { changes: 1 } };
      }
      return { meta: { changes: 0 } };
    }
    // Патч №15: UPSERT кошелька (атомарная серверная выдача).
    if (sql.startsWith('INSERT INTO wallets')) {
      const [userId, purchasedRna, boosterUntilMs, skinsJson, updatedAt] = params;
      wallets.set(userId, {
        user_id: userId,
        purchased_rna: purchasedRna,
        booster_until_ms: boosterUntilMs,
        skins_json: skinsJson,
        updated_at: updatedAt,
      });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('INSERT OR IGNORE INTO wallet_ledger')) {
      const [userId, chargeId, kind, amountText, createdAt] = params;
      if (ledger.has(chargeId)) return { meta: { changes: 0 } };
      ledger.set(chargeId, { user_id: userId, charge_id: chargeId, kind, amount_text: amountText, created_at: createdAt });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("UPDATE payments SET status='fulfilled'")) {
      const [fulfilledAt, chargeId, userId] = params;
      const p = payments.get(chargeId);
      if (p && p.user_id === userId && p.status === 'paid') {
        p.status = 'fulfilled';
        p.fulfilled_at = fulfilledAt;
        return { meta: { changes: 1 } };
      }
      return { meta: { changes: 0 } };
    }
    throw new Error(`makeD1: unknown write SQL: ${sql}`);
  };
  const firstSql = (sql, params) => {
    if (failNext) {
      failNext = false;
      throw new Error('d1 injected failure');
    }
    if (sql === 'SELECT user_id, product_id, status FROM orders WHERE nonce=?') {
      return orders.get(params[0]) ?? null;
    }
    if (sql === 'SELECT charge_id, user_id, product_id, status, created_at FROM payments WHERE nonce=?') {
      for (const p of payments.values()) if (p.nonce === params[0]) return p;
      return null;
    }
    // Патч №15: backstop nonce-reuse, self-heal дубликатов, чтение кошелька.
    if (sql === 'SELECT charge_id FROM payments WHERE nonce=?') {
      for (const p of payments.values()) if (p.nonce === params[0]) return { charge_id: p.charge_id };
      return null;
    }
    if (sql === 'SELECT 1 AS one FROM wallet_ledger WHERE charge_id=?') {
      return ledger.has(params[0]) ? { one: 1 } : null;
    }
    if (sql === 'SELECT purchased_rna, booster_until_ms, skins_json FROM wallets WHERE user_id=?') {
      return wallets.get(params[0]) ?? null;
    }
    throw new Error(`makeD1: unknown first SQL: ${sql}`);
  };
  const allSql = (sql, params) => {
    if (failNext) {
      failNext = false;
      throw new Error('d1 injected failure');
    }
    if (
      sql ===
      'SELECT charge_id, product_id, status, created_at FROM payments WHERE user_id=? ORDER BY created_at ASC'
    ) {
      return {
        results: [...payments.values()]
          .filter((p) => p.user_id === params[0])
          .sort((a, b) => a.created_at - b.created_at),
      };
    }
    throw new Error(`makeD1: unknown all SQL: ${sql}`);
  };
  return {
    orders,
    payments,
    wallets,
    ledger,
    failNext: () => {
      failNext = true;
    },
    prepare(query) {
      const sql = norm(query);
      let params = [];
      return {
        bind(...args) {
          params = args;
          return this;
        },
        async run() {
          return runSql(sql, params);
        },
        async first() {
          return firstSql(sql, params);
        },
        async all() {
          return allSql(sql, params);
        },
      };
    },
    async batch(statements) {
      const results = [];
      for (const st of statements) results.push(await st.run());
      return results;
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

function preCheckoutBody({ nonce, stars, currency = 'XTR', userId = 777001 }) {
  return {
    pre_checkout_query: {
      id: 'q-1',
      invoice_payload: nonce,
      currency,
      total_amount: stars,
      // Патч №15 (P0-2): строгий pre_checkout требует from.id == order.user_id.
      from: { id: userId },
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
  const db = makeD1();
  const SECRET = 'test-webhook-secret';
  const env = { TELEGRAM_BOT_TOKEN: BOT_TOKEN, WEBHOOK_SECRET: SECRET, PAYMENTS_DB: db };
  const hookHeaders = { 'x-telegram-bot-api-secret-token': SECRET };

  // Seed orders (как если бы /api/invoice их записал: INSERT INTO orders).
  await db
    .prepare('INSERT INTO orders (nonce, user_id, product_id, status, created_at) VALUES (?,?,?,?,?)')
    .bind('nonce-001', 777001, 'skin.virulent-magenta', 'pending', Date.now())
    .run();
  await db
    .prepare('INSERT INTO orders (nonce, user_id, product_id, status, created_at) VALUES (?,?,?,?,?)')
    .bind('nonce-002', 777001, 'booster.rna-x2-7d', 'pending', Date.now())
    .run();

  // --- webhook → атомарный batch: payment + order → 'paid' ---
  const first = await post(
    worker,
    env,
    '/api/webhook',
    webhookBody({ userId: 777001, nonce: 'nonce-001', chargeId: 'charge-test-1', stars: 100 }),
    hookHeaders
  );
  eq(first.status, 200, 'webhook ok');
  const pay = db.payments.get('charge-test-1');
  assert(pay, 'payment row written');
  eq(pay.product_id, 'skin.virulent-magenta', 'payment stores product');
  eq(pay.user_id, 777001, 'payment stores user');
  eq(pay.amount, 100, 'payment stores amount');
  eq(pay.currency, 'XTR', 'payment stores currency');
  eq(pay.status, 'paid', 'payment status paid');
  eq(pay.nonce, 'nonce-001', 'payment stores nonce');
  eq(db.orders.get('nonce-001').status, 'paid', 'order moved to paid');

  // --- повторный вебхук не дублирует (OR IGNORE → changes 0) ---
  await post(
    worker,
    env,
    '/api/webhook',
    webhookBody({ userId: 777001, nonce: 'nonce-001', chargeId: 'charge-test-1', stars: 100 }),
    hookHeaders
  );
  eq(db.payments.size, 1, 'duplicate webhook does not duplicate payment');

  // --- второй товар того же пользователя ---
  await post(
    worker,
    env,
    '/api/webhook',
    webhookBody({ userId: 777001, nonce: 'nonce-002', chargeId: 'charge-test-2', stars: 75 }),
    hookHeaders
  );
  eq(db.payments.size, 2, 'second charge recorded');
  eq(db.orders.get('nonce-002').status, 'paid', 'second order paid');

  // --- batch failure → 503 {ok:false}, повтор после починки записывает (патч №14, P0-2) ---
  await db
    .prepare('INSERT INTO orders (nonce, user_id, product_id, status, created_at) VALUES (?,?,?,?,?)')
    .bind('nonce-003', 777001, 'currency.rna-pack-s', 'pending', Date.now())
    .run();
  db.failNext();
  const failed = await post(
    worker,
    env,
    '/api/webhook',
    webhookBody({ userId: 777001, nonce: 'nonce-003', chargeId: 'charge-test-3', stars: 35 }),
    hookHeaders
  );
  eq(failed.status, 503, 'batch failure → 503 (Telegram redelivers)');
  eq(failed.json.ok, false, 'batch failure body ok:false');
  eq(failed.json.error, 'db_unavailable', 'batch failure body error code');
  assert(!db.payments.has('charge-test-3'), 'failed batch writes nothing');
  eq(db.orders.get('nonce-003').status, 'pending', 'failed batch leaves order pending');
  const retried = await post(
    worker,
    env,
    '/api/webhook',
    webhookBody({ userId: 777001, nonce: 'nonce-003', chargeId: 'charge-test-3', stars: 35 }),
    hookHeaders
  );
  eq(retried.status, 200, 'retry after fix ok');
  assert(db.payments.has('charge-test-3'), 'retry records payment');

  // --- негативные вебхуки: 200, но без записи ---
  const neg = [
    ['unknown order', webhookBody({ userId: 777001, nonce: 'nonce-unknown', chargeId: 'charge-neg-1', stars: 100 }), 'charge-neg-1'],
    ['user mismatch', webhookBody({ userId: 555000, nonce: 'nonce-001', chargeId: 'charge-neg-2', stars: 100 }), 'charge-neg-2'],
    ['amount mismatch', webhookBody({ userId: 777001, nonce: 'nonce-001', chargeId: 'charge-neg-3', stars: 50 }), 'charge-neg-3'],
    ['currency mismatch', webhookBody({ userId: 777001, nonce: 'nonce-001', chargeId: 'charge-neg-4', stars: 100, currency: 'USD' }), 'charge-neg-4'],
    ['invalid (no chargeId)', webhookBody({ userId: 777001, nonce: 'nonce-001', chargeId: undefined, stars: 100 }), undefined],
  ];
  for (const [label, body, key] of neg) {
    const res = await post(worker, env, '/api/webhook', body, hookHeaders);
    eq(res.status, 200, `negative webhook still 200 (${label})`);
    if (key) assert(!db.payments.has(key), `negative webhook writes nothing (${label})`);
  }
  eq(db.payments.size, 3, 'payments unchanged by negative webhooks');

  // --- pre_checkout: сверка по order ---
  const realFetch = globalThis.fetch;
  const botCalls = [];
  globalThis.fetch = async (_url, init) => {
    botCalls.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ ok: true, result: true }) };
  };
  try {
    // Патч №15: ok:true — только для pending-заказа. nonce-001 к этому
    // моменту уже оплачен вебхуками выше, поэтому сеем свежий pending.
    await db
      .prepare('INSERT INTO orders (nonce, user_id, product_id, status, created_at) VALUES (?,?,?,?,?)')
      .bind('nonce-pc-ok', 777001, 'skin.virulent-magenta', 'pending', Date.now())
      .run();
    let res = await post(worker, env, '/api/webhook', preCheckoutBody({ nonce: 'nonce-pc-ok', stars: 100 }), hookHeaders);
    eq(res.status, 200, 'pre_checkout ok');
    eq(botCalls[botCalls.length - 1].ok, true, 'pre_checkout correct price → ok:true');
    res = await post(worker, env, '/api/webhook', preCheckoutBody({ nonce: 'nonce-pc-ok', stars: 50 }), hookHeaders);
    eq(botCalls[botCalls.length - 1].ok, false, 'pre_checkout wrong price → ok:false');
    res = await post(worker, env, '/api/webhook', preCheckoutBody({ nonce: 'x', stars: 100 }), hookHeaders);
    eq(botCalls[botCalls.length - 1].ok, false, 'pre_checkout invalid nonce → ok:false');
    // Без D1 — fail-closed ok:false (деградация ok:true из №12 убрана).
    res = await post(
      worker,
      { TELEGRAM_BOT_TOKEN: BOT_TOKEN, WEBHOOK_SECRET: SECRET },
      '/api/webhook',
      preCheckoutBody({ nonce: 'nonce-001', stars: 100 }),
      hookHeaders
    );
    eq(botCalls[botCalls.length - 1].ok, false, 'pre_checkout without DB → ok:false fail-closed');
    // Expired order → ok:false.
    await db
      .prepare('INSERT INTO orders (nonce, user_id, product_id, status, created_at) VALUES (?,?,?,?,?)')
      .bind('nonce-exp', 777001, 'currency.rna-pack-s', 'expired', Date.now())
      .run();
    res = await post(worker, env, '/api/webhook', preCheckoutBody({ nonce: 'nonce-exp', stars: 35 }), hookHeaders);
    eq(botCalls[botCalls.length - 1].ok, false, 'pre_checkout expired order → ok:false');
    // Патч №15 (P0-2): чужой from.id → ok:false (нельзя оплатить чужой инвойс).
    await db
      .prepare('INSERT INTO orders (nonce, user_id, product_id, status, created_at) VALUES (?,?,?,?,?)')
      .bind('nonce-pc-alien', 777001, 'skin.virulent-magenta', 'pending', Date.now())
      .run();
    res = await post(
      worker,
      env,
      '/api/webhook',
      preCheckoutBody({ nonce: 'nonce-pc-alien', stars: 100, userId: 777001 + 999 }),
      hookHeaders
    );
    eq(botCalls[botCalls.length - 1].ok, false, 'pre_checkout ok=false on user mismatch');
    // Патч №15 (P0-2): уже оплаченный заказ (status='paid') → ok:false
    // (повторная оплата того же nonce невозможна через гейт pending).
    await db
      .prepare('INSERT INTO orders (nonce, user_id, product_id, status, created_at) VALUES (?,?,?,?,?)')
      .bind('nonce-pc-paid', 777001, 'skin.virulent-magenta', 'paid', Date.now())
      .run();
    res = await post(worker, env, '/api/webhook', preCheckoutBody({ nonce: 'nonce-pc-paid', stars: 100 }), hookHeaders);
    eq(botCalls[botCalls.length - 1].ok, false, 'pre_checkout ok=false on paid order');
  } finally {
    globalThis.fetch = realFetch;
  }

  // --- /api/verify (строгий v3) ---
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
  // order есть, payment нет → pending (а не not_found).
  await db
    .prepare('INSERT INTO orders (nonce, user_id, product_id, status, created_at) VALUES (?,?,?,?,?)')
    .bind('nonce-pend', 777001, 'currency.rna-pack-s', 'pending', Date.now())
    .run();
  v = await post(worker, env, '/api/verify', { initData: buildInitData(777001), nonce: 'nonce-pend' });
  eq(v.json.verified, false, 'verify false for unpaid order');
  eq(v.json.reason, 'pending', 'verify pending reason');
  // Подменённый товар в payment → mismatch.
  db.payments.get('charge-test-1').product_id = 'currency.rna-pack-s';
  v = await post(worker, env, '/api/verify', { initData: buildInitData(777001), nonce: 'nonce-001' });
  eq(v.json.verified, false, 'verify false for tampered product');
  eq(v.json.reason, 'mismatch', 'verify tampered product reason');
  db.payments.get('charge-test-1').product_id = 'skin.virulent-magenta';
  v = await post(worker, env, '/api/verify', { initData: buildInitData(777001), nonce: 'x' });
  eq(v.status, 400, 'verify bad nonce → 400');
  v = await post(worker, env, '/api/verify', { initData: 'garbage', nonce: 'nonce-001' });
  eq(v.status, 401, 'verify bad initData → 401');

  // --- /api/entitlements → {purchases} ORDER BY created_at ASC ---
  // refunded passthrough; поля products нет.
  db.payments.get('charge-test-2').status = 'refunded';
  const ent = await post(worker, env, '/api/entitlements', { initData: buildInitData(777001) });
  eq(ent.status, 200, 'entitlements ok');
  assert(!('products' in ent.json), 'entitlements has no legacy products field');
  eq(ent.json.purchases.length, 3, 'entitlements returns all own payments');
  eq(ent.json.purchases[0].chargeId, 'charge-test-1', 'entitlements order 1');
  eq(ent.json.purchases[0].productId, 'skin.virulent-magenta', 'entitlements product 1');
  eq(ent.json.purchases[0].status, 'paid', 'entitlements status 1');
  assert(typeof ent.json.purchases[0].createdAt === 'number', 'entitlements createdAt 1');
  eq(ent.json.purchases[1].chargeId, 'charge-test-2', 'entitlements order 2');
  eq(ent.json.purchases[1].status, 'refunded', 'entitlements refunded passthrough');
  eq(ent.json.purchases[2].chargeId, 'charge-test-3', 'entitlements order 3');

  // --- чужой пользователь — пустой список, не чужие товары ---
  const other = await post(worker, env, '/api/entitlements', { initData: buildInitData(555000) });
  eq(other.status, 200, 'entitlements ok for unknown user');
  eq(JSON.stringify(other.json.purchases), JSON.stringify([]), 'unknown user has no purchases');

  // --- /api/ack: paid → fulfilled ---
  let ack = await post(worker, env, '/api/ack', { initData: buildInitData(777001), chargeId: 'charge-test-1' });
  eq(ack.status, 200, 'ack ok');
  eq(ack.json.ok, true, 'ack applied paid→fulfilled');
  eq(db.payments.get('charge-test-1').status, 'fulfilled', 'payment fulfilled');
  assert(typeof db.payments.get('charge-test-1').fulfilled_at === 'number', 'fulfilled_at set');
  ack = await post(worker, env, '/api/ack', { initData: buildInitData(777001), chargeId: 'charge-test-1' });
  eq(ack.json.ok, false, 'ack repeat → ok:false (not paid anymore)');
  ack = await post(worker, env, '/api/ack', { initData: buildInitData(555000), chargeId: 'charge-test-3' });
  eq(ack.json.ok, false, 'ack other user → ok:false');
  ack = await post(worker, env, '/api/ack', { initData: buildInitData(777001), chargeId: '' });
  eq(ack.status, 400, 'ack empty chargeId → 400');
  eq(ack.json.error, 'bad-charge-id', 'ack 400 error code');
  ack = await post(worker, env, '/api/ack', { initData: 'garbage', chargeId: 'charge-test-3' });
  eq(ack.status, 401, 'ack bad initData → 401');

  // --- без PAYMENTS_DB → 501 db_unavailable (verify/entitlements/ack),
  // invoice → 503, webhook → 200 log-only ---
  const noDbEnv = { TELEGRAM_BOT_TOKEN: BOT_TOKEN, WEBHOOK_SECRET: SECRET };
  const noDbVerify = await post(worker, noDbEnv, '/api/verify', { initData: buildInitData(777001), nonce: 'nonce-001' });
  eq(noDbVerify.status, 501, 'verify without DB → 501');
  eq(noDbVerify.json.error, 'db_unavailable', 'verify 501 error code');
  const noDbEnt = await post(worker, noDbEnv, '/api/entitlements', { initData: buildInitData(777001) });
  eq(noDbEnt.status, 501, 'entitlements without DB → 501');
  const noDbAck = await post(worker, noDbEnv, '/api/ack', { initData: buildInitData(777001), chargeId: 'charge-test-1' });
  eq(noDbAck.status, 501, 'ack without DB → 501');
  const noDbInvoice = await post(worker, noDbEnv, '/api/invoice', {
    initData: buildInitData(777001),
    productId: 'currency.rna-pack-s',
    nonce: 'nonce-nodb',
  });
  eq(noDbInvoice.status, 503, 'invoice without DB → 503');
  eq(noDbInvoice.json.error, 'db_unavailable', 'invoice 503 error code');

  // --- плохая initData → 401 ---
  const bad = await post(worker, env, '/api/entitlements', { initData: 'garbage' });
  eq(bad.status, 401, 'bad initData → 401');

  // --- WEBHOOK_SECRET fail-closed ---
  const noSecret = await post(
    worker,
    { TELEGRAM_BOT_TOKEN: BOT_TOKEN, PAYMENTS_DB: db },
    '/api/webhook',
    webhookBody({ userId: 777001, nonce: 'nonce-001', chargeId: 'charge-neg-5', stars: 100 }),
    hookHeaders
  );
  eq(noSecret.status, 401, 'webhook without WEBHOOK_SECRET → 401 fail-closed');
  const wrongSecret = await post(
    worker,
    env,
    '/api/webhook',
    webhookBody({ userId: 777001, nonce: 'nonce-001', chargeId: 'charge-neg-6', stars: 100 }),
    { 'x-telegram-bot-api-secret-token': 'wrong' }
  );
  eq(wrongSecret.status, 403, 'webhook wrong secret → 403');
  const noHeader = await post(
    worker,
    env,
    '/api/webhook',
    webhookBody({ userId: 777001, nonce: 'nonce-001', chargeId: 'charge-neg-7', stars: 100 })
  );
  eq(noHeader.status, 403, 'webhook missing secret header → 403');

  // --- вебхук без D1 → 503 fail-closed (патч №14, P0-2): раньше было 200
  // "log only" — Telegram считал апдейт обработанным, оплата терялась ---
  const noDbHook = await post(
    worker,
    { TELEGRAM_BOT_TOKEN: BOT_TOKEN, WEBHOOK_SECRET: SECRET },
    '/api/webhook',
    webhookBody({ userId: 777001, nonce: 'nonce-001', chargeId: 'charge-test-9', stars: 100 }),
    hookHeaders
  );
  eq(noDbHook.status, 503, 'webhook without DB → 503 fail-closed (Telegram retries)');
  eq(noDbHook.json.error, 'db_unavailable', 'webhook without DB error code');

  console.log('worker-entitlements: OK');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
