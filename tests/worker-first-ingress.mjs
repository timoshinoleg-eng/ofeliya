/**
 * Worker-first Telegram ingress — isolated, no real Telegram, Render or D1.
 * Runs in CI as part of npm run test:stars. Keeps the production webhook
 * unchanged while the new route is tested under a dormant feature gate.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { buildTelegramWebhookMethod } from '../server/telegram-webhook.mjs';
import { makeD1, seedOrder } from './d1-v16-stub.mjs';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-ingress-'));
writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'commonjs' }));
const require = createRequire(import.meta.url);
const TG_SECRET = 'TelegramSecret_01234567890123456789';
const WORKER_SECRET = 'WorkerSecret_01234567890123456789';
const endpoint = 'https://test.example/api/telegram/ingress';
const baseEnv = {
  TG_WEBHOOK_SECRET: TG_SECRET,
  WEBHOOK_SECRET: WORKER_SECRET,
  TELEGRAM_BOT_TOKEN: '123456:THIS-IS-FAKE-DO-NOT-USE',
};
const originalFetch = globalThis.fetch;
const calls = [];
let fakeFetch = async (url, init) => {
  calls.push({ url: String(url), init });
  return new Response(JSON.stringify({ method: 'sendMessage', chat_id: 42, text: 'OK' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

function request(body, secret = TG_SECRET, contentType = 'application/json') {
  return new Request(endpoint, {
    method: 'POST',
    headers: { 'content-type': contentType, 'x-telegram-bot-api-secret-token': secret },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'worker/src/index.ts', 'worker/src/grants.ts', 'worker/src/sql.ts',
      '--target', 'ES2021', '--module', 'commonjs', '--moduleResolution', 'node',
      '--strict', 'true', '--outDir', temp, '--skipLibCheck', 'true',
      '--esModuleInterop', 'true',
    ],
    { stdio: 'inherit' }
  );
  const worker = require(join(temp, 'index.js')).default;
  assert.equal(typeof worker?.fetch, 'function');
  globalThis.fetch = async (...args) => fakeFetch(...args);

  const start = {
    update_id: 101,
    message: { message_id: 1, chat: { id: 42, type: 'private' }, from: { id: 42 }, text: '/start ref_test123' },
  };
  const help = { update_id: 102, message: { chat: { id: 42, type: 'private' }, text: '/help' } };
  const support = { update_id: 103, message: { chat: { id: 42, type: 'private' }, text: '/paysupport' } };
  const callback = { update_id: 104, callback_query: { id: 'callback', data: 'ok' } };

  // Auth, malformed input and strict body bounds are fail-closed.
  let res = await worker.fetch(request(start, 'invalid'), baseEnv);
  assert.equal(res.status, 403, 'invalid Telegram secret is rejected');
  assert.equal(calls.length, 0, 'invalid auth cannot forward');
  res = await worker.fetch(request(start, WORKER_SECRET), baseEnv);
  assert.equal(res.status, 403, 'legacy Worker proxy secret is not accepted by direct ingress');
  res = await worker.fetch(request(start), { ...baseEnv, TG_WEBHOOK_SECRET: '' });
  assert.equal(res.status, 503, 'unconfigured direct secret is fail-closed');
  res = await worker.fetch(request('{bad-json'), baseEnv);
  assert.equal(res.status, 400, 'malformed JSON rejected');
  res = await worker.fetch(request('null'), baseEnv);
  assert.equal(res.status, 400, 'nonobject body rejected');
  res = await worker.fetch(request([], TG_SECRET), baseEnv);
  assert.equal(res.status, 400, 'array body rejected');
  res = await worker.fetch(request(start, TG_SECRET, 'text/plain'), baseEnv);
  assert.equal(res.status, 415, 'non-JSON content-type rejected');
  res = await worker.fetch(request('x'.repeat(260 * 1024)), baseEnv);
  assert.equal(res.status, 413, 'actual byte limit enforced without trusting Content-Length');
  assert.equal(calls.length, 0, 'bad or unauthenticated updates never forwarded');

  // Commands and deep links: mimic the real Render pure reply builder.
  fakeFetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const update = JSON.parse(init.body);
    const method = buildTelegramWebhookMethod(update, {
      gameUrl: 'https://ofeliya-game.onrender.com/ofeliya/',
      paymentSupportEmail: 'ovt@ovtveol.ru',
    });
    return new Response(JSON.stringify(method ?? { ok: true }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };
  for (const update of [start, help, support, callback]) {
    res = await worker.fetch(request(update), baseEnv);
    assert.equal(res.status, 200, 'nonpayment command forwarded');
    const expected = buildTelegramWebhookMethod(update, {
      gameUrl: 'https://ofeliya-game.onrender.com/ofeliya/',
      paymentSupportEmail: 'ovt@ovtveol.ru',
    }) ?? { ok: true };
    assert.deepEqual(await res.json(), expected, 'preserve real command response');
    const call = calls.at(-1);
    assert.equal(call.url, 'https://ofeliya-game.onrender.com/api/telegram/webhook');
    assert.equal(call.init.headers['x-telegram-bot-api-secret-token'], TG_SECRET);
    assert.equal(call.init.body, JSON.stringify(update), 'original JSON preserved');
    assert.equal(call.init.redirect, 'manual', 'do not follow redirects with Telegram secret');
    assert.equal(call.init.method, 'POST');
  }
  assert.equal(calls.length, 4, 'exactly four nonpayment forwards');
  const rawStart = JSON.stringify(start, null, 2);
  res = await worker.fetch(request(rawStart), baseEnv);
  assert.equal(res.status, 200, 'referral with whitespace accepted');
  assert.equal(calls.at(-1).init.body, rawStart, 'referral body not parsed and reserialized');

  fakeFetch = async () => { throw new Error('render asleep'); };
  res = await worker.fetch(request(start), baseEnv);
  assert.equal(res.status, 503, 'downstream timeout/unavailable causes retryable response');
  fakeFetch = async () => new Response('upstream failed', { status: 500 });
  res = await worker.fetch(request(help), baseEnv);
  assert.equal(res.status, 503, 'non-2xx Render response is never acknowledged');
  fakeFetch = async (url, init) => {
    assert.equal(init.redirect, 'manual', 'redirect handling must not leak secret');
    return new Response(null, { status: 302, headers: { location: 'https://untrusted.example/' } });
  };
  res = await worker.fetch(request(help), baseEnv);
  assert.equal(res.status, 503, 'redirect refused and not followed');

  // Malformed recognized payment updates fail before any Bot API or Render call.
  calls.length = 0;
  for (const broken of [
    { pre_checkout_query: [] },
    { pre_checkout_query: { id: '', from: {}, invoice_payload: 'x', total_amount: 35, currency: 'XTR' } },
    { subscription: [] },
    { subscription: { user: {}, state: 'active', invoice_payload: 'nonce_sp_bad' } },
    { message: { successful_payment: [], from: { id: 42 } } },
    { message: { successful_payment: { telegram_payment_charge_id: '', invoice_payload: 'nonce_bad', currency: 'XTR', total_amount: 35 }, from: { id: 42 } } },
  ]) {
    res = await worker.fetch(request(broken), baseEnv);
    assert.equal(res.status, 400, 'malformed recognized payment rejected without downstream');
  }
  assert.equal(calls.length, 0, 'malformed payment causes no network requests');

  // Payment precheckout reaches existing Bot API handler WITHOUT forwarding to Render,
  // and fails closed without D1. No real Telegram API calls are made.
  calls.length = 0;
  fakeFetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (!String(url).includes('/answerPreCheckoutQuery')) throw new Error('wrong destination');
    return new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };
  const checkout = {
    update_id: 202, pre_checkout_query: {
      id: 'test-precheckout-id', from: { id: 42 }, currency: 'XTR',
      total_amount: 250, invoice_payload: 'nonce_TEST_012345678',
    },
  };
  res = await worker.fetch(request(checkout), baseEnv);
  assert.equal(res.status, 200, 'Worker responds to precheckout even with missing D1');
  assert.equal(calls.length, 1, 'one outgoing Bot API request, no Render');
  assert.equal(JSON.parse(calls[0].init.body).ok, false, 'missing D1 cannot approve a charge');

  // Successful payment fails closed if D1 is down; should not go to Render.
  calls.length = 0;
  const paid = {
    update_id: 203, message: {
      from: { id: 42 }, successful_payment: {
        currency: 'XTR', total_amount: 250, invoice_payload: 'nonce_TEST_012345678',
        telegram_payment_charge_id: 'fake-charge-id', provider_payment_charge_id: '',
      },
    },
  };
  res = await worker.fetch(request(paid), baseEnv);
  assert.equal(res.status, 503, 'paid update without D1 requests retry');
  assert.equal(calls.length, 0, 'no cross-host forward for successful_payment');

  // Full payment path: valid precheckout → atomic paid grant → redelivery
  // no double credit, and failed batch → retry succeeds exactly once.
  const db = makeD1();
  const nonce = 'nonce_ingress_0123456789';
  await seedOrder(db, nonce, 42, 'currency.rna-pack-s', 35, {
    skuVersion: 4, grantRna: 500, grantBoosterDays: 0, grantSkinId: null,
    grantSeasonPassDays: 0, invoiceUrl: 'https://t.me/$dummy',
  });
  const dbEnv = { ...baseEnv, PAYMENTS_DB: db };
  calls.length = 0;
  fakeFetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (!String(url).includes('/answerPreCheckoutQuery')) throw new Error('unexpected Render request');
    return new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };
  const realCheckout = { update_id: 301, pre_checkout_query: {
    id: 'q-ingress-paid', from: { id: 42 }, currency: 'XTR',
    total_amount: 35, invoice_payload: nonce,
  } };
  res = await worker.fetch(request(realCheckout), dbEnv);
  assert.equal(res.status, 200, 'valid direct precheckout accepted');
  assert.equal(calls.length, 1, 'precheckout contacts Telegram only, not Render');
  assert.equal(JSON.parse(calls[0].init.body).ok, true, 'pending order accepted by Telegram');
  const paidOnce = { update_id: 302, message: { from: { id: 42 }, successful_payment: {
    currency: 'XTR', total_amount: 35, invoice_payload: nonce,
    telegram_payment_charge_id: 'ch-ingress-1', provider_payment_charge_id: 'provider-fake',
  } } };
  db.hooks.failBatchAtStatement = 2;
  res = await worker.fetch(request(paidOnce), dbEnv);
  assert.equal(res.status, 503, 'atomic D1 batch failure must request Telegram retry');
  assert.equal(db.payments.size, 0, 'failed batch no payment commit');
  assert.equal(db.ledger.size, 0, 'failed batch no grant commit');
  db.hooks.failBatchAtStatement = -1;
  res = await worker.fetch(request(paidOnce), dbEnv);
  assert.equal(res.status, 200, 'paid retry accepted');
  assert.equal(db.payments.size, 1, 'one payment committed');
  assert.equal(db.ledger.size, 1, 'one ledger grant committed');
  assert.equal(db.wallets.get(42)?.purchased_rna, 500, 'exactly 500 RNA granted');
  res = await worker.fetch(request(paidOnce), dbEnv);
  assert.equal(res.status, 200, 'repeat update idempotent');
  assert.equal(db.payments.size, 1);
  assert.equal(db.ledger.size, 1);
  assert.equal(db.wallets.get(42)?.purchased_rna, 500, 'no double grant on replay');
  assert.equal(calls.length, 1, 'paid updates do not contact Render or Bot API');

  // Subscription events must also bypass sleeping Render and be audited in D1.
  const subscription = { update_id: 303, subscription: {
    user: { id: 42 }, invoice_payload: nonce, state: 'canceled',
  } };
  res = await worker.fetch(request(subscription), dbEnv);
  assert.equal(res.status, 200, 'valid subscription update accepted by Worker');
  assert.equal(db.subscriptionEvents.length, 1, 'subscription event audited');
  assert.equal(db.subscriptionEvents[0].state, 'canceled');
  assert.equal(calls.length, 1, 'subscription update does not contact Render');

  // D1 that never responds must fail closed before Telegram's ten-second limit.
  const neverResolvingD1 = {
    prepare() { return { bind() { return { first: async () => new Promise(() => {}) }; } }; },
  };
  calls.length = 0;
  const started = Date.now();
  res = await worker.fetch(request(realCheckout), { ...baseEnv, PAYMENTS_DB: neverResolvingD1 });
  const elapsedMs = Date.now() - started;
  assert.equal(res.status, 200, 'D1 timeout still produces a Telegram rejection');
  assert.equal(calls.length, 1, 'D1 timeout causes one Telegram answer');
  assert.equal(JSON.parse(calls[0].init.body).ok, false, 'D1 timeout must fail closed');
  assert(elapsedMs < 9_000, 'D1 timeout must reserve time for Bot API');

  // Legacy /api/webhook still uses legacy secret for rollback compatibility.
  res = await worker.fetch(new Request('https://test.example/api/webhook', {
    method: 'POST', headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': TG_SECRET,
    }, body: '{}',
  }), baseEnv);
  assert.equal(res.status, 403, 'direct secret not accepted at legacy Worker route');
  res = await worker.fetch(new Request('https://test.example/api/webhook', {
    method: 'POST', headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': WORKER_SECRET,
    }, body: '{}',
  }), baseEnv);
  assert.equal(res.status, 200, 'legacy Worker route intact for rollback');

  console.log('worker-first ingress: auth, forwarding, retry, payment isolation and legacy path PASS');
} finally {
  globalThis.fetch = originalFetch;
  rmSync(temp, { recursive: true, force: true });
}
