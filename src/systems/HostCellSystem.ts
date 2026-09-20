import Phaser from 'phaser';
import { COLORS } from '../game/config';
import type { Player } from '../game/Player';
import { selectHostCellRecycleIndex } from './HostCellRecycling';

interface HostCellSlot {
  image: Phaser.GameObjects.Image;
  infectionOverlay: Phaser.GameObjects.Image;
  ring: Phaser.GameObjects.Graphics;
  active: boolean;
  infection: number;
  phase: number;
  spawnedAt: number;
}

export interface HostCellTuning {
  infectionRadius: number;
  infectionMs: number;
  rna: number;
  lysisRadius: number;
  lysisDamage: number;
}

export interface HostCellLysisEvent {
  x: number;
  y: number;
  rna: number;
  radius: number;
  damage: number;
}

export interface HostCellCheckpointSlot {
  active: boolean;
  infection: number;
  x: number;
  y: number;
  spawnedAgoMs: number;
}

export interface HostCellSystemSnapshot {
  spawnAcc: number;
  firstSpawned: boolean;
  cells: HostCellCheckpointSlot[];
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
  private readonly tuningFn: () => HostCellTuning;
  private readonly gameplayRandom: () => number;
  private readonly cells: HostCellSlot[] = [];
  private spawnAcc = 0;
  private firstSpawned = false;
  constructor(
    scene: Phaser.Scene,
    player: Player,
    onLysis: (event: HostCellLysisEvent) => void,
    tuningFn: () => HostCellTuning = () => ({
      infectionRadius: 58,
      infectionMs: 1250,
      rna: 4,
      lysisRadius: 150,
      lysisDamage: 26,
    }),
    gameplayRandom: () => number = () => {
      throw new Error('HostCellSystem gameplay RNG is not configured');
    }
  ) {
    this.scene = scene;
    this.player = player;
    this.onLysis = onLysis;
    this.tuningFn = tuningFn;
    this.gameplayRandom = gameplayRandom;

    for (let i = 0; i < 6; i++) {
      const image = scene.add
        .image(0, 0, 'host-cell-shadow')
        .setDepth(12)
        .setScale(0.78)
        .setAlpha(0)
        .setVisible(false);
      const infectionOverlay = scene.add
        .image(0, 0, 'host-cell-infection')
        .setDepth(13)
        .setScale(0.78)
        .setAlpha(0)
        .setVisible(false)
        .setBlendMode(Phaser.BlendModes.ADD);
      const ring = scene.add.graphics().setDepth(14).setVisible(false);
      this.cells.push({
        image,
        infectionOverlay,
        ring,
        active: false,
        infection: 0,
        phase: i * 1.23,
        spawnedAt: 0,
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

    const tuning = this.tuningFn();
    for (const cell of this.cells) {
      if (!cell.active) continue;
      const dx = this.player.x - cell.image.x;
      const dy = this.player.y - cell.image.y;
      const distance = Math.hypot(dx, dy);
      const inside = distance <= tuning.infectionRadius;

      if (inside) {
        cell.infection = Math.min(1, cell.infection + delta / Math.max(250, tuning.infectionMs));
      } else {
        // Progress decays gently, so a brief dodge does not erase the interaction.
        cell.infection = Math.max(0, cell.infection - delta / 5000);
      }

      const infected = cell.infection;
      const pulse = 1 + Math.sin(time * 0.003 + cell.phase) * 0.025;
      const scale = (0.78 + infected * 0.1) * pulse;
      const rotation = Math.sin(time * 0.00032 + cell.phase) * 0.025;

      cell.image
        .setScale(scale)
        .setAlpha(0.78 + infected * 0.16)
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

      // Host cells are the signature objective, so they keep a persistent membrane locator even
      // before infection starts. This must survive a 200-enemy screen without becoming HUD-like.
      const locatorRadius = 47 + Math.sin(time * 0.0035 + cell.phase) * 1.2;
      cell.ring.lineStyle(1.8, COLORS.green, 0.34 + infected * 0.18);
      cell.ring.strokeCircle(cell.image.x, cell.image.y, locatorRadius);
      cell.ring.lineStyle(1, COLORS.white, 0.18 + infected * 0.12);
      cell.ring.strokeCircle(cell.image.x, cell.image.y, locatorRadius - 3);

      for (let i = 0; i < 4; i++) {
        const a = cell.phase * 0.2 + (i / 4) * Math.PI * 2;
        const x0 = cell.image.x + Math.cos(a) * (locatorRadius + 1);
        const y0 = cell.image.y + Math.sin(a) * (locatorRadius + 1);
        const x1 = cell.image.x + Math.cos(a) * (locatorRadius + 7);
        const y1 = cell.image.y + Math.sin(a) * (locatorRadius + 7);
        cell.ring.lineStyle(2, COLORS.green, 0.42 + infected * 0.28);
        cell.ring.beginPath();
        cell.ring.moveTo(x0, y0);
        cell.ring.lineTo(x1, y1);
        cell.ring.strokePath();
      }

      const ringColor = infected > 0.66 ? COLORS.green : COLORS.magenta;
      cell.ring.lineStyle(3.4, ringColor, 0.28 + infected * 0.72);
      cell.ring.beginPath();
      cell.ring.arc(
        cell.image.x,
        cell.image.y,
        42 + Math.sin(time * 0.005 + cell.phase) * infected * 2,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * Math.max(0.025, infected),
        false
      );
      cell.ring.strokePath();

      if (inside && infected > 0 && infected < 1) {
        cell.ring.lineStyle(1, COLORS.white, 0.09 + infected * 0.08);
        cell.ring.strokeCircle(cell.image.x, cell.image.y, tuning.infectionRadius);
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

  snapshot(): HostCellSystemSnapshot {
    const now = this.scene.time.now;
    return {
      spawnAcc: this.spawnAcc,
      firstSpawned: this.firstSpawned,
      cells: this.cells.map((cell) => ({
        active: cell.active,
        infection: cell.infection,
        x: cell.image.x,
        y: cell.image.y,
        spawnedAgoMs: cell.active ? Math.max(0, now - cell.spawnedAt) : 0,
      })),
    };
  }

  restore(snapshot: HostCellSystemSnapshot): void {
    this.resetStage();
    this.spawnAcc = snapshot.spawnAcc;
    this.firstSpawned = snapshot.firstSpawned;
    const now = this.scene.time.now;

    for (let i = 0; i < this.cells.length; i++) {
      const cell = this.cells[i];
      const saved = snapshot.cells[i];
      if (!saved?.active) continue;
      cell.active = true;
      cell.infection = saved.infection;
      cell.spawnedAt = now - saved.spawnedAgoMs;
      cell.image
        .setPosition(saved.x, saved.y)
        .setVisible(true)
        .setAlpha(0.78 + saved.infection * 0.16)
        .clearTint()
        .setRotation(0)
        .setScale(0.78 + saved.infection * 0.1);
      cell.infectionOverlay
        .setPosition(saved.x, saved.y)
        .setVisible(saved.infection > 0.015)
        .setAlpha(saved.infection * 0.82)
        .setRotation(0)
        .setScale(0.78 + saved.infection * 0.1);
      cell.ring.setVisible(true).clear();
    }
  }

  /** Reset pooled gameplay cells between stages without reallocating scene objects. */
  ensureOpportunityNearPlayer(maxDistance = 280): boolean {
    const hasNearby = () =>
      this.cells.some((cell) => {
        if (!cell.active || cell.infection >= 0.98) return false;
        return (
          Math.hypot(cell.image.x - this.player.x, cell.image.y - this.player.y) <= maxDistance
        );
      });

    if (hasNearby()) return true;
    this.spawnNearPlayer();
    return hasNearby();
  }

  resetStage(): void {
    this.spawnAcc = 0;
    this.firstSpawned = false;
    for (const cell of this.cells) {
      this.scene.tweens.killTweensOf(cell.image);
      this.scene.tweens.killTweensOf(cell.infectionOverlay);
      this.scene.tweens.killTweensOf(cell.ring);
      cell.active = false;
      cell.infection = 0;
      cell.spawnedAt = 0;
      cell.image.setVisible(false).setAlpha(0).clearTint().setRotation(0).setScale(0.78);
      cell.infectionOverlay.setVisible(false).setAlpha(0).setRotation(0).setScale(0.78);
      cell.ring.setVisible(false).clear();
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
    const cam = this.scene.cameras.main;
    let slot = this.cells.find((c) => !c.active);

    // Signature mechanic must follow the player. If all six pooled cells are stranded far behind,
    // recycle only a nearly untouched old/far cell rather than letting host-cell gameplay disappear.
    if (!slot) {
      const recycleDistance = Math.max(520, Math.max(cam.width, cam.height) * 1.15);
      const recycleIndex = selectHostCellRecycleIndex(
        this.cells.map((cell) => ({
          active: cell.active,
          infection: cell.infection,
          x: cell.image.x,
          y: cell.image.y,
          spawnedAt: cell.spawnedAt,
        })),
        {
          playerX: this.player.x,
          playerY: this.player.y,
          now: this.scene.time.now,
          recycleDistance,
        }
      );
      slot = recycleIndex === null ? undefined : this.cells[recycleIndex];
      if (!slot) return;
      this.scene.tweens.killTweensOf(slot.image);
      this.scene.tweens.killTweensOf(slot.infectionOverlay);
      slot.image.setVisible(false).setAlpha(0).clearTint();
      slot.infectionOverlay.setVisible(false).setAlpha(0);
      slot.ring.setVisible(false).clear();
    }

    const angle = this.gameplayRandom() * Math.PI * 2;
    const distance =
      120 +
      this.gameplayRandom() *
        (Math.min(220, Math.max(140, cam.width * 0.42)) - 120);
    const x = this.player.x + Math.cos(angle) * distance;
    const y = this.player.y + Math.sin(angle) * distance;

    slot.active = true;
    slot.infection = 0;
    slot.spawnedAt = this.scene.time.now;
    slot.image
      .setPosition(x, y)
      .setVisible(true)
      .setAlpha(0)
      .clearTint()
      .setRotation(0)
      .setScale(0.68);
    slot.infectionOverlay
      .setPosition(x, y)
      .setVisible(false)
      .setAlpha(0)
      .setRotation(0)
      .setScale(0.68);
    slot.ring.setVisible(true).clear();
    this.scene.tweens.add({
      targets: slot.image,
      alpha: 0.78,
      scale: 0.78,
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
    cell.spawnedAt = 0;
    cell.ring.setVisible(false).clear();

    // Preserve the texture's native magenta/green membrane colors. Applying a green tint here
    // multiplies away most of the magenta pixels and made the rupture nearly disappear on device.
    const membraneGhost = this.scene.add
      .image(x, y, 'host-cell-shadow')
      .setDepth(13)
      .setScale(scale * 0.98)
      .setAlpha(0.96);
    const infectionGhost = this.scene.add
      .image(x, y, 'host-cell-infection')
      .setDepth(14)
      .setScale(scale)
      .setAlpha(0.98)
      .setBlendMode(Phaser.BlendModes.ADD);

    // Explicit Arc objects remain a secondary contour; the textured membrane and shards carry the
    // primary biological read so the cue survives WebGL blend differences on mobile.
    const segments = [
      [-166, -123],
      [-99, -46],
      [-17, 28],
      [53, 99],
      [119, 156],
    ] as const;
    const ruptureArcs = segments.map(([a0, a1], index) =>
      this.scene.add
        .arc(x, y, 39 + (index % 2) * 3, a0, a1, false, 0x000000, 0)
        .setStrokeStyle(index === 2 ? 5 : 4, COLORS.green, 1)
        .setDepth(15)
    );
    const ruptureHighlights = [
      this.scene.add
        .arc(x, y, 34, -146, -111, false, 0x000000, 0)
        .setStrokeStyle(2, COLORS.white, 0.78)
        .setDepth(16),
      this.scene.add
        .arc(x, y, 34, 20, 61, false, 0x000000, 0)
        .setStrokeStyle(2, COLORS.white, 0.78)
        .setDepth(16),
    ];
    const ruptureShapes = [...ruptureArcs, ...ruptureHighlights];
    for (const arc of ruptureShapes) arc.setScale(0.94).setAlpha(1);
    this.scene.tweens.add({
      targets: ruptureShapes,
      scale: 1.48,
      alpha: 0,
      duration: 640,
      ease: 'Cubic.Out',
      onComplete: () => ruptureShapes.forEach((arc) => arc.destroy()),
    });

    this.scene.tweens.add({
      targets: membraneGhost,
      scale: scale * 1.48,
      alpha: 0,
      duration: 610,
      ease: 'Quad.Out',
      onComplete: () => membraneGhost.destroy(),
    });
    this.scene.tweens.add({
      targets: infectionGhost,
      scale: scale * 1.28,
      rotation: 0.35,
      alpha: 0,
      duration: 430,
      ease: 'Cubic.Out',
      onComplete: () => infectionGhost.destroy(),
    });

    // The fragment texture already contains both membrane colors; keep them intact and large enough
    // to read as torn tissue rather than generic particles.
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2 + Phaser.Math.FloatBetween(-0.12, 0.12);
      const fragment = this.scene.add
        .image(x + Math.cos(a) * 27, y + Math.sin(a) * 27, 'membrane-fragment')
        .setDepth(17)
        .setRotation(a + Math.PI / 2)
        .setScale(Phaser.Math.FloatBetween(1.35, 1.85))
        .setAlpha(1);
      const travel = Phaser.Math.FloatBetween(70, 108);
      this.scene.tweens.add({
        targets: fragment,
        x: x + Math.cos(a) * travel,
        y: y + Math.sin(a) * travel,
        rotation: fragment.rotation + Phaser.Math.FloatBetween(-0.75, 0.75),
        scale: fragment.scaleX * 0.52,
        alpha: 0,
        duration: Phaser.Math.Between(560, 760),
        ease: 'Quad.Out',
        onComplete: () => fragment.destroy(),
      });
    }

    cell.image.setVisible(false).setAlpha(0).clearTint();
    cell.infectionOverlay.setVisible(false).setAlpha(0);
    const tuning = this.tuningFn();
    this.onLysis({
      x,
      y,
      rna: Math.max(1, Math.round(tuning.rna)),
      radius: Math.max(60, tuning.lysisRadius),
      damage: Math.max(1, tuning.lysisDamage),
    });
  }
}
