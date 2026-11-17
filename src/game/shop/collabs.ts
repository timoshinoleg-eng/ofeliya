/**
 * Коллабы (монетизация v3, этап 5): диплинк `startapp=collab_<id>`.
 *
 * Механика: пользователь заходит по ссылке партнёра — меню сразу
 * открывает витрину с баннером коллаба (см. MenuScene.create).
 * Неизвестный id — обычное меню и обычная витрина (fail-closed:
 * чужой/битый id не ломает вход в игру).
 *
 * Реестр ПУСТ в v1: партнёров пока нет, фейковые не создаются.
 *
 * Как добавить коллаб (data-only, без кода сцен):
 * 1. Зарегистрируйте id здесь: { id, title, description } (+ опционально
 *    highlightProductId — id товара из SHOP_CATALOG, который коллаб
 *    подсвечивает; карточка уже есть в списке, баннер её не дублирует).
 * 2. Если у коллаба свой скин — добавьте товар как обычный скин:
 *    SHOP_CATALOG (products.ts) + SERVER_GRANTS (worker/src/grants.ts),
 *    id/stars/грант должны совпадать (тест worker-payments сверяет).
 *    Скин автоматически попадёт в галерею (SkinCatalog читает
 *    SHOP_CATALOG); редкость — в SHOP_SKIN_META.
 * 3. Ссылка партнёра: https://t.me/ofeliya_game_bot?startapp=collab_<id>
 *    (или через buildTelegramStartLink с тем же пейлоадом).
 *
 * Модуль Phaser-free: чистые функции, тестируются в Node.
 */

export interface CollabDef {
  /** id из диплинка (после `collab_`). */
  id: string;
  /** Заголовок баннера в витрине. */
  title: string;
  /** Описание баннера (1–2 строки). */
  description: string;
  /**
   * id товара из SHOP_CATALOG, который коллаб подсвечивает.
   * Необязательно: баннер — информационный, карточка товара уже в списке.
   */
  highlightProductId?: string;
}

/**
 * Реестр коллабов. Пуст в v1 — партнёров пока нет (см. шапку).
 * Ключ — id из диплинка.
 */
export const COLLAB_REGISTRY: Readonly<Record<string, CollabDef>> = {};

/**
 * Чистая функция: определение коллаба по id (undefined — неизвестен).
 * CR2: own-property check — без него getCollab('constructor') возвращал
 * унаследованный конструктор (truthy), и пейлоад collab_constructor
 * проходил truthiness-check в меню и вёл в витрину с баннером.
 */
export function getCollab(id: string): CollabDef | undefined {
  return Object.prototype.hasOwnProperty.call(COLLAB_REGISTRY, id)
    ? COLLAB_REGISTRY[id]
    : undefined;
}

const COLLAB_START_RE = /^collab_([A-Za-z0-9-]{1,48})$/;

/**
 * Чистая функция: id коллаба из start_param (`collab_<id>`).
 * null — не коллаб-диплинк (обычный вход, дуэль, реферал и т.д.).
 */
export function parseCollabStartPayload(startParam: string | null | undefined): string | null {
  if (typeof startParam !== 'string') return null;
  const m = COLLAB_START_RE.exec(startParam);
  return m ? m[1] : null;
}
