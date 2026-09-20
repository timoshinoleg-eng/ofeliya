export interface PrimeAttackPhasePacing {
  telegraphMs: number;
  recoveryMs: number;
  cooldownMs: number;
  radius: number;
  damageMultiplier: number;
}

export const BOSS_PHASE_TWO_HP_FRACTION = 0.52;

export const PRIME_ATTACK_PACING = {
  initialDelayMs: 1_900,
  phase1: {
    telegraphMs: 720,
    recoveryMs: 650,
    cooldownMs: 2_800,
    radius: 180,
    damageMultiplier: 0.62,
  },
  phase2: {
    telegraphMs: 560,
    recoveryMs: 480,
    cooldownMs: 1_850,
    radius: 225,
    damageMultiplier: 0.78,
  },
} as const;

export function primeAttackPhasePacing(phase: number): PrimeAttackPhasePacing {
  return phase >= 2 ? PRIME_ATTACK_PACING.phase2 : PRIME_ATTACK_PACING.phase1;
}

export function primeAttackCycleMs(phase: number): number {
  const profile = primeAttackPhasePacing(phase);
  return profile.telegraphMs + profile.recoveryMs + profile.cooldownMs;
}
