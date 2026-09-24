import type { RunState } from './RunState';
import type { LegendaryId } from './LegendarySystem';

export type UpgradeFamily = 'weapon' | 'core' | 'defense' | 'utility';
export type UpgradeRarity = 'common' | 'rare' | 'legendary';
export type EvolutionId = 'prism' | 'halo' | 'singularity';
export type ChoiceKind = 'upgrade' | 'evolution' | 'legendary';

export const UPGRADE_FAMILY_LABELS: Record<UpgradeFamily, string> = {
  weapon: 'АГРЕССИЯ',
  core: 'РАСПРОСТРАНЕНИЕ',
  defense: 'ЗАЩИТА',
  utility: 'АДАПТАЦИЯ',
};

export const EVOLUTION_NAMES: Record<EvolutionId, string> = {
  prism: 'ГИПЕРШИП',
  halo: 'СВЕРХКАПСИД',
  singularity: 'СИНГУЛЯРНОСТЬ',
};

export interface UpgradeDef {
  id: string;
  /** Точный эффект — цифры остаются видимыми игроку. */
  name: string;
  /** Короткое тематическое имя карточки. */
  shortName: string;
  desc: string;
  max: number;
  family: UpgradeFamily;
  rarity: UpgradeRarity;
  kind?: ChoiceKind;
  evolutionHint?: EvolutionId;
  evolutionId?: EvolutionId;
  legendaryId?: LegendaryId;
  showProgress?: boolean;
  apply: (s: RunState) => void;
}

export interface UpgradeProgress {
  current: number;
  next: number;
  max: number;
  fraction: number;
}

