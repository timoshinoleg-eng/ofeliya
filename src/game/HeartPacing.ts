export interface HeartSafePocketProfile {
  offset: number;
  radius: number;
  protectedMs: number;
  opportunityMs: number;
}

export const HEART_SAFE_POCKET = {
  normal: {
    offset: 88,
    radius: 78,
    protectedMs: 1_050,
    opportunityMs: 1_150,
  },
  boss: {
    offset: 112,
    radius: 72,
    protectedMs: 900,
    opportunityMs: 1_350,
  },
  legendaryWindowMs: 850,
} as const;

export function heartSafePocketProfile(bossActive: boolean): HeartSafePocketProfile {
  return bossActive ? HEART_SAFE_POCKET.boss : HEART_SAFE_POCKET.normal;
}

/**
 * Minimum straight-line displacement needed from the player's telegraph position to touch the
 * safe pocket. This is intentionally smaller than the pocket center offset because entering the
 * radius is enough to synchronize.
 */
export function heartSafePocketMinTravel(bossActive: boolean): number {
  const profile = heartSafePocketProfile(bossActive);
  return Math.max(0, profile.offset - profile.radius);
}
