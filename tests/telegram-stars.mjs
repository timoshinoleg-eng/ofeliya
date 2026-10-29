/**
 * TelegramStarsPaymentProvider — контракт и логика (витрина, Stars-биллинг).
 *
 * Covers: isTelegramWebApp()/readTelegramInitData() guards, mapInvoiceStatus
 * mapping, provider availability matrix, purchase flow with mocked fetch +
 * openInvoice, stars-price catalog validation, resolveProvider/isStorefrontVisible
 * priorities ('telegram' explicit, auto-detect, fail-closed default).
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

  // tsc preserves structure from the common root (src/game/): the provider
  // now imports ../meta/MetaWallet (recordStarsSpent), so outputs land in
  // shop/ and meta/ — not at the temp root.
  const { SHOP_CATALOG, validateCatalog } = require(join(temp, 'shop', 'products.js'));
  const {
    TelegramStarsPaymentProvider,
    isTelegramWebApp,
    readTelegramInitData,
    mapInvoiceStatus,
    ENTITLEMENTS_KEY,
  } = require(join(temp, 'shop', 'TelegramStarsPaymentProvider.js'));
  const { resolveProvider, isStorefrontVisible } = require(join(temp, 'shop', 'Storefront.js'));
  const { loadMeta } = require(join(temp, 'meta', 'MetaWallet.js'));

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

  // --- purchase: happy path (mocked fetch + openInvoice) ---
  let openedUrl = '';
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    assert(url === 'https://pay.example/api/invoice', 'posts to /api/invoice');
    assert(
      typeof body.productId === 'string' && SHOP_CATALOG.some((p) => p.id === body.productId),
      'sends a catalog productId'
    );
    assert(typeof body.initData === 'string' && body.initData.length > 0, 'sends initData');
    return { ok: true, json: async () => ({ invoiceUrl: 'https://t.me/$invoice123' }) };
  };
  withWindow({
    openInvoice: (url, cb) => {
      openedUrl = url;
      cb('paid');
    },
    initData: 'a=1&hash=b',
  });
  const pOk = new TelegramStarsPaymentProvider({ apiBaseUrl: 'https://pay.example' });
  r = await pOk.purchase(first.id);
  eq(openedUrl, 'https://t.me/$invoice123', 'openInvoice called with backend url');
  eq(r.state, 'success', 'paid invoice succeeds');
  eq(r.productId, first.id, 'success carries productId');
  eq(r.provider, 'telegram-stars', 'success carries provider');
  assert(typeof r.receipt === 'string' && r.receipt.length > 0, 'success carries receipt');
  const restored = await pOk.restore();
  assert(restored.productIds.includes(first.id), 'restore returns purchased product');
  eq(loadMeta().starsSpent, first.stars, 'paid purchase records stars spent (Investor)');

  // --- purchase: user cancels ---
  withWindow({
    openInvoice: (url, cb) => cb('cancelled'),
    initData: 'a=1&hash=b',
  });
  r = await pOk.purchase(SHOP_CATALOG[1].id);
  eq(r.state, 'cancelled', 'cancelled invoice maps');
  eq(r.reason, 'user-cancelled', 'cancelled reason');
  const restored2 = await pOk.restore();
  assert(!restored2.productIds.includes(SHOP_CATALOG[1].id), 'cancelled purchase not entitled');
  eq(loadMeta().starsSpent, first.stars, 'cancelled purchase records no stars');

  globalThis.fetch = realFetch;
  clearWindow();

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
  rmSync(temp, { recursive: true, force: true });
}
