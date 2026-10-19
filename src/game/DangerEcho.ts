import {
  COMBAT_TELEGRAPH_PATTERNS, COMBAT_TELEGRAPH_TICK_INNER,
  combatTelegraphRingRatio, combatTelegraphTickOuter,
  type CombatTelegraphLevel,
} from './CombatTelegraphLanguage';

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
  /**
   * Live motion sampled from the original telegraph animation (countdown
   * scale/alpha) so the echo cannot drift from the warning it mirrors. Both
   * default to 1 when absent.
   */
  scale?: number;
  alpha?: number;
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
  const scale = echo.scale ?? 1;
  // Invalid/collapsed transforms are inert. Production animations use positive scale.
  if (!Number.isFinite(scale) || scale <= 0 || pocketRadius < 0) return false;
  if (!Number.isFinite(echo.x) || !Number.isFinite(echo.y) ||
      !Number.isFinite(pocketX) || !Number.isFinite(pocketY) || !Number.isFinite(pocketRadius)) return false;
  const pattern = COMBAT_TELEGRAPH_PATTERNS[echo.level];
  // Work in Graphics-local coordinates, retaining the existing world-space slack.
  const px = (pocketX - echo.x) / scale;
  const py = (pocketY - echo.y) / scale;
  const pocket = pocketRadius / scale;
  if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pocket)) return false;
  if (echo.shape === 'lane') {
    if (!Number.isFinite(echo.start) || !Number.isFinite(echo.end)) return false;
    const length = Math.hypot(echo.dirX, echo.dirY);
    if (!Number.isFinite(length) || length < 1e-6) return false;
    const ux = echo.dirX / length;
    const uy = echo.dirY / length;
    const x = px * ux + py * uy;
    const y = -px * uy + py * ux;
    const start = Math.max(0, echo.start);
    const end = Math.max(start + 12, echo.end);
    if (!Number.isFinite(end * scale)) return false;
    const slack = LANE_MARGIN / scale;
    if (pointToSegmentDistance(x, y, start, 0, end, 0) <=
      pocket + Math.max(slack, (pattern.underlayWidth + 5) / 2)) return true;
    const halfWidth = echo.level === 'critical' ? 7 : 5.5;
    for (let i = 0; i < pattern.laneChevronCount; i++) {
      const center = start + (end - start) * (i + 1) / (pattern.laneChevronCount + 1);
      const reach = pocket + Math.max(slack, 0.9);
      if (pointToSegmentDistance(x, y, center - 7, halfWidth, center + 7, 0) <= reach ||
          pointToSegmentDistance(x, y, center - 7, -halfWidth, center + 7, 0) <= reach) return true;
    }
    return Math.hypot(x - end, y) <= pocket + Math.max(slack, echo.level === 'critical' ? 5 : 4);
  }
  if (!Number.isFinite(echo.radius)) return false;
  const radius = Math.max(8, echo.radius);
  if (!Number.isFinite((radius + combatTelegraphTickOuter(echo.level)) * scale)) return false;
  const distance = Math.hypot(px, py);
  const slack = RADIAL_MARGIN / scale;
  for (let ring = 0; ring < pattern.ringCount; ring++) {
    const halfStroke = ring === 0 ? pattern.underlayWidth / 2 :
      Math.max(1.2, pattern.lineWidth - ring * 0.8) / 2;
    if (Math.abs(distance - radius * combatTelegraphRingRatio(echo.level, ring)) <=
        pocket + Math.max(slack, halfStroke)) return true;
  }
  // Test actual ticks, not a filled annulus: gaps between ticks stay empty.
  const tickInner = radius + COMBAT_TELEGRAPH_TICK_INNER;
  const tickOuter = radius + combatTelegraphTickOuter(echo.level);
  const reach = pocket + Math.max(slack, echo.level === 'critical' ? 1.3 : 1);
  if (distance > tickOuter + reach || distance < tickInner - reach) return false;
  for (let i = 0; i < pattern.tickCount; i++) {
    const angle = i / pattern.tickCount * Math.PI * 2;
    const x = Math.cos(angle);
    const y = Math.sin(angle);
    if (pointToSegmentDistance(px, py, x * tickInner, y * tickInner, x * tickOuter, y * tickOuter) <= reach) return true;
  }
  return false;
}
