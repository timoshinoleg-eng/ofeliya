import Phaser from 'phaser';
import { COLORS, ELITE, ENEMY_DEFS, type EnemyKind } from './config';
import type { GameScene } from '../scenes/GameScene';
import type { Player } from './Player';
import type { StageBossBehavior } from './StageDefinitions';
import type { EliteModifierId } from './DifficultyProfile';
import {
  canPrimeLysisBreak,
  primeDamageMultiplier,
  primeMembraneBreakDurationMs,
  type PrimeAttackState,
} from './BossVulnerability';
import {
  BOSS_PHASE_TWO_HP_FRACTION,
  PRIME_ATTACK_PACING,
  primeAttackPhasePacing,
} from './BossPacing';

export type EnemyDamageSource = 'standard' | 'lysis';

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
  eliteModifier: EliteModifierId | null = null;
  color = 0xffffff;
  flashUntil = 0;
  bladeImmuneUntil = 0;
  spawnSerial = 0;
  bossPhase = 1;

  private gs: GameScene | null = null;
  private target: Player | null = null;
  private knockX = 0;
  private knockY = 0;
  private eliteRing: Phaser.GameObjects.Graphics | null = null;
  private eliteMarker: Phaser.GameObjects.Graphics | null = null;
  eliteVisualSignature: 'none' | 'regen-orbit' | 'frenzy-spikes' | 'volatile-diamond' = 'none';
  private bossAura: Phaser.GameObjects.Graphics | null = null;
  private bossBehavior: StageBossBehavior = 'pressure-wave';
  private heartbeatMs = 0;
  private visualScale = 1;
  private lastDamageAt = 0;
  private rolePhase: 'pursuit' | 'windup' | 'burst' | 'recovery' = 'pursuit';
  private rolePhaseUntil = 0;
  private nextRoleActionAt = 0;
  private lockedDirX = 0;
  private lockedDirY = 0;
  private roleTelegraph: Phaser.GameObjects.Graphics | null = null;
  private bossAttackState: PrimeAttackState = 'pursuit';
  private bossAttackStartedAt = 0;
  private bossAttackUntil = 0;
  private nextBossAttackAt = 0;
  private bossTelegraph: Phaser.GameObjects.Graphics | null = null;
  private primeBrokenUntil = 0;

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
    opts: {
      elite: boolean;
      hpScale: number;
      dmgScale: number;
      speedScale?: number;
      eliteModifier?: EliteModifierId | null;
      textureKey?: string;
      color?: number;
      bossBehavior?: StageBossBehavior;
      heartbeatMs?: number;
    }
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
    this.eliteModifier = opts.elite ? (opts.eliteModifier ?? null) : null;
    this.eliteVisualSignature =
      this.eliteModifier === 'regenerator'
        ? 'regen-orbit'
        : this.eliteModifier === 'frenzied'
          ? 'frenzy-spikes'
          : this.eliteModifier === 'volatile'
            ? 'volatile-diamond'
            : 'none';
    this.bossBehavior = opts.bossBehavior ?? 'pressure-wave';
    this.heartbeatMs = Math.max(0, opts.heartbeatMs ?? 0);

    this.maxHp = def.hp * opts.hpScale * (opts.elite ? ELITE.hpMul : 1);
    this.hp = this.maxHp;
    this.dmg =
      def.dmg *
      opts.dmgScale *
      (opts.elite ? ELITE.dmgMul : 1) *
      (this.eliteModifier === 'frenzied' ? 1.15 : 1);
    this.xpValue = def.xp * (opts.elite ? ELITE.xpMul : 1);
    this.speed =
      def.speed *
      (opts.elite ? 0.92 : 1) *
      (opts.speedScale ?? 1) *
      (this.eliteModifier === 'frenzied' ? 1.22 : 1);
    this.radius = def.radius * scale;
    this.color = opts.elite
      ? this.eliteModifierColor()
      : kind === 'boss'
        ? (opts.color ?? COLORS.cyan)
        : kind === 'swarm'
          ? COLORS.white
          : kind === 'runner'
            ? COLORS.cyan
            : 0xffd6a1;

    this.flashUntil = 0;
    this.bladeImmuneUntil = 0;
    this.lastDamageAt = this.scene.time.now;
    this.knockX = 0;
    this.knockY = 0;
    this.rolePhase = 'pursuit';
    this.rolePhaseUntil = 0;
    this.nextRoleActionAt = this.scene.time.now + 700 + (this.spawnSerial % 5) * 170;
    this.lockedDirX = 0;
    this.lockedDirY = 0;
    this.roleTelegraph?.setVisible(false).clear();
    this.bossPhase = 1;
    this.bossAttackState = 'pursuit';
    this.bossAttackStartedAt = 0;
    this.bossAttackUntil = 0;
    this.nextBossAttackAt = this.isBoss
      ? this.scene.time.now + PRIME_ATTACK_PACING.initialDelayMs
      : 0;
    this.bossTelegraph?.setVisible(false).clear();
    this.primeBrokenUntil = 0;
    this.setAlpha(1);
    this.clearTint();
    this.setRotation(0);

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setCircle(def.radius, this.width / 2 - def.radius, this.height / 2 - def.radius);

    if (opts.elite) {
      if (!this.eliteRing) this.eliteRing = this.scene.add.graphics().setDepth(9);
      if (!this.eliteMarker) this.eliteMarker = this.scene.add.graphics().setDepth(12);
      const modifierColor = this.eliteModifierColor();
      this.drawEliteCorona(
        this.eliteRing,
        Math.max(24, def.radius * scale + 12),
        this.eliteModifier,
        modifierColor
      );
      this.drawEliteMarker(this.eliteMarker, this.eliteModifier, modifierColor);
      this.eliteRing.setVisible(true).setPosition(x, y).setRotation(0).setAlpha(0.78);
      this.eliteMarker
        .setVisible(true)
        .setPosition(x, y - this.radius - 12)
        .setScale(1)
        .setRotation(0);
    } else {
      this.eliteVisualSignature = 'none';
      this.eliteRing?.setVisible(false);
      this.eliteMarker?.setVisible(false);
    }

    if (this.isBoss) {
      if (!this.bossAura) this.bossAura = this.scene.add.graphics().setDepth(9);
      if (this.bossBehavior === 'heartbeat-pulse') {
        this.drawCardiacAura(this.bossAura, Math.max(68, this.radius + 42), this.color);
        this.bossAura.setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.88);
      } else {
        this.drawPrimeAura(this.bossAura, Math.max(62, this.radius + 36), 'armored');
        this.bossAura.setBlendMode(Phaser.BlendModes.NORMAL).setAlpha(0.72);
      }
      this.bossAura.setVisible(true).setPosition(x, y);
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

    if (
      this.isElite &&
      this.eliteModifier === 'regenerator' &&
      this.hp > 0 &&
      this.hp < this.maxHp &&
      time - this.lastDamageAt >= 900
    ) {
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.025 * (Math.min(delta, 50) / 1000));
    }

    const p = this.target;
    const dx = p.x - this.x;
    const dy = p.y - this.y;
    const d = Math.hypot(dx, dy) || 1;

    // Dense fights should preserve danger hierarchy instead of turning every silhouette equally
    // bright. Bosses/elites stay at full priority; nearby normal enemies remain readable while
    // distant low-value bodies recede as density rises.
    if (this.isBoss || this.isElite) {
      this.setAlpha(1);
    } else {
      const density = this.gs?.getCombatVisualDensity() ?? 0;
      const nearPlayer = d <= 150;
      const alpha =
        density >= 180
          ? nearPlayer
            ? 0.94
            : this.kind === 'swarm'
              ? 0.58
              : 0.72
          : density >= 140
            ? nearPlayer
              ? 0.97
              : this.kind === 'swarm'
                ? 0.7
                : 0.82
            : density >= 110 && !nearPlayer
              ? 0.88
              : 1;
      this.setAlpha(alpha);
    }

    const pressure = this.gs?.getEnemyPressureMultiplier() ?? 1;
    const forwardSpeed = this.speed * pressure;

    // Antibodies predict the player's near-future path instead of joining the same pursuit line.
    let pursuitDx = dx;
    let pursuitDy = dy;
    if (!this.isBoss && this.kind === 'swarm') {
      const playerBody = p.body as Phaser.Physics.Arcade.Body;
      const leadSeconds = Phaser.Math.Clamp(d / Math.max(1, forwardSpeed) * 0.18, 0.16, 0.42);
      pursuitDx = p.x + playerBody.velocity.x * leadSeconds - this.x;
      pursuitDy = p.y + playerBody.velocity.y * leadSeconds - this.y;
    }
    const pursuitD = Math.hypot(pursuitDx, pursuitDy) || 1;

    if (this.isBoss) {
      const nextPhase =
        this.hp / Math.max(1, this.maxHp) <= BOSS_PHASE_TWO_HP_FRACTION ? 2 : 1;
      if (nextPhase !== this.bossPhase) {
        this.bossPhase = nextPhase;
        this.gs?.onBossPhaseChanged(this);
      }
      if (this.bossBehavior === 'pressure-wave') this.updateBossPressureAttack(time);
    }

    if (!this.isBoss && (this.kind === 'runner' || this.kind === 'brute')) {
      this.updateRolePhase(time, d, dx / d, dy / d);
    }

    let velocityX = (pursuitDx / pursuitD) * forwardSpeed + this.knockX;
    let velocityY = (pursuitDy / pursuitD) * forwardSpeed + this.knockY;

    if (!this.isBoss && this.kind === 'runner') {
      if (this.rolePhase === 'windup') {
        velocityX = this.knockX;
        velocityY = this.knockY;
      } else if (this.rolePhase === 'burst') {
        velocityX = this.lockedDirX * forwardSpeed * 2.65 + this.knockX;
        velocityY = this.lockedDirY * forwardSpeed * 2.65 + this.knockY;
      } else if (this.rolePhase === 'recovery') {
        velocityX = (dx / d) * forwardSpeed * 0.36 + this.knockX;
        velocityY = (dy / d) * forwardSpeed * 0.36 + this.knockY;
      }
    } else if (!this.isBoss && this.kind === 'brute') {
      if (this.rolePhase === 'windup') {
        velocityX = this.knockX;
        velocityY = this.knockY;
      } else if (this.rolePhase === 'burst') {
        velocityX = this.lockedDirX * forwardSpeed * 1.7 + this.knockX;
        velocityY = this.lockedDirY * forwardSpeed * 1.7 + this.knockY;
      } else if (this.rolePhase === 'recovery') {
        velocityX = (dx / d) * forwardSpeed * 0.28 + this.knockX;
        velocityY = (dy / d) * forwardSpeed * 0.28 + this.knockY;
      }
    }

    if (this.isBoss && this.bossBehavior === 'pressure-wave') {
      const moveMul =
        this.bossAttackState === 'telegraph'
          ? 0.12
          : this.bossAttackState === 'recovery'
            ? 0.55
            : this.bossPhase === 2
              ? 1.08
              : 0.92;
      velocityX = (dx / d) * forwardSpeed * moveMul + this.knockX;
      velocityY = (dy / d) * forwardSpeed * moveMul + this.knockY;
    } else if (this.isBoss && this.bossBehavior === 'heartbeat-pulse') {
      const lateralMul = this.bossPhase === 2 ? 0.5 : 0.34;
      const pursuitMul = this.bossPhase === 2 ? 1.02 : 0.9;
      const lateral = Math.sin(time * 0.0026) * this.speed * lateralMul;
      velocityX = (dx / d) * forwardSpeed * pursuitMul + (-dy / d) * lateral + this.knockX;
      velocityY = (dy / d) * forwardSpeed * pursuitMul + (dx / d) * lateral + this.knockY;
    }
    (this.body as Phaser.Physics.Arcade.Body).setVelocity(velocityX, velocityY);
    this.knockX *= 0.82;
    this.knockY *= 0.82;

    // Role motion is a second readability channel after silhouette:
    // antibody = drifting Y, T-killer = locked charge, macrophage = heavy membrane wobble.
    if (this.kind === 'runner') {
      this.setRotation(
        this.rolePhase === 'burst'
          ? Math.atan2(this.lockedDirY, this.lockedDirX)
          : Math.atan2(dy, dx)
      );
      const charge =
        this.rolePhase === 'windup'
          ? 0.9 + Math.sin(time * 0.028) * 0.06
          : this.rolePhase === 'burst'
            ? 1.12
            : 1 + Math.sin(time * 0.012 + this.y * 0.01) * 0.035;
      this.setScale(this.visualScale * charge, this.visualScale * (2 - charge));
    } else if (this.kind === 'brute') {
      this.setRotation(Math.sin(time * 0.0012 + this.x * 0.01) * 0.1);
      const windupPulse = this.rolePhase === 'windup' ? Math.sin(time * 0.022) * 0.055 : 0;
      const wobble = 1 + Math.sin(time * 0.003 + this.x * 0.008) * 0.025 + windupPulse;
      this.setScale(this.visualScale * wobble, this.visualScale / wobble);
    } else if (this.kind === 'swarm') {
      this.setRotation(Math.atan2(dy, dx) + Math.PI / 2 + Math.sin(time * 0.003 + this.x) * 0.06);
      this.setScale(this.visualScale);
    } else {
      if (this.bossBehavior === 'heartbeat-pulse' && this.heartbeatMs > 0) {
        const phase = (time % this.heartbeatMs) / this.heartbeatMs;
        const secondBeat = phase >= 0.22 ? Math.exp(-(phase - 0.22) * 20) * 0.55 : 0;
        const doubleBeat = Math.max(Math.exp(-phase * 15), secondBeat);
        this.setRotation(Math.sin(time * 0.0012) * (this.bossPhase === 2 ? 0.16 : 0.11));
        this.setScale(
          this.visualScale *
            (this.bossPhase === 2 ? 1.045 : 1) *
            (1 + doubleBeat * (this.bossPhase === 2 ? 0.12 : 0.085))
        );
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

    if (this.isBoss && this.bossBehavior === 'pressure-wave' && this.bossAura) {
      this.updatePrimeAura(time);
    } else if (this.isBoss && this.bossBehavior === 'heartbeat-pulse' && this.bossAura) {
      const phase = this.heartbeatMs > 0 ? (time % this.heartbeatMs) / this.heartbeatMs : 0;
      const secondBeat = phase >= 0.22 ? Math.exp(-(phase - 0.22) * 20) * 0.55 : 0;
      const beat = Math.max(Math.exp(-phase * 15), secondBeat);
      this.bossAura
        .setVisible(true)
        .setPosition(this.x, this.y)
        .setRotation(time * 0.0008)
        .setScale((this.bossPhase === 2 ? 1.08 : 0.98) + beat * (this.bossPhase === 2 ? 0.2 : 0.16))
        .setAlpha((this.bossPhase === 2 ? 0.72 : 0.62) + beat * 0.28);
    }
  }

  private updateBossPressureAttack(time: number): void {
    const pacing = primeAttackPhasePacing(this.bossPhase);
    if (this.bossAttackState === 'pursuit') {
      if (time < this.nextBossAttackAt) {
        this.bossTelegraph?.setVisible(false);
        return;
      }
      this.bossAttackState = 'telegraph';
      this.bossAttackStartedAt = time;
      this.bossAttackUntil = time + pacing.telegraphMs;
      this.drawBossPressureTelegraph();
      return;
    }

    if (this.bossAttackState === 'telegraph') {
      this.updateBossPressureTelegraph(time);
      if (time < this.bossAttackUntil) return;
      this.bossTelegraph?.setVisible(false);
      this.gs?.triggerBossPressureWave(
        this,
        pacing.radius,
        this.dmg * pacing.damageMultiplier
      );
      this.bossAttackState = 'recovery';
      this.bossAttackUntil = time + pacing.recoveryMs;
      return;
    }

    if (time < this.bossAttackUntil) return;
    this.bossAttackState = 'pursuit';
    this.nextBossAttackAt = time + pacing.cooldownMs;
  }

  private drawBossPressureTelegraph(): void {
    if (!this.bossTelegraph) this.bossTelegraph = this.scene.add.graphics().setDepth(8);
    const radius = primeAttackPhasePacing(this.bossPhase).radius;
    this.bossTelegraph.clear().setVisible(true).setPosition(this.x, this.y);
    this.bossTelegraph.lineStyle(this.bossPhase === 2 ? 5 : 4, COLORS.red, 0.94);
    this.bossTelegraph.strokeCircle(0, 0, radius);
    this.bossTelegraph.lineStyle(2, COLORS.white, 0.62);
    this.bossTelegraph.strokeCircle(0, 0, radius * 0.72);
    this.bossTelegraph.lineStyle(1.5, COLORS.red, 0.42);
    this.bossTelegraph.strokeCircle(0, 0, radius * 0.9);
    this.bossTelegraph.fillStyle(COLORS.red, 0.075);
    this.bossTelegraph.fillCircle(0, 0, radius);
  }

  private updateBossPressureTelegraph(time: number): void {
    if (!this.bossTelegraph) return;
    const duration = Math.max(1, this.bossAttackUntil - this.bossAttackStartedAt);
    const progress = Phaser.Math.Clamp((time - this.bossAttackStartedAt) / duration, 0, 1);
    this.bossTelegraph
      .setVisible(true)
      .setPosition(this.x, this.y)
      .setScale(1.08 - progress * 0.08)
      .setAlpha(0.42 + progress * 0.5);
  }

  private updateRolePhase(
    time: number,
    distance: number,
    dirX: number,
    dirY: number
  ): void {
    if (this.rolePhase === 'pursuit') {
      const canStart =
        time >= this.nextRoleActionAt &&
        (this.kind === 'runner'
          ? distance >= 90 && distance <= 350
          : distance <= 165);
      if (!canStart) {
        this.roleTelegraph?.setVisible(false);
        return;
      }

      this.rolePhase = 'windup';
      this.rolePhaseUntil = time + (this.kind === 'runner' ? 480 : 680);
      this.lockedDirX = dirX;
      this.lockedDirY = dirY;
      this.drawRoleTelegraph();
      return;
    }

    if (this.rolePhase === 'windup') {
      this.updateRoleTelegraph(time);
      if (time < this.rolePhaseUntil) return;
      this.roleTelegraph?.setVisible(false);
      this.rolePhase = 'burst';
      this.rolePhaseUntil = time + (this.kind === 'runner' ? 430 : 360);
      return;
    }

    if (this.rolePhase === 'burst') {
      if (time < this.rolePhaseUntil) return;
      this.rolePhase = 'recovery';
      this.rolePhaseUntil = time + (this.kind === 'runner' ? 520 : 720);
      return;
    }

    if (time < this.rolePhaseUntil) return;
    this.rolePhase = 'pursuit';
    this.nextRoleActionAt = time + (this.kind === 'runner' ? 1450 : 1900);
  }

  private drawRoleTelegraph(): void {
    if (!this.roleTelegraph) this.roleTelegraph = this.scene.add.graphics().setDepth(8);
    this.roleTelegraph.clear().setVisible(true).setPosition(this.x, this.y);

    if (this.kind === 'runner') {
      const laneStart = Math.max(18, this.radius + 5);
      const laneEnd = 154;
      // A broad translucent lane survives phone downscaling; the bright center line keeps direction exact.
      this.roleTelegraph.lineStyle(13, COLORS.cyan, 0.12);
      this.roleTelegraph.beginPath();
      this.roleTelegraph.moveTo(this.lockedDirX * laneStart, this.lockedDirY * laneStart);
      this.roleTelegraph.lineTo(this.lockedDirX * laneEnd, this.lockedDirY * laneEnd);
      this.roleTelegraph.strokePath();
      this.roleTelegraph.lineStyle(3.2, COLORS.cyan, 0.92);
      this.roleTelegraph.beginPath();
      this.roleTelegraph.moveTo(this.lockedDirX * laneStart, this.lockedDirY * laneStart);
      this.roleTelegraph.lineTo(this.lockedDirX * laneEnd, this.lockedDirY * laneEnd);
      this.roleTelegraph.strokePath();
      this.roleTelegraph.fillStyle(COLORS.white, 0.82);
      this.roleTelegraph.fillCircle(this.lockedDirX * laneEnd, this.lockedDirY * laneEnd, 4.5);
      this.roleTelegraph.lineStyle(1.8, COLORS.white, 0.68);
      this.roleTelegraph.strokeCircle(0, 0, Math.max(19, this.radius + 8));
    } else {
      this.roleTelegraph.lineStyle(3, COLORS.orange, 0.72);
      this.roleTelegraph.strokeCircle(0, 0, Math.max(58, this.radius + 38));
      this.roleTelegraph.lineStyle(1.5, COLORS.white, 0.42);
      this.roleTelegraph.strokeCircle(0, 0, Math.max(42, this.radius + 22));
    }
  }

  private updateRoleTelegraph(time: number): void {
    if (!this.roleTelegraph) return;
    const pulse = 0.72 + Math.sin(time * 0.025) * 0.2;
    this.roleTelegraph
      .setVisible(true)
      .setPosition(this.x, this.y)
      .setAlpha(pulse)
      .setScale(0.94 + (1 - pulse) * 0.16);
  }

  /** Hide pooled enemy presentation before the object is reused by another stage. */
  deactivateForStageReset(): void {
    this.eliteRing?.setVisible(false);
    this.eliteMarker?.setVisible(false);
    this.bossAura?.setVisible(false);
    this.roleTelegraph?.setVisible(false).clear();
    this.bossTelegraph?.setVisible(false).clear();
    this.primeBrokenUntil = 0;
    this.target = null;
    this.gs = null;
    this.knockX = 0;
    this.knockY = 0;
    this.eliteModifier = null;
    this.eliteVisualSignature = 'none';
    this.lastDamageAt = 0;
    this.clearTint();
    this.disableBody(true, true);
  }

  applyKnock(kx: number, ky: number): void {
    if (!this.active) return;
    this.knockX += kx;
    this.knockY += ky;
  }

  takeDamage(
    amount: number,
    kx = 0,
    ky = 0,
    source: EnemyDamageSource = 'standard'
  ): number {
    if (!this.active) return 0;
    const now = this.scene.time.now;
    let actualDamage = Math.max(0, amount);

    if (this.isBoss && this.bossBehavior === 'pressure-wave') {
      if (source === 'lysis' && canPrimeLysisBreak(this.bossAttackState)) {
        const wasBroken = now <= this.primeBrokenUntil;
        this.primeBrokenUntil = Math.max(
          this.primeBrokenUntil,
          now + primeMembraneBreakDurationMs(this.bossPhase)
        );
        if (!wasBroken) this.gs?.onPrimeMembraneBreak(this);
      }
      actualDamage *= primeDamageMultiplier(
        this.bossAttackState,
        now <= this.primeBrokenUntil
      );
    }

    this.hp -= actualDamage;
    if (actualDamage > 0) this.lastDamageAt = now;
    this.flashUntil = now + 70;
    this.knockX += kx;
    this.knockY += ky;
    if (this.hp <= 0) {
      this.eliteRing?.setVisible(false);
      this.eliteMarker?.setVisible(false);
      this.bossAura?.setVisible(false);
      this.roleTelegraph?.setVisible(false).clear();
      this.bossTelegraph?.setVisible(false).clear();
      this.disableBody(true, true);
      this.gs?.onEnemyDied(this);
    }
    return actualDamage;
  }

  private drawPrimeAura(
    g: Phaser.GameObjects.Graphics,
    radius: number,
    mode: 'armored' | 'recovery' | 'broken'
  ): void {
    g.clear();
    const color =
      mode === 'broken' ? COLORS.green : mode === 'recovery' ? COLORS.gold : COLORS.cyan;

    if (mode === 'armored') {
      g.lineStyle(3.2, color, 0.72);
      g.strokeCircle(0, 0, radius);
      g.lineStyle(1.4, COLORS.white, 0.34);
      g.strokeCircle(0, 0, radius + 8);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.lineStyle(2.2, color, 0.62);
        g.beginPath();
        g.moveTo(Math.cos(a) * (radius - 7), Math.sin(a) * (radius - 7));
        g.lineTo(Math.cos(a) * (radius + 7), Math.sin(a) * (radius + 7));
        g.strokePath();
      }
      return;
    }

    const gap = mode === 'broken' ? 0.72 : 0.5;
    g.lineStyle(mode === 'broken' ? 4 : 3, color, mode === 'broken' ? 0.92 : 0.78);
    for (const offset of [0, Math.PI]) {
      g.beginPath();
      g.arc(0, 0, radius, offset + gap, offset + Math.PI - gap, false);
      g.strokePath();
    }
    g.lineStyle(1.5, COLORS.white, mode === 'broken' ? 0.62 : 0.42);
    g.strokeCircle(0, 0, radius + 10);
  }

  private updatePrimeAura(time: number): void {
    if (!this.bossAura) return;
    const broken = time <= this.primeBrokenUntil;
    const mode = broken
      ? 'broken'
      : this.bossAttackState === 'recovery'
        ? 'recovery'
        : 'armored';
    const radius = Math.max(62, this.radius + 36);
    this.drawPrimeAura(this.bossAura, radius, mode);
    const pulse = 1 + Math.sin(time * (broken ? 0.012 : 0.005)) * (broken ? 0.065 : 0.025);
    this.bossAura
      .setVisible(true)
      .setPosition(this.x, this.y)
      .setRotation(mode === 'armored' ? -time * 0.00045 : time * 0.00085)
      .setScale(pulse)
      .setAlpha(broken ? 0.94 : mode === 'recovery' ? 0.82 : 0.62);
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
  private eliteModifierColor(): number {
    if (this.eliteModifier === 'regenerator') return COLORS.green;
    if (this.eliteModifier === 'frenzied') return COLORS.orange;
    if (this.eliteModifier === 'volatile') return COLORS.red;
    return COLORS.gold;
  }

  private drawEliteMarker(
    g: Phaser.GameObjects.Graphics,
    modifier: EliteModifierId | null,
    color: number
  ): void {
    g.clear();
    if (modifier === 'regenerator') {
      g.lineStyle(2, color, 0.95);
      g.strokeCircle(0, 0, 6.5);
      g.lineStyle(1.4, COLORS.white, 0.72);
      g.strokeCircle(0, 0, 2.6);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        g.beginPath();
        g.moveTo(Math.cos(a) * 10, Math.sin(a) * 10);
        g.lineTo(Math.cos(a) * 6.5, Math.sin(a) * 6.5);
        g.strokePath();
      }
      return;
    }

    if (modifier === 'frenzied') {
      g.lineStyle(2.4, color, 0.96);
      for (const offset of [-5, 5]) {
        g.beginPath();
        g.moveTo(-7, offset + 4);
        g.lineTo(0, offset - 3);
        g.lineTo(7, offset + 4);
        g.strokePath();
      }
      g.lineStyle(1.2, COLORS.white, 0.7);
      g.beginPath();
      g.moveTo(-4, 0);
      g.lineTo(4, 0);
      g.strokePath();
      return;
    }

    if (modifier === 'volatile') {
      g.fillStyle(color, 0.18);
      g.lineStyle(2.3, color, 0.96);
      g.beginPath();
      g.moveTo(0, -8);
      g.lineTo(8, 0);
      g.lineTo(0, 8);
      g.lineTo(-8, 0);
      g.closePath();
      g.fillPath();
      g.strokePath();
      g.fillStyle(COLORS.white, 0.88);
      g.fillCircle(0, 0, 2.2);
      return;
    }

    g.lineStyle(2, COLORS.gold, 0.9);
    g.strokeTriangle(-6, 6, 0, -6, 6, 6);
  }

  private drawEliteCorona(
    g: Phaser.GameObjects.Graphics,
    radius: number,
    modifier: EliteModifierId | null,
    color = COLORS.gold
  ): void {
    g.clear();

    if (modifier === 'regenerator') {
      g.lineStyle(1.8, color, 0.66);
      g.strokeCircle(0, 0, radius);
      g.lineStyle(1.1, COLORS.white, 0.28);
      g.strokeCircle(0, 0, radius + 5);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const outer = radius + 7;
        const inner = radius - 5;
        g.lineStyle(i % 2 === 0 ? 2 : 1.2, color, 0.72);
        g.beginPath();
        g.moveTo(Math.cos(a) * outer, Math.sin(a) * outer);
        g.lineTo(Math.cos(a) * inner, Math.sin(a) * inner);
        g.strokePath();
      }
      return;
    }

    if (modifier === 'frenzied') {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const inner = radius - 3;
        const outer = radius + (i % 2 === 0 ? 13 : 8);
        g.lineStyle(i % 2 === 0 ? 2.8 : 1.5, i % 2 === 0 ? color : COLORS.white, 0.82);
        g.beginPath();
        g.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
        g.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
        g.strokePath();
      }
      return;
    }

    if (modifier === 'volatile') {
      g.lineStyle(2.4, color, 0.78);
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + (i / 4) * Math.PI * 2;
        const tangent = a + Math.PI / 2;
        const cx = Math.cos(a) * radius;
        const cy = Math.sin(a) * radius;
        const half = 6;
        g.beginPath();
        g.moveTo(cx + Math.cos(tangent) * half, cy + Math.sin(tangent) * half);
        g.lineTo(Math.cos(a) * (radius + 9), Math.sin(a) * (radius + 9));
        g.lineTo(cx - Math.cos(tangent) * half, cy - Math.sin(tangent) * half);
        g.strokePath();
      }
      g.lineStyle(1, COLORS.white, 0.34);
      g.strokeCircle(0, 0, radius - 5);
      return;
    }

    g.lineStyle(1.4, color, 0.62);
    g.strokeCircle(0, 0, radius);
  }
}
