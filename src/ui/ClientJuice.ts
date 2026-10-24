import type Phaser from 'phaser';
import { prefersReducedMotion } from '../systems/MotionPreferences';

export interface ClientJuiceOptions {
  enabled?: boolean;
  reduced?: boolean;
}

export interface ImpactZoomOptions extends ClientJuiceOptions {
  qualityScale?: number;
}

type DisplayTarget = Phaser.GameObjects.GameObject & { alpha: number; scaleX: number; scaleY: number };
type ActiveEffect = { tween: Phaser.Tweens.Tween | null; restore: () => void; shutdown: () => void };
type TweenValues = Record<string, number | { from: number; to: number }>;

const activeEffects = new WeakMap<object, ActiveEffect>();

function canPlay(options: ClientJuiceOptions): boolean {
  return options.enabled !== false && !(options.reduced ?? prefersReducedMotion());
}

function play(scene: Phaser.Scene, target: object, values: TweenValues, restore: () => void,
  duration: number, yoyo = false): boolean {
  if (activeEffects.has(target)) return false;
  const effect: ActiveEffect = { tween: null, restore, shutdown: () => undefined };
  const finish = () => {
    if (activeEffects.get(target) !== effect) return;
    effect.restore();
    activeEffects.delete(target);
    scene.events.off('shutdown', effect.shutdown);
  };
  effect.shutdown = () => { effect.tween?.stop(); finish(); };
  activeEffects.set(target, effect);
  scene.events.once('shutdown', effect.shutdown);
  try {
    effect.tween = scene.tweens.add({ targets: target, ...values, duration, ease: 'Sine.Out', yoyo, onComplete: finish });
    return true;
  } catch {
    finish();
    return false;
  }
}

/** Reveal a UI preview or panel container with a small scale-and-alpha tween. */
export function rewardReveal(scene: Phaser.Scene, target: DisplayTarget, options: ClientJuiceOptions = {}): boolean {
  if (!canPlay(options) || !target || activeEffects.has(target)) return false;
  const baseline = { alpha: target.alpha, scaleX: target.scaleX, scaleY: target.scaleY };
  if (!Object.values(baseline).every(Number.isFinite)) return false;
  target.alpha = 0;
  target.scaleX = baseline.scaleX * 0.92;
  target.scaleY = baseline.scaleY * 0.92;
  return play(scene, target, { alpha: baseline.alpha, scaleX: baseline.scaleX, scaleY: baseline.scaleY },
    () => Object.assign(target, baseline), 180);
}

/** Add a brief squash to a UI preview or container without touching game entities. */
export function squashAndStretch(scene: Phaser.Scene, target: DisplayTarget, options: ClientJuiceOptions = {}): boolean {
  if (!canPlay(options) || !target) return false;
  const baseline = { alpha: target.alpha, scaleX: target.scaleX, scaleY: target.scaleY };
  if (![baseline.alpha, baseline.scaleX, baseline.scaleY].every(Number.isFinite)) return false;
  return play(scene, target, {
    scaleX: { from: baseline.scaleX, to: baseline.scaleX * 1.06 },
    scaleY: { from: baseline.scaleY, to: baseline.scaleY * 0.94 },
  }, () => Object.assign(target, baseline), 42, true);
}

/** Apply a subtle camera preview pulse only when runtime quality explicitly permits it. */
export function impactZoom(scene: Phaser.Scene, options: ImpactZoomOptions = {}): boolean {
  const quality = options.qualityScale ?? 1;
  if (!canPlay(options) || !Number.isFinite(quality) || quality <= 0.5) return false;
  const camera = scene.cameras.main;
  const baseline = camera.zoom;
  if (!Number.isFinite(baseline) || baseline <= 0) return false;
  return play(scene, camera, { zoom: { from: baseline, to: baseline * 1.008 } },
    () => { camera.zoom = baseline; }, 80, true);
}
