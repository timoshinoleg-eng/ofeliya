import type { LegendaryId } from './LegendarySystem';
import type { StageBuildResult } from './RunContracts';
import type { EvolutionId } from './UpgradeSystem';

export type RunIdentityId = 'projectile' | 'orbit-control' | 'infection-lysis' | 'hybrid';

export interface RunIdentityInput {
  stacks: Record<string, number>;
  stageBuilds?: Partial<Record<string, StageBuildResult>>;
  evolutions: readonly EvolutionId[];
  legendaryIds: readonly LegendaryId[];
  hostCellsInfected: number;
}

export interface RunIdentityAssessment {
  id: RunIdentityId;
  label: string;
  shortLabel: string;
  description: string;
  score: number;
  runnerUpScore: number;
  focused: boolean;
  signals: string[];
}

export interface MasteryDiscoveryInput {
  evolutionsSeen: readonly EvolutionId[];
  legendarySeen: readonly LegendaryId[];
}

export interface MasteryTrack {
  id: Exclude<RunIdentityId, 'hybrid'>;
  label: string;
  progress: number;
  max: 2;
  complete: boolean;
  objective: string;
  nextGoal: string;
}

type IdentityScore = {
  id: Exclude<RunIdentityId, 'hybrid'>;
  score: number;
  signals: string[];
};

const LABELS: Record<RunIdentityId, { label: string; shortLabel: string; description: string }> = {
  projectile: {
    label: 'ПРОЕКТИЛЬНЫЙ ШТАММ',
    shortLabel: 'ПРОЕКТИЛЬНЫЙ',
    description: 'Ставка на залп, пробивание и урон снарядов.',
  },
  'orbit-control': {
    label: 'ОРБИТАЛЬНЫЙ КОНТРОЛЬ',
    shortLabel: 'КОНТРОЛЬ',
    description: 'Ставка на спутники, импульсы, мобильность и управление толпой.',
  },
  'infection-lysis': {
    label: 'ИНФЕКЦИЯ / ЛИЗИС',
    shortLabel: 'ЛИЗИС',
    description: 'Ставка на заражение клеток, разрыв мембраны и цепные эффекты.',
  },
  hybrid: {
    label: 'ГИБРИДНЫЙ ШТАММ',
    shortLabel: 'ГИБРИД',
    description: 'Сила распределена между несколькими ветвями без одной доминирующей.',
  },
};

