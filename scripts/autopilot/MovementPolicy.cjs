'use strict';
// Autonomous Campaign Harness — movement policy (track C, design §3.1).
//
// Steering vector, Manus formula from §3.1:
//
//   desired = + targetAttraction + rnaAttraction + hostCellAttraction
//             - enemyRepulsion - telegraphRepulsion + orbitTangent
//
// Priorities (§3.1, in order): (1) never cross an active telegraph;
// (2) never enter crowd pressure; (3) host cell when reachable without
// crossing a danger zone; (4) RNA inside a safe radius; (5) boss distance +
// constant orbit motion. Ordinary enemies are handled by repulsion only —
// the bot never chases a kill; the auto-fire does the killing.
//
// Pure function of (snapshot, profile, opts) plus the caller's orbit
// direction. No I/O, no Math.random, no Date.now.

const {
  clamp,
  length,
  kindWeight,
  telegraphEdgeDistance,
  telegraphEscapeDirection,
  telegraphUrgency,
  riskAt,
  nearestGem,
  nearestInfectableCell,
} = require('./ThreatModel.cjs');

// Weapon range is 380 (config.ts WEAPON.range); the bot keeps the boss
// inside ~330 so shots land while leaving dodge room.
const WEAPON_RANGE = 380;
const ENGAGE_RANGE = 330;
// RNA is only chased inside this radius — beyond it the bot holds position.
const RNA_CHASE_RADIUS = 240;
// Host cells are only approached inside this radius.
const HOST_CELL_CHASE_RADIUS = 300;

function unit(x, y) {
  const d = length(x, y);
  if (d < 1e-9) return { x: 0, y: 0 };
  return { x: x / d, y: y / d };
}

/**
 * Hard telegraph rule (priority 1): if the point the bot would step to
 * (player + move * LOOKAHEAD px) lands inside an active telegraph, project
 * the move onto the escape direction. Returns the (possibly replaced)
 * vector. This runs AFTER the weighted sum, so no attraction can drag the
 * bot into a beam.
 */
function projectOutOfTelegraphs(snapshot, move) {
  const LOOKAHEAD = 34; // ~2 decision ticks of travel at full speed.
  const px = snapshot.player.x;
  const py = snapshot.player.y;
  const tx = px + move.x * LOOKAHEAD;
  const ty = py + move.y * LOOKAHEAD;
  let worst = null;
  let worstEdge = 0;
  for (const t of snapshot.telegraphs) {
    const edge = telegraphEdgeDistance(t, tx, ty);
    if (edge <= 0 && (worst === null || edge < worstEdge)) {
      worst = t;
      worstEdge = edge;
    }
  }
  if (!worst) return move;
  // Step to the escape direction; blend with the original move so the bot
  // slides along the boundary instead of bouncing straight out.
  const escape = telegraphEscapeDirection(worst, px, py);
  const along = move.x * escape.x + move.y * escape.y;
  if (along >= 0) return move; // Already moving out.
  const out = {
    x: move.x - along * escape.x + escape.x * 1.2,
    y: move.y - along * escape.y + escape.y * 1.2,
  };
  return unit(out.x, out.y);
}

/**
 * Compute the desired movement vector.
 *
 * @param {object} snapshot HarnessState.
 * @param {object} profile { dangerRadius, safeHpRatio, hostCellRiskLimit,
 *   orbitRadius } — §3.2, verbatim per difficulty.
 * @param {object} opts
 * @param {number} opts.orbitDir +1 | -1 — orbit direction around the anchor.
 * @param {{x:number,y:number}|null} [opts.anchor] Orbit center (boss pos
 *   when a boss is active; null = strafe around the nearest threat).
 * @param {number} [opts.orbitRadius] Override for the orbit ring.
 * @param {{x:number,y:number,radius:number}|null} [opts.seekTarget] When
 *   set (safe pocket), the bot goes here and other attractions are muted.
 * @param {number} [opts.telegraphWeight] Multiplier on telegraph repulsion
 *   (boss policies raise it during windup / low boss HP).
 * @param {number} [opts.repulsionWeight] Multiplier on enemy repulsion
 *   (raised when the player is hurt).
 * @returns {{x:number,y:number}} Unit-ish vector in [-1, 1] per component.
 */
