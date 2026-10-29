/**
 * DailyCalendar — ежедневная награда как UI-слой поверх серверного daily.
 *
 * Порт Фазы 3, ПЕРЕПИСАН под решение Mark (2026-10-28): клиентский
 * DailyCalendar стека НЕ переносится. Независимый календарь стека (свои
 * UTC-дни, свой стрик, свой claim) дублировал бы серверный daily main и
 * давал бы награды за «визит», а не за игру.
 *
 * Источник истины — серверный daily main:
 * - сыгранный забег дня: `DailyHistory.recordDailyResult` (пишется в UIScene
 *   в конце забега по серверному тикету; локальные ключи дней = localDateKey
 *   сервера, НЕ UTC);
 * - стрик: `DailyHistory.dailyStreakSummary` — trailing consecutive played
 *   days (локальный календарь), best — с high-water mark.
 *
 * Правила этого модуля:
 * - День = ЛОКАЛЬНЫЙ день (localDayKey из DailyHistory). UTC здесь нет:
 *   серверные тикеты — на локальных днях, UTC-день увёл бы стрик на сутки
 *   в таймзонах с положительным смещением.
 * - claim — только если сегодня сыгран забег дня (playedToday) и награда
 *   ещё не забрана (claimedToday). Без забега claim невозможен: награда —
 *   за игру, а не за визит.
 * - Награда — 7-дневный цикл RNA (таблица стека сохранена): позиция в цикле
 *   = стрик с учётом сегодня. После 7-го дня цикл начинается заново.
 * - Грант — локальный (grantMetaRna, Фаза 4: доход идёт через множитель
 *   лаборатории — метаболизм × престиж; при нулевых уровнях = MetaWallet.addRna):
 *   серверной экономики пока нет (нет /api/daily/claim, нет /api/economy/* —
 *   дизайн ofeliya-server-economy-design.md future-only). Единственная точка
 *   минта награды — claimDaily ниже; claim пишется в ofeliya.daily.v1 ДО
 *   возврата, повторный claim невозможен. Когда появится серверный claim —
 *   этот модуль станет тонким клиентом поверх него, а локальный грант уйдёт.
 * - Офлайн — кэш: стрик и playedToday читаются из локальной DailyHistory,
 *   claim — из локального ofeliya.daily.v1. Без сети ничего не ломается.
 * - maxStreak в MetaWallet синхронизируется из DailyHistory.best при claim
 *   и при конце забега (GameScene.finish) — иначе streak-достижения
 *   не увидят стрик.
 *
 * Чистые функции с инъекцией зависимостей (summary/claims/wallet) — для
 * тестов в Node без localStorage и без DailyHistory.
 */

import { dailyStreakSummary, localDayKey, type DailyStreakSummary } from '../../systems/DailyHistory';
import { grantMetaRna } from '../lab/LabState';
import { recordStreak } from '../meta/MetaWallet';

export interface DailyReward {
  day: number; // 1..7
  rna: number;
}

export const DAILY_REWARDS: DailyReward[] = [
  { day: 1, rna: 50 },
  { day: 2, rna: 75 },
  { day: 3, rna: 100 },
  { day: 4, rna: 150 },
  { day: 5, rna: 200 },
  { day: 6, rna: 300 },
  { day: 7, rna: 500 },
];

export interface DailyCalendarStatus {
  /** Локальный день 'YYYY-MM-DD'. */
  todayKey: string;
  /** Сегодня сыгран забег дня (запись в DailyHistory). */
  playedToday: boolean;
  /** Награда за сегодня уже забрана. */
  claimedToday: boolean;
  /** Можно забрать: playedToday && !claimedToday. */
  canClaim: boolean;
  /**
   * Текущий стрик для показа: trailing played days, заканчивающийся
   * сегодня (если сыграно) или вчера (если сегодня ещё не сыграно).
   */
  streak: number;
  /** Лучший стрик за всё время (из DailyHistory, с high-water mark). */
  bestStreak: number;
  /** Индекс сегодняшней награды в 7-дневном цикле (0-based). */
  cycleIndex: number;
  /** Награда за сегодня (по streak с учётом сегодня). */
  rewardToday: DailyReward;
}

export interface DailyClaimRecord {
  streak: number;
  reward: number;
  claimedAt: number;
}

export type ClaimMap = Record<string, DailyClaimRecord>;

export interface DailyWallet {
  addRna(amount: number): number;
  recordStreak(streak: number): void;
}

export interface DailyCalendarDeps {
  summary?: DailyStreakSummary;
  claims?: ClaimMap;
  wallet?: DailyWallet;
}

const CLAIMS_KEY = 'ofeliya.daily.v1';
const memClaims: { map: ClaimMap | null } = { map: null };

