import Phaser from 'phaser';
import { COLORS } from './config';
import { SafeArea } from '../systems/SafeArea';

/**
 * Виртуальный джойстик v2:
 * - появляется строго под пальцем, исчезает при отпускании (snap-back кноба);
 * - ВЕКТОР мгновенный (нулевая задержка ввода), сглаживается только ВИЗУАЛ кноба;
 * - deadzone с плавным ramp'ом — нет рывка на выходе из мёртвой зоны;
 * - флик (быстрый свайп ≥ FLICK_DIST за ≤ FLICK_MAX_MS) публикуется как dodge:
 *   при активном джойстике игрок и так двигался в ту же сторону — рывок её
 *   усиливает; «чистым» свайпом вторым пальцем dodge вызывается отдельно.
 *
 * Публикует вектор в глобальный registry ('joy') и вызывает onFlick.
 */
export class Joystick {
  private base: Phaser.GameObjects.Arc;
  private knob: Phaser.GameObjects.Arc;
  private active = false;
  private pointerId = -1;
  private ox = 0;
  private oy = 0;
  private knobX = 0;
  private knobY = 0;
  private knobTargetX = 0;
  private knobTargetY = 0;
  private snapTween: Phaser.Tweens.Tween | null = null;
  private domCancel: (e: PointerEvent) => void;
  /** След за всеми поинтерами (не только джойстик) — для фликов второй рукой. */
  private downInfo = new Map<number, { x: number; y: number; t: number }>();
  private readonly R = 62;
  private readonly KNOB = 26;
  private readonly DEAD = 0.14;
  private readonly FLICK_DIST = 48;
  private readonly FLICK_MAX_MS = 200;
  private blockedFn: () => boolean;
  private onFlick: (dirX: number, dirY: number) => void;
  private updateBound: (t: number, delta: number) => void;

  constructor(
    scene: Phaser.Scene,
    blockedFn: () => boolean,
    onFlick: (dirX: number, dirY: number) => void
  ) {
    this.blockedFn = blockedFn;
    this.onFlick = onFlick;

    this.base = scene.add
      .circle(0, 0, this.R, COLORS.cyan, 0.07)
      .setStrokeStyle(2, COLORS.cyan, 0.35)
      .setScrollFactor(0)
      .setDepth(60)
      .setVisible(false);
    this.knob = scene.add
      .circle(0, 0, this.KNOB, COLORS.cyan, 0.3)
      .setStrokeStyle(1.5, COLORS.cyan, 0.5)
      .setScrollFactor(0)
      .setDepth(61)
      .setVisible(false);

    const input = scene.input;
    input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    input.on(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
    // Phaser 3.90 не имеет события POINTER_CANCEL — ловим DOM pointercancel сами
    // (иначе после отмены тача джойстик «залипает» на мёртвом pointerId).
    this.domCancel = (e: PointerEvent) => this.onCancel(e.pointerId);
    scene.game.canvas.addEventListener('pointercancel', this.domCancel);
    this.updateBound = this.tick.bind(this);
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.updateBound);

    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      input.off(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
      input.off(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
      input.off(Phaser.Input.Events.POINTER_UP, this.onUp, this);
      input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
      scene.game.canvas.removeEventListener('pointercancel', this.domCancel);
      scene.events.off(Phaser.Scenes.Events.UPDATE, this.updateBound);
      this.snapTween?.stop();
      scene.registry.remove('joy');
    });
  }

  /**
   * Верхняя HUD-полоса: джойстик под ней не появляется. 100px покрывает XP-бар,
   * таймер, HP и кнопки (mute/pause до y = 90+safeTop), чтобы release пальца
   * не «попал» по кнопке звука во время свайпа.
   */
  private topZone(): number {
    return SafeArea.top + 100;
  }

  private onDown(p: Phaser.Input.Pointer): void {
    this.downInfo.set(p.id, { x: p.x, y: p.y, t: p.time });
    if (this.active || this.blockedFn() || p.y <= this.topZone()) return;
    this.active = true;
    this.pointerId = p.id;
    this.ox = p.x;
    this.oy = p.y;
    this.knobTargetX = p.x;
    this.knobTargetY = p.y;
    this.knobX = p.x;
    this.knobY = p.y;
    this.base.setPosition(p.x, p.y).setVisible(true);
    this.knob.setPosition(p.x, p.y).setVisible(true);
    this.publish(0, 0);
  }

  private onMove(p: Phaser.Input.Pointer): void {
    if (!this.active || p.id !== this.pointerId) return;
    const dx = p.x - this.ox;
    const dy = p.y - this.oy;
    const d = Math.hypot(dx, dy);
    const cx = d > this.R ? (dx / d) * this.R : dx;
    const cy = d > this.R ? (dy / d) * this.R : dy;
    // Вектор — мгновенно, без латентности.
    const v = this.scaleDead(cx / this.R, cy / this.R);
    this.publish(v.x, v.y);
    // Кноб — цель, сглаживается в tick().
    this.knobTargetX = this.ox + cx;
    this.knobTargetY = this.oy + cy;
  }

  private onUp(p: Phaser.Input.Pointer): void {
    const info = this.downInfo.get(p.id);
    this.downInfo.delete(p.id);

    // Флик → уклонение. Срабатывает и для «чистого» свайпа вторым пальцем.
    if (!this.blockedFn() && info) {
      const dt = p.time - info.t;
      const dist = Math.hypot(p.x - info.x, p.y - info.y);
      if (dist >= this.FLICK_DIST && dt <= this.FLICK_MAX_MS) {
        const d = dist || 1;
        this.onFlick((p.x - info.x) / d, (p.y - info.y) / d);
      }
    }

    if (!this.active || p.id !== this.pointerId) return;
    this.active = false;
    this.pointerId = -1;
    this.publish(0, 0);
    // Кноб плавно возвращается к центру и исчезает — нет «залипания» на месте.
    this.snapTween?.stop();
    this.base.setVisible(false);
    this.snapTween = this.base.scene.tweens.add({
      targets: this.knob,
      x: this.ox,
      y: this.oy,
      duration: 90,
      ease: 'Quad.Out',
      onComplete: () => this.knob.setVisible(false),
    });
  }

  /**
   * POINTER_CANCEL (входящий звонок, системный жест): флик не регистрируем
   * (направление неоднозначно), просто сбрасываем состояние — без «залипания».
   */
  private onCancel(pointerId: number): void {
    this.downInfo.delete(pointerId);
    if (!this.active || pointerId !== this.pointerId) return;
    this.active = false;
    this.pointerId = -1;
    this.publish(0, 0);
    this.snapTween?.stop();
    this.base.setVisible(false);
    this.knob.setVisible(false);
  }

  /** Deadzone 0→DEAD даёт 0, дальше плавный ramp до полного хода. */
  private scaleDead(x: number, y: number): { x: number; y: number } {
    const d = Math.hypot(x, y);
    if (d < this.DEAD) return { x: 0, y: 0 };
    const f = (d - this.DEAD) / (1 - this.DEAD);
    return { x: x * f, y: y * f };
  }

  private tick(_t: number, delta: number): void {
    if (!this.active) return;
    // ~14-16мс шаг → коэффициент для smooth-догонки кноба (чисто визуальный).
    const k = 1 - Math.exp(-delta / 22);
    this.knobX += (this.knobTargetX - this.knobX) * k;
    this.knobY += (this.knobTargetY - this.knobY) * k;
    this.knob.setPosition(this.knobX, this.knobY);
  }

  private publish(x: number, y: number): void {
    this.base.scene.registry.set('joy', { x, y });
  }
}
