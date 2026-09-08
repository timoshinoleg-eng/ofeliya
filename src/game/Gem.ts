import Phaser from 'phaser';
import { GEM } from './config';
import type { GameScene } from '../scenes/GameScene';

export class Gem extends Phaser.Physics.Arcade.Sprite {
  value = 1;

  private gs: GameScene | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'gem');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(5);
  }

  activate(gs: GameScene, x: number, y: number, value: number): void {
    this.gs = gs;
    this.enableBody(true, x, y, true, true);
    this.value = value;
    this.setScale(1);
    this.setAlpha(1);
    this.setRotation(0);
  }

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    if (!this.active || !this.gs) return;
    const p = this.gs.player;
    const dx = p.x - this.x;
    const dy = p.y - this.y;
    const d = Math.hypot(dx, dy) || 1;
    const body = this.body as Phaser.Physics.Arcade.Body;
    if (d < this.gs.runState.magnetRadius) {
      body.setVelocity((dx / d) * GEM.attractSpeed, (dy / d) * GEM.attractSpeed);
    } else if (body.velocity.lengthSq() > 1) {
      body.setVelocity(body.velocity.x * 0.85, body.velocity.y * 0.85);
    }
  }

  collect(): void {
    if (!this.active) return;
    this.gs?.onGemCollected(this.value);
    this.disableBody(true, true);
  }
}
