import type { RunState } from './RunState';
import { EVOLUTION_NAMES, type EvolutionId } from './UpgradeSystem';
import { SaveSystem } from '../systems/SaveSystem';

export type AchievementId =
  | 'first-contact'
  | 'continuous-flow'
  | 'stable-core'
  | 'adaptation'
  | 'deep-dive'
  | 'epidemic'
  | 'cleanup-500'
  | 'restart-3'
  | 'full-protocol';

export interface AchievementDef {
  id: AchievementId;
  name: string;
  desc: string;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first-contact', name: 'ПЕРВЫЙ КОНТАКТ', desc: 'Уничтожить 50 иммунных клеток за цикл' },
  { id: 'continuous-flow', name: 'ЦЕПНАЯ РЕАКЦИЯ', desc: 'Достичь комбо ×20' },
  { id: 'stable-core', name: 'УСТОЙЧИВЫЙ ШТАММ', desc: '60 секунд подряд без повреждения капсида' },
  { id: 'adaptation', name: 'КРИТИЧЕСКАЯ МУТАЦИЯ', desc: 'Получить первую критическую мутацию' },
  { id: 'deep-dive', name: 'СИСТЕМНАЯ ИНФЕКЦИЯ', desc: 'Продержаться до 03:00' },
  { id: 'epidemic', name: 'ЭПИДЕМИЯ', desc: 'Заразить 10 клеток хозяина за один цикл' },
  { id: 'cleanup-500', name: 'ИММУННЫЙ ПРОРЫВ', desc: 'Уничтожить 500 иммунных клеток суммарно' },
  { id: 'restart-3', name: 'НОВЫЙ ЦИКЛ', desc: 'Завершить 3 цикла заражения' },
  { id: 'full-protocol', name: 'ИДЕАЛЬНЫЙ ШТАММ', desc: 'Открыть все три критические мутации' },
];

const BY_ID = new Map<AchievementId, AchievementDef>(ACHIEVEMENTS.map((a) => [a.id, a]));

export function getAchievementDef(id: AchievementId): AchievementDef {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`Unknown achievement: ${id}`);
  return def;
}

/**
 * Lightweight evaluation. `runRecorded=true` means current kills/evolutions are already stored.
 */
export function evaluateAchievements(st: RunState, runRecorded = false): AchievementId[] {
  const save = SaveSystem.get();
  const candidate: AchievementId[] = [];

  if (st.kills >= 50) candidate.push('first-contact');
  if (st.comboBest >= 20) candidate.push('continuous-flow');
  if (st.maxNoDamageMs >= 60_000) candidate.push('stable-core');
  if (st.evolutions.size > 0) candidate.push('adaptation');
  if (st.timeMs >= 180_000) candidate.push('deep-dive');
  if (st.hostCellsInfected >= 10) candidate.push('epidemic');

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
