import { UPGRADES, EVOLUTION_NAMES } from '../UpgradeSystem';
import { LEGENDARIES } from '../LegendarySystem';
/**
 * Local, observational achievements and cosmetic ownership.
 * This module never writes to SaveSystem, the wallet, or authoritative run state.
 */

export const COLLECTION_KEY = 'ofeliya.collection.v1';
export const COLLECTION_VERSION = 1;

export interface CollectionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface RunObservation {
  /** Stable identity supplied by the caller for this completed run. */
  id: string;
  kills: number;
  timeMs: number;
  noDamageMs: number;
  level: number;
  combo: number;
  mutations: readonly string[];
  elites: number;
  hostCells: number;
  evolutions: readonly string[];
  legendaryIds: readonly string[];
  won: boolean;
  rnaCollected?: number;
}

type Metric =
  | 'kills' | 'runs' | 'evolutions' | 'visitDays' | 'hostCells' | 'elites'
  | 'survivalMs' | 'combo' | 'noDamageMs' | 'wins' | 'mutations' | 'legendaries'
  | 'visitStreak' | 'losses' | 'rnaCollected';

export interface AchievementDefinition {
  id: string;
  title: string;
  description: string;
  metric: Metric;
  threshold: number;
  /** Cosmetic palette ownership is the only achievement unlock effect. */
  unlockSkinId?: string;
}

export interface SkinDefinition {
  id: string;
  title: string;
  palette: string;
  earnedBy?: string;
}

export interface AchievementProgress {
  id: string;
  title: string;
  description: string;
  progress: number;
  threshold: number;
  unlocked: boolean;
}

export interface CollectionSnapshot {
  achievements: AchievementProgress[];
  /**
   * The kill counter of the milestones system.
   *
   * It is its own window and it is never replaced by the lifetime counter of
   * the codex: the two numbers measure different things.
   */
  killsTotal: number;
  ownedSkinIds: string[];
  selectedSkinId: string;
  /** Informational UTC login-day counters. They do not grant anything. */
  visitDays: number;
  visitStreak: number;
  recentVisitDays: string[];
  readOnly: boolean;
}

export const DEFAULT_SKIN_ID = 'strain-zero';

/**
 * The Muse catalog's 24 IDs are retained for continuity. Original currency,
 * spend and claim criteria are replaced by client observations: quests_* records
 * infected host cells, stars_* elite kills, and rna_* collected combat RNA (no grant).
 * Streaks remain consecutive UTC visits. evo_5 measures five standard mutations,
 * because this campaign has only three critical evolutions.
 */
