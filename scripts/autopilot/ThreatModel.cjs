'use strict';
// Autonomous Campaign Harness — threat model (track C, design §3.1).
//
// Pure functions over a HarnessState snapshot (window.__ofeliyaTest
// readState()). No I/O, no Math.random, no Date.now — the bot must be a
// deterministic function of the snapshot sequence, so a recorded run can be
// replayed from its input log alone.
//
// Kind weights (§3.1 + task spec): the runner's locked charge (T-killer)
// and the anomaly are the maximum threat, the brute (macrophage) the
// minimum — it is slow (56 px/s vs player 180) and its radial telegraph is
// easy to walk out of. Elites count extra: they are faster, tankier, and
// on Strained carry regenerator / frenzied / volatile modifiers.
//
// Enemy speeds (config.ts ENEMY_DEFS): swarm 92, runner 152, brute 56,
// anomaly 74, boss 66. Player speed is 180 — the player outruns everything,
// which is what makes kiting a viable policy at all.
//
// Telegraph geometry comes from readState().telegraphs (track A): circles
// carry radius, lanes carry center + angle + length. The API exposes NO
// lane width, so LINE_HALF_WIDTH is an assumption (see below).

const KIND_WEIGHTS = {
  runner: 1.0, // T-killer: locked charge, fastest non-boss threat.
  anomaly: 1.0, // Mini-boss: radial bursts + dash, high damage.
  swarm: 0.55,
  boss: 0.9, // Boss body contact; boss attacks arrive as telegraphs.
  brute: 0.25, // Macrophage: slow, avoidable, lowest weight.
};

const ELITE_MULTIPLIER = 1.5;

/**
 * Assumed half-width of a lane telegraph in px. The Test API reports lane
 * center/angle/length but no width (Enemy.getDangerEcho has none either —
 * the lane is a path, the visual width lives in the renderer). 36 px covers
 * the runner charge corridor (runner radius 10 + charge visual) and the
 * cardiac line beam with margin. If the bot ever dies inside a lane it
 * thought it had cleared, this is the first number to re-measure.
 */
const LINE_HALF_WIDTH = 36;

/** Extra clearance added around every telegraph shape (player radius + slack). */
const TELEGRAPH_MARGIN = 22;

