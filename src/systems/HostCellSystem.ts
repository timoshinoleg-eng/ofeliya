import Phaser from 'phaser';
import { COLORS } from '../game/config';
import type { Player } from '../game/Player';

interface HostCellSlot {
  image: Phaser.GameObjects.Image;
  infectionOverlay: Phaser.GameObjects.Image;
  ring: Phaser.GameObjects.Graphics;
  active: boolean;
  infection: number;
  phase: number;
}

export interface HostCellLysisEvent {
  x: number;
  y: number;
  rna: number;
  radius: number;
  damage: number;
}

/**
 * Signature Strain Zero interaction: a neutral cell visibly changes from healthy tissue to a
 * replicated viral factory before membrane rupture. The six gameplay cells are pooled; only the
 * rare lysis burst allocates short-lived decorative fragments, all destroyed by their tweens.
 */
export class HostCellSystem {
  private readonly scene: Phaser.Scene;
  private readonly player: Player;
  private readonly onLysis: (event: HostCellLysisEvent) => void;
  private readonly cells: HostCellSlot[] = [];
  private spawnAcc = 0;
  private firstSpawned = false;
  private readonly infectionRadius = 58;
  private readonly infectionMs = 1250;

  constructor(
    scene: Phaser.Scene,
    player: Player,
    onLysis: (event: HostCellLysisEvent) => void
  ) {
    this.scene = scene;
    this.player = player;
    this.onLysis = onLysis;

    for (let i = 0; i < 6; i++) {
      const image = scene.add
        .image(0, 0, 'host-cell-shadow')
        .setDepth(7)
        .setScale(0.72)
        .setAlpha(0)
        .setVisible(false);
      const infectionOverlay = scene.add
        .image(0, 0, 'host-cell-infection')
        .setDepth(8)
        .setScale(0.72)
        .setAlpha(0)
        .setVisible(false)
        .setBlendMode(Phaser.BlendModes.ADD);
      const ring = scene.add.graphics().setDepth(9).setVisible(false);
      this.cells.push({
        image,
        infectionOverlay,
        ring,
        active: false,
        infection: 0,
        phase: i * 1.23,
      });
    }
  }

  update(time: number, delta: number, runTimeMs: number): void {
    if (!this.firstSpawned && runTimeMs >= 7000) {
      this.firstSpawned = true;
      this.spawnNearPlayer();
    }

    this.spawnAcc += delta;
    const interval = Math.max(12_000, 21_000 - runTimeMs * 0.018);
    if (this.spawnAcc >= interval) {
      this.spawnAcc = 0;
      this.spawnNearPlayer();
    }

    for (const cell of this.cells) {
      if (!cell.active) continue;
      const dx = this.player.x - cell.image.x;
      const dy = this.player.y - cell.image.y;
      const distance = Math.hypot(dx, dy);
      const inside = distance <= this.infectionRadius;

      if (inside) {
        cell.infection = Math.min(1, cell.infection + delta / this.infectionMs);
      } else {
        // Progress decays gently, so a brief dodge does not erase the interaction.
        cell.infection = Math.max(0, cell.infection - delta / 5000);
      }

      const infected = cell.infection;
      const pulse = 1 + Math.sin(time * 0.003 + cell.phase) * 0.025;
      const scale = (0.72 + infected * 0.1) * pulse;
      const rotation = Math.sin(time * 0.00032 + cell.phase) * 0.025;

      cell.image
        .setScale(scale)
        .setAlpha(0.62 + infected * 0.18)
        .setRotation(rotation)
        .setTint(infected > 0.82 ? 0xffd7eb : 0xffffff);

      // This is the key visual story: replication foci/veins grow inside the cell rather than a
      // flat global tint. At 70%+ the overlay visibly pulses as if the membrane is under pressure.
      const infectionPulse = 0.82 + Math.sin(time * 0.007 + cell.phase) * 0.18;
      cell.infectionOverlay
        .setPosition(cell.image.x, cell.image.y)
        .setRotation(-rotation * 1.8)
        .setScale(scale * (1 + infected * 0.025))
        .setVisible(infected > 0.015)
        .setAlpha(infected * (infected > 0.7 ? infectionPulse : 0.82));

      cell.ring.clear();
      const ringColor = infected > 0.66 ? COLORS.green : COLORS.magenta;
      cell.ring.lineStyle(3, ringColor, 0.18 + infected * 0.72);
      cell.ring.beginPath();
      cell.ring.arc(
        cell.image.x,
        cell.image.y,
        43 + Math.sin(time * 0.005 + cell.phase) * infected * 2,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * Math.max(0.025, infected),
        false
      );
      cell.ring.strokePath();

      if (inside && infected > 0 && infected < 1) {
        cell.ring.lineStyle(1, COLORS.white, 0.09 + infected * 0.08);
        cell.ring.strokeCircle(cell.image.x, cell.image.y, this.infectionRadius);
      }

      // Membrane warning arcs appear only near rupture, replacing a generic progress-circle feel.
      if (infected > 0.72) {
        const crack = (infected - 0.72) / 0.28;
        for (let i = 0; i < 3; i++) {
          const a = time * 0.0008 + cell.phase + (i / 3) * Math.PI * 2;
          cell.ring.lineStyle(1.5, COLORS.green, 0.18 + crack * 0.55);
          cell.ring.beginPath();
          cell.ring.arc(cell.image.x, cell.image.y, 36 + i * 2.2, a, a + 0.42 + crack * 0.35, false);
          cell.ring.strokePath();
        }
      }

      if (infected >= 1) this.lyse(cell);
    }
  }

