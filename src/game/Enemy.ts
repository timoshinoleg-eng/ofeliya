import Phaser from 'phaser';
import {
  BOSS_SHARD,
  BOSS_TYPES,
  COLORS,
  ELITE,
  ENEMY_DEFS,
  K2_BEHAVIOR,
  K5_BEHAVIOR,
  type BossType,
  type EnemyDef,
  type EnemyKind,
} from './config';
import type { GameScene } from '../scenes/GameScene';
import type { Player } from './Player';

const KIND_COLOR: Record<EnemyKind, number> = {
  swarm: COLORS.magenta,
  runner: COLORS.orange,
  brute: COLORS.purple,
  boss: COLORS.red,
  splitter: COLORS.green,
  minion: COLORS.green,
  shield: 0x4f9dff,
  sniper: COLORS.purple,
  bomber: COLORS.orange,
  mine: 0xff5577,
};

export class Enemy extends Phaser.Physics.Arcade.Sprite {
  kind: EnemyKind = 'swarm';
  hp = 1;
  maxHp = 1;
  dmg = 1;
  xpValue = 0;
  speed = 0;
  radius = 12;
  isElite = false;
  isBoss = false;
  /** K4: тип босса (crown/orbital/splitter/shard); null — не босс. */
  bossType: BossType | 'shard' | null = null;
  color = 0xffffff;
  flashUntil = 0;
  bladeImmuneUntil = 0;
  /** K2: щит — направление «лица» (к игроку). null — не щит. */
  shieldFacing: { x: number; y: number } | null = null;
  /** K2: замедление (вортекс/ноу) до момента времени. */
  slowUntil = 0;

