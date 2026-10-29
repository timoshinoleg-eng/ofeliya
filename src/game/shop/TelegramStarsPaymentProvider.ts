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
 * Флоу (патч №13, протокол nonce/verify — согласован с потоком воркера):
 *  1. purchase(productId): nonce = makePaymentNonce() (только crypto-RNG);
 *     POST {apiBaseUrl}/api/invoice {productId, initData, nonce} (таймаут 15с);
 *  2. клиент: window.Telegram.WebApp.openInvoice(url, cb) (120с-гард);
 *  3. cb(status): 'paid' → verify(nonce): POST /api/verify {initData, nonce}
 *     (3 попытки × 2с, таймаут 8с) → {verified:true, chargeId, productId}:
 *     доверяем ТОЛЬКО серверу целиком — настоящий непустой chargeId
 *     обязателен (синтетики `nonce-${nonce}` больше нет) и серверный
 *     productId обязан совпасть с локальным, иначе mismatch → 'pending'
 *     БЕЗ выдачи; иначе → {state:'pending', nonce, productId} БЕЗ выдачи
 *     (запись в pending-журнал + допроверка — дело вызывающего кода /
 *     restore(); fallback-выдачи по колбэку больше нет — патч №12);
 *  4. 'cancelled'/'failed' → как раньше (mapInvoiceStatus);
 *  5. бот отвечает на pre_checkout_query через answerPreCheckoutQuery
 *     (обязательно в течение 10 секунд) и получает successful_payment;
 *     воркер пишет charge в D1 по nonce (атомарный batch, идемпотентно).
 *  6. restore(): обрабатывает pending-записи — verify → verified →
 *     fulfillPurchase → снять запись (только при ok); не подтверждено —
 *     ретраи с бэкоффом 2с/5с/15с/60с в сессии (setTimeout), затем стоп
 *     (запись остаётся + ручная кнопка «Проверить оплату»). Плюс мерж
 *     серверного списка POST /api/entitlements v2
 *     ({purchases:[{chargeId,productId,status,createdAt}]}):
 *     все записи со status='paid' И 'fulfilled' (кроме 'refunded'), которых
 *     нет в локальном журнале выданных (ofeliya.payments.credited.v1 по
 *     chargeId), — через единую fulfillPurchase() (патч №14, P0-1).
 *     Локальный credited.v1 даёт exactly-once на устройстве; журнал
 *     сервера — источник правды о покупках. 'refunded' — пропуск без
 *     перевыдачи; продукта нет в каталоге — warn + пропуск БЕЗ пометки.
 *     Плюс обработка pending-записей: verify → verified → fulfillPurchase
 *     → снять запись (только при ok); не подтверждено — ретраи с бэкоффом
 *     2с/5с/15с/60с в сессии, затем стоп (запись остаётся + ручная кнопка
 *     «Проверить оплату»). Локальный список entitlements обновляется
 *     ПОСЛЕ успешной выдачи (для UI).
 *     ИЗВЕСТНОЕ ОГРАНИЧЕНИЕ: два живых устройства материализуют покупки
 *     локально каждое (двойной локальный баланс) — окончательно решается
 *     только серверной экономикой (дизайн-док
 *     ofeliya-server-economy-design.md).
 *  7. Патч №16 (A3/A4): выдача материализуется seq-синком кошелька
 *     (ServerWalletSync: POST /api/wallet {initData, since_seq} →
 *     schema_version:2 + ledger; курсор per (server_id, tgUserId), ключ
 *     ofeliya.wallet.seq.v2; старый watermark v1 игнорируется).
 *     acknowledgeCharge БЕЗОПАСЕН: /api/ack уходит только за chargeId,
 *     чья материализация подтверждена синком (grant-событие в ledger'е),
 *     иначе — запись в pending-sync очередь
 *     (ofeliya.payments.pending-sync.v1). Дрэйн очереди: старт приложения,
 *     открытие витрины (restore), событие 'online', после каждого успешного
 *     синка; кап 24ч/50 попыток → 'needs-manual-check' (авто-ретрай стоп).
 *     StorefrontScene.buy: r.ok → тост «Товар успешно получен» + ack;
 *     !r.ok → «Оплата подтверждена, товар ожидает синхронизации» + кнопка
 *     «Повторить», ack не уходит. Новый клиент + старый воркер (без
 *     schema_version:2) → {ok:false, error:'incompatible-worker'} →
 *     pending-sync, не молча (fail-closed).
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
  isChargeCredited,
  loadPendingPurchases,
  makePaymentNonce,
  removePendingPurchase,
  verifyPurchase,
  type PendingRecord,
} from './PaymentLedger';
import { syncServerWallet, type SyncResult } from './ServerWalletSync';
import {
  drainPendingWalletSync,
  enqueuePendingWalletSync,
  getPendingSyncChargeIds,
  type DrainResult,
} from './PendingWalletSync';

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
 * Патч №14: POST /api/entitlements →
 * {purchases:[{chargeId, productId, status, createdAt}]}.
 * status: 'paid' | 'fulfilled' | 'refunded' (воркер, D1-журнал).
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
  /** In-flight синки кошелька: параллельные вызовы дедуплицируются. */
  private readonly walletSyncInFlight = new Map<string, Promise<SyncResult>>();
  /**
   * chargeId, чья материализация подтверждена успешным синком
   * (grant-события ledger'а). acknowledgeCharge шлёт /api/ack ТОЛЬКО для
   * них; остальное — в pending-sync очередь (патч №16, A3).
   * Cap 1000: ack удаляет, переполнение вытесняет старейшие.
   */
  private readonly walletConfirmedCharges = new Set<string>();

  constructor(options: TelegramStarsOptions = {}) {
    this.apiBaseUrl = (options.apiBaseUrl ?? '').trim().replace(/\/+$/, '');
    // Патч №16 (A3): дрэйн pending-sync по событию 'online'.
    // Отдельный инстанс на каждое открытие витрины — слушатели копятся,
    // но дрэйн без записей в очереди — no-op без сетевого запроса.
    try {
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('online', () => {
          void this.syncWalletAndDrainPending().catch(() => undefined);
        });
      }
    } catch {
      /* ignore */
    }
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
        // Патч №13 (P0-2): доверяем серверу целиком. Настоящий непустой
        // chargeId обязателен — синтетики `nonce-${nonce}` больше нет:
        // иначе платёж считается неподтверждённым → 'pending', не 'paid'.
        const chargeId = verification.chargeId;
        if (!chargeId) {
          return {
            state: 'pending',
            productId,
            provider: 'telegram-stars',
            nonce,
            reason: 'verify-no-charge-id',
          };
        }
        // Серверный productId — единственный источник истины о том, ЧТО
        // куплено. Расхождение с локальным → mismatch: не выдавать, лог,
        // запись в pending-журнал (дело сцены) — допроверка в restore().
        if (verification.productId !== productId) {
          console.warn('[telegram-stars] verify productId mismatch:', {
            server: verification.productId,
            local: productId,
          });
          return {
            state: 'pending',
            productId,
            provider: 'telegram-stars',
            nonce,
            reason: 'verify-product-mismatch',
          };
        }
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
   * Материализация серверно-авторитетной выдачи (патч №16, A4 — seq-журнал).
   *
   * Тянет POST /api/wallet {initData, since_seq} и применяет события
   * журнала: свежий синк — неттинг грантов, инкрементальный — события
   * seq > last_seq (курсор per (server_id, tgUserId), ключ
   * ofeliya.wallet.seq.v2). Ответ без schema_version:2/tip_seq →
   * {ok:false, error:'incompatible-worker'} (fail-closed).
   *
   * Возвращает SyncResult КАК ЕСТЬ — вызывающий код обязан проверить ok:
   * fire-and-forget внутри purchase-flow запрещён (патч №16, A3).
   * Параллельные вызовы с тем же sinceSeq дедуплицируются.
   * Никогда не бросает (и не реджектит).
   */
  syncWalletFromServer(sinceSeq?: number): Promise<SyncResult> {
    const key = sinceSeq == null ? 'inc' : `seq:${Math.max(0, Math.floor(sinceSeq))}`;
    const inFlight = this.walletSyncInFlight.get(key);
    if (inFlight) return inFlight;
    const p: Promise<SyncResult> = (async (): Promise<SyncResult> => {
      try {
        const initData = readTelegramInitData();
        const r = await syncServerWallet({ apiBaseUrl: this.apiBaseUrl, initData, sinceSeq });
        if (r.ok) {
          // Накапливаем подтверждённые chargeId: грант мог материализовать
          // более ранний синк, а ack вызывают позже (buy/restore/дрэйн).
          for (const cid of r.applied.grantChargeIds ?? []) {
            this.walletConfirmedCharges.add(cid);
          }
          while (this.walletConfirmedCharges.size > 1000) {
            const oldest = this.walletConfirmedCharges.values().next();
            if (oldest.done) break;
            this.walletConfirmedCharges.delete(oldest.value);
          }
        }
        return r;
      } catch {
        return { ok: false, error: 'unexpected', reason: 'unexpected' };
      } finally {
        // Значение под ключом — только этот промис (остальные получили его
        // же через дедупликацию), поэтому безусловное удаление корректно.
        this.walletSyncInFlight.delete(key);
      }
    })();
    this.walletSyncInFlight.set(key, p);
    return p;
  }

  /**
   * Патч №16 (A3): синк + дрэйн pending-sync очереди.
   * После каждого успешного синка очередь допроверяется (подтверждённые
   * chargeId снимаются + ack). Возвращает результат синка как есть.
   * Никогда не бросает.
   */
  async syncWalletAndDrainPending(): Promise<SyncResult> {
    let r: SyncResult;
    try {
      r = await this.syncWalletFromServer();
    } catch {
      r = { ok: false, error: 'unexpected', reason: 'unexpected' };
    }
    if (r.ok) {
      try {
        await this.drainPendingWalletSyncQueue();
      } catch {
        /* дрэйн не роняет синк */
      }
    }
    return r;
  }

  /**
   * Патч №16 (A3): дрэйн очереди «оплата подтверждена, товар ожидает
   * синхронизации». Очередь пуста → no-op без сетевого запроса.
   * Подтверждённые chargeId: снятие + /api/ack (материализация доказана
   * ledger'ом). Никогда не бросает.
   */
  drainPendingWalletSyncQueue(): Promise<DrainResult> {
    try {
      return drainPendingWalletSync((sinceSeq) => this.syncWalletFromServer(sinceSeq), {
        onConfirmed: (chargeId) => {
          this.walletConfirmedCharges.add(chargeId);
          this.postAck(chargeId);
        },
      });
    } catch {
      return Promise.resolve({ ok: false, confirmed: [], error: 'unexpected' });
    }
  }

  /**
   * Патч №16 (A3): chargeId записей pending-sync со статусом 'pending'
   * (UI-баннер, тесты). Никогда не бросает.
   */
  getPendingSyncCharges(): string[] {
    try {
      return getPendingSyncChargeIds();
    } catch {
      return [];
    }
  }

  /**
   * Патч №13: обрабатывает pending-журнал (ofeliya.payments.pending.v1):
   * verify → verified → fulfillPurchase → снять запись (только при ok).
   * Не подтверждено — ретраи с бэкоффом 2с/5с/15с/60с в сессии (setTimeout,
   * unref в Node), затем стоп: запись остаётся + ручная кнопка сцены.
   * Плюс мерж серверного списка /api/entitlements (идемпотентно).
   * Вызывается сценой при открытии витрины и кнопкой «Проверить оплату».
   * Никогда не бросает.
   */
  async restore(): Promise<RestoreResult> {
    const pendingFulfilled: string[] = [];
    // Патч №16 (A3): кандидаты на /api/ack. Ack — ТОЛЬКО после подтверждённой
    // материализации (успешный синк кошелька); иначе — в pending-sync очередь.
    const ackCandidates: Array<{ chargeId: string; productId: string }> = [];
    try {
      for (const rec of loadPendingPurchases()) {
        try {
          const done = await this.processPendingRecord(rec);
          if (done) {
            pendingFulfilled.push(done.productId);
            // chargeId '' — товар исчез из каталога: допроверять нечего.
            if (done.chargeId) ackCandidates.push({ chargeId: done.chargeId, productId: done.productId });
          }
        } catch {
          /* одна запись не роняет остальные */
        }
      }
    } catch {
      /* ignore */
    }
    try {
      // Патч №14 (P0-1): restore сверяет ЖУРНАЛ сервера (все записи со
      // статусами paid И fulfilled) с ЛОКАЛЬНЫМ журналом выданных
      // (ofeliya.payments.credited.v1 по chargeId). Каждая запись, которой
      // нет локально и у которой статус != 'refunded', — через единую
      // fulfillPurchase(). Локальный credited.v1 даёт exactly-once на
      // устройстве; журнал сервера — источник правды о покупках.
      // Сценарий: fulfilled на старом устройстве + потеря localStorage /
      // новое устройство → restore догрантит (раньше 'fulfilled' падал
      // в else-ветку и товар терялся навсегда).
      // 'refunded' — пропуск без перевыдачи. Неизвестный статус —
      // fail-closed: ни гранта, ни пометки.
      // ИЗВЕСТНОЕ ОГРАНИЧЕНИЕ: два живых устройства материализуют покупки
      // локально каждое (двойной локальный баланс). Окончательно решается
      // только серверной экономикой (дизайн-док ofeliya-server-economy-
      // design.md); при локальной экономике это не блокер.
      const server = await this.fetchServerEntitlements();
      if (server) {
        const local = this.readEntitlements();
        let changed = false;
        for (const p of server) {
          if (p.status === 'refunded') continue;
          if (isChargeCredited(p.chargeId)) continue;
          if (p.status !== 'paid' && p.status !== 'fulfilled') {
            // Неизвестный статус — fail-closed: ни гранта, ни пометки.
            continue;
          }
          const product = SHOP_CATALOG.find((x) => x.id === p.productId);
          if (!product) {
            // E-a: товар вне каталога — warn, БЕЗ пометки credited и БЕЗ
            // ack: запись остаётся 'paid' в журнале, ручное разрешение позже.
            console.warn('[telegram-stars] server purchase for unknown product:', p.productId);
            continue;
          }
          const grant = fulfillPurchase(product, {
            chargeId: p.chargeId,
            providerId: this.id,
          });
          if (!grant.ok) {
            console.warn(
              '[telegram-stars] fulfillPurchase failed for server purchase:',
              grant.error
            );
            continue;
          }
          // E-b: ack — только при реальном начислении ('granted'), не при
          // 'duplicate'. Серверный ack идемпотентен, но семантика точная.
          // Патч №16 (A3): ack НЕ здесь — только после подтверждённого синка
          // кошелька (в конце restore()). Кандидат запоминается; выдача
          // серверная, грант материализует финальный синк.
          if (grant.outcome === 'granted')
            ackCandidates.push({ chargeId: p.chargeId, productId: p.productId });
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
    let syncResult: SyncResult;
    let drainedConfirmed: string[] = [];
    try {
      // Патч №16 (A3/A4): один итоговый синк материализует ВСЕ серверные
      // гранты (seq-идемпотентно) + дрэйн pending-sync очереди (подтверждённые
      // chargeId — снятие + ack). Догоняет и случаи, когда синк
      // из processPendingRecord не долетел. Никогда не бросает.
      syncResult = await this.syncWalletFromServer();
      if (syncResult.ok) {
        try {
          drainedConfirmed = (await this.drainPendingWalletSyncQueue()).confirmed;
        } catch {
          drainedConfirmed = [];
        }
      }
    } catch {
      syncResult = { ok: false, error: 'unexpected', reason: 'unexpected' };
    }
    try {
      if (syncResult.ok) {
        // Материализация подтверждена — bookkeeping воркера paid→fulfilled.
        // Уже подтверждённые дрэйном (drain: снятие + ack) — пропуск, чтобы
        // не дублировать POST (серверный ack идемпотентен, но семантика точная).
        const alreadyAcked = new Set(drainedConfirmed);
        for (const c of ackCandidates) {
          if (!alreadyAcked.has(c.chargeId)) this.acknowledgeCharge(c.chargeId);
        }
      } else {
        // Синк не подтверждён: ack НЕ уходит; кандидаты — в pending-sync
        // очередь (допроверка дрэйном: старт приложения, 'online',
        // следующий успешный синк). Товар не теряется.
        for (const c of ackCandidates)
          enqueuePendingWalletSync({ chargeId: c.chargeId, productId: c.productId });
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
   * Одна попытка допроверки pending-записи. Возвращает {productId, chargeId},
   * если сервер подтвердил и выдача выполнена (запись снята); ack и синк —
   * дело restore() (единый финальный синк + ack только при r.ok).
   * Патч №13: chargeId — только настоящий от сервера (синтетики нет),
   * productId — только серверный (mismatch → не выдавать, лог);
   * запись снимается ТОЛЬКО при ok от fulfillPurchase.
   */
  private async processPendingRecord(
    rec: PendingRecord
  ): Promise<{ productId: string; chargeId: string } | null> {
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
        const chargeId = v.chargeId;
        if (!chargeId) {
          // Сервер подтвердил, но chargeId не прислал (гонка с вебхуком) —
          // не выдавать: допроверим позже по бэкоффу ниже.
        } else if (v.productId !== fresh.productId) {
          // P0-2: расхождение серверного productId с локальным — mismatch:
          // не выдавать, лог; запись остаётся для ручной разборки.
          console.warn('[telegram-stars] verify productId mismatch:', {
            nonce,
            server: v.productId,
            local: fresh.productId,
          });
        } else {
          const product = SHOP_CATALOG.find((p) => p.id === v.productId);
          if (!product) {
            // Каталог сменился, а платёж настоящий — не крутить вечно.
            console.warn('[telegram-stars] pending product vanished from catalog:', fresh.productId);
            removePendingPurchase(nonce);
            return { productId: fresh.productId, chargeId: '' };
          }
          // Выдача — только через ledger (идемпотентность по chargeId).
          // P1-a: запись снимаем ТОЛЬКО при успешной выдаче.
          const grant = fulfillPurchase(product, {
            chargeId,
            providerId: this.id,
          });
          if (!grant.ok) {
            console.warn('[telegram-stars] fulfillPurchase failed:', grant.error);
            return null;
          }
          // Патч №16 (A3): ack и материализация — в restore(): единый
          // финальный синк кошелька, ack только при r.ok. Fire-and-forget
          // синка здесь больше нет (был P0 A3: результат игнорировался).
          removePendingPurchase(nonce);
          return { productId: fresh.productId, chargeId };
        }
      }
      // Не подтверждено / не выдано: бэкофф-ретраи в сессии, затем стоп.
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
   * Патч №16 (A3): БЕЗОПАСНЫЙ ack. /api/ack уходит ТОЛЬКО если материализация
   * chargeId подтверждена успешным синком кошелька (grant-событие в ledger'е:
   * syncWalletFromServer / дрэйн pending-sync). Иначе — запись в pending-sync
   * очередь (допроверка дрэйном), ack НЕ уходит: сервер не должен помечать
   * fulfilled то, что клиент не применил.
   *
   * Идемпотентен: повторный вызов после ack — запись уже снята из
   * confirmed-множества → уйдёт в очередь, а дрэйн её тут же подтвердит
   * по ledger'у и снимет (ack на сервере идемпотентен).
   * Никогда не бросает.
   */
  acknowledgeCharge(chargeId: string | undefined): void {
    try {
      const id = (chargeId ?? '').trim();
      if (!id) return;
      if (this.walletConfirmedCharges.has(id)) {
        this.walletConfirmedCharges.delete(id);
        this.postAck(id);
      } else {
        // Материализация не подтверждена — не помечаем fulfilled на сервере.
        // productId неизвестен (сигнатура) — дрэйну он не нужен.
        enqueuePendingWalletSync({ chargeId: id, productId: '' });
      }
    } catch {
      /* ignore */
    }
  }

  /**
   * Сырой POST /api/ack {initData, chargeId} (fire-and-forget).
   * Вызывать только после подтверждённой материализации (см.
   * acknowledgeCharge / дрэйн). Пустой chargeId / без бэкенда / без
   * initData — no-op. Никогда не бросает.
   */
  private postAck(chargeId: string): void {
    try {
      const id = (chargeId ?? '').trim();
      if (!id || this.apiBaseUrl === '') return;
      const initData = readTelegramInitData();
      if (!initData) return;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      void fetch(`${this.apiBaseUrl}/api/ack`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ initData, chargeId: id }),
        signal: ctrl.signal,
      })
        .catch(() => undefined)
        .finally(() => {
          clearTimeout(timer);
        });
    } catch {
      /* fire-and-forget: выдача уже выполнена, bookkeeping не критичен */
    }
  }

  /**
   * Патч №13 (worker v3): серверный список покупок для restore() —
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
        if (!res.ok) return null; // 501 db_unavailable — как недоступность
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
