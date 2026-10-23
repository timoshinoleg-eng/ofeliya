import { QuestBoard } from '../ui/QuestBoard';
import Phaser from 'phaser';
import { artScale } from '../game/ArtMetrics';
import { parseChallengePayload } from '../game/Challenge';
import { parseDuelStartPayload, type DuelChallengeSnapshot } from '../game/Duel';
import { ACHIEVEMENTS } from '../game/AchievementSystem';
import { COLORS, FONT, UI_FONT, UI_TEXT, fmtTime } from '../game/config';
import { IDENTITY } from '../game/identity';
import { masteryTracks } from '../game/RunIdentity';
import { LEGENDARIES } from '../game/LegendarySystem';
import { STAGES } from '../game/StageDefinitions';
import { EVOLUTION_NAMES, type EvolutionId } from '../game/UpgradeSystem';
import {
  controlModeCompactDescription,
  controlModeCompactLabel,
  controlModeDescription,
  controlModeLabel,
  controlModeTinyHint,
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
import { clearDailyIntent, launchDailyRun } from '../game/DailyRunIntent';
import { showLegalOverlay } from '../legal/LegalOverlay';
import { SocialHub } from '../ui/SocialHub';
import { BORDER, PANEL, ROLE } from '../ui/tokens';
import { VISUAL, VISUAL_TEXT } from '../ui/visualTokens';
import { createSpecimenSurface, drawSpecimenSurface } from '../ui/specimenSurface';
import { FOUNDER_BADGE_LABEL, hasFounderBadge } from '../ui/FounderBadge';
import { PlatformBridge } from '../platform';
import { RELEASE_SHORT } from '../release';
import { SaveSystem } from '../systems/SaveSystem';
import { fetchServerProfile } from '../systems/ProfileClient';
import { RunCheckpoint } from '../systems/RunCheckpoint';
import { Sfx } from '../systems/Sfx';
import { prefersReducedMotion } from '../systems/MotionPreferences';
import { StartupTrace } from '../systems/StartupTrace';
import { VideoInterstitial } from '../systems/VideoInterstitial';
import { loadDuelChallenge, trackDuelEvent } from '../systems/DuelClient';
import { trackProductEvent } from '../systems/AnalyticsClient';

export class MenuScene extends Phaser.Scene {
  private questBoard: QuestBoard | null = null;
  private codexOverlay: Phaser.GameObjects.Container | null = null;
  private socialHub: SocialHub | null = null;
  private founderBadge: Phaser.GameObjects.Container | null = null;
  private profileLoadGeneration = 0;

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
    this.socialHub = null;
    this.founderBadge?.destroy();
    this.founderBadge = null;
    const profileLoadGeneration = ++this.profileLoadGeneration;
    this.cameras.main.setBackgroundColor(COLORS.bg);
    Sfx.stopMusic();
    PlatformBridge.setBackHandler(null);

    const startParam = PlatformBridge.getStartParam();
    const incomingDuelId = parseDuelStartPayload(startParam);
    const incomingChallenge = incomingDuelId ? null : parseChallengePayload(startParam);
    const resumeCheckpoint = incomingDuelId || incomingChallenge ? null : RunCheckpoint.load();
    let incomingDuel: DuelChallengeSnapshot | null = null;
    let duelLoading = incomingDuelId !== null;
    let duelUnavailable = false;
    let selectedDifficulty = incomingDuelId || incomingChallenge ? 'standard' : readDifficultySelection();
    let selectedControlMode: ControlMode = readControlMode();
    this.registry.set('difficultyId', selectedDifficulty);
    this.registry.set('controlMode', selectedControlMode);
    // Legacy social targets remain display-only. Verified fixed-seed duels use a separate
    // immutable server snapshot and explicitly set runSeed/controlMode before Game starts.
    this.registry.set('challengeTarget', incomingChallenge);
    this.registry.set('duelChallenge', null);

    const plasma = this.add
      .tileSprite(0, 0, W, H, 'blood-plasma')
      .setOrigin(0)
      .setDepth(-20);
    if (!prefersReducedMotion()) this.tweens.add({
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
      if (!prefersReducedMotion()) this.tweens.add({
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
      .setScale(artScale('host-cell-shadow', H < 650 ? 1.1 : 1.4))
      .setAlpha(0.1)
      .setDepth(-10);
    if (!prefersReducedMotion()) this.tweens.add({
      targets: host,
      scale: host.scaleX * 1.07,
      alpha: 0.14,
      duration: 2600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    });

    // Retained specimen framing sits below the portrait and all copy/input targets.
    // Only the halo's opacity breathes; no scene objects are spawned by animation.
    const specimenRadius = Math.min(82, H * 0.088);
    const specimen = this.add.graphics().setPosition(W / 2, H * 0.27).setDepth(0);
    specimen.fillStyle(ROLE.surface.panel, PANEL.plate * 0.5);
    specimen.fillCircle(0, 0, specimenRadius);
    specimen.lineStyle(BORDER.hair, VISUAL.immune, 0.36);
    specimen.strokeCircle(0, 0, specimenRadius);
    for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const inner = specimenRadius - 5;
      const outer = specimenRadius + 5;
      specimen.lineBetween(Math.cos(angle) * inner, Math.sin(angle) * inner,
        Math.cos(angle) * outer, Math.sin(angle) * outer);
    }
    const halo = this.add.graphics().setPosition(W / 2, H * 0.27).setDepth(1);
    halo.lineStyle(BORDER.heavyLg, VISUAL.player, 0.1);
    halo.strokeCircle(0, 0, specimenRadius - 11);
    halo.lineStyle(BORDER.hair, VISUAL.player, 0.32);
    halo.strokeCircle(0, 0, specimenRadius - 11);
    halo.setAlpha(0.55);
    if (!prefersReducedMotion()) this.tweens.add({ targets: halo, alpha: 1, duration: 2400, yoyo: true,
      repeat: -1, ease: 'Sine.InOut' });

    const virus = this.add
      .image(W / 2, H * 0.27, 'virus-player')
      .setScale(artScale('virus-player', H < 650 ? 1.8 : 2.15))
      .setDepth(2);
    if (!prefersReducedMotion()) this.tweens.add({
      targets: virus,
      rotation: Math.PI * 2,
      duration: 12000,
      repeat: -1,
      ease: 'Linear',
    });
    if (!prefersReducedMotion()) this.tweens.add({
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
        fontSize: H < 650 ? '39px' : '48px',
        fontStyle: 'bold',
        color: VISUAL_TEXT.ivory,
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setName('ofeliya-menu-title')
      .setDepth(5);
    title.setShadow(0, 2, '#080f14', 0, true, true);

    this.add
      .text(W / 2, titleY + (H < 650 ? 38 : 46), 'STRAIN ZERO', {
        fontFamily: FONT,
        fontSize: '12px',
        fontStyle: 'bold',
        color: VISUAL_TEXT.player,
        letterSpacing: 4,
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setDepth(5);

    // Cosmetic meta is fail-closed: only a strictly parsed, signed server profile can
    // surface the founder entitlement. No local save/registry state can manufacture it.
    void fetchServerProfile(PlatformBridge).then((profile) => {
      if (profileLoadGeneration !== this.profileLoadGeneration || !this.sys.isActive()) return;
      if (!hasFounderBadge(profile)) return;

      const badgeY = H * 0.175;
      const badgeW = Math.min(W - 48, 156);
      const badge = this.add.container(0, 0).setDepth(6).setName('ofeliya-menu-founder-badge');
      const plate = this.add
        .rectangle(W / 2, badgeY, badgeW, 24, COLORS.bg, 0.86)
        .setStrokeStyle(1, COLORS.gold, 0.78);
      const label = this.add
        .text(W / 2, badgeY, `◆  ${FOUNDER_BADGE_LABEL}`, {
          fontFamily: FONT,
          fontSize: H < 650 ? '9px' : '10px',
          fontStyle: 'bold',
          color: '#ffe066',
          letterSpacing: 0.6,
        })
        .setOrigin(0.5)
        .setResolution(2);
      badge.add([plate, label]);
      this.founderBadge = badge;
    });

    const hookY = H * 0.405;
    this.add
      .text(W / 2, hookY, 'СИНТЕТИЧЕСКИЙ ВИРУС.\nЖИВОЙ ОРГАНИЗМ.', {
        fontFamily: FONT,
        fontSize: H < 650 ? '15px' : '18px',
        fontStyle: 'bold',
        color: VISUAL_TEXT.ivory,
        align: 'center',
        lineSpacing: 5,
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setName('ofeliya-menu-hook')
      .setDepth(5);

    this.add
      .text(W / 2, hookY + 38, 'Выживай. Собирай РНК. Меняй штамм.', {
        fontFamily: UI_FONT,
        fontSize: H < 650 ? '12px' : '15px',
        fontStyle: '600',
        color: VISUAL_TEXT.muted,
        align: 'center',
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setName('ofeliya-menu-subtitle')
      .setDepth(5);

    const displayName = PlatformBridge.getDisplayName();
    if (PlatformBridge.available && displayName) {
      this.add
        .text(W / 2, hookY + 62, `Носитель: ${displayName}`, {
          fontFamily: UI_FONT,
          fontSize: H < 650 ? '12px' : '14px',
          fontStyle: '700',
          color: '#9deeff',
          wordWrap: { width: W - 40, useAdvancedWrap: true },
          maxLines: 1,
        })
        .setOrigin(0.5)
        .setResolution(2)
        .setName('ofeliya-menu-carrier')
        .setDepth(5);
    }

    let challengeHeadline: Phaser.GameObjects.Text | null = null;
    let challengeTargetText: Phaser.GameObjects.Text | null = null;
    let challengeDetailText: Phaser.GameObjects.Text | null = null;
    if (incomingChallenge || incomingDuelId) {
      const challengeY = H * 0.54;
      const panelW = Math.min(W - 42, 330);
      this.add
        .rectangle(W / 2, challengeY, panelW, 58, 0x251020, 0.9)
        .setStrokeStyle(1.5, COLORS.gold, 0.78)
        .setDepth(4);
      challengeHeadline = this.add
        .text(W / 2, challengeY - 15, incomingDuelId ? 'ДУЭЛЬ · ЗАГРУЗКА' : 'ВЫЗОВ ПОЛУЧЕН', {
          fontFamily: FONT,
          fontSize: H < 650 ? '10px' : '11px',
          fontStyle: 'bold',
          color: '#ffe066',
          letterSpacing: 1,
        })
        .setOrigin(0.5)
        .setResolution(2)
        .setName('ofeliya-menu-challenge-header')
        .setDepth(5);
      const target = incomingChallenge
        ? incomingChallenge.objective === 'boss1-clear'
          ? `Подави ИММУННОГО ПРАЙМА быстрее ${fmtTime(incomingChallenge.timeMs)}`
          : incomingChallenge.objective === 'campaign-clear'
            ? `Заверши кампанию быстрее ${fmtTime(incomingChallenge.timeMs)}`
            : `Продержись дольше ${fmtTime(incomingChallenge.timeMs)}`
        : 'Получаю условия дуэли…';
      challengeTargetText = this.add
        .text(W / 2, challengeY + 2, target, {
          fontFamily: FONT,
          fontSize: H < 650 ? '10px' : '11px',
          fontStyle: 'bold',
          color: '#fff4ec',
          align: 'center',
        })
        .setOrigin(0.5)
        .setResolution(2)
        .setName('ofeliya-menu-challenge-target')
        .setDepth(5);
      const detail = incomingChallenge
        ? `уничтожено ${incomingChallenge.kills} · заражено ${incomingChallenge.hostCellsInfected} · мутация ${incomingChallenge.level}`
        : 'СТАНДАРТ · управление и случайность фиксированы';
      challengeDetailText = this.add
        .text(W / 2, challengeY + 18, detail, {
          fontFamily: UI_FONT,
          fontSize: H < 650 ? '10px' : '11px',
          fontStyle: '600',
          color: UI_TEXT.secondary,
          align: 'center',
        })
        .setOrigin(0.5)
        .setResolution(2)
        .setName('ofeliya-menu-challenge-meta')
        .setDepth(5);
    } else if (resumeCheckpoint) {
      const resumeStage =
        STAGES.find((stage) => stage.id === resumeCheckpoint.director.stageId) ?? STAGES[0];
      const resumeDifficulty = getDifficultyProfile(resumeCheckpoint.difficultyId);
      this.add
        .text(
          W / 2,
          H * 0.54,
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
          ? `Выживание ${survival} · ПРАЙМ ${boss1}\nКампания ${campaign} · клетки ${save.bestKills}`
          : 'STRAIN-0 · ПЕРВЫЙ ЦИКЛ ЗАРАЖЕНИЯ';
      this.add
        .text(W / 2, H * 0.54, records, {
          fontFamily: UI_FONT,
          fontSize: H < 650 ? '12px' : '14px',
          fontStyle: '650',
          color: VISUAL_TEXT.muted,
          align: 'center',
          lineSpacing: 5,
          wordWrap: { width: W - 42 },
        })
        .setOrigin(0.5)
        .setResolution(2)
        .setDepth(5);
    }

    // 320px cannot fit five utility labels at the minimum readable font, even
    // after measuring. Reflow only on truly narrow viewports.
    const narrowFooter = W < 344;
    const compactStackShift = narrowFooter && H < 650 ? 24 : 0;
    const splitSelectors = W >= 360 && H >= 650;
    const selectorGap = splitSelectors ? 10 : 0;
    const selectorW = splitSelectors
      ? Math.min((W - 34 - selectorGap) / 2, 164)
      : Math.min(W - 34, 330);
    const selectorH = splitSelectors ? 84 : H < 650 ? 46 : 54;
    const selectorY = splitSelectors ? H * 0.685 : 0;
    const difficultyY = splitSelectors ? selectorY : H * 0.635 - compactStackShift;
    const difficultyX = splitSelectors ? W / 2 - selectorW / 2 - selectorGap / 2 : W / 2;
    const difficultyLeft = difficultyX - selectorW / 2;
    const difficultyRight = difficultyX + selectorW / 2;
    const difficultyBg = this.add
      .rectangle(difficultyX, difficultyY, selectorW, selectorH, VISUAL.panel, 0.97)
      .setStrokeStyle(1, COLORS.stroke, 0.46)
      .setDepth(5)
      .setName('ofeliya-menu-difficulty-selector')
      .setInteractive({ useHandCursor: true });
    const difficultySurface = createSpecimenSurface(this, difficultyX, difficultyY, selectorW, selectorH,
      { fill: VISUAL.panel, accent: VISUAL.immune, detail: 'quiet' }).setDepth(5);
    const difficultyRail = this.add
      .rectangle(difficultyLeft + 5, difficultyY, 5, selectorH - 10, COLORS.cyan, 0.92)
      .setDepth(6);
    this.add.rectangle(difficultyX, difficultyY - selectorH / 2 + 1,
      selectorW - 16, BORDER.hair, ROLE.faction.immune, 0.38).setDepth(6);
    this.add
      .text(difficultyLeft + 14, difficultyY - (splitSelectors ? 27 : 12), 'СЛОЖНОСТЬ:', {
        fontFamily: UI_FONT,
        fontSize: splitSelectors ? '12px' : H < 650 ? '11px' : '12px',
        fontStyle: '700',
        color: UI_TEXT.secondary,
        letterSpacing: 0.8,
      })
      .setOrigin(0, 0.5)
      .setResolution(2)
      .setDepth(6);
    const difficultyText = this.add
      .text(difficultyLeft + 14, difficultyY - (splitSelectors ? 7 : -8), '', {
        fontFamily: FONT,
        fontSize: splitSelectors ? '14px' : H < 650 ? '13px' : '16px',
        fontStyle: 'bold',
        color: UI_TEXT.primary,
      })
      .setOrigin(0, 0.5)
      .setResolution(2)
      .setName('ofeliya-menu-difficulty-value')
      .setDepth(6);
    const difficultyDesc = this.add
      .text(
        splitSelectors ? difficultyLeft + 14 : difficultyRight - 12,
        difficultyY + (splitSelectors ? 23 : 1),
        '',
        {
          fontFamily: UI_FONT,
          fontSize: splitSelectors ? '13px' : H < 650 ? '11px' : '13px',
          fontStyle: '650',
          color: UI_TEXT.secondary,
          align: splitSelectors ? 'left' : 'right',
          lineSpacing: 1,
          wordWrap: { width: splitSelectors ? selectorW - 28 : Math.min(142, selectorW * 0.43), useAdvancedWrap: true },
        }
      )
      .setOrigin(splitSelectors ? 0 : 1, 0.5)
      .setResolution(2)
      .setDepth(6);

    const renderDifficulty = () => {
      const profile = getDifficultyProfile(selectedDifficulty);
      const duelLocked = incomingDuelId !== null && !duelUnavailable;
      const challengeLocked = Boolean(incomingChallenge) || duelLocked;
      const difficultyAccent =
        challengeLocked || profile.id === 'strained' ? COLORS.gold : COLORS.cyan;
      difficultyText.setText(
        challengeLocked
          ? splitSelectors
            ? 'СТАНДАРТ'
            : `СТАНДАРТ · ${duelLocked ? 'ДУЭЛЬ' : 'ВЫЗОВ'}`
          : `${profile.label}  ›`
      );
      difficultyText.setColor(profile.id === 'strained' || challengeLocked ? '#ffe066' : '#fff4ec');
      difficultyDesc.setVisible(true);
      difficultyDesc.setText(
        challengeLocked
          ? duelLocked
            ? splitSelectors
              ? 'фиксировано · вне рейтинга'
              : 'фиксированный режим\nбез глобального рейтинга'
            : splitSelectors
              ? 'фиксировано условиями вызова'
              : 'сложность фиксирована\nусловиями вызова'
          : H < 650
            ? profile.id === 'strained' ? 'сложнее' : 'базовый'
            : profile.description
      );
      difficultyRail.setFillStyle(difficultyAccent, 0.94);
      difficultyBg
        .setStrokeStyle(1, difficultyAccent, challengeLocked || profile.id === 'strained' ? 0.5 : 0.34)
        .setFillStyle(profile.id === 'strained' ? 0x29251e : VISUAL.panel, 0.97);
      drawSpecimenSurface(difficultySurface, selectorW, selectorH, {
        fill: profile.id === 'strained' ? 0x29251e : VISUAL.panel,
        accent: difficultyAccent, detail: 'quiet',
      });
    };
    renderDifficulty();
    difficultyBg.on('pointerup', () => {
      Sfx.play('click');
      PlatformBridge.haptic('light');
      if (incomingChallenge || (incomingDuelId && !duelUnavailable)) return;
      selectedDifficulty = nextDifficultyId(selectedDifficulty);
      writeDifficultySelection(selectedDifficulty);
      this.registry.set('difficultyId', selectedDifficulty);
      renderDifficulty();
    });
    difficultyBg.on('pointerover', () => difficultyBg.setAlpha(1));
    difficultyBg.on('pointerout', () => difficultyBg.setAlpha(0.97));

    const controlY = splitSelectors ? selectorY : H * 0.715 - compactStackShift;
    const controlX = splitSelectors ? W / 2 + selectorW / 2 + selectorGap / 2 : W / 2;
    const controlH = splitSelectors ? selectorH : H < 650 ? 44 : 52;
    const controlLeft = controlX - selectorW / 2;
    const controlRight = controlX + selectorW / 2;
    const controlBg = this.add
      .rectangle(controlX, controlY, selectorW, controlH, VISUAL.panel, 0.96)
      .setStrokeStyle(1, COLORS.stroke, 0.44)
      .setDepth(5)
      .setName('ofeliya-menu-control-selector')
      .setInteractive({ useHandCursor: true });
    const controlSurface = createSpecimenSurface(this, controlX, controlY, selectorW, controlH,
      { fill: VISUAL.panel, accent: VISUAL.player, detail: 'quiet' }).setDepth(5);
    const controlRail = this.add
      .rectangle(controlLeft + 5, controlY, 5, controlH - 10, COLORS.magenta, 0.94)
      .setDepth(6);
    this.add.rectangle(controlX, controlY - controlH / 2 + 1,
      selectorW - 16, BORDER.hair, ROLE.faction.player, 0.38).setDepth(6);
    this.add
      .text(controlLeft + 14, controlY - (splitSelectors ? 27 : 11), 'УПРАВЛЕНИЕ:', {
        fontFamily: UI_FONT,
        fontSize: splitSelectors ? '12px' : H < 650 ? '11px' : '12px',
        fontStyle: '700',
        color: UI_TEXT.secondary,
        letterSpacing: 0.8,
      })
      .setOrigin(0, 0.5)
      .setResolution(2)
      .setDepth(6);
    const controlText = this.add
      .text(controlLeft + 14, controlY - (splitSelectors ? 7 : -8), '', {
        fontFamily: FONT,
        fontSize: splitSelectors ? '13px' : H < 650 ? '12px' : '15px',
        fontStyle: 'bold',
        color: UI_TEXT.primary,
        wordWrap: { width: splitSelectors ? selectorW - 28 : selectorW * 0.52, useAdvancedWrap: true },
      })
      .setOrigin(0, 0.5)
      .setResolution(2)
      .setName('ofeliya-menu-control-value')
      .setDepth(6);
    const controlDesc = this.add
      .text(
        splitSelectors ? controlLeft + 14 : controlRight - 12,
        controlY + (splitSelectors ? 23 : 1),
        '',
        {
          fontFamily: UI_FONT,
          fontSize: splitSelectors ? '13px' : H < 650 ? '11px' : '13px',
          fontStyle: '650',
          color: UI_TEXT.secondary,
          align: splitSelectors ? 'left' : 'right',
          lineSpacing: 1,
          wordWrap: { width: splitSelectors ? selectorW - 28 : Math.min(144, selectorW * 0.44), useAdvancedWrap: true },
        }
      )
      .setOrigin(splitSelectors ? 0 : 1, 0.5)
      .setResolution(2)
      .setDepth(6);
    let startHint: Phaser.GameObjects.Text | null = null;
    const renderControlMode = () => {
      const splitControlValue = controlModeCompactLabel(selectedControlMode);
      const splitControlDescription = controlModeCompactDescription(selectedControlMode);
      if (duelLoading) {
        controlText.setText('ЗАГРУЗКА ДУЭЛИ');
        controlDesc.setText(H < 650 ? 'фиксировано' : splitSelectors ? 'режим придёт из вызова' : 'режим придёт\nиз снимка вызова');
      } else if (incomingDuel) {
        controlText.setText(splitSelectors ? splitControlValue : `${controlModeLabel(selectedControlMode)} · ДУЭЛЬ`);
        controlDesc.setText(H < 650 ? 'фиксировано' : 'зафиксировано вызовом\nменять нельзя');
      } else {
        controlText.setText(splitSelectors ? `${splitControlValue}  ›` : `${controlModeLabel(selectedControlMode)}  ›`);
        controlDesc.setText(
          H < 650
            ? controlModeTinyHint(selectedControlMode)
            : splitSelectors ? splitControlDescription : controlModeDescription(selectedControlMode)
        );
      }
      controlDesc.setVisible(true);
      const controlAccent =
        selectedControlMode === 'two-hand'
          ? COLORS.cyan
          : selectedControlMode === 'dual-move'
            ? COLORS.purple
            : COLORS.magenta;
      controlRail.setFillStyle(controlAccent, 0.95);
      controlBg.setStrokeStyle(1, controlAccent, selectedControlMode === 'one-hand' ? 0.34 : 0.5);
      drawSpecimenSurface(controlSurface, selectorW, controlH,
        { fill: VISUAL.panel, accent: controlAccent, detail: 'quiet' });
      if (incomingDuel) {
        startHint?.setText(`тот же забег · быстрее ${fmtTime(incomingDuel.targetTimeMs)}`);
      } else if (resumeCheckpoint) {
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
      if (duelLoading || incomingDuel) return;
      selectedControlMode = nextControlMode(selectedControlMode);
      writeControlMode(selectedControlMode);
      this.registry.set('controlMode', selectedControlMode);
      renderControlMode();
    });
    controlBg.on('pointerover', () => controlBg.setAlpha(1));
    controlBg.on('pointerout', () => controlBg.setAlpha(0.96));

    const btnY = H * (resumeCheckpoint ? 0.785 : 0.805) - (compactStackShift ? 20 : 0);
    const btnW = Math.min(W - 30, 338);
    const btnH = resumeCheckpoint || compactStackShift ? 58 : 66;
    const btnAccent = incomingChallenge ? VISUAL.warning : VISUAL.player;
    this.add
      .rectangle(W / 2 + 3, btnY + 4, btnW, btnH, 0x050308, 0.58)
      .setDepth(4);
    const btnBg = this.add
      .rectangle(W / 2, btnY, btnW, btnH, 0x472a38, 0.95)
      .setStrokeStyle(1, btnAccent, 0.58)
      .setName('ofeliya-menu-action-bg')
      .setDepth(5);
    const actionSurface = createSpecimenSurface(this, W / 2, btnY, btnW, btnH,
      { fill: 0x472a38, accent: btnAccent, detail: 'specimen' }).setDepth(5);
    this.add
      .rectangle(W / 2, btnY - btnH / 2 + 3, btnW - 16, 1, btnAccent, 0.72)
      .setDepth(6);
    const startButtonText = this.add
      .text(
        W / 2,
        btnY - 5,
        incomingDuelId
          ? 'ЗАГРУЗКА ДУЭЛИ…'
          : incomingChallenge
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
      .setName('ofeliya-menu-action')
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
      .setName('ofeliya-menu-action-hint')
      .setDepth(6);
    renderControlMode();

    let freshRunStarting = false;
    const launchFreshRun = () => {
      if (!freshRunStarting) freshRunStarting = true;
      clearDailyIntent(this.registry);
      RunCheckpoint.clear();
      this.registry.remove('runCheckpointResume');
      this.registry.set('difficultyId', selectedDifficulty);
      this.registry.set('controlMode', selectedControlMode);
      if (incomingDuel) {
        this.registry.set('duelChallenge', incomingDuel);
        this.registry.set('runSeedOverride', incomingDuel.runSeed);
        void trackDuelEvent(incomingDuel.challengeId, 'start', PlatformBridge);
      } else {
        this.registry.set('duelChallenge', null);
        // Preserve the existing deterministic-run contract: GameScene owns and consumes any
        // one-shot runSeedOverride already present in the registry.
      }
      this.scene.start('Game');
    };
    const startFreshRun = () => {
      if (freshRunStarting || duelLoading) return;
      freshRunStarting = true;
      let launched = false;
      const launchOnce = () => {
        if (launched) return;
        launched = true;
        launchFreshRun();
      };
      const playing = VideoInterstitial.play('startIntro', {
        onComplete: launchOnce,
        onFail: launchOnce,
        maxDurationMs: 3200,
        ariaLabel: 'Пропустить вступление',
      });
      if (!playing) launchOnce();
    };

    btnBg.setInteractive({ useHandCursor: true });
    btnBg.on('pointerdown', () => {
      if (!resumeCheckpoint) VideoInterstitial.preload('startIntro');
    });
    btnBg.on('pointerup', () => {
      Sfx.play('click');
      PlatformBridge.haptic('medium');
      if (duelLoading) return;
      if (resumeCheckpoint) {
        clearDailyIntent(this.registry);
        this.registry.set('difficultyId', resumeCheckpoint.difficultyId);
        this.registry.set('controlMode', resumeCheckpoint.controlMode);
        this.registry.set('runCheckpointResume', resumeCheckpoint);
        this.scene.start('Game');
        return;
      }
      startFreshRun();
    });
    btnBg.on('pointerover', () => { btnBg.setFillStyle(0x654050, 1); actionSurface.setAlpha(0.72); });
    btnBg.on('pointerout', () => { btnBg.setFillStyle(0x472a38, 0.95); actionSurface.setAlpha(1); });
    btnBg.on('pointerdown', () => actionSurface.setAlpha(0.55));
    btnBg.on('pointerup', () => actionSurface.setAlpha(1));

    if (incomingDuelId) {
      void loadDuelChallenge(incomingDuelId).then((challenge) => {
        if (!this.sys.isActive()) return;
        duelLoading = false;
        if (!challenge) {
          duelUnavailable = true;
          this.registry.set('duelChallenge', null);
          challengeHeadline?.setText('ДУЭЛЬ НЕДОСТУПНА').setColor('#ff9b66');
          challengeTargetText?.setText('Ссылка истекла или вызов больше не существует');
          challengeDetailText?.setText('можно начать обычный забег · сложность СТАНДАРТ');
          startButtonText.setText('НАЧАТЬ ОБЫЧНЫЙ ЗАБЕГ');
          renderDifficulty();
          renderControlMode();
          return;
        }

        incomingDuel = challenge;
        selectedDifficulty = 'standard';
        selectedControlMode = challenge.controlMode;
        this.registry.set('duelChallenge', challenge);
        this.registry.set('difficultyId', 'standard');
        this.registry.set('controlMode', challenge.controlMode);
        challengeHeadline?.setText('ФИКСИРОВАННАЯ ДУЭЛЬ').setColor('#ffe066');
        challengeTargetText?.setText(`Заверши ту же кампанию быстрее ${fmtTime(challenge.targetTimeMs)}`);
        challengeDetailText?.setText(
          `тот же забег · ${controlModeLabel(challenge.controlMode)} · без наград и глобального рейтинга`
        );
        startButtonText.setText('ПРИНЯТЬ ДУЭЛЬ');
        renderDifficulty();
        renderControlMode();
        void trackDuelEvent(challenge.challengeId, 'open', PlatformBridge);
      });
    }

    if (resumeCheckpoint) {
      const newRunY = btnY + 42;
      const newRunHit = this.add
        .rectangle(W / 2, newRunY, Math.min(btnW, 190), 22, 0x14101a, 0.78)
        .setStrokeStyle(1, COLORS.cyan, 0.45)
        .setDepth(7)
        .setName('ofeliya-menu-new-run')
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

    // Keep the action/utilities/footer as separate vertical bands on short MAX WebViews.
    // The old btnY-relative row collided with the footer copy at 568–640 px (and with the
    // resume secondary action at the shortest viewport).
    const compactFooter = H < 720;
    // Resume adds a secondary action immediately below the main button. On the shortest MAX
    // viewport reserve a narrow middle band for utilities and move legal copy down by 5 px.
    const utilityY = compactFooter
      ? H - (resumeCheckpoint ? 59 : 64)
      : btnY + (resumeCheckpoint ? 72 : 55);
    const legalY = compactFooter && resumeCheckpoint ? H - 38 : H - 43;
    // Utilities row: volume steppers flank the existing mute toggle. Slot spacing is
    // measured live in layoutUtilityRow() — at creation and after every label change —
    // so the row provably fits any viewport/font metrics and never overlaps after taps
    // (the old fixed-gap formula overflowed at 360px on Linux Chrome).
    const wideLabels = W >= 460;
    const utilityFont = H < 650 ? '11px' : '12px';
    const volLabel = (pct: number) => (wideLabels ? `музыка: ${pct}%` : `муз·${pct}%`);
    const sfxLabel = (pct: number) => (wideLabels ? `эффекты: ${pct}%` : `эфф·${pct}%`);
    const utilitySlots: Phaser.GameObjects.Text[] = [];
    // Function declarations hoist above the pointerup registrations, so handlers can
    // re-run the layout after setText(); the length guard covers creation order.
    function layoutUtilityRow(): void {
      if (utilitySlots.length !== 5) return;
      let slotWidths = utilitySlots.map((t) => t.width);
      let slotTotal = slotWidths.reduce((a, b) => a + b, 0);
      // Linux Chrome renders these labels measurably wider than local metrics. The
      // readability contract floors the row at 11px (compact) / 12px (tall), so only
      // when the 4px gaps cannot fit do we normalize larger labels to that floor.
      if ((W - 16 - slotTotal) / (utilitySlots.length - 1) < 4) {
        utilitySlots.forEach((t) => t.setFontSize(H < 650 ? 11 : 12));
        slotWidths = utilitySlots.map((t) => t.width);
        slotTotal = slotWidths.reduce((a, b) => a + b, 0);
      }
      // A five-item row of 11px labels can require >320px once its margins
      // and tap gaps are included. Keep the readable font and reflow 3+2.
      const needsTwoRows = (W - 16 - slotTotal) / (utilitySlots.length - 1) < 4;
      const groups = needsTwoRows ? [[0, 1, 2], [3, 4]] : [[0, 1, 2, 3, 4]];
      // The first utility row must clear both the start button and optional
      // resume/new-run button. On 360px tall layouts its old y overlapped START.
      const rowStep = resumeCheckpoint ? 18 : 22;
      const occupiedBottom = Math.max(btnY + btnH / 2, resumeCheckpoint ? btnY + 53 : -Infinity);
      const firstRowHalfHeight = Math.max(...utilitySlots.slice(0, 3).map(t => t.height / 2));
      const firstRowY = needsTwoRows
        ? Math.max(utilityY - rowStep, occupiedBottom + 4 + firstRowHalfHeight)
        : utilityY;
      groups.forEach((indices, rowIndex) => {
        const widths = indices.map((i) => slotWidths[i]);
        const total = widths.reduce((a, b) => a + b, 0);
        const slotGap = Math.max(4, Math.min(28, (W - 16 - total) / (indices.length - 1)));
        let slotX = (W - total - slotGap * (indices.length - 1)) / 2;
        for (const index of indices) {
          const t = utilitySlots[index];
          t.setX(slotX + slotWidths[index] / 2);
          t.setY(needsTwoRows ? firstRowY + rowIndex * rowStep : utilityY);
          slotX += slotWidths[index] + slotGap;
          // setInteractive() snapshots the text hit area before later setText().
          const hit = t.input?.hitArea;
          if (hit && typeof hit.setSize === 'function') hit.setSize(t.width, t.height);
        }
      });
    }
    const musicVolText = this.add
      .text(W / 2, utilityY, volLabel(Math.round(Sfx.getMusicVolume() * 100)), {
        fontFamily: UI_FONT,
        fontSize: utilityFont,
        fontStyle: '650',
        color: '#c89aaf',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .setResolution(2)
      .setDepth(5)
      .on('pointerup', () => {
        const v = Sfx.bumpMusicVolume();
        musicVolText.setText(volLabel(Math.round(v * 100)));
        layoutUtilityRow();
        Sfx.play('click');
      });
    utilitySlots.push(musicVolText);
    const soundText = this.add
      .text(W / 2, utilityY, `звук: ${Sfx.muted ? 'выкл' : 'вкл'}`, {
        fontFamily: UI_FONT,
        fontSize: utilityFont,
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
        layoutUtilityRow();
        if (!muted) Sfx.play('click');
      });
    utilitySlots.push(soundText);
    const sfxVolText = this.add
      .text(W / 2, utilityY, sfxLabel(Math.round(Sfx.getSfxVolume() * 100)), {
        fontFamily: UI_FONT,
        fontSize: utilityFont,
        fontStyle: '650',
        color: '#c89aaf',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .setResolution(2)
      .setDepth(5)
      .on('pointerup', () => {
        const v = Sfx.bumpSfxVolume();
        sfxVolText.setText(sfxLabel(Math.round(v * 100)));
        layoutUtilityRow();
        Sfx.play('click');
      });
    utilitySlots.push(sfxVolText);


    const summaryText = this.add
      .text(W / 2, utilityY, `СВОДКА`, {
        fontFamily: FONT,
        fontSize: H < 650 ? '11px' : '12px',
        fontStyle: 'bold',
        color: '#c9f6ff',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .setResolution(2)
      .setDepth(5)
      .setName('ofeliya-menu-social')
      .on('pointerup', () => {
        Sfx.play('click');
        PlatformBridge.haptic('light');
        this.showSocialHub();
      });
    utilitySlots.push(summaryText);

    const codexSave = SaveSystem.get();
    const codexFound = codexSave.evolutionsSeen.length + codexSave.legendarySeen.length;
    const codexText = this.add
      .text(W / 2, utilityY, `КОДЕКС ${codexFound}/9`, {
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
    utilitySlots.push(codexText);
    // All five utility labels were created centered as placeholders; distribute them
    // edge-to-edge from real measured widths so neither end can leave the screen.
    layoutUtilityRow();

    if (!compactFooter) {
      this.add
        .text(W / 2, H - 66, 'Двигай штамм · собирай РНК · выбирай мутации', {
          fontFamily: UI_FONT,
          fontSize: '13px',
          fontStyle: '600',
          color: '#d8d1e2',
          align: 'center',
          wordWrap: { width: W - 36 },
        })
        .setOrigin(0.5)
        .setResolution(2)
        .setDepth(5);
    }

    this.add
      .text(W / 2, legalY, 'О ПРИЛОЖЕНИИ · ПОЛИТИКА · ПОДДЕРЖКА', {
        fontFamily: UI_FONT,
        fontSize: H < 650 ? '11px' : '12px',
        fontStyle: '700',
        color: '#c9f6ff',
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
      .text(W / 2, H - 9, `mini-app · ${PlatformBridge.platform} · ${RELEASE_SHORT}`, {
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
      this.questBoard?.destroy();
      this.questBoard = null;
      this.socialHub?.destroy();
      this.socialHub = null;
      this.profileLoadGeneration += 1;
      this.founderBadge?.destroy();
      this.founderBadge = null;
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

  private showSocialHub(): void {
    if (this.socialHub || this.codexOverlay || this.questBoard) return;
    this.socialHub = new SocialHub(
      this,
      PlatformBridge,
      async () => {
        const status = await launchDailyRun({
          registry: this.registry,
          platform: PlatformBridge,
        });
        if (status === 'ok') {
          void trackProductEvent('daily', PlatformBridge, { action: 'launch' });
          this.socialHub?.destroy();
          this.scene.start('Game');
        }
        return status;
      },
      () => {
        this.socialHub = null;
      }
    );
  }

  private showCodex(): void {
    if (this.codexOverlay || this.socialHub || this.questBoard) return;

    const W = this.scale.width;
    const H = this.scale.height;
    const compact = H < 650;
    const save = SaveSystem.get();
    const overlay = this.add.container(0, 0).setDepth(40);
    this.codexOverlay = overlay;

    const dim = this.add
      .rectangle(W / 2, H / 2, W, H, VISUAL.ink, 0.95)
      .setInteractive();
    const panelW = Math.min(W - 22, 370);
    const panelH = Math.min(H - 34, 650);
    const panel = this.add
      .rectangle(W / 2, H / 2, panelW, panelH, VISUAL.panel, 0.995)
      .setStrokeStyle(1, VISUAL.line, 0.8);
    overlay.add([dim, panel, createSpecimenSurface(this, W / 2, H / 2, panelW, panelH, {
      accent: VISUAL.host, detail: 'quiet',
    })]);

    const top = H / 2 - panelH / 2;
    const left = W / 2 - panelW / 2;
    overlay.add(
      this.add
        .text(W / 2, top + 26, 'КОДЕКС · STRAIN-0', {
          fontFamily: FONT,
          fontSize: compact ? '19px' : '22px',
          fontStyle: 'bold',
          color: VISUAL_TEXT.ivory,
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
          color: VISUAL_TEXT.host,
        })
        .setOrigin(0.5)
        .setResolution(2)
    );

    const close = this.add
      .text(left + panelW - 18, top + 14, '×', {
        fontFamily: FONT,
        fontSize: '26px',
        color: VISUAL_TEXT.muted,
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
      ['legendary', 'ЛЕГЕНДАРНЫЕ', W / 2],
      ['mastery', 'МАСТЕРСТВО', W / 2 + 104],
    ];

    const render = () => {
      body.removeAll(true);
      for (const tab of tabs) {
        const active = tab.id === page;
        tab.text.setColor(active ? VISUAL_TEXT.warning : VISUAL_TEXT.muted);
        tab.text.setAlpha(active ? 1 : 0.95);
        tab.underline.setVisible(active);
      }

      const bodyTop = top + 116;
      const addText = (
        x: number,
        y: number,
        value: string,
        size: number = compact ? 12 : 14,
        color: string = VISUAL_TEXT.ivory,
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
        addText(W / 2, bodyTop, 'КРИТИЧЕСКИЕ МУТАЦИИ', compact ? 13 : 15, VISUAL_TEXT.warning, panelW - 42, 'center');
        const evolutionIds: EvolutionId[] = ['prism', 'halo', 'singularity'];
        evolutionIds.forEach((id, index) => {
          const found = save.evolutionsSeen.includes(id);
          const y = bodyTop + 40 + index * (compact ? 76 : 86);
          const row = createSpecimenSurface(
            this, W / 2, y + (compact ? 24 : 28), panelW - 34, compact ? 62 : 72,
            { fill: VISUAL.panelRaised, accent: found ? VISUAL.warning : VISUAL.line, detail: 'quiet' },
          );
          body.add(row);
          addText(
            left + 28,
            y,
            `${found ? '◆' : '◇'}  ${found ? EVOLUTION_NAMES[id] : 'НЕ ОТКРЫТО'}`,
            compact ? 13 : 15,
            found ? VISUAL_TEXT.warning : VISUAL_TEXT.muted
          );
          addText(
            left + 49,
            y + 22,
            found
              ? 'Критическая форма зарегистрирована в КОДЕКСЕ.'
              : 'Развивай совместимые ветви мутаций.',
            compact ? 12 : 13,
            found ? VISUAL_TEXT.muted : VISUAL_TEXT.muted,
            panelW - 76
          );
        });
      } else if (page === 'legendary') {
        addText(W / 2, bodyTop, 'ЛЕГЕНДАРНЫЕ ИЗМЕНЕНИЯ ПРАВИЛ', compact ? 12 : 15, VISUAL_TEXT.warning, panelW - 42, 'center');
        LEGENDARIES.forEach((def, index) => {
          const found = save.legendarySeen.includes(def.id);
          const y = bodyTop + 32 + index * (compact ? 46 : 51);
          body.add(createSpecimenSurface(this, W / 2, y + (compact ? 16 : 18), panelW - 34, compact ? 44 : 49, {
            fill: VISUAL.panelRaised, accent: found ? VISUAL.warning : VISUAL.line, detail: 'quiet',
          }));
          addText(
            left + 28,
            y,
            `${found ? '◆' : '◇'}  ${found ? def.title : '???'}`,
            compact ? 12 : 14,
            found ? VISUAL_TEXT.warning : VISUAL_TEXT.muted,
            panelW - 54
          );
          if (found) {
            addText(
              left + 49,
              y + 18,
              def.effect,
              compact ? 11 : 13,
              VISUAL_TEXT.ivory,
              panelW - 78
            ).setFontStyle('600');
          }
        });
      } else {
        const standardBest = save.bestCampaignClearMs > 0 ? fmtTime(save.bestCampaignClearMs) : '—';
        const strainedBest =
          save.bestStrainedCampaignClearMs > 0 ? fmtTime(save.bestStrainedCampaignClearMs) : '—';
        addText(W / 2, bodyTop, 'МАСТЕРСТВО КАМПАНИИ', compact ? 13 : 15, VISUAL_TEXT.warning, panelW - 42, 'center');
        const standardRow = createSpecimenSurface(this, W / 2, bodyTop + 50, panelW - 34, 40, {
          fill: VISUAL.panelRaised, accent: save.standardCampaignClears > 0 ? VISUAL.immune : VISUAL.line, detail: 'quiet',
        });
        const strainedRow = createSpecimenSurface(this, W / 2, bodyTop + 92, panelW - 34, 40, {
          fill: VISUAL.panelRaised, accent: save.strainedCampaignClears > 0 ? VISUAL.warning : VISUAL.line, detail: 'quiet',
        });
        body.add([standardRow, strainedRow]);
        addText(
          left + 28,
          bodyTop + 39,
          `${save.standardCampaignClears > 0 ? '◆' : '◇'} СТАНДАРТ · пройдено ${save.standardCampaignClears} · рекорд ${standardBest}`,
          compact ? 12 : 13,
          save.standardCampaignClears > 0 ? VISUAL_TEXT.immune : VISUAL_TEXT.muted
        );
        addText(
          left + 28,
          bodyTop + 81,
          `${save.strainedCampaignClears > 0 ? '◆' : '◇'} НАПРЯЖЕНИЕ · пройдено ${save.strainedCampaignClears} · рекорд ${strainedBest}`,
          compact ? 12 : 13,
          save.strainedCampaignClears > 0 ? VISUAL_TEXT.warning : VISUAL_TEXT.muted
        );
        addText(
          left + 28,
          bodyTop + 130,
          'ВЕТКИ ШТАММА',
          compact ? 12 : 14,
          VISUAL_TEXT.ivory
        ).setFontStyle('700');
        const tracks = masteryTracks({
          evolutionsSeen: save.evolutionsSeen,
          legendarySeen: save.legendarySeen,
        });
        tracks.forEach((track, index) => {
          const y = bodyTop + 154 + index * (compact ? 42 : 46);
          addText(
            left + 28,
            y,
            `${track.complete ? '◆' : '◇'} ${track.label} · ${track.progress}/${track.max}`,
            compact ? 11 : 13,
            track.complete ? VISUAL_TEXT.host : VISUAL_TEXT.ivory,
            panelW - 56
          ).setFontStyle('700');
          addText(
            left + 48,
            y + (compact ? 17 : 19),
            track.complete ? track.objective : track.nextGoal,
            compact ? 11 : 13,
            track.complete ? VISUAL_TEXT.host : VISUAL_TEXT.muted,
            panelW - 78
          );
        });
        addText(
          left + 28,
          bodyTop + (compact ? 286 : 302),
          `ДОСТИЖЕНИЯ · ${save.achievements.length}/${ACHIEVEMENTS.length}`,
          compact ? 11 : 13,
          VISUAL_TEXT.ivory
        );
        addText(
          left + 28,
          top + panelH - 82,
          `ЦИКЛОВ: ${save.runs}   ·   УНИЧТОЖЕНО КЛЕТОК: ${save.totalKills}`,
          compact ? 11 : 13,
          VISUAL_TEXT.ivory
        );
      }
    };

    for (const [id, label, x] of tabDefs) {
      const tabText = this.add
        .text(x, tabY, label, {
          fontFamily: FONT,
          fontSize: compact ? '11px' : '13px',
          fontStyle: 'bold',
          color: VISUAL_TEXT.muted,
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
        .rectangle(x, tabY + (compact ? 13 : 14), Math.min(88, Math.max(52, tabText.width + 14)), 3, VISUAL.warning, 1)
        .setVisible(false);
      tabs.push({ id, label, x, text: tabText, underline });
      overlay.add([tabText, underline]);
    }

    overlay.add(
      this.add
        .text(W / 2, top + panelH - 40, 'КВЕСТЫ · локальный прогресс', {
          fontFamily: UI_FONT,
          fontSize: compact ? '11px' : '12px',
          fontStyle: '650',
          color: VISUAL_TEXT.ivory,
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
    const questHit = this.add.rectangle(W / 2, top + panelH - 40, panelW - 32, 44, VISUAL.ink, 0.001)
      .setInteractive({ useHandCursor: true }).setName('ofeliya-menu-quests');
    overlay.add(questHit);
    questHit.on('pointerup', () => {
      dismiss();
      this.questBoard = new QuestBoard(this, () => { this.questBoard = null; });
    });
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
