/**
 * Storefront — оркестрация витрины (выбор провайдера, чистые хелперы).
 *
 * Связка с флагом storefront.variant (Фаза 2):
 *   'hidden' (дефолт) → витрины нет (null);
 *   'mock'           → MockPaymentProvider (dev/QA);
 *   'max'            → MaxBridgePaymentProvider (stub: unavailable → UI «скоро»);
 *   'telegram'       → TelegramStarsPaymentProvider (РЕАЛЬНЫЙ биллинг Stars).
 * Любое другое значение → null (fail-closed: лучше спрятать, чем сломать).
 *
 * Авто-детект Telegram (приоритет задокументирован):
 *   1. Явное значение флага всегда побеждает ('telegram' → Stars-провайдер).
 *   2. Если флаг 'hidden' (дефолт), но игра запущена внутри Telegram WebApp
 *      И сконфигурирован бэкенд (apiBaseUrl) → тоже Stars-провайдер.
 *      Это осознанное исключение из fail-closed: isAvailable() провайдера
 *      остаётся финальным гейтом (без бэкенда/инит-даты покупка недоступна),
 *      так что сломанная витрина невозможна.
 *   3. Иначе → null (витрина скрыта).
 *
 * Phaser-free, тестируется в Node (window/location — под guard).
 */
import type { PaymentProvider } from './PaymentProvider';
import { MaxBridgePaymentProvider } from './MaxBridgePaymentProvider';
import { MockPaymentProvider, readMockShopConfig } from './MockPaymentProvider';
import {
  TelegramStarsPaymentProvider,
  isTelegramWebApp,
  type TelegramStarsOptions,
} from './TelegramStarsPaymentProvider';

/** Значения флага storefront.variant, которые понимает витрина. */
export const STOREFRONT_HIDDEN = 'hidden';
export const STOREFRONT_MOCK = 'mock';
export const STOREFRONT_MAX = 'max';
export const STOREFRONT_TELEGRAM = 'telegram';

/** Опции резолва (бэкенд-URL приходит из сцены: import.meta.env там безопасен). */
export interface ResolveOptions extends TelegramStarsOptions {}

/**
 * Чистая функция (+ env-sniffing под guard): резолвит реализацию провайдера
 * по значению флага. null = витрина скрыта (fail-closed, кроме авто-детекта).
 */
export function resolveProvider(
  variant: string,
  opts: ResolveOptions = {}
): PaymentProvider | null {
  if (variant === STOREFRONT_MOCK) {
    const search = typeof location === 'undefined' ? '' : location.search;
    return new MockPaymentProvider(readMockShopConfig(search));
  }
  if (variant === STOREFRONT_MAX) return new MaxBridgePaymentProvider();
  if (variant === STOREFRONT_TELEGRAM) {
    return new TelegramStarsPaymentProvider({ apiBaseUrl: opts.apiBaseUrl });
  }
  if (
    variant === STOREFRONT_HIDDEN &&
    (opts.apiBaseUrl ?? '') !== '' &&
    isTelegramWebApp()
  ) {
    // Авто-детект: игра внутри Telegram + бэкенд сконфигурирован.
    return new TelegramStarsPaymentProvider({ apiBaseUrl: opts.apiBaseUrl });
  }
  return null;
}

/** Видна ли точка входа в витрину (кнопка в меню). */
export function isStorefrontVisible(variant: string, opts: ResolveOptions = {}): boolean {
  if (
    variant === STOREFRONT_MOCK ||
    variant === STOREFRONT_MAX ||
    variant === STOREFRONT_TELEGRAM
  ) {
    return true;
  }
  if (
    variant === STOREFRONT_HIDDEN &&
    (opts.apiBaseUrl ?? '') !== '' &&
    isTelegramWebApp()
  ) {
    return true;
  }
  return false;
}
