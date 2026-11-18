'use strict';
// Autonomous Campaign Harness — campaign bot controller (track C, design §3).
//
// Layers (§3.1):
//   CampaignBot (this file) — run lifecycle, stuck detection, orchestration
//   BossPolicies             — IMMUNE PRIME / CARDIAC TITAN state policies
//   MovementPolicy           — threat map, kiting, dodge, safe pockets
//   ThreatModel              — threat weights and telegraph geometry
//   UpgradePolicy            — deterministic mutation table
//
// Decision tick: 10 Hz of GAME time (every 6 frames at 60 Hz). decide() is
// a function (snapshot, tick) -> { move, aim, events } — deterministic given
// the snapshot sequence: the only randomness is a seeded PRNG (mulberry32
// over the run seed) used for escape vectors and orbit-direction flips, so
// the same seed replays the same decisions.
//
// The bot reads ONLY HarnessState (window.__ofeliyaTest.readState()). It
// never touches window.__game — the runner owns diagnostics, invariants
// and the watchdog and may read __game for those, but the bot's decisions
// must come from the public Test API contract alone.

const { computeMove, projectOutOfTelegraphs } = require('./MovementPolicy.cjs');
const { primePolicy, TitanPolicy } = require('./BossPolicies.cjs');
const { chooseUpgrade } = require('./UpgradePolicy.cjs');
const { length } = require('./ThreatModel.cjs');

// Profiles §3.2, verbatim.
const PROFILES = {
  strained: {
    dangerRadius: 190,
    safeHpRatio: 0.42,
    hostCellRiskLimit: 0.25,
    orbitRadius: 220,
  },
  standard: {
    dangerRadius: 150,
    safeHpRatio: 0.30,
    hostCellRiskLimit: 0.40,
    orbitRadius: 180,
  },
};

// Decision tick: 10 Hz game time.
const DECISION_FRAMES = 6;
// Stuck detector (§3.4 fail-safe): no displacement for 5 s of game time
// while commanding movement -> random escape vector.
const STUCK_WINDOW_TICKS = 50; // 50 ticks * 100 ms = 5 s
const STUCK_MIN_DISPLACEMENT = 10; // px over the window
const ESCAPE_TICKS = 10; // 1 s of escape movement
// Flip the orbit direction every ~25 s of game time so the bot does not
// loop predictably into a spawn wall (deterministic: tick-based).
// Orbit direction flips every 600 ticks (60 s sim). A shorter period
// scatters the enemy train the bot is kiting — flipping makes the bot run
// into its own train instead of letting it trail behind in weapon range.
const ORBIT_FLIP_TICKS = 600;

