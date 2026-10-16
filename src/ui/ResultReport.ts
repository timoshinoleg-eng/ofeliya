import Phaser from 'phaser';
import { FONT } from '../game/config';
import { VISUAL, VISUAL_TEXT } from './visualTokens';

/** Measured report rows scroll independently of the always-visible result actions. */
export function createResultReport(
  scene: Phaser.Scene, parent: Phaser.GameObjects.Container,
  rows: Phaser.GameObjects.Text[], x: number, top: number, width: number, height: number,
  status: Phaser.GameObjects.Text,
): void {
  const report = scene.add.container(x, top).setName('ofeliya-result-report');
  parent.add(report);
  let bottom = 0;
  for (const row of rows) {
    parent.remove(row);
    row.setFontSize(11).setWordWrapWidth(width - 24).setOrigin(0.5, 0).setPosition(0, bottom);
    if (row.style.color === '#5a6480' || row.style.color === '#8f9ab7') row.setColor(VISUAL_TEXT.muted);
    report.add(row);
    // Async submit statuses have room for three wrapped lines without shifting later rows.
    bottom += Math.max(row.height, row === status ? 44 : 0) + 8;
  }
  const limit = Math.max(0, bottom - 8 - height);
  let offset = 0, owner = -1, lastY = 0;
  const hint = scene.add.text(x, top + height + 4, '', {
    fontFamily: FONT, fontSize: '11px', color: VISUAL_TEXT.host,
  }).setOrigin(0.5, 0).setResolution(2).setName('ofeliya-result-scroll-hint');
  parent.add(hint);
  const scroll = (next: number): void => {
    offset = Phaser.Math.Clamp(next, 0, limit);
    report.y = top - offset;
    hint.setText(limit ? (offset >= limit - 1 ? '↑ ПОТЯНИТЕ, ЧТОБЫ ВЕРНУТЬСЯ' : '↓ ЕЩЁ СВЕДЕНИЯ · ПОТЯНИТЕ ВВЕРХ') : '');
  };
  const clip = scene.make.graphics({});
  const updateClip = (): void => {
    const matrix = parent.getWorldTransformMatrix();
    const a = matrix.transformPoint(x - width / 2, top);
    const b = matrix.transformPoint(x + width / 2, top + height);
    clip.clear().fillStyle(VISUAL.ink).fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
  };
  updateClip();
  const mask = clip.createGeometryMask();
  report.setMask(mask);
  const hit = scene.add.rectangle(x, top + height / 2, width, height, VISUAL.ink, 0)
    .setName('ofeliya-result-report-hit');
  parent.add(hit);
  if (limit) {
    hit.setInteractive();
    hit.on('pointerdown', (pointer: Phaser.Input.Pointer) => { owner = pointer.id; lastY = pointer.y; });
    hit.on('wheel', (_pointer: Phaser.Input.Pointer, _dx: number, dy: number) => scroll(offset + dy * 0.5));
  }
  const move = (pointer: Phaser.Input.Pointer): void => {
    if (pointer.id !== owner) return;
    scroll(offset + (lastY - pointer.y) / parent.scaleY);
    lastY = pointer.y;
  };
  const release = (pointer: Phaser.Input.Pointer): void => { if (pointer.id === owner) owner = -1; };
  scene.input.on('pointermove', move);
  scene.input.on('pointerup', release);
  scene.input.on('pointerupoutside', release);
  scene.scale.on('resize', updateClip);
  parent.once(Phaser.GameObjects.Events.DESTROY, () => {
    scene.input.off('pointermove', move);
    scene.input.off('pointerup', release);
    scene.input.off('pointerupoutside', release);
    scene.scale.off('resize', updateClip);
    report.clearMask(); mask.destroy(); clip.destroy();
  });
  scroll(0);
}
