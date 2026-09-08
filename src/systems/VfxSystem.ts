import Phaser from 'phaser';
import { COLORS } from '../game/config';

type KillImportance = 'normal' | 'elite' | 'boss';

type TintableEmitter = Phaser.GameObjects.Particles.ParticleEmitter & {
  setParticleTint?: (color: number) => void;
};

/**
 * Единая точка для combat-VFX. Все emitters постоянные, каждый burst конечный;
 * transient rings гарантированно destroy-ятся после tween completion.
 */
export class VfxSystem {
  private readonly scene: Phaser.Scene;
  private readonly killEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly hitEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly pickupEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly rewardEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private lastHitAt = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;

    this.killEmitter = scene.add
      .particles(0, 0, 'spark', {
        speed: { min: 60, max: 190 },
        lifespan: { min: 200, max: 420 },
        scale: { start: 1, end: 0 },
        blendMode: 'ADD',
        emitting: false,
      })
      .setDepth(20);

    this.hitEmitter = scene.add
      .particles(0, 0, 'spark', {
        speed: { min: 35, max: 95 },
        lifespan: { min: 110, max: 190 },
        scale: { start: 0.55, end: 0 },
        blendMode: 'ADD',
        emitting: false,
      })
      .setDepth(21);

    this.pickupEmitter = scene.add
      .particles(0, 0, 'spark', {
        speed: { min: 40, max: 110 },
        lifespan: 260,
        scale: { start: 0.8, end: 0 },
        blendMode: 'ADD',
        emitting: false,
      })
      .setDepth(20);

    this.rewardEmitter = scene.add
      .particles(0, 0, 'spark', {
        speed: { min: 100, max: 290 },
        lifespan: { min: 260, max: 540 },
        scale: { start: 1.05, end: 0 },
        blendMode: 'ADD',
        emitting: false,
      })
      .setDepth(23);
  }

  hit(x: number, y: number, color = COLORS.white): void {
    const now = this.scene.time.now;
    if (now - this.lastHitAt < 45) return;
    this.lastHitAt = now;
    this.tint(this.hitEmitter, color);
    this.hitEmitter.emitParticleAt(x, y, 2);
  }

  kill(x: number, y: number, color: number, importance: KillImportance = 'normal'): void {
    this.tint(this.killEmitter, color);
    const count = importance === 'boss' ? 30 : importance === 'elite' ? 16 : 8;
    this.killEmitter.emitParticleAt(x, y, count);

    if (importance !== 'normal') {
      this.ring(
        x,
        y,
        importance === 'boss' ? COLORS.red : COLORS.gold,
        importance === 'boss' ? 84 : 48,
        360
      );
    }
  }

  pickup(x: number, y: number): void {
    this.tint(this.pickupEmitter, COLORS.green);
    this.pickupEmitter.emitParticleAt(x, y, 3);
  }

  nova(x: number, y: number, radius: number): void {
    this.tint(this.rewardEmitter, COLORS.cyan);
    this.rewardEmitter.emitParticleAt(x, y, 10);
    this.ring(x, y, COLORS.cyan, radius, 360, 0.3);
  }

  singularity(x: number, y: number, radius: number): void {
    this.tint(this.rewardEmitter, COLORS.purple);
    this.rewardEmitter.emitParticleAt(x, y, 18);

    // Отдельная фаза схлопывания перед привычной ударной волной.
    const collapse = this.scene.add
      .circle(x, y, radius * 0.62)
      .setStrokeStyle(3, COLORS.purple, 0.9)
      .setDepth(19)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({
      targets: collapse,
      scale: 0.12,
      alpha: 0.1,
      duration: 170,
      ease: 'Quad.In',
      onComplete: () => collapse.destroy(),
    });

    const core = this.scene.add
      .circle(x, y, 7, COLORS.white, 0.8)
      .setDepth(20)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({
      targets: core,
      scale: 2.2,
      alpha: 0,
      duration: 320,
      ease: 'Quad.Out',
      onComplete: () => core.destroy(),
    });

    this.ring(x, y, COLORS.purple, radius, 430, 0.36, 135);
  }

  levelUp(x: number, y: number): void {
    this.tint(this.rewardEmitter, COLORS.cyan);
    this.rewardEmitter.emitParticleAt(x, y, 22);
    this.ring(x, y, COLORS.cyan, 96, 420, 0.24);
  }

  evolution(x: number, y: number, color = COLORS.gold): void {
    this.tint(this.rewardEmitter, color);
    this.rewardEmitter.emitParticleAt(x, y, 36);
    this.ring(x, y, color, 150, 520, 0.34);
  }

  milestone(x: number, y: number, color = COLORS.purple): void {
    this.tint(this.rewardEmitter, color);
    this.rewardEmitter.emitParticleAt(x, y, 14);
    this.ring(x, y, color, 120, 430, 0.2);
  }

  destroy(): void {
    this.killEmitter.destroy();
    this.hitEmitter.destroy();
    this.pickupEmitter.destroy();
    this.rewardEmitter.destroy();
  }

  private ring(
    x: number,
    y: number,
    color: number,
    radius: number,
    duration: number,
    alpha = 0.22,
    delay = 0
  ): void {
    const startRadius = 12;
    const ring = this.scene.add
      .circle(x, y, startRadius, color, alpha)
      .setStrokeStyle(2, color, Math.min(1, alpha * 2.6))
      .setDepth(19)
      .setBlendMode(Phaser.BlendModes.ADD);
    if (delay > 0) ring.setAlpha(0);
    this.scene.tweens.add({
      targets: ring,
      scale: radius / startRadius,
      alpha: { from: alpha, to: 0 },
      duration,
      delay,
      ease: 'Quad.Out',
      onStart: () => ring.setAlpha(alpha),
      onComplete: () => ring.destroy(),
    });
  }

  private tint(emitter: Phaser.GameObjects.Particles.ParticleEmitter, color: number): void {
    (emitter as TintableEmitter).setParticleTint?.(color);
  }
}
