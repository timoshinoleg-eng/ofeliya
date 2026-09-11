import type { RunState } from './RunState';
import {
  EVOLUTION_NAMES,
  rollChoices,
  type EvolutionId,
  type UpgradeDef,
} from './UpgradeSystem';

export interface EvolutionDef {
  id: EvolutionId;
  name: string;
  effect: string;
  desc: string;
  recipe: string;
  eligible: (s: RunState) => boolean;
}

export const EVOLUTIONS: EvolutionDef[] = [
  {
    id: 'prism',
    name: EVOLUTION_NAMES.prism,
    effect: 'Шиповые белки удлиняются · пробивание +1',
    desc: 'Вирусные частицы получают агрессивный светящийся след и глубже проходят через иммунные клетки.',
    recipe: 'БЕЛКОВЫЕ ШИПЫ III + ПРОНИКНОВЕНИЕ II',
    eligible: (s) => s.stackOf('dmg') >= 3 && s.stackOf('pierce') >= 2,
  },
  {
    id: 'halo',
    name: EVOLUTION_NAMES.halo,
    effect: 'Капсид формирует многослойную защитную оболочку',
    desc: 'Орбитальные белковые фрагменты синхронизируются в заметный внешний слой штамма.',
    recipe: 'КАПСИДНЫЕ СПУТНИКИ III + ПОДВИЖНОСТЬ/РЕПЛИКАЦИЯ II',
    eligible: (s) =>
      s.stackOf('orbit') >= 3 && (s.stackOf('speed') >= 2 || s.stackOf('rate') >= 2),
  },
  {
    id: 'singularity',
    name: EVOLUTION_NAMES.singularity,
    effect: 'Мембрана схлопывается перед мощным лизис-импульсом',
    desc: 'Каждый импульс получает фазу стягивания биоматерии и последующий разрыв наружу.',
    recipe: 'ЛИЗИС-ПУЛЬС III + РНК-АФФИНИТЕТ II',
    eligible: (s) => s.stackOf('nova') >= 3 && s.stackOf('magnet') >= 2,
  },
];

export function getEvolutionDef(id: EvolutionId): EvolutionDef {
  const def = EVOLUTIONS.find((e) => e.id === id);
  if (!def) throw new Error(`Unknown evolution: ${id}`);
  return def;
}

export function readyEvolutions(s: RunState): EvolutionDef[] {
  return EVOLUTIONS.filter((e) => !s.hasEvolution(e.id) && e.eligible(s));
}

function toChoice(def: EvolutionDef): UpgradeDef {
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

/**
 * Критические мутации не встроены в rollChoices(): они отдельным приоритетным слоем
 * резервируют слоты, а оставшиеся места заполняются обычными мутациями. Невыбранная
 * готовая критическая мутация снова появится при следующем level-up.
 */
export function rollRunChoices(s: RunState, n = 3): UpgradeDef[] {
  const ready = readyEvolutions(s).slice(0, n).map(toChoice);
  if (ready.length >= n) return ready;
  return [...ready, ...rollChoices(s, n - ready.length)];
}
