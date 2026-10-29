/**
 * Feature flags contract — Phase 2 (micro-flags, ноль зависимостей).
 *
 * Covers the pure logic (resolveFlags, readUrlFlagOverrides) and the singleton
 * lifecycle (defaults before init, overrides via init, setOverride/reset).
 * Compiles the TS module with tsc like the other node-side contract tests.
 *
 * Scope: Phase 2 keys (events.doubleRna, difficulty.earlyGame,
 * storefront.variant) + Phase 3 key (retention.quests, порт Фазы 3)
 * + Phase 4 key (economy.lab, порт Фазы 4)
 * + Phase 5 key (skins.gallery, порт Фазы 5).
 * Later phases add their own keys here.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Temp dir inside the repo (consistent with other contract tests).
// The marker package.json opts the dir out of the repo's "type": "module"
// (tsc emits CommonJS).
const temp = mkdtempSync(join(resolve('.'), '.tmp-ofeliya-ff-'));
writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'commonjs' }));
const require = createRequire(import.meta.url);

const assert = (condition, message) => {
  if (!condition) throw new Error(`feature-flags: ${message}`);
};
const eq = (actual, expected, message) =>
  assert(actual === expected, `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
const deepEq = (actual, expected, message) =>
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
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

  const {
    FLAG_DEFAULTS,
    resolveFlags,
    readUrlFlagOverrides,
    FeatureFlags,
  } = require(join(temp, 'FeatureFlags.js'));

  // --- defaults ---
  deepEq(
    FLAG_DEFAULTS,
    { 'events.doubleRna': false, 'difficulty.earlyGame': 1, 'storefront.variant': 'hidden', 'retention.quests': true, 'economy.lab': true, 'skins.gallery': true },
    'FLAG_DEFAULTS'
  );

  // --- resolveFlags: pure merge ---
  deepEq(resolveFlags(), FLAG_DEFAULTS, 'resolveFlags() with no args = defaults');
  deepEq(
    resolveFlags({ 'events.doubleRna': true }),
    { 'events.doubleRna': true, 'difficulty.earlyGame': 1, 'storefront.variant': 'hidden', 'retention.quests': true, 'economy.lab': true, 'skins.gallery': true },
    'resolveFlags partial override'
  );
  deepEq(
    resolveFlags({ 'difficulty.earlyGame': 1.25, 'storefront.variant': 'featured' }),
    { 'events.doubleRna': false, 'difficulty.earlyGame': 1.25, 'storefront.variant': 'featured', 'retention.quests': true, 'economy.lab': true, 'skins.gallery': true },
    'resolveFlags multiple overrides'
  );
  deepEq(
    resolveFlags({ 'retention.quests': false }),
    { 'events.doubleRna': false, 'difficulty.earlyGame': 1, 'storefront.variant': 'hidden', 'retention.quests': false, 'economy.lab': true, 'skins.gallery': true },
    'resolveFlags retention override'
  );
  deepEq(
    resolveFlags({ 'economy.lab': false }),
    { 'events.doubleRna': false, 'difficulty.earlyGame': 1, 'storefront.variant': 'hidden', 'retention.quests': true, 'economy.lab': false, 'skins.gallery': true },
    'resolveFlags lab override'
  );
  deepEq(
    resolveFlags({ 'skins.gallery': false }),
    { 'events.doubleRna': false, 'difficulty.earlyGame': 1, 'storefront.variant': 'hidden', 'retention.quests': true, 'economy.lab': true, 'skins.gallery': false },
    'resolveFlags gallery override'
  );
  deepEq(
    resolveFlags({ 'unknown.flag': true }),
    FLAG_DEFAULTS,
    'resolveFlags ignores unknown keys'
  );
  deepEq(
    resolveFlags({ 'storefront.variant': '' }),
    FLAG_DEFAULTS,
    'resolveFlags: empty string variant falls back to default'
  );

  // --- readUrlFlagOverrides: ?flag.<key>=<value> ---
  deepEq(readUrlFlagOverrides(''), {}, 'empty search = no overrides');
  deepEq(
    readUrlFlagOverrides('?flag.events.doubleRna=true'),
    { 'events.doubleRna': true },
    'URL bool true'
  );
  deepEq(
    readUrlFlagOverrides('?flag.events.doubleRna=0&flag.difficulty.earlyGame=1.5'),
    { 'events.doubleRna': false, 'difficulty.earlyGame': 1.5 },
    'URL bool false + number'
  );
  deepEq(
    readUrlFlagOverrides('?flag.events.doubleRna=yes&flag.difficulty.earlyGame=-2&flag.storefront.variant='),
    {},
    'URL garbage values ignored'
  );
  deepEq(
    readUrlFlagOverrides('?flag.retention.quests=false'),
    { 'retention.quests': false },
    'URL retention bool false'
  );
  deepEq(
    readUrlFlagOverrides('?flag.retention.quests=yes'),
    {},
    'URL retention garbage ignored'
  );
  deepEq(
    readUrlFlagOverrides('?flag.economy.lab=false'),
    { 'economy.lab': false },
    'URL lab bool false'
  );
  deepEq(
    readUrlFlagOverrides('?flag.economy.lab=yes'),
    {},
    'URL lab garbage ignored'
  );
  deepEq(
    readUrlFlagOverrides('?flag.skins.gallery=false'),
    { 'skins.gallery': false },
    'URL gallery bool false'
  );
  deepEq(
    readUrlFlagOverrides('?flag.skins.gallery=yes'),
    {},
    'URL gallery garbage ignored'
  );
  deepEq(
    readUrlFlagOverrides('?flag.unknown.flag=1'),
    {},
    'URL unknown flags ignored'
  );
  deepEq(
    readUrlFlagOverrides('?flag.storefront.variant=' + 'x'.repeat(65)),
    {},
    'URL overlong variant ignored'
  );

  // --- singleton lifecycle (async) ---
  await (async () => {
    // Before init: safe defaults, never throws.
    eq(FeatureFlags.get('events.doubleRna'), false, 'get() before init = default');
    eq(FeatureFlags.get('difficulty.earlyGame'), 1, 'get() number before init = default');
    eq(FeatureFlags.get('retention.quests'), true, 'retention default true before init');
    eq(FeatureFlags.get('economy.lab'), true, 'lab default true before init');
    eq(FeatureFlags.get('skins.gallery'), true, 'gallery default true before init');
    eq(FeatureFlags.isInitialized(), false, 'not initialized before init()');

    // init() with overrides resolves through the micro-flags pipeline.
    await FeatureFlags.init({ 'events.doubleRna': true, 'difficulty.earlyGame': 1.25 });
    eq(FeatureFlags.isInitialized(), true, 'initialized after init()');
    eq(FeatureFlags.get('events.doubleRna'), true, 'init override bool applied');
    eq(FeatureFlags.get('difficulty.earlyGame'), 1.25, 'init override number applied');
    eq(FeatureFlags.get('storefront.variant'), 'hidden', 'non-overridden flag keeps default');
    eq(FeatureFlags.get('retention.quests'), true, 'retention keeps default when not overridden');
    eq(FeatureFlags.get('economy.lab'), true, 'lab keeps default when not overridden');
    eq(FeatureFlags.get('skins.gallery'), true, 'gallery keeps default when not overridden');

    // setOverride / reset round-trip.
    FeatureFlags.setOverride('storefront.variant', 'featured');
    eq(FeatureFlags.get('storefront.variant'), 'featured', 'setOverride applies');
    FeatureFlags.setOverride('retention.quests', false);
    eq(FeatureFlags.get('retention.quests'), false, 'retention setOverride applies');
    FeatureFlags.setOverride('economy.lab', false);
    eq(FeatureFlags.get('economy.lab'), false, 'lab setOverride applies');
    FeatureFlags.setOverride('skins.gallery', false);
    eq(FeatureFlags.get('skins.gallery'), false, 'gallery setOverride applies');
    FeatureFlags.reset();
    eq(FeatureFlags.get('storefront.variant'), 'hidden', 'reset restores default');
    eq(FeatureFlags.get('retention.quests'), true, 'reset restores retention default');
    eq(FeatureFlags.get('economy.lab'), true, 'reset restores lab default');
    eq(FeatureFlags.get('skins.gallery'), true, 'reset restores gallery default');
    eq(FeatureFlags.isInitialized(), false, 'reset clears initialized');

    // init() with no overrides = pure defaults through the provider.
    await FeatureFlags.init();
    deepEq(
      {
        'events.doubleRna': FeatureFlags.get('events.doubleRna'),
        'difficulty.earlyGame': FeatureFlags.get('difficulty.earlyGame'),
        'storefront.variant': FeatureFlags.get('storefront.variant'),
        'retention.quests': FeatureFlags.get('retention.quests'),
        'economy.lab': FeatureFlags.get('economy.lab'),
        'skins.gallery': FeatureFlags.get('skins.gallery'),
      },
      FLAG_DEFAULTS,
      'init() with no overrides = defaults'
    );
    FeatureFlags.reset();
  })();

  // --- Патч №13 (P1-f): ?flag.-оверрайды — только QA-сборки ---
  // ВАЖНО для Mark: QA-сборки требуют VITE_QA_TOOLS=1 — ?flag. в URL
  // работает только при qaTools (dev или VITE_QA_TOOLS=1, см. main.ts).
  await (async () => {
    FeatureFlags.reset();
    globalThis.location = {
      search: '?flag.events.doubleRna=true&flag.storefront.variant=mock&flag.retention.quests=false',
    };
    try {
      await FeatureFlags.init({}, { qaTools: true });
      eq(FeatureFlags.get('events.doubleRna'), true, 'qaTools: URL bool override applied');
      eq(FeatureFlags.get('storefront.variant'), 'mock', 'qaTools: URL variant override applied');
      eq(FeatureFlags.get('retention.quests'), false, 'qaTools: URL retention override applied');

      FeatureFlags.reset();
      await FeatureFlags.init({}, { qaTools: false });
      eq(FeatureFlags.get('events.doubleRna'), false, 'qaTools:false: URL overrides ignored');
      eq(
        FeatureFlags.get('storefront.variant'),
        'hidden',
        'qaTools:false: variant keeps default'
      );
      eq(FeatureFlags.get('retention.quests'), true, 'qaTools:false: retention keeps default');

      FeatureFlags.reset();
      await FeatureFlags.init({});
      eq(FeatureFlags.get('events.doubleRna'), false, 'default opts: URL overrides ignored');

      FeatureFlags.reset();
      await FeatureFlags.init();
      eq(FeatureFlags.get('events.doubleRna'), false, 'no-arg init: URL overrides ignored');

      // Явные (не URL) оверрайды работают всегда — гейт только для ?flag.
      FeatureFlags.reset();
      await FeatureFlags.init({ 'events.doubleRna': true });
      eq(FeatureFlags.get('events.doubleRna'), true, 'explicit overrides work without qaTools');

      // readUrlFlagOverrides остаётся чистой экспортируемой функцией.
      eq(typeof readUrlFlagOverrides, 'function', 'readUrlFlagOverrides exported');
      FeatureFlags.reset();
    } finally {
      delete globalThis.location;
    }
  })();

  console.log('feature-flags: OK');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
