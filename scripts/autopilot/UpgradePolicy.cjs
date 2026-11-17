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

// Priority tables: first listed available id wins. Survivability before the
// first boss, damage/attack speed before and during boss windows, defensive
// bias on Strained (§3.4).
const TABLES = {
  standard: {
    // Bloodstream before ~2:30: build the base — HP, speed, damage, magnet.
    early: ['hp', 'speed', 'dmg', 'rate', 'magnet', 'regen', 'infect', 'multi', 'pierce', 'orbit', 'nova', 'lysis', 'factory', 'heal'],
    // Bloodstream late / IMMUNE PRIME: damage first.
    preBoss: ['multi', 'dmg', 'rate', 'pierce', 'orbit', 'nova', 'speed', 'hp', 'lysis', 'magnet', 'infect', 'regen', 'factory', 'heal'],
    // Heart stage, no boss yet: damage + sustain mix.
    heart: ['multi', 'dmg', 'rate', 'orbit', 'nova', 'pierce', 'speed', 'hp', 'regen', 'lysis', 'magnet', 'infect', 'factory', 'heal'],
    // CARDIAC TITAN active: maximum damage.
    titan: ['multi', 'dmg', 'rate', 'pierce', 'nova', 'orbit', 'speed', 'hp', 'regen', 'lysis', 'magnet', 'infect', 'factory', 'heal'],
  },
  strained: {
    early: ['hp', 'regen', 'speed', 'dmg', 'magnet', 'rate', 'infect', 'multi', 'orbit', 'pierce', 'nova', 'lysis', 'factory', 'heal'],
    preBoss: ['multi', 'dmg', 'hp', 'rate', 'speed', 'pierce', 'orbit', 'regen', 'nova', 'lysis', 'magnet', 'infect', 'factory', 'heal'],
    heart: ['dmg', 'multi', 'hp', 'regen', 'rate', 'speed', 'orbit', 'pierce', 'nova', 'lysis', 'magnet', 'infect', 'factory', 'heal'],
    titan: ['multi', 'dmg', 'hp', 'rate', 'regen', 'pierce', 'nova', 'orbit', 'speed', 'lysis', 'magnet', 'infect', 'factory', 'heal'],
  },
};

// Below this HP ratio an offered 'heal' beats everything except a legendary
// or an evolution (those are one-time offers — never skip them).
const HEAL_THRESHOLD = 0.3;

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
 *   bossKind|null, hpRatio }
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
  bucketFor,
  chooseUpgrade,
};