function kindWeight(kind, isElite) {
  const base = KIND_WEIGHTS[kind] ?? 0.5;
  return isElite ? base * ELITE_MULTIPLIER : base;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function length(x, y) {
  return Math.sqrt(x * x + y * y);
}

/** Endpoints of a lane telegraph from its center/angle/length. */
function laneEndpoints(t) {
  const dx = Math.cos(t.angle || 0);
  const dy = Math.sin(t.angle || 0);
  const half = (t.length || 0) / 2;
  return {
    x1: t.x - dx * half,
    y1: t.y - dy * half,
    x2: t.x + dx * half,
    y2: t.y + dy * half,
    dx,
    dy,
  };
}

/** Closest point on segment (x1,y1)-(x2,y2) to (px,py); returns {x, y, dist}. */
function closestOnSegment(px, py, x1, y1, x2, y2) {
  const segX = x2 - x1;
  const segY = y2 - y1;
  const lenSq = segX * segX + segY * segY;
  let t = 0;
  if (lenSq > 0) t = clamp(((px - x1) * segX + (py - y1) * segY) / lenSq, 0, 1);
  const x = x1 + t * segX;
  const y = y1 + t * segY;
  return { x, y, dist: length(px - x, py - y) };
}

/**
 * Urgency of a telegraph from its countdown: 1 while the beam is live or
 * about to fire, decaying as the firing moment recedes. msToFire is -1 when
 * unknown — treat unknown as urgent (fail safe).
 */
function telegraphUrgency(msToFire) {
  if (!Number.isFinite(msToFire) || msToFire < 0) return 1;
  if (msToFire <= 400) return 1;
  if (msToFire <= 1200) return 0.75;
  if (msToFire <= 2500) return 0.45;
  return 0.25;
}

/**
 * Distance from (x, y) to the *edge* of a telegraph shape (negative when
 * inside). The margin is folded in: distance 0 means "at the edge plus
 * TELEGRAPH_MARGIN clearance".
 */
function telegraphEdgeDistance(t, x, y) {
  if (t.shape === 'circle') {
    return length(x - t.x, y - t.y) - (t.radius || 0) - TELEGRAPH_MARGIN;
  }
  const seg = laneEndpoints(t);
  const closest = closestOnSegment(x, y, seg.x1, seg.y1, seg.x2, seg.y2);
  return closest.dist - LINE_HALF_WIDTH - TELEGRAPH_MARGIN;
}

function isPointInTelegraph(t, x, y) {
  return telegraphEdgeDistance(t, x, y) <= 0;
}

/**
 * Escape direction out of a telegraph: radially outward for circles,
 * perpendicular to the lane axis for lines (never along the beam — the
 * CardiacLineHazard rule, §3.3). Returns a unit vector, or null when the
 * point is already clear of the shape.
 */
function telegraphEscapeDirection(t, x, y) {
  if (t.shape === 'circle') {
    const dx = x - t.x;
    const dy = y - t.y;
    const d = length(dx, dy);
    if (d < 1e-6) return { x: 1, y: 0 }; // Dead center: pick a deterministic dir.
    return { x: dx / d, y: dy / d };
  }
  const seg = laneEndpoints(t);
  const closest = closestOnSegment(x, y, seg.x1, seg.y1, seg.x2, seg.y2);
  const dx = x - closest.x;
  const dy = y - closest.y;
  const d = length(dx, dy);
  if (d < 1e-6) {
    // On the beam centerline: step perpendicular (deterministic side).
    return { x: -seg.dy, y: seg.dx };
  }
  return { x: dx / d, y: dy / d };
}

/**
 * Scalar danger at a point, roughly 0..2 (higher = worse). Enemies
 * contribute weight * falloff within dangerRadius; telegraphs contribute
 * urgency-scaled danger inside the shape and near its edge; the boss body
 * contributes like an enemy with boss weight.
 */
function threatAt(snapshot, x, y, dangerRadius) {
  let total = 0;
  for (const enemy of snapshot.enemies) {
    const d = length(x - enemy.x, y - enemy.y);
    if (d >= dangerRadius) continue;
    const falloff = 1 - d / dangerRadius;
    total += kindWeight(enemy.kind, enemy.isElite) * falloff * falloff;
  }
  const boss = snapshot.boss;
  if (boss) {
    const d = length(x - boss.x, y - boss.y);
    const bossRadius = Math.max(dangerRadius, 200);
    if (d < bossRadius) {
      const falloff = 1 - d / bossRadius;
      total += KIND_WEIGHTS.boss * falloff * falloff;
    }
  }
  for (const t of snapshot.telegraphs) {
    const edge = telegraphEdgeDistance(t, x, y);
    const urgency = telegraphUrgency(t.msToFire);
    if (edge <= 0) {
      total += 2.0 * urgency;
    } else if (edge < dangerRadius * 0.6) {
      total += 0.8 * urgency * (1 - edge / (dangerRadius * 0.6));
    }
  }
  return total;
}

/** Normalized risk 0..1 for "is it safe to go here" decisions (host cells, RNA). */
function riskAt(snapshot, x, y, dangerRadius) {
  return clamp(threatAt(snapshot, x, y, dangerRadius) / 2, 0, 1);
}

/** Nearest enemy to a point (any kind), or null. */
function nearestEnemy(snapshot, x, y) {
  let best = null;
  let bestDist = Infinity;
  for (const enemy of snapshot.enemies) {
    const d = length(x - enemy.x, y - enemy.y);
    if (d < bestDist) {
      bestDist = d;
      best = enemy;
    }
  }
  return best ? { enemy: best, dist: bestDist } : null;
}

/** Nearest active gem to a point, or null. */
function nearestGem(snapshot, x, y) {
  let best = null;
  let bestDist = Infinity;
  for (const gem of snapshot.gems) {
    if (!gem.active) continue;
    const d = length(x - gem.x, y - gem.y);
    if (d < bestDist) {
      bestDist = d;
      best = gem;
    }
  }
  return best ? { gem: best, dist: bestDist } : null;
}

/**
 * Nearest host cell worth infecting: active, not yet fully infected
 * (infection < 1). Fully infected cells are done — the bot must not camp
 * them.
 */
function nearestInfectableCell(snapshot, x, y) {
  let best = null;
  let bestDist = Infinity;
  for (const cell of snapshot.hostCells) {
    if (!cell.active) continue;
    if (cell.infection >= 1) continue;
    const d = length(x - cell.x, y - cell.y);
    if (d < bestDist) {
      bestDist = d;
      best = cell;
    }
  }
  return best ? { cell: best, dist: bestDist } : null;
}

module.exports = {
  KIND_WEIGHTS,
  ELITE_MULTIPLIER,
  LINE_HALF_WIDTH,
  TELEGRAPH_MARGIN,
  kindWeight,
  clamp,
  length,
  laneEndpoints,
  closestOnSegment,
  telegraphUrgency,
  telegraphEdgeDistance,
  isPointInTelegraph,
  telegraphEscapeDirection,
  threatAt,
  riskAt,
  nearestEnemy,
  nearestGem,
  nearestInfectableCell,
};
