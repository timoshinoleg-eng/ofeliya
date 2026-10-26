import { getDifficultyProfile, type DifficultyId } from './DifficultyProfile';

/**
 * Player-facing run-mode line for the result screen.
 *
 * The line names the tier the player actually ran and states its ranking status.
 * Only the ranked Standard tier ever claims a place. Every other tier reports
 * itself as unranked — a normal outcome, never a failure or a penalty.
 */
export interface RunModeLabelInput {
  difficultyId: DifficultyId;
  resumed: boolean;
  daily: boolean;
  duel: boolean;
  ranked: boolean;
}

/**
 * Whether a finished run may claim a ranked place.
 *
 * Only a fresh, non-resumed Standard run is ranked. Daily and Duel runs carry
 * their own rules and never compete on the global Standard board, and no other
 * difficulty tier is ranked at all.
 */
export function isRankedResult(input: {
  difficultyId: DifficultyId;
  resumed: boolean;
  daily: boolean;
  duel: boolean;
}): boolean {
  return (
    input.difficultyId === 'standard' &&
    !input.resumed &&
    !input.daily &&
    !input.duel
  );
}

export function runModeLabel(input: RunModeLabelInput): string {
  const mode = getDifficultyProfile(input.difficultyId).label;
  if (input.resumed) return `РЕЖИМ: ${mode} · ВОЗОБНОВЛЁН · ВНЕ РЕЙТИНГА`;
  if (input.daily) return 'РЕЖИМ: СТАНДАРТ · ежедневный забег';
  if (input.duel) return 'РЕЖИМ: ДУЭЛЬ · СТАНДАРТ · ВНЕ РЕЙТИНГА';
  if (input.ranked) return 'РЕЖИМ: СТАНДАРТ · рейтинговый';
  return `РЕЖИМ: ${mode} · вне рейтинга`;
}
