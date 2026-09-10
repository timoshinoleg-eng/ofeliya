import Phaser from 'phaser';
import { RUN, type BossType, type EnemyKind } from './config';
import { RunMilestones } from './RunMilestones';
import type { Rng } from './SeededRng';
import type { GameScene } from '../scenes/GameScene';
import type { Enemy } from './Enemy';

/** Управляет темпом и составом волн врагов, элитами и боссом. */
export class WaveDirector {
  boss: Enemy | null = null;
  /** K4: тип босса текущего забега (seeded). */
  bossType: BossType = 'crown';
  /** K4: осколки расколовшегося босса (победа = последний погиб). */
  bossParts: Enemy[] = [];

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
  }

  update(delta: number): void {
    const t = this.scene.runState.timeMs;

    // Presentation observer only: не меняет spawn/difficulty contracts.
    this.milestones.update(t);

    if (!this.bossSpawned && t >= RUN.bossTimeMs) this.spawnBoss();

    // K4: после раскола босс-«мина» (boss=null) миньоны больше не зовёт —
    // бой уже идёт с осколками, не надо усложнять.
    if (this.boss && this.bossParts.length === 0) {
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
      // K2: после 4 мин элита может быть сплиттером/щитоном (больше фактур).
      const pool =
        t >= 240000
          ? (['swarm', 'runner', 'brute', 'splitter', 'shield'] as const)
          : (['swarm', 'runner', 'brute'] as const);
      const kind: EnemyKind = this.rng.pick(pool);
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

  private get rng(): Rng {
    return this.scene.runState.rng;
  }

  private pickKind(t: number): EnemyKind {
    const r = this.rng.next();
    if (t < 45000) return 'swarm';
    if (t < 90000) return r < 0.8 ? 'swarm' : 'runner';
    // K2: с 1.5 мин в ротацию входит сплиттер (взрыв на миньонов).
    if (t < 180000) return r < 0.55 ? 'swarm' : r < 0.85 ? 'runner' : 'splitter';
    // K2/K5: с 3 мин — щитоны, с ~3 мин в ротации и бомбёр (взрыв при смерти).
    if (t < 300000) {
      return r < 0.42 ? 'swarm' : r < 0.64 ? 'runner' : r < 0.8 ? 'brute' : r < 0.92 ? 'splitter' : 'bomber';
    }
    // K2/K5: с 5 мин — снайперы, мины (неподвижная угроза) + вся ротация.
    return r < 0.28 ? 'swarm'
      : r < 0.46 ? 'runner'
      : r < 0.6 ? 'brute'
      : r < 0.72 ? 'splitter'
      : r < 0.82 ? 'shield'
      : r < 0.9 ? 'sniper'
      : r < 0.96 ? 'bomber'
      : 'mine';
  }

  private spawn(kind: EnemyKind, elite: boolean): void {
    if (!elite && this.enemies.countActive(true) >= 240) return;
    const p = this.ringPos();
    this.scene.spawnEnemy(kind, p.x, p.y, elite);
  }

  private spawnBoss(): void {
    this.bossSpawned = true;
    // K4: тип босса — seeded (daily: все получают одного и того же).
    this.bossType = this.rng.pick(['crown', 'orbital', 'splitter'] as const);
    const p = this.ringPos();
    this.boss = this.scene.spawnEnemy('boss', p.x, p.y, false, this.bossType);
  }

  /**
   * K4: раскол «Разделяющего ядра» (50% HP). Оригинал убирается (взрыв
   * отрисовал GameScene), появляются 2 осколка; победа — когда оба погибли
   * (см. onEnemyDied).
   */
  splitBoss(boss: Enemy): void {
    if (this.bossParts.length > 0) return;
    this.bossParts = [];
    for (const off of [-46, 46]) {
      const s = this.scene.spawnEnemy('boss', boss.x + off, boss.y, false, 'shard');
      if (s) this.bossParts.push(s);
    }
    // Оригинальное ядро «тратится» на раскол: убиваем без награды/лоута.
    this.boss = null;
    boss.disableBody(true, true);
  }

  private ringPos(): { x: number; y: number } {
    const cam = this.scene.cameras.main;
    const a = this.rng.next() * Math.PI * 2;
    const r = Math.max(cam.width, cam.height) / 2 + 90 + this.rng.next() * 60;
    return { x: cam.midPoint.x + Math.cos(a) * r, y: cam.midPoint.y + Math.sin(a) * r };
  }
}
