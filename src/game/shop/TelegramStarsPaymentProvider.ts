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
 * Флоу (патч №12, протокол nonce/verify — согласован с потоком воркера):
 *  1. purchase(productId): nonce = makePaymentNonce();
 *     POST {apiBaseUrl}/api/invoice {productId, initData, nonce} (таймаут 15с);
 *  2. клиент: window.Telegram.WebApp.openInvoice(url, cb) (120с-гард);
 *  3. cb(status): 'paid' → verify(nonce): POST /api/verify {initData, nonce}
 *     (3 попытки × 2с, таймаут 8с) → {verified:true, chargeId} →
 *     {state:'paid', chargeId, productId, nonce};
 *     иначе → {state:'pending', nonce, productId} БЕЗ выдачи
 *     (запись в pending-журнал + допроверка — дело вызывающего кода /
 *     restore(); fallback-выдачи по колбэку больше нет — патч №12);
 *  4. 'cancelled'/'failed' → как раньше (mapInvoiceStatus);
 *  5. бот отвечает на pre_checkout_query через answerPreCheckoutQuery
 *     (обязательно в течение 10 секунд) и получает successful_payment;
 *     воркер пишет charge в KV по nonce (идемпотентно).
 *  6. restore(): обрабатывает pending-записи — verify → verified →
 *     fulfillPurchase → снять запись; не подтверждено — ретраи с бэкоффом
 *     2с/5с/15с/60с в сессии (setTimeout), затем стоп (запись остаётся +
 *     ручная кнопка «Проверить оплату»). Плюс мерж серверного списка
 *     POST /api/entitlements v2 ({purchases:[{chargeId,productId,status,
 *     createdAt}]}): идемпотентно + chargeId сразу в credited-журнал
 *     (сервер видел платёж — повторный fulfill 'duplicate').
 *
 * Схема патча №11 (сверка через /api/entitlements {products} + выдача
 * по колбэку при недоступности) заменена протоколом №12 полностью:
 * fallback-выдачи по колбэку больше нет.
 *
 * Клиент НЕ может создавать инвойсы сам (нужен bot token) — без
 * сконфигурированного бэкенда (VITE_PAYMENTS_API_URL) провайдер
 * isAvailable() === false (graceful «скоро», не краш).
 *
 * Phaser-free, Node-safe (window/fetch/localStorage — все под guard).
 *
 * Адаптация к main (порт партии 3): в отличие от стека, выдача здесь НЕ
 * «запись + аналитика» — успешная покупка грантится сценой витрины через
 * PaymentLedger.fulfillPurchase (скины → SkinOwnership, РНК → MetaWallet,
 * бустер → boosterUntilMs), как и mock-покупка. Локальный entitlement
 * провайдера — только журнал чеков для restore(). Потраченные звёзды
 * фиксируются в MetaWallet.recordStarsSpent внутри fulfillPurchase
 * (только реальные провайдеры, не 'mock'); сбой учёта никогда
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
import {
  fulfillPurchase,
  incrementPendingAttempts,
  loadPendingPurchases,
  makePaymentNonce,
  markChargeCredited,
  removePendingPurchase,
  verifyPurchase,
  type PendingRecord,
} from './PaymentLedger';

export const TELEGRAM_STARS_UNAVAILABLE = 'stars-unavailable';
export const ENTITLEMENTS_KEY = 'ofeliya.telegram.entitlements.v1';

/** Максимум ожидания callback openInvoice: дальше считаем зависшим. */
const INVOICE_CALLBACK_TIMEOUT_MS = 120_000;
/** Таймаут создания инвойса (протокол патча №12). */
const INVOICE_CREATE_TIMEOUT_MS = 15_000;
/** Таймаут запроса /api/entitlements v2. */
const ENTITLEMENTS_TIMEOUT_MS = 8000;
/** Бэкофф ретраев pending-записей в сессии: 2с/5с/15с/60с, затем стоп. */
const PENDING_RETRY_BACKOFF_MS = [2_000, 5_000, 15_000, 60_000];

type InvoiceStatus = 'paid' | 'cancelled' | 'failed' | 'pending';

interface Entitlement {
  productId: string;
  receipt: string;
  ts: number;
}

