import Phaser from 'phaser';
import { getAchievementDef } from '../game/AchievementSystem';
import {
  createChallengePayload,
  encodeChallengePayload,
  isChallengeBeaten,
  type ChallengePayload,
} from '../game/Challenge';
import { COLORS, COMBO, FONT, JUICE, fmtTime } from '../game/config';
import { getEvolutionDef } from '../game/EvolutionSystem';
import { IDENTITY } from '../game/identity';
import { Joystick } from '../game/Joystick';
import { getLegendaryDefinition, type LegendaryId } from '../game/LegendarySystem';
import { TwinStickControls } from '../game/TwinStickControls';
import { readControlMode, type ControlMode } from '../game/ControlMode';
import type { RunResult, RunSnapshot } from '../game/RunContracts';
import {
  EVOLUTION_NAMES,
  UPGRADE_FAMILY_LABELS,
  UPGRADES,
  getUpgradeProgress,
  type EvolutionId,
  type UpgradeDef,
} from '../game/UpgradeSystem';
import { PlatformBridge } from '../platform';
import { Sfx } from '../systems/Sfx';
import { submitRunScore } from '../systems/ScoreClient';
import type { GameScene } from './GameScene';

const DEPTH = 50;

type TintableEmitter = Phaser.GameObjects.Particles.ParticleEmitter & {
  setParticleTint?: (color: number) => void;
};

export class UIScene extends Phaser.Scene {
  private gs: GameScene | null = null;

  private xpBack!: Phaser.GameObjects.Graphics;
  private xpFill!: Phaser.GameObjects.Graphics;
  private hpBack!: Phaser.GameObjects.Graphics;
  private hpFill!: Phaser.GameObjects.Graphics;
  private bossBack!: Phaser.GameObjects.Graphics;
  private bossFill!: Phaser.GameObjects.Graphics;
  private bossLabel!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private levelText!: Phaser.GameObjects.Text;
  private killsText!: Phaser.GameObjects.Text;
  private hpText!: Phaser.GameObjects.Text;
  private muteText!: Phaser.GameObjects.Text;
  private pauseText!: Phaser.GameObjects.Text;
  private joystick: Joystick | null = null;
  private twinStick: TwinStickControls | null = null;
  private hpWarn!: Phaser.GameObjects.Graphics;
  private fanfare!: Phaser.GameObjects.Particles.ParticleEmitter;
  private comboText!: Phaser.GameObjects.Text;
  private lastCombo = 0;

  private modal: Phaser.GameObjects.Container | null = null;
  private transitionOverlay: Phaser.GameObjects.Container | null = null;
  private pauseOverlay: Phaser.GameObjects.Container | null = null;
  private manualPaused = false;
  private modalOpen = false;
  private modalGeneration = 0;
  private overShown = false;
  private uiBlocked = false;

  constructor() {
    super('UI');
  }

