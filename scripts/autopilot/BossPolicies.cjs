'use strict';
// Autonomous Campaign Harness — boss policies (track C, design §3.3).
//
// Explicit state policies per boss, not one generic heuristic.
//
// IMMUNE PRIME (behavior 'pressure-wave', bloodstream): medium distance,
// elliptical orbit, host-cell/RNA priority over damage; aim at the boss
// during vulnerability; during windup move perpendicular to the attack
// line; below ~52% boss HP raise dodge priority.
//
// CARDIAC TITAN (behavior 'heartbeat-pulse', heart): explicit FSM
//   OBSERVE_HEARTBEAT → TELEGRAPH → LOCATE_SAFE_POCKET →
//   MOVE_TO_SAFE_POCKET → VERIFY_SYNCHRONIZATION → ATTACK_WINDOW →
//   RETURN_TO_KITING → OBSERVE_HEARTBEAT
// Synchronization is verified, not assumed: reaching the pocket coordinates
// is not success until the game confirms the heartbeat impact passed while
// the bot was inside (nextImpactAtMs advances).
//
// CORRECTION vs §3.3 of the design doc: the doc says the bot must compute
// safe pockets itself from telegraph geometry. Track A found the game DOES
// track the pocket (heartbeatSafeX/Y/radius + indicator) and exposes it as
// readState().heartbeat.safePocket — so the bot READS the pocket and only
// decides when to go to it. The FSM below works on the API pocket.
//
// Heartbeat timing (HeartbeatPulseDirector HEARTBEAT_PULSE_PROFILE, verified
// against code — NOT the "900 ms" figure in §3.3, which is wrong):
// first impact at 12 s stage time, then every 18 s; during the boss fight
// every 7.2 s with the first boss impact 3.2 s after spawn; telegraph lead
// 700 ms; pressure lasts 1,050 ms. Strained multiplies the interval by 0.78
// (boss interval ~5.6 s) via heartbeatIntervalMultiplier.
//
// The FSM is driven by msToNextImpact (stage clock — reliable) and the
// safePocket presence. Two time bases exist in the API (protected/
// opportunity are scene-clock, nextImpact is stage-clock); only the
// stage-clock value is used here.
//
// T-KILLER (runner) and MACROPHAGE (brute) need no separate policy object:
// the runner's locked charge arrives as a lane telegraph (dodge is
// perpendicular escape in ThreatModel/MovementPolicy) and the brute is the
// lowest threat weight. CardiacLineHazard crossing is perpendicular-only —
// enforced by telegraphEscapeDirection (perpendicular to the lane axis) +
// the hard projection in MovementPolicy, never by moving along the beam.

const { length } = require('./ThreatModel.cjs');

const TITAN_STATES = {
  OBSERVE_HEARTBEAT: 'OBSERVE_HEARTBEAT',
  TELEGRAPH: 'TELEGRAPH',
  LOCATE_SAFE_POCKET: 'LOCATE_SAFE_POCKET',
  MOVE_TO_SAFE_POCKET: 'MOVE_TO_SAFE_POCKET',
  VERIFY_SYNCHRONIZATION: 'VERIFY_SYNCHRONIZATION',
  ATTACK_WINDOW: 'ATTACK_WINDOW',
  RETURN_TO_KITING: 'RETURN_TO_KITING',
};

// Start moving to the pocket when the impact is this close (ms). The pocket
// indicator appears with the telegraph (700 ms lead), so the bot reacts to
// the pocket itself, not the clock; the clock is the fallback when the
// pocket is already known.
const POCKET_REACT_MS = 4000;
// Leave the attack window and re-check the heartbeat when the next impact
// is this close.
const ATTACK_EXIT_MS = 3000;
// Consider the bot "inside" the pocket at 60% of its radius (margin for
// drift and for the indicator/pocket edge mismatch).
const POCKET_INSIDE_FRACTION = 0.6;

function dist(ax, ay, bx, by) {
  return length(ax - bx, ay - by);
}

/**
 * IMMUNE PRIME policy. Stateless per tick (the orbit state lives in the
 * bot); returns steering hints for MovementPolicy.
 */
function primePolicy(snapshot, profile) {
  const boss = snapshot.boss;
  if (!boss) return { anchor: null, aimAt: null, telegraphWeight: 1 };
  const bossHpRatio = boss.maxHp > 0 ? boss.hp / boss.maxHp : 1;
  const windingUp = boss.telegraph === 'telegraph'
    || snapshot.telegraphs.some((t) => t.source === 'boss');
  return {
    anchor: { x: boss.x, y: boss.y },
    aimAt: { x: boss.x, y: boss.y },
    // Below ~52% boss HP the pressure waves come denser: dodge first.
    // During windup the telegraph repulsion dominates anyway; raise it.
    telegraphWeight: (bossHpRatio < 0.52 ? 1.5 : 1) * (windingUp ? 1.4 : 1),
    mode: windingUp ? 'PRIME_DODGE' : 'PRIME_ORBIT',
  };
}

