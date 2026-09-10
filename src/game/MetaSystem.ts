/**
 * K1: метапрогресс — «осколки ядра».
 *
 * Валюта: осколки (⬢) — начисляются за каждый забег (киллы + уровень +
 * бонус за победу). Тратятся на ПЕРСИСТЕНТНЫЕ усиления (5 треков), которые
 * применяются к началу каждого забега. Цель — retention: есть за что
 * возвращаться между забегами и сезонами.
 *
 * Баланс: первая ступенька стоит ~1 забег, max-трек ~30–40 забегов.
 * Итоговый пул всех треков ≈ 3000+ осколков — на недели ежедневной игры.
 */
import { SaveSystem, type SaveData } from '../systems/SaveSystem';

export type MetaId = 'dmg' | 'hp' | 'speed' | 'magnet' | 'shard';

export interface MetaDef {
  id: MetaId;
  /** Короткое тематическое имя (верхний регистр, как карточки улучшений). */
  name: string;
  /** Точный эффект на уровень — цифры видны игроку. */
  effect: string;
  desc: string;
  max: number;
  baseCost: number;
}

export const META_UPGRADES: MetaDef[] = [
  {
    id: 'dmg',
    name: 'ПУЛЬС',
    effect: '+4% урона',
    desc: 'Импульс и клинки бьют больнее',
    max: 10,
    baseCost: 10,
  },
  {
    id: 'hp',
    name: 'ОБОЛОЧКА',
    effect: '+10% прочности',
    desc: 'Максимум HP на старте забега',
    max: 8,
    baseCost: 12,
  },
  {
    id: 'speed',
    name: 'ДВИЖОК',
    effect: '+2.5% скорости',
    desc: 'Ядро перемещается быстрее',
    max: 8,
    baseCost: 12,
  },
  {
    id: 'magnet',
    name: 'ПОЛЕ',
    effect: '+8% магнита',
    desc: 'Фрагменты притягиваются издалека',
    max: 8,
    baseCost: 10,
  },
  {
    id: 'shard',
    name: 'РЕЗОНАНС',
    effect: '+5% осколков',
    desc: 'Больше осколков за каждый забег',
    max: 10,
    baseCost: 20,
  },
];

/** Стоимость следующей ступеньки (level — текущий, 0-based). Кратно 5. */
export function metaCost(def: MetaDef, level: number): number {
  const raw = def.baseCost * Math.pow(level + 1, 1.35);
  return Math.max(5, Math.round(raw / 5) * 5);
}

export interface MetaEffects {
  damageMul: number;
  hpMul: number;
  speedMul: number;
  magnetMul: number;
  shardMul: number;
}

export function metaLevel(meta: Record<string, number>, id: MetaId): number {
  const def = META_UPGRADES.find((d) => d.id === id);
  if (!def) return 0;
  const lv = typeof meta[id] === 'number' && Number.isFinite(meta[id]) ? meta[id] : 0;
  return Math.max(0, Math.min(def.max, Math.floor(lv)));
}

/** Множители забега из купленных ступенек. */
export function metaEffects(meta: Record<string, number>): MetaEffects {
  return {
    damageMul: 1 + 0.04 * metaLevel(meta, 'dmg'),
    hpMul: 1 + 0.1 * metaLevel(meta, 'hp'),
    speedMul: 1 + 0.025 * metaLevel(meta, 'speed'),
    magnetMul: 1 + 0.08 * metaLevel(meta, 'magnet'),
    shardMul: 1 + 0.05 * metaLevel(meta, 'shard'),
  };
}

/** Сколько осколков даёт забег (киллы + уровень + победа, × РЕЗОНАНС). */
export function earnShards(
  kills: number,
  level: number,
  win: boolean,
  meta: Record<string, number>
): number {
  const base = Math.floor(Math.max(0, kills) / 3) + Math.max(0, level) + (win ? 25 : 0);
  return Math.round(base * metaEffects(meta).shardMul);
}

