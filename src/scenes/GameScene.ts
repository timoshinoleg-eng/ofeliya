import Phaser from 'phaser';
import {
  BOSS_SCALE,
  COLORS,
  COMBO,
  DODGE,
  FONT,
  JUICE,
  ORBIT,
  PLAYER,
  POSTFX,
  WEAPON,
  difficulty,
  type EnemyKind,
} from '../game/config';
import {
  evaluateAchievements,
  getAchievementDef,
  type AchievementId,
} from '../game/AchievementSystem';
import { rollRunChoices } from '../game/EvolutionSystem';
import { IDENTITY } from '../game/identity';
import { dailyRng, mathRandom, todayKey } from '../game/SeededRng';
import { Player } from '../game/Player';
import { Enemy } from '../game/Enemy';
import { Bullet } from '../game/Bullet';
import { Gem } from '../game/Gem';
import { RunState } from '../game/RunState';
import type { EvolutionId, UpgradeDef } from '../game/UpgradeSystem';
import { WaveDirector } from '../game/WaveDirector';
import { Analytics } from '../systems/Analytics';
import { AtmosphereSystem } from '../systems/AtmosphereSystem';
import { MessengerBridge } from '../systems/MessengerBridge';
import { ServerClient } from '../systems/ServerClient';
import { SaveSystem } from '../systems/SaveSystem';
import { Sfx } from '../systems/Sfx';
import { ShareVideo } from '../systems/ShareVideo';
import { VfxSystem } from '../systems/VfxSystem';

interface RunSnapshot {
  hp: number;
  maxHp: number;
  level: number;
  xp: number;
  xpNext: number;
  timeMs: number;
  kills: number;
  combo: number;
  bossHp: number;
  bossMax: number;
}

export class GameScene extends Phaser.Scene {
  player!: Player;
  runState!: RunState;

  private atmosphere!: AtmosphereSystem;
  private vignette!: Phaser.GameObjects.Image;
  private vfx!: VfxSystem;
  private bullets!: Phaser.Physics.Arcade.Group;
  private enemies!: Phaser.Physics.Arcade.Group;
  private gems!: Phaser.Physics.Arcade.Group;
  private blades: Phaser.GameObjects.Image[] = [];
  private haloRing: Phaser.GameObjects.Arc | null = null;
  private wave!: WaveDirector;
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
  private dailyMode = false;
  private dailyDateKey = '';
  /** Публичный: UIScene читает для логики паузы/модалок. */
  finished = false;
  /** V5: идёт ли запись клипа (canRecord). */
  private recording = false;
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
  private bloomFx: Phaser.FX.Bloom | null = null;
  private vigFx: Phaser.FX.Vignette | null = null;
  private qualityAcc = 0;
  private qualityFrames = 0;
  private qualityDecided = false;
  private snap: RunSnapshot = {
    hp: 0,
    maxHp: 0,
    level: 1,
    xp: 0,
    xpNext: 1,
    timeMs: 0,
    kills: 0,
    combo: 0,
    bossHp: 0,
    bossMax: 0,
  };
  private dodgeUntil = 0;
  private dodgeCdUntil = 0;
  private dodgeVx = 0;
  private dodgeVy = 0;
  private lastMoveX = 1;
  private lastMoveY = 0;
  /** Реф-бонус (V1): кулдаун рывка −30% на первом забеге по приглашению. */
  private refBuffActive = false;
  /** Rewarded (V6): сколько лечащих бонусов за рекламу уже выдано в этом забеге. */
  private rewardHealsUsed = 0;
  static readonly REWARD_HEAL_LIMIT = 3;

  constructor() {
    super('Game');
  }

