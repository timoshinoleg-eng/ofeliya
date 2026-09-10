import { nextDayKey } from '../game/SeededRng';
import type { EvolutionId } from '../game/UpgradeSystem';

/** Прогресс ежедневного испытания (стрик + лучший результат дня). */
export interface DailyProgress {
  /** Календарный день (YYYY-MM-DD) последнего сыгранного daily. */
  dateKey: string;
  /** Сколько дней подряд (включая dateKey) игрок играл в daily. */
  streak: number;
  /** Лучший результат дня: победил ли и сколько времени продержался. */
  win: boolean;
  timeMs: number;
  kills: number;
}

/** Запись локального лидерборда. */
export interface LeaderboardEntry {
  dateKey: string;
  daily: boolean;
  win: boolean;
  timeMs: number;
  kills: number;
  level: number;
}

export interface SaveData {
  /** Legacy compatibility alias. New code should use bestSurvivalMs. */
  bestTimeMs: number;
  bestSurvivalMs: number;
  /** Fastest successful boss clear; 0 means no victory yet. */
  bestWinTimeMs: number;
  bestKills: number;
  bestLevel: number;
  runs: number;
  muted: boolean;
  totalKills: number;
  achievements: string[];
  evolutionsSeen: EvolutionId[];
  daily: DailyProgress;
  leaderboard: LeaderboardEntry[];
  /** uid друга, по чьей реф-ссылке пришли (не потрачено бонусом). */
  pendingRef: string | null;
  /** Бонус первого забега по рефу уже выдан. */
  refBonusUsed: boolean;
}

const KEY = 'ofeliya_save_v1';

const DEFAULT_DAILY: DailyProgress = {
  dateKey: '',
  streak: 0,
  win: false,
  timeMs: 0,
  kills: 0,
};

const DEFAULTS: SaveData = {
  bestTimeMs: 0,
  bestSurvivalMs: 0,
  bestWinTimeMs: 0,
  bestKills: 0,
  bestLevel: 0,
  runs: 0,
  muted: false,
  totalKills: 0,
  achievements: [],
  evolutionsSeen: [],
  daily: { ...DEFAULT_DAILY },
  leaderboard: [],
  pendingRef: null,
  refBonusUsed: false,
};

const VALID_EVOLUTIONS = new Set<EvolutionId>(['prism', 'halo', 'singularity']);

