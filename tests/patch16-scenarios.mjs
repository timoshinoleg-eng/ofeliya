/**
 * patch16-scenarios — 16 сценариев ТЗ патча №16 (поток TESTS, Фаза 2).
 *
 * Worker-side сценарии идут через РЕАЛЬНЫЙ worker/src/index.ts против
 * НАСТОЯЩЕГО SQLite (node:sqlite, :memory:; S16 — файловый для эмуляции
 * рестарта): D1-адаптер поверх DatabaseSync, схема worker/schema.sql,
 * триггер trg_wallet_ledger_apply — настоящий. Client-side — скомпилированный
 * tsc shop-чейн (ServerWalletSync v2 + PendingWalletSync).
 * Живой Telegram/Cloudflare/Docker/Chrome не используются: Bot API и
 * getStarTransactions — стабы.
 *
 *  S1  конкурентные покупки same/diff SKU → 2000 (500+1500);
 *  S2  redelivery одного charge_id → ровно 1 грант;
 *  S3  D1-fail между записью и грантом → 503, один батч → ничего не записано;
 *  S4  D1-fail при refund (execute): op requested → resume → completed;
 *  S5  503/timeout /api/wallet → pending-sync без ack;
 *  S6  ресинк после сети → дрэйн подтверждает + ack, очередь пуста;
 *  S7  wipe localStorage → точное восстановление по журналу;
 *  S8  смена аккаунта: /api/wallet изолирован по user;
 *  S9  два устройства: одинаковые локальные итоги;
 *  S10 возврат одного из двух скинов → второй остаётся active;
 *  S11 покупка→возврат→ре-покупка РНК: fresh == incremental == 1000;
 *  S12 бустер+возврат: политика max(момент возврата, cur−E);
 *  S13 unknown SKU → paid без гранта, громкий лог;
 *  S14 миграция v15→v16 на БД с v15-данными;
 *  S15 reconcile: paid_without_grant + telegram_without_d1 (стаб);
 *  S16 рестарт воркера mid-payment → повтор webhook идемпотентен.
 *
 * Exit code: 0 — все OK, 1 — есть FAIL.
 */
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reconcile } from '../worker/scripts/reconcile.mjs';

const require = createRequire(import.meta.url);
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TSC = join(REPO, 'node_modules/typescript/bin/tsc');
const SCHEMA = readFileSync(join(REPO, 'worker/schema.sql'), 'utf8');
// Схема v15 (до патча №16): первична /tmp/p16-baseline/schema.sql; если /tmp
// очищен (эфемерен) — извлекаем из git по пину patch15-коммита 319c4be.
let SCHEMA_V15;
try {
  SCHEMA_V15 = readFileSync('/tmp/p16-baseline/schema.sql', 'utf8');
} catch {
  SCHEMA_V15 = execFileSync('git', ['show', '319c4be:worker/schema.sql'], { cwd: REPO }).toString('utf8');
}
const MIGRATION_16 = readFileSync(join(REPO, 'worker/migration-16.sql'), 'utf8');

const WEBHOOK_SECRET = 'p16s-webhook-secret';
const BOT_TOKEN = 'p16s-bot-token';
const ADMIN_TOKEN = 'p16s-admin-token';
const USER = 777005;
const USER2 = 777006;

