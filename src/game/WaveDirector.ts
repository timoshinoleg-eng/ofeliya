import Phaser from 'phaser';
import { RUN, type EnemyKind } from './config';
import { RunMilestones } from './RunMilestones';
import type { GameScene } from '../scenes/GameScene';

/** Управляет темпом и составом волн врагов, элитами и боссом. */
export class WaveDirector {
  boss: import('./Enemy').Enemy | null = null;

  private scene: GameScene;
  private enemies: Phaser.Physics.Arcade.Group;
  private milestones: RunMilestones;
  private spawnAcc = 0;
  private spawnedElites = 0;
  private bossSpawned = false;
  private minionAcc = 0;

  constructor(scene: GameScene, enemies: Phaser.Physics.Arcade.Group) {
    this.scene = scene;
    this.enemies = enemies;
    this.milestones = new RunMilestones(scene);

    // First-session hook: three antibodies begin inside auto-fire range so the player sees
    // shooting immediately, while their spacing leaves a clear escape lane for a new player.
    this.spawnOpeningAntibodies();
  }

  update(delta: number): void {
    const t = this.scene.runState.timeMs;

    // Presentation observer only: it mirrors the immune-response timeline while this director
    // owns the actual composition changes below.
    this.milestones.update(t);

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

    // First NK-cell presentation arrives with the adaptive-immunity beat at 02:00.
    const expectedElites = Math.floor(t / 120000);
    if (expectedElites > this.spawnedElites) {
      this.spawnedElites = expectedElites;
      const kind: EnemyKind = Phaser.Utils.Array.GetRandom(['swarm', 'runner', 'brute'] as EnemyKind[]);
      this.spawn(kind, true);
    }

    const progress = Phaser.Math.Clamp(t / RUN.bossTimeMs, 0, 1);
    let interval = Phaser.Math.Linear(1150, 330, progress);
    // Boss phase stays readable: ordinary immune traffic is reduced while IMMUNE PRIME is active.
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

    // 0:00–1:30: innate response / antibodies only. The first 45-second milestone increases
    // pressure through density, not by prematurely revealing the T-killer silhouette.
    if (t < 90_000) return 'swarm';

    // 1:30: T-killers join the hunt, matching the player-facing milestone exactly.
    if (t < 120_000) return r < 0.78 ? 'swarm' : 'runner';

    // 2:00+: macrophages enter as the adaptive response becomes visibly heavier.
    if (t < 180_000) return r < 0.6 ? 'swarm' : r < 0.9 ? 'runner' : 'brute';

    // Systemic response: all three ordinary immune roles are now established.
    return r < 0.48 ? 'swarm' : r < 0.79 ? 'runner' : 'brute';
  }

  private spawnOpeningAntibodies(): void {
    const p = this.scene.player;
    const layout = [
      { angle: -0.3, radius: 205 },
      { angle: 2.05, radius: 235 },
      { angle: 3.85, radius: 255 },
    ];
    for (const spot of layout) {
      this.scene.spawnEnemy(
        'swarm',
        p.x + Math.cos(spot.angle) * spot.radius,
        p.y + Math.sin(spot.angle) * spot.radius,
        false
      );
    }
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