  create(): void {
    this.gs = this.scene.get('Game') as GameScene;
    this.modalOpen = false;
    this.modalGeneration = 0;
    this.overShown = false;
    this.uiBlocked = false;
    this.modal = null;
    this.transitionOverlay = null;
    this.pauseOverlay = null;
    this.manualPaused = false;

    const W = this.scale.width;

    this.xpBack = this.add.graphics().setDepth(DEPTH);
    this.xpFill = this.add.graphics().setDepth(DEPTH + 1);
    this.hpBack = this.add.graphics().setDepth(DEPTH);
    this.hpFill = this.add.graphics().setDepth(DEPTH + 1);
    this.bossBack = this.add.graphics().setDepth(DEPTH);
    this.bossFill = this.add.graphics().setDepth(DEPTH + 1);

    const text = (
      x: number,
      y: number,
      s: string,
      size: number,
      color: string,
      ox = 0.5
    ): Phaser.GameObjects.Text =>
      this.add
        .text(x, y, s, { fontFamily: FONT, fontSize: `${size}px`, color })
        .setOrigin(ox, 0)
        .setResolution(2)
        .setDepth(DEPTH + 1);

    this.timerText = text(W / 2, 28, '00:00', 24, '#e8f4ff');
    this.levelText = text(16, 30, 'МУТАЦИЯ 1', 13, '#ff78c8', 0);
    this.killsText = text(W - 16, 30, 'ИММУН. 0', 13, '#dff8ff', 1);
    this.hpText = text(W / 2, 58, '', 10, '#e8f4ff');
    this.bossLabel = text(W / 2, 72, IDENTITY.boss, 11, '#ff3860');
    this.muteText = this.add
      .text(W - 16, 54, '♪', { fontFamily: FONT, fontSize: '16px', color: Sfx.muted ? '#5a6480' : '#35e0ff' })
      .setOrigin(1, 0)
      .setResolution(2)
      .setDepth(DEPTH + 1)
      .setInteractive({ useHandCursor: true })
      .on('pointerup', () => {
        const muted = Sfx.toggle();
        this.muteText.setText('♪').setColor(muted ? '#5a6480' : '#35e0ff');
      });

    this.pauseText = this.add
      .text(W - 44, 52, 'Ⅱ', {
        fontFamily: FONT,
        fontSize: '14px',
        fontStyle: 'bold',
        color: '#35e0ff',
        backgroundColor: '#141a2e',
        padding: { x: 7, y: 4 },
      })
      .setOrigin(1, 0)
      .setResolution(2)
      .setDepth(DEPTH + 2)
      .setInteractive({ useHandCursor: true })
      .on('pointerup', () => this.showPauseMenu());

    this.hpWarn = this.add.graphics().setDepth(DEPTH - 1);
    this.fanfare = this.add
      .particles(0, 0, 'spark', {
        speed: { min: 140, max: 330 },
        lifespan: { min: 320, max: 620 },
        scale: { start: 1, end: 0 },
        blendMode: 'ADD',
        tint: COLORS.cyan,
        emitting: false,
      })
      .setDepth(101);

    this.lastCombo = 0;
    this.comboText = this.add
      .text(16, 54, '', {
        fontFamily: FONT,
        fontSize: '18px',
        fontStyle: 'bold',
        color: '#ffe066',
      })
      .setResolution(2)
      .setDepth(DEPTH + 1)
      .setVisible(false);

    const controlMode =
      (this.registry.get('controlMode') as ControlMode | undefined) ?? readControlMode();
    this.registry.set('controlMode', controlMode);
    this.joystick = null;
    this.twinStick = null;
    if (controlMode === 'two-hand') {
      this.twinStick = new TwinStickControls(this, () => this.uiBlocked);
    } else {
      // Preserve the established one-thumb control path exactly as-is.
      this.joystick = new Joystick(this, () => this.uiBlocked);
    }

    this.scale.on('resize', this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.layout, this);
      this.pauseOverlay = null;
      this.manualPaused = false;
    });
    this.layout();
  }

  update(): void {
    const run = this.registry.get('run') as RunSnapshot | undefined;
    const W = this.scale.width;
    const H = this.scale.height;
    if (run) {
      this.xpBack.clear();
      this.xpBack.fillStyle(0x1a2136, 0.9);
      this.xpBack.fillRoundedRect(12, 12, W - 24, 10, 5);
      this.xpFill.clear();
      const xf = Phaser.Math.Clamp(run.xp / run.xpNext, 0, 1);
      if (xf > 0) {
        this.xpFill.fillStyle(COLORS.magenta, 1);
        this.xpFill.fillRoundedRect(12, 12, Math.max((W - 24) * xf, 10), 10, 5);
      }

      this.timerText.setText(fmtTime(run.timeMs));
      this.levelText.setText(`МУТАЦИЯ ${run.level}`);
      this.killsText.setText(`ИММУН. ${run.kills}`);

      const showCombo = run.combo >= COMBO.showFrom;
      this.comboText.setVisible(showCombo);
      if (showCombo && run.combo !== this.lastCombo) {
        this.lastCombo = run.combo;
        this.comboText.setText(`×${run.combo}`);
        this.tweens.killTweensOf(this.comboText);
        this.comboText.setScale(1.4);
        this.tweens.add({ targets: this.comboText, scale: 1, duration: 200, ease: 'Quad.Out' });
      } else if (!showCombo) {
        this.lastCombo = 0;
      }

      const bw = 200;
      const bx = W / 2 - bw / 2;
      this.hpBack.clear();
      this.hpBack.fillStyle(0x1a2136, 0.9);
      this.hpBack.fillRoundedRect(bx, 54, bw, 12, 6);
      this.hpFill.clear();
      const hf = Phaser.Math.Clamp(run.hp / run.maxHp, 0, 1);
      if (hf > 0) {
        this.hpFill.fillStyle(hf > 0.35 ? COLORS.green : 0xff5a5a, 1);
        this.hpFill.fillRoundedRect(bx, 54, Math.max(bw * hf, 10), 12, 6);
      }
      this.hpText.setText(`${Math.ceil(Math.max(0, run.hp))} / ${run.maxHp}`);

      this.hpWarn.clear();
      if (run.hp > 0 && hf <= JUICE.lowHpFraction) {
        const a = 0.22 + 0.22 * Math.sin(this.time.now / 120);
        this.hpWarn.lineStyle(16, COLORS.red, a);
        this.hpWarn.strokeRect(8, 8, W - 16, H - 16);
      }

      const boss = run.bossMax > 0;
      this.bossBack.setVisible(boss);
      this.bossFill.setVisible(boss);
      this.bossLabel.setVisible(boss);
      if (boss) {
        this.bossLabel.setText(run.bossName);
        this.bossBack.clear();
        this.bossBack.fillStyle(0x1a2136, 0.9);
        this.bossBack.fillRoundedRect(W / 2 - 140, 82, 280, 9, 4);
        this.bossFill.clear();
        this.bossFill.fillStyle(COLORS.red, 1);
        this.bossFill.fillRoundedRect(
          W / 2 - 140,
          82,
          Math.max(280 * Phaser.Math.Clamp(run.bossHp / run.bossMax, 0, 1), 8),
          9,
          4
        );
      }
    }

    if (this.gs && this.gs.awaitingChoice && !this.modalOpen && !this.overShown) {
      this.showLevelUp();
    }

    const res = this.registry.get('runResult') as RunResult | undefined | null;
    if (res && !this.overShown) {
      this.overShown = true;
      this.hideModal();
      this.hideStageTransition();
      this.showGameOver(res);
    }
  }

  showStageTransition(fromName: string, toName: string, accent: number, onSkip: () => void): void {
    this.hideModal();
    this.hideStageTransition();
    this.uiBlocked = true;

    const W = this.scale.width;
    const H = this.scale.height;
    const compact = H < 620;
    const c = this.add.container(0, 0).setDepth(160);
    this.transitionOverlay = c;

    const dim = this.add.rectangle(W / 2, H / 2, W, H, 0x050308, 0.96).setInteractive();
    dim.on('pointerup', onSkip);
    c.add(dim);

    if (this.textures.exists('cinematic-heart')) {
      const keyArt = this.add
        .image(W / 2, H * 0.47, 'cinematic-heart')
        .setDisplaySize(Math.min(W * 1.04, 520), Math.min(H * 0.38, 260))
        .setAlpha(0.58);
      c.add(keyArt);
      keyArt.setScale(keyArt.scaleX * 1.04, keyArt.scaleY * 1.04);
      this.tweens.add({
        targets: keyArt,
        scaleX: keyArt.scaleX * 0.97,
        scaleY: keyArt.scaleY * 0.97,
        alpha: 0.72,
        duration: 1800,
        ease: 'Sine.InOut',
      });
    }

    // Lightweight 2.5D cinematic layer: existing procedural textures, no video payload.
    if (this.textures.exists('heart-plasma')) {
      const flow = this.add
        .tileSprite(0, 0, W, H, 'heart-plasma')
        .setOrigin(0)
        .setAlpha(0.28)
        .setBlendMode(Phaser.BlendModes.ADD);
      c.add(flow);
      this.tweens.add({
        targets: flow,
        tilePositionX: 150,
        tilePositionY: -50,
        duration: 2600,
        ease: 'Sine.InOut',
      });
    }
    if (this.textures.exists('cardiac-fiber')) {
      const fibers = this.add
        .image(W / 2, H / 2, 'cardiac-fiber')
        .setDisplaySize(W * 1.2, H * 1.05)
        .setAlpha(0.15)
        .setBlendMode(Phaser.BlendModes.ADD);
      c.add(fibers);
      this.tweens.add({
        targets: fibers,
        scaleX: fibers.scaleX * 1.05,
        scaleY: fibers.scaleY * 1.05,
        alpha: 0.25,
        duration: 850,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      });
    }
    c.add([
      this.add.rectangle(W / 2, H * 0.055, W, H * 0.11, 0x020204, 0.96),
      this.add.rectangle(W / 2, H * 0.945, W, H * 0.11, 0x020204, 0.96),
    ]);

    const outerPulse = this.add
      .circle(W / 2, H * 0.47, compact ? 38 : 46)
      .setStrokeStyle(2.4, accent, 0.72);
    const innerPulse = this.add
      .circle(W / 2, H * 0.47, compact ? 18 : 22, accent, 0.055)
      .setStrokeStyle(1.4, COLORS.white, 0.48);
    c.add([outerPulse, innerPulse]);

    c.add(
      this.add
        .text(W / 2, H * 0.34, 'ОРГАН ДОСТИГНУТ', {
          fontFamily: FONT,
          fontSize: compact ? '13px' : '15px',
          fontStyle: 'bold',
          color: '#aab4d4',
          letterSpacing: 2,
        })
        .setOrigin(0.5)
        .setResolution(2)
    );
    c.add(
      this.add
        .text(W / 2, H * 0.45, toName.toUpperCase(), {
          fontFamily: FONT,
          fontSize: compact ? '32px' : '40px',
          fontStyle: 'bold',
          color: `#${accent.toString(16).padStart(6, '0')}`,
          align: 'center',
        })
        .setOrigin(0.5)
        .setResolution(2)
        .setShadow(0, 0, `#${accent.toString(16).padStart(6, '0')}`, 16, true, true)
    );
    c.add(
      this.add
        .text(W / 2, H * 0.56, `${fromName}  →  ${toName}`, {
          fontFamily: FONT,
          fontSize: compact ? '12px' : '14px',
          color: '#fff4ec',
        })
        .setOrigin(0.5)
        .setResolution(2)
    );
    c.add(
      this.add
        .text(W / 2, H * 0.64, 'ШТАММ ПЕРЕСТРАИВАЕТСЯ\nнажми, чтобы ускорить', {
          fontFamily: FONT,
          fontSize: compact ? '10px' : '12px',
          color: '#aab4d4',
          align: 'center',
          lineSpacing: 5,
        })
        .setOrigin(0.5)
        .setResolution(2)
    );

    const line = this.add.rectangle(W / 2, H * 0.515, Math.min(W - 72, 250), 3, accent, 0.9);
    c.add(line);
    c.setAlpha(0);
    this.tweens.add({ targets: c, alpha: 1, duration: 180, ease: 'Quad.Out' });
    this.tweens.add({ targets: line, scaleX: 0.38, alpha: 0.38, yoyo: true, repeat: -1, duration: 420 });
    this.tweens.add({
      targets: outerPulse,
      scale: 1.55,
      alpha: 0.12,
      duration: 760,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    });
    this.tweens.add({
      targets: innerPulse,
      scale: 0.78,
      alpha: 0.72,
      duration: 360,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    });
  }

  showBossReveal(name: string, textureKey: string, accent: number): void {
    if (this.transitionOverlay || this.modalOpen) return;
    const W = this.scale.width;
    const H = this.scale.height;
    const compact = H < 620;
    const c = this.add.container(0, 0).setDepth(150).setAlpha(0);

    const bandH = compact ? 150 : 178;
    const band = this.add
      .rectangle(W / 2, H / 2, W, bandH, 0x040308, 0.78)
      .setStrokeStyle(1, accent, 0.4);
    const lineTop = this.add.rectangle(W / 2, H / 2 - bandH / 2, W, 2, accent, 0.82);
    const lineBottom = this.add.rectangle(W / 2, H / 2 + bandH / 2, W, 2, accent, 0.5);
    c.add([band, lineTop, lineBottom]);

    const cinematicKey =
      textureKey === 'immune-prime'
        ? 'cinematic-immune-prime'
        : textureKey === 'cardiac-titan'
          ? 'cinematic-cardiac-titan'
          : null;
    if (cinematicKey && this.textures.exists(cinematicKey)) {
      const art = this.add
        .image(W / 2, H / 2, cinematicKey)
        .setDisplaySize(W, bandH)
        .setAlpha(0.5);
      c.add(art);
      art.setScale(1.04, 1.04);
      this.tweens.add({
        targets: art,
        scaleX: 1,
        scaleY: 1,
        alpha: 0.64,
        duration: 760,
        ease: 'Quad.Out',
      });
    }

    if (this.textures.exists(textureKey)) {
      const portrait = this.add
        .image(W * 0.28, H / 2, textureKey)
        .setScale(compact ? 1.22 : 1.48)
        .setAlpha(0.92)
        .setBlendMode(Phaser.BlendModes.ADD);
      c.add(portrait);
      portrait.setX(W * 0.22);
      this.tweens.add({
        targets: portrait,
        x: W * 0.3,
        scale: portrait.scaleX * 1.08,
        duration: 760,
        ease: 'Quad.Out',
      });
    }

    c.add(
      this.add
        .text(W * 0.57, H / 2 - 30, 'ИММУННЫЙ КОНТАКТ', {
          fontFamily: FONT,
          fontSize: compact ? '10px' : '11px',
          fontStyle: 'bold',
          color: '#aab4d4',
          letterSpacing: 2,
        })
        .setOrigin(0, 0.5)
        .setResolution(2)
    );
    c.add(
      this.add
        .text(W * 0.57, H / 2 + 4, name, {
          fontFamily: FONT,
          fontSize: compact ? '21px' : '26px',
          fontStyle: 'bold',
          color: `#${accent.toString(16).padStart(6, '0')}`,
          wordWrap: { width: W * 0.38 },
        })
        .setOrigin(0, 0.5)
        .setResolution(2)
        .setShadow(0, 0, `#${accent.toString(16).padStart(6, '0')}`, 12, true, true)
    );
    c.add(
      this.add
        .text(W * 0.57, H / 2 + 39, 'АДАПТАЦИЯ НАЧАЛАСЬ', {
          fontFamily: FONT,
          fontSize: compact ? '9px' : '10px',
          color: '#fff4ec',
        })
        .setOrigin(0, 0.5)
        .setResolution(2)
    );

    this.tweens.add({
      targets: c,
      alpha: 1,
      duration: 120,
      yoyo: true,
      hold: 700,
      ease: 'Quad.Out',
      onComplete: () => c.destroy(true),
    });
  }

  hideStageTransition(): void {
    if (!this.transitionOverlay) return;
    this.tweens.killTweensOf(this.transitionOverlay);
    this.transitionOverlay.destroy(true);
    this.transitionOverlay = null;
    this.uiBlocked = false;
  }

  dismissProgressionForStageBoundary(): void {
    this.modalGeneration += 1;
    const modal = this.modal;
    if (modal) {
      this.tweens.killTweensOf(modal);
      for (const child of modal.list) this.tweens.killTweensOf(child);
    }
    this.hideModal();
    if (this.scene.isPaused('Game')) this.scene.resume('Game');
  }

  private layout(): void {
    const W = this.scale.width;
    this.timerText.setX(W / 2);
    this.levelText.setX(16);
    this.killsText.setX(W - 16);
    this.hpText.setX(W / 2);
    this.bossLabel.setX(W / 2);
    this.muteText.setX(W - 16);
    this.pauseText.setX(W - 44);
  }

  private showPauseMenu(): void {
    if (
      this.manualPaused ||
      this.modalOpen ||
      this.transitionOverlay ||
      this.overShown ||
      this.uiBlocked ||
      !this.scene.isActive('Game')
    ) {
      return;
    }

    this.manualPaused = true;
    this.uiBlocked = true;
    this.registry.set('joy', { x: 0, y: 0 });
    this.registry.set('aimJoy', { x: 0, y: 0 });
    this.scene.pause('Game');
    PlatformBridge.haptic('light');

    const W = this.scale.width;
    const H = this.scale.height;
    const compact = H < 650;
    const c = this.add.container(0, 0).setDepth(220);
    this.pauseOverlay = c;

    c.add(this.add.rectangle(W / 2, H / 2, W, H, 0x05070f, 0.9).setInteractive());
    c.add(
      this.add
        .text(W / 2, H * 0.34, 'ПАУЗА', {
          fontFamily: FONT,
          fontSize: compact ? '32px' : '38px',
          fontStyle: 'bold',
          color: '#e8f4ff',
          letterSpacing: 3,
        })
        .setOrigin(0.5)
        .setResolution(2)
        .setShadow(0, 0, 'rgba(53,224,255,0.45)', 12, true, true)
    );
    c.add(
      this.add
        .text(W / 2, H * 0.41, 'забег остановлен', {
          fontFamily: FONT,
          fontSize: compact ? '11px' : '13px',
          color: '#8f9ab7',
        })
        .setOrigin(0.5)
        .setResolution(2)
    );

    this.button(c, 'ПРОДОЛЖИТЬ', W / 2, H * 0.53, true, () => this.closePauseMenu(true));
    this.button(c, 'В МЕНЮ', W / 2, H * 0.63, false, () => {
      this.closePauseMenu(false);
      Sfx.stopMusic();
      if (this.scene.isActive('Game') || this.scene.isPaused('Game')) this.scene.stop('Game');
      this.scene.start('Menu');
    });
  }

  private closePauseMenu(resumeGame: boolean): void {
    this.pauseOverlay?.destroy(true);
    this.pauseOverlay = null;
    this.manualPaused = false;
    this.uiBlocked = false;
    this.registry.set('joy', { x: 0, y: 0 });
    this.registry.set('aimJoy', { x: 0, y: 0 });
    if (resumeGame && this.scene.isPaused('Game')) this.scene.resume('Game');
  }

  private showLevelUp(): void {
    const gs = this.gs;
    if (!gs) return;
    this.modalOpen = true;
    this.uiBlocked = true;
    this.scene.pause('Game');
    Sfx.play('levelup');
    PlatformBridge.notify('success');
    PlatformBridge.haptic('medium');

    const W = this.scale.width;
    const H = this.scale.height;
    const compact = H < 620;
    const legendaryReward = gs.legendaryRewardPending;
    const c = this.add.container(0, 0).setDepth(100);
    this.modal = c;

    const dim = this.add.rectangle(W / 2, H / 2, W, H, 0x09040a, 0.91).setInteractive();
    c.add(dim);

    const ring = this.add
      .circle(W / 2, H / 2, 20)
      .setStrokeStyle(3, legendaryReward ? COLORS.gold : COLORS.magenta, 0.92)
      .setDepth(101);
    this.tweens.add({
      targets: ring,
      scale: 7,
      alpha: 0,
      duration: 520,
      ease: 'Quad.Out',
      onComplete: () => ring.destroy(),
    });
    this.fanfare.emitParticleAt(W / 2, H / 2, 22);

    const titleY = compact ? H * 0.1 : H * 0.13;
    const titleT = this.add
      .text(W / 2, titleY, legendaryReward ? 'ЛЕГЕНДАРНЫЙ ТРОФЕЙ' : IDENTITY.levelUp, {
        fontFamily: FONT,
        fontSize: compact ? '23px' : '27px',
        fontStyle: 'bold',
        color: legendaryReward ? '#ffe066' : '#ff78c8',
        align: 'center',
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setShadow(
        0,
        0,
        legendaryReward ? 'rgba(255,224,102,0.82)' : 'rgba(255,79,181,0.72)',
        16,
        true,
        true
      );
    c.add(titleT);
    titleT.setScale(0.7);
    this.tweens.add({ targets: titleT, scale: 1, duration: 260, ease: 'Back.Out' });
    c.add(
      this.add
        .text(
          W / 2,
          titleY + (compact ? 31 : 38),
          legendaryReward
            ? 'IMMUNE PRIME подавлен · выбери мутацию для СЕРДЦА'
            : 'стадия ' + gs.runState.stage.level + ' · выбери мутацию',
          {
          fontFamily: FONT,
          fontSize: compact ? '12px' : '14px',
          color: '#aab4d4',
          }
        )
        .setOrigin(0.5)
        .setResolution(2)
    );

    const cards = gs.pendingChoices;
    const cw = Math.min(W - 28, 360);
    const ch = compact ? 94 : 106;
    const gap = compact ? 8 : 10;
    const totalH = cards.length * ch + (cards.length - 1) * gap;
    const blockCenter = compact ? H * 0.56 : H * 0.55;
    let y = blockCenter - totalH / 2 + ch / 2;

    cards.forEach((def: UpgradeDef, cardIndex: number) => {
      const card = this.add.container(W / 2, y);
      const evolution = def.kind === 'evolution';
      const legendary = def.kind === 'legendary';
      const accent = legendary
        ? COLORS.gold
        : evolution
          ? COLORS.gold
          : def.rarity === 'rare'
            ? COLORS.purple
            : COLORS.cyan;
      const progress = getUpgradeProgress(gs.runState, def);
      const bg = this.add
        .rectangle(0, 0, cw, ch, COLORS.panel, 0.985)
        .setStrokeStyle(
          legendary ? 3.5 : evolution ? 3 : def.rarity === 'rare' ? 2.5 : 2,
          accent,
          legendary || evolution ? 1 : 0.85
        );
      card.add(bg);

      if (evolution || legendary) {
        card.add(
          this.add
            .rectangle(0, 0, cw - 6, ch - 6, COLORS.gold, legendary ? 0.07 : 0.035)
            .setStrokeStyle(1, COLORS.gold, legendary ? 0.52 : 0.28)
        );
      }

      const iconKey = evolution && def.evolutionId ? `mutation-${def.evolutionId}` : `up-${def.id}`;
      const hasIcon = this.textures.exists(iconKey);
      if (hasIcon) {
        card.add(
          this.add
            .image(-cw / 2 + 38, -2, iconKey)
            .setScale(compact ? 0.82 : 0.9)
            .setTint(evolution ? COLORS.gold : def.rarity === 'rare' ? 0xe9dcff : 0xffffff)
        );
      }

      const tx = -cw / 2 + (hasIcon ? 68 : 16);
      const right = cw / 2 - 12;
      const family = legendary
        ? 'ЛЕГЕНДАРНАЯ МУТАЦИЯ'
        : evolution
          ? 'КРИТИЧЕСКАЯ МУТАЦИЯ'
          : `${UPGRADE_FAMILY_LABELS[def.family]} · ${def.rarity === 'rare' ? 'РЕДКИЙ' : 'СТАНДАРТ'}`;
      card.add(
        this.add
          .text(tx, -ch / 2 + 8, family, {
            fontFamily: FONT,
            fontSize: compact ? '9px' : '10px',
            fontStyle: 'bold',
            color: legendary || evolution ? '#ffe066' : def.rarity === 'rare' ? '#cbb6ff' : '#73eaff',
          })
          .setResolution(2)
      );

      card.add(
        this.add
          .text(tx, -ch / 2 + (compact ? 22 : 24), def.shortName, {
            fontFamily: FONT,
            fontSize: legendary || evolution ? (compact ? '16px' : '18px') : compact ? '14px' : '15px',
            fontStyle: 'bold',
            color: legendary || evolution ? '#ffe066' : '#e8f4ff',
          })
          .setResolution(2)
      );

      card.add(
        this.add
          .text(tx, -ch / 2 + (compact ? 43 : 47), def.name, {
            fontFamily: FONT,
            fontSize: compact ? '10px' : '11px',
            fontStyle: 'bold',
            color: legendary || evolution ? '#fff1ac' : def.rarity === 'rare' ? '#cbb6ff' : '#73eaff',
            wordWrap: { width: Math.max(100, right - tx) },
          })
          .setResolution(2)
      );

      if (!compact && !evolution && !legendary) {
        card.add(
          this.add
            .text(tx, -ch / 2 + 64, def.desc, {
              fontFamily: FONT,
              fontSize: '10px',
              color: '#8f9ab7',
              wordWrap: { width: Math.max(100, right - tx - 4) },
            })
            .setResolution(2)
        );
      }

      if (!evolution && def.evolutionHint) {
        card.add(
          this.add
            .text(right, -ch / 2 + 9, `→ ${EVOLUTION_NAMES[def.evolutionHint]}`, {
              fontFamily: FONT,
              fontSize: compact ? '9px' : '10px',
              fontStyle: 'bold',
              color: '#ffe066',
            })
            .setOrigin(1, 0)
            .setResolution(2)
        );
      }

      if (def.showProgress !== false && def.max <= 8) {
        const pg = this.add.graphics();
        const barX = tx;
        const barY = ch / 2 - 13;
        const available = Math.min(118, Math.max(72, right - tx - 64));
        const segGap = 3;
        const segW = (available - segGap * (def.max - 1)) / def.max;
        for (let i = 0; i < def.max; i++) {
          const x = barX + i * (segW + segGap);
          const completed = i < progress.current;
          const next = i === progress.current;
          pg.fillStyle(accent, completed ? 0.95 : next ? 0.42 : 0.1);
          pg.fillRoundedRect(x, barY, segW, 5, 2);
        }
        card.add(pg);
        card.add(
          this.add
            .text(right, barY - 5, `${progress.current} → ${progress.next} / ${progress.max}`, {
              fontFamily: FONT,
              fontSize: '9px',
              color: '#7f8aa7',
            })
            .setOrigin(1, 0)
            .setResolution(2)
        );
      } else {
        card.add(
          this.add
            .text(
              right,
              ch / 2 - 19,
              legendary
                ? 'ИЗМЕНИТЬ ПРАВИЛА ЗАБЕГА'
                : evolution
                  ? 'ЗАКРЕПИТЬ МУТАЦИЮ'
                  : 'РАЗОВАЯ АДАПТАЦИЯ',
              {
              fontFamily: FONT,
              fontSize: '9px',
              fontStyle: legendary || evolution ? 'bold' : 'normal',
              color: legendary || evolution ? '#ffe066' : '#7dff6e',
            })
            .setOrigin(1, 0)
            .setResolution(2)
        );
      }

      bg.setInteractive({ useHandCursor: true }).on('pointerup', () => {
        Sfx.play('click');
        const more = gs.chooseUpgrade(def.id);
        const legendaryId = gs.consumeLegendaryCeremony();
        const evolutionId = gs.consumeEvolutionCeremony();
        if (legendaryId) {
          c.destroy();
          if (this.modal === c) this.modal = null;
          this.showLegendaryCeremony(legendaryId, more);
        } else if (evolutionId) {
          c.destroy();
          if (this.modal === c) this.modal = null;
          this.showEvolutionCeremony(evolutionId, more);
        } else if (more) {
          c.destroy();
          if (this.modal === c) this.modal = null;
          this.modalOpen = false;
          this.showLevelUp();
        } else {
          this.hideModal();
          this.scene.resume('Game');
        }
      });
      bg.on('pointerover', () => bg.setFillStyle(legendary || evolution ? 0x332d18 : COLORS.panelHover, 1));
      bg.on('pointerout', () => bg.setFillStyle(COLORS.panel, 0.985));

      c.add(card);
      card.setScale(0.94).setAlpha(0);
      this.tweens.add({
        targets: card,
        scale: 1,
        alpha: 1,
        duration: 170,
        delay: cardIndex * 35,
        ease: 'Back.Out',
      });

      y += ch + gap;
    });
  }

  private showLegendaryCeremony(id: LegendaryId, moreChoices: boolean): void {
    const ceremonyGeneration = ++this.modalGeneration;
    const W = this.scale.width;
    const H = this.scale.height;
    const compact = H < 650;
    const def = getLegendaryDefinition(id);
    this.modalOpen = true;
    this.uiBlocked = true;

    const c = this.add.container(0, 0).setDepth(108);
    this.modal = c;
    const dim = this.add
      .rectangle(W / 2, H / 2, W, H, 0x030208, 0.94)
      .setInteractive({ useHandCursor: true });
    c.add(dim);

    const bandH = compact ? 250 : 292;
    const band = this.add
      .rectangle(W / 2, H / 2, W, bandH, 0x171008, 0.86)
      .setStrokeStyle(1, COLORS.gold, 0.36);
    const topLine = this.add.rectangle(W / 2, H / 2 - bandH / 2, W, 2, COLORS.gold, 0.78);
    const bottomLine = this.add.rectangle(W / 2, H / 2 + bandH / 2, W, 2, COLORS.gold, 0.48);
    c.add([band, topLine, bottomLine]);

    const halo = this.add.graphics();
    halo.lineStyle(2.4, COLORS.gold, 0.72);
    halo.strokeCircle(0, 0, compact ? 52 : 62);
    halo.lineStyle(1.2, COLORS.white, 0.38);
    halo.strokeCircle(0, 0, compact ? 68 : 80);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const inner = compact ? 58 : 69;
      const outer = i % 2 === 0 ? (compact ? 79 : 93) : (compact ? 72 : 85);
      halo.lineStyle(i % 2 === 0 ? 2.4 : 1.2, i % 2 === 0 ? COLORS.gold : COLORS.white, 0.68);
      halo.beginPath();
      halo.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
      halo.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
      halo.strokePath();
    }
    halo.setPosition(W / 2, H * 0.43).setAlpha(0);
    c.add(halo);

    const emblem = this.add.graphics().setPosition(W / 2, H * 0.43);
    const drawEmblem = () => {
      emblem.clear();
      emblem.lineStyle(3, COLORS.gold, 0.96);
      emblem.fillStyle(COLORS.gold, 0.08);
      if (def.archetype === 'projectile') {
        emblem.beginPath();
        emblem.moveTo(-28, 18);
        emblem.lineTo(0, -28);
        emblem.lineTo(28, 18);
        emblem.moveTo(0, -20);
        emblem.lineTo(-18, 27);
        emblem.moveTo(0, -20);
        emblem.lineTo(18, 27);
        emblem.strokePath();
      } else if (def.archetype === 'lysis') {
        emblem.strokeCircle(0, 0, 28);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          emblem.beginPath();
          emblem.moveTo(Math.cos(a) * 18, Math.sin(a) * 18);
          emblem.lineTo(Math.cos(a) * 39, Math.sin(a) * 39);
          emblem.strokePath();
        }
      } else if (def.archetype === 'control') {
        emblem.strokeCircle(0, 0, 30);
        emblem.strokeCircle(0, 0, 13);
        emblem.fillStyle(COLORS.white, 0.9);
        emblem.fillCircle(0, 0, 4);
      } else if (def.archetype === 'boss') {
        emblem.beginPath();
        emblem.moveTo(0, -32);
        emblem.lineTo(29, 0);
        emblem.lineTo(0, 32);
        emblem.lineTo(-29, 0);
        emblem.closePath();
        emblem.fillPath();
        emblem.strokePath();
        emblem.fillStyle(COLORS.white, 0.88);
        emblem.fillCircle(0, 0, 5);
      } else if (def.archetype === 'heartbeat') {
        emblem.beginPath();
        emblem.moveTo(-36, 4);
        emblem.lineTo(-18, 4);
        emblem.lineTo(-10, -16);
        emblem.lineTo(0, 24);
        emblem.lineTo(11, -26);
        emblem.lineTo(20, 4);
        emblem.lineTo(36, 4);
        emblem.strokePath();
      } else {
        emblem.beginPath();
        emblem.moveTo(0, -32);
        emblem.lineTo(28, -12);
        emblem.lineTo(22, 24);
        emblem.lineTo(0, 34);
        emblem.lineTo(-22, 24);
        emblem.lineTo(-28, -12);
        emblem.closePath();
        emblem.fillPath();
        emblem.strokePath();
      }
    };
    drawEmblem();
    emblem.setScale(0.52).setAlpha(0);
    c.add(emblem);

    const label = this.add
      .text(W / 2, H * 0.2, 'ЛЕГЕНДАРНАЯ МУТАЦИЯ', {
        fontFamily: FONT,
        fontSize: compact ? '15px' : '18px',
        fontStyle: 'bold',
        color: '#fff1ac',
        letterSpacing: 2,
      })
      .setOrigin(0.5)
      .setResolution(2);
    const name = this.add
      .text(W / 2, H * 0.29, def.title, {
        fontFamily: FONT,
        fontSize: compact ? '27px' : '34px',
        fontStyle: 'bold',
        color: '#ffe066',
        align: 'center',
        wordWrap: { width: W - 40 },
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setShadow(0, 0, 'rgba(255,224,102,0.58)', 10, true, true);
    const effect = this.add
      .text(W / 2, H * 0.63, def.effect, {
        fontFamily: FONT,
        fontSize: compact ? '12px' : '14px',
        fontStyle: 'bold',
        color: '#fff4ec',
        align: 'center',
        wordWrap: { width: Math.min(W - 48, 360) },
      })
      .setOrigin(0.5)
      .setResolution(2);
    const footer = this.add
      .text(W / 2, H * 0.74, 'ПРАВИЛА ЗАБЕГА ИЗМЕНЕНЫ · НАЖМИ, ЧТОБЫ ПРОДОЛЖИТЬ', {
        fontFamily: FONT,
        fontSize: compact ? '8px' : '9px',
        fontStyle: 'bold',
        color: '#b9a56a',
        align: 'center',
        wordWrap: { width: W - 44 },
      })
      .setOrigin(0.5)
      .setResolution(2);
    c.add([label, name, effect, footer]);

    c.setAlpha(0);
    name.setScale(0.72);
    this.tweens.add({ targets: c, alpha: 1, duration: 140, ease: 'Quad.Out' });
    this.tweens.add({ targets: name, scale: 1, duration: 360, ease: 'Back.Out' });
    this.tweens.add({ targets: emblem, scale: 1, alpha: 1, duration: 430, ease: 'Back.Out' });
    this.tweens.add({
      targets: halo,
      alpha: 0.86,
      rotation: Math.PI * 0.16,
      scale: 1.08,
      duration: 560,
      ease: 'Sine.Out',
    });
    this.tweens.add({
      targets: [topLine, bottomLine],
      scaleX: 0.54,
      alpha: 0.42,
      duration: 520,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    });

    (this.fanfare as TintableEmitter).setParticleTint?.(COLORS.gold);
    this.fanfare.emitParticleAt(W / 2, H * 0.43, 46);
    Sfx.play('levelup');
    this.time.delayedCall(120, () => Sfx.play('elite'));
    PlatformBridge.haptic('heavy');

    let finished = false;
    let autoDismissTimer: number | null = null;
    const canSkipAt = performance.now() + 260;
    const finish = () => {
      if (
        finished ||
        this.modalGeneration !== ceremonyGeneration ||
        this.modal !== c
      ) {
        return;
      }
      finished = true;
      if (autoDismissTimer !== null) {
        window.clearTimeout(autoDismissTimer);
        autoDismissTimer = null;
      }
      this.tweens.killTweensOf(c);
      this.tweens.add({
        targets: c,
        alpha: 0,
        duration: 190,
        onComplete: () => {
          c.destroy();
          if (this.modal === c) this.modal = null;
          this.modalOpen = false;
          this.uiBlocked = false;
          (this.fanfare as TintableEmitter).setParticleTint?.(COLORS.cyan);
          if (moreChoices) this.showLevelUp();
          else this.scene.resume('Game');
        },
      });
    };

    dim.on('pointerup', () => {
      if (performance.now() >= canSkipAt) finish();
    });
    autoDismissTimer = window.setTimeout(finish, 1_350);
  }

  private showEvolutionCeremony(id: EvolutionId, moreChoices: boolean): void {
    const ceremonyGeneration = ++this.modalGeneration;
    const W = this.scale.width;
    const H = this.scale.height;
    const def = getEvolutionDef(id);
    this.modalOpen = true;
    this.uiBlocked = true;

    const c = this.add.container(0, 0).setDepth(106);
    this.modal = c;
    c.add(this.add.rectangle(W / 2, H / 2, W, H, 0x03040a, 0.9).setInteractive());

    const outer = this.add
      .circle(W / 2, H * 0.43, 58)
      .setStrokeStyle(3, COLORS.gold, 0.9)
      .setBlendMode(Phaser.BlendModes.ADD);
    const inner = this.add
      .circle(W / 2, H * 0.43, 30)
      .setStrokeStyle(2, COLORS.white, 0.7)
      .setBlendMode(Phaser.BlendModes.ADD);
    const emblem = this.add
      .image(W / 2, H * 0.43, `mutation-${id}`)
      .setScale(1.18)
      .setAlpha(0.96)
      .setBlendMode(Phaser.BlendModes.ADD);
    c.add([outer, inner, emblem]);
    this.tweens.add({ targets: outer, scale: 1.75, alpha: 0.08, duration: 760, ease: 'Quad.Out' });
    this.tweens.add({ targets: inner, scale: 0.55, alpha: 1, duration: 300, yoyo: true, ease: 'Sine.InOut' });
    emblem.setScale(0.62);
    this.tweens.add({ targets: emblem, scale: 1.18, duration: 420, ease: 'Back.Out' });

    (this.fanfare as TintableEmitter).setParticleTint?.(COLORS.gold);
    this.fanfare.emitParticleAt(W / 2, H * 0.43, 38);

    c.add(
      this.add
        .text(W / 2, H * 0.21, 'КРИТИЧЕСКАЯ МУТАЦИЯ', {
          fontFamily: FONT,
          fontSize: '18px',
          fontStyle: 'bold',
          color: '#fff1ac',
          letterSpacing: 2,
        })
        .setOrigin(0.5)
        .setResolution(2)
    );

    const name = this.add
      .text(W / 2, H * 0.31, def.name, {
        fontFamily: FONT,
        fontSize: H < 620 ? '30px' : '38px',
        fontStyle: 'bold',
        color: '#ffe066',
        align: 'center',
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setShadow(0, 0, 'rgba(255,224,102,0.85)', 20, true, true);
    c.add(name);
    name.setScale(0.6);
    this.tweens.add({ targets: name, scale: 1, duration: 380, ease: 'Back.Out' });

    c.add(
      this.add
        .text(W / 2, H * 0.61, def.effect, {
          fontFamily: FONT,
          fontSize: '13px',
          color: '#e8f4ff',
          align: 'center',
          wordWrap: { width: Math.min(W - 48, 360) },
        })
        .setOrigin(0.5)
        .setResolution(2)
    );
    c.add(
      this.add
        .text(W / 2, H * 0.69, 'ШТАММ ИЗМЕНИЛСЯ', {
          fontFamily: FONT,
          fontSize: '12px',
          fontStyle: 'bold',
          color: '#ffe066',
        })
        .setOrigin(0.5)
        .setResolution(2)
    );

    Sfx.play('levelup');
    this.time.delayedCall(130, () => Sfx.play(id === 'singularity' ? 'nova' : 'elite'));
    PlatformBridge.haptic('heavy');

    this.time.delayedCall(1050, () => {
      if (this.modalGeneration !== ceremonyGeneration || this.modal !== c) return;
      this.tweens.add({
        targets: c,
        alpha: 0,
        duration: 240,
        onComplete: () => {
          c.destroy();
          if (this.modal === c) this.modal = null;
          this.modalOpen = false;
          this.uiBlocked = false;
          (this.fanfare as TintableEmitter).setParticleTint?.(COLORS.cyan);
          if (moreChoices) this.showLevelUp();
          else this.scene.resume('Game');
        },
      });
    });
  }

  private hideModal(): void {
    this.modal?.destroy();
    this.modal = null;
    this.modalOpen = false;
    this.uiBlocked = false;
  }

  private showGameOver(res: RunResult): void {
    this.uiBlocked = true;
    const ranked = res.difficultyId === 'standard';
    const W = this.scale.width;
    const H = this.scale.height;
    const compact = H < 650;
    const c = this.add.container(0, 0).setDepth(110);

    c.add(this.add.rectangle(W / 2, H / 2, W, H, 0x05070f, 0.84).setInteractive());
    if (res.win && this.textures.exists('cinematic-victory')) {
      c.add(
        this.add
          .image(W / 2, H * 0.25, 'cinematic-victory')
          .setDisplaySize(Math.min(W * 0.96, 440), Math.min(H * 0.3, 230))
          .setAlpha(0.3)
      );
    }

    const titleY = compact ? H * 0.1 : H * 0.13;
    c.add(
      this.add
        .text(W / 2, titleY, res.win ? 'ИММУНИТЕТ ПОДАВЛЕН' : 'ШТАММ УНИЧТОЖЕН', {
          fontFamily: FONT,
          fontSize: res.win ? (compact ? '22px' : '27px') : compact ? '27px' : '32px',
          fontStyle: 'bold',
          color: res.win ? '#ffe066' : '#ff3860',
          align: 'center',
        })
        .setOrigin(0.5)
        .setResolution(2)
        .setShadow(0, 0, res.win ? 'rgba(255,224,102,0.7)' : 'rgba(255,56,96,0.7)', 16, true, true)
    );

    c.add(
      this.add
        .text(W / 2, titleY + (compact ? 42 : 54), fmtTime(res.timeMs), {
          fontFamily: FONT,
          fontSize: compact ? '38px' : '46px',
          fontStyle: 'bold',
          color: '#e8f4ff',
        })
        .setOrigin(0.5)
        .setResolution(2)
    );

    const statY = titleY + (compact ? 79 : 100);
    c.add(
      this.add
        .text(
          W / 2,
          statY,
          `${IDENTITY.kills}: ${res.kills}   ·   Клеток: ${res.hostCellsInfected}   ·   Пик мутации: ${res.highestLevel}   ·   ×${res.comboBest}`,
          {
            fontFamily: FONT,
            fontSize: compact ? '11px' : '13px',
            color: '#aab4d4',
          }
        )
        .setOrigin(0.5)
        .setResolution(2)
    );

    let detailY = statY + 27;
    const evoText = res.evolutions.length > 0
      ? res.evolutions.map((id) => EVOLUTION_NAMES[id]).join(' · ')
      : 'нет';
    c.add(
      this.add
        .text(W / 2, detailY, `КРИТ. МУТАЦИИ: ${evoText}`, {
          fontFamily: FONT,
          fontSize: compact ? '10px' : '11px',
          fontStyle: 'bold',
          color: res.evolutions.length > 0 ? '#ffe066' : '#5a6480',
          align: 'center',
          wordWrap: { width: W - 42 },
        })
        .setOrigin(0.5)
        .setResolution(2)
    );

    detailY += compact ? 24 : 28;
    const legendaryText =
      res.legendaryIds.length > 0
        ? res.legendaryIds.map((id) => getLegendaryDefinition(id).title).join(' · ')
        : 'нет';
    c.add(
      this.add
        .text(W / 2, detailY, `ЛЕГЕНДАРНЫЕ: ${legendaryText}`, {
          fontFamily: FONT,
          fontSize: compact ? '9px' : '10px',
          fontStyle: 'bold',
          color: res.legendaryIds.length > 0 ? '#ffe066' : '#5a6480',
          align: 'center',
          wordWrap: { width: W - 42 },
        })
        .setOrigin(0.5)
        .setResolution(2)
    );

    detailY += compact ? 23 : 27;
    const bloodstreamBuild = res.stageBuilds.bloodstream
      ? this.buildSummary(res.stageBuilds.bloodstream.stacks)
      : '';
    const heartBuild = res.stageBuilds.heart ? this.buildSummary(res.stageBuilds.heart.stacks) : '';
    const stageBuildText = [
      bloodstreamBuild ? `КРОВОТОК: ${bloodstreamBuild}` : '',
      heartBuild ? `СЕРДЦЕ: ${heartBuild}` : '',
    ]
      .filter(Boolean)
      .join('  →  ');
    c.add(
      this.add
        .text(W / 2, detailY, `ШТАММ: ${stageBuildText || this.buildSummary(res.stacks) || 'базовый штамм'}`, {
          fontFamily: FONT,
          fontSize: compact ? '9px' : '10px',
          color: '#8f9ab7',
          align: 'center',
          wordWrap: { width: W - 42 },
        })
        .setOrigin(0.5)
        .setResolution(2)
    );

    detailY += compact ? 22 : 25;
    c.add(
      this.add
        .text(
          W / 2,
          detailY,
          ranked ? 'РЕЖИМ: STANDARD · рейтинговый' : 'РЕЖИМ: STRAINED · вне рейтинга',
          {
            fontFamily: FONT,
            fontSize: compact ? '9px' : '10px',
            fontStyle: 'bold',
            color: ranked ? '#8fe8ff' : '#ffe066',
          }
        )
        .setOrigin(0.5)
        .setResolution(2)
    );

    detailY += compact ? 20 : 23;
    const scoreStatus = this.add
      .text(W / 2, detailY, 'СЧЁТ: синхронизация…', {
        fontFamily: FONT,
        fontSize: compact ? '9px' : '10px',
        fontStyle: 'bold',
        color: '#8f9ab7',
        align: 'center',
      })
      .setOrigin(0.5)
      .setResolution(2);
    c.add(scoreStatus);

    void submitRunScore(res, PlatformBridge).then((score) => {
      if (!scoreStatus.active) return;
      if (!score) {
        scoreStatus.setVisible(false);
        return;
      }
      if (score.ranked) {
        scoreStatus
          .setText(score.rank ? `РЕЙТИНГ · RULESET ${score.rulesetVersion} · #${score.rank}` : 'РЕЙТИНГ · РЕЗУЛЬТАТ СОХРАНЁН')
          .setColor('#8fe8ff');
      } else if (PlatformBridge.kind === 'browser') {
        scoreStatus.setText('ТЕСТОВЫЙ РЕЗУЛЬТАТ · ВНЕ РЕЙТИНГА').setColor('#8f9ab7');
      } else {
        scoreStatus.setText('РЕЗУЛЬТАТ СОХРАНЁН · ВНЕ РЕЙТИНГА').setColor('#ffe066');
      }
    });

    const rec: string[] = [];
    if (res.records.timeRecord && res.timeMs > 0) rec.push(res.win ? 'победа' : 'выживание');
    if (res.records.killsRecord) rec.push('иммунитет');
    if (res.records.levelRecord) rec.push('мутация');
    if (rec.length > 0) {
      detailY += compact ? 24 : 28;
      c.add(
        this.add
          .text(W / 2, detailY, `НОВЫЕ ЗАПИСИ: ${rec.join(' · ')}`, {
            fontFamily: FONT,
            fontSize: compact ? '10px' : '11px',
            fontStyle: 'bold',
            color: '#73eaff',
          })
          .setOrigin(0.5)
          .setResolution(2)
      );
    }

    if (res.newAchievements.length > 0) {
      detailY += compact ? 24 : 29;
      const labels = res.newAchievements.slice(0, 2).map((id) => getAchievementDef(id).name);
      const extra = res.newAchievements.length > 2 ? ` +${res.newAchievements.length - 2}` : '';
      c.add(
        this.add
          .text(W / 2, detailY, `НОВОЕ ДОСТИЖЕНИЕ: ${labels.join(' · ')}${extra}`, {
            fontFamily: FONT,
            fontSize: compact ? '9px' : '10px',
            fontStyle: 'bold',
            color: '#ffe066',
            align: 'center',
            wordWrap: { width: W - 42 },
          })
          .setOrigin(0.5)
          .setResolution(2)
      );
    }

    const challengeTarget = this.registry.get('challengeTarget') as ChallengePayload | null | undefined;
    if (challengeTarget) {
      detailY += compact ? 24 : 29;
      const target =
        challengeTarget.objective === 'boss1-clear'
          ? `IMMUNE PRIME быстрее ${fmtTime(challengeTarget.timeMs)}`
          : challengeTarget.objective === 'campaign-clear'
            ? `кампания быстрее ${fmtTime(challengeTarget.timeMs)}`
            : `дольше ${fmtTime(challengeTarget.timeMs)}`;
      const beaten = ranked && isChallengeBeaten(challengeTarget, res);
      const label = ranked
        ? `ВЫЗОВ ${beaten ? 'ПРЕВЗОЙДЁН' : 'НЕ ПРЕВЗОЙДЁН'} · цель ${target}`
        : 'ВЫЗОВ НЕ ЗАСЧИТАН · требуется STANDARD';
      c.add(
        this.add
          .text(W / 2, detailY, label, {
            fontFamily: FONT,
            fontSize: compact ? '10px' : '11px',
            fontStyle: 'bold',
            color: ranked ? (beaten ? '#7fffa1' : '#ff9b66') : '#ffe066',
            align: 'center',
            wordWrap: { width: W - 42 },
          })
          .setOrigin(0.5)
          .setResolution(2)
      );
    }

    const gap = compact ? 50 : 56;
    const desiredY = Math.max(H * (compact ? 0.66 : 0.68), detailY + (compact ? 54 : 62));
    const maxFirstY = H - 24 - gap * 2;
    let y = Math.min(desiredY, maxFirstY);
    this.button(c, 'ЕЩЁ ОДИН ЦИКЛ', W / 2, y, true, () => {
      const gameScene = this.gs;
      if (!gameScene) return;
      // Result Game is paused. Treat shutdown as a barrier: only start the fresh run after Phaser
      // has fully completed the old Game teardown. UI stays alive until that point, so the
      // SceneManager always has an active owner for the queued transition.
      gameScene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        this.registry.set('runResult', null);
        this.scene.launch('Game');
        this.scene.restart();
      });
      this.scene.stop('Game');
    });
    y += gap;
    this.button(c, ranked ? 'БРОСИТЬ ВЫЗОВ' : 'ПОДЕЛИТЬСЯ РЕЗУЛЬТАТОМ', W / 2, y, false, () => {
      const mins = fmtTime(res.timeMs);
      const evoShare = res.evolutions.length > 0 ? ` Критические мутации: ${res.evolutions.map((id) => EVOLUTION_NAMES[id]).join(', ')}.` : '';
      const legendaryShare =
        res.legendaryIds.length > 0
          ? ` Legendary: ${res.legendaryIds.map((id) => getLegendaryDefinition(id).title).join(', ')}.`
          : '';
      const modeShare = ranked ? '' : ' Режим: STRAINED.';
      const shareText = res.win
        ? `OFELIYA / STRAIN-0 завершила кампанию за ${mins}. Иммунных клеток: ${res.kills}, заражено клеток: ${res.hostCellsInfected}.${modeShare}${evoShare}${legendaryShare} ${ranked ? 'Сможешь быстрее?' : ''}`.trim()
        : `Мой STRAIN-0 выжил ${mins}. Иммунных клеток: ${res.kills}, заражено клеток: ${res.hostCellsInfected}.${modeShare}${evoShare}${legendaryShare} ${ranked ? 'Сможешь дольше?' : ''}`.trim();
      const payload = ranked ? encodeChallengePayload(createChallengePayload(res)) : null;
      const link = payload ? PlatformBridge.buildStartLink(payload) : null;
      void PlatformBridge.shareResult(shareText, link ?? undefined).then((ok) => {
        if (!ok) {
          this.toast(c, 'Нативный шаринг недоступен в этом клиенте');
        } else if (!link && PlatformBridge.kind === 'max') {
          this.toast(c, 'Ссылка вызова не настроена');
        }
      });
    });
    y += gap;
    this.button(c, 'В МЕНЮ', W / 2, y, false, () => {
      this.gs?.scene.stop();
      this.scene.start('Menu');
    });
  }

  private buildSummary(stacks: Record<string, number>): string {
    const labels: Record<string, string> = {
      dmg: 'ШИПЫ',
      rate: 'РЕПЛИКАЦИЯ',
      multi: 'КОПИИ',
      pierce: 'ПРОНИКН.',
      speed: 'ПОДВИЖН.',
      hp: 'КАПСИД',
      magnet: 'АФФИНИТЕТ',
      orbit: 'СПУТНИКИ',
      nova: 'ЛИЗИС',
      regen: 'РЕКОМБ.',
      infect: 'ЗАРАЖ.',
      lysis: 'ЦИТОЛИЗ',
      factory: 'ФАБРИКА',
    };
    return Object.entries(stacks)
      .filter(([id, n]) => n > 0 && UPGRADES.some((u) => u.id === id))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, n]) => `${labels[id] ?? id.toUpperCase()} ${n}`)
      .join(' · ');
  }

  private button(
    c: Phaser.GameObjects.Container,
    label: string,
    x: number,
    y: number,
    primary: boolean,
    cb: () => void
  ): void {
    const w = 230;
    const h = 46;
    const bg = this.add
      .rectangle(x, y, w, h, primary ? COLORS.magenta : COLORS.panel, primary ? 0.18 : 0.95)
      .setStrokeStyle(2, primary ? COLORS.magenta : COLORS.stroke, 1);
    const t = this.add
      .text(x, y, label, {
        fontFamily: FONT,
        fontSize: '16px',
        fontStyle: 'bold',
        color: primary ? '#ff78c8' : '#fff4ec',
      })
      .setOrigin(0.5)
      .setResolution(2);
    bg.setInteractive({ useHandCursor: true }).on('pointerup', () => cb());
    bg.on('pointerover', () => bg.setFillStyle(COLORS.panelHover, 1));
    bg.on('pointerout', () =>
      bg.setFillStyle(primary ? COLORS.magenta : COLORS.panel, primary ? 0.18 : 0.95)
    );
    c.add([bg, t]);
  }

  private toast(c: Phaser.GameObjects.Container, msg: string): void {
    const W = this.scale.width;
    const H = this.scale.height;
    const t = this.add
      .text(W / 2, H * 0.9, msg, {
        fontFamily: FONT,
        fontSize: '13px',
        color: '#aab4d4',
        backgroundColor: '#141a2e',
        padding: { x: 10, y: 6 },
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setAlpha(0);
    c.add(t);
    this.tweens.add({
      targets: t,
      alpha: 1,
      duration: 150,
      yoyo: true,
      hold: 1200,
      onComplete: () => t.destroy(),
    });
  }
}
