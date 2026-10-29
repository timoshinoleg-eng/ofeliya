import Phaser from 'phaser';
import { Easing, Group, Tween } from '@tweenjs/tween.js';

/**
 * Juice — единый движок game feel поверх tween.js (MIT, `@tweenjs/tween.js`).
 *
 * Зачем: до Фазы 1 тряска/всплывашки/появления наград были разрозненными вызовами
 * Phaser-твинов и camera FX, вне досягаемости RuntimeQualityGovernor (ревью:
 * "tween-heavy juice вне зоны governor"). Juice — одна точка, где вся
 * косметическая интенсивность масштабируется профилем качества
 * (particleScale: 0.55 / 0.78 / 1), а кривые — единые кривые Пеннера из Easing.
 *
 * Что Juice НЕ делает (осознанно):
 * - не решает, сколько presentation положено событию — это ImpactDirector;
 * - не трогает симуляцию, RNG, телопорты урона;
 * - screenShake делегирует смещение нативному camera.shake: он корректен поверх
 *   follow-lerp камеры (0.14), а ручные смещения scroll через твин дрались бы
 *   с follow и давали дрейф. Вклад Juice здесь — скейлинг по governor.
 *
 * Владелец вызывает update() из своего update() каждый кадр — ДО любых
 * early-return (включая хит-стоп фриз), чтобы дип timeScale прогрессировал.
 *
 * ЧАСЫ (отличие от стека, осознанное): update() НЕ принимает время сцены
 * Phaser. tween.js стартует твины на performance.now(), а время сцены —
 * симулированные часы (смещение от загрузки + замедление от timeScale-дипов).
 * Прокачка группы временем сцены откладывала бы твины на boot-offset и
 * заставляла бы hitStop-дип замедлять собственное восстановление. Поэтому
 * группа качается на собственных часах tween.js (group.update() без
 * аргумента → now()); опциональный параметр — только для Node-тестов,
 * где время инжектится явно.
 */
export interface JuiceHooks {
  /**
   * 0..1 — множитель косметической интенсивности. В GameScene wired к
   * RuntimeQualityGovernor.profile.particleScale; в UI-сценах — константа 1.
   */
  intensityScale: () => number;
}

export interface RewardRevealOptions {
  /** Стартовый масштаб (эмблема legendary уже выставлена в 0.52 до вызова). */
  from?: number;
  /** Длительность появления, мс. */
  durationMs?: number;
}

const HIT_STOP_FLOOR = 0.06;
const HIT_STOP_RECOVERY_MS = 150;
const DAMAGE_POPUP_RISE_PX = 36;
const DAMAGE_POPUP_MS = 700;

