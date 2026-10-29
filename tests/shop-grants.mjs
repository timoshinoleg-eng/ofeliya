/**
 * Storefront grant contract — витрина (порт партии 3, main-only).
 *
 * Covers the pure purchase→grant mapping (shop/grantPurchase) and the
 * MetaWallet booster state it writes: skins map to a skin grant, RNA packs
 * to their amounts, the booster to a 7-day window; unknown products grant
 * nothing (fail-closed). Compiles the TS modules with tsc like the other
 * node-side contract tests.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(resolve('.'), '.tmp-ofeliya-shop-'));
writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'commonjs' }));
const require = createRequire(import.meta.url);

const assert = (condition, message) => {
  if (!condition) throw new Error(`shop-grants: ${message}`);
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
      'src/game/shop/grantPurchase.ts',
      'src/game/meta/MetaWallet.ts',
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

  // tsc preserves structure from the common root (src/): outputs land in
  // game/shop/, game/meta/, systems/, ... — not in shop/ directly.
  const { SHOP_CATALOG } = require(join(temp, 'game', 'shop', 'products.js'));
  const { purchaseGrants, applyPurchaseGrants, BOOSTER_DURATION_MS } = require(
    join(temp, 'game', 'shop', 'grantPurchase.js')
  );
  const { loadMeta, setBoosterUntilMs, isBoosterActive } = require(
    join(temp, 'game', 'meta', 'MetaWallet.js')
  );

  // --- booster duration is 7 days (from the product title) ---
  eq(BOOSTER_DURATION_MS, 7 * 24 * 3600 * 1000, 'booster lasts 7 days');

  // --- every catalog product maps to exactly one grant ---
  for (const product of SHOP_CATALOG) {
    const grants = purchaseGrants(product);
    eq(grants.length, 1, `${product.id} maps to exactly one grant`);
  }

  // --- skins map to a skin grant (purchase seam, Phase 5 follow-up) ---
  for (const product of SHOP_CATALOG.filter((p) => p.kind === 'skin')) {
    const [grant] = purchaseGrants(product);
    eq(grant.type, 'skin', `${product.id} grants a skin`);
    eq(grant.skinId, product.id, `${product.id} grants itself`);
  }

  // --- RNA packs map to their amounts ---
  const packS = SHOP_CATALOG.find((p) => p.id === 'currency.rna-pack-s');
  const packM = SHOP_CATALOG.find((p) => p.id === 'currency.rna-pack-m');
  eq(purchaseGrants(packS)[0].amount, 500, 'small pack grants 500 RNA');
  eq(purchaseGrants(packM)[0].amount, 1500, 'medium pack grants 1500 RNA');

  // --- booster maps to a 7-day window ---
  const booster = SHOP_CATALOG.find((p) => p.kind === 'booster');
  eq(purchaseGrants(booster)[0].type, 'booster', 'booster grants a booster');
  eq(purchaseGrants(booster)[0].durationMs, BOOSTER_DURATION_MS, 'booster duration matches');

  // --- unknown products grant nothing (fail-closed) ---
  eq(purchaseGrants({ id: 'nope', kind: 'currency' }).length, 0, 'unknown currency grants nothing');
  eq(purchaseGrants({ id: 'nope', kind: 'spaceship' }).length, 0, 'unknown kind grants nothing');

  // --- booster state round-trips through MetaWallet (Node memFallback) ---
  eq(isBoosterActive(Date.now()), false, 'no booster initially');
  const applied = applyPurchaseGrants(booster);
  eq(applied.length, 1, 'booster apply returns one grant');
  assert(isBoosterActive(Date.now()), 'booster active right after grant');
  assert(!isBoosterActive(Date.now() + BOOSTER_DURATION_MS + 1000), 'booster expires after 7 days');
  setBoosterUntilMs(0);
  eq(isBoosterActive(Date.now()), false, 'booster cleared');
  eq(loadMeta().boosterUntilMs, 0, 'booster state is zero after clear');

  console.log('shop-grants: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
