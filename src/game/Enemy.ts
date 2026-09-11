import Phaser from 'phaser';
import { COLORS, ELITE, ENEMY_DEFS, type EnemyKind } from './config';
import type { GameScene } from '../scenes/GameScene';
import type { Player } from './Player';

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

  private gs: GameScene | null = null;
  private target: Player | null = null;
  private knockX = 0;
  private knockY = 0;
  private eliteRing: Phaser.GameObjects.Graphics | null = null;
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
    opts: { elite: boolean; hpScale: number; dmgScale: number }
  ): void {
    this.gs = gs;
    this.target = gs.player;
    this.kind = kind;
    const def = ENEMY_DEFS[kind];
    const scale = def.scale * (opts.elite ? ELITE.scale : 1);
    this.visualScale = scale;

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
    this.color = opts.elite
      ? COLORS.gold
      : kind === 'boss'
        ? COLORS.cyan
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
      this.drawEliteCorona(this.eliteRing, Math.max(24, def.radius * scale + 12));
      this.eliteRing.setVisible(true).setPosition(x, y).setRotation(0).setAlpha(0.78);
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
    (this.body as Phaser.Physics.Arcade.Body).setVelocity(
      (dx / d) * this.speed + this.knockX,
      (dy / d) * this.speed + this.knockY
    );
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
      this.setRotation(Math.sin(time * 0.0007) * 0.06);
      const bossPulse = 1 + Math.sin(time * 0.0032) * 0.018;
      this.setScale(this.visualScale * bossPulse);
    }

    if (this.isElite && this.eliteRing) {
      this.eliteRing
        .setVisible(true)
        .setPosition(this.x, this.y)
        .setRotation(-time * 0.00105)
        .setScale(0.96 + Math.sin(time / 180) * 0.055)
        .setAlpha(0.58 + Math.sin(time / 180) * 0.15);
    }
  }

  takeDamage(amount: number, kx = 0, ky = 0): void {
    if (!this.active) return;
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
