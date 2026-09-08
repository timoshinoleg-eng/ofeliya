import Phaser from 'phaser';
import { COLORS } from '../game/config';
import type { Player } from '../game/Player';

interface HostCellSlot {
  image: Phaser.GameObjects.Image;
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
 * Signature Strain Zero interaction: approach a neutral host cell, stay nearby long enough to
 * infect it, then trigger lysis. Everything is pooled; no cell objects are created mid-run.
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
      const ring = scene.add.graphics().setDepth(8).setVisible(false);
      this.cells.push({ image, ring, active: false, infection: 0, phase: i * 1.23 });
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
      cell.image
        .setScale((0.72 + infected * 0.11) * pulse)
        .setAlpha(0.62 + infected * 0.28)
        .setTint(infected > 0.05 ? this.mixTint(infected) : 0xffffff);

      cell.ring.clear();
      cell.ring.lineStyle(3, infected > 0.65 ? COLORS.green : COLORS.magenta, 0.25 + infected * 0.7);
      cell.ring.beginPath();
      cell.ring.arc(
        cell.image.x,
        cell.image.y,
        42,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * Math.max(0.035, infected),
        false
      );
      cell.ring.strokePath();

      if (inside && infected > 0 && infected < 1) {
        cell.ring.lineStyle(1, COLORS.white, 0.12);
        cell.ring.strokeCircle(cell.image.x, cell.image.y, this.infectionRadius);
      }

      if (infected >= 1) this.lyse(cell);
    }
  }

  destroy(): void {
    for (const cell of this.cells) {
      cell.image.destroy();
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
      .setScale(0.62);
    slot.ring.setVisible(true).clear();
    this.scene.tweens.add({
      targets: slot.image,
      alpha: 0.62,
      scale: 0.72,
      duration: 260,
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

    const ghost = this.scene.add
      .image(x, y, 'host-cell-shadow')
      .setDepth(9)
      .setScale(scale)
      .setTint(COLORS.green)
      .setAlpha(0.85)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({
      targets: ghost,
      scale: scale * 1.65,
      alpha: 0,
      duration: 340,
      ease: 'Quad.Out',
      onComplete: () => ghost.destroy(),
    });

    cell.image.setVisible(false).setAlpha(0).clearTint();
    this.onLysis({ x, y, rna: 4, radius: 150, damage: 26 });
  }

  private mixTint(progress: number): number {
    if (progress > 0.72) return COLORS.green;
    if (progress > 0.38) return 0xd86aa9;
    return 0xb84c79;
  }
}
