import Phaser from 'phaser';
import { COLORS } from './config';

type Side = 'left' | 'right';

interface MoveStickState {
  active: boolean;
  pointerId: number;
  touchX: number;
  touchY: number;
  vectorX: number;
  vectorY: number;
  serial: number;
  centerX: number;
  centerY: number;
  base: Phaser.GameObjects.Arc;
  knob: Phaser.GameObjects.Arc;
}

/**
 * Two-thumb movement-only profile.
 *
 * Both lower pads publish the same movement channel ('joy'); firing remains automatic.
 * When both thumbs are active, the most recently moved non-deadzone stick owns movement.
 * Releasing that thumb immediately hands control back to the other active stick.
 */
export class DualMoveControls {
  private readonly scene: Phaser.Scene;
  private readonly blockedFn: () => boolean;
  private readonly radius: number;
  private readonly left: MoveStickState;
  private readonly right: MoveStickState;
  private sequence = 0;

  private readonly idleAlpha = 0.18;
  private readonly activeAlpha = 0.68;
  private readonly deadzone = 0.11;
  private readonly activeZoneTop = 0.76;

  constructor(scene: Phaser.Scene, blockedFn: () => boolean) {
    this.scene = scene;
    this.blockedFn = blockedFn;
    this.radius = Phaser.Math.Clamp(Math.min(scene.scale.width, scene.scale.height) * 0.115, 44, 58);
    this.left = this.createStick();
    this.right = this.createStick();

    scene.registry.remove('aimJoy');
    scene.registry.set('joy', { x: 0, y: 0 });

    this.layout();

    scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
    scene.scale.on('resize', this.onResize, this);

    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
      scene.input.off(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
      scene.input.off(Phaser.Input.Events.POINTER_UP, this.onUp, this);
      scene.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
      scene.scale.off('resize', this.onResize, this);
      scene.tweens.killTweensOf([
        this.left.base,
        this.left.knob,
        this.right.base,
        this.right.knob,
      ]);
      scene.registry.remove('joy');
      scene.registry.remove('aimJoy');
    });
  }

  reset(): void {
    this.releaseImmediately(this.left);
    this.releaseImmediately(this.right);
    this.publish(0, 0);
  }

  private createStick(): MoveStickState {
    const knobRadius = Phaser.Math.Clamp(this.radius * 0.42, 19, 25);
    const base = this.scene.add
      .circle(0, 0, this.radius, COLORS.magenta, 0.11)
      .setStrokeStyle(2, COLORS.magenta, 0.72)
      .setScrollFactor(0)
      .setDepth(60)
      .setAlpha(this.idleAlpha)
      .setVisible(true);
    const knob = this.scene.add
      .circle(0, 0, knobRadius, COLORS.white, 0.34)
      .setStrokeStyle(1.5, COLORS.magenta, 0.88)
      .setScrollFactor(0)
      .setDepth(61)
      .setAlpha(this.idleAlpha)
      .setVisible(true);

    return {
      active: false,
      pointerId: -1,
      touchX: 0,
      touchY: 0,
      vectorX: 0,
      vectorY: 0,
      serial: 0,
      centerX: 0,
      centerY: 0,
      base,
      knob,
    };
  }

  private layout(): void {
    const W = this.scene.scale.width;
    const H = this.scene.scale.height;
    const edgeInset = Math.max(this.radius + 18, W * 0.24);
    const y = H - Math.max(this.radius + 18, H * 0.075);

    this.left.centerX = edgeInset;
    this.left.centerY = y;
    this.right.centerX = W - edgeInset;
    this.right.centerY = y;

    this.left.base.setPosition(this.left.centerX, this.left.centerY);
    this.right.base.setPosition(this.right.centerX, this.right.centerY);
    if (!this.left.active) this.left.knob.setPosition(this.left.centerX, this.left.centerY);
    if (!this.right.active) this.right.knob.setPosition(this.right.centerX, this.right.centerY);
  }

  private onResize(): void {
    this.reset();
    this.layout();
  }

  private onDown(p: Phaser.Input.Pointer): void {
    if (this.blockedFn() || p.y < this.scene.scale.height * this.activeZoneTop) return;

    const side: Side = p.x < this.scene.scale.width / 2 ? 'left' : 'right';
    const stick = side === 'left' ? this.left : this.right;
    if (stick.active) return;

    stick.active = true;
    stick.pointerId = p.id;
    stick.touchX = p.x;
    stick.touchY = p.y;
    stick.vectorX = 0;
    stick.vectorY = 0;
    stick.serial = ++this.sequence;

    this.scene.tweens.killTweensOf([stick.base, stick.knob]);
    stick.base.setAlpha(this.activeAlpha);
    stick.knob.setPosition(stick.centerX, stick.centerY).setAlpha(this.activeAlpha);
    this.recomputeJoy();
  }

  private onMove(p: Phaser.Input.Pointer): void {
    const stick =
      this.left.active && p.id === this.left.pointerId
        ? this.left
        : this.right.active && p.id === this.right.pointerId
          ? this.right
          : null;
    if (!stick) return;

    if (this.blockedFn()) {
      this.reset();
      return;
    }

    let dx = p.x - stick.touchX;
    let dy = p.y - stick.touchY;
    const distance = Math.hypot(dx, dy);
    if (distance > this.radius) {
      dx = (dx / distance) * this.radius;
      dy = (dy / distance) * this.radius;
    }

    const nx = dx / this.radius;
    const ny = dy / this.radius;
    const magnitude = Math.hypot(nx, ny);
    if (magnitude < this.deadzone) {
      stick.vectorX = 0;
      stick.vectorY = 0;
      stick.knob.setPosition(stick.centerX, stick.centerY);
    } else {
      stick.vectorX = nx;
      stick.vectorY = ny;
      stick.serial = ++this.sequence;
      stick.knob.setPosition(stick.centerX + dx, stick.centerY + dy);
    }

    this.recomputeJoy();
  }

  private onUp(p: Phaser.Input.Pointer): void {
    if (this.left.active && p.id === this.left.pointerId) {
      this.release(this.left);
      return;
    }
    if (this.right.active && p.id === this.right.pointerId) this.release(this.right);
  }

  private release(stick: MoveStickState): void {
    stick.active = false;
    stick.pointerId = -1;
    stick.vectorX = 0;
    stick.vectorY = 0;

    this.scene.tweens.killTweensOf([stick.base, stick.knob]);
    this.scene.tweens.add({
      targets: [stick.base, stick.knob],
      alpha: this.idleAlpha,
      duration: 90,
      ease: 'Quad.Out',
    });
    this.scene.tweens.add({
      targets: stick.knob,
      x: stick.centerX,
      y: stick.centerY,
      duration: 90,
      ease: 'Quad.Out',
    });
    this.recomputeJoy();
  }

  private releaseImmediately(stick: MoveStickState): void {
    stick.active = false;
    stick.pointerId = -1;
    stick.vectorX = 0;
    stick.vectorY = 0;
    this.scene.tweens.killTweensOf([stick.base, stick.knob]);
    stick.base.setAlpha(this.idleAlpha);
    stick.knob.setPosition(stick.centerX, stick.centerY).setAlpha(this.idleAlpha);
  }

  private recomputeJoy(): void {
    const candidates = [this.left, this.right].filter(
      (stick) => stick.active && Math.hypot(stick.vectorX, stick.vectorY) >= this.deadzone
    );
    if (candidates.length === 0) {
      this.publish(0, 0);
      return;
    }

    const winner = candidates.reduce((best, stick) => (stick.serial > best.serial ? stick : best));
    this.publish(winner.vectorX, winner.vectorY);
  }

  private publish(x: number, y: number): void {
    this.scene.registry.set('joy', { x, y });
  }
}
