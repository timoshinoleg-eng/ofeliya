/**
 * Skins contract — скины-штаммы Фазы 5 (DiceBear), порт в main.
 *
 * Covers:
 * - каталог: 4 скина, seed/palette/title/цены шоп-скинов — из inline-дефов
 *   SkinCatalog (в main витрина ещё не портирована, партия 3 переключит
 *   каталог на SHOP_CATALOG; значения — те же, что в каталоге стека);
 * - детерминированность DiceBear: один seed+палитра → один SVG,
 *   разные seed → разные (реальный @dicebear/core + @dicebear/shapes);
 * - владение: grant/equip/персистентность/миграция легаси-грантов Фазы 3;
 * - проводка purchase→grant: grantSkin(id, 'purchase') на уровне владения
 *   (сцена витрины вызовет её при purchase_completed для kind==='skin'
 *   в партии 3; здесь покрыт только уровень владения).
 *
 * Compiles the pure TS modules with tsc like the other node-side tests.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createAvatar } from '@dicebear/core';
import * as shapes from '@dicebear/shapes';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-skins-'));
writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'commonjs' }));
const require = createRequire(import.meta.url);

const assert = (condition, message) => {
  if (!condition) throw new Error(`skins: ${message}`);
};
const eq = (actual, expected, message) =>
  assert(actual === expected, `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/game/skins/SkinCatalog.ts',
      'src/game/skins/SkinOwnership.ts',
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
    ],
    { stdio: 'pipe' }
  );

  const catalog = require(join(temp, 'game/skins/SkinCatalog.js'));
  const own = require(join(temp, 'game/skins/SkinOwnership.js'));

  // --- каталог ---
  const skins = catalog.listSkins();
  eq(skins.length, 4, 'catalog size');
  eq(skins[0].id, 'strain-zero', 'default skin first');
  eq(skins[0].productId, null, 'default skin is free');
  for (const s of skins.slice(1)) {
    assert(s.productId === s.id, `shop skin ${s.id} references its product`);
    assert(typeof s.seed === 'string' && s.seed.length > 0, `skin ${s.id} has seed`);
    assert(typeof s.palette === 'string' && s.palette.length > 0, `skin ${s.id} has palette`);
  }
  // Цены — из каталога (до партии 3 — inline-дефы, значения как в витрине стека): 100/100/250 stars.
  eq(catalog.getSkinPriceStars('skin.virulent-magenta'), 100, 'magenta price');
  eq(catalog.getSkinPriceStars('skin.abyssal-teal'), 100, 'teal price');
  eq(catalog.getSkinPriceStars('skin.gilded-prime'), 250, 'gilded price');
  eq(catalog.getSkinPriceStars('strain-zero'), null, 'default is free');
  eq(catalog.getSkinPriceStars('nope'), null, 'unknown skin price');
  // Ключ текстуры детерминирован и безопасен для Phaser.
  eq(catalog.skinTextureKey('skin.virulent-magenta'), 'skin-tex-skin-virulent-magenta', 'texture key');
  assert(catalog.skinTextureKey('skin.gilded-prime').startsWith('skin-tex-'), 'texture key prefix');

  // --- детерминированность DiceBear ---
  const def = catalog.getSkinDef('skin.virulent-magenta');
  const opts = catalog.skinAvatarOptions(def);
  const svg1 = createAvatar(shapes, opts).toString();
  const svg2 = createAvatar(shapes, opts).toString();
  assert(svg1 === svg2, 'same seed+palette → same SVG');
  assert(svg1.startsWith('<svg'), 'renders SVG');
  const other = catalog.getSkinDef('skin.abyssal-teal');
  const svg3 = createAvatar(shapes, catalog.skinAvatarOptions(other)).toString();
  assert(svg1 !== svg3, 'different seed → different SVG');
  // Палитра влияет на цвета SVG.
  const recolored = createAvatar(
    shapes,
    catalog.skinAvatarOptions({ ...def, palette: 'gold' })
  ).toString();
  assert(svg1 !== recolored, 'different palette → different SVG');

  // --- владение: чистые функции ---
  let store = own.parseStore(null);
  eq(store.equippedId, 'strain-zero', 'default equipped');
  assert(store.owned.includes('strain-zero'), 'default owned');

  store = own.parseStore('garbage{{{');
  eq(store.equippedId, 'strain-zero', 'garbage → default');

  store = own.parseStore(JSON.stringify({ owned: ['strain-zero', 'nope', 'skin.gilded-prime', 'skin.gilded-prime'], equippedId: 'nope' }));
  eq(store.owned.length, 2, 'unknown ids dropped, dupes removed');
  eq(store.equippedId, 'strain-zero', 'equipped not owned → default');

  // grant
  let r = own.grantSkinTo(own.emptyStore(), 'skin.virulent-magenta');
  assert(r.granted, 'grant known skin');
  assert(r.store.owned.includes('skin.virulent-magenta'), 'owned after grant');
  r = own.grantSkinTo(r.store, 'skin.virulent-magenta');
  assert(!r.granted, 'grant is idempotent');
  r = own.grantSkinTo(r.store, 'nope');
  assert(!r.granted, 'unknown skin rejected');

  // equip — только из собственности
  r = own.equipSkinIn(own.emptyStore(), 'skin.gilded-prime');
  assert(!r.ok, 'cannot equip unowned');
  let s2 = own.grantSkinTo(own.emptyStore(), 'skin.gilded-prime').store;
  r = own.equipSkinIn(s2, 'skin.gilded-prime');
  assert(r.ok && r.store.equippedId === 'skin.gilded-prime', 'equip owned');

  // roundtrip
  const back = own.parseStore(own.serializeStore(r.store));
  eq(back.equippedId, 'skin.gilded-prime', 'roundtrip equipped');
  eq(back.owned.length, 2, 'roundtrip owned');

  // миграция легаси-грантов Фазы 3
  const legacy = own.migrateLegacyGrants(JSON.stringify(['skin.gilded-prime', 'nope', 'skin.gilded-prime']));
  eq(legacy.length, 1, 'legacy migration keeps known unique');
  eq(legacy[0], 'skin.gilded-prime', 'legacy migration id');
  eq(own.migrateLegacyGrants('zzz').length, 0, 'legacy garbage → empty');
  eq(own.migrateLegacyGrants(null).length, 0, 'legacy null → empty');

  // --- рантайм-обёртки: localStorage-шим + проводка purchase→grant ---
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => void mem.set(k, String(v)),
    removeItem: (k) => void mem.delete(k),
  };
  // Легаси-грант Фазы 3 подхватывается при первом чтении.
  mem.set('ofeliya.ach-skins.v1', JSON.stringify(['skin.gilded-prime']));
  eq(own.getEquippedSkinId(), 'strain-zero', 'equipped before any grant');
  assert(own.isSkinOwned('skin.gilded-prime'), 'legacy grant migrated to ownership');
  // Покупка: сцена витрины вызывает grantSkin(product.id, 'purchase').
  assert(own.grantSkin('skin.abyssal-teal', 'purchase'), 'purchase grant');
  assert(own.isSkinOwned('skin.abyssal-teal'), 'purchased skin owned');
  assert(own.equipSkin('skin.abyssal-teal'), 'equip purchased');
  eq(own.getEquippedSkinId(), 'skin.abyssal-teal', 'equipped persists');
  assert(!own.equipSkin('skin.virulent-magenta'), 'cannot equip unpurchased');
  delete globalThis.localStorage;

  console.log('skins: OK');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
