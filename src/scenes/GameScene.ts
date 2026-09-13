import Phaser from 'phaser';
import {
  COLORS,
  COMBO,
  FONT,
  JUICE,
  ORBIT,
  PLAYER,
  POSTFX,
  WEAPON,
  type EnemyKind,
} from '../game/config';
import {
  evaluateAchievements,
  getAchievementDef,
  type AchievementId,
} from '../game/AchievementSystem';
import { rollRunChoices } from '../game/EvolutionSystem';
import { IDENTITY } from '../game/identity';
import { Player } from '../game/Player';
import { Enemy } from '../game/Enemy';
import { Bullet } from '../game/Bullet';
import { Gem } from '../game/Gem';
import type { RunResult, RunSnapshot } from '../game/RunContracts';
import { RunMilestones } from '../game/RunMilestones';
import { RunState } from '../game/RunState';
import {
  StageDirector,
  type RunEndReason,
  type StageDirectorEvent,
} from '../game/StageDirector';
import { STAGES, difficultyForStage, type StageDefinition } from '../game/StageDefinitions';
import type { EvolutionId, UpgradeDef } from '../game/UpgradeSystem';
import { WaveDirector } from '../game/WaveDirector';
import { AtmosphereSystem } from '../systems/AtmosphereSystem';
import { PlatformBridge } from '../platform';
import { SaveSystem } from '../systems/SaveSystem';
import { Sfx } from '../systems/Sfx';
import { VfxSystem } from '../systems/VfxSystem';
import { HostCellSystem, type HostCellLysisEvent } from '../systems/HostCellSystem';
import type { UIScene } from './UIScene';

export class GameScene extends Phaser.Scene {
  player!: Player;
  runState!: RunState;

  private atmosphere!: AtmosphereSystem;
  private vignette!: Phaser.GameObjects.Image;
  private vfx!: VfxSystem;
  private hostCells!: HostCellSystem;
  private bullets!: Phaser.Physics.Arcade.Group;
  private enemies!: Phaser.Physics.Arcade.Group;
  private gems!: Phaser.Physics.Arcade.Group;
  private blades: Phaser.GameObjects.Image[] = [];
  private haloRing: Phaser.GameObjects.Arc | null = null;
  private wave!: WaveDirector;
  private stageDirector!: StageDirector;
  private milestones!: RunMilestones;
  private aimMarker!: Phaser.GameObjects.Image;
  private playerBar!: Phaser.GameObjects.Graphics;

  private nextFireAt = 0;
  private novaAcc = 0;
  private queuedLevels = 0;
  awaitingChoice = false;
  pendingChoices: UpgradeDef[] = [];
  private pendingEvolutionCeremony: EvolutionId | null = null;
  private newAchievements: AchievementId[] = [];
  private achievementCheckAcc = 0;
  private hitStopUntil = 0;
  private hitStopped = false;
  private dmgTexts: Phaser.GameObjects.Text[] = [];
  private dmgCursor = 0;
  private lastDmgAt = 0;
  private lastDmg: { obj: Phaser.GameObjects.Text; value: number; at: number } | null = null;
  private trail: Phaser.GameObjects.Image[] = [];
  private trailCursor = 0;
  private trailAcc = 0;
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  private introHint: Phaser.GameObjects.Container | null = null;
  private transitionGeneration = 0;
  private stageTransition: {
    token: number;
    from: StageDefinition;
    to: StageDefinition;
    timer: Phaser.Time.TimerEvent | null;
    committing: boolean;
    earliestCommitAt: number;
  } | null = null;

  constructor() {
    super('Game');
  }

