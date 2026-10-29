/**
 * grants.ts — серверный каталог грантов (патч №15, P0-3).
 *
 * Серверно-авторитетная выдача: ЧТО получает игрок за productId, решает
 * ТОЛЬКО этот каталог. Клиентский src/game/shop/products.ts — витрина
 * (цены для показа, stars для инвойса); серверный каталог — истина для
 * выдачи. Связь двусторонняя и проверяется вручную при изменении любого
 * из каталогов:
 *   worker/src/grants.ts  ←→  src/game/shop/products.ts
 * Правила синхронизации:
 *   - productId — один и тот же ключ в обоих файлах;
 *   - stars (XTR) — одинаковые (сервер сверяет сумму платежа с grants);
 *   - grantRna (клиент) == rna (сервер); grantBoosterDays == boosterDays;
 *   - kind 'skin' (клиент) ⇔ skinId != null (сервер).
 * Клиентскому значению не доверяем: /api/invoice и webhook сверяются
 * только с этим файлом.
 *
 * Модель гранта (один товар — один грант одного вида; kinds:
 * 'rna' | 'booster' | 'skin'):
 *   - rna: целое число мета-РНК, плоское начисление БЕЗ бонуса
 *     лаборатории/бустера (как клиентский addRna; патч №11);
 *   - boosterDays: целое число дней ×2 дохода мета-РНК; сервер пишет
 *     абсолютный booster_until_ms = max(текущий, now) + days;
 *   - skinId: id скина из SkinCatalog (серверный кошелёк — аддитивное
 *     множество; клиент делает union).
 */
export interface ServerGrant {
  /** Заголовок/описание — для createInvoiceLink (бывший SERVER_PRODUCTS). */
  title: string;
  description: string;
  /** Цена в Stars (XTR, целые). Должна совпадать с products.ts::stars. */
  stars: number;
  /** Плоское начисление мета-РНК (целое ≥0; 0 = не этот вид). */
  rna: number;
  /** Дней бустера ×2 (целое ≥0; 0 = не этот вид). */
  boosterDays: number;
  /** Id скина (null = не скин). */
  skinId: string | null;
}

/**
 * Версия серверного каталога (патч №16, B2). Пишется в orders.sku_version и
 * payments.sku_version при создании заказа/платежа. Вебхук сверяет платёж
 * с НЕИЗМЕНЯЕМЫМ заказом (sp.total_amount === order.amount_stars); дрейф
 * версии между инвойсом и оплатой — громкий диагностический лог
 * ('stars_payment_sku_drift'), заказ при этом остаётся контрактом.
 * При ЛЮБОМ изменении цен/грантов ниже — увеличить на 1.
 */
export const GRANTS_VERSION = 2;

/**
 * Серверный каталог: ЦЕНА И ГРАНТ ВСЕГДА С СЕРВЕРА.
 * Должен совпадать с src/game/shop/products.ts (см. шапку файла).
 * Описания — как в main (client products.ts / бывший SERVER_PRODUCTS);
 * расхождение патча №15 в описании бустера не переносится.
 */
export const SERVER_GRANTS: Record<string, ServerGrant> = {
  'skin.virulent-magenta': {
    title: 'Штамм «Вирулентный»',
    description: 'Пурпурный боевой окрас STRAIN-0. Чистая косметика.',
    stars: 100,
    rna: 0,
    boosterDays: 0,
    skinId: 'skin.virulent-magenta',
  },
  'skin.abyssal-teal': {
    title: 'Штамм «Бездонный»',
    description: 'Глубоководный тил. Виден даже в темной плазме.',
    stars: 100,
    rna: 0,
    boosterDays: 0,
    skinId: 'skin.abyssal-teal',
  },
  'skin.gilded-prime': {
    title: 'Штамм «Позолоченный»',
    description: 'Праймовый золотой штамм для ветеранов кровотока.',
    stars: 250,
    rna: 0,
    boosterDays: 0,
    skinId: 'skin.gilded-prime',
  },
  'booster.rna-x2-7d': {
    title: 'РНК ×2 — 7 дней',
    description: 'Двойной дроп РНК со всех гемов в течение недели.',
    stars: 75,
    rna: 0,
    boosterDays: 7,
    skinId: null,
  },
  'currency.rna-pack-s': {
    title: 'Набор РНК ×500',
    description: 'Малая капсула чистой РНК для лаборатории мутаций.',
    stars: 35,
    rna: 500,
    boosterDays: 0,
    skinId: null,
  },
  'currency.rna-pack-m': {
    title: 'Набор РНК ×1500',
    description: 'Средняя капсула. Выгоднее малого набора на 13%.',
    stars: 100,
    rna: 1500,
    boosterDays: 0,
    skinId: null,
  },
};

/** Вид гранта для журнала wallet_ledger. */
export type GrantKind = 'rna' | 'booster' | 'skin';

/**
 * Грант товара: какой вид и в каком размере применить к кошельку.
 * Возвращает null, если товара нет в каталоге (unknown-product —
 * обрабатывается отдельно, без выдачи).
 */
export function grantForProduct(productId: string): { kind: GrantKind; grant: ServerGrant } | null {
  const grant = SERVER_GRANTS[productId];
  if (!grant) return null;
  if (grant.skinId) return { kind: 'skin', grant };
  if (grant.boosterDays > 0) return { kind: 'booster', grant };
  if (grant.rna > 0) return { kind: 'rna', grant };
  return null;
}

/**
 * Текстовое значение гранта для wallet_ledger.amount_text
 * (аудит-след: сколько чего выдано этим charge_id).
 */
export function grantAmountText(kind: GrantKind, grant: ServerGrant): string {
  if (kind === 'rna') return String(grant.rna);
  if (kind === 'booster') return String(grant.boosterDays);
  return grant.skinId ?? '';
}
