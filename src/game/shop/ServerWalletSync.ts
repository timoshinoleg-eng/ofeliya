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
 *    неттинг событий); бустер — серверный срок покупки + банк
 *    заработанного (миссионного) времени (CR-R3-6/7, см. ниже);
 *    пропуск — local := server, если в батче есть его reversal, иначе
 *    max(local, server) (P1-5: возврат отзывает доступ локально);
 *  - инкрементальный: гранты батча минус reversal тех же грантов (если
 *    reversal пришёл в том же батче); reversal старого гранта — только
 *    учёт (локально не вычитаем: нельзя отозвать потраченное);
 *    исключение — пропуск: reversal в батче делает серверный срок
 *    авторитетным (local := server); бустер — серверный срок + банк
 *    заработанного времени (CR-R3-6/7, см. ниже);
 *  - события с seq<=last_seq — пропуск (идемпотентность);
 *  - устаревший ответ (tip_seq <= last_seq — снапшот/реплика старше
 *    применённого) серверные сроки не применяет и курсор назад не
 *    двигает: старое высокое значение не «воскрешает» отозванный пропуск
 *    и отозванный бустер (CR-R3-8), а откат курсора не даёт двойного
 *    начисления на следующем синке.
 *
 * Бустер (CR-R3-6/7, замена неттинга P2-N3): серверный снапшот
 * resp.boosterUntilMs авторитетен для КУПЛЕННОЙ компоненты (триггер
 * воркера уже учёл гранты/возвраты батча), а заработанное (миссионное)
 * время хранится отдельным персистентным банком
 * (MetaWallet.boosterEarnedMs + boosterEarnedAnchorMs) и складывается
 * поверх серверного срока — но только НЕИЗРАСХОДОВАННЫЙ остаток
 * (CR-R4-1, elapsed-aware): время хвоста, уже прожитое к моменту
 * синка, не добавляется заново (миссия 3д в T + покупка 7д в T+1д =
 * T+10д, а не T+11д). Возврат истёкшей покупки не срезает
 * непросроченную награду (банк не трогается), а новая покупка
 * добавляется к миссионному времени (3 + 7 = 10 при покупке в тот же
 * момент), а не заменяет его. Повторный синк идемпотентен:
 * персистятся остаток и его якорь, а не дельта событий. Банк жив,
 * пока жив local booster: при истечении обнуляется, иначе мёртвая
 * награда вечно продлевала бы покупки.
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
import {
  addRna,
  getBoosterEarnedAnchorMs,
  getBoosterEarnedMs,
  loadMeta,
  setBoosterEarned,
  setBoosterUntilMs,
  setSeasonPassUntilMs,
} from '../meta/MetaWallet';
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
/** P3-10: максимум страниц журнала за один синк (20 × 5000 = 100k событий). */
export const WALLET_MAX_PAGES = 20;

export interface ServerWalletState {
  purchased_rna: number;
  booster_until_ms: number;
  /** Монетизация v3: абсолютный срок сезонного пропуска (epoch ms). */
  season_pass_until_ms: number;
  skins: string[];
}

