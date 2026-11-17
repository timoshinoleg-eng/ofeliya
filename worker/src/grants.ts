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
 * 'rna' | 'booster' | 'skin' | 'season_pass'):
 *   - rna: целое число мета-РНК, плоское начисление БЕЗ бонуса
 *     лаборатории/бустера (как клиентский addRna; патч №11);
 *   - boosterDays: целое число дней ×2 дохода мета-РНК; сервер пишет
 *     абсолютный booster_until_ms = max(текущий, now) + days;
 *   - skinId: id скина из SkinCatalog (серверный кошелёк — аддитивное
 *     множество; клиент делает union);
 *   - seasonPassDays: целое число дней сезонного пропуска (монетизация
 *     v3); сервер пишет season_pass_until_ms = max(текущий, now) + days,
 *     как бустер. Товар с seasonPassDays > 0 — ПОДПИСКА Telegram Stars:
 *     subscription.periodSeconds = 2592000 (30 дней — ЕДИНСТВЕННОЕ
 *     допустимое значение; кап цены подписки 10 000 Stars).
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
  /** Дней сезонного пропуска (целое ≥0; 0 = не пропуск). Монетизация v3. */
  seasonPassDays: number;
  /**
   * Подписка Telegram Stars (монетизация v3). Только для товаров с
   * seasonPassDays > 0: periodSeconds обязан быть 2592000 (30 дней —
   * единственное значение, которое принимает Telegram; см. handleInvoice —
   * другое значение → 500 catalog-misconfigured, инвойс не создаётся).
   */
  subscription?: { periodSeconds: number };
}

/**
 * Версия серверного каталога (патч №16, B2). Пишется в orders.sku_version и
 * payments.sku_version при создании заказа/платежа. Вебхук сверяет платёж
 * с НЕИЗМЕНЯЕМЫМ заказом (sp.total_amount === order.amount_stars); дрейф
 * версии между инвойсом и оплатой — громкий диагностический лог
 * ('stars_payment_sku_drift'), заказ при этом остаётся контрактом.
 * При ЛЮБОМ изменении цен/грантов ниже — увеличить на 1.
 */
export const GRANTS_VERSION = 3;

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
    seasonPassDays: 0,
  },
  'skin.abyssal-teal': {
    title: 'Штамм «Бездонный»',
    description: 'Глубоководный тил. Виден даже в темной плазме.',
    stars: 100,
    rna: 0,
    boosterDays: 0,
    skinId: 'skin.abyssal-teal',
    seasonPassDays: 0,
  },
  'skin.gilded-prime': {
    title: 'Штамм «Позолоченный»',
    description: 'Праймовый золотой штамм для ветеранов кровотока.',
    stars: 250,
    rna: 0,
    boosterDays: 0,
    skinId: 'skin.gilded-prime',
    seasonPassDays: 0,
  },
  'booster.rna-x2-7d': {
    title: 'РНК ×2 — 7 дней',
    description: 'Двойной дроп РНК со всех гемов в течение недели.',
    stars: 75,
    rna: 0,
    boosterDays: 7,
    skinId: null,
    seasonPassDays: 0,
  },
  'currency.rna-pack-s': {
    title: 'Набор РНК ×500',
    description: 'Малая капсула чистой РНК для лаборатории мутаций.',
    stars: 35,
    rna: 500,
    boosterDays: 0,
    skinId: null,
    seasonPassDays: 0,
  },
  'currency.rna-pack-m': {
    title: 'Набор РНК ×1500',
    description: 'Средняя капсула. Выгоднее малого набора на 13%.',
    stars: 100,
    rna: 1500,
    boosterDays: 0,
    skinId: null,
    seasonPassDays: 0,
  },
  /**
   * Сезонный пропуск v1 (монетизация v3): ТОЛЬКО базовый, 250 Stars, 30 дней.
   * Premium-аддон (вторая подписка) в v1 НЕ делается — план сам помечает
   * «удваивает ARPPU» как гипотезу; инфраструктура нескольких активных
   * подписок у одного юзера работает естественно (каждая подписка — свой
   * заказ/charge_id), премиум станет добавлением товара без изменения кода
   * (см. memory/02_DECISIONS.md). Грант: доступ к paid-треку сезонных
   * миссий; НЕ постоянные статы (AGENTS.md: mastery — не сила).
   */
  'season-pass.basic-30d': {
    title: 'Сезонный пропуск — 30 дней',
    description: 'Доступ к платному треку сезонных миссий: косметика, РНК и бустеры.',
    stars: 250,
    rna: 0,
    boosterDays: 0,
    skinId: null,
    seasonPassDays: 30,
    subscription: { periodSeconds: 2592000 },
  },
};

/** Вид гранта для журнала wallet_ledger. */
export type GrantKind = 'rna' | 'booster' | 'skin' | 'season_pass';

/**
 * Грант товара: какой вид и в каком размере применить к кошельку.
 * Возвращает null, если товара нет в каталоге (unknown-product —
 * обрабатывается отдельно, без выдачи).
 * Порядок проверок — тот же, что в grantFromOrderSnapshot (index.ts):
 * скин, пропуск, бустер, РНК. Корректный каталог даёт товару ровно один
 * вид; порядок нужен только для битых данных.
 */
export function grantForProduct(productId: string): { kind: GrantKind; grant: ServerGrant } | null {
  const grant = SERVER_GRANTS[productId];
  if (!grant) return null;
  if (grant.skinId) return { kind: 'skin', grant };
  if (grant.seasonPassDays > 0) return { kind: 'season_pass', grant };
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
  if (kind === 'season_pass') return String(grant.seasonPassDays);
  return grant.skinId ?? '';
}
