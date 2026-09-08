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
    // Preserve the original gameplay hitbox despite the larger, more detailed virion art.
    (this.body as Phaser.Physics.Arcade.Body).setCircle(13, 9, 9);

    // Three fixed overlays are allocated once. Critical mutations reveal them instead of
    // swapping to expensive animated assets or creating effects every frame.
    this.spikeCrown = scene.add.graphics().setDepth(14).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.drawSpikeCrown(this.spikeCrown);

    this.capsidShell = scene.add.graphics().setDepth(16).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.drawCapsidShell(this.capsidShell);

    this.lysisCore = scene.add.graphics().setDepth(14).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
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

    const baseRotation = time * 0.00016;
    const breathe = 1 + Math.sin(time * 0.0042) * 0.035;
    this.setRotation(baseRotation);
    this.setScale(breathe);

    this.spikeCrown
      .setPosition(this.x, this.y)
      .setRotation(-time * 0.0007)
      .setScale(0.98 + Math.sin(time * 0.0048) * 0.045)
      .setAlpha(0.72 + Math.sin(time * 0.006) * 0.16);

    this.capsidShell
      .setPosition(this.x, this.y)
      .setRotation(time * 0.0005)
      .setScale(1 + Math.sin(time * 0.0034) * 0.035)
      .setAlpha(0.62 + Math.sin(time * 0.0041) * 0.13);

    this.lysisCore
      .setPosition(this.x, this.y)
      .setRotation(-time * 0.00028)
      .setScale(0.9 + Math.sin(time * 0.0054) * 0.09)
      .setAlpha(0.5 + Math.sin(time * 0.0054) * 0.2);
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

  private drawSpikeCrown(g: Phaser.GameObjects.Graphics): void {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const inner = i % 2 === 0 ? 19 : 21;
      const outer = i % 2 === 0 ? 31 : 27;
      g.lineStyle(i % 2 === 0 ? 2.2 : 1.5, i % 3 === 0 ? COLORS.green : COLORS.gold, 0.86);
      g.beginPath();
      g.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
      g.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
      g.strokePath();
      if (i % 2 === 0) {
        g.fillStyle(COLORS.gold, 0.82);
        g.fillCircle(Math.cos(a) * outer, Math.sin(a) * outer, 2.1);
      }
    }
  }

  private drawCapsidShell(g: Phaser.GameObjects.Graphics): void {
    g.lineStyle(3, COLORS.gold, 0.82);
    g.beginPath();
    g.arc(0, 0, 26, -0.15, 1.25, false);
    g.strokePath();
    g.beginPath();
    g.arc(0, 0, 26, 1.75, 3.05, false);
    g.strokePath();
    g.beginPath();
    g.arc(0, 0, 26, 3.55, 4.9, false);
    g.strokePath();
    g.beginPath();
    g.arc(0, 0, 26, 5.3, 6.1, false);
    g.strokePath();
    g.lineStyle(1.2, COLORS.white, 0.44);
    g.strokeCircle(0, 0, 30);
  }

  private drawLysisCore(g: Phaser.GameObjects.Graphics): void {
    g.lineStyle(2.4, COLORS.green, 0.72);
    g.strokeCircle(0, 0, 11);
    g.lineStyle(1.4, COLORS.magenta, 0.62);
    g.strokeCircle(0, 0, 17);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.lineStyle(1.2, COLORS.green, 0.5);
      g.beginPath();
      g.moveTo(Math.cos(a) * 7, Math.sin(a) * 7);
      g.lineTo(Math.cos(a) * 15, Math.sin(a) * 15);
      g.strokePath();
    }
  }
}
