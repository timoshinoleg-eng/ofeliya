/**
 * LabModifiers — чистые множители лаборатории (Фаза 4), Plain-number порт.
 *
 * Математика — plain numbers: metaRnaMul / startHpMul / magnetMul — числа
 * (без Decimal, как и весь порт Фазы 4; см. LabBranches.ts).
 * Вход — состояние лаборатории, выход — множители.
 *
 * Поведение:
 * - metabolism: metaRnaMul = 1 + 0.1 * level (ур. 20 → 3.0) × prestigeBonus.
 * - chitin: startHpMul = 1 + 0.08 * level (ур. 15 → 2.2).
 * - chemotaxis: magnetMul = 1 + 0.12 * level (ур. 10 → 2.2).
 * - При нулевых уровнях все множители = 1 (лаборатория не куплена — игра
 *   идентична до-Фазе-4; это же делает сейв-совместимость тривиальной).
 * - Неизвестные ветки в levels игнорируются (защита от будущих удалений).
 */

import { getLabBranch, prestigeBonus } from './LabBranches';
import type { LabState } from './LabState';

export interface LabModifiers {
  /** Множитель дохода meta-RNA (метаболизм × престиж). */
  metaRnaMul: number;
  /** Множитель стартового HP забега. */
  startHpMul: number;
  /** Множитель радиуса сбора (магнит). */
  magnetMul: number;
}

export function computeLabModifiers(state: LabState): LabModifiers {
  const metabolism = state.levels['metabolism'] ?? 0;
  const chitin = state.levels['chitin'] ?? 0;
  const chemotaxis = state.levels['chemotaxis'] ?? 0;
  const metaBranch = getLabBranch('metabolism');
  const hpBranch = getLabBranch('chitin');
  const magnetBranch = getLabBranch('chemotaxis');
  const metaRnaMul =
    (1 + (metaBranch ? metaBranch.effectPerLevel * metabolism : 0)) *
    prestigeBonus(state.prestigeCount);
  const startHpMul = 1 + (hpBranch ? hpBranch.effectPerLevel * chitin : 0);
  const magnetMul = 1 + (magnetBranch ? magnetBranch.effectPerLevel * chemotaxis : 0);
  return { metaRnaMul, startHpMul, magnetMul };
}

export interface RunStageLike {
  maxHp: number;
  hp: number;
  magnetMul: number;
}

/**
 * Применить лабораторные модификаторы к этапу забега.
 * Вызывается один раз на fresh run (после restoreFromCheckpoint, до первого
 * кадра), НЕ на resume: чекпоинт уже содержит запечённые значения.
 * На fresh run с нулевыми уровнями — maxHp = round(PLAYER.hp * 1) = 100,
 * hp = maxHp, magnetMul *= 1 — поведение идентично до-Фазе-4.
 */
export function applyLabRunModifiers(stage: RunStageLike, state: LabState): void {
  const mods = computeLabModifiers(state);
  stage.maxHp = Math.round(stage.maxHp * mods.startHpMul);
  stage.hp = stage.maxHp;
  stage.magnetMul *= mods.magnetMul;
}