  create(): void {
    this.stageDirector = new StageDirector(STAGES);
    this.runState = new RunState(this.stageDirector.currentStage);
    Sfx.startMusic();
    PlatformBridge.setBackHandler(() => this.exitToMenu());
    this.queuedLevels = 0;
    this.awaitingChoice = false;
    this.pendingChoices = [];
    this.pendingEvolutionCeremony = null;
    this.newAchievements = [];
    this.achievementCheckAcc = 0;
    this.nextFireAt = 0;
    this.novaAcc = 0;
    this.blades = [];
    this.haloRing = null;
    this.hitStopUntil = 0;
    this.hitStopped = false;
    this.lastDmg = null;
    this.lastDmgAt = 0;
    this.dmgCursor = 0;
    this.introHint = null;
    this.transitionGeneration = 0;
    this.stageTransition = null;
    this.physics.world.resume();

    const W = this.scale.width;
    const H = this.scale.height;
    this.cameras.main.setBackgroundColor(COLORS.bg);

    this.atmosphere = new AtmosphereSystem(this);
    this.vignette = this.add
      .image(W / 2, H / 2, 'vignette')
      .setScrollFactor(0)
      .setDepth(28)
      .setDisplaySize(W * 1.25, H * 1.25);

    const fxEnabled = POSTFX.enabled && this.game.renderer.type === Phaser.WEBGL;
    if (fxEnabled) {
      const fx = this.cameras.main.postFX;
      fx.addBloom(0xffffff, 0, 0, POSTFX.bloom.blurStrength, POSTFX.bloom.strength, POSTFX.bloom.steps);
      fx.addVignette(0.5, 0.5, POSTFX.vignette.radius, POSTFX.vignette.strength);
    }
    this.vignette.setVisible(!fxEnabled);

    this.player = new Player(this, W / 2, H / 2);
    this.aimMarker = this.add.image(0, 0, 'marker').setDepth(16).setVisible(false);
    this.playerBar = this.add.graphics().setDepth(17);

    this.bullets = this.physics.add.group({ classType: Bullet, maxSize: 160 });
    this.enemies = this.physics.add.group({ classType: Enemy, maxSize: 260 });
    this.gems = this.physics.add.group({ classType: Gem, maxSize: 220 });
    this.vfx = new VfxSystem(this);
    this.hostCells = new HostCellSystem(this, this.player, (event) => this.onHostCellLysis(event));

    this.dmgTexts = [];
    for (let i = 0; i < JUICE.dmgTextPool; i++) {
      this.dmgTexts.push(
        this.add
          .text(0, 0, '', {
            fontFamily: FONT,
            fontSize: '14px',
            fontStyle: 'bold',
            color: '#e8f4ff',
          })
          .setOrigin(0.5)
          .setResolution(2)
          .setDepth(26)
          .setStroke('#0b0e1a', 3)
          .setVisible(false)
          .setActive(false)
      );
    }

    this.trail = [];
    for (let i = 0; i < JUICE.trailPool; i++) {
      this.trail.push(
        this.add
          .image(0, 0, 'virus-player')
          .setDepth(14)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setVisible(false)
      );
    }
    this.trailCursor = 0;
    this.trailAcc = 0;

    this.physics.add.overlap(this.bullets, this.enemies, this.onBulletHit, undefined, this);
    this.physics.add.overlap(this.player, this.enemies, this.onPlayerHit, undefined, this);
    this.physics.add.overlap(this.player, this.gems, this.onGemTouch, undefined, this);

    this.wave = new WaveDirector(this, this.enemies, this.stageDirector.currentStage);
    this.milestones = new RunMilestones(this);
    this.handleStageEvents(this.stageDirector.startRun());
    this.cameras.main.startFollow(this.player, true, 0.14, 0.14);

    const kb = this.input.keyboard;
    if (kb) {
      this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT') as Record<
        string,
        Phaser.Input.Keyboard.Key
      >;
    }

    if (!this.scene.isActive('UI')) this.scene.launch('UI');

    this.registry.set('joy', { x: 0, y: 0 });
    this.registry.set('runResult', null);
    this.registry.set('run', this.snapshot());

    if (SaveSystem.get().runs === 0) this.showIntroHint();

    this.scale.on('resize', this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.onResize, this);
      PlatformBridge.setBackHandler(null);
      this.cancelStageTransition();
      this.dismissIntroHint(true);
      this.cameras.main.resetFX();
      this.atmosphere.destroy();
      this.vfx.destroy();
      this.hostCells.destroy();
      this.milestones.reset();
      this.registry.remove('run');
      this.registry.remove('runResult');
      this.registry.remove('joy');
    });
  }

  private exitToMenu(): void {
    this.cancelStageTransition();
    Sfx.stopMusic();
    if (this.scene.isActive('UI') || this.scene.isPaused('UI')) this.scene.stop('UI');
    this.scene.stop();
    this.scene.start('Menu');
  }

  update(time: number, delta: number): void {
    if (this.stageDirector.phase === 'RUN_ENDED') return;
    // A stage transition is a frozen transaction: no movement, combat, wave spawns or stage clocks.
    // The UI scene stays live and either the guarded timer or tap commits exactly one reset.
    if (this.stageDirector.phase === 'STAGE_TRANSITION' || this.stageDirector.phase === 'BOSS_DEFEATED') return;
    if (this.hitStopped) {
      if (time < this.hitStopUntil) return;
      this.hitStopped = false;
      this.physics.world.resume();
    }
    this.runState.tick(delta);
    const st = this.runState.stage;
    const stage = this.stageDirector.currentStage;
    this.achievementCheckAcc += delta;
    if (this.achievementCheckAcc >= 500) {
      this.achievementCheckAcc = 0;
      this.captureAchievements(false, true);
    }

    let vx = 0;
    let vy = 0;
    const k = this.keys;
    if (k.A?.isDown || k.LEFT?.isDown) vx -= 1;
    if (k.D?.isDown || k.RIGHT?.isDown) vx += 1;
    if (k.W?.isDown || k.UP?.isDown) vy -= 1;
    if (k.S?.isDown || k.DOWN?.isDown) vy += 1;
    const joy = this.registry.get('joy') as { x: number; y: number } | undefined;
    if (joy) {
      vx += joy.x;
      vy += joy.y;
    }
    const len = Math.hypot(vx, vy);
    if (len > 1) {
      vx /= len;
      vy /= len;
    }
    const speed = PLAYER.speed * st.speedMul;
    (this.player.body as Phaser.Physics.Arcade.Body).setVelocity(vx * speed, vy * speed);

    if (len > 0.1) {
      this.trailAcc += delta;
      if (this.trailAcc >= JUICE.trailEveryMs) {
        this.trailAcc = 0;
        this.spawnTrail();
      }
    } else {
      this.trailAcc = JUICE.trailEveryMs;
    }

    if (time < this.player.hurtUntil) {
      this.player.setAlpha(Math.sin(time / 45) > 0 ? 0.55 : 1);
    } else {
      this.player.setAlpha(1);
      if (this.player.tintFill) this.player.clearTint();
    }

    this.tryFire(time);
    this.syncBlades(time);

    if (st.novaLevel > 0) {
      this.novaAcc += delta;
      if (this.novaAcc >= this.runState.novaInterval) {
        this.novaAcc = 0;
        this.fireNova();
      }
    }

    if (st.regen > 0) st.hp = Math.min(st.maxHp, st.hp + (st.regen * delta) / 1000);

    // Keep the established frame order: firing resolves before timeline presentations and spawns.
    this.milestones.setIntensity(st.timeMs / stage.durationMs);
    this.handleStageEvents(this.stageDirector.update(st.timeMs));
    this.wave.update(delta);
    this.hostCells.update(time, delta, st.timeMs);
    this.atmosphere.update(time, delta, st.timeMs, stage.durationMs);

    this.playerBar.clear();
    if (st.hp < st.maxHp) {
      const w = 34;
      const x = this.player.x - w / 2;
      const y = this.player.y - 24;
      const f = Phaser.Math.Clamp(st.hp / st.maxHp, 0, 1);
      this.playerBar.fillStyle(0x1a2136, 0.9);
      this.playerBar.fillRect(x, y, w, 5);
      this.playerBar.fillStyle(f > 0.35 ? COLORS.green : 0xff5a5a, 1);
      this.playerBar.fillRect(x, y, w * f, 5);
    }

    this.registry.set('run', this.snapshot());

    if (this.queuedLevels > 0 && !this.awaitingChoice) {
      // Progression supersedes onboarding; never render tutorial copy beneath a mutation modal.
      this.dismissIntroHint(true);
      this.pendingChoices = rollRunChoices(this.runState);
      this.awaitingChoice = true;
      this.queuedLevels -= 1;
    }
  }

  spawnEnemy(kind: EnemyKind, x: number, y: number, elite: boolean): Enemy | null {
    const e = this.enemies.get(x, y) as Enemy | null;
    if (!e) return null;
    const isBoss = kind === 'boss';
    const stage = this.stageDirector.currentStage;
    const { hpScale, dmgScale } = difficultyForStage(stage, this.runState.stage.timeMs);
    e.activate(this, kind, x, y, {
      elite,
      hpScale: isBoss ? stage.difficulty.bossHpScale : hpScale,
      dmgScale: isBoss ? stage.difficulty.bossDamageScale : dmgScale,
      textureKey: isBoss ? stage.boss.textureKey : undefined,
      color: isBoss ? stage.theme.accentColor : undefined,
    });
    if (kind === 'boss') {
      Sfx.play('boss');
      this.atmosphere.pulse(stage.theme.dangerColor, 0.32);
      this.cameras.main.shake(320, 0.008);
      PlatformBridge.haptic('heavy');
    } else if (elite) {
      Sfx.play('elite');
      this.atmosphere.pulse(COLORS.gold, 0.12);
    }
    return e;
  }

  onEnemyDied(e: Enemy): void {
    const st = this.runState.stage;
    this.runState.recordKill(COMBO.windowMs);
    this.captureAchievements(false, true);
    this.vfx.kill(e.x, e.y, e.color, e.isBoss ? 'boss' : e.isElite ? 'elite' : 'normal');
    if (e.isElite || e.isBoss) {
      this.hitStop(e.isBoss ? JUICE.hitStopBossMs : JUICE.hitStopMs);
      const s = JUICE.shakeEliteKill;
      this.cameras.main.shake(s.duration, s.intensity);
    }
    if (e.xpValue > 0) {
      // The first readable pickup teaches the mutation loop immediately instead of requiring
      // five scattered one-XP drops before the player sees the first choice.
      const value = st.kills === 1 ? Math.max(5, e.xpValue) : e.xpValue;
      this.spawnGem(e.x, e.y, value);
    }
    if (e.isBoss && this.wave.boss === e) {
      this.wave.boss = null;
      this.cameras.main.shake(400, 0.01);
      const defeatedStageId = this.stageDirector.currentStage.id;
      const ceremonyToken = ++this.transitionGeneration;
      this.runState.recordBossDefeated(this.stageDirector.currentStage.boss.id);
      this.handleStageEvents(this.stageDirector.bossDefeated());
      this.time.delayedCall(550, () => {
        if (this.transitionGeneration !== ceremonyToken) return;
        if (this.stageDirector.phase !== 'BOSS_DEFEATED') return;
        if (this.stageDirector.currentStage.id !== defeatedStageId) return;
        this.handleStageEvents(this.stageDirector.completeBossDefeat());
      });
    }
  }

  private onHostCellLysis(event: HostCellLysisEvent): void {
    this.runState.recordHostCellInfected();
    // Gameplay radius is unchanged; the smaller visual nova leaves room for the membrane contour.
    this.vfx.nova(event.x, event.y, event.radius * 0.72);
    this.atmosphere.pulse(COLORS.green, 0.14);
    Sfx.play('nova');
    PlatformBridge.haptic('medium');

    for (let i = 0; i < event.rna; i++) {
      const a = (i / event.rna) * Math.PI * 2 + Math.random() * 0.35;
      const r = 18 + Math.random() * 24;
      this.spawnGem(event.x + Math.cos(a) * r, event.y + Math.sin(a) * r, 1);
    }

    const list = this.enemies.getChildren() as Enemy[];
    for (const e of list) {
      if (!e.active) continue;
      const dx = e.x - event.x;
      const dy = e.y - event.y;
      const d = Math.hypot(dx, dy);
      if (d > event.radius + e.radius) continue;
      const dd = d || 1;
      this.vfx.hit(e.x, e.y, COLORS.green);
      e.takeDamage(event.damage, (dx / dd) * 210, (dy / dd) * 210);
    }
  }

  private hitStop(ms: number): void {
    if (this.stageDirector.phase === 'RUN_ENDED') return;
    const now = this.time.now;
    if (now < this.hitStopUntil + JUICE.hitStopMinGapMs) return;
    this.hitStopUntil = now + ms;
    this.hitStopped = true;
    this.physics.world.pause();
  }

  private showDamage(x: number, y: number, amount: number): void {
    if (amount <= 0) return;
    const now = this.time.now;
    const last = this.lastDmg;
    if (
      last &&
      last.obj.visible &&
      now - last.at < JUICE.dmgTextMergeMs &&
      Math.hypot(last.obj.x - x, last.obj.y - y) < JUICE.dmgTextMergeDist
    ) {
      last.value += amount;
      last.at = now;
      this.styleDmg(last.obj, last.value);
      return;
    }
    if (now - this.lastDmgAt < JUICE.dmgTextMinGapMs) return;

    const t = this.dmgTexts[this.dmgCursor];
    this.dmgCursor = (this.dmgCursor + 1) % this.dmgTexts.length;
    this.tweens.killTweensOf(t);
    this.styleDmg(t, amount);
    t.setActive(true)
      .setVisible(true)
      .setAlpha(1)
      .setScale(0.75)
      .setPosition(x + Phaser.Math.Between(-6, 6), y - 10);
    this.lastDmg = { obj: t, value: amount, at: now };
    this.lastDmgAt = now;
    this.tweens.add({
      targets: t,
      y: t.y - 30,
      alpha: 0,
      scale: 1.05,
      duration: JUICE.dmgTextMs,
      ease: 'Quad.Out',
      onComplete: () => {
        t.setVisible(false).setActive(false);
        if (this.lastDmg && this.lastDmg.obj === t) this.lastDmg = null;
      },
    });
  }

  private spawnTrail(): void {
    const t = this.trail[this.trailCursor];
    this.trailCursor = (this.trailCursor + 1) % this.trail.length;
    this.tweens.killTweensOf(t);
    t.setPosition(this.player.x, this.player.y)
      .setVisible(true)
      .setAlpha(this.runState.hasEvolution('halo') ? 0.42 : 0.32)
      .setTint(this.runState.hasEvolution('halo') ? COLORS.gold : COLORS.white)
      .setScale(1)
      .setRotation(0);
    this.tweens.add({
      targets: t,
      alpha: 0,
      scale: 0.62,
      duration: JUICE.trailFadeMs,
      ease: 'Quad.Out',
      onComplete: () => t.setVisible(false),
    });
  }

  private styleDmg(t: Phaser.GameObjects.Text, value: number): void {
    const crit = value >= JUICE.critDamage;
    t.setText(String(Math.round(value)));
    t.setFontSize(crit ? 18 : 14);
    t.setColor(crit ? '#ffe066' : '#e8f4ff');
  }

  onGemCollected(value: number): void {
    Sfx.play('pickup');
    this.vfx.pickup(this.player.x, this.player.y);
    this.queuedLevels += this.runState.addXp(value);
  }

  chooseUpgrade(id: string): boolean {
    const def = this.pendingChoices.find((c) => c.id === id);
    if (def) {
      def.apply(this.runState);
      if (def.kind === 'evolution' && def.evolutionId) {
        this.pendingEvolutionCeremony = def.evolutionId;
        this.syncPlayerMutationSilhouette();
        this.atmosphere.pulse(COLORS.gold, 0.3);
      } else {
        this.runState.bump(id);
      }
      this.captureAchievements(false, false);
      Sfx.play('click');
      PlatformBridge.notify('success');
    }
    if (this.queuedLevels > 0) {
      this.queuedLevels -= 1;
      this.pendingChoices = rollRunChoices(this.runState);
      return true;
    }
    this.awaitingChoice = false;
    this.pendingChoices = [];
    return false;
  }

  private syncPlayerMutationSilhouette(): void {
    const st = this.runState;
    this.player.setMutationState(
      st.hasEvolution('prism'),
      st.hasEvolution('halo'),
      st.hasEvolution('singularity')
    );
  }

  consumeEvolutionCeremony(): EvolutionId | null {
    const id = this.pendingEvolutionCeremony;
    this.pendingEvolutionCeremony = null;
    return id;
  }

  private beginStageTransition(from: StageDefinition, to: StageDefinition): void {
    if (this.stageDirector.phase !== 'STAGE_TRANSITION' || this.stageTransition) return;

    const token = ++this.transitionGeneration;
    const transaction = {
      token,
      from,
      to,
      timer: null as Phaser.Time.TimerEvent | null,
      committing: false,
      earliestCommitAt: this.time.now + 350,
    };
    this.stageTransition = transaction;

    this.dismissIntroHint(true);
    this.awaitingChoice = false;
    this.pendingChoices = [];
    this.queuedLevels = 0;
    this.pendingEvolutionCeremony = null;
    this.registry.set('joy', { x: 0, y: 0 });
    (this.player.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
    this.aimMarker.setVisible(false);
    this.physics.world.pause();

    this.getUiScene()?.showStageTransition(
      from.name,
      to.name,
      to.theme.accentColor,
      () => this.requestStageTransitionCommit(token)
    );
    transaction.timer = this.time.delayedCall(2400, () => this.commitStageTransition(token));
  }

  private requestStageTransitionCommit(token: number): void {
    const transaction = this.stageTransition;
    if (!transaction || transaction.token !== token || transaction.committing) return;
    const remaining = transaction.earliestCommitAt - this.time.now;
    if (remaining > 0) {
      transaction.timer?.remove(false);
      transaction.timer = this.time.delayedCall(remaining, () => this.commitStageTransition(token));
      return;
    }
    this.commitStageTransition(token);
  }

  private commitStageTransition(token: number): void {
    const transaction = this.stageTransition;
    if (!transaction || transaction.token !== token || transaction.committing) return;
    if (this.stageDirector.phase !== 'STAGE_TRANSITION') return;

    transaction.committing = true;
    transaction.timer?.remove(false);
    transaction.timer = null;
    this.stageDirector.completeTransition();

    if (this.stageDirector.currentStage.id !== transaction.to.id) {
      this.stageTransition = null;
      this.physics.world.resume();
      this.finish(false, 'abandoned');
      return;
    }

    this.resetStageWorld(transaction.to);
    this.stageTransition = null;
    this.getUiScene()?.hideStageTransition();
    const stageStartEvents = this.stageDirector.startStage();
    if (stageStartEvents.length === 0) {
      this.physics.world.resume();
      this.finish(false, 'abandoned');
      return;
    }
    this.handleStageEvents(stageStartEvents);
    this.physics.world.resume();
    PlatformBridge.haptic('medium');
    this.registry.set('run', this.snapshot());
  }

  private resetStageWorld(nextStage: StageDefinition): void {
    this.milestones.reset();
    this.hostCells.resetStage();
    this.wave.boss = null;

    for (const enemy of this.enemies.getChildren() as Enemy[]) {
      if (enemy.active) enemy.deactivateForStageReset();
    }
    for (const bullet of this.bullets.getChildren() as Bullet[]) {
      if (bullet.active) bullet.deactivateForStageReset();
    }
    for (const gem of this.gems.getChildren() as Gem[]) {
      if (gem.active) gem.deactivateForStageReset();
    }

    this.runState.resetStageProgression(nextStage);
    this.queuedLevels = 0;
    this.awaitingChoice = false;
    this.pendingChoices = [];
    this.pendingEvolutionCeremony = null;
    this.novaAcc = 0;
    this.nextFireAt = this.time.now + 250;
    this.achievementCheckAcc = 0;
    this.hitStopUntil = 0;
    this.hitStopped = false;
    this.lastDmg = null;
    this.lastDmgAt = 0;
    this.trailCursor = 0;
    this.trailAcc = 0;

    for (const text of this.dmgTexts) {
      this.tweens.killTweensOf(text);
      text.setVisible(false).setActive(false).setAlpha(0);
    }
    for (const trail of this.trail) {
      this.tweens.killTweensOf(trail);
      trail.setVisible(false).setAlpha(0);
    }
    for (const blade of this.blades) {
      this.tweens.killTweensOf(blade);
      blade.setVisible(false);
    }
    this.haloRing?.setVisible(false);

    const centerX = this.scale.width / 2;
    const centerY = this.scale.height / 2;
    this.player.setMutationState(false, false, false);
    this.player.hurtUntil = 0;
    this.player.clearTint().setAlpha(1).setRotation(0).setScale(0.9).setPosition(centerX, centerY);
    (this.player.body as Phaser.Physics.Arcade.Body).reset(centerX, centerY);
    this.aimMarker.setVisible(false);
    this.playerBar.clear();
    this.registry.set('joy', { x: 0, y: 0 });
  }

  private cancelStageTransition(): void {
    const transaction = this.stageTransition;
    if (transaction) {
      transaction.timer?.remove(false);
      transaction.timer = null;
    }
    this.stageTransition = null;
    this.transitionGeneration += 1;
    this.getUiScene()?.hideStageTransition();
    this.physics.world.resume();
  }

  private getUiScene(): UIScene | null {
    if (!this.scene.isActive('UI') && !this.scene.isPaused('UI')) return null;
    return this.scene.get('UI') as UIScene;
  }

  private handleStageEvents(events: readonly StageDirectorEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case 'stage-started':
          if (
            this.runState.stage.id !== event.stage.id ||
            this.runState.stage.order !== event.stage.order
          ) {
            this.runState.resetStageProgression(event.stage);
          }
          this.cameras.main.setBackgroundColor(event.stage.theme.backgroundColor);
          this.atmosphere.setStage(event.stage);
          this.wave.startStage(event.stage);
          break;
        case 'milestone':
          this.milestones.show(event.milestone);
          break;
        case 'boss-spawn-requested':
          this.wave.spawnBoss();
          break;
        case 'run-ended':
          this.finish(event.reason === 'campaign-complete', event.reason);
          break;
        case 'boss-warning':
          this.atmosphere.pulse(event.stage.theme.dangerColor, 0.28);
          PlatformBridge.haptic('medium');
          break;
        case 'boss-defeated':
          // Kill VFX/hit-stop are emitted by onEnemyDied; the director event owns lifecycle only.
          break;
        case 'stage-transition-requested':
          this.beginStageTransition(event.from, event.to);
          break;
      }
    }
  }

  finish(win: boolean, reason: RunEndReason = win ? 'campaign-complete' : 'defeat'): void {
    if (this.registry.get('runResult')) return;
    if (this.stageDirector.phase !== 'RUN_ENDED') this.stageDirector.endRun(reason);
    const run = this.runState.run;
    const stage = this.runState.stage;
    const evolutions = [...run.evolutionsSeen];
    const records = SaveSystem.recordRun(win, run.timeMs, run.kills, stage.level, evolutions);
    this.captureAchievements(true, false);
    this.registry.set('run', this.snapshot());
    const result: RunResult = {
      win,
      reason,
      timeMs: run.timeMs,
      kills: run.kills,
      hostCellsInfected: run.hostCellsInfected,
      level: stage.level,
      comboBest: run.comboBest,
      stageId: stage.id,
      stageOrder: stage.order,
      bossesDefeated: run.bossesDefeated,
      stacks: { ...stage.stacks },
      evolutions,
      newAchievements: [...this.newAchievements],
      records,
    };
    this.registry.set('runResult', result);
    Sfx.play(win ? 'victory' : 'gameover');
    PlatformBridge.notify(win ? 'success' : 'error');
    this.cameras.main.resetFX();
    this.scene.pause();
  }

  private tryFire(time: number): void {
    const target = this.nearestEnemy(WEAPON.range);
    if (!target) {
      this.aimMarker.setVisible(false);
      return;
    }
    const ang = Math.atan2(target.y - this.player.y, target.x - this.player.x);
    this.aimMarker
      .setVisible(true)
      .setPosition(this.player.x + Math.cos(ang) * 22, this.player.y + Math.sin(ang) * 22)
      .setRotation(ang);
    if (time < this.nextFireAt) return;
    this.nextFireAt = time + this.runState.fireInterval;
    Sfx.play('shoot');
    const n = this.runState.stage.projectiles;
    const spread = (WEAPON.spreadDeg * Math.PI) / 180;
    const prism = this.runState.hasEvolution('prism');
    for (let i = 0; i < n; i++) {
      const a = ang + (i - (n - 1) / 2) * spread;
      const b = this.bullets.get(this.player.x, this.player.y) as Bullet | null;
      if (b) b.fire(time, a, this.runState.bulletDamage, this.runState.bulletPierce, prism);
    }
  }

  private nearestEnemy(range: number): Enemy | null {
    let best: Enemy | null = null;
    let bestD = range;
    const list = this.enemies.getChildren() as Enemy[];
    for (const e of list) {
      if (!e.active) continue;
      const d = Math.hypot(e.x - this.player.x, e.y - this.player.y);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  private syncBlades(now: number): void {
    const st = this.runState;
    const want = st.stage.orbitBlades;
    const halo = st.hasEvolution('halo');
    while (this.blades.length < want) {
      this.blades.push(this.add.image(this.player.x, this.player.y, 'blade').setDepth(12));
    }

    if (halo && want > 0) {
      if (!this.haloRing) {
        this.haloRing = this.add
          .circle(this.player.x, this.player.y, ORBIT.radius)
          .setStrokeStyle(2, COLORS.gold, 0.52)
          .setDepth(11)
          .setBlendMode(Phaser.BlendModes.ADD);
      }
      this.haloRing
        .setVisible(true)
        .setPosition(this.player.x, this.player.y)
        .setAlpha(0.42 + Math.sin(now / 110) * 0.15);
    } else {
      this.haloRing?.setVisible(false);
    }

    if (want === 0) {
      for (const b of this.blades) b.setVisible(false);
      return;
    }
    const base = (now / 1000) * ORBIT.speedDeg * (Math.PI / 180);
    for (let i = 0; i < this.blades.length; i++) {
      const b = this.blades[i];
      if (i >= want) {
        b.setVisible(false);
        continue;
      }
      const a = base + (i * Math.PI * 2) / want;
      b.setVisible(true)
        .setPosition(
          this.player.x + Math.cos(a) * ORBIT.radius,
          this.player.y + Math.sin(a) * ORBIT.radius
        )
        .setRotation(a + Math.PI / 2)
        .setTint(halo ? COLORS.gold : COLORS.white)
        .setBlendMode(halo ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL)
        .setScale(halo ? 1.22 : 1);
    }
    const list = this.enemies.getChildren() as Enemy[];
    for (const e of list) {
      if (!e.active || now < e.bladeImmuneUntil) continue;
      for (let i = 0; i < want; i++) {
        const a = base + (i * Math.PI * 2) / want;
        const bx = this.player.x + Math.cos(a) * ORBIT.radius;
        const by = this.player.y + Math.sin(a) * ORBIT.radius;
        if (Math.hypot(e.x - bx, e.y - by) < e.radius + 14) {
          e.bladeImmuneUntil = now + ORBIT.hitCooldownMs;
          const dx = e.x - this.player.x;
          const dy = e.y - this.player.y;
          const d = Math.hypot(dx, dy) || 1;
          this.vfx.hit(e.x, e.y, halo ? COLORS.gold : e.color);
          e.takeDamage(st.bladeDamage, (dx / d) * 170, (dy / d) * 170);
          Sfx.play('hit');
          this.showDamage(e.x, e.y, st.bladeDamage);
          break;
        }
      }
    }
  }

  private fireNova(): void {
    const st = this.runState;
    const singularity = st.hasEvolution('singularity');
    Sfx.play('nova');
    PlatformBridge.haptic('light');
    if (singularity) this.vfx.singularity(this.player.x, this.player.y, st.novaRadius);
    else this.vfx.nova(this.player.x, this.player.y, st.novaRadius);
    const list = this.enemies.getChildren() as Enemy[];
    for (const e of list) {
      if (!e.active) continue;
      const dx = e.x - this.player.x;
      const dy = e.y - this.player.y;
      const d = Math.hypot(dx, dy);
      if (d < st.novaRadius + e.radius) {
        const dd = d || 1;
        e.takeDamage(st.novaDamage, (dx / dd) * 220, (dy / dd) * 220);
      }
    }
  }

  private onBulletHit = (obj1: unknown, obj2: unknown): void => {
    const b = obj1 as Bullet;
    const e = obj2 as Enemy;
    if (!b.active || !e.active) return;
    if (b.lastHit === e && this.time.now - b.lastHitAt < 220) return;
    b.lastHit = e;
    b.lastHitAt = this.time.now;
    const bv = (b.body as Phaser.Physics.Arcade.Body).velocity;
    const vm = Math.hypot(bv.x, bv.y) || 1;
    this.vfx.hit(e.x, e.y, b.prism ? COLORS.gold : e.color);
    e.takeDamage(b.damage, (bv.x / vm) * 130, (bv.y / vm) * 130);
    Sfx.play('hit');
    this.showDamage(e.x, e.y, b.damage);
    if (b.pierceLeft > 0) b.pierceLeft -= 1;
    else b.disableBody(true, true);
  };

  private onPlayerHit = (obj1: unknown, obj2: unknown): void => {
    const e = obj2 as Enemy;
    if (!e.active || this.stageDirector.phase === 'RUN_ENDED') return;
    const now = this.time.now;
    if (now < this.player.hurtUntil) return;
    this.runState.stage.hp -= e.dmg;
    this.runState.resetNoDamage();
    this.player.markHurt(now);
    Sfx.play('hurt');
    PlatformBridge.haptic('medium');
    this.cameras.main.flash(140, 255, 60, 100);
    const s = JUICE.shakeHurt;
    this.cameras.main.shake(s.duration, s.intensity);
    this.hitStop(JUICE.hitStopMs);
    const dx = e.x - this.player.x;
    const dy = e.y - this.player.y;
    const d = Math.hypot(dx, dy) || 1;
    e.takeDamage(0, (dx / d) * 240, (dy / d) * 240);
    if (this.runState.stage.hp <= 0) this.finish(false);
  };

  private onGemTouch = (obj1: unknown, obj2: unknown): void => {
    (obj2 as Gem).collect();
  };

  private spawnGem(x: number, y: number, value: number): void {
    const g = this.gems.get(x, y) as Gem | null;
    if (g) {
      g.activate(this, x, y, value);
      return;
    }
    const first = this.gems.getFirstAlive() as Gem | null;
    if (first) first.value += value;
  }

  private captureAchievements(runRecorded: boolean, showToast: boolean): void {
    const unlocked = evaluateAchievements(this.runState, runRecorded);
    for (const id of unlocked) {
      if (!this.newAchievements.includes(id)) this.newAchievements.push(id);
      if (showToast) this.showAchievementToast(id);
    }
  }

  private showAchievementToast(id: AchievementId): void {
    const W = this.scale.width;
    const H = this.scale.height;
    const def = getAchievementDef(id);
    const y = Math.max(155, H * 0.25) + ((this.newAchievements.length - 1) % 2) * 62;
    const c = this.add.container(W / 2, y).setScrollFactor(0).setDepth(44).setAlpha(0);
    const panelW = Math.min(W - 36, 340);
    const panel = this.add
      .rectangle(0, 0, panelW, 52, 0x101522, 0.94)
      .setStrokeStyle(1.5, COLORS.gold, 0.82);
    const title = this.add
      .text(-panelW / 2 + 14, -16, 'ДОСТИЖЕНИЕ', {
        fontFamily: FONT,
        fontSize: '9px',
        fontStyle: 'bold',
        color: '#ffe066',
      })
      .setResolution(2);
    const name = this.add
      .text(-panelW / 2 + 14, 0, def.name, {
        fontFamily: FONT,
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#e8f4ff',
      })
      .setResolution(2);
    c.add([panel, title, name]);
    Sfx.play('levelup');
    PlatformBridge.haptic('light');
    this.tweens.add({
      targets: c,
      alpha: 1,
      y: y + 6,
      duration: 160,
      yoyo: true,
      hold: 900,
      onComplete: () => c.destroy(),
    });
  }

  private showIntroHint(): void {
    this.dismissIntroHint(true);
    const W = this.scale.width;
    const H = this.scale.height;
    const c = this.add.container(0, 0).setDepth(60);
    this.introHint = c;
    const panelW = Math.min(W - 28, 370);
    const panelY = H * 0.3 + 8;

    const panel = this.add
      .rectangle(W / 2, panelY, panelW, 86, 0x12070c, 0.68)
      .setStrokeStyle(1, COLORS.magenta, 0.18);
    const title = this.add
      .text(W / 2, H * 0.275, IDENTITY.copy.introTitle, {
        fontFamily: FONT,
        fontSize: W < 370 ? '14px' : '16px',
        fontStyle: 'bold',
        color: '#ff78c8',
        align: 'center',
        lineSpacing: 3,
        wordWrap: { width: panelW - 24 },
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setShadow(0, 0, 'rgba(255,79,181,0.34)', 8, true, true);
    const sub = this.add
      .text(W / 2, H * 0.275 + 45, IDENTITY.copy.introSub, {
        fontFamily: FONT,
        fontSize: W < 370 ? '10px' : '11px',
        color: '#d9b7c5',
        align: 'center',
        wordWrap: { width: panelW - 26 },
      })
      .setOrigin(0.5)
      .setResolution(2);
    c.add([panel, title, sub]);

    c.setAlpha(0);
    this.tweens.add({ targets: c, alpha: 1, duration: 220 });
    this.time.delayedCall(4600, () => {
      if (!c.active || this.introHint !== c) return;
      this.introHint = null;
      this.tweens.add({ targets: c, alpha: 0, duration: 260, onComplete: () => c.destroy() });
    });
  }

  private dismissIntroHint(immediate = false): void {
    const c = this.introHint;
    if (!c) return;
    this.introHint = null;
    this.tweens.killTweensOf(c);
    if (immediate) {
      c.destroy();
      return;
    }
    this.tweens.add({
      targets: c,
      alpha: 0,
      duration: 110,
      ease: 'Quad.Out',
      onComplete: () => c.destroy(),
    });
  }

  private snapshot(): RunSnapshot {
    const run = this.runState.run;
    const stageProgress = this.runState.stage;
    const stage = this.stageDirector.currentStage;
    return {
      hp: stageProgress.hp,
      maxHp: stageProgress.maxHp,
      level: stageProgress.level,
      xp: stageProgress.xp,
      xpNext: stageProgress.xpNext,
      timeMs: run.timeMs,
      stageTimeMs: stageProgress.timeMs,
      kills: run.kills,
      combo: stageProgress.combo,
      bossHp: this.wave.boss?.hp ?? 0,
      bossMax: this.wave.boss?.maxHp ?? 0,
      bossName: stage.boss.name,
      stageId: stage.id,
      stageOrder: stage.order,
      stageName: stage.name,
      phase: this.stageDirector.phase,
    };
  }

  private onResize(): void {
    const W = this.scale.width;
    const H = this.scale.height;
    this.atmosphere.resize();
    this.vignette.setPosition(W / 2, H / 2).setDisplaySize(W * 1.25, H * 1.25);
  }
}
