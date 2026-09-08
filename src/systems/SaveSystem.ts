import type { EvolutionId } from '../game/UpgradeSystem';

export interface SaveData {
  bestTimeMs: number;
  bestKills: number;
  bestLevel: number;
  runs: number;
  muted: boolean;
  totalKills: number;
  achievements: string[];
  evolutionsSeen: EvolutionId[];
}

const KEY = 'ofeliya_save_v1';

const DEFAULTS: SaveData = {
  bestTimeMs: 0,
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
          this.data = {
            bestTimeMs: this.num(parsed.bestTimeMs),
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
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* приватный режим — просто держим в памяти */
    }
  }

  recordRun(timeMs: number, kills: number, level: number, evolutions: EvolutionId[] = []) {
    const res = {
      timeRecord: timeMs > this.data.bestTimeMs,
      killsRecord: kills > this.data.bestKills,
      levelRecord: level > this.data.bestLevel,
    };
    const seen = new Set<EvolutionId>(this.data.evolutionsSeen);
    for (const id of evolutions) seen.add(id);
    this.update({
      bestTimeMs: Math.max(this.data.bestTimeMs, timeMs),
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
