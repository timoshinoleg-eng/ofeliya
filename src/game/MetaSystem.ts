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
import { SaveSystem } from '../systems/SaveSystem';

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
