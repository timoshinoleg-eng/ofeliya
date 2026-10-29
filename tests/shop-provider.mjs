/**
 * PaymentProvider contract — витрина (rail-agnostic).
 *
 * Covers MockPaymentProvider (list/purchase/restore, forced failures,
 * URL config parsing) and MaxBridgePaymentProvider (unavailable stub).
 * Compiles the TS modules with tsc like the other node-side contract tests.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(resolve('.'), '.tmp-ofeliya-shop-'));
writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'commonjs' }));
const require = createRequire(import.meta.url);

const assert = (condition, message) => {
  if (!condition) throw new Error(`shop-provider: ${message}`);
};
const eq = (actual, expected, message) =>
  assert(actual === expected, `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/game/shop/PaymentProvider.ts',
      'src/game/shop/products.ts',
      'src/game/shop/MockPaymentProvider.ts',
      'src/game/shop/MaxBridgePaymentProvider.ts',
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

  const { SHOP_CATALOG } = require(join(temp, 'products.js'));
  const { MockPaymentProvider, readMockShopConfig } = require(join(temp, 'MockPaymentProvider.js'));
  const { MaxBridgePaymentProvider, MAX_BRIDGE_UNAVAILABLE } = require(
    join(temp, 'MaxBridgePaymentProvider.js')
  );

  // --- readMockShopConfig: pure URL parsing ---
  let cfg = readMockShopConfig('');
  eq(cfg.delayMs, 0, 'empty search: no delay');
  eq(cfg.fail, '', 'empty search: no fail');
  cfg = readMockShopConfig('?shop.mockDelay=750&shop.mockFail=all');
  eq(cfg.delayMs, 750, 'delay parsed');
  eq(cfg.fail, 'all', 'fail parsed');
  cfg = readMockShopConfig('?shop.mockDelay=99999');
  eq(cfg.delayMs, 10000, 'delay clamped to 10s');
  cfg = readMockShopConfig('?shop.mockDelay=bogus');
  eq(cfg.delayMs, 0, 'garbage delay ignored');

  // --- mock: happy path ---
  const mock = new MockPaymentProvider();
  eq(mock.id, 'mock', 'mock id');
  eq(mock.isAvailable(), true, 'mock is available');
  const products = await mock.listProducts();
  eq(products.length, SHOP_CATALOG.length, 'mock lists full catalog');
  eq(products === SHOP_CATALOG, false, 'catalog copy is not the same array');
  eq(products[0] === SHOP_CATALOG[0], false, 'catalog items are copies');

  const firstId = SHOP_CATALOG[0].id;
  const ok = await mock.purchase(firstId);
  eq(ok.state, 'success', 'purchase succeeds');
  eq(ok.productId, firstId, 'success carries productId');
  eq(ok.provider, 'mock', 'success carries provider');
  assert(typeof ok.receipt === 'string' && ok.receipt.length > 0, 'success carries receipt');

  // --- mock: restore returns granted entitlements ---
  const restored = await mock.restore();
  assert(restored.productIds.includes(firstId), 'restore returns purchased product');

  // --- mock: unknown product ---
  const unknown = await mock.purchase('nope.not-real');
  eq(unknown.state, 'failed', 'unknown product fails');
  eq(unknown.reason, 'unknown-product', 'unknown product reason');

  // --- mock: forced failure (QA path) ---
  const failing = new MockPaymentProvider({ delayMs: 0, fail: 'all' });
  const forced = await failing.purchase(firstId);
  eq(forced.state, 'failed', 'forced failure fails');
  eq(forced.reason, 'mock-forced-failure', 'forced failure reason');
  const single = new MockPaymentProvider({ delayMs: 0, fail: firstId });
  const forcedOne = await single.purchase(firstId);
  eq(forcedOne.state, 'failed', 'per-product forced failure fails');
  const other = await single.purchase(SHOP_CATALOG[1].id);
  eq(other.state, 'success', 'other products unaffected by per-product fail');

  // --- max-bridge stub: unavailable, never crashes the caller contract ---
  const stub = new MaxBridgePaymentProvider();
  eq(stub.id, 'max-bridge', 'stub id');
  eq(stub.isAvailable(), false, 'stub is not available');
  const stubPurchase = await stub.purchase(firstId);
  eq(stubPurchase.state, 'unavailable', 'stub purchase is unavailable');
  eq(stubPurchase.reason, MAX_BRIDGE_UNAVAILABLE, 'stub reason code');
  let threw = false;
  try {
    await stub.listProducts();
  } catch (e) {
    threw = e instanceof Error && e.message === MAX_BRIDGE_UNAVAILABLE;
  }
  assert(threw, 'stub listProducts throws the unavailable code');

  console.log('shop-provider: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
