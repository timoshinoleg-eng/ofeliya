import Phaser from 'phaser';
import type { EnemyKind } from './config';
import type { StageDefinition } from './StageDefinitions';
import type { DifficultyProfile } from './DifficultyProfile';
import type { GameScene } from '../scenes/GameScene';

/** Owns only stage-local enemy composition; StageDirector owns lifecycle and boss timing. */
export class WaveDirector {
  boss: import('./Enemy').Enemy | null = null;

  private readonly scene: GameScene;
  private readonly enemies: Phaser.Physics.Arcade.Group;
  private stage: StageDefinition;
  private readonly difficulty: DifficultyProfile;
  private spawnAcc = 0;
  private spawnedElites = 0;
  private minionAcc = 0;
  private readonly randomKind: () => number;
  private readonly randomSpawn: () => number;

  constructor(
    scene: GameScene,
    enemies: Phaser.Physics.Arcade.Group,
    stage: StageDefinition,
    difficulty: DifficultyProfile,
    randomKind: () => number = Math.random,
    randomSpawn: () => number = Math.random
  ) {
    this.scene = scene;
    this.enemies = enemies;
    this.stage = stage;
    this.difficulty = difficulty;
    this.randomKind = randomKind;
    this.randomSpawn = randomSpawn;
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
      const minionInterval = waves.bossMinionIntervalMs * this.difficulty.bossMinionIntervalMultiplier;
      if (this.minionAcc >= minionInterval) {
        this.minionAcc = 0;
        const boss = this.boss;
        const count = waves.bossMinionCount + this.difficulty.bossMinionBonus;
        for (let i = 0; i < count; i++) {
          if (!this.canAddThreat('swarm', false, t)) break;
          const angle = (i / count) * Math.PI * 2;
          this.scene.spawnEnemy(
            'swarm',
            boss.x + Math.cos(angle) * waves.bossMinionRadius,
            boss.y + Math.sin(angle) * waves.bossMinionRadius,
            false
          );
        }
      }
    }

    const eliteEveryMs = waves.eliteEveryMs * this.difficulty.eliteIntervalMultiplier;
    const expectedElites = eliteEveryMs > 0 ? Math.floor(t / eliteEveryMs) : 0;
    if (expectedElites > this.spawnedElites) {
      this.spawnedElites = expectedElites;
      const eliteKinds: EnemyKind[] = ['swarm', 'runner', 'brute'];
      const kind = eliteKinds[Math.floor(this.randomKind() * eliteKinds.length)] ?? 'swarm';
      this.spawn(kind, true);
    }

    const progress = Phaser.Math.Clamp(t / this.stage.durationMs, 0, 1);
    let interval = Phaser.Math.Linear(
      waves.spawnIntervalStartMs,
      waves.spawnIntervalEndMs,
      progress
    );
    interval *= this.difficulty.spawnIntervalMultiplier;
    if (this.boss) interval /= waves.bossPhaseSpawnMultiplier;
    this.spawnAcc += delta;
    while (this.spawnAcc >= interval) {
      this.spawnAcc -= interval;
      const batch = Math.min(
        waves.maxBatchSize + this.difficulty.batchBonus,
        1 + Math.floor(t / waves.batchEveryMs) + this.difficulty.batchBonus
      );
      for (let i = 0; i < batch; i++) this.spawn(waves.pickKind(t, this.randomKind()), false);
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
    const cap = this.stage.waves.normalEnemyCap + this.difficulty.normalEnemyCapBonus;
    if (!elite && this.enemies.countActive(true) >= cap) return;
    if (!elite && !this.canAddThreat(kind, false, this.scene.runState.stage.timeMs)) {
      const fallback: Exclude<EnemyKind, 'boss'>[] =
        kind === 'brute' ? ['runner', 'swarm'] : kind === 'runner' ? ['swarm'] : [];
      const next = fallback.find((candidate) =>
        this.canAddThreat(candidate, false, this.scene.runState.stage.timeMs)
      );
      if (!next) return;
      kind = next;
    }
    const position = this.ringPos();
    this.scene.spawnEnemy(kind, position.x, position.y, elite);
  }

  private canAddThreat(kind: EnemyKind, elite: boolean, stageTimeMs: number): boolean {
    if (this.difficulty.threatCapStart === null || this.difficulty.threatCapEnd === null) return true;
    if (elite || kind === 'boss') return true;
    const progress = Phaser.Math.Clamp(stageTimeMs / this.stage.durationMs, 0, 1);
    const cap = Phaser.Math.Linear(
      this.difficulty.threatCapStart,
      this.difficulty.threatCapEnd,
      progress
    );
    return this.activeThreat() + this.threatCost(kind, elite) <= cap;
  }

  private activeThreat(): number {
    let total = 0;
    for (const enemy of this.enemies.getChildren() as import('./Enemy').Enemy[]) {
      if (!enemy.active || enemy.isBoss) continue;
      total += this.threatCost(enemy.kind, enemy.isElite);
    }
    return total;
  }

  private threatCost(kind: EnemyKind, elite: boolean): number {
    const base = kind === 'brute' ? 3 : kind === 'runner' ? 1.5 : kind === 'boss' ? 0 : 1;
    return base + (elite ? 7 : 0);
  }

  get debugThreatState(): { active: number; cap: number | null } {
    if (this.difficulty.threatCapStart === null || this.difficulty.threatCapEnd === null) {
      return { active: this.activeThreat(), cap: null };
    }
    const progress = Phaser.Math.Clamp(
      this.scene.runState.stage.timeMs / this.stage.durationMs,
      0,
      1
    );
    return {
      active: this.activeThreat(),
      cap: Phaser.Math.Linear(
        this.difficulty.threatCapStart,
        this.difficulty.threatCapEnd,
        progress
      ),
    };
  }

  private ringPos(): { x: number; y: number } {
    const camera = this.scene.cameras.main;
    const angle = this.randomSpawn() * Math.PI * 2;
    const radius =
      Math.max(camera.width, camera.height) / 2 + 90 + this.randomSpawn() * 60;
    return {
      x: camera.midPoint.x + Math.cos(angle) * radius,
      y: camera.midPoint.y + Math.sin(angle) * radius,
    };
  }
}
