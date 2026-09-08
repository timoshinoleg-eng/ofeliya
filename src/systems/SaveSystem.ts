export interface SaveData {
  bestTimeMs: number;
  bestKills: number;
  bestLevel: number;
  runs: number;
  muted: boolean;
}

const KEY = 'ofeliya_save_v1';

const DEFAULTS: SaveData = {
  bestTimeMs: 0,
  bestKills: 0,
  bestLevel: 0,
  runs: 0,
  muted: false,
};

class SaveImpl {
  private data: SaveData = { ...DEFAULTS };

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<SaveData>) };
    } catch {
      /* повреждённое сохранение — начинаем с нуля */
    }
  }

  get(): SaveData {
    return { ...this.data };
  }

  update(patch: Partial<SaveData>): void {
    this.data = { ...this.data, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* приватный режим — просто держим в памяти */
    }
  }

  recordRun(timeMs: number, kills: number, level: number) {
    const res = {
      timeRecord: timeMs > this.data.bestTimeMs,
      killsRecord: kills > this.data.bestKills,
      levelRecord: level > this.data.bestLevel,
    };
    this.update({
      bestTimeMs: Math.max(this.data.bestTimeMs, timeMs),
      bestKills: Math.max(this.data.bestKills, kills),
      bestLevel: Math.max(this.data.bestLevel, level),
      runs: this.data.runs + 1,
    });
    return res;
  }
}

export const SaveSystem = new SaveImpl();
