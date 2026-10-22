import type {
  QuestDefinition,
  QuestId,
  QuestMetric,
  QuestMetricMode,
  QuestMetricScope,
} from './questTypes';

/**
 * The quest catalog: the twelve goals of the Muse reference.
 *
 * The ids, the titles, the descriptions, the counters and the targets are the ones of
 * `src/game/quests/content/quests.ink` in the Muse patch stack, transcribed as plain
 * data. The Muse implementation reads them out of a compiled ink story at runtime; this
 * catalog is the same content without the inkjs dependency, the runtime and the
 * `reward_rna` tag.
 *
 * The reward is deliberately absent. In the Muse reference every quest carries a
 * `reward_rna` tag and the client pays it out on completion, which is a client-side
 * value grant and a second daily source. Here the reward table belongs to the server
 * (see `QuestRewardGateway`), so the catalog describes the goal and nothing else.
 */
export const QUEST_CATALOG: readonly QuestDefinition[] = [
  {
    id: 'slayer_1',
    title: 'Первая кровь',
    desc: 'Уничтожь 50 врагов за один забег',
    metric: 'q_kills',
    target: 50,
    family: 'combat',
  },
  {
    id: 'slayer_2',
    title: 'Гроза лейкоцитов',
    desc: 'Уничтожь 300 врагов за один забег',
    metric: 'q_kills',
    target: 300,
    family: 'combat',
  },
  {
    id: 'slayer_3',
    title: 'Эпидемия',
    desc: 'Уничтожь 1000 врагов за один забег',
    metric: 'q_kills',
    target: 1000,
    family: 'combat',
  },
  {
    id: 'hoarder_1',
    title: 'Собиратель',
    desc: 'Собери 500 РНК за один забег',
    metric: 'q_rna',
    target: 500,
    family: 'progress',
  },
  {
    id: 'hoarder_2',
    title: 'Жадный штамм',
    desc: 'Собери 2000 РНК за один забег',
    metric: 'q_rna',
    target: 2000,
    family: 'progress',
  },
  {
    id: 'survivor_1',
    title: 'Живучий',
    desc: 'Переживи 3 минуты в одном забеге',
    metric: 'q_time',
    target: 180,
    family: 'survival',
  },
  {
    id: 'survivor_2',
    title: 'Неубиваемый',
    desc: 'Переживи 5 минут в одном забеге',
    metric: 'q_time',
    target: 300,
    family: 'survival',
  },
  {
    id: 'ghost',
    title: 'Невидимка',
    desc: '60 секунд подряд без урона',
    metric: 'q_nodmg',
    target: 60,
    family: 'survival',
  },
  {
    id: 'mutant_1',
    title: 'Мутант',
    desc: 'Выбери 3 мутации за один забег',
    metric: 'q_mut',
    target: 3,
    family: 'progress',
  },
  {
    id: 'hunter',
    title: 'Охотник за элитой',
    desc: 'Уничтожь 5 элитных врагов за один забег',
    metric: 'q_elites',
    target: 5,
    family: 'combat',
  },
  {
    id: 'marathon',
    title: 'Марафонец',
    desc: 'Заверши 3 забега (суммарно)',
    metric: 'q_runs',
    target: 3,
    family: 'mastery',
  },
  {
    id: 'veteran',
    title: 'Ветеран штамма',
    desc: 'Заверши 10 забегов (суммарно)',
    metric: 'q_runs',
    target: 10,
    family: 'mastery',
  },
];

/** How every metric moves when an event is applied. */
export const QUEST_METRIC_MODES: Record<QuestMetric, QuestMetricMode> = {
  q_kills: 'accumulate',
  q_rna: 'accumulate',
  q_time: 'peak',
  q_mut: 'accumulate',
  q_elites: 'accumulate',
  q_nodmg: 'peak',
  q_runs: 'accumulate',
};

/** The scope every metric is measured in. */
export const QUEST_METRIC_SCOPES: Record<QuestMetric, QuestMetricScope> = {
  q_kills: 'run',
  q_rna: 'run',
  q_time: 'run',
  q_mut: 'run',
  q_elites: 'run',
  q_nodmg: 'day',
  q_runs: 'lifetime',
};

/**
 * Metrics that are reset when a run starts.
 *
 * Their day baseline is the value they had when the day started, so only the progress
 * made during the current day counts towards the goal.
 */
export const RUN_SCOPED_METRICS: readonly QuestMetric[] = [
  'q_kills',
  'q_rna',
  'q_time',
  'q_mut',
  'q_elites',
];

/**
 * Metrics that belong to the UTC day.
 *
 * The value is the best result of the day across every run of that day. The streak of
 * yesterday is not a streak of today, so the day has to start from zero.
 */
export const DAY_SCOPED_METRICS: readonly QuestMetric[] = ['q_nodmg'];

/**
 * Metrics that survive every run and every day.
 *
 * The quest core never counts these. They are mirrored from the product save through
 * `syncLifetime()`, so the quest screen cannot become a second source of truth.
 */
export const LIFETIME_METRICS: readonly QuestMetric[] = ['q_runs'];

/**
 * Maps a lifetime metric onto the field of the mirror that holds it.
 *
 * The metric names are the stable public vocabulary of the quest catalog, while the
 * mirror keeps the camelCase spelling the product save already uses.
 */
export const LIFETIME_METRIC_KEYS = {
  q_runs: 'completedRuns',
} as const;

export type LifetimeMetric = keyof typeof LIFETIME_METRIC_KEYS;

export function findQuestDefinition(
  catalog: readonly QuestDefinition[],
  questId: QuestId
): QuestDefinition | undefined {
  return catalog.find((quest) => quest.id === questId);
}
