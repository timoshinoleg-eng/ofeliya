import type { RunState } from './RunState';
import type { EvolutionId, UpgradeDef, UpgradeFamily } from './UpgradeSystem';

export type LegendaryId =
  | 'split-geometry'
  | 'lysis-chain'
  | 'zero-point'
  | 'core-predator'
  | 'myocardial-rhythm'
  | 'last-carrier';

export type LegendaryArchetype =
  | 'projectile'
  | 'lysis'
  | 'control'
  | 'boss'
  | 'heartbeat'
  | 'survival';

export interface LegendaryDefinition {
  id: LegendaryId;
  title: string;
  effect: string;
  desc: string;
  archetype: LegendaryArchetype;
  stage: 'any' | 'bloodstream' | 'heart';
  weight: number;
  prerequisites: readonly string[];
  forbiddenWith: readonly LegendaryId[];
  maxPerRun: 1;
  family: UpgradeFamily;
  /**
   * Применение карты в «Сердце» — строка трофейного экрана (только там, где
   * она есть). Механика уже описана в effect/desc; эта строка отвечает на
   * вопрос «как этим пользоваться в следующем органе».
   */
  heartHint?: string;
}

export const MAX_LEGENDARIES_PER_RUN = 2;
export const LEGENDARY_PITY_OFFERS = 8;
export const LEGENDARY_BASE_CHANCE = 0.1;
export const MAX_RANDOM_LEGENDARIES_BEFORE_FIRST_BOSS = 1;

export const LEGENDARIES: readonly LegendaryDefinition[] = [
  {
    id: 'split-geometry',
    title: 'ГЕОМЕТРИЯ РАСКОЛА',
    effect: 'Первое попадание делит снаряд на две копии под ±32°',
    desc: 'Копии наносят 45% урона и не пробивают врагов. Каждая копия может разделиться ещё раз — от одного выстрела не больше 6 копий.',
    archetype: 'projectile',
    stage: 'any',
    weight: 1,
    prerequisites: ['evo:prism'],
    forbiddenWith: [],
    maxPerRun: 1,
    family: 'weapon',
  },
  {
    id: 'lysis-chain',
    title: 'ЦЕПЬ ЛИЗИСА',
    effect: 'Лизис заражённой клетки бьёт две ближайшие цели за взрывом',
    desc: 'Две ближайшие цели за пределами взрыва получают 30% урона лизиса — через 140 и 220 мс. Гибель не гарантируется. Цепь не повторяется, отброса нет.',
    archetype: 'lysis',
    stage: 'any',
    weight: 1,
    prerequisites: ['evo:singularity'],
    forbiddenWith: [],
    maxPerRun: 1,
    family: 'weapon',
  },
  {
    id: 'zero-point',
    title: 'НУЛЕВАЯ ТОЧКА',
    effect: 'Каждые 12 секунд толпа стягивается в одну точку на 2,5 с',
    desc: 'Якорь — ближайший к тебе враг (не босс). Все враги в радиусе 190 тянутся к точке 2,5 с. Без подходящей цели попытка повторится через 1 с.',
    heartHint:
      'В Сердце: толпы плотнее и быстрее — стянутая группа удобна для круговой волны и взрывов. Боссы не стягиваются.',
    archetype: 'control',
    stage: 'any',
    weight: 0.9,
    prerequisites: [],
    forbiddenWith: [],
    maxPerRun: 1,
    family: 'core',
  },
  {
    id: 'core-predator',
    title: 'ХИЩНИК ЯДРА',
    effect: '4 попадания подряд по элитке или боссу открывают ядро на 1,5 с: урон +75%',
    desc: 'Счёт идёт по одной цели; перерыв больше 1,6 с сбрасывает его. Бонус получают попадания после четвёртого. Обычные враги ядра не получают.',
    heartHint:
      'В Сердце: держи огонь на элитках и КАРДИАЛЬНОМ ТИТАНЕ — ядро есть только у них. Перерыв между попаданиями больше 1,6 с сбрасывает счёт.',
    archetype: 'boss',
    stage: 'any',
    weight: 1,
    prerequisites: [],
    forbiddenWith: [],
    maxPerRun: 1,
    family: 'weapon',
  },
  {
    id: 'myocardial-rhythm',
    title: 'РИТМ МИОКАРДА',
    effect: 'Попадание снарядом после удара пульса взрывает цель: урон по площади рядом',
    desc: 'Только в Сердце. В момент удара пульса будь в безопасной зоне — откроется окно 850 мс. Первое попадание снарядом в окне взрывает поражённую цель: радиус 92, урон равен урону попадания, отброс 110. Один раз за удар пульса.',
    heartHint:
      'В Сердце: синхронизируйся с пульсом — окно открывается, только если ты в безопасной зоне в момент удара.',
    archetype: 'heartbeat',
    stage: 'heart',
    weight: 1.15,
    prerequisites: [],
    forbiddenWith: [],
    maxPerRun: 1,
    family: 'core',
  },
  {
    id: 'last-carrier',
    title: 'ПОСЛЕДНИЙ НОСИТЕЛЬ',
    effect: 'Один раз за забег отменяет гибель: остаётся 1 прочности',
    desc: 'Срабатывает само при смертельном уроне: 1 прочности, все враги, кроме боссов, исчезают. Цена — 25% прогресса текущего уровня. Форма вируса на 8 с — только облик.',
    archetype: 'survival',
    stage: 'any',
    weight: 0.72,
    prerequisites: [],
    forbiddenWith: [],
    maxPerRun: 1,
    family: 'defense',
  },
];

