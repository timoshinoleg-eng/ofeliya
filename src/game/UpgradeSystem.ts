import type { RunState } from './RunState';

export type UpgradeFamily = 'weapon' | 'core' | 'defense' | 'utility';
export type UpgradeRarity = 'common' | 'rare';
export type EvolutionId = 'prism' | 'halo' | 'singularity';
export type ChoiceKind = 'upgrade' | 'evolution';

export const UPGRADE_FAMILY_LABELS: Record<UpgradeFamily, string> = {
  weapon: 'АГРЕССИЯ',
  core: 'РАСПРОСТРАНЕНИЕ',
  defense: 'ЗАЩИТА',
  utility: 'АДАПТАЦИЯ',
};

export const EVOLUTION_NAMES: Record<EvolutionId, string> = {
  prism: 'ГИПЕРШИП',
  halo: 'СВЕРХКАПСИД',
  singularity: 'ЛИЗИС',
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
    name: 'Урон +25%',
    desc: 'Шиповые белки сильнее разрушают иммунные клетки',
    max: 6,
    family: 'weapon',
    rarity: 'common',
    evolutionHint: 'prism',
    apply: (s) => {
      s.damageMul *= 1.25;
    },
  },
  {
    id: 'rate',
    shortName: 'УСКОРЕННАЯ РЕПЛИКАЦИЯ',
    name: 'Скорострельность +15%',
    desc: 'Штамм выпускает вирусные частицы чаще',
    max: 6,
    family: 'weapon',
    rarity: 'common',
    evolutionHint: 'halo',
    apply: (s) => {
      s.fireRateMul *= 1.15;
    },
  },
  {
    id: 'multi',
    shortName: 'МНОЖЕСТВЕННАЯ РЕПЛИКАЦИЯ',
    name: '+1 снаряд',
    desc: 'Дополнительная вирусная частица в каждом выбросе',
    max: 3,
    family: 'weapon',
    rarity: 'rare',
    apply: (s) => {
      s.projectiles += 1;
    },
  },
  {
    id: 'pierce',
    shortName: 'ПРОНИКНОВЕНИЕ',
    name: 'Пробивание +1',
    desc: 'Вирусная частица проходит ещё через одну иммунную клетку',
    max: 3,
    family: 'weapon',
    rarity: 'rare',
    evolutionHint: 'prism',
    apply: (s) => {
      s.pierce += 1;
    },
  },
  {
    id: 'speed',
    shortName: 'ПОДВИЖНЫЙ ШТАММ',
    name: 'Скорость +8%',
    desc: 'OFELIYA быстрее перемещается в кровотоке',
    max: 5,
    family: 'core',
    rarity: 'common',
    evolutionHint: 'halo',
    apply: (s) => {
      s.speedMul *= 1.08;
    },
  },
  {
    id: 'hp',
    shortName: 'УТОЛЩЁННЫЙ КАПСИД',
    name: 'Прочность +25',
    desc: 'Оболочка крепче, максимум HP выше и сразу +25 HP',
    max: 5,
    family: 'defense',
    rarity: 'common',
    apply: (s) => {
      s.maxHp += 25;
      s.hp = Math.min(s.maxHp, s.hp + 25);
    },
  },
  {
    id: 'magnet',
    shortName: 'РНК-АФФИНИТЕТ',
    name: 'Магнит +35%',
    desc: 'Фрагменты РНК притягиваются к штамму издалека',
    max: 4,
    family: 'utility',
    rarity: 'common',
    evolutionHint: 'singularity',
    apply: (s) => {
      s.magnetMul *= 1.35;
    },
  },
  {
    id: 'orbit',
    shortName: 'КАПСИДНЫЕ СПУТНИКИ',
    name: '+1 орбитальная частица',
    desc: 'Белковые фрагменты вращаются вокруг штамма и режут иммунные клетки',
    max: 4,
    family: 'weapon',
    rarity: 'rare',
    evolutionHint: 'halo',
    apply: (s) => {
      s.orbitBlades += 1;
    },
  },
  {
    id: 'nova',
    shortName: 'ЛИЗИС-ПУЛЬС',
    name: 'Импульс +1',
    desc: 'Периодический мембранный выброс вокруг штамма сильнее и чаще',
    max: 4,
    family: 'weapon',
    rarity: 'rare',
    evolutionHint: 'singularity',
    apply: (s) => {
      s.novaLevel += 1;
    },
  },
  {
    id: 'regen',
    shortName: 'РЕКОМБИНАЦИЯ',
    name: 'Регенерация +0.6/с',
    desc: 'Капсид постепенно восстанавливает целостность',
    max: 3,
    family: 'defense',
    rarity: 'common',
    apply: (s) => {
      s.regen += 0.6;
    },
  },
];

const HEAL: UpgradeDef = {
  id: 'heal',
  shortName: 'АВАРИЙНАЯ РЕКОМБИНАЦИЯ',
  name: 'Восстановить +40 HP',
  desc: 'Мгновенно восстанавливает оболочку без постоянного усиления',
  max: 99,
  family: 'defense',
  rarity: 'common',
  showProgress: false,
  apply: (s) => {
    s.hp = Math.min(s.maxHp, s.hp + 40);
  },
};

/** n случайных доступных улучшений (без повторов). */
export function rollChoices(s: RunState, n = 3): UpgradeDef[] {
  const pool = UPGRADES.filter((u) => s.stackOf(u.id) < u.max);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const picks = pool.slice(0, n);
  while (picks.length < n) picks.push(HEAL);
  return picks;
}
