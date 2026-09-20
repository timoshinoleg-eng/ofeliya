import Phaser from 'phaser';
import { parseChallengePayload } from '../game/Challenge';
import { ACHIEVEMENTS } from '../game/AchievementSystem';
import { COLORS, FONT, fmtTime } from '../game/config';
import { IDENTITY } from '../game/identity';
import { LEGENDARIES } from '../game/LegendarySystem';
import { EVOLUTION_NAMES, type EvolutionId } from '../game/UpgradeSystem';
import {
  controlModeDescription,
  controlModeLabel,
  nextControlMode,
  readControlMode,
  writeControlMode,
  type ControlMode,
} from '../game/ControlMode';
import {
  getDifficultyProfile,
  nextDifficultyId,
  readDifficultySelection,
  writeDifficultySelection,
} from '../game/DifficultyProfile';
import { ensureStrainZeroTextures } from '../game/StrainZeroTextures';
import { ensureCinematicTextures } from '../game/CinematicTextures';
import { showLegalOverlay } from '../legal/LegalOverlay';
import { PlatformBridge } from '../platform';
import { SaveSystem } from '../systems/SaveSystem';
import { Sfx } from '../systems/Sfx';

export class MenuScene extends Phaser.Scene {
  private codexOverlay: Phaser.GameObjects.Container | null = null;

  constructor() {
    super('Menu');
  }

