import Phaser from 'phaser';
import { parseChallengePayload } from '../game/Challenge';
import { ACHIEVEMENTS } from '../game/AchievementSystem';
import { COLORS, FONT, UI_FONT, UI_TEXT, fmtTime } from '../game/config';
import { IDENTITY } from '../game/identity';
import { LEGENDARIES } from '../game/LegendarySystem';
import { STAGES } from '../game/StageDefinitions';
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
import { RunCheckpoint } from '../systems/RunCheckpoint';
import { Sfx } from '../systems/Sfx';
import { StartupTrace } from '../systems/StartupTrace';

export class MenuScene extends Phaser.Scene {
  private codexOverlay: Phaser.GameObjects.Container | null = null;

  constructor() {
    super('Menu');
  }

  create(): void {
    StartupTrace.mark('menu.create.start');
    StartupTrace.mark('menu.cinematicTextures.start');
    ensureCinematicTextures(this);
    StartupTrace.mark('menu.cinematicTextures.end');
    StartupTrace.mark('menu.strainTextures.start');
    ensureStrainZeroTextures(this);
    StartupTrace.mark('menu.strainTextures.end');
    const W = this.scale.width;
    const H = this.scale.height;
    this.codexOverlay = null;
    this.cameras.main.setBackgroundColor(COLORS.bg);
    Sfx.stopMusic();
    PlatformBridge.setBackHandler(null);

    const incomingChallenge = parseChallengePayload(PlatformBridge.getStartParam());
    const resumeCheckpoint = incomingChallenge ? null : RunCheckpoint.load();
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
        lineSpacing: 5,
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setDepth(5);

    this.add
      .text(W / 2, hookY + 46, 'Мутируй быстрее, чем иммунитет адаптируется.', {
        fontFamily: UI_FONT,
        fontSize: H < 650 ? '12px' : '15px',
        fontStyle: '600',
        color: UI_TEXT.primary,
        align: 'center',
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setDepth(5);

    const displayName = PlatformBridge.getDisplayName();
    if (PlatformBridge.available && displayName) {
      this.add
        .text(W / 2, hookY + 70, `Носитель: ${displayName}`, {
          fontFamily: UI_FONT,
          fontSize: H < 650 ? '12px' : '14px',
          fontStyle: '700',
          color: '#9deeff',
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
            fontFamily: UI_FONT,
            fontSize: H < 650 ? '10px' : '11px',
            fontStyle: '600',
            color: UI_TEXT.secondary,
            align: 'center',
          }
        )
        .setOrigin(0.5)
        .setResolution(2)
        .setDepth(5);
    } else if (resumeCheckpoint) {
      const resumeStage =
        STAGES.find((stage) => stage.id === resumeCheckpoint.director.stageId) ?? STAGES[0];
      const resumeDifficulty = getDifficultyProfile(resumeCheckpoint.difficultyId);
      this.add
        .text(
          W / 2,
          H * 0.57,
          `НЕЗАВЕРШЁННЫЙ ЗАБЕГ\n${resumeStage.name} · ${fmtTime(resumeCheckpoint.runState.run.timeMs)} · МУТАЦИЯ ${resumeCheckpoint.runState.stage.level} · ${resumeDifficulty.shortLabel}`,
          {
            fontFamily: UI_FONT,
            fontSize: H < 650 ? '11px' : '12px',
            fontStyle: '700',
            color: '#ffe066',
            align: 'center',
            lineSpacing: 4,
            wordWrap: { width: W - 42 },
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
          fontFamily: UI_FONT,
          fontSize: H < 650 ? '12px' : '14px',
          fontStyle: '650',
          color: UI_TEXT.primary,
          align: 'center',
          lineSpacing: 5,
          wordWrap: { width: W - 42 },
        })
        .setOrigin(0.5)
        .setResolution(2)
        .setDepth(5);
    }

    const difficultyY = H * 0.635;
    const difficultyW = Math.min(W - 34, 330);
    const difficultyBg = this.add
      .rectangle(W / 2, difficultyY, difficultyW, H < 650 ? 46 : 54, 0x21101d, 0.97)
      .setStrokeStyle(1.4, COLORS.cyan, 0.68)
      .setDepth(5)
      .setInteractive({ useHandCursor: true });
    const difficultyText = this.add
      .text(W / 2, difficultyY - 8, '', {
        fontFamily: FONT,
        fontSize: H < 650 ? '12px' : '15px',
        fontStyle: 'bold',
        color: UI_TEXT.primary,
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setDepth(6);
    const difficultyDesc = this.add
      .text(W / 2, difficultyY + 9, '', {
        fontFamily: UI_FONT,
        fontSize: H < 650 ? '11px' : '13px',
        fontStyle: '650',
        color: UI_TEXT.secondary,
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
    const controlW = Math.min(W - 34, 330);
    const controlH = H < 650 ? 44 : 52;
    const controlBg = this.add
      .rectangle(W / 2, controlY, controlW, controlH, 0x141d2a, 0.94)
      .setStrokeStyle(1.4, COLORS.magenta, 0.7)
      .setDepth(5)
      .setInteractive({ useHandCursor: true });
    const controlText = this.add
      .text(W / 2, controlY - 7, '', {
        fontFamily: FONT,
        fontSize: H < 650 ? '12px' : '14px',
        fontStyle: 'bold',
        color: UI_TEXT.primary,
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setDepth(6);
    const controlDesc = this.add
      .text(W / 2, controlY + 8, '', {
        fontFamily: UI_FONT,
        fontSize: H < 650 ? '11px' : '13px',
        fontStyle: '650',
        color: UI_TEXT.secondary,
        align: 'center',
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setDepth(6);
    let startHint: Phaser.GameObjects.Text | null = null;
    const renderControlMode = () => {
      controlText.setText(`УПРАВЛЕНИЕ: ${controlModeLabel(selectedControlMode)}  ›`);
      controlDesc.setText(controlModeDescription(selectedControlMode));
      const controlAccent =
        selectedControlMode === 'two-hand'
          ? COLORS.cyan
          : selectedControlMode === 'dual-move'
            ? COLORS.purple
            : COLORS.magenta;
      controlBg.setStrokeStyle(selectedControlMode === 'one-hand' ? 1.4 : 1.8, controlAccent, 0.82);
      if (resumeCheckpoint) {
        const resumeStage =
          STAGES.find((stage) => stage.id === resumeCheckpoint.director.stageId) ?? STAGES[0];
        startHint?.setText(
          `${resumeStage.name} · ${fmtTime(resumeCheckpoint.runState.run.timeMs)} · МУТАЦИЯ ${resumeCheckpoint.runState.stage.level}`
        );
      } else {
        startHint?.setText('автоатака · заражай клетки · собирай РНК');
      }
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

    const btnY = H * (resumeCheckpoint ? 0.785 : 0.805);
    const btnW = Math.min(W - 30, 338);
    const btnBg = this.add
      .rectangle(W / 2, btnY, btnW, resumeCheckpoint ? 58 : 66, 0x5c143e, 0.92)
      .setStrokeStyle(2, incomingChallenge ? COLORS.gold : COLORS.magenta, 1)
      .setDepth(5);
    this.add
      .text(
        W / 2,
        btnY - 5,
        incomingChallenge
          ? 'ПРИНЯТЬ ВЫЗОВ'
          : resumeCheckpoint
            ? 'ПРОДОЛЖИТЬ ЗАБЕГ'
            : 'НАЧАТЬ ЗАРАЖЕНИЕ',
        {
        fontFamily: FONT,
        fontSize: H < 650 ? '18px' : '22px',
        fontStyle: 'bold',
        color: '#fff4ec',
        }
      )
      .setOrigin(0.5)
      .setResolution(2)
      .setDepth(6);
    startHint = this.add
      .text(W / 2, btnY + 18, '', {
        fontFamily: UI_FONT,
        fontSize: H < 650 ? '11px' : '13px',
        fontStyle: '650',
        color: '#ffe3f0',
        align: 'center',
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setDepth(6);
    renderControlMode();

    const startFreshRun = () => {
      RunCheckpoint.clear();
      this.registry.remove('runCheckpointResume');
      this.registry.set('difficultyId', selectedDifficulty);
      this.registry.set('controlMode', selectedControlMode);
      this.scene.start('Game');
    };

    btnBg.setInteractive({ useHandCursor: true }).on('pointerup', () => {
      Sfx.play('click');
      PlatformBridge.haptic('medium');
      if (resumeCheckpoint) {
        this.registry.set('difficultyId', resumeCheckpoint.difficultyId);
        this.registry.set('controlMode', resumeCheckpoint.controlMode);
        this.registry.set('runCheckpointResume', resumeCheckpoint);
        this.scene.start('Game');
        return;
      }
      startFreshRun();
    });
    btnBg.on('pointerover', () => btnBg.setFillStyle(0x7a1a52, 1));
    btnBg.on('pointerout', () => btnBg.setFillStyle(0x5c143e, 0.92));

    if (resumeCheckpoint) {
      const newRunY = btnY + 42;
      const newRunHit = this.add
        .rectangle(W / 2, newRunY, Math.min(btnW, 190), 22, 0x14101a, 0.78)
        .setStrokeStyle(1, COLORS.cyan, 0.45)
        .setDepth(7)
        .setInteractive({ useHandCursor: true });
      this.add
        .text(W / 2, newRunY, 'НАЧАТЬ НОВЫЙ', {
          fontFamily: FONT,
          fontSize: H < 650 ? '10px' : '11px',
          fontStyle: 'bold',
          color: '#8fe8ff',
          letterSpacing: 1,
        })
        .setOrigin(0.5)
        .setResolution(2)
        .setDepth(8);
      newRunHit.on('pointerup', () => {
        Sfx.play('click');
        PlatformBridge.haptic('medium');
        startFreshRun();
      });
    }

    const utilityY =
      btnY + (resumeCheckpoint ? (H < 650 ? 60 : 72) : H < 650 ? 48 : 55);
    const soundText = this.add
      .text(W / 2 - 72, utilityY, `звук: ${Sfx.muted ? 'выкл' : 'вкл'}`, {
        fontFamily: UI_FONT,
        fontSize: H < 650 ? '11px' : '13px',
        fontStyle: '650',
        color: Sfx.muted ? UI_TEXT.secondary : '#efcddd',
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
        fontSize: H < 650 ? '12px' : '13px',
        fontStyle: 'bold',
        color: '#9deeff',
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
        fontFamily: UI_FONT,
        fontSize: H < 650 ? '11px' : '12px',
        fontStyle: '600',
        color: UI_TEXT.secondary,
        align: 'center',
        wordWrap: { width: W - 36 },
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setDepth(5);

    this.add
      .text(W / 2, H - 31, 'О ПРИЛОЖЕНИИ · ПОЛИТИКА · ПОДДЕРЖКА', {
        fontFamily: UI_FONT,
        fontSize: H < 650 ? '10px' : '11px',
        fontStyle: '700',
        color: '#b8f3ff',
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setDepth(6)
      .setInteractive({ useHandCursor: true })
      .on('pointerup', () => {
        Sfx.play('click');
        showLegalOverlay();
      });

    let diagnosticTapCount = 0;
    let diagnosticTapTimer: number | null = null;
    const versionText = this.add
      .text(W / 2, H - 9, `mini-app · ${PlatformBridge.platform} · v0.1.0`, {
        fontFamily: FONT,
        fontSize: '9px',
        color: '#654454',
      })
      .setOrigin(0.5, 1)
      .setResolution(2)
      .setDepth(5)
      .setInteractive({ useHandCursor: true });

    versionText.on('pointerup', () => {
      diagnosticTapCount += 1;
      if (diagnosticTapTimer !== null) window.clearTimeout(diagnosticTapTimer);
      diagnosticTapTimer = window.setTimeout(() => {
        diagnosticTapCount = 0;
        diagnosticTapTimer = null;
      }, 2400);

      if (diagnosticTapCount < 5) return;

      diagnosticTapCount = 0;
      if (diagnosticTapTimer !== null) {
        window.clearTimeout(diagnosticTapTimer);
        diagnosticTapTimer = null;
      }
      if (StartupTrace.showDebugOverlay()) PlatformBridge.haptic('light');
    });

    this.scale.on('resize', this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.onResize, this);
      if (diagnosticTapTimer !== null) window.clearTimeout(diagnosticTapTimer);
    });

    StartupTrace.setMeta('platformFinal', PlatformBridge.kind);
    StartupTrace.setMeta('platformVersionFinal', PlatformBridge.version || '');
    StartupTrace.mark('menu.create.end');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        StartupTrace.finish('menu.visible');
      });
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
      .rectangle(W / 2, H / 2, panelW, panelH, 0x100d16, 0.995)
      .setStrokeStyle(2, COLORS.cyan, 0.72);
    overlay.add([dim, panel]);

    const top = H / 2 - panelH / 2;
    const left = W / 2 - panelW / 2;
    overlay.add(
      this.add
        .text(W / 2, top + 26, 'КОДЕКС · STRAIN-0', {
          fontFamily: FONT,
          fontSize: compact ? '19px' : '22px',
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
          fontFamily: UI_FONT,
          fontSize: compact ? '11px' : '13px',
          fontStyle: '700',
          color: '#b8f3ff',
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
    const tabs: Array<{
      id: CodexPage;
      label: string;
      x: number;
      text: Phaser.GameObjects.Text;
      underline: Phaser.GameObjects.Rectangle;
    }> = [];
    const tabY = top + 82;
    const tabDefs: Array<[CodexPage, string, number]> = [
      ['mutations', 'МУТАЦИИ', W / 2 - 104],
      ['legendary', 'LEGENDARY', W / 2],
      ['mastery', 'МАСТЕРСТВО', W / 2 + 104],
    ];

    const render = () => {
      body.removeAll(true);
      for (const tab of tabs) {
        const active = tab.id === page;
        tab.text.setColor(active ? '#ffe066' : UI_TEXT.muted);
        tab.text.setAlpha(active ? 1 : 0.86);
        tab.underline.setVisible(active);
      }

      const bodyTop = top + 116;
      const addText = (
        x: number,
        y: number,
        value: string,
        size: number = compact ? 12 : 14,
        color: string = UI_TEXT.primary,
        width: number = panelW - 42,
        align: 'left' | 'center' = 'left'
      ) => {
        const text = this.add
          .text(x, y, value, {
            fontFamily: UI_FONT,
            fontSize: `${size}px`,
            color,
            align,
            lineSpacing: 4,
            wordWrap: { width },
          })
          .setOrigin(align === 'center' ? 0.5 : 0, 0)
          .setResolution(2);
        body.add(text);
        return text;
      };

      if (page === 'mutations') {
        addText(W / 2, bodyTop, 'КРИТИЧЕСКИЕ МУТАЦИИ', compact ? 13 : 15, '#ffe066', panelW - 42, 'center');
        const evolutionIds: EvolutionId[] = ['prism', 'halo', 'singularity'];
        evolutionIds.forEach((id, index) => {
          const found = save.evolutionsSeen.includes(id);
          const y = bodyTop + 40 + index * (compact ? 76 : 86);
          const row = this.add
            .rectangle(
              W / 2,
              y + (compact ? 24 : 28),
              panelW - 34,
              compact ? 62 : 72,
              0x19151f,
              0.78
            )
            .setStrokeStyle(1, found ? COLORS.gold : COLORS.stroke, found ? 0.4 : 0.55);
          body.add(row);
          addText(
            left + 28,
            y,
            `${found ? '◆' : '◇'}  ${found ? EVOLUTION_NAMES[id] : 'НЕ ОТКРЫТО'}`,
            compact ? 13 : 15,
            found ? '#ffe066' : '#c9c1d3'
          );
          addText(
            left + 49,
            y + 22,
            found
              ? 'Критическая форма зарегистрирована в Codex.'
              : 'Развивай совместимые ветви мутаций.',
            compact ? 12 : 13,
            found ? UI_TEXT.secondary : '#d0c7d8',
            panelW - 76
          );
        });
      } else if (page === 'legendary') {
        addText(W / 2, bodyTop, 'ЛЕГЕНДАРНЫЕ ИЗМЕНЕНИЯ ПРАВИЛ', compact ? 12 : 14, '#ffe066', panelW - 42, 'center');
        LEGENDARIES.forEach((def, index) => {
          const found = save.legendarySeen.includes(def.id);
          const y = bodyTop + 32 + index * (compact ? 46 : 51);
          addText(
            left + 28,
            y,
            `${found ? '◆' : '◇'}  ${found ? def.title : '???'}`,
            compact ? 12 : 13,
            found ? '#fff1ac' : '#bdb4c8',
            panelW - 54
          );
          if (found) {
            addText(
              left + 49,
              y + 18,
              def.effect,
              compact ? 11 : 12,
              UI_TEXT.secondary,
              panelW - 78
            );
          }
        });
      } else {
        const standardBest = save.bestCampaignClearMs > 0 ? fmtTime(save.bestCampaignClearMs) : '—';
        const strainedBest =
          save.bestStrainedCampaignClearMs > 0 ? fmtTime(save.bestStrainedCampaignClearMs) : '—';
        addText(W / 2, bodyTop, 'МАСТЕРСТВО КАМПАНИИ', compact ? 13 : 15, '#ffe066', panelW - 42, 'center');
        const standardRow = this.add
          .rectangle(W / 2, bodyTop + 50, panelW - 34, 40, 0x151b24, 0.72)
          .setStrokeStyle(1, save.standardCampaignClears > 0 ? COLORS.cyan : COLORS.stroke, 0.5);
        const strainedRow = this.add
          .rectangle(W / 2, bodyTop + 92, panelW - 34, 40, 0x1f1714, 0.72)
          .setStrokeStyle(1, save.strainedCampaignClears > 0 ? COLORS.gold : COLORS.stroke, 0.5);
        body.add([standardRow, strainedRow]);
        addText(
          left + 28,
          bodyTop + 39,
          `${save.standardCampaignClears > 0 ? '◆' : '◇'} STANDARD · пройдено ${save.standardCampaignClears} · рекорд ${standardBest}`,
          compact ? 12 : 13,
          save.standardCampaignClears > 0 ? '#8fe8ff' : '#c7bfd0'
        );
        addText(
          left + 28,
          bodyTop + 81,
          `${save.strainedCampaignClears > 0 ? '◆' : '◇'} STRAINED · пройдено ${save.strainedCampaignClears} · рекорд ${strainedBest}`,
          compact ? 12 : 13,
          save.strainedCampaignClears > 0 ? '#ffe066' : '#c7bfd0'
        );
        addText(
          left + 28,
          bodyTop + 132,
          `ДОСТИЖЕНИЯ · ${save.achievements.length}/${ACHIEVEMENTS.length}`,
          compact ? 13 : 15,
          UI_TEXT.primary
        );
        const unlocked = ACHIEVEMENTS.filter((achievement) => save.achievements.includes(achievement.id));
        addText(
          left + 28,
          bodyTop + 160,
          unlocked.length
            ? unlocked.map((achievement) => `◆ ${achievement.name}`).join('\n')
            : '◇ Пока нет открытых достижений',
          compact ? 12 : 13,
          unlocked.length ? UI_TEXT.primary : UI_TEXT.secondary,
          panelW - 56
        );
        addText(
          left + 28,
          top + panelH - 106,
          `ЦИКЛОВ: ${save.runs}   ·   ИММУННЫХ КЛЕТОК: ${save.totalKills}`,
          compact ? 11 : 12,
          UI_TEXT.secondary
        );
      }
    };

    for (const [id, label, x] of tabDefs) {
      const tabText = this.add
        .text(x, tabY, label, {
          fontFamily: FONT,
          fontSize: compact ? '11px' : '13px',
          fontStyle: 'bold',
          color: '#bdb4c8',
        })
        .setOrigin(0.5)
        .setResolution(2)
        .setInteractive({ useHandCursor: true })
        .on('pointerup', () => {
          page = id;
          Sfx.play('click');
          render();
        });
      const underline = this.add
        .rectangle(x, tabY + (compact ? 13 : 14), Math.min(88, Math.max(52, tabText.width + 14)), 3, COLORS.gold, 1)
        .setVisible(false);
      tabs.push({ id, label, x, text: tabText, underline });
      overlay.add([tabText, underline]);
    }

    overlay.add(
      this.add
        .text(W / 2, top + panelH - 34, 'Codex хранит открытия · без постоянных бонусов', {
          fontFamily: UI_FONT,
          fontSize: compact ? '10px' : '11px',
          fontStyle: '600',
          color: UI_TEXT.secondary,
          align: 'center',
          wordWrap: { width: panelW - 46 },
        })
        .setOrigin(0.5)
        .setResolution(2)
    );

    const dismiss = () => {
      if (this.codexOverlay !== overlay) return;
      PlatformBridge.setBackHandler(null);
      overlay.destroy();
      this.codexOverlay = null;
    };
    PlatformBridge.setBackHandler(dismiss);
    close.on('pointerup', dismiss);
    dim.on('pointerup', () => {
      // The full-screen interactive dimmer owns the pointer event and blocks menu controls below.
    });

    render();
  }

  private onResize(): void {
    this.scene.restart();
  }
}
