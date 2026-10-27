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
  /** Height of the challenge band. Zero when no challenge is waiting. */
  challengeHeight: number;
  ctaY: number;
  ctaHeight: number;
  ctaWidth: number;
  secondaryY: number;
  secondaryHeight: number;
  gridTop: number;
  gridRowHeight: number;
  gridGap: number;
  gridWidth: number;
  audioY: number;
  legalY: number;
  /** The strain eyebrow is on screen: it gives up its room only in a desperate state. */
  showStrain: boolean;
  /** The promise line is on screen: it gives up its room only in a desperate state. */
  showTagline: boolean;
}

interface Band {
  key: string;
  height: number;
  /** Elastic bands absorb the free space. */
  elastic?: boolean;
  /**
   * A decorative band carries brand text only: no run information, no control.
   * It gives up its room before the hero collapses, so the menu never loses
   * the run state to keep a promise line.
   */
  decorative?: boolean;
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
  // The run configuration lives inside the primary action, and the resume state
  // marks the configuration cards as belonging to the next run. The menu
  // therefore needs no separate hint band: the space belongs to the hero.
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
  // never share a slot, or they overlap on a compact viewport. On a compact
  // viewport the card is tighter, so the hero keeps more of its room in the
  // state that carries the most controls.
  const challengeHeight = flags.hasChallenge ? (compact ? 48 : 58) : 0;

  const bands: Band[] = [
    { key: 'title', height: titleFont * 1.24 },
    { key: 'strain', height: strainFont * 1.4, decorative: true },
    { key: 'art', height: 0, elastic: true },
    { key: 'hook', height: hookFont * 2.4 },
    { key: 'tagline', height: taglineFont * 1.35, decorative: true },
    { key: 'record', height: recordHeight },
    { key: 'challenge', height: challengeHeight },
    { key: 'cards', height: cardHeight },
    { key: 'cta', height: ctaHeight },
    { key: 'secondary', height: secondary },
    { key: 'grid', height: gridHeight },
    { key: 'audio', height: audioHeight },
    { key: 'legal', height: legalHeight },
  ];

  const minArt = 24;
  const maxArt = 240;
  // The hero must stay recognisable in every state, including the returning
  // player, whose menu carries one action more than the fresh one.
  const heroMin = compact ? 64 : 96;
  // The gaps may give up space; a control never does.
  const hardMinGap = 2;
  const gapCount = bands.length - 1;
  const gapMinTotal = hardMinGap * gapCount;
  const gapBaseTotal = minGap * gapCount;

  // The room is given up in a fixed order, and the hero has the last word:
  //  1. the spacing gives up its room first;
  //  2. the decorative brand text (the strain eyebrow, then the promise line)
  //     gives up its room;
  //  3. nothing else. A control, the challenge, the record, the navigation and
  //     the legal and audio rows keep their space.
  // The state in which the brand text has to go is a state the product never
  // renders — a checkpoint and an incoming challenge never arrive together —
  // so this is the guarantee of the layout contract, not a change of the
  // shipped menu.
  const available = height - padTop - padBottom;
  const fixedOf = (): number =>
    bands.filter((band) => !band.elastic).reduce((sum, band) => sum + band.height, 0);
  let strainHidden = false;
  let taglineHidden = false;
  for (const band of bands) {
    if (!band.decorative) continue;
    if (fixedOf() + heroMin + gapMinTotal <= available) break;
    if (band.height <= 0) continue;
    band.height = 0;
    if (band.key === 'strain') strainHidden = true;
    if (band.key === 'tagline') taglineHidden = true;
  }

  const fixedBands = fixedOf();
  const flow = height - padTop - padBottom - fixedBands;
  let gapTotal = gapBaseTotal;
  let artHeight = Math.max(minArt, Math.min(maxArt, flow - gapTotal));
  if (artHeight + gapTotal > flow) {
    // The content does not fit: the spacing gives up its room first.
    const artRoom = Math.max(0, flow - gapMinTotal);
    artHeight = Math.max(minArt, Math.min(artHeight, artRoom));
    gapTotal = flow - artHeight;
  }
  if (artHeight < heroMin) {
    // The hero takes what the spacing can spare, and never pushes a control out
    // of the viewport.
    const need = heroMin - artHeight;
    const room = Math.max(0, gapTotal - gapMinTotal);
    const take = Math.min(need, room);
    artHeight += take;
    gapTotal -= take;
  }
  let leftover = flow - artHeight - gapTotal;
  const gapMaxTotal = maxGap * gapCount;
  if (leftover > 0 && gapTotal < gapMaxTotal) {
    const grow = Math.min(leftover, gapMaxTotal - gapTotal);
    gapTotal += grow;
    leftover -= grow;
  }
  artHeight = Math.min(maxArt, artHeight + Math.max(0, leftover));
  const gap = gapTotal / gapCount;

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
    challengeHeight,
    ctaY: top.cta + ctaHeight / 2,
    ctaHeight,
    ctaWidth: Math.min(contentWidth, 338),
    secondaryY: secondary > 0 ? top.secondary + secondaryHeight / 2 : 0,
    secondaryHeight,
    gridTop: top.grid,
    gridRowHeight,
    gridGap,
    gridWidth: contentWidth,
    audioY: top.audio + audioHeight / 2,
    legalY: top.legal + legalHeight / 2,
    showStrain: !strainHidden,
    showTagline: !taglineHidden,
  };
}
