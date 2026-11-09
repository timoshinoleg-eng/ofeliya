import { RunState } from './RunState';
import { getEvolutionDef, readyEvolutions, type EvolutionDef } from './EvolutionSystem';
import { UPGRADES, type EvolutionId, type UpgradeDef } from './UpgradeSystem';

/**
 * Прогресс рецепта эволюции для блока на обычной карточке (экран B).
 *
 * Карточка с `evolutionHint` показывает не стрелку «→ эволюция», а сам рецепт:
 * каждый шаг с фактическим стеком, отметку выполненного и подсветку того
 * условия, которое карточка продвигает. Пояснение живёт внутри блока рецепта —
 * отдельной служебной плашки «справка» нет.
 *
 * Все числа считаются из живого RunState; «закроет ли выбор рецепт» проверяется
 * настоящим apply() карточки против клона состояния (тот же приём, что и в
 * upgradeBeforeAfter): переданное состояние не мутируется.
 */

export interface RecipeRow {
  /** Имя ветки — shortName карточки ветки или имя группы альтернатив. */
  label: string;
  /** Фактический стек (максимум по группе альтернатив). */
  current: number;
  /** Требуемый стек. */
  target: number;
  /** Эту ветку продвигает предложенная карточка. */
  advances: boolean;
  /** Условие уже выполнено. */
  done: boolean;
}

export interface RecipeProgress {
  /** Определение эволюции, чей рецепт показан. */
  evolution: EvolutionDef;
  /** Шаги в порядке рецепта. */
  rows: RecipeRow[];
  /**
   * Выбор карточки закрывает последнее условие: после apply() эволюция
   * станет предложенной (сама не применится).
   */
  completes: boolean;
}

function cloneState(s: RunState): RunState {
  const clone = new RunState({ id: s.stage.id, order: s.stage.order });
  clone.stage = {
    ...s.stage,
    stacks: { ...s.stage.stacks },
    evolutions: new Set(s.stage.evolutions),
  };
  return clone;
}

function stepLabel(step: EvolutionDef['steps'][number]): string {
  if (step.label) return step.label;
  const def = UPGRADES.find((u) => u.id === step.ids[0]);
  return def ? def.shortName : step.ids[0].toUpperCase();
}

/**
 * Прогресс рецепта эволюции `evoId` с точки зрения предложенной карточки
 * `card`. Возвращает null, если эволюция неизвестна.
 */
export function getRecipeProgress(
  s: RunState,
  evoId: EvolutionId,
  card: UpgradeDef
): RecipeProgress | null {
  let evolution: EvolutionDef;
  try {
    evolution = getEvolutionDef(evoId);
  } catch {
    return null;
  }
  const rows: RecipeRow[] = evolution.steps.map((step) => {
    const current = Math.max(0, ...step.ids.map((id) => s.stackOf(id)));
    return {
      label: stepLabel(step),
      current,
      target: step.target,
      advances: step.ids.includes(card.id),
      done: current >= step.target,
    };
  });
  const after = cloneState(s);
  // Выбор в игре — это apply() + bump() (счётчик стека); без bump прогресс
  // рецепта не сдвинется, и «закроет ли карточка рецепт» всегда было бы ложно.
  card.apply(after);
  after.bump(card.id);
  const completes = readyEvolutions(after).some((e) => e.id === evoId);
  return { evolution, rows, completes };
}

/**
 * Одна строка шага рецепта: «Мембранный импульс — 3/3 ✓» для выполненного,
 * «РНК-аффинитет — 1/2 → 2/2» для ветки, которую продвигает карточка,
 * «Подвижность или Репликация — 1/2» в остальных случаях.
 */
export function formatRecipeRow(row: RecipeRow): string {
  const base = `${row.label} — ${row.current}/${row.target}`;
  if (row.done) return `${base} ✓`;
  if (row.advances) return `${base} → ${row.current + 1}/${row.target}`;
  return base;
}

/**
 * Пояснение внутри блока рецепта. Два случая из брифа: карточка закрывает
 * последнее условие (рецепт будет готов) или только приближает к нему
 * (перечисляем, что останется).
 */
export function formatRecipeNote(progress: RecipeProgress): string {
  const name = progress.evolution.name;
  if (progress.completes) {
    return `После выбора рецепт будет готов. «${name}» выбирается отдельной картой.`;
  }
  const remaining = progress.rows
    .filter((row) => !row.done && !row.advances)
    .map((row) => `${row.label.toLowerCase()} ${row.current}/${row.target}`);
  const tail =
    remaining.length > 0
      ? `Останется: ${remaining.join(', ')}. `
      : '';
  return `${tail}«${name}» появится отдельной картой, когда рецепт будет готов.`;
}

/** Заголовок блока рецепта: последнее условие отмечено отдельно. */
export function formatRecipeTitle(progress: RecipeProgress): string {
  return progress.completes
    ? `Рецепт «${progress.evolution.name}» — последнее условие`
    : `Рецепт «${progress.evolution.name}»`;
}