export interface WalletSyncApplied {
  /** Начислено РНК этой синхронизацией (≥0). */
  rna: number;
  /** Впервые полученные скины (id). */
  skins: string[];
  /** Итоговый срок бустера (серверный срок покупки + банк заработанного). */
  boosterUntilMs: number;
  /**
   * Итоговый срок сезонного пропуска (монетизация v3). P1-5: серверное
   * значение, если в применённом батче есть reversal пропуска, иначе
   * max(local, server); устаревший ответ оставляет локальное как есть.
   */
  seasonPassUntilMs: number;
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
  grant_type: 'rna' | 'booster' | 'skin' | 'season_pass';
  /** Знаковое целое: +N grant / −N reversal (РНК); ±E_ms бустер/пропуск; 0 скин. */
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
    e.grant_type === 'rna' ||
    e.grant_type === 'booster' ||
    e.grant_type === 'skin' ||
    e.grant_type === 'season_pass'
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
  seasonPassUntilMs: number;
  skins: string[];
  ledger: WalletLedgerEvent[];
  tipSeq: number;
  /** P3-10: есть ещё строки за страницей (воркер отдаёт максимум 5000). */
  truncated: boolean;
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
            seasonPassUntilMs: num(d.season_pass_until_ms),
            skins,
            ledger,
            tipSeq,
            // Старый воркер (до P3-10) флаг не шлёт — false (ограничение:
            // с таким воркером журнал >5000 строк по-прежнему усекается
            // молча; сначала обновляется воркер, потом клиент — runbook).
            truncated: d.truncated === true,
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
    // P3-10: пагинация усечённого журнала. Воркер отдаёт максимум 5000
    // событий за страницу и ставит truncated:true (LIMIT 5001). Без
    // пагинации свежий синк пользователя с >5000 строк навсегда пропускал
    // бы середину событий, а недавний reversal пропуска — «воскрешал» бы
    // его через max(). Страницы склеиваются в один resp.ledger (снапшот —
    // с последней страницы, самой свежей); курсор двигается только после
    // применения ВСЕХ страниц. Лимит 20 страниц (100k событий) — дальше
    // fail-closed БЕЗ применения: частичный синк хуже отсутствия синка
    // (курсор прыгнул бы мимо середины). Пустая страница при truncated
    // или смена server_id mid-sync — тоже fail (битый воркер).
    if (resp.truncated) {
      const allLedger = [...resp.ledger];
      let pages = 1;
      while (resp.truncated) {
        if (pages >= WALLET_MAX_PAGES) return fail('wallet-truncated');
        const lastSeq = allLedger.reduce((m, ev) => Math.max(m, ev.seq), sinceSeq);
        const next = await doPost(lastSeq);
        if (next.ok === false) return next;
        if (next.wallet.serverId !== resp.serverId) return fail('server-changed');
        if (next.wallet.ledger.length === 0) return fail('wallet-truncated');
        allLedger.push(...next.wallet.ledger);
        resp = { ...next.wallet, ledger: allLedger };
        pages += 1;
      }
    }
    // CR-R3-9: курсор перечитывается из персистентного хранилища
    // НЕПОСРЕДСТВЕННО перед синхронным применением ответа. seqMap выше
    // прочитан ДО сетевых ожиданий: два инстанса провайдера (например,
    // рестарт сцены при resize создаёт новый, пока синк старого ещё
    // в полёте) захватывали один курсор — устаревший ответ мог повторно
    // применить РНК, восстановить отозванный пропуск и откатить курсор
    // (Math.max сравнивал с захваченным, а не с персистентным).
    // Применение ниже — синхронный блок без await (run-to-completion),
    // поэтому перечитанный курсор не устареет до записи. Тернарник
    // assumedServer/sinceSeq больше не нужен: свежий персистентный
    // курсор для (serverId, user) покрывает все три случая (тот же
    // бэкенд, смена бэкенда, зонд с sinceSeq).
    const freshSeqMap = readSeqMap();
    const cursor: number | null =
      freshSeqMap[resp.serverId]?.[userKey]?.last_seq ?? null;

    const applied: WalletSyncApplied = {
      rna: 0,
      skins: [],
      boosterUntilMs: num(loadMeta().boosterUntilMs),
      seasonPassUntilMs: num(loadMeta().seasonPassUntilMs),
      eventsApplied: 0,
      grantChargeIds: [],
    };
    const grantChargeIds = new Set<string>();
    for (const ev of resp.ledger) {
      if (ev.kind === 'grant') grantChargeIds.add(ev.charge_id);
    }
    applied.grantChargeIds = [...grantChargeIds];

