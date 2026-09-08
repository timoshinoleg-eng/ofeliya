import Phaser from 'phaser';
import { PLAYER } from './config';

export class Player extends Phaser.Physics.Arcade.Sprite {
  hurtUntil = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'player');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(15);
    (this.body as Phaser.Physics.Arcade.Body).setCircle(13, 1, 1);
  }

  markHurt(now: number): void {
    this.hurtUntil = now + PLAYER.iframeMs;
    this.setTintFill(0xffffff);
  }
}
