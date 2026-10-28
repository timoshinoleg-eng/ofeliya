/**
 * MetaAchievements — lifetime-достижения с наградами.
 *
 * Порт Фазы 3 (адаптация под main): в main нет lifetime-достижений — модуль новый.
 * Честное разграничение: в проекте уже есть src/game/AchievementSystem.ts —
 * 9 достижений уровня забега (без наград, тосты в GameScene). Этот модуль
 * его НЕ дублирует, а добавляет meta-слой: lifetime-триггеры + награды
 * (RNA сейчас; {kind:'skin'} — слот под скины Фазы 5, выдача скинов
 * не реализована) + аналитика achievement_unlocked.
 *
 * Отличие от стека (исправление): evo_5 → evo_3. В игре всего 3 критические
 * мутации (prism/halo/singularity — VALID_EVOLUTIONS в SaveSystem), поэтому
 * порог «5 эволюций» был недостижим уже в стеке. Смысл достижения —
 * «открыть все критические мутации», порог 3.
 *
 * Каталог — данные; check — чистые функции (тестируются в Node).
 * Разблокировки персистентны (localStorage).
 */
import { SaveSystem } from '../../systems/SaveSystem';
import { loadMeta } from '../meta/MetaWallet';

export type MetaAchievementId =
  | 'killer_500' | 'killer_1k' | 'killer_10k' | 'killer_100k'
  | 'runs_3' | 'runs_10' | 'runs_50' | 'runs_100'
  | 'evo_3'
  | 'daily_first' | 'streak_3' | 'streak_7' | 'streak_30'
  | 'quests_10' | 'quests_50'
  | 'stars_1' | 'stars_500'
  | 'deaths_100'
  | 'rna_1k' | 'rna_10k'
  | 'combo_50' | 'ghost_120' | 'winner' | 'time_10h';

export type MetaReward = { kind: 'rna'; amount: number } | { kind: 'skin'; skinId: string };

export interface MetaAchievementDef {
  id: MetaAchievementId;
  title: string;
  desc: string;
  reward: MetaReward;
}

/** Снимок статистики для проверки (lifetime + per-run на конец забега). */
export interface LifetimeStats {
  totalKills: number;
  runs: number;
  evolutionsSeen: number;
  questsCompleted: number;
  timeSecTotal: number;
  deaths: number;
  rnaEarned: number;
  starsSpent: number;
  maxStreak: number;
  /** Per-run (на момент проверки): */
  comboBest: number;
  maxNoDamageMs: number;
  won: boolean;
}

interface Def extends MetaAchievementDef {
  check: (s: LifetimeStats) => boolean;
}

const D: Def[] = [
  { id: 'killer_500', title: 'ЧИСТИЛЬЩИК', desc: '500 убийств суммарно', reward: { kind: 'rna', amount: 50 }, check: (s) => s.totalKills >= 500 },
  { id: 'killer_1k', title: 'ТЫСЯЧНИК', desc: '1 000 убийств суммарно', reward: { kind: 'rna', amount: 100 }, check: (s) => s.totalKills >= 1000 },
  { id: 'killer_10k', title: 'ДЕСЯТИТЫСЯЧНИК', desc: '10 000 убийств суммарно', reward: { kind: 'rna', amount: 300 }, check: (s) => s.totalKills >= 10000 },
  { id: 'killer_100k', title: 'ПАНДЕМИЯ', desc: '100 000 убийств суммарно', reward: { kind: 'rna', amount: 1000 }, check: (s) => s.totalKills >= 100000 },
  { id: 'runs_3', title: 'РЕЦИДИВ', desc: 'Завершить 3 забега', reward: { kind: 'rna', amount: 50 }, check: (s) => s.runs >= 3 },
  { id: 'runs_10', title: 'ЗАВСЕГДАТАЙ', desc: 'Завершить 10 забегов', reward: { kind: 'rna', amount: 100 }, check: (s) => s.runs >= 10 },
  { id: 'runs_50', title: 'ХРОНИК', desc: 'Завершить 50 забегов', reward: { kind: 'rna', amount: 250 }, check: (s) => s.runs >= 50 },
  { id: 'runs_100', title: 'ЛЕГЕНДА ШТАММА', desc: 'Завершить 100 забегов', reward: { kind: 'rna', amount: 600 }, check: (s) => s.runs >= 100 },
  { id: 'evo_3', title: 'КОЛЛЕКЦИОНЕР МУТАЦИЙ', desc: 'Открыть все 3 критические мутации', reward: { kind: 'rna', amount: 200 }, check: (s) => s.evolutionsSeen >= 3 },
  { id: 'daily_first', title: 'ВОЗВРАЩЕНИЕ', desc: 'Забрать первую ежедневную награду', reward: { kind: 'rna', amount: 50 }, check: (s) => s.maxStreak >= 1 },
  { id: 'streak_3', title: 'РЕГУЛЯРНОСТЬ', desc: 'Стрик входа 3 дня', reward: { kind: 'rna', amount: 100 }, check: (s) => s.maxStreak >= 3 },
  { id: 'streak_7', title: 'НЕДЕЛЯ ЗАРАЖЕНИЯ', desc: 'Стрик входа 7 дней', reward: { kind: 'rna', amount: 300 }, check: (s) => s.maxStreak >= 7 },
  { id: 'streak_30', title: 'МЕСЯЦ ПАНДЕМИИ', desc: 'Стрик входа 30 дней', reward: { kind: 'rna', amount: 1000 }, check: (s) => s.maxStreak >= 30 },
  { id: 'quests_10', title: 'ИСПОЛНИТЕЛЬ', desc: 'Выполнить 10 квестов', reward: { kind: 'rna', amount: 150 }, check: (s) => s.questsCompleted >= 10 },
  { id: 'quests_50', title: 'МАШИНА ЗАДАНИЙ', desc: 'Выполнить 50 квестов', reward: { kind: 'rna', amount: 400 }, check: (s) => s.questsCompleted >= 50 },
  { id: 'stars_1', title: 'ПЕРВЫЙ ВКЛАД', desc: 'Потратить первую звезду', reward: { kind: 'rna', amount: 50 }, check: (s) => s.starsSpent >= 1 },
  // Связка «достижение → скин» (роадмап): выдача скина — Фаза 5, здесь только грант.
  { id: 'stars_500', title: 'ИНВЕСТОР', desc: 'Потратить 500 звёзд', reward: { kind: 'skin', skinId: 'skin.gilded-prime' }, check: (s) => s.starsSpent >= 500 },
  { id: 'deaths_100', title: 'БЕССМЕРТНЫЙ', desc: 'Погибнуть 100 раз', reward: { kind: 'rna', amount: 200 }, check: (s) => s.deaths >= 100 },
  { id: 'rna_1k', title: 'НАКОПИТЕЛЬ', desc: 'Заработать 1 000 RNA (мета)', reward: { kind: 'rna', amount: 75 }, check: (s) => s.rnaEarned >= 1000 },
  { id: 'rna_10k', title: 'МАГНАТ RNA', desc: 'Заработать 10 000 RNA (мета)', reward: { kind: 'rna', amount: 250 }, check: (s) => s.rnaEarned >= 10000 },
  { id: 'combo_50', title: 'РЕЗНЯ', desc: 'Комбо ×50 за один забег', reward: { kind: 'rna', amount: 200 }, check: (s) => s.comboBest >= 50 },
  { id: 'ghost_120', title: 'ПРИЗРАК', desc: '120 секунд без урона за забег', reward: { kind: 'rna', amount: 250 }, check: (s) => s.maxNoDamageMs >= 120000 },
  { id: 'winner', title: 'ИДЕАЛЬНЫЙ ЦИКЛ', desc: 'Победить в забеге', reward: { kind: 'rna', amount: 500 }, check: (s) => s.won },
  { id: 'time_10h', title: 'ДОЛГОЖИТЕЛЬ', desc: '10 часов суммарного выживания', reward: { kind: 'rna', amount: 300 }, check: (s) => s.timeSecTotal >= 36000 },
];

