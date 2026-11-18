'use strict';
// Autonomous Campaign Harness — upgrade policy (track C, design §3.4).
//
// Deterministic table by (difficultyId, stage, phase bucket, HP state).
// Chooses ONLY from pendingChoices; if the preferred offer is absent, takes
// the best available — never tries to "fish" for a specific mutation.
//
// Choice id formats (verified against code):
//   base upgrades: 'dmg' | 'rate' | 'multi' | 'pierce' | 'speed' | 'hp' |
//     'magnet' | 'orbit' | 'nova' | 'infect' | 'lysis' | 'factory' |
//     'regen' | 'heal' (UpgradeSystem.ts)
//   evolutions: 'evo:prism' | 'evo:halo' | 'evo:singularity'
//     (EvolutionSystem.ts toChoice — offered only when the recipe is ready)
//   legendaries: 'legendary:split-geometry' | 'legendary:lysis-chain' |
//     'legendary:zero-point' | 'legendary:core-predator' |
//     'legendary:myocardial-rhythm' | 'legendary:last-carrier'
//     (LegendarySystem.ts toChoice; max 2 per run, enforced by the game)
//
// Pure function: (pendingChoices, context) -> id. No I/O, no randomness.

const LEGENDARY_PRIORITY = [
  'legendary:myocardial-rhythm', // Heart synergy; strongest on the heart stage.
  'legendary:zero-point',
  'legendary:split-geometry',
  'legendary:lysis-chain',
  'legendary:core-predator',
  'legendary:last-carrier', // Costs 25% of current level progress — last.
];

const EVOLUTION_PRIORITY = [
  'evo:singularity',
  'evo:prism',
  'evo:halo',
];

// Priority tables: first listed available id wins.
//
// Early game is a DPS race, not a survival race — proven by the
// smoke-boss1 run (2026-11-18): hp-first early picks (regen, hp, hp) left
// the bot at 52 kills / level 4 after 135 s sim, and HP crashed 125 -> 46
// once the swarm hit the pool cap. Kills feed XP, XP feeds levels, levels
// feed damage: without early damage the bot cannot scale against spawn
// pressure, and HP alone only postpones the same death. So damage and AoE
// (dmg/multi/rate, orbit ring 11 dmg per 340 ms, infect -> lysis 26 dmg
// in 150 px) lead every table; HP/regen are mid-table insurance. The
// emergency heal rule (HEAL_THRESHOLD) still covers real danger.
const TABLES = {
  standard: {
    // Bloodstream before ~2:30: damage + AoE first — kills are XP.
    early: ['dmg', 'multi', 'rate', 'orbit', 'infect', 'lysis', 'nova', 'pierce', 'magnet', 'hp', 'speed', 'regen', 'factory', 'heal'],
    // Bloodstream late / IMMUNE PRIME: damage first, AoE for the swarm.
    preBoss: ['multi', 'dmg', 'rate', 'orbit', 'infect', 'lysis', 'nova', 'pierce', 'speed', 'hp', 'magnet', 'regen', 'factory', 'heal'],
    // Heart stage, no boss yet: damage + AoE + sustain mix.
    heart: ['multi', 'dmg', 'rate', 'orbit', 'nova', 'infect', 'lysis', 'pierce', 'speed', 'hp', 'regen', 'magnet', 'factory', 'heal'],
    // CARDIAC TITAN active: maximum damage.
    titan: ['multi', 'dmg', 'rate', 'pierce', 'nova', 'orbit', 'speed', 'hp', 'regen', 'lysis', 'magnet', 'infect', 'factory', 'heal'],
  },
  strained: {
    // Strained keeps its defensive bias (hp/regen higher) but damage still
    // leads: spawn pressure is higher, so the DPS race is tighter.
    early: ['dmg', 'multi', 'hp', 'rate', 'orbit', 'infect', 'regen', 'lysis', 'nova', 'pierce', 'magnet', 'speed', 'factory', 'heal'],
    preBoss: ['multi', 'dmg', 'hp', 'rate', 'speed', 'orbit', 'infect', 'pierce', 'regen', 'nova', 'lysis', 'magnet', 'factory', 'heal'],
    heart: ['dmg', 'multi', 'hp', 'regen', 'rate', 'speed', 'orbit', 'pierce', 'nova', 'lysis', 'magnet', 'infect', 'factory', 'heal'],
    titan: ['multi', 'dmg', 'hp', 'rate', 'regen', 'pierce', 'nova', 'orbit', 'speed', 'lysis', 'magnet', 'infect', 'factory', 'heal'],
  },
};

