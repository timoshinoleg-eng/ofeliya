/**
 * Worker payments v5 — патч №15 (пятый аудит).
 *
 * Covers:
 * - P0-1: (прокси — в tests/stars-proxy.mjs).
 * - P0-2: строгий pre_checkout — ok:true ТОЛЬКО при order.status==='pending'
 *   И from.id===order.user_id; 'paid'/'expired'/чужой user → ok:false.
 *   Backstop nonce-reuse: второй платёж с тем же nonce, но другим charge_id
 *   → 200 + лог 'stars_payment_nonce_reuse', грант применён один раз.
 *   UNIQUE(payments.nonce) — в worker/schema.sql (текстовая проверка).
 * - P0-3: серверная выдача — successful_payment атомарно пишет платёж +
 *   кошелёк + журнал; повторная доставка того же charge_id НЕ удваивает
 *   грант (wallets.purchased_rna, wallet_ledger — одна строка).
 *   POST /api/wallet: 401 без initData, значения после платежей, 501 без DB.
 * - P1-4: admin refund двухшаговый — execute=true без TELEGRAM_BOT_TOKEN →
 *   503 bot-token-misconfigured; execute=true со стабом Bot API →
 *   {ok:true, executed:true} + статус refunded + откат кошелька;
 *   повтор → {ok:true, already:true}; execute=false → только пометка.
 * - P1-5: GET /api/admin/stale-orders — 401 без токена; старые pending-заказы
 *   и paid-без-fulfilled платежи; olderThanMin работает.
 *
 * D1 — in-memory стаб с поддержкой wallets/wallet_ledger.
 * Bot API (answerPreCheckoutQuery/refundStarPayment) — стаб globalThis.fetch.
 */
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-worker-v5-'));
writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'commonjs' }));
const require = createRequire(import.meta.url);

