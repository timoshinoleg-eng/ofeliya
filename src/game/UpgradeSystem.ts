import type { RunState } from './RunState';

export type UpgradeFamily = 'weapon' | 'core' | 'defense' | 'utility';
export type UpgradeRarity = 'common' | 'rare';
export type EvolutionId = 'prism' | 'halo' | 'singularity';
export type ChoiceKind = 'upgrade' | 'evolution';

export const UPGRADE_FAMILY_LABELS: Record<UpgradeFamily, string> = {
  weapon: 'АТАКА',
  core: 'ЯДРО',
  defense: 'ЗАЩИТА',
  utility: 'СИСТЕМА',
};

export const EVOLUTION_NAMES: Record<EvolutionId, string> = {
  prism: 'ПРИЗМА',
  halo: 'ОРЕОЛ',
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
    shortName: 'УСИЛЕНИЕ ИМПУЛЬСА',
    name: 'Урон +25%',
    desc: 'Пули и клинки бьют больнее',
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
    shortName: 'РАЗГОН ПРОТОКОЛА',
    name: 'Скорострельность +15%',
    desc: 'Протокол атаки срабатывает чаще',
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
    shortName: 'ПАРАЛЛЕЛЬНЫЙ ЗАЛП',
    name: '+1 снаряд',
    desc: 'Дополнительный импульс в каждом залпе',
    max: 3,
    family: 'weapon',
    rarity: 'rare',
    apply: (s) => {
      s.projectiles += 1;
    },
  },
  {
    id: 'pierce',
    shortName: 'СКВОЗНОЙ СИГНАЛ',
    name: 'Пробивание +1',
    desc: 'Импульс проходит ещё через одну угрозу',
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
    shortName: 'УСКОРЕНИЕ ЯДРА',
    name: 'Скорость +8%',
    desc: 'Ядро перемещается быстрее',
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
    shortName: 'БРОНЯ ЯДРА',
    name: 'Прочность +25',
    desc: 'Максимум HP выше и сразу +25 HP',
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
    shortName: 'ПОЛЕ СБОРА',
    name: 'Магнит +35%',
    desc: 'Фрагменты данных притягиваются издалека',
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
    shortName: 'КОЛЬЦО ЗАЩИТЫ',
    name: '+1 орбитальный клинок',
    desc: 'Клинок вращается вокруг ядра и режет угрозы',
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
    shortName: 'ВОЛНА ЯДРА',
    name: 'Нова +1',
    desc: 'Периодический импульс вокруг ядра сильнее и чаще',
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
    shortName: 'САМОРЕМОНТ',
    name: 'Регенерация +0.6/с',
    desc: 'Ядро постепенно восстанавливает прочность',
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
  shortName: 'АВАРИЙНЫЙ РЕМОНТ',
  name: 'Восстановить +40 HP',
  desc: 'Мгновенное восстановление без постоянного усиления',
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
