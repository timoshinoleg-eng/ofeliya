/** Cosmetic Heart envelope; stage and gameplay heartbeat timing remain authoritative elsewhere. */
export function heartBeatEnvelope(phase: number): number {
  if (!Number.isFinite(phase) || phase < 0 || phase > 1) return 0;
  const first = Math.exp(-phase * 14);
  const second = phase >= 0.22 ? 0.52 * Math.exp(-(phase - 0.22) * 18) : 0;
  return Math.max(first, second);
}

/** Milliseconds are deliberately not movement-clamped: equal elapsed time has equal decay. */
export function decayAtmospherePulse(alpha: number, deltaMs: number): number {
  if (!Number.isFinite(alpha) || alpha <= 0) return 0;
  const elapsed = Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0;
  return Math.min(0.075, alpha) * Math.exp(-elapsed / 110);
}

/** Distribute a decorative budget proportionally while retaining every available depth band. */
export function visibleAtmosphereBands(available: readonly number[], budget: number): number[] {
  const counts: number[] = available.map(count => count > 0 ? 1 : 0);
  const total = available.reduce((sum, count) => sum + count, 0);
  const target = Math.min(total, Math.max(counts.reduce((sum, count) => sum + count, 0), budget));
  while (counts.reduce((sum, count) => sum + count, 0) < target) {
    let selected = -1;
    let deficit = -Infinity;
    for (let i = 0; i < available.length; i++) {
      const nextDeficit = available[i] * target / total - counts[i];
      if (counts[i] < available[i] && nextDeficit > deficit) {
        selected = i;
        deficit = nextDeficit;
      }
    }
    if (selected < 0) break;
    counts[selected]++;
  }
  return counts;
}
