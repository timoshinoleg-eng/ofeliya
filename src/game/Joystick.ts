import Phaser from 'phaser';
import { COLORS } from './config';

/** Floating one-thumb joystick. Publishes movement vector into registry ('joy'). */
export class Joystick {
  private readonly scene: Phaser.Scene;
  private readonly base: Phaser.GameObjects.Arc;
  private readonly knob: Phaser.GameObjects.Arc;
  private readonly blockedFn: () => boolean;
  private readonly radius: number;
  private active = false;
  private pointerId = -1;
  private ox = 0;
  private oy = 0;
  private touchX = 0;
  private touchY = 0;

  constructor(scene: Phaser.Scene, blockedFn: () => boolean) {
    this.scene = scene;
    this.blockedFn = blockedFn;
    this.radius = Phaser.Math.Clamp(Math.min(scene.scale.width, scene.scale.height) * 0.145, 54, 70);
    const knobRadius = Phaser.Math.Clamp(this.radius * 0.42, 22, 29);

    this.base = scene.add
      .circle(0, 0, this.radius, COLORS.magenta, 0.075)
      .setStrokeStyle(2, COLORS.magenta, 0.42)
      .setScrollFactor(0)
      .setDepth(60)
      .setAlpha(0)
      .setVisible(false);
    this.knob = scene.add
      .circle(0, 0, knobRadius, COLORS.white, 0.24)
      .setStrokeStyle(1.5, COLORS.magenta, 0.7)
      .setScrollFactor(0)
      .setDepth(61)
      .setAlpha(0)
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
      scene.tweens.killTweensOf([this.base, this.knob]);
      scene.registry.remove('joy');
    });
  }

  private onDown(p: Phaser.Input.Pointer): void {
    const hudSafeY = Math.max(104, this.scene.scale.height * 0.135);
    if (this.active || this.blockedFn() || p.y <= hudSafeY) return;

    this.active = true;
    this.pointerId = p.id;
    this.touchX = p.x;
    this.touchY = p.y;

    // Keep the visual control fully on-screen even if the thumb starts on a physical edge.
    const margin = this.radius + 8;
    this.ox = Phaser.Math.Clamp(p.x, margin, Math.max(margin, this.scene.scale.width - margin));
    this.oy = Phaser.Math.Clamp(p.y, margin, Math.max(margin, this.scene.scale.height - margin));

    this.scene.tweens.killTweensOf([this.base, this.knob]);
    this.base.setPosition(this.ox, this.oy).setVisible(true).setAlpha(1);
    this.knob.setPosition(this.ox, this.oy).setVisible(true).setAlpha(1);
    this.publish(0, 0);
  }

  private onMove(p: Phaser.Input.Pointer): void {
    if (!this.active || p.id !== this.pointerId) return;
    let dx = p.x - this.touchX;
    let dy = p.y - this.touchY;
    const d = Math.hypot(dx, dy);
    if (d > this.radius) {
      dx = (dx / d) * this.radius;
      dy = (dy / d) * this.radius;
    }
    this.knob.setPosition(this.ox + dx, this.oy + dy);
    const nx = dx / this.radius;
    const ny = dy / this.radius;
    if (Math.hypot(nx, ny) < 0.11) this.publish(0, 0);
    else this.publish(nx, ny);
  }

  private onUp(p: Phaser.Input.Pointer): void {
    if (!this.active || p.id !== this.pointerId) return;
    this.active = false;
    this.pointerId = -1;
    this.publish(0, 0);
    this.scene.tweens.killTweensOf([this.base, this.knob]);
    this.scene.tweens.add({
      targets: [this.base, this.knob],
      alpha: 0,
      duration: 90,
      ease: 'Quad.Out',
      onComplete: () => {
        if (this.active) return;
        this.base.setVisible(false);
        this.knob.setVisible(false);
      },
    });
  }

  private publish(x: number, y: number): void {
    this.scene.registry.set('joy', { x, y });
  }
}
