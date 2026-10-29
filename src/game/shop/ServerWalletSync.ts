/**
 * ServerWalletSync — материализация серверно-авторитетной выдачи
 * по seq-журналу (патч №16, A4; переписан поверх патча №15).
 *
 * Проблема патча №15: накопительный watermark (ofeliya.wallet.sync.v1)
 * недетерминирован — клиент, синканувшийся между refund и repurchase,
 * и клиент, синканувшийся один раз в конце, получали разные локальные
 * итоги при одинаковой серверной истории; watermark не был изолирован
 * по пользователю (смена Telegram-аккаунта применяла чужой курсор).
 *
 * Теперь клиент тянет POST /api/wallet {initData, since_seq} и применяет
 * события журнала wallet_ledger (seq = wallet_ledger.id, монотонен):
 *  - свежий синк (нет last_seq): since_seq=0, неттинг грантов МИНУС
 *    reversal (по reverses_charge_id); РНК net>0 → addRna(net) ПЛОСКО, без
 *    бонуса лаборатории; скины — union АВТОРИТЕТНОГО server.skins (не
 *    неттинг событий); бустер — max(local, server.booster_until_ms);
 *  - инкрементальный: гранты батча минус reversal тех же грантов (если
 *    reversal пришёл в том же батче); reversal старого гранта — только
 *    учёт (локально не вычитаем: нельзя отозвать потраченное);
 *  - события с seq<=last_seq — пропуск (идемпотентность).
 *
 * Детерминизм: свежий синк даёт тот же локальный итог, что и
 * инкрементальное применение тех же событий. Возврат → новое
 * устройство/wipe НЕ даёт бесплатной РНК: reversal гасит грант в неттинге
 * (P0-1 независимого review; было — активное двойное начисление).
 *
 * Курсор: 'ofeliya.wallet.seq.v2' → {serverId: {tgUserId: {last_seq}}}.
 * tgUserId парсится из initData (user.id); без него синк невозможен
 * ({ok:false, error:'no-user'}). Привязка к server_id из ответа: смена
 * бэкенда → свежий синк (чужой курсор не применяется). Смена
 * Telegram-аккаунта → другой tgUserId → другой ключ → свежий синк.
 * Старый watermark-ключ ofeliya.wallet.sync.v1 НЕ читается (игнор);
 * контракт v2 — всегда seq. Порядок апгрейда: сначала воркер, потом
 * клиент (см. runbook): ответ без schema_version/tip_seq →
 * {ok:false, error:'incompatible-worker'} (fail-closed, НЕ silent fallback).
 *
 * Скины — union в SkinOwnership (серверный набор аддитивен;
 * grantSkin идемпотентен). Возврат скина (reversal) локальное владение
 * не отзывает — честно (та же модель угроз).
 *
 * Phaser-free, Node-safe. Никогда не бросает.
 */
import { addRna, loadMeta, setBoosterUntilMs } from '../meta/MetaWallet';
import { grantSkin } from '../skins/SkinOwnership';

/**
 * Ключ seq-курсора (патч №16, A4).
 * Формат: JSON {serverId: {tgUserId: {last_seq: number}}}.
 */
export const WALLET_SEQ_KEY = 'ofeliya.wallet.seq.v2';

/**
 * @deprecated Патч №15 (watermark). Больше НЕ читается: контракт v2 —
 * всегда seq. Оставлен для совместимости импортов; сбрасывается вместе
 * с v2 в debugResetWalletSync().
 */
export const WALLET_SYNC_WATERMARK_KEY = 'ofeliya.wallet.sync.v1';

/** Таймаут запроса /api/wallet. */
export const WALLET_FETCH_TIMEOUT_MS = 8000;

export interface ServerWalletState {
  purchased_rna: number;
  booster_until_ms: number;
  skins: string[];
}

export interface WalletSyncApplied {
  /** Начислено РНК этой синхронизацией (≥0). */
  rna: number;
  /** Впервые полученные скины (id). */
  skins: string[];
  /** Итоговый срок бустера (max local/server). */
  boosterUntilMs: number;
  /**
   * Обработано событий журнала с seq > last_seq (гранты + учтённые
   * reversal). Свежий синк: число событий, вошедших в неттинг.
   */
  eventsApplied: number;
  /**
   * charge_id грантовых событий из ответа (ВЕСЬ ledger, не только
   * применённые). Расширение контракта для клиента: дрэйн pending-sync
   * подтверждает материализацию конкретного chargeId. Не персистится.
   */
  grantChargeIds: string[];
}

export type SyncResult =
  | { ok: true; applied: WalletSyncApplied; tip_seq: number }
  /** reason — deprecated-алиас error (совместимость с патчем №15). */
  | { ok: false; error: string; reason?: string };

