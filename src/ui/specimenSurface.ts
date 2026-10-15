import Phaser from 'phaser';
import { VISUAL, VISUAL_SURFACE } from './visualTokens';

export type SpecimenSurfaceOptions = {
  accent?: number;
  fill?: number;
  alpha?: number;
  detail?: 'quiet' | 'specimen';
};

/** Static membrane decoration. No listeners, random numbers, timers or frame updates.
 * Coordinates are local to the returned Graphics; any Container can own its lifetime.
 */
export function createSpecimenSurface(
  scene: Phaser.Scene, x: number, y: number, width: number, height: number,
  options: SpecimenSurfaceOptions = {},
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics().setPosition(x, y);
  drawSpecimenSurface(g, width, height, options);
  return g;
}

/** Reuse the same Graphics on resize; never call this from a frame update. */
export function drawSpecimenSurface(
  g: Phaser.GameObjects.Graphics, width: number, height: number,
  options: SpecimenSurfaceOptions = {},
): void {
  const accent = options.accent ?? VISUAL.host;
  const left = -width / 2;
  const top = -height / 2;
  const radius = Math.min(VISUAL_SURFACE.radius, height / 4);
  g.clear();
  g.fillStyle(options.fill ?? VISUAL.panel, options.alpha ?? VISUAL_SURFACE.alpha);
  g.fillRoundedRect(left, top, width, height, radius);
  g.lineStyle(VISUAL_SURFACE.stroke, VISUAL.line, 0.8);
  g.strokeRoundedRect(left + 0.5, top + 0.5, width - 1, height - 1, radius);
  g.lineStyle(1, accent, 0.32);
  g.lineBetween(left + radius, top + VISUAL_SURFACE.seamInset, left + Math.min(width * 0.58, 172), top + VISUAL_SURFACE.seamInset);
  g.lineStyle(1, accent, 0.16);
  g.lineBetween(left + radius, -top - VISUAL_SURFACE.seamInset, -left - radius, -top - VISUAL_SURFACE.seamInset);
  if (options.detail !== 'quiet') {
    // Fixed contours sit at the perimeter, leaving the copy area quiet.
    const cx = width / 2 - Math.min(30, width * 0.12);
    const cy = height * 0.15;
    const cellW = Math.min(48, width * 0.15);
    const cellH = Math.min(64, height * 0.54);
    g.lineStyle(1, accent, 0.09);
    g.strokeEllipse(cx, cy, cellW, cellH);
    g.strokeEllipse(cx - 5, cy - 3, cellW * 0.7, cellH * 0.75);
    g.fillStyle(accent, 0.075);
    g.fillEllipse(cx + 2, cy, cellW * 0.24, cellH * 0.3);
  }
}
