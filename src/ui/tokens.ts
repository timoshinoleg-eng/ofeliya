/**
 * OFELIYA UI token foundation - presentation-only, data-only.
 *
 * Every value below is IDENTICAL to the literal it replaces at main @ b898fd4.
 * This module changes no product behaviour; it exists so later slices can change
 * a value in exactly one place.
 *
 * Constraints (SLICE-TOKENS-01R):
 *  - do not import phaser / systems / scenes / gameplay here;
 *  - never import this module from gameplay code;
 *  - do not merge into src/game/config.ts (path-filtered by the Release Visual Matrix workflow).
 */

/** Responsive breakpoints (height). Both live thresholds are preserved on purpose. */
export const BP = { compact: 650, compactNarrow: 620, narrow: 360 } as const;

/** Spacing scale (px). */
export const SPACE = { xxs: 2, xs: 4, sm: 6, md: 8, lg: 12, xl: 16, xxl: 24, gutter: 32 } as const;

/** Panel alpha recipes (0..1). */
export const PANEL = {
  sheet: 0.995, card: 0.985, raised: 0.97, panel: 0.95, raisedSoft: 0.94,
  button: 0.92, dim: 0.9, dimSoft: 0.86, dimDeep: 0.84, band: 0.78,
  rowMuted: 0.72, plate: 0.46,
} as const;

/** Border widths (px). */
export const BORDER = {
  hair: 1, thin: 1.4, soft: 1.5, medium: 1.8, base: 2,
  baseLg: 2.4, bold: 2.5, heavy: 3, heavyLg: 3.5,
} as const;

/** Modal scrim recipes (colour + alpha) - one entry per live modal. */
export const SCRIM = {
  transition: { color: 0x050308, alpha: 0.96 },
  pause: { color: 0x05070f, alpha: 0.9 },
  levelUp: { color: 0x09040a, alpha: 0.91 },
  legendary: { color: 0x030208, alpha: 0.94 },
  evolution: { color: 0x03040a, alpha: 0.9 },
  result: { color: 0x05070f, alpha: 0.84 },
} as const;

/** Shared result-button recipe (the HUD pause control is owned by SLICE-HUD-01). */
export const BUTTON = {
  primaryFill: 0.18,
  secondaryFill: 0.95,
  strokeWidth: 2,
  strokeAlpha: 1,
} as const;

/** Touch-target minimums (px). */
export const TOUCH = { min: 44, comfortable: 48, chip: 24, gap: 1 } as const;

/** Layout clamps (px). */
export const CLAMP = {
  padScreen: 24, padTight: 12, padLoose: 32, padWide: 42, padHuge: 58,
  panelMax: 370, cardMax: 374, contentMax: 338, buttonMax: 230, chipMax: 190,
  longCopyMax: 360, bottomReserve: 205, edgeGuard: 24,
  fitMinScaleDefault: 0.62, fitMinScaleTight: 0.58, fitMinScaleBody: 0.68,
  fitMinScaleHeading: 0.72, fitMinScaleMicro: 0.64, detailMinScale: 0.72,
} as const;

/** Semantic roles (aliases over existing palette values - no new colours). */
export const ROLE = {
  surface: { screen: 0x12070d, sheet: 0x100d16, panel: 0x1d0d18, panelHover: 0x2a1222, stroke: 0x583044, barBack: 0x1a2136 },
  faction: { player: 0xff4fb5, hostile: 0xe8faff, immune: 0x8fe8ff, reward: 0x7fffa1, danger: 0xff3e5f, neutral: 0xfff4ec },
  rarity: { common: 0x8fe8ff, rare: 0x9b6dff, critical: 0xffd56a, legendary: 0xffd56a },
  state: { ok: 0x7fffa1, warn: 0xffd56a, bad: 0xff5a5a },
} as const;