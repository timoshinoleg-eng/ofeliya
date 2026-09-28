import Phaser from 'phaser';
import type { EnemyKind } from './config';
import type { StageDefinition } from './StageDefinitions';
import type { DifficultyProfile } from './DifficultyProfile';
import type { GameScene } from '../scenes/GameScene';
import {
  ThreatDirector,
  type ThreatAssessment,
  type ThreatDirectorSnapshot,
  type ThreatPacingDirective,
} from './ThreatDirector';

export interface WaveDirectorSnapshot {
  spawnAcc: number;
  spawnedElites: number;
  minionAcc: number;
  /** Optional for backwards-compatible checkpoints created before adaptive threat pacing. */
  threat?: ThreatDirectorSnapshot;
  threatAccMs?: number;
}

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
  private readonly threat = new ThreatDirector();
  private threatAccMs = 0;
  private threatAssessment: ThreatAssessment = this.threat.current;
  private readonly adaptivePacingEnabled: boolean;

  constructor(
    scene: GameScene,
    enemies: Phaser.Physics.Arcade.Group,
    stage: StageDefinition,
    difficulty: DifficultyProfile,
    randomKind: () => number,
    randomSpawn: () => number,
    adaptivePacingEnabled = false
  ) {
    this.scene = scene;
    this.enemies = enemies;
    this.stage = stage;
    this.difficulty = difficulty;
    this.randomKind = randomKind;
    this.randomSpawn = randomSpawn;
    this.adaptivePacingEnabled = adaptivePacingEnabled;
  }

  startStage(stage: StageDefinition): void {
    this.stage = stage;
    this.spawnAcc = 0;
    this.spawnedElites = 0;
    this.minionAcc = 0;
    this.boss = null;
    this.threatAccMs = 0;
    this.threat.reset(this.scene.runState.stage.timeMs);
    this.threatAssessment = this.threat.current;
    this.spawnOpeningEnemies();
  }

  update(delta: number): void {
    const t = this.scene.runState.stage.timeMs;
    const waves = this.stage.waves;
    this.updateAdaptiveThreat(delta);

    if (this.boss) {
      this.minionAcc += delta;
      const minionInterval =
        waves.bossMinionIntervalMs *
        this.difficulty.bossMinionIntervalMultiplier *
        this.pacingDirective.bossMinionIntervalMultiplier;
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
    if (
      expectedElites > this.spawnedElites &&
      this.pacingDirective.allowDangerousCombinations
    ) {
      // Skip backlog rather than burst-spawning deferred elites after a recovery window.
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
    interval *= this.pacingDirective.spawnIntervalMultiplier;
    if (this.boss) interval /= waves.bossPhaseSpawnMultiplier;
    this.spawnAcc += delta;
    while (this.spawnAcc >= interval) {
      this.spawnAcc -= interval;
      const authoredBatch = Math.min(
        waves.maxBatchSize + this.difficulty.batchBonus,
        1 + Math.floor(t / waves.batchEveryMs) + this.difficulty.batchBonus
      );
      const batch = Math.max(
        1,
        Math.floor(authoredBatch * this.pacingDirective.batchScale)
      );
      for (let i = 0; i < batch; i++) this.spawn(waves.pickKind(t, this.randomKind()), false);
    }
  }

  snapshot(): WaveDirectorSnapshot {
    return {
      spawnAcc: this.spawnAcc,
      spawnedElites: this.spawnedElites,
      minionAcc: this.minionAcc,
      threat: this.threat.snapshot(this.scene.runState.stage.timeMs),
      threatAccMs: this.threatAccMs,
    };
  }

  restore(stage: StageDefinition, snapshot: WaveDirectorSnapshot): void {
    this.stage = stage;
    this.spawnAcc = snapshot.spawnAcc;
    this.spawnedElites = snapshot.spawnedElites;
    this.minionAcc = snapshot.minionAcc;
    this.threatAccMs = Math.max(0, snapshot.threatAccMs ?? 0);
    this.threat.restore(snapshot.threat, this.scene.runState.stage.timeMs);
    this.threatAssessment = this.threat.current;
    this.boss = null;
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


  private get pacingDirective(): ThreatPacingDirective {
    if (this.adaptivePacingEnabled) return this.threatAssessment.directive;
    return {
      spawnIntervalMultiplier: 1,
      bossMinionIntervalMultiplier: 1,
      batchScale: 1,
      allowDangerousCombinations: true,
      recoveryWindowMs: 0,
    };
  }

  recordPlayerDamage(damage: number, maxHp: number): void {
    this.threat.recordDamage(damage, maxHp, this.scene.runState.stage.timeMs);
  }

  get debugAdaptiveThreatState(): ThreatAssessment {
    return this.threatAssessment;
  }

  private updateAdaptiveThreat(delta: number): void {
    this.threatAccMs += Math.max(0, delta);
    if (this.threatAccMs < 120) return;
    this.threatAccMs = 0;

    const player = this.scene.player;
    const scanRadius = 280;
    const escapeRadius = 220;
    const sectorCount = 8;
    let nearbyWeight = 0;
    let eliteWeight = 0;
    const blocked = new Array<boolean>(sectorCount).fill(false);

    for (const enemy of this.enemies.getChildren() as import('./Enemy').Enemy[]) {
      if (!enemy.active) continue;
      const dx = enemy.x - player.x;
      const dy = enemy.y - player.y;
      const distance = Math.hypot(dx, dy);

      if (!enemy.isBoss && distance < scanRadius) {
        const proximity = 1 - distance / scanRadius;
        const cost = this.threatCost(enemy.kind, enemy.isElite);
        nearbyWeight += cost * proximity;
        if (enemy.isElite) eliteWeight += proximity;
      }

      if (distance < escapeRadius) {
        const angle = Math.atan2(dy, dx) + Math.PI;
        const normalized = (angle % (Math.PI * 2)) / (Math.PI * 2);
        const sector = Math.min(sectorCount - 1, Math.floor(normalized * sectorCount));
        blocked[sector] = true;
        if (distance < 120) {
          blocked[(sector + sectorCount - 1) % sectorCount] = true;
          blocked[(sector + 1) % sectorCount] = true;
        }
      }
    }

    const boss = this.boss;
    const bossPhase01 = boss && boss.active ? (boss.bossPhase >= 2 ? 1 : 0.55) : 0;
    const st = this.scene.runState.stage;
    this.threatAssessment = this.threat.update(
      {
        nearbyPressure01: Phaser.Math.Clamp(nearbyWeight / 12, 0, 1),
        hpFraction: st.maxHp > 0 ? Phaser.Math.Clamp(st.hp / st.maxHp, 0, 1) : 1,
        escapeSpaceRatio: 1 - blocked.filter(Boolean).length / sectorCount,
        elitePressure01: Phaser.Math.Clamp(eliteWeight / 2, 0, 1),
        bossPhase01,
      },
      st.timeMs
    );
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