    // P1-5: сезонный пропуск — серверно-авторитетный срок. Сервер меняет
    // season_pass_until_ms ТОЛЬКО через события журнала (триггер воркера
    // на вставку в wallet_ledger), поэтому применённый батч — источник
    // истины о направлении изменения: есть reversal пропуска — локальное
    // значение ПРИСВАИВАЕТСЯ серверному (возврат отзывает доступ), иначе
    // max(local, server) — локальная покупка до синка не сгорает.
    // Свежий синк: батч — весь ledger ответа; инкрементальный — события
    // seq > cursor. Устаревший ответ (tip_seq <= курсора — снапшот/реплика
    // старше применённого) серверные сроки не применяет вообще.
    const appliedEvents =
      cursor == null ? resp.ledger : resp.ledger.filter((ev) => ev.seq > cursor);
    const passReversalInBatch = appliedEvents.some(
      (ev) => ev.kind === 'reversal' && ev.grant_type === 'season_pass'
    );
    const staleResponse = cursor != null && resp.tipSeq <= cursor;
    // CR-R3-8: бустер — строгий «старше» (tip < cursor). Повторный синк
    // без новых событий (tip == cursor) — не устаревший: снапшот при
    // этом может вырасти без событий (тест 4: server wins), а
    // воскрешение возможно только при откате tip ниже курсора (журнал
    // append-only: равный tip — та же история, а не старая реплика).
    const staleBoosterResponse = cursor != null && resp.tipSeq < cursor;

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
        // booster: применяется ниже одним пересчётом «сервер + банк»
        // (CR-R3-6/7) — время не сгорает ни при каком порядке событий.
        applied.eventsApplied += 1;
      }
    }

    // CR-R3-6/7/8 + CR-R4-1: бустер — серверный срок покупки + банк
    // заработанного времени (миссионные награды,
    // MetaWallet.boosterEarnedMs/AnchorMs). Замена неттинга P2-N3
    // (local + Σamount батча): неттинг вычитал ИСХОДНУЮ длительность
    // покупки, даже когда она уже истекла, — возврат истёкшей покупки
    // срезал непросроченную миссионную награду, а max(local, server)
    // при новой покупке терял её вовсе (3 + 7 = 7). Серверный снапшот
    // resp.boosterUntilMs авторитетен для купленной компоненты (триггер
    // воркера уже учёл гранты/возвраты батча).
    // CR-R4-1 (review 5944088831): банк — elapsed-aware ОСТАТОК, а не
    // полная длительность. Хвост = [anchor, anchor + bank]; время
    // хвоста, уже прожитое к моменту синка, израсходовано и не
    // добавляется заново: миссия 3д в T + покупка 7д в T+1д = T+10д
    // (2 оставшихся дня миссии + 7 купленных), а не T+11д. Остаток:
    //   anchor > now — хвост ещё не начался (наслоен на будущий
    //   купленный срок), остаток — весь банк;
    //   anchor <= now — хвост уже идёт, остаток = anchor + bank - now.
    // Начало пересчитанного хвоста (base): при остатке > 0 —
    // max(серверный срок, now): живая покупка — хвост за ней, истёкшая
    // или отозванная — хвост идёт от now к своему концу (поздний синк
    // после возврата награду не теряет, в отличие от старого base =
    // серверный срок); остатка нет — серверный срок как есть (возврат
    // в прошлое точен, без пола now). computed = base + remaining.
    // Батч с событиями бустера — строгий пересчёт (возврат отзывает
    // купленное время); без событий бустера — max(local, computed):
    // локальное время из неизвестных синку источников (QA-мок, локальный
    // грант grantPurchase) не стирается. Повторный синк идемпотентен:
    // персистятся ОСТАТОК и его якорь (base) — второй синк складывает
    // тот же остаток, а не банк заново, а дальнейшее течение времени
    // продолжает расходовать остаток от нового якоря. Устаревший ответ
    // (R3-8, tip < курсора) бустер не трогает вообще — как пропуск:
    // старый высокий снапшот не воскрешает отозванный бустер. Повторный
    // синк (tip == курсора) — не устаревший (см. staleBoosterResponse
    // выше). Банк жив, пока жив local booster: при истечении
    // (local <= now) банк обнуляется, иначе мёртвая награда вечно
    // продлевала бы будущие покупки.
    // Якорь 0 при живом банке — легаси-состояние кода раунда 3
    // (addBoosterEarnedMs не якорил хвост при живом бустере): хвост
    // начинается на конце купленного окна — local минус банк.
    const localBooster = num(loadMeta().boosterUntilMs);
    let boosterUntilMs = localBooster;
    if (!staleBoosterResponse) {
      const nowMs = Date.now();
      let bank = getBoosterEarnedMs();
      let anchor = getBoosterEarnedAnchorMs();
      if (localBooster <= nowMs && bank > 0) {
        bank = 0;
        anchor = 0;
        setBoosterEarned(0, 0);
      }
      if (bank > 0 && anchor <= 0) anchor = Math.max(0, localBooster - bank);
      const remaining =
        anchor > nowMs ? bank : Math.max(0, anchor + bank - nowMs);
      const boosterEventsInBatch = appliedEvents.some((ev) => ev.grant_type === 'booster');
      const base =
        remaining > 0 ? Math.max(resp.boosterUntilMs, nowMs) : resp.boosterUntilMs;
      const computed = base + remaining;
      boosterUntilMs = boosterEventsInBatch
        ? computed
        : Math.max(localBooster, computed);
      if (boosterUntilMs !== localBooster) setBoosterUntilMs(boosterUntilMs);
      // Остаток и якорь перебазируются на принятое значение — только
      // если пересчёт принят (иначе max(local) сохранил старое local,
      // и банк не трогаем: следующий синк пересчитает остаток заново
      // от исходного якоря). Исчерпанный остаток (0) обнуляет банк —
      // мёртвая награда больше не продлевает покупки.
      const adopted = boosterEventsInBatch || computed >= localBooster;
      if (adopted) {
        if (remaining > 0) {
          if (bank !== remaining || anchor !== base) setBoosterEarned(remaining, base);
        } else if (bank > 0) {
          setBoosterEarned(0, 0);
        }
      }
    }
    applied.boosterUntilMs = boosterUntilMs;

    // Сезонный пропуск (монетизация v3; P1-5): серверное значение
    // авторитетно. Если в применённом батче есть reversal пропуска —
    // локальное значение ПРИСВАИВАЕТСЯ серверному (иначе возврат не
    // отзывает доступ: max() никогда не уменьшает срок). Без reversal —
    // max(local, server): грант/продление/повторная покупка растут от
    // серверных событий, а локальная покупка до синка не сгорает.
    // События season_pass в журнале не неттятся по charge_id: срок — одна
    // абсолютная дата. Устаревший ответ (tip_seq <= курсора) локальное
    // значение не трогает: старое высокое серверное значение не должно
    // «воскрешать» отозванный пропуск. Сетевая ошибка сюда не доходит
    // (fail до применения) — действующая подписка не сокращается.
    const localPass = num(loadMeta().seasonPassUntilMs);
    let seasonPassUntilMs = localPass;
    if (!staleResponse) {
      seasonPassUntilMs = passReversalInBatch
        ? resp.seasonPassUntilMs
        : Math.max(localPass, resp.seasonPassUntilMs);
      if (seasonPassUntilMs !== localPass) setSeasonPassUntilMs(seasonPassUntilMs);
    }
    applied.seasonPassUntilMs = seasonPassUntilMs;

    // Курсор всегда двигается на tip_seq — сервер авторитетен, что новее
    // ничего нет (даже если событий 0). Назад курсор НЕ двигается:
    // устаревший ответ (tip_seq < курсора) иначе заставил бы следующий
    // синк переприменить уже применённые события (двойное начисление РНК).
    // CR-R3-9: пишем СВЕЖУЮ карту (freshSeqMap), а не захваченную до
    // сети: иначе запись затёрла бы курсоры других пользователей/
    // бэкендов, продвинутые конкурентным синком.
    const users = freshSeqMap[resp.serverId] ?? {};
    users[userKey] = { last_seq: Math.max(cursor ?? 0, resp.tipSeq) };
    freshSeqMap[resp.serverId] = users;
    writeSeqMap(freshSeqMap);

    return { ok: true, applied, tip_seq: resp.tipSeq };
  } catch {
    return fail('network');
  }
}
