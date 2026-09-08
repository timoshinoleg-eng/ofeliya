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
    this.color = opts.elite
      ? COLORS.gold
      : kind === 'boss'
        ? COLORS.red
        : kind === 'swarm'
          ? COLORS.magenta
          : kind === 'runner'
            ? COLORS.orange
            : COLORS.purple;

    this.flashUntil = 0;
    this.bladeImmuneUntil = 0;
    this.knockX = 0;
    this.knockY = 0;
    this.setAlpha(1);
    this.clearTint();
    this.setRotation(0);

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setCircle(def.radius, this.width / 2 - def.radius, this.height / 2 - def.radius);
  }

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    if (!this.active || !this.target) return;

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

    if (this.kind === 'runner') this.setRotation(Math.atan2(dy, dx));
  }

  takeDamage(amount: number, kx = 0, ky = 0): void {
    if (!this.active) return;
    this.hp -= amount;
    this.flashUntil = this.scene.time.now + 70;
    this.knockX += kx;
    this.knockY += ky;
    if (this.hp <= 0) {
      this.disableBody(true, true);
      this.gs?.onEnemyDied(this);
    }
  }
}
