/**
 * Post-review fixes contract — патч №11 (порт партии 4а).
 *
 * Covers:
 * - grantMetaRna: возвращает {balance, granted}; бустер «РНК ×2»
 *   удваивает ДОХОД (независимо от флага economy.lab); отрицательный
 *   вход → 0; UI-показ granted (GameScene/RetentionOverlays/StorefrontScene
 *   покрыты чтением кода — тосты берут granted, а не базовую награду);
 * - prestigeRequiredLevels: 10 + prestigeCount*5 (чистая функция);
 *   doPrestige гейтится по ней (полный reset — в tests/lab-economy.mjs);
 * - Juice.hitStop: повторный вызов в окне recover — траектория нового
 *   дипа чистая (hold на floor, восстановление к 1). Честная оговорка:
 *   в main баг стека («старый recover борется с новым dip») НЕ
 *   воспроизводится — в установленном tween.js stop() уже каскадит в
 *   chained-твины (проверено по коду tween.umd.js и эмпирически: старый
 *   код даёт ту же чистую траекторию). Поэтому двухполевая версия —
 *   hardening (инвариант явный, а не завязанный на каскад библиотеки),
 *   а тест здесь — characterization/guard, а не repro живого бага.
 * - grantPurchase: повторная покупка бустера продлевает от
 *   max(now, текущий срок) — время не сгорает.
 *
 * Не покрывается здесь (уже в main из партии 3, сверено grep):
 * recordStarsSpent wired, packs grant addRna flat, boosterUntilMs в
 * grantPurchase, Stars-цены в каталоге, SkinArt loaderror cleanup,
 * SkinGallery re-render, TelegramPlatform insets, ArtMetrics BAKE_FACTOR.
 *
 * Compiles the TS modules with tsc like the other node-side tests.
 * Phaser — только типы (стираются при компиляции), сцена — фейк.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(resolve('.'), '.tmp-ofeliya-post-review-'));
writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'commonjs' }));
const require = createRequire(import.meta.url);

const assert = (condition, message) => {
  if (!condition) throw new Error(`post-review-fixes: ${message}`);
};
const eq = (actual, expected, message) =>
  assert(actual === expected, `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
const approx = (actual, expected, eps, message) =>
  assert(Math.abs(actual - expected) <= eps, `${message}: expected ~${expected}, got ${actual}`);

// In-memory localStorage — ставится ДО require модулей.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
};

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/game/lab/LabState.ts',
      'src/game/shop/grantPurchase.ts',
      'src/game/shop/products.ts',
      'src/game/shop/PaymentProvider.ts',
      'src/game/meta/MetaWallet.ts',
      'src/game/Juice.ts',
      '--target',
      'ES2020',
      '--module',
      'commonjs',
      '--moduleResolution',
      'node',
      '--rootDir',
      'src',
      '--outDir',
      temp,
      '--skipLibCheck',
      'true',
      '--esModuleInterop',
      'true',
    ],
    { stdio: 'pipe' }
  );

  const lab = require(join(temp, 'game/lab/LabState.js'));
  const mw = require(join(temp, 'game/meta/MetaWallet.js'));
  const ff = require(join(temp, 'game/FeatureFlags.js'));
  const grants = require(join(temp, 'game/shop/grantPurchase.js'));
  const products = require(join(temp, 'game/shop/products.js'));
  const juiceMod = require(join(temp, 'game/Juice.js'));

  // --- grantMetaRna: {balance, granted} + бустер ---
  store.delete('ofeliya.meta.v1');
  store.set('ofeliya.lab.v1', JSON.stringify({ levels: {}, prestigeCount: 0 }));
  let r = lab.grantMetaRna(100);
  eq(r.granted, 100, 'grant with no levels: granted 100');
  eq(r.balance, 100, 'grant with no levels: balance 100');

  store.set('ofeliya.lab.v1', JSON.stringify({ levels: { metabolism: 3 }, prestigeCount: 0 }));
  r = lab.grantMetaRna(100);
  eq(r.granted, 130, 'grant with metabolism 3 → 130');

  // Бустер удваивает доход: без лаборатории и с ней.
  mw.setBoosterUntilMs(Date.now() + 86400000);
  store.set('ofeliya.lab.v1', JSON.stringify({ levels: {}, prestigeCount: 0 }));
  r = lab.grantMetaRna(100);
  eq(r.granted, 200, 'booster doubles income without lab');
  store.set('ofeliya.lab.v1', JSON.stringify({ levels: { metabolism: 3 }, prestigeCount: 0 }));
  r = lab.grantMetaRna(100);
  eq(r.granted, 260, 'booster stacks with lab multiplier');

  // Флаг economy.lab выключен: множитель лаборатории не применяется,
  // но бустер всё равно удваивает (семантика стека).
  ff.FeatureFlags.setOverride('economy.lab', false);
  store.set('ofeliya.lab.v1', JSON.stringify({ levels: { metabolism: 3 }, prestigeCount: 0 }));
  r = lab.grantMetaRna(100);
  eq(r.granted, 200, 'flag off: lab multiplier ignored, booster still doubles');
  ff.FeatureFlags.reset();

  // Отрицательный вход → 0, баланс не меняется.
  const beforeNeg = mw.loadMeta().rna;
  r = lab.grantMetaRna(-50);
  eq(r.granted, 0, 'negative grant → 0');
  eq(mw.loadMeta().rna, beforeNeg, 'negative grant leaves balance');

  // --- prestigeRequiredLevels: 10 + count*5 ---
  eq(lab.prestigeRequiredLevels(0), 10, 'prestige 0 → 10');
  eq(lab.prestigeRequiredLevels(1), 15, 'prestige 1 → 15');
  eq(lab.prestigeRequiredLevels(2), 20, 'prestige 2 → 20');
  eq(lab.prestigeRequiredLevels(-3), 10, 'prestige negative clamps');

  // Гейт doPrestige по шкале: при count 2 нужно 20 уровней.
  store.set('ofeliya.lab.v1', JSON.stringify({ levels: { metabolism: 10, chitin: 9 }, prestigeCount: 2 }));
  let res = lab.doPrestige();
  eq(res.ok, false, 'prestige gated below scaled threshold (count 2)');
  eq(res.reason, 'no_levels', 'reason no_levels below threshold');

  // --- grantPurchase: бустер продлевается, а не перезаписывается ---
  const booster = products.SHOP_CATALOG.find((p) => p.kind === 'booster');
  const dayMs = 24 * 3600 * 1000;
  mw.setBoosterUntilMs(Date.now() + dayMs);
  const prevUntil = mw.getBoosterUntilMs();
  grants.applyPurchaseGrants(booster);
  eq(
    mw.getBoosterUntilMs(),
    prevUntil + grants.BOOSTER_DURATION_MS,
    'booster extends from current expiry, time does not burn'
  );

  // --- Juice.hitStop: фейковая сцена, время инжектится явно ---
  // NB: tween.js стартует от performance.now(), поэтому группу прогоняем
  // от захваченного t0/t1, а не от нуля (как в tests/juice-driver.mjs).
  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const fakeScene = () => ({ time: { timeScale: 1 }, physics: { world: { timeScale: 1 } } });

  {
    // Базовый цикл: дип + восстановление.
    const scene = fakeScene();
    const juice = new juiceMod.Juice(scene);
    const t0 = nowMs();
    juice.hitStop(120);
    let minSeen = 1;
    for (let dt = 0; dt <= 800; dt += 5) {
      juice.update(t0 + dt);
      if (scene.time.timeScale < minSeen) minSeen = scene.time.timeScale;
    }
    assert(minSeen < 0.5, `dip observed (min ${minSeen})`);
    eq(scene.time.timeScale, 1, 'timeScale restored after full cycle');
    eq(scene.physics.world.timeScale, 1, 'world timeScale restored');
  }
  {
    // Повторный вызов в окне recover: траектория нового дипа чистая.
    // Characterization/guard (см. шапку): на установленном tween.js
    // stop() каскадит, поэтому старый код даёт ту же траекторию —
    // тест пинит корректное поведение, а не ловит живой баг main.
    const scene = fakeScene();
    const juice = new juiceMod.Juice(scene);
    const t0 = nowMs();
    juice.hitStop(100);
    for (let dt = 0; dt <= 60; dt += 5) juice.update(t0 + dt); // дип завершён, recover в delay
    const t1 = nowMs();
    juice.hitStop(200); // новый дип 110 мс, hold 90 мс, recover 150 мс
    let minSeen = 1;
    let holdSample = null;
    for (let dt = 0; dt <= 600; dt += 5) {
      juice.update(t1 + dt);
      if (scene.time.timeScale < minSeen) minSeen = scene.time.timeScale;
      if (dt === 140) holdSample = scene.time.timeScale; // внутри hold нового дипа
    }
    assert(minSeen < 0.5, `second dip observed (min ${minSeen})`);
    approx(holdSample, 0.06, 0.05, `hold phase stays at floor, got ${holdSample}`);
    eq(scene.time.timeScale, 1, 'timeScale restored after re-entrant hitStop');
    eq(scene.physics.world.timeScale, 1, 'world timeScale restored after re-entrant hitStop');
  }
  {
    // hitStop(0) — no-op, reset() — чистый выход.
    const scene = fakeScene();
    const juice = new juiceMod.Juice(scene);
    const t0 = nowMs();
    juice.hitStop(0);
    for (let dt = 0; dt <= 100; dt += 10) juice.update(t0 + dt);
    eq(scene.time.timeScale, 1, 'hitStop(0) no-op');
    juice.hitStop(120);
    const t1 = nowMs();
    for (let dt = 0; dt <= 30; dt += 10) juice.update(t1 + dt);
    juice.reset();
    eq(scene.time.timeScale, 1, 'reset restores timeScale');
  }

  console.log('post-review-fixes: OK');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
