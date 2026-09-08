import Phaser from 'phaser';
import { COLORS, FONT, fmtTime } from '../game/config';
import { IDENTITY } from '../game/identity';
import { MaxBridge } from '../systems/MaxBridge';
import { SaveSystem } from '../systems/SaveSystem';
import { Sfx } from '../systems/Sfx';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    const W = this.scale.width;
    const H = this.scale.height;
    this.cameras.main.setBackgroundColor(COLORS.bg);
    Sfx.stopMusic();
    MaxBridge.setBackHandler(null);

    const grid = this.add
      .tileSprite(0, 0, W, H, 'grid')
      .setOrigin(0)
      .setDepth(-10);
    grid.tilePositionX = 40;
    grid.tilePositionY = 90;
    this.add.image(W / 2, H / 2, 'vignette').setDisplaySize(W * 1.25, H * 1.25).setDepth(-9);

    const decor = [
      { tex: 'enemy-swarm', x: 0.16, y: 0.3 },
      { tex: 'enemy-runner', x: 0.86, y: 0.24 },
      { tex: 'enemy-brute', x: 0.78, y: 0.78 },
      { tex: 'gem', x: 0.12, y: 0.72 },
    ];
    decor.forEach((d, i) => {
      const s = this.add
        .image(W * d.x, H * d.y, d.tex)
        .setAlpha(0.3)
        .setAngle(Phaser.Math.Between(-15, 15));
      this.tweens.add({
        targets: s,
        y: s.y + Phaser.Math.Between(-14, 14),
        angle: s.angle + Phaser.Math.Between(-12, 12),
        duration: 2200 + i * 350,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      });
    });

    const title = this.add
      .text(W / 2, H * 0.24, 'OFELIYA', {
        fontFamily: FONT,
        fontSize: '56px',
        fontStyle: 'bold',
        color: '#35e0ff',
      })
      .setOrigin(0.5)
      .setResolution(2);
    title.setShadow(0, 0, 'rgba(53,224,255,0.85)', 22, true, true);

    this.add
      .text(W / 2, H * 0.24 + 46, IDENTITY.copy.menuTagline, {
        fontFamily: FONT,
        fontSize: '14px',
        color: '#aab4d4',
      })
      .setOrigin(0.5)
      .setResolution(2);

    const displayName = MaxBridge.getDisplayName();
    if (MaxBridge.available && displayName) {
      this.add
        .text(W / 2, H * 0.24 + 70, `Привет, ${displayName}!`, {
          fontFamily: FONT,
          fontSize: '13px',
          color: '#7dff6e',
        })
        .setOrigin(0.5)
        .setResolution(2);
    }

    const save = SaveSystem.get();
    const survival = save.bestSurvivalMs > 0 ? fmtTime(save.bestSurvivalMs) : '—';
    const victory = save.bestWinTimeMs > 0 ? fmtTime(save.bestWinTimeMs) : '—';
    const records =
      save.runs > 0
        ? `Выживание ${survival}   ·   Победа ${victory}\nОчищено ${save.bestKills}   ·   Ядро ${save.bestLevel}`
        : IDENTITY.copy.firstRun;
    this.add
      .text(W / 2, H * 0.45, records, {
        fontFamily: FONT,
        fontSize: '14px',
        color: '#e8f4ff',
        align: 'center',
        lineSpacing: 5,
      })
      .setOrigin(0.5)
      .setResolution(2);

    const btnY = H * 0.64;
    const btnBg = this.add
      .rectangle(W / 2, btnY, 250, 64, COLORS.cyan, 0.16)
      .setStrokeStyle(2, COLORS.cyan, 1);
    this.add
      .text(W / 2, btnY, 'ЗАПУСТИТЬ ЯДРО', {
        fontFamily: FONT,
        fontSize: '21px',
        fontStyle: 'bold',
        color: '#35e0ff',
      })
      .setOrigin(0.5)
      .setResolution(2);
    btnBg.setInteractive({ useHandCursor: true }).on('pointerup', () => {
      Sfx.play('click');
      this.scene.start('Game');
    });
    btnBg.on('pointerover', () => btnBg.setFillStyle(COLORS.cyan, 0.28));
    btnBg.on('pointerout', () => btnBg.setFillStyle(COLORS.cyan, 0.16));

    const soundText = this.add
      .text(W / 2, btnY + 58, `звук: ${Sfx.muted ? 'выкл' : 'вкл'}`, {
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

    this.add
      .text(W / 2, H - 52, IDENTITY.copy.howToPlay, {
        fontFamily: FONT,
        fontSize: '12px',
        color: '#8a94b0',
        align: 'center',
        wordWrap: { width: W - 40 },
      })
      .setOrigin(0.5, 0)
      .setResolution(2);

    this.add
      .text(W / 2, H - 12, `mini-app · MAX · v0.1.0 · ${MaxBridge.platform}`, {
        fontFamily: FONT,
        fontSize: '10px',
        color: '#5a6480',
      })
      .setOrigin(0.5, 1)
      .setResolution(2);

    this.scale.on('resize', this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.onResize, this);
    });
  }

  private onResize(): void {
    this.scene.restart();
  }
}
