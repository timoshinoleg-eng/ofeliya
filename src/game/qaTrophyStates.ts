import { type UpgradeDef } from './UpgradeSystem';
import { getLegendaryDefinition, type LegendaryId } from './LegendarySystem';
import type { RunState } from './RunState';

/**
 * QA-only fixed trophy states (после «ИММУННОГО ПРАЙМА») для приёмки
 * трофейного экрана на телефоне.
 *
 * Открыть через тот же QA-гейт, что и ?qaMutation (DEV / VITE_QA_TOOLS=1):
 *
 *   ?qaTrophy=fresh   0 легендарных до босса; карты «ХИЩНИК ЯДРА» + «НУЛЕВАЯ ТОЧКА»
 *   ?qaTrophy=one     1 легендарная до босса («ПОСЛЕДНИЙ НОСИТЕЛЬ», не тронут);
 *                     та же пара карт — сноска «последняя легендарная»
 *   ?qaTrophy=used    как one, но спасение носителя уже потрачено в «Кровотоке»
 *   ?qaTrophy=rhythm  длинное условие: «РИТМ МИОКАРДА» + «ХИЩНИК ЯДРА», стадия — Сердце
 *
 * Как и qaMutationStates, фикстура подменяет только предложение: выбор, пауза,
 * церемония и возврат в бой идут штатным путём GameScene/UIScene. Без гейта
 * параметр игнорируется и модуль ничего не меняет. Pure and node-testable.
 */

export type QaTrophyStateId = 'fresh' | 'one' | 'used' | 'rhythm';

export interface QaTrophyFixture {
  id: QaTrophyStateId;
  /** Легендарная, уже взятая до босса (0 или 1 — от неё зависит сноска). */
  preLegendary: readonly LegendaryId[];
  /** Спасение «Последнего носителя» уже потрачено (переход с использованной страховкой). */
  carrierSpent: boolean;
  /** Стадия для фикстуры: 'heart' ставит забег в «Сердце» (пул ритма). */
  stage: 'bloodstream' | 'heart';
  /** Закреплённые карты трофея, построенные из игровых определений. */
  choices: readonly UpgradeDef[];
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

const TROPHY_PAIR: readonly UpgradeDef[] = [
  legendaryChoice('core-predator'),
  legendaryChoice('zero-point'),
];

const FIXTURES: Record<QaTrophyStateId, QaTrophyFixture> = {
  fresh: {
    id: 'fresh',
    preLegendary: [],
    carrierSpent: false,
    stage: 'bloodstream',
    choices: TROPHY_PAIR,
  },
  one: {
    id: 'one',
    preLegendary: ['last-carrier'],
    carrierSpent: false,
    stage: 'bloodstream',
    choices: TROPHY_PAIR,
  },
  used: {
    id: 'used',
    preLegendary: ['last-carrier'],
    carrierSpent: true,
    stage: 'bloodstream',
    choices: TROPHY_PAIR,
  },
  rhythm: {
    id: 'rhythm',
    preLegendary: [],
    carrierSpent: false,
    stage: 'heart',
    choices: [legendaryChoice('myocardial-rhythm'), legendaryChoice('core-predator')],
  },
};

/** Parse the ?qaTrophy= parameter. Unknown/absent -> null (no-op). */
export function parseQaTrophyState(search: string): QaTrophyFixture | null {
  const raw = new URLSearchParams(search.replace(/^\?/, '')).get('qaTrophy');
  if (raw === 'fresh' || raw === 'one' || raw === 'used' || raw === 'rhythm') {
    return FIXTURES[raw];
  }
  return null;
}

/**
 * Apply the fixture to a live run state: доведённая до босса легендарная идёт
 * через настоящий addLegendary(), стадия — через resetStageProgression('heart')
 * у вызывающего кода, если фикстура просит 'heart'.
 */
export function applyQaTrophyFixture(s: RunState, fixture: QaTrophyFixture): void {
  for (const id of fixture.preLegendary) s.addLegendary(id);
}
