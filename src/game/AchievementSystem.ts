import type { RunState } from './RunState';
import { EVOLUTION_NAMES, type EvolutionId } from './UpgradeSystem';
import { SaveSystem } from '../systems/SaveSystem';

export type AchievementId =
  | 'first-contact'
  | 'continuous-flow'
  | 'stable-core'
  | 'adaptation'
  | 'deep-dive'
  | 'cleanup-500'
  | 'restart-3'
  | 'full-protocol';

export interface AchievementDef {
  id: AchievementId;
  name: string;
  desc: string;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first-contact', name: 'ПЕРВЫЙ КОНТАКТ', desc: 'Очистить 50 угроз за один сеанс' },
  { id: 'continuous-flow', name: 'НЕПРЕРЫВНЫЙ ПОТОК', desc: 'Достичь комбо ×20' },
  { id: 'stable-core', name: 'СТАБИЛЬНОЕ ЯДРО', desc: '60 секунд подряд без урона' },
  { id: 'adaptation', name: 'АДАПТАЦИЯ', desc: 'Получить первую эволюцию' },
  { id: 'deep-dive', name: 'ГЛУБОКОЕ ПОГРУЖЕНИЕ', desc: 'Дожить до 03:00' },
  { id: 'cleanup-500', name: 'ОЧИСТКА', desc: 'Очистить 500 угроз суммарно' },
  { id: 'restart-3', name: 'ПОВТОРНЫЙ ЗАПУСК', desc: 'Завершить 3 сеанса' },
  { id: 'full-protocol', name: 'ПОЛНЫЙ ПРОТОКОЛ', desc: 'Открыть все три эволюции' },
];

const BY_ID = new Map<AchievementId, AchievementDef>(ACHIEVEMENTS.map((a) => [a.id, a]));

export function getAchievementDef(id: AchievementId): AchievementDef {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`Unknown achievement: ${id}`);
  return def;
}

/**
 * Проверка лёгкая и side-effect-free до момента реального unlock.
 * `runRecorded=true` означает, что current kills/evolutions уже перенесены в SaveSystem.
 */
export function evaluateAchievements(st: RunState, runRecorded = false): AchievementId[] {
  const save = SaveSystem.get();
  const candidate: AchievementId[] = [];

  if (st.kills >= 50) candidate.push('first-contact');
  if (st.comboBest >= 20) candidate.push('continuous-flow');
  if (st.maxNoDamageMs >= 60_000) candidate.push('stable-core');
  if (st.evolutions.size > 0) candidate.push('adaptation');
  if (st.timeMs >= 180_000) candidate.push('deep-dive');

  const lifetimeKills = save.totalKills + (runRecorded ? 0 : st.kills);
  if (lifetimeKills >= 500) candidate.push('cleanup-500');
  if (save.runs >= 3) candidate.push('restart-3');

  const seen = new Set<EvolutionId>(save.evolutionsSeen);
  if (!runRecorded) for (const id of st.evolutions) seen.add(id);
  if (seen.size >= 3) candidate.push('full-protocol');

  return SaveSystem.unlockAchievements(candidate);
}

export function achievementSummary(ids: AchievementId[]): string {
  return ids.map((id) => getAchievementDef(id).name).join(' · ');
}

export function evolutionSummary(ids: EvolutionId[]): string {
  return ids.map((id) => EVOLUTION_NAMES[id]).join(' · ');
}
