import Phaser from 'phaser';
import { COLORS, ELITE, ENEMY_DEFS, K2_BEHAVIOR, type EnemyKind } from './config';
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
    opts: { elite: boolean; hpScale: number; dmgScale: number }
  ): void {
    this.gs = gs;
    this.target = gs.player;
    this.kind = kind;
    const def = ENEMY_DEFS[kind];
    const scale = def.scale * (opts.elite ? ELITE.scale : 1);

    this.enableBody(true, x, y, true, true);
    this.setTexture(def.tex).setScale(scale);
    this.isElite = opts.elite;
    this.isBoss = kind === 'boss';

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
    if (this.hp <= 0) {
      this.eliteRing?.setVisible(false);
      this.disableBody(true, true);
      this.gs?.onEnemyDied(this);
    }
  }
}
