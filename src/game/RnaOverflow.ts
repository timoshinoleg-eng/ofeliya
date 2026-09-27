export interface RnaOverflowCandidate {
  active: boolean;
  x: number;
  y: number;
  value: number;
}

/**
 * When the bounded Phaser RNA pool is full, merge into the active fragment
 * nearest to the new drop. The caller then relocates that fragment to the
 * fresh drop position so the newly earned RNA remains spatially collectible.
 */
export function pickRnaOverflowTarget<T extends RnaOverflowCandidate>(
  candidates: readonly T[],
  x: number,
  y: number
): T | null {
  let best: T | null = null;
  let bestDistanceSq = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (!candidate.active || !Number.isFinite(candidate.value) || candidate.value <= 0) continue;
    const dx = candidate.x - x;
    const dy = candidate.y - y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq < bestDistanceSq) {
      best = candidate;
      bestDistanceSq = distanceSq;
    }
  }

  return best;
}

export function mergeRnaOverflowValue(existing: number, incoming: number): number {
  if (!Number.isFinite(existing) || existing <= 0) {
    throw new Error('RNA overflow target must contain a positive finite value');
  }
  if (!Number.isFinite(incoming) || incoming <= 0) {
    throw new Error('RNA overflow reward must be a positive finite value');
  }
  return existing + incoming;
}