function safeStack(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function mergedStacks(input: RunIdentityInput): Record<string, number> {
  const merged: Record<string, number> = {};
  const absorb = (stacks: Record<string, number> | undefined) => {
    if (!stacks) return;
    for (const [id, value] of Object.entries(stacks)) {
      merged[id] = Math.max(merged[id] ?? 0, safeStack(value));
    }
  };

  absorb(input.stacks);
  for (const build of Object.values(input.stageBuilds ?? {})) absorb(build?.stacks);
  return merged;
}

function scoreIdentity(input: RunIdentityInput): IdentityScore[] {
  const s = mergedStacks(input);
  const evolutions = new Set(input.evolutions);
  const legendary = new Set(input.legendaryIds);
  const cells = Math.max(0, Number.isFinite(input.hostCellsInfected) ? input.hostCellsInfected : 0);

  const projectileSignals: string[] = [];
  let projectile = safeStack(s.dmg) + safeStack(s.rate) * 0.8;
  projectile += safeStack(s.multi) * 1.7 + safeStack(s.pierce) * 1.9;
  if (safeStack(s.multi) >= 2) projectileSignals.push('многозарядность');
  if (safeStack(s.pierce) >= 2) projectileSignals.push('пробивание');
  if (evolutions.has('prism')) {
    projectile += 4;
    projectileSignals.push('ГИПЕРШИП');
  }
  if (legendary.has('split-geometry')) {
    projectile += 4;
    projectileSignals.push('ГЕОМЕТРИЯ РАСКОЛА');
  }
  if (legendary.has('core-predator')) {
    projectile += 2;
    projectileSignals.push('ХИЩНИК ЯДРА');
  }

  const controlSignals: string[] = [];
  let control = safeStack(s.orbit) * 2 + safeStack(s.nova) * 1.5;
  control += safeStack(s.speed) * 0.6 + safeStack(s.magnet) * 0.45;
  if (safeStack(s.orbit) >= 2) controlSignals.push('спутники');
  if (safeStack(s.nova) >= 2) controlSignals.push('импульсы');
  if (evolutions.has('halo')) {
    control += 4;
    controlSignals.push('СВЕРХКАПСИД');
  }
  if (legendary.has('zero-point')) {
    control += 3.5;
    controlSignals.push('НУЛЕВАЯ ТОЧКА');
  }
  if (legendary.has('myocardial-rhythm')) {
    control += 1.5;
    controlSignals.push('РИТМ МИОКАРДА');
  }

  const lysisSignals: string[] = [];
  let lysis = safeStack(s.infect) * 2 + safeStack(s.lysis) * 2.2 + safeStack(s.factory) * 1.8;
  lysis += Math.min(6, cells) * 0.45;
  if (safeStack(s.infect) >= 2) lysisSignals.push('быстрое заражение');
  if (safeStack(s.lysis) >= 2) lysisSignals.push('усиленный лизис');
  if (safeStack(s.factory) >= 1) lysisSignals.push('вирусная фабрика');
  if (cells >= 4) lysisSignals.push('клеточный маршрут');
  if (evolutions.has('singularity')) {
    lysis += 2;
    lysisSignals.push('СИНГУЛЯРНОСТЬ');
  }
  if (legendary.has('lysis-chain')) {
    lysis += 4;
    lysisSignals.push('ЦЕПЬ ЛИЗИСА');
  }

  return [
    { id: 'projectile', score: projectile, signals: projectileSignals },
    { id: 'orbit-control', score: control, signals: controlSignals },
    { id: 'infection-lysis', score: lysis, signals: lysisSignals },
  ].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/**
 * Classifies the build that actually emerged during the run. It never modifies gameplay and uses
 * max per-stage stack depth so Bloodstream/Heart resets do not double-count the same investment.
 */
export function assessRunIdentity(input: RunIdentityInput): RunIdentityAssessment {
  const scores = scoreIdentity(input);
  const top = scores[0];
  const runnerUp = scores[1];
  const margin = top.score - runnerUp.score;
  const focused = top.score >= 5 && margin >= 1.75;
  const id: RunIdentityId = focused ? top.id : 'hybrid';
  const copy = LABELS[id];

  return {
    id,
    label: copy.label,
    shortLabel: copy.shortLabel,
    description: copy.description,
    score: top.score,
    runnerUpScore: runnerUp.score,
    focused,
    signals: focused ? top.signals.slice(0, 3) : scores.flatMap((score) => score.signals).slice(0, 3),
  };
}

export function masteryTracks(input: MasteryDiscoveryInput): MasteryTrack[] {
  const evolutions = new Set(input.evolutionsSeen);
  const legendary = new Set(input.legendarySeen);

  const definitions: Array<{
    id: Exclude<RunIdentityId, 'hybrid'>;
    label: string;
    evolution: EvolutionId;
    legendary: LegendaryId;
    objective: string;
    firstGoal: string;
    secondGoal: string;
  }> = [
    {
      id: 'projectile',
      label: 'ПРОЕКТИЛЬНЫЙ ШТАММ',
      evolution: 'prism',
      legendary: 'split-geometry',
      objective: 'ГИПЕРШИП + ГЕОМЕТРИЯ РАСКОЛА',
      firstGoal: 'Открой ГИПЕРШИП',
      secondGoal: 'Найди ГЕОМЕТРИЮ РАСКОЛА',
    },
    {
      id: 'orbit-control',
      label: 'ОРБИТАЛЬНЫЙ КОНТРОЛЬ',
      evolution: 'halo',
      legendary: 'zero-point',
      objective: 'СВЕРХКАПСИД + НУЛЕВАЯ ТОЧКА',
      firstGoal: 'Открой СВЕРХКАПСИД',
      secondGoal: 'Найди НУЛЕВУЮ ТОЧКУ',
    },
    {
      id: 'infection-lysis',
      label: 'ИНФЕКЦИЯ / ЛИЗИС',
      evolution: 'singularity',
      legendary: 'lysis-chain',
      objective: 'СИНГУЛЯРНОСТЬ + ЦЕПЬ ЛИЗИСА',
      firstGoal: 'Открой СИНГУЛЯРНОСТЬ',
      secondGoal: 'Найди ЦЕПЬ ЛИЗИСА',
    },
  ];

  return definitions.map((def) => {
    const evolutionFound = evolutions.has(def.evolution);
    const legendaryFound = legendary.has(def.legendary);
    const progress = Number(evolutionFound) + Number(legendaryFound);
    return {
      id: def.id,
      label: def.label,
      progress,
      max: 2 as const,
      complete: progress === 2,
      objective: def.objective,
      nextGoal: !evolutionFound ? def.firstGoal : !legendaryFound ? def.secondGoal : 'Ветка освоена',
    };
  });
}

export function nextMasteryGoal(
  identity: RunIdentityAssessment,
  discovery: MasteryDiscoveryInput
): string {
  const tracks = masteryTracks(discovery);
  if (identity.id !== 'hybrid') {
    return tracks.find((track) => track.id === identity.id)?.nextGoal ?? 'Продолжай исследовать ветку';
  }
  const next = [...tracks].sort((a, b) => a.progress - b.progress || a.id.localeCompare(b.id))[0];
  return next?.nextGoal ?? 'Собери выраженную ветвь штамма';
}