/** Событие серверного журнала (POST /api/wallet → ledger[]). */
export interface WalletLedgerEvent {
  seq: number;
  charge_id: string;
  kind: 'grant' | 'reversal';
  grant_type: 'rna' | 'booster' | 'skin';
  /** Знаковое целое: +N grant / −N reversal (РНК); ±E_ms бустер; 0 скин. */
  amount: number;
  skin_id: string | null;
  /** Для reversal — charge_id исходного гранта (иначе null). */
  reverses_charge_id: string | null;
  created_at: number;
}

export interface SyncServerWalletOptions {
  apiBaseUrl: string;
  initData: string;
  /** Переопределение since_seq (дрэйн pending-sync: полный ledger-зонд). */
  sinceSeq?: number;
  fetchFn?: typeof fetch;
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
      /* ignore — синк не ломает игру */
    }
  }
}

function removeRaw(key: string): void {
  try {
    if (typeof localStorage === 'undefined') {
      delete memStore[key];
      return;
    }
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

interface SeqEntry {
  last_seq: number;
}
type SeqMap = Record<string, Record<string, SeqEntry>>;

function sanitizeSeq(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;
}

/** Карта курсоров {serverId: {tgUserId: {last_seq}}}. Битый JSON → {}. */
function readSeqMap(): SeqMap {
  try {
    const raw = readRaw(WALLET_SEQ_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: SeqMap = {};
    for (const [serverId, users] of Object.entries(parsed as Record<string, unknown>)) {
      if (!serverId || !users || typeof users !== 'object') continue;
      const uout: Record<string, SeqEntry> = {};
      for (const [tgUserId, entry] of Object.entries(users as Record<string, unknown>)) {
        const lastSeq =
          !!entry && typeof entry === 'object'
            ? sanitizeSeq((entry as { last_seq?: unknown }).last_seq)
            : null;
        if (tgUserId && lastSeq != null) uout[tgUserId] = { last_seq: lastSeq };
      }
      out[serverId] = uout;
    }
    return out;
  } catch {
    return {};
  }
}

function writeSeqMap(map: SeqMap): void {
  try {
    writeRaw(WALLET_SEQ_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/** @internal сброс seq-курсора и legacy watermark (тесты). */
export function debugResetWalletSync(): void {
  removeRaw(WALLET_SEQ_KEY);
  // v1 больше не читается, но сбрасываем и его — чтобы QA-состояние
  // было детерминированным после апгрейда с клиентов патча №15.
  removeRaw(WALLET_SYNC_WATERMARK_KEY);
}

/** tgUserId из initData (user.id). null — распарсить нельзя. */
export function parseTelegramUserId(initData: string): number | null {
  try {
    if (!initData) return null;
    const userRaw = new URLSearchParams(initData).get('user');
    if (!userRaw) return null;
    const user: unknown = JSON.parse(userRaw);
    const id =
      !!user && typeof user === 'object' && typeof (user as { id?: unknown }).id === 'number'
        ? Math.floor((user as { id: number }).id)
        : -1;
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

function int(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0;
}

function sanitizeEvent(raw: unknown): WalletLedgerEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  const seq = sanitizeSeq(e.seq);
  if (seq == null || seq <= 0) return null;
  const chargeId = typeof e.charge_id === 'string' ? e.charge_id.trim() : '';
  if (!chargeId) return null;
  const kind = e.kind === 'grant' || e.kind === 'reversal' ? e.kind : null;
  if (!kind) return null;
  const grantType =
    e.grant_type === 'rna' || e.grant_type === 'booster' || e.grant_type === 'skin'
      ? e.grant_type
      : null;
  if (!grantType) return null;
  const skinId = e.skin_id == null ? null : typeof e.skin_id === 'string' ? e.skin_id : null;
  const reversesChargeId =
    e.reverses_charge_id == null
      ? null
      : typeof e.reverses_charge_id === 'string' && e.reverses_charge_id.length > 0
        ? e.reverses_charge_id
        : null;
  return {
    seq,
    charge_id: chargeId,
    kind,
    grant_type: grantType,
    amount: int(e.amount),
    skin_id: skinId,
    reverses_charge_id: reversesChargeId,
    created_at: num(e.created_at),
  };
}

interface WalletResponse {
  serverId: string;
  userId: number;
  purchasedRna: number;
  boosterUntilMs: number;
  skins: string[];
  ledger: WalletLedgerEvent[];
  tipSeq: number;
}

const fail = (error: string): SyncResult => ({ ok: false, error, reason: error });

/**
 * Одна синхронизация с серверным кошельком по seq-журналу. Идемпотентна
 * (last_seq + идемпотентные локальные примитивы): безопасно вызывать после
 * каждой покупки, в restore(), в дрэйне pending-sync и повторно.
 * Никогда не бросает.
 */
export async function syncServerWallet(opts: SyncServerWalletOptions): Promise<SyncResult> {
  try {
    const base = (opts.apiBaseUrl ?? '').trim().replace(/\/+$/, '');
    if (!base || !opts.initData) return fail('bad-config');
    // A4: курсор изолирован по пользователю. Без user.id синк невозможен —
    // иначе курсор одного аккаунта применился бы к чужому кошельку.
    const tgUserId = parseTelegramUserId(opts.initData);
    if (tgUserId == null) return fail('no-user');
    const userKey = String(tgUserId);

    const seqMap = readSeqMap();
    // since_seq для запроса: сохранённый курсор этого пользователя на
    // известном бэкенде, иначе 0 (свежий синк). Явный sinceSeq (зонд дрэйна)
    // переопределяет, но режим fresh/incremental решает НАЛИЧИЕ курсора.
    let sinceSeq = 0;
    let assumedServer: string | null = null;
    if (opts.sinceSeq != null) {
      sinceSeq = Math.max(0, Math.floor(opts.sinceSeq));
    } else {
      for (const sid of Object.keys(seqMap)) {
        const lastSeq = seqMap[sid]?.[userKey]?.last_seq;
        if (lastSeq != null) {
          sinceSeq = lastSeq;
          assumedServer = sid;
          break;
        }
      }
    }

    type PostResult =
      | { ok: true; wallet: WalletResponse }
      | { ok: false; error: string; reason?: string };
    const failPost = (error: string): PostResult => ({ ok: false, error, reason: error });
    const doPost = async (seq: number): Promise<PostResult> => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), WALLET_FETCH_TIMEOUT_MS);
      try {
        const res = await (opts.fetchFn ?? fetch)(`${base}/api/wallet`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ initData: opts.initData, since_seq: seq }),
          signal: ctrl.signal,
        });
        if (!res.ok) return failPost(`http-${res.status}`);
        const data: unknown = await res.json().catch(() => null);
        if (!data || typeof data !== 'object') return failPost('bad-response');
        const d = data as Record<string, unknown>;
        // A4: только schema_version 2. Старый воркер (purchased_rna +
        // ledger_tip без журнала) → fail-closed, НЕ silent fallback:
        // сначала обновляется воркер, потом клиент (runbook).
        if (d.schema_version !== 2) return failPost('incompatible-worker');
        const tipSeq = sanitizeSeq(d.tip_seq);
        const serverId = typeof d.server_id === 'string' ? d.server_id.trim() : '';
        if (tipSeq == null || !serverId) return failPost('incompatible-worker');
        if (!Array.isArray(d.ledger)) return failPost('incompatible-worker');
        const ledger: WalletLedgerEvent[] = [];
        for (const raw of d.ledger) {
          const ev = sanitizeEvent(raw);
          if (ev) ledger.push(ev);
          // Битое событие — пропуск (не роняет синк); tip_seq всё равно
          // двигается — сервер авторитетен.
        }
        const skins = Array.isArray(d.skins)
          ? d.skins.filter((s): s is string => typeof s === 'string' && s.length > 0)
          : [];
        return {
          ok: true,
          wallet: {
            serverId,
            userId: typeof d.user_id === 'number' ? Math.floor(d.user_id) : 0,
            purchasedRna: num(d.purchased_rna),
            boosterUntilMs: num(d.booster_until_ms),
            skins,
            ledger,
            tipSeq,
          },
        };
      } catch {
        return failPost('network');
      } finally {
        clearTimeout(timer);
      }
    };

    const wr = await doPost(sinceSeq);
    // Явное === false: тестовые tsc-прогоны игнорируют tsconfig (non-strict),
    // без strictNullChecks truthiness не сужает дискриминант.
    if (wr.ok === false) return wr;
    let resp = wr.wallet;
    // Смена бэкенда (другой server_id): курсор чужого бэкенда невалиден —
    // один повторный запрос как свежий синк для нового server_id.
    if (assumedServer != null && assumedServer !== resp.serverId && opts.sinceSeq == null) {
      const wr2 = await doPost(0);
      if (wr2.ok === false) return wr2;
      resp = wr2.wallet;
      sinceSeq = 0;
      assumedServer = null;
    }
    const cursor: number | null =
      assumedServer === resp.serverId ? sinceSeq : (seqMap[resp.serverId]?.[userKey]?.last_seq ?? null);

    const applied: WalletSyncApplied = {
      rna: 0,
      skins: [],
      boosterUntilMs: num(loadMeta().boosterUntilMs),
      eventsApplied: 0,
      grantChargeIds: [],
    };
    const grantChargeIds = new Set<string>();
    for (const ev of resp.ledger) {
      if (ev.kind === 'grant') grantChargeIds.add(ev.charge_id);
    }
    applied.grantChargeIds = [...grantChargeIds];

    if (cursor == null) {
      // ---------- Свежий синк: неттинг грантов МИНУС reversal ----------
      // P0-1 (независимый review): reversal НЕЛЬЗЯ игнорировать — иначе
      // возврат → новое устройство/wipe = бесплатная РНК из воздуха, а
      // buy→refund→rebuy даёт 1000 вместо серверных 500. Неттинг:
      // каждый reversal гасит грант с reverses_charge_id; несопоставленный
      // reversal (гранта нет в ответе) — игнор, итог floor 0.
      // Детерминизм A4 сохранён: fresh == incremental для одной истории.
      const grants = new Map<string, number>();
      for (const ev of resp.ledger) {
        if (ev.grant_type !== 'rna' || ev.kind !== 'grant' || ev.amount <= 0) continue;
        if (grants.has(ev.charge_id)) continue;
        grants.set(ev.charge_id, ev.amount);
      }
      for (const ev of resp.ledger) {
        if (ev.grant_type !== 'rna' || ev.kind !== 'reversal') continue;
        const target = ev.reverses_charge_id;
        if (target && grants.has(target)) grants.delete(target);
      }
      let net = 0;
      for (const v of grants.values()) net += v;
      // Плоское начисление БЕЗ бонуса лаборатории (семантика паков:
      // сервер выдал финальную сумму).
      if (net > 0) {
        addRna(net);
        applied.rna = net;
      }
      applied.eventsApplied = resp.ledger.length;
      // Скины — union АВТОРИТЕТНОГО server.skins (не неттинг событий).
      for (const id of resp.skins) {
        try {
          if (grantSkin(id, 'purchase')) applied.skins.push(id);
        } catch {
          /* один скин не роняет синк */
        }
      }
    } else {
      // ---------- Инкрементальный синк: события seq > last_seq ----------
      // P0-1: reversal гранта из ЭТОГО ЖЕ батча гасит его до начисления
      // (иначе buy→refund→rebuy в одном батче даст лишнее). Reversal
      // старого гранта (уже материализован в прошлых синках) — только
      // учёт: локально не вычитаем (нельзя отозвать потраченное;
      // задокументированный остаточный риск).
      const fresh = resp.ledger
        .filter((ev) => ev.seq > cursor)
        .sort((a, b) => a.seq - b.seq);
      const batchGrants = new Map<string, number>();
      for (const ev of fresh) {
        if (ev.grant_type === 'rna' && ev.kind === 'grant' && ev.amount > 0) {
          if (!batchGrants.has(ev.charge_id)) batchGrants.set(ev.charge_id, ev.amount);
        }
      }
      for (const ev of fresh) {
        if (ev.grant_type === 'rna' && ev.kind === 'reversal') {
          const target = ev.reverses_charge_id;
          if (target && batchGrants.has(target)) batchGrants.delete(target);
        }
      }
      let batchNet = 0;
      for (const v of batchGrants.values()) batchNet += v;
      if (batchNet > 0) {
        // Плоско, без бонуса лаборатории (как свежий синк).
        addRna(batchNet);
        applied.rna += batchNet;
      }
      for (const ev of fresh) {
        if (ev.grant_type === 'skin') {
          if (ev.kind === 'grant' && ev.skin_id) {
            try {
              if (grantSkin(ev.skin_id, 'purchase')) applied.skins.push(ev.skin_id);
            } catch {
              /* один скин не роняет синк */
            }
          }
          // reversal скина: учёт; локальное владение НЕ отзывается — честно.
        }
        // booster: авторитетное значение сервера применяется ниже одним
        // max() — время не сгорает ни при каком порядке событий.
        applied.eventsApplied += 1;
      }
    }

    // Бустер — max(local, server) после применения: серверное значение
    // авторитетно, локальное время не сгорает.
    const localBooster = num(loadMeta().boosterUntilMs);
    const boosterUntilMs = Math.max(localBooster, resp.boosterUntilMs);
    if (boosterUntilMs > localBooster) setBoosterUntilMs(boosterUntilMs);
    applied.boosterUntilMs = boosterUntilMs;

    // Курсор всегда двигается на tip_seq — сервер авторитетен, что новее
    // ничего нет (даже если событий 0).
    const users = seqMap[resp.serverId] ?? {};
    users[userKey] = { last_seq: resp.tipSeq };
    seqMap[resp.serverId] = users;
    writeSeqMap(seqMap);

    return { ok: true, applied, tip_seq: resp.tipSeq };
  } catch {
    return fail('network');
  }
}
