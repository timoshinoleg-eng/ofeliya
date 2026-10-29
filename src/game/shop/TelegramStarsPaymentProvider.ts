/**
 * TelegramStarsPaymentProvider — РЕАЛЬНЫЙ биллинг витрины через Telegram Stars.
 *
 * Первая rail-agnostic имплементация против интерфейса PaymentProvider:
 * цифровые товары в Telegram Mini Apps оплачиваются только Stars (XTR).
 *
 * Флоу (Bot API, сверено с https://core.telegram.org/bots/webapps 2026-10-21):
 *  1. purchase(productId) → POST {apiBaseUrl}/api/invoice {productId, initData}
 *     (initData — сырая строка Telegram.WebApp.initData);
 *  2. reference backend (worker/) валидирует initData по HMAC-SHA256,
 *     сверяет товар с серверным whitelist (цену от клиента НЕ доверяет),
 *     вызывает Bot API createInvoiceLink
 *     (currency='XTR', provider_token='', prices=[{label, amount}] —
 *     amount в ЦЕЛЫХ звёздах) → {invoiceUrl};
 *  3. клиент: window.Telegram.WebApp.openInvoice(url, cb);
 *  4. cb(status): 'paid' → success; 'cancelled' → cancelled;
 *     'failed' → failed; 'pending' → failed (reason stars-payment-pending).
 *  5. бот отвечает на pre_checkout_query через answerPreCheckoutQuery
 *     (обязательно в течение 10 секунд) и получает successful_payment.
 *
 * Клиент НЕ может создавать инвойсы сам (нужен bot token) — без
 * сконфигурированного бэкенда (VITE_PAYMENTS_API_URL) провайдер
 * isAvailable() === false (graceful «скоро», не краш).
 *
 * Phaser-free, Node-safe (window/fetch/localStorage — все под guard).
 *
 * Адаптация к main (порт партии 3): в отличие от стека, выдача здесь НЕ
 * «запись + аналитика» — успешная покупка грантится сценой витрины через
 * grantPurchase (скины → SkinOwnership, РНК → MetaWallet, бустер →
 * boosterUntilMs), как и mock-покупка. Локальный entitlement провайдера —
 * только журнал чеков для restore(). Потраченные звёзды фиксируются в
 * MetaWallet.recordStarsSpent (достижение «Инвестор»); сбой учёта никогда
 * не превращает оплаченную покупку в failed.
 *
 * openInvoice: вызывается на том же объекте window.Telegram.WebApp, который
 * оборачивает TelegramPlatform (интерфейс объявлен там: openInvoice в
 * src/platform/TelegramPlatform.ts). Отдельного адаптера витрина не заводит:
 * shop-модули компилируются Node-тестами standalone, поэтому здесь —
 * локальный structural-тип и guarded доступ, а не импорт платформы.
 */
import type {
  PaymentProvider,
  Product,
  ProviderId,
  PurchaseResult,
  RestoreResult,
} from './PaymentProvider';
import { SHOP_CATALOG } from './products';
import { recordStarsSpent } from '../meta/MetaWallet';

export const TELEGRAM_STARS_UNAVAILABLE = 'stars-unavailable';
export const ENTITLEMENTS_KEY = 'ofeliya.telegram.entitlements.v1';

/** Максимум ожидания callback openInvoice: дальше считаем зависшим. */
const INVOICE_CALLBACK_TIMEOUT_MS = 120_000;

type InvoiceStatus = 'paid' | 'cancelled' | 'failed' | 'pending';

interface Entitlement {
  productId: string;
  receipt: string;
  ts: number;
}

export interface TelegramStarsOptions {
  /** Базовый URL reference backend, напр. https://ofeliya-payments.workers.dev */
  apiBaseUrl?: string;
}

/**
 * Минимальный structural тип Telegram WebApp для витрины.
 * Локальный (не глобальный augmentation): в игре уже есть полное объявление
 * в src/platform/TelegramPlatform.ts, а shop-модули компилируются Node-тестами
 * отдельно — глобальный тип там недоступен. Совместим с обоими.
 */
interface TelegramWebAppLike {
  openInvoice?: (url: string, callback?: (status: string) => void) => void;
  initData?: string;
}

