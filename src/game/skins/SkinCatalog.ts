/**
 * SkinCatalog — каталог скинов-штаммов (Фаза 5, DiceBear).
 *
 * Данные, не код. Шоп-скины берутся из SHOP_CATALOG (src/game/shop/products.ts)
 * как единого источника: id/title/seed/palette — оттуда, дублирования нет.
 * Редкость — галерейная аннотация (в каталоге витрины её нет), а цены в
 * звёздах (XTR) пока заданы здесь же: витрина партии 3 несёт только RUB-цены,
 * поле stars в SHOP_CATALOG добавит партия Stars — тогда и stars переедут
 * туда, а productId уже сейчас совпадают с id товаров.
 * Дефолтный скин 'strain-zero' — каноничный арт 'virus-player' (без DiceBear).
 *
 * Модуль Phaser-free: чистые функции, тестируются в Node.
 * Рендер SVG — в SkinArt.ts (там же зависимость @dicebear/*).
 */
import { SHOP_CATALOG } from '../shop/products';

export type SkinRarity = 'common' | 'rare' | 'legendary';

/** Дефолтный скин: каноничный процедурный арт, без DiceBear-рендера. */
export const DEFAULT_SKIN_ID = 'strain-zero';

export interface SkinDef {
  id: string;
  title: string;
  /** DiceBear-seed (для дефолтного — служебный, не рендерится). */
  seed: string;
  /** Ключ палитры → PALETTE_COLORS. */
  palette: string;
  rarity: SkinRarity;
  /** id товара в будущей витрине (цена/stars — оттуда) или null (бесплатный). */
  productId: string | null;
  /** Цена в звёздах Telegram (XTR); null — бесплатный. До партии 3 — из этих данных. */
  stars: number | null;
}

/** Палитра → цвета DiceBear (hex без '#'): 3 фигуры + фон. */
export const PALETTE_COLORS: Record<
  string,
  { shape1: string; shape2: string; shape3: string; background: string }
> = {
  bio: { shape1: '7fffa1', shape2: '2f9e5f', shape3: 'd2ffe0', background: '050d08' },
  magenta: { shape1: 'ff4fb5', shape2: 'b3128f', shape3: 'ffc2e2', background: '14060f' },
  teal: { shape1: '2fd6c0', shape2: '0f8f80', shape3: 'b8fff4', background: '041410' },
  gold: { shape1: 'ffd56a', shape2: 'c98f1b', shape3: 'fff3c4', background: '141006' },
};

/** Чистая функция: цвета палитры (неизвестная → 'bio'). */
export function paletteColors(palette: string): {
  shape1: string;
  shape2: string;
  shape3: string;
  background: string;
} {
  return PALETTE_COLORS[palette] ?? PALETTE_COLORS.bio;
}

/** Галерейные аннотации шоп-скинов (rarity нет в каталоге витрины). */
const SHOP_SKIN_META: Record<string, { rarity: SkinRarity; stars: number }> = {
  'skin.virulent-magenta': { rarity: 'rare', stars: 100 },
  'skin.abyssal-teal': { rarity: 'rare', stars: 100 },
  'skin.gilded-prime': { rarity: 'legendary', stars: 250 },
};

export const SKIN_CATALOG: readonly SkinDef[] = [
  {
    id: DEFAULT_SKIN_ID,
    title: 'Штамм «Нулевой»',
    seed: 'strain-zero-base',
    palette: 'bio',
    rarity: 'common',
    productId: null,
    stars: null,
  },
  // Шоп-скины: id/title/seed/palette — из SHOP_CATALOG (единый источник);
  // rarity и stars — галерейные аннотации (см. шапку: stars переедут
  // в SHOP_CATALOG с партией Stars).
  ...SHOP_CATALOG.filter((p) => p.kind === 'skin').map((p) => ({
    id: p.id,
    title: p.title,
    seed: p.art.seed,
    palette: p.art.palette,
    rarity: SHOP_SKIN_META[p.id]?.rarity ?? 'rare',
    productId: p.id,
    stars: SHOP_SKIN_META[p.id]?.stars ?? null,
  })),
];

const BY_ID = new Map(SKIN_CATALOG.map((s) => [s.id, s]));

/** Чистая функция: определение скина по id. */
export function getSkinDef(skinId: string): SkinDef | undefined {
  return BY_ID.get(skinId);
}

/** Чистая функция: весь каталог. */
export function listSkins(): readonly SkinDef[] {
  return SKIN_CATALOG;
}

/**
 * Чистая функция: опции для DiceBear createAvatar (стиль 'shapes').
 * Детерминированы: один seed+палитра → один SVG.
 */
export function skinAvatarOptions(def: SkinDef): {
  seed: string;
  shape1Color: string[];
  shape2Color: string[];
  shape3Color: string[];
  backgroundColor: string[];
} {
  const c = paletteColors(def.palette);
  return {
    seed: def.seed,
    shape1Color: [c.shape1],
    shape2Color: [c.shape2],
    shape3Color: [c.shape3],
    backgroundColor: [c.background],
  };
}

/** Ключ текстуры Phaser для запечённого скина. */
export function skinTextureKey(skinId: string): string {
  return `skin-tex-${skinId.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}`;
}

/** Чистая функция: цена скина в звёздах (XTR); null — бесплатный. */
export function getSkinPriceStars(skinId: string): number | null {
  const def = BY_ID.get(skinId);
  if (!def) return null;
  return def.stars;
}

/** Подписи редкости для UI. */
export const RARITY_LABEL: Record<SkinRarity, string> = {
  common: 'ОБЫЧНЫЙ',
  rare: 'РЕДКИЙ',
  legendary: 'ЛЕГЕНДАРНЫЙ',
};
