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
    effect: 'Импульс становится призматическим · пробивание +1',
    desc: 'Золотой энергетический след и более глубокий сквозной удар.',
    recipe: 'УСИЛЕНИЕ ИМПУЛЬСА III + СКВОЗНОЙ СИГНАЛ II',
    eligible: (s) => s.stackOf('dmg') >= 3 && s.stackOf('pierce') >= 2,
  },
  {
    id: 'halo',
    name: EVOLUTION_NAMES.halo,
    effect: 'Клинки синхронизируются в световое кольцо',
    desc: 'Орбитальная защита получает отдельный золотой визуальный контур.',
    recipe: 'КОЛЬЦО ЗАЩИТЫ III + УСКОРЕНИЕ/РАЗГОН II',
    eligible: (s) =>
      s.stackOf('orbit') >= 3 && (s.stackOf('speed') >= 2 || s.stackOf('rate') >= 2),
  },
  {
    id: 'singularity',
    name: EVOLUTION_NAMES.singularity,
    effect: 'Волна ядра схлопывается перед ударной волной',
    desc: 'Каждая Нова получает выраженную фазу имплозии и новый визуальный ритм.',
    recipe: 'ВОЛНА ЯДРА III + ПОЛЕ СБОРА II',
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
 * Эволюции не встроены в rollChoices(): они отдельным приоритетным слоем резервируют
 * слоты, а оставшиеся места заполняются обычными улучшениями. Невыбранная готовая
 * эволюция снова появится при следующем level-up.
 */
export function rollRunChoices(s: RunState, n = 3): UpgradeDef[] {
  const ready = readyEvolutions(s).slice(0, n).map(toChoice);
  if (ready.length >= n) return ready;
  return [...ready, ...rollChoices(s, n - ready.length)];
}
