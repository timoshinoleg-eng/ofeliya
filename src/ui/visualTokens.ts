/** Phase 1 presentation palette. No gameplay imports or runtime effects. */
export const VISUAL = {
  ink: 0x080f14, vascular: 0x23151e, panel: 0x111d22, panelRaised: 0x1b2b2f,
  line: 0x395357, ivory: 0xf0eadb, muted: 0x9cacac,
  player: 0xd18a9e, host: 0xa4cbb5, immune: 0x91cbd2,
  warning: 0xd9ba79, danger: 0xe37a78, rare: 0xb6accd,
} as const;

export const VISUAL_TEXT = {
  ivory: '#f0eadb', muted: '#9cacac', player: '#d18a9e', host: '#a4cbb5',
  immune: '#91cbd2', warning: '#d9ba79', danger: '#e37a78', rare: '#b6accd',
} as const;

/** Membrane component geometry; gameplay HUD sizes remain in hudTokens.ts. */
export const VISUAL_SURFACE = {
  radius: 18, stroke: 1, seamInset: 4, alpha: 0.97,
} as const;