const assert = (condition, message) => {
  if (!condition) throw new Error(`worker-payments-v5: ${message}`);
};
const eq = (actual, expected, message) =>
  assert(actual === expected, `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

const BOT_TOKEN = 'test-bot-token-v5-0123456789';
const WEBHOOK_SECRET = 'test-webhook-secret-v5-0123456789';
const ADMIN_TOKEN = 'test-admin-token-v5-0123456789';
const USER_ID = 777005;
const OTHER_USER = 777006;

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
    query_id: 'AAE-v5-test',
    user: JSON.stringify({ id: userId, first_name: 'Test' }),
  };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) params.set(k, v);
  params.set('hash', signInitData(fields));
  return params.toString();
}

/** In-memory D1-стаб: orders/payments/wallets/wallet_ledger. */
function makeD1() {
  const orders = new Map();
  const payments = new Map();
  const wallets = new Map();
  const ledger = new Map();
  const norm = (sql) => sql.replace(/\s+/g, ' ').trim();

  function execRun(sql, params) {
    const q = norm(sql);
    if (q.startsWith('INSERT INTO orders')) {
      const [nonce, user_id, product_id, status, created_at] = params;
      if (orders.has(nonce)) throw new Error('UNIQUE constraint failed: orders.nonce');
      orders.set(nonce, { nonce, user_id, product_id, status, created_at });
      return { success: true, meta: { changes: 1 } };
    }
    if (q.startsWith('INSERT OR IGNORE INTO payments')) {
      const [charge_id, user_id, product_id, amount, currency, status, nonce, created_at, fulfilled_at] = params;
      if (payments.has(charge_id)) return { success: true, meta: { changes: 0 } };
      for (const row of payments.values()) {
        if (row.nonce === nonce && nonce != null) return { success: true, meta: { changes: 0 } };
      }
      payments.set(charge_id, {
        charge_id, user_id, product_id, amount, currency, status, nonce, created_at, fulfilled_at,
      });
      return { success: true, meta: { changes: 1 } };
    }
    if (q.startsWith("UPDATE orders SET status='paid'")) {
      const [nonce] = params;
      const row = orders.get(nonce);
      if (row && row.status === 'pending') {
        row.status = 'paid';
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }
    if (q.startsWith('INSERT INTO wallets')) {
      const [user_id, purchased_rna, booster_until_ms, skins_json, updated_at] = params;
      wallets.set(user_id, { user_id, purchased_rna, booster_until_ms, skins_json, updated_at });
      return { success: true, meta: { changes: 1 } };
    }
    if (q.startsWith('INSERT OR IGNORE INTO wallet_ledger')) {
      const [user_id, charge_id, kind, amount_text, created_at] = params;
      if (ledger.has(charge_id)) return { success: true, meta: { changes: 0 } };
      ledger.set(charge_id, { user_id, charge_id, kind, amount_text, created_at });
      return { success: true, meta: { changes: 1 } };
    }
    if (q.startsWith("UPDATE payments SET status='refunded'")) {
      const [charge_id] = params;
      const row = payments.get(charge_id);
      if (row && (row.status === 'paid' || row.status === 'fulfilled')) {
        row.status = 'refunded';
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }
    if (q.startsWith('UPDATE wallets SET purchased_rna=')) {
      const [purchased_rna, updated_at, user_id] = params;
      const w = wallets.get(user_id);
      if (w) {
        w.purchased_rna = purchased_rna;
        w.updated_at = updated_at;
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }
    if (q.startsWith('UPDATE wallets SET skins_json=')) {
      const [skins_json, updated_at, user_id] = params;
      const w = wallets.get(user_id);
      if (w) {
        w.skins_json = skins_json;
        w.updated_at = updated_at;
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }
    throw new Error(`d1-stub: unsupported run SQL: ${q}`);
  }

  function execSelect(sql, params) {
    const q = norm(sql);
    if (q === 'SELECT user_id, product_id, status FROM orders WHERE nonce=?') {
      const row = orders.get(params[0]);
      return row ? [{ user_id: row.user_id, product_id: row.product_id, status: row.status }] : [];
    }
    if (q === 'SELECT charge_id FROM payments WHERE nonce=?') {
      for (const row of payments.values()) {
        if (row.nonce === params[0]) return [{ charge_id: row.charge_id }];
      }
      return [];
    }
    if (q === 'SELECT 1 AS one FROM wallet_ledger WHERE charge_id=?') {
      return ledger.has(params[0]) ? [{ one: 1 }] : [];
    }
    if (q === 'SELECT purchased_rna, booster_until_ms, skins_json FROM wallets WHERE user_id=?') {
      const w = wallets.get(params[0]);
      return w
        ? [{ purchased_rna: w.purchased_rna, booster_until_ms: w.booster_until_ms, skins_json: w.skins_json }]
        : [];
    }
    if (q === 'SELECT purchased_rna, skins_json FROM wallets WHERE user_id=?') {
      const w = wallets.get(params[0]);
      return w ? [{ purchased_rna: w.purchased_rna, skins_json: w.skins_json }] : [];
    }
    if (q === 'SELECT charge_id, user_id, product_id, status FROM payments WHERE charge_id=?') {
      const row = payments.get(params[0]);
      return row
        ? [{ charge_id: row.charge_id, user_id: row.user_id, product_id: row.product_id, status: row.status }]
        : [];
    }
    if (q === 'SELECT kind, amount_text FROM wallet_ledger WHERE charge_id=?') {
      const row = ledger.get(params[0]);
      return row ? [{ kind: row.kind, amount_text: row.amount_text }] : [];
    }
    if (q === 'SELECT MAX(created_at) AS tip FROM wallet_ledger WHERE user_id=?') {
      let tip = null;
      for (const row of ledger.values()) {
        if (row.user_id === params[0] && (tip == null || row.created_at > tip)) tip = row.created_at;
      }
      return [{ tip }];
    }
    if (q.startsWith("SELECT nonce, user_id, product_id, status, created_at FROM orders WHERE status='pending'")) {
      const [cutoff] = params;
      return [...orders.values()]
        .filter((r) => r.status === 'pending' && r.created_at < cutoff)
        .sort((a, b) => a.created_at - b.created_at)
        .slice(0, 200);
    }
    if (q.startsWith("SELECT charge_id, user_id, product_id, created_at FROM payments WHERE status='paid'")) {
      const [cutoff] = params;
      return [...payments.values()]
        .filter((r) => r.status === 'paid' && r.created_at < cutoff)
        .sort((a, b) => a.created_at - b.created_at)
        .slice(0, 200);
    }
    throw new Error(`d1-stub: unsupported select SQL: ${q}`);
  }

  const db = {
    orders,
    payments,
    wallets,
    ledger,
    prepare(sql) {
      const st = {
        _params: [],
        bind(...params) {
          st._params = params;
          return st;
        },
        async run() {
          return execRun(sql, st._params);
        },
        async first(column) {
          const rows = execSelect(sql, st._params);
          const row = rows[0] ?? null;
          if (row == null) return null;
          return column != null ? (row[column] ?? null) : row;
        },
        async all() {
          return { results: execSelect(sql, st._params) };
        },
      };
      return st;
    },
    async batch(statements) {
      const out = [];
      for (const st of statements) out.push(await st.run());
      return out;
    },
  };
  return db;
}

function paymentBody(chargeId, nonce, { productId = 'currency.rna-pack-s', userId = USER_ID, amount = 35, currency = 'XTR' } = {}) {
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

function preCheckoutBody(queryId, nonce, { amount = 35, currency = 'XTR', userId = USER_ID, productId = 'currency.rna-pack-s' } = {}) {
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

async function get(handler, path, env, headers = {}) {
  const req = new Request(`https://worker.test${path}`, { method: 'GET', headers });
  return handler.fetch(req, env);
}