export function getUpgradeProgress(s: RunState, def: UpgradeDef): UpgradeProgress {
  const current = Math.min(s.stackOf(def.id), def.max);
  const next = Math.min(def.max, current + 1);
  return {
    current,
    next,
    max: def.max,
    fraction: def.max > 0 ? current / def.max : 0,
  };
}

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'dmg',
    shortName: 'БЕЛКОВЫЕ ШИПЫ',
    name: 'Снаряды: урон +25%',
    desc: 'Каждое попадание снимает больше прочности у иммунных клеток.',
    max: 6,
    family: 'weapon',
    rarity: 'common',
    evolutionHint: 'prism',
    apply: (s) => {
      s.stage.damageMul *= 1.25;
    },
  },
  {
    id: 'rate',
    shortName: 'БЫСТРАЯ РЕПЛИКАЦИЯ',
    name: 'Стрельба: на 15% чаще',
    desc: 'OFELIYA выпускает вирусные частицы быстрее.',
    max: 6,
    family: 'weapon',
    rarity: 'common',
    evolutionHint: 'halo',
    apply: (s) => {
      s.stage.fireRateMul *= 1.15;
    },
  },
  {
    id: 'multi',
    shortName: 'МНОЖЕСТВЕННЫЙ ЗАЛП',
    name: 'Залп: +1 снаряд',
    desc: 'Каждый выстрел выпускает ещё одну вирусную частицу.',
    max: 3,
    family: 'weapon',
    rarity: 'rare',
    apply: (s) => {
      s.stage.projectiles += 1;
    },
  },
  {
    id: 'pierce',
    shortName: 'ПРОНИКНОВЕНИЕ',
    name: 'Снаряд пробивает +1 цель',
    desc: 'После попадания снаряд летит дальше и может задеть ещё одну цель.',
    max: 3,
    family: 'weapon',
    rarity: 'rare',
    evolutionHint: 'prism',
    apply: (s) => {
      s.stage.pierce += 1;
    },
  },
  {
    id: 'speed',
    shortName: 'ПОДВИЖНЫЙ ШТАММ',
    name: 'Движение: скорость +8%',
    desc: 'OFELIYA быстрее уходит от атак и перемещается между целями.',
    max: 5,
    family: 'core',
    rarity: 'common',
    evolutionHint: 'halo',
    apply: (s) => {
      s.stage.speedMul *= 1.08;
    },
  },
  {
    id: 'hp',
    shortName: 'УТОЛЩЁННЫЙ КАПСИД',
    name: 'Макс. прочность +25 · сразу +25',
    desc: 'Увеличивает запас здоровья и сразу восстанавливает 25 прочности.',
    max: 5,
    family: 'defense',
    rarity: 'common',
    apply: (s) => {
      s.stage.maxHp += 25;
      s.stage.hp = Math.min(s.stage.maxHp, s.stage.hp + 25);
    },
  },
  {
    id: 'magnet',
    shortName: 'РНК-АФФИНИТЕТ',
    name: 'Подбор РНК: радиус +35%',
    desc: 'РНК начинает притягиваться к OFELIYA с большего расстояния.',
    max: 4,
    family: 'utility',
    rarity: 'common',
    evolutionHint: 'singularity',
    apply: (s) => {
      s.stage.magnetMul *= 1.35;
    },
  },
  {
    id: 'orbit',
    shortName: 'КАПСИДНЫЕ СПУТНИКИ',
    name: 'Орбита: +1 режущий спутник',
    desc: 'Спутник вращается вокруг OFELIYA и наносит урон врагам при касании.',
    max: 4,
    family: 'weapon',
    rarity: 'rare',
    evolutionHint: 'halo',
    apply: (s) => {
      s.stage.orbitBlades += 1;
    },
  },
  {
    id: 'nova',
    shortName: 'МЕМБРАННЫЙ ИМПУЛЬС',
    name: 'Круговая волна: уровень +1',
    desc: 'Круговая волна сама срабатывает вокруг OFELIYA. Уровни усиливают её.',
    max: 4,
    family: 'weapon',
    rarity: 'rare',
    evolutionHint: 'singularity',
    apply: (s) => {
      s.stage.novaLevel += 1;
    },
  },
  {
    id: 'infect',
    shortName: 'РЕЦЕПТОРНЫЙ ЗАХВАТ',
    name: 'Заражение: +22% скорость · +8% зона',
    desc: 'Стой рядом с клеткой: она заражается быстрее и с большей дистанции.',
    max: 4,
    family: 'core',
    rarity: 'common',
    apply: (s) => {
      s.stage.infectionSpeedMul *= 1.22;
      s.stage.infectionRadiusMul *= 1.08;
    },
  },
  {
    id: 'lysis',
    shortName: 'ЦИТОЛИЗ',
    name: 'Взрыв клетки: +30% урон · +8% радиус',
    desc: 'Лизис — разрыв заражённой клетки. Взрыв ранит врагов вокруг неё.',
    max: 4,
    family: 'weapon',
    rarity: 'rare',
    apply: (s) => {
      s.stage.lysisDamageMul *= 1.3;
      s.stage.lysisRadiusMul *= 1.08;
    },
  },
  {
    id: 'factory',
    shortName: 'ВИРУСНАЯ ФАБРИКА',
    name: 'Разрыв клетки: +1 РНК · +10% урон',
    desc: 'Лизис клетки даёт больше РНК и сильнее ранит врагов.',
    max: 3,
    family: 'utility',
    rarity: 'rare',
    apply: (s) => {
      s.stage.lysisRnaBonus += 1;
      s.stage.lysisDamageMul *= 1.1;
    },
  },
  {
    id: 'regen',
    shortName: 'РЕКОМБИНАЦИЯ',
    name: 'Регенерация: +0,6 прочности/с',
    desc: 'Постоянно восстанавливает прочность во время забега.',
    max: 3,
    family: 'defense',
    rarity: 'common',
    apply: (s) => {
      s.stage.regen += 0.6;
    },
  },
];

const HEAL: UpgradeDef = {
  id: 'heal',
  shortName: 'АВАРИЙНАЯ РЕКОМБИНАЦИЯ',
  name: 'Сразу восстановить 40 прочности',
  desc: 'Мгновенное лечение без постоянного усиления.',
  max: 99,
  family: 'defense',
  rarity: 'common',
  showProgress: false,
  apply: (s) => {
    s.stage.hp = Math.min(s.stage.maxHp, s.stage.hp + 40);
  },
};

/** n случайных доступных улучшений (без повторов). */
export function rollChoices(s: RunState, n = 3, rng: () => number = Math.random): UpgradeDef[] {
  const pool = UPGRADES.filter((u) => s.stackOf(u.id) < u.max);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const picks = pool.slice(0, n);
  while (picks.length < n) picks.push(HEAL);
  return picks;
}