import Phaser from 'phaser';
import { COLORS } from './config';

type StickRole = 'move' | 'aim';

interface StickState {
  active: boolean;
  pointerId: number;
  touchX: number;
  touchY: number;
  originX: number;
  originY: number;
  base: Phaser.GameObjects.Arc;
  knob: Phaser.GameObjects.Arc;
}

/**
 * Optional two-thumb control profile.
 * Left half = movement. Right half = aim priority.
 * Firing remains automatic; aim only biases target selection.
 */
export class TwinStickControls {
  private readonly scene: Phaser.Scene;
  private readonly blockedFn: () => boolean;
  private readonly radius: number;
  private readonly move: StickState;
  private readonly aim: StickState;

  constructor(scene: Phaser.Scene, blockedFn: () => boolean) {
    this.scene = scene;
    this.blockedFn = blockedFn;
    this.radius = Phaser.Math.Clamp(Math.min(scene.scale.width, scene.scale.height) * 0.13, 50, 66);
    this.move = this.createStick(COLORS.magenta);
    this.aim = this.createStick(COLORS.cyan);

    scene.registry.set('joy', { x: 0, y: 0 });
    scene.registry.set('aimJoy', { x: 0, y: 0 });

    scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
    const resetOnFocusLoss = () => this.reset();
    const resetOnVisibilityLoss = () => {
      if (document.visibilityState === 'hidden') this.reset();
    };
    window.addEventListener('blur', resetOnFocusLoss);
    document.addEventListener('visibilitychange', resetOnVisibilityLoss);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('blur', resetOnFocusLoss);
      document.removeEventListener('visibilitychange', resetOnVisibilityLoss);
      scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
      scene.input.off(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
      scene.input.off(Phaser.Input.Events.POINTER_UP, this.onUp, this);
      scene.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
      this.reset();
      scene.tweens.killTweensOf([
        this.move.base,
        this.move.knob,
        this.aim.base,
        this.aim.knob,
      ]);
      scene.registry.remove('joy');
      scene.registry.remove('aimJoy');
    });
  }

  private createStick(color: number): StickState {
    const knobRadius = Phaser.Math.Clamp(this.radius * 0.42, 21, 28);
    const base = this.scene.add
      .circle(0, 0, this.radius, color, 0.06)
      .setStrokeStyle(2, color, 0.5)
      .setScrollFactor(0)
      .setDepth(60)
      .setVisible(false);
    const knob = this.scene.add
      .circle(0, 0, knobRadius, COLORS.white, 0.22)
      .setStrokeStyle(1.5, color, 0.82)
      .setScrollFactor(0)
      .setDepth(61)
      .setVisible(false);
    return {
      active: false,
      pointerId: -1,
      touchX: 0,
      touchY: 0,
      originX: 0,
      originY: 0,
      base,
      knob,
    };
  }

  private onDown(p: Phaser.Input.Pointer): void {
    const hudSafeY = Math.max(104, this.scene.scale.height * 0.135);
    if (this.blockedFn() || p.y <= hudSafeY) return;

    const role: StickRole = p.x < this.scene.scale.width / 2 ? 'move' : 'aim';
    const stick = role === 'move' ? this.move : this.aim;
    if (stick.active) return;

    stick.active = true;
    stick.pointerId = p.id;
    stick.touchX = p.x;
    stick.touchY = p.y;

    const margin = this.radius + 8;
    const half = this.scene.scale.width / 2;
    const minX = role === 'move' ? margin : half + margin * 0.25;
    const maxX = role === 'move' ? half - margin * 0.25 : this.scene.scale.width - margin;
    stick.originX = Phaser.Math.Clamp(p.x, Math.min(minX, maxX), Math.max(minX, maxX));
    stick.originY = Phaser.Math.Clamp(
      p.y,
      margin,
      Math.max(margin, this.scene.scale.height - margin)
    );

    this.scene.tweens.killTweensOf([stick.base, stick.knob]);
    stick.base.setPosition(stick.originX, stick.originY).setVisible(true).setAlpha(1);
    stick.knob.setPosition(stick.originX, stick.originY).setVisible(true).setAlpha(1);
    this.publish(role, 0, 0);
  }

  private onMove(p: Phaser.Input.Pointer): void {
    const match =
      this.move.active && p.id === this.move.pointerId
        ? { role: 'move' as const, stick: this.move }
        : this.aim.active && p.id === this.aim.pointerId
          ? { role: 'aim' as const, stick: this.aim }
          : null;
    if (!match) return;

    let dx = p.x - match.stick.touchX;
    let dy = p.y - match.stick.touchY;
    const d = Math.hypot(dx, dy);
    if (d > this.radius) {
      dx = (dx / d) * this.radius;
      dy = (dy / d) * this.radius;
    }

    match.stick.knob.setPosition(match.stick.originX + dx, match.stick.originY + dy);
    const nx = dx / this.radius;
    const ny = dy / this.radius;
    if (Math.hypot(nx, ny) < 0.11) this.publish(match.role, 0, 0);
    else this.publish(match.role, nx, ny);
  }

  reset(): void {
    this.releaseImmediately('move', this.move);
    this.releaseImmediately('aim', this.aim);
  }

  private releaseImmediately(role: StickRole, stick: StickState): void {
    stick.active = false;
    stick.pointerId = -1;
    this.publish(role, 0, 0);
    this.scene.tweens.killTweensOf([stick.base, stick.knob]);
    stick.base.setVisible(false).setAlpha(0);
    stick.knob.setVisible(false).setAlpha(0);
  }

  private onUp(p: Phaser.Input.Pointer): void {
    if (this.move.active && p.id === this.move.pointerId) {
      this.release('move', this.move);
      return;
    }
    if (this.aim.active && p.id === this.aim.pointerId) this.release('aim', this.aim);
  }

  private release(role: StickRole, stick: StickState): void {
    stick.active = false;
    stick.pointerId = -1;
    this.publish(role, 0, 0);
    this.scene.tweens.killTweensOf([stick.base, stick.knob]);
    this.scene.tweens.add({
      targets: [stick.base, stick.knob],
      alpha: 0,
      duration: 90,
      ease: 'Quad.Out',
      onComplete: () => {
        if (stick.active) return;
        stick.base.setVisible(false);
        stick.knob.setVisible(false);
      },
    });
  }

  private publish(role: StickRole, x: number, y: number): void {
    this.scene.registry.set(role === 'move' ? 'joy' : 'aimJoy', { x, y });
  }
}