export const COLLECTION_CATALOG: readonly AchievementDefinition[] = [
  { id: 'killer_500', title: 'ЧИСТИЛЬЩИК', description: '500 противников всего', metric: 'kills', threshold: 500 },
  { id: 'killer_1k', title: 'ТЫСЯЧНИК', description: '1 000 противников всего', metric: 'kills', threshold: 1_000 },
  { id: 'killer_10k', title: 'ДЕСЯТИТЫСЯЧНИК', description: '10 000 противников всего', metric: 'kills', threshold: 10_000 },
  { id: 'killer_100k', title: 'ПАНДЕМИЯ', description: '100 000 противников всего', metric: 'kills', threshold: 100_000 },
  { id: 'runs_3', title: 'РЕЦИДИВ', description: 'Завершить 3 забега', metric: 'runs', threshold: 3 },
  { id: 'runs_10', title: 'ЗАВСЕГДАТАЙ', description: 'Завершить 10 забегов', metric: 'runs', threshold: 10 },
  { id: 'runs_50', title: 'ХРОНИК', description: 'Завершить 50 забегов', metric: 'runs', threshold: 50 },
  { id: 'runs_100', title: 'ЛЕГЕНДА ШТАММА', description: 'Завершить 100 забегов', metric: 'runs', threshold: 100 },
  { id: 'evo_5', title: 'КОЛЛЕКЦИОНЕР МУТАЦИЙ', description: 'Выбрать 5 разных видов мутаций', metric: 'mutations', threshold: 5, unlockSkinId: 'skin.virulent-magenta' },
  { id: 'daily_first', title: 'ВОЗВРАЩЕНИЕ', description: 'Посетить игру в первый день', metric: 'visitDays', threshold: 1 },
  { id: 'streak_3', title: 'РЕГУЛЯРНОСТЬ', description: 'Посетить игру 3 дня подряд', metric: 'visitStreak', threshold: 3 },
  { id: 'streak_7', title: 'НЕДЕЛЯ ЗАРАЖЕНИЯ', description: 'Посетить игру 7 дней подряд', metric: 'visitStreak', threshold: 7 },
  { id: 'streak_30', title: 'МЕСЯЦ ПАНДЕМИИ', description: 'Посетить игру 30 дней подряд', metric: 'visitStreak', threshold: 30 },
  { id: 'quests_10', title: 'КЛЕТОЧНАЯ СЕТЬ', description: 'Инфицировать 10 клеток хозяина', metric: 'hostCells', threshold: 10 },
  { id: 'quests_50', title: 'РАСШИРЕНИЕ СЕТИ', description: 'Инфицировать 50 клеток хозяина', metric: 'hostCells', threshold: 50 },
  { id: 'stars_1', title: 'ПЕРВАЯ ЭЛИТА', description: 'Победить одного элитного противника', metric: 'elites', threshold: 1 },
  { id: 'stars_500', title: 'ОХОТНИК НА ЭЛИТУ', description: 'Победить 25 элитных противников', metric: 'elites', threshold: 25, unlockSkinId: 'skin.gilded-prime' },
  { id: 'deaths_100', title: 'БЕССМЕРТНЫЙ', description: 'Завершить 100 забегов без победы', metric: 'losses', threshold: 100 },
  { id: 'rna_1k', title: 'НАКОПИТЕЛЬ', description: 'Собрать 1 000 РНК за завершённые забеги', metric: 'rnaCollected', threshold: 1_000 },
  { id: 'rna_10k', title: 'СБОРЩИК РНК', description: 'Собрать 10 000 РНК за завершённые забеги', metric: 'rnaCollected', threshold: 10_000 },
  { id: 'combo_50', title: 'РЕЗНЯ', description: 'Достичь комбо ×50 за один забег', metric: 'combo', threshold: 50, unlockSkinId: 'skin.abyssal-teal' },
  { id: 'ghost_120', title: 'ПРИЗРАК', description: 'Выжить 120 секунд без урона за один забег', metric: 'noDamageMs', threshold: 120_000 },
  { id: 'winner', title: 'ИДЕАЛЬНЫЙ ЦИКЛ', description: 'Победить в забеге', metric: 'wins', threshold: 1 },
  { id: 'time_10h', title: 'ДОЛГОЖИТЕЛЬ', description: 'Выжить суммарно 10 часов', metric: 'survivalMs', threshold: 36_000_000 },
];

export const SKIN_CATALOG: readonly SkinDefinition[] = [
  { id: DEFAULT_SKIN_ID, title: 'Штамм «Нулевой»', palette: 'bio' },
  { id: 'skin.virulent-magenta', title: 'Вирулентная магента', palette: 'magenta', earnedBy: 'evo_5' },
  { id: 'skin.abyssal-teal', title: 'Абиссальный бирюзовый', palette: 'teal', earnedBy: 'combo_50' },
  { id: 'skin.gilded-prime', title: 'Золотой прайм', palette: 'gold', earnedBy: 'stars_500' },
];

type CounterState = Record<Metric, number>;
interface StoredState {
  version: number;
  unlockedAchievementIds: string[];
  ownedSkinIds: string[];
  selectedSkinId: string;
  counters: CounterState;
  mutations: string[];
  evolutions: string[];
  legendaries: string[];
  processedRunIds: string[];
  visitDays: number;
  lastVisitDay: string;
  visitStreak: number;
  recentVisitDays: string[];
}

