import Phaser from 'phaser';
import { FOE_BULLET } from './config';

/** K2: снаряд снайпера (летит к игроку). Простой: скорость + время жизни. */
export class FoeBullet extends Phaser.Physics.Arcade.Sprite {
  damage = FOE_BULLET.dmg;
  dieAt = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'foebullet');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(13);
    (this.body as Phaser.Physics.Arcade.Body).setCircle(FOE_BULLET.radius, 0, 0);
  }

  shoot(now: number, angle: number): void {
    this.enableBody(true, this.x, this.y, true, true);
    this.damage = FOE_BULLET.dmg;
    this.dieAt = now + FOE_BULLET.lifetimeMs;
    this.setRotation(angle);
    (this.body as Phaser.Physics.Arcade.Body).setVelocity(
      Math.cos(angle) * FOE_BULLET.speed,
      Math.sin(angle) * FOE_BULLET.speed
    );
  }

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    if (!this.active) return;
    if (time > this.dieAt) this.disableBody(true, true);
  }
}
