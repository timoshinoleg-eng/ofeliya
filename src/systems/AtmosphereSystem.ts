import Phaser from 'phaser';
import { COLORS, RUN } from '../game/config';

interface GlyphLayer {
  image: Phaser.GameObjects.Image;
  baseX: number;
  baseY: number;
  parallax: number;
  drift: number;
  phase: number;
  alpha: number;
}

interface DustParticle {
  image: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  alpha: number;
}

/**
 * Лёгкий атмосферный слой арены: сетка, крупные системные глифы и фиксированный
 * пул digital dust. Никаких бесконечно создаваемых emitter-ов или тяжёлых shader-ов.
 */
export class AtmosphereSystem {
  private readonly scene: Phaser.Scene;
  private readonly grid: Phaser.GameObjects.TileSprite;
  private readonly glyphs: GlyphLayer[] = [];
  private readonly dust: DustParticle[] = [];

  private width: number;
  private height: number;
  private lastCamX = 0;
  private lastCamY = 0;
  private phaseBoost = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.width = scene.scale.width;
    this.height = scene.scale.height;

    this.grid = scene.add
      .tileSprite(0, 0, this.width, this.height, 'grid')
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(-30)
      .setAlpha(0.86);

    const glyphDefs = [
      { x: 0.12, y: 0.18, p: 0.035, drift: 0.7, scale: 1.7, tex: 'atmo-ring', alpha: 0.055 },
      { x: 0.82, y: 0.28, p: 0.055, drift: -0.5, scale: 2.2, tex: 'atmo-circuit', alpha: 0.045 },
      { x: 0.28, y: 0.72, p: 0.045, drift: -0.65, scale: 2.5, tex: 'atmo-circuit', alpha: 0.04 },
      { x: 0.76, y: 0.82, p: 0.03, drift: 0.45, scale: 1.9, tex: 'atmo-ring', alpha: 0.05 },
      { x: 0.5, y: 0.5, p: 0.018, drift: 0.32, scale: 3.2, tex: 'atmo-ring', alpha: 0.028 },
    ] as const;

    glyphDefs.forEach((def, i) => {
      const image = scene.add
        .image(this.width * def.x, this.height * def.y, def.tex)
        .setScrollFactor(0)
        .setDepth(-22)
        .setScale(def.scale)
        .setAlpha(def.alpha)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(i % 2 === 0 ? COLORS.cyan : COLORS.purple);
      this.glyphs.push({
        image,
        baseX: def.x,
        baseY: def.y,
        parallax: def.p,
        drift: def.drift,
        phase: i * 1.31,
        alpha: def.alpha,
      });
    });

    // Фиксированный пул: количество объектов никогда не растёт во время забега.
    for (let i = 0; i < 28; i++) {
      const x = Phaser.Math.FloatBetween(0, this.width);
      const y = Phaser.Math.FloatBetween(0, this.height);
      const alpha = Phaser.Math.FloatBetween(0.07, 0.2);
      const image = scene.add
        .image(x, y, 'spark')
        .setScrollFactor(0)
        .setDepth(-18)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(i % 5 === 0 ? COLORS.magenta : COLORS.cyan)
        .setScale(Phaser.Math.FloatBetween(0.18, 0.48))
        .setAlpha(alpha);
      this.dust.push({
        image,
        x,
        y,
        vx: Phaser.Math.FloatBetween(-4, 7),
        vy: Phaser.Math.FloatBetween(-8, -2),
        phase: Phaser.Math.FloatBetween(0, Math.PI * 2),
        alpha,
      });
    }

    const cam = scene.cameras.main;
    this.lastCamX = cam.scrollX;
    this.lastCamY = cam.scrollY;
  }

  update(time: number, delta: number, runTimeMs: number): void {
    const cam = this.scene.cameras.main;
    const camDx = cam.scrollX - this.lastCamX;
    const camDy = cam.scrollY - this.lastCamY;
    this.lastCamX = cam.scrollX;
    this.lastCamY = cam.scrollY;

    const progress = Phaser.Math.Clamp(runTimeMs / RUN.bossTimeMs, 0, 1);
    const intensity = Phaser.Math.Clamp(0.76 + progress * 0.24 + this.phaseBoost, 0.7, 1.25);

    // Сетка двигается медленнее мира: простая, дешёвая иллюзия глубины.
    this.grid.tilePositionX = cam.scrollX * 0.82 + time * 0.004;
    this.grid.tilePositionY = cam.scrollY * 0.82 - time * 0.002;
    this.grid.setAlpha(0.8 + progress * 0.1);
    this.grid.setTint(progress > 0.72 ? 0xe9dcff : 0xffffff);

    for (const g of this.glyphs) {
      const x = this.wrap(
        this.width * g.baseX - cam.scrollX * g.parallax + Math.sin(time * 0.00018 + g.phase) * 16,
        -140,
        this.width + 140
      );
      const y = this.wrap(
        this.height * g.baseY - cam.scrollY * g.parallax + Math.cos(time * 0.00015 + g.phase) * 12,
        -140,
        this.height + 140
      );
      g.image
        .setPosition(x, y)
        .setRotation(time * 0.000035 * g.drift + g.phase)
        .setAlpha(g.alpha * intensity);
    }

    const dt = Math.min(delta, 50) / 1000;
    for (const d of this.dust) {
      d.x += d.vx * dt - camDx * 0.055;
      d.y += d.vy * dt - camDy * 0.055;
      d.x = this.wrap(d.x, -12, this.width + 12);
      d.y = this.wrap(d.y, -12, this.height + 12);
      d.image
        .setPosition(d.x, d.y)
        .setAlpha(d.alpha * intensity * (0.82 + Math.sin(time * 0.0012 + d.phase) * 0.18));
    }

    // Плавно возвращаемся к базовой интенсивности после milestone pulse.
    this.phaseBoost *= Math.pow(0.2, dt);
  }

  /** Короткий атмосферный импульс; используется будущими milestone-событиями. */
  pulse(color = COLORS.cyan, strength = 0.22): void {
    this.phaseBoost = Math.max(this.phaseBoost, strength);
    const flash = this.scene.add
      .rectangle(0, 0, this.width, this.height, color, 0.08 + strength * 0.12)
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(-6)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 420,
      ease: 'Quad.Out',
      onComplete: () => flash.destroy(),
    });
  }

  resize(): void {
    this.width = this.scene.scale.width;
    this.height = this.scene.scale.height;
    this.grid.setSize(this.width, this.height);
  }

  destroy(): void {
    this.grid.destroy();
    for (const g of this.glyphs) g.image.destroy();
    for (const d of this.dust) d.image.destroy();
    this.glyphs.length = 0;
    this.dust.length = 0;
  }

  private wrap(value: number, min: number, max: number): number {
    const span = max - min;
    if (span <= 0) return min;
    return ((((value - min) % span) + span) % span) + min;
  }
}
