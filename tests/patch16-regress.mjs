/**
 * patch16-regress — регрессия багов платёжного контура патча №15.
 *
 * Поток TESTS патча №16.
 *  - ФАЗА 1: 6 сценариев воспроизводили баги №15 на старом коде (все FAIL,
 *    зафиксировано в tests/patch16-regress.FAIL.log, коммит 3e24728).
 *  - ФАЗА 2 (этот файл сейчас): те же 6 сценариев адаптированы к
 *    реализации WORKER/CLIENT потоков патча №16 и должны быть PASS:
 *    A1 — один атомарный батч из 3 statement'ов (worker/src/sql.ts);
 *    A2 — выдача триггером trg_wallet_ledger_apply (нет read→calc→write в JS);
 *    A3 — безопасный acknowledgeCharge + очередь pending-sync;
 *    A4 — seq-журнал: курсор {server_id:{tgUserId:{last_seq}}}, неттинг грантов;
 *    A5 — refund state machine (refund_ops, один батч journal+status+reversal).
 * Тесты не удалены, пороги не снижены: каждый assert фазы 1 сохранён как
 * инвариант, теперь он выполняется.
 *
 * Харнес: реальный worker/src/index.ts (tsc --strict, как требует новый код),
 * in-memory D1-стаб с эмуляцией триггера и атомарности батча
 * (snapshot/restore при инжектированной ошибке — как D1: весь батч
 * откатывается). Клиентский shop-чейн компилируется tsc в изолированные
 * каталоги (свой memStore/memFallback у каждого — для A4).
 *
 * Exit code: 0 — все OK, 1 — есть FAIL.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TSC = join(REPO, 'node_modules/typescript/bin/tsc');

const WEBHOOK_SECRET = 'p16-test-webhook-secret';
const TELEGRAM_BOT_TOKEN = 'p16-test-bot-token';
const ADMIN_TOKEN = 'p16-test-admin-token';
const USER = 777005;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function ok(id, detail = '') {
  results.push({ id, status: 'OK' });
  console.log(`[OK] ${id}${detail ? ` — ${detail}` : ''}`);
}
function fail(id, detail) {
  results.push({ id, status: 'FAIL', detail });
  console.log(`[FAIL] ${id} — ${detail}`);
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

/* ------------------------------------------------------------------ */
/* Компиляция worker (tsc --strict: новый index.ts требует narrowing)   */
/* и клиентского shop-чейна. Temp внутри репозитория (break_infinity).  */
/* ------------------------------------------------------------------ */
const tmpDirs = [];
function compileWorker() {
  const tmp = mkdtempSync(join(REPO, '.tmp-p16-regress-worker-'));
  tmpDirs.push(tmp);
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ type: 'commonjs' }));
  execFileSync(
    process.execPath,
    [
      TSC,
      'worker/src/index.ts',
      'worker/src/grants.ts',
      'worker/src/sql.ts',
      '--target', 'ES2021',
      '--module', 'commonjs',
      '--moduleResolution', 'node',
      '--strict', 'true',
      '--skipLibCheck', 'true',
      '--outDir', tmp,
    ],
    { stdio: 'pipe', cwd: REPO }
  );
  return createRequire(join(tmp, 'package.json'))(join(tmp, 'index.js')).default;
}

