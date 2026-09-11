import { PERFORMANCE } from '../systems/PerformanceProfile';

// Вся стартовая балансировка игры — в этом файле.

export const COLORS = {
  bg: 0x12070d,
  cyan: 0x8fe8ff,
  magenta: 0xff4fb5,
  orange: 0xff9b66,
  purple: 0x9b6dff,
  gold: 0xffd56a,
  red: 0xff3e5f,
  green: 0x7fffa1,
  white: 0xfff4ec,
  panel: 0x1d0d18,
  panelHover: 0x2a1222,
  stroke: 0x583044,
  blood: 0xb92c42,
  plasma: 0x38101d,
  immune: 0xe8faff,
  virus: 0xff4fb5,
};

export const FONT = "'Chakra Petch', Arial, sans-serif";

/** Visual parameters. PerformanceProfile is the single authority for whether postFX are enabled. */
export const POSTFX = {
  enabled: PERFORMANCE.postFx,
  bloom: { strength: 0.8, blurStrength: 0.9, steps: 4 },
  vignette: { radius: 0.72, strength: 0.6 },
};

export const JUICE = {
  hitStopMs: 55,
  hitStopBossMs: 90,
  hitStopMinGapMs: 170,
  dmgTextPool: 22,
  dmgTextMs: 620,
  dmgTextMinGapMs: 50,
  dmgTextMergeMs: 130,
  dmgTextMergeDist: 34,
  critDamage: 30,
  lowHpFraction: 0.3,
  shakeHurt: { duration: 190, intensity: 0.009 },
  shakeEliteKill: { duration: 150, intensity: 0.006 },
  trailEveryMs: 55,
  trailFadeMs: 260,
  trailPool: 8,
};

export const COMBO = { windowMs: 2500, showFrom: 3 };
export const PLAYER = { hp: 100, speed: 180, iframeMs: 700 };
export const WEAPON = {
  damage: 10,
  fireIntervalMs: 550,
  bulletSpeed: 480,
  bulletLifetimeMs: 1400,
  range: 380,
  spreadDeg: 9,
};
export const ORBIT = { damage: 11, radius: 82, speedDeg: 260, hitCooldownMs: 340 };
export const NOVA = { damage: 15, radius: 140, intervalMs: 2500 };
export const GEM = { magnetRadius: 90, attractSpeed: 460 };

/** Момент появления финального иммунного ответа — победа, если уничтожить его. */
export const RUN = { bossTimeMs: 5 * 60 * 1000, bossPhaseSpawnMul: 0.35 };

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
  swarm: { tex: 'immune-antibody', hp: 20, speed: 92, dmg: 8, xp: 1, scale: 1, radius: 11 },
  runner: { tex: 'immune-tcell', hp: 12, speed: 152, dmg: 6, xp: 1, scale: 1, radius: 10 },
  brute: { tex: 'immune-macrophage', hp: 85, speed: 56, dmg: 16, xp: 4, scale: 1, radius: 13 },
  boss: { tex: 'immune-prime', hp: 2600, speed: 66, dmg: 26, xp: 0, scale: 1, radius: 25 },
};

export const ELITE = { hpMul: 6, dmgMul: 1.7, xpMul: 8, scale: 1.45 };
export const BOSS_SCALE = { hp: 1, dmg: 1 };

export function difficulty(timeMs: number): { hpScale: number; dmgScale: number } {
  const minutes = timeMs / 60000;
  return { hpScale: 1 + minutes * 0.42, dmgScale: 1 + minutes * 0.12 };
}

export function fmtTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
