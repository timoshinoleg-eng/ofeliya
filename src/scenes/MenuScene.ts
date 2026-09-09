import Phaser from 'phaser';
import { parseChallengePayload } from '../game/Challenge';
import { COLORS, FONT, fmtTime } from '../game/config';
import { IDENTITY } from '../game/identity';
import { ensureStrainZeroTextures } from '../game/StrainZeroTextures';
import { showLegalOverlay } from '../legal/LegalOverlay';
import { PlatformBridge } from '../platform';
import { SaveSystem } from '../systems/SaveSystem';
import { Sfx } from '../systems/Sfx';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    ensureStrainZeroTextures(this);
    const W = this.scale.width;
    const H = this.scale.height;
    this.cameras.main.setBackgroundColor(COLORS.bg);
    Sfx.stopMusic();
    PlatformBridge.setBackHandler(null);

    const incomingChallenge = parseChallengePayload(PlatformBridge.getStartParam());
    // Registry keeps the social target across Menu -> Game -> UI and fast restarts. It is display
    // context only: gameplay/rewards never consume it.
    this.registry.set('challengeTarget', incomingChallenge);

    const plasma = this.add
      .tileSprite(0, 0, W, H, 'blood-plasma')
      .setOrigin(0)
      .setDepth(-20);
    this.tweens.add({
      targets: plasma,
      tilePositionX: -120,
      duration: 9000,
      repeat: -1,
      ease: 'Linear',
    });

    const bloodCells = [
      { x: 0.07, y: 0.22, scale: 1.15, alpha: 0.25 },
      { x: 0.9, y: 0.18, scale: 0.75, alpha: 0.22 },
      { x: 0.82, y: 0.74, scale: 1.35, alpha: 0.2 },
      { x: 0.12, y: 0.82, scale: 0.82, alpha: 0.18 },
      { x: 0.92, y: 0.48, scale: 0.55, alpha: 0.16 },
    ];
    bloodCells.forEach((d, i) => {
      const cell = this.add
        .image(W * d.x, H * d.y, 'erythrocyte')
        .setScale(d.scale)
        .setAlpha(d.alpha)
        .setDepth(-12)
        .setRotation(Phaser.Math.FloatBetween(-Math.PI, Math.PI));
      this.tweens.add({
        targets: cell,
        x: cell.x + (i % 2 === 0 ? 28 : -22),
        y: cell.y + Phaser.Math.Between(-10, 10),
        rotation: cell.rotation + (i % 2 === 0 ? 0.25 : -0.2),
        duration: 4200 + i * 520,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      });
    });

    const host = this.add
      .image(W * 0.5, H * 0.3, 'host-cell-shadow')
      .setScale(H < 650 ? 1.1 : 1.4)
      .setAlpha(0.1)
      .setDepth(-10);
    this.tweens.add({
      targets: host,
      scale: host.scaleX * 1.07,
      alpha: 0.14,
      duration: 2600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    });

    const virus = this.add
      .image(W / 2, H * 0.28, 'virus-player')
      .setScale(H < 650 ? 1.8 : 2.15)
      .setDepth(2)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: virus,
      rotation: Math.PI * 2,
      duration: 12000,
      repeat: -1,
      ease: 'Linear',
    });
    this.tweens.add({
      targets: virus,
      scale: virus.scaleX * 1.06,
      duration: 1150,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    });

    const titleY = H < 650 ? H * 0.08 : H * 0.09;
    const title = this.add
      .text(W / 2, titleY, 'OFELIYA', {
        fontFamily: FONT,
        fontSize: H < 650 ? '42px' : '50px',
        fontStyle: 'bold',
        color: '#fff4ec',
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setDepth(5);
    title.setShadow(0, 0, 'rgba(255,79,181,0.75)', 18, true, true);

    this.add
      .text(W / 2, titleY + (H < 650 ? 38 : 46), 'STRAIN ZERO', {
        fontFamily: FONT,
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#ff78c8',
        letterSpacing: 4,
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setDepth(5);

    const hookY = H * 0.43;
    this.add
      .text(W / 2, hookY, 'ОРГАНИЗМ ЕЩЁ НЕ ЗНАЕТ,\nЧТО ТЫ ЗДЕСЬ', {
        fontFamily: FONT,
        fontSize: H < 650 ? '14px' : '16px',
        fontStyle: 'bold',
        color: '#fff4ec',
        align: 'center',
        lineSpacing: 4,
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setDepth(5);

    this.add
      .text(W / 2, hookY + 46, 'Мутируй быстрее, чем иммунитет адаптируется.', {
        fontFamily: FONT,
        fontSize: H < 650 ? '10px' : '11px',
        color: '#d9a5b8',
        align: 'center',
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setDepth(5);

    const displayName = PlatformBridge.getDisplayName();
    if (PlatformBridge.available && displayName) {
      this.add
        .text(W / 2, hookY + 70, `Носитель: ${displayName}`, {
          fontFamily: FONT,
          fontSize: '10px',
          color: '#8fe8ff',
        })
        .setOrigin(0.5)
        .setResolution(2)
        .setDepth(5);
    }

    if (incomingChallenge) {
      const challengeY = H * 0.57;
      const panelW = Math.min(W - 42, 330);
      this.add
        .rectangle(W / 2, challengeY, panelW, 58, 0x251020, 0.9)
        .setStrokeStyle(1.5, COLORS.gold, 0.78)
        .setDepth(4);
      this.add
        .text(W / 2, challengeY - 15, 'ВЫЗОВ ПОЛУЧЕН', {
          fontFamily: FONT,
          fontSize: H < 650 ? '10px' : '11px',
          fontStyle: 'bold',
          color: '#ffe066',
          letterSpacing: 1,
        })
        .setOrigin(0.5)
        .setResolution(2)
        .setDepth(5);
      const target =
        incomingChallenge.objective === 'clear'
          ? `Подави IMMUNE PRIME быстрее ${fmtTime(incomingChallenge.timeMs)}`
          : `Продержись дольше ${fmtTime(incomingChallenge.timeMs)}`;
      this.add
        .text(W / 2, challengeY + 2, target, {
          fontFamily: FONT,
          fontSize: H < 650 ? '10px' : '11px',
          fontStyle: 'bold',
          color: '#fff4ec',
          align: 'center',
        })
        .setOrigin(0.5)
        .setResolution(2)
        .setDepth(5);
      this.add
        .text(
          W / 2,
          challengeY + 18,
          `${incomingChallenge.kills} иммун. · ${incomingChallenge.hostCellsInfected} клеток · мутация ${incomingChallenge.level}`,
          {
            fontFamily: FONT,
            fontSize: '9px',
            color: '#c89aaf',
            align: 'center',
          }
        )
        .setOrigin(0.5)
        .setResolution(2)
        .setDepth(5);
    } else {
      const save = SaveSystem.get();
      const survival = save.bestSurvivalMs > 0 ? fmtTime(save.bestSurvivalMs) : '—';
      const victory = save.bestWinTimeMs > 0 ? fmtTime(save.bestWinTimeMs) : '—';
      const records =
        save.runs > 0
          ? `Лучшее выживание ${survival}   ·   подавление иммунитета ${victory}\nИммунных клеток ${save.bestKills}   ·   стадия мутации ${save.bestLevel}`
          : 'STRAIN-0 · ПЕРВЫЙ ЦИКЛ ЗАРАЖЕНИЯ';
      this.add
        .text(W / 2, H * 0.57, records, {
          fontFamily: FONT,
          fontSize: H < 650 ? '10px' : '11px',
          color: '#e8c9d4',
          align: 'center',
          lineSpacing: 4,
          wordWrap: { width: W - 42 },
        })
        .setOrigin(0.5)
        .setResolution(2)
        .setDepth(5);
    }

    const btnY = H * 0.7;
    const btnW = Math.min(W - 44, 300);
    const btnBg = this.add
      .rectangle(W / 2, btnY, btnW, 66, 0x5c143e, 0.92)
      .setStrokeStyle(2, incomingChallenge ? COLORS.gold : COLORS.magenta, 1)
      .setDepth(5);
    this.add
      .text(W / 2, btnY - 5, incomingChallenge ? 'ПРИНЯТЬ ВЫЗОВ' : 'НАЧАТЬ ЗАРАЖЕНИЕ', {
        fontFamily: FONT,
        fontSize: H < 650 ? '17px' : '19px',
        fontStyle: 'bold',
        color: '#fff4ec',
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setDepth(6);
    this.add
      .text(W / 2, btnY + 18, 'атака автоматическая · движение одним пальцем', {
        fontFamily: FONT,
        fontSize: '9px',
        color: '#ffc0dd',
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setDepth(6);

    btnBg.setInteractive({ useHandCursor: true }).on('pointerup', () => {
      Sfx.play('click');
      PlatformBridge.haptic('medium');
      this.scene.start('Game');
    });
    btnBg.on('pointerover', () => btnBg.setFillStyle(0x7a1a52, 1));
    btnBg.on('pointerout', () => btnBg.setFillStyle(0x5c143e, 0.92));

    const soundText = this.add
      .text(W / 2, btnY + 55, `звук: ${Sfx.muted ? 'выкл' : 'вкл'}`, {
        fontFamily: FONT,
        fontSize: '11px',
        color: Sfx.muted ? '#755266' : '#c89aaf',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .setResolution(2)
      .setDepth(5)
      .on('pointerup', () => {
        const muted = Sfx.toggle();
        soundText.setText(`звук: ${muted ? 'выкл' : 'вкл'}`).setColor(muted ? '#755266' : '#c89aaf');
        if (!muted) Sfx.play('click');
      });

    this.add
      .text(W / 2, H - 54, 'Двигай штамм · собирай РНК · выбирай мутации', {
        fontFamily: FONT,
        fontSize: '10px',
        color: '#8d6678',
        align: 'center',
        wordWrap: { width: W - 36 },
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setDepth(5);

    this.add
      .text(W / 2, H - 31, 'О ПРИЛОЖЕНИИ · ПОЛИТИКА · ПОДДЕРЖКА', {
        fontFamily: FONT,
        fontSize: '9px',
        fontStyle: 'bold',
        color: '#8fe8ff',
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setDepth(6)
      .setInteractive({ useHandCursor: true })
      .on('pointerup', () => {
        Sfx.play('click');
        showLegalOverlay();
      });

    this.add
      .text(W / 2, H - 9, `mini-app · ${PlatformBridge.platform} · v0.1.0`, {
        fontFamily: FONT,
        fontSize: '9px',
        color: '#654454',
      })
      .setOrigin(0.5, 1)
      .setResolution(2)
      .setDepth(5);

    this.scale.on('resize', this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.onResize, this);
    });
  }

  private onResize(): void {
    this.scene.restart();
  }
}
