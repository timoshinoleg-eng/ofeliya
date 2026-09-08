import Phaser from 'phaser';
import { PLAYER } from './config';

export class Player extends Phaser.Physics.Arcade.Sprite {
  hurtUntil = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'virus-player');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(15);
    // Preserve the original gameplay hitbox despite the larger, more detailed virion art.
    (this.body as Phaser.Physics.Arcade.Body).setCircle(13, 9, 9);
  }

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    if (!this.active) return;
    // Cheap living-organism motion: no emitters or extra objects.
    this.setRotation(time * 0.00016);
    const breathe = 1 + Math.sin(time * 0.0042) * 0.035;
    this.setScale(breathe);
  }

  markHurt(now: number): void {
    this.hurtUntil = now + PLAYER.iframeMs;
    this.setTintFill(0xffffff);
  }
}