// --- стаб Bot API: перехватываем globalThis.fetch ---
const botCalls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith('https://api.telegram.org/')) {
    const body = JSON.parse(opts.body);
    botCalls.push({ url: u, method: u.split('/').pop(), body });
    if (u.includes('/refundStarPayment') && globalThis.__v5_refundShouldFail) {
      return new Response(JSON.stringify({ ok: false, description: 'test-fail' }), {
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

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'worker/src/index.ts',
      'worker/src/grants.ts',
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
    ],
    { stdio: 'pipe' }
  );

  const worker = require(join(temp, 'index.js'));
  const handler = worker.default;
  assert(handler && typeof handler.fetch === 'function', 'worker exports default.fetch');

  // grants.ts тоже скомпилирован — проверяем каталог напрямую.
  const grants = require(join(temp, 'grants.js'));
  eq(grants.grantForProduct('currency.rna-pack-s').kind, 'rna', 'grant kind rna');
  eq(grants.grantForProduct('currency.rna-pack-s').grant.rna, 500, 'grant rna 500');
  eq(grants.grantForProduct('booster.rna-x2-7d').kind, 'booster', 'grant kind booster');
  eq(grants.grantForProduct('skin.gilded-prime').kind, 'skin', 'grant kind skin');
  eq(grants.grantForProduct('nope'), null, 'unknown product → null');

  const initData = buildInitData(USER_ID);
  const baseEnv = { TELEGRAM_BOT_TOKEN: BOT_TOKEN, WEBHOOK_SECRET };

  async function seedOrder(db, nonce, userId, productId, status = 'pending', createdAt = Date.now()) {
    await db
      .prepare('INSERT INTO orders (nonce, user_id, product_id, status, created_at) VALUES (?,?,?,?,?)')
      .bind(nonce, userId, productId, status, createdAt)
      .run();
  }

  // === P0-2: строгий pre_checkout ===
  {
    const db = makeD1();
    const env = { ...baseEnv, PAYMENTS_DB: db };
    botCalls.length = 0;
    await seedOrder(db, 'nonce-v5-pc-ok', USER_ID, 'currency.rna-pack-s', 'pending');
    await seedOrder(db, 'nonce-v5-pc-paid', USER_ID, 'currency.rna-pack-s', 'paid');
    await seedOrder(db, 'nonce-v5-pc-exp', USER_ID, 'currency.rna-pack-s', 'expired');

    const r1 = await post(handler, '/api/webhook', preCheckoutBody('q-ok', 'nonce-v5-pc-ok'), env, secretHeader());
    eq(r1.status, 200, 'pre_checkout http 200');
    const a1 = botCalls.find((c) => c.method === 'answerPreCheckoutQuery' && c.body.pre_checkout_query_id === 'q-ok');
    eq(a1.body.ok, true, 'pre_checkout ok=true: pending + свой user + цена');

    const r2 = await post(handler, '/api/webhook', preCheckoutBody('q-paid', 'nonce-v5-pc-paid'), env, secretHeader());
    eq(r2.status, 200, 'pre_checkout paid http 200');
    const a2 = botCalls.find((c) => c.method === 'answerPreCheckoutQuery' && c.body.pre_checkout_query_id === 'q-paid');
    eq(a2.body.ok, false, 'pre_checkout ok=false: заказ уже paid');

    const r3 = await post(
      handler, '/api/webhook',
      preCheckoutBody('q-alien', 'nonce-v5-pc-ok', { userId: OTHER_USER }), env, secretHeader()
    );
    eq(r3.status, 200, 'pre_checkout alien http 200');
    const a3 = botCalls.find((c) => c.method === 'answerPreCheckoutQuery' && c.body.pre_checkout_query_id === 'q-alien');
    eq(a3.body.ok, false, 'pre_checkout ok=false: чужой from.id');

    const r4 = await post(handler, '/api/webhook', preCheckoutBody('q-exp', 'nonce-v5-pc-exp'), env, secretHeader());
    const a4 = botCalls.find((c) => c.method === 'answerPreCheckoutQuery' && c.body.pre_checkout_query_id === 'q-exp');
    eq(a4.body.ok, false, 'pre_checkout ok=false: expired');
  }

  // === P0-2: UNIQUE(nonce) в схеме + backstop nonce-reuse ===
  {
    const schema = readFileSync(resolve('worker/schema.sql'), 'utf8');
    assert(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_nonce_unique ON payments\(nonce\)/.test(schema),
      'schema.sql: UNIQUE(payments.nonce)'
    );
    assert(schema.includes('CREATE TABLE IF NOT EXISTS wallets'), 'schema.sql: wallets');
    assert(schema.includes('CREATE TABLE IF NOT EXISTS wallet_ledger'), 'schema.sql: wallet_ledger');

    const db = makeD1();
    const env = { ...baseEnv, PAYMENTS_DB: db };
    await seedOrder(db, 'nonce-v5-reuse', USER_ID, 'currency.rna-pack-s', 'pending');
    const w1 = await post(handler, '/api/webhook', paymentBody('ch-v5-first', 'nonce-v5-reuse'), env, secretHeader());
    eq(w1.status, 200, 'first payment 200');
    eq(db.wallets.get(USER_ID).purchased_rna, 500, 'grant applied once');
    eq(db.ledger.size, 1, 'ledger: one row');

    // Тот же nonce, другой charge_id → backstop: 200, без повторного гранта.
    const w2 = await post(handler, '/api/webhook', paymentBody('ch-v5-second', 'nonce-v5-reuse'), env, secretHeader());
    eq(w2.status, 200, 'nonce-reuse → 200 (не 503)');
    eq(db.wallets.get(USER_ID).purchased_rna, 500, 'grant NOT doubled on nonce reuse');
    eq(db.ledger.size, 1, 'ledger still one row');
    eq(db.payments.size, 1, 'payments still one row');
  }

  // === P0-3: двойная доставка того же charge_id — грант один раз ===
  {
    const db = makeD1();
    const env = { ...baseEnv, PAYMENTS_DB: db };
    await seedOrder(db, 'nonce-v5-dup', USER_ID, 'currency.rna-pack-m', 'pending');
    const body = paymentBody('ch-v5-dup', 'nonce-v5-dup', { productId: 'currency.rna-pack-m', amount: 100 });
    const d1 = await post(handler, '/api/webhook', body, env, secretHeader());
    eq(d1.status, 200, 'first delivery 200');
    const d2 = await post(handler, '/api/webhook', body, env, secretHeader());
    eq(d2.status, 200, 'redelivery 200');
    eq(db.wallets.get(USER_ID).purchased_rna, 1500, 'rna granted exactly once');
    eq(db.ledger.size, 1, 'ledger: exactly one row');
    const entry = db.ledger.get('ch-v5-dup');
    eq(entry.kind, 'rna', 'ledger kind rna');
    eq(entry.amount_text, '1500', 'ledger amount 1500');

    // Скин: аддитивное множество, повтор — без дубля.
    await seedOrder(db, 'nonce-v5-skin', USER_ID, 'skin.gilded-prime', 'pending');
    const sbody = paymentBody('ch-v5-skin', 'nonce-v5-skin', { productId: 'skin.gilded-prime', amount: 250 });
    await post(handler, '/api/webhook', sbody, env, secretHeader());
    await post(handler, '/api/webhook', sbody, env, secretHeader());
    const skins = JSON.parse(db.wallets.get(USER_ID).skins_json);
    eq(skins.length, 1, 'skin granted once');
    eq(skins[0], 'skin.gilded-prime', 'skin id');

    // Бустер: max(now, текущий) + дни; повторная доставка не продлевает.
    await seedOrder(db, 'nonce-v5-boost', USER_ID, 'booster.rna-x2-7d', 'pending');
    const bbody = paymentBody('ch-v5-boost', 'nonce-v5-boost', { productId: 'booster.rna-x2-7d', amount: 75 });
    await post(handler, '/api/webhook', bbody, env, secretHeader());
    const firstUntil = db.wallets.get(USER_ID).booster_until_ms;
    assert(firstUntil > Date.now(), 'booster active');
    await post(handler, '/api/webhook', bbody, env, secretHeader());
    eq(db.wallets.get(USER_ID).booster_until_ms, firstUntil, 'booster not extended on redelivery');
  }

  // === P0-3: POST /api/wallet ===
  {
    const db = makeD1();
    const env = { ...baseEnv, PAYMENTS_DB: db };
    // 401 без initData.
    const u1 = await post(handler, '/api/wallet', { initData: 'bad' }, env);
    eq(u1.status, 401, 'wallet → 401 on bad initData');
    // 501 без DB.
    const u2 = await post(handler, '/api/wallet', { initData }, { ...baseEnv });
    eq(u2.status, 501, 'wallet → 501 without DB');
    // Пустой кошелёк.
    const u3 = await post(handler, '/api/wallet', { initData }, env);
    const u3j = await u3.json();
    eq(u3j.purchased_rna, 0, 'wallet empty rna');
    eq(u3j.booster_until_ms, 0, 'wallet empty booster');
    eq(JSON.stringify(u3j.skins), '[]', 'wallet empty skins');
    eq(u3j.ledger_tip, null, 'wallet empty ledger_tip');

    // После платежей — значения сервера.
    await seedOrder(db, 'nonce-v5-w1', USER_ID, 'currency.rna-pack-s', 'pending');
    await post(handler, '/api/webhook', paymentBody('ch-v5-w1', 'nonce-v5-w1'), env, secretHeader());
    await seedOrder(db, 'nonce-v5-w2', USER_ID, 'skin.abyssal-teal', 'pending');
    await post(
      handler, '/api/webhook',
      paymentBody('ch-v5-w2', 'nonce-v5-w2', { productId: 'skin.abyssal-teal', amount: 100 }),
      env, secretHeader()
    );
    const u4 = await post(handler, '/api/wallet', { initData }, env);
    const u4j = await u4.json();
    eq(u4j.purchased_rna, 500, 'wallet rna 500');
    eq(JSON.stringify(u4j.skins), '["skin.abyssal-teal"]', 'wallet skins');
    assert(typeof u4j.ledger_tip === 'number' && u4j.ledger_tip > 0, 'wallet ledger_tip set');

    // Чужой пользователь свой кошелёк не видит.
    const alienData = buildInitData(OTHER_USER);
    const u5 = await post(handler, '/api/wallet', { initData: alienData }, env);
    eq((await u5.json()).purchased_rna, 0, 'alien wallet empty');
  }

  // === P1-4: admin refund двухшаговый ===
  {
    const db = makeD1();
    const envNoToken = { ...baseEnv, WEBHOOK_SECRET, PAYMENTS_DB: db, ADMIN_TOKEN };
    const env = { ...envNoToken, TELEGRAM_BOT_TOKEN: BOT_TOKEN };
    await seedOrder(db, 'nonce-v5-r1', USER_ID, 'currency.rna-pack-s', 'pending');
    await post(handler, '/api/webhook', paymentBody('ch-v5-r1', 'nonce-v5-r1'), env, secretHeader());
    eq(db.wallets.get(USER_ID).purchased_rna, 500, 'grant before refund');
    botCalls.length = 0;

    // execute=true без TELEGRAM_BOT_TOKEN → 503, статус НЕ меняется.
    const e1 = await post(
      handler, '/api/admin/refund',
      { chargeId: 'ch-v5-r1', execute: true },
      { ...envNoToken, TELEGRAM_BOT_TOKEN: undefined },
      adminHeader()
    );
    eq(e1.status, 503, 'execute without bot token → 503');
    eq((await e1.json()).error, 'bot-token-misconfigured', 'bot-token-misconfigured code');
    eq(db.payments.get('ch-v5-r1').status, 'paid', 'status unchanged on 503');

    // execute=true: реальный refundStarPayment, затем пометка + откат кошелька.
    const e2 = await post(
      handler, '/api/admin/refund',
      { chargeId: 'ch-v5-r1', reason: 'test', execute: true },
      env, adminHeader()
    );
    const e2j = await e2.json();
    eq(e2.status, 200, 'execute → 200');
    eq(e2j.ok, true, 'execute ok:true');
    eq(e2j.executed, true, 'executed:true');
    const refundCall = botCalls.find((c) => c.method === 'refundStarPayment');
    assert(refundCall, 'refundStarPayment called');
    eq(refundCall.body.user_id, USER_ID, 'refund user_id');
    eq(refundCall.body.telegram_payment_charge_id, 'ch-v5-r1', 'refund charge_id');
    eq(db.payments.get('ch-v5-r1').status, 'refunded', 'status → refunded');
    eq(db.wallets.get(USER_ID).purchased_rna, 0, 'wallet rna rolled back');

    // Повтор → {ok:true, already:true} (аудит №5: было {ok:false}).
    const e3 = await post(handler, '/api/admin/refund', { chargeId: 'ch-v5-r1', execute: true }, env, adminHeader());
    const e3j = await e3.json();
    eq(e3j.ok, true, 'repeat → ok:true');
    eq(e3j.already, true, 'repeat → already:true');

    // Не найден → ok:false.
    const e4 = await post(handler, '/api/admin/refund', { chargeId: 'nope' }, env, adminHeader());
    eq((await e4.json()).ok, false, 'unknown charge → ok:false');

    // execute=false (mark only): пометка без вызова Telegram.
    await seedOrder(db, 'nonce-v5-r2', USER_ID, 'skin.virulent-magenta', 'pending');
    await post(
      handler, '/api/webhook',
      paymentBody('ch-v5-r2', 'nonce-v5-r2', { productId: 'skin.virulent-magenta', amount: 100 }),
      env, secretHeader()
    );
    assert(JSON.parse(db.wallets.get(USER_ID).skins_json).includes('skin.virulent-magenta'), 'skin granted');
    botCalls.length = 0;
    const e5 = await post(
      handler, '/api/admin/refund',
      { chargeId: 'ch-v5-r2', reason: 'manual via BotFather', execute: false },
      env, adminHeader()
    );
    const e5j = await e5.json();
    eq(e5j.ok, true, 'mark-only ok:true');
    eq(e5j.executed, false, 'mark-only executed:false');
    assert(!botCalls.some((c) => c.method === 'refundStarPayment'), 'no Telegram call on mark-only');
    eq(db.payments.get('ch-v5-r2').status, 'refunded', 'mark-only status → refunded');
    assert(
      !JSON.parse(db.wallets.get(USER_ID).skins_json).includes('skin.virulent-magenta'),
      'skin removed from server wallet on refund'
    );
    // /api/wallet после refund: скин больше не выдаётся новым устройствам.
    const wj = await (await post(handler, '/api/wallet', { initData }, env)).json();
    assert(!wj.skins.includes('skin.virulent-magenta'), 'wallet skins exclude refunded');

    // refundStarPayment упал → 502, статус НЕ меняется.
    await seedOrder(db, 'nonce-v5-r3', USER_ID, 'currency.rna-pack-s', 'pending');
    await post(handler, '/api/webhook', paymentBody('ch-v5-r3', 'nonce-v5-r3'), env, secretHeader());
    globalThis.__v5_refundShouldFail = true;
    const e6 = await post(handler, '/api/admin/refund', { chargeId: 'ch-v5-r3', execute: true }, env, adminHeader());
    globalThis.__v5_refundShouldFail = false;
    eq(e6.status, 502, 'failed refund → 502');
    eq((await e6.json()).error, 'refund-failed', 'refund-failed code');
    eq(db.payments.get('ch-v5-r3').status, 'paid', 'status unchanged on failed refund');
  }

  // === P1-5: GET /api/admin/stale-orders ===
  {
    const db = makeD1();
    const env = { ...baseEnv, WEBHOOK_SECRET, PAYMENTS_DB: db, ADMIN_TOKEN };
    const old = Date.now() - 120 * 60_000; // 2 часа назад
    const fresh = Date.now() - 5 * 60_000; // 5 минут назад
    await seedOrder(db, 'nonce-v5-stale-1', USER_ID, 'currency.rna-pack-s', 'pending', old);
    await seedOrder(db, 'nonce-v5-stale-2', USER_ID, 'currency.rna-pack-s', 'pending', fresh);
    await seedOrder(db, 'nonce-v5-stale-3', USER_ID, 'currency.rna-pack-s', 'pending', old);
    // Старый платёж paid без fulfilled (вставляем напрямую со старым created_at:
    // вебхук ставит created_at=now, а нам нужен «зависший» платёж).
    await db
      .prepare(
        'INSERT OR IGNORE INTO payments (charge_id, user_id, product_id, amount, currency, status, nonce, created_at, fulfilled_at) VALUES (?,?,?,?,?,?,?,?,?)'
      )
      .bind('ch-v5-stale-p', USER_ID, 'currency.rna-pack-s', 35, 'XTR', 'paid', 'nonce-v5-stale-p', old, null)
      .run();

    // 401 без токена.
    const s0 = await get(handler, '/api/admin/stale-orders', env);
    eq(s0.status, 401, 'stale-orders → 401 without token');

    const s1 = await get(handler, '/api/admin/stale-orders?olderThanMin=60', env, adminHeader());
    eq(s1.status, 200, 'stale-orders → 200');
    const s1j = await s1.json();
    eq(s1j.olderThanMin, 60, 'olderThanMin echoed');
    eq(s1j.orders.length, 2, 'two stale pending orders');
    assert(s1j.orders.every((o) => o.nonce !== 'nonce-v5-stale-2'), 'fresh order excluded');
    eq(s1j.unpaidPayments.length, 1, 'one unpaid payment');
    eq(s1j.unpaidPayments[0].charge_id, 'ch-v5-stale-p', 'stale payment charge');

    // olderThanMin=10: свежий заказ попадает.
    const s2 = await get(handler, '/api/admin/stale-orders?olderThanMin=1', env, adminHeader());
    eq((await s2.json()).orders.length, 3, 'olderThanMin=1 includes fresh-ish order');
  }

  console.log('worker-payments-v5: all assertions passed');
} finally {
  globalThis.fetch = realFetch;
  rmSync(temp, { recursive: true, force: true });
}