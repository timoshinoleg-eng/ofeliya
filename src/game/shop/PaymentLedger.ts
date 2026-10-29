/**
 * PaymentLedger — журнал платежей и идемпотентная выдача (патч №12).
 *
 * Проблема, которую закрывает: колбэк openInvoice вызывается в браузере —
 * его можно подделать; а сервер может не успеть подтвердить платёж к моменту
 * колбэка (гонка с вебхуком). Поэтому:
 *  1. purchase() провайдера возвращает 'paid' только с chargeId от сервера
 *     (POST /api/verify {initData, nonce}), иначе — 'pending' БЕЗ выдачи;
 *  2. 'pending'-покупки лежат в ofeliya.payments.pending.v1 и допроверяются
 *     в restore() (бэкофф 2с/5с/15с/60с в сессии) + ручной кнопкой;
 *  3. выдача — только через fulfillPurchase(): идемпотентность по chargeId
 *     (журнал ofeliya.payments.credited.v1), повторный прогон — 'duplicate'.
 *
 * Адаптация к main: грант делегируется shop/grantPurchase (единая точка
 * выдачи main: скины → SkinOwnership, РНК → MetaWallet flat, бустер →
 * boosterUntilMs с продлением от max(now, срок)). Аналитика
 * purchase_completed здесь НЕ трекается: в main нет standalone-аналитики
 * для shop-модулей (trackProductEvent требует PlatformAdapter) — её
 * трекает сцена витрины: в buy() при outcome 'granted' и в restore()
 * при pendingFulfilled. Ключи зарегистрированы в src/game/storageKeys.ts.
 *
 * Phaser-free, Node-safe (localStorage guarded + in-memory fallback для
 * Node/тестов).
 */
import type { Product, ProviderId } from './PaymentProvider';
import { applyPurchaseGrants } from './grantPurchase';
import { recordStarsSpent } from '../meta/MetaWallet';

/** Pending-журнал: покупки, ждущие серверного подтверждения. */
export const PENDING_PAYMENTS_KEY = 'ofeliya.payments.pending.v1';
/** Журнал выданных charge id — идемпотентность выдачи. */
export const CREDITED_CHARGES_KEY = 'ofeliya.payments.credited.v1';

export interface PendingRecord {
  /** Nonce инвойса — ключ для POST /api/verify. */
  nonce: string;
  productId: string;
  stars: number;
  createdAt: number;
  /** Сколько verify-попыток уже сделано (для бэкоффа restore). */
  attempts: number;
}

export type FulfillOutcome = 'granted' | 'duplicate' | 'invalid-product';

export interface FulfillOptions {
  /** Telegram payment charge id — ключ идемпотентности. У mock отсутствует. */
  chargeId?: string;
  providerId: ProviderId;
}

// ---------------------------------------------------------------------------
// storage (guarded, с in-memory fallback для Node)
// ---------------------------------------------------------------------------

const memStore: Record<string, string> = {};

function readRaw(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return memStore[key] ?? null;
    return localStorage.getItem(key);
  } catch {
    return memStore[key] ?? null;
  }
}

function writeRaw(key: string, value: string): void {
  try {
    if (typeof localStorage === 'undefined') {
      memStore[key] = value;
      return;
    }
    localStorage.setItem(key, value);
  } catch {
    try {
      memStore[key] = value;
    } catch {
      /* ignore — журнал не ломает игру */
    }
  }
}

function sanitizeRecord(raw: unknown): PendingRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.nonce !== 'string' || !r.nonce) return null;
  if (typeof r.productId !== 'string' || !r.productId) return null;
  const num = (v: unknown): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
  return {
    nonce: r.nonce,
    productId: r.productId,
    stars: num(r.stars),
    createdAt: num(r.createdAt),
    attempts: num(r.attempts),
  };
}

// ---------------------------------------------------------------------------
// pending-журнал
// ---------------------------------------------------------------------------