// Адаптация к main: src/game/UmamiAnalytics.ts в main нет (аналитика —
// src/systems/AnalyticsClient.ts, shop-модули её не импортируют), поэтому
// файл исключён из списка компиляции. Остальные entry points существуют
// в main; транзитивные импорты (grantPurchase, ClientExperience, …) tsc
// подтягивает сам.
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
  const tmp = mkdtempSync(join(REPO, `.tmp-p16-regress-client-${tag}-`));
  tmpDirs.push(tmp);
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ type: 'commonjs' }));
  execFileSync(
    process.execPath,
    [
      TSC,
      ...CLIENT_SOURCES,
      '--target', 'ES2020',
      '--module', 'commonjs',
      '--moduleResolution', 'node',
      '--rootDir', 'src',
      '--outDir', tmp,
      '--skipLibCheck', 'true',
      '--esModuleInterop', 'true',
    ],
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

/* ------------------------------------------------------------------ */
/* In-memory D1-стаб под протокол v16: новые SQL (worker/src/sql.ts),  */
/* эмуляция триггера trg_wallet_ledger_apply, атомарность батча         */
/* (snapshot/restore — как D1: ошибка любого statement откатывает всё). */
/* Хуки: failBatchAtStatement (n-й statement батча бросает),           */
/* parkLedgerInsert (парковка перед вставкой гранта — интерливинг A2).  */
/* ------------------------------------------------------------------ */
function makeD1() {
  const orders = new Map();
  const payments = new Map();
  const wallets = new Map();
  const ledger = new Map(); // charge_id -> row
  const walletSkins = new Map(); // charge_id -> row
  const refundOps = new Map();
  const hooks = { failBatchAtStatement: -1, parkLedgerInsert: false };
  const parked = [];
  let batchCalls = 0;
  const batchSizes = [];
  const norm = (sql) => sql.replace(/\s+/g, ' ').trim();

  const snapshot = () => ({
    orders: structuredClone(orders),
    payments: structuredClone(payments),
    wallets: structuredClone(wallets),
    ledger: structuredClone(ledger),
    walletSkins: structuredClone(walletSkins),
    refundOps: structuredClone(refundOps),
  });
  const restore = (s) => {
    for (const [m, v] of [[orders, s.orders], [payments, s.payments], [wallets, s.wallets], [ledger, s.ledger], [walletSkins, s.walletSkins], [refundOps, s.refundOps]]) {
      m.clear(); for (const [k, val] of v) m.set(k, val);
    }
  };

  /** Эмуляция trg_wallet_ledger_apply (см. worker/schema.sql). */
  function applyTrigger(row) {
    const { user_id, kind, grant_type, amount, skin_id, charge_id, reverses_charge_id, created_at } = row;
    let w = wallets.get(user_id);
    if (!w) {
      w = { user_id, purchased_rna: 0, booster_until_ms: 0, skins_json: '[]', updated_at: created_at };
      wallets.set(user_id, w);
    }
    if (kind === 'grant' && grant_type === 'rna') w.purchased_rna += amount;
    else if (kind === 'grant' && grant_type === 'booster') w.booster_until_ms = Math.max(w.booster_until_ms, created_at) + amount;
    else if (kind === 'grant' && grant_type === 'skin' && skin_id) {
      if (!walletSkins.has(charge_id)) {
        walletSkins.set(charge_id, { user_id, skin_id, charge_id, status: 'active', granted_at: created_at });
      }
    } else if (kind === 'reversal' && grant_type === 'rna') w.purchased_rna = Math.max(0, w.purchased_rna + amount);
    else if (kind === 'reversal' && grant_type === 'booster') w.booster_until_ms = Math.max(created_at, w.booster_until_ms + amount);
    else if (kind === 'reversal' && grant_type === 'skin' && reverses_charge_id) {
      const s = walletSkins.get(reverses_charge_id);
      if (s && s.status === 'active') s.status = 'reversed';
    }
    w.updated_at = created_at;
  }

  function execRun(sql, params, batchCtx) {
    const q = norm(sql);
    if (batchCtx && hooks.failBatchAtStatement === batchCtx.index) {
      throw new Error('d1-stub: injected statement failure');
    }
    if (q === "UPDATE orders SET status='paid' WHERE nonce=? AND status='pending'") {
      const [nonce] = params;
      const row = orders.get(nonce);
      if (row && row.status === 'pending') { row.status = 'paid'; return { success: true, meta: { changes: 1 } }; }
      return { success: true, meta: { changes: 0 } };
    }
    if (q.startsWith('INSERT INTO payments (charge_id,')) {
      const [charge_id, user_id, product_id, amount, currency, status, nonce, sku_version, created_at, fulfilled_at] = params;
      if (payments.has(charge_id)) return { success: true, meta: { changes: 0 } };
      for (const row of payments.values()) {
        if (row.nonce === nonce && nonce != null) throw new Error('UNIQUE constraint failed: payments.nonce');
      }
      payments.set(charge_id, { charge_id, user_id, product_id, amount, currency, status, nonce, sku_version, created_at, fulfilled_at });
      return { success: true, meta: { changes: 1 } };
    }
    if (q.startsWith('INSERT INTO wallet_ledger (user_id, charge_id, kind, grant_type,') && q.includes('VALUES')) {
      const [user_id, charge_id, kind, grant_type, amount, skin_id, reverses_charge_id, amount_text, created_at] = params;
      if (ledger.has(charge_id)) return { success: true, meta: { changes: 0 } };
      const row = { id: ledger.size + 1, user_id, charge_id, kind, grant_type, amount, skin_id, reverses_charge_id, amount_text, created_at };
      ledger.set(charge_id, row);
      applyTrigger(row);
      return { success: true, meta: { changes: 1 } };
    }
    if (q.startsWith('INSERT INTO wallet_ledger (user_id, charge_id, kind, grant_type,') && q.includes('SELECT')) {
      // SQL_INSERT_LEDGER_REVERSAL: params (rev_charge_id, created_at, orig_charge_id, orig_charge_id)
      const [rev_charge_id, created_at, orig_charge_id] = params;
      if (ledger.has(rev_charge_id)) return { success: true, meta: { changes: 0 } };
      const grant = ledger.get(orig_charge_id);
      const alreadyReversed = [...ledger.values()].some(
        (r) => r.kind === 'reversal' && r.reverses_charge_id === orig_charge_id
      );
      if (!grant || grant.kind !== 'grant' || alreadyReversed) return { success: true, meta: { changes: 0 } };
      const row = {
        id: ledger.size + 1, user_id: grant.user_id, charge_id: rev_charge_id, kind: 'reversal',
        grant_type: grant.grant_type, amount: -grant.amount, skin_id: grant.skin_id,
        reverses_charge_id: orig_charge_id, amount_text: `reversal-of:${orig_charge_id}`, created_at,
      };
      ledger.set(rev_charge_id, row);
      applyTrigger(row);
      return { success: true, meta: { changes: 1 } };
    }
    if (q.startsWith('INSERT INTO refund_ops')) {
      const [operation_id, charge_id, user_id, action, status, reason, telegram_confirmed_at, created_at, updated_at] = params;
      if (refundOps.has(operation_id)) throw new Error('UNIQUE constraint failed: refund_ops.operation_id');
      refundOps.set(operation_id, { operation_id, charge_id, user_id, action, status, reason, telegram_confirmed_at, created_at, updated_at });
      return { success: true, meta: { changes: 1 } };
    }
    if (q === "UPDATE payments SET status='refunded' WHERE charge_id=? AND status IN ('paid','fulfilled')") {
      const [charge_id] = params;
      const row = payments.get(charge_id);
      if (row && (row.status === 'paid' || row.status === 'fulfilled')) {
        row.status = 'refunded'; return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }
    throw new Error(`d1-stub: unsupported run SQL: ${q}`);
  }

  function execSelect(sql, params) {
    const q = norm(sql);
    if (q === 'SELECT user_id, product_id, status, amount_stars, sku_version, grant_rna, grant_booster_days, grant_skin_id FROM orders WHERE nonce=?') {
      const row = orders.get(params[0]);
      return row ? [{ user_id: row.user_id, product_id: row.product_id, status: row.status, amount_stars: row.amount_stars, sku_version: row.sku_version, grant_rna: row.grant_rna ?? null, grant_booster_days: row.grant_booster_days ?? null, grant_skin_id: row.grant_skin_id ?? null }] : [];
    }
    if (q === 'SELECT charge_id FROM payments WHERE nonce=?') {
      for (const row of payments.values()) if (row.nonce === params[0]) return [{ charge_id: row.charge_id }];
      return [];
    }
    if (q === 'SELECT charge_id, user_id, product_id, status FROM payments WHERE charge_id=?') {
      const row = payments.get(params[0]);
      return row ? [{ charge_id: row.charge_id, user_id: row.user_id, product_id: row.product_id, status: row.status }] : [];
    }
    if (q === 'SELECT operation_id, charge_id, action, status FROM refund_ops WHERE operation_id=?') {
      const row = refundOps.get(params[0]);
      return row ? [{ operation_id: row.operation_id, charge_id: row.charge_id, action: row.action, status: row.status }] : [];
    }
    throw new Error(`d1-stub: unsupported select SQL: ${q}`);
  }

  const db = {
    orders, payments, wallets, ledger, walletSkins, refundOps, hooks, parked,
    batchCalls: () => batchCalls,
    batchSizes,
    prepare(sql) {
      const st = {
        _params: [],
        _sql: sql,
        bind(...params) { st._params = params; return st; },
        async run() { return execRun(sql, st._params, null); },
        async first(column) {
          const rows = execSelect(sql, st._params);
          const row = rows[0] ?? null;
          if (row == null) return null;
          return column != null ? (row[column] ?? null) : row;
        },
        async all() { return { results: execSelect(sql, st._params) }; },
      };
      return st;
    },
    async batch(statements) {
      batchCalls += 1;
      batchSizes.push(statements.length);
      const snap = snapshot();
      try {
        const out = [];
        let i = 0;
        for (const st of statements) {
          i += 1;
          const nq = norm(st._sql);
          if (hooks.parkLedgerInsert && nq.startsWith('INSERT INTO wallet_ledger') && nq.includes('VALUES')) {
            await new Promise((res) => parked.push(res));
          }
          out.push(execRun(st._sql, st._params, { index: i }));
        }
        return out;
      } catch (e) {
        restore(snap); // D1: ошибка любого statement откатывает весь батч
        throw e;
      }
    },
  };
  return db;
}

function seedOrder(db, nonce, userId, productId, { amountStars = 35, skuVersion = 2, status = 'pending' } = {}) {
  db.orders.set(nonce, { nonce, user_id: userId, product_id: productId, amount_stars: amountStars, sku_version: skuVersion, status, created_at: Date.now() });
}

function paymentBody(chargeId, nonce, { userId = USER, amount = 35, currency = 'XTR' } = {}) {
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

function webhookReq(body) {
  return new Request('https://worker.test/api/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
    body: JSON.stringify(body),
  });
}

/** initData с user.id (новый клиент требует user для курсора; HMAC не нужен — парсинг клиентский). */
const initDataFor = (userId) =>
  `user=${encodeURIComponent(JSON.stringify({ id: userId, first_name: 'T' }))}&auth_date=1700000000&hash=x`;

/** fetchFn-стаб /api/wallet v2: серверный журнал, фильтр по since_seq. */
function walletFetchV2(rows, { serverId = 'test-server', userId = USER } = {}) {
  return async (url, opts) => {
    assert(String(url).endsWith('/api/wallet'), 'wallet endpoint');
    const body = JSON.parse(opts.body);
    const since = typeof body.since_seq === 'number' ? body.since_seq : 0;
    const ledger = rows
      .filter((r) => r.seq > since)
      .map((r) => ({
        seq: r.seq, charge_id: r.charge_id, kind: r.kind, grant_type: r.grant_type,
        amount: r.amount, skin_id: r.skin_id ?? null,
        reverses_charge_id: r.reverses_charge_id ?? null, created_at: r.created_at,
      }));
    const tip = rows.reduce((m, r) => Math.max(m, r.seq), 0);
    return new Response(
      JSON.stringify({
        ok: true, user_id: userId, server_id: serverId, schema_version: 2,
        purchased_rna: 0, booster_until_ms: 0, skins: [],
        ledger, tip_seq: tip, ledger_tip: null,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  };
}

const syncOpts = (fetchFn, userId = USER) => ({
  apiBaseUrl: 'https://pay.test',
  initData: initDataFor(userId),
  fetchFn,
});

/* A1: один атомарный батч из 3 statement'ов.
 * Инвариант фазы 1 («грант применён или ничего не записано») теперь
 * выполняется структурно: ошибка любого statement откатывает весь батч. */
async function testA1(handler) {
  const id = 'A1: атомарный батч — сбой statement → ничего не записано';
  try {
    const db = makeD1();
    const env = { TELEGRAM_BOT_TOKEN, WEBHOOK_SECRET, PAYMENTS_DB: db };
    // Позитивный путь: ровно ОДИН батч из 3 statement'ов.
    seedOrder(db, 'a1-nonce-01', USER, 'currency.rna-pack-s');
    const r1 = await handler.fetch(webhookReq(paymentBody('a1-charge-01', 'a1-nonce-01')), env);
    assert(r1.status === 200, `webhook: ${r1.status}`);
    assert(db.batchCalls() === 1, `батчей на платёж: ${db.batchCalls()}, ожидался 1`);
    assert(db.batchSizes[0] === 3, `statement'ов в батче: ${db.batchSizes[0]}, ожидалось 3`);
    assert(db.payments.get('a1-charge-01')?.status === 'paid', 'платёж paid');
    assert(db.ledger.get('a1-charge-01')?.kind === 'grant', 'грант в журнале');
    assert(db.wallets.get(USER)?.purchased_rna === 500, 'кошелёк +500 (триггер)');
    // Негативный путь: падение 2-го statement → весь батч откачен.
    seedOrder(db, 'a1-nonce-02', USER, 'currency.rna-pack-s');
    db.hooks.failBatchAtStatement = 2;
    const r2 = await handler.fetch(webhookReq(paymentBody('a1-charge-02', 'a1-nonce-02')), env);
    db.hooks.failBatchAtStatement = -1;
    assert(r2.status === 503, `ожидался 503 (ретрай Telegram), получен ${r2.status}`);
    assert(!db.payments.has('a1-charge-02'), 'платёж НЕ записан при сбое батча');
    assert(!db.ledger.has('a1-charge-02'), 'грант НЕ записан при сбое батча');
    assert(db.orders.get('a1-nonce-02')?.status === 'pending', 'заказ остался pending');
    assert(db.wallets.get(USER)?.purchased_rna === 500, 'кошелёк не тронут сбоем (только грант №1)');
    ok(id, '1 батч / 3 statement; сбой → 503 и ноль записей');
  } catch (e) {
    fail(id, e.message);
  }
}

/* A2: конкурентные гранты — триггер делает += атомарно, read→calc→write
 * в JS больше нет. Тот же интерливинг, что ронял №15. */
async function testA2(handler) {
  const id = 'A2: конкурентные гранты суммируются (2×500=1000), redelivery — 1 грант';
  try {
    const db = makeD1();
    const env = { TELEGRAM_BOT_TOKEN, WEBHOOK_SECRET, PAYMENTS_DB: db };
    seedOrder(db, 'a2-nonce-01', USER, 'currency.rna-pack-s');
    seedOrder(db, 'a2-nonce-02', USER, 'currency.rna-pack-s');
    db.hooks.parkLedgerInsert = true; // оба зависнут перед вставкой гранта
    const p1 = handler.fetch(webhookReq(paymentBody('a2-charge-01', 'a2-nonce-01')), env);
    const p2 = handler.fetch(webhookReq(paymentBody('a2-charge-02', 'a2-nonce-02')), env);
    const t0 = Date.now();
    while (db.parked.length < 2) {
      assert(Date.now() - t0 < 5000, 'харнес: оба вызова не дошли до вставки гранта');
      await sleep(5);
    }
    db.parked.splice(0).forEach((r) => r());
    db.hooks.parkLedgerInsert = false;
    const [r1, r2] = await Promise.all([p1, p2]);
    assert(r1.status === 200 && r2.status === 200, `webhook: ${r1.status}/${r2.status}`);
    assert(db.wallets.get(USER)?.purchased_rna === 1000,
      `итог purchased_rna=${db.wallets.get(USER)?.purchased_rna}, ожидалось 1000`);
    // Redelivery того же charge_id — идемпотентно, триггер не срабатывает повторно.
    seedOrder(db, 'a2-nonce-01b', USER, 'currency.rna-pack-s');
    const rd = await handler.fetch(webhookReq(paymentBody('a2-charge-01', 'a2-nonce-01')), env);
    assert(rd.status === 200, `redelivery: ${rd.status}`);
    assert(db.wallets.get(USER)?.purchased_rna === 1000, 'redelivery не удвоил грант');
    assert([...db.ledger.values()].filter((l) => l.charge_id === 'a2-charge-01').length === 1,
      'одна ledger-строка на charge_id');
    ok(id, '1000 ровно; дубликат — no-op');
  } catch (e) {
    fail(id, e.message);
  }
}

/* A3: /api/wallet → 503. Новый флоу: sync {ok:false} → acknowledgeCharge
 * НЕ шлёт ack, а кладёт запись в pending-sync очередь. */
async function testA3(client) {
  const id = 'A3: провал синка → ack не уходит, покупка в pending-sync';
  let prevFetch, prevWindow;
  try {
    const calls = { wallet: 0, ack: 0 };
    prevFetch = globalThis.fetch;
    prevWindow = globalThis.window;
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.endsWith('/api/wallet')) {
        calls.wallet += 1;
        return new Response(JSON.stringify({ error: 'db_unavailable' }), { status: 503 });
      }
      if (u.endsWith('/api/ack')) {
        calls.ack += 1;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      throw new Error(`a3: unexpected fetch ${u}`);
    };
    globalThis.window = { Telegram: { WebApp: { initData: initDataFor(USER) } } };
    const provider = new client.provider.TelegramStarsPaymentProvider({ apiBaseUrl: 'https://pay.test' });
    const syncRes = await provider.syncWalletFromServer();
    assert(syncRes && syncRes.ok === false, `синк должен провалиться: ${JSON.stringify(syncRes)}`);
    assert(calls.wallet === 1, `вызовов /api/wallet: ${calls.wallet}`);
    // Безопасный ack: материализация не подтверждена → в очередь, не на сервер.
    provider.acknowledgeCharge('a3-charge-01');
    await sleep(100);
    assert(calls.ack === 0, `ack ушёл (${calls.ack}) при неподтверждённой материализации`);
    const q = provider.getPendingSyncCharges();
    assert(Array.isArray(q) && q.includes('a3-charge-01'),
      `покупка не встала в pending-sync: ${JSON.stringify(q)}`);
    ok(id, 'ack=0, очередь pending-sync содержит charge');
  } catch (e) {
    fail(id, e.message);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
  }
}

/* A4a: seq-журнал — свежий синк неттит reversal (P0-1), инкрементальный
 * хранит уже материализованное (residual risk).
 * История: грант 500 (c1a), reversal c1a, грант 500 (c1c). Сервер: 500.
 * Клиент1 (3 синка): +500, reversal старого гранта — только учёт (+0),
 * +500 → 1000 (500 residual: материализовано до возврата, не отзывается).
 * Клиент2 (свежий синк): неттинг 500−500+500 = 500. Баг P0-1 давал 1000. */
async function testA4a(clientA, clientB) {
  const id = 'A4a: seq-журнал (c1=1000 residual, c2=500 net)';
  try {
    const rows = [
      { seq: 1, charge_id: 'c1a', kind: 'grant', grant_type: 'rna', amount: 500, created_at: 1000 },
      { seq: 2, charge_id: 'c1b', kind: 'reversal', grant_type: 'rna', amount: -500, reverses_charge_id: 'c1a', created_at: 2000 },
      { seq: 3, charge_id: 'c1c', kind: 'grant', grant_type: 'rna', amount: 500, created_at: 3000 },
    ];
    const live = [];
    const fetchFor = () => walletFetchV2(live);
    // Клиент1: три инкрементальных синка по мере появления событий.
    live.push(rows[0]);
    let r = await clientA.sync.syncServerWallet(syncOpts(fetchFor()));
    assert(r.ok && r.applied.rna === 500, `c1 шаг1: ${JSON.stringify(r)}`);
    live.push(rows[1]);
    r = await clientA.sync.syncServerWallet(syncOpts(fetchFor()));
    assert(r.ok && r.applied.rna === 0, `c1 шаг2 (reversal — только учёт): ${JSON.stringify(r)}`);
    live.push(rows[2]);
    r = await clientA.sync.syncServerWallet(syncOpts(fetchFor()));
    assert(r.ok && r.applied.rna === 500, `c1 шаг3: ${JSON.stringify(r)}`);
    const c1 = Number(clientA.meta.loadMeta().rna);
    // Клиент2: один свежий синк всего журнала → неттинг с reversal.
    r = await clientB.sync.syncServerWallet(syncOpts(walletFetchV2(rows)));
    assert(r.ok, `c2: ${JSON.stringify(r)}`);
    const c2 = Number(clientB.meta.loadMeta().rna);
    // P0-1: c2 обязан быть 500 (сервер), а не 1000 (баг — игнор reversal).
    // c1=1000 — residual risk: материализовано до возврата, не отзывается.
    assert(c1 === 1000 && c2 === 500, `c1=${c1} (residual), c2=${c2} (net; ожидалось 1000/500)`);
    ok(id, 'свежий синк неттит reversal; инкрементальный хранит residual');
  } catch (e) {
    fail(id, e.message);
  }
}

/* A4b: курсор изолирован по (server_id, tgUserId).
 * user1 +500, user2 +200 → локально 700, фантомного гранта нет. */
async function testA4b(client) {
  const id = 'A4b: курсор изолирован по пользователю (700, без фантома)';
  try {
    const rows1 = [{ seq: 1, charge_id: 'u1a', kind: 'grant', grant_type: 'rna', amount: 500, created_at: 1000 }];
    const rows2 = [{ seq: 1, charge_id: 'u2a', kind: 'grant', grant_type: 'rna', amount: 200, created_at: 1000 }];
    let r = await client.sync.syncServerWallet(syncOpts(walletFetchV2(rows1), 1));
    assert(r.ok && r.applied.rna === 500, `user1: ${JSON.stringify(r)}`);
    r = await client.sync.syncServerWallet(syncOpts(walletFetchV2(rows2), 2));
    assert(r.ok && r.applied.rna === 200, `user2 (свежий курсор): ${JSON.stringify(r)}`);
    r = await client.sync.syncServerWallet(syncOpts(walletFetchV2(rows1), 1));
    assert(r.ok && r.applied.rna === 0, `user1 снова (событий нет): ${JSON.stringify(r)}`);
    const local = Number(client.meta.loadMeta().rna);
    assert(local === 700, `локально ${local} РНК, ожидалось 700 (500+200 без фантома)`);
    ok(id, 'per-user курсоры, чужой total не применяется');
  } catch (e) {
    fail(id, e.message);
  }
}

/* A5: refund state machine — пометка+статус+reversal одним батчем.
 * Сбой mid-batch → 502 и НИЧЕГО не применено (атомарно); повтор с тем же
 * operationId докатывает; already:true — только при реально откаченном. */
async function testA5(handler) {
  const id = 'A5: refund атомарен; already:true только при откаченном кошельке';
  try {
    const db = makeD1();
    const env = { TELEGRAM_BOT_TOKEN, WEBHOOK_SECRET, ADMIN_TOKEN, PAYMENTS_DB: db };
    seedOrder(db, 'a5-nonce-01', USER, 'currency.rna-pack-s');
    seedOrder(db, 'a5-nonce-02', USER, 'currency.rna-pack-s');
    const w1 = await handler.fetch(webhookReq(paymentBody('a5-charge-01', 'a5-nonce-01')), env);
    const w2 = await handler.fetch(webhookReq(paymentBody('a5-charge-02', 'a5-nonce-02')), env);
    assert(w1.status === 200 && w2.status === 200, `платежи: ${w1.status}/${w2.status}`);
    assert(db.wallets.get(USER)?.purchased_rna === 1000, 'кошелёк 1000 до refund');
    const refundReq = (opId, charge) =>
      new Request('https://worker.test/api/admin/refund', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${ADMIN_TOKEN}` },
        body: JSON.stringify({ chargeId: charge, reason: 'p16-a5', confirmExternalRefund: true, operationId: opId }),
      });
    // Сбой mid-batch (2-й statement): 502, ничего не применено.
    db.hooks.failBatchAtStatement = 2;
    const r1 = await handler.fetch(refundReq('op-a5-2', 'a5-charge-02'), env);
    db.hooks.failBatchAtStatement = -1;
    assert(r1.status === 502, `сбойный refund: ${r1.status}`);
    assert(db.payments.get('a5-charge-02')?.status === 'paid', 'платёж остался paid');
    assert(db.wallets.get(USER)?.purchased_rna === 1000, 'кошелёк не тронут');
    assert(!db.refundOps.has('op-a5-2'), 'операция не записана (откат)');
    // Повтор с тем же operationId — докатывает до конца.
    const r2 = await handler.fetch(refundReq('op-a5-2', 'a5-charge-02'), env);
    const b2 = await r2.json();
    assert(r2.status === 200 && b2.ok === true, `повтор: ${r2.status} ${JSON.stringify(b2)}`);
    assert(db.payments.get('a5-charge-02')?.status === 'refunded', 'платёж refunded');
    assert(db.wallets.get(USER)?.purchased_rna === 500, 'кошелёк откачен reversal (1000−500)');
    assert([...db.ledger.values()].some((l) => l.kind === 'reversal' && l.reverses_charge_id === 'a5-charge-02'),
      'reversal-строка в журнале');
    // Повтор завершённого — already:true ПРИ откаченном кошельке.
    const r3 = await handler.fetch(refundReq('op-a5-2', 'a5-charge-02'), env);
    const b3 = await r3.json();
    assert(r3.status === 200 && b3.ok === true && b3.already === true,
      `идемпотентный повтор: ${JSON.stringify(b3)}`);
    assert(db.wallets.get(USER)?.purchased_rna === 500, 'двойного отката нет');
    ok(id, '502→retry→already:true, кошелёк корректен');
  } catch (e) {
    fail(id, e.message);
  }
}

/* ------------------------------------------------------------------ */
/* Runner                                                               */
/* ------------------------------------------------------------------ */
async function main() {
  console.log('patch16-regress: ФАЗА 2 — те же 6 сценариев на реализации №16 (ожидаются OK)');
  console.log('='.repeat(80));
  const handler = compileWorker();
  const clientA = compileClient('a');
  const clientB = compileClient('b');
  const clientC = compileClient('c');
  const clientD = compileClient('d');
  await testA1(handler);
  await testA2(handler);
  await testA3(clientA);
  await testA4a(clientB, clientC);
  await testA4b(clientD);
  await testA5(handler);
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
