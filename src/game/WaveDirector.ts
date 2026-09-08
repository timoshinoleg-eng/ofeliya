import Phaser from 'phaser';
import { RUN, difficulty, type EnemyKind } from './config';
import type { GameScene } from '../scenes/GameScene';

/** Управляет темпом и составом волн врагов, элитами и боссом. */
export class WaveDirector {
  boss: import('./Enemy').Enemy | null = null;

  private scene: GameScene;
  private enemies: Phaser.Physics.Arcade.Group;
  private spawnAcc = 0;
  private spawnedElites = 0;
  private bossSpawned = false;
  private minionAcc = 0;

  constructor(scene: GameScene, enemies: Phaser.Physics.Arcade.Group) {
    this.scene = scene;
    this.enemies = enemies;
  }

  update(delta: number): void {
    const t = this.scene.runState.timeMs;

    if (!this.bossSpawned && t >= RUN.bossTimeMs) this.spawnBoss();

    if (this.boss) {
      this.minionAcc += delta;
      if (this.minionAcc >= 12000) {
        this.minionAcc = 0;
        const b = this.boss;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          this.scene.spawnEnemy('swarm', b.x + Math.cos(a) * 130, b.y + Math.sin(a) * 130, false);
        }
      }
    }

    const expectedElites = Math.floor(t / 120000);
    if (expectedElites > this.spawnedElites) {
      this.spawnedElites = expectedElites;
      const kind: EnemyKind = Phaser.Utils.Array.GetRandom(['swarm', 'runner', 'brute'] as EnemyKind[]);
      this.spawn(kind, true);
    }

    const progress = Phaser.Math.Clamp(t / RUN.bossTimeMs, 0, 1);
    let interval = Phaser.Math.Linear(1150, 330, progress);
    // бой с боссом — дуэль: обычный спавн реже, иначе босс теряется в толпе
    if (this.bossSpawned) interval /= RUN.bossPhaseSpawnMul;
    this.spawnAcc += delta;
    while (this.spawnAcc >= interval) {
      this.spawnAcc -= interval;
      const batch = Math.min(5, 1 + Math.floor(t / 45000));
      for (let i = 0; i < batch; i++) this.spawn(this.pickKind(t), false);
    }
  }

  private pickKind(t: number): EnemyKind {
    const r = Math.random();
    if (t < 45000) return 'swarm';
    if (t < 90000) return r < 0.8 ? 'swarm' : 'runner';
    if (t < 180000) return r < 0.6 ? 'swarm' : r < 0.9 ? 'runner' : 'brute';
    return r < 0.5 ? 'swarm' : r < 0.8 ? 'runner' : 'brute';
  }

  private spawn(kind: EnemyKind, elite: boolean): void {
    if (!elite && this.enemies.countActive(true) >= 240) return;
    const p = this.ringPos();
    this.scene.spawnEnemy(kind, p.x, p.y, elite);
  }

  private spawnBoss(): void {
    this.bossSpawned = true;
    const p = this.ringPos();
    this.boss = this.scene.spawnEnemy('boss', p.x, p.y, false);
  }

  private ringPos(): { x: number; y: number } {
    const cam = this.scene.cameras.main;
    const a = Math.random() * Math.PI * 2;
    const r = Math.max(cam.width, cam.height) / 2 + 90 + Math.random() * 60;
    return { x: cam.midPoint.x + Math.cos(a) * r, y: cam.midPoint.y + Math.sin(a) * r };
  }
}
