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
  type TelegramStarsOptions,
} from './TelegramStarsPaymentProvider';
import {
  STOREFRONT_HIDDEN,
  STOREFRONT_MAX,
  STOREFRONT_MOCK,
  STOREFRONT_TELEGRAM,
  isStorefrontVisible,
  isTelegramWebApp,
} from './storefrontVisibility';

// P-07: константы и проверка видимости переехали в лёгкий модуль
// storefrontVisibility (first-load без платёжной цепочки); ре-экспорты
// сохраняют импорты существующих потребителей и Node-тестов.
export {
  STOREFRONT_HIDDEN,
  STOREFRONT_MOCK,
  STOREFRONT_MAX,
  STOREFRONT_TELEGRAM,
  isStorefrontVisible,
} from './storefrontVisibility';

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
