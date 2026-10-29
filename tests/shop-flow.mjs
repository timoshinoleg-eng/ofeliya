/**
 * Storefront wiring contract — витрина (rail-agnostic).
 *
 * Covers provider resolution from the storefront.variant flag
 * ('hidden' default | 'mock' | 'max'), the menu entry-point gate,
 * and the flag default itself. Compiles the TS modules with tsc
 * like the other node-side contract tests.
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
  if (!condition) throw new Error(`shop-flow: ${message}`);
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
      'src/game/shop/Storefront.ts',
      'src/game/FeatureFlags.ts',
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

  // tsc common root is now src/ (not src/game/): Storefront imports
  // TelegramStars → PaymentLedger → grantPurchase → SkinOwnership →
  // ClientExperience (src/systems/), so outputs land in game/shop/ and
  // game/FeatureFlags.js. Same assertions, only the require paths moved.
  const { FLAG_DEFAULTS } = require(join(temp, 'game', 'FeatureFlags.js'));
  const { resolveProvider, isStorefrontVisible } = require(join(temp, 'game', 'shop', 'Storefront.js'));
  const { MockPaymentProvider } = require(join(temp, 'game', 'shop', 'MockPaymentProvider.js'));
  const { MaxBridgePaymentProvider } = require(join(temp, 'game', 'shop', 'MaxBridgePaymentProvider.js'));

  // --- flag default is fail-closed ---
  eq(FLAG_DEFAULTS['storefront.variant'], 'hidden', 'storefront.variant defaults to hidden');

  // --- menu entry-point gate ---
  eq(isStorefrontVisible('hidden'), false, 'hidden: no entry point');
  eq(isStorefrontVisible('mock'), true, 'mock: entry point visible');
  eq(isStorefrontVisible('max'), true, 'max: entry point visible (stub shows "soon")');
  eq(isStorefrontVisible('control'), false, 'legacy value: fail-closed');
  eq(isStorefrontVisible(''), false, 'empty: fail-closed');
  eq(isStorefrontVisible('bogus'), false, 'unknown: fail-closed');

  // --- provider resolution ---
  eq(resolveProvider('hidden'), null, 'hidden resolves to null');
  eq(resolveProvider('bogus'), null, 'unknown resolves to null');
  // Патч №13 (P1-f): mock — только QA-сборки, fail-closed без qaTools.
  eq(resolveProvider('mock'), null, 'mock without opts: fail-closed null');
  eq(resolveProvider('mock', {}), null, 'mock with empty opts: fail-closed null');
  eq(resolveProvider('mock', { qaTools: false }), null, 'mock qaTools:false: fail-closed null');
  const mock = resolveProvider('mock', { qaTools: true });
  assert(mock instanceof MockPaymentProvider, 'mock qaTools:true resolves to MockPaymentProvider');
  assert(mock.isAvailable(), 'resolved mock is available');
  const stub = resolveProvider('max');
  assert(stub instanceof MaxBridgePaymentProvider, 'max resolves to MaxBridgePaymentProvider');
  eq(stub.isAvailable(), false, 'resolved stub is unavailable');

  console.log('shop-flow: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
