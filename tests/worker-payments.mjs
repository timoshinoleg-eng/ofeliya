/**
 * Worker payments backend — initData HMAC-валидация и серверный каталог.
 *
 * Строит тестовый вектор НЕЗАВИСИМО от кода воркера (node:crypto по схеме
 * из документации Telegram) и проверяет, что validateInitData его принимает,
 * а поддельные/протухшие данные отвергает. Компилирует worker/src/index.ts
 * через tsc (модуль экспортирует validateInitData/SERVER_PRODUCTS).
 */
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-worker-'));
writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'commonjs' }));
const require = createRequire(import.meta.url);

const assert = (condition, message) => {
  if (!condition) throw new Error(`worker-payments: ${message}`);
};

const BOT_TOKEN = '123456:TEST-TOKEN-ABCDEF';

/**
 * Независимый расчёт подписи по документации Telegram
 * (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
 * secret_key = HMAC_SHA256(bot_token, key="WebAppData").
 */
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
    { stdio: 'inherit' }
  );

  const { validateInitData, SERVER_PRODUCTS } = require(join(temp, 'index.js'));

  const now = Math.floor(Date.now() / 1000);
  const fields = {
    auth_date: String(now),
    query_id: 'AAE-test-query',
    user: JSON.stringify({ id: 777001, first_name: 'Test' }),
  };

  // --- валидная подпись принимается ---
  let v = await validateInitData(buildInitData(fields), BOT_TOKEN);
  assert(v.ok === true, 'valid signature accepted');
  assert(v.userId === 777001, 'user id extracted');

  // --- подмена user.id ломает подпись ---
  const tampered = { ...fields, user: JSON.stringify({ id: 999 }) };
  const tamperedParams = new URLSearchParams();
  for (const [k, val] of Object.entries(tampered)) tamperedParams.set(k, val);
  // подпись от ОРИГИНАЛЬНЫХ полей, данные — подменённые
  tamperedParams.set('hash', signInitData(fields));
  v = await validateInitData(tamperedParams.toString(), BOT_TOKEN);
  assert(v.ok === false && v.reason === 'bad-hash', 'tampered payload rejected');

  // --- чужой bot token не проходит ---
  v = await validateInitData(buildInitData(fields), '000000:WRONG');
  assert(v.ok === false && v.reason === 'bad-hash', 'wrong token rejected');

  // --- протухшая auth_date ---
  const stale = { ...fields, auth_date: String(now - 90000) };
  v = await validateInitData(buildInitData(stale), BOT_TOKEN);
  assert(v.ok === false && v.reason === 'stale-auth-date', 'stale auth_date rejected');

  // --- нет hash ---
  const noHash = new URLSearchParams();
  noHash.set('auth_date', String(now));
  v = await validateInitData(noHash.toString(), BOT_TOKEN);
  assert(v.ok === false && v.reason === 'no-hash', 'missing hash rejected');

  // --- мусор ---
  v = await validateInitData('not-a-query-string%%%', BOT_TOKEN);
  assert(v.ok === false, 'garbage rejected');

  // --- серверный каталог совпадает с клиентским (цены!) ---
  const { SHOP_CATALOG } = await (async () => {
    const t2 = mkdtempSync(join(tmpdir(), 'ofeliya-wcat-'));
    writeFileSync(join(t2, 'package.json'), JSON.stringify({ type: 'commonjs' }));
    try {
      execFileSync(
        process.execPath,
        [
          resolve('node_modules/typescript/bin/tsc'),
          'src/game/shop/PaymentProvider.ts',
          'src/game/shop/products.ts',
          '--target',
          'ES2020',
          '--module',
          'commonjs',
          '--moduleResolution',
          'node',
          '--outDir',
          t2,
          '--skipLibCheck',
          'true',
          '--esModuleInterop',
          'true',
        ],
        { stdio: 'inherit' }
      );
      return require(join(t2, 'products.js'));
    } finally {
      rmSync(t2, { recursive: true, force: true });
    }
  })();
  for (const p of SHOP_CATALOG) {
    const srv = SERVER_PRODUCTS[p.id];
    assert(srv !== undefined, `server catalog has ${p.id}`);
    assert(srv.stars === p.stars, `stars price match for ${p.id}: server=${srv.stars} client=${p.stars}`);
  }
  assert(
    Object.keys(SERVER_PRODUCTS).length === SHOP_CATALOG.length,
    'server catalog has no extra products'
  );

  // --- /api/invoice: nonce → createInvoiceLink + order в KV (протокол v2) ---
  // worker.fetch для вебхуков в этом файле не вызывается (только validateInitData
  // и каталог выше), поэтому WEBHOOK_SECRET здесь не нужен; invoice-блок ниже
  // стабит только Bot API (createInvoiceLink).
  const worker = require(join(temp, 'index.js')).default;
  const realFetch = globalThis.fetch;
  const botCalls = [];
  globalThis.fetch = async (_url, init) => {
    botCalls.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ ok: true, result: 'https://t.me/$inv-test' }) };
  };
  try {
    const kvMap = new Map();
    const kv = {
      async get(k) {
        return kvMap.has(k) ? kvMap.get(k) : null;
      },
      async put(k, v, _options) {
        kvMap.set(k, v);
      },
    };
    const invoicePost = async (env, body) => {
      const res = await worker.fetch(
        new Request('https://worker.test/api/invoice', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        env
      );
      let json = null;
      try {
        json = await res.json();
      } catch {
        // страховка
      }
      return { status: res.status, json };
    };
    const goodInit = buildInitData(fields);
    const invEnv = { TELEGRAM_BOT_TOKEN: BOT_TOKEN, PAYMENTS: kv };
    let inv = await invoicePost(invEnv, {
      initData: goodInit,
      productId: 'currency.rna-pack-s',
      nonce: 'nonce-inv-1',
    });
    assert(inv.status === 200, `invoice ok, got ${inv.status}`);
    assert(inv.json.invoiceUrl === 'https://t.me/$inv-test', 'invoice returns bot url');
    assert(inv.json.nonce === 'nonce-inv-1', 'invoice echoes nonce');
    const call = botCalls[botCalls.length - 1];
    assert(call.payload === 'nonce-inv-1', 'createInvoiceLink payload is the raw nonce');
    assert(call.currency === 'XTR', 'createInvoiceLink currency XTR');
    assert(call.provider_token === '', 'createInvoiceLink provider_token empty for Stars');
    assert(call.prices[0].amount === 35, 'createInvoiceLink amount is server stars price');
    const orderRaw = kvMap.get('order:nonce-inv-1');
    assert(orderRaw !== undefined, 'order written to KV');
    const order = JSON.parse(orderRaw);
    assert(order.userId === 777001, 'order stores userId');
    assert(order.productId === 'currency.rna-pack-s', 'order stores productId');
    inv = await invoicePost(invEnv, {
      initData: goodInit,
      productId: 'currency.rna-pack-s',
      nonce: 'x',
    });
    assert(inv.status === 400, 'bad nonce → 400');
    inv = await invoicePost(invEnv, {
      initData: goodInit,
      productId: 'nope.not-real',
      nonce: 'nonce-inv-2',
    });
    assert(inv.status === 400, 'unknown product → 400');
    inv = await invoicePost(invEnv, {
      initData: 'garbage',
      productId: 'currency.rna-pack-s',
      nonce: 'nonce-inv-3',
    });
    assert(inv.status === 401, 'bad initData → 401');
    // Без KV инвойс всё равно создаётся, заказ не трекается.
    inv = await invoicePost(
      { TELEGRAM_BOT_TOKEN: BOT_TOKEN },
      { initData: goodInit, productId: 'currency.rna-pack-s', nonce: 'nonce-inv-4' }
    );
    assert(inv.status === 200, 'invoice without KV still ok');
    assert(!kvMap.has('order:nonce-inv-4'), 'no order tracked without KV');
    // Падение записи заказа → честный 502 вместо битого трекинга.
    const throwingKv = {
      async get() {
        return null;
      },
      async put() {
        throw new Error('kv down');
      },
    };
    inv = await invoicePost(
      { TELEGRAM_BOT_TOKEN: BOT_TOKEN, PAYMENTS: throwingKv },
      { initData: goodInit, productId: 'currency.rna-pack-s', nonce: 'nonce-inv-5' }
    );
    assert(inv.status === 502, 'order-store failure → 502');
  } finally {
    globalThis.fetch = realFetch;
  }

  console.log('worker-payments: all assertions passed');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