export class Juice {
  private readonly group = new Group();
  private readonly hooks: JuiceHooks;
  private hitStopTween: Tween<{ v: number }> | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    hooks?: Partial<JuiceHooks>
  ) {
    this.hooks = { intensityScale: () => 1, ...hooks };
  }

  /**
   * Двигать группу твинов. Вызывать из update() сцены каждый кадр.
   * Без аргумента — на часах tween.js (performance.now, см. шапку);
   * явное время — только для тестов.
   */
  update(timeMs?: number): void {
    this.group.update(timeMs);
  }

  /** Остановить все juice-твины и вернуть timeScale в 1 (на shutdown сцены). */
  reset(): void {
    this.group.removeAll();
    this.hitStopTween = null;
    this.scene.time.timeScale = 1;
    const world = this.scene.physics?.world as { timeScale?: number } | undefined;
    if (world) world.timeScale = 1;
  }

  private intensity(): number {
    const s = this.hooks.intensityScale();
    return Number.isFinite(s) ? Math.max(0, Math.min(1, s)) : 1;
  }

  /**
   * Тряска камеры с затуханием. См. заметку в шапке файла про camera.shake.
   */
  screenShake(durationMs: number, intensity: number): void {
    const scaled = intensity * this.intensity();
    if (durationMs <= 0 || scaled <= 0) return;
    this.scene.cameras.main.shake(durationMs, scaled);
  }

  /**
   * Твин-импульс зума камеры (tween.js, синусное затухание) — безопасен при
   * активном follow, в отличие от ручных смещений scroll.
   */
  impactZoom(durationMs: number, amount: number): void {
    const cam = this.scene.cameras.main;
    const scaled = amount * this.intensity();
    if (durationMs <= 0 || scaled <= 0) return;
    const proxy = { z: 0 };
    new Tween(proxy, this.group)
      .to({ z: 1 }, durationMs)
      .easing(Easing.Quadratic.Out)
      .onUpdate(() => {
        cam.setZoom(1 + scaled * Math.sin(proxy.z * Math.PI));
      })
      .onComplete(() => {
        cam.setZoom(1);
      })
      .start();
  }

  /**
   * Hit-stop твином timeScale (ревью прямо рекомендовало time.timeScale).
   * ДОПОЛНЯЕТ, не заменяет жёсткий фриз GameScene.hitStop(): дип
   * 1 → HIT_STOP_FLOOR → 1 поверх существующего контракта ImpactDirector
   * (12/20/220 мс) — фриз держит длительность, твин даёт плавный slow-mo хвост.
   * Повторный вызов перезапускает дип (предыдущий останавливается).
   */
  hitStop(ms: number): void {
    if (ms <= 0) return;
    if (this.hitStopTween) {
      this.hitStopTween.stop();
      this.hitStopTween = null;
    }
    const time = this.scene.time;
    const world = this.scene.physics?.world as { timeScale: number } | undefined;
    const proxy = { v: 1 };
    const dipMs = Math.max(40, Math.round(ms * 0.55));
    const holdMs = Math.max(0, ms - dipMs);
    const apply = (): void => {
      time.timeScale = proxy.v;
      if (world) world.timeScale = proxy.v;
    };
    const recover = new Tween(proxy, this.group)
      .to({ v: 1 }, HIT_STOP_RECOVERY_MS)
      .easing(Easing.Quadratic.Out)
      .delay(holdMs)
      .onUpdate(apply)
      .onComplete(() => {
        time.timeScale = 1;
        if (world) world.timeScale = 1;
        this.hitStopTween = null;
      });
    this.hitStopTween = new Tween(proxy, this.group)
      .to({ v: HIT_STOP_FLOOR }, dipMs)
      .easing(Easing.Cubic.In)
      .onUpdate(apply)
      .chain(recover)
      .start();
  }

  /**
   * Squash & stretch спрайта: растяжение по X со сжатием по Y и упругим
   * возвратом. Кривые Пеннера (Back.Out) — единый язык "сочности".
   */
  squashAndStretch(
    target: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image,
    strength = 1
  ): void {
    const s = strength * this.intensity();
    if (s <= 0) return;
    const sx = 1 + 0.28 * s;
    const sy = 1 - 0.22 * s;
    new Tween(target, this.group)
      .to({ scaleX: sx, scaleY: sy }, 110)
      .easing(Easing.Quadratic.Out)
      .chain(
        new Tween(target, this.group)
          .to({ scaleX: 1, scaleY: 1 }, 240)
          .easing(Easing.Back.Out)
      )
      .start();
  }

  /**
   * Всплывающая цифра урона: подъём + затухание, авто-уничтожение.
   * Автономный хелпер; существующий ring buffer GameScene.showDamage не тронут.
   */
  damagePopup(
    x: number,
    y: number,
    text: string,
    color = '#ffd75e',
    fontSize = 15
  ): void {
    if (this.intensity() <= 0) return;
    const t = this.scene.add
      .text(x, y, text, {
        fontFamily: 'Chakra Petch, monospace',
        fontSize: `${fontSize}px`,
        fontStyle: 'bold',
        color,
      })
      .setOrigin(0.5)
      .setDepth(900);
    const target = { y, alpha: 1 };
    new Tween(target, this.group)
      .to({ y: y - DAMAGE_POPUP_RISE_PX, alpha: 0 }, DAMAGE_POPUP_MS)
      .easing(Easing.Quadratic.Out)
      .onUpdate(() => {
        t.setY(target.y).setAlpha(target.alpha);
      })
      .onComplete(() => {
        t.destroy();
      })
      .start();
  }

  /**
   * Появление награды: масштабный "поп" с Back.Out + проявление.
   * Напрямую влияет на восприятие ценности выдачи (Фаза 5: скины, Season Pass).
   * Хелпер сам выставляет стартовое состояние (from / alpha 0).
   */
  rewardReveal(
    target: Phaser.GameObjects.Container | Phaser.GameObjects.Graphics | Phaser.GameObjects.Text,
    opts?: RewardRevealOptions
  ): void {
    const from = opts?.from ?? 0.7;
    const durationMs = opts?.durationMs ?? 430;
    target.setScale(from).setAlpha(0);
    new Tween(target, this.group)
      .to({ scaleX: 1, scaleY: 1, alpha: 1 }, durationMs)
      .easing(Easing.Back.Out)
      .start();
  }
}
