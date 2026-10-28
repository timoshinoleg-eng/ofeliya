/**
 * LabState — состояние лаборатории мутаций (Фаза 4), Plain-number порт.
 *
 * Адаптация под main: БЕЗ Decimal. Суммы и стоимости — number (целые RNA),
 * кошелёк — number (MetaWallet). Математика: costForLevel округляется до
 * целого, grantMetaRna — floor после множителя. Всё — точные целые в
 * пределах <1e9 (см. LabBranches.ts).
 *
 * Хранение: `ofeliya.lab.v1` { levels: Record<string, number>, prestigeCount: number }.
 * Гейт: флаг `economy.lab` — выключен → уровни не читаются, покупки не
 * работают (buyLabUpgrade → { ok: false, reason: 'disabled' }), а
 * grantMetaRna ведёт себя как addRna.
 * Фасад над MetaWallet: `addRna` напрямую НЕ вызывается для доходов
 * (DailyCalendar, GameScene, RetentionOverlays идут через grantMetaRna).
 * Исключение: `spendRna` остаётся прямым (покупка) и `resetRnaBalance`
 * используется только престижем.
 */

import { FeatureFlags } from '../FeatureFlags';
import { loadMeta, addRna, spendRna, resetRnaBalance } from '../meta/MetaWallet';
import { LAB_BRANCHES, costForLevel, getLabBranch, prestigeBonus } from './LabBranches';
import { computeLabModifiers } from './LabModifiers';

const LAB_STATE_KEY = 'ofeliya.lab.v1';

export interface LabState {
  levels: Record<string, number>;
  prestigeCount: number;
}

export const EMPTY_LAB_STATE: LabState = { levels: {}, prestigeCount: 0 };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function loadLabState(): LabState {
  try {
    const raw = localStorage.getItem(LAB_STATE_KEY);
    if (!raw) return { ...EMPTY_LAB_STATE, levels: {} };
    const parsed = JSON.parse(raw) as unknown;
    if (!isObject(parsed)) return { ...EMPTY_LAB_STATE, levels: {} };
    const levels: Record<string, number> = {};
    if (isObject(parsed.levels)) {
      for (const b of LAB_BRANCHES) {
        const v = parsed.levels[b.id];
        if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
          levels[b.id] = Math.min(Math.floor(v), b.maxLevel);
        }
      }
    }
    const prestigeCount =
      typeof parsed.prestigeCount === 'number' && Number.isFinite(parsed.prestigeCount)
        ? Math.max(0, Math.floor(parsed.prestigeCount))
        : 0;
    return { levels, prestigeCount };
  } catch {
    return { ...EMPTY_LAB_STATE, levels: {} };
  }
}

export function saveLabState(state: LabState): void {
  try {
    localStorage.setItem(LAB_STATE_KEY, JSON.stringify(state));
  } catch {
    // ignore (storage unavailable)
  }
}

export function getBranchLevel(state: LabState, branchId: string): number {
  const branch = getLabBranch(branchId);
  if (!branch) return 0;
  return state.levels[branchId] ?? 0;
}

export function totalLevels(state: LabState): number {
  return LAB_BRANCHES.reduce((acc, b) => acc + getBranchLevel(state, b.id), 0);
}

/** Мин. число купленных уровней для престижа. */
export const PRESTIGE_MIN_LEVELS = 1;

export interface BuyResult {
  ok: boolean;
  reason?: 'disabled' | 'maxed' | 'funds' | 'unknown';
  /** Новый уровень ветки после успешной покупки (для аналитики/тоста). */
  level?: number;
}

/**
 * Купить следующий уровень ветки. Тратит RNA из кошелька через spendRna.
 * На граничных уровнях: maxed (достигнут maxLevel), funds (не хватает RNA).
 */
export function buyLabUpgrade(branchId: string): BuyResult {
  if (!FeatureFlags.get('economy.lab')) return { ok: false, reason: 'disabled' };
  const branch = getLabBranch(branchId);
  if (!branch) return { ok: false, reason: 'unknown' };
  const state = loadLabState();
  const level = getBranchLevel(state, branchId);
  if (level >= branch.maxLevel) return { ok: false, reason: 'maxed' };
  const cost = costForLevel(branch, level);
  if (loadMeta().rna < cost) return { ok: false, reason: 'funds' };
  const spent = spendRna(cost);
  if (!spent) return { ok: false, reason: 'funds' };
  const next: LabState = {
    levels: { ...state.levels, [branchId]: level + 1 },
    prestigeCount: state.prestigeCount,
  };
  saveLabState(next);
  return { ok: true, level: level + 1 };
}

/**
 * Единая точка начисления дохода meta-RNA: метаболизм × престиж.
 * Возвращает новый баланс кошелька.
 */
export function grantMetaRna(amount: number): number {
  const meta = loadMeta();
  const mult = FeatureFlags.get('economy.lab')
    ? computeLabModifiers(loadLabState()).metaRnaMul
    : 1;
  const granted = Math.floor(amount * mult);
  addRna(granted);
  return meta.rna + granted;
}

export interface PrestigeResult {
  ok: boolean;
  reason?: 'disabled' | 'no_levels';
  /** Сколько престижей было до сброса (для аналитики). */
  previousCount?: number;
  /** Новый бонус престижа после сброса (для аналитики). */
  newBonus?: number;
}

/**
 * Престиж: сбросить уровни и баланс RNA → +10% к доходу meta-RNA.
 * Lifetime-счётчики (rnaEarned и др.) не трогаются — престиж не стирает
 * достижения (мета-прогресс, не хардкор).
 */
export function doPrestige(): PrestigeResult {
  if (!FeatureFlags.get('economy.lab')) return { ok: false, reason: 'disabled' };
  const state = loadLabState();
  if (totalLevels(state) < PRESTIGE_MIN_LEVELS) return { ok: false, reason: 'no_levels' };
  resetRnaBalance();
  const previousCount = state.prestigeCount;
  const next: LabState = { levels: {}, prestigeCount: previousCount + 1 };
  saveLabState(next);
  return { ok: true, previousCount, newBonus: prestigeBonus(next.prestigeCount) };
}

/** Сброс для тестов. */
export function debugResetLab(): void {
  saveLabState({ ...EMPTY_LAB_STATE, levels: {} });
}