export interface BuyResult {
  ok: boolean;
  cost: number;
  level: number;
  shards: number;
}

/**
 * K6: мета-достижения — одноразовые бонусы осколков за долгосрочные цели.
 * Проверяются после каждого забега; выданные фиксируются в save.metaAchievements.
 */
export interface MetaAchievement {
  id: string;
  name: string;
  desc: string;
  reward: number;
  check: (s: SaveData) => boolean;
}

export const META_ACHIEVEMENTS: MetaAchievement[] = [
  { id: 'first_win', name: 'СТАБИЛИЗАЦИЯ', desc: 'Первая победа над боссом', reward: 30, check: (s) => s.totalWins >= 1 },
  { id: 'kills_100', name: 'СОТНЯ', desc: '100 убийств суммарно', reward: 20, check: (s) => s.totalKills >= 100 },
  { id: 'kills_500', name: 'КАТЕЧ', desc: '500 убийств суммарно', reward: 30, check: (s) => s.totalKills >= 500 },
  { id: 'kills_2000', name: 'КАЗНЬ', desc: '2000 убийств суммарно', reward: 50, check: (s) => s.totalKills >= 2000 },
  { id: 'runs_10', name: 'ЗАВСЕГДАТАЙ', desc: '10 забегов', reward: 15, check: (s) => s.runs >= 10 },
  { id: 'runs_50', name: 'ВЕТЕРАН', desc: '50 забегов', reward: 25, check: (s) => s.runs >= 50 },
  { id: 'fast_win', name: 'СПИДРАН', desc: 'Победа за 5:30', reward: 25, check: (s) => s.bestWinTimeMs > 0 && s.bestWinTimeMs <= 330_000 },
  { id: 'level_15', name: 'РОСТ', desc: 'Ядро уровня 15', reward: 20, check: (s) => s.bestLevel >= 15 },
  { id: 'combo_20', name: 'КОМБО ×20', desc: 'Серия из 20 убийств', reward: 20, check: (s) => s.bestCombo >= 20 },
  { id: 'evo_3', name: 'АЛХИМИК', desc: '3 эволюции открыто', reward: 30, check: (s) => s.evolutionsSeen.length >= 3 },
  { id: 'shard_1000', name: 'КОЗЫРЬ', desc: '1000 осколков заработано', reward: 40, check: (s) => s.totalShardsEarned >= 1000 },
];

/** После забега: все вновь выполненные достижения → бонус осколков. */
export function grantMetaAchievements(): { id: string; reward: number }[] {
  const save = SaveSystem.get();
  const known = new Set(save.metaAchievements);
  const granted: { id: string; reward: number }[] = [];
  for (const a of META_ACHIEVEMENTS) {
    if (known.has(a.id)) continue;
    let ok = false;
    try {
      ok = a.check(save);
    } catch {
      ok = false;
    }
    if (ok) {
      known.add(a.id);
      granted.push({ id: a.id, reward: a.reward });
    }
  }
  if (granted.length > 0) {
    SaveSystem.addMetaAchievements(granted.map((g) => g.id));
    SaveSystem.addShards(granted.reduce((sum, g) => sum + g.reward, 0));
  }
  return granted;
}

/** Купить ступеньку: проверка баланса → списание → сохранение. */
export function buyMeta(id: MetaId): BuyResult {
  const save = SaveSystem.get();
  const def = META_UPGRADES.find((d) => d.id === id);
  const level = metaLevel(save.meta, id);
  if (!def || level >= def.max) {
    return { ok: false, cost: 0, level, shards: save.shards };
  }
  const cost = metaCost(def, level);
  if (save.shards < cost) return { ok: false, cost, level, shards: save.shards };
  SaveSystem.addShards(-cost);
  SaveSystem.setMetaLevel(id, level + 1);
  return { ok: true, cost, level: level + 1, shards: SaveSystem.get().shards };
}
