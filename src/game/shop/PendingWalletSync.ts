/**
 * PendingWalletSync — очередь «оплата подтверждена, товар ожидает
 * синхронизации» (патч №16, A3).
 *
 * Проблема: StorefrontScene.buy делал `await tg.syncWalletFromServer()`,
 * игнорируя результат, и безусловно вызывал acknowledgeCharge — сервер
 * помечал платёж fulfilled, хотя клиент кошелёк не применил (P0 A3).
 *
 * Теперь:
 *  - buy: r.ok → тост «Товар успешно получен» + acknowledgeCharge ТОЛЬКО
 *    здесь; !r.ok → запись в очередь + различимый UI-статус
 *    «Оплата подтверждена, товар ожидает синхронизации» + кнопка
 *    «Повторить» (не «Товар получен», ack не уходит);
 *  - acknowledgeCharge безопасен сам по себе: без подтверждённой
 *    материализации chargeId он НЕ шлёт /api/ack, а кладёт запись в очередь;
 *  - дрэйн очереди: при старте приложения (main.ts → restore()),
 *    при открытии витрины (restore()), по событию 'online', после каждого
 *    успешного синка. Один дрэйн — один зондовый синк since_seq=0
 *    (полный ledger; применяются только события seq > last_seq —
 *    идемпотентно); подтверждённые chargeId снимаются + ack;
 *    неподтверждённые остаются до следующего дрэйна;
 *  - кап: старше 24ч или ≥50 попыток → статус 'needs-manual-check',
 *    авто-ретрай останавливается (без бесконечного цикла), пометка в UI;
 *  - закрытие Mini App между платежом и синком: товар не теряется —
 *    следующий запуск → restore() → синк по seq (сервер применил грант
 *    атомарно, патч №16 A1).
 *
 * Не путать с ofeliya.payments.pending.v1 (PaymentLedger): там —
 * verify-очередь по nonce (сервер ещё НЕ подтвердил оплату), здесь —
 * сервер оплату подтвердил, но клиент ещё НЕ материализовал кошелёк.
 *
 * Phaser-free, Node-safe. Никогда не бросает.
 */
import type { SyncResult } from './ServerWalletSync';

/** Очередь синхронизации кошелька: оплата подтверждена, грант не материализован. */
export const PENDING_WALLET_SYNC_KEY = 'ofeliya.payments.pending-sync.v1';

/** Возраст записи, после которого авто-ретрай останавливается. */
export const PENDING_SYNC_MAX_AGE_MS = 24 * 3600 * 1000;
/** Число попыток дрэйна, после которого авто-ретрай останавливается. */
export const PENDING_SYNC_MAX_ATTEMPTS = 50;

export type PendingWalletSyncStatus = 'pending' | 'needs-manual-check';

export interface PendingWalletSyncRecord {
  /** Telegram payment charge id — ключ идемпотентности. */
  chargeId: string;
  /** id товара (может быть '' — запись через безопасный acknowledgeCharge). */
  productId: string;
  /** Когда встали в очередь (Date.now()). */
  addedAt: number;
  /** Сколько дрэйнов уже пытались подтвердить. */
  attempts: number;
  status: PendingWalletSyncStatus;
}

/** Синк кошелька, который использует дрэйн (провайдер). */
export type WalletSyncFn = (sinceSeq?: number) => Promise<SyncResult>;

export interface DrainResult {
  ok: boolean;
  /** chargeId, чья материализация подтверждена ledger'ом в этом дрэйне. */
  confirmed: string[];
  error?: string;
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
      /* ignore — очередь не ломает игру */
    }
  }
}

function sanitizeRecord(raw: unknown): PendingWalletSyncRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.chargeId !== 'string' || !r.chargeId.trim()) return null;
  const num = (v: unknown): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
  const status: PendingWalletSyncStatus =
    r.status === 'needs-manual-check' ? 'needs-manual-check' : 'pending';
  return {
    chargeId: r.chargeId.trim(),
    productId: typeof r.productId === 'string' ? r.productId : '',
    addedAt: num(r.addedAt),
    attempts: num(r.attempts),
    status,
  };
}

/** Все записи очереди (копия). */
export function loadPendingWalletSync(): PendingWalletSyncRecord[] {
  try {
    const raw = readRaw(PENDING_WALLET_SYNC_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: PendingWalletSyncRecord[] = [];
    for (const item of parsed) {
      const rec = sanitizeRecord(item);
      if (rec && !out.some((o) => o.chargeId === rec.chargeId)) out.push(rec);
    }
    return out;
  } catch {
    return [];
  }
}

function savePendingWalletSync(list: PendingWalletSyncRecord[]): void {
  writeRaw(PENDING_WALLET_SYNC_KEY, JSON.stringify(list));
}

/**
 * Встать в очередь (идемпотентно по chargeId). Пустой chargeId — no-op.
 * Существующая запись не затирается (сохраняет attempts/статус).
 */
export function enqueuePendingWalletSync(rec: { chargeId: string; productId: string }): void {
  const chargeId = (rec.chargeId ?? '').trim();
  if (!chargeId) return;
  const list = loadPendingWalletSync();
  if (list.some((p) => p.chargeId === chargeId)) return;
  list.push({
    chargeId,
    productId: typeof rec.productId === 'string' ? rec.productId : '',
    addedAt: Date.now(),
    attempts: 0,
    status: 'pending',
  });
  savePendingWalletSync(list);
}

/** Снять запись (материализация подтверждена). */
export function removePendingWalletSync(chargeId: string): void {
  const id = (chargeId ?? '').trim();
  if (!id) return;
  const list = loadPendingWalletSync();
  const next = list.filter((p) => p.chargeId !== id);
  if (next.length !== list.length) savePendingWalletSync(next);
}

/** +1 попытка; возвращает новое значение (0 — записи нет). */
export function incrementPendingWalletSyncAttempts(chargeId: string): number {
  const list = loadPendingWalletSync();
  const rec = list.find((p) => p.chargeId === chargeId);
  if (!rec) return 0;
  rec.attempts += 1;
  savePendingWalletSync(list);
  return rec.attempts;
}

/** Перевести в 'needs-manual-check' (кап исчерпан). */
export function markPendingWalletSyncManual(chargeId: string): void {
  const list = loadPendingWalletSync();
  const rec = list.find((p) => p.chargeId === chargeId);
  if (!rec || rec.status === 'needs-manual-check') return;
  rec.status = 'needs-manual-check';
  savePendingWalletSync(list);
}

/** chargeId записей со статусом 'pending' (для UI и тестов). */
export function getPendingSyncChargeIds(): string[] {
  return loadPendingWalletSync()
    .filter((p) => p.status === 'pending')
    .map((p) => p.chargeId);
}

/** Есть ли записи, требующие ручной проверки (для UI-баннера). */
export function hasManualCheckEntries(): boolean {
  return loadPendingWalletSync().some((p) => p.status === 'needs-manual-check');
}

/** Очистить очередь (QA/тесты). */
export function clearPendingWalletSync(): void {
  savePendingWalletSync([]);
}

// ---------------------------------------------------------------------------
// дрэйн
// ---------------------------------------------------------------------------

/**
 * Дрэйн очереди: подтверждает материализацию грантов по seq-журналу.
 *
 *  - очередь пуста → no-op БЕЗ сетевого запроса;
 *  - записи старше 24ч / с ≥50 попытками → 'needs-manual-check'
 *    (авто-ретрай стоп, без бесконечного цикла);
 *  - остальным attempts++ и один зондовый синк sync(0): сервер отдаёт
 *    полный ledger, применяются только события seq > last_seq
 *    (идемпотентно); chargeId из grant-событий ledger'а → подтверждён:
 *    запись снимается, вызывается onConfirmed (провайдер шлёт ack);
 *  - синк не удался → записи остаются, следующий дрэйн повторит.
 *
 * Никогда не бросает.
 */
export async function drainPendingWalletSync(
  sync: WalletSyncFn,
  opts?: { onConfirmed?: (chargeId: string) => void; now?: () => number }
): Promise<DrainResult> {
  try {
    const now = opts?.now ? opts.now() : Date.now();
    const pending = loadPendingWalletSync().filter((p) => p.status === 'pending');
    if (pending.length === 0) return { ok: true, confirmed: [] };

    const work: PendingWalletSyncRecord[] = [];
    for (const rec of pending) {
      if (
        now - rec.addedAt > PENDING_SYNC_MAX_AGE_MS ||
        rec.attempts >= PENDING_SYNC_MAX_ATTEMPTS
      ) {
        // Кап исчерпан: авто-ретрай останавливаем, запись остаётся
        // с пометкой для ручной разборки (не удаляем — товар не теряем).
        markPendingWalletSyncManual(rec.chargeId);
        continue;
      }
      work.push(rec);
    }
    if (work.length === 0) return { ok: true, confirmed: [] };

    for (const rec of work) incrementPendingWalletSyncAttempts(rec.chargeId);

    // Зонд: полный ledger (since_seq=0). Применяются только события
    // seq > last_seq — идемпотентно; подтверждение — по grant-событиям
    // ВСЕГО ledger'а (грант мог материализовать более ранний синк).
    let r: SyncResult;
    try {
      r = await sync(0);
    } catch {
      return { ok: false, confirmed: [], error: 'sync-threw' };
    }
    // Явное === false: тестовые tsc-прогоны игнорируют tsconfig (non-strict),
    // без strictNullChecks truthiness не сужает дискриминант.
    if (r.ok === false) return { ok: false, confirmed: [], error: r.error };

    const granted = new Set(r.applied.grantChargeIds ?? []);
    const confirmed: string[] = [];
    for (const rec of work) {
      if (!granted.has(rec.chargeId)) continue; // гранта ещё нет в журнале — ждём
      removePendingWalletSync(rec.chargeId);
      confirmed.push(rec.chargeId);
      try {
        opts?.onConfirmed?.(rec.chargeId);
      } catch {
        /* колбэк не роняет дрэйн */
      }
    }
    return { ok: true, confirmed };
  } catch {
    return { ok: false, confirmed: [], error: 'unexpected' };
  }
}
