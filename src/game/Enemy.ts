import Phaser from 'phaser';
import { COLORS, ELITE, ENEMY_DEFS, type EnemyKind } from './config';
import type { GameScene } from '../scenes/GameScene';
import type { Player } from './Player';
import type { StageBossBehavior } from './StageDefinitions';

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
  spawnSerial = 0;

  private gs: GameScene | null = null;
  private target: Player | null = null;
  private knockX = 0;
  private knockY = 0;
  private eliteRing: Phaser.GameObjects.Graphics | null = null;
  private eliteMarker: Phaser.GameObjects.Triangle | null = null;
  private bossAura: Phaser.GameObjects.Graphics | null = null;
  private bossBehavior: StageBossBehavior = 'pressure-wave';
  private heartbeatMs = 0;
  private visualScale = 1;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'immune-antibody');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(10);
  }

  activate(
    gs: GameScene,
    kind: EnemyKind,
    x: number,
    y: number,
    opts: { elite: boolean; hpScale: number; dmgScale: number; textureKey?: string; color?: number; bossBehavior?: StageBossBehavior; heartbeatMs?: number }
  ): void {
    this.gs = gs;
    this.target = gs.player;
    this.kind = kind;
    const def = ENEMY_DEFS[kind];
    const scale = def.scale * (opts.elite ? ELITE.scale : 1);
    this.visualScale = scale;
    this.spawnSerial += 1;

    this.enableBody(true, x, y, true, true);
    this.setTexture(opts.textureKey ?? def.tex).setScale(scale);
    this.isElite = opts.elite;
    this.isBoss = kind === 'boss';
    this.bossBehavior = opts.bossBehavior ?? 'pressure-wave';
    this.heartbeatMs = Math.max(0, opts.heartbeatMs ?? 0);

    this.maxHp = def.hp * opts.hpScale * (opts.elite ? ELITE.hpMul : 1);
    this.hp = this.maxHp;
    this.dmg = def.dmg * opts.dmgScale * (opts.elite ? ELITE.dmgMul : 1);
    this.xpValue = def.xp * (opts.elite ? ELITE.xpMul : 1);
    this.speed = def.speed * (opts.elite ? 0.92 : 1);
    this.radius = def.radius * scale;
    this.color = opts.elite
      ? COLORS.gold
      : kind === 'boss'
        ? (opts.color ?? COLORS.cyan)
        : kind === 'swarm'
          ? COLORS.white
          : kind === 'runner'
            ? COLORS.cyan
            : 0xffd6a1;

    this.flashUntil = 0;
    this.bladeImmuneUntil = 0;
    this.knockX = 0;
    this.knockY = 0;
    this.setAlpha(1);
    this.clearTint();
    this.setRotation(0);

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setCircle(def.radius, this.width / 2 - def.radius, this.height / 2 - def.radius);

    if (opts.elite) {
      if (!this.eliteRing) this.eliteRing = this.scene.add.graphics().setDepth(9);
      if (!this.eliteMarker) {
        this.eliteMarker = this.scene.add
          .triangle(0, 0, 0, 8, 6, 0, 12, 8, COLORS.gold, 0.96)
          .setOrigin(0.5, 1)
          .setStrokeStyle(1, COLORS.white, 0.78)
          .setDepth(12);
      }
      this.drawEliteCorona(this.eliteRing, Math.max(24, def.radius * scale + 12));
      this.eliteRing.setVisible(true).setPosition(x, y).setRotation(0).setAlpha(0.78);
      this.eliteMarker.setVisible(true).setPosition(x, y - this.radius - 10).setScale(1);
    } else {
      this.eliteRing?.setVisible(false);
      this.eliteMarker?.setVisible(false);
    }

    if (this.isBoss && this.bossBehavior === 'heartbeat-pulse') {
      if (!this.bossAura) this.bossAura = this.scene.add.graphics().setDepth(9);
      this.drawCardiacAura(this.bossAura, Math.max(68, this.radius + 42), this.color);
      this.bossAura
        .setVisible(true)
        .setPosition(x, y)
        .setAlpha(0.88)
        .setBlendMode(Phaser.BlendModes.ADD);
    } else {
      this.bossAura?.setVisible(false);
    }
  }

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    if (!this.active || !this.target) {
      this.eliteRing?.setVisible(false);
      this.eliteMarker?.setVisible(false);
      this.bossAura?.setVisible(false);
      return;
    }

    if (time < this.flashUntil) this.setTintFill(0xffffff);
    else if (this.tintFill) this.clearTint();

    const p = this.target;
    const dx = p.x - this.x;
    const dy = p.y - this.y;
    const d = Math.hypot(dx, dy) || 1;
    const pressure = this.gs?.getEnemyPressureMultiplier() ?? 1;
    const forwardSpeed = this.speed * pressure;
    let velocityX = (dx / d) * forwardSpeed + this.knockX;
    let velocityY = (dy / d) * forwardSpeed + this.knockY;
    if (this.isBoss && this.bossBehavior === 'heartbeat-pulse') {
      const lateral = Math.sin(time * 0.0026) * this.speed * 0.34;
      velocityX = (dx / d) * forwardSpeed * 0.9 + (-dy / d) * lateral + this.knockX;
      velocityY = (dy / d) * forwardSpeed * 0.9 + (dx / d) * lateral + this.knockY;
    }
    (this.body as Phaser.Physics.Arcade.Body).setVelocity(velocityX, velocityY);
    this.knockX *= 0.82;
    this.knockY *= 0.82;

    // Role motion is a second readability channel after silhouette:
    // antibody = drifting Y, T-killer = locked charge, macrophage = heavy membrane wobble.
    if (this.kind === 'runner') {
      this.setRotation(Math.atan2(dy, dx));
      const charge = 1 + Math.sin(time * 0.012 + this.y * 0.01) * 0.035;
      this.setScale(this.visualScale * charge, this.visualScale * (2 - charge));
    } else if (this.kind === 'brute') {
      this.setRotation(Math.sin(time * 0.0012 + this.x * 0.01) * 0.1);
      const wobble = 1 + Math.sin(time * 0.003 + this.x * 0.008) * 0.025;
      this.setScale(this.visualScale * wobble, this.visualScale / wobble);
    } else if (this.kind === 'swarm') {
      this.setRotation(Math.atan2(dy, dx) + Math.PI / 2 + Math.sin(time * 0.003 + this.x) * 0.06);
      this.setScale(this.visualScale);
    } else {
      if (this.bossBehavior === 'heartbeat-pulse' && this.heartbeatMs > 0) {
        const phase = (time % this.heartbeatMs) / this.heartbeatMs;
        const secondBeat = phase >= 0.22 ? Math.exp(-(phase - 0.22) * 20) * 0.55 : 0;
        const doubleBeat = Math.max(Math.exp(-phase * 15), secondBeat);
        this.setRotation(Math.sin(time * 0.0012) * 0.11);
        this.setScale(this.visualScale * (1 + doubleBeat * 0.085));
      } else {
        this.setRotation(Math.sin(time * 0.0007) * 0.06);
        const bossPulse = 1 + Math.sin(time * 0.0032) * 0.018;
        this.setScale(this.visualScale * bossPulse);
      }
    }

    if (this.isElite && this.eliteRing) {
      this.eliteRing
        .setVisible(true)
        .setPosition(this.x, this.y)
        .setRotation(-time * 0.00105)
        .setScale(0.96 + Math.sin(time / 180) * 0.055)
        .setAlpha(0.58 + Math.sin(time / 180) * 0.15);
      this.eliteMarker
        ?.setVisible(true)
        .setPosition(this.x, this.y - this.radius - 10)
        .setScale(0.92 + Math.sin(time / 130) * 0.12)
        .setAlpha(0.78 + Math.sin(time / 130) * 0.18);
    }

    if (this.isBoss && this.bossBehavior === 'heartbeat-pulse' && this.bossAura) {
      const phase = this.heartbeatMs > 0 ? (time % this.heartbeatMs) / this.heartbeatMs : 0;
      const secondBeat = phase >= 0.22 ? Math.exp(-(phase - 0.22) * 20) * 0.55 : 0;
      const beat = Math.max(Math.exp(-phase * 15), secondBeat);
      this.bossAura
        .setVisible(true)
        .setPosition(this.x, this.y)
        .setRotation(time * 0.0008)
        .setScale(0.98 + beat * 0.16)
        .setAlpha(0.62 + beat * 0.28);
    }
  }

  /** Hide pooled enemy presentation before the object is reused by another stage. */
  deactivateForStageReset(): void {
    this.eliteRing?.setVisible(false);
    this.eliteMarker?.setVisible(false);
    this.bossAura?.setVisible(false);
    this.target = null;
    this.gs = null;
    this.knockX = 0;
    this.knockY = 0;
    this.clearTint();
    this.disableBody(true, true);
  }

  applyKnock(kx: number, ky: number): void {
    if (!this.active) return;
    this.knockX += kx;
    this.knockY += ky;
  }

  takeDamage(amount: number, kx = 0, ky = 0): void {
    if (!this.active) return;
    this.hp -= amount;
    this.flashUntil = this.scene.time.now + 70;
    this.knockX += kx;
    this.knockY += ky;
    if (this.hp <= 0) {
      this.eliteRing?.setVisible(false);
      this.eliteMarker?.setVisible(false);
      this.bossAura?.setVisible(false);
      this.disableBody(true, true);
      this.gs?.onEnemyDied(this);
    }
  }

  private drawCardiacAura(g: Phaser.GameObjects.Graphics, radius: number, color: number): void {
    g.clear();
    g.lineStyle(4.5, color, 0.92);
    for (const offset of [0, Math.PI]) {
      g.beginPath();
      g.arc(0, 0, radius, offset - 0.98, offset + 0.98, false);
      g.strokePath();
    }
    g.lineStyle(2.2, COLORS.white, 0.5);
    g.strokeCircle(0, 0, radius + 12);
    g.lineStyle(1.4, color, 0.42);
    g.strokeCircle(0, 0, radius - 11);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const inner = radius + 4;
      const outer = radius + (i % 2 === 0 ? 22 : 17);
      g.lineStyle(i % 2 === 0 ? 3 : 2, i % 2 === 0 ? color : COLORS.white, 0.78);
      g.beginPath();
      g.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
      g.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
      g.strokePath();
      g.fillStyle(i % 2 === 0 ? color : COLORS.white, 0.92);
      g.fillCircle(Math.cos(a) * outer, Math.sin(a) * outer, i % 2 === 0 ? 3.2 : 2.4);
    }
  }

  /** Cytokine/receptor corona: organic radial rhythm instead of the old cyber-tech segmented ring. */
  private drawEliteCorona(g: Phaser.GameObjects.Graphics, radius: number): void {
    g.clear();
    g.lineStyle(1.4, COLORS.gold, 0.55);
    g.strokeCircle(0, 0, radius);
    g.lineStyle(1, COLORS.white, 0.22);
    g.strokeCircle(0, 0, radius + 4);

    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const inner = radius - 2;
      const outer = radius + (i % 2 === 0 ? 8 : 5);
      g.lineStyle(i % 3 === 0 ? 2 : 1.2, i % 3 === 0 ? COLORS.green : COLORS.gold, 0.7);
      g.beginPath();
      g.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
      g.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
      g.strokePath();
      if (i % 3 === 0) {
        g.fillStyle(COLORS.white, 0.72);
        g.fillCircle(Math.cos(a) * outer, Math.sin(a) * outer, 1.6);
      }
    }
  }
}
