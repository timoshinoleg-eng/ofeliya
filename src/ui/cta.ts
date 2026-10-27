import Phaser from 'phaser';
import { FONT } from '../game/config';
import { TOUCH } from './tokens';
import { VISUAL, VISUAL_TEXT } from './visualTokens';

/**
 * OFELIYA — the one shared primary call-to-action style.
 *
 * A single visual recipe for every "start / resume / new run / daily" action:
 *
 *  - mint fill (`VISUAL.host`) with dark, high-contrast label text;
 *  - a visible disabled state that reads as disabled, not as a broken button;
 *  - a hit area that is never smaller than the project touch minimum.
 *
 * The result screen already used this recipe; the menu and the Daily action now use
 * the same one, so "the primary action" looks the same everywhere.
 */
export const CTA = {
  fill: VISUAL.host,
  fillHover: 0xbcd9c3,
  fillPressed: 0x9dc3a9,
  fillDisabled: VISUAL.panelRaised,
  text: '#080f14',
  /** The caption of a captioned primary action: dark, one step softer than the label. */
  caption: '#16302a',
  textDisabled: VISUAL_TEXT.muted,
  stroke: VISUAL.host,
  strokeDisabled: VISUAL.line,
  /** Default height. Never below {@link TOUCH.min}. */
  height: 46,
  minHeight: TOUCH.min,
  fontSize: 16,
} as const;

export interface PrimaryCtaOptions {
  x: number;
  y: number;
  width: number;
  label: string;
  enabled?: boolean;
  name?: string;
  fontSize?: number;
  height?: number;
  onTap?: () => void;
}

export interface PrimaryCta {
  bg: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  setEnabled(enabled: boolean): void;
}

/**
 * Build a primary CTA. The button is returned as a pair so the caller can move or
 * re-label it without rebuilding the hit area.
 *
 * `parent` may be a container (the label and the hit area join it) or `null`
 * (the caller owns the scene-level objects).
 */
export function createPrimaryCta(
  scene: Phaser.Scene,
  parent: Phaser.GameObjects.Container | null,
  options: PrimaryCtaOptions
): PrimaryCta {
  const enabled = options.enabled !== false;
  const height = Math.max(CTA.minHeight, options.height ?? CTA.height);
  const fontSize = options.fontSize ?? CTA.fontSize;

  const bg = scene.add
    .rectangle(options.x, options.y, options.width, height, enabled ? CTA.fill : CTA.fillDisabled, 0.97)
    .setStrokeStyle(enabled ? 2 : 1, enabled ? CTA.stroke : CTA.strokeDisabled, enabled ? 1 : 0.7);
  if (options.name) bg.setName(options.name);

  const label = scene.add
    .text(options.x, options.y, options.label, {
      fontFamily: FONT,
      fontSize: `${fontSize}px`,
      fontStyle: 'bold',
      color: enabled ? CTA.text : CTA.textDisabled,
    })
    .setOrigin(0.5)
    .setResolution(2);
  if (options.name) label.setName(`${options.name}-label`);

  // A long label must never push the button wider than its hit area.
  if (label.width > options.width - 20) label.setFontSize(Math.max(11, fontSize - 3));

  let armedPointer: number | null = null;

  const setEnabled = (next: boolean): void => {
    bg.setFillStyle(next ? CTA.fill : CTA.fillDisabled, 0.97);
    bg.setStrokeStyle(next ? 2 : 1, next ? CTA.stroke : CTA.strokeDisabled, next ? 1 : 0.7);
    label.setColor(next ? CTA.text : CTA.textDisabled);
    if (next) bg.setInteractive({ useHandCursor: true });
    else bg.disableInteractive();
  };

  if (enabled) {
    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      armedPointer = pointer.id;
      bg.setFillStyle(CTA.fillPressed, 1);
    });
    bg.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      const wasArmed = armedPointer === pointer.id;
      armedPointer = null;
      bg.setFillStyle(CTA.fill, 0.97);
      if (!wasArmed) return;
      options.onTap?.();
    });
    bg.on('pointerout', () => {
      armedPointer = null;
      bg.setFillStyle(CTA.fill, 0.97);
    });
  }

  if (parent) parent.add([bg, label]);
  return { bg, label, setEnabled };
}
