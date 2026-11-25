import Phaser from 'phaser';
import { prefersReducedMotion } from '../systems/MotionPreferences';
import type { MenuKeyboard, MenuKeyboardControl, MenuKeyboardScope } from './MenuKeyboard';

export type ScrollViewportBounds = { x: number; y: number; width: number; height: number };

export type ScrollViewportOptions = {
  parent: Phaser.GameObjects.Container;
  content: Phaser.GameObjects.Container;
  bounds: ScrollViewportBounds;
  contentHeight: number;
  name?: string;
  keyboard?: MenuKeyboard;
  blocked?: () => boolean;
  escape?: () => boolean;
  onChange?: (offset: number, limit: number) => void;
};

export const SCROLL_TAP_THRESHOLD_PX = 10;
const WHEEL_SCALE = 0.5;
const INERTIA_MS = 220;

/** A Phaser-only vertical viewport with renderer-independent geometry clipping. */
export class ScrollViewport {
  readonly hitZone: Phaser.GameObjects.Zone;
  private readonly clip: Phaser.GameObjects.Graphics;
  private readonly mask: Phaser.Display.Masks.GeometryMask;
  private readonly parent: Phaser.GameObjects.Container;
  private readonly content: Phaser.GameObjects.Container;
  private readonly scene: Phaser.Scene;
  private bounds: ScrollViewportBounds;
  private contentHeight: number;
  private contentStartY: number;
  private offset = 0;
  private limit = 0;
  private owner = -1;
  private dragging = false;
  private dragStartY = 0;
  private lastY = 0;
  private lastMoveAt = 0;
  private velocity = 0;
  private inertia: Phaser.Tweens.Tween | null = null;
  private destroyed = false;
  private focusScope: MenuKeyboardScope | null = null;
  private focusControls: MenuKeyboardControl[] = [];
  private inputStates = new Map<Phaser.GameObjects.GameObject, boolean>();
  private readonly onChange?: (offset: number, limit: number) => void;

