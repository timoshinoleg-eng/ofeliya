import Phaser from 'phaser';
import { COLORS } from '../game/config';
import type { Enemy } from '../game/Enemy';

interface EnemyHealthSlot {
  graphics: Phaser.GameObjects.Graphics;
  enemy: Enemy | null;
  spawnSerial: number;
  visibleUntil: number;
  isElite: boolean;
}

/** Small fixed pool for recently damaged, non-boss enemies. */
export class EnemyHealthOverlay {
  private readonly slots: EnemyHealthSlot[];

  constructor(scene: Phaser.Scene, capacity = 10) {
    this.slots = Array.from({ length: capacity }, () => ({
      graphics: scene.add.graphics().setDepth(13).setVisible(false).setName('ofeliya-enemy-health-bar'),
      enemy: null,
      spawnSerial: 0,
      visibleUntil: 0,
      isElite: false,
    }));
  }

  show(enemy: Enemy, time: number): void {
    if (!enemy.active || enemy.hp <= 0 || enemy.isBoss) {
      this.hide(enemy);
      return;
    }

    let slot = this.slots.find(
      (candidate) => candidate.enemy === enemy && candidate.spawnSerial === enemy.spawnSerial
    );
    if (!slot) {
      // Pooled Enemy objects keep identity across lives. Detach any old assignment before reuse.
      const stale = this.slots.find((candidate) => candidate.enemy === enemy);
      if (stale) this.release(stale);
      slot = this.slots.find((candidate) => !candidate.enemy);
      if (!slot) slot = this.slots.find((candidate) => time >= candidate.visibleUntil);
      if (!slot) {
        let oldestRegular: EnemyHealthSlot | undefined;
        for (const candidate of this.slots) {
          if (!candidate.isElite && (!oldestRegular || candidate.visibleUntil < oldestRegular.visibleUntil)) {
            oldestRegular = candidate;
          }
        }
        if (!oldestRegular) return;
        slot = oldestRegular;
      }
      slot.enemy = enemy;
      slot.spawnSerial = enemy.spawnSerial;
      slot.isElite = enemy.isElite;
    }

    slot.visibleUntil = time + (enemy.isElite ? 1400 : 1000);
    this.draw(slot);
  }

  hide(enemy: Enemy): void {
    for (const slot of this.slots) {
      if (slot.enemy === enemy) this.release(slot);
    }
  }

  update(time: number): void {
    for (const slot of this.slots) {
      const enemy = slot.enemy;
      if (
        !enemy ||
        !enemy.active ||
        enemy.hp <= 0 ||
        enemy.isBoss ||
        enemy.spawnSerial !== slot.spawnSerial ||
        time >= slot.visibleUntil
      ) {
        if (enemy) this.release(slot);
        continue;
      }
      this.draw(slot);
    }
  }

  clear(): void {
    for (const slot of this.slots) this.release(slot);
  }

  destroy(): void {
    for (const slot of this.slots) slot.graphics.destroy();
    this.slots.length = 0;
  }

  private draw(slot: EnemyHealthSlot): void {
    const enemy = slot.enemy;
    if (!enemy) return;
    const width = Phaser.Math.Clamp(enemy.radius * 2.4, 24, 38);
    const height = 4;
    const x = enemy.x - width / 2;
    const y = enemy.y - enemy.radius - 8;
    const fraction = Phaser.Math.Clamp(enemy.hp / Math.max(1, enemy.maxHp), 0, 1);
    const color = slot.isElite ? COLORS.gold : COLORS.green;
    const graphics = slot.graphics;
    graphics.clear();
    graphics.fillStyle(0x081018, 0.88);
    graphics.fillRoundedRect(x, y, width, height, 1.5);
    graphics.fillStyle(color, 0.96);
    graphics.fillRoundedRect(x, y, width * fraction, height, 1.5);
    graphics.lineStyle(0.8, COLORS.white, 0.46);
    graphics.strokeRoundedRect(x, y, width, height, 1.5);
    graphics.setVisible(true);
  }

  private release(slot: EnemyHealthSlot): void {
    slot.graphics.clear().setVisible(false);
    slot.enemy = null;
    slot.spawnSerial = 0;
    slot.visibleUntil = 0;
    slot.isElite = false;
  }
}