const METRICS: readonly Metric[] = [
  'kills', 'runs', 'evolutions', 'visitDays', 'hostCells', 'elites',
  'survivalMs', 'combo', 'noDamageMs', 'wins', 'mutations', 'legendaries',
  'visitStreak', 'losses', 'rnaCollected',
];
const ACHIEVEMENT_IDS = new Set(COLLECTION_CATALOG.map((item) => item.id));
const SKIN_BY_ID = new Map(SKIN_CATALOG.map((skin) => [skin.id, skin]));
const DEFINITION_BY_ID = new Map(COLLECTION_CATALOG.map((item) => [item.id, item]));
const MAX_COUNT = Number.MAX_SAFE_INTEGER;
const MUTATION_IDS = new Set(UPGRADES.filter(u=>u.id!=='heal').map(u=>u.id));
const EVOLUTION_IDS = new Set(Object.keys(EVOLUTION_NAMES));
const LEGENDARY_IDS = new Set(LEGENDARIES.map(l=>l.id));

/**
 * How many observed run ids are remembered for idempotency.
 *
 * Every finished run appends its id so a repeated observation cannot be counted twice.
 * Without a bound the ledger grows by one entry per run for the lifetime of the profile
 * and the stored record eventually reaches the storage quota, after which the collection
 * silently stops persisting and the player loses their observed progress.
 *
 * The bound keeps the record small. It does not tolerate an arbitrarily late duplicate:
 * a run is observed when it finishes, and the game refuses to finish the same run twice.
 */
const MAX_OBSERVED_RUN_IDS = 1024;

function emptyCounters(): CounterState {
  return Object.fromEntries(METRICS.map((metric) => [metric, 0])) as CounterState;
}

function emptyState(): StoredState {
  return {
    version: COLLECTION_VERSION,
    unlockedAchievementIds: [],
    ownedSkinIds: [DEFAULT_SKIN_ID],
    selectedSkinId: DEFAULT_SKIN_ID,
    counters: emptyCounters(),
    mutations: [],
    evolutions: [],
    legendaries: [],
    processedRunIds: [],
    visitDays: 0,
    lastVisitDay: '',
    visitStreak: 0,
    recentVisitDays: [],
  };
}

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.min(MAX_COUNT, Math.floor(value));
}
function validDay(value:unknown):value is string {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const date=new Date(value+'T00:00:00Z');
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}

function validIds(value: unknown, known: Set<string>): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && known.has(id)))];
}

function validObservedIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string =>
    typeof id === 'string' && /^[a-z0-9_.:-]{1,128}$/i.test(id),
  ))];
}

function parseState(raw: string | null): { state: StoredState; futureVersion: boolean } {
  if (raw === null) return { state: emptyState(), futureVersion: false };
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { state: emptyState(), futureVersion: false };
    const record = data as Record<string, unknown>;
    if (typeof record.version === 'number' && record.version > COLLECTION_VERSION) {
      return { state: emptyState(), futureVersion: true };
    }
    if (record.version !== COLLECTION_VERSION) return { state: emptyState(), futureVersion: false };

    const state = emptyState();
    state.unlockedAchievementIds = validIds(record.unlockedAchievementIds, ACHIEVEMENT_IDS);
    state.ownedSkinIds = validIds(record.ownedSkinIds, new Set(SKIN_BY_ID.keys()));
    if (!state.ownedSkinIds.includes(DEFAULT_SKIN_ID)) state.ownedSkinIds.unshift(DEFAULT_SKIN_ID);
    state.selectedSkinId = typeof record.selectedSkinId === 'string' &&
      state.ownedSkinIds.includes(record.selectedSkinId) ? record.selectedSkinId : DEFAULT_SKIN_ID;
    if (record.counters && typeof record.counters === 'object' && !Array.isArray(record.counters)) {
      const counters = record.counters as Record<string, unknown>;
      for (const metric of METRICS) state.counters[metric] = count(counters[metric]);
    }
    state.mutations = validIds(record.mutations,MUTATION_IDS);
    state.evolutions = validIds(record.evolutions,EVOLUTION_IDS);
    state.legendaries = validIds(record.legendaries,LEGENDARY_IDS);
    state.processedRunIds = validObservedIds(record.processedRunIds).slice(-MAX_OBSERVED_RUN_IDS);
    state.visitDays = count(record.visitDays);
    state.lastVisitDay = validDay(record.lastVisitDay) ? record.lastVisitDay : '';
    state.recentVisitDays=Array.isArray(record.recentVisitDays)
      ? [...new Set(record.recentVisitDays.filter(validDay))].sort().slice(-31)
      : state.lastVisitDay ? [state.lastVisitDay] : [];
    state.visitStreak = count(record.visitStreak);
    return { state, futureVersion: false };
  } catch {
    return { state: emptyState(), futureVersion: false };
  }
}

