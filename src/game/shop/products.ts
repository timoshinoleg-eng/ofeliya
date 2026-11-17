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
 *
 * ПРАВИЛО (P2-8): скидочные теги ('-N%') и процентные утверждения в
 * описаниях считаются В ВАЛЮТЕ ПОКУПКИ — Telegram Stars (XTR), которыми
 * реально платят, — а не в витринных рублях. Рублёвая цена — только
 * витринная; расхождение валют даёт неверный процент (было: '-13%' у
 * набора РНК ×1500 по рублям, в Stars — 5%). Проверяется тестом
 * shop-catalog (каждый '-%' тег сверяется со Stars-математикой).
 *
 * Коллаб-скин (монетизация v3, этап 5): добавляется как обычный скин —
 * запись здесь + зеркальная запись в worker/src/grants.ts (id/stars/грант
 * должны совпадать; тест worker-payments сверяет каталоги). Скин сам
 * попадёт в галерею (SkinCatalog читает SHOP_CATALOG); редкость — в
 * SHOP_SKIN_META. Диплинк и баннер коллаба — в src/game/shop/collabs.ts.
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
    description: 'Средняя капсула. Выгоднее малого набора на 5%.',
    price: { amount: 129, currency: 'RUB' },
    stars: 100,  // Telegram Stars (XTR): 100★ vs 3×35★=105★ → выгода 5%
    art: { seed: 'rna-pack-m', palette: 'cyan' },
    tag: '-5%',
  },
  {
    // Монетизация v3: сезонный пропуск v1 (только базовый). Подписка
    // Telegram Stars: 250 ★, 30 дней, продление автоматическое.
    // Цена RUB — витринная (как у скина за 250 ★); серверный грант —
    // в worker/src/grants.ts (должен совпадать по id/stars/гранту).
    id: 'season-pass.basic-30d',
    kind: 'season_pass',
    title: 'Сезонный пропуск — 30 дней',
    description: 'Доступ к платному треку сезонных миссий: косметика, РНК и бустеры.',
    price: { amount: 299, currency: 'RUB' },
    stars: 250,  // Telegram Stars (XTR)
    art: { seed: 'season-pass-basic', palette: 'green' },
    tag: 'NEW',
  },
  {
    // Монетизация v3: стартовый набор. Эксклюзивный скин «Прайм» —
    // только здесь (отдельного товара нет; см. SkinCatalog
    // BUNDLE_ONLY_SKINS). 3-дневный бустер — новый грант только внутри
    // бандла. Видимость — флаг monetization.starter-pack.
    id: 'bundle.starter-pack',
    kind: 'bundle',
    title: 'Стартовый набор',
    description: 'Эксклюзивный штамм «Прайм», 500 РНК и бустер ×2 на 3 дня.',
    price: { amount: 199, currency: 'RUB' },
    stars: 150,  // Telegram Stars (XTR)
    art: { seed: 'starter-pack', palette: 'prime' },
    tag: 'NEW',
    bundle: [
      { kind: 'skin', skinId: 'skin.starter-prime' },
      { kind: 'rna', rna: 500 },
      { kind: 'booster', boosterDays: 3 },
    ],
  },
  {
    // Монетизация v3: три шоп-скина одним платежом (по отдельности 450 ★).
    id: 'bundle.skin-trio',
    kind: 'bundle',
    title: 'Трио штаммов',
    description: '«Вирулентный», «Бездонный» и «Позолоченный» — все три окраса сразу.',
    price: { amount: 349, currency: 'RUB' },
    stars: 300,  // Telegram Stars (XTR)
    art: { seed: 'skin-trio', palette: 'magenta' },
    tag: '-33%',
    bundle: [
      { kind: 'skin', skinId: 'skin.virulent-magenta' },
      { kind: 'skin', skinId: 'skin.abyssal-teal' },
      { kind: 'skin', skinId: 'skin.gilded-prime' },
    ],
  },
];

const VALID_KINDS: readonly ProductKind[] = ['skin', 'booster', 'currency', 'season_pass', 'bundle'];

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
    // Монетизация v3: бандл — непустой список валидных компонентов.
    if (p.kind === 'bundle') {
      if (!Array.isArray(p.bundle) || p.bundle.length === 0) {
        errors.push(`${where}: bundle without components`);
      } else {
        p.bundle.forEach((c, j) => {
          const ok =
            c &&
            typeof c === 'object' &&
            ((c.kind === 'rna' && typeof c.rna === 'number' && c.rna > 0) ||
              (c.kind === 'booster' &&
                typeof c.boosterDays === 'number' &&
                c.boosterDays > 0) ||
              (c.kind === 'skin' && typeof c.skinId === 'string' && c.skinId.length > 0));
          if (!ok) errors.push(`${where}: bundle component [${j}] invalid`);
        });
      }
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
