/**
 * MetaWallet — мета-валюта RNA и lifetime-счётчики (зародыш экономики Фазы 4).
 *
 * Порт Фазы 3 (адаптация под main): в main нет мета-кошелька — модуль новый.
 * Отличие от стека: убрана todayUtc() (мёртвый код, UTC-день DailyCalendar
 * стека не портируется — daily в main на локальных днях, см. DailyCalendar).
 *
 * Сейчас: простое localStorage-хранилище для наград daily/достижений.
 * Фаза 4 (порт, plain numbers): Decimal НЕ вводится — см. LabBranches.ts
 * (максимумы экономики ~1e8, float64 точен до 9e15). resetRnaBalance —
 * для престижа лаборатории (счётчики при этом не трогаются).
 *
 * Счётчики (для meta-достижений): questsCompleted, timeSecTotal, deaths,
 * rnaEarned, starsSpent, maxStreak. runs/totalKills берутся из SaveSystem.
 * maxStreak синхронизируется из DailyHistory (серверный daily) — см.
 * DailyCalendar.claimDaily и GameScene.finish: кошелёк сам стрик не считает.
 */

export interface MetaState {
  rna: number;
  questsCompleted: number;
  timeSecTotal: number;
  deaths: number;
  rnaEarned: number;
  starsSpent: number;
  maxStreak: number;
  /** Epoch-мс окончания бустера «РНК ×2» (витрина); 0 — бустера нет. */
  boosterUntilMs: number;
  /** Epoch-мс окончания сезонного пропуска (монетизация v3); 0 — пропуска нет. */
  seasonPassUntilMs: number;
  /**
   * CR-R3-6/7: банк заработанного бустера — суммарная длительность (мс)
   * бустера, выданного сезонными миссиями и ещё не истёкшего. Сервер о
   * нём не знает (локальный источник), поэтому синк кошелька складывает
   * его поверх серверного срока покупки, а не теряет. Жив, пока жив
   * local boosterUntilMs; при истечении обнуляется (см.
   * addBoosterEarnedMs и ServerWalletSync). Инвариант: 0 ⟹ якорь 0.
   * CR-R4-1: синк учитывает elapsed — остаток = anchor + bank - now;
   * при перебазировании персистится остаток, а не полная длительность.
   */
  boosterEarnedMs: number;
  /**
   * CR-R3-6/7: якорь банка — абсолютное начало хвоста заработанного
   * времени (epoch ms). Хвост = [anchor, anchor + boosterEarnedMs].
   * Якорь > now — хвост ещё не начался (наслоен на будущий купленный
   * срок) и «сползает» за серверным сроком при возврате; якорь <= now —
   * хвост уже идёт (наслоен на now при истёкшем бустере) и зафиксирован.
   */
  boosterEarnedAnchorMs: number;
}

const STORAGE_KEY = 'ofeliya.meta.v1';
const memFallback: { state: MetaState | null } = { state: null };

const ZERO: MetaState = {
  rna: 0,
  questsCompleted: 0,
  timeSecTotal: 0,
  deaths: 0,
  rnaEarned: 0,
  starsSpent: 0,
  maxStreak: 0,
  boosterUntilMs: 0,
  seasonPassUntilMs: 0,
  boosterEarnedMs: 0,
  boosterEarnedAnchorMs: 0,
};

function sanitize(p: Partial<MetaState>): MetaState {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  // CR-R3-6/7: инвариант банка — при нулевом банке якорь 0 (иначе
  // битое/старое состояние воскресило бы мёртвую награду).
  const earned = n(p.boosterEarnedMs);
  return {
    rna: n(p.rna),
    questsCompleted: n(p.questsCompleted),
    timeSecTotal: n(p.timeSecTotal),
    deaths: n(p.deaths),
    rnaEarned: n(p.rnaEarned),
    starsSpent: n(p.starsSpent),
    maxStreak: n(p.maxStreak),
    boosterUntilMs: n(p.boosterUntilMs),
    seasonPassUntilMs: n(p.seasonPassUntilMs),
    boosterEarnedMs: earned,
    boosterEarnedAnchorMs: earned > 0 ? n(p.boosterEarnedAnchorMs) : 0,
  };
}

export function loadMeta(): MetaState {
  try {
    if (typeof localStorage === 'undefined') return { ...(memFallback.state ?? ZERO) };
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitize(JSON.parse(raw) as Partial<MetaState>) : { ...ZERO };
  } catch {
    return { ...ZERO };
  }
}

function saveMeta(st: MetaState): void {
  try {
    if (typeof localStorage === 'undefined') {
      memFallback.state = { ...st };
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(st));
  } catch {
    /* ignore — игра не падает из-за хранилища */
  }
}

/** Начислить RNA (награды). Возвращает новый баланс. */
export function addRna(amount: number): number {
  const st = loadMeta();
  const n = Math.max(0, Math.floor(amount));
  st.rna += n;
  st.rnaEarned += n;
  saveMeta(st);
  return st.rna;
}

/** Потратить RNA. false если не хватает. */
export function spendRna(amount: number): boolean {
  const st = loadMeta();
  const n = Math.max(0, Math.floor(amount));
  if (st.rna < n) return false;
  st.rna -= n;
  saveMeta(st);
  return true;
}

/**
 * Обнулить баланс RNA (престиж лаборатории, Фаза 4).
 * Lifetime-счётчики (rnaEarned и др.) НЕ трогаются — престиж не стирает
 * достижения и meta-прогресс.
 */
export function resetRnaBalance(): void {
  const st = loadMeta();
  st.rna = 0;
  saveMeta(st);
}