/** Все записи, ожидающие подтверждения (копия, мутировать нельзя). */
export function loadPendingPurchases(): PendingRecord[] {
  try {
    const raw = readRaw(PENDING_PAYMENTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: PendingRecord[] = [];
    for (const item of parsed) {
      const rec = sanitizeRecord(item);
      if (rec && !out.some((o) => o.nonce === rec.nonce)) out.push(rec);
    }
    return out;
  } catch {
    return [];
  }
}

function savePendingPurchases(list: PendingRecord[]): void {
  writeRaw(PENDING_PAYMENTS_KEY, JSON.stringify(list));
}

/** Добавить запись (идемпотентно по nonce). attempts стартует с 0. */
export function addPendingPurchase(rec: {
  nonce: string;
  productId: string;
  stars: number;
  createdAt: number;
  attempts?: number;
}): void {
  const clean = sanitizeRecord({ attempts: 0, ...rec });
  if (!clean) return;
  const list = loadPendingPurchases();
  if (list.some((p) => p.nonce === clean.nonce)) return;
  list.push(clean);
  savePendingPurchases(list);
}

/** Снять запись (подтверждена или отменена). */
export function removePendingPurchase(nonce: string): void {
  const list = loadPendingPurchases();
  const next = list.filter((p) => p.nonce !== nonce);
  if (next.length !== list.length) savePendingPurchases(next);
}

/**
 * Увеличить счётчик попыток записи. Возвращает новое значение.
 * Используется restore() для бэкоффа 2с/5с/15с/60с.
 */
export function incrementPendingAttempts(nonce: string): number {
  const list = loadPendingPurchases();
  const rec = list.find((p) => p.nonce === nonce);
  if (!rec) return 0;
  rec.attempts += 1;
  savePendingPurchases(list);
  return rec.attempts;
}

/** Очистить журнал (QA/тесты). */
export function clearPendingPurchases(): void {
  savePendingPurchases([]);
}

// ---------------------------------------------------------------------------
// журнал выданных charge id (идемпотентность)
// ---------------------------------------------------------------------------

function loadCreditedCharges(): string[] {
  try {
    const raw = readRaw(CREDITED_CHARGES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((c): c is string => typeof c === 'string' && c.length > 0);
  } catch {
    return [];
  }
}

export function isChargeCredited(chargeId: string): boolean {
  return chargeId !== '' && loadCreditedCharges().includes(chargeId);
}

export function markChargeCredited(chargeId: string): void {
  if (!chargeId) return;
  const list = loadCreditedCharges();
  if (!list.includes(chargeId)) {
    list.push(chargeId);
    writeRaw(CREDITED_CHARGES_KEY, JSON.stringify(list));
  }
}

/** Очистить журнал (QA/тесты). */
export function clearCreditedCharges(): void {
  writeRaw(CREDITED_CHARGES_KEY, JSON.stringify([]));
}

// ---------------------------------------------------------------------------
// выдача
// ---------------------------------------------------------------------------

/**
 * Идемпотентная выдача покупки — ЕДИНСТВЕННАЯ точка гранта за деньги.
 *
 * - chargeId уже в журнале credited → 'duplicate': НИЧЕГО не начисляется
 *   (защита от двойной выдачи при повторных verify/restore/ретраях);
 * - без chargeId (mock, QA-дубль) — грант напрямую, как раньше
 *   (повторный грант мока без chargeId не дедуплицируется — для скинов
 *   grantSkin сам идемпотентен, для РНК/бустера это поведение QA-дубля);
 * - грант — через shop/grantPurchase (скины → SkinOwnership вне
 *   inventory-контракта check-profile-client.mjs:162, РНК — плоское
 *   начисление, бустер — продление от max(now, срок));
 * - recordStarsSpent — ТОЛЬКО для реальных провайдеров
 *   (providerId !== 'mock'): у мока звёзды не настоящие, достижения
 *   stars_1/stars_500 качать нельзя;
 * - аналитику purchase_completed трекает вызывающий код (сцена витрины),
 *   а не ledger — см. шапку.
 *
 * Никогда не бросает.
 */
export function fulfillPurchase(
  product: Product | undefined | null,
  opts: FulfillOptions
): FulfillOutcome {
  try {
    if (!product || typeof product.id !== 'string' || !product.id) return 'invalid-product';
    const chargeId = (opts.chargeId ?? '').trim();
    if (chargeId && isChargeCredited(chargeId)) return 'duplicate';

    // Грант по виду товара — через единую точку выдачи main.
    applyPurchaseGrants(product);

    if (opts.providerId !== 'mock' && product.stars) recordStarsSpent(product.stars);

    if (chargeId) markChargeCredited(chargeId);
    return 'granted';
  } catch {
    // Грант не удался — chargeId НЕ помечаем, ретрай/restore повторит.
    return 'invalid-product';
  }
}

// ---------------------------------------------------------------------------
// серверная верификация (POST /api/verify)
// ---------------------------------------------------------------------------

export interface VerifyOptions {
  apiBaseUrl: string;
  initData: string;
  nonce: string;
}

export type VerifyResult =
  | { verified: true; chargeId: string }
  | { verified: false; reason: 'verify-unreachable' | 'verify-unconfirmed' | 'verify-bad-config' };

/** Протокол патча №12: 3 попытки × 2с паузы, таймаут попытки 8с. */
export const VERIFY_ATTEMPTS = 3;
export const VERIFY_RETRY_PAUSE_MS = 2000;
export const VERIFY_TIMEOUT_MS = 8000;

/**
 * Верификация покупки на бэкенде: POST {api}/api/verify {initData, nonce}.
 * - {verified:true, chargeId} — сервер видел successful_payment по nonce;
 * - verified!==true после ретраев (гонка с вебхуком) → 'verify-unconfirmed';
 * - сеть упала сразу → 'verify-unreachable' (быстрый путь в pending-UI,
 *   допроверка — в restore()).
 * Вызывающий код НЕ выдаёт товар при verified:false — только 'pending'.
 * Никогда не бросает.
 */
export async function verifyPurchase(opts: VerifyOptions): Promise<VerifyResult> {
  try {
    const base = (opts.apiBaseUrl ?? '').trim().replace(/\/+$/, '');
    if (!base || !opts.initData || !opts.nonce) {
      return { verified: false, reason: 'verify-bad-config' };
    }
    for (let attempt = 0; attempt < VERIFY_ATTEMPTS; attempt++) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), VERIFY_TIMEOUT_MS);
        let res: Response;
        try {
          res = await fetch(`${base}/api/verify`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ initData: opts.initData, nonce: opts.nonce }),
            signal: ctrl.signal,
          });
        } finally {
          clearTimeout(timer);
        }
        if (res.ok) {
          const data: unknown = await res.json().catch(() => null);
          const v =
            !!data && typeof data === 'object'
              ? (data as { verified?: unknown; chargeId?: unknown })
              : null;
          if (v?.verified === true) {
            const chargeId = typeof v.chargeId === 'string' ? v.chargeId.trim() : '';
            return { verified: true, chargeId };
          }
          // verified !== true — возможно, вебхук ещё не долетел; ретрай.
        }
        // HTTP-ошибка — тоже ретрай (воркер мог рестартовать).
      } catch {
        // Сеть недоступна — быстрый путь: допроверим в restore().
        return { verified: false, reason: 'verify-unreachable' };
      }
      if (attempt < VERIFY_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, VERIFY_RETRY_PAUSE_MS));
      }
    }
    return { verified: false, reason: 'verify-unconfirmed' };
  } catch {
    return { verified: false, reason: 'verify-unreachable' };
  }
}

/**
 * Nonce инвойса. crypto.randomUUID с Math.random-фолбэком.
 * Node-safe (глобальный crypto есть в Node 18+ и браузерах).
 */
export function makePaymentNonce(): string {
  try {
    const c = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch {
    /* fallback ниже */
  }
  return `n-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffffff).toString(36)}`;
}
