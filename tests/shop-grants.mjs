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
  const { purchaseGrants, applyPurchaseGrants, BOOSTER_DURATION_MS, SEASON_PASS_DURATION_MS } = require(
    join(temp, 'game', 'shop', 'grantPurchase.js')
  );
  const { loadMeta, setBoosterUntilMs, isBoosterActive, setSeasonPassUntilMs, isSeasonPassActive } = require(
    join(temp, 'game', 'meta', 'MetaWallet.js')
  );

  // --- booster duration is 7 days (from the product title) ---
  eq(BOOSTER_DURATION_MS, 7 * 24 * 3600 * 1000, 'booster lasts 7 days');
  // --- season pass duration is 30 days (монетизация v3) ---
  eq(SEASON_PASS_DURATION_MS, 30 * 24 * 3600 * 1000, 'season pass lasts 30 days');

  // --- every catalog product maps to grants: singles → 1, bundles → 1 per component ---
  for (const product of SHOP_CATALOG) {
    const grants = purchaseGrants(product);
    if (product.kind === 'bundle') {
      eq(grants.length, product.bundle.length, `${product.id} maps to one grant per component`);
    } else {
      eq(grants.length, 1, `${product.id} maps to exactly one grant`);
    }
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

  // --- season pass maps to a 30-day window (монетизация v3) ---
  const pass = SHOP_CATALOG.find((p) => p.id === 'season-pass.basic-30d');
  assert(pass, 'season pass is in catalog');
  eq(pass.kind, 'season_pass', 'season pass kind');
  eq(pass.stars, 250, 'season pass costs 250 stars');
  eq(purchaseGrants(pass)[0].type, 'season_pass', 'season pass grants a season pass');
  eq(purchaseGrants(pass)[0].durationMs, SEASON_PASS_DURATION_MS, 'season pass duration matches');

  // --- bundles map to one grant per component (монетизация v3) ---
  const starter = SHOP_CATALOG.find((p) => p.id === 'bundle.starter-pack');
  assert(starter, 'starter pack is in catalog');
  eq(starter.kind, 'bundle', 'starter pack kind');
  eq(starter.stars, 150, 'starter pack costs 150 stars');
  const starterGrants = purchaseGrants(starter);
  eq(starterGrants.map((g) => g.type).join(','), 'skin,rna,booster', 'starter grant types');
  eq(starterGrants[0].skinId, 'skin.starter-prime', 'starter grants exclusive skin');
  eq(starterGrants[1].amount, 500, 'starter grants 500 RNA');
  eq(starterGrants[2].durationMs, 3 * 24 * 3600 * 1000, 'starter booster is 3 days (bundle-only grant)');
  const trio = SHOP_CATALOG.find((p) => p.id === 'bundle.skin-trio');
  assert(trio, 'skin trio is in catalog');
  eq(trio.stars, 300, 'skin trio costs 300 stars');
  const trioGrants = purchaseGrants(trio);
  eq(trioGrants.length, 3, 'trio grants 3 skins');
  eq(trioGrants.every((g) => g.type === 'skin'), true, 'trio grants are all skins');
  eq(
    trioGrants.map((g) => g.skinId).sort().join(','),
    'skin.abyssal-teal,skin.gilded-prime,skin.virulent-magenta',
    'trio skin ids'
  );
  // битый бандл (нет компонентов) — пустой список, не падение
  eq(purchaseGrants({ id: 'bundle.broken', kind: 'bundle' }).length, 0, 'bundle without components grants nothing');

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

  // --- season pass state round-trips through MetaWallet (монетизация v3) ---
  eq(isSeasonPassActive(Date.now()), false, 'no season pass initially');
  const passApplied = applyPurchaseGrants(pass);
  eq(passApplied.length, 1, 'season pass apply returns one grant');
  assert(isSeasonPassActive(Date.now()), 'season pass active right after grant');
  assert(
    !isSeasonPassActive(Date.now() + SEASON_PASS_DURATION_MS + 1000),
    'season pass expires after 30 days'
  );
  // повторная покупка продлевает от текущего срока (как бустер, патч №11)
  const firstUntil = loadMeta().seasonPassUntilMs;
  applyPurchaseGrants(pass);
  assert(
    loadMeta().seasonPassUntilMs >= firstUntil + SEASON_PASS_DURATION_MS - 1000,
    'season pass renewal extends from current term'
  );
  setSeasonPassUntilMs(0);
  eq(isSeasonPassActive(Date.now()), false, 'season pass cleared');
  eq(loadMeta().seasonPassUntilMs, 0, 'season pass state is zero after clear');

  console.log('shop-grants: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
