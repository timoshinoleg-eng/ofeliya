/**
 * LabBranches — ветки апгрейдов «лаборатории мутаций» (Фаза 4) как данные.
 *
 * Порт Фазы 4 (адаптация под main): БЕЗ break_infinity.js / Decimal.
 * Обоснование: максимальная стоимость уровня — 52,4 млн (метаболизм, ур. 19),
 * полная прокачка всех веток — ~1,1e8, lifetime-доход — порядка 1e6.
 * Всё это — точные целые числа в float64 (безопасно до 9e15); утверждение
 * стека «float теряет целые единицы уже на уровне ~15» неверно для этих
 * величин (2.5^15 ≈ 9e5 — точное целое). Decimal добавлял бы зависимость,
 * миграцию кошелька и риск ради нулевой пользы. Если экономика когда-нибудь
 * вырастет за 1e12 — тогда и вводить Decimal, а не сейчас.
 * Стоимость уровня — целое число RNA (Math.round), кошелёк — number.
 *
 * Модуль Phaser-free: costForLevel / formatRna / maxAffordableLevel —
 * чистые функции, тестируются в Node (tests/lab-economy.mjs).
 */

export type LabEffectKind = 'metaRnaMul' | 'startHpMul' | 'magnetMul';

export interface LabBranch {
  id: string;
  /** Заголовок ветки (UI). */
  title: string;
  /** Описание (UI). */
  description: string;
  /** Максимальный уровень ветки. */
  maxLevel: number;
  /** Базовая стоимость (RNA) — цена уровня 0. */
  costBase: number;
  /** Рост стоимости 1.8–2.5 (стандарт жанра). */
  costGrowth: number;
  /** Бонус за уровень, доля (0.10 = +10%). */
  effectPerLevel: number;
  effectKind: LabEffectKind;
}

export const LAB_BRANCHES: readonly LabBranch[] = [
  {
    id: 'metabolism',
    title: 'Метаболизм РНК',
    description: 'Ферментные каскады выжимают больше РНК из каждой добычи.',
    maxLevel: 20,
    costBase: 100,
    costGrowth: 2.0,
    effectPerLevel: 0.1,
    effectKind: 'metaRnaMul',
  },
  {
    id: 'chitin',
    title: 'Плотность хитина',
    description: 'Утолщённая оболочка: больше стартового здоровья.',
    maxLevel: 15,
    costBase: 150,
    costGrowth: 2.2,
    effectPerLevel: 0.08,
    effectKind: 'startHpMul',
  },
  {
    id: 'chemotaxis',
    title: 'Хемотаксис',
    description: 'Чувствительность к градиентам: шире радиус сбора.',
    maxLevel: 10,
    costBase: 200,
    costGrowth: 2.5,
    effectPerLevel: 0.12,
    effectKind: 'magnetMul',
  },
];

export function getLabBranch(id: string): LabBranch | undefined {
  return LAB_BRANCHES.find((b) => b.id === id);
}

/**
 * Стоимость покупки уровня `level` (0 = первый уровень ветки):
 * costBase * costGrowth^level, округлённая до целого RNA.
 * Все стоимости в пределах maxLevel — безопасные целые (макс. 52,4 млн).
 */
export function costForLevel(branch: LabBranch, level: number): number {
  const lvl = Math.max(0, Math.floor(level));
  return Math.round(branch.costBase * Math.pow(branch.costGrowth, lvl));
}

/**
 * Чистая функция: текст эффекта ветки на уровне `level`
 * («+30% к доходу РНК»). Ноль уровней → «+0% …».
 */
export function effectText(branch: LabBranch, level: number): string {
  const pct = Math.round(branch.effectPerLevel * Math.max(0, Math.floor(level)) * 100);
  switch (branch.effectKind) {
    case 'metaRnaMul':
      return `+${pct}% к доходу РНК`;
    case 'startHpMul':
      return `+${pct}% к стартовому HP`;
    case 'magnetMul':
      return `+${pct}% к радиусу сбора`;
  }
}

/**
 * Бонус престижа: +10% к доходу meta-RNA за каждый престиж.
 *
 * Обоснование формулы: бонус применяется ТОЛЬКО к мета-доходу, боевой баланс
 * (HP/урон/скорость/RNG) не трогается — детерминизм и баланс-тесты ревью
 * не затрагиваются. Линейные +10% дают ощутимый, но не ломающий раннюю игру
 * рост: 5 престижей = +50% к доходу, что компенсирует сброс ~20 уровней
 * метаболизма (+200%) лишь частично — престиж остаётся решением,
 * а не обязаловкой.
 */
export function prestigeBonus(count: number): number {
  const n = Math.max(0, Math.floor(count));
  return 1 + 0.1 * n;
}

const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

function trimZeros(text: string): string {
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

/**
 * Чистая функция: форматирование числа в стиле idle-игр.
 * 999 → "999", 1000 → "1K", 1500 → "1.5K", 1_200_000 → "1.2M", 3e12 → "3T".
 * Невалидные/неположительные → "0" (кошелёк не показывает мусор).
 */
export function formatRna(value: number | string): string {
  let n: number;
  try {
    n = typeof value === 'number' ? value : Number(value);
  } catch {
    return '0';
  }
  if (!Number.isFinite(n) || n <= 0) return '0';
  const exp = Math.floor(Math.log10(n));
  if (exp < 3) return Math.floor(n).toString();
  const tier = Math.min(Math.floor(exp / 3), SUFFIXES.length - 1);
  const scaled = n / Math.pow(10, tier * 3);
  let text: string;
  if (scaled >= 100) text = scaled.toFixed(0);
  else if (scaled >= 10) text = trimZeros(scaled.toFixed(1));
  else text = trimZeros(scaled.toFixed(2));
  return `${text}${SUFFIXES[tier]}`;
}
