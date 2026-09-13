import Phaser from 'phaser';
import type { EnemyKind } from './config';
import type { StageDefinition } from './StageDefinitions';
import type { GameScene } from '../scenes/GameScene';

/** Owns only stage-local enemy composition; StageDirector owns lifecycle and boss timing. */
export class WaveDirector {
  boss: import('./Enemy').Enemy | null = null;

  private readonly scene: GameScene;
  private readonly enemies: Phaser.Physics.Arcade.Group;
  private stage: StageDefinition;
  private spawnAcc = 0;
  private spawnedElites = 0;
  private minionAcc = 0;

  constructor(
    scene: GameScene,
    enemies: Phaser.Physics.Arcade.Group,
    stage: StageDefinition
  ) {
    this.scene = scene;
    this.enemies = enemies;
    this.stage = stage;
  }

  startStage(stage: StageDefinition): void {
    this.stage = stage;
    this.spawnAcc = 0;
    this.spawnedElites = 0;
    this.minionAcc = 0;
    this.boss = null;
    this.spawnOpeningEnemies();
  }

  update(delta: number): void {
    const t = this.scene.runState.stage.timeMs;
    const waves = this.stage.waves;

    if (this.boss) {
      this.minionAcc += delta;
      if (this.minionAcc >= waves.bossMinionIntervalMs) {
        this.minionAcc = 0;
        const boss = this.boss;
        for (let i = 0; i < waves.bossMinionCount; i++) {
          const angle = (i / waves.bossMinionCount) * Math.PI * 2;
          this.scene.spawnEnemy(
            'swarm',
            boss.x + Math.cos(angle) * waves.bossMinionRadius,
            boss.y + Math.sin(angle) * waves.bossMinionRadius,
            false
          );
        }
      }
    }

    const expectedElites = waves.eliteEveryMs > 0 ? Math.floor(t / waves.eliteEveryMs) : 0;
    if (expectedElites > this.spawnedElites) {
      this.spawnedElites = expectedElites;
      const kind: EnemyKind = Phaser.Utils.Array.GetRandom([
        'swarm',
        'runner',
        'brute',
      ] as EnemyKind[]);
      this.spawn(kind, true);
    }

    const progress = Phaser.Math.Clamp(t / this.stage.durationMs, 0, 1);
    let interval = Phaser.Math.Linear(
      waves.spawnIntervalStartMs,
      waves.spawnIntervalEndMs,
      progress
    );
    if (this.boss) interval /= waves.bossPhaseSpawnMultiplier;
    this.spawnAcc += delta;
    while (this.spawnAcc >= interval) {
      this.spawnAcc -= interval;
      const batch = Math.min(waves.maxBatchSize, 1 + Math.floor(t / waves.batchEveryMs));
      for (let i = 0; i < batch; i++) this.spawn(waves.pickKind(t, Math.random()), false);
    }
  }

  spawnBoss(): import('./Enemy').Enemy | null {
    if (this.boss) return this.boss;
    const position = this.ringPos();
    this.boss = this.scene.spawnEnemy(
      this.stage.boss.enemyKind,
      position.x,
      position.y,
      false
    );
    return this.boss;
  }

  private spawnOpeningEnemies(): void {
    const player = this.scene.player;
    for (const spot of this.stage.waves.openingSpawns) {
      this.scene.spawnEnemy(
        spot.kind,
        player.x + Math.cos(spot.angle) * spot.radius,
        player.y + Math.sin(spot.angle) * spot.radius,
        false
      );
    }
  }

  private spawn(kind: EnemyKind, elite: boolean): void {
    if (!elite && this.enemies.countActive(true) >= this.stage.waves.normalEnemyCap) return;
    const position = this.ringPos();
    this.scene.spawnEnemy(kind, position.x, position.y, elite);
  }

  private ringPos(): { x: number; y: number } {
    const camera = this.scene.cameras.main;
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.max(camera.width, camera.height) / 2 + 90 + Math.random() * 60;
    return {
      x: camera.midPoint.x + Math.cos(angle) * radius,
      y: camera.midPoint.y + Math.sin(angle) * radius,
    };
  }
}
