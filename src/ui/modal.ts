import Phaser from 'phaser';
import { FONT, UI_FONT } from '../game/config';
import { TOUCH } from './tokens';
import { VISUAL, VISUAL_TEXT } from './visualTokens';
import { createSpecimenSurface } from './specimenSurface';

/**
 * OFELIYA — shared modal chrome and the internal meta dock.
 *
 * Four surfaces share one frame now: Задачи дня, Кодекс, Коллекция and Рейтинг.
 * They all use the same title placement, the same close affordance, the same padding
 * and the same border/radius recipe, so moving between them reads as one product.
 */

/** Shared modal frame metrics. */
export const MODAL = {
  /** Horizontal padding between the panel edge and the content. */
  padX: 16,
  /** Distance from the panel top edge to the title baseline. */
  titleTop: 22,
  /** Distance from the panel top edge to the first content row. */
  bodyTop: 56,
  /** Side length of the close control's hit area. Never below {@link TOUCH.min}. */
  closeHit: TOUCH.min,
  closeInset: 12,
  /** Height of the internal dock row. */
  dockHeight: TOUCH.min,
  radius: 18,
} as const;

export type MetaDockTarget = 'tasks' | 'codex' | 'collection';

/**
 * The three destinations that live inside one meta surface.
 *
 * Рейтинг is deliberately absent: it is a top-level destination, not a tab of the
 * meta surfaces.
 */
export const META_DOCK_ITEMS: ReadonlyArray<{ id: MetaDockTarget; label: string }> = [
  { id: 'tasks', label: 'ЗАДАЧИ ДНЯ' },
  { id: 'codex', label: 'КОДЕКС' },
  { id: 'collection', label: 'КОЛЛЕКЦИЯ' },
];

export interface ModalFrame {
  dim: Phaser.GameObjects.Rectangle;
  panel: Phaser.GameObjects.Rectangle;
  title: Phaser.GameObjects.Text;
  closeHit: Phaser.GameObjects.Rectangle;
  closeGlyph: Phaser.GameObjects.Text;
  /** Y of the first content row below the title. */
  bodyTop: number;
  /** Y of the dock row, measured from the panel top edge. */
  dockTop: number;
}

export interface ModalFrameOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  accent?: number;
  compact?: boolean;
  onClose: () => void;
  /** Reserve the bottom band for the internal dock. */
  withDock?: boolean;
}

/**
 * Build the shared modal frame: scrim, panel, centered title and a top-right close
 * control whose hit area is at least {@link MODAL.closeHit} on both axes.
 */
export function createModalFrame(
  scene: Phaser.Scene,
  parent: Phaser.GameObjects.Container,
  options: ModalFrameOptions
): ModalFrame {
  const { x, y, width, height } = options;
  const accent = options.accent ?? VISUAL.host;
  const compact = options.compact ?? false;

  const dim = scene.add
    .rectangle(scene.scale.width / 2, scene.scale.height / 2, scene.scale.width, scene.scale.height, VISUAL.ink, 0.96)
    .setInteractive()
    .setName('ofeliya-modal-dim');
  // The panel carries no stroke of its own: the membrane surface below owns the
  // frame, so a framed panel never shows two parallel border lines.
  const panel = scene.add.rectangle(x, y, width, height, VISUAL.panel, 0.995);
  const membrane = createSpecimenSurface(scene, x, y, width, height, {
    accent,
    fill: VISUAL.panel,
    alpha: 0.995,
    detail: 'quiet',
  });

  const title = scene.add
    .text(x, y - height / 2 + MODAL.titleTop, options.title, {
      fontFamily: FONT,
      fontSize: compact ? '18px' : '21px',
      fontStyle: 'bold',
      color: VISUAL_TEXT.ivory,
      letterSpacing: 1,
    })
    .setOrigin(0.5, 0)
    .setResolution(2)
    .setName('ofeliya-modal-title');

  // The close hit area stays fully inside the frame: the control is a target, not
  // a decoration that may hang over the edge of the panel.
  const closeX = x + width / 2 - MODAL.closeInset - MODAL.closeHit / 2;
  const closeY = y - height / 2 + MODAL.titleTop + 10;
  const closeHit = scene.add
    .rectangle(closeX, closeY, MODAL.closeHit, MODAL.closeHit, 0x000000, 0.001)
    .setInteractive({ useHandCursor: true })
    .setName('ofeliya-modal-close-hit');
  const closeGlyph = scene.add
    .text(closeX, closeY, '×', {
      fontFamily: FONT,
      fontSize: '26px',
      color: VISUAL_TEXT.muted,
    })
    .setOrigin(0.5)
    .setResolution(2)
    .setName('ofeliya-modal-close-label');
  closeHit.on('pointerup', () => options.onClose());

  parent.add([dim, panel, membrane, title, closeHit, closeGlyph]);

  return {
    dim,
    panel,
    title,
    closeHit,
    closeGlyph,
    bodyTop: y - height / 2 + MODAL.bodyTop,
    dockTop: options.withDock ? y + height / 2 - MODAL.dockHeight - 8 : 0,
  };
}

