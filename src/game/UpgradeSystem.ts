import type { RunState } from './RunState';

export interface UpgradeDef {
  id: string;
  name: string;
  desc: string;
  max: number;
  apply: (s: RunState) => void;
}

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'dmg',
    name: 'Урон +25%',
    desc: 'Пули и клинки бьют больнее',
    max: 6,
    apply: (s) => {
      s.damageMul *= 1.25;
    },
  },
  {
    id: 'rate',
    name: 'Скорострельность +15%',
    desc: 'Стреляешь чаще',
    max: 6,
    apply: (s) => {
      s.fireRateMul *= 1.15;
    },
  },
  {
    id: 'multi',
    name: '+1 снаряд',
    desc: 'Дополнительный снаряд в каждом залпе',
    max: 3,
    apply: (s) => {
      s.projectiles += 1;
    },
  },
  {
    id: 'pierce',
    name: 'Пробивание +1',
    desc: 'Пуля пронзает ещё одного врага',
    max: 3,
    apply: (s) => {
      s.pierce += 1;
    },
  },
  {
    id: 'speed',
    name: 'Скорость +8%',
    desc: 'Двигаешься быстрее',
    max: 5,
    apply: (s) => {
      s.speedMul *= 1.08;
    },
  },
  {
    id: 'hp',
    name: 'Прочность +25',
    desc: 'Больше здоровья и мгновенное лечение',
    max: 5,
    apply: (s) => {
      s.maxHp += 25;
      s.hp = Math.min(s.maxHp, s.hp + 25);
    },
  },
  {
    id: 'magnet',
    name: 'Магнит +35%',
    desc: 'Собираешь опыт с большего расстояния',
    max: 4,
    apply: (s) => {
      s.magnetMul *= 1.35;
    },
  },
  {
    id: 'orbit',
    name: 'Орбитальный клинок',
    desc: 'Клинок вращается вокруг тебя и режет врагов',
    max: 4,
    apply: (s) => {
      s.orbitBlades += 1;
    },
  },
  {
    id: 'nova',
    name: 'Нова',
    desc: 'Периодический взрыв вокруг тебя',
    max: 4,
    apply: (s) => {
      s.novaLevel += 1;
    },
  },
  {
    id: 'regen',
    name: 'Регенерация +0.6/с',
    desc: 'Здоровье восстанавливается со временем',
    max: 3,
    apply: (s) => {
      s.regen += 0.6;
    },
  },
];

const HEAL: UpgradeDef = {
  id: 'heal',
  name: 'Ремонт +40 HP',
  desc: 'Мгновенно восстанавливает здоровье',
  max: 99,
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
