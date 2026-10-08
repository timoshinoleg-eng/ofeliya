/** Logical art dimensions are independent of the bounded texture backing and renderer. */
export const CORE_ART = {
  'virus-player': { width: 56, height: 56 },
  'immune-antibody': { width: 38, height: 38 },
  'immune-tcell': { width: 44, height: 40 },
  'immune-macrophage': { width: 62, height: 62 },
  'immune-prime': { width: 94, height: 94 },
  'cardiac-titan': { width: 108, height: 108 },
  'host-cell-shadow': { width: 112, height: 112 },
} as const;

export function artSourceFactor(key: string): number {
  if (key === 'bio-cycle-virus-player' || key === 'bio-cycle-immune-antibody' || key === 'bio-hit-virus-player' || key === 'bio-hit-immune-antibody') return 4;
  return Object.prototype.hasOwnProperty.call(CORE_ART, key) ? 4 : 1;
}

export function artScale(key: string, logicalScale: number): number {
  return logicalScale / artSourceFactor(key);
}

export function rawArtKey(key: string): string {
  return `raw-art-${key}`;
}
