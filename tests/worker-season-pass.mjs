/**
 * Worker season pass — монетизация v3 (сезонный пропуск, схема v17).
 *
 * Covers:
 * - каталог: GRANTS_VERSION === 4; season-pass.basic-30d — kind
 *   'season_pass', 30 дней, subscription.periodSeconds === 2592000
 *   (единственное допустимое значение Telegram Stars);
 * - /api/invoice: subscription_period=2592000 передаётся в
 *   createInvoiceLink ТОЛЬКО для пропуска; обычный товар — без него;
 *   заказ пишет grant_season_pass_days=30 в снапшот;
 * - первая оплата: season_pass_until_ms ≈ now+30d, /api/wallet отдаёт
 *   поле, ledger — одна строка season_pass, заказ 'paid';
 * - продление (тот же nonce, новый charge_id, is_recurring=true,
 *   is_first_recurring=false): +30d от max(текущий срок, now), платёж
 *   с производным nonce `${nonce}:r:${chargeId}`, заказ остаётся paid;
 * - дубликат продления (тот же charge_id) — no-op, без двойного гранта;
 * - продление не на ту сумму / не от того пользователя — гранта нет;
 * - is_recurring у НЕ-подписки — nonce_reuse-путь, гранта нет;
 * - BotSubscriptionUpdated (Bot API 10.2, точная форма: {user,
 *   invoice_payload, state}): 3 состояния → 3 строки subscription_events,
 *   charge_id резолвится из payments; невалидный state — без записи;
 *   кошелёк от апдейта НЕ меняется (доступ гейтится только датой);
 * - POST /api/admin/subscription: 401 без токена, 400 плохой chargeId /
 *   isCanceled, not-found для неизвестного charge, успех вызывает
 *   editUserStarSubscription (Bot API, HTTPS) с user_id/charge_id/is_canceled;
 * - продление с subscription_expiration_date не роняет вебхук.
 *
 * D1 — общий стаб tests/d1-v16-stub.mjs (+v17: season_pass, subscription_events).
 * Bot API — стаб globalThis.fetch (createInvoiceLink/editUserStarSubscription).
 */
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { makeD1, seedOrder } from './d1-v16-stub.mjs';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-worker-season-pass-'));
writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'commonjs' }));
const require = createRequire(import.meta.url);