export const META_ACHIEVEMENTS: MetaAchievementDef[] = D.map(({ check: _c, ...def }) => def);

const BY_ID = new Map<MetaAchievementId, Def>(D.map((d) => [d.id, d]));

export function getMetaAchievementDef(id: MetaAchievementId): MetaAchievementDef {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`Unknown meta achievement: ${id}`);
  return { id: def.id, title: def.title, desc: def.desc, reward: def.reward };
}

const UNLOCKED_KEY = 'ofeliya.meta-ach.v1';
const SKIN_GRANTS_KEY = 'ofeliya.ach-skins.v1';

function loadUnlocked(): Set<string> {
  try {
    if (typeof localStorage === 'undefined') return new Set();
    const raw = localStorage.getItem(UNLOCKED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveUnlocked(ids: Set<string>): void {
  try {
    localStorage?.setItem(UNLOCKED_KEY, JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
}

/** Чистая функция: какие достижения выполнены (без персистентности). */
export function checkMetaAchievements(stats: LifetimeStats): MetaAchievementId[] {
  return D.filter((d) => d.check(stats)).map((d) => d.id);
}

/** Собрать снимок статистики из SaveSystem + MetaWallet + per-run. */
export function collectLifetimeStats(run?: { comboBest: number; maxNoDamageMs: number; won: boolean }): LifetimeStats {
  const save = SaveSystem.get();
  const meta = loadMeta();
  return {
    totalKills: save.totalKills,
    runs: save.runs,
    evolutionsSeen: save.evolutionsSeen.length,
    questsCompleted: meta.questsCompleted,
    timeSecTotal: meta.timeSecTotal,
    deaths: meta.deaths,
    rnaEarned: meta.rnaEarned,
    starsSpent: meta.starsSpent,
    maxStreak: meta.maxStreak,
    comboBest: run?.comboBest ?? 0,
    maxNoDamageMs: run?.maxNoDamageMs ?? 0,
    won: run?.won ?? false,
  };
}

/**
 * Проверить и разблокировать новые. Возвращает только что разблокированные
 * (для тостов/наград/аналитики).
 */
export function unlockMetaAchievements(stats: LifetimeStats): MetaAchievementId[] {
  const unlocked = loadUnlocked();
  const fresh: MetaAchievementId[] = [];
  for (const id of checkMetaAchievements(stats)) {
    if (!unlocked.has(id)) {
      unlocked.add(id);
      fresh.push(id);
    }
  }
  if (fresh.length > 0) saveUnlocked(unlocked);
  return fresh;
}

/** Записать грант скина (слот под Фазу 5; рендер/применение — там). */
export function grantAchievementSkin(skinId: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(SKIN_GRANTS_KEY);
    const list = raw ? (JSON.parse(raw) as string[]) : [];
    if (!list.includes(skinId)) {
      list.push(skinId);
      localStorage.setItem(SKIN_GRANTS_KEY, JSON.stringify(list));
    }
  } catch {
    /* ignore */
  }
}
