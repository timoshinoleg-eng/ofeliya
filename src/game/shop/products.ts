/**
 * Каталог витрины — данные, не код (витрина OFELIYA, rail-agnostic).
 *
 * Цены — нейтральный формат {amount, currency} + опциональные stars (XTR,
 * целые) для Telegram Stars (см. TelegramStarsPaymentProvider).
 * Скины несут DiceBear-совместимые поля art.seed/art.palette
 * (Фаза 5 сгенерирует из них SVG-арт); сейчас UI рисует детерминированную
 * заглушку по хешу seed.
 *
 * Модуль Phaser-free: validateCatalog/formatPrice — чистые функции,
 * тестируются в Node.
 */
import type { Product, ProductKind, ProductPrice } from './PaymentProvider';

export const SHOP_CATALOG: readonly Product[] = [
  {
    id: 'skin.virulent-magenta',
    kind: 'skin',
    title: 'Штамм «Вирулентный»',
    description: 'Пурпурный боевой окрас STRAIN-0. Чистая косметика.',
    price: { amount: 149, currency: 'RUB' },
    stars: 100,  // Telegram Stars (XTR)
    art: { seed: 'virulent-01', palette: 'magenta' },
    tag: 'HIT',
  },
  {
    id: 'skin.abyssal-teal',
    kind: 'skin',
    title: 'Штамм «Бездонный»',
    description: 'Глубоководный тил. Виден даже в темной плазме.',
    price: { amount: 149, currency: 'RUB' },
    stars: 100,  // Telegram Stars (XTR)
    art: { seed: 'abyssal-02', palette: 'teal' },
    tag: 'NEW',
  },
  {
    id: 'skin.gilded-prime',
    kind: 'skin',
    title: 'Штамм «Позолоченный»',
    description: 'Праймовый золотой штамм для ветеранов кровотока.',
    price: { amount: 299, currency: 'RUB' },
    stars: 250,  // Telegram Stars (XTR)
    art: { seed: 'gilded-03', palette: 'gold' },
  },
  {
    id: 'booster.rna-x2-7d',
    kind: 'booster',
    title: 'РНК ×2 — 7 дней',
    description: 'Двойной дроп РНК со всех гемов в течение недели.',
    price: { amount: 99, currency: 'RUB' },
    stars: 75,  // Telegram Stars (XTR)
    art: { seed: 'booster-rna-x2', palette: 'green' },
  },
  {
    id: 'currency.rna-pack-s',
    kind: 'currency',
    title: 'Набор РНК ×500',
    description: 'Малая капсула чистой РНК для лаборатории мутаций.',
    price: { amount: 49, currency: 'RUB' },
    stars: 35,  // Telegram Stars (XTR)
    art: { seed: 'rna-pack-s', palette: 'cyan' },
  },
  {
    id: 'currency.rna-pack-m',
    kind: 'currency',
    title: 'Набор РНК ×1500',
    description: 'Средняя капсула. Выгоднее малого набора на 13%.',
    price: { amount: 129, currency: 'RUB' },
    stars: 100,  // Telegram Stars (XTR)
    art: { seed: 'rna-pack-m', palette: 'cyan' },
    tag: '-13%',
  },
];

const VALID_KINDS: readonly ProductKind[] = ['skin', 'booster', 'currency'];

/**
 * Чистая функция: проверяет каталог. Возвращает список ошибок (пусто = ок).
 * Проверки: уникальные непустые id, валидный kind, положительная цена,
 * ISO-код валюты, непустые title/description, art.seed+palette у скинов.
 */
export function validateCatalog(products: readonly Product[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  products.forEach((p, i) => {
    const where = `products[${i}]${p && p.id ? ` (${p.id})` : ''}`;
    if (!p || typeof p !== 'object') {
      errors.push(`${where}: not an object`);
      return;
    }
    if (!p.id || typeof p.id !== 'string') errors.push(`${where}: bad id`);
    else if (seen.has(p.id)) errors.push(`${where}: duplicate id '${p.id}'`);
    else seen.add(p.id);
    if (!VALID_KINDS.includes(p.kind)) errors.push(`${where}: bad kind '${p.kind}'`);
    if (
      !p.price ||
      typeof p.price.amount !== 'number' ||
      !Number.isFinite(p.price.amount) ||
      p.price.amount <= 0
    ) {
      errors.push(`${where}: bad price.amount`);
    }
    if (!p.price || typeof p.price.currency !== 'string' || !/^[A-Z]{3}$/.test(p.price.currency)) {
      errors.push(`${where}: bad price.currency (want ISO 4217)`);
    }
    if (!p.title || typeof p.title !== 'string') errors.push(`${where}: bad title`);
    if (!p.description || typeof p.description !== 'string')
      errors.push(`${where}: bad description`);
    if (p.kind === 'skin') {
      if (!p.art || typeof p.art.seed !== 'string' || !p.art.seed)
        errors.push(`${where}: skin without art.seed`);
      if (!p.art || typeof p.art.palette !== 'string' || !p.art.palette)
        errors.push(`${where}: skin without art.palette`);
    }
    if (p.tag !== undefined && (typeof p.tag !== 'string' || !p.tag))
      errors.push(`${where}: bad tag`);
    if (p.stars !== undefined && (!Number.isInteger(p.stars) || p.stars <= 0))
      errors.push(`${where}: bad stars (want positive integer XTR)`);
  });
  return errors;
}

/**
 * Чистая функция: нейтральное форматирование цены.
 * RUB → «149 ₽», USD → «$1.99», иначе «149 RUB».
 */
export function formatPrice(price: ProductPrice): string {
  const { amount, currency } = price;
  if (currency === 'RUB') return `${amount} ₽`;
  if (currency === 'USD') return `$${amount.toFixed(2)}`;
  return `${amount} ${currency}`;
}