const assert = (condition, message) => {
  if (!condition) throw new Error(`worker-season-pass: ${message}`);
};
const eq = (actual, expected, message) =>
  assert(actual === expected, `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

const BOT_TOKEN = 'test-bot-token-sp-0123456789';
const WEBHOOK_SECRET = 'test-webhook-secret-sp-0123456789';
const ADMIN_TOKEN = 'test-admin-token-sp-0123456789';
const USER_ID = 777005;
const OTHER_USER = 777006;
const PASS_ID = 'season-pass.basic-30d';
const DAY_MS = 86_400_000;
const PASS_MS = 30 * DAY_MS;

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
    query_id: 'AAE-sp-test',
    user: JSON.stringify({ id: userId, first_name: 'Test' }),
  };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) params.set(k, v);
  params.set('hash', signInitData(fields));
  return params.toString();
}

function paymentBody(chargeId, nonce, opts = {}) {
  const { userId = USER_ID, amount = 250, isRecurring, isFirstRecurring, expDate } = opts;
  const sp = {
    currency: 'XTR',
    total_amount: amount,
    invoice_payload: nonce,
    telegram_payment_charge_id: chargeId,
    provider_payment_charge_id: 'prov-sp-1',
  };
  if (isRecurring !== undefined) sp.is_recurring = isRecurring;
  if (isFirstRecurring !== undefined) sp.is_first_recurring = isFirstRecurring;
  if (expDate !== undefined) sp.subscription_expiration_date = expDate;
  return { message: { from: { id: userId }, successful_payment: sp } };
}

function subscriptionUpdateBody(nonce, state, userId = USER_ID) {
  return { subscription: { user: { id: userId }, invoice_payload: nonce, state } };
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
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith('https://api.telegram.org/')) {
    const body = JSON.parse(opts.body);
    botCalls.push({ url: u, method: u.split('/').pop(), body });
    if (u.includes('/createInvoiceLink')) {
      return new Response(JSON.stringify({ ok: true, result: 'https://t.me/$inv-sp' }), {
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
  const baseEnv = { TELEGRAM_BOT_TOKEN: BOT_TOKEN, WEBHOOK_SECRET };

  // === каталог ===
  eq(grants.GRANTS_VERSION, 4, 'GRANTS_VERSION 4 (season pass + bundles)');
  const passGrant = grants.grantForProduct(PASS_ID);
  assert(passGrant, 'season pass in catalog');
  eq(passGrant.kind, 'season_pass', 'pass kind');
  eq(passGrant.grant.seasonPassDays, 30, 'pass days = 30');
  eq(passGrant.grant.stars, 250, 'pass stars = 250');
  eq(passGrant.grant.subscription.periodSeconds, 2592000, 'subscription period = 30d (only allowed value)');
  assert(grants.grantAmountText('season_pass', passGrant.grant).includes('30'), 'grantAmountText mentions 30 days');
  eq(grants.grantForProduct('currency.rna-pack-s').grant.seasonPassDays, 0, 'non-pass grant has seasonPassDays 0');

  // === /api/invoice: subscription_period только для пропуска ===
  {
    const db = makeD1();
    const env = { ...baseEnv, PAYMENTS_DB: db };
    botCalls.length = 0;
    const inv = await post(
      handler, '/api/invoice',
      { initData, productId: PASS_ID, nonce: 'nonce-sp-inv-1' }, env
    );
    eq(inv.status, 200, 'pass invoice 200');
    const call = botCalls.find((c) => c.method === 'createInvoiceLink');
    assert(call, 'createInvoiceLink called');
    eq(call.body.subscription_period, 2592000, 'subscription_period=2592000 for pass');
    eq(call.body.prices[0].amount, 250, 'pass amount 250 stars');
    const order = db.orders.get('nonce-sp-inv-1');
    assert(order, 'pass order written');
    eq(order.grant_season_pass_days, 30, 'order snapshot: 30 pass days');
    eq(order.sku_version, 4, 'order sku_version 4');

    botCalls.length = 0;
    const inv2 = await post(
      handler, '/api/invoice',
      { initData, productId: 'currency.rna-pack-s', nonce: 'nonce-sp-inv-2' }, env
    );
    eq(inv2.status, 200, 'rna invoice 200');
    const call2 = botCalls.find((c) => c.method === 'createInvoiceLink');
    assert(call2, 'createInvoiceLink called for rna');
    assert(!('subscription_period' in call2.body), 'no subscription_period for non-subscription product');
    eq(db.orders.get('nonce-sp-inv-2').grant_season_pass_days, 0, 'rna order snapshot: 0 pass days');
  }

  // === первая оплата + продление + дубликат ===
  {
    const db = makeD1();
    const env = { ...baseEnv, PAYMENTS_DB: db };
    await seedOrder(db, 'nonce-sp-1', USER_ID, PASS_ID, 250, { skuVersion: 4, grantRna: 0, grantBoosterDays: 0, grantSeasonPassDays: 30 });

    const before = Date.now();
    const r1 = await post(handler, '/api/webhook', paymentBody('ch-sp-1', 'nonce-sp-1'), env, secretHeader());
    eq(r1.status, 200, 'first payment webhook 200');
    const w1 = db.wallets.get(USER_ID);
    assert(w1, 'wallet created');
    assert(
      w1.season_pass_until_ms >= before + PASS_MS - 1000 && w1.season_pass_until_ms <= Date.now() + PASS_MS + 1000,
      `first payment: season_pass_until_ms ≈ now+30d (got ${w1.season_pass_until_ms})`
    );
    eq(db.orders.get('nonce-sp-1').status, 'paid', 'order paid');
    const ledgerRows = [...db.ledger.values()].filter((r) => r.grant_type === 'season_pass');
    eq(ledgerRows.length, 1, 'one season_pass ledger row');
    eq(ledgerRows[0].amount, PASS_MS, 'ledger amount = 30d in ms');

    // Платёж со снапшотом НЕ должен ложно логировать sku_drift
    // (пред-v17 баг: grant.stars из снапшота = 0 → catalogStars: 0).
    // Перехватываем console.log на один платёж и проверяем события.
    {
      const lines = [];
      const origLog = console.log;
      console.log = (...args) => void lines.push(args.join(' '));
      try {
        // P1-2: вторая покупка пропуска при активном запрещена сервером,
        // поэтому drift-проверка идёт от ДРУГОГО пользователя (иначе платёж
        // отклонится в duplicate_payments без stars_payment_recorded).
        await seedOrder(db, 'nonce-sp-1b', OTHER_USER, PASS_ID, 250, { skuVersion: 4, grantRna: 0, grantBoosterDays: 0, grantSeasonPassDays: 30 });
        const rb = await post(handler, '/api/webhook', paymentBody('ch-sp-1b', 'nonce-sp-1b', { userId: OTHER_USER }), env, secretHeader());
        eq(rb.status, 200, 'drift-check payment 200');
      } finally {
        console.log = origLog;
      }
      const drift = lines.filter((l) => l.includes('stars_payment_sku_drift'));
      eq(drift.length, 0, 'no false sku_drift on snapshot payment (price matches catalog)');
      assert(lines.some((l) => l.includes('stars_payment_recorded')), 'payment recorded event logged');
    }

    // /api/wallet отдаёт поле.
    const wj = await (await post(handler, '/api/wallet', { initData }, env)).json();
    eq(wj.season_pass_until_ms, w1.season_pass_until_ms, '/api/wallet returns season_pass_until_ms');

    // Продление: тот же nonce, новый charge_id.
    const until1 = w1.season_pass_until_ms;
    const r2 = await post(
      handler, '/api/webhook',
      paymentBody('ch-sp-r1', 'nonce-sp-1', { isRecurring: true, isFirstRecurring: false }),
      env, secretHeader()
    );
    eq(r2.status, 200, 'renewal webhook 200');
    const w2 = db.wallets.get(USER_ID);
    assert(
      w2.season_pass_until_ms >= until1 + PASS_MS - 1000 && w2.season_pass_until_ms <= until1 + PASS_MS + 1000,
      `renewal extends from current term (+30d, got ${w2.season_pass_until_ms - until1} ms)`
    );
    const renewalPayment = db.payments.get('ch-sp-r1');
    assert(renewalPayment, 'renewal payment recorded');
    eq(renewalPayment.nonce, 'nonce-sp-1:r:ch-sp-r1', 'renewal uses derived nonce');
    eq(db.orders.get('nonce-sp-1').status, 'paid', 'order still paid after renewal');
    // Строк season_pass: 2 гранта (ch-sp-1, ch-sp-1b из drift-блока) + продление.
    eq([...db.ledger.values()].filter((r) => r.grant_type === 'season_pass').length, 3, 'third season_pass ledger row (renewal)');

    // Дубликат продления (тот же charge_id) — no-op.
    const until2 = w2.season_pass_until_ms;
    const r3 = await post(
      handler, '/api/webhook',
      paymentBody('ch-sp-r1', 'nonce-sp-1', { isRecurring: true, isFirstRecurring: false }),
      env, secretHeader()
    );
    eq(r3.status, 200, 'duplicate renewal webhook 200');
    eq(db.wallets.get(USER_ID).season_pass_until_ms, until2, 'duplicate renewal does not extend');
    eq([...db.ledger.values()].filter((r) => r.grant_type === 'season_pass').length, 3, 'no extra ledger row on duplicate');

    // Продление с subscription_expiration_date — не роняет вебхук.
    const expSec = Math.floor((until2 + PASS_MS) / 1000);
    const r4 = await post(
      handler, '/api/webhook',
      paymentBody('ch-sp-r2', 'nonce-sp-1', { isRecurring: true, isFirstRecurring: false, expDate: expSec }),
      env, secretHeader()
    );
    eq(r4.status, 200, 'renewal with expiration_date 200');
    assert(
      db.wallets.get(USER_ID).season_pass_until_ms >= until2 + PASS_MS - 1000,
      'renewal with expiration_date grants'
    );
  }

  // === продление: не та сумма / не тот пользователь — гранта нет ===
  {
    const db = makeD1();
    const env = { ...baseEnv, PAYMENTS_DB: db };
    await seedOrder(db, 'nonce-sp-2', USER_ID, PASS_ID, 250, { skuVersion: 4, grantRna: 0, grantBoosterDays: 0, grantSeasonPassDays: 30 });
    await post(handler, '/api/webhook', paymentBody('ch-sp-2', 'nonce-sp-2'), env, secretHeader());
    const until = db.wallets.get(USER_ID).season_pass_until_ms;

    const ra = await post(
      handler, '/api/webhook',
      paymentBody('ch-sp-2-wrong-amount', 'nonce-sp-2', { amount: 100, isRecurring: true, isFirstRecurring: false }),
      env, secretHeader()
    );
    eq(ra.status, 200, 'wrong-amount renewal 200');
    eq(db.wallets.get(USER_ID).season_pass_until_ms, until, 'wrong amount: no extension');
    assert(!db.payments.has('ch-sp-2-wrong-amount'), 'wrong amount: no payment recorded');

    const rb = await post(
      handler, '/api/webhook',
      paymentBody('ch-sp-2-alien', 'nonce-sp-2', { userId: OTHER_USER, isRecurring: true, isFirstRecurring: false }),
      env, secretHeader()
    );
    eq(rb.status, 200, 'alien renewal 200');
    eq(db.wallets.get(USER_ID).season_pass_until_ms, until, 'alien renewal: no extension');
    assert(!db.wallets.has(OTHER_USER), 'alien renewal: no wallet for alien');
  }

  // === is_recurring у НЕ-подписки — nonce_reuse, гранта нет ===
  {
    const db = makeD1();
    const env = { ...baseEnv, PAYMENTS_DB: db };
    await seedOrder(db, 'nonce-sp-3', USER_ID, 'currency.rna-pack-s', 35, { skuVersion: 4, grantRna: 500, grantBoosterDays: 0 });
    await post(handler, '/api/webhook', paymentBody('ch-sp-3', 'nonce-sp-3', { amount: 35 }), env, secretHeader());
    eq(db.wallets.get(USER_ID).purchased_rna, 500, 'rna grant applied');
    const r = await post(
      handler, '/api/webhook',
      paymentBody('ch-sp-3-recur', 'nonce-sp-3', { amount: 35, isRecurring: true, isFirstRecurring: false }),
      env, secretHeader()
    );
    eq(r.status, 200, 'recurring non-subscription 200');
    eq(db.wallets.get(USER_ID).purchased_rna, 500, 'no double grant on recurring non-subscription');
    eq(db.wallets.get(USER_ID).season_pass_until_ms, 0, 'no pass from rna product');
  }

  // === переходное состояние v16→v17: grant_season_pass_days NULL при полном снапшоте ===
  {
    const db = makeD1();
    const env = { ...baseEnv, PAYMENTS_DB: db };
    // Заказ «старого воркера»: снапшот v16 полный, поле пропуска NULL.
    await seedOrder(db, 'nonce-sp-4', USER_ID, 'currency.rna-pack-s', 35, { skuVersion: 2, grantRna: 500, grantBoosterDays: 0, grantSeasonPassDays: null });
    const r = await post(handler, '/api/webhook', paymentBody('ch-sp-4', 'nonce-sp-4', { amount: 35 }), env, secretHeader());
    eq(r.status, 200, 'v16-order payment 200');
    eq(db.wallets.get(USER_ID).purchased_rna, 500, 'v16 snapshot still grants (NULL pass tolerated)');
  }

  // === BotSubscriptionUpdated: 3 состояния + невалидный ===
  {
    const db = makeD1();
    const env = { ...baseEnv, PAYMENTS_DB: db };
    await seedOrder(db, 'nonce-sp-5', USER_ID, PASS_ID, 250, { skuVersion: 4, grantRna: 0, grantBoosterDays: 0, grantSeasonPassDays: 30 });
    await post(handler, '/api/webhook', paymentBody('ch-sp-5', 'nonce-sp-5'), env, secretHeader());
    const until = db.wallets.get(USER_ID).season_pass_until_ms;

    for (const state of ['canceled', 'active', 'failed']) {
      const r = await post(handler, '/api/webhook', subscriptionUpdateBody('nonce-sp-5', state), env, secretHeader());
      eq(r.status, 200, `subscription update ${state} 200`);
    }
    eq(db.subscriptionEvents.length, 3, 'three subscription events recorded');
    eq(db.subscriptionEvents[0].state, 'canceled', 'first event canceled');
    eq(db.subscriptionEvents[0].charge_id, 'ch-sp-5', 'charge_id resolved from payments by nonce');
    eq(db.subscriptionEvents[0].user_id, USER_ID, 'event user_id');
    eq(db.wallets.get(USER_ID).season_pass_until_ms, until, 'subscription update does not change wallet');

    const bad = await post(handler, '/api/webhook', subscriptionUpdateBody('nonce-sp-5', 'bogus-state'), env, secretHeader());
    eq(bad.status, 200, 'invalid state 200 (no throw)');
    eq(db.subscriptionEvents.length, 3, 'invalid state not recorded');
  }

  // === POST /api/admin/subscription ===
  {
    const db = makeD1();
    const env = { ...baseEnv, PAYMENTS_DB: db, ADMIN_TOKEN };
    await seedOrder(db, 'nonce-sp-6', USER_ID, PASS_ID, 250, { skuVersion: 4, grantRna: 0, grantBoosterDays: 0, grantSeasonPassDays: 30 });
    await post(handler, '/api/webhook', paymentBody('ch-sp-6', 'nonce-sp-6'), env, secretHeader());

    const noAuth = await post(handler, '/api/admin/subscription', { chargeId: 'ch-sp-6', isCanceled: true }, env);
    eq(noAuth.status, 401, 'admin subscription without token → 401');

    const badCharge = await post(handler, '/api/admin/subscription', { chargeId: '', isCanceled: true }, env, adminHeader());
    eq(badCharge.status, 400, 'empty chargeId → 400');
    const badFlag = await post(handler, '/api/admin/subscription', { chargeId: 'ch-sp-6', isCanceled: 'yes' }, env, adminHeader());
    eq(badFlag.status, 400, 'non-boolean isCanceled → 400');

    const notFound = await post(handler, '/api/admin/subscription', { chargeId: 'ch-nope', isCanceled: true }, env, adminHeader());
    const notFoundJ = await notFound.json();
    eq(notFoundJ.ok, false, 'unknown charge → ok:false');
    eq(notFoundJ.error, 'not-found', 'unknown charge → not-found');

    botCalls.length = 0;
    const ok = await post(handler, '/api/admin/subscription', { chargeId: 'ch-sp-6', isCanceled: true }, env, adminHeader());
    eq(ok.status, 200, 'admin subscription 200');
    const okJ = await ok.json();
    eq(okJ.ok, true, 'admin subscription ok:true');
    eq(okJ.isCanceled, true, 'admin subscription echoes isCanceled');
    const editCall = botCalls.find((c) => c.method === 'editUserStarSubscription');
    assert(editCall, 'editUserStarSubscription called (Bot API, HTTPS)');
    eq(editCall.body.user_id, USER_ID, 'edit call user_id');
    eq(editCall.body.telegram_payment_charge_id, 'ch-sp-6', 'edit call charge_id');
    eq(editCall.body.is_canceled, true, 'edit call is_canceled');

    const noToken = await post(
      handler, '/api/admin/subscription', { chargeId: 'ch-sp-6', isCanceled: false },
      { ...env, TELEGRAM_BOT_TOKEN: '' }, adminHeader()
    );
    eq(noToken.status, 503, 'no bot token → 503');
  }

  console.log('worker-season-pass: all assertions passed');
} finally {
  globalThis.fetch = realFetch;
  rmSync(temp, { recursive: true, force: true });
}