const results = [];
const ok = (id, detail = '') => {
  results.push({ id, status: 'OK' });
  console.log(`[OK] ${id}${detail ? ` — ${detail}` : ''}`);
};
const fail = (id, detail) => {
  results.push({ id, status: 'FAIL', detail });
  console.log(`[FAIL] ${id} — ${detail}`);
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const eq = (a, e, msg) => assert(a === e, `${msg}: ожидалось ${JSON.stringify(e)}, получено ${JSON.stringify(a)}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- initData (HMAC, как настоящий Telegram) ---------------- */
function signInitData(fields) {
  const keys = Object.keys(fields).sort();
  const dataCheckString = keys.map((k) => `${k}=${fields[k]}`).join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  return createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
}
function buildInitData(userId) {
  const fields = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'p16s-test',
    user: JSON.stringify({ id: userId, first_name: 'T' }),
  };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) params.set(k, v);
  params.set('hash', signInitData(fields));
  return params.toString();
}

/* ---------------- компиляция ---------------- */
const tmpDirs = [];
function compileWorker() {
  const tmp = mkdtempSync(join(REPO, '.tmp-p16-scen-worker-'));
  tmpDirs.push(tmp);
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ type: 'commonjs' }));
  execFileSync(
    process.execPath,
    [TSC, 'worker/src/index.ts', 'worker/src/grants.ts', 'worker/src/sql.ts',
      '--target', 'ES2021', '--module', 'commonjs', '--moduleResolution', 'node',
      '--strict', 'true', '--skipLibCheck', 'true', '--outDir', tmp],
    { stdio: 'pipe', cwd: REPO }
  );
  return createRequire(join(tmp, 'package.json'))(join(tmp, 'index.js')).default;
}
// Адаптация к main: src/game/UmamiAnalytics.ts в main нет (аналитика —
// src/systems/AnalyticsClient.ts, shop-модули её не импортируют).
const CLIENT_SOURCES = [
  'src/game/shop/TelegramStarsPaymentProvider.ts',
  'src/game/shop/PaymentProvider.ts',
  'src/game/shop/products.ts',
  'src/game/shop/PaymentLedger.ts',
  'src/game/shop/ServerWalletSync.ts',
  'src/game/shop/PendingWalletSync.ts',
  'src/game/meta/MetaWallet.ts',
  'src/game/daily/DailyCalendar.ts',
  'src/game/skins/SkinOwnership.ts',
  'src/game/skins/SkinCatalog.ts',
  'src/game/storageKeys.ts',
];
function compileClient(tag) {
  const tmp = mkdtempSync(join(REPO, `.tmp-p16-scen-client-${tag}-`));
  tmpDirs.push(tmp);
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ type: 'commonjs' }));
  execFileSync(
    process.execPath,
    [TSC, ...CLIENT_SOURCES, '--target', 'ES2020', '--module', 'commonjs',
      '--moduleResolution', 'node', '--rootDir', 'src', '--outDir', tmp,
      '--skipLibCheck', 'true', '--esModuleInterop', 'true'],
    { stdio: 'pipe', cwd: REPO }
  );
  const cr = createRequire(join(tmp, 'package.json'));
  return {
    provider: cr(join(tmp, 'game/shop/TelegramStarsPaymentProvider.js')),
    sync: cr(join(tmp, 'game/shop/ServerWalletSync.js')),
    pending: cr(join(tmp, 'game/shop/PendingWalletSync.js')),
    meta: cr(join(tmp, 'game/meta/MetaWallet.js')),
  };
}

/* ---------------- D1-адаптер поверх node:sqlite ----------------
 * prepare/bind/run/first/all + batch() как одна транзакция
 * (эквивалент семантики D1: ошибка → ROLLBACK всего батча). */
function makeSqliteD1(db) {
  const hooks = { failBatchAtStatement: -1 };
  return {
    hooks,
    prepare(sqlText) {
      const s = db.prepare(sqlText);
      const st = {
        _p: [],
        bind(...p) { st._p = p; return st; },
        run() {
          const r = s.run(...st._p);
          return { success: true, meta: { changes: Number(r.changes) } };
        },
        first(col) {
          const row = s.get(...st._p);
          if (row == null) return null;
          return col != null ? (row[col] ?? null) : row;
        },
        all() { return { results: s.all(...st._p) }; },
      };
      return st;
    },
    async batch(statements) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const out = [];
        let i = 0;
        for (const st of statements) {
          i += 1;
          if (hooks.failBatchAtStatement === i) throw new Error('sqlite-d1: injected batch failure');
          out.push(st.run());
        }
        db.exec('COMMIT');
        return out;
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch { /* ignore */ }
        throw e;
      }
    },
  };
}

/** Свежая БД (:memory:) со схемой v16 + адаптер. */
function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  return { db, d1: makeSqliteD1(db) };
}

function seedOrder(db, nonce, userId, productId, amountStars) {
  db.prepare(
    'INSERT INTO orders (nonce, user_id, product_id, amount_stars, sku_version, status, created_at) ' +
    "VALUES (?, ?, ?, ?, 2, 'pending', ?)"
  ).run(nonce, userId, productId, amountStars, Date.now());
}

function payBody(chargeId, nonce, { userId = USER, amount = 35 } = {}) {
  return {
    message: {
      from: { id: userId },
      successful_payment: {
        currency: 'XTR', total_amount: amount, invoice_payload: nonce,
        telegram_payment_charge_id: chargeId, provider_payment_charge_id: 'prov-1',
      },
    },
  };
}

const secHeader = { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET };
const adminHeader = { authorization: `Bearer ${ADMIN_TOKEN}` };

async function postWebhook(handler, d1, body) {
  return handler.fetch(
    new Request('https://worker.test/api/webhook', {
      method: 'POST', headers: { 'content-type': 'application/json', ...secHeader },
      body: JSON.stringify(body),
    }),
    { TELEGRAM_BOT_TOKEN: BOT_TOKEN, WEBHOOK_SECRET, PAYMENTS_DB: d1 }
  );
}
async function postRefund(handler, d1, body) {
  const r = await handler.fetch(
    new Request('https://worker.test/api/admin/refund', {
      method: 'POST', headers: { 'content-type': 'application/json', ...adminHeader },
      body: JSON.stringify(body),
    }),
    { TELEGRAM_BOT_TOKEN: BOT_TOKEN, WEBHOOK_SECRET, ADMIN_TOKEN, PAYMENTS_DB: d1 }
  );
  return { status: r.status, body: await r.json() };
}
async function postWallet(handler, d1, userId, sinceSeq = 0) {
  const r = await handler.fetch(
    new Request('https://worker.test/api/wallet', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initData: buildInitData(userId), since_seq: sinceSeq }),
    }),
    { TELEGRAM_BOT_TOKEN: BOT_TOKEN, WEBHOOK_SECRET, PAYMENTS_DB: d1 }
  );
  return { status: r.status, body: await r.json() };
}

/* Стаб Bot API (refundStarPayment) через globalThis.fetch. */
function stubBotApi({ refundOk = true } = {}) {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith('https://api.telegram.org/')) {
      const body = JSON.parse(opts.body);
      calls.push({ method: u.split('/').pop(), body });
      if (u.includes('/refundStarPayment') && !refundOk) {
        return new Response(JSON.stringify({ ok: false, description: 'test network fail' }),
          { headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ ok: true, result: true }),
        { headers: { 'content-type': 'application/json' } });
    }
    return prev(url, opts);
  };
  return { calls, restore: () => { globalThis.fetch = prev; } };
}

/* S1: конкурентные покупки same/diff SKU → 2000. */
async function s1(handler) {
  const id = 'S1: конкурентные покупки 500+1500 → 2000';
  const { db, d1 } = freshDb();
  try {
    seedOrder(db, 's1-nonce-01', USER, 'currency.rna-pack-s', 35);
    seedOrder(db, 's1-nonce-02', USER, 'currency.rna-pack-m', 100);
    const [r1, r2] = await Promise.all([
      postWebhook(handler, d1, payBody('s1-ch-1', 's1-nonce-01', { amount: 35 })),
      postWebhook(handler, d1, payBody('s1-ch-2', 's1-nonce-02', { amount: 100 })),
    ]);
    eq(r1.status, 200, 'webhook 1'); eq(r2.status, 200, 'webhook 2');
    const w = db.prepare('SELECT purchased_rna FROM wallets WHERE user_id=?').get(USER);
    eq(w?.purchased_rna, 2000, 'purchased_rna');
    ok(id);
  } catch (e) { fail(id, e.message); } finally { db.close(); }
}

/* S2: redelivery одного charge_id → ровно 1 грант. */
async function s2(handler) {
  const id = 'S2: redelivery → 1 грант (идемпотентность)';
  const { db, d1 } = freshDb();
  try {
    seedOrder(db, 's2-nonce-01', USER, 'currency.rna-pack-s', 35);
    const r1 = await postWebhook(handler, d1, payBody('s2-ch-1', 's2-nonce-01', { amount: 35 }));
    const r2 = await postWebhook(handler, d1, payBody('s2-ch-1', 's2-nonce-01', { amount: 35 }));
    eq(r1.status, 200, 'первая доставка'); eq(r2.status, 200, 'повторная доставка');
    eq(db.prepare('SELECT purchased_rna FROM wallets WHERE user_id=?').get(USER)?.purchased_rna, 500, 'purchased_rna');
    eq(db.prepare('SELECT COUNT(*) c FROM wallet_ledger WHERE charge_id=?').get('s2-ch-1')?.c, 1, 'ledger строк');
    ok(id);
  } catch (e) { fail(id, e.message); } finally { db.close(); }
}

/* S3: D1-fail между записью и грантом → 503, один батч → ничего не записано. */
async function s3(handler) {
  const id = 'S3: D1-fail mid-batch → 503, ноль записей';
  const { db, d1 } = freshDb();
  try {
    seedOrder(db, 's3-nonce-01', USER, 'currency.rna-pack-s', 35);
    d1.hooks.failBatchAtStatement = 1; // падение на первом statement батча
    const r = await postWebhook(handler, d1, payBody('s3-ch-1', 's3-nonce-01', { amount: 35 }));
    d1.hooks.failBatchAtStatement = -1;
    eq(r.status, 503, 'статус');
    eq(db.prepare('SELECT COUNT(*) c FROM payments').get()?.c, 0, 'платежей нет');
    eq(db.prepare('SELECT COUNT(*) c FROM wallet_ledger').get()?.c, 0, 'грантов нет');
    eq(db.prepare('SELECT status FROM orders WHERE nonce=?').get('s3-nonce-01')?.status, 'pending', 'заказ pending');
    ok(id);
  } catch (e) { fail(id, e.message); } finally { db.close(); }
}

/* S4: execute-refund: сбой Bot API → op requested; resume тем же operationId → completed. */
async function s4(handler) {
  const id = 'S4: refund execute: fail → requested → resume → completed';
  const { db, d1 } = freshDb();
  const bot = stubBotApi({ refundOk: false });
  try {
    seedOrder(db, 's4-nonce-01', USER, 'currency.rna-pack-s', 35);
    const w = await postWebhook(handler, d1, payBody('s4-ch-1', 's4-nonce-01', { amount: 35 }));
    eq(w.status, 200, 'платёж');
    eq(db.prepare('SELECT purchased_rna FROM wallets WHERE user_id=?').get(USER)?.purchased_rna, 500, 'кошелёк 500');
    const r1 = await postRefund(handler, d1, { chargeId: 's4-ch-1', reason: 's4', execute: true, operationId: 'op-s4' });
    eq(r1.status, 502, 'сбой refundStarPayment → 502');
    eq(r1.body.error, 'refund-failed', 'код ошибки');
    eq(db.prepare('SELECT status FROM refund_ops WHERE operation_id=?').get('op-s4')?.status, 'requested', 'op requested');
    eq(db.prepare('SELECT status FROM payments WHERE charge_id=?').get('s4-ch-1')?.status, 'refund_requested', 'бронь');
    eq(db.prepare('SELECT purchased_rna FROM wallets WHERE user_id=?').get(USER)?.purchased_rna, 500, 'кошелёк не тронут');
    bot.restore();
    const bot2 = stubBotApi({ refundOk: true });
    try {
      const r2 = await postRefund(handler, d1, { chargeId: 's4-ch-1', reason: 's4', execute: true, operationId: 'op-s4' });
      eq(r2.status, 200, 'resume → 200');
      eq(r2.body.ok, true, 'ok'); eq(r2.body.executed, true, 'executed');
      eq(db.prepare('SELECT status FROM payments WHERE charge_id=?').get('s4-ch-1')?.status, 'refunded', 'refunded');
      eq(db.prepare('SELECT purchased_rna FROM wallets WHERE user_id=?').get(USER)?.purchased_rna, 0, 'кошелёк откачен');
      eq(db.prepare('SELECT status FROM refund_ops WHERE operation_id=?').get('op-s4')?.status, 'completed', 'op completed');
      eq(db.prepare("SELECT COUNT(*) c FROM wallet_ledger WHERE kind='reversal'").get()?.c, 1, 'reversal в журнале');
    } finally { bot2.restore(); }
    ok(id);
  } catch (e) { fail(id, e.message); } finally { bot.restore(); db.close(); }
}

/* S5: 503 / timeout /api/wallet → pending-sync без ack. */
async function s5(client) {
  const id = 'S5: провал /api/wallet → pending-sync, ack не уходит';
  let prevFetch, prevWindow;
  try {
    const calls = { wallet: 0, ack: 0 };
    prevFetch = globalThis.fetch; prevWindow = globalThis.window;
    const mkFetch = (mode) => async (url) => {
      const u = String(url);
      if (u.endsWith('/api/wallet')) {
        calls.wallet += 1;
        if (mode === 'http503') return new Response(JSON.stringify({ error: 'x' }), { status: 503 });
        throw new Error('network down (timeout)');
      }
      if (u.endsWith('/api/ack')) { calls.ack += 1; return new Response('{}', { status: 200 }); }
      throw new Error(`s5: unexpected ${u}`);
    };
    const initData = `user=${encodeURIComponent(JSON.stringify({ id: USER }))}&hash=x`;
    globalThis.window = { Telegram: { WebApp: { initData } } };
    for (const mode of ['http503', 'timeout']) {
      globalThis.fetch = mkFetch(mode);
      const provider = new client.provider.TelegramStarsPaymentProvider({ apiBaseUrl: 'https://pay.test' });
      const r = await provider.syncWalletFromServer();
      assert(r.ok === false, `${mode}: sync ok=false`);
      provider.acknowledgeCharge(`s5-ch-${mode}`);
      await sleep(50);
      assert(provider.getPendingSyncCharges().includes(`s5-ch-${mode}`), `${mode}: в pending-sync`);
    }
    eq(calls.ack, 0, 'ack не уходил');
    ok(id, '503 и timeout → очередь, ack=0');
  } catch (e) { fail(id, e.message); } finally {
    globalThis.fetch = prevFetch;
    if (prevWindow === undefined) delete globalThis.window; else globalThis.window = prevWindow;
  }
}

/* S6: ресинк после сети → дрэйн подтверждает + ack, очередь пуста. */
async function s6(client) {
  const id = 'S6: ресинк → дрэйн подтверждает грант, ack уходит';
  let prevFetch, prevWindow;
  try {
    const ackCalls = [];
    prevFetch = globalThis.fetch; prevWindow = globalThis.window;
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.endsWith('/api/wallet')) return new Response(JSON.stringify({ error: 'x' }), { status: 503 });
      if (u.endsWith('/api/ack')) { ackCalls.push(u); return new Response('{}', { status: 200 }); }
      throw new Error(`s6: unexpected ${u}`);
    };
    const initData = `user=${encodeURIComponent(JSON.stringify({ id: USER }))}&hash=x`;
    globalThis.window = { Telegram: { WebApp: { initData } } };
    const provider = new client.provider.TelegramStarsPaymentProvider({ apiBaseUrl: 'https://pay.test' });
    const r0 = await provider.syncWalletFromServer();
    assert(r0.ok === false, 'первый синк провален');
    provider.acknowledgeCharge('s6-ch-1');
    await sleep(50);
    eq(ackCalls.length, 0, 'ack не ушёл до подтверждения');
    // Сеть вернулась: серверный журнал содержит грант.
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.endsWith('/api/wallet')) {
        return new Response(JSON.stringify({
          ok: true, user_id: USER, server_id: 's', schema_version: 2,
          purchased_rna: 500, booster_until_ms: 0, skins: [],
          ledger: [{ seq: 1, charge_id: 's6-ch-1', kind: 'grant', grant_type: 'rna', amount: 500, skin_id: null, created_at: 1 }],
          tip_seq: 1, ledger_tip: 1,
        }), { status: 200 });
      }
      if (u.endsWith('/api/ack')) { ackCalls.push(u); return new Response('{}', { status: 200 }); }
      throw new Error(`s6: unexpected ${u}`);
    };
    const drain = await provider.drainPendingWalletSyncQueue();
    eq(drain.ok, true, 'дрэйн ok');
    assert(drain.confirmed.includes('s6-ch-1'), 'charge подтверждён');
    await sleep(50);
    eq(ackCalls.length, 1, 'ack ушёл после подтверждения');
    eq(provider.getPendingSyncCharges().length, 0, 'очередь пуста');
    eq(Number(client.meta.loadMeta().rna), 500, 'грант материализован');
    ok(id);
  } catch (e) { fail(id, e.message); } finally {
    globalThis.fetch = prevFetch;
    if (prevWindow === undefined) delete globalThis.window; else globalThis.window = prevWindow;
  }
}

/* S7: wipe localStorage → точное восстановление по журналу (свежий клиент). */
async function s7(clientA, clientB) {
  const id = 'S7: wipe localStorage → точное восстановление (2000)';
  try {
    const ledger = [
      { seq: 1, charge_id: 's7-a', kind: 'grant', grant_type: 'rna', amount: 500, skin_id: null, created_at: 1 },
      { seq: 2, charge_id: 's7-b', kind: 'grant', grant_type: 'rna', amount: 1500, skin_id: null, created_at: 2 },
    ];
    const mkFetch = () => async (url) => {
      assert(String(url).endsWith('/api/wallet'), 'wallet endpoint');
      return new Response(JSON.stringify({
        ok: true, user_id: USER, server_id: 's', schema_version: 2,
        purchased_rna: 2000, booster_until_ms: 0, skins: [],
        ledger, tip_seq: 2, ledger_tip: 2,
      }), { status: 200 });
    };
    const opts = (f) => ({ apiBaseUrl: 'https://pay.test', initData: `user=${encodeURIComponent(JSON.stringify({ id: USER }))}&hash=x`, fetchFn: f });
    const r1 = await clientA.sync.syncServerWallet(opts(mkFetch()));
    assert(r1.ok, 'первый синк');
    eq(Number(clientA.meta.loadMeta().rna), 2000, 'баланс 2000');
    // wipe: совершенно свежее устройство/хранилище (новый модуль).
    const r2 = await clientB.sync.syncServerWallet(opts(mkFetch()));
    assert(r2.ok, 'синк после wipe');
    eq(Number(clientB.meta.loadMeta().rna), 2000, 'восстановлено ровно 2000');
    ok(id);
  } catch (e) { fail(id, e.message); }
}

/* S8: смена аккаунта — /api/wallet изолирован по user. */
async function s8(handler) {
  const id = 'S8: /api/wallet изолирован по пользователю';
  const { db, d1 } = freshDb();
  try {
    seedOrder(db, 's8-nonce-01', USER, 'currency.rna-pack-s', 35);
    seedOrder(db, 's8-nonce-02', USER2, 'currency.rna-pack-m', 100);
    const r1 = await postWebhook(handler, d1, payBody('s8-ch-1', 's8-nonce-01', { userId: USER, amount: 35 }));
    const r2 = await postWebhook(handler, d1, payBody('s8-ch-2', 's8-nonce-02', { userId: USER2, amount: 100 }));
    eq(r1.status, 200, 'w1'); eq(r2.status, 200, 'w2');
    const w1 = await postWallet(handler, d1, USER);
    const w2 = await postWallet(handler, d1, USER2);
    eq(w1.status, 200, 'wallet1'); eq(w2.status, 200, 'wallet2');
    eq(w1.body.user_id, USER, 'user_id эхом');
    eq(w1.body.ledger.length, 1, 'у user1 одна строка');
    eq(w1.body.ledger[0].charge_id, 's8-ch-1', 'чужих строк нет');
    eq(w1.body.purchased_rna, 500, 'total user1');
    eq(w2.body.ledger.length, 1, 'у user2 одна строка');
    eq(w2.body.purchased_rna, 1500, 'total user2');
    ok(id);
  } catch (e) { fail(id, e.message); } finally { db.close(); }
}

/* S9: два устройства — одинаковые локальные итоги после свежего синка. */
async function s9(handler, clientA, clientB) {
  const id = 'S9: два устройства → одинаковые итоги';
  const { db, d1 } = freshDb();
  try {
    seedOrder(db, 's9-nonce-01', USER, 'currency.rna-pack-s', 35);
    const w = await postWebhook(handler, d1, payBody('s9-ch-1', 's9-nonce-01', { amount: 35 }));
    eq(w.status, 200, 'платёж');
    const mkFetch = () => async (url, opts) => {
      assert(String(url).endsWith('/api/wallet'), 'wallet endpoint');
      const body = JSON.parse(opts.body);
      const wr = await postWallet(handler, d1, USER, typeof body.since_seq === 'number' ? body.since_seq : 0);
      assert(wr.status === 200, `worker wallet: ${wr.status}`);
      return new Response(JSON.stringify(wr.body), { status: 200 });
    };
    const opts = (f) => ({ apiBaseUrl: 'https://pay.test', initData: buildInitData(USER), fetchFn: f });
    const r1 = await clientA.sync.syncServerWallet(opts(mkFetch()));
    const r2 = await clientB.sync.syncServerWallet(opts(mkFetch()));
    assert(r1.ok && r2.ok, 'оба синка ok');
    const [a, b] = [Number(clientA.meta.loadMeta().rna), Number(clientB.meta.loadMeta().rna)];
    eq(a, 500, 'устройство 1'); eq(b, 500, 'устройство 2'); eq(a, b, 'итоги совпали');
    ok(id);
  } catch (e) { fail(id, e.message); } finally { db.close(); }
}

/* S10: возврат одного из двух скинов → второй остаётся active. */
async function s10(handler) {
  const id = 'S10: возврат одного скина → второй active';
  const { db, d1 } = freshDb();
  try {
    seedOrder(db, 's10-nonce-01', USER, 'skin.virulent-magenta', 100);
    seedOrder(db, 's10-nonce-02', USER, 'skin.abyssal-teal', 100);
    eq(((await postWebhook(handler, d1, payBody('s10-ch-1', 's10-nonce-01', { amount: 100 }))).status), 200, 'грант 1');
    eq(((await postWebhook(handler, d1, payBody('s10-ch-2', 's10-nonce-02', { amount: 100 }))).status), 200, 'грант 2');
    const rr = await postRefund(handler, d1, { chargeId: 's10-ch-1', reason: 's10', confirmExternalRefund: true, operationId: 'op-s10' });
    eq(rr.status, 200, 'refund'); eq(rr.body.ok, true, 'ok');
    const w = await postWallet(handler, d1, USER);
    eq(w.status, 200, 'wallet');
    eq(JSON.stringify(w.body.skins), JSON.stringify(['skin.abyssal-teal']), 'остался один скин');
    const st = (ch) => db.prepare('SELECT status FROM wallet_skins WHERE charge_id=?').get(ch)?.status;
    eq(st('s10-ch-1'), 'reversed', 'возвращённый погашен');
    eq(st('s10-ch-2'), 'active', 'второй активен');
    ok(id);
  } catch (e) { fail(id, e.message); } finally { db.close(); }
}

/* S11: покупка→возврат→ре-покупка РНК.
 * Сервер: purchased_rna=500 (грант 500 − возврат 500 + грант 500).
 * Инкрементальный клиент (синк после каждого шага): 1000 — residual risk:
 * первый грант материализован ДО возврата, не отзывается.
 * Свежий клиент (один синк): 500 — неттинг с reversal (P0-1, был баг 1000). */
async function s11(handler, clientA, clientB) {
  const id = 'S11: buy→refund→rebuy (inc=1000 residual, fresh=500 net)';
  const { db, d1 } = freshDb();
  try {
    seedOrder(db, 's11-nonce-01', USER, 'currency.rna-pack-s', 35);
    seedOrder(db, 's11-nonce-02', USER, 'currency.rna-pack-s', 35);
    const mkFetch = () => async (url, opts) => {
      const body = JSON.parse(opts.body);
      const wr = await postWallet(handler, d1, USER, typeof body.since_seq === 'number' ? body.since_seq : 0);
      return new Response(JSON.stringify(wr.body), { status: 200 });
    };
    const opts = (f) => ({ apiBaseUrl: 'https://pay.test', initData: buildInitData(USER), fetchFn: f });
    const inc = clientA;
    const step = async () => { const r = await inc.sync.syncServerWallet(opts(mkFetch())); assert(r.ok, 'inc sync'); };
    // НАСТОЯЩИЙ инкрементальный сценарий: синк ПОСЛЕ каждого шага.
    eq(((await postWebhook(handler, d1, payBody('s11-ch-1', 's11-nonce-01', { amount: 35 }))).status), 200, 'грант 1');
    await step(); // +500 (свежий синк одного гранта)
    const rr = await postRefund(handler, d1, { chargeId: 's11-ch-1', reason: 's11', confirmExternalRefund: true, operationId: 'op-s11' });
    eq(rr.body.ok, true, 'refund');
    await step(); // reversal старого гранта — только учёт (+0)
    eq(((await postWebhook(handler, d1, payBody('s11-ch-2', 's11-nonce-02', { amount: 35 }))).status), 200, 'грант 2');
    await step(); // +500
    const cInc = Number(inc.meta.loadMeta().rna);
    // Свежий клиент: один синк всего журнала.
    const rF = await clientB.sync.syncServerWallet(opts(mkFetch()));
    assert(rF.ok, 'fresh sync');
    const cFresh = Number(clientB.meta.loadMeta().rna);
    // P0-1: свежий клиент обязан неттить reversal → 500 (сервер), а не 1000 (баг).
    // Инкрементальный = 1000 — residual risk: первый грант материализован до возврата.
    eq(cFresh, 500, 'fresh: неттинг reversal'); eq(cInc, 1000, 'incremental: residual risk');
    ok(id);
  } catch (e) { fail(id, e.message); } finally { db.close(); }
}

/* S12: бустер+возврат — политика max(момент возврата, cur−E). */
async function s12(handler) {
  const id = 'S12: booster+refund → max(момент возврата, cur−E)';
  const { db, d1 } = freshDb();
  try {
    seedOrder(db, 's12-nonce-01', USER, 'booster.rna-x2-7d', 75);
    eq(((await postWebhook(handler, d1, payBody('s12-ch-1', 's12-nonce-01', { amount: 75 }))).status), 200, 'грант');
    const E = 7 * 86_400_000;
    const b1 = db.prepare('SELECT booster_until_ms FROM wallets WHERE user_id=?').get(USER)?.booster_until_ms;
    assert(typeof b1 === 'number' && b1 > 0, 'бустер выдан');
    const tBefore = Date.now();
    const rr = await postRefund(handler, d1, { chargeId: 's12-ch-1', reason: 's12', confirmExternalRefund: true, operationId: 'op-s12' });
    const tAfter = Date.now();
    eq(rr.body.ok, true, 'refund ok');
    const b2 = db.prepare('SELECT booster_until_ms FROM wallets WHERE user_id=?').get(USER)?.booster_until_ms;
    // Политика: время вспять не отматываем — max(момент возврата, b1−E).
    // b1−E = момент выдачи ≤ tBefore ≤ момент возврата ⇒ b2 ∈ [tBefore, tAfter].
    assert(b2 >= tBefore && b2 <= tAfter, `b2=${b2} вне [${tBefore}, ${tAfter}]`);
    assert(b2 < b1, 'срок уменьшился (возврат применён)');
    ok(id, `b1=${b1} → b2=${b2}`);
  } catch (e) { fail(id, e.message); } finally { db.close(); }
}

/* S13: unknown SKU → paid без гранта (громкий лог, ручное разрешение). */
async function s13(handler) {
  const id = 'S13: unknown SKU → paid, гранта нет';
  const { db, d1 } = freshDb();
  try {
    db.prepare(
      'INSERT INTO orders (nonce, user_id, product_id, amount_stars, sku_version, status, created_at) ' +
      "VALUES ('s13-nonce-01', ?, 'nope.unknown', 35, 2, 'pending', ?)"
    ).run(USER, Date.now());
    const logs = [];
    const origLog = console.log;
    console.log = (...a) => { logs.push(a.join(' ')); };
    let r;
    try {
      r = await postWebhook(handler, d1, payBody('s13-ch-1', 's13-nonce-01', { amount: 35 }));
    } finally { console.log = origLog; }
    eq(r.status, 200, 'статус');
    eq(db.prepare('SELECT status FROM payments WHERE charge_id=?').get('s13-ch-1')?.status, 'paid', 'платёж paid');
    eq(db.prepare('SELECT COUNT(*) c FROM wallet_ledger').get()?.c, 0, 'грантов нет');
    assert(logs.some((l) => l.includes('stars_payment_unknown_product')), 'громкий лог unknown_product');
    ok(id);
  } catch (e) { fail(id, e.message); } finally { db.close(); }
}

/* S14: миграция v15→v16 на БД с v15-данными. */
async function s14() {
  const id = 'S14: миграция v15→v16 сохраняет данные';
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(SCHEMA_V15);
    const now = Date.now();
    db.prepare("INSERT INTO orders (nonce, user_id, product_id, status, created_at) VALUES ('m-n1', ?, 'currency.rna-pack-s', 'paid', ?)")
      .run(USER, now);
    db.prepare("INSERT INTO payments (charge_id, user_id, product_id, amount, currency, status, nonce, created_at, fulfilled_at) VALUES ('m-ch-1', ?, 'currency.rna-pack-s', 35, 'XTR', 'paid', 'm-n1', ?, NULL)")
      .run(USER, now);
    db.prepare('INSERT INTO wallets (user_id, purchased_rna, booster_until_ms, skins_json, updated_at) VALUES (?, 500, 123456789, \'["skin.abyssal-teal"]\', ?)')
      .run(USER, now);
    db.prepare("INSERT INTO wallet_ledger (user_id, charge_id, kind, amount_text, created_at) VALUES (?, 'm-ch-1', 'rna', '500', ?)")
      .run(USER, now);
    db.prepare("INSERT INTO wallet_ledger (user_id, charge_id, kind, amount_text, created_at) VALUES (?, 'm-ch-2', 'booster', '7', ?)")
      .run(USER, now);
    db.prepare("INSERT INTO wallet_ledger (user_id, charge_id, kind, amount_text, created_at) VALUES (?, 'm-ch-3', 'skin', 'skin.abyssal-teal', ?)")
      .run(USER, now);
    db.exec(MIGRATION_16);
    eq(db.prepare("SELECT version FROM schema_migrations WHERE version='v16'").get()?.version, 'v16', 'маркер v16');
    const w = db.prepare('SELECT purchased_rna, booster_until_ms FROM wallets WHERE user_id=?').get(USER);
    eq(w?.purchased_rna, 500, 'purchased_rna сохранён');
    eq(w?.booster_until_ms, 123456789, 'booster сохранён');
    const rows = db.prepare('SELECT charge_id, kind, grant_type, amount, skin_id FROM wallet_ledger ORDER BY charge_id').all();
    eq(rows.length, 3, 'строк журнала');
    const byId = Object.fromEntries(rows.map((r) => [r.charge_id, r]));
    eq(byId['m-ch-1'].kind, 'grant', 'kind=grant'); eq(byId['m-ch-1'].grant_type, 'rna', 'rna'); eq(byId['m-ch-1'].amount, 500, 'amount 500');
    eq(byId['m-ch-2'].grant_type, 'booster', 'booster'); eq(byId['m-ch-2'].amount, 7 * 86_400_000, 'booster мс');
    eq(byId['m-ch-3'].grant_type, 'skin', 'skin'); eq(byId['m-ch-3'].skin_id, 'skin.abyssal-teal', 'skin_id');
    eq(db.prepare("SELECT status FROM wallet_skins WHERE charge_id='m-ch-3'").get()?.status, 'active', 'скин перенесён');
    ok(id);
  } catch (e) { fail(id, e.message); } finally { db.close(); }
}

/* S15: reconcile находит paid_without_grant и telegram_without_d1 (стаб). */
async function s15() {
  const id = 'S15: reconcile находит расхождения (стаб Telegram)';
  const dir = mkdtempSync(join(tmpdir(), 'p16-s15-'));
  try {
    const dump = {
      payments: [{ charge_id: 'ch-d1', user_id: USER, product_id: 'currency.rna-pack-s', status: 'paid', created_at: 1 }],
      orders: [], refund_ops: [],
    };
    const ledger = [];
    const dumpPath = join(dir, 'dump.json');
    const ledgerPath = join(dir, 'ledger.json');
    writeFileSync(dumpPath, JSON.stringify(dump));
    writeFileSync(ledgerPath, JSON.stringify(ledger));
    const fetchFn = async (url) => {
      assert(String(url).includes('getStarTransactions'), 'bot api call');
      return {
        ok: true,
        json: async () => ({
          ok: true,
          result: {
            transactions: [
              { id: 'ch-tg-ghost', amount: 100, source: { type: 'user', transaction_type: 'invoice_payment' } },
              { id: 'ch-d1', amount: 35, source: { type: 'user', transaction_type: 'invoice_payment' } },
            ],
          },
        }),
      };
    };
    const { findings } = await reconcile({ dump: dumpPath, ledger: ledgerPath, botToken: 'x', fetchFn, stuckMin: 60 });
    const codes = findings.map((f) => f.code);
    assert(codes.includes('paid_without_grant'), `нет paid_without_grant: ${codes.join(',')}`);
    assert(codes.includes('telegram_without_d1'), `нет telegram_without_d1: ${codes.join(',')}`);
    ok(id, codes.join(', '));
  } catch (e) { fail(id, e.message); } finally { rmSync(dir, { recursive: true, force: true }); }
}

/* S16: рестарт воркера mid-payment → повтор webhook идемпотентен. */
async function s16(handler) {
  const id = 'S16: рестарт воркера → повтор webhook идемпотентен';
  const dir = mkdtempSync(join(tmpdir(), 'p16-s16-'));
  const dbPath = join(dir, 's16.db');
  try {
    let db = new DatabaseSync(dbPath);
    db.exec(SCHEMA);
    seedOrder(db, 's16-nonce-01', USER, 'currency.rna-pack-s', 35);
    db.close();
    // «Первый запуск»: платёж проходит.
    db = new DatabaseSync(dbPath);
    const d1a = makeSqliteD1(db);
    const r1 = await postWebhook(handler, d1a, payBody('s16-ch-1', 's16-nonce-01', { amount: 35 }));
    eq(r1.status, 200, 'первая доставка');
    eq(db.prepare('SELECT purchased_rna FROM wallets WHERE user_id=?').get(USER)?.purchased_rna, 500, 'грант 500');
    db.close();
    // «Рестарт»: новый адаптер на том же файле; Telegram переотправляет апдейт.
    db = new DatabaseSync(dbPath);
    const d1b = makeSqliteD1(db);
    const r2 = await postWebhook(handler, d1b, payBody('s16-ch-1', 's16-nonce-01', { amount: 35 }));
    eq(r2.status, 200, 'повторная доставка');
    eq(db.prepare('SELECT purchased_rna FROM wallets WHERE user_id=?').get(USER)?.purchased_rna, 500, 'без двойного гранта');
    eq(db.prepare('SELECT COUNT(*) c FROM wallet_ledger WHERE charge_id=?').get('s16-ch-1')?.c, 1, 'одна строка');
    ok(id);
  } catch (e) { fail(id, e.message); } finally { rmSync(dir, { recursive: true, force: true }); }
}

/* ---------------- runner ---------------- */
async function main() {
  console.log('patch16-scenarios: 16 сценариев ТЗ (реальный worker + SQLite, стабы Telegram)');
  console.log('='.repeat(80));
  const handler = compileWorker();
  // Каждой sync-группе — свежие клиенты: курсоры/балансы/очереди не перетекают.
  const clientA = compileClient('a'); // s5
  const clientB = compileClient('b'); // s6
  const clientC = compileClient('c'); // s7
  const clientD = compileClient('d'); // s7
  const clientE = compileClient('e'); // s9
  const clientF = compileClient('f'); // s9
  const clientG = compileClient('g'); // s11
  const clientH = compileClient('h'); // s11
  await s1(handler);
  await s2(handler);
  await s3(handler);
  await s4(handler);
  await s5(clientA);
  await s6(clientB);
  await s7(clientC, clientD);
  await s8(handler);
  await s9(handler, clientE, clientF);
  await s10(handler);
  await s11(handler, clientG, clientH);
  await s12(handler);
  await s13(handler);
  await s14();
  await s15();
  await s16(handler);
  console.log('='.repeat(80));
  const nFail = results.filter((r) => r.status === 'FAIL').length;
  const nOk = results.filter((r) => r.status === 'OK').length;
  console.log(`ИТОГ: ${nOk} OK, ${nFail} FAIL из ${results.length}`);
  if (nFail > 0) process.exitCode = 1;
}

try {
  await main();
} finally {
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
