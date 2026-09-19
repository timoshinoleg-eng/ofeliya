import type { EvolutionId } from '../game/UpgradeSystem';

export interface SaveData {
  /** Legacy compatibility alias. New code should use bestSurvivalMs. */
  bestTimeMs: number;
  bestSurvivalMs: number;
  /**
   * Legacy compatibility alias for the original one-stage victory record.
   * New code should use bestBoss1ClearMs.
   */
  bestWinTimeMs: number;
  /** Fastest IMMUNE PRIME clear across legacy and multi-stage builds. */
  bestBoss1ClearMs: number;
  /** Fastest complete Bloodstream -> Heart campaign clear. */
  bestCampaignClearMs: number;
  bestKills: number;
  bestLevel: number;
  runs: number;
  muted: boolean;
  totalKills: number;
  achievements: string[];
  evolutionsSeen: EvolutionId[];
}

export interface RunMilestoneTimes {
  boss1ClearMs?: number;
}

const KEY = 'ofeliya_save_v1';

const DEFAULTS: SaveData = {
  bestTimeMs: 0,
  bestSurvivalMs: 0,
  bestWinTimeMs: 0,
  bestBoss1ClearMs: 0,
  bestCampaignClearMs: 0,
  bestKills: 0,
  bestLevel: 0,
  runs: 0,
  muted: false,
  totalKills: 0,
  achievements: [],
  evolutionsSeen: [],
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
          // Pre-Heart builds used bestWinTimeMs for the only boss/campaign clear. Preserve it
          // specifically as the IMMUNE PRIME record; never reinterpret it as a full campaign time.
          const boss1Clear = this.num(parsed.bestBoss1ClearMs) || this.num(parsed.bestWinTimeMs);
          this.data = {
            bestTimeMs: survival,
            bestSurvivalMs: survival,
            bestWinTimeMs: boss1Clear,
            bestBoss1ClearMs: boss1Clear,
            bestCampaignClearMs: this.num(parsed.bestCampaignClearMs),
            bestKills: this.num(parsed.bestKills),
            bestLevel: this.num(parsed.bestLevel),
            runs: this.num(parsed.runs),
            muted: typeof parsed.muted === 'boolean' ? parsed.muted : false,
            totalKills: this.num(parsed.totalKills),
            achievements: this.stringArray(parsed.achievements),
            evolutionsSeen: this.stringArray(parsed.evolutionsSeen).filter((v): v is EvolutionId =>
              VALID_EVOLUTIONS.has(v as EvolutionId)
            ),
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
    };
  }

  update(patch: Partial<SaveData>): void {
    this.data = {
      ...this.data,
      ...patch,
      achievements: patch.achievements ? [...patch.achievements] : this.data.achievements,
      evolutionsSeen: patch.evolutionsSeen ? [...patch.evolutionsSeen] : this.data.evolutionsSeen,
    };
    // Preserve both legacy aliases for older clients that may read the same localStorage key.
    this.data.bestTimeMs = this.data.bestSurvivalMs;
    if (patch.bestBoss1ClearMs === undefined && patch.bestWinTimeMs !== undefined) {
      this.data.bestBoss1ClearMs = this.num(patch.bestWinTimeMs);
    }
    this.data.bestWinTimeMs = this.data.bestBoss1ClearMs;
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
    evolutions: EvolutionId[] = [],
    milestones: RunMilestoneTimes = {}
  ): { timeRecord: boolean; killsRecord: boolean; levelRecord: boolean } {
    const survivalRecord = !win && timeMs > this.data.bestSurvivalMs;
    const boss1ClearMs = this.num(milestones.boss1ClearMs);
    const boss1Record =
      boss1ClearMs > 0 &&
      (this.data.bestBoss1ClearMs === 0 || boss1ClearMs < this.data.bestBoss1ClearMs);
    const campaignRecord =
      win &&
      timeMs > 0 &&
      (this.data.bestCampaignClearMs === 0 || timeMs < this.data.bestCampaignClearMs);
    const res = {
      timeRecord: survivalRecord || boss1Record || campaignRecord,
      killsRecord: kills > this.data.bestKills,
      levelRecord: level > this.data.bestLevel,
    };
    const seen = new Set<EvolutionId>(this.data.evolutionsSeen);
    for (const id of evolutions) seen.add(id);
    this.update({
      bestSurvivalMs: survivalRecord ? timeMs : this.data.bestSurvivalMs,
      bestBoss1ClearMs: boss1Record ? boss1ClearMs : this.data.bestBoss1ClearMs,
      bestCampaignClearMs: campaignRecord ? timeMs : this.data.bestCampaignClearMs,
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

  private num(v: unknown): number {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
  }

  private stringArray(v: unknown): string[] {
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  }
}

export const SaveSystem = new SaveImpl();
