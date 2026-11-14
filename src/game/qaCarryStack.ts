/**
 * QA — перенос одного стака мутации в «Сердце»: эксперимент «сохранить один
 * шаг билда при входе в Сердце».
 *
 * ЧТО ЭТО
 * -------
 * Экспериментальный кандидат. Штатный сброс стадии НЕ меняется:
 * `resetStageProgression` по-прежнему обнуляет уровень, XP, прочность,
 * максимум прочности, временные эффекты, стаки и стадийные эволюции.
 * Кандидат добавляет ровно ОДИН перенесённый стак обычной или редкой мутации.
 *
 * ПРАВИЛА ЭКСПЕРИМЕНТА (заданы владельцем, зафиксированы ДО замеров)
 * -------------------------------------------------------------------
 * 1. Переносится ОДИН стак ОДНОЙ мутации, которую игрок ДЕЙСТВИТЕЛЬНО взял
 *    в «Кровотоке» (проверяется по снимку `run.stageBuilds['bloodstream']`).
 * 2. Мутация задаётся явно (QA), без нового игрового экрана.
 * 3. Уровень, XP, прочность, временные эффекты и эволюции сбрасываются по
 *    действующим правилам игры.
 * 4. Ранее взятые легендарные сохраняются (они живут в `run.legendaryIds`).
 * 5. Переносимый стак НЕ открывает новое условие трофея: переносятся только
 *    обычные/редкие мутации, `stage.evolutions` остаётся пустым, поэтому
 *    условия легендарных (`hasEvolution`) не меняются.
 * 6. Переход не выдаёт лишний level-up (`queuedLevels = 0`, уровень = 1).
 * 7. Эффект перенесённой мутации применяется РОВНО ОДИН раз; следующий стак
 *    той же мутации, взятый в «Сердце», считается штатно (1 -> 2).
 *
 * ЧТО ЭТОТ МОДУЛЬ НЕ ДЕЛАЕТ
 * -------------------------
 * Не меняет `RunState.resetStageProgression`, не меняет правила трофея,
 * лимиты легендарных, эволюции, публичные режимы и формат чекпоинта.
 */

import type { RunState } from './RunState';
import { UPGRADES } from './UpgradeSystem';

export interface QaCarryStackState {
  /** Перенос включён (QA-переключатель). */
  enabled: boolean;
  /** id переносимой мутации (из `UPGRADES`). */
  mutationId: string | null;
  /** Требовать, чтобы мутация была действительно взята в «Кровотоке». */
  requireSource: boolean;
  /** Сколько стаков этой мутации было взято в «Кровотоке» (снимок). */
  sourceStacks: number;
  /** Перенос выполнен. */
  applied: boolean;
  /** Сколько стаков перенесено. */
  appliedStacks: number;
  /** Сколько раз применён эффект перенесённой мутации (должно быть ровно 1). */
  appliedEffects: number;
  /** id перенесённой мутации (факт). */
  appliedId: string | null;
}

const state: QaCarryStackState = {
  enabled: false,
  mutationId: null,
  requireSource: true,
  sourceStacks: 0,
  applied: false,
  appliedStacks: 0,
  appliedEffects: 0,
  appliedId: null,
};

/** Текущее состояние эксперимента (живой объект — читать из пробника). */
export function qaCarryStack(): QaCarryStackState {
  return state;
}

/** Сброс забега: счётчики переноса обнуляются, переключатель сохраняется. */
export function resetQaCarryStackRun(): void {
  const enabled = state.enabled;
  const mutationId = state.mutationId;
  const requireSource = state.requireSource;
  state.enabled = enabled;
  state.mutationId = mutationId;
  state.requireSource = requireSource;
  state.sourceStacks = 0;
  state.applied = false;
  state.appliedStacks = 0;
  state.appliedEffects = 0;
  state.appliedId = null;
}

/** Задать переносимую мутацию (QA). `null` — перенос выключен. */
export function setQaCarryStackMutation(mutationId: string | null): void {
  state.mutationId = mutationId;
  state.enabled = mutationId !== null;
  state.applied = false;
  state.appliedStacks = 0;
  state.appliedEffects = 0;
  state.appliedId = null;
  state.sourceStacks = 0;
}

/**
 * Перенос одного стака. Вызывается из `GameScene.resetStageWorld` сразу
 * после штатного `resetStageProgression` и ДО сборки трофея перехода.
 *
 * Возвращает true, если перенос состоялся.
 */
export function qaApplyCarryStack(s: RunState): boolean {
  if (!state.enabled) return false;
  if (state.applied) return false;
  const id = state.mutationId;
  if (!id) return false;

  const def = UPGRADES.find((u) => u.id === id);
  if (!def) return false;
  // Переносить можно только обычную или редкую мутацию — не эволюцию,
  // не легендарную (легендарные переживают переход сами по себе).
  if (def.kind === 'evolution' || def.kind === 'legendary') return false;

  // Мутация должна быть действительно взята в «Кровотоке».
  const build = s.run.stageBuilds['bloodstream'];
  const sourceStacks = build?.stacks?.[id] ?? 0;
  state.sourceStacks = sourceStacks;
  if (state.requireSource && sourceStacks < 1) return false;

  // Ровно один стак: эффект мутации применяется один раз, счётчик = 1.
  def.apply(s);
  s.bump(id);
  state.applied = true;
  state.appliedStacks = 1;
  state.appliedEffects = 1;
  state.appliedId = id;
  return true;
}
