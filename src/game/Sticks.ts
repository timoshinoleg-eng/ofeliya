import Phaser from 'phaser';
import { COLORS } from './config';
import { SafeArea } from '../systems/SafeArea';
import type { ControlMode } from '../systems/SaveSystem';

/** Аим-вектор для GameScene: active=false → авто-прицел по ближайшему (ассист). */
export interface AimState {
  x: number;
  y: number;
  active: boolean;
}

/**
 * Виртуальные стики (M-блок, MAX/Android).
 *
 * Режим «1 палец» (по умолчанию, casual):
 * - плавающий стик движения — появляется под пальцем (ниже HUD-зоны);
 * - флик (быстрый свайп ≥ FLICK_DIST за ≤ FLICK_MAX_MS) → dodge;
 * - стрельба — авто-прицел по ближайшему врагу.
 *
 * Режим «2 пальца» (twin-stick, для скоростных/рекордных игроков):
 * - левая половина экрана — плавающий стик движения (флик → dodge);
 * - правая половина — плавающий стик прицела (золотой): направление =
 *   направление огня; удержание за dead-zone → непрерывный огонь по линии;
 * - стик прицела в dead-zone или отпущен → возврат к авто-прицелу
 *   (aim-assist, как в мобильных twin-stick: Fortnite mobile и др.).
 *
 * Принципы (по гайду gamedeveloper.com «Doing Thumbstick Dead Zones Right»):
 * - RADIAL dead zone + scaled ramp: нет «касания» границы и рывка на выходе;
 * - динамические (floating) базы — современный стандарт мобильных
 *   twin-stick: стик появляется под пальцем, рука не мигрирует к углу;
 * - зоны назначаются при pointerdown и не «перескакивают», даже если палец
 *   пересёк середину экрана (sticky zones);
 * - ВЕКТОР мгновенный (нулевая задержка ввода), сглаживается только ВИЗУАЛ
 *   кноба; snap-back при отпускании.
 *
 * Публикует в registry: 'joy' — движение {x, y}, 'aim' — AimState.
 */
export class Sticks {
  private scene: Phaser.Scene;
  private mode: ControlMode;

  // — Стик движения (циан)
  private mvBase: Phaser.GameObjects.Arc;
  private mvKnob: Phaser.GameObjects.Arc;
  private mvActive = false;
  private mvPointerId = -1;
  private mvOx = 0;
  private mvOy = 0;
  private mvKnobX = 0;
  private mvKnobY = 0;
  private mvKnobTargetX = 0;
  private mvKnobTargetY = 0;
  private mvSnapTween: Phaser.Tweens.Tween | null = null;

  // — Стик прицела (золото, только dual-режим)
  private aiBase: Phaser.GameObjects.Arc;
  private aiKnob: Phaser.GameObjects.Arc;
  private aiActive = false;
  private aiPointerId = -1;
  private aiOx = 0;
  private aiOy = 0;
  private aiKnobX = 0;
  private aiKnobY = 0;
  private aiKnobTargetX = 0;
  private aiKnobTargetY = 0;
  private aiSnapTween: Phaser.Tweens.Tween | null = null;

  /** След за ВСЕМИ поинтерами (не только стиками) — для фликов второй рукой. */
  private downInfo = new Map<number, { x: number; y: number; t: number; side: 'L' | 'R' }>();
  private domCancel: (e: PointerEvent) => void;
  private updateBound: (t: number, delta: number) => void;

  private readonly MV_R = 62;
  private readonly MV_KNOB = 26;
  private readonly MV_DEAD = 0.14;
  /** Флик → dodge (те же пороги, что в однопальцевом режиме). */
  private readonly FLICK_DIST = 48;
  private readonly FLICK_MAX_MS = 200;

  private readonly AI_R = 70;
  private readonly AI_KNOB = 24;
  /**
   * Dead-zone прицела шире, чем у движения: мелкий джитт пальцем не должен
   * «крутить» линию огня. Для direction-only twin-stick достаточно radial
   * dead zone; ramp сохраняет плавность направления.
   */
  private readonly AI_DEAD = 0.35;

  private blockedFn: () => boolean;
  private onFlick: (dirX: number, dirY: number) => void;

