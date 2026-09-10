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
  /** K3: комета — тяжёлый снаряд (КОМЕТА). */
  comet = false;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'bullet');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(14);
  }

  fire(
    now: number,
    angle: number,
    damage: number,
    pierce: number,
    prism = false,
    opts: { comet?: boolean; speed?: number; lifetimeMs?: number } = {}
  ): void {
    this.enableBody(true, this.x, this.y, true, true);
    this.damage = damage;
    this.pierceLeft = pierce;
    this.prism = prism;
    this.comet = !!opts.comet;
    this.dieAt = now + (opts.lifetimeMs ?? WEAPON.bulletLifetimeMs);
    this.lastHit = null;
    this.lastHitAt = 0;
    this.setRotation(angle);
    const body = this.body as Phaser.Physics.Arcade.Body;
    if (this.comet) {
      this.setScale(1.7)
        .setTint(COLORS.orange)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setAlpha(1);
      body.setSize(18, 8);
    } else {
      this.setScale(1);
      body.setSize(14, 6);
      if (prism) {
        this.setTint(COLORS.gold).setBlendMode(Phaser.BlendModes.ADD).setAlpha(1);
      } else {
        this.clearTint().setBlendMode(Phaser.BlendModes.NORMAL).setAlpha(1);
      }
    }
    const speed = opts.speed ?? WEAPON.bulletSpeed;
    body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
  }

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    if (!this.active) return;
    // ПРИЗМА/КОМЕТА мерцают без дополнительных объектов/emitters.
    if (this.prism) this.setAlpha(0.82 + Math.sin(time / 55) * 0.18);
    else if (this.comet) this.setAlpha(0.9 + Math.sin(time / 40) * 0.1);
    if (time > this.dieAt) this.disableBody(true, true);
  }
}
