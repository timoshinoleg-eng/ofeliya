/**
 * MaxBridgePaymentProvider — заглушка под будущий реальный биллинг MAX.
 *
 * Статус на 2026-10-21: в MAX Bridge НЕТ payments API для мини-аппов
 * (проверено grep'ом по src/platform/* — упоминаний платежей нет; см.
 * ofeliya-storefront-design.md §7 и §9). Поэтому isAvailable() = false,
 * а все методы возвращают unavailable. UI на это показывает «скоро»,
 * а не крашится и не рисует пустую витрину.
 *
 * ШОВ НА ДЕНЬ, КОГДА MAX ДАСТ PAYMENTS API (менять только этот файл):
 *  1. isAvailable(): вернуть проверку наличия бриджа, напр.
 *     `(window as unknown as { MaxBridge?: { payments?: unknown } }).MaxBridge?.payments != null`.
 *  2. listProducts(): каталог/цены из MAX (или локальный каталог + цены MAX).
 *  3. purchase(): вызов MaxBridge.payments.purchase(sku) → маппинг статусов
 *     в PurchaseResult; receipt = токен/чек MAX.
 *  4. restore(): MaxBridge.payments.restore().
 *  5. Раскатка флагом storefront.variant='max' (A/B тем же механизмом Фазы 2).
 *  6. Снять программный запрет: scripts/check-profile-client.mjs:162
 *     ('purchase' must never be accepted).
 */
import type {
  PaymentProvider,
  ProviderId,
  PurchaseResult,
  RestoreResult,
  Product,
} from './PaymentProvider';

export const MAX_BRIDGE_UNAVAILABLE = 'max-bridge-unavailable';

export class MaxBridgePaymentProvider implements PaymentProvider {
  readonly id: ProviderId = 'max-bridge';

  isAvailable(): boolean {
    // MAX Bridge payments API отсутствует (статус 2026-10-21).
    return false;
  }

  async listProducts(): Promise<Product[]> {
    throw unavailable();
  }

  async purchase(productId: string): Promise<PurchaseResult> {
    return {
      state: 'unavailable',
      productId,
      provider: 'max-bridge',
      reason: MAX_BRIDGE_UNAVAILABLE,
    };
  }

  async restore(): Promise<RestoreResult> {
    throw unavailable();
  }
}

function unavailable(): Error {
  return new Error(MAX_BRIDGE_UNAVAILABLE);
}
