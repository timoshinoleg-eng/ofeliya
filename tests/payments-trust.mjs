/**
 * Payments trust contract — патч №13 (P0-1 / P0-2 / P1-a / P1-d / P1-e).
 *
 * Честный мок fetch: отвечает на /api/entitlements (v3 worker'а),
 * /api/verify и /api/ack. Локальное хранилище — in-memory (как lab-economy).
 *
 * Covers:
 * - P1-e: successful_payment получен, Mini App закрыт до выдачи —
 *   серверный журнал содержит 'paid', локальные credited/pending пусты →
 *   restore() вызывает fulfillPurchase и начисляет (товар не теряется);
 * - повторный restore — тишина (идемпотентность по chargeId);
 * - 'refunded' — пропуск (ни гранта, ни пометки, ни ack);
 * - продукта нет в каталоге — warn + пропуск БЕЗ пометки credited;
 * - уже credited — пропуск без повторного гранта;
 * - P1-d: POST /api/ack {initData, chargeId} после УСПЕШНОЙ выдачи
 *   (paid→fulfilled bookkeeping); ack НЕ вызывается при неуспешной выдаче;
 *   падение ack не блокирует выдачу (fire-and-forget);
 * - P0-2: verifyPurchase возвращает серверный productId;
 * - P1-a: fulfillPurchase → {ok:false} на invalid-product.
 *
 * Адаптация к main (в отличие от стека): MetaWallet на plain numbers
 * (rna — число, не Decimal-строка), debugResetMeta нет — сброс через
 * store.clear() + clearPendingPurchases/clearCreditedCharges.
 * Compiles the TS modules with tsc like the other node-side contract tests.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-payments-trust-'));
writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'commonjs' }));
const require = createRequire(import.meta.url);

const assert = (condition, message) => {
  if (!condition) throw new Error(`payments-trust: ${message}`);
};
const eq = (actual, expected, message) =>
  assert(actual === expected, `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

// In-memory localStorage — модули читают его динамически, сброс через clear().
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/game/shop/PaymentProvider.ts',
      'src/game/shop/products.ts',
      'src/game/shop/PaymentLedger.ts',
      'src/game/shop/MockPaymentProvider.ts',
      'src/game/shop/MaxBridgePaymentProvider.ts',
      'src/game/shop/TelegramStarsPaymentProvider.ts',
      'src/game/shop/Storefront.ts',
      'src/game/shop/grantPurchase.ts',
      '--target',
      'ES2020',
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

  // tsc follows imports into src/game/meta, src/game/skins, src/systems —
  // common root is src/, outputs land in game/shop/, game/meta/, ....
  const { SHOP_CATALOG } = require(join(temp, 'game', 'shop', 'products.js'));
  const { TelegramStarsPaymentProvider } = require(
    join(temp, 'game', 'shop', 'TelegramStarsPaymentProvider.js')
  );
  const ledger = require(join(temp, 'game', 'shop', 'PaymentLedger.js'));
  const mw = require(join(temp, 'game', 'meta', 'MetaWallet.js'));

  const withWindow = (webApp) => {
    globalThis.window = { Telegram: { WebApp: webApp } };
  };
  const clearWindow = () => {
    delete globalThis.window;
  };
  const realFetch = globalThis.fetch;
  // fire-and-forget ack выполняется вне await restore() — даём микрозадачам долететь.
  const flush = () => new Promise((r) => setTimeout(r, 10));

  // worker v3: {purchases:[{chargeId, productId, status, createdAt}]}
  let entitlementPurchases = [];
  let ackCalls = [];
  let ackBehavior = 'ok'; // 'ok' | 'fail'
  const honestFetch = async (url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : {};
    if (String(url).endsWith('/api/entitlements')) {
      return { ok: true, json: async () => ({ purchases: entitlementPurchases }) };
    }
    if (String(url).endsWith('/api/ack')) {
      assert(typeof body.initData === 'string' && body.initData.length > 0, 'ack: initData');
      assert(typeof body.chargeId === 'string' && body.chargeId.length > 0, 'ack: chargeId');
      ackCalls.push(body);
      if (ackBehavior === 'fail') throw new Error('ack backend down');
      return { ok: true, json: async () => ({ ok: true }) };
    }
    throw new Error(`payments-trust: unexpected fetch ${url}`);
  };
  globalThis.fetch = honestFetch;

  const resetAll = () => {
    store.clear();
    ledger.clearPendingPurchases();
    ledger.clearCreditedCharges();
    entitlementPurchases = [];
    ackCalls = [];
    ackBehavior = 'ok';
  };

  const packS = SHOP_CATALOG.find((p) => p.id === 'currency.rna-pack-s');
  assert(packS, 'pack-s fixture present');
  withWindow({ openInvoice: () => {}, initData: 'tg-init-data' });
  const provider = new TelegramStarsPaymentProvider({ apiBaseUrl: 'https://pay.example' });

  // === P1-e: successful_payment получен, Mini App закрыт до выдачи ===
  // Серверный журнал: 'paid'. Локальные credited/pending: пусто
  // (процесс умер между вебхуком и выдачей).
  // → restore() вызывает fulfillPurchase и начисляет. Товар не теряется.
  resetAll();
  entitlementPurchases = [
    { chargeId: 'ch_p1e_1', productId: packS.id, status: 'paid', createdAt: 1700000000000 },
  ];
  eq(ledger.loadPendingPurchases().length, 0, 'P1-e: pending пуст (приложение было закрыто)');
  assert(!ledger.isChargeCredited('ch_p1e_1'), 'P1-e: credited пуст (приложение было закрыто)');
  eq(mw.loadMeta().rna, 0, 'P1-e: баланс пуст до restore');
  const r1 = await provider.restore();
  await flush();
  assert(r1.productIds.includes(packS.id), 'P1-e: entitlement виден UI');
  eq(mw.loadMeta().rna, 500, 'P1-e: restore начислил товар из серверного журнала');
  eq(mw.loadMeta().starsSpent, 35, 'P1-e: starsSpent записан');
  assert(ledger.isChargeCredited('ch_p1e_1'), 'P1-e: chargeId помечен выданным');
  eq(ackCalls.length, 1, 'P1-e: ack отправлен после успешной выдачи');
  eq(ackCalls[0].chargeId, 'ch_p1e_1', 'P1-e: ack несёт chargeId');
  eq(ackCalls[0].initData, 'tg-init-data', 'P1-e: ack несёт initData');
  // Повторный restore — тишина (идемпотентность по chargeId).
  const r2 = await provider.restore();
  await flush();
  eq(mw.loadMeta().rna, 500, 'P1-e: повторный restore не дублирует грант');
  eq(ackCalls.length, 1, 'P1-e: повторный restore не шлёт ack (already credited → skip)');
  eq(r2.pendingFulfilled.length, 0, 'P1-e: pendingFulfilled пуст');

  // === 'refunded' — пропуск: ни гранта, ни пометки, ни ack ===
  resetAll();
  entitlementPurchases = [
    { chargeId: 'ch_ref_1', productId: packS.id, status: 'refunded', createdAt: 0 },
  ];
  const rRef = await provider.restore();
  await flush();
  eq(mw.loadMeta().rna, 0, 'refunded: гранта нет');
  assert(!ledger.isChargeCredited('ch_ref_1'), 'refunded: не помечен');
  assert(!rRef.productIds.includes(packS.id), 'refunded: не виден UI');
  eq(ackCalls.length, 0, 'refunded: ack нет');

  // === Продукта нет в каталоге — warn + пропуск БЕЗ пометки ===
  resetAll();
  const warns = [];
  const origWarn = console.warn;
  console.warn = (...a) => void warns.push(a.join(' '));
  try {
    entitlementPurchases = [
      { chargeId: 'ch_ghost_1', productId: 'nope.not-real', status: 'paid', createdAt: 0 },
    ];
    await provider.restore();
    await flush();
  } finally {
    console.warn = origWarn;
  }
  assert(warns.some((w) => w.includes('unknown product')), 'unknown product: warn залогирован');
  assert(!ledger.isChargeCredited('ch_ghost_1'), 'unknown product: НЕ помечен (след не теряем)');
  eq(mw.loadMeta().rna, 0, 'unknown product: гранта нет');
  eq(ackCalls.length, 0, 'unknown product: ack нет');

  // === Уже credited — пропуск без повторного гранта ===
  resetAll();
  ledger.markChargeCredited('ch_old_1');
  entitlementPurchases = [
    { chargeId: 'ch_old_1', productId: packS.id, status: 'paid', createdAt: 0 },
  ];
  await provider.restore();
  await flush();
  eq(mw.loadMeta().rna, 0, 'already credited: повторного гранта нет');
  eq(ackCalls.length, 0, 'already credited: ack нет (skip-путь)');

  // === status 'credited' (зарезервирован воркером): пометка без гранта ===
  resetAll();
  entitlementPurchases = [
    { chargeId: 'ch_crd_1', productId: packS.id, status: 'credited', createdAt: 0 },
  ];
  const rCrd = await provider.restore();
  await flush();
  eq(mw.loadMeta().rna, 0, 'credited: гранта нет (сервер утверждает, что выдал)');
  assert(ledger.isChargeCredited('ch_crd_1'), 'credited: помечен');
  assert(rCrd.productIds.includes(packS.id), 'credited: виден UI');
  eq(ackCalls.length, 0, 'credited: ack нет (локального гранта не было)');

  // === ack НЕ вызывается при неуспешной выдаче (fulfillPurchase → ok=false) ===
  resetAll();
  entitlementPurchases = [
    { chargeId: 'ch_fail_1', productId: packS.id, status: 'paid', createdAt: 0 },
  ];
  const origAddRna = mw.addRna;
  mw.addRna = () => {
    throw new Error('grant boom');
  };
  try {
    await provider.restore();
    await flush();
  } finally {
    mw.addRna = origAddRna;
  }
  eq(mw.loadMeta().rna, 0, 'failed grant: начисления нет');
  assert(!ledger.isChargeCredited('ch_fail_1'), 'failed grant: не помечен (ретрай возможен)');
  eq(ackCalls.length, 0, 'failed grant: ack НЕ вызван');

  // === Падение ack не блокирует выдачу (fire-and-forget) ===
  resetAll();
  ackBehavior = 'fail';
  entitlementPurchases = [
    { chargeId: 'ch_ackfail_1', productId: packS.id, status: 'paid', createdAt: 0 },
  ];
  await provider.restore();
  await flush();
  eq(mw.loadMeta().rna, 500, 'ack упал: выдача всё равно выполнена');
  assert(ledger.isChargeCredited('ch_ackfail_1'), 'ack упал: chargeId помечен');
  eq(ackCalls.length, 1, 'ack упал: попытка была');

  // === P0-2: verifyPurchase возвращает СЕРВЕРНЫЙ productId ===
  resetAll();
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/api/verify')) {
      return {
        ok: true,
        json: async () => ({ verified: true, chargeId: 'ch_v_1', productId: packS.id }),
      };
    }
    throw new Error(`payments-trust: unexpected fetch ${url}`);
  };
  const v = await ledger.verifyPurchase({
    apiBaseUrl: 'https://pay.example',
    initData: 'x',
    nonce: 'n',
  });
  eq(v.verified, true, 'verify: verified');
  eq(v.chargeId, 'ch_v_1', 'verify: chargeId');
  eq(v.productId, packS.id, 'verify: productId — только серверный');
  globalThis.fetch = honestFetch;

  // === P1-a: fulfillPurchase → {ok:false} на invalid-product ===
  const bad1 = ledger.fulfillPurchase(undefined, { providerId: 'telegram-stars' });
  eq(bad1.ok, false, 'undefined product: ok=false');
  eq(bad1.outcome, 'invalid-product', 'undefined product: outcome');
  const bad2 = ledger.fulfillPurchase(null, { providerId: 'telegram-stars' });
  eq(bad2.ok, false, 'null product: ok=false');
  const bad3 = ledger.fulfillPurchase({ id: '' }, { providerId: 'telegram-stars' });
  eq(bad3.ok, false, 'empty id: ok=false');

  globalThis.fetch = realFetch;
  clearWindow();

  console.log('payments-trust: all assertions passed');
} finally {
  delete globalThis.window;
  delete globalThis.localStorage;
  rmSync(temp, { recursive: true, force: true });
}