  private gs: GameScene | null = null;
  private target: Player | null = null;
  private knockX = 0;
  private knockY = 0;
  private eliteRing: Phaser.GameObjects.Image | null = null;
  /** K2: снайпер — таймер следующего выстрела. */
  private sniperNextShot = 0;
  /** K2: снайпер — направление стрейфа (+1/-1). */
  private strafeDir = 1;
  /** K4: орбитальная крепость — параметры (0 = не орбитальный). */
  private bossOrbitRadius = 0;
  private bossShardDmg = 0;
  private bossBurstEvery = 0;
  private bossBurstAt = 0;
  private bossShardAngle = 0;
  /** K4: разделение босса выполнено (раскол в 50% HP). */
  private splitDone = false;
  /** K5: базовый масштаб (для пульса мины). */
  private baseScale = 1;
  /** K5: время появления мины (авто-сгорание, чтобы не копить поле). */
  private mineSpawnAt = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'enemy-swarm');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(10);
  }

  activate(
    gs: GameScene,
    kind: EnemyKind,
    x: number,
    y: number,
    opts: { elite: boolean; hpScale: number; dmgScale: number; bossType?: BossType | 'shard' }
  ): void {
    this.gs = gs;
    this.target = gs.player;
    this.kind = kind;
    // K4: босс — параметры по типу (crown/orbital/splitter), осколок — BOSS_SHARD.
    const bossType: BossType | 'shard' | null = kind === 'boss' ? (opts.bossType ?? 'crown') : null;
    const bd = bossType === 'shard' ? null : bossType ? BOSS_TYPES[bossType] : null;
    const def: EnemyDef =
      bossType === 'shard'
        ? {
            tex: BOSS_SHARD.tex,
            hp: BOSS_SHARD.hp,
            speed: BOSS_SHARD.speed,
            dmg: BOSS_SHARD.dmg,
            xp: 0,
            scale: 1,
            radius: BOSS_SHARD.radius,
          }
        : bd
          ? { tex: bd.tex, hp: bd.hp, speed: bd.speed, dmg: bd.dmg, xp: 0, scale: 1, radius: bd.radius }
          : ENEMY_DEFS[kind];
    this.bossOrbitRadius = bd?.orbitRadius ?? 0;
    this.bossShardDmg = bd?.shardDmg ?? 0;
    this.bossBurstEvery = bd?.burstEveryMs ?? 0;
    const scale = def.scale * (opts.elite ? ELITE.scale : 1);
    this.baseScale = scale;

    this.enableBody(true, x, y, true, true);
    this.setTexture(def.tex).setScale(scale);
    this.isElite = opts.elite;
    this.isBoss = kind === 'boss';
    this.bossType = bossType;

    this.maxHp = def.hp * opts.hpScale * (opts.elite ? ELITE.hpMul : 1);
    this.hp = this.maxHp;
    this.dmg = def.dmg * opts.dmgScale * (opts.elite ? ELITE.dmgMul : 1);
    this.xpValue = def.xp * (opts.elite ? ELITE.xpMul : 1);
    this.speed = def.speed * (opts.elite ? 0.92 : 1);
    this.radius = def.radius * scale;
    this.color = opts.elite ? COLORS.gold : KIND_COLOR[kind];

    this.flashUntil = 0;
    this.bladeImmuneUntil = 0;
    this.knockX = 0;
    this.knockY = 0;
    // K2: сброс поведенческих полей при повторном использовании из пула.
    this.shieldFacing = kind === 'shield' ? { x: 1, y: 0 } : null;
    this.slowUntil = 0;
    this.sniperNextShot =
      kind === 'sniper' ? this.scene.time.now + 900 + gs.runState.rng.next() * 900 : 0;
    this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    // K4: сброс босс-поведения.
    this.splitDone = false;
    this.bossBurstAt = this.scene.time.now + (this.bossBurstEvery ? 2500 : 0);
    this.bossShardAngle = 0;
    // K5: отсчёт жизни мины.
    this.mineSpawnAt = this.scene.time.now;
    this.setAlpha(1);
    this.clearTint();
    this.setRotation(0);

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setCircle(def.radius, this.width / 2 - def.radius, this.height / 2 - def.radius);

    if (opts.elite) {
      if (!this.eliteRing) {
        this.eliteRing = this.scene.add
          .image(x, y, 'elite-ring')
          .setDepth(9)
          .setBlendMode(Phaser.BlendModes.ADD);
      }
      this.eliteRing
        .setVisible(true)
        .setAlpha(0.82)
        .setPosition(x, y)
        .setScale(def.scale)
        .setRotation(0);
    } else {
      this.eliteRing?.setVisible(false);
    }
  }

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    if (!this.active || !this.target) {
      this.eliteRing?.setVisible(false);
      return;
    }

    if (time < this.flashUntil) this.setTintFill(0xffffff);
    else if (this.tintFill) this.clearTint();

    const p = this.target;
    const dx = p.x - this.x;
    const dy = p.y - this.y;
    const d = Math.hypot(dx, dy) || 1;

    // K2: щит всегда «лицом» к игроку (+X текстуры = направление атаки).
    if (this.kind === 'shield') {
      this.shieldFacing = { x: dx / d, y: dy / d };
      this.setRotation(Math.atan2(dy, dx));
    }

    // K2: снайпер держит дистанцию в полосе, иначе приближается/отходит;
    // в полосе — стрейф. Выстрел раз в ~2.2 с (jitter не рушит daily-сид:
    // он влияет только на тайминг, не на состав волн).
    if (this.kind === 'sniper') {
      const B = K2_BEHAVIOR;
      let vx: number;
      let vy: number;
      if (d < B.sniperMinDist) {
        vx = -dx / d;
        vy = -dy / d;
      } else if (d > B.sniperMaxDist) {
        vx = dx / d;
        vy = dy / d;
      } else {
        // периодически сменить сторону стрейфа, чтобы не рисовать окружность
        if (Math.random() < 0.004) this.strafeDir *= -1;
        vx = (-dy / d) * this.strafeDir;
        vy = (dx / d) * this.strafeDir;
      }
      this.setRotation(Math.atan2(dy, dx));
      if (time >= this.sniperNextShot && d > B.sniperMinShotDist && d < 520) {
        this.sniperNextShot =
          time + B.sniperShotIntervalMs + Math.random() * B.sniperShotJitterMs;
        this.gs?.foeShoot(this.x, this.y, Math.atan2(dy, dx));
      }
      (this.body as Phaser.Physics.Arcade.Body).setVelocity(
        vx * this.speed + this.knockX,
        vy * this.speed + this.knockY
      );
      this.knockX *= 0.82;
      this.knockY *= 0.82;
      this.updateEliteRing(time);
      return;
    }

    // К2: замедление (вортекс в K3): множитель 0.55 скорости.
    const speedMul = time < this.slowUntil ? 0.55 : 1;
    (this.body as Phaser.Physics.Arcade.Body).setVelocity(
      (dx / d) * this.speed * speedMul + this.knockX,
      (dy / d) * this.speed * speedMul + this.knockY
    );
    this.knockX *= 0.82;
    this.knockY *= 0.82;

    if (this.kind === 'runner') this.setRotation(Math.atan2(dy, dx));

    // K5: мина — неподвижна (speed 0), детонирует при сближении; чем ближе
    // игрок, тем сильнее пульс «сдетонирует» (визуальная подсказка).
    if (this.kind === 'mine' && p) {
      if (time - this.mineSpawnAt > 25000) {
        this.disableBody(true, true); // фатиг: мина «разряжается» тихо
      } else if (d < K5_BEHAVIOR.mineTriggerDist) {
        this.takeDamage(999999); // смерть → onEnemyDied → взрыв
      } else {
        const prox = Phaser.Math.Clamp(1 - d / (K5_BEHAVIOR.mineTriggerDist * 3), 0, 1);
        const pulse = 1 + 0.2 * prox * (0.6 + 0.4 * Math.sin(this.scene.time.now / 80));
        this.setScale(this.baseScale * pulse);
      }
    }

    // K4: орбитальная крепость — два клинка по окружности + радиальный залп.
    if (this.isBoss && this.bossOrbitRadius > 0) {
      this.ensureBossBlades();
      this.bossShardAngle += delta * 0.0016;
      const p = this.target;
      for (let i = 0; i < 2; i++) {
        const blade = this.bossBlades[i];
        if (!blade) continue;
        const a = this.bossShardAngle + i * Math.PI;
        const bx = this.x + Math.cos(a) * this.bossOrbitRadius;
        const by = this.y + Math.sin(a) * this.bossOrbitRadius;
        blade.setPosition(bx, by).setRotation(a + Math.PI / 2);
        if (p && Math.hypot(p.x - bx, p.y - by) < 13 + 11 && p.hurtUntil < time) {
          this.gs?.applyPlayerDamage(this.bossShardDmg);
        }
      }
      if (this.bossBurstEvery > 0 && time >= this.bossBurstAt) {
        this.bossBurstAt = time + this.bossBurstEvery;
        this.gs?.foeBurst(this.x, this.y, 8);
      }
    }

    this.updateEliteRing(time);
  }

  private updateEliteRing(time: number): void {
    if (this.isElite && this.eliteRing) {
      this.eliteRing
        .setVisible(true)
        .setPosition(this.x, this.y)
        .setRotation(-time * 0.00115)
        .setAlpha(0.72 + Math.sin(time / 180) * 0.16);
    }
  }

  /**
   * урон. K2: fromDir — направление атаки (нормализованное). Для щитона:
   * атака «в лицо» (dot > K2_BEHAVIOR.shieldDot) даёт только
   * shieldFrontDmgMul урона; клинки/нова зовут без fromDir → полный урон.
   */
  takeDamage(
    amount: number,
    kx = 0,
    ky = 0,
    fromDir: { x: number; y: number } | null = null
  ): void {
    if (!this.active) return;
    if (this.kind === 'shield' && this.shieldFacing && fromDir) {
      const dot = this.shieldFacing.x * fromDir.x + this.shieldFacing.y * fromDir.y;
      if (dot > K2_BEHAVIOR.shieldDot) amount *= K2_BEHAVIOR.shieldFrontDmgMul;
    }
    this.hp -= amount;
    this.flashUntil = this.scene.time.now + 70;
    this.knockX += kx;
    this.knockY += ky;
    // K4: «Разделяющее ядро» раскалывается на 50% HP (однократно, пока живо).
    if (
      this.isBoss &&
      this.bossType === 'splitter' &&
      !this.splitDone &&
      this.hp > 0 &&
      this.hp <= this.maxHp * 0.5
    ) {
      this.splitDone = true;
      this.speed = 0; // сам «труп» угрозы больше не несёт
      this.dmg = 0;
      this.gs?.onBossSplit(this);
    }
    if (this.hp <= 0) {
      this.eliteRing?.setVisible(false);
      this.destroyBossBlades();
      this.disableBody(true, true);
      this.gs?.onEnemyDied(this);
    }
  }

  /** K4: клинки орбитальной крепости (визуал + источник урона). */
  private bossBlades: Phaser.GameObjects.Image[] = [];

  private ensureBossBlades(): void {
    if (this.bossBlades.length > 0 || this.bossOrbitRadius <= 0) return;
    for (let i = 0; i < 2; i++) {
      this.bossBlades.push(
        this.scene.add.image(this.x, this.y, 'blade').setDepth(11).setBlendMode(Phaser.BlendModes.ADD)
      );
    }
  }

  private destroyBossBlades(): void {
    for (const b of this.bossBlades) b.destroy();
    this.bossBlades = [];
  }
}