/**
 * Патч №12 (worker v2, breaking): POST /api/entitlements →
 * {purchases:[{chargeId, productId, status, createdAt}]}.
 * status: 'paid' | 'credited' ('credited' зарезервирован воркером).
 */
interface ServerPurchase {
  chargeId: string;
  productId: string;
  status: string;
  createdAt: number;
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
  /** Nonce с активной verify-попыткой (защита от параллельных допроверок). */
  private readonly pendingInFlight = new Set<string>();
  /** Nonce с запланированным бэкофф-ретраем (патч №12). */
  private readonly pendingRetryTimers = new Set<string>();

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
      // nonce — ключ идемпотентности и будущей верификации.
      const nonce = makePaymentNonce();
      let invoiceUrl = '';
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), INVOICE_CREATE_TIMEOUT_MS);
        try {
          const res = await fetch(`${this.apiBaseUrl}/api/invoice`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ productId, initData, nonce }),
            signal: ctrl.signal,
          });
          if (!res.ok) return fail('invoice-create-failed');
          const data: unknown = await res.json();
          invoiceUrl =
            !!data && typeof data === 'object'
              ? String((data as { invoiceUrl?: unknown }).invoiceUrl ?? '')
              : '';
        } finally {
          clearTimeout(timer);
        }
      } catch {
        return fail('invoice-create-failed');
      }
      if (!invoiceUrl) return fail('invoice-create-failed');

      // 2. Нативный Stars-инвойс Telegram.
      const status = await this.openInvoice(invoiceUrl);
      const mapped = mapInvoiceStatus(status, productId);
      if (mapped.state !== 'paid') return mapped;

      // 3. Серверная верификация по nonce (протокол патча №12).
      // Колбэк openInvoice вызывается в браузере/WebView — злоумышленник
      // может вызвать его вручную или подменить WebApp.openInvoice, поэтому
      // доверяем только серверу: воркер видел successful_payment по nonce.
      // Fallback-выдачи по колбэку больше нет: не подтверждено → 'pending'
      // БЕЗ выдачи, допроверка — в restore() и кнопкой «Проверить оплату».
      const verification = await verifyPurchase({
        apiBaseUrl: this.apiBaseUrl,
        initData,
        nonce,
      });
      // Явное === true: тестовые tsc-прогоны игнорируют tsconfig (non-strict),
      // а без strictNullChecks truthiness не сужает boolean-дискриминант.
      if (verification.verified === true) {
        const chargeId = verification.chargeId || `nonce-${nonce}`;
        return { state: 'paid', productId, provider: 'telegram-stars', chargeId, nonce };
      }
      return {
        state: 'pending',
        productId,
        provider: 'telegram-stars',
        nonce,
        reason: verification.reason,
      };
    } catch {
      return fail('stars-unexpected-error');
    }
  }

  /**
   * Патч №12: обрабатывает pending-журнал (ofeliya.payments.pending.v1):
   * verify → verified → fulfillPurchase → снять запись.
   * Не подтверждено — ретраи с бэкоффом 2с/5с/15с/60с в сессии (setTimeout,
   * unref в Node), затем стоп: запись остаётся + ручная кнопка сцены.
   * Плюс мерж серверного списка /api/entitlements v2 (идемпотентно).
   * Вызывается сценой при открытии витрины и кнопкой «Проверить оплату».
   * Никогда не бросает.
   */
  async restore(): Promise<RestoreResult> {
    const pendingFulfilled: string[] = [];
    try {
      for (const rec of loadPendingPurchases()) {
        try {
          const pid = await this.processPendingRecord(rec);
          if (pid) pendingFulfilled.push(pid);
        } catch {
          /* одна запись не роняет остальные */
        }
      }
    } catch {
      /* ignore */
    }
    try {
      // Патч №12 (worker v2): серверный список покупок —
      // {purchases:[{chargeId, productId, status, createdAt}]}.
      // Мержим в локальный список (идемпотентно) и помечаем chargeId
      // выданными — сервер видел эти платежи, повторный fulfill по тем же
      // chargeId станет 'duplicate', а не двойным грантом.
      const server = await this.fetchServerEntitlements();
      if (server) {
        const local = this.readEntitlements();
        let changed = false;
        for (const p of server) {
          markChargeCredited(p.chargeId);
          if (!local.some((e) => e.productId === p.productId)) {
            local.push({
              productId: p.productId,
              receipt: `server-${p.chargeId}`,
              ts: p.createdAt > 0 ? p.createdAt : Date.now(),
            });
            changed = true;
          }
        }
        if (changed) this.writeEntitlements(local);
      }
    } catch {
      /* ignore */
    }
    return {
      productIds: this.readEntitlements().map((e) => e.productId),
      pendingFulfilled,
    };
  }

  /**
   * Одна попытка допроверки pending-записи. Возвращает productId, если
   * сервер подтвердил и выдача выполнена (запись снята).
   */
  private async processPendingRecord(rec: PendingRecord): Promise<string | null> {
    const nonce = rec.nonce;
    if (this.pendingInFlight.has(nonce)) return null;
    this.pendingInFlight.add(nonce);
    try {
      const attempts = incrementPendingAttempts(nonce);
      const initData = readTelegramInitData();
      const v = await verifyPurchase({ apiBaseUrl: this.apiBaseUrl, initData, nonce });
      const fresh = loadPendingPurchases().find((p) => p.nonce === nonce);
      if (!fresh) return null; // запись сняли (параллельный вызов)
      if (v.verified === true) {
        const product = SHOP_CATALOG.find((p) => p.id === fresh.productId);
        if (product) {
          // Выдача — только через ledger (идемпотентность по chargeId).
          fulfillPurchase(product, {
            chargeId: v.chargeId || `nonce-${nonce}`,
            providerId: this.id,
          });
        } else {
          // Каталог сменился, а платёж настоящий — не крутить вечно.
          console.warn('[telegram-stars] pending product vanished from catalog:', fresh.productId);
        }
        removePendingPurchase(nonce);
        return fresh.productId;
      }
      // Не подтверждено: бэкофф-ретраи в сессии, затем стоп.
      if (attempts <= PENDING_RETRY_BACKOFF_MS.length && !this.pendingRetryTimers.has(nonce)) {
        const delayMs = PENDING_RETRY_BACKOFF_MS[attempts - 1];
        const timer = setTimeout(() => {
          this.pendingRetryTimers.delete(nonce);
          void this.processPendingRecord({ ...fresh, attempts });
        }, delayMs);
        // В Node (тесты) таймеры не должны держать процесс.
        (timer as unknown as { unref?: () => void }).unref?.();
        this.pendingRetryTimers.add(nonce);
      }
      return null;
    } finally {
      this.pendingInFlight.delete(nonce);
    }
  }

  /**
   * Патч №12 (worker v2): серверный список покупок для restore() —
   * POST /api/entitlements → {purchases:[{chargeId, productId, status,
   * createdAt}]}. null — endpoint недоступен (остаётся локальный список).
   * Никогда не бросает.
   */
  private async fetchServerEntitlements(): Promise<ServerPurchase[] | null> {
    try {
      if (this.apiBaseUrl === '') return null;
      const initData = readTelegramInitData();
      if (!initData) return null;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), ENTITLEMENTS_TIMEOUT_MS);
      try {
        const res = await fetch(`${this.apiBaseUrl}/api/entitlements`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ initData }),
          signal: ctrl.signal,
        });
        if (!res.ok) return null; // 501 kv_unavailable — как недоступность
        const data: unknown = await res.json().catch(() => null);
        const raw =
          !!data && typeof data === 'object' && Array.isArray((data as { purchases?: unknown }).purchases)
            ? (data as { purchases: unknown[] }).purchases
            : [];
        const out: ServerPurchase[] = [];
        for (const item of raw) {
          if (!item || typeof item !== 'object') continue;
          const p = item as { chargeId?: unknown; productId?: unknown; status?: unknown; createdAt?: unknown };
          if (typeof p.chargeId !== 'string' || !p.chargeId) continue;
          if (typeof p.productId !== 'string' || !p.productId) continue;
          out.push({
            chargeId: p.chargeId,
            productId: p.productId,
            status: typeof p.status === 'string' ? p.status : 'paid',
            createdAt: typeof p.createdAt === 'number' && p.createdAt > 0 ? p.createdAt : 0,
          });
        }
        return out;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return null;
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