  constructor(
    scene: Phaser.Scene,
    mode: ControlMode,
    blockedFn: () => boolean,
    onFlick: (dirX: number, dirY: number) => void
  ) {
    this.scene = scene;
    this.mode = mode;
    this.blockedFn = blockedFn;
    this.onFlick = onFlick;

    this.mvBase = scene.add
      .circle(0, 0, this.MV_R, COLORS.cyan, 0.07)
      .setStrokeStyle(2, COLORS.cyan, 0.35)
      .setScrollFactor(0)
      .setDepth(60)
      .setVisible(false);
    this.mvKnob = scene.add
      .circle(0, 0, this.MV_KNOB, COLORS.cyan, 0.3)
      .setStrokeStyle(1.5, COLORS.cyan, 0.5)
      .setScrollFactor(0)
      .setDepth(61)
      .setVisible(false);

    this.aiBase = scene.add
      .circle(0, 0, this.AI_R, COLORS.gold, 0.07)
      .setStrokeStyle(2, COLORS.gold, 0.35)
      .setScrollFactor(0)
      .setDepth(60)
      .setVisible(false);
    this.aiKnob = scene.add
      .circle(0, 0, this.AI_KNOB, COLORS.gold, 0.3)
      .setStrokeStyle(1.5, COLORS.gold, 0.5)
      .setScrollFactor(0)
      .setDepth(61)
      .setVisible(false);

    const input = scene.input;
    input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    input.on(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
    // Phaser 3.90 не имеет события POINTER_CANCEL — ловим DOM pointercancel сами
    // (иначе после отмены тача стик «залипает» на мёртвом pointerId).
    this.domCancel = (e: PointerEvent) => this.onCancel(e.pointerId);
    scene.game.canvas.addEventListener('pointercancel', this.domCancel);
    this.updateBound = this.tick.bind(this);
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.updateBound);

    scene.registry.set('joy', { x: 0, y: 0 });
    scene.registry.set('aim', { x: 0, y: 0, active: false } satisfies AimState);

    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      input.off(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
      input.off(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
      input.off(Phaser.Input.Events.POINTER_UP, this.onUp, this);
      input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
      scene.game.canvas.removeEventListener('pointercancel', this.domCancel);
      scene.events.off(Phaser.Scenes.Events.UPDATE, this.updateBound);
      this.mvSnapTween?.stop();
      this.aiSnapTween?.stop();
      scene.registry.remove('joy');
      scene.registry.remove('aim');
    });
  }

  /**
   * Верхняя HUD-полоса: стики под ней не появляются. 100px покрывает XP-бар,
   * таймер, HP и кнопки (mute/pause до y = 90+safeTop), чтобы release пальца
   * не «попал» по кнопке звука во время свайпа.
   */
  private topZone(): number {
    return SafeArea.top + 100;
  }

  /** Зона прицела: правая половина экрана (sticky — фиксируем при down). */
  private isRightHalf(x: number): boolean {
    return x >= this.scene.scale.width / 2;
  }

  private onDown(p: Phaser.Input.Pointer): void {
    const side: 'L' | 'R' = this.isRightHalf(p.x) ? 'R' : 'L';
    this.downInfo.set(p.id, { x: p.x, y: p.y, t: p.time, side });
    if (this.blockedFn() || p.y <= this.topZone()) return;

    if (this.mode === 'dual') {
      if (side === 'R') {
        // Правая половина → стик прицела (пока не занят другим пальцем).
        if (this.aiActive) return;
        this.aiActive = true;
        this.aiPointerId = p.id;
        this.aiOx = p.x;
        this.aiOy = p.y;
        this.aiKnobTargetX = p.x;
        this.aiKnobTargetY = p.y;
        this.aiKnobX = p.x;
        this.aiKnobY = p.y;
        this.aiBase.setPosition(p.x, p.y).setVisible(true);
        this.aiKnob.setPosition(p.x, p.y).setVisible(true);
        this.publishAim(0, 0, false);
        return;
      }
      if (this.mvActive) return;
    } else if (this.mvActive) {
      // one-режим: один стик на экран; флик вторым пальцем учитывается в onUp.
      return;
    }

    this.mvActive = true;
    this.mvPointerId = p.id;
    this.mvOx = p.x;
    this.mvOy = p.y;
    this.mvKnobTargetX = p.x;
    this.mvKnobTargetY = p.y;
    this.mvKnobX = p.x;
    this.mvKnobY = p.y;
    this.mvBase.setPosition(p.x, p.y).setVisible(true);
    this.mvKnob.setPosition(p.x, p.y).setVisible(true);
    this.publishJoy(0, 0);
  }

  private onMove(p: Phaser.Input.Pointer): void {
    if (this.mvActive && p.id === this.mvPointerId) {
      const dx = p.x - this.mvOx;
      const dy = p.y - this.mvOy;
      const d = Math.hypot(dx, dy);
      const cx = d > this.MV_R ? (dx / d) * this.MV_R : dx;
      const cy = d > this.MV_R ? (dy / d) * this.MV_R : dy;
      // Вектор — мгновенно, без латентности.
      const v = this.scaleMove(cx / this.MV_R, cy / this.MV_R);
      this.publishJoy(v.x, v.y);
      // Кноб — цель, сглаживается в tick().
      this.mvKnobTargetX = this.mvOx + cx;
      this.mvKnobTargetY = this.mvOy + cy;
    }
    if (this.aiActive && p.id === this.aiPointerId) {
      const dx = p.x - this.aiOx;
      const dy = p.y - this.aiOy;
      const d = Math.hypot(dx, dy);
      const cx = d > this.AI_R ? (dx / d) * this.AI_R : dx;
      const cy = d > this.AI_R ? (dy / d) * this.AI_R : dy;
      const v = this.scaleAim(cx / this.AI_R, cy / this.AI_R);
      const m = Math.hypot(v.x, v.y);
      // Ниже dead-zone — ассист (авто-прицел); выше — Manual aim по линии.
      this.publishAim(v.x, v.y, m > 0.02);
      this.aiKnobTargetX = this.aiOx + cx;
      this.aiKnobTargetY = this.aiOy + cy;
    }
  }