  constructor(scene: Phaser.Scene, options: ScrollViewportOptions) {
    this.scene = scene;
    this.parent = options.parent;
    this.content = options.content;
    this.bounds = { ...options.bounds };
    this.contentHeight = Math.max(0, options.contentHeight);
    this.contentStartY = options.content.y;
    this.onChange = options.onChange;

    const name = options.name ?? 'ofeliya-scroll';
    this.hitZone = scene.add.zone(
      this.bounds.x + this.bounds.width / 2,
      this.bounds.y + this.bounds.height / 2,
      this.bounds.width,
      this.bounds.height,
    ).setName(`${name}-hit`).setInteractive();
    this.parent.addAt(this.hitZone, Math.max(0, this.parent.getIndex(this.content)));

    this.clip = scene.make.graphics({}).setVisible(false);
    this.clip.fillStyle(0xffffff, 1).fillRect(0, 0, this.bounds.width, this.bounds.height);
    this.clip.setPosition(this.bounds.x, this.bounds.y);
    this.parent.add(this.clip);
    this.mask = this.clip.createGeometryMask();
    this.content.setMask(this.mask);

    if (options.keyboard) {
      this.focusScope = options.keyboard.createScope({
        blocked: options.blocked,
        escape: options.escape ?? (() => false),
      });
    }

    scene.input.on('pointerdown', this.onPointerDown, this);
    scene.input.on('pointermove', this.onPointerMove, this);
    scene.input.on('pointerup', this.onPointerUp, this);
    scene.input.on('pointerupoutside', this.onPointerUp, this);
    scene.input.on('wheel', this.onWheel, this);
    scene.input.on('gameout', this.onGameOut, this);
    scene.scale.on('resize', this.onScaleResize, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    this.content.once(Phaser.GameObjects.Events.DESTROY, this.destroy, this);
    this.refresh(this.contentHeight);
  }

  get scrollOffset(): number { return this.offset; }
  get scrollLimit(): number { return this.limit; }

  setFocusTargets(targets: MenuKeyboardControl[]): void {
    this.focusControls = targets.map(target => ({
      ...target,
      keyboardAvailable: this.inputStates.get(target.object) === true,
      onFocus: () => {
        target.onFocus?.();
        if (target.id) this.scrollToTarget(target.id);
      },
    }));
    this.focusScope?.setControls(this.focusControls);
  }

  refresh(contentHeight = this.contentHeight): void {
    if (this.destroyed) return;
    this.contentHeight = Math.max(0, contentHeight);
    this.limit = Math.max(0, this.contentStartY + this.contentHeight - (this.bounds.y + this.bounds.height));
    this.captureInputStates();
    this.applyOffset(this.offset);
  }

  resize(bounds: ScrollViewportBounds, contentHeight = this.contentHeight, contentStartY = this.contentStartY): void {
    if (this.destroyed) return;
    this.bounds = { ...bounds };
    this.contentStartY = contentStartY;
    this.hitZone.setPosition(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    this.hitZone.setSize(bounds.width, bounds.height);
    this.clip.clear().fillStyle(0xffffff, 1).fillRect(0, 0, bounds.width, bounds.height);
    this.clip.setPosition(bounds.x, bounds.y);
    this.refresh(contentHeight);
  }

  scrollTo(next: number): void {
    if (this.destroyed) return;
    this.stopInertia();
    this.applyOffset(next);
  }

  scrollToTarget(id: string): boolean {
    if (this.destroyed) return false;
    const control = this.focusControls.find(target => target.id === id);
    if (!control) return false;
    const target = control.object.getBounds();
    const matrix = this.parent.getWorldTransformMatrix();
    const topLeft = matrix.transformPoint(this.bounds.x, this.bounds.y);
    const bottomRight = matrix.transformPoint(this.bounds.x + this.bounds.width, this.bounds.y + this.bounds.height);
    const unit = this.localUnitInPixels();
    let next = this.offset;
    if (target.y < topLeft.y) next -= (topLeft.y - target.y) / unit;
    if (target.y + target.height > bottomRight.y) next += (target.y + target.height - bottomRight.y) / unit;
    this.scrollTo(next);
    return true;
  }

  focus(id: string): boolean {
    if (!this.focusScope || !this.scrollToTarget(id)) return false;
    return this.focusScope.focus(id);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.owner = -1;
    this.dragging = false;
    this.stopInertia();
    this.syncInput();
    this.focusScope?.destroy();
    this.focusScope = null;
    this.focusControls = [];
    this.inputStates.clear();
    this.scene.input.off('pointerdown', this.onPointerDown, this);
    this.scene.input.off('pointermove', this.onPointerMove, this);
    this.scene.input.off('pointerup', this.onPointerUp, this);
    this.scene.input.off('pointerupoutside', this.onPointerUp, this);
    this.scene.input.off('wheel', this.onWheel, this);
    this.scene.input.off('gameout', this.onGameOut, this);
    this.scene.scale.off('resize', this.onScaleResize, this);
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    this.content.off(Phaser.GameObjects.Events.DESTROY, this.destroy, this);
    if (this.content.active) this.content.clearMask(false);
    this.mask.destroy();
    if (this.hitZone.active) this.hitZone.destroy();
    if (this.clip.active) this.clip.destroy();
  }

  private localPoint(pointer: Phaser.Input.Pointer): { x: number; y: number } {
    return this.parent.getWorldTransformMatrix().applyInverse(pointer.worldX, pointer.worldY, {
      x: 0, y: 0,
    } as Phaser.Math.Vector2);
  }

  private localUnitInPixels(): number {
    const matrix = this.parent.getWorldTransformMatrix();
    const a = matrix.transformPoint(0, 0);
    const b = matrix.transformPoint(0, 1);
    return Math.max(0.0001, Math.hypot(b.x - a.x, b.y - a.y));
  }

  private contains(pointer: Phaser.Input.Pointer): boolean {
    const point = this.localPoint(pointer);
    return point.x >= this.bounds.x && point.x <= this.bounds.x + this.bounds.width &&
      point.y >= this.bounds.y && point.y <= this.bounds.y + this.bounds.height;
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.destroyed || this.owner !== -1 || this.limit <= 0 || !this.contains(pointer)) return;
    this.stopInertia();
    const point = this.localPoint(pointer);
    this.owner = pointer.id;
    this.dragging = false;
    this.dragStartY = pointer.worldY;
    this.lastY = point.y;
    this.lastMoveAt = performance.now();
    this.velocity = 0;
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.destroyed || pointer.id !== this.owner) return;
    const point = this.localPoint(pointer);
    if (!this.dragging && Math.abs(pointer.worldY - this.dragStartY) < SCROLL_TAP_THRESHOLD_PX) return;
    if (!this.dragging) {
      this.dragging = true;
      this.syncInput();
    }
    const now = performance.now();
    const elapsed = Math.max(1, now - this.lastMoveAt);
    const delta = this.lastY - point.y;
    this.velocity = this.velocity * 0.55 + (delta / elapsed) * 0.45;
    this.lastY = point.y;
    this.lastMoveAt = now;
    this.applyOffset(this.offset + delta);
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    if (pointer.id !== this.owner) return;
    const shouldInertia = this.dragging && !pointer.wasCanceled;
    this.releasePointer();
    if (shouldInertia) this.startInertia();
  }