/** Node-safe доступ к Telegram WebApp (null вне Telegram/Node). */
function telegramWebApp(): TelegramWebAppLike | null {
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
 * Результат маппинга статуса инвойса (без receipt — его добавляет purchase).
 * 'pending' маппится в failed: платёж не завершён, деньги не списаны
 * окончательно — клиент не должен считать это успехом.
 */
export type InvoiceMapping =
  | { state: 'paid' }
  | {
      state: 'cancelled' | 'failed';
      productId: string;
      provider: ProviderId;
      reason: string;
    };

/** Чистая функция: маппинг статуса openInvoice → InvoiceMapping. */
export function mapInvoiceStatus(status: string, productId: string): InvoiceMapping {
  if (status === 'paid') return { state: 'paid' };
  if (status === 'cancelled')
    return { state: 'cancelled', productId, provider: 'telegram-stars', reason: 'user-cancelled' };
  if (status === 'pending')
    return {
      state: 'failed',
      productId,
      provider: 'telegram-stars',
      reason: 'stars-payment-pending',
    };
  if (status === 'failed')
    return { state: 'failed', productId, provider: 'telegram-stars', reason: 'stars-payment-failed' };
  return { state: 'failed', productId, provider: 'telegram-stars', reason: 'stars-unknown-status' };
}

function storageAvailable(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function readStoredEntitlements(): Entitlement[] {
  try {
    const raw = localStorage.getItem(ENTITLEMENTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is Entitlement =>
        !!e && typeof e === 'object' && typeof (e as Entitlement).productId === 'string'
    );
  } catch {
    return [];
  }
}

function writeStoredEntitlements(list: Entitlement[]): void {
  try {
    localStorage.setItem(ENTITLEMENTS_KEY, JSON.stringify(list));
  } catch {
    // провайдер не ломает игру из-за квот/приватного режима
  }
}

export class TelegramStarsPaymentProvider implements PaymentProvider {
  readonly id: ProviderId = 'telegram-stars';
  private readonly apiBaseUrl: string;
  /** In-memory fallback, когда localStorage недоступен (Node/тесты). */
  private readonly memoryEntitlements: Entitlement[] = [];

  constructor(options: TelegramStarsOptions = {}) {
    this.apiBaseUrl = (options.apiBaseUrl ?? '').trim().replace(/\/+$/, '');
  }

  /**
   * Рельс доступен, только если: Telegram WebApp с openInvoice +
   * есть initData + сконфигурирован бэкенд. Иначе — graceful «скоро».
   * Никогда не бросает.
   */
  isAvailable(): boolean {
    try {
      return isTelegramWebApp() && this.apiBaseUrl !== '' && readTelegramInitData() !== '';
    } catch {
      return false;
    }
  }

  async listProducts(): Promise<Product[]> {
    // Копия: каталог мутировать нельзя (контракт интерфейса).
    return SHOP_CATALOG.map((p) => ({ ...p, price: { ...p.price }, art: { ...p.art } }));
  }

  async purchase(productId: string): Promise<PurchaseResult> {
    const fail = (reason: string): PurchaseResult => ({
      state: 'failed',
      productId,
      provider: 'telegram-stars',
      reason,
    });
    try {
      const product = SHOP_CATALOG.find((p) => p.id === productId);
      if (!product) return fail('unknown-product');
      if (product.stars == null) return fail('no-stars-price');
      if (!isTelegramWebApp()) {
        return {
          state: 'unavailable',
          productId,
          provider: 'telegram-stars',
          reason: 'not-in-telegram',
        };
      }
      if (this.apiBaseUrl === '') {
        return {
          state: 'unavailable',
          productId,
          provider: 'telegram-stars',
          reason: 'stars-backend-unconfigured',
        };
      }
      const initData = readTelegramInitData();
      if (!initData) {
        return { state: 'unavailable', productId, provider: 'telegram-stars', reason: 'no-init-data' };
      }

      // 1. Инвойс создаёт бэкенд (bot token нельзя хранить в клиенте).
      let invoiceUrl = '';
      try {
        const res = await fetch(`${this.apiBaseUrl}/api/invoice`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ productId, initData }),
        });
        if (!res.ok) return fail('invoice-create-failed');
        const data: unknown = await res.json();
        invoiceUrl =
          !!data && typeof data === 'object'
            ? String((data as { invoiceUrl?: unknown }).invoiceUrl ?? '')
            : '';
      } catch {
        return fail('invoice-create-failed');
      }
      if (!invoiceUrl) return fail('invoice-create-failed');

      // 2. Нативный Stars-инвойс Telegram.
      const status = await this.openInvoice(invoiceUrl);
      const mapped = mapInvoiceStatus(status, productId);
      if (mapped.state !== 'paid') return mapped;

      // 3. Успех: учёт потраченных звёзд (достижение «Инвестор») — сбой
      // учёта не отменяет оплаченную покупку; локальный entitlement —
      // журнал чеков для restore(), а грант делает сцена (grantPurchase).
      try {
        if ((product.stars ?? 0) > 0) recordStarsSpent(product.stars as number);
      } catch {
        // bookkeeping must never fail a paid purchase
      }
      const receipt = `stars-${Date.now().toString(36)}-${productId}`;
      const list = this.readEntitlements();
      if (!list.some((e) => e.productId === productId)) {
        list.push({ productId, receipt, ts: Date.now() });
        this.writeEntitlements(list);
      }
      return { state: 'success', productId, provider: 'telegram-stars', receipt };
    } catch {
      return fail('stars-unexpected-error');
    }
  }

  async restore(): Promise<RestoreResult> {
    try {
      return { productIds: this.readEntitlements().map((e) => e.productId) };
    } catch {
      return { productIds: [] };
    }
  }

  private readEntitlements(): Entitlement[] {
    if (storageAvailable()) return readStoredEntitlements();
    return [...this.memoryEntitlements];
  }

  private writeEntitlements(list: Entitlement[]): void {
    if (storageAvailable()) {
      writeStoredEntitlements(list);
      return;
    }
    this.memoryEntitlements.length = 0;
    this.memoryEntitlements.push(...list);
  }

  /** Промис поверх callback-API openInvoice + страховочный таймаут. */
  private openInvoice(url: string): Promise<string> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (status: string): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(status);
      };
      const timer = setTimeout(() => finish('pending'), INVOICE_CALLBACK_TIMEOUT_MS);
      try {
        const webApp = telegramWebApp();
        if (!webApp?.openInvoice) {
          finish('failed');
          return;
        }
        webApp.openInvoice(url, (status) => finish(status));
      } catch {
        finish('failed');
      }
    });
  }
}