function computeMove(snapshot, profile, opts) {
  const player = snapshot.player;
  const px = player.x;
  const py = player.y;
  const hpRatio = player.maxHp > 0 ? player.hp / player.maxHp : 1;
  const dangerRadius = profile.dangerRadius;
  const telegraphWeight = opts.telegraphWeight ?? 1;
  const repulsionWeight = opts.repulsionWeight ?? 1;
  const orbitRadius = opts.orbitRadius ?? profile.orbitRadius;

  let mx = 0;
  let my = 0;

  // --- enemy repulsion (priority 2: crowd pressure) -----------------------
  for (const enemy of snapshot.enemies) {
    const dx = px - enemy.x;
    const dy = py - enemy.y;
    const d = length(dx, dy);
    if (d >= dangerRadius || d < 1e-6) continue;
    const falloff = 1 - d / dangerRadius;
    const strength = kindWeight(enemy.kind, enemy.isElite) * falloff * falloff * 2.4 * repulsionWeight;
    mx += (dx / d) * strength;
    my += (dy / d) * strength;
  }
  const boss = snapshot.boss;
  if (boss) {
    const dx = px - boss.x;
    const dy = py - boss.y;
    const d = length(dx, dy);
    const bossDanger = Math.max(dangerRadius, 200);
    if (d < bossDanger && d > 1e-6) {
      const falloff = 1 - d / bossDanger;
      const strength = 0.9 * falloff * falloff * 2.4 * repulsionWeight;
      mx += (dx / d) * strength;
      my += (dy / d) * strength;
    }
  }

  // --- telegraph repulsion (priority 1, soft part; the hard part is the
  // projection below) ------------------------------------------------------
  for (const t of snapshot.telegraphs) {
    const edge = telegraphEdgeDistance(t, px, py);
    const urgency = telegraphUrgency(t.msToFire);
    if (edge > dangerRadius * 0.8) continue;
    const escape = telegraphEscapeDirection(t, px, py);
    const proximity = edge <= 0 ? 1 : 1 - edge / (dangerRadius * 0.8);
    const strength = (edge <= 0 ? 3.2 : 1.6) * urgency * proximity * telegraphWeight;
    mx += escape.x * strength;
    my += escape.y * strength;
  }

  const seeking = Boolean(opts.seekTarget);

  // --- host-cell attraction (priority 3) ----------------------------------
  // Only when the cell itself is safe enough (risk limit from the profile)
  // and the player is not already hurt (below safeHpRatio the bot flees
  // instead of farming).
  if (!seeking && hpRatio >= profile.safeHpRatio) {
    const found = nearestInfectableCell(snapshot, px, py);
    if (found && found.dist < HOST_CELL_CHASE_RADIUS) {
      const risk = riskAt(snapshot, found.cell.x, found.cell.y, dangerRadius);
      if (risk <= profile.hostCellRiskLimit) {
        const toward = unit(found.cell.x - px, found.cell.y - py);
        // Pull harder when close: infection needs dwell time near the cell.
        const strength = found.dist < 90 ? 1.15 : 0.6;
        mx += toward.x * strength;
        my += toward.y * strength;
      }
    }
  }

  // --- RNA attraction (priority 4) ----------------------------------------
  if (!seeking) {
    const found = nearestGem(snapshot, px, py);
    if (found && found.dist < RNA_CHASE_RADIUS) {
      const risk = riskAt(snapshot, found.gem.x, found.gem.y, dangerRadius);
      // Gems are only worth it inside a safe radius; a hurt bot values
      // them less (survival first).
      if (risk < 0.55) {
        const toward = unit(found.gem.x - px, found.gem.y - py);
        const strength = (hpRatio < profile.safeHpRatio ? 0.18 : 0.55) * (1 - found.dist / RNA_CHASE_RADIUS * 0.5);
        mx += toward.x * strength;
        my += toward.y * strength;
      }
    }
  }

  // --- seek target (safe pocket) overrides the economy --------------------
  if (seeking) {
    const target = opts.seekTarget;
    const dx = target.x - px;
    const dy = target.y - py;
    const d = length(dx, dy);
    if (d > target.radius * 0.4) {
      const toward = unit(dx, dy);
      mx += toward.x * 2.2;
      my += toward.y * 2.2;
    }
    // Inside the pocket: hold still (repulsion still applies, so the bot
    // dodges minions without leaving the pocket if it can help it).
  }

  // --- target attraction + orbit tangent (priority 5) ---------------------
  const anchor = opts.anchor || null;
  if (anchor) {
    const dx = px - anchor.x;
    const dy = py - anchor.y;
    const d = length(dx, dy) || 1;
    const radial = { x: dx / d, y: dy / d };
    // Ring control: pull toward the orbit radius, never beyond weapon range.
    if (!seeking) {
      if (d > ENGAGE_RANGE) {
        // Too far to shoot: close in.
        mx += -radial.x * 1.1;
        my += -radial.y * 1.1;
      } else if (d > orbitRadius + 30) {
        mx += -radial.x * 0.45;
        my += -radial.y * 0.45;
      } else if (d < orbitRadius - 50) {
        mx += radial.x * 0.55;
        my += radial.y * 0.55;
      }
    }
    // Constant orbit motion: tangent around the anchor.
    const dir = opts.orbitDir >= 0 ? 1 : -1;
    const tangent = { x: -radial.y * dir, y: radial.x * dir };
    const tangentWeight = seeking ? 0.15 : 0.85;
    mx += tangent.x * tangentWeight;
    my += tangent.y * tangentWeight;
  } else if (!seeking) {
    // No boss: strafe around the nearest threat so the bot never sits still
    // while enemies converge. If nothing is near, drift toward the nearest
    // gem/cell (already handled above) or hold a slow patrol circle.
    const near = snapshot.enemies.length > 0
      ? snapshot.enemies.reduce((best, e) => {
          const d = length(px - e.x, py - e.y);
          return d < best.d ? { e, d } : best;
        }, { e: null, d: Infinity })
      : { e: null, d: Infinity };
    if (near.e && near.d < dangerRadius * 1.4) {
      const dx = px - near.e.x;
      const dy = py - near.e.y;
      const d = near.d || 1;
      const radial = { x: dx / d, y: dy / d };
      const dir = opts.orbitDir >= 0 ? 1 : -1;
      mx += -radial.y * dir * 0.7;
      my += radial.x * dir * 0.7;
    }
  }

  // --- normalize ----------------------------------------------------------
  const mag = length(mx, my);
  let move;
  if (mag < 1e-6) {
    // Balanced forces: keep moving on the orbit tangent so the bot never
    // stands still in a swarm.
    if (anchor) {
      const dx = px - anchor.x;
      const dy = py - anchor.y;
      const d = length(dx, dy) || 1;
      const dir = opts.orbitDir >= 0 ? 1 : -1;
      move = { x: (-dy / d) * dir, y: (dx / d) * dir };
    } else {
      move = { x: 0, y: -1 }; // Deterministic default: drift up.
    }
  } else if (mag > 1) {
    move = { x: mx / mag, y: my / mag };
  } else {
    move = { x: mx, y: my };
  }

  // --- hard telegraph rule (priority 1) ------------------------------------
  move = projectOutOfTelegraphs(snapshot, move);
  return {
    x: clamp(move.x, -1, 1),
    y: clamp(move.y, -1, 1),
  };
}

module.exports = {
  WEAPON_RANGE,
  ENGAGE_RANGE,
  RNA_CHASE_RADIUS,
  HOST_CELL_CHASE_RADIUS,
  computeMove,
  projectOutOfTelegraphs,
  unit,
};
