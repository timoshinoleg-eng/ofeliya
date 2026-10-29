/**
 * Storefront catalog contract — витрина (rail-agnostic).
 *
 * Covers the pure catalog logic: SHOP_CATALOG validity, validateCatalog
 * (unique ids, kinds, prices, skin art), formatPrice. Compiles the TS
 * modules with tsc like the other node-side contract tests.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Temp dir inside the repo so bare imports resolve via node_modules at
// require() time. The marker package.json opts the dir out of the repo's
// "type": "module" (tsc emits CommonJS).
const temp = mkdtempSync(join(resolve('.'), '.tmp-ofeliya-shop-'));
writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'commonjs' }));
const require = createRequire(import.meta.url);

const assert = (condition, message) => {
  if (!condition) throw new Error(`shop-catalog: ${message}`);
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

  const { SHOP_CATALOG, validateCatalog, formatPrice } = require(join(temp, 'products.js'));

  // --- shipped catalog is valid ---
  eq(validateCatalog(SHOP_CATALOG).length, 0, 'SHOP_CATALOG passes validation');

  // --- duplicate ids ---
  const dup = [...SHOP_CATALOG, { ...SHOP_CATALOG[0] }];
  assert(
    validateCatalog(dup).some((e) => e.includes('duplicate id')),
    'duplicate ids are rejected'
  );

  // --- bad kind ---
  const badKind = [{ ...SHOP_CATALOG[0], id: 'x.bad-kind', kind: 'spaceship' }];
  assert(
    validateCatalog(badKind).some((e) => e.includes('bad kind')),
    'unknown kind is rejected'
  );

  // --- bad prices ---
  for (const price of [
    { amount: 0, currency: 'RUB' },
    { amount: -5, currency: 'RUB' },
    { amount: NaN, currency: 'RUB' },
    { amount: 10, currency: 'rub' },
    { amount: 10, currency: 'R' },
  ]) {
    const errs = validateCatalog([{ ...SHOP_CATALOG[0], id: 'x.bad-price', price }]);
    assert(errs.length > 0, `bad price ${JSON.stringify(price)} is rejected`);
  }

  // --- skin without art.seed/palette ---
  const noSeed = [{ ...SHOP_CATALOG[0], id: 'x.no-seed', art: { seed: '', palette: 'magenta' } }];
  assert(
    validateCatalog(noSeed).some((e) => e.includes('art.seed')),
    'skin without art.seed is rejected'
  );
  const noPalette = [{ ...SHOP_CATALOG[0], id: 'x.no-pal', art: { seed: 's', palette: '' } }];
  assert(
    validateCatalog(noPalette).some((e) => e.includes('art.palette')),
    'skin without art.palette is rejected'
  );

  // --- non-skin products may omit art details (booster/currency carry stubs) ---
  const booster = SHOP_CATALOG.find((p) => p.kind === 'booster');
  assert(booster && booster.art.seed.length > 0, 'booster keeps art stub');

  // --- formatPrice ---
  eq(formatPrice({ amount: 149, currency: 'RUB' }), '149 ₽', 'RUB formats with ₽');
  eq(formatPrice({ amount: 1.99, currency: 'USD' }), '$1.99', 'USD formats with $');
  eq(formatPrice({ amount: 10, currency: 'EUR' }), '10 EUR', 'unknown currency falls back');

  console.log('shop-catalog: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