  create(): void {
    ensureCinematicTextures(this);
    ensureStrainZeroTextures(this);
    const W = this.scale.width;
    const H = this.scale.height;
    this.codexOverlay = null;
    this.cameras.main.setBackgroundColor(COLORS.bg);
    Sfx.stopMusic();
    PlatformBridge.setBackHandler(null);

    const incomingChallenge = parseChallengePayload(PlatformBridge.getStartParam());
    let selectedDifficulty = incomingChallenge ? 'standard' : readDifficultySelection();
    let selectedControlMode: ControlMode = readControlMode();
    this.registry.set('difficultyId', selectedDifficulty);
    this.registry.set('controlMode', selectedControlMode);
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
      .setDepth(2);
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
    title.setShadow(0, 0, 'rgba(255,79,181,0.48)', 7, true, true);

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
        fontSize: H < 650 ? '11px' : '12px',
        color: '#e7c5d2',
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
        incomingChallenge.objective === 'boss1-clear'
          ? `Подави IMMUNE PRIME быстрее ${fmtTime(incomingChallenge.timeMs)}`
          : incomingChallenge.objective === 'campaign-clear'
            ? `Заверши кампанию быстрее ${fmtTime(incomingChallenge.timeMs)}`
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
      const boss1 = save.bestBoss1ClearMs > 0 ? fmtTime(save.bestBoss1ClearMs) : '—';
      const campaign = save.bestCampaignClearMs > 0 ? fmtTime(save.bestCampaignClearMs) : '—';
      const records =
        save.runs > 0
          ? `Выживание ${survival}   ·   IMMUNE PRIME ${boss1}\nКампания ${campaign}   ·   иммунных клеток ${save.bestKills}`
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

    const difficultyY = H * 0.635;
    const difficultyW = Math.min(W - 52, 286);
    const difficultyBg = this.add
      .rectangle(W / 2, difficultyY, difficultyW, 46, 0x21101d, 0.94)
      .setStrokeStyle(1.4, COLORS.cyan, 0.68)
      .setDepth(5)
      .setInteractive({ useHandCursor: true });
    const difficultyText = this.add
      .text(W / 2, difficultyY - 8, '', {
        fontFamily: FONT,
        fontSize: H < 650 ? '11px' : '12px',
        fontStyle: 'bold',
        color: '#fff4ec',
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setDepth(6);
    const difficultyDesc = this.add
      .text(W / 2, difficultyY + 9, '', {
        fontFamily: FONT,
        fontSize: H < 650 ? '9px' : '10px',
        color: '#b9cbd6',
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setDepth(6);

    const renderDifficulty = () => {
      const profile = getDifficultyProfile(selectedDifficulty);
      difficultyText.setText(
        incomingChallenge ? 'СЛОЖНОСТЬ: СТАНДАРТ · ВЫЗОВ' : `СЛОЖНОСТЬ: ${profile.label}  ›`
      );
      difficultyText.setColor(profile.id === 'strained' ? '#ffe066' : '#fff4ec');
      difficultyDesc.setText(
        incomingChallenge ? 'соревновательные вызовы фиксируют Standard' : profile.description
      );
      difficultyBg.setStrokeStyle(
        profile.id === 'strained' ? 1.8 : 1.4,
        incomingChallenge ? COLORS.gold : profile.id === 'strained' ? COLORS.gold : COLORS.cyan,
        incomingChallenge ? 0.9 : profile.id === 'strained' ? 0.9 : 0.68
      );
    };
    renderDifficulty();
    difficultyBg.on('pointerup', () => {
      Sfx.play('click');
      PlatformBridge.haptic('light');
      if (incomingChallenge) return;
      selectedDifficulty = nextDifficultyId(selectedDifficulty);
      writeDifficultySelection(selectedDifficulty);
      this.registry.set('difficultyId', selectedDifficulty);
      renderDifficulty();
    });
    difficultyBg.on('pointerover', () => difficultyBg.setFillStyle(0x2a1425, 1));
    difficultyBg.on('pointerout', () => difficultyBg.setFillStyle(0x21101d, 0.94));

    const controlY = H * 0.715;
    const controlW = Math.min(W - 52, 286);
    const controlH = H < 650 ? 38 : 42;
    const controlBg = this.add
      .rectangle(W / 2, controlY, controlW, controlH, 0x141d2a, 0.94)
      .setStrokeStyle(1.4, COLORS.magenta, 0.7)
      .setDepth(5)
      .setInteractive({ useHandCursor: true });
    const controlText = this.add
      .text(W / 2, controlY - 7, '', {
        fontFamily: FONT,
        fontSize: H < 650 ? '10px' : '11px',
        fontStyle: 'bold',
        color: '#fff4ec',
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setDepth(6);
    const controlDesc = this.add
      .text(W / 2, controlY + 8, '', {
        fontFamily: FONT,
        fontSize: H < 650 ? '9px' : '10px',
        color: '#b9cbd6',
        align: 'center',
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setDepth(6);
    let startHint: Phaser.GameObjects.Text | null = null;
    const renderControlMode = () => {
      controlText.setText(`УПРАВЛЕНИЕ: ${controlModeLabel(selectedControlMode)}  ›`);
      controlDesc.setText(controlModeDescription(selectedControlMode));
      controlBg.setStrokeStyle(
        selectedControlMode === 'two-hand' ? 1.8 : 1.4,
        selectedControlMode === 'two-hand' ? COLORS.cyan : COLORS.magenta,
        0.82
      );
      startHint?.setText(
        selectedControlMode === 'one-hand'
          ? 'атака автоматическая · движение одним пальцем'
          : 'атака автоматическая · слева движение · справа приоритет'
      );
    };
    renderControlMode();
    controlBg.on('pointerup', () => {
      Sfx.play('click');
      PlatformBridge.haptic('light');
      selectedControlMode = nextControlMode(selectedControlMode);
      writeControlMode(selectedControlMode);
      this.registry.set('controlMode', selectedControlMode);
      renderControlMode();
    });
    controlBg.on('pointerover', () => controlBg.setFillStyle(0x1b2939, 1));
    controlBg.on('pointerout', () => controlBg.setFillStyle(0x141d2a, 0.94));

    const btnY = H * 0.805;
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
    startHint = this.add
      .text(W / 2, btnY + 18, '', {
        fontFamily: FONT,
        fontSize: H < 650 ? '9px' : '10px',
        color: '#ffd4e8',
        align: 'center',
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setDepth(6);
    renderControlMode();

    btnBg.setInteractive({ useHandCursor: true }).on('pointerup', () => {
      Sfx.play('click');
      PlatformBridge.haptic('medium');
      this.scene.start('Game');
    });
    btnBg.on('pointerover', () => btnBg.setFillStyle(0x7a1a52, 1));
    btnBg.on('pointerout', () => btnBg.setFillStyle(0x5c143e, 0.92));

    const utilityY = btnY + (H < 650 ? 48 : 55);
    const soundText = this.add
      .text(W / 2 - 72, utilityY, `звук: ${Sfx.muted ? 'выкл' : 'вкл'}`, {
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

    const codexSave = SaveSystem.get();
    const codexFound = codexSave.evolutionsSeen.length + codexSave.legendarySeen.length;
    this.add
      .text(W / 2 + 72, utilityY, `КОДЕКС ${codexFound}/9`, {
        fontFamily: FONT,
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#8fe8ff',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .setResolution(2)
      .setDepth(5)
      .on('pointerup', () => {
        Sfx.play('click');
        PlatformBridge.haptic('light');
        this.showCodex();
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

  private showCodex(): void {
    if (this.codexOverlay) return;

    const W = this.scale.width;
    const H = this.scale.height;
    const compact = H < 650;
    const save = SaveSystem.get();
    const overlay = this.add.container(0, 0).setDepth(40);
    this.codexOverlay = overlay;

    const dim = this.add
      .rectangle(W / 2, H / 2, W, H, 0x03040a, 0.95)
      .setInteractive();
    const panelW = Math.min(W - 22, 370);
    const panelH = Math.min(H - 34, 650);
    const panel = this.add
      .rectangle(W / 2, H / 2, panelW, panelH, 0x120f19, 0.98)
      .setStrokeStyle(1.5, COLORS.cyan, 0.55);
    overlay.add([dim, panel]);

    const top = H / 2 - panelH / 2;
    const left = W / 2 - panelW / 2;
    overlay.add(
      this.add
        .text(W / 2, top + 26, 'КОДЕКС · STRAIN-0', {
          fontFamily: FONT,
          fontSize: compact ? '17px' : '20px',
          fontStyle: 'bold',
          color: '#fff4ec',
          letterSpacing: 1,
        })
        .setOrigin(0.5)
        .setResolution(2)
    );

    const discovered = save.evolutionsSeen.length + save.legendarySeen.length;
    overlay.add(
      this.add
        .text(W / 2, top + 50, `ОТКРЫТО ${discovered}/9 · ДОСТИЖЕНИЯ ${save.achievements.length}/${ACHIEVEMENTS.length}`, {
          fontFamily: FONT,
          fontSize: '9px',
          fontStyle: 'bold',
          color: '#8fe8ff',
        })
        .setOrigin(0.5)
        .setResolution(2)
    );

    const close = this.add
      .text(left + panelW - 18, top + 14, '×', {
        fontFamily: FONT,
        fontSize: '26px',
        color: '#c89aaf',
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setInteractive({ useHandCursor: true });
    overlay.add(close);

    const body = this.add.container(0, 0);
    overlay.add(body);

    type CodexPage = 'mutations' | 'legendary' | 'mastery';
    let page: CodexPage = 'mutations';
    const tabs: Array<{ id: CodexPage; label: string; x: number; text: Phaser.GameObjects.Text }> = [];
    const tabY = top + 82;
    const tabDefs: Array<[CodexPage, string, number]> = [
      ['mutations', 'МУТАЦИИ', W / 2 - 104],
      ['legendary', 'LEGENDARY', W / 2],
      ['mastery', 'МАСТЕРСТВО', W / 2 + 104],
    ];

    const render = () => {
      body.removeAll(true);
      for (const tab of tabs) {
        tab.text.setColor(tab.id === page ? '#ffe066' : '#7f8da8');
      }

      const bodyTop = top + 116;
      const addText = (
        x: number,
        y: number,
        value: string,
        size = compact ? 10 : 11,
        color = '#e8f4ff',
        width = panelW - 42,
        align: 'left' | 'center' = 'left'
      ) => {
        const text = this.add
          .text(x, y, value, {
            fontFamily: FONT,
            fontSize: `${size}px`,
            color,
            align,
            lineSpacing: 3,
            wordWrap: { width },
          })
          .setOrigin(align === 'center' ? 0.5 : 0, 0)
          .setResolution(2);
        body.add(text);
        return text;
      };

      if (page === 'mutations') {
        addText(W / 2, bodyTop, 'КРИТИЧЕСКИЕ МУТАЦИИ', 11, '#ffe066', panelW - 42, 'center');
        const evolutionIds: EvolutionId[] = ['prism', 'halo', 'singularity'];
        evolutionIds.forEach((id, index) => {
          const found = save.evolutionsSeen.includes(id);
          const y = bodyTop + 38 + index * (compact ? 66 : 72);
          addText(
            left + 28,
            y,
            `${found ? '◆' : '◇'}  ${found ? EVOLUTION_NAMES[id] : 'НЕ ОТКРЫТО'}`,
            compact ? 11 : 12,
            found ? '#ffe066' : '#65718b'
          );
          addText(
            left + 49,
            y + 22,
            found
              ? 'Критическая форма зарегистрирована в Codex.'
              : 'Продолжай развивать совместимые ветви мутаций.',
            compact ? 9 : 10,
            found ? '#c9d6e8' : '#59647c',
            panelW - 76
          );
        });
      } else if (page === 'legendary') {
        addText(W / 2, bodyTop, 'ЛЕГЕНДАРНЫЕ ИЗМЕНЕНИЯ ПРАВИЛ', 11, '#ffe066', panelW - 42, 'center');
        LEGENDARIES.forEach((def, index) => {
          const found = save.legendarySeen.includes(def.id);
          const y = bodyTop + 30 + index * (compact ? 43 : 47);
          addText(
            left + 28,
            y,
            `${found ? '◆' : '◇'}  ${found ? def.title : '???'}`,
            compact ? 10 : 11,
            found ? '#fff1ac' : '#59647c',
            panelW - 54
          );
          if (found) {
            addText(
              left + 49,
              y + 18,
              def.effect,
              compact ? 8 : 9,
              '#aab4d4',
              panelW - 78
            );
          }
        });
      } else {
        const standardBest = save.bestCampaignClearMs > 0 ? fmtTime(save.bestCampaignClearMs) : '—';
        const strainedBest =
          save.bestStrainedCampaignClearMs > 0 ? fmtTime(save.bestStrainedCampaignClearMs) : '—';
        addText(W / 2, bodyTop, 'МАСТЕРСТВО КАМПАНИИ', 11, '#ffe066', panelW - 42, 'center');
        addText(
          left + 28,
          bodyTop + 38,
          `${save.standardCampaignClears > 0 ? '◆' : '◇'} STANDARD · прохождений ${save.standardCampaignClears} · рекорд ${standardBest}`,
          compact ? 10 : 11,
          save.standardCampaignClears > 0 ? '#8fe8ff' : '#65718b'
        );
        addText(
          left + 28,
          bodyTop + 70,
          `${save.strainedCampaignClears > 0 ? '◆' : '◇'} STRAINED · прохождений ${save.strainedCampaignClears} · личный рекорд ${strainedBest}`,
          compact ? 10 : 11,
          save.strainedCampaignClears > 0 ? '#ffe066' : '#65718b'
        );
        addText(
          left + 28,
          bodyTop + 116,
          `ДОСТИЖЕНИЯ · ${save.achievements.length}/${ACHIEVEMENTS.length}`,
          11,
          '#fff4ec'
        );
        const unlocked = ACHIEVEMENTS.filter((achievement) => save.achievements.includes(achievement.id));
        addText(
          left + 28,
          bodyTop + 142,
          unlocked.length
            ? unlocked.map((achievement) => `◆ ${achievement.name}`).join('\n')
            : '◇ Пока нет открытых достижений',
          compact ? 9 : 10,
          unlocked.length ? '#c9d6e8' : '#65718b',
          panelW - 56
        );
        addText(
          left + 28,
          top + panelH - 106,
          `ЦИКЛОВ: ${save.runs}   ·   ИММУННЫХ КЛЕТОК: ${save.totalKills}`,
          9,
          '#8f9ab7'
        );
      }
    };

    for (const [id, label, x] of tabDefs) {
      const tabText = this.add
        .text(x, tabY, label, {
          fontFamily: FONT,
          fontSize: compact ? '9px' : '10px',
          fontStyle: 'bold',
          color: '#7f8da8',
        })
        .setOrigin(0.5)
        .setResolution(2)
        .setInteractive({ useHandCursor: true })
        .on('pointerup', () => {
          page = id;
          Sfx.play('click');
          render();
        });
      tabs.push({ id, label, x, text: tabText });
      overlay.add(tabText);
    }

    overlay.add(
      this.add
        .text(W / 2, top + panelH - 34, 'Codex фиксирует открытия · постоянного усиления характеристик нет', {
          fontFamily: FONT,
          fontSize: compact ? '8px' : '9px',
          color: '#6f7c92',
          align: 'center',
          wordWrap: { width: panelW - 46 },
        })
        .setOrigin(0.5)
        .setResolution(2)
    );

    const dismiss = () => {
      if (this.codexOverlay !== overlay) return;
      overlay.destroy();
      this.codexOverlay = null;
    };
    close.on('pointerup', dismiss);
    dim.on('pointerup', (_pointer, localX, localY, event) => {
      event?.stopPropagation?.();
    });

    render();
  }

  private onResize(): void {
    this.scene.restart();
  }
}