function hashSeed(seed) {
  let h = 2166136261;
  const s = String(seed ?? 'campaign');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seedInt) {
  let a = seedInt >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class CampaignBot {
  /**
   * @param {object} options { seed: string, difficulty: 'standard'|'strained' }
   */
  constructor(options) {
    const { seed, difficulty } = options;
    this.seed = seed;
    this.difficulty = difficulty;
    this.profile = { ...(PROFILES[difficulty] || PROFILES.standard) };
    this.rng = mulberry32(hashSeed(seed));
    this.titan = new TitanPolicy();
    this.orbitDir = 1;
    this.lastFlipTick = 0;
    // Stuck detector: ring of recent positions (one per decision tick).
    this.positions = [];
    this.escapeUntilTick = -1;
    this.escapeVector = { x: 0, y: 0 };
    this.stuckCount = 0;
    this.lastStageId = null;
    this.lastPhase = null;
    // Own upgrade stacks (from chooseUpgrade calls — the bot's own build,
    // not readState, which does not expose stacks). Cycle 5: drives the
    // regen sustain rule in UpgradePolicy (cap 2 stacks); the AoE
    // distance shrink they drove in cycles 2-3 stays reverted.
    this.stacks = {};
    this.wasDwelling = false;
  }

  resetForStage(stageId) {
    this.titan.reset();
    this.positions = [];
    this.escapeUntilTick = -1;
    this.orbitDir = -this.orbitDir;
    this.lastStageId = stageId;
  }

  /**
   * Decide the next input.
   * @param {object} snapshot HarnessState.
   * @param {number} tick Run-relative frame count (frames advanced since
   *   startCampaign returned — the same coordinate the input log uses).
   * @returns {{ move: {x,y}, aim: {x,y}, events: string[], debug: object }}
   *   events: 'BOT_STUCK' when the stuck detector fires, 'BOT_DWELL' once
   *   per host-cell dwell start, 'HEART_SYNC_SUCCESS' / 'HEART_SYNC_MISSED'
   *   from the Titan FSM.
   */
  decide(snapshot, tick) {
    const events = [];
    const player = snapshot.player;

    // Stage change: reset per-stage policy state.
    if (snapshot.stageId && snapshot.stageId !== this.lastStageId) {
      this.resetForStage(snapshot.stageId);
    }
    this.lastStageId = snapshot.stageId;
    this.lastPhase = snapshot.phase;

    // Deterministic orbit-direction flip.
    if (tick - this.lastFlipTick >= ORBIT_FLIP_TICKS) {
      this.orbitDir = -this.orbitDir;
      this.lastFlipTick = tick;
    }

    // --- stuck detector ----------------------------------------------------
    this.positions.push({ x: player.x, y: player.y, tick });
    while (this.positions.length > 0 && tick - this.positions[0].tick > STUCK_WINDOW_TICKS * DECISION_FRAMES) {
      this.positions.shift();
    }
    const oldest = this.positions[0];
    const displacement = oldest ? length(player.x - oldest.x, player.y - oldest.y) : Infinity;
    const windowCovered = oldest && tick - oldest.tick >= STUCK_WINDOW_TICKS * DECISION_FRAMES;
    if (
      windowCovered
      && displacement < STUCK_MIN_DISPLACEMENT
      && tick > this.escapeUntilTick
      && (snapshot.phase === 'PLAYING' || snapshot.phase === 'BOSS_ACTIVE' || snapshot.phase === 'BOSS_WARNING')
    ) {
      // Stuck: pick a deterministic-random escape vector.
      const angle = this.rng() * Math.PI * 2;
      this.escapeVector = { x: Math.cos(angle), y: Math.sin(angle) };
      this.escapeUntilTick = tick + ESCAPE_TICKS * DECISION_FRAMES;
      this.stuckCount += 1;
      events.push('BOT_STUCK');
      this.positions = [];
    }

    // --- boss policy ---------------------------------------------------------
    const boss = snapshot.boss;
    let hints = { anchor: null, aimAt: null, seekTarget: null, telegraphWeight: 1, mode: 'KITE' };
    if (boss && boss.behavior === 'heartbeat-pulse') {
      const titanHints = this.titan.update(snapshot, this.profile);
      hints = titanHints;
      if (titanHints.event) events.push(titanHints.event);
    } else if (boss && boss.behavior === 'pressure-wave') {
      hints = primePolicy(snapshot, this.profile);
    } else if (boss) {
      // Unknown boss behavior: orbit + aim, generic dodge.
      hints = {
        anchor: { x: boss.x, y: boss.y },
        aimAt: { x: boss.x, y: boss.y },
        seekTarget: null,
        telegraphWeight: 1.2,
        mode: 'BOSS_GENERIC',
      };
    }

    // --- AoE fighting distance: REVERTED in cycle 4 ------------------------
    // Cycles 2-3 shrank dangerRadius with orbit stacks (0.7 / stack-scaled)
    // to let enemies inside the orbit ring — and both died EARLIER than
    // cycle 1 (132 s vs 157 s sim, same seed/build). The premise was wrong
    // twice over: runner HP is 12, not 30 (config.ts), and the ring's
    // 340 ms/enemy hit cooldown caps its real DPS vs a fast crosser — a
    // runner spends ~0.37 s inside the 82 px ring and takes at most 2
    // blade hits (22 dmg vs 22 scaled HP: borderline), a swarmer survives
    // the crossing outright (37 HP at 2 min). The ring is a chip grinder,
    // not a wall; fighting closer only buys contact hits. The profile
    // dangerRadius (§3.2, verbatim) is used as-is; the real fixes for the
    // ~100 s bleed are in MovementPolicy (runner radius, tangent
    // suppression, brute floor). aoeStacks is kept as a debug diagnostic.
    const aoeStacks = (this.stacks.orbit || 0) + (this.stacks.nova || 0);
    const profile = this.profile;

    // --- movement ------------------------------------------------------------
    const hpRatio = player.maxHp > 0 ? player.hp / player.maxHp : 1;
    const hurt = hpRatio < profile.safeHpRatio;
    let move;
    if (tick <= this.escapeUntilTick) {
      // Escape vector, still projected out of telegraphs (priority 1 holds
      // even while escaping).
      move = projectOutOfTelegraphs(snapshot, this.escapeVector);
    } else {
      move = computeMove(snapshot, profile, {
        orbitDir: this.orbitDir,
        anchor: hints.anchor,
        orbitRadius: hints.orbitRadius ?? profile.orbitRadius,
        seekTarget: hints.seekTarget || null,
        telegraphWeight: hints.telegraphWeight,
        // Hurt: push enemies away harder, farm less (MovementPolicy already
        // gates host-cell/RNA attraction on safeHpRatio).
        repulsionWeight: hurt ? 1.5 : 1,
      });
    }

    // Dwell diagnostic: emit once per dwell start (edge-triggered, so a
    // 1.3 s dwell logs one marker, not thirteen).
    if (move.dwelled && !this.wasDwelling) events.push('BOT_DWELL');
    this.wasDwelling = Boolean(move.dwelled);

    // --- aim -------------------------------------------------------------------
    // Boss active: aim at the boss (focus fire). Otherwise aim (0,0): the
    // game falls back to nearest-enemy auto-aim when |aim| < 0.18
    // (GameScene targeting), which is exactly what kiting wants.
    let aim = { x: 0, y: 0 };
    if (hints.aimAt) {
      const dx = hints.aimAt.x - player.x;
      const dy = hints.aimAt.y - player.y;
      const d = length(dx, dy);
      if (d > 1e-6) aim = { x: dx / d, y: dy / d };
    }

    return {
      move,
      aim,
      events,
      debug: {
        mode: hints.mode || 'KITE',
        titanState: boss && boss.behavior === 'heartbeat-pulse' ? this.titan.state : null,
        hpRatio,
        stuckCount: this.stuckCount,
        syncSuccesses: this.titan.syncSuccesses,
        syncMisses: this.titan.syncMisses,
        aoeStacks,
        dangerRadius: profile.dangerRadius,
        dwelled: Boolean(move.dwelled),
      },
    };
  }

  /**
   * Pick a mutation from the pending offers (UpgradePolicy table).
   * Records the pick in this.stacks (the bot's own build). The stacks are
   * passed to the policy (cycle 5: the regen sustain rule caps at 2).
   * @param {object} snapshot HarnessState (must have pendingChoices).
   * @returns {string} chosen upgrade id.
   */
  chooseUpgrade(snapshot) {
    const player = snapshot.player;
    const id = chooseUpgrade(snapshot.pendingChoices, {
      difficultyId: snapshot.difficultyId,
      stageId: snapshot.stageId,
      stageTimeMs: snapshot.stageTimeMs,
      phase: snapshot.phase,
      bossKind: snapshot.boss ? snapshot.boss.kind : null,
      hpRatio: player.maxHp > 0 ? player.hp / player.maxHp : 1,
      stacks: this.stacks,
    });
    this.stacks[id] = (this.stacks[id] || 0) + 1;
    return id;
  }
}

module.exports = {
  PROFILES,
  DECISION_FRAMES,
  STUCK_WINDOW_TICKS,
  STUCK_MIN_DISPLACEMENT,
  ESCAPE_TICKS,
  ORBIT_FLIP_TICKS,
  CampaignBot,
  hashSeed,
};