class SaveImpl {
  private data: SaveData = { ...DEFAULTS };

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SaveData> | null;
        if (parsed && typeof parsed === 'object') {
          const legacyTime = this.num(parsed.bestTimeMs);
          // Old builds mixed all run times together. Preserve that value as survival history;
          // never guess a historical victory that the old schema could not prove.
          const survival = this.num(parsed.bestSurvivalMs) || legacyTime;
          this.data = {
            bestTimeMs: survival,
            bestSurvivalMs: survival,
            bestWinTimeMs: this.num(parsed.bestWinTimeMs),
            bestKills: this.num(parsed.bestKills),
            bestLevel: this.num(parsed.bestLevel),
            runs: this.num(parsed.runs),
            muted: typeof parsed.muted === 'boolean' ? parsed.muted : false,
            totalKills: this.num(parsed.totalKills),
            achievements: this.stringArray(parsed.achievements),
            evolutionsSeen: this.stringArray(parsed.evolutionsSeen).filter((v): v is EvolutionId =>
              VALID_EVOLUTIONS.has(v as EvolutionId)
            ),
            daily: this.dailyFrom(parsed.daily),
            leaderboard: this.leaderboardFrom(parsed.leaderboard),
            pendingRef: this.optString(parsed.pendingRef),
            refBonusUsed: parsed.refBonusUsed === true,
          };
        }
      }
    } catch {
      /* повреждённое сохранение — начинаем с безопасных defaults */
    }
  }

  get(): SaveData {
    return {
      ...this.data,
      achievements: [...this.data.achievements],
      evolutionsSeen: [...this.data.evolutionsSeen],
      daily: { ...this.data.daily },
      leaderboard: [...this.data.leaderboard],
    };
  }

  /** Запомнить реф-приглашение (первое — приоритет). */
  setPendingRef(from: string): void {
    const uid = from.trim();
    if (!uid || uid.length > 64) return;
    if (!this.data.pendingRef) this.update({ pendingRef: uid });
  }

  /**
   * Заглянуть: есть ли активный (ещё не потраченный) реф-бонус.
   * Не затрагивает состояние — только для применения бонуса в начале забега.
   */
  peekRefBonus(): string | null {
    return this.data.pendingRef && !this.data.refBonusUsed ? this.data.pendingRef : null;
  }

  /**
   * Потратить бонус первого забега по рефу. Возвращает uid приглашавшего,
   * если бонус активен (ещё не потрачен), иначе null.
   */
  takeRefBonus(): string | null {
    const from = this.peekRefBonus();
    if (!from) return null;
    this.update({ refBonusUsed: true });
    return from;
  }

  private optString(v: unknown): string | null {
    return typeof v === 'string' && v.length > 0 && v.length <= 64 ? v : null;
  }

  /**
   * Учёт ежедневного забега. Возвращает строку сообщения для UI
   * (стрик/рекорд дня) и обновлённое состояние.
   *
   * Стрик: если dateKey — следующий календарный день после сохранённого,
   * streak += 1; если пропуск — сброс на 1. Повторный забег в тот же день
   * стрик не меняет, но улучшает результат дня.
   */
  recordDaily(
    dateKey: string,
    result: { win: boolean; timeMs: number; kills: number }
  ): { streak: number; dailyRecord: boolean; newStreak: boolean } {
    const prev = this.data.daily;
    let freshDay = false;
    let newStreak = false;

    if (prev.dateKey !== dateKey) {
      const streak = prev.dateKey && nextDayKey(prev.dateKey) === dateKey ? prev.streak + 1 : 1;
      newStreak = prev.dateKey !== '' && streak > 1;
      this.data = {
        ...this.data,
        daily: { dateKey, streak, win: false, timeMs: 0, kills: 0 },
      };
      freshDay = true;
    }

    const day = this.data.daily;
    const better =
      result.win && !day.win
        ? true
        : result.win && day.win
          ? result.timeMs < day.timeMs
          : !result.win && !day.win
            ? result.timeMs > day.timeMs
            : false;
    if (better) {
      const next: DailyProgress = { ...day, kills: Math.max(day.kills, result.kills) };
      if (result.win) {
        next.win = true;
        next.timeMs = Math.min(day.timeMs || Number.MAX_SAFE_INTEGER, result.timeMs);
      } else {
        next.timeMs = Math.max(day.timeMs, result.timeMs);
      }
      this.data.daily = next;
    }
    return {
      streak: this.data.daily.streak,
      dailyRecord: !freshDay && better,
      newStreak,
    };
  }

  /**
   * Локальный лидерборд: топ-10 по времени выживания (победы выше поражений
   * при равном времени). Возвращает позицию (1-based) забега, если он в топе.
   */
  recordLeaderboard(entry: LeaderboardEntry): number | null {
    const list = [...this.data.leaderboard, entry];
    list.sort((a, b) => {
      if (a.win !== b.win) return a.win ? -1 : 1;
      if (a.timeMs !== b.timeMs) return b.timeMs - a.timeMs;
      return b.kills - a.kills;
    });
    const top = list.slice(0, 10);
    const rank = top.indexOf(entry) + 1;
    this.update({ leaderboard: top });
    return rank > 0 ? rank : null;
  }

  update(patch: Partial<SaveData>): void {
    this.data = {
      ...this.data,
      ...patch,
      achievements: patch.achievements ? [...patch.achievements] : this.data.achievements,
      evolutionsSeen: patch.evolutionsSeen ? [...patch.evolutionsSeen] : this.data.evolutionsSeen,
    };
    // Keep the old field coherent for older clients that may read the same localStorage key.
    this.data.bestTimeMs = this.data.bestSurvivalMs;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* приватный режим — просто держим в памяти */
    }
  }

  recordRun(
    win: boolean,
    timeMs: number,
    kills: number,
    level: number,
    evolutions: EvolutionId[] = []
  ): { timeRecord: boolean; killsRecord: boolean; levelRecord: boolean } {
    const survivalRecord = !win && timeMs > this.data.bestSurvivalMs;
    const victoryRecord =
      win && timeMs > 0 && (this.data.bestWinTimeMs === 0 || timeMs < this.data.bestWinTimeMs);
    const res = {
      timeRecord: survivalRecord || victoryRecord,
      killsRecord: kills > this.data.bestKills,
      levelRecord: level > this.data.bestLevel,
    };
    const seen = new Set<EvolutionId>(this.data.evolutionsSeen);
    for (const id of evolutions) seen.add(id);
    this.update({
      bestSurvivalMs: survivalRecord ? timeMs : this.data.bestSurvivalMs,
      bestWinTimeMs: victoryRecord ? timeMs : this.data.bestWinTimeMs,
      bestKills: Math.max(this.data.bestKills, kills),
      bestLevel: Math.max(this.data.bestLevel, level),
      runs: this.data.runs + 1,
      totalKills: this.data.totalKills + Math.max(0, Math.floor(kills)),
      evolutionsSeen: [...seen],
    });
    return res;
  }

  unlockAchievements<T extends string>(ids: T[]): T[] {
    if (ids.length === 0) return [];
    const known = new Set(this.data.achievements);
    const unlocked: T[] = [];
    for (const id of ids) {
      if (known.has(id)) continue;
      known.add(id);
      unlocked.push(id);
    }
    if (unlocked.length > 0) this.update({ achievements: [...known] });
    return unlocked;
  }

  private dailyFrom(v: unknown): DailyProgress {
    if (!v || typeof v !== 'object') return { ...DEFAULT_DAILY };
    const d = v as Partial<DailyProgress>;
    return {
      dateKey: typeof d.dateKey === 'string' ? d.dateKey : '',
      streak: this.num(d.streak),
      win: d.win === true,
      timeMs: this.num(d.timeMs),
      kills: this.num(d.kills),
    };
  }

  private leaderboardFrom(v: unknown): LeaderboardEntry[] {
    if (!Array.isArray(v)) return [];
    return v
      .filter((e): e is LeaderboardEntry => !!e && typeof e === 'object')
      .map((e) => ({
        dateKey: typeof e.dateKey === 'string' ? e.dateKey : '',
        daily: e.daily === true,
        win: e.win === true,
        timeMs: this.num(e.timeMs),
        kills: this.num(e.kills),
        level: this.num(e.level),
      }))
      .slice(0, 10);
  }

  private num(v: unknown): number {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
  }

  private stringArray(v: unknown): string[] {
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  }
}

export const SaveSystem = new SaveImpl();
