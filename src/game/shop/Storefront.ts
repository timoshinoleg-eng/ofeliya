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
export interface ResolveOptions extends TelegramStarsOptions {
  /**
   * QA-инструменты включены (dev или сборка с VITE_QA_TOOLS=1).
   * Без qaTools вариант 'mock' недоступен (fail-closed): QA-дубль с
   * ненастоящими деньгами не должен резолвиться в проде.
   * Сцена передаёт флаг из import.meta.env (browser-only, безопасно).
   */
  qaTools?: boolean;
}

/**
 * Чистая функция (+ env-sniffing под guard): резолвит реализацию провайдера
 * по значению флага. null = витрина скрыта (fail-closed, кроме авто-детекта).
 *
 * Патч №13 (P1-f): 'mock' — только при opts.qaTools. В проде без
 * VITE_QA_TOOLS=1 resolveProvider('mock') → null: сцена покажет «скоро»
 * вместо покупок на ненастоящие деньги.
 */
export function resolveProvider(
  variant: string,
  opts: ResolveOptions = {}
): PaymentProvider | null {
  if (variant === STOREFRONT_MOCK) {
    if (opts.qaTools !== true) return null;
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