  private onGameOut(): void {
    if (this.owner !== -1) this.releasePointer();
  }

  private releasePointer(): void {
    const wasDragging = this.dragging;
    this.owner = -1;
    this.dragging = false;
    this.syncInput();
    if (wasDragging) {
      for (const object of this.inputStates.keys()) {
        if (object.active && object.input) object.emit('pointerout');
      }
    }
  }

  private onWheel(pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number): void {
    if (this.destroyed || this.limit <= 0 || !this.contains(pointer)) return;
    this.scrollTo(this.offset + dy * WHEEL_SCALE / this.localUnitInPixels());
  }

  private startInertia(): void {
    if (prefersReducedMotion() || Math.abs(this.velocity) < 0.04) return;
    const target = Phaser.Math.Clamp(this.offset + this.velocity * INERTIA_MS, 0, this.limit);
    if (Math.abs(target - this.offset) < 1) return;
    const proxy = { offset: this.offset };
    this.inertia = this.scene.tweens.add({
      targets: proxy,
      offset: target,
      duration: Math.min(420, Math.max(160, Math.abs(target - this.offset) * 2)),
      ease: 'Quad.Out',
      onUpdate: () => this.applyOffset(proxy.offset),
      onComplete: () => { this.inertia = null; },
    });
  }

  private stopInertia(): void {
    this.inertia?.stop();
    this.inertia = null;
  }

  private applyOffset(next: number): void {
    this.offset = Phaser.Math.Clamp(next, 0, this.limit);
    this.content.y = this.contentStartY - this.offset;
    this.syncInput();
    this.onChange?.(this.offset, this.limit);
  }

  private captureInputStates(): void {
    const previous = this.inputStates;
    this.inputStates = new Map();
    const visit = (object: Phaser.GameObjects.GameObject): void => {
      if (object.input) this.inputStates.set(object, previous.get(object) ?? object.input.enabled);
      const children = (object as Phaser.GameObjects.Container).list;
      if (Array.isArray(children)) children.forEach(visit);
    };
    this.content.list.forEach(visit);
  }

  private syncInput(): void {
    const matrix = this.parent.getWorldTransformMatrix();
    const topLeft = matrix.transformPoint(this.bounds.x, this.bounds.y);
    const bottomRight = matrix.transformPoint(this.bounds.x + this.bounds.width, this.bounds.y + this.bounds.height);
    for (const [object, enabled] of this.inputStates) {
      if (!object.active || !object.input) continue;
      const bounds = (object as Phaser.GameObjects.Rectangle).getBounds();
      object.input.enabled = enabled && !this.dragging && bounds.x >= topLeft.x && bounds.y >= topLeft.y &&
        bounds.x + bounds.width <= bottomRight.x && bounds.y + bounds.height <= bottomRight.y;
    }
  }

  private onScaleResize(): void {
    if (this.destroyed) return;
    this.clip.clear().fillStyle(0xffffff, 1).fillRect(0, 0, this.bounds.width, this.bounds.height);
  }
}
