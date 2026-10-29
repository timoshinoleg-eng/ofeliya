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
// Патч №13 (P1-a): fulfillPurchase возвращает {ok, outcome, error?}.
const eqGrant = (res, outcome, message) => {
  eq(res.ok, true, `${message}: ok`);
  eq(res.outcome, outcome, `${message}: outcome`);
};

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
    verifyMode: 'ok', // 'ok' | 'ok-no-charge' | 'mismatch' | 'not-found' | 'throw'
    entitlementsMode: 'ok', // 'ok' | 'unavailable'
    ackCalls: [],
    ackBehavior: 'ok', // 'ok' | 'fail'
    // Патч №15 (P0-3): симуляция серверного кошелька воркера (POST /api/wallet).
    wallet: { purchased_rna: 0, booster_until_ms: 0, skins: [], ledger_tip: null },
  };
  let lastInvoiceNonce = '';
  const resetServer = () => {
    server.orders.clear();
    server.payments.clear();
    server.nonceToCharge.clear();
    server.verifyNonces.length = 0;
    server.verifyMode = 'ok';
    server.entitlementsMode = 'ok';
    server.ackCalls.length = 0;
    server.ackBehavior = 'ok';
    server.wallet = { purchased_rna: 0, booster_until_ms: 0, skins: [], ledger_tip: null };
    lastInvoiceNonce = '';
  };
  // fire-and-forget ack выполняется вне await restore() — даём микрозадачам долететь.
  const flush = () => new Promise((r) => setTimeout(r, 10));
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
      // Патч №13 (P0-2): mismatch — сервер возвращает чужой productId.
      const serverProductId =
        server.verifyMode === 'mismatch'
          ? SHOP_CATALOG.find((p) => p.id !== pay.productId).id
          : pay.productId;
      return { ok: true, json: async () => ({ verified: true, chargeId, productId: serverProductId }) };
    }
    if (url.endsWith('/api/entitlements')) {
      if (server.entitlementsMode === 'unavailable') {
        return { ok: false, status: 501, json: async () => ({}) };
      }
      return { ok: true, json: async () => ({ purchases: [...server.payments.values()] }) };
    }
    if (url.endsWith('/api/ack')) {
      assert(typeof body.initData === 'string' && body.initData.length > 0, 'ack: initData');
      assert(typeof body.chargeId === 'string' && body.chargeId.length > 0, 'ack: chargeId');
      server.ackCalls.push(body);
      if (server.ackBehavior === 'fail') throw new Error('ack backend down');
      return { ok: true, json: async () => ({ ok: true }) };
    }
    if (url.endsWith('/api/wallet')) {
      assert(typeof body.initData === 'string' && body.initData.length > 0, 'wallet: initData');
      return { ok: true, json: async () => ({ ...server.wallet }) };
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

  // (1) verified → paid + учёт через ledger + материализация серверного
  // кошелька (как StorefrontScene.buy после патча №15).
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
  eqGrant(f, 'granted', 'first fulfill ok');
  eq(f.needsServerSync, true, 'telegram: needsServerSync');
  eq(loadMeta().rna, 0, 'no local grant: issuance is server-side');
  // сервер применил грант (симуляция воркера) → синк материализует
  server.wallet.purchased_rna = 500;
  const sync1 = await p1.syncWalletFromServer();
  eq(sync1.ok, true, 'wallet sync ok');
  eq(loadMeta().rna, 500, 'pack-s grants 500 RNA flat via server wallet');
  eq(loadMeta().starsSpent, 35, 'pack-s records 35 stars spent');
  assert(isChargeCredited(r.chargeId), 'fulfilled charge is credited');

  // (2) same chargeId again → duplicate, no double grant/stars.
  f = fulfillPurchase(packS, { chargeId: r.chargeId, providerId: 'telegram-stars' });
  eqGrant(f, 'duplicate', 'same chargeId is duplicate');
  const sync2 = await p1.syncWalletFromServer();
  eq(sync2.ok, true, 'repeat sync ok');
  eq(sync2.applied.rna, 0, 'repeat sync: no double grant (watermark)');
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
  // сервер уже применил грант (симуляция воркера №15) — restore материализует
  server.wallet.purchased_rna = 500;
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

  // (4b) entitlements v2 merge (патч №13, P0-1): серверный 'paid' → выдача
  // через fulfillPurchase (раньше merge только помечал chargeId БЕЗ гранта —
  // товар терялся при потере локальных данных); 'refunded' — пропуск;
  // битые записи — пропуск.
  resetPayments();
  resetServer();
  server.payments.set('charge-valid', {
    chargeId: 'charge-valid',
    productId: packS.id,
    status: 'paid',
    createdAt: 1000,
  });
  server.payments.set('charge-ref', {
    chargeId: 'charge-ref',
    productId: packM.id,
    status: 'refunded',
    createdAt: 1001,
  });
  server.payments.set('charge-broken', {
    chargeId: 'charge-broken',
    productId: '',
    status: 'paid',
    createdAt: 1002,
  });
  server.payments.set('', {
    chargeId: '',
    productId: packS.id,
    status: 'paid',
    createdAt: 1003,
  });
  withWindow({ openInvoice: () => {}, initData: 'a=1&hash=b' });
  // сервер применил грант за charge-valid (симуляция воркера №15)
  server.wallet.purchased_rna = 500;
  const merged = await p1.restore();
  await flush(); // fire-and-forget ack долетел
  assert(merged.productIds.includes(packS.id), 'entitlements merge returns granted product');
  assert(!merged.productIds.includes(packM.id), 'refunded purchase not visible in UI');
  assert(isChargeCredited('charge-valid'), 'server paid charge marked credited after grant');
  assert(!isChargeCredited('charge-ref'), 'refunded purchase not credited');
  eq(loadMeta().rna, 500, 'server paid purchase granted via fulfillPurchase');
  eq(loadMeta().starsSpent, 35, 'starsSpent recorded on server-purchase grant');
  eq(server.ackCalls.length, 1, 'ack called once after server-purchase grant');
  eq(server.ackCalls[0].chargeId, 'charge-valid', 'ack carries the chargeId');
  eq(server.ackCalls[0].initData, 'a=1&hash=b', 'ack carries initData');
  // повторный fulfill по серверному chargeId — duplicate, гранта нет:
  f = fulfillPurchase(packS, { chargeId: 'charge-valid', providerId: 'telegram-stars' });
  eqGrant(f, 'duplicate', 'server chargeId dedupes fulfill');
  eq(loadMeta().rna, 500, 'no double grant on duplicate');

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

  // (6) verified без chargeId → pending, НЕ paid (патч №13, P0-2) —
  // синтетических chargeId вида `nonce-${nonce}` больше нет: настоящий
  // непустой chargeId от сервера обязателен, иначе — pending без выдачи.
  resetPayments();
  resetServer();
  server.verifyMode = 'ok-no-charge';
  withWindow(paidWindow());
  r = await p1.purchase(packS.id);
  eq(r.state, 'pending', 'verified without chargeId is pending, not paid');
  eq(r.reason, 'verify-no-charge-id', 'pending reason is verify-no-charge-id');
  assert(typeof r.nonce === 'string' && r.nonce.length > 0, 'pending carries nonce');
  eq(loadMeta().rna, 0, 'no grant without server chargeId');
  eq(loadMeta().starsSpent, 0, 'no starsSpent without server chargeId');

  // (6b) verify productId mismatch → pending, НЕ paid (патч №13, P0-2).
  resetPayments();
  resetServer();
  server.verifyMode = 'mismatch'; // сервер вернул чужой productId
  withWindow(paidWindow());
  r = await p1.purchase(packS.id);
  eq(r.state, 'pending', 'productId mismatch is pending, not paid');
  eq(r.reason, 'verify-product-mismatch', 'pending reason is verify-product-mismatch');
  eq(loadMeta().rna, 0, 'no grant on productId mismatch');

  // (7) booster: серверный грант → синк берёт max(local, server).
  // Патч №15: fulfillPurchase начислений не делает; срок вычисляет сервер.
  resetPayments();
  f = fulfillPurchase(booster, { chargeId: 'c-booster', providerId: 'telegram-stars' });
  eqGrant(f, 'granted', 'booster accounted');
  eq(f.needsServerSync, true, 'booster needsServerSync');
  eq(getBoosterUntilMs(), 0, 'no local grant: issuance is server-side');
  // сервер применил грант: max(now, текущий) + 7 дней (симуляция воркера)
  server.wallet = { purchased_rna: 0, booster_until_ms: Date.now() + 7 * 86400000, skins: [], ledger_tip: null };
  const pBoost = new TelegramStarsPaymentProvider({ apiBaseUrl: 'https://pay.example' });
  const syncB = await pBoost.syncWalletFromServer();
  eq(syncB.ok, true, 'booster sync ok');
  const exp1 = getBoosterUntilMs();
  const sevenDays = 7 * 24 * 3600 * 1000;
  assert(
    exp1 - Date.now() > sevenDays - 60000 && exp1 - Date.now() < sevenDays + 60000,
    `booster extends ~7 days, got ${exp1 - Date.now()}ms`
  );
  f = fulfillPurchase(booster, { chargeId: 'c-booster', providerId: 'telegram-stars' });
  eqGrant(f, 'duplicate', 'booster duplicate');
  const syncB2 = await pBoost.syncWalletFromServer();
  eq(syncB2.applied.boosterUntilMs, exp1, 'repeat sync: booster unchanged');
  eq(getBoosterUntilMs(), exp1, 'duplicate does not re-extend booster');

  // (8) skin: серверный грант → синк делает union.
  // Патч №15: grantSkin вызывается из ServerWalletSync, не из fulfillPurchase.
  resetPayments();
  const pure = grantSkinTo(loadSkinStore(), skinMagenta.id);
  eq(pure.granted, true, 'pure grantSkinTo grants unknown skin');
  eq(isSkinOwned(skinMagenta.id), false, 'pure check does not persist ownership');
  f = fulfillPurchase(skinMagenta, { chargeId: 'c-skin', providerId: 'telegram-stars' });
  eqGrant(f, 'granted', 'skin accounted via ledger');
  eq(f.needsServerSync, true, 'skin needsServerSync');
  eq(isSkinOwned(skinMagenta.id), false, 'no local grant: issuance is server-side');
  server.wallet = { purchased_rna: 0, booster_until_ms: 0, skins: [skinMagenta.id], ledger_tip: null };
  const pSkin = new TelegramStarsPaymentProvider({ apiBaseUrl: 'https://pay.example' });
  const syncS = await pSkin.syncWalletFromServer();
  eq(syncS.ok, true, 'skin sync ok');
  eq(isSkinOwned(skinMagenta.id), true, 'skin owned after sync');
  eq(loadMeta().starsSpent, 100, 'skin records 100 stars spent');
  f = fulfillPurchase(skinMagenta, { chargeId: 'c-skin', providerId: 'telegram-stars' });
  eqGrant(f, 'duplicate', 'skin duplicate');
  const syncS2 = await pSkin.syncWalletFromServer();
  eq(syncS2.applied.skins.length, 0, 'repeat sync: no duplicate skin');
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
  eqGrant(f, 'granted', 'mock fulfill without chargeId grants');
  eq(loadMeta().starsSpent, 0, 'mock records no stars');
  f = fulfillPurchase(skinMagenta, { providerId: 'mock' });
  eqGrant(f, 'granted', 'mock re-grant returns granted');
  eq(
    loadSkinStore().owned.filter((id) => id === skinMagenta.id).length,
    1,
    'mock re-grant does not duplicate skin ownership'
  );

  // (10) makePaymentNonce: только crypto-RNG (патч №13, P1-b).
  const n1 = makePaymentNonce();
  const n2 = makePaymentNonce();
  assert(typeof n1 === 'string' && n1.length > 0, 'nonce non-empty');
  assert(n1 !== n2, 'nonces unique');
  assert(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(n1),
    'nonce is crypto.randomUUID v4'
  );
  // Без crypto — throw (Math.random-фолбэка больше нет).
  {
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    let threw = false;
    let skipped = false;
    try {
      Object.defineProperty(globalThis, 'crypto', {
        value: undefined,
        configurable: true,
        writable: true,
      });
    } catch {
      skipped = true;
    }
    try {
      if (!skipped) {
        try {
          makePaymentNonce();
        } catch {
          threw = true;
        }
        assert(threw, 'makePaymentNonce throws without crypto');
      }
    } finally {
      if (!skipped) {
        if (desc) Object.defineProperty(globalThis, 'crypto', desc);
        else delete globalThis.crypto;
      }
    }
    assert(typeof makePaymentNonce() === 'string', 'nonce works after crypto restore');
  }

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
  // Патч №13 (P1-f): mock — только QA-сборки (VITE_QA_TOOLS=1 / dev).
  eq(resolveProvider('mock'), null, 'mock without qaTools: fail-closed null');
  eq(resolveProvider('mock', { qaTools: true })?.id, 'mock', 'mock+qaTools resolves');

  console.log('telegram-stars: all assertions passed');
} finally {
  delete globalThis.window;
  delete globalThis.localStorage;
  rmSync(temp, { recursive: true, force: true });
}
