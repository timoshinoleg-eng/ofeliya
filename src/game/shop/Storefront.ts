/**
 * Storefront — оркестрация витрины (выбор провайдера, чистые хелперы).
 *
 * Связка с флагом storefront.variant (Фаза 2):
 *   'hidden' (дефолт) → витрины нет (null);
 *   'mock'           → MockPaymentProvider (dev/QA);
 *   'max'            → MaxBridgePaymentProvider (stub: unavailable → UI «скоро»).
 * Любое другое значение → null (fail-closed: лучше спрятать, чем сломать).
 *
 * Phaser-free, тестируется в Node.
 */
import type { PaymentProvider } from './PaymentProvider';
import { MaxBridgePaymentProvider } from './MaxBridgePaymentProvider';
import { MockPaymentProvider, readMockShopConfig } from './MockPaymentProvider';

/** Значения флага storefront.variant, которые понимает витрина. */
export const STOREFRONT_HIDDEN = 'hidden';
export const STOREFRONT_MOCK = 'mock';
export const STOREFRONT_MAX = 'max';

/**
 * Чистая функция: резолвит реализацию провайдера по значению флага.
 * null = витрина скрыта (fail-closed).
 */
export function resolveProvider(variant: string): PaymentProvider | null {
  if (variant === STOREFRONT_MOCK) {
    const search = typeof location === 'undefined' ? '' : location.search;
    return new MockPaymentProvider(readMockShopConfig(search));
  }
  if (variant === STOREFRONT_MAX) return new MaxBridgePaymentProvider();
  return null;
}

/** Видна ли точка входа в витрину (кнопка в меню). */
export function isStorefrontVisible(variant: string): boolean {
  return variant === STOREFRONT_MOCK || variant === STOREFRONT_MAX;
}
