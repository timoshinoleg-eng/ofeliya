import Phaser from 'phaser';
import { WEAPON } from './config';
import type { Enemy } from './Enemy';

export class Bullet extends Phaser.Physics.Arcade.Sprite {
  damage = 0;
  pierceLeft = 0;
  dieAt = 0;
  lastHit: Enemy | null = null;
  lastHitAt = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'bullet');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(14);
  }

  fire(now: number, angle: number, damage: number, pierce: number): void {
    this.enableBody(true, this.x, this.y, true, true);
    this.damage = damage;
    this.pierceLeft = pierce;
    this.dieAt = now + WEAPON.bulletLifetimeMs;
    this.lastHit = null;
    this.lastHitAt = 0;
    this.setRotation(angle);
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(Math.cos(angle) * WEAPON.bulletSpeed, Math.sin(angle) * WEAPON.bulletSpeed);
  }

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    if (!this.active) return;
    if (time > this.dieAt) this.disableBody(true, true);
  }
}
