import Phaser from 'phaser';
import {
  BOSS_SCALE,
  COLORS,
  COMBO,
  FONT,
  JUICE,
  ORBIT,
  PLAYER,
  POSTFX,
  WEAPON,
  difficulty,
  type EnemyKind,
} from '../game/config';
import { Player } from '../game/Player';
import { Enemy } from '../game/Enemy';
import { Bullet } from '../game/Bullet';
import { Gem } from '../game/Gem';
import { RunState } from '../game/RunState';
import { rollChoices, type UpgradeDef } from '../game/UpgradeSystem';
import { WaveDirector } from '../game/WaveDirector';
import { MaxBridge } from '../systems/MaxBridge';
import { SaveSystem } from '../systems/SaveSystem';
import { Sfx } from '../systems/Sfx';

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

  private grid!: Phaser.GameObjects.TileSprite;
  private vignette!: Phaser.GameObjects.Image;
  private bullets!: Phaser.Physics.Arcade.Group;
  private enemies!: Phaser.Physics.Arcade.Group;
  private gems!: Phaser.Physics.Arcade.Group;
  private blades: Phaser.GameObjects.Image[] = [];
  private wave!: WaveDirector;
  private aimMarker!: Phaser.GameObjects.Image;
  private playerBar!: Phaser.GameObjects.Graphics;
  private deathEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private pickupEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;

  private nextFireAt = 0;
  private novaAcc = 0;
  private queuedLevels = 0;
  awaitingChoice = false;
  pendingChoices: UpgradeDef[] = [];
  private finished = false;
  // hit-stop: пока время заморожено, симуляция стоит (см. update)
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

  constructor() {
    super('Game');
  }

  create(): void {
    this.runState = new RunState();
    Sfx.startMusic();
    this.queuedLevels = 0;
    this.awaitingChoice = false;
    this.pendingChoices = [];
    this.finished = false;
    this.nextFireAt = 0;
    this.novaAcc = 0;
    this.blades = [];
    this.hitStopUntil = 0;
    this.hitStopped = false;
    this.lastDmg = null;
    this.lastDmgAt = 0;
    this.dmgCursor = 0;
    // на старом забеге мог остаться замороженный мир (hit-stop на момент смерти)
    this.physics.world.resume();

    const W = this.scale.width;
    const H = this.scale.height;
    this.cameras.main.setBackgroundColor(COLORS.bg);

    this.grid = this.add
      .tileSprite(0, 0, W, H, 'grid')
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(-10);
    this.vignette = this.add
      .image(W / 2, H / 2, 'vignette')
      .setScrollFactor(0)
      .setDepth(28)
      .setDisplaySize(W * 1.25, H * 1.25);

    // Встроенные постэффекты (только WebGL): неоновый bloom + мягкая виньетка.
    // addBloom/addVignette сами резолвят пайплайны по строковым именам и линкуют
    // контроллеры; успех проверяется через hasPostPipeline (postFX.list — только pre-FX).
    // В Canvas-режиме остаётся текстурная виньетка, флаг — в POSTFX.enabled.
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

    this.deathEmitter = this.add
      .particles(0, 0, 'spark', {
        speed: { min: 60, max: 190 },
        lifespan: { min: 200, max: 420 },
        scale: { start: 1, end: 0 },
        blendMode: 'ADD',
        emitting: false,
      })
      .setDepth(20);
    this.pickupEmitter = this.add
      .particles(0, 0, 'spark', {
        speed: { min: 40, max: 110 },
        lifespan: 260,
        scale: { start: 0.8, end: 0 },
        blendMode: 'ADD',
        emitting: false,
      })
      .setDepth(20);

    // пул всплывающих цифр урона: создаём заранее, в бою только переиспользуем
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

    // трейл игрока: пул спрайтов, гасим твином. Глубина 14 — под игроком (15)
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
    }

    if (!this.scene.isActive('UI')) this.scene.launch('UI');

    this.registry.set('joy', { x: 0, y: 0 });
    this.registry.set('runResult', null);
    this.registry.set('run', this.snapshot());

    // подсказка только в самый первый забег (runs инкрементится в finish())
    if (SaveSystem.get().runs === 0) this.showIntroHint();

    this.scale.on('resize', this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.onResize, this);
      this.registry.remove('run');
      this.registry.remove('runResult');
      this.registry.remove('joy');
    });
  }

  update(time: number, delta: number): void {
    if (this.finished) return;
    // hit-stop: физика заморожена через world.pause, здесь — выход из фриза.
    // Снимаем по игровому времени, а не таймером: если сцену поставили на паузу
    // модалкой левелапа, мир поднимется сразу на первом же кадре после снятия.
    if (this.hitStopped) {
      if (time < this.hitStopUntil) return;
      this.hitStopped = false;
      this.physics.world.resume();
    }
    const st = this.runState;
    st.timeMs += delta;

    // движение: WASD/стрелки + виртуальный джойстик
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

    // трейл — только на реальном движении; на стоянке аккумулятор держим
    // заряженным, чтобы первый же шаг сразу дал след
    if (len > 0.1) {
      this.trailAcc += delta;
      if (this.trailAcc >= JUICE.trailEveryMs) {
        this.trailAcc = 0;
        this.spawnTrail();
      }
    } else {
      this.trailAcc = JUICE.trailEveryMs;
    }

    // комбо: серия убийств, сбрасывается паузой дольше COMBO.windowMs
    if (st.combo > 0) {
      st.comboTimer -= delta;
      if (st.comboTimer <= 0) {
        st.combo = 0;
        st.comboTimer = 0;
      }
    }

    // мигание в кадрах неуязвимости
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

    const cam = this.cameras.main;
    this.grid.tilePositionX = cam.scrollX;
    this.grid.tilePositionY = cam.scrollY;

    // мини-полоска HP над игроком
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
      this.pendingChoices = rollChoices(st);
      this.awaitingChoice = true;
      this.queuedLevels -= 1;
    }
  }

  // --- спавн и события ---

  spawnEnemy(kind: EnemyKind, x: number, y: number, elite: boolean): Enemy | null {
    const e = this.enemies.get(x, y) as Enemy | null;
    if (!e) return null;
    // босс — фиксированный климакс: кривая сложности к нему не применяется
    const isBoss = kind === 'boss';
    const { hpScale, dmgScale } = difficulty(this.runState.timeMs);
    e.activate(this, kind, x, y, {
      elite,
      hpScale: isBoss ? BOSS_SCALE.hp : hpScale,
      dmgScale: isBoss ? BOSS_SCALE.dmg : dmgScale,
    });
    if (kind === 'boss') {
      Sfx.play('boss');
      this.cameras.main.shake(320, 0.008);
      MaxBridge.haptic('heavy');
    } else if (elite) {
      Sfx.play('elite');
    }
    return e;
  }

  onEnemyDied(e: Enemy): void {
    const st = this.runState;
    st.kills += 1;
    st.combo += 1;
    st.comboTimer = COMBO.windowMs;
    if (st.combo > st.comboBest) st.comboBest = st.combo;
    (this.deathEmitter as unknown as { setParticleTint?: (c: number) => void }).setParticleTint?.(
      e.color
    );
    this.deathEmitter.emitParticleAt(e.x, e.y, e.isBoss ? 30 : e.isElite ? 16 : 8);
    if (e.isElite || e.isBoss) {
      // элита и босс — заметные смерти: фриз + тряска, обычная толпа — без фриза,
      // иначе на 200+ убийств и рассыпается в слайд-шоу
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

  // --- фидбек: hit-stop и цифры урона ---

  /**
   * Короткая остановка симуляции. Физика замирает через world.pause()
   * (иначе враги продолжают идти по preUpdate), сцена — через hitStopUntil.
   * minGapMs не даёт фризам накладываться друг на друга.
   */
  private hitStop(ms: number): void {
    if (this.finished) return;
    const now = this.time.now;
    if (now < this.hitStopUntil + JUICE.hitStopMinGapMs) return;
    this.hitStopUntil = now + ms;
    this.hitStopped = true;
    this.physics.world.pause();
  }

  /** Всплывающая цифра урона над врагом (пул, без аллокаций в бою). */
  private showDamage(x: number, y: number, amount: number): void {
    if (amount <= 0) return;
    const now = this.time.now;
    const last = this.lastDmg;
    // склейка: серия попаданий в одну цель — одна растущая цифра вместо россыпи
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

  /** След игрока: тот же спрайт, но бледнее и меньше — ощущение скорости. */
  private spawnTrail(): void {
    const t = this.trail[this.trailCursor];
    this.trailCursor = (this.trailCursor + 1) % this.trail.length;
    this.tweens.killTweensOf(t);
    t.setPosition(this.player.x, this.player.y)
      .setVisible(true)
      .setAlpha(0.32)
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
    (this.pickupEmitter as unknown as { setParticleTint?: (c: number) => void }).setParticleTint?.(
      COLORS.green
    );
    this.pickupEmitter.emitParticleAt(this.player.x, this.player.y, 3);
    this.queuedLevels += this.runState.addXp(value);
  }

  /** Выбор улучшения из UI-сцены. true — есть ещё ожидающие уровни. */
  chooseUpgrade(id: string): boolean {
    const def = this.pendingChoices.find((c) => c.id === id);
    if (def) {
      def.apply(this.runState);
      this.runState.bump(id);
      Sfx.play('click');
      MaxBridge.notify('success');
    }
    if (this.queuedLevels > 0) {
      this.queuedLevels -= 1;
      this.pendingChoices = rollChoices(this.runState);
      return true;
    }
    this.awaitingChoice = false;
    this.pendingChoices = [];
    return false;
  }

  finish(win: boolean): void {
    if (this.finished) return;
    this.finished = true;
    const st = this.runState;
    const records = SaveSystem.recordRun(st.timeMs, st.kills, st.level);
    this.registry.set('run', this.snapshot());
    this.registry.set('runResult', {
      win,
      timeMs: st.timeMs,
      kills: st.kills,
      level: st.level,
      records,
    });
    Sfx.play(win ? 'victory' : 'gameover');
    MaxBridge.notify(win ? 'success' : 'error');
    // сцена встаёт на паузу в этом же кадре — эффекты камеры больше не обновятся,
    // поэтому сбрасываем их вручную, иначе вспышка урона «залипает» на экране итогов
    this.cameras.main.resetFX();
    this.scene.pause();
  }

  // --- оружие ---

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
    for (let i = 0; i < n; i++) {
      const a = ang + (i - (n - 1) / 2) * spread;
      const b = this.bullets.get(this.player.x, this.player.y) as Bullet | null;
      if (b) b.fire(time, a, this.runState.bulletDamage, this.runState.pierce);
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
    while (this.blades.length < want) {
      this.blades.push(this.add.image(this.player.x, this.player.y, 'blade').setDepth(12));
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
      b.setVisible(true);
      b.setPosition(
        this.player.x + Math.cos(a) * ORBIT.radius,
        this.player.y + Math.sin(a) * ORBIT.radius
      );
      b.setRotation(a + Math.PI / 2);
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
    Sfx.play('nova');
    MaxBridge.haptic('light');
    const ring = this.add
      .circle(this.player.x, this.player.y, 12, COLORS.cyan, 0.3)
      .setDepth(19);
    this.tweens.add({
      targets: ring,
      scale: st.novaRadius / 12,
      alpha: 0,
      duration: 360,
      ease: 'Quad.Out',
      onComplete: () => ring.destroy(),
    });
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

  // --- коллизии ---

  private onBulletHit = (obj1: unknown, obj2: unknown): void => {
    const b = obj1 as Bullet;
    const e = obj2 as Enemy;
    if (!b.active || !e.active) return;
    if (b.lastHit === e && this.time.now - b.lastHitAt < 220) return;
    b.lastHit = e;
    b.lastHitAt = this.time.now;
    const bv = (b.body as Phaser.Physics.Arcade.Body).velocity;
    const vm = Math.hypot(bv.x, bv.y) || 1;
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
    this.player.markHurt(now);
    Sfx.play('hurt');
    MaxBridge.haptic('medium');
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

  // --- прочее ---

  private spawnGem(x: number, y: number, value: number): void {
    const g = this.gems.get(x, y) as Gem | null;
    if (g) {
      g.activate(this, x, y, value);
      return;
    }
    const first = this.gems.getFirstAlive() as Gem | null;
    if (first) first.value += value;
  }

  // --- онбординг первого забега ---

  /** Короткая подсказка в первом забеге: управление + авто-огонь. */
  private showIntroHint(): void {
    const W = this.scale.width;
    const H = this.scale.height;
    const c = this.add.container(0, 0).setDepth(60);

    const title = this.add
      .text(W / 2, H * 0.3, 'Двигай — джойстик или WASD', {
        fontFamily: FONT,
        fontSize: '18px',
        fontStyle: 'bold',
        color: '#35e0ff',
      })
      .setOrigin(0.5)
      .setResolution(2);
    const sub = this.add
      .text(W / 2, H * 0.3 + 30, 'оружие стреляет само · собирай опыт', {
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
    // самоубирается через 5 с, даже если игрок так и не пошёл
    this.time.delayedCall(5000, () => {
      this.tweens.add({ targets: c, alpha: 0, duration: 300, onComplete: () => c.destroy() });
    });
  }

  private snapshot(): RunSnapshot {
    const st = this.runState;
    return {
      hp: st.hp,
      maxHp: st.maxHp,
      level: st.level,
      xp: st.xp,
      xpNext: st.xpNext,
      timeMs: st.timeMs,
      kills: st.kills,
      combo: st.combo,
      bossHp: this.wave.boss?.hp ?? 0,
      bossMax: this.wave.boss?.maxHp ?? 0,
    };
  }

  private onResize(): void {
    const W = this.scale.width;
    const H = this.scale.height;
    this.grid.setSize(W, H);
    this.vignette.setPosition(W / 2, H / 2).setDisplaySize(W * 1.25, H * 1.25);
  }
}