function safeBrowserStorage(): CollectionStorage | undefined {
  try {
    if (typeof globalThis.localStorage !== 'undefined') return globalThis.localStorage;
  } catch { /* restricted WebViews may throw while reading localStorage */ }
  return undefined;
}

function validRunId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9_.:-]{1,128}$/i.test(value);
}

function increment(current: number, amount: number): number {
  return Math.min(MAX_COUNT, current + amount);
}

export class ClientCollection {
  private readonly storage?: CollectionStorage;
  private readonly clock: () => number;
  private state: StoredState;
  private readonly readOnly: boolean;

  constructor(storage?: CollectionStorage, clock: () => number = Date.now) {
    this.storage = storage ?? safeBrowserStorage();
    this.clock = clock;
    let loaded: { state: StoredState; futureVersion: boolean };
    try {
      loaded = parseState(this.storage?.getItem(COLLECTION_KEY) ?? null);
    } catch {
      loaded = { state: emptyState(), futureVersion: false };
    }
    this.state = loaded.state;
    this.readOnly = loaded.futureVersion;
    this.applyAchievementSkins();
  }

  /** Record a completed run once. Returns achievement IDs unlocked by this call. */
  observeRun(input: RunObservation): string[] {
    if (this.readOnly || !input || !validRunId(input.id) || this.state.processedRunIds.includes(input.id)) return [];
    this.state.processedRunIds.push(input.id);
    const overflow = this.state.processedRunIds.length - MAX_OBSERVED_RUN_IDS;
    if (overflow > 0) this.state.processedRunIds.splice(0, overflow);
    this.state.counters.kills = increment(this.state.counters.kills, count(input.kills));
    this.state.counters.runs = increment(this.state.counters.runs, 1);
    this.state.counters.survivalMs = increment(this.state.counters.survivalMs, count(input.timeMs));
    this.state.counters.hostCells = increment(this.state.counters.hostCells, count(input.hostCells));
    this.state.counters.elites = increment(this.state.counters.elites, count(input.elites));
    this.state.counters.combo = Math.max(this.state.counters.combo, count(input.combo));
    this.state.counters.noDamageMs = Math.max(this.state.counters.noDamageMs, count(input.noDamageMs));
    this.state.counters.wins = increment(this.state.counters.wins, input.won === true ? 1 : 0);
    this.state.counters.losses = increment(this.state.counters.losses, input.won === false ? 1 : 0);
    this.state.counters.rnaCollected = increment(this.state.counters.rnaCollected, count(input.rnaCollected));
    this.mergeSet('mutations', validIds(input.mutations,MUTATION_IDS));
    this.mergeSet('evolutions', validIds(input.evolutions,EVOLUTION_IDS));
    this.mergeSet('legendaries', validIds(input.legendaryIds,LEGENDARY_IDS));
    this.state.counters.mutations = this.state.mutations.length;
    this.state.counters.evolutions = this.state.evolutions.length;
    this.state.counters.legendaries = this.state.legendaries.length;
    const newlyUnlocked = this.evaluateAchievements();
    this.persist();
    return newlyUnlocked;
  }