  private onUp(p: Phaser.Input.Pointer): void {
    const info = this.downInfo.get(p.id);
    this.downInfo.delete(p.id);

    // Флик → уклонение. one-режим: любой палец (в т.ч. второй, пока стик
    // занят). dual-режим: ТОЛЬКО левая половина — правая рука прицеливается,
    // флик от неё = случайный рывок посреди прицеливания.
    if (info && this.blockedFn() === false) {
      const flickSideOk = this.mode === 'dual' ? info.side === 'L' : true;
      if (flickSideOk) {
        const dt = p.time - info.t;
        const dist = Math.hypot(p.x - info.x, p.y - info.y);
        if (dist >= this.FLICK_DIST && dt <= this.FLICK_MAX_MS) {
          const d = dist || 1;
          this.onFlick((p.x - info.x) / d, (p.y - info.y) / d);
        }
      }
    }

    if (this.mvActive && p.id === this.mvPointerId) {
      this.mvActive = false;
      this.mvPointerId = -1;
      this.publishJoy(0, 0);
      this.snapBack('mv');
    }
    if (this.aiActive && p.id === this.aiPointerId) {
      this.aiActive = false;
      this.aiPointerId = -1;
      this.publishAim(0, 0, false);
      this.snapBack('ai');
    }
  }

  /**
   * POINTER_CANCEL (входящий звонок, системный жест): флик не регистрируем
   * (направление неоднозначно), просто сбрасываем состояние — без «залипания».
   */
  private onCancel(pointerId: number): void {
    this.downInfo.delete(pointerId);
    if (this.mvActive && pointerId === this.mvPointerId) {
      this.mvActive = false;
      this.mvPointerId = -1;
      this.publishJoy(0, 0);
      this.mvSnapTween?.stop();
      this.mvBase.setVisible(false);
      this.mvKnob.setVisible(false);
    }
    if (this.aiActive && pointerId === this.aiPointerId) {
      this.aiActive = false;
      this.aiPointerId = -1;
      this.publishAim(0, 0, false);
      this.aiSnapTween?.stop();
      this.aiBase.setVisible(false);
      this.aiKnob.setVisible(false);
    }
  }

  /** Deadzone 0→DEAD даёт 0, дальше плавный ramp до полного хода. */
  private ramp(x: number, y: number, dead: number): { x: number; y: number } {
    const d = Math.hypot(x, y);
    if (d < dead) return { x: 0, y: 0 };
    const f = (d - dead) / (1 - dead);
    return { x: x * f, y: y * f };
  }

  private scaleMove(x: number, y: number): { x: number; y: number } {
    return this.ramp(x, y, this.MV_DEAD);
  }

  private scaleAim(x: number, y: number): { x: number; y: number } {
    return this.ramp(x, y, this.AI_DEAD);
  }

  private tick(_t: number, delta: number): void {
    if (this.mvActive) {
      // ~14-16мс шаг → коэффициент для smooth-догонки кноба (чисто визуальный).
      const k = 1 - Math.exp(-delta / 22);
      this.mvKnobX += (this.mvKnobTargetX - this.mvKnobX) * k;
      this.mvKnobY += (this.mvKnobTargetY - this.mvKnobY) * k;
      this.mvKnob.setPosition(this.mvKnobX, this.mvKnobY);
    }
    if (this.aiActive) {
      const k = 1 - Math.exp(-delta / 22);
      this.aiKnobX += (this.aiKnobTargetX - this.aiKnobX) * k;
      this.aiKnobY += (this.aiKnobTargetY - this.aiKnobY) * k;
      this.aiKnob.setPosition(this.aiKnobX, this.aiKnobY);
    }
  }

  private snapBack(which: 'mv' | 'ai'): void {
    if (which === 'mv') {
      this.mvSnapTween?.stop();
      this.mvBase.setVisible(false);
      this.mvSnapTween = this.mvBase.scene.tweens.add({
        targets: this.mvKnob,
        x: this.mvOx,
        y: this.mvOy,
        duration: 90,
        ease: 'Quad.Out',
        onComplete: () => this.mvKnob.setVisible(false),
      });
    } else {
      this.aiSnapTween?.stop();
      this.aiBase.setVisible(false);
      this.aiSnapTween = this.aiBase.scene.tweens.add({
        targets: this.aiKnob,
        x: this.aiOx,
        y: this.aiOy,
        duration: 90,
        ease: 'Quad.Out',
        onComplete: () => this.aiKnob.setVisible(false),
      });
    }
  }

  private publishJoy(x: number, y: number): void {
    this.mvBase.scene.registry.set('joy', { x, y });
  }

  private publishAim(x: number, y: number, active: boolean): void {
    this.aiBase.scene.registry.set('aim', { x, y, active } satisfies AimState);
  }
}
