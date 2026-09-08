import Phaser from 'phaser';
import { COLORS, FONT, fmtTime } from '../game/config';
import { Joystick } from '../game/Joystick';
import { MaxBridge } from '../systems/MaxBridge';
import { Sfx } from '../systems/Sfx';
import type { GameScene } from './GameScene';
import type { UpgradeDef } from '../game/UpgradeSystem';

interface RunSnapshot {
  hp: number;
  maxHp: number;
  level: number;
  xp: number;
  xpNext: number;
  timeMs: number;
  kills: number;
  bossHp: number;
  bossMax: number;
}

interface RunResult {
  win: boolean;
  timeMs: number;
  kills: number;
  level: number;
  records: { timeRecord: boolean; killsRecord: boolean; levelRecord: boolean };
}

const DEPTH = 50;

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

  private modal: Phaser.GameObjects.Container | null = null;
  private modalOpen = false;
  private overShown = false;
  private uiBlocked = false;

  constructor() {
    super('UI');
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

    this.timerText = text(W / 2, 28, '00:00', 24, '#e8f4ff');
    this.levelText = text(16, 30, 'УР 1', 15, '#35e0ff', 0);
    this.killsText = text(W - 16, 30, 'уб. 0', 15, '#aab4d4', 1);
    this.hpText = text(W / 2, 58, '', 10, '#e8f4ff');
    this.bossLabel = text(W / 2, 72, 'БОСС', 11, '#ff3860');
    this.muteText = this.add
      .text(W - 16, 54, '♪', { fontFamily: FONT, fontSize: '16px', color: Sfx.muted ? '#5a6480' : '#35e0ff' })
      .setOrigin(1, 0)
      .setResolution(2)
      .setDepth(DEPTH + 1)
      .setInteractive({ useHandCursor: true })
      .on('pointerup', () => {
        const muted = Sfx.toggle();
        this.muteText
          .setText('♪')
          .setColor(muted ? '#5a6480' : '#35e0ff');
      });

    this.joystick = new Joystick(this, () => this.uiBlocked);

    this.scale.on('resize', this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.layout, this);
    });
    this.layout();
  }

  update(): void {
    const run = this.registry.get('run') as RunSnapshot | undefined;
    const W = this.scale.width;
    if (run) {
      // XP-бар
      this.xpBack.clear();
      this.xpBack.fillStyle(0x1a2136, 0.9);
      this.xpBack.fillRoundedRect(12, 12, W - 24, 10, 5);
      this.xpFill.clear();
      const xf = Phaser.Math.Clamp(run.xp / run.xpNext, 0, 1);
      if (xf > 0) {
        this.xpFill.fillStyle(COLORS.cyan, 1);
        this.xpFill.fillRoundedRect(12, 12, Math.max((W - 24) * xf, 10), 10, 5);
      }

      this.timerText.setText(fmtTime(run.timeMs));
      this.levelText.setText(`УР ${run.level}`);
      this.killsText.setText(`уб. ${run.kills}`);

      // HP-бар
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

      // полоска босса
      const boss = run.bossMax > 0;
      this.bossBack.setVisible(boss);
      this.bossFill.setVisible(boss);
      this.bossLabel.setVisible(boss);
      if (boss) {
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

    // левелап
    if (this.gs && this.gs.awaitingChoice && !this.modalOpen && !this.overShown) {
      this.showLevelUp();
    }

    // итог забега
    const res = this.registry.get('runResult') as RunResult | undefined | null;
    if (res && !this.overShown) {
      this.overShown = true;
      this.hideModal();
      this.showGameOver(res);
    }
  }

  private layout(): void {
    const W = this.scale.width;
    this.timerText.setX(W / 2);
    this.levelText.setX(16);
    this.killsText.setX(W - 16);
    this.hpText.setX(W / 2);
    this.bossLabel.setX(W / 2);
    this.muteText.setX(W - 16);
  }

  // --- модалка левелапа ---

  private showLevelUp(): void {
    const gs = this.gs;
    if (!gs) return;
    this.modalOpen = true;
    this.uiBlocked = true;
    // пауза боя на время выбора улучшения
    this.scene.pause('Game');
    Sfx.play('levelup');
    MaxBridge.notify('success');

    const W = this.scale.width;
    const H = this.scale.height;
    const c = this.add.container(0, 0).setDepth(100);
    this.modal = c;

    const dim = this.add.rectangle(W / 2, H / 2, W, H, 0x05070f, 0.72).setInteractive();
    c.add(dim);

    c.add(
      this.add
        .text(W / 2, H * 0.14, `УРОВЕНЬ ${gs.runState.level}`, {
          fontFamily: FONT,
          fontSize: '30px',
          fontStyle: 'bold',
          color: '#35e0ff',
        })
        .setOrigin(0.5)
        .setResolution(2)
        .setShadow(0, 0, 'rgba(53,224,255,0.7)', 14, true, true)
    );
    c.add(
      this.add
        .text(W / 2, H * 0.14 + 40, 'выбери улучшение', {
          fontFamily: FONT,
          fontSize: '14px',
          color: '#aab4d4',
        })
        .setOrigin(0.5)
        .setResolution(2)
    );

    const cards = gs.pendingChoices;
    const cw = Math.min(W - 40, 340);
    const ch = 88;
    const gap = 14;
    const totalH = cards.length * ch + (cards.length - 1) * gap;
    let y = H / 2 - totalH / 2 + ch / 2;

    cards.forEach((def: UpgradeDef) => {
      const card = this.add.container(W / 2, y);
      const bg = this.add
        .rectangle(0, 0, cw, ch, COLORS.panel, 0.98)
        .setStrokeStyle(2, COLORS.cyan, 0.85);
      const nameT = this.add
        .text(-cw / 2 + 16, -ch / 2 + 12, def.name, {
          fontFamily: FONT,
          fontSize: '17px',
          fontStyle: 'bold',
          color: '#e8f4ff',
        })
        .setResolution(2);
      const descT = this.add
        .text(-cw / 2 + 16, -ch / 2 + 38, def.desc, {
          fontFamily: FONT,
          fontSize: '12px',
          color: '#aab4d4',
          wordWrap: { width: cw - 70 },
        })
        .setResolution(2);
      card.add([bg, nameT, descT]);
      const stacks = gs.runState.stackOf(def.id);
      if (stacks > 0) {
        card.add(
          this.add
            .text(cw / 2 - 12, -ch / 2 + 10, `×${stacks}`, {
              fontFamily: FONT,
              fontSize: '12px',
              color: '#5a6480',
            })
            .setOrigin(1, 0)
            .setResolution(2)
        );
      }
      bg.setInteractive({ useHandCursor: true }).on('pointerup', () => {
        Sfx.play('click');
        const more = gs.chooseUpgrade(def.id);
        if (more) {
          c.destroy();
          this.showLevelUp();
        } else {
          this.hideModal();
          this.scene.resume('Game');
        }
      });
      bg.on('pointerover', () => bg.setFillStyle(COLORS.panelHover, 0.98));
      bg.on('pointerout', () => bg.setFillStyle(COLORS.panel, 0.98));

      c.add(card);
      card.setScale(0.92).setAlpha(0);
      this.tweens.add({ targets: card, scale: 1, alpha: 1, duration: 150, ease: 'Back.Out' });

      y += ch + gap;
    });
  }

  private hideModal(): void {
    this.modal?.destroy();
    this.modal = null;
    this.modalOpen = false;
    this.uiBlocked = false;
  }

  // --- итог забега ---

  private showGameOver(res: RunResult): void {
    this.uiBlocked = true;
    const W = this.scale.width;
    const H = this.scale.height;
    const c = this.add.container(0, 0).setDepth(110);

    c.add(this.add.rectangle(W / 2, H / 2, W, H, 0x05070f, 0.8).setInteractive());

    c.add(
      this.add
        .text(W / 2, H * 0.2, res.win ? 'ПОБЕДА!' : 'ИГРА ОКОНЧЕНА', {
          fontFamily: FONT,
          fontSize: '34px',
          fontStyle: 'bold',
          color: res.win ? '#ffe066' : '#ff3860',
        })
        .setOrigin(0.5)
        .setResolution(2)
        .setShadow(0, 0, res.win ? 'rgba(255,224,102,0.7)' : 'rgba(255,56,96,0.7)', 16, true, true)
    );

    c.add(
      this.add
        .text(W / 2, H * 0.2 + 58, fmtTime(res.timeMs), {
          fontFamily: FONT,
          fontSize: '46px',
          fontStyle: 'bold',
          color: '#e8f4ff',
        })
        .setOrigin(0.5)
        .setResolution(2)
    );

    c.add(
      this.add
        .text(W / 2, H * 0.2 + 104, `Убийств: ${res.kills}   ·   Уровень: ${res.level}`, {
          fontFamily: FONT,
          fontSize: '14px',
          color: '#aab4d4',
        })
        .setOrigin(0.5)
        .setResolution(2)
    );

    const rec: string[] = [];
    if (res.records.timeRecord && res.timeMs > 0) rec.push('время');
    if (res.records.killsRecord) rec.push('убийства');
    if (res.records.levelRecord) rec.push('уровень');
    if (rec.length > 0) {
      c.add(
        this.add
          .text(W / 2, H * 0.2 + 130, `НОВЫЕ РЕКОРДЫ: ${rec.join(' · ')}`, {
            fontFamily: FONT,
            fontSize: '13px',
            fontStyle: 'bold',
            color: '#ffe066',
          })
          .setOrigin(0.5)
          .setResolution(2)
      );
    }

    const gs = this.gs;
    let y = H * 0.6;
    this.button(c, 'ЕЩЁ РАЗ', W / 2, y, true, () => {
      this.scene.stop();
      if (gs) {
        gs.scene.resume();
        gs.scene.restart();
      }
    });
    y += 58;
    this.button(c, 'ПОДЕЛИТЬСЯ', W / 2, y, false, () => {
      const mins = fmtTime(res.timeMs);
      const shareText = res.win
        ? `Я убил босса в OFELIYA за ${mins}! Убийств: ${res.kills}. Сможешь быстрее?`
        : `Я продержался ${mins} в OFELIYA и набил ${res.kills} убийств. Сможешь больше?`;
      void MaxBridge.shareResult(shareText).then((ok) => {
        if (!ok) this.toast(c, 'Поделиться можно внутри MAX');
      });
    });
    y += 58;
    this.button(c, 'В МЕНЮ', W / 2, y, false, () => {
      this.scene.stop();
      if (gs) {
        gs.scene.stop();
        gs.scene.start('Menu');
      }
    });
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
