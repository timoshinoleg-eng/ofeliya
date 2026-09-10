// Вся стартовая балансировка игры — в этом файле.

export const COLORS = {
  bg: 0x0b0e1a,
  cyan: 0x35e0ff,
  magenta: 0xff4fd8,
  orange: 0xffa645,
  purple: 0x9d5cff,
  gold: 0xffe066,
  red: 0xff3860,
  green: 0x7dff6e,
  white: 0xffffff,
  panel: 0x141a2e,
  panelHover: 0x1b2440,
  stroke: 0x2a3452,
};

export const FONT = "'Chakra Petch', Arial, sans-serif";

/**
 * Встроенные постэффекты Phaser 3.60+ (только WebGL).
 * При просадках на слабых устройствах выключить enabled — канвас-режим
 * автоматически вернётся к старой виньетке-текстуре.
 */
export const POSTFX = {
  enabled: true,
  bloom: { strength: 0.8, blurStrength: 0.9, steps: 4 },
  vignette: { radius: 0.72, strength: 0.6 },
};

/**
 * Параметры «сочности» (game feel). Вынесены отдельно от баланса: крутить их
 * можно без риска сломать матчасть.
 *
 * hitStop — короткий фриз симуляции на важных событиях (смерть элиты/босса,
 * урон игроку). 50–90 мс читаются как «удар», а не как лаг. minGapMs защищает
 * от дробления: частые фризы подряд превращают игру в слайд-шоу.
 */
export const JUICE = {
  hitStopMs: 55,
  hitStopBossMs: 90,
  hitStopMinGapMs: 170,
  /** Пул всплывающих цифр урона: в бою только переиспользуем, без аллокаций. */
  dmgTextPool: 22,
  dmgTextMs: 620,
  /** Минимальный интервал между новыми цифрами (кроме склейки). */
  dmgTextMinGapMs: 50,
  /** Попадания ближе чем N мс и R px склеиваются в одну цифру — читаемее. */
  dmgTextMergeMs: 130,
  dmgTextMergeDist: 34,
  /** Порог «крита»: другая цифра и цвет. */
  critDamage: 30,
  /** Ниже этой доли HP включается пульсирующая красная рамка. */
  lowHpFraction: 0.3,
  shakeHurt: { duration: 190, intensity: 0.009 },
  shakeEliteKill: { duration: 150, intensity: 0.006 },
  /** Трейл игрока: след каждые N мс, живёт trailFadeMs. */
  trailEveryMs: 55,
  trailFadeMs: 260,
  trailPool: 8,
};

/**
 * Комбо-счётчик: серия убийств без пауз. Чисто визуальная мотивация «ещё разок»,
 * на баланс не влияет (в дуэлях пригодится как метрика мастерства).
 */
export const COMBO = {
  /** Сколько держится серия после последнего убийства. */
  windowMs: 2500,
  /** Ниже этого значения счётчик не показываем — не засорять экран. */
  showFrom: 3,
};

export const PLAYER = {
  hp: 100,
  speed: 180,
  iframeMs: 700,
};

/**
 * Уклонение (dodge/рывок): свайп-флик на мобильном, Space/Shift на десктопе.
 * i-frames на всё время рывка + небольшой запас. Кулдаун длиннее рывка —
 * dodge — осознанное действие, а не спам.
 */
export const DODGE = {
  durationMs: 220,
  cooldownMs: 1100,
  speed: 640,
  /** Запас i-frames после конца рывка, мс. */
  iframeExtraMs: 80,
};

export const WEAPON = {
  damage: 10,
  fireIntervalMs: 550,
  bulletSpeed: 480,
  bulletLifetimeMs: 1400,
  range: 380,
  spreadDeg: 9,
};

export const ORBIT = {
  damage: 11,
  radius: 82,
  speedDeg: 260,
  hitCooldownMs: 340,
};

export const NOVA = {
  damage: 15,
  radius: 140,
  intervalMs: 2500,
};

export const GEM = {
  magnetRadius: 90,
  attractSpeed: 460,
};

/** Момент появления босса — победа, если убить его. */
export const RUN = {
  bossTimeMs: 5 * 60 * 1000,
  /**
   * Во сколько раз реже спавнятся обычные враги после появления босса.
   * 0.35 → интервал ×2.9: босс читается как дуэль, а не теряется в толпе.
   */
  bossPhaseSpawnMul: 0.35,
};

export type EnemyKind = 'swarm' | 'runner' | 'brute' | 'boss';

export interface EnemyDef {
  tex: string;
  hp: number;
  speed: number;
  dmg: number;
  xp: number;
  scale: number;
  radius: number;
}

export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  swarm: { tex: 'enemy-swarm', hp: 20, speed: 92, dmg: 8, xp: 1, scale: 1, radius: 11 },
  runner: { tex: 'enemy-runner', hp: 12, speed: 152, dmg: 6, xp: 1, scale: 1, radius: 10 },
  brute: { tex: 'enemy-brute', hp: 85, speed: 56, dmg: 16, xp: 4, scale: 1, radius: 13 },
  boss: { tex: 'boss', hp: 2600, speed: 66, dmg: 26, xp: 0, scale: 1, radius: 25 },
};

export const ELITE = { hpMul: 6, dmgMul: 1.7, xpMul: 8, scale: 1.45 };

/**
 * Босс — фиксированный климакс забега, НЕ масштабируется кривой сложности.
 * difficulty() даёт на 5:00 ×3.1 HP: 2600 → 8060 HP. При ~100–150 DPS игрока
 * это минута боя и нулевой винрейт у недамажных сборок (победа = шеринг).
 * 2600 HP — расчётный бой ~20 с. Менять здесь, а не в ENEMY_DEFS.boss.
 */
export const BOSS_SCALE = { hp: 1, dmg: 1 };

/** Множители сложности, растущие со временем забега. */
export function difficulty(timeMs: number): { hpScale: number; dmgScale: number } {
  const minutes = timeMs / 60000;
  return {
    hpScale: 1 + minutes * 0.42,
    dmgScale: 1 + minutes * 0.12,
  };
}

export function fmtTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
