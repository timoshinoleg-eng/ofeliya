export interface HostCellRecycleCandidate {
  active: boolean;
  infection: number;
  x: number;
  y: number;
  spawnedAt: number;
}

export interface HostCellRecycleContext {
  playerX: number;
  playerY: number;
  now: number;
  recycleDistance: number;
  maxProtectedInfection?: number;
  minOldCellAgeMs?: number;
  minOldCellDistance?: number;
}

/**
 * Pure selector for the bounded six-cell pool.
 * Meaningful infection progress is protected. Among eligible stale cells, the farthest one wins so
 * long straight-line movement naturally leaves recyclable cells behind the player.
 */
export function selectHostCellRecycleIndex(
  cells: readonly HostCellRecycleCandidate[],
  context: HostCellRecycleContext
): number | null {
  const maxProtectedInfection = context.maxProtectedInfection ?? 0.12;
  const minOldCellAgeMs = context.minOldCellAgeMs ?? 35_000;
  const minOldCellDistance = context.minOldCellDistance ?? 320;

  let bestIndex: number | null = null;
  let bestDistance = -1;

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (!cell.active || cell.infection >= maxProtectedInfection) continue;

    const distance = Math.hypot(cell.x - context.playerX, cell.y - context.playerY);
    const age = context.now - cell.spawnedAt;
    const strandedFarBehind = distance >= context.recycleDistance;
    const oldAndNoLongerLocal = age >= minOldCellAgeMs && distance >= minOldCellDistance;
    if (!strandedFarBehind && !oldAndNoLongerLocal) continue;

    if (distance > bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }

  return bestIndex;
}
