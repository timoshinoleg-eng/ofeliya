/**
 * Storefront visibility — лёгкий first-load модуль (P-07).
 *
 * Живёт отдельно от Storefront.ts / TelegramStarsPaymentProvider.ts, чтобы
 * MenuScene и SkinGallery могли спросить «показывать ли витрину» без
 * статического импорта всей платёжной цепочки (провайдеры, ledger,
 * wallet-sync) в первый экран. Phaser-free, Node-safe, без зависимостей.
 */

/** Значения флага storefront.variant, которые понимает витрина. */
export const STOREFRONT_HIDDEN = 'hidden';
export const STOREFRONT_MOCK = 'mock';
export const STOREFRONT_MAX = 'max';
export const STOREFRONT_TELEGRAM = 'telegram';

export interface StorefrontVisibilityOptions {
  /** Базовый URL payments-backend; пусто = авто-детект выключен. */
  apiBaseUrl?: string;
}

/**
 * Минимальный structural тип Telegram WebApp для проверки видимости.
 * Локальный (не глобальный augmentation): shop-модули компилируются
 * Node-тестами отдельно — глобальный тип там недоступен.
 */
export interface TelegramWebAppLike {
  openInvoice?: (url: string, callback?: (status: string) => void) => void;
  initData?: string;
}

/** Node-safe доступ к Telegram WebApp (null вне Telegram/Node). */
export function telegramWebApp(): TelegramWebAppLike | null {
  try {
    if (typeof window === 'undefined') return null;
    const w = window as unknown as { Telegram?: { WebApp?: TelegramWebAppLike } };
    return w.Telegram?.WebApp ?? null;
  } catch {
    return null;
  }
}

/** Чистая функция: есть ли Telegram WebApp с openInvoice. Node-safe. */
export function isTelegramWebApp(): boolean {
  return typeof telegramWebApp()?.openInvoice === 'function';
}

/** Сырая initData-строка для бэкенда. Пусто = нет (не бросает). */
export function readTelegramInitData(): string {
  try {
    const d = telegramWebApp()?.initData;
    return typeof d === 'string' ? d : '';
  } catch {
    return '';
  }
}

/**
 * Витрина видна, когда флаг storefront.variant явно 'mock'/'max'/'telegram',
 * либо 'hidden' (дефолт), но игра в Telegram WebApp и бэкенд сконфигурирован
 * (авто-детект). Любое другое значение → false (fail-closed: лучше спрятать,
 * чем сломать).
 */
export function isStorefrontVisible(
  variant: string,
  opts: StorefrontVisibilityOptions = {}
): boolean {
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