  /** Count one local UTC visit day. The streak is descriptive only. */
  visit(): void {
    if (this.readOnly) return;
    const now = this.clock();
    if (!Number.isFinite(now) || now < 0) return;
    const date = new Date(now);
    if (!Number.isFinite(date.getTime())) return;
    const day = date.toISOString().slice(0, 10);
    if (day <= this.state.lastVisitDay) return;
    const previous = this.state.lastVisitDay ? Date.parse(`${this.state.lastVisitDay}T00:00:00Z`) : NaN;
    const today = Date.parse(`${day}T00:00:00Z`);
    this.state.visitStreak = today - previous === 86_400_000 ? this.state.visitStreak + 1 : 1;
    this.state.lastVisitDay = day;
    this.state.recentVisitDays=[...this.state.recentVisitDays,day].slice(-31);
    this.state.visitDays = increment(this.state.visitDays, 1);
    this.state.counters.visitDays = this.state.visitDays;
    this.state.counters.visitStreak = Math.max(this.state.counters.visitStreak, this.state.visitStreak);
    this.evaluateAchievements();
    this.persist();
  }

  /** Select an owned catalog skin. Unknown and locked IDs are rejected. */
  selectSkin(id: string): boolean {
    if (this.readOnly || !SKIN_BY_ID.has(id) || !this.state.ownedSkinIds.includes(id)) return false;
    this.state.selectedSkinId = id;
    this.persist();
    return true;
  }

  snapshot(): CollectionSnapshot {
    const unlocked = new Set(this.state.unlockedAchievementIds);
    return {
      achievements: COLLECTION_CATALOG.map((definition) => ({
        id: definition.id,
        title: definition.title,
        description: definition.description,
        progress: Math.min(definition.threshold, this.state.counters[definition.metric]),
        threshold: definition.threshold,
        unlocked: unlocked.has(definition.id),
      })),
      killsTotal: Math.max(0, Math.floor(this.state.counters.kills ?? 0)),
      ownedSkinIds: [...this.state.ownedSkinIds],
      selectedSkinId: this.state.selectedSkinId,
      visitDays: this.state.visitDays,
      visitStreak: this.state.visitStreak,
      recentVisitDays: [...this.state.recentVisitDays],
      readOnly: this.readOnly,
    };
  }

  private mergeSet(key: 'mutations' | 'evolutions' | 'legendaries', incoming: string[]): void {
    this.state[key] = [...new Set([...this.state[key], ...incoming])];
  }

  private evaluateAchievements(): string[] {
    const unlocked = new Set(this.state.unlockedAchievementIds);
    const fresh: string[] = [];
    for (const definition of COLLECTION_CATALOG) {
      if (unlocked.has(definition.id) || this.state.counters[definition.metric] < definition.threshold) continue;
      unlocked.add(definition.id);
      fresh.push(definition.id);
    }
    this.state.unlockedAchievementIds = [...unlocked];
    this.applyAchievementSkins();
    return fresh;
  }

  private applyAchievementSkins(): void {
    const unlocked = new Set(this.state.unlockedAchievementIds);
    for (const definition of COLLECTION_CATALOG) {
      if (definition.unlockSkinId && unlocked.has(definition.id) && !this.state.ownedSkinIds.includes(definition.unlockSkinId)) {
        this.state.ownedSkinIds.push(definition.unlockSkinId);
      }
    }
    if (!this.state.ownedSkinIds.includes(this.state.selectedSkinId)) this.state.selectedSkinId = DEFAULT_SKIN_ID;
  }

  private persist(): void {
    if (this.readOnly || !this.storage) return;
    try {
      this.storage.setItem(COLLECTION_KEY, JSON.stringify(this.state));
    } catch { /* local collection is optional when storage is unavailable/full */ }
  }
}