// Below this HP ratio an offered 'heal' beats everything except a legendary
// or an evolution (those are one-time offers — never skip them).
const HEAL_THRESHOLD = 0.3;
// Cycle 5 (survivability): the bot bleeds ~0.5-1 HP/s from ~30 s onward in
// every run (std-001: 100 -> 19 HP by 150 s; std-002: 100 -> 1 by 135 s)
// with zero sustain — regen was offered and passed every time. Regen is
// +0.6 HP/s per stack (UpgradeSystem.ts), so one stack nearly cancels the
// bleed and two (+1.2/s) out-heal it; over a 300 s run one early stack is
// worth ~+180 HP. 'hp' is +25 max HP and +25 HP immediately. The rules:
//   - hurt (hpRatio < 0.6) + 'hp' offered -> take it (immediate +25);
//   - regen stacks < 2 + 'regen' offered -> take it (compounds over time).
// Both sit below legendary/evolution/emergency-heal and above the damage
// tables. The tables themselves stay damage-first (the cycle-1 lesson
// stands: hp-first EARLY picks stall XP); the sustain rules are gated
// exceptions, not a table reorder. The bot's stacks come from the caller
// (CampaignBot tracks its own picks); without stacks info the regen rule
// treats the count as 0 and the game itself caps regen at 3 stacks.
const HP_HURT_THRESHOLD = 0.6;
const REGEN_STACK_CAP = 2;

function bucketFor(context) {
  if (context.bossKind === 'cardiac-titan') return 'titan';
  if (context.stageId === 'heart') return 'heart';
  if (context.bossKind === 'immune-prime') return 'preBoss';
  if (context.stageId === 'bloodstream' && context.stageTimeMs >= 150_000) return 'preBoss';
  return 'early';
}

function firstAvailable(priorityList, pendingChoices) {
  for (const id of priorityList) {
    if (pendingChoices.includes(id)) return id;
  }
  return null;
}

/**
 * @param {string[]} pendingChoices ids from readState().pendingChoices.
 * @param {object} context { difficultyId, stageId, stageTimeMs, phase,
 *   bossKind|null, hpRatio, stacks? } — stacks is the bot's own pick counts
 *   ({ regen: n, ... }); absent = unknown (regen rule assumes 0).
 * @returns {string} chosen id (always one of pendingChoices).
 */
function chooseUpgrade(pendingChoices, context) {
  if (!Array.isArray(pendingChoices) || pendingChoices.length === 0) {
    throw new Error('UpgradePolicy: no pending choices to pick from');
  }
  if (pendingChoices.length === 1) return pendingChoices[0];

  // 1. Legendary offers are one-time and run-defining: always take the best.
  const legendary = firstAvailable(LEGENDARY_PRIORITY, pendingChoices);
  if (legendary) return legendary;

  // 2. Evolution offers are one-time (recipe ready): always take the best.
  const evolution = firstAvailable(EVOLUTION_PRIORITY, pendingChoices);
  if (evolution) return evolution;

  // 3. Emergency heal when hurt.
  const hpRatio = Number.isFinite(context.hpRatio) ? context.hpRatio : 1;
  if (hpRatio <= HEAL_THRESHOLD && pendingChoices.includes('heal')) return 'heal';

  // 3b. Sustain (cycle 5): hurt + 'hp' offered -> +25 HP now.
  if (hpRatio < HP_HURT_THRESHOLD && pendingChoices.includes('hp')) return 'hp';

  // 3c. Sustain (cycle 5): regen below cap -> +0.6 HP/s for the rest of
  // the run. Value scales with remaining run time, so take it whenever
  // offered while under the cap.
  const regenStacks = (context.stacks && context.stacks.regen) || 0;
  if (regenStacks < REGEN_STACK_CAP && pendingChoices.includes('regen')) return 'regen';

  // 4. Deterministic table by difficulty + bucket.
  const table = (TABLES[context.difficultyId] || TABLES.standard)[bucketFor(context)];
  const pick = firstAvailable(table, pendingChoices);
  if (pick) return pick;

  // 5. Unknown ids (future upgrades): first offered — deterministic because
  // pendingChoices order itself is game-determined.
  return pendingChoices[0];
}

module.exports = {
  LEGENDARY_PRIORITY,
  EVOLUTION_PRIORITY,
  TABLES,
  HEAL_THRESHOLD,
  HP_HURT_THRESHOLD,
  REGEN_STACK_CAP,
  bucketFor,
  chooseUpgrade,
};
