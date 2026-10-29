/**
 * TelegramStarsPaymentProvider — контракт и логика (витрина, Stars-биллинг).
 *
 * Covers: isTelegramWebApp()/readTelegramInitData() guards, mapInvoiceStatus
 * mapping, provider availability matrix, purchase flow with mocked fetch +
 * openInvoice, stars-price catalog validation, resolveProvider/isStorefrontVisible
 * priorities ('telegram' explicit, auto-detect, fail-closed default).
 *
 * Протокол v2 (патч №12, заменяет схему №11): purchase возвращает 'paid'
 * только после серверной верификации nonce через POST /api/verify, иначе
 * 'pending' БЕЗ выдачи; выдача — только через PaymentLedger.fulfillPurchase
 * (идемпотентно по chargeId, журнал ofeliya.payments.credited.v1);
 * недоверенные платежи допроверяются в restore() (ретраи 2/5/15/60с).
 * Compiles the TS modules with tsc like the other node-side contract tests.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-telegram-stars-'));
writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'commonjs' }));
const require = createRequire(import.meta.url);

const assert = (condition, message) => {
  if (!condition) throw new Error(`telegram-stars: ${message}`);
};
const eq = (actual, expected, message) =>
  assert(actual === expected, `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

const SHOP_DIR = 'src/game/shop';

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      `${SHOP_DIR}/PaymentProvider.ts`,
      `${SHOP_DIR}/products.ts`,
      `${SHOP_DIR}/MockPaymentProvider.ts`,
      `${SHOP_DIR}/MaxBridgePaymentProvider.ts`,
      `${SHOP_DIR}/TelegramStarsPaymentProvider.ts`,
      `${SHOP_DIR}/Storefront.ts`,
      `${SHOP_DIR}/PaymentLedger.ts`,
      `${SHOP_DIR}/grantPurchase.ts`,
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

  // tsc follows imports from src/game/shop into src/game/meta, src/game/skins
  // and src/systems, so the common root is src/ and outputs land in
  // game/shop/, game/meta/, game/skins/, systems/ — not at the temp root.
  const { SHOP_CATALOG, validateCatalog } = require(join(temp, 'game', 'shop', 'products.js'));
  const {
    TelegramStarsPaymentProvider,
    isTelegramWebApp,
    readTelegramInitData,
    mapInvoiceStatus,
    ENTITLEMENTS_KEY,
  } = require(join(temp, 'game', 'shop', 'TelegramStarsPaymentProvider.js'));
  const { MockPaymentProvider } = require(join(temp, 'game', 'shop', 'MockPaymentProvider.js'));
  const { resolveProvider, isStorefrontVisible } = require(join(temp, 'game', 'shop', 'Storefront.js'));
  const { loadMeta, getBoosterUntilMs } = require(join(temp, 'game', 'meta', 'MetaWallet.js'));
  const {
    loadPendingPurchases,
    addPendingPurchase,
    clearPendingPurchases,
    isChargeCredited,
    clearCreditedCharges,
    fulfillPurchase,
    makePaymentNonce,
    PENDING_PAYMENTS_KEY,
    CREDITED_CHARGES_KEY,
  } = require(join(temp, 'game', 'shop', 'PaymentLedger.js'));
  const {
    loadSkinStore,
    grantSkinTo,
    isSkinOwned,
  } = require(join(temp, 'game', 'skins', 'SkinOwnership.js'));

  const withWindow = (webApp) => {
    globalThis.window = webApp === null ? undefined : { Telegram: { WebApp: webApp } };
  };
  const clearWindow = () => {
    delete globalThis.window;
  };
  const realFetch = globalThis.fetch;

  // --- environment detection: Node-safe guards ---
  clearWindow();
  eq(isTelegramWebApp(), false, 'no window: not a telegram webapp');
  eq(readTelegramInitData(), '', 'no window: empty initData');
  withWindow(null);
  eq(isTelegramWebApp(), false, 'no Telegram namespace: false');
  withWindow({});
  eq(isTelegramWebApp(), false, 'WebApp without openInvoice: false');
  withWindow({ initData: 'a=1' });
  eq(isTelegramWebApp(), false, 'WebApp without openInvoice fn: false');
  withWindow({ openInvoice: () => {}, initData: 'a=1&hash=b' });
  eq(isTelegramWebApp(), true, 'WebApp with openInvoice: true');
  eq(readTelegramInitData(), 'a=1&hash=b', 'initData passthrough');
  clearWindow();

  // --- status mapping: pure function ---
  eq(mapInvoiceStatus('paid', 'p').state, 'paid', 'paid maps to paid');
  let m = mapInvoiceStatus('cancelled', 'p1');
  eq(m.state, 'cancelled', 'cancelled state');
  eq(m.reason, 'user-cancelled', 'cancelled reason');
  eq(m.provider, 'telegram-stars', 'cancelled provider');
  m = mapInvoiceStatus('failed', 'p1');
  eq(m.state, 'failed', 'failed state');
  eq(m.reason, 'stars-payment-failed', 'failed reason');
  m = mapInvoiceStatus('pending', 'p1');
  eq(m.state, 'failed', 'pending is failed (not success)');
  eq(m.reason, 'stars-payment-pending', 'pending reason');
  m = mapInvoiceStatus('bogus', 'p1');
  eq(m.reason, 'stars-unknown-status', 'unknown status reason');

  // --- availability matrix ---
  clearWindow();
  const noEnv = new TelegramStarsPaymentProvider({ apiBaseUrl: 'https://pay.example' });
  eq(noEnv.id, 'telegram-stars', 'provider id');
  eq(noEnv.isAvailable(), false, 'not in telegram: unavailable');
  withWindow({ openInvoice: () => {}, initData: 'a=1' });
  const noBackend = new TelegramStarsPaymentProvider();
  eq(noBackend.isAvailable(), false, 'no backend url: unavailable');
  withWindow({ openInvoice: () => {} });
  const noInit = new TelegramStarsPaymentProvider({ apiBaseUrl: 'https://pay.example' });
  eq(noInit.isAvailable(), false, 'no initData: unavailable');
  withWindow({ openInvoice: () => {}, initData: 'a=1&hash=b' });
  const ready = new TelegramStarsPaymentProvider({ apiBaseUrl: 'https://pay.example/' });
  eq(ready.isAvailable(), true, 'telegram + initData + backend: available');
  clearWindow();

  // --- purchase: product-level failures (no telegram env needed) ---
  const p0 = new TelegramStarsPaymentProvider({ apiBaseUrl: 'https://pay.example' });
  let r = await p0.purchase('nope.not-real');
  eq(r.state, 'failed', 'unknown product fails');
  eq(r.reason, 'unknown-product', 'unknown product reason');

  // product without stars price → failed
  const first = SHOP_CATALOG[0];
  const savedStars = first.stars;
  first.stars = undefined;
  r = await p0.purchase(first.id);
  eq(r.state, 'failed', 'missing stars price fails');
  eq(r.reason, 'no-stars-price', 'missing stars reason');
  first.stars = savedStars;

  // --- purchase: env-level failures ---
  clearWindow();
  r = await p0.purchase(first.id);
  eq(r.state, 'unavailable', 'outside telegram: unavailable');
  eq(r.reason, 'not-in-telegram', 'outside telegram reason');
  withWindow({ openInvoice: () => {}, initData: 'a=1' });
  const pNoBackend = new TelegramStarsPaymentProvider();
  r = await pNoBackend.purchase(first.id);
  eq(r.state, 'unavailable', 'no backend: unavailable');
  eq(r.reason, 'stars-backend-unconfigured', 'no backend reason');

  // --- purchase: invoice backend failure ---
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const pFail = new TelegramStarsPaymentProvider({ apiBaseUrl: 'https://pay.example' });
  r = await pFail.purchase(first.id);
  eq(r.state, 'failed', 'invoice 500 fails');
  eq(r.reason, 'invoice-create-failed', 'invoice failure reason');
  globalThis.fetch = async () => {
    throw new Error('network down');
  };
  r = await pFail.purchase(first.id);
  eq(r.reason, 'invoice-create-failed', 'network error maps to invoice failure');

  // --- v2 harness: in-memory localStorage + honest server mock ---
  // Main has no debugResetMeta (unlike the stack): MetaWallet/SkinOwnership/
  // PaymentLedger read localStorage dynamically, so clearing the stub resets
  // everything.
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  const resetPayments = () => {
    store.clear();
    clearPendingPurchases();
    clearCreditedCharges();
  };
  // Server state: orders (nonce → order) + payments (chargeId → purchase).
  // The openInvoice 'paid' callback records the payment synchronously,
  // simulating the Telegram webhook arriving before /api/verify.
  const server = {
    orders: new Map(),
    payments: new Map(),
    nonceToCharge: new Map(),
    verifyNonces: [],
    verifyMode: 'ok', // 'ok' | 'ok-no-charge' | 'not-found' | 'throw'
    entitlementsMode: 'ok', // 'ok' | 'unavailable'
  };
  let lastInvoiceNonce = '';
  const resetServer = () => {
    server.orders.clear();
    server.payments.clear();
    server.nonceToCharge.clear();
    server.verifyNonces.length = 0;
    server.verifyMode = 'ok';
    server.entitlementsMode = 'ok';
    lastInvoiceNonce = '';
  };
  globalThis.fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    if (url.endsWith('/api/invoice')) {
      assert(typeof body.nonce === 'string' && body.nonce.length >= 8, 'invoice sends nonce');
      assert(
        typeof body.productId === 'string' && SHOP_CATALOG.some((p) => p.id === body.productId),
        'invoice sends a catalog productId'
      );
      assert(typeof body.initData === 'string' && body.initData.length > 0, 'invoice sends initData');
      server.orders.set(body.nonce, { userId: 42, productId: body.productId });
      lastInvoiceNonce = body.nonce;
      return { ok: true, json: async () => ({ invoiceUrl: 'https://t.me/$invoice123', nonce: body.nonce }) };
    }
    if (url.endsWith('/api/verify')) {
      server.verifyNonces.push(body.nonce);
      if (server.verifyMode === 'throw') throw new Error('network down');
      if (server.verifyMode === 'ok-no-charge') {
        return { ok: true, json: async () => ({ verified: true }) };
      }
      const chargeId = server.nonceToCharge.get(body.nonce);
      if (server.verifyMode === 'not-found' || !chargeId) {
        return { ok: true, json: async () => ({ verified: false, reason: 'not_found' }) };
      }
      const pay = server.payments.get(chargeId);
      return { ok: true, json: async () => ({ verified: true, chargeId, productId: pay.productId }) };
    }
    if (url.endsWith('/api/entitlements')) {
      if (server.entitlementsMode === 'unavailable') {
        return { ok: false, status: 501, json: async () => ({}) };
      }
      return { ok: true, json: async () => ({ purchases: [...server.payments.values()] }) };
    }
    throw new Error(`unexpected fetch url ${url}`);
  };
  const paidWindow = () => ({
    openInvoice: (_url, cb) => {
      const order = server.orders.get(lastInvoiceNonce);
      assert(order, 'openInvoice after an invoice call');
      const chargeId = `charge-${lastInvoiceNonce}`;
      server.payments.set(chargeId, {
        chargeId,
        productId: order.productId,
        status: 'paid',
        createdAt: Date.now(),
      });
      server.nonceToCharge.set(lastInvoiceNonce, chargeId);
      cb('paid');
    },
    initData: 'a=1&hash=b',
  });

  const packS = SHOP_CATALOG.find((p) => p.id === 'currency.rna-pack-s');
  const packM = SHOP_CATALOG.find((p) => p.id === 'currency.rna-pack-m');
  const skinTeal = SHOP_CATALOG.find((p) => p.id === 'skin.abyssal-teal');
  const skinMagenta = SHOP_CATALOG.find((p) => p.id === 'skin.virulent-magenta');
  const booster = SHOP_CATALOG.find((p) => p.id === 'booster.rna-x2-7d');
  assert(packS && packM && skinTeal && skinMagenta && booster, 'catalog fixtures present');

  // (1) verified → paid + fulfillPurchase grant (pack-s: 500 RNA flat, 35★).
  resetPayments();
  resetServer();
  withWindow(paidWindow());
  const p1 = new TelegramStarsPaymentProvider({ apiBaseUrl: 'https://pay.example' });
  r = await p1.purchase(packS.id);
  eq(r.state, 'paid', 'verified purchase is paid');
  eq(r.productId, packS.id, 'paid carries productId');
  eq(r.provider, 'telegram-stars', 'paid carries provider');
  assert(typeof r.chargeId === 'string' && r.chargeId.length > 0, 'paid carries chargeId');
  assert(typeof r.nonce === 'string' && r.nonce.length > 0, 'paid carries nonce');
  eq(
    server.verifyNonces[server.verifyNonces.length - 1],
    r.nonce,
    'verify reuses the invoice nonce'
  );
  eq(loadMeta().rna, 0, 'no grant before fulfill');
  let f = fulfillPurchase(packS, { chargeId: r.chargeId, providerId: 'telegram-stars' });
  eq(f, 'granted', 'first fulfill grants');
  eq(loadMeta().rna, 500, 'pack-s grants 500 RNA flat');
  eq(loadMeta().starsSpent, 35, 'pack-s records 35 stars spent');
  assert(isChargeCredited(r.chargeId), 'fulfilled charge is credited');

  // (2) same chargeId again → duplicate, no double grant/stars.
  f = fulfillPurchase(packS, { chargeId: r.chargeId, providerId: 'telegram-stars' });
  eq(f, 'duplicate', 'same chargeId is duplicate');
  eq(loadMeta().rna, 500, 'duplicate grants no extra RNA');
  eq(loadMeta().starsSpent, 35, 'duplicate records no extra stars');

  // (3) unverified ({verified:false} × 3 attempts, ~4s) → pending, NO grant,
  // and the provider does NOT auto-add the pending record (scene does).
  resetPayments();
  resetServer();
  server.verifyMode = 'not-found';
  withWindow(paidWindow());
  r = await p1.purchase(packS.id);
  eq(r.state, 'pending', 'unverified purchase is pending');
  eq(r.reason, 'verify-unconfirmed', 'unverified reason');
  eq(r.productId, packS.id, 'pending carries productId');
  assert(typeof r.nonce === 'string' && r.nonce.length > 0, 'pending carries nonce');
  eq(loadMeta().rna, 0, 'pending grants nothing');
  eq(loadMeta().starsSpent, 0, 'pending records no stars');
  eq(loadPendingPurchases().length, 0, 'provider does not auto-add pending record');
  // Scene-simulated: the scene adds the record after a pending purchase.
  addPendingPurchase({ nonce: r.nonce, productId: packS.id, stars: 35, createdAt: Date.now() });
  eq(loadPendingPurchases().length, 1, 'scene adds one pending record');
  const pendingNonce = r.nonce;

  // (4) pending → restore() → verify → paid + grant exactly once, record
  // removed; a second restore fulfills nothing.
  server.verifyMode = 'ok';
  const restored = await p1.restore();
  assert(restored.pendingFulfilled.includes(packS.id), 'restore fulfills pending pack');
  eq(loadMeta().rna, 500, 'restore grants exactly 500 RNA');
  eq(loadMeta().starsSpent, 35, 'restore records 35 stars once');
  eq(loadPendingPurchases().length, 0, 'fulfilled pending record removed');
  const restoredAgain = await p1.restore();
  eq(restoredAgain.pendingFulfilled.length, 0, 'second restore fulfills nothing');
  eq(loadMeta().rna, 500, 'second restore grants nothing extra');
  eq(loadMeta().starsSpent, 35, 'second restore records nothing extra');
  assert(pendingNonce.length > 0, 'pending nonce tracked');

  // (4b) entitlements v2 merge: valid + broken records; merge alone grants
  // nothing, and fulfilling by the merged chargeId is a duplicate.
  resetPayments();
  resetServer();
  server.payments.set('charge-valid', {
    chargeId: 'charge-valid',
    productId: skinTeal.id,
    status: 'paid',
    createdAt: 1000,
  });
  server.payments.set('charge-broken', {
    chargeId: 'charge-broken',
    productId: '',
    status: 'paid',
    createdAt: 1001,
  });
  server.payments.set('', {
    chargeId: '',
    productId: packS.id,
    status: 'paid',
    createdAt: 1002,
  });
  withWindow({ openInvoice: () => {}, initData: 'a=1&hash=b' });
  const merged = await p1.restore();
  assert(merged.productIds.includes(skinTeal.id), 'entitlements merge returns valid product');
  assert(!merged.productIds.includes(packS.id), 'broken entitlements record skipped');
  assert(isChargeCredited('charge-valid'), 'merged server charge marked credited');
  eq(isSkinOwned(skinTeal.id), false, 'merge alone grants no skin');
  eq(loadMeta().starsSpent, 0, 'merge alone records no stars');
  f = fulfillPurchase(skinTeal, { chargeId: 'charge-valid', providerId: 'telegram-stars' });
  eq(f, 'duplicate', 'fulfill by merged chargeId is duplicate');
  eq(isSkinOwned(skinTeal.id), false, 'duplicate fulfill still grants no skin');

  // (5) verify unreachable (fetch throws) → pending 'verify-unreachable',
  // fast (<3s): network error is an immediate fast path, not 3 retries.
  resetPayments();
  resetServer();
  server.verifyMode = 'throw';
  withWindow(paidWindow());
  const t0 = Date.now();
  r = await p1.purchase(packS.id);
  const elapsed = Date.now() - t0;
  eq(r.state, 'pending', 'unreachable verify is pending');
  eq(r.reason, 'verify-unreachable', 'unreachable reason');
  assert(elapsed < 3000, `unreachable verify is fast, took ${elapsed}ms`);
  eq(loadMeta().rna, 0, 'unreachable verify grants nothing');

  // (6) verified without chargeId → nonce-derived chargeId, grant + duplicate.
  resetPayments();
  resetServer();
  server.verifyMode = 'ok-no-charge';
  withWindow(paidWindow());
  r = await p1.purchase(packS.id);
  eq(r.state, 'paid', 'verified-without-chargeId is paid');
  eq(r.chargeId, `nonce-${r.nonce}`, 'chargeId derived from nonce');
  f = fulfillPurchase(packS, { chargeId: r.chargeId, providerId: 'telegram-stars' });
  eq(f, 'granted', 'nonce-derived charge grants');
  f = fulfillPurchase(packS, { chargeId: r.chargeId, providerId: 'telegram-stars' });
  eq(f, 'duplicate', 'nonce-derived charge duplicate');

  // (7) booster fulfill → ~7 days, duplicate does not re-extend.
  resetPayments();
  f = fulfillPurchase(booster, { chargeId: 'c-booster', providerId: 'telegram-stars' });
  eq(f, 'granted', 'booster first fulfill grants');
  const exp1 = getBoosterUntilMs();
  const sevenDays = 7 * 24 * 3600 * 1000;
  assert(
    exp1 - Date.now() > sevenDays - 60000 && exp1 - Date.now() < sevenDays + 60000,
    `booster extends ~7 days, got ${exp1 - Date.now()}ms`
  );
  f = fulfillPurchase(booster, { chargeId: 'c-booster', providerId: 'telegram-stars' });
  eq(f, 'duplicate', 'booster duplicate');
  eq(getBoosterUntilMs(), exp1, 'duplicate does not re-extend booster');

  // (8) skin fulfill: pure grantSkinTo checks + ledger grant, exactly-once
  // ownership, starsSpent 100.
  resetPayments();
  const pure = grantSkinTo(loadSkinStore(), skinMagenta.id);
  eq(pure.granted, true, 'pure grantSkinTo grants unknown skin');
  eq(isSkinOwned(skinMagenta.id), false, 'pure check does not persist ownership');
  f = fulfillPurchase(skinMagenta, { chargeId: 'c-skin', providerId: 'telegram-stars' });
  eq(f, 'granted', 'skin fulfill grants');
  eq(isSkinOwned(skinMagenta.id), true, 'skin owned after fulfill');
  eq(loadMeta().starsSpent, 100, 'skin records 100 stars spent');
  f = fulfillPurchase(skinMagenta, { chargeId: 'c-skin', providerId: 'telegram-stars' });
  eq(f, 'duplicate', 'skin duplicate');
  eq(
    loadSkinStore().owned.filter((id) => id === skinMagenta.id).length,
    1,
    'skin owned exactly once'
  );

  // (9) mock → paid immediately, no nonce/chargeId/verify, fulfill without
  // chargeId grants, starsSpent stays 0, mock re-grant returns 'granted'
  // without duplicating skin ownership.
  resetPayments();
  globalThis.fetch = async () => {
    throw new Error('mock must not fetch');
  };
  const mock = new MockPaymentProvider();
  r = await mock.purchase(skinMagenta.id);
  eq(r.state, 'paid', 'mock purchase is paid');
  assert(r.chargeId === undefined && r.nonce === undefined, 'mock paid has no chargeId/nonce');
  f = fulfillPurchase(skinMagenta, { providerId: 'mock' });
  eq(f, 'granted', 'mock fulfill without chargeId grants');
  eq(loadMeta().starsSpent, 0, 'mock records no stars');
  f = fulfillPurchase(skinMagenta, { providerId: 'mock' });
  eq(f, 'granted', 'mock re-grant returns granted');
  eq(
    loadSkinStore().owned.filter((id) => id === skinMagenta.id).length,
    1,
    'mock re-grant does not duplicate skin ownership'
  );

  // (10) makePaymentNonce: unique, non-empty.
  const n1 = makePaymentNonce();
  const n2 = makePaymentNonce();
  assert(typeof n1 === 'string' && n1.length > 0, 'nonce non-empty');
  assert(n1 !== n2, 'nonces unique');

  // (11) key consts match the documented storage keys.
  eq(PENDING_PAYMENTS_KEY, 'ofeliya.payments.pending.v1', 'pending key const');
  eq(CREDITED_CHARGES_KEY, 'ofeliya.payments.credited.v1', 'credited key const');

  // (12) cancelled invoice → cancelled, no pending record.
  resetPayments();
  resetServer();
  withWindow({ openInvoice: (_url, cb) => cb('cancelled'), initData: 'a=1&hash=b' });
  // Restore the honest fetch mock for the invoice call (mock section replaced it).
  globalThis.fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    if (url.endsWith('/api/invoice')) {
      server.orders.set(body.nonce, { userId: 42, productId: body.productId });
      lastInvoiceNonce = body.nonce;
      return { ok: true, json: async () => ({ invoiceUrl: 'https://t.me/$invoice123', nonce: body.nonce }) };
    }
    throw new Error(`unexpected fetch url ${url}`);
  };
  r = await p1.purchase(packM.id);
  eq(r.state, 'cancelled', 'cancelled invoice maps');
  eq(r.reason, 'user-cancelled', 'cancelled reason');
  eq(loadPendingPurchases().length, 0, 'cancelled purchase leaves no pending record');

  globalThis.fetch = realFetch;
  clearWindow();
  delete globalThis.localStorage;

  // --- catalog: stars prices valid ---
  eq(validateCatalog(SHOP_CATALOG).length, 0, 'catalog with stars validates clean');
  for (const p of SHOP_CATALOG) {
    assert(Number.isInteger(p.stars) && p.stars > 0, `product ${p.id} has positive integer stars`);
  }
  const badStars = SHOP_CATALOG.map((p) => ({ ...p }));
  badStars[0] = { ...badStars[0], stars: 0 };
  assert(
    validateCatalog(badStars).some((e) => e.includes('bad stars')),
    'zero stars rejected'
  );
  badStars[0] = { ...badStars[0], stars: 1.5 };
  assert(
    validateCatalog(badStars).some((e) => e.includes('bad stars')),
    'fractional stars rejected'
  );
  badStars[0] = { ...badStars[0], stars: -3 };
  assert(
    validateCatalog(badStars).some((e) => e.includes('bad stars')),
    'negative stars rejected'
  );

  // --- resolveProvider / isStorefrontVisible priorities ---
  clearWindow();
  const tp = resolveProvider('telegram', { apiBaseUrl: 'https://pay.example' });
  assert(tp !== null && tp.id === 'telegram-stars', 'explicit telegram variant resolves');
  eq(isStorefrontVisible('telegram'), true, 'telegram variant visible');
  eq(resolveProvider('hidden'), null, 'hidden default stays null in Node');
  eq(isStorefrontVisible('hidden'), false, 'hidden default not visible in Node');
  eq(resolveProvider('bogus'), null, 'unknown variant fail-closed');
  // auto-detect does not fire without window (Node) — explicit behavior preserved
  eq(resolveProvider('mock')?.id, 'mock', 'mock still resolves');

  console.log('telegram-stars: all assertions passed');
} finally {
  delete globalThis.window;
  delete globalThis.localStorage;
  rmSync(temp, { recursive: true, force: true });
}
