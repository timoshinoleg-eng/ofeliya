import Phaser from 'phaser';
import { COLORS } from '../game/config';
import { combatParticleFrame } from '../game/StrainZeroTextures';
import { PERFORMANCE } from './PerformanceProfile';
import { VfxBudget } from './VfxBudget';

type KillImportance = 'normal' | 'elite' | 'boss';

type ContactDirection = { x: number; y: number };
type Decoration = {
  circle: Phaser.GameObjects.Arc;
  active: boolean;
  important: boolean;
  serial: number;
};

/** Central bounded combat-VFX layer. Reduced mode changes presentation only, never gameplay. */
export class VfxSystem {
  private readonly scene: Phaser.Scene;
  private readonly killEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly hitEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly pickupEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly rewardEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly budget: VfxBudget;
  private lastHitAt = -Infinity;
  private readonly decorations: Decoration[] = [];
  private decorationSerial = 0;
  private destroyed = false;
  private combatDensity = 0;
  private runtimeQualityScale = 1;
  private readonly biologicalGhosts: { image: Phaser.GameObjects.Image; active: boolean; serial: number }[] = [];
  private ghostSerial = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.budget = new VfxBudget(PERFORMANCE.combatParticleBudget, PERFORMANCE.burstParticleBudget);

