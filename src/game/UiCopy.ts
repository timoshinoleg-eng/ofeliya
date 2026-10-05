import {
  UPGRADE_FAMILY_LABELS,
  UPGRADES,
  type ChoiceKind,
  type UpgradeFamily,
  type UpgradeRarity,
} from './UpgradeSystem';

/**
 * Player-visible RU copy catalog for interface surfaces that previously carried
 * inline literals in scene code.
 *
 * Scope: display-only strings (rarity words, card headers, build-summary
 * abbreviations). Not a localization layer and not a runtime i18n module —
 * the canonical vocabulary stays in docs/GAME_LANGUAGE_BIBLE.md.
 *
 * Every value here must equal the literal it replaced. See tests/ui-copy-catalog.mjs.
 */

/** Rarity words that appear in the `[СЕМЬЯ] · [РЕДКОСТЬ]` mutation card header. */
export const RARITY_LABELS: Record<'common' | 'rare', string> = {
  common: 'СТАНДАРТ',
  rare: 'РЕДКИЙ',
};

/**
 * Headers for the two special mutation cards. They replace the family/rarity
 * line entirely, so they deliberately live outside `RARITY_LABELS`.
 */
export const MUTATION_CARD_HEADERS: Record<'legendary' | 'evolution', string> = {
  legendary: 'ЛЕГЕНДАРНАЯ МУТАЦИЯ',
  evolution: 'КРИТИЧЕСКАЯ МУТАЦИЯ',
};

export interface MutationCardHeaderSource {
  family: UpgradeFamily;
  rarity: UpgradeRarity;
  kind?: ChoiceKind;
}

/**
 * Header line of a mutation card. Legendary/evolution cards drop the
 * family/rarity line; every other card renders `[СЕМЬЯ] · [РЕДКОСТЬ]`.
 */
export function mutationCardHeader(def: MutationCardHeaderSource): string {
  if (def.kind === 'legendary') return MUTATION_CARD_HEADERS.legendary;
  if (def.kind === 'evolution') return MUTATION_CARD_HEADERS.evolution;
  return `${UPGRADE_FAMILY_LABELS[def.family]} · ${
    RARITY_LABELS[def.rarity === 'rare' ? 'rare' : 'common']
  }`;
}

/**
 * Short upgrade abbreviations for the run build summary (result screen).
 * Coverage of `UPGRADES` ids is asserted by tests/ui-copy-catalog.mjs.
 */
export const BUILD_SUMMARY_LABELS: Record<string, string> = {
  dmg: 'ШИПЫ',
  rate: 'РЕПЛИКАЦИЯ',
  multi: 'КОПИИ',
  pierce: 'ПРОБИТИЕ',
  speed: 'СКОРОСТЬ',
  hp: 'КАПСИД',
  magnet: 'МАГНИТ',
  orbit: 'СПУТНИКИ',
  nova: 'ИМПУЛЬС',
  regen: 'РЕГЕН.',
  infect: 'ЗАРАЖЕНИЕ',
  lysis: 'ЦИТОЛИЗ',
  factory: 'ФАБРИКА',
};

export const BUILD_SUMMARY_LIMIT = 5;

/**
 * `[СЕМЬЯ] · [РЕДКОСТЬ]`-independent summary of the strongest stacks of a run:
 * known upgrade ids only, count above zero, sorted by count (descending),
 * capped at {@link BUILD_SUMMARY_LIMIT} entries.
 */
export function formatBuildSummary(stacks: Record<string, number>): string {
  return Object.entries(stacks)
    .filter(([id, n]) => n > 0 && UPGRADES.some((u) => u.id === id))
    .sort((a, b) => b[1] - a[1])
    .slice(0, BUILD_SUMMARY_LIMIT)
    .map(([id, n]) => `${BUILD_SUMMARY_LABELS[id] ?? id.toUpperCase()} ${n}`)
    .join(' · ');
}