import Phaser from 'phaser';
import { getAchievementDef, type AchievementId } from '../game/AchievementSystem';
import { COLORS, COMBO, FONT, JUICE, fmtTime } from '../game/config';
import { getEvolutionDef } from '../game/EvolutionSystem';
import { buildRefLink, buildShareLink, buildShareText, shareCard } from '../game/share';
import { IDENTITY } from '../game/identity';
import { Analytics } from '../systems/Analytics';
import { ServerClient } from '../systems/ServerClient';
import { VK_ADS, VkBridge } from '../systems/VkBridge';
import { Joystick } from '../game/Joystick';
import {
  EVOLUTION_NAMES,
  UPGRADE_FAMILY_LABELS,
  UPGRADES,
  getUpgradeProgress,
  type EvolutionId,
  type UpgradeDef,
} from '../game/UpgradeSystem';
import { MessengerBridge } from '../systems/MessengerBridge';
import { SafeArea } from '../systems/SafeArea';
import { Sfx } from '../systems/Sfx';
import { shareClip, type RecordedClip } from '../systems/ShareVideo';
import type { GameScene } from './GameScene';

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

interface RunResult {
  win: boolean;
  timeMs: number;
  kills: number;
  level: number;
  comboBest: number;
  stacks: Record<string, number>;
  evolutions: EvolutionId[];
  newAchievements: AchievementId[];
  records: { timeRecord: boolean; killsRecord: boolean; levelRecord: boolean };
  daily: { streak: number; dailyRecord: boolean; newStreak: boolean } | null;
  rank: number | null;
  /** K1: осколки ядра, заработанные в забеге. */
  shardsEarned: number;
}

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
  private joystick!: Joystick;
  private muteBg!: Phaser.GameObjects.Rectangle;
  private hpWarn!: Phaser.GameObjects.Graphics;
  private fanfare!: Phaser.GameObjects.Particles.ParticleEmitter;
  private comboText!: Phaser.GameObjects.Text;
  private lastCombo = 0;

  private modal: Phaser.GameObjects.Container | null = null;
  private modalOpen = false;
  private overShown = false;
  private uiBlocked = false;
  private dailyBadge: Phaser.GameObjects.Text | null = null;

  private pauseOverlay: Phaser.GameObjects.Container | null = null;
  private autoPaused = false;
  private pauseBtnBg: Phaser.GameObjects.Rectangle | null = null;
  private pauseBtnText: Phaser.GameObjects.Text | null = null;
  private readonly onVisibility: () => void;
  private readonly onBack: () => void;
  /** Кэш перерисовки баров: Graphics.clear()+fill каждый кадр — лишний GPU-стейт. */
  private barKey = '';

  constructor() {
    super('UI');
    this.onVisibility = () => {
      if (document.hidden) {
        // rAF в фоне замёрзнет, но WebAudio-граф продолжит играть — гасим.
        Sfx.suspend();
        if (this.canPauseGame()) {
          this.autoPaused = true;
          this.openPauseMenu();
        }
      } else {
        Sfx.resume();
        // При возврате из фона не запускаем бой молча: если автопауза открыта,
        // игрок сам жмёт «продолжить» (защита от сюрприза-урона при развороте).
      }
    };
    this.onBack = () => {
      if (this.pauseOverlay) {
        this.closePauseMenu();
        return;
      }
      if (this.canPauseGame()) this.openPauseMenu();
    };
  }

  create(): void {
    this.gs = this.scene.get('Game') as GameScene;
    this.modalOpen = false;
    this.overShown = false;
    this.uiBlocked = false;
    this.modal = null;

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

    const st = SafeArea.top;
    this.timerText = text(W / 2, 28 + st, '00:00', 24, '#e8f4ff');
    this.levelText = text(16, 30 + st, 'ЯДРО 1', 14, '#35e0ff', 0);
    this.killsText = text(W - 16, 30 + st, 'ОЧИЩ. 0', 14, '#aab4d4', 1);
    this.hpText = text(W / 2, 58 + st, '', 10, '#e8f4ff');
    this.bossLabel = text(W / 2, 72 + st, IDENTITY.boss, 11, '#ff3860');

    // Кнопка звука: видимый глиф 16px, но hit-area ≥ 44×44 (требование к тач-целям).
    this.muteText = this.add
      .text(W - 16, 54 + st, '♪', { fontFamily: FONT, fontSize: '16px', color: Sfx.muted ? '#5a6480' : '#35e0ff' })
      .setOrigin(1, 0)
      .setResolution(2)
      .setDepth(DEPTH + 1);
    this.muteBg = this.add
      .rectangle(W - 16 - 22, 54 + st + 14, 44, 44, 0x141a2e, 0.0)
      .setDepth(DEPTH)
      .setInteractive({ useHandCursor: true })
      .on('pointerup', () => {
        const muted = Sfx.toggle();
        this.muteText.setText('♪').setColor(muted ? '#5a6480' : '#35e0ff');
      });

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
      .text(16, 54 + st, '', {
        fontFamily: FONT,
        fontSize: '18px',
        fontStyle: 'bold',
        color: '#ffe066',
      })
      .setResolution(2)
      .setDepth(DEPTH + 1)
      .setVisible(false);

    // Флик (быстрый свайп) → уклонение. Работает и второй рукой, пока джойстик занят.
    this.joystick = new Joystick(this, () => this.uiBlocked, (dx, dy) => {
      if (this.gs) this.gs.tryDodge(dx, dy);
    });

    // Бейдж daily-режима: виден весь забег, сравниваемость результата в одном месте.
    const runMode = this.registry.get('runMode') as
      | { daily: boolean; dateKey: string }
      | undefined;
    if (runMode?.daily) {
      this.dailyBadge = this.add
        .text(W / 2, 100 + st, `ЕЖЕДНЕВНОЕ · ${runMode.dateKey.slice(5).replace('-', '.')}`, {
          fontFamily: FONT,
          fontSize: '10px',
          fontStyle: 'bold',
          color: '#73eaff',
        })
        .setOrigin(0.5, 0)
        .setResolution(2)
        .setDepth(DEPTH + 1);
    }

    // Кнопка паузы (браузер/десктоп; в мессенджерах срабатывает и нативный Back).
    const px = W - 16 - 44 - 8 - 22;
    this.pauseBtnBg = this.add
      .rectangle(px, 54 + st + 14, 44, 44, 0x141a2e, 0.0)
      .setDepth(DEPTH)
      .setInteractive({ useHandCursor: true });
    this.pauseBtnText = this.add
      .text(px, 54 + st + 14, 'II', { fontFamily: FONT, fontSize: '15px', fontStyle: 'bold', color: '#35e0ff' })
      .setOrigin(0.5)
      .setResolution(2)
      .setDepth(DEPTH + 1);
    this.pauseBtnBg.on('pointerup', () => {
      if (this.uiBlocked) return;
      if (this.pauseOverlay) this.closePauseMenu();
      else if (this.canPauseGame()) this.openPauseMenu();
    });

    // Жизненный цикл: фон/foreground и нативная кнопка «назад».
    document.addEventListener('visibilitychange', this.onVisibility, { passive: true });
    MessengerBridge.setBackHandler(this.onBack);

    this.scale.on('resize', this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      document.removeEventListener('visibilitychange', this.onVisibility);
      MessengerBridge.setBackHandler(null);
      Sfx.resume();
      this.scale.off('resize', this.layout, this);
    });
    this.layout();
  }

  /** Пауза разрешена только в активном, незавершённом бою без модалок. */
  private canPauseGame(): boolean {
    return (
      !!this.gs &&
      !this.gs.finished &&
      !this.modalOpen &&
      !this.overShown &&
      !this.pauseOverlay
    );
  }

  private openPauseMenu(): void {
    if (!this.canPauseGame()) return;
    const gs = this.gs;
    if (!gs) return;
    gs.scene.pause();
    this.uiBlocked = true;
    Analytics.track('pause_shown', { auto: this.autoPaused });

    const W = this.scale.width;
    const H = this.scale.height;
    const c = this.add.container(0, 0).setDepth(112);
    this.pauseOverlay = c;
    c.add(this.add.rectangle(W / 2, H / 2, W, H, 0x05070f, 0.82).setInteractive());

    c.add(
      this.add
        .text(W / 2, H * 0.3, 'ПАУЗА', {
          fontFamily: FONT,
          fontSize: '30px',
          fontStyle: 'bold',
          color: '#35e0ff',
        })
        .setOrigin(0.5)
        .setResolution(2)
        .setShadow(0, 0, 'rgba(53,224,255,0.7)', 14, true, true)
    );

    if (this.autoPaused) {
      c.add(
        this.add
          .text(W / 2, H * 0.3 + 34, 'протокол на удержании — бой остановлен', {
            fontFamily: FONT,
            fontSize: '11px',
            color: '#aab4d4',
          })
          .setOrigin(0.5)
          .setResolution(2)
      );
    }

    const gap = 54;
    const y0 = H * 0.52;
    this.button(c, 'ПРОДОЛЖИТЬ', W / 2, y0, true, () => this.closePauseMenu());
    this.button(c, 'ЗАНОВО', W / 2, y0 + gap, false, () => {
      this.scene.stop();
      if (gs) {
        gs.scene.resume();
        gs.scene.restart();
      }
    });
    this.button(c, 'В МЕНЮ', W / 2, y0 + 2 * gap, false, () => {
      this.scene.stop();
      if (gs) {
        gs.scene.stop();
        gs.scene.start('Menu');
      }
    });

    // Rewarded-слот (V6, VK): +1 HP за просмотр рекламы. Показываем ТОЛЬКО когда
    // реклама реально доступна (VKWebAppCheckNativeAds) и есть лимит исцелений.
    // Бонус выдаётся только при outcome 'completed'.
    const rewardY = y0 + 3 * gap;
    if (
      MessengerBridge.kind === 'vk' &&
      VK_ADS.rewardedPlacementId &&
      gs.rewardHealsLeft() > 0
    ) {
      void VkBridge.rewardedAvailable(VK_ADS.rewardedPlacementId).then((ok) => {
        if (!ok || !this.scene.isActive() || !this.pauseOverlay || gs.rewardHealsLeft() <= 0) {
          return;
        }
        try {
          this.button(this.pauseOverlay, 'СМОТРЕТЬ РЕКЛАМУ: +1 HP', W / 2, rewardY, false, () => {
            Analytics.track('reward_ad_opened');
            void VkBridge.showRewarded(VK_ADS.rewardedPlacementId).then((outcome) => {
              Analytics.track('reward_ad_done', { outcome });
              if (outcome === 'completed' && gs.tryRewardHeal()) {
                Sfx.play('levelup');
                MessengerBridge.haptic('medium');
              }
            });
          });
        } catch {
          /* overlay уже закрыт — безопасно игнорируем */
        }
      });
    }

    const soundLabel = `звук: ${Sfx.muted ? 'выкл' : 'вкл'}`;
    const soundText = this.add
      .text(W / 2, rewardY + gap - 6, soundLabel, {
        fontFamily: FONT,
        fontSize: '13px',
        color: Sfx.muted ? '#5a6480' : '#aab4d4',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .setResolution(2)
      .on('pointerup', () => {
        const muted = Sfx.toggle();
        soundText.setText(`звук: ${muted ? 'выкл' : 'вкл'}`).setColor(muted ? '#5a6480' : '#aab4d4');
        if (!muted) Sfx.play('click');
      });
    c.add(soundText);
  }

  private closePauseMenu(): void {
    if (!this.pauseOverlay) return;
    this.pauseOverlay.destroy();
    this.pauseOverlay = null;
    this.autoPaused = false;
    this.uiBlocked = false;
    if (this.gs && !this.gs.finished && !this.overShown) this.gs.scene.resume();
  }

  update(): void {
    const run = this.registry.get('run') as RunSnapshot | undefined;
    const W = this.scale.width;
    const H = this.scale.height;
    const st = SafeArea.top;
    if (run) {
      this.timerText.setText(fmtTime(run.timeMs));
      this.levelText.setText(`ЯДРО ${run.level}`);
      this.killsText.setText(`ОЧИЩ. ${run.kills}`);

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

      // Бары (Graphics = GPU-стейт): перерисовываем только при изменении значений.
      const barKey = `${W}|${st}|${run.xp.toFixed(1)}|${run.xpNext}|${run.hp.toFixed(1)}|${run.maxHp}|${run.bossHp.toFixed(0)}|${run.bossMax}`;
      if (barKey !== this.barKey) {
        this.barKey = barKey;

        this.xpBack.clear();
        this.xpBack.fillStyle(0x1a2136, 0.9);
        this.xpBack.fillRoundedRect(12, 12 + st, W - 24, 10, 5);
        this.xpFill.clear();
        const xf = Phaser.Math.Clamp(run.xp / run.xpNext, 0, 1);
        if (xf > 0) {
          this.xpFill.fillStyle(COLORS.cyan, 1);
          this.xpFill.fillRoundedRect(12, 12 + st, Math.max((W - 24) * xf, 10), 10, 5);
        }

        const bw = 200;
        const bx = W / 2 - bw / 2;
        const hf = Phaser.Math.Clamp(run.hp / run.maxHp, 0, 1);
        this.hpBack.clear();
        this.hpBack.fillStyle(0x1a2136, 0.9);
        this.hpBack.fillRoundedRect(bx, 54 + st, bw, 12, 6);
        this.hpFill.clear();
        if (hf > 0) {
          this.hpFill.fillStyle(hf > 0.35 ? COLORS.green : 0xff5a5a, 1);
          this.hpFill.fillRoundedRect(bx, 54 + st, Math.max(bw * hf, 10), 12, 6);
        }
        this.hpText.setText(`${Math.ceil(Math.max(0, run.hp))} / ${run.maxHp}`);

        const boss = run.bossMax > 0;
        this.bossBack.setVisible(boss);
        this.bossFill.setVisible(boss);
        this.bossLabel.setVisible(boss);
        if (boss) {
          this.bossBack.clear();
          this.bossBack.fillStyle(0x1a2136, 0.9);
          this.bossBack.fillRoundedRect(W / 2 - 140, 82 + st, 280, 9, 4);
          this.bossFill.clear();
          this.bossFill.fillStyle(COLORS.red, 1);
          this.bossFill.fillRoundedRect(
            W / 2 - 140,
            82 + st,
            Math.max(280 * Phaser.Math.Clamp(run.bossHp / run.bossMax, 0, 1), 8),
            9,
            4
          );
        }
      }

      // Рамка низкого HP пульсирует по sin — каждый кадр, но только когда hp низкий.
      this.hpWarn.clear();
      if (run.hp > 0) {
        const hf = Phaser.Math.Clamp(run.hp / run.maxHp, 0, 1);
        if (hf <= JUICE.lowHpFraction) {
          const a = 0.22 + 0.22 * Math.sin(this.time.now / 120);
          this.hpWarn.lineStyle(16, COLORS.red, a);
          this.hpWarn.strokeRect(8, 8, W - 16, H - 16);
        }
      }
    }

    if (this.gs && this.gs.awaitingChoice && !this.modalOpen && !this.overShown) {
      this.showLevelUp();
    }

    const res = this.registry.get('runResult') as RunResult | undefined | null;
    if (res && !this.overShown) {
      this.overShown = true;
      this.hideModal();
      this.showGameOver(res);
    }
  }

  private layout(): void {
    const W = this.scale.width;
    const st = SafeArea.top;
    this.timerText.setPosition(W / 2, 28 + st);
    this.levelText.setPosition(16, 30 + st);
    this.killsText.setPosition(W - 16, 30 + st);
    this.hpText.setPosition(W / 2, 58 + st);
    this.bossLabel.setPosition(W / 2, 72 + st);
    this.muteText.setPosition(W - 16, 54 + st);
    this.muteBg.setPosition(W - 16 - 22, 54 + st + 14);
    const px = W - 16 - 44 - 8 - 22;
    this.pauseBtnBg?.setPosition(px, 54 + st + 14);
    this.pauseBtnText?.setPosition(px, 54 + st + 14);
    this.dailyBadge?.setPosition(W / 2, 100 + st);
  }

  private showLevelUp(): void {
    const gs = this.gs;
    if (!gs) return;
    this.modalOpen = true;
    this.uiBlocked = true;
    this.scene.pause('Game');
    Sfx.play('levelup');
    MessengerBridge.notify('success');
    MessengerBridge.haptic('medium');

    const W = this.scale.width;
    const H = this.scale.height;
    const compact = H < 620;
    const c = this.add.container(0, 0).setDepth(100);
    this.modal = c;

    const dim = this.add.rectangle(W / 2, H / 2, W, H, 0x05070f, 0.76).setInteractive();
    c.add(dim);

    const ring = this.add
      .circle(W / 2, H / 2, 20)
      .setStrokeStyle(3, COLORS.cyan, 0.9)
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
      .text(W / 2, titleY, IDENTITY.levelUp, {
        fontFamily: FONT,
        fontSize: compact ? '23px' : '27px',
        fontStyle: 'bold',
        color: '#35e0ff',
        align: 'center',
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setShadow(0, 0, 'rgba(53,224,255,0.7)', 14, true, true);
    c.add(titleT);
    titleT.setScale(0.7);
    this.tweens.add({ targets: titleT, scale: 1, duration: 260, ease: 'Back.Out' });
    c.add(
      this.add
        .text(W / 2, titleY + (compact ? 31 : 38), `ядро ${gs.runState.level} · выбери протокол`, {
          fontFamily: FONT,
          fontSize: compact ? '12px' : '14px',
          color: '#aab4d4',
        })
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
      const accent = evolution ? COLORS.gold : def.rarity === 'rare' ? COLORS.purple : COLORS.cyan;
      const progress = getUpgradeProgress(gs.runState, def);
      const bg = this.add
        .rectangle(0, 0, cw, ch, COLORS.panel, 0.985)
        .setStrokeStyle(evolution ? 3 : def.rarity === 'rare' ? 2.5 : 2, accent, evolution ? 1 : 0.85);
      card.add(bg);

      if (evolution) {
        card.add(
          this.add
            .rectangle(0, 0, cw - 6, ch - 6, COLORS.gold, 0.035)
            .setStrokeStyle(1, COLORS.gold, 0.28)
        );
      }

      const iconKey = evolution && def.evolutionId ? `up-${this.evolutionIcon(def.evolutionId)}` : `up-${def.id}`;
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
      const family = evolution
        ? 'ЭВОЛЮЦИЯ ГОТОВА'
        : `${UPGRADE_FAMILY_LABELS[def.family]} · ${def.rarity === 'rare' ? 'РЕДКИЙ' : 'СТАНДАРТ'}`;
      card.add(
        this.add
          .text(tx, -ch / 2 + 8, family, {
            fontFamily: FONT,
            fontSize: compact ? '9px' : '10px',
            fontStyle: 'bold',
            color: evolution ? '#ffe066' : def.rarity === 'rare' ? '#cbb6ff' : '#73eaff',
          })
          .setResolution(2)
      );

      card.add(
        this.add
          .text(tx, -ch / 2 + (compact ? 22 : 24), def.shortName, {
            fontFamily: FONT,
            fontSize: evolution ? (compact ? '16px' : '18px') : compact ? '14px' : '15px',
            fontStyle: 'bold',
            color: evolution ? '#ffe066' : '#e8f4ff',
          })
          .setResolution(2)
      );

      card.add(
        this.add
          .text(tx, -ch / 2 + (compact ? 43 : 47), def.name, {
            fontFamily: FONT,
            fontSize: compact ? '10px' : '11px',
            fontStyle: 'bold',
            color: evolution ? '#fff1ac' : def.rarity === 'rare' ? '#cbb6ff' : '#73eaff',
            wordWrap: { width: Math.max(100, right - tx) },
          })
          .setResolution(2)
      );

      if (!compact && !evolution) {
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
            .text(right, ch / 2 - 19, evolution ? 'ПЕРЕПИСАТЬ ПРОТОКОЛ' : 'РАЗОВЫЙ ПРОТОКОЛ', {
              fontFamily: FONT,
              fontSize: '9px',
              fontStyle: evolution ? 'bold' : 'normal',
              color: evolution ? '#ffe066' : '#7dff6e',
            })
            .setOrigin(1, 0)
            .setResolution(2)
        );
      }

      bg.setInteractive({ useHandCursor: true }).on('pointerup', () => {
        Sfx.play('click');
        const more = gs.chooseUpgrade(def.id);
        const evolutionId = gs.consumeEvolutionCeremony();
        if (evolutionId) {
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
      bg.on('pointerover', () => bg.setFillStyle(evolution ? 0x332d18 : COLORS.panelHover, 1));
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

  private showEvolutionCeremony(id: EvolutionId, moreChoices: boolean): void {
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
    c.add([outer, inner]);
    this.tweens.add({ targets: outer, scale: 1.75, alpha: 0.08, duration: 760, ease: 'Quad.Out' });
    this.tweens.add({ targets: inner, scale: 0.55, alpha: 1, duration: 300, yoyo: true, ease: 'Sine.InOut' });

    (this.fanfare as TintableEmitter).setParticleTint?.(COLORS.gold);
    this.fanfare.emitParticleAt(W / 2, H * 0.43, 38);

    c.add(
      this.add
        .text(W / 2, H * 0.21, 'ЭВОЛЮЦИЯ ЯДРА', {
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
        .text(W / 2, H * 0.69, 'ПРОТОКОЛ ПЕРЕПИСАН', {
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
    MessengerBridge.haptic('heavy');

    this.time.delayedCall(1050, () => {
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

  private evolutionIcon(id: EvolutionId): string {
    if (id === 'prism') return 'pierce';
    if (id === 'halo') return 'orbit';
    return 'nova';
  }

  private hideModal(): void {
    this.modal?.destroy();
    this.modal = null;
    this.modalOpen = false;
    this.uiBlocked = false;
  }

  private showGameOver(res: RunResult): void {
    this.uiBlocked = true;
    Analytics.track('game_over_shown', {
      win: res.win,
      daily: !!res.daily,
      rank: res.rank,
    });
    const W = this.scale.width;
    const H = this.scale.height;
    const compact = H < 650;
    const c = this.add.container(0, 0).setDepth(110);

    c.add(this.add.rectangle(W / 2, H / 2, W, H, 0x05070f, 0.84).setInteractive());

    const titleY = compact ? H * 0.1 : H * 0.13;

    // «Скриншот-момент»: финальный кадр должен быть красивым — свечение за
    // заголовком, вспышка (победа) и салют частиц.
    const glow = this.add
      .image(W / 2, titleY - 12, 'glow')
      .setDisplaySize(Math.min(W * 0.95, 460), 300)
      .setTint(res.win ? COLORS.gold : COLORS.red)
      .setAlpha(res.win ? 0.5 : 0.32)
      .setBlendMode(Phaser.BlendModes.ADD);
    c.add(glow);
    this.tweens.add({
      targets: glow,
      scale: 1.07,
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    });
    (this.fanfare as TintableEmitter).setParticleTint?.(res.win ? COLORS.gold : COLORS.red);
    this.fanfare.emitParticleAt(W / 2, titleY, res.win ? 36 : 12);
    if (res.win) {
      this.cameras.main.flash(240, 255, 236, 200);
      (this.fanfare as TintableEmitter).setParticleTint?.(COLORS.cyan);
    }
    c.add(
      this.add
        .text(W / 2, titleY, res.win ? 'ЯДРО СТАБИЛИЗИРОВАНО' : 'ЯДРО ПОТЕРЯНО', {
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
          `${IDENTITY.kills}: ${res.kills}   ·   Ядро: ${res.level}   ·   Комбо: ×${res.comboBest}`,
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
        .text(W / 2, detailY, `ЭВОЛЮЦИИ: ${evoText}`, {
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

    detailY += compact ? 25 : 29;
    const build = this.buildSummary(res.stacks);
    c.add(
      this.add
        .text(W / 2, detailY, `СБОРКА: ${build || 'базовое ядро'}`, {
          fontFamily: FONT,
          fontSize: compact ? '9px' : '10px',
          color: '#8f9ab7',
          align: 'center',
          wordWrap: { width: W - 42 },
        })
        .setOrigin(0.5)
        .setResolution(2)
    );

    const rec: string[] = [];
    if (res.records.timeRecord && res.timeMs > 0) rec.push(res.win ? 'победа' : 'выживание');
    if (res.records.killsRecord) rec.push('очищено');
    if (res.records.levelRecord) rec.push('ядро');
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

    // Daily-результат: стрик + рекорд дня.
    if (res.daily) {
      detailY += compact ? 24 : 29;
      const n = res.daily.streak;
      const days = n === 1 ? 'день' : n < 5 ? 'дня' : 'дней';
      const parts = [`стрик: ${n} ${days}`];
      if (res.daily.newStreak) parts.push('НОВЫЙ СТРИК!');
      if (res.daily.dailyRecord) parts.push('РЕКОРД ДНЯ');
      c.add(
        this.add
          .text(W / 2, detailY, `📅 ЕЖЕДНЕВНОЕ · ${parts.join(' · ')}`, {
            fontFamily: FONT,
            fontSize: compact ? '10px' : '11px',
            fontStyle: 'bold',
            color: '#73eaff',
            align: 'center',
            wordWrap: { width: W - 42 },
          })
          .setOrigin(0.5)
          .setResolution(2)
      );
    }

    // Мест в локальном топе-10.
    if (res.rank && res.rank <= 5) {
      detailY += compact ? 22 : 26;
      c.add(
        this.add
          .text(W / 2, detailY, `🏅 В ЛОКАЛЬНОМ ТОПЕ: №${res.rank}`, {
            fontFamily: FONT,
            fontSize: compact ? '10px' : '11px',
            fontStyle: 'bold',
            color: '#ffe066',
            align: 'center',
          })
          .setOrigin(0.5)
          .setResolution(2)
      );
    }

    // V4: «общий» результат дня — «ты №N из M сегодня» (для daily-забега).
    if (res.daily) {
      detailY += compact ? 22 : 26;
      const drY = detailY;
      void ServerClient.getDailyRank(ServerClient.serverUid() ?? '', MessengerBridge.kind).then(
        (d) => {
          if (!d || d.rank == null || !this.scene.isActive()) return;
          const t = this.add
            .text(W / 2, drY, `📅 СЕГОДНЯ: №${d.rank} из ${d.total}`, {
              fontFamily: FONT,
              fontSize: compact ? '10px' : '11px',
              fontStyle: 'bold',
              color: '#73eaff',
              align: 'center',
            })
            .setOrigin(0.5)
            .setResolution(2);
          try {
            c.add(t);
          } catch {
            /* overlay уже закрыт */
          }
        }
      );
    }

    // K1: осколки ядра за забег — валюта метапрогресса.
    if (res.shardsEarned > 0) {
      detailY += compact ? 22 : 26;
      c.add(
        this.add
          .text(W / 2, detailY, `⬢ +${res.shardsEarned} ОСКОЛКИ`, {
            fontFamily: FONT,
            fontSize: compact ? '10px' : '11px',
            fontStyle: 'bold',
            color: '#7dff6e',
            align: 'center',
          })
          .setOrigin(0.5)
          .setResolution(2)
      );
    }

    const gs = this.gs;
    const gap = compact ? 50 : 56;
    const btnH = 46;
    // Нижняя кнопка не должна уходить за home-indicator / нижнюю панель.
    const maxFirstY = H - SafeArea.bottom - 16 - (btnH * 4 + gap * 3);
    let y = Math.min(
      Math.max(H * (compact ? 0.66 : 0.68), detailY + (compact ? 54 : 62)),
      maxFirstY
    );

    // V2: топ друзей по реф-рёбрам — над кнопками, только если есть связи.
    // Асинхронно; без друзей — ничего не рисуем (без пустого слота).
    const friendUid = ServerClient.localUid();
    if (friendUid && MessengerBridge.kind !== 'browser') {
      void ServerClient.getFriends(friendUid, MessengerBridge.kind).then((friends) => {
        if (!friends || friends.length === 0 || !this.scene.isActive()) return;
        const lines = friends.slice(0, 2).map((f) => {
          const rel = f.relation === 'inviter' ? 'позвал' : f.relation === 'invited' ? 'ты позвал' : 'друзья';
          const last = f.uid.length > 4 ? '···' + f.uid.slice(-4) : f.uid;
          return `${f.win ? '🏆' : '⏱'} ${last}  ${fmtTime(f.timeMs)} · ${f.kills}  (${rel})`;
        });
        const t = this.add
          .text(W / 2, y - (compact ? 30 : 38), `ДРУЗЬЯ\n${lines.join('\n')}`, {
            fontFamily: FONT,
            fontSize: compact ? '10px' : '11px',
            color: '#73eaff',
            align: 'center',
            lineSpacing: 3,
          })
          .setOrigin(0.5)
          .setResolution(2);
        try {
          c.add(t);
        } catch {
          /* overlay уже закрыт */
        }
      });
    }

    const cam = this.cameras.main;
    // Все «выходы» — через тёмный fade, без жёстких склеек сцены.
    const go = (fn: () => void): void => {
      Sfx.play('click');
      cam.fadeOut(240, 11, 14, 26);
      cam.once('camerafadeoutcomplete', fn);
    };
    this.button(c, 'ЕЩЁ РАЗ', W / 2, y, true, () =>
      go(() => {
        this.scene.stop();
        if (gs) {
          gs.scene.resume();
          gs.scene.restart();
        }
      })
    );
    y += gap;
    // V5: при победе и доступном клипе «ПОДЕЛИТЬСЯ» сначала шлёт видео-клип
    // (Web Share API с файлом); не поддержано/отмена → фолбэк на карточку.
    const clipPromise =
      (this.registry.get('runClip') as Promise<RecordedClip | null> | null) ?? null;
    this.button(c, 'ПОДЕЛИТЬСЯ', W / 2, y, false, () => {
      Analytics.track('share_opened');
      const mode = this.registry.get('runMode') as
        | { daily: boolean; dateKey: string }
        | undefined;
      const input = {
        win: res.win,
        timeMs: res.timeMs,
        kills: res.kills,
        level: res.level,
        evolutions: res.evolutions,
        daily: mode?.daily ?? false,
        dateKey: mode?.dateKey ?? '',
        records: res.records,
      };
      const text = buildShareText(input);
      const link = buildShareLink(input);
      const card = (): void => {
        void shareCard(text, link).then((outcome) => {
          Analytics.track('share_done', { channel: outcome });
          if (outcome === 'clipboard') this.toast(c, 'Скопировано — вставь в чат');
          else if (outcome === 'failed') this.toast(c, 'Шеринг работает в MAX / Telegram');
        });
      };
      void (async () => {
        if (res.win && clipPromise) {
          const clip = await clipPromise;
          if (clip && (await shareClip(clip, text, link))) {
            Analytics.track('share_done', { channel: 'clip' });
            return;
          }
        }
        card();
      })();
    });
    y += gap;
    // V1: виральный рост — приглашение по личной реф-ссылке.
    this.button(c, 'ПРИГЛАСИТЬ', W / 2, y, false, () => {
      Analytics.track('ref_shared');
      const uid = ServerClient.localUid() ?? ServerClient.anonId();
      const link = buildRefLink(uid);
      const text =
        '⚡️ OFELIYA — удержи ядро\nПриходи по моей ссылке: бонус на первый забег!';
      void shareCard(text, link).then((outcome) => {
        Analytics.track('ref_share_done', { channel: outcome });
        if (outcome === 'clipboard') this.toast(c, 'Ссылка скопирована — отправь другу');
        else if (outcome === 'failed') this.toast(c, 'Ссылка работает в MAX / Telegram');
      });
    });
    y += gap;
    this.button(c, 'В МЕНЮ', W / 2, y, false, () =>
      go(() => {
        this.scene.stop();
        if (gs) {
          gs.scene.stop();
          gs.scene.start('Menu');
        }
      })
    );
  }

  private buildSummary(stacks: Record<string, number>): string {
    const labels: Record<string, string> = {
      dmg: 'ИМПУЛЬС',
      rate: 'РАЗГОН',
      multi: 'ЗАЛП',
      pierce: 'СКВОЗНОЙ',
      speed: 'СКОРОСТЬ',
      hp: 'БРОНЯ',
      magnet: 'ПОЛЕ',
      orbit: 'КОЛЬЦО',
      nova: 'ВОЛНА',
      regen: 'РЕМОНТ',
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
      .rectangle(x, y, w, h, primary ? COLORS.cyan : COLORS.panel, primary ? 0.18 : 0.95)
      .setStrokeStyle(2, primary ? COLORS.cyan : COLORS.stroke, 1);
    const t = this.add
      .text(x, y, label, {
        fontFamily: FONT,
        fontSize: '16px',
        fontStyle: 'bold',
        color: primary ? '#35e0ff' : '#e8f4ff',
      })
      .setOrigin(0.5)
      .setResolution(2);
    bg.setInteractive({ useHandCursor: true }).on('pointerup', () => cb());
    bg.on('pointerover', () => bg.setFillStyle(COLORS.panelHover, 1));
    bg.on('pointerout', () =>
      bg.setFillStyle(primary ? COLORS.cyan : COLORS.panel, primary ? 0.18 : 0.95)
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
