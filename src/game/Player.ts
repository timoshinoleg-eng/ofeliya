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
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const major = i % 2 === 0;
      const inner = major ? 21 : 23;
      const outer = major ? 39 : 33;
      const color = i % 4 === 0 ? COLORS.green : COLORS.gold;

      g.lineStyle(major ? 2.5 : 1.5, color, major ? 0.92 : 0.7);
      g.beginPath();
      g.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
      g.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
      g.strokePath();

      if (major) {
        const tx = Math.cos(a) * outer;
        const ty = Math.sin(a) * outer;
        g.fillStyle(color, 0.9);
        g.fillCircle(tx, ty, 2.4);
        // Two tiny receptor branches turn every long spike into a recognisable protein head.
        const tangent = a + Math.PI / 2;
        g.lineStyle(1.2, COLORS.white, 0.46);
        g.beginPath();
        g.moveTo(tx, ty);
        g.lineTo(tx + Math.cos(tangent) * 3.2, ty + Math.sin(tangent) * 3.2);
        g.moveTo(tx, ty);
        g.lineTo(tx - Math.cos(tangent) * 3.2, ty - Math.sin(tangent) * 3.2);
        g.strokePath();
      }
    }
  }

  /** СВЕРХКАПСИД: segmented armour wraps the virion with a heavy golden membrane. */
  private drawCapsidShell(g: Phaser.GameObjects.Graphics): void {
    const segments = 8;
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2 + 0.08;
      const a1 = ((i + 0.7) / segments) * Math.PI * 2 + 0.08;
      g.lineStyle(i % 2 === 0 ? 4.2 : 3.2, COLORS.gold, i % 2 === 0 ? 0.88 : 0.68);
      g.beginPath();
      g.arc(0, 0, 29, a0, a1, false);
      g.strokePath();

      const mid = (a0 + a1) / 2;
      g.fillStyle(COLORS.white, 0.58);
      g.fillCircle(Math.cos(mid) * 29, Math.sin(mid) * 29, 1.6);
    }
    g.lineStyle(1.2, COLORS.white, 0.32);
    g.strokeCircle(0, 0, 33);
    g.lineStyle(1, COLORS.gold, 0.25);
    g.strokeCircle(0, 0, 25);
  }

  /** ЛИЗИС: an unstable replication core plus three budding daughter virions. */
  private drawLysisCore(g: Phaser.GameObjects.Graphics): void {
    g.lineStyle(2.4, COLORS.green, 0.78);
    g.strokeCircle(0, 0, 11);
    g.lineStyle(1.5, COLORS.magenta, 0.62);
    g.strokeCircle(0, 0, 17);

    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.lineStyle(1.2, i % 2 ? COLORS.magenta : COLORS.green, 0.5);
      g.beginPath();
      g.moveTo(Math.cos(a) * 7, Math.sin(a) * 7);
      g.lineTo(Math.cos(a + 0.18) * 15, Math.sin(a + 0.18) * 15);
      g.strokePath();
    }

    // Budding satellites are the strongest silhouette cue for replication/lysis.
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.35;
      const x = Math.cos(a) * 24;
      const y = Math.sin(a) * 24;
      g.fillStyle(COLORS.magenta, 0.35);
      g.fillCircle(x, y, 5.2);
      g.lineStyle(1.5, COLORS.green, 0.75);
      g.strokeCircle(x, y, 4.2);
      g.fillStyle(COLORS.white, 0.7);
      g.fillCircle(x - 1.2, y - 1.2, 1.1);
    }
  }
}
