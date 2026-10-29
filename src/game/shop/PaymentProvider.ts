/**
 * PaymentProvider — rail-agnostic абстракция биллинга (витрина OFELIYA).
 *
 * Зачем: ответа MAX по payments API нет и может не быть. Вся логика витрины
 * работает против этого интерфейса; когда MAX ответит — меняется только
 * реализация провайдера (см. ofeliya-storefront-design.md §7).
 * Реальных денег и сетевых вызовов биллинга в этом скоупе нет.
 *
 * Модуль намеренно Phaser-free: чистая логика, тестируется в Node.
 */

export type ProviderId = 'mock' | 'max-bridge' | 'telegram-stars';

export type ProductKind = 'skin' | 'booster' | 'currency';

/** Нейтральный формат цены: major units + ISO 4217 код. */
export interface ProductPrice {
  amount: number;
  currency: string;
}

/**
 * Арт товара. Для скинов — DiceBear-совместимые поля (Фаза 5):
 * seed + palette превратятся в процедурный SVG-арт. До Фазы 5 UI рисует
 * детерминированную заглушку-паттерн по хешу seed (см. StorefrontScene).
 */
export interface ProductArt {
  seed: string;
  palette: string;
}

export interface Product {
  /** Уникальный id, напр. 'skin.virulent-magenta'. */
  id: string;
  kind: ProductKind;
  title: string;
  description: string;
  price: ProductPrice;
  art: ProductArt;
  /** Бейдж на карточке: 'HIT' | 'NEW' | '-13%' … */
  tag?: string;
  /**
   * Цена в звёздах Telegram (XTR) — ЦЕЛОЕ число (1 star ≈ $0.013).
   * TelegramStarsPaymentProvider берёт цену отсюда; если stars нет —
   * товар недоступен к покупке через Stars (failed 'no-stars-price').
   */
  stars?: number;
}

export type PurchaseState = 'success' | 'cancelled' | 'failed' | 'unavailable';

export interface PurchaseSuccess {
  state: 'success';
  productId: string;
  provider: ProviderId;
  /** Непрозрачный чек провайдера; у мока — сгенерированный. */
  receipt: string;
}

export interface PurchaseFailure {
  state: 'cancelled' | 'failed' | 'unavailable';
  productId: string;
  provider: ProviderId;
  /** Машиночитаемая причина: 'user-cancelled' | 'mock-forced-failure' |
   *  'unknown-product' | 'max-bridge-unavailable' | … */
  reason: string;
}

export type PurchaseResult = PurchaseSuccess | PurchaseFailure;

export interface RestoreResult {
  productIds: string[];
}

/**
 * Контракт платёжного провайдера.
 *
 * Инварианты:
 * - методы никогда не бросают синхронно; ошибки — через PurchaseResult.reason;
 * - listProducts() возвращает копию каталога (мутировать нельзя);
 * - isAvailable() === false → UI показывает «скоро», покупка недоступна.
 */
export interface PaymentProvider {
  readonly id: ProviderId;
  /** Доступен ли рельс. false = graceful «скоро», не краш. */
  isAvailable(): boolean;
  listProducts(): Promise<Product[]>;
  purchase(productId: string): Promise<PurchaseResult>;
  /** Ранее выданные права (для восстановления после переустановки). */
  restore(): Promise<RestoreResult>;
}
