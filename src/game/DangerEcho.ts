import type { CombatTelegraphLevel } from './CombatTelegraphLanguage';

/**
 * Descriptor of an actionable danger warning that the dense-combat echo layer
 * may re-stroke above the silhouette clearing. The echo never invents new
 * grammar: it reuses the same shape/level/color the enemy already drew at
 * depth 8, so a warning hidden inside the dark pocket stays readable without
 * touching hitboxes, timing or balance.
 */
export interface DangerEcho {
  shape: 'lane' | 'radial';
  /** World position of the warning origin (enemy center). */
  x: number;
  y: number;
  /** Unit direction for lane echoes. */
  dirX: number;
  dirY: number;
  /** Lane distances from the origin. */
  start: number;
  end: number;
  /** Ring radius for radial echoes. */
  radius: number;
  level: CombatTelegraphLevel;
  color: number;
}

/**
 * Pool bound for echo Graphics. Four echoes cover the realistic worst case
 * (a boss ring plus two role warnings plus an anomaly) while keeping the
 * extra per-frame stroke count bounded at density >= 110.
 */
export const DANGER_ECHO_POOL = 4;

/** Extra slack so an echo appears just before the warning truly reaches the pocket. */
const LANE_MARGIN = 10;
const RADIAL_MARGIN = 12;

function pointToSegmentDistance(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq > 0 ? Math.min(1, Math.max(0, ((px - x1) * dx + (py - y1) * dy) / lengthSq)) : 0;
  const cx = x1 + dx * t;
  const cy = y1 + dy * t;
  return Math.hypot(px - cx, py - cy);
}

/**
 * True when an active warning geometrically overlaps the silhouette pocket
 * and therefore risks being muted by the clearing layer (depth 11, alpha up
 * to ~0.72 over warnings at depth 8).
 */
export function echoIntersectsPocket(
  echo: DangerEcho,
  pocketX: number,
  pocketY: number,
  pocketRadius: number
): boolean {
  if (!Number.isFinite(echo.x) || !Number.isFinite(echo.y)) return false;
  if (!Number.isFinite(pocketX) || !Number.isFinite(pocketY) || !Number.isFinite(pocketRadius)) {
    return false;
  }
  if (echo.shape === 'lane') {
    const length = Math.hypot(echo.dirX, echo.dirY);
    if (!Number.isFinite(length) || length < 1e-6) return false;
    const ux = echo.dirX / length;
    const uy = echo.dirY / length;
    const start = Math.max(0, echo.start);
    const end = Math.max(start + 12, echo.end);
    return (
      pointToSegmentDistance(
        pocketX,
        pocketY,
        echo.x + ux * start,
        echo.y + uy * start,
        echo.x + ux * end,
        echo.y + uy * end
      ) <= pocketRadius + LANE_MARGIN
    );
  }
  const radius = echo.radius;
  if (!Number.isFinite(radius) || radius < 8) return false;
  return Math.abs(Math.hypot(echo.x - pocketX, echo.y - pocketY) - radius) <=
    pocketRadius + RADIAL_MARGIN;
}
