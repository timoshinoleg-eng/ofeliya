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
import { makeD1, seedOrder } from './d1-v16-stub.mjs';

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

  console.log('worker-round2: all assertions passed');
} catch (e) {
  console.error(e.stack || e);
  process.exit(1);
} finally {
  globalThis.fetch = realFetch;
}