/** Записать завершение забега в lifetime-счётчики. */
export function recordRunEnd(opts: { timeSec: number; won: boolean }): void {
  const st = loadMeta();
  st.timeSecTotal += Math.max(0, Math.floor(opts.timeSec));
  if (!opts.won) st.deaths += 1;
  saveMeta(st);
}

export function recordQuestCompleted(): void {
  const st = loadMeta();
  st.questsCompleted += 1;
  saveMeta(st);
}

/** Потрачено звёзд (для достижения «Инвестор»); вызывается из shop-флоу. */
export function recordStarsSpent(stars: number): void {
  const st = loadMeta();
  st.starsSpent += Math.max(0, Math.floor(stars));
  saveMeta(st);
}

/**
 * Синхронизировать лучший стрик (только вверх). Источник истины — DailyHistory
 * (серверный daily); сюда попадает уже посчитанный best. Вызывается из
 * DailyCalendar.claimDaily и из GameScene.finish.
 */
export function recordStreak(streak: number): void {
  const st = loadMeta();
  if (streak > st.maxStreak) {
    st.maxStreak = streak;
    saveMeta(st);
  }
}

/**
 * Установить абсолютный срок бустера (патч №15, P0-3): серверный синк
 * берёт max(локальный, серверный). Санитизация: неотрицательное целое,
 * иначе no-op. Прямая установка вместо продления — срок уже вычислен
 * сервером (max(текущий, now) + дни). Никогда не бросает.
 */
export function setBoosterUntilMs(ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  const st = loadMeta();
  st.boosterUntilMs = Math.floor(ms);
  saveMeta(st);
}

/** Окончание действия бустера «РНК ×2» (epoch ms; 0 = неактивен). */
export function getBoosterUntilMs(): number {
  try {
    return loadMeta().boosterUntilMs;
  } catch {
    return 0;
  }
}

/** Активен ли бустер «РНК ×2» сейчас (применяется в GameScene.spawnGem). */
export function isBoosterActive(nowMs: number = Date.now()): boolean {
  try {
    return loadMeta().boosterUntilMs > nowMs;
  } catch {
    return false;
  }
}

/** CR-R3-6/7: банк заработанного (миссионного) бустера, мс. */
export function getBoosterEarnedMs(): number {
  try {
    return loadMeta().boosterEarnedMs;
  } catch {
    return 0;
  }
}

/** CR-R3-6/7: якорь банка заработанного бустера (epoch ms; 0 — банка нет). */
export function getBoosterEarnedAnchorMs(): number {
  try {
    return loadMeta().boosterEarnedAnchorMs;
  } catch {
    return 0;
  }
}

/**
 * CR-R3-6/7: записать банк заработанного бустера (синк кошелька).
 * Инвариант: ms = 0 ⟹ anchor = 0. Никогда не бросает.
 */
export function setBoosterEarned(ms: number, anchorMs: number): void {
  const st = loadMeta();
  const bank = Number.isFinite(ms) ? Math.max(0, Math.floor(ms)) : 0;
  st.boosterEarnedMs = bank;
  st.boosterEarnedAnchorMs =
    bank > 0 && Number.isFinite(anchorMs) && anchorMs > 0 ? Math.floor(anchorMs) : 0;
  saveMeta(st);
}

/**
 * CR-R3-6/7: начислить заработанный (миссионный) бустер. Локальный срок
 * растёт как раньше — max(now, local) + ms; одновременно растёт банк,
 * чтобы синк кошелька складывал награду поверх покупок, а не терял её.
 * Если local бустер истёк — старый банк мёртв: обнуляется, новый хвост
 * якорится на now. CR-R4-1: при живом бустере и неякорённом хвосте
 * (anchor 0 — награда, забранная при живом купленном бустере) хвост
 * якорится на конец купленного окна (local минус уже учтённый банк):
 * иначе elapsed-остаток anchor + bank - now посчитался бы от 0 и
 * обнулил бы живую награду. Никогда не бросает.
 */
export function addBoosterEarnedMs(ms: number, nowMs: number = Date.now()): void {
  const add = Math.floor(ms);
  if (!Number.isFinite(add) || add <= 0) return;
  const now = Number.isFinite(nowMs) && nowMs > 0 ? Math.floor(nowMs) : Date.now();
  const st = loadMeta();
  let bank = st.boosterEarnedMs;
  let anchor = st.boosterEarnedAnchorMs;
  if (st.boosterUntilMs <= now) {
    // Бустер истёк — старый банк мёртв, новый хвост начинается сейчас.
    bank = 0;
    anchor = now;
  } else if (anchor <= 0) {
    anchor = Math.max(0, st.boosterUntilMs - bank);
  }
  bank += add;
  st.boosterEarnedMs = bank;
  st.boosterEarnedAnchorMs = anchor;
  st.boosterUntilMs = Math.max(now, st.boosterUntilMs) + add;
  saveMeta(st);
}

/**
 * Установить абсолютный срок сезонного пропуска (монетизация v3) — зеркало
 * бустера. Серверный синк (P1-5): local := server при reversal пропуска
 * в применённом батче, иначе max(локальный, серверный). Санитизация:
 * неотрицательное целое, иначе no-op. Никогда не бросает.
 */
export function setSeasonPassUntilMs(ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  const st = loadMeta();
  st.seasonPassUntilMs = Math.floor(ms);
  saveMeta(st);
}

/** Окончание действия сезонного пропуска (epoch ms; 0 = неактивен). */
export function getSeasonPassUntilMs(): number {
  try {
    return loadMeta().seasonPassUntilMs;
  } catch {
    return 0;
  }
}

/** Активен ли сезонный пропуск сейчас (гейт paid-трека сезонных миссий). */
export function isSeasonPassActive(nowMs: number = Date.now()): boolean {
  try {
    return loadMeta().seasonPassUntilMs > nowMs;
  } catch {
    return false;
  }
}
