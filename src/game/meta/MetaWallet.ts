/**
 * MetaWallet — мета-валюта RNA и lifetime-счётчики (зародыш экономики Фазы 4).
 *
 * Порт Фазы 3 (адаптация под main): в main нет мета-кошелька — модуль новый.
 * Отличие от стека: убрана todayUtc() (мёртвый код, UTC-день DailyCalendar
 * стека не портируется — daily в main на локальных днях, см. DailyCalendar).
 *
 * Сейчас: простое localStorage-хранилище для наград daily/достижений.
 * Фаза 4 (break_infinity.js Decimal) заменит number-арифметику и добавит
 * кривые стоимости — интерфейс addRna/spendRna спроектирован с запасом.
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
};

function sanitize(p: Partial<MetaState>): MetaState {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  return {
    rna: n(p.rna),
    questsCompleted: n(p.questsCompleted),
    timeSecTotal: n(p.timeSecTotal),
    deaths: n(p.deaths),
    rnaEarned: n(p.rnaEarned),
    starsSpent: n(p.starsSpent),
    maxStreak: n(p.maxStreak),
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
