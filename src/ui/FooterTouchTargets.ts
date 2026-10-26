import Phaser from 'phaser';
import { TOUCH } from './tokens';

function target(text: Phaser.GameObjects.Text, width: number): void {
  text.setInteractive({ useHandCursor: true });
  // Phaser's setInteractive only enables an existing input; update that input explicitly.
  const input = text.input!;
  input.hitArea = new Phaser.Geom.Rectangle((text.width - width) / 2, (text.height - TOUCH.min) / 2, width, TOUCH.min);
  input.hitAreaCallback = Phaser.Geom.Rectangle.Contains;
  input.customHitArea = true; // Text reflow must not replace the expanded rectangle.
}

/** Keep the existing utility order and font sizes; wrap only when measured labels cannot fit. */
export function layoutUtilityTargets(
  texts: Phaser.GameObjects.Text[], width: number, height: number, preferredY: number, occupiedBottom: number,
): void {
  if (texts.length !== 5) return;
  const minimumGap = 4;
  texts.forEach(text => text.setWordWrapWidth(0));
  let widths = texts.map(text => Math.max(TOUCH.min, text.width));
  if (widths.reduce((a, b) => a + b, 0) + 4 * minimumGap > width - 16) {
    const column = Math.floor((width - 16 - 4 * minimumGap) / 5);
    texts.forEach(text => text.setWordWrapWidth(column, true));
    widths = texts.map(text => Math.max(TOUCH.min, text.width));
  }
  const gap = (width - 16 - widths.reduce((a, b) => a + b, 0)) / 4;
  const y = Math.max(occupiedBottom + TOUCH.min / 2, Math.min(preferredY, height - 67));
  let left = 8;
  texts.forEach((text, index) => {
    text.setPosition(left + widths[index] / 2, y);
    target(text, widths[index]);
    left += widths[index] + gap;
  });
}

/** The legal link and diagnostic gesture share a row, with disjoint 44px-high targets. */
export function layoutFooterLinks(legal: Phaser.GameObjects.Text, version: Phaser.GameObjects.Text, width: number, height: number): void {
  const legalWidth = width - 112;
  legal.setWordWrapWidth(legalWidth, true).setAlign('center').setPosition(8 + legalWidth / 2, height - 22);
  version.setWordWrapWidth(80, true).setAlign('center').setOrigin(0.5).setPosition(width - 48, height - 22);
  target(legal, legalWidth);
  target(version, 80);
}
