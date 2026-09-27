export type CombatTelegraphLevel = 'normal' | 'dangerous' | 'critical';

export interface CombatTelegraphPattern {
  level: CombatTelegraphLevel;
  ringCount: number;
  tickCount: number;
  laneChevronCount: number;
  pulseHz: number;
  alphaFloor: number;
  alphaPeak: number;
  scaleMin: number;
  scaleMax: number;
  lineWidth: number;
  underlayWidth: number;
}

export const COMBAT_TELEGRAPH_PATTERNS: Record<CombatTelegraphLevel, CombatTelegraphPattern> = {
  normal: {
    level: 'normal',
    ringCount: 1,
    tickCount: 0,
    laneChevronCount: 1,
    pulseHz: 1.7,
    alphaFloor: 0.46,
    alphaPeak: 0.72,
    scaleMin: 0.98,
    scaleMax: 1.035,
    lineWidth: 2,
    underlayWidth: 6,
  },
  dangerous: {
    level: 'dangerous',
    ringCount: 2,
    tickCount: 4,
    laneChevronCount: 3,
    pulseHz: 2.8,
    alphaFloor: 0.58,
    alphaPeak: 0.9,
    scaleMin: 0.96,
    scaleMax: 1.055,
    lineWidth: 3,
    underlayWidth: 9,
  },
  critical: {
    level: 'critical',
    ringCount: 3,
    tickCount: 8,
    laneChevronCount: 5,
    pulseHz: 4.2,
    alphaFloor: 0.7,
    alphaPeak: 1,
    scaleMin: 0.94,
    scaleMax: 1.075,
    lineWidth: 4,
    underlayWidth: 12,
  },
};

export interface CombatTelegraphMotion {
  alpha: number;
  scale: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Time-based pulse for repeating enemy windups. Threat is encoded by rhythm in addition to color.
 */
export function combatTelegraphPulse(
  level: CombatTelegraphLevel,
  timeMs: number
): CombatTelegraphMotion {
  const pattern = COMBAT_TELEGRAPH_PATTERNS[level];
  const t = Number.isFinite(timeMs) ? Math.max(0, timeMs) : 0;
  const wave = 0.5 + 0.5 * Math.sin((t / 1000) * Math.PI * 2 * pattern.pulseHz);
  return {
    alpha: pattern.alphaFloor + (pattern.alphaPeak - pattern.alphaFloor) * wave,
    scale: pattern.scaleMin + (pattern.scaleMax - pattern.scaleMin) * wave,
  };
}

/**
 * One-shot countdown motion for boss/critical warnings. The shape tightens and becomes more opaque
 * as impact approaches, so timing remains legible without relying on hue.
 */
export function combatTelegraphCountdown(
  level: CombatTelegraphLevel,
  progress01: number
): CombatTelegraphMotion {
  const pattern = COMBAT_TELEGRAPH_PATTERNS[level];
  const progress = clamp01(progress01);
  const eased = progress * progress * (3 - 2 * progress);
  return {
    alpha: pattern.alphaFloor + (pattern.alphaPeak - pattern.alphaFloor) * eased,
    scale: pattern.scaleMax - (pattern.scaleMax - pattern.scaleMin) * eased,
  };
}