function prerequisiteMet(state: RunState, prerequisite: string): boolean {
  if (prerequisite.startsWith('evo:')) {
    return state.hasEvolution(prerequisite.slice(4) as EvolutionId);
  }
  return state.stackOf(prerequisite) > 0;
}

export function eligibleLegendaries(state: RunState): LegendaryDefinition[] {
  if (state.run.legendaryIds.size >= MAX_LEGENDARIES_PER_RUN) return [];
  return LEGENDARIES.filter((def) => {
    if (state.hasLegendary(def.id)) return false;
    if (def.stage !== 'any' && def.stage !== state.stage.id) return false;
    if (!def.prerequisites.every((id) => prerequisiteMet(state, id))) return false;
    if (def.forbiddenWith.some((id) => state.hasLegendary(id))) return false;
    return true;
  });
}

function toChoice(def: LegendaryDefinition): UpgradeDef {
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
    apply: (state) => {
      state.addLegendary(def.id);
    },
  };
}

function weightedPick(
  pool: readonly LegendaryDefinition[],
  rng: () => number
): LegendaryDefinition {
  const total = pool.reduce((sum, def) => sum + Math.max(0, def.weight), 0);
  if (total <= 0) return pool[0];
  let cursor = rng() * total;
  for (const def of pool) {
    cursor -= Math.max(0, def.weight);
    if (cursor <= 0) return def;
  }
  return pool[pool.length - 1];
}

export function guaranteedLegendaryChoices(
  state: RunState,
  count = 2,
  rng: () => number = Math.random
): UpgradeDef[] {
  const pool = [...eligibleLegendaries(state)];
  const picks: UpgradeDef[] = [];
  const limit = Math.max(0, Math.min(count, pool.length));

  while (picks.length < limit && pool.length > 0) {
    const picked = weightedPick(pool, rng);
    picks.push(toChoice(picked));
    pool.splice(pool.indexOf(picked), 1);
  }

  if (picks.length > 0) state.noteLegendaryOffer(true);
  return picks;
}

export function rollLegendaryChoice(
  state: RunState,
  rng: () => number = Math.random
): UpgradeDef | null {
  // Reserve the second run-wide Legendary slot for the IMMUNE PRIME trophy contract.
  // Random level-ups before the first boss may grant at most one Legendary.
  if (
    state.run.bossesDefeated === 0 &&
    state.run.legendaryIds.size >= MAX_RANDOM_LEGENDARIES_BEFORE_FIRST_BOSS
  ) {
    return null;
  }

  const eligible = eligibleLegendaries(state);
  if (eligible.length === 0) return null;

  const guaranteed = state.run.legendaryPity >= LEGENDARY_PITY_OFFERS;
  if (!guaranteed && rng() >= LEGENDARY_BASE_CHANCE) {
    state.noteLegendaryOffer(false);
    return null;
  }

  state.noteLegendaryOffer(true);
  return toChoice(weightedPick(eligible, rng));
}

export function getLegendaryDefinition(id: LegendaryId): LegendaryDefinition {
  const found = LEGENDARIES.find((def) => def.id === id);
  if (!found) throw new Error(`Unknown Legendary: ${id}`);
  return found;
}