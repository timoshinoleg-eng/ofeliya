import Phaser from 'phaser';
import { artScale } from '../game/ArtMetrics';
import { COLORS } from '../game/config';
import { ensureStrainZeroTextures } from '../game/StrainZeroTextures';
import type { StageDefinition } from '../game/StageDefinitions';
import { PERFORMANCE } from './PerformanceProfile';
import { decayAtmospherePulse, heartBeatEnvelope, visibleAtmosphereBands } from './atmosphereMath';

const RBC_BANDS = [
  { depth: -26, scale: [0.55, 0.85], alpha: [0.16, 0.24], parallax: [0.025, 0.045] },
  { depth: -14, scale: [0.95, 1.4], alpha: [0.23, 0.34], parallax: [0.07, 0.10] },
  { depth: -8, scale: [1.6, 2.1], alpha: [0.08, 0.14], parallax: [0.14, 0.18] },
] as const;

interface AmbientCell {
  image: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  rotationSpeed: number;
  alpha: number;
  parallax: number;
  band?: number;
}

interface PlasmaParticle {
  image: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  alpha: number;
}

/**
 * Bounded microscopic bloodstream layer. All ambient objects are allocated once per scene:
 * no per-frame creation, no per-cell postFX and no unbounded particle emitters.
 */
export class AtmosphereSystem {
  private readonly scene: Phaser.Scene;
  private readonly plasma: Phaser.GameObjects.TileSprite;
  private readonly structure: Phaser.GameObjects.TileSprite;
  private readonly pulseOverlay: Phaser.GameObjects.Rectangle;
  private readonly erythrocytes: AmbientCell[] = [];
  private readonly hostCells: AmbientCell[] = [];
  private readonly particles: PlasmaParticle[] = [];

  private width: number;
  private height: number;
  private lastCamX = 0;
  private lastCamY = 0;
  private phaseBoost = 0;
  private stage: StageDefinition | null = null;
  private runtimeQualityScale = 1;
  private pulseAlpha = 0;
  private secondBeatMs: number | null = null;
  private secondBeatColor = COLORS.immune;
  private secondBeatStrength = 0;
  private destroyed = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    ensureStrainZeroTextures(scene);
    this.width = scene.scale.width;
    this.height = scene.scale.height;

    this.plasma = scene.add
      .tileSprite(0, 0, this.width, this.height, 'blood-plasma')
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(-32)
      .setAlpha(1);

    this.structure = scene.add
      .tileSprite(0, 0, this.width, this.height, 'cardiac-fiber')
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(-20)
      .setAlpha(0)
      .setVisible(false);

    this.pulseOverlay = scene.add
      .rectangle(0, 0, this.width, this.height, COLORS.immune, 1)
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(-6)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0)
      .setVisible(false);

    // All three bands sit below gameplay, including the larger low-opacity near cells.
    const bandCounts = PERFORMANCE.ambientErythrocytes === 8 ? [4, 3, 1] : [8, 4, 2];
    for (let i = 0; i < PERFORMANCE.ambientErythrocytes; i++) {
      const x = Phaser.Math.FloatBetween(-40, this.width + 40);
      const y = Phaser.Math.FloatBetween(-40, this.height + 40);
      const band = i < bandCounts[0] ? 0 : i < bandCounts[0] + bandCounts[1] ? 1 : 2;
      const profile = RBC_BANDS[band];
      const alpha = Phaser.Math.FloatBetween(profile.alpha[0], profile.alpha[1]);
      const scale = Phaser.Math.FloatBetween(profile.scale[0], profile.scale[1]);
      const image = scene.add
        .image(x, y, 'erythrocyte')
        .setScrollFactor(0)
        .setDepth(profile.depth)
        .setScale(scale)
        .setAlpha(alpha)
        .setRotation(Phaser.Math.FloatBetween(-Math.PI, Math.PI));
      this.erythrocytes.push({
        image,
        x,
        y,
        vx: Phaser.Math.FloatBetween(10, 24),
        vy: Phaser.Math.FloatBetween(-3, 5),
        phase: Phaser.Math.FloatBetween(0, Math.PI * 2),
        rotationSpeed: Phaser.Math.FloatBetween(-0.08, 0.08),
        alpha,
        parallax: Phaser.Math.FloatBetween(profile.parallax[0], profile.parallax[1]),
        band,
      });
    }

    // Large soft host cells create depth now; interactive cells use a separate gameplay pool.
    for (let i = 0; i < PERFORMANCE.ambientHostCells; i++) {
      const x = Phaser.Math.FloatBetween(-80, this.width + 80);
      const y = Phaser.Math.FloatBetween(-80, this.height + 80);
      const alpha = Phaser.Math.FloatBetween(0.045, 0.105);
      const image = scene.add
        .image(x, y, 'host-cell-shadow')
        .setScrollFactor(0)
        .setDepth(-27)
        .setScale(artScale('host-cell-shadow', Phaser.Math.FloatBetween(1.2, 2.15)))
        .setAlpha(alpha)
        .setRotation(Phaser.Math.FloatBetween(-Math.PI, Math.PI));
      this.hostCells.push({
        image,
        x,
        y,
        vx: Phaser.Math.FloatBetween(3, 8),
        vy: Phaser.Math.FloatBetween(-2, 3),
        phase: i * 1.7,
        rotationSpeed: Phaser.Math.FloatBetween(-0.025, 0.025),
        alpha,
        parallax: Phaser.Math.FloatBetween(0.012, 0.03),
      });
    }

    // Fixed micro-particle pool. Reduced tier cuts decoration, never gameplay objects.
    for (let i = 0; i < PERFORMANCE.ambientParticles; i++) {
      const x = Phaser.Math.FloatBetween(0, this.width);
      const y = Phaser.Math.FloatBetween(0, this.height);
      const alpha = Phaser.Math.FloatBetween(0.025, 0.085);
      const image = scene.add
        .image(x, y, 'spark')
        .setScrollFactor(0)
        .setDepth(-18)
        .setTint(i % 6 === 0 ? COLORS.green : 0xffa2b6)
        .setScale(Phaser.Math.FloatBetween(0.12, 0.34))
        .setAlpha(alpha);
      this.particles.push({
        image,
        x,
        y,
        vx: Phaser.Math.FloatBetween(6, 18),
        vy: Phaser.Math.FloatBetween(-4, 4),
        phase: Phaser.Math.FloatBetween(0, Math.PI * 2),
        alpha,
      });
    }

    const cam = scene.cameras.main;
    this.lastCamX = cam.scrollX;
    this.lastCamY = cam.scrollY;
    this.scene.events.once('shutdown', this.destroy, this);
  }

  setStage(stage: StageDefinition): void {
    if (this.destroyed) return;
    this.secondBeatMs = null;
    this.pulseAlpha = 0;
    this.pulseOverlay.setAlpha(0).setVisible(false);
    this.stage = stage;
    this.plasma.setTexture(stage.theme.plasmaTexture).clearTint();
    const heart = stage.theme.ambientProfile === 'heart';
    this.structure.setVisible(heart).setAlpha(heart ? 0.34 : 0);
    if (heart && stage.theme.structureTexture) this.structure.setTexture(stage.theme.structureTexture);
    this.particles.forEach((particle, index) => {
      particle.image.setTint(index % 7 === 0 ? stage.theme.accentColor : stage.theme.particleTint);
    });
    this.applyRuntimeVisibility();
    this.phaseBoost = 0;
  }

  update(time: number, delta: number, stageTimeMs: number, stageDurationMs: number): void {
    if (this.destroyed) return;
    this.updatePulse(delta);
    const cam = this.scene.cameras.main;
    const camDx = cam.scrollX - this.lastCamX;
    const camDy = cam.scrollY - this.lastCamY;
    this.lastCamX = cam.scrollX;
    this.lastCamY = cam.scrollY;

    const progress = Phaser.Math.Clamp(stageTimeMs / stageDurationMs, 0, 1);
    const dt = Math.min(delta, 50) / 1000;
    const response = Phaser.Math.Clamp(progress + this.phaseBoost, 0, 1.3);
    const stage = this.stage;
    const heart = stage?.theme.ambientProfile === 'heart';
    const beatEvery = stage?.theme.heartbeatMs ?? 0;
    const beatPhase = heart && beatEvery > 0 ? (stageTimeMs % beatEvery) / beatEvery : 1;
    const beat = heart ? heartBeatEnvelope(beatPhase) : 0;

    const flow = (heart ? 0.72 : 1) + progress * (heart ? 0.42 : 0.65) + beat * 0.32;
    this.plasma.tilePositionX = cam.scrollX * 0.7 - time * (heart ? 0.004 : 0.007) * flow;
    this.plasma.tilePositionY = cam.scrollY * 0.7 + Math.sin(time * (heart ? 0.00034 : 0.00018)) * (heart ? 4 : 8);
    this.plasma.setTint(heart ? 0xffc9a8 : progress > 0.72 ? 0xffd6df : 0xffffff);
    this.structure.tilePositionX = cam.scrollX * 0.52 + time * 0.003;
    this.structure.tilePositionY = cam.scrollY * 0.52 - time * 0.0015;
    if (heart) this.structure.setAlpha(0.27 + beat * 0.2 + progress * 0.05);

    for (const cell of this.erythrocytes) {
      if (!cell.image.visible) continue;
      cell.x += cell.vx * flow * dt - camDx * cell.parallax;
      cell.y += (cell.vy + Math.sin(time * 0.00065 + cell.phase) * 2.4) * dt - camDy * cell.parallax;
      cell.x = this.wrap(cell.x, -90, this.width + 90);
      cell.y = this.wrap(cell.y, -70, this.height + 70);
      cell.image
        .setPosition(cell.x, cell.y)
        .setRotation(cell.image.rotation + cell.rotationSpeed * dt)
        .setAlpha(cell.alpha * (0.88 + response * 0.07));
    }

    for (const cell of this.hostCells) {
      if (!cell.image.visible) continue;
      cell.x += cell.vx * flow * dt - camDx * cell.parallax;
      cell.y += (cell.vy + Math.cos(time * 0.0004 + cell.phase) * 1.4) * dt - camDy * cell.parallax;
      cell.x = this.wrap(cell.x, -170, this.width + 170);
      cell.y = this.wrap(cell.y, -150, this.height + 150);
      cell.image
        .setPosition(cell.x, cell.y)
        .setRotation(cell.image.rotation + cell.rotationSpeed * dt)
        .setAlpha(cell.alpha * (0.86 + response * 0.1));
    }

    for (const p of this.particles) {
      if (!p.image.visible) continue;
      p.x += p.vx * flow * dt - camDx * 0.045;
      p.y += (p.vy + Math.sin(time * 0.001 + p.phase) * 1.8) * dt - camDy * 0.045;
      p.x = this.wrap(p.x, -10, this.width + 10);
      p.y = this.wrap(p.y, -10, this.height + 10);
      p.image
        .setPosition(p.x, p.y)
        .setAlpha(p.alpha * (0.82 + Math.sin(time * 0.0013 + p.phase) * 0.18 + response * 0.18));
    }

    this.phaseBoost *= Math.pow(0.2, Math.max(0, Number.isFinite(delta) ? delta : 0) / 1000);
  }

  /** Runtime governor may only reduce decorative objects; gameplay telegraphs are separate. */
  setRuntimeQualityScale(scale: number): void {
    if (this.destroyed || !Number.isFinite(scale)) return;
    this.runtimeQualityScale = Phaser.Math.Clamp(scale, 0.45, 1);
    this.applyRuntimeVisibility();
  }

  get debugRuntimeQualityScale(): number {
    return this.runtimeQualityScale;
  }

  pulse(color = COLORS.immune, strength = 0.22): void {
    if (this.destroyed || !Number.isFinite(strength)) return;
    const boundedStrength = Phaser.Math.Clamp(strength, 0, 1.3);
    this.phaseBoost = Math.max(this.phaseBoost, boundedStrength);
    this.pulseAlpha = Math.max(this.pulseAlpha, Math.min(0.075, 0.06 + boundedStrength * 0.1));
    this.pulseOverlay.setFillStyle(color, 1).setAlpha(this.pulseAlpha).setVisible(true);
  }

  heartbeatPulse(color: number, strength = 0.32): void {
    if (this.destroyed || !Number.isFinite(strength)) return;
    this.pulse(color, strength);
    // Latest heartbeat owns the one pending second visual pulse; no timer/tween allocation.
    this.secondBeatMs = 190;
    this.secondBeatColor = color;
    this.secondBeatStrength = Phaser.Math.Clamp(strength, 0, 1.3) * 0.68;
  }

  private updatePulse(delta: number): void {
    const elapsed = Number.isFinite(delta) ? Math.max(0, delta) : 0;
    if (this.secondBeatMs !== null && elapsed >= this.secondBeatMs) {
      const afterSecond = elapsed - this.secondBeatMs;
      this.pulseAlpha = decayAtmospherePulse(this.pulseAlpha, this.secondBeatMs);
      this.secondBeatMs = null;
      this.pulse(this.secondBeatColor, this.secondBeatStrength);
      this.pulseAlpha = decayAtmospherePulse(this.pulseAlpha, afterSecond);
    } else {
      if (this.secondBeatMs !== null) this.secondBeatMs -= elapsed;
      this.pulseAlpha = decayAtmospherePulse(this.pulseAlpha, elapsed);
    }
    this.pulseOverlay.setAlpha(this.pulseAlpha).setVisible(this.pulseAlpha > 0.0001);
  }

  resize(): void {
    if (this.destroyed) return;
    this.width = this.scene.scale.width;
    this.height = this.scene.scale.height;
    this.plasma.setSize(this.width, this.height);
    this.structure.setSize(this.width, this.height);
    this.pulseOverlay.setSize(this.width, this.height);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.secondBeatMs = null;
    this.scene.events.off('shutdown', this.destroy, this);
    this.pulseOverlay.destroy();
    this.plasma.destroy();
    this.structure.destroy();
    for (const c of this.erythrocytes) c.image.destroy();
    for (const c of this.hostCells) c.image.destroy();
    for (const p of this.particles) p.image.destroy();
    this.erythrocytes.length = 0;
    this.hostCells.length = 0;
    this.particles.length = 0;
  }

  private applyRuntimeVisibility(): void {
    const heart = this.stage?.theme.ambientProfile === 'heart';
    const visibleCount = (length: number) =>
      Math.max(1, Math.min(length, Math.ceil(length * this.runtimeQualityScale)));
    const available = RBC_BANDS.map((_, band) => this.erythrocytes.filter(cell => cell.band === band).length);
    const runtimeBudget = visibleCount(this.erythrocytes.length);
    const bandLimits = visibleAtmosphereBands(available, heart ? Math.ceil(runtimeBudget / 2) : runtimeBudget);
    const seen = [0, 0, 0];
    const hostCellLimit = visibleCount(this.hostCells.length);
    const particleLimit = visibleCount(this.particles.length);

    this.erythrocytes.forEach(cell => {
      const band = cell.band!;
      cell.image.setVisible(seen[band]++ < bandLimits[band]);
    });
    this.hostCells.forEach((cell, index) => {
      cell.image.setVisible(index < hostCellLimit && (!heart || index % 3 === 0));
    });
    this.particles.forEach((particle, index) => {
      particle.image.setVisible(index < particleLimit);
    });
  }

  private wrap(value: number, min: number, max: number): number {
    const span = max - min;
    if (span <= 0) return min;
    return ((((value - min) % span) + span) % span) + min;
  }
}
