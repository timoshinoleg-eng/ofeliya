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
  generation = 0;
  splitUsed = false;
  /**
   * QA-эксперимент: враг, попадание в которое породило эту копию.
   *
   * Идентификация — ПАРОЙ (объект + серийный номер появления):
   * `spawnSerial` — инстансный счётчик объекта, поэтому у ДВУХ РАЗНЫХ врагов
   * при первом появлении он одинаков (1). Одного номера мало: так можно
   * пропустить совершенно чужого врага.
   *
   * null / -1 = источник не записан. Поля сбрасываются в fire() и
   * deactivateForStageReset(), то есть при переиспользовании снаряда из пула.
   */
  qaSourceEnemy: Enemy | null = null;
  qaSourceSpawnSerial = -1;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'viral-particle');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(14);
  }

  fire(now: number, angle: number, damage: number, pierce: number, prism = false, generation = 0): void {
    this.enableBody(true, this.x, this.y, true, true);
    this.damage = damage;
    this.pierceLeft = pierce;
    this.prism = prism;
    this.generation = generation;
    this.splitUsed = false;
    this.qaSourceEnemy = null;
    this.qaSourceSpawnSerial = -1;
    this.dieAt = now + WEAPON.bulletLifetimeMs;
    this.lastHit = null;
    this.lastHitAt = 0;
    this.setRotation(angle);
    if (prism) {
      this.setTint(COLORS.gold).setBlendMode(Phaser.BlendModes.ADD).setAlpha(1).setScale(1.22);
    } else {
      this.clearTint().setBlendMode(Phaser.BlendModes.ADD).setAlpha(1).setScale(1);
    }
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(Math.cos(angle) * WEAPON.bulletSpeed, Math.sin(angle) * WEAPON.bulletSpeed);
  }

  deactivateForStageReset(): void {
    this.lastHit = null;
    this.lastHitAt = 0;
    this.prism = false;
    this.generation = 0;
    this.splitUsed = false;
    this.qaSourceEnemy = null;
    this.qaSourceSpawnSerial = -1;
    this.dieAt = 0;
    this.clearTint().setAlpha(1).setScale(1);
    this.disableBody(true, true);
  }

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    if (!this.active) return;
    // ГИПЕРШИП мерцает без дополнительных объектов/emitters — дешёвая визуальная сигнатура.
    if (this.prism) this.setAlpha(0.82 + Math.sin(time / 55) * 0.18);
    if (time > this.dieAt) this.disableBody(true, true);
  }
}