    // Four retained emitters share one token budget. Baked frames work in Canvas and WebGL.
    this.killEmitter = scene.add
      .particles(0, 0, 'combat-particles', {
        frame: 'spark-white',
        speed: { min: 60, max: 190 },
        lifespan: { min: 170, max: 330 },
        scale: { start: 0.82, end: 0 },
        blendMode: 'ADD',
        emitting: false,
      })
      .setDepth(20);
    this.hitEmitter = scene.add
      .particles(0, 0, 'combat-particles', {
        frame: 'spark-white',
        speed: { min: 35, max: 95 },
        lifespan: { min: 90, max: 155 },
        scale: { start: 0.68, end: 0 },
        blendMode: 'ADD',
        emitting: false,
      })
      .setDepth(21);
    this.pickupEmitter = scene.add
      .particles(0, 0, 'combat-particles', {
        frame: 'spark-white',
        speed: { min: 40, max: 110 },
        lifespan: 220,
        scale: { start: 0.72, end: 0 },
        blendMode: 'ADD',
        emitting: false,
      })
      .setDepth(20);
    this.rewardEmitter = scene.add
      .particles(0, 0, 'combat-particles', {
        frame: 'spark-white',
        speed: { min: 100, max: 290 },
        lifespan: { min: 260, max: 540 },
        scale: { start: 0.92, end: 0 },
        blendMode: 'ADD',
        emitting: false,
      })
      .setDepth(23);
    this.scene.events.once('shutdown', this.destroy, this);
  }

  hit(
    x: number, y: number, color = COLORS.white,
    direction?: ContactDirection, victimRadius = 0
  ): void {
    if (this.destroyed) return;
    const now = this.scene.time.now;
    const denseInterval = this.combatDensity >= 180 ? 90 : this.combatDensity >= 140 ? 65 : 45;
    const minInterval = PERFORMANCE.tier === 'reduced' ? Math.max(80, denseInterval) : denseInterval;
    if (now - this.lastHitAt < minInterval) return;
    this.lastHitAt = now;
    const length = direction ? Math.hypot(direction.x, direction.y) : 0;
    const directed = Number.isFinite(length) && length > 0;
    const dx = directed ? direction!.x / length : 0;
    const dy = directed ? direction!.y / length : 0;
    const radius = Number.isFinite(victimRadius) ? Math.max(0, victimRadius) : 0;
    const contactX = x - dx * radius;
    const contactY = y - dy * radius;
    const angle = Math.atan2(dy, dx) * 180 / Math.PI + 180;
    this.hitEmitter.setEmitterAngle(
      directed ? { min: angle - 38, max: angle + 38 } : { min: 0, max: 360 }
    );
    this.frame(this.hitEmitter, color);
    this.emit(this.hitEmitter, contactX, contactY, this.combatDensity >= 160 ? 2 : 3);
    // Short local membrane response; no camera/shake channel is requested for ordinary hits.
    if (this.combatDensity < 180) this.ring(contactX, contactY, color, 16, 125, 0.2);
  }

  kill(
    x: number, y: number, color: number, importance: KillImportance = 'normal',
    direction?: ContactDirection, victimRadius = 0
  ): void {
    if (this.destroyed) return;
    const normalBase = this.combatDensity >= 180 ? 3 : this.combatDensity >= 140 ? 5 : 8;
    const base = importance === 'boss' ? 30 : importance === 'elite' ? 16 : normalBase;
    // Chips and sparks divide ONE death grant; both silhouettes stay inside VfxBudget.
    const granted = this.budget.request(
      this.count(base), this.scene.time.now, importance !== 'normal'
    );
    const chips = Math.floor(granted * 0.4);
    const length = direction ? Math.hypot(direction.x, direction.y) : 0;
    const angle = direction && Number.isFinite(length) && length > 0
      ? Math.atan2(direction.y, direction.x) * 180 / Math.PI
      : null;
    this.killEmitter.setEmitterAngle(
      angle === null ? { min: 0, max: 360 } : { min: angle - 75, max: angle + 75 }
    );
    if (chips > 0) {
      this.frame(this.killEmitter, color, 'chip');
      this.killEmitter.emitParticleAt(x, y, chips);
    }
    if (granted - chips > 0) {
      this.frame(this.killEmitter, color);
      this.killEmitter.emitParticleAt(x, y, granted - chips);
    }
    if (importance !== 'normal') {
      const radius = Number.isFinite(victimRadius) ? Math.max(0, victimRadius) : 0;
      this.ring(
        x, y, importance === 'boss' ? COLORS.red : COLORS.gold,
        Math.max(importance === 'boss' ? 84 : 48, Math.min(110, radius * 1.8)),
        360, 0.22, 0, true
      );
    }
  }

  pickup(x: number, y: number): void {
    if (this.destroyed) return;
    this.frame(this.pickupEmitter, COLORS.green);
    this.emit(this.pickupEmitter, x, y, this.combatDensity >= 170 ? 1 : this.combatDensity >= 130 ? 2 : 3);
    if (this.combatDensity < 180) this.ring(x, y, COLORS.green, 24, 200, 0.1);
  }

  setCombatDensity(density: number): void {
    this.combatDensity = Math.max(0, Math.floor(density));
  }

  /** Presentation-only runtime scaling. Boss/gameplay telegraphs are outside this system. */
  setRuntimeQualityScale(scale: number): void {
    if (!Number.isFinite(scale)) return;
    this.runtimeQualityScale = Phaser.Math.Clamp(scale, 0.45, 1);
    this.trimDecorations();
    this.trimBiologicalGhosts();
  }

  /** Snapshot after authoritative death; this Image has no body and cannot retain a pooled enemy. */
  biologicalDeath(source: {
    active: boolean; x: number; y: number; rotation: number; scaleX: number; scaleY: number;
    alpha: number; texture: { key: string }; frame: { name: string | number };
  }): void {
    if (this.destroyed || source.active || this.combatDensity >= 150) return;
    if (!['immune-antibody', 'bio-cycle-immune-antibody', 'bio-hit-immune-antibody'].includes(source.texture.key)) return;
    let entry = this.biologicalGhosts.find(ghost => !ghost.active);
    if (!entry && this.biologicalGhosts.length < this.biologicalGhostCap) {
      entry = { image: this.scene.add.image(0, 0, source.texture.key).setDepth(12).setVisible(false), active: false, serial: 0 };
      this.biologicalGhosts.push(entry);
    }
    if (!entry) return; // Drop decoration rather than replace an in-flight collapse.
    const ghost = entry;
    ghost.active = true;
    const serial = ghost.serial = ++this.ghostSerial;
    ghost.image.setTexture(source.texture.key, source.frame.name).clearTint()
      .setPosition(source.x, source.y).setRotation(source.rotation)
      .setScale(source.scaleX, source.scaleY).setAlpha(Math.min(0.65, source.alpha)).setVisible(true);
    this.scene.tweens.add({
      targets: ghost.image, scaleX: source.scaleX * 0.25, scaleY: source.scaleY * 0.25,
      alpha: 0, duration: this.biologicalGhostCap === 2 ? 120 : 180, ease: 'Quad.In',
      onComplete: () => {
        if (this.destroyed || ghost.serial !== serial) return;
        ghost.active = false;
        ghost.image.setVisible(false);
      },
    });
  }

  private get biologicalGhostCap(): number {
    return PERFORMANCE.tier === 'reduced' || this.runtimeQualityScale <= 0.65 ? 2 : 4;
  }

  private trimBiologicalGhosts(): void {
    while (this.biologicalGhosts.length > this.biologicalGhostCap) {
      const ghost = this.biologicalGhosts.pop()!;
      ghost.serial = ++this.ghostSerial;
      this.scene.tweens.killTweensOf(ghost.image);
      ghost.image.destroy();
    }
  }

  get debugRuntimeQualityScale(): number {
    return this.runtimeQualityScale;
  }

  nova(x: number, y: number, radius: number): void {
    if (this.destroyed) return;
    this.frame(this.rewardEmitter, COLORS.cyan);
    this.emit(this.rewardEmitter, x, y, 10);
    this.ring(x, y, COLORS.cyan, radius, 360, 0.3);
  }

  lysis(x: number, y: number, innerRadius: number, gameplayRadius: number): void {
    if (this.destroyed) return;
    this.nova(x, y, innerRadius);
    this.ring(x, y, COLORS.green, gameplayRadius, 320, 0.16);
  }

  singularity(x: number, y: number, radius: number): void {
    if (this.destroyed) return;
    this.frame(this.rewardEmitter, COLORS.purple);
    this.emit(this.rewardEmitter, x, y, 18, true);
    const collapse = this.acquireDecoration(true);
    if (collapse) {
      this.resetCircle(collapse, x, y, radius * 0.62, COLORS.purple, 0, 3, 0.9);
      this.animate(collapse, { scale: 0.12, alpha: 0.1, duration: 170, ease: 'Quad.In' });
    }
    const core = this.acquireDecoration(true);
    if (core) {
      this.resetCircle(core, x, y, 7, COLORS.white, 0.8, 0, 0);
      this.animate(core, { scale: 2.2, alpha: 0, duration: 320, ease: 'Quad.Out' });
    }
    this.ring(x, y, COLORS.purple, radius, 430, 0.36, 135, true);
  }

  levelUp(x: number, y: number): void {
    if (this.destroyed) return;
    this.frame(this.rewardEmitter, COLORS.magenta);
    this.emit(this.rewardEmitter, x, y, 22, true);
    this.ring(x, y, COLORS.magenta, 96, 420, 0.24, 0, true);
  }

  evolution(x: number, y: number, color = COLORS.gold): void {
    if (this.destroyed) return;
    this.frame(this.rewardEmitter, color);
    this.emit(this.rewardEmitter, x, y, 36, true);
    this.ring(x, y, color, 150, 520, 0.34, 0, true);
    // A delayed inner ring gives critical mutations a two-beat membrane pulse.
    // Both circles remain in the bounded pool and release their tween on completion.
    this.ring(x, y, COLORS.green, 94, 460, 0.2, 90, true);
  }

  milestone(x: number, y: number, color = COLORS.purple): void {
    if (this.destroyed) return;
    this.frame(this.rewardEmitter, color);
    this.emit(this.rewardEmitter, x, y, 14, true);
    this.ring(x, y, color, 120, 430, 0.2, 0, true);
  }

  legendary(x: number, y: number, color = COLORS.gold): void {
    if (this.destroyed) return;
    this.frame(this.rewardEmitter, color);
    this.emit(this.rewardEmitter, x, y, 48, true);
    this.ring(x, y, color, 170, 520, 0.38, 0, true);
    this.ring(x, y, COLORS.white, 104, 420, 0.2, 70, true);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off('shutdown', this.destroy, this);
    for (const entry of this.decorations) {
      this.scene.tweens.killTweensOf(entry.circle);
      entry.circle.destroy();
    }
    this.decorations.length = 0;
    for (const ghost of this.biologicalGhosts) {
      this.scene.tweens.killTweensOf(ghost.image);
      ghost.image.destroy();
    }
    this.biologicalGhosts.length = 0;
    this.killEmitter.destroy();
    this.hitEmitter.destroy();
    this.pickupEmitter.destroy();
    this.rewardEmitter.destroy();
  }

  private count(base: number): number {
    return Math.max(1, Math.round(base * PERFORMANCE.vfxScale * this.runtimeQualityScale));
  }

  private emit(
    emitter: Phaser.GameObjects.Particles.ParticleEmitter,
    x: number,
    y: number,
    base: number,
    burst = false
  ): void {
    const granted = this.budget.request(this.count(base), this.scene.time.now, burst);
    if (granted > 0) emitter.emitParticleAt(x, y, granted);
  }

  private get decorationCap(): number {
    return PERFORMANCE.tier === 'reduced' || this.runtimeQualityScale <= 0.65 ? 6 : 12;
  }

  private trimDecorations(): void {
    while (this.decorations.length > this.decorationCap) {
      // Shed ordinary decoration first, preserving important feedback where possible.
      const index = this.decorations.findIndex(entry => !entry.important);
      const [entry] = this.decorations.splice(index < 0 ? 0 : index, 1);
      this.scene.tweens.killTweensOf(entry.circle);
      entry.circle.destroy();
    }
  }

  private acquireDecoration(important: boolean): Decoration | null {
    if (this.destroyed) return null;
    const reserve = this.decorationCap === 6 ? 2 : 3;
    if (!important && this.decorations.filter(entry => entry.active).length >= this.decorationCap - reserve) {
      return null;
    }
    let entry = this.decorations.find(entry => !entry.active);
    if (!entry && this.decorations.length < this.decorationCap) {
      entry = {
        circle: this.scene.add.circle(0, 0, 12).setDepth(19).setBlendMode(Phaser.BlendModes.ADD),
        active: false, important: false, serial: 0,
      };
      this.decorations.push(entry);
    }
    if (!entry && important) {
      entry = [...this.decorations].sort(
        (a, b) => Number(a.important) - Number(b.important) || a.serial - b.serial
      )[0];
    }
    if (!entry) return null;
    this.scene.tweens.killTweensOf(entry.circle);
    entry.active = true;
    entry.important = important;
    entry.serial = ++this.decorationSerial;
    return entry;
  }

  private resetCircle(
    entry: Decoration, x: number, y: number, radius: number, color: number,
    fillAlpha: number, strokeWidth: number, strokeAlpha: number
  ): void {
    entry.circle.setPosition(x, y).setRadius(radius).setScale(1).setAlpha(1)
      .setFillStyle(color, fillAlpha).setStrokeStyle(strokeWidth, color, strokeAlpha).setVisible(true);
  }

  private animate(
    entry: Decoration, config: Omit<Phaser.Types.Tweens.TweenBuilderConfig, 'targets'>
  ): void {
    const serial = entry.serial;
    this.scene.tweens.add({
      ...config, targets: entry.circle,
      onComplete: () => {
        if (entry.serial !== serial || this.destroyed) return;
        entry.active = false;
        entry.circle.setVisible(false);
      },
    });
  }

  private ring(
    x: number, y: number, color: number, radius: number, duration: number,
    alpha = 0.22, delay = 0, important = false
  ): void {
    const entry = this.acquireDecoration(important);
    if (!entry) return;
    const startRadius = 12;
    this.resetCircle(entry, x, y, startRadius, color, alpha * 0.3, 2, Math.min(1, alpha * 2.6));
    if (delay > 0) entry.circle.setAlpha(0);
    this.animate(entry, {
      scale: radius / startRadius, alpha: { from: alpha, to: 0 }, duration, delay,
      ease: 'Quad.Out', onStart: () => entry.circle.setAlpha(alpha),
    });
  }

  private frame(
    emitter: Phaser.GameObjects.Particles.ParticleEmitter, color: number, kind: 'spark' | 'chip' = 'spark'
  ): void {
    emitter.setEmitterFrame(combatParticleFrame(color, kind));
  }
}
