/**
 * OFELIYA — main menu layout.
 *
 * Pure geometry: no Phaser, no scene, no state, no side effects. The menu is a
 * single vertical flow of bands, and this module owns where every band lands.
 *
 * The layout has two elastic parts:
 *  - the hero art band absorbs the free space, because decoration may shrink and
 *    grow before a control does;
 *  - the gaps between the bands grow up to a maximum, so a tall viewport breathes
 *    instead of leaving a hole under the footer.
 *
 * Every interactive band is at least {@link MIN_TOUCH} tall, so the hit area of a
 * control is never smaller than its label.
 */

/** Minimum hit area of an interactive element, in px. */
export const MIN_TOUCH = 44;

export interface MenuLayoutFlags {
  /** A checkpoint exists: the primary action becomes "resume" and gains a secondary. */
  hasCheckpoint: boolean;
  /** The player record strip has content. */
  hasRecord: boolean;
  /** How many lines the record strip needs. */
  recordLines: number;
  /** An incoming challenge or duel is waiting: the menu shows the challenge band. */
  hasChallenge: boolean;
}

export interface MenuLayout {
  width: number;
  height: number;
  compact: boolean;
  /** Width of the centred content column. */
  contentWidth: number;
  cardWidth: number;
  cardGap: number;
  cardHeight: number;
  cardY: number;
  titleY: number;
  titleFont: number;
  strainY: number;
  badgeY: number;
  artTop: number;
  artHeight: number;
  /** Scale of the 56px logical virus art. */
  artScale: number;
  /** Radius of the specimen ring around the virus. */
  ringRadius: number;
  hookY: number;
  hookFont: number;
  taglineY: number;
  taglineFont: number;
  recordY: number;
  recordFont: number;
  /** Y of the challenge band, between the record and the run configuration. */
  challengeY: number;
  ctaY: number;
  ctaHeight: number;
  ctaWidth: number;
  hintY: number;
  secondaryY: number;
  secondaryHeight: number;
  gridTop: number;
  gridRowHeight: number;
  gridGap: number;
  gridWidth: number;
  audioY: number;
  legalY: number;
}

interface Band {
  key: string;
  height: number;
  /** Elastic bands absorb the free space. */
  elastic?: boolean;
}

const LOGICAL_VIRUS_SIZE = 56;

export function computeMenuLayout(
  width: number,
  height: number,
  flags: MenuLayoutFlags
): MenuLayout {
  const compact = height < 650;
  const contentWidth = Math.min(width - 34, Math.max(440, width * 0.55));
  const padTop = compact ? 8 : 16;
  const padBottom = compact ? 8 : 20;
  const minGap = compact ? 4 : 7;
  const maxGap = compact ? 9 : 16;

  const titleFont = compact ? 28 : 44;
  const strainFont = compact ? 9 : 12;
  const hookFont = compact ? 13 : 17;
  const taglineFont = compact ? 11 : 14;
  const recordFont = compact ? 11 : 13;

  const cardHeight = compact ? 56 : 64;
  const ctaHeight = compact ? 48 : 60;
  // The resume state adds a second hint line that says the run-configuration
  // cards belong to the next run.
  const hintHeight = flags.hasCheckpoint ? (compact ? 26 : 32) : compact ? 14 : 18;
  const secondaryHeight = MIN_TOUCH;
  const gridRowHeight = MIN_TOUCH;
  const gridGap = compact ? 4 : 8;
  const gridHeight = gridRowHeight * 2 + gridGap;
  const audioHeight = MIN_TOUCH;
  const legalHeight = MIN_TOUCH;

  const recordHeight = flags.hasRecord
    ? Math.ceil(recordFont * 1.35 * Math.max(1, flags.recordLines))
    : 0;
  const secondary = flags.hasCheckpoint ? secondaryHeight : 0;
  // The challenge band is its own band: the record line and the challenge must
  // never share a slot, or they overlap on a compact viewport.
  const challengeHeight = flags.hasChallenge ? 58 : 0;

  const bands: Band[] = [
    { key: 'title', height: titleFont * 1.24 },
    { key: 'strain', height: strainFont * 1.4 },
    { key: 'art', height: 0, elastic: true },
    { key: 'hook', height: hookFont * 2.4 },
    { key: 'tagline', height: taglineFont * 1.35 },
    { key: 'record', height: recordHeight },
    { key: 'challenge', height: challengeHeight },
    { key: 'cards', height: cardHeight },
    { key: 'cta', height: ctaHeight },
    { key: 'hint', height: hintHeight },
    { key: 'secondary', height: secondary },
    { key: 'grid', height: gridHeight },
    { key: 'audio', height: audioHeight },
    { key: 'legal', height: legalHeight },
  ];

  const fixedTotal =
    padTop +
    padBottom +
    bands.filter((band) => !band.elastic).reduce((sum, band) => sum + band.height, 0) +
    minGap * (bands.length - 1);

  const minArt = 34;
  const maxArt = 240;
  let artHeight = Math.max(minArt, Math.min(maxArt, height - fixedTotal));
  let leftover = height - fixedTotal - artHeight;
  const gapCount = bands.length - 1;
  const gap = Math.min(maxGap, minGap + (gapCount > 0 ? leftover / gapCount : 0));
  leftover -= (gap - minGap) * gapCount;
  artHeight = Math.min(maxArt, artHeight + Math.max(0, leftover));

  // Walk the flow and record the position of every band.
  const top: Record<string, number> = {};
  let cursor = padTop;
  for (const band of bands) {
    top[band.key] = cursor;
    cursor += (band.elastic ? artHeight : band.height) + gap;
  }
  const usedBottom = cursor - gap;

  // A viewport taller than the content centres the block instead of leaving a hole.
  const shift = Math.max(0, (height - usedBottom) / 2);
  for (const key of Object.keys(top)) top[key] += shift;

  const cardGap = 10;
  const cardWidth = Math.min((contentWidth - cardGap) / 2, 200);

  return {
    width,
    height,
    compact,
    contentWidth,
    cardWidth,
    cardGap,
    cardHeight,
    cardY: top.cards + cardHeight / 2,
    titleY: top.title + bands[0].height / 2,
    titleFont,
    strainY: top.strain + bands[1].height / 2,
    // The founder badge is a plate on the top of the specimen ring: it costs no
    // vertical band of its own.
    badgeY: top.art + 13,
    artTop: top.art,
    artHeight,
    artScale: artHeight / LOGICAL_VIRUS_SIZE,
    ringRadius: Math.min(82, height * 0.088, artHeight * 0.46),
    hookY: top.hook + bands[3].height / 2,
    hookFont,
    taglineY: top.tagline + bands[4].height / 2,
    taglineFont,
    recordY: top.record + recordHeight / 2,
    recordFont,
    challengeY: challengeHeight > 0 ? top.challenge + challengeHeight / 2 : 0,
    ctaY: top.cta + ctaHeight / 2,
    ctaHeight,
    ctaWidth: Math.min(contentWidth, 338),
    hintY: top.hint + hintHeight / 2,
    secondaryY: secondary > 0 ? top.secondary + secondaryHeight / 2 : 0,
    secondaryHeight,
    gridTop: top.grid,
    gridRowHeight,
    gridGap,
    gridWidth: contentWidth,
    audioY: top.audio + audioHeight / 2,
    legalY: top.legal + legalHeight / 2,
  };
}
