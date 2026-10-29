/**
 * ServerWalletSync — материализация серверно-авторитетной выдачи
 * (патч №15, P0-3).
 *
 * Раньше fulfillPurchase() начислял РНК/бустер/скины на клиенте — отсюда
 * риски: два устройства материализуют одну покупку независимо, локальная
 * экономика редактируема, /api/ack подтверждает лишь заявление клиента.
 *
 * Теперь грант применяет СЕРВЕР (воркер, атомарный D1-батч в
 * successful_payment: платёж + кошелёк + журнал). Клиент выдачу НЕ
 * выдумывает: он тянет POST /api/wallet и материализует серверный
 * результат:
 *  - скины — union в SkinOwnership (серверный набор аддитивен;
 *    grantSkin идемпотентен);
 *  - бустер — max(локальный, серверный) — время не сгорает;
 *  - РНК — дельта: server.purchased_rna − локальный watermark
 *    (ofeliya.wallet.sync.v1, per-device); delta > 0 → addRna(delta)
 *    ПЛОСКО, без бонуса лаборатории (как было в fulfillPurchase до №15).
 *
 * Watermark-bootstrap: ключа нет → 0 (свежее устройство / первый синк
 * после wipe). Апгрейд с клиентов до №15: серверный кошелёк знает только
 * платежи, обработанные воркером №15+, — старые локальные гранты не
 * задваиваются (сервер их не видит, дельта = 0). Потеря localStorage на
 * старом клиенте + новый клиент: доплата по /api/entitlements —
 * через restore(), как раньше.
 *
 * Возврат (refunded): сервер уменьшает purchased_rna / убирает скин из
 * кошелька → дельта на следующих синках не перевыдаёт. Уже
 * материализованное локальное значение НЕ отзывается (честно: локальная
 * модель; см. «Модель угроз» в worker/src/index.ts).
 *
 * Два живых устройства материализуют покупки независимо (watermark
 * per-device) — окончательно только серверными расходуемыми балансами
 * (дизайн-док ofeliya-server-economy-design.md).
 *
 * Phaser-free, Node-safe. Никогда не бросает.
 */
import { addRna, loadMeta, setBoosterUntilMs } from '../meta/MetaWallet';
import { grantSkin } from '../skins/SkinOwnership';

/** Watermark: серверный purchased_rna, уже материализованный локально. */
export const WALLET_SYNC_WATERMARK_KEY = 'ofeliya.wallet.sync.v1';

/** Таймаут запроса /api/wallet. */
export const WALLET_FETCH_TIMEOUT_MS = 8000;

export interface ServerWalletState {
  purchased_rna: number;
  booster_until_ms: number;
  skins: string[];
}

export interface WalletSyncApplied {
  /** Начислено РНК этой синхронизацией (дельта, ≥0). */
  rna: number;
  /** Впервые полученные скины (id). */
  skins: string[];
  /** Итоговый срок бустера (max local/server). */
  boosterUntilMs: number;
}

export type SyncResult =
  | { ok: true; applied: WalletSyncApplied }
  | { ok: false; reason: string };

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
      /* ignore — синк не ломает игру */
    }
  }
}

function readWatermark(): number {
  try {
    const raw = readRaw(WALLET_SYNC_WATERMARK_KEY);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

function writeWatermark(v: number): void {
  writeRaw(WALLET_SYNC_WATERMARK_KEY, String(Math.max(0, Math.floor(v))));
}

/** @internal сброс watermark (тесты). */
export function debugResetWalletSync(): void {
  try {
    if (typeof localStorage === 'undefined') {
      delete memStore[WALLET_SYNC_WATERMARK_KEY];
      return;
    }
    localStorage.removeItem(WALLET_SYNC_WATERMARK_KEY);
  } catch {
    /* ignore */
  }
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

/**
 * Одна синхронизация с серверным кошельком. Идемпотентна (watermark +
 * идемпотентные локальные примитивы): безопасно вызывать после каждой
 * покупки, в restore() и по таймеру. Никогда не бросает.
 */
export async function syncServerWallet(opts: {
  apiBaseUrl: string;
  initData: string;
  fetchFn?: typeof fetch;
}): Promise<SyncResult> {
  try {
    const base = (opts.apiBaseUrl ?? '').trim().replace(/\/+$/, '');
    if (!base || !opts.initData) return { ok: false, reason: 'bad-config' };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), WALLET_FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await (opts.fetchFn ?? fetch)(`${base}/api/wallet`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ initData: opts.initData }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return { ok: false, reason: `http-${res.status}` };
    const data: unknown = await res.json().catch(() => null);
    if (!data || typeof data !== 'object') return { ok: false, reason: 'bad-response' };
    const d = data as Record<string, unknown>;
    const serverRna = num(d.purchased_rna);
    const serverBooster = num(d.booster_until_ms);
    const serverSkins = Array.isArray(d.skins)
      ? d.skins.filter((s): s is string => typeof s === 'string' && s.length > 0)
      : [];

    // Скины — union: серверный набор аддитивен, grantSkin идемпотентен.
    const newSkins: string[] = [];
    for (const id of serverSkins) {
      try {
        if (grantSkin(id, 'purchase')) newSkins.push(id);
      } catch {
        /* один скин не роняет синк */
      }
    }

    // Бустер — max(local, server): время не сгорает ни при каком порядке.
    const localBooster = num(loadMeta().boosterUntilMs);
    const boosterUntilMs = Math.max(localBooster, serverBooster);
    if (boosterUntilMs > localBooster) setBoosterUntilMs(boosterUntilMs);

    // РНК — дельта по watermark. Плоское начисление БЕЗ бонуса лаборатории
    // (семантика паков не меняется: сервер выдал финальную сумму).
    const watermark = readWatermark();
    const delta = serverRna - watermark;
    let appliedRna = 0;
    if (delta > 0) {
      addRna(delta);
      appliedRna = delta;
    }
    writeWatermark(serverRna);
    return { ok: true, applied: { rna: appliedRna, skins: newSkins, boosterUntilMs } };
  } catch {
    return { ok: false, reason: 'network' };
  }
}
