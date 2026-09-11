export type PerformanceTier = 'full' | 'reduced';

export interface PerformanceProfile {
  tier: PerformanceTier;
  postFx: boolean;
  ambientErythrocytes: number;
  ambientHostCells: number;
  ambientParticles: number;
  vfxScale: number;
}

function readOverride(): PerformanceTier | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const value = localStorage.getItem('ofeliya_performance_tier');
    return value === 'full' || value === 'reduced' ? value : null;
  } catch {
    return null;
  }
}

function detectTier(): PerformanceTier {
  const override = readOverride();
  if (override) return override;
  if (typeof navigator === 'undefined') return 'full';

  const nav = navigator as Navigator & { deviceMemory?: number };
  const memory = nav.deviceMemory;
  const cores = nav.hardwareConcurrency || 4;

  // Conservative automatic fallback for low-memory / low-core phones. Gameplay density is
  // untouched: only post-processing and decorative/VFX counts are reduced.
  if ((typeof memory === 'number' && memory <= 4) || cores <= 4) return 'reduced';
  return 'full';
}

const tier = detectTier();

export const PERFORMANCE: PerformanceProfile =
  tier === 'reduced'
    ? {
        tier,
        postFx: false,
        ambientErythrocytes: 8,
        ambientHostCells: 2,
        ambientParticles: 12,
        vfxScale: 0.58,
      }
    : {
        tier,
        postFx: true,
        ambientErythrocytes: 14,
        ambientHostCells: 4,
        ambientParticles: 24,
        vfxScale: 1,
      };