  create(data?: { daily?: boolean; dateKey?: string }): void {
    this.runState = new RunState();
    // Daily: сид от даты → одинаковый забег у всех игроков этого дня.
    this.dailyMode = !!(data && data.daily);
    this.dailyDateKey = (data && data.dateKey) || todayKey();
    this.runState.rng = this.dailyMode ? dailyRng(this.dailyDateKey) : mathRandom;
    // Реф-бонус (V1): первый забег по приглашению — +1 HP и рывк быстрее.
    this.refBuffActive = SaveSystem.peekRefBonus() !== null;
    if (this.refBuffActive) {
      this.runState.maxHp += 1;
      this.runState.hp += 1;
    }
    Sfx.startMusic();
    this.queuedLevels = 0;
    this.rewardHealsUsed = 0;
    this.awaitingChoice = false;
    this.pendingChoices = [];
    this.pendingEvolutionCeremony = null;
    this.newAchievements = [];
    this.achievementCheckAcc = 0;
    this.finished = false;
    this.nextFireAt = 0;
    this.novaAcc = 0;
    this.blades = [];
    this.haloRing = null;
    this.hitStopUntil = 0;
    this.hitStopped = false;
    this.lastDmg = null;
    this.lastDmgAt = 0;
    this.dmgCursor = 0;
    this.physics.world.resume();

    const W = this.scale.width;
    const H = this.scale.height;
    this.cameras.main.setBackgroundColor(COLORS.bg);
    // Плавное появление после fadeOut из меню / game over.
    this.cameras.main.fadeIn(320, 11, 14, 26);

    this.atmosphere = new AtmosphereSystem(this);
    this.vignette = this.add
      .image(W / 2, H / 2, 'vignette')
      .setScrollFactor(0)
      .setDepth(28)
      .setDisplaySize(W * 1.25, H * 1.25);

    // Постпроцесс (bloom/vignette) — самый дорогой расход GPU на мобильном.
    // Включаем только если устройство не похоже на слабое; первые 6 секунд
    // меряем FPS и при просадке откатываемся на виньетку-текстуру (см. update).
    const nav = navigator as { hardwareConcurrency?: number; deviceMemory?: number };
    const lowEnd =
      (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4;
    const fxEnabled =
      POSTFX.enabled && this.game.renderer.type === Phaser.WEBGL && !lowEnd;
    if (fxEnabled) {
      const fx = this.cameras.main.postFX;
      this.bloomFx = fx.addBloom(
        0xffffff,
        0,
        0,
        POSTFX.bloom.blurStrength,
        POSTFX.bloom.strength,
        POSTFX.bloom.steps
      );
      this.vigFx = fx.addVignette(
        0.5,
        0.5,
        POSTFX.vignette.radius,
        POSTFX.vignette.strength
      );
    }
    this.vignette.setVisible(!fxEnabled);

    this.player = new Player(this, W / 2, H / 2);
    this.aimMarker = this.add.image(0, 0, 'marker').setDepth(16).setVisible(false);
    this.playerBar = this.add.graphics().setDepth(17);

    this.bullets = this.physics.add.group({ classType: Bullet, maxSize: 160 });
    this.enemies = this.physics.add.group({ classType: Enemy, maxSize: 260 });
    this.gems = this.physics.add.group({ classType: Gem, maxSize: 220 });
    this.vfx = new VfxSystem(this);

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
          .image(0, 0, 'player')
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

    this.wave = new WaveDirector(this, this.enemies);
    this.cameras.main.startFollow(this.player, true, 0.14, 0.14);

    const kb = this.input.keyboard;
    if (kb) {
      this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT') as Record<
        string,
        Phaser.Input.Keyboard.Key
      >;
      // Додж на десктопе: Space или Shift, в текущем направлении движения.
      const dodgeKeys = kb.addKeys(['SPACE', 'SHIFT']);
      for (const k of Object.values(dodgeKeys)) {
        k.on('down', () => this.tryDodge(this.lastMoveX, this.lastMoveY));
      }
    }

    if (!this.scene.isActive('UI')) this.scene.launch('UI');

    this.registry.set('joy', { x: 0, y: 0 });
    this.registry.set('runResult', null);
    this.registry.set('runMode', { daily: this.dailyMode, dateKey: this.dailyDateKey });
    this.registry.set('run', this.snapshot());

    // V5: запись клипа последних секунд (скользящее окно). Только если устройство
    // реально умеет (MediaRecorder/captureStream); иначе тихо пропускаем.
    this.recording = ShareVideo.start(this.game.canvas as HTMLCanvasElement | null);
    if (this.recording) this.registry.set('runClip', null);

    if (SaveSystem.get().runs === 0) {
      this.showIntroHint();
      Analytics.track('first_run');
    }
    Analytics.track('run_started', { daily: this.dailyMode });

    this.scale.on('resize', this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.onResize, this);
      this.atmosphere.destroy();
      this.vfx.destroy();
      // V5: запись не завершена забегом (перезапуск/смена сцены) → просто
      // останавливаем без сохранения клипа.
      if (this.recording) {
        this.recording = false;
        void ShareVideo.stop();
      }
      this.registry.remove('run');
      this.registry.remove('runResult');
      this.registry.remove('runMode');
      this.registry.remove('joy');
      this.registry.remove('runClip');
    });
  }

  update(time: number, delta: number): void {
    if (this.finished) return;
    if (this.hitStopped) {
      if (time < this.hitStopUntil) return;
      this.hitStopped = false;
      this.physics.world.resume();
    }
    const st = this.runState;
    st.timeMs += delta;
    st.tickNoDamage(delta);

    // Адаптивное качество: первые 6 секунд считаем средний FPS; <45 —
    // снимаем постпроцесс (bloom = основной бюджет) и возвращаем виньетку-текстуру.
    if (!this.qualityDecided && this.bloomFx) {
      this.qualityAcc += delta;
      this.qualityFrames += 1;
      if (this.qualityAcc >= 6000) {
        this.qualityDecided = true;
        const fps = this.qualityFrames / (this.qualityAcc / 1000);
        if (fps < 45) this.disablePostFX();
      }
    }
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
    if (len > 0.1) {
      this.lastMoveX = vx;
      this.lastMoveY = vy;
    }
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    if (time < this.dodgeUntil) {
      // Рывок: фиксированный импульс, игнорирует обычный ввод (но не кулдаун).
      body.setVelocity(this.dodgeVx, this.dodgeVy);
    } else {
      const speed = PLAYER.speed * st.speedMul;
      body.setVelocity(vx * speed, vy * speed);
    }

    if (len > 0.1) {
      this.trailAcc += delta;
      if (this.trailAcc >= JUICE.trailEveryMs) {
        this.trailAcc = 0;
        this.spawnTrail();
      }
    } else {
      this.trailAcc = JUICE.trailEveryMs;
    }

    if (st.combo > 0) {
      st.comboTimer -= delta;
      if (st.comboTimer <= 0) {
        st.combo = 0;
        st.comboTimer = 0;
      }
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
      if (this.novaAcc >= st.novaInterval) {
        this.novaAcc = 0;
        this.fireNova();
      }
    }

    if (st.regen > 0) st.hp = Math.min(st.maxHp, st.hp + (st.regen * delta) / 1000);

    this.wave.update(delta);
    this.atmosphere.update(time, delta, st.timeMs);

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
      this.pendingChoices = rollRunChoices(st);
      this.awaitingChoice = true;
      this.queuedLevels -= 1;
    }
  }

  spawnEnemy(kind: EnemyKind, x: number, y: number, elite: boolean): Enemy | null {
    const e = this.enemies.get(x, y) as Enemy | null;
    if (!e) return null;
    const isBoss = kind === 'boss';
    const { hpScale, dmgScale } = difficulty(this.runState.timeMs);
    e.activate(this, kind, x, y, {
      elite,
      hpScale: isBoss ? BOSS_SCALE.hp : hpScale,
      dmgScale: isBoss ? BOSS_SCALE.dmg : dmgScale,
    });
    if (kind === 'boss') {
      Sfx.play('boss');
      this.atmosphere.pulse(COLORS.red, 0.32);
      this.cameras.main.shake(320, 0.008);
      MessengerBridge.haptic('heavy');
      this.showBossIntro();
      Analytics.track('boss_spawned');
    } else if (elite) {
      Sfx.play('elite');
      this.atmosphere.pulse(COLORS.gold, 0.12);
    }
    return e;
  }

  /**
   * Уклонение в направлении (nx, ny). true — если рывок стартовал.
   * i-frames на время рывка + запас: читается как «успел уйти», а не «почти».
   */
  tryDodge(nx: number, ny: number): boolean {
    if (this.finished) return false;
    const now = this.time.now;
    if (now < this.dodgeCdUntil) return false;
    const d = Math.hypot(nx, ny);
    if (d < 0.15) return false;
    this.dodgeVx = (nx / d) * DODGE.speed;
    this.dodgeVy = (ny / d) * DODGE.speed;
    this.lastMoveX = nx;
    this.lastMoveY = ny;
    this.dodgeUntil = now + DODGE.durationMs;
    this.dodgeCdUntil = now + (this.refBuffActive ? DODGE.cooldownMs * 0.7 : DODGE.cooldownMs);
    this.player.hurtUntil = Math.max(this.player.hurtUntil, this.dodgeUntil + DODGE.iframeExtraMs);
    Sfx.play('dodge');
    MessengerBridge.haptic('light');
    this.vfx.dodge(this.player.x, this.player.y, this.dodgeVx, this.dodgeVy);
    Analytics.track('dodge_used', { t: Math.round(this.runState.timeMs / 1000) });
    return true;
  }

  onEnemyDied(e: Enemy): void {
    const st = this.runState;
    st.kills += 1;
    st.combo += 1;
    st.comboTimer = COMBO.windowMs;
    if (st.combo > st.comboBest) st.comboBest = st.combo;
    this.captureAchievements(false, true);
    this.vfx.kill(e.x, e.y, e.color, e.isBoss ? 'boss' : e.isElite ? 'elite' : 'normal');
    if (e.isElite || e.isBoss) {
      this.hitStop(e.isBoss ? JUICE.hitStopBossMs : JUICE.hitStopMs);
      const s = JUICE.shakeEliteKill;
      this.cameras.main.shake(s.duration, s.intensity);
    }
    if (e.xpValue > 0) this.spawnGem(e.x, e.y, e.xpValue);
    if (e.isBoss && this.wave.boss === e) {
      this.wave.boss = null;
      this.cameras.main.shake(400, 0.01);
      this.finish(true);
    }
  }

  private hitStop(ms: number): void {
    if (this.finished) return;
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
    const gained = this.runState.addXp(value);
    this.queuedLevels += gained;
    if (gained > 0) Analytics.track('level_up', { level: this.runState.level });
  }

  chooseUpgrade(id: string): boolean {
    const def = this.pendingChoices.find((c) => c.id === id);
    if (def) {
      def.apply(this.runState);
      if (def.kind === 'evolution' && def.evolutionId) {
        this.pendingEvolutionCeremony = def.evolutionId;
        this.atmosphere.pulse(COLORS.gold, 0.3);
      } else {
        this.runState.bump(id);
      }
      this.captureAchievements(false, false);
      Sfx.play('click');
      MessengerBridge.notify('success');
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

  consumeEvolutionCeremony(): EvolutionId | null {
    const id = this.pendingEvolutionCeremony;
    this.pendingEvolutionCeremony = null;
    return id;
  }

  /** Сколько лечащих rewarded-бонусов ещё доступно в этом забеге. */
  rewardHealsLeft(): number {
    return GameScene.REWARD_HEAL_LIMIT - this.rewardHealsUsed;
  }

  /**
   * Rewarded-бонус (V6): +1 HP за просмотр рекламы. true — если бонус выдан.
   * Лимит на забег, чтобы не спамить; вызывается ТОЛЬКО после 'completed'.
   */
  tryRewardHeal(): boolean {
    if (this.finished) return false;
    if (this.rewardHealsUsed >= GameScene.REWARD_HEAL_LIMIT) return false;
    this.rewardHealsUsed += 1;
    const st = this.runState;
    st.hp = Math.min(st.maxHp, st.hp + 1);
    this.vfx.pickup(this.player.x, this.player.y); // зелёные частицы = здоровье
    return true;
  }

  finish(win: boolean): void {
    if (this.finished) return;
    this.finished = true;
    const st = this.runState;
    const evolutions = [...st.evolutions];
    const records = SaveSystem.recordRun(win, st.timeMs, st.kills, st.level, evolutions);
    // Daily: стрик + результат дня (только в daily-режиме).
    const daily = this.dailyMode
      ? SaveSystem.recordDaily(this.dailyDateKey, { win, timeMs: st.timeMs, kills: st.kills })
      : null;
    // Локальный лидерборд (топ-10).
    const rank = SaveSystem.recordLeaderboard({
      dateKey: this.dailyDateKey || todayKey(),
      daily: this.dailyMode,
      win,
      timeMs: st.timeMs,
      kills: st.kills,
      level: st.level,
    });
    this.captureAchievements(true, false);
    this.registry.set('run', this.snapshot());
    this.registry.set('runResult', {
      win,
      timeMs: st.timeMs,
      kills: st.kills,
      level: st.level,
      comboBest: st.comboBest,
      stacks: { ...st.stacks },
      evolutions,
      newAchievements: [...this.newAchievements],
      records,
      daily,
      rank,
    });
    // V5: клип последних секунд → registry (Promise; UIScene дождётся и
    // покажет кнопку шаринга клипа). Fire-and-forget: сбой записи не трогает UI.
    if (this.recording) {
      this.recording = false;
      this.registry.set('runClip', ShareVideo.stop());
    }
    Analytics.track('run_completed', {
      win,
      timeMs: Math.round(st.timeMs / 1000) * 1000,
      kills: st.kills,
      level: st.level,
      daily: this.dailyMode,
    });
    // Глобальный лидерборд + реферальное рёбро: fire-and-forget,
    // сбой сети не трогает геймплей. Реф привязывается к первому забегу.
    const refFrom = SaveSystem.takeRefBonus();
    if (refFrom) {
      void ServerClient.submitScore({
        daily: this.dailyMode,
        win,
        timeMs: Math.round(st.timeMs),
        kills: st.kills,
        level: st.level,
        dateKey: this.dailyDateKey || todayKey(),
        ref: refFrom,
      });
    } else {
      void ServerClient.submitScore({
        daily: this.dailyMode,
        win,
        timeMs: Math.round(st.timeMs),
        kills: st.kills,
        level: st.level,
        dateKey: this.dailyDateKey || todayKey(),
        ref: null,
      });
    }
    Sfx.play(win ? 'victory' : 'gameover');
    MessengerBridge.notify(win ? 'success' : 'error');
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
    const n = this.runState.projectiles;
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
    const want = st.orbitBlades;
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
    MessengerBridge.haptic('light');
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
    if (!e.active || this.finished) return;
    const now = this.time.now;
    if (now < this.player.hurtUntil) return;
    this.runState.hp -= e.dmg;
    this.runState.resetNoDamage();
    this.player.markHurt(now);
    Sfx.play('hurt');
    MessengerBridge.haptic('medium');
    this.cameras.main.flash(140, 255, 60, 100);
    const s = JUICE.shakeHurt;
    this.cameras.main.shake(s.duration, s.intensity);
    this.hitStop(JUICE.hitStopMs);
    const dx = e.x - this.player.x;
    const dy = e.y - this.player.y;
    const d = Math.hypot(dx, dy) || 1;
    e.takeDamage(0, (dx / d) * 240, (dy / d) * 240);
    if (this.runState.hp <= 0) this.finish(false);
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
    MessengerBridge.haptic('light');
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
    const W = this.scale.width;
    const H = this.scale.height;
    const c = this.add.container(0, 0).setDepth(60);

    const title = this.add
      .text(W / 2, H * 0.3, IDENTITY.copy.introTitle, {
        fontFamily: FONT,
        fontSize: '18px',
        fontStyle: 'bold',
        color: '#35e0ff',
      })
      .setOrigin(0.5)
      .setResolution(2);
    const sub = this.add
      .text(W / 2, H * 0.3 + 30, IDENTITY.copy.introSub, {
        fontFamily: FONT,
        fontSize: '13px',
        color: '#aab4d4',
        align: 'center',
      })
      .setOrigin(0.5)
      .setResolution(2);
    c.add([title, sub]);

    c.setAlpha(0);
    this.tweens.add({ targets: c, alpha: 1, duration: 250 });
    this.time.delayedCall(5000, () => {
      this.tweens.add({ targets: c, alpha: 0, duration: 300, onComplete: () => c.destroy() });
    });
  }

  /**
   * Переиспользуемый snapshot (один объект на всё время забега): UIScene читает
   * его из registry каждый кадр, аллокация — ноль.
   */
  private snapshot(): RunSnapshot {
    const st = this.runState;
    const s = this.snap;
    s.hp = st.hp;
    s.maxHp = st.maxHp;
    s.level = st.level;
    s.xp = st.xp;
    s.xpNext = st.xpNext;
    s.timeMs = st.timeMs;
    s.kills = st.kills;
    s.combo = st.combo;
    s.bossHp = this.wave.boss?.hp ?? 0;
    s.bossMax = this.wave.boss?.maxHp ?? 0;
    return s;
  }

  /** Откат постпроцесса на слабом устройстве: один раз, необратимо в пределах забега. */
  private disablePostFX(): void {
    const fx = this.cameras.main.postFX;
    if (this.bloomFx) {
      fx.remove(this.bloomFx);
      this.bloomFx = null;
    }
    if (this.vigFx) {
      fx.remove(this.vigFx);
      this.vigFx = null;
    }
    this.vignette.setVisible(true);
  }

  /** Скриншот-момент: появление босса — заголовок над ареной. */
  private showBossIntro(): void {
    const W = this.scale.width;
    const H = this.scale.height;
    const c = this.add
      .container(W / 2, Math.max(H * 0.3, 170))
      .setScrollFactor(0)
      .setDepth(46)
      .setAlpha(0);
    c.add(
      this.add
        .text(0, 0, IDENTITY.boss, {
          fontFamily: FONT,
          fontSize: '30px',
          fontStyle: 'bold',
          color: '#ff3860',
        })
        .setOrigin(0.5)
        .setResolution(2)
        .setShadow(0, 0, 'rgba(255,56,96,0.85)', 18, true, true)
    );
    c.add(
      this.add
        .text(0, 34, 'уничтожь узел — это единственная победа', {
          fontFamily: FONT,
          fontSize: '12px',
          color: '#aab4d4',
        })
        .setOrigin(0.5)
        .setResolution(2)
    );
    this.tweens.add({
      targets: c,
      alpha: 1,
      duration: 180,
      yoyo: true,
      hold: 1100,
      onComplete: () => c.destroy(),
    });
  }

  private onResize(): void {
    const W = this.scale.width;
    const H = this.scale.height;
    this.atmosphere.resize();
    this.vignette.setPosition(W / 2, H / 2).setDisplaySize(W * 1.25, H * 1.25);
  }
}
