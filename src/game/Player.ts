import Phaser from 'phaser';
import { COLORS, PLAYER } from './config';

export class Player extends Phaser.Physics.Arcade.Sprite {
  hurtUntil = 0;

  private readonly spikeCrown: Phaser.GameObjects.Graphics;
  private readonly capsidShell: Phaser.GameObjects.Graphics;
  private readonly lysisCore: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'virus-player');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(15);

    // Visual art is deliberately larger than the authoritative gameplay body. Keep the hitbox
    // stable across every art/mutation state so polish never changes difficulty by accident.
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setCircle(13, this.width / 2 - 13, this.height / 2 - 13);

    // Critical mutations allocate their silhouette overlays once. Mutating only toggles them.
    this.spikeCrown = scene.add
      .graphics()
      .setDepth(14)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false);
    this.drawSpikeCrown(this.spikeCrown);

    this.capsidShell = scene.add
      .graphics()
      .setDepth(16)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false);
    this.drawCapsidShell(this.capsidShell);

    this.lysisCore = scene.add
      .graphics()
      .setDepth(16)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false);
    this.drawLysisCore(this.lysisCore);
  }

  /** Keep internal evolution IDs stable while making their effect visible on the virion itself. */
  setMutationState(hyperSpike: boolean, superCapsid: boolean, lysis: boolean): void {
    this.spikeCrown.setVisible(hyperSpike);
    this.capsidShell.setVisible(superCapsid);
    this.lysisCore.setVisible(lysis);
  }

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    if (!this.active) return;

    // Slow virion drift + membrane breathing. The 0.9 visual scale keeps the richer 56px texture
    // close to the old footprint while preserving readable spikes on small phones.
    const baseRotation = time * 0.00014;
    const breathe = 0.9 + Math.sin(time * 0.0042) * 0.028;
    this.setRotation(baseRotation);
    this.setScale(breathe);

    this.spikeCrown
      .setPosition(this.x, this.y)
      .setRotation(-time * 0.00062)
      .setScale(0.96 + Math.sin(time * 0.0048) * 0.04)
      .setAlpha(0.7 + Math.sin(time * 0.006) * 0.16);

    this.capsidShell
      .setPosition(this.x, this.y)
      .setRotation(time * 0.00046)
      .setScale(0.98 + Math.sin(time * 0.0034) * 0.028)
      .setAlpha(0.58 + Math.sin(time * 0.0041) * 0.12);

    this.lysisCore
      .setPosition(this.x, this.y)
      .setRotation(-time * 0.0004)
      .setScale(0.92 + Math.sin(time * 0.0054) * 0.08)
      .setAlpha(0.56 + Math.sin(time * 0.0054) * 0.2);
  }

  markHurt(now: number): void {
    this.hurtUntil = now + PLAYER.iframeMs;
    this.setTintFill(0xffffff);
  }

  destroy(fromScene?: boolean): void {
    this.spikeCrown.destroy();
    this.capsidShell.destroy();
    this.lysisCore.destroy();
    super.destroy(fromScene);
  }

  /** ГИПЕРШИП: the silhouette becomes visibly more predatory, not just recoloured. */
  private drawSpikeCrown(g: Phaser.GameObjects.Graphics): void {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const inner = 22;
      const outer = i % 2 === 0 ? 36 : 32;
      const color = i % 2 === 0 ? COLORS.green : COLORS.gold;
      g.lineStyle(i % 2 === 0 ? 2.4 : 1.8, color, 0.78);
      g.beginPath();
      g.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
      g.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
      g.strokePath();

      const tx = Math.cos(a) * outer;
      const ty = Math.sin(a) * outer;
      g.fillStyle(color, 0.82);
      g.fillCircle(tx, ty, i % 2 === 0 ? 2.5 : 2);
      if (i % 2 === 0) {
        const tangent = a + Math.PI / 2;
        g.lineStyle(1.1, COLORS.white, 0.38);
        g.beginPath();
        g.moveTo(tx, ty);
        g.lineTo(tx + Math.cos(tangent) * 3, ty + Math.sin(tangent) * 3);
        g.moveTo(tx, ty);
        g.lineTo(tx - Math.cos(tangent) * 3, ty - Math.sin(tangent) * 3);
        g.strokePath();
      }
    }
  }

  /** СВЕРХКАПСИД: segmented armour wraps the virion with a heavy golden membrane. */
  private drawCapsidShell(g: Phaser.GameObjects.Graphics): void {
    for (let i = 0; i < 4; i++) {
      const centre = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const a0 = centre - 0.42;
      const a1 = centre + 0.42;
      g.lineStyle(4.6, COLORS.gold, 0.76);
      g.beginPath();
      g.arc(0, 0, 27.5, a0, a1, false);
      g.strokePath();
      g.fillStyle(COLORS.white, 0.5);
      g.fillCircle(Math.cos(centre) * 27.5, Math.sin(centre) * 27.5, 1.7);
    }
    g.lineStyle(1.1, COLORS.gold, 0.18);
    g.strokeCircle(0, 0, 25);
  }

  /** ЛИЗИС: an unstable replication core plus three budding daughter virions. */
  private drawLysisCore(g: Phaser.GameObjects.Graphics): void {
    g.fillStyle(COLORS.green, 0.12);
    g.fillCircle(0, 0, 13);
    g.lineStyle(2.2, COLORS.green, 0.68);
    g.strokeCircle(0, 0, 11);

    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      g.lineStyle(1.1, i % 2 ? COLORS.magenta : COLORS.green, 0.42);
      g.beginPath();
      g.moveTo(Math.cos(a) * 6, Math.sin(a) * 6);
      g.lineTo(Math.cos(a + 0.2) * 14, Math.sin(a + 0.2) * 14);
      g.strokePath();
    }

    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.35;
      const x = Math.cos(a) * 30;
      const y = Math.sin(a) * 30;
      g.fillStyle(COLORS.magenta, 0.24);
      g.fillCircle(x, y, 5.6);
      g.lineStyle(1.4, COLORS.green, 0.64);
      g.strokeCircle(x, y, 4.4);
      g.fillStyle(COLORS.white, 0.62);
      g.fillCircle(x - 1.2, y - 1.2, 1);
    }
  }
}