/**
 * CARDIAC TITAN heartbeat FSM. One instance per run; reset() on stage
 * change. update() returns steering hints plus an optional event
 * ('HEART_SYNC_SUCCESS' when an impact passes with the bot inside the
 * pocket, 'HEART_SYNC_MISSED' when an impact passes with the bot outside).
 */
class TitanPolicy {
  constructor() {
    this.state = TITAN_STATES.OBSERVE_HEARTBEAT;
    this.lastNextImpactAtMs = null;
    this.lastProtectedUntilMs = null;
    this.impactPassedWhileInside = false;
    this.syncSuccesses = 0;
    this.syncMisses = 0;
  }

  reset() {
    this.state = TITAN_STATES.OBSERVE_HEARTBEAT;
    this.lastNextImpactAtMs = null;
    this.lastProtectedUntilMs = null;
    this.impactPassedWhileInside = false;
  }

  /**
   * @param {object} snapshot HarnessState.
   * @param {object} profile §3.2 profile (orbitRadius used for kiting).
   * @returns {{anchor, aimAt, seekTarget, telegraphWeight, mode, event}}
   */
  update(snapshot, profile) {
    const boss = snapshot.boss;
    const heartbeat = snapshot.heartbeat || {};
    const pocket = heartbeat.safePocket || null;
    const msToNext = heartbeat.msToNextImpact;
    const nextImpactAt = heartbeat.nextImpactAtMs;
    const player = snapshot.player;

    let event = null;

    // Detect an impact passing: nextImpactAtMs jumps forward (new interval
    // scheduled). This is the game's own confirmation, not our clock.
    const impactPassed = this.lastNextImpactAtMs !== null
      && nextImpactAt !== null
      && nextImpactAt !== this.lastNextImpactAtMs;
    if (nextImpactAt !== null) this.lastNextImpactAtMs = nextImpactAt;

    const insidePocket = pocket
      && dist(player.x, player.y, pocket.x, pocket.y) <= pocket.radius * POCKET_INSIDE_FRACTION;

    // The game destroys the safe-pocket indicator at the impact, before the
    // harness reads state, so insidePocket is null/stale at this poll. The
    // protection window is the game's own record of "player was inside at
    // impact": it is renewed (advanced) on a protected impact and zeroed on
    // an unprotected one.
    const protectedUntil = heartbeat.protectedUntilMs ?? null;
    const nowMs = snapshot.runTimeMs ?? 0;
    const impactProtected = protectedUntil !== null
      && protectedUntil !== this.lastProtectedUntilMs
      && protectedUntil > nowMs;
    this.lastProtectedUntilMs = protectedUntil;

    if (impactPassed) {
      if (this.state === TITAN_STATES.VERIFY_SYNCHRONIZATION && (insidePocket || impactProtected)) {
        this.syncSuccesses += 1;
        event = 'HEART_SYNC_SUCCESS';
        this.state = TITAN_STATES.ATTACK_WINDOW;
      } else if (
        this.state === TITAN_STATES.MOVE_TO_SAFE_POCKET
        || this.state === TITAN_STATES.VERIFY_SYNCHRONIZATION
        || this.state === TITAN_STATES.TELEGRAPH
        || this.state === TITAN_STATES.LOCATE_SAFE_POCKET
      ) {
        // The impact passed while we were on our way or outside: a miss.
        // (If we were already inside but in MOVE state, still count the
        // sync as a success — the pocket protected us either way.)
        if (insidePocket || impactProtected) {
          this.syncSuccesses += 1;
          event = 'HEART_SYNC_SUCCESS';
        } else {
          this.syncMisses += 1;
          event = 'HEART_SYNC_MISSED';
        }
        this.state = TITAN_STATES.ATTACK_WINDOW;
      } else if (this.state === TITAN_STATES.ATTACK_WINDOW || this.state === TITAN_STATES.RETURN_TO_KITING) {
        // Impact passed while kiting/attacking: if we happened to be inside
        // a pocket, that is a free sync; otherwise just keep going.
        if (insidePocket || impactProtected) {
          this.syncSuccesses += 1;
          event = 'HEART_SYNC_SUCCESS';
        }
      }
      // In OBSERVE_HEARTBEAT an impact passing unnoticed means the pocket
      // never showed or we were far away — no event, just continue.
    }

    // --- transitions -------------------------------------------------------
    switch (this.state) {
      case TITAN_STATES.OBSERVE_HEARTBEAT: {
        if (pocket) {
          this.state = TITAN_STATES.TELEGRAPH;
        }
        break;
      }
      case TITAN_STATES.TELEGRAPH: {
        // The pocket is shown: its coordinates are known.
        this.state = pocket
          ? TITAN_STATES.LOCATE_SAFE_POCKET
          : TITAN_STATES.OBSERVE_HEARTBEAT;
        break;
      }
      case TITAN_STATES.LOCATE_SAFE_POCKET: {
        this.state = pocket
          ? TITAN_STATES.MOVE_TO_SAFE_POCKET
          : TITAN_STATES.OBSERVE_HEARTBEAT;
        break;
      }
      case TITAN_STATES.MOVE_TO_SAFE_POCKET: {
        if (!pocket) {
          // Pocket gone without an impact event we saw: the beat passed.
          this.state = TITAN_STATES.OBSERVE_HEARTBEAT;
        } else if (insidePocket) {
          this.state = TITAN_STATES.VERIFY_SYNCHRONIZATION;
        } else if (
          Number.isFinite(msToNext)
          && msToNext <= 0
        ) {
          this.state = TITAN_STATES.OBSERVE_HEARTBEAT;
        }
        break;
      }
      case TITAN_STATES.VERIFY_SYNCHRONIZATION: {
        if (!pocket) {
          // Pocket closed: the impact passed (or was cancelled). If we were
          // inside when it closed, the sync held; the impactPassed branch
          // above already scored it — fall through to attack.
          this.state = TITAN_STATES.ATTACK_WINDOW;
        } else if (!insidePocket) {
          // Drifted out (knockback / minion push): go back in.
          this.state = TITAN_STATES.MOVE_TO_SAFE_POCKET;
        }
        break;
      }
      case TITAN_STATES.ATTACK_WINDOW: {
        if (pocket) {
          this.state = TITAN_STATES.TELEGRAPH;
        } else if (Number.isFinite(msToNext) && msToNext < ATTACK_EXIT_MS) {
          this.state = TITAN_STATES.RETURN_TO_KITING;
        }
        break;
      }
      case TITAN_STATES.RETURN_TO_KITING: {
        if (pocket) {
          this.state = TITAN_STATES.TELEGRAPH;
        } else if (!Number.isFinite(msToNext) || msToNext > POCKET_REACT_MS) {
          this.state = TITAN_STATES.OBSERVE_HEARTBEAT;
        }
        break;
      }
      default:
        this.state = TITAN_STATES.OBSERVE_HEARTBEAT;
        break;
    }

    // --- steering hints ------------------------------------------------------
    const anchor = boss ? { x: boss.x, y: boss.y } : null;
    const aimAt = boss ? { x: boss.x, y: boss.y } : null;
    const windingUp = boss && (boss.telegraph === 'telegraph'
      || snapshot.telegraphs.some((t) => t.source === 'boss' || t.source === 'cardiac-line'));

    switch (this.state) {
      case TITAN_STATES.MOVE_TO_SAFE_POCKET:
      case TITAN_STATES.LOCATE_SAFE_POCKET:
        return {
          anchor, aimAt, seekTarget: pocket,
          telegraphWeight: windingUp ? 1.4 : 1,
          mode: this.state, event,
        };
      case TITAN_STATES.VERIFY_SYNCHRONIZATION:
        return {
          anchor, aimAt, seekTarget: pocket,
          telegraphWeight: 1,
          mode: this.state, event,
        };
      case TITAN_STATES.ATTACK_WINDOW:
        // Close in: orbit tight so shots land, aim at the boss.
        return {
          anchor, aimAt, seekTarget: null,
          telegraphWeight: windingUp ? 1.4 : 1,
          mode: this.state, event,
          orbitRadius: Math.min(profile.orbitRadius, 170),
        };
      case TITAN_STATES.TELEGRAPH:
        return {
          anchor, aimAt, seekTarget: pocket,
          telegraphWeight: 1.2,
          mode: this.state, event,
        };
      default: // OBSERVE_HEARTBEAT, RETURN_TO_KITING
        return {
          anchor, aimAt, seekTarget: null,
          telegraphWeight: windingUp ? 1.4 : 1,
          mode: this.state, event,
        };
    }
  }
}

module.exports = {
  TITAN_STATES,
  POCKET_REACT_MS,
  ATTACK_EXIT_MS,
  POCKET_INSIDE_FRACTION,
  primePolicy,
  TitanPolicy,
};