  destroy(): void {
    for (const cell of this.cells) {
      cell.image.destroy();
      cell.infectionOverlay.destroy();
      cell.ring.destroy();
    }
    this.cells.length = 0;
  }

  private spawnNearPlayer(): void {
    const slot = this.cells.find((c) => !c.active);
    if (!slot) return;
    const cam = this.scene.cameras.main;
    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const distance = Phaser.Math.FloatBetween(120, Math.min(220, Math.max(140, cam.width * 0.42)));
    const x = this.player.x + Math.cos(angle) * distance;
    const y = this.player.y + Math.sin(angle) * distance;

    slot.active = true;
    slot.infection = 0;
    slot.image
      .setPosition(x, y)
      .setVisible(true)
      .setAlpha(0)
      .clearTint()
      .setRotation(0)
      .setScale(0.62);
    slot.infectionOverlay
      .setPosition(x, y)
      .setVisible(false)
      .setAlpha(0)
      .setRotation(0)
      .setScale(0.62);
    slot.ring.setVisible(true).clear();
    this.scene.tweens.add({
      targets: slot.image,
      alpha: 0.62,
      scale: 0.72,
      duration: 280,
      ease: 'Back.Out',
    });
  }

  private lyse(cell: HostCellSlot): void {
    const x = cell.image.x;
    const y = cell.image.y;
    const scale = cell.image.scaleX;
    cell.active = false;
    cell.infection = 0;
    cell.ring.setVisible(false).clear();

    // Two-layer rupture flash preserves the healthy membrane and infected replication pattern for
    // a few frames, so the player reads cause -> rupture instead of an arbitrary explosion.
    const membraneGhost = this.scene.add
      .image(x, y, 'host-cell-shadow')
      .setDepth(9)
      .setScale(scale)
      .setTint(COLORS.green)
      .setAlpha(0.76)
      .setBlendMode(Phaser.BlendModes.ADD);
    const infectionGhost = this.scene.add
      .image(x, y, 'host-cell-infection')
      .setDepth(10)
      .setScale(scale)
      .setAlpha(0.95)
      .setBlendMode(Phaser.BlendModes.ADD);

    // Keep a broken membrane contour visible through the brightest nova frames. This gives the
    // lysis event a semantic silhouette on a 60 Hz phone: cell ruptures first, RNA escapes second.
    const ruptureContour = this.scene.add.graphics().setPosition(x, y).setDepth(12);
    const segments = [
      [-2.9, -2.15],
      [-1.72, -0.8],
      [-0.3, 0.48],
      [0.92, 1.72],
      [2.08, 2.72],
    ] as const;
    ruptureContour.lineStyle(4, COLORS.green, 0.96);
    for (const [a0, a1] of segments) {
      ruptureContour.beginPath();
      ruptureContour.arc(0, 0, 40, a0, a1, false);
      ruptureContour.strokePath();
    }
    ruptureContour.lineStyle(1.5, COLORS.white, 0.48);
    ruptureContour.beginPath();
    ruptureContour.arc(0, 0, 35, -2.55, -1.95, false);
    ruptureContour.strokePath();
    ruptureContour.beginPath();
    ruptureContour.arc(0, 0, 35, 0.35, 1.05, false);
    ruptureContour.strokePath();
    ruptureContour.setScale(0.92).setAlpha(1);
    this.scene.tweens.add({
      targets: ruptureContour,
      scale: 1.5,
      alpha: 0,
      duration: 560,
      ease: 'Cubic.Out',
      onComplete: () => ruptureContour.destroy(),
    });

    this.scene.tweens.add({
      targets: membraneGhost,
      scale: scale * 1.72,
      alpha: 0,
      duration: 390,
      ease: 'Quad.Out',
      onComplete: () => membraneGhost.destroy(),
    });
    this.scene.tweens.add({
      targets: infectionGhost,
      scale: scale * 1.3,
      rotation: 0.4,
      alpha: 0,
      duration: 300,
      ease: 'Cubic.Out',
      onComplete: () => infectionGhost.destroy(),
    });

    // Membrane fragments make lysis look biological rather than like a generic neon nova.
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + Phaser.Math.FloatBetween(-0.18, 0.18);
      const fragment = this.scene.add
        .image(x + Math.cos(a) * 18, y + Math.sin(a) * 18, 'membrane-fragment')
        .setDepth(11)
        .setRotation(a + Math.PI / 2)
        .setScale(Phaser.Math.FloatBetween(0.65, 1.05))
        .setAlpha(0.88)
        .setBlendMode(Phaser.BlendModes.ADD);
      const travel = Phaser.Math.FloatBetween(54, 92);
      this.scene.tweens.add({
        targets: fragment,
        x: x + Math.cos(a) * travel,
        y: y + Math.sin(a) * travel,
        rotation: fragment.rotation + Phaser.Math.FloatBetween(-0.7, 0.7),
        scale: fragment.scaleX * 0.45,
        alpha: 0,
        duration: Phaser.Math.Between(280, 420),
        ease: 'Quad.Out',
        onComplete: () => fragment.destroy(),
      });
    }

    cell.image.setVisible(false).setAlpha(0).clearTint();
    cell.infectionOverlay.setVisible(false).setAlpha(0);
    this.onLysis({ x, y, rna: 4, radius: 150, damage: 26 });
  }
}