function sanitizeClaims(raw: unknown): ClaimMap {
  if (!raw || typeof raw !== 'object') return {};
  const out: ClaimMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !value || typeof value !== 'object') continue;
    const v = value as Partial<DailyClaimRecord>;
    if (typeof v.streak !== 'number' || typeof v.reward !== 'number') continue;
    out[key] = {
      streak: Math.max(0, Math.floor(v.streak)),
      reward: Math.max(0, Math.floor(v.reward)),
      claimedAt: typeof v.claimedAt === 'number' && Number.isFinite(v.claimedAt) ? v.claimedAt : 0,
    };
  }
  return out;
}

function loadClaims(): ClaimMap {
  try {
    if (typeof localStorage === 'undefined') return { ...(memClaims.map ?? {}) };
    const raw = localStorage.getItem(CLAIMS_KEY);
    return raw ? sanitizeClaims(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

function saveClaims(claims: ClaimMap): void {
  // Прune: храним только последние 30 дней, чтобы запись не росла.
  const keys = Object.keys(claims).sort();
  for (const key of keys.slice(0, Math.max(0, keys.length - 30))) delete claims[key];
  try {
    if (typeof localStorage === 'undefined') {
      memClaims.map = { ...claims };
      return;
    }
    localStorage.setItem(CLAIMS_KEY, JSON.stringify(claims));
  } catch {
    /* ignore — игра не падает из-за хранилища */
  }
}

/** Награда для UI-превью (какой день цикла светится следующим). */
export function rewardForDayIndex(i: number): DailyReward {
  return DAILY_REWARDS[((i % DAILY_REWARDS.length) + DAILY_REWARDS.length) % DAILY_REWARDS.length];
}

/** Чистая функция: статус без записи. */
export function getDailyStatus(now: Date = new Date(), deps: DailyCalendarDeps = {}): DailyCalendarStatus {
  const summary = deps.summary ?? dailyStreakSummary(undefined, now);
  const claims = deps.claims ?? loadClaims();
  const todayKey = localDayKey(now);
  const playedToday = summary.days[0]?.date === todayKey ? summary.days[0].played : false;
  // Стрик, заканчивающийся вчера (для показа и превью, пока сегодня не сыграно).
  let streakBefore = 0;
  for (let i = 1; i < summary.days.length; i++) {
    if (summary.days[i]?.played) streakBefore += 1;
    else break;
  }
  const streak = playedToday ? summary.current : streakBefore;
  const claimedToday = claims[todayKey] !== undefined;
  const canClaim = playedToday && !claimedToday;
  // Стрик, за который даётся награда: с учётом сегодня (сыграно — streak,
  // не сыграно — streak+1 как превью следующего дня).
  const streakForClaim = playedToday ? streak : streak + 1;
  const cycleIndex = (streakForClaim - 1) % DAILY_REWARDS.length;
  return {
    todayKey,
    playedToday,
    claimedToday,
    canClaim,
    streak,
    bestStreak: summary.best,
    cycleIndex,
    rewardToday: DAILY_REWARDS[cycleIndex],
  };
}

export type ClaimResult =
  | { ok: true; streak: number; reward: DailyReward; granted: number }
  | { ok: false; reason: 'not_played' | 'already_claimed' };

/**
 * Забрать награду за сегодня. Единственная точка минта daily-награды.
 * Возвращает {ok:false} если сегодня не сыгран забег дня или награда
 * уже забрана. Грант (addRna + recordStreak) и запись claim — атомарно
 * внутри: повторный вызов после успеха всегда вернёт already_claimed.
 * Патч №12 (E1): возвращается и РЕАЛЬНО начисленное (granted, с бонусами
 * лаборатории/бустера), а не только базовая награда — кнопка и onClaimed
 * показывают granted. С инжектированным wallet granted неизвестен
 * (интерфейс возвращает только баланс) — тогда granted = базовая награда.
 */
export function claimDaily(now: Date = new Date(), deps: DailyCalendarDeps = {}): ClaimResult {
  const summary = deps.summary ?? dailyStreakSummary(undefined, now);
  const claims = deps.claims ?? loadClaims();
  let granted: number | null = null;
  const wallet: DailyWallet = deps.wallet ?? {
    // DailyWallet.addRna возвращает баланс — адаптер к новому
    // GrantMetaRnaResult (пост-ревью, патч №11); granted захватываем
    // замыканием для E1.
    addRna: (amount) => {
      const r = grantMetaRna(amount);
      granted = r.granted;
      return r.balance;
    },
    recordStreak,
  };
  const status = getDailyStatus(now, { summary, claims });
  if (!status.playedToday) return { ok: false, reason: 'not_played' };
  if (status.claimedToday) return { ok: false, reason: 'already_claimed' };
  const reward = status.rewardToday;
  wallet.addRna(reward.rna);
  wallet.recordStreak(status.bestStreak);
  claims[status.todayKey] = { streak: status.streak, reward: reward.rna, claimedAt: now.getTime() };
  saveClaims(claims);
  return { ok: true, streak: status.streak, reward, granted: granted ?? reward.rna };
}
