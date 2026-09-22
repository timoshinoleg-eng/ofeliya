/**
 * OFELIYA HUD strip geometry + type tokens (SLICE-HUD-01R).
 *
 * Single source of truth for the in-run HUD layout owned by `src/scenes/UIScene.ts`.
 * Every entry is either a numeric literal moved out of `UIScene.ts` (unchanged value)
 * or an alias over a primitive from `./tokens` (SLICE-TOKENS-01R) - there is no second
 * token vocabulary and no new colour.
 *
 * Constraints:
 *  - presentation only: no phaser / systems / scenes / gameplay imports;
 *  - primitives come from `./tokens` and are never re-declared here;
 *  - `TYPE` is deliberately absent - the HUD uses explicit per-element floors.
 */
import { BORDER, PANEL, ROLE, TOUCH } from './tokens';

/** In-run HUD strip: plate, rows, bar clamps, type floors, touch targets. */
export const HUD = {
  plate: { top: 5, height: 90, padX: 6, padY: 4 },
  row: {
    xpX: 12, xpY: 12, xpH: 10,
    timerY: 28,
    levelX: 16, levelY: 30,
    killsY: 9, killsPadX: 16,
    hpY: 54, hpH: 12, hpTextY: 56,
    bossLabelY: 72, bossBarY: 82, bossBarH: 11,
    comboX: 16, comboY: 54,
    muteY: 54, mutePadX: 16,
  },
  bar: { xpPadX: 12, xpReserveRight: 168, hpPad: 156, hpMaxW: 200, bossPad: 32, bossMaxW: 280 },
  type: { timer: 24, level: 15, kills: 14, hp: 12, boss: 13, combo: 18 },
  plateAlpha: PANEL.plate,
  lowHp: ROLE.state.bad,
  barBack: ROLE.surface.barBack,
  pauseVisual: { x: 52, y: 65, w: 34, h: 30, fill: 0x141a2e, fillAlpha: 0.92, strokeW: BORDER.hair, strokeAlpha: 0.72 },
  hit: { primary: TOUCH.min, secondary: TOUCH.chip, secondaryH: TOUCH.min },
} as const;