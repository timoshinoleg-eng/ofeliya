import Phaser from 'phaser';
import { Easing, Group, Tween } from '@tweenjs/tween.js';
import { prefersReducedMotion } from '../systems/MotionPreferences';

export const MUTATION_CARD_SHEEN_TEXTURE_KEY = 'sz_ui_card_sheen';

export type MutationSheenCard = {
  card: Phaser.GameObjects.Container;
  width: number;
  height: number;
  accent: number;
};

type SheenEntry = {
  object: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle;
  mask: Phaser.Display.Masks.GeometryMask;
};

/** Modal-owned tween.js animation; no scene update or HUD rendering is involved. */
export function createMutationCardSheens(
  scene: Phaser.Scene,
  modal: Phaser.GameObjects.Container,
  cards: MutationSheenCard[],
  reducedMotion = prefersReducedMotion(),
): { destroy: () => void } {
  const group = new Group();
  const entries: SheenEntry[] = [];
  let destroyed = false;

  cards.forEach(({ card, width, height, accent }, index) => {
    const clip = scene.make.graphics({}).setVisible(false);
    clip.fillStyle(0xffffff, 1).fillRect(-width / 2, -height / 2, width, height);
    card.add(clip);

    const object = scene.textures.exists(MUTATION_CARD_SHEEN_TEXTURE_KEY)
      ? scene.add.image(0, 0, MUTATION_CARD_SHEEN_TEXTURE_KEY)
        .setDisplaySize(Math.max(42, width * 0.16), height * 1.5)
        .setTint(accent)
      : scene.add.rectangle(0, 0, Math.max(24, width * 0.08), height * 1.5, accent, 1);
    object.setRotation(-0.2).setBlendMode(Phaser.BlendModes.ADD).setAlpha(reducedMotion ? 0.08 : 0.18);
    card.add(object);
    const mask = clip.createGeometryMask();
    object.setMask(mask);
    entries.push({ object, mask });

    if (reducedMotion) {
      object.x = width * 0.22;
      return;
    }
    const proxy = { x: -width * 0.65 };
    object.x = proxy.x;
    new Tween(proxy, group)
      .to({ x: width * 0.65 }, 1450)
      .easing(Easing.Sinusoidal.InOut)
      .delay(index * 120)
      .repeat(Infinity)
      .repeatDelay(850)
      .onUpdate(() => { object.x = proxy.x; })
      .start();
  });

  const update = (): void => { group.update(); };
  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    scene.events.off(Phaser.Scenes.Events.UPDATE, update);
    scene.events.off(Phaser.Scenes.Events.SHUTDOWN, destroy);
    modal.off(Phaser.GameObjects.Events.DESTROY, destroy);
    group.removeAll();
    for (const entry of entries) {
      if (entry.object.active) entry.object.clearMask(false);
      entry.mask.destroy();
    }
    entries.length = 0;
  };

  if (!reducedMotion && cards.length > 0) scene.events.on(Phaser.Scenes.Events.UPDATE, update);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, destroy);
  modal.once(Phaser.GameObjects.Events.DESTROY, destroy);
  return { destroy };
}
