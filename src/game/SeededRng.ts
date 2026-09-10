/**
 * Детерминированный RNG для ежедневного испытания: seed = hash(дата),
 * поэтому у всех игроков в один день волны и выборки улучшений идентичны,
 * а результаты сравнимы.
 *
 * ВАЖНО: воспроизводимость зависит от ПОРЯДКА вызовов rng в WaveDirector /
 * UpgradeSystem / EvolutionSystem. Не вставляйте новые rng-вызовы «в середине»
 * существующих без повышения версии сида (hashSeed содержит VERSION).
 */

export interface Rng {
  /** [0, 1) */
  next(): number;
  /** Целое в [0, max) */
  int(max: number): number;
  /** Случайный элемент массива */
  pick<T>(arr: readonly T[]): T;
}

/** Обычный недетерминированный режим. */
export const mathRandom: Rng = {
  next: Math.random,
  int: (max) => Math.floor(Math.random() * max),
  pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
};

/** FNV-1a 32-bit. */
export function hashSeed(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — компактный детерминированный PRNG. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return {
    next(): number {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(max: number): number {
      return Math.floor(this.next() * max);
    },
    pick<T>(arr: readonly T[]): T {
      return arr[this.int(arr.length)];
    },
  };
}

const SEED_VERSION = 'v1';

/** Ключ локальной даты: YYYY-MM-DD. */
export function todayKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** RNG дня — одинаковый у всех, кто играет в этот календарный день. */
export function dailyRng(dateKey: string = todayKey()): Rng {
  return mulberry32(hashSeed(`${SEED_VERSION}:ofeliya-daily:${dateKey}`));
}

/** Следующий календарный день после dateKey (для стриков). */
export function nextDayKey(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return todayKey(d);
}