export interface MetaDockOptions {
  x: number;
  y: number;
  width: number;
  active: MetaDockTarget;
  compact?: boolean;
  onSelect: (target: MetaDockTarget) => void;
}

export interface MetaDock {
  container: Phaser.GameObjects.Container;
  setActive(active: MetaDockTarget): void;
}

/**
 * The internal three-item dock used by Задачи дня, Кодекс and Коллекция.
 *
 * The active destination is filled and coloured; the others are quiet. Every item
 * has a hit area of at least the touch minimum, even though the label itself is
 * smaller.
 */
export function createMetaDock(
  scene: Phaser.Scene,
  parent: Phaser.GameObjects.Container,
  options: MetaDockOptions
): MetaDock {
  const container = scene.add.container(0, 0).setName('ofeliya-meta-dock');
  const itemWidth = options.width / META_DOCK_ITEMS.length;
  const fontSize = options.compact ? '11px' : '12px';
  const labels = new Map<MetaDockTarget, Phaser.GameObjects.Text>();
  const plates = new Map<MetaDockTarget, Phaser.GameObjects.Rectangle>();

  META_DOCK_ITEMS.forEach((item, index) => {
    const itemX = options.x - options.width / 2 + itemWidth * (index + 0.5);
    const plate = scene.add
      .rectangle(itemX, options.y, itemWidth - 4, MODAL.dockHeight, VISUAL.ink, 0.001)
      .setInteractive({ useHandCursor: true })
      .setName(`ofeliya-meta-dock-${item.id}`);
    const label = scene.add
      .text(itemX, options.y, item.label, {
        fontFamily: UI_FONT,
        fontSize,
        fontStyle: '700',
        color: VISUAL_TEXT.muted,
        letterSpacing: 0.4,
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setName(`ofeliya-meta-dock-${item.id}-label`);
    plate.on('pointerup', () => options.onSelect(item.id));
    plates.set(item.id, plate);
    labels.set(item.id, label);
    container.add([plate, label]);
  });

  const setActive = (active: MetaDockTarget): void => {
    META_DOCK_ITEMS.forEach((item) => {
      const isActive = item.id === active;
      const label = labels.get(item.id);
      const plate = plates.get(item.id);
      label?.setColor(isActive ? VISUAL_TEXT.host : VISUAL_TEXT.muted);
      label?.setAlpha(isActive ? 1 : 0.85);
      plate?.setFillStyle(isActive ? VISUAL.host : VISUAL.ink, isActive ? 0.18 : 0.001);
      plate?.setStrokeStyle(1, isActive ? VISUAL.host : VISUAL.line, isActive ? 0.8 : 0.25);
    });
  };

  setActive(options.active);
  parent.add(container);
  return { container, setActive };
}
