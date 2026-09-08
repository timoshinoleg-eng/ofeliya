import Phaser from 'phaser';
import { COLORS, WEAPON } from './config';
import type { Enemy } from './Enemy';

export class Bullet extends Phaser.Physics.Arcade.Sprite {
  damage = 0;
  pierceLeft = 0;
  dieAt = 0;
  lastHit: Enemy | null = null;
  lastHitAt = 0;
  prism = false;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'bullet');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(14);
  }

  fire(now: number, angle: number, damage: number, pierce: number, prism = false): void {
    this.enableBody(true, this.x, this.y, true, true);
    this.damage = damage;
    this.pierceLeft = pierce;
    this.prism = prism;
    this.dieAt = now + WEAPON.bulletLifetimeMs;
    this.lastHit = null;
    this.lastHitAt = 0;
    this.setRotation(angle);
    if (prism) {
      this.setTint(COLORS.gold).setBlendMode(Phaser.BlendModes.ADD).setAlpha(1);
    } else {
      this.clearTint().setBlendMode(Phaser.BlendModes.NORMAL).setAlpha(1);
    }
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(Math.cos(angle) * WEAPON.bulletSpeed, Math.sin(angle) * WEAPON.bulletSpeed);
  }

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    if (!this.active) return;
    // ПРИЗМА мерцает без дополнительных объектов/emitters — дешёвая визуальная сигнатура.
    if (this.prism) this.setAlpha(0.82 + Math.sin(time / 55) * 0.18);
    if (time > this.dieAt) this.disableBody(true, true);
  }
}
