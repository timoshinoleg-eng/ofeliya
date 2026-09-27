import Phaser from 'phaser';
import {
  COMBAT_TELEGRAPH_PATTERNS,
  type CombatTelegraphLevel,
} from './CombatTelegraphLanguage';

const DARK_UNDERLAY = 0x140b12;
const WHITE = 0xffffff;

function unit(x: number, y: number): { x: number; y: number } {
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

function drawSegment(
  graphics: Phaser.GameObjects.Graphics,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): void {
  graphics.beginPath();
  graphics.moveTo(x1, y1);
  graphics.lineTo(x2, y2);
  graphics.strokePath();
}

/**
 * Draws a radial warning whose severity is readable from geometry:
 * normal = one ring, dangerous = double ring + 4 ticks, critical = triple ring + 8 ticks.
 */
export function drawRadialCombatTelegraph(
  graphics: Phaser.GameObjects.Graphics,
  radius: number,
  level: CombatTelegraphLevel,
  color: number,
  fillAlpha = 0
): void {
  const r = Math.max(8, radius);
  const pattern = COMBAT_TELEGRAPH_PATTERNS[level];

  graphics.lineStyle(pattern.underlayWidth, DARK_UNDERLAY, 0.58);
  graphics.strokeCircle(0, 0, r);
  graphics.lineStyle(pattern.lineWidth, color, 0.96);
  graphics.strokeCircle(0, 0, r);

  for (let ring = 1; ring < pattern.ringCount; ring++) {
    const ratio = 1 - ring * (level === 'critical' ? 0.13 : 0.19);
    graphics.lineStyle(Math.max(1.2, pattern.lineWidth - ring * 0.8), ring % 2 ? WHITE : color, 0.58);
    graphics.strokeCircle(0, 0, r * ratio);
  }

  if (fillAlpha > 0) {
    graphics.fillStyle(color, Math.min(0.12, Math.max(0, fillAlpha)));
    graphics.fillCircle(0, 0, r);
  }

  if (pattern.tickCount <= 0) return;
  const tickInner = r + 3;
  const tickOuter = r + (level === 'critical' ? 15 : 11);
  for (let i = 0; i < pattern.tickCount; i++) {
    const angle = (i / pattern.tickCount) * Math.PI * 2;
    const innerX = Math.cos(angle) * tickInner;
    const innerY = Math.sin(angle) * tickInner;
    const outerX = Math.cos(angle) * tickOuter;
    const outerY = Math.sin(angle) * tickOuter;
    graphics.lineStyle(level === 'critical' ? 2.6 : 2, i % 2 === 0 ? WHITE : color, 0.84);
    drawSegment(graphics, innerX, innerY, outerX, outerY);
  }
}

/**
 * Directional lane language for charge/projectile-like windups. Broad underlay gives contrast on
 * noisy biological backgrounds; repeated chevrons encode direction independently of color.
 */
export function drawDirectionalCombatTelegraph(
  graphics: Phaser.GameObjects.Graphics,
  dirX: number,
  dirY: number,
  start: number,
  end: number,
  level: CombatTelegraphLevel,
  color: number
): void {
  const dir = unit(dirX, dirY);
  const perp = { x: -dir.y, y: dir.x };
  const pattern = COMBAT_TELEGRAPH_PATTERNS[level];
  const laneStart = Math.max(0, start);
  const laneEnd = Math.max(laneStart + 12, end);

  graphics.lineStyle(pattern.underlayWidth + 5, DARK_UNDERLAY, 0.48);
  drawSegment(
    graphics,
    dir.x * laneStart,
    dir.y * laneStart,
    dir.x * laneEnd,
    dir.y * laneEnd
  );

  graphics.lineStyle(pattern.underlayWidth, color, level === 'normal' ? 0.12 : 0.18);
  drawSegment(
    graphics,
    dir.x * laneStart,
    dir.y * laneStart,
    dir.x * laneEnd,
    dir.y * laneEnd
  );

  graphics.lineStyle(pattern.lineWidth, color, 0.96);
  drawSegment(
    graphics,
    dir.x * laneStart,
    dir.y * laneStart,
    dir.x * laneEnd,
    dir.y * laneEnd
  );

  const usable = laneEnd - laneStart;
  const count = pattern.laneChevronCount;
  for (let i = 0; i < count; i++) {
    const ratio = (i + 1) / (count + 1);
    const centerDistance = laneStart + usable * ratio;
    const tipDistance = centerDistance + 7;
    const baseDistance = centerDistance - 7;
    const halfWidth = level === 'critical' ? 7 : 5.5;
    const tipX = dir.x * tipDistance;
    const tipY = dir.y * tipDistance;
    const baseX = dir.x * baseDistance;
    const baseY = dir.y * baseDistance;

    graphics.lineStyle(1.8, i % 2 === 0 ? WHITE : color, 0.82);
    graphics.beginPath();
    graphics.moveTo(baseX + perp.x * halfWidth, baseY + perp.y * halfWidth);
    graphics.lineTo(tipX, tipY);
    graphics.lineTo(baseX - perp.x * halfWidth, baseY - perp.y * halfWidth);
    graphics.strokePath();
  }

  graphics.fillStyle(WHITE, 0.9);
  graphics.fillCircle(dir.x * laneEnd, dir.y * laneEnd, level === 'critical' ? 5 : 4);
}

