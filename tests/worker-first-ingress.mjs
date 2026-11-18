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
  let res = await worker.fetch(request(start, 'invalid'));
  assert.equal(res.status, 403, 'invalid Telegram secret is rejected');
  assert.equal(calls.length, 0, 'invalid auth cannot forward');
  res = await worker.fetch(request(start, WORKER_SECRET));
  assert.equal(res.status, 403, 'legacy Worker proxy secret is not accepted by direct ingress');
  res = await worker.fetch(request(start), { ...baseEnv, TG_WEBHOOK_SECRET: '' });
  assert.equal(res.status, 503, 'unconfigured direct secret is fail-closed');
  res = await worker.fetch(request('{bad-json'));
  assert.equal(res.status, 400, 'malformed JSON rejected');
  res = await worker.fetch(request('null'));
  assert.equal(res.status, 400, 'nonobject body rejected');
  res = await worker.fetch(request([], TG_SECRET));
  assert.equal(res.status, 400, 'array body rejected');
  res = await worker.fetch(request(start, TG_SECRET, 'text/plain'));
  assert.equal(res.status, 415, 'non-JSON content-type rejected');
  res = await worker.fetch(request('x'.repeat(260 * 1024)));
  assert.equal(res.status, 413, 'actual byte limit enforced without trusting Content-Length');
  assert.equal(calls.length, 0, 'bad or unauthenticated updates never forwarded');

  // Commands, callback, deep links: original exact JSON and secret preserved.
  for (const update of [start, help, support, callback]) {
    res = await worker.fetch(request(update), baseEnv);
    assert.equal(res.status, 200, 'nonpayment command forwarded');
    assert.deepEqual(await res.json(), { method: 'sendMessage', chat_id: 42, text: 'OK' });
    const call = calls.at(-1);
    assert.equal(call.url, 'https://ofeliya-game.onrender.com/api/telegram/webhook');
    assert.equal(call.init.headers['x-telegram-bot-api-secret-token'], TG_SECRET);
    assert.deepEqual(JSON.parse(call.init.body), update);
    assert.equal(call.init.method, 'POST');
  }
  assert.equal(calls.length, 4, 'exactly four nonpayment forwards');

  fakeFetch = async () => { throw new Error('render asleep'); };
  res = await worker.fetch(request(start), baseEnv);
  assert.equal(res.status, 503, 'downstream timeout/unavailable causes retryable response');
  fakeFetch = async () => new Response('upstream failed', { status: 500 });
  res = await worker.fetch(request(help), baseEnv);
  assert.equal(res.status, 503, 'non-2xx Render response is never acknowledged');

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
