import Phaser from 'phaser';
import { COLORS, PLAYER } from './config';
import { artScale, artSourceFactor } from './ArtMetrics';
import { biologicalAtlasKey, biologicalFrameAt } from './BiologicalAnimation';

export class Player extends Phaser.Physics.Arcade.Sprite {
  hurtUntil = 0;

  private readonly focusAnchor: Phaser.GameObjects.Arc;
  private readonly spikeCrown: Phaser.GameObjects.Graphics;
  private readonly capsidShell: Phaser.GameObjects.Graphics;
  private readonly lysisCore: Phaser.GameObjects.Graphics;
  // Packaged art stays a quiet inner detail; the retained Graphics carry three distinct
  // silhouettes at separate radii. Canonical texture objects remain available for late recovery.
  private readonly prismUnderlay: Phaser.GameObjects.Image;
  private readonly haloUnderlay: Phaser.GameObjects.Image;
  private readonly singularityUnderlay: Phaser.GameObjects.Image;
  private biologicalFrame = -1;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'virus-player');
    this.setScale(artScale(this.texture.key, 1));
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(15);

    // Visual art is deliberately larger than the authoritative gameplay body. Keep the hitbox
    // stable across every art/mutation state so polish never changes difficulty by accident.
    const body = this.body as Phaser.Physics.Arcade.Body;
    const radius = 13 * artSourceFactor(this.texture.key);
    body.setCircle(radius, this.width / 2 - radius, this.height / 2 - radius);

    // One Canvas-safe contrast anchor keeps the player readable over plasma, cells and VFX
    // without a per-frame shader or permanent bloom pass.
    this.focusAnchor = scene.add
      .circle(x, y, 23, 0x05070f, 0.34)
      .setStrokeStyle(1.5, COLORS.white, 0.32)
      .setDepth(13);

    // Critical mutations allocate their silhouette overlays once. Mutating only toggles them.
    this.spikeCrown = scene.add
      .graphics()
      .setDepth(14)
      .setBlendMode(Phaser.BlendModes.NORMAL)
      .setVisible(false);
    this.drawSpikeCrown(this.spikeCrown);

    this.capsidShell = scene.add
      .graphics()
      .setDepth(14.2)
      .setBlendMode(Phaser.BlendModes.NORMAL)
      .setVisible(false);
    this.drawCapsidShell(this.capsidShell);

    this.lysisCore = scene.add
      .graphics()
      .setDepth(16)
      .setBlendMode(Phaser.BlendModes.NORMAL)
      .setVisible(false);
    this.drawLysisCore(this.lysisCore);

    this.prismUnderlay = this.makeMutationUnderlay('mutation-prism');
    this.haloUnderlay = this.makeMutationUnderlay('mutation-halo');
    this.singularityUnderlay = this.makeMutationUnderlay('mutation-singularity');
  }

  /** Inner artwork never covers the graphic perimeter identifying each critical mutation. */
  private makeMutationUnderlay(key: string): Phaser.GameObjects.Image {
    return this.scene.add
      .image(this.x, this.y, key)
      .setDepth(13.5)
      .setAlpha(0.26)
      .setScale(artScale(key, key === 'mutation-prism' ? 1.12 : key === 'mutation-halo' ? 0.9 : 0.76))
      .setVisible(false);
  }

  /** Keep internal evolution IDs stable while making their effect visible on the virion itself. */
  setMutationState(hyperSpike: boolean, superCapsid: boolean, lysis: boolean): void {
    this.spikeCrown.setVisible(hyperSpike);
    this.capsidShell.setVisible(superCapsid);
    this.lysisCore.setVisible(lysis);
    this.prismUnderlay.setVisible(hyperSpike);
    this.haloUnderlay.setVisible(superCapsid);
    this.singularityUnderlay.setVisible(lysis);
  }

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    if (!this.active) return;
    const atlas = biologicalAtlasKey('virus-player');
    if (this.scene.textures.exists(atlas)) {
      const reduced = this.scene.registry.get('performanceTier') === 'reduced' || this.scene.registry.get('runtimeQuality')?.level === 'low';
      const frame = biologicalFrameAt(time, 0, reduced);
      if (frame !== this.biologicalFrame || this.texture.key !== atlas) {
        this.setTexture(atlas, `bio-${frame}`);
        this.biologicalFrame = frame;
      }
    }

    // Slow virion drift + membrane breathing. The 0.9 visual scale keeps the richer 56px texture
    // close to the old footprint while preserving readable spikes on small phones.
    const baseRotation = time * 0.00014;
    const breathe = 0.9 + Math.sin(time * 0.0042) * 0.028;
    this.setRotation(baseRotation);
    this.setScale(artScale(this.texture.key, breathe));

    this.focusAnchor
      .setPosition(this.x, this.y)
      .setScale(0.96 + Math.sin(time * 0.0036) * 0.025)
      .setAlpha(0.28 + Math.sin(time * 0.0036) * 0.045);

    this.spikeCrown
      .setPosition(this.x, this.y)
      .setRotation(-time * 0.00062)
      .setScale(0.96 + Math.sin(time * 0.0048) * 0.04)
      .setAlpha(0.9 + Math.sin(time * 0.006) * 0.06);

    this.capsidShell
      .setPosition(this.x, this.y)
      .setRotation(time * 0.00046)
      .setScale(0.98 + Math.sin(time * 0.0034) * 0.028)
      .setAlpha(0.9 + Math.sin(time * 0.0041) * 0.06);

    this.lysisCore
      .setPosition(this.x, this.y)
      .setRotation(-time * 0.0004)
      .setScale(0.92 + Math.sin(time * 0.0054) * 0.08)
      .setAlpha(0.86 + Math.sin(time * 0.0054) * 0.1);

    // Silhouette underlays counter-rotate against the body so the mutation reads in motion,
    // not only in a still frame. Distinct speeds keep the three identities separable.
    this.prismUnderlay
      .setPosition(this.x, this.y)
      .setRotation(-time * 0.00062)
      .setScale(artScale('mutation-prism', 1.12 + Math.sin(time * 0.0048) * 0.05))
      .setAlpha(0.26 + Math.sin(time * 0.006) * 0.03);

    this.haloUnderlay
      .setPosition(this.x, this.y)
      .setRotation(time * 0.00046)
      .setScale(artScale('mutation-halo', 0.9 + Math.sin(time * 0.0034) * 0.04))
      .setAlpha(0.22 + Math.sin(time * 0.0041) * 0.03);

    this.singularityUnderlay
      .setPosition(this.x, this.y)
      .setRotation(-time * 0.0004)
      .setScale(artScale('mutation-singularity', 0.76 + Math.sin(time * 0.0054) * 0.09))
      .setAlpha(0.2 + Math.sin(time * 0.0054) * 0.03);
  }

  markHurt(now: number): void {
    this.hurtUntil = now + PLAYER.iframeMs;
    this.setTintFill(0xffffff);
  }

  destroy(fromScene?: boolean): void {
    this.focusAnchor.destroy();
    this.spikeCrown.destroy();
    this.capsidShell.destroy();
    this.lysisCore.destroy();
    this.prismUnderlay.destroy();
    this.haloUnderlay.destroy();
    this.singularityUnderlay.destroy();
    super.destroy(fromScene);
  }

  /** ГИПЕРШИП: the silhouette becomes visibly more predatory, not just recoloured. */
  private drawSpikeCrown(g: Phaser.GameObjects.Graphics): void {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const outer = i % 2 === 0 ? 46 : 42;
      // Broad, dark-rooted spear blades stay legible over both bright cells and plasma.
      const left = a - 0.15;
      const right = a + 0.15;
      g.fillStyle(0x7dbda5, 0.92);
      g.fillTriangle(Math.cos(left) * 25, Math.sin(left) * 25,
        Math.cos(a) * outer, Math.sin(a) * outer,
        Math.cos(right) * 25, Math.sin(right) * 25);
      g.lineStyle(1.3, 0xe1f2df, 0.94);
      g.beginPath();
      g.moveTo(Math.cos(left) * 25, Math.sin(left) * 25);
      g.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
      g.lineTo(Math.cos(right) * 25, Math.sin(right) * 25);
      g.strokePath();
    }
  }

  /** СВЕРХКАПСИД: segmented armour wraps the virion with a heavy golden membrane. */
  private drawCapsidShell(g: Phaser.GameObjects.Graphics): void {
    for (let i = 0; i < 6; i++) {
      const centre = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const a0 = centre - 0.34;
      const a1 = centre + 0.34;
      g.lineStyle(7, 0x67533b, 0.94);
      g.beginPath();
      g.arc(0, 0, 34, a0, a1, false);
      g.strokePath();
      g.lineStyle(4.2, 0xf1dfae, 0.96);
      g.beginPath();
      g.arc(0, 0, 34, a0, a1, false);
      g.strokePath();
      g.fillStyle(0xfff3d1, 1);
      g.fillCircle(Math.cos(centre) * 34, Math.sin(centre) * 34, 2);
    }
  }

  /** ЛИЗИС: three separated outer arcs and a small violet replication core. */
  private drawLysisCore(g: Phaser.GameObjects.Graphics): void {
    g.fillStyle(0x22172e, 0.94);
    g.fillCircle(0, 0, 7);
    g.lineStyle(1.8, 0xc5a9e8, 0.96);
    g.strokeCircle(0, 0, 7);
    g.fillStyle(0xf0e3fc, 0.96);
    g.fillCircle(0, 0, 2.4);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.35;
      g.lineStyle(5, 0x30213f, 0.95);
      g.beginPath();
      g.arc(0, 0, 51, a - 0.38, a + 0.38, false);
      g.strokePath();
      g.lineStyle(2.4, 0xb79add, 0.96);
      g.beginPath();
      g.arc(0, 0, 51, a - 0.38, a + 0.38, false);
      g.strokePath();
      g.fillStyle(0xe8d4f6, 0.96);
      g.fillCircle(Math.cos(a + 0.38) * 51, Math.sin(a + 0.38) * 51, 2.6);
    }
  }
}
