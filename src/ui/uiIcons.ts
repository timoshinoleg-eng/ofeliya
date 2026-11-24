import Phaser from 'phaser';
import {
  UI_ICON_ATLAS_KEY,
  UI_ICON_FRAMES,
  type UiIconFrame,
  type UiIconVariant,
} from './generated/iconFrames';
import { VISUAL_TEXT } from './visualTokens';

/**
 * VF-02 UI icon helper. Icons resolve from the baked `ui-icons` atlas when the
 * BootScene preload succeeded; any missing texture/frame falls back to an
 * instantly generated procedural texture in the established `up-*` naming
 * convention (same rule as BootScene.makeIcons), so a failed optional load can
 * never break a UI surface. UI-scene integration is intentionally minimal —
 * the presentation surfaces pick frames from `UI_ICON_FRAMES` themselves.
 */

/** Phaser frame name inside the atlas for a frame + palette variant. */
export function uiIconFrameName(frame: UiIconFrame, variant: UiIconVariant = 'default'): string {
  return variant === 'default' ? frame : `${frame}.${variant}`;
}

const VARIANT_COLORS: Record<UiIconVariant, string> = {
  default: VISUAL_TEXT.ivory,
  host: VISUAL_TEXT.host,
  immune: VISUAL_TEXT.immune,
  danger: VISUAL_TEXT.danger,
};

/** True when the atlas texture is loaded and contains the requested frame. */
export function hasUiIconTexture(
  scene: Phaser.Scene,
  frame: UiIconFrame,
  variant: UiIconVariant = 'default'
): boolean {
  if (!scene.textures.exists(UI_ICON_ATLAS_KEY)) return false;
  return scene.textures.get(UI_ICON_ATLAS_KEY).has(uiIconFrameName(frame, variant));
}

export function uiIconFallbackKey(frame: UiIconFrame, variant: UiIconVariant = 'default'): string {
  return variant === 'default' ? `up-icon-${frame}` : `up-icon-${frame}-${variant}`;
}

const FALLBACK_SIZE = 40;

/**
 * Instant procedural fallback for a missing atlas texture/frame: a 40x40 canvas
 * texture named `up-icon-<frame>[-<variant>]`, drawn synchronously once per
 * scene texture manager. Neutral "unknown cell" glyph so the placeholder reads
 * as an icon slot, never as gameplay state.
 */
export function ensureUiIconFallback(
  scene: Phaser.Scene,
  frame: UiIconFrame,
  variant: UiIconVariant = 'default'
): string {
  const key = uiIconFallbackKey(frame, variant);
  if (scene.textures.exists(key)) return key;
  const texture = scene.textures.createCanvas(key, FALLBACK_SIZE, FALLBACK_SIZE);
  if (!texture) return key;
  const ctx = texture.getContext();
  const color = VARIANT_COLORS[variant];
  ctx.clearRect(0, 0, FALLBACK_SIZE, FALLBACK_SIZE);
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(20, 20, 12, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 4; i++) {
    const a = i * (Math.PI / 2) + Math.PI / 4;
    ctx.beginPath();
    ctx.moveTo(20 + Math.cos(a) * 14, 20 + Math.sin(a) * 14);
    ctx.lineTo(20 + Math.cos(a) * 17, 20 + Math.sin(a) * 17);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(20, 20, 3, 0, Math.PI * 2);
  ctx.fill();
  texture.refresh();
  return key;
}

/**
 * Add an icon image. Uses the atlas frame when present; otherwise the
 * procedural `up-icon-*` fallback texture (created on first use, cached).
 */
export function addUiIcon(
  scene: Phaser.Scene,
  x: number,
  y: number,
  frame: UiIconFrame,
  variant: UiIconVariant = 'default'
): Phaser.GameObjects.Image {
  if (hasUiIconTexture(scene, frame, variant)) {
    return scene.add.image(x, y, UI_ICON_ATLAS_KEY, uiIconFrameName(frame, variant));
  }
  return scene.add.image(x, y, ensureUiIconFallback(scene, frame, variant));
}

/**
 * Pre-create default-variant fallbacks for every frame. BootScene calls this
 * only when the optional atlas load failed, so later UI scenes can rely on
 * `up-icon-*` existence without per-call checks. Cheap: 59 one-time 40x40
 * canvas textures, drawn synchronously outside the frame loop.
 */
export function installUiIconFallbacks(scene: Phaser.Scene): void {
  for (const frame of UI_ICON_FRAMES) ensureUiIconFallback(scene, frame);
}
