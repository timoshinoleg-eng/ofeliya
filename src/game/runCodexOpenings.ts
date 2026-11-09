import type { EvolutionId } from './UpgradeSystem';
import type { LegendaryId } from './LegendarySystem';

/** A Codex tab that holds entries a run can open. Mastery has no entries. */
export type CodexEntryTab = 'synergies' | 'legendary';

export type NewCodexEntry =
  | { kind: 'evolution'; id: EvolutionId }
  | { kind: 'legendary'; id: LegendaryId };

/** The registry handoff for opening the Codex on a specific entry. */
export interface CodexEntryRef {
  tab: CodexEntryTab;
  id: EvolutionId | LegendaryId;
}

export function codexEntryRef(entry: NewCodexEntry): CodexEntryRef {
  return { tab: entry.kind === 'evolution' ? 'synergies' : 'legendary', id: entry.id };
}

/**
 * The entries this run opened in the Codex for the first time.
 *
 * The caller passes the save's seen sets as they were BEFORE
 * `SaveSystem.recordRun` merged this run's choices into them; the diff is
 * empty if it is computed after the merge. Achievements are deliberately
 * not an input: a new achievement is not a Codex opening, and an opening
 * without an achievement is still listed.
 *
 * Order: evolutions first (the synergies tab), then legendaries, each in
 * run order, deduped.
 */
export function computeNewCodexEntries(
  runLegendaryIds: readonly LegendaryId[],
  runEvolutions: readonly EvolutionId[],
  seenLegendary: readonly LegendaryId[],
  seenEvolutions: readonly EvolutionId[],
): NewCodexEntry[] {
  const seenL = new Set(seenLegendary);
  const seenE = new Set(seenEvolutions);
  const out: NewCodexEntry[] = [];
  for (const id of new Set(runEvolutions)) {
    if (!seenE.has(id)) out.push({ kind: 'evolution', id });
  }
  for (const id of new Set(runLegendaryIds)) {
    if (!seenL.has(id)) out.push({ kind: 'legendary', id });
  }
  return out;
}
