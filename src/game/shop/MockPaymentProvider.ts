/**
 * MockPaymentProvider — dev/QA-реализация PaymentProvider (витрина OFELIYA).
 *
 * Реальных денег нет: покупка «успешна» после настраиваемой задержки.
 * Конфиг из URL (без пересборки, как флаги Фазы 2):
 *   ?shop.mockDelay=<ms>        — симуляция латентности биллинга;
 *   ?shop.mockFail=all|<prodId> — принудительная ошибка (QA failed-пути).
 *
 * Выданные права (entitlements) персистятся в localStorage, чтобы работал
 * QA-цикл «купил → убил апп → restore()». Всё под try/catch: мок никогда
 * не ломает игру. Phaser-free, тестируется в Node (localStorage guarded).
 */
import type {
  PaymentProvider,
  Product,
  ProviderId,
  PurchaseResult,
  RestoreResult,
} from './PaymentProvider';
import { SHOP_CATALOG } from './products';

export interface MockShopConfig {
  /** Симулированная задержка биллинга, мс. */
  delayMs: number;
  /** 'all' | productId | '' — принудительный провал покупки. */
  fail: string;
}

export const ENTITLEMENTS_KEY = 'ofeliya.mock.entitlements.v1';

interface Entitlement {
  productId: string;
  receipt: string;
  ts: number;
}

/**
 * Чистая функция: парсит ?shop.mockDelay= и ?shop.mockFail= из query-строки.
 * Мусор игнорируется (delay clamp 0..10_000 мс).
 */
export function readMockShopConfig(search: string): MockShopConfig {
  const out: MockShopConfig = { delayMs: 0, fail: '' };
  if (!search) return out;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search.replace(/^\?/, ''));
  } catch {
    return out;
  }
  const rawDelay = params.get('shop.mockDelay');
  if (rawDelay !== null) {
    const n = Number(rawDelay);
    if (Number.isFinite(n)) out.delayMs = Math.max(0, Math.min(10_000, Math.round(n)));
  }
  const rawFail = params.get('shop.mockFail');
  if (rawFail !== null && rawFail.length > 0 && rawFail.length <= 128) {
    out.fail = rawFail;
  }
  return out;
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
    // мок не ломает игру из-за квот/приватного режима
  }
}

export class MockPaymentProvider implements PaymentProvider {
  readonly id: ProviderId = 'mock';
  private readonly config: MockShopConfig;
  /** In-memory fallback, когда localStorage недоступен (Node/тесты). */
  private readonly memoryEntitlements: Entitlement[] = [];

  constructor(config: MockShopConfig = { delayMs: 0, fail: '' }) {
    this.config = { delayMs: config.delayMs, fail: config.fail };
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

  isAvailable(): boolean {
    return true;
  }

  async listProducts(): Promise<Product[]> {
    await delay(this.config.delayMs);
    // Копия: каталог мутировать нельзя (контракт интерфейса).
    return SHOP_CATALOG.map((p) => ({ ...p, price: { ...p.price }, art: { ...p.art } }));
  }

  async purchase(productId: string): Promise<PurchaseResult> {
    await delay(this.config.delayMs);
    if (this.config.fail === 'all' || this.config.fail === productId) {
      return { state: 'failed', productId, provider: 'mock', reason: 'mock-forced-failure' };
    }
    const product = SHOP_CATALOG.find((p) => p.id === productId);
    if (!product) {
      return { state: 'failed', productId, provider: 'mock', reason: 'unknown-product' };
    }
    const receipt = `mock-${Date.now().toString(36)}-${productId}`;
    const list = this.readEntitlements();
    if (!list.some((e) => e.productId === productId)) {
      list.push({ productId, receipt, ts: Date.now() });
      this.writeEntitlements(list);
    }
    return { state: 'paid', productId, provider: 'mock', receipt };
  }

  async restore(): Promise<RestoreResult> {
    await delay(this.config.delayMs);
    return { productIds: this.readEntitlements().map((e) => e.productId) };
  }
}
