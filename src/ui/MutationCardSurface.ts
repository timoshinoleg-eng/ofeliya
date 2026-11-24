import type Phaser from 'phaser';
import type { UpgradeDef } from '../game/UpgradeSystem';
import { COLORS } from '../game/config';
import { addUiIcon, hasUiIconTexture } from './uiIcons';
import type { UiIconFrame } from './generated/iconFrames';

const FRAMES: Readonly<Record<string, UiIconFrame>> = {
  dmg: 'target', rate: 'activity', multi: 'blood-cells', pierce: 'bolt',
  speed: 'bolt', hp: 'heart', magnet: 'magnet', orbit: 'cell-nuclei',
  nova: 'flame', infect: 'virus', lysis: 'enzyme', factory: 'dna',
  regen: 'bandage', heal: 'heart',
};

/** Ordinary upgrades use the atlas; bespoke evolution/legendary art stays canonical. */
export function createMutationCardIcon(scene: Phaser.Scene, def: UpgradeDef, key: string, x: number, y: number, compact: boolean): Phaser.GameObjects.Image {
  const frame = FRAMES[def.id];
  const variant = def.rarity === 'rare' ? 'immune' : 'host';
  if (def.kind !== 'evolution' && def.kind !== 'legendary' && frame && hasUiIconTexture(scene, frame, variant)) {
    return addUiIcon(scene, x, y, frame, variant).setDisplaySize(compact ? 36 : 41, compact ? 36 : 41);
  }
  return scene.add.image(x, y, key).setScale(compact ? 0.9 : 1.02)
    .setTint(def.kind === 'evolution' ? COLORS.gold : def.rarity === 'rare' ? 0xe9dcff : 0xffffff);
}
