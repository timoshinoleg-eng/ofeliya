import Phaser from 'phaser';
import { COLORS } from './config';

/** Виртуальный джойстик: появляется под пальцем, публикует вектор в registry ('joy'). */
export class Joystick {
  private base: Phaser.GameObjects.Arc;
  private knob: Phaser.GameObjects.Arc;
  private active = false;
  private pointerId = -1;
  private ox = 0;
  private oy = 0;
  private readonly R = 62;
  private blockedFn: () => boolean;

  constructor(scene: Phaser.Scene, blockedFn: () => boolean) {
    this.blockedFn = blockedFn;
    this.base = scene.add
      .circle(0, 0, this.R, COLORS.cyan, 0.07)
      .setStrokeStyle(2, COLORS.cyan, 0.35)
      .setScrollFactor(0)
      .setDepth(60)
      .setVisible(false);
    this.knob = scene.add
      .circle(0, 0, 26, COLORS.cyan, 0.3)
      .setScrollFactor(0)
      .setDepth(61)
      .setVisible(false);

    scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
      scene.input.off(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
      scene.input.off(Phaser.Input.Events.POINTER_UP, this.onUp, this);
      scene.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
      scene.registry.remove('joy');
    });
  }

  private onDown(p: Phaser.Input.Pointer): void {
    if (this.active || this.blockedFn() || p.y <= 96) return;
    this.active = true;
    this.pointerId = p.id;
    this.ox = p.x;
    this.oy = p.y;
    this.base.setPosition(p.x, p.y).setVisible(true);
    this.knob.setPosition(p.x, p.y).setVisible(true);
    this.publish(0, 0);
  }

  private onMove(p: Phaser.Input.Pointer): void {
    if (!this.active || p.id !== this.pointerId) return;
    let dx = p.x - this.ox;
    let dy = p.y - this.oy;
    const d = Math.hypot(dx, dy);
    if (d > this.R) {
      dx = (dx / d) * this.R;
      dy = (dy / d) * this.R;
    }
    this.knob.setPosition(this.ox + dx, this.oy + dy);
    const nx = dx / this.R;
    const ny = dy / this.R;
    if (Math.hypot(nx, ny) < 0.12) this.publish(0, 0);
    else this.publish(nx, ny);
  }

  private onUp(p: Phaser.Input.Pointer): void {
    if (!this.active || p.id !== this.pointerId) return;
    this.active = false;
    this.pointerId = -1;
    this.base.setVisible(false);
    this.knob.setVisible(false);
    this.publish(0, 0);
  }

  private publish(x: number, y: number): void {
    this.base.scene.registry.set('joy', { x, y });
  }
}
