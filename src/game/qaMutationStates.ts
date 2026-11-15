import { UPGRADES, type EvolutionId, type UpgradeDef } from './UpgradeSystem';
import { getEvolutionDef } from './EvolutionSystem';
import { getLegendaryDefinition, type LegendaryId } from './LegendarySystem';
import type { RunState } from './RunState';

/**
 * QA-only fixed mutation-choice states (A/B/C) for the choice-screen work.
 *
 * Open a state through the REAL interface: build the game with
 * VITE_QA_TOOLS=1 (or run dev) and open
 *
 *   ?qaMutation=A   last-carrier + infect + lysis, fresh run
 *   ?qaMutation=B   magnet + infect + lysis, stacks nova 3/3 + magnet 1/2
 *   ?qaMutation=C   evo:singularity + infect + lysis, stacks nova 3/3 + magnet 2/2
 *   ?qaMutation=D   speed + infect + lysis, stacks orbit 3/3 + rate 1/2
 *                   (альтернативный шаг рецепта «СВЕРХКАПСИД» честно
 *                   остаётся 1/2 без ложной стрелки «→ 2/2»)
 *   ?qaMutation=E   dmg + infect + lysis, stacks dmg 3/3 + pierce 2/2,
 *                   эволюция «ГИПЕРШИП» УЖЕ получена — блок рецепта на
 *                   карточке компонента скрыт (нет обещания повторной выдачи)
 *
 * The GameScene seam applies the fixed stacks through the real card apply()
 * and exposes the fixed choices through the normal pendingChoices/awaitingChoice
 * path, so UIScene opens the level-up modal exactly as it does for a real
 * level-up. Choice, pause and return to battle stay on the ordinary game path.
 *
 * Without the QA gate (DEV / VITE_QA_TOOLS=1) the parameter is ignored and
 * this module changes nothing. Pure and node-testable.
 */

export type QaMutationStateId = 'A' | 'B' | 'C' | 'D' | 'E';

export interface QaMutationFixture {
  id: QaMutationStateId;
  /** Card ids applied as stacks through the real apply() before the offer. */
  stacks: readonly string[];
  /** Эволюции, уже полученные к моменту предложения. */
  evolutionIds?: readonly EvolutionId[];
  /** The three offered choices, built from the game's own definitions. */
  choices: readonly UpgradeDef[];
}

function upgradeDef(id: string): UpgradeDef {
  const def = UPGRADES.find((u) => u.id === id);
  if (!def) throw new Error(`qaMutationStates: unknown upgrade ${id}`);
  return def;
}

/** Same mapping EvolutionSystem.toChoice uses, built from the real def. */
function evolutionChoice(id: Parameters<typeof getEvolutionDef>[0]): UpgradeDef {
  const def = getEvolutionDef(id);
  return {
    id: `evo:${def.id}`,
    shortName: def.name,
    name: def.effect,
    desc: `${def.recipe}\n${def.desc}`,
    max: 1,
    family: 'weapon',
    rarity: 'rare',
    kind: 'evolution',
    evolutionId: def.id,
    showProgress: false,
    apply: (s) => {
      s.addEvolution(def.id);
    },
  };
}

/** Same mapping LegendarySystem.toChoice uses, built from the real def. */
function legendaryChoice(id: LegendaryId): UpgradeDef {
  const def = getLegendaryDefinition(id);
  return {
    id: `legendary:${def.id}`,
    shortName: def.title,
    name: def.effect,
    desc: def.desc,
    max: 1,
    family: def.family,
    rarity: 'legendary',
    kind: 'legendary',
    legendaryId: def.id,
    showProgress: false,
    apply: (s) => {
      s.addLegendary(def.id);
    },
  };
}

const FIXTURES: Record<QaMutationStateId, QaMutationFixture> = {
  A: {
    id: 'A',
    stacks: [],
    choices: [legendaryChoice('last-carrier'), upgradeDef('infect'), upgradeDef('lysis')],
  },
  B: {
    id: 'B',
    stacks: ['nova', 'nova', 'nova', 'magnet'],
    choices: [upgradeDef('magnet'), upgradeDef('infect'), upgradeDef('lysis')],
  },
  C: {
    id: 'C',
    stacks: ['nova', 'nova', 'nova', 'magnet', 'magnet'],
    choices: [evolutionChoice('singularity'), upgradeDef('infect'), upgradeDef('lysis')],
  },
  // P2-регрессия: первая «Подвижность» при Спутниках III + Репликации I
  // оставляет альтернативный шаг рецепта на 1/2 — карточка не обещает 2/2.
  D: {
    id: 'D',
    stacks: ['orbit', 'orbit', 'orbit', 'rate'],
    choices: [upgradeDef('speed'), upgradeDef('infect'), upgradeDef('lysis')],
  },
  // P2-регрессия: «Гипершип» уже получен — блок рецепта на карточке его
  // компонента скрыт, повторной выдачи карточка не обещает.
  E: {
    id: 'E',
    stacks: ['dmg', 'dmg', 'dmg', 'pierce', 'pierce'],
    evolutionIds: ['prism'],
    choices: [upgradeDef('dmg'), upgradeDef('infect'), upgradeDef('lysis')],
  },
};

/** Parse the ?qaMutation= parameter. Unknown/absent -> null (no-op). */
export function parseQaMutationState(search: string): QaMutationFixture | null {
  const raw = new URLSearchParams(search.replace(/^\?/, '')).get('qaMutation');
  if (raw === 'A' || raw === 'B' || raw === 'C' || raw === 'D' || raw === 'E') {
    return FIXTURES[raw];
  }
  return null;
}

/**
 * Apply the fixture to a live run state: the fixed stacks go through each
 * card's real apply() + bump, exactly like real picks. State B/C therefore
 * reach the offer with the same numbers a real run would have.
 */
export function applyQaMutationFixture(s: RunState, fixture: QaMutationFixture): void {
  for (const id of fixture.evolutionIds ?? []) {
    s.addEvolution(id);
  }
  for (const id of fixture.stacks) {
    const def = upgradeDef(id);
    def.apply(s);
    s.bump(id);
  }
}
