import { CollectionBoard } from '../ui/CollectionBoard';
import { clientCollection, clientFlags } from '../systems/ClientExperience';
import { QuestBoard } from '../ui/QuestBoard';
import Phaser from 'phaser';
import { artScale } from '../game/ArtMetrics';
import { parseChallengePayload } from '../game/Challenge';
import { parseDuelStartPayload, type DuelChallengeSnapshot } from '../game/Duel';
import { COLORS, FONT, UI_FONT, UI_TEXT, fmtTime } from '../game/config';
import { CODEX_COPY, MENU_COPY, META_COPY, masteryModeLine, platformLabel } from '../game/UiCopy';
import { fmtInt, joinSegments, toTitleCase } from '../game/UiFormat';
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
import { CTA } from '../ui/cta';
import { computeMenuLayout, MIN_TOUCH } from '../ui/menuLayout';
import { createMetaDock, createModalFrame, type MetaDockTarget } from '../ui/modal';
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

/** The number of records the codex counts. */
const CODEX_RECORD_TOTAL = CODEX_COPY.recordTotal;
/** The explanation under the critical mutations header. */
const CODEX_SYNERGY_SUB = CODEX_COPY.synergySub;
/** The titles of the three locked synergies. */
const CODEX_SYNERGY_TITLES = CODEX_COPY.synergyTitles;
/** The recipe of every locked synergy. */
const CODEX_SYNERGY_RECIPES = CODEX_COPY.synergyRecipes;
/** The state of a branch that is fully discovered. */
const CODEX_BRANCH_COMPLETE = CODEX_COPY.branchComplete;

export class MenuScene extends Phaser.Scene {
  private collectionBoard: CollectionBoard | null = null;
  private questBoard: QuestBoard | null = null;
  private codexOverlay: Phaser.GameObjects.Container | null = null;
  private socialHub: SocialHub | null = null;
  private founderBadge: Phaser.GameObjects.Container | null = null;
  private profileLoadGeneration = 0;

  constructor() {
    super('Menu');
  }

  create(): void {
    if (clientFlags().collection.enabled) clientCollection().visit();
    StartupTrace.mark('menu.create.start');
    StartupTrace.mark('menu.cinematicTextures.start');
    ensureCinematicTextures(this);
    StartupTrace.mark('menu.cinematicTextures.end');
    StartupTrace.mark('menu.strainTextures.start');
    ensureStrainZeroTextures(this);
    StartupTrace.mark('menu.strainTextures.end');
    const W = this.scale.width;
    const H = this.scale.height;

    // The record strip is known before anything is drawn, so the whole menu geometry
    // can be resolved up front by the layout module.
    const save = SaveSystem.get();
    const displayName = PlatformBridge.getDisplayName();
    const recordParts: string[] = [];
    if (displayName) recordParts.push(`Носитель: ${displayName}`);
    if (save.bestSurvivalMs > 0) recordParts.push(`Рекорд: ${fmtTime(save.bestSurvivalMs)}`);
    if (save.bestKills > 0) recordParts.push(`Уничтожено: ${fmtInt(save.bestKills)}`);
    const recordText = recordParts.join(' · ');
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

    // The run configuration is known before anything is drawn, so the whole menu
    // geometry can be resolved up front by the layout module.
    const layout = computeMenuLayout(W, H, {
      hasCheckpoint: Boolean(resumeCheckpoint),
      hasRecord: recordText.length > 0,
      recordLines: recordText.length > 40 ? 2 : 1,
      hasChallenge: Boolean(incomingChallenge || incomingDuelId),
    });

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

    // ---- Hero ------------------------------------------------------------
    // The hero is anchored to the top of the viewport. The layout module owns the
    // geometry, so the art, the statement and the record always land on the same
    // rhythm at every viewport.
    const artCenterY = layout.artTop + layout.artHeight / 2;
    const host = this.add
      .image(W * 0.5, artCenterY + layout.artHeight * 0.16, 'host-cell-shadow')
      .setScale(artScale('host-cell-shadow', (layout.artHeight * 1.25) / 112))
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
    const specimenRadius = layout.ringRadius;
    const specimen = this.add.graphics().setPosition(W / 2, artCenterY).setDepth(0);
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
    const halo = this.add.graphics().setPosition(W / 2, artCenterY).setDepth(1);
    halo.lineStyle(BORDER.heavyLg, VISUAL.player, 0.1);
    halo.strokeCircle(0, 0, specimenRadius - 11);
    halo.lineStyle(BORDER.hair, VISUAL.player, 0.32);
    halo.strokeCircle(0, 0, specimenRadius - 11);
    halo.setAlpha(0.55);
    if (!prefersReducedMotion()) this.tweens.add({ targets: halo, alpha: 1, duration: 2400, yoyo: true,
      repeat: -1, ease: 'Sine.InOut' });

    const virus = this.add
      .image(W / 2, artCenterY, 'virus-player')
      .setScale(artScale('virus-player', layout.artScale))
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

    const title = this.add
      .text(W / 2, layout.titleY, 'OFELIYA', {
        fontFamily: FONT,
        fontSize: `${layout.titleFont}px`,
        fontStyle: 'bold',
        color: VISUAL_TEXT.ivory,
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setName('ofeliya-menu-title')
      .setDepth(5);
    title.setShadow(0, 2, '#080f14', 0, true, true);

    const strainLabel = this.add
      .text(W / 2, layout.strainY, 'STRAIN ZERO', {
        fontFamily: FONT,
        fontSize: layout.compact ? '9px' : '12px',
        fontStyle: 'bold',
        color: VISUAL_TEXT.player,
        letterSpacing: 4,
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setDepth(5);
    // The brand text gives up its room before the hero collapses. The layout
    // decides; the menu only obeys.
    if (!layout.showStrain) strainLabel.setVisible(false);

    // Cosmetic meta is fail-closed: only a strictly parsed, signed server profile can
    // surface the founder entitlement. No local save/registry state can manufacture it.
    void fetchServerProfile(PlatformBridge).then((profile) => {
      if (profileLoadGeneration !== this.profileLoadGeneration || !this.sys.isActive()) return;
      if (!hasFounderBadge(profile)) return;

      const badgeY = layout.badgeY;
      const badgeW = Math.min(layout.contentWidth, 156);
      const badge = this.add.container(0, 0).setDepth(6).setName('ofeliya-menu-founder-badge');
      const plate = this.add
        .rectangle(W / 2, badgeY, badgeW, 24, COLORS.bg, 0.86)
        .setStrokeStyle(1, COLORS.gold, 0.78);
      const label = this.add
        .text(W / 2, badgeY, `◆  ${FOUNDER_BADGE_LABEL}`, {
          fontFamily: FONT,
          fontSize: layout.compact ? '9px' : '10px',
          fontStyle: 'bold',
          color: '#ffe066',
          letterSpacing: 0.6,
        })
        .setOrigin(0.5)
        .setResolution(2);
      badge.add([plate, label]);
      this.founderBadge = badge;
    });

    // ---- Statement, record and run state ---------------------------------
    const hookY = layout.hookY;
    this.add
      .text(W / 2, hookY, MENU_COPY.hook, {
        fontFamily: FONT,
        fontSize: `${layout.hookFont}px`,
        fontStyle: 'bold',
        color: VISUAL_TEXT.ivory,
        align: 'center',
        lineSpacing: 5,
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setName('ofeliya-menu-hook')
      .setDepth(5);

    const tagline = this.add
      .text(W / 2, layout.taglineY, MENU_COPY.tagline, {
        fontFamily: UI_FONT,
        fontSize: `${layout.taglineFont}px`,
        fontStyle: '600',
        color: VISUAL_TEXT.muted,
        align: 'center',
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setName('ofeliya-menu-subtitle')
      .setDepth(5);
    if (!layout.showTagline) tagline.setVisible(false);

    // One compact record line. Every value is a real counter of the product save:
    // the display name of the carrier, the best survival time and the best kills of
    // a single run. A value that does not exist yet removes its own segment.
    const recordLine = this.add
      .text(W / 2, layout.recordY, recordText, {
        fontFamily: UI_FONT,
        fontSize: `${layout.recordFont}px`,
        fontStyle: '700',
        color: '#9deeff',
        align: 'center',
        wordWrap: { width: W - 40, useAdvancedWrap: true },
        maxLines: 2,
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setName('ofeliya-menu-record')
      .setDepth(5);
    if (!recordText) recordLine.setVisible(false);

    let challengeHeadline: Phaser.GameObjects.Text | null = null;
    let challengeTargetText: Phaser.GameObjects.Text | null = null;
    let challengeDetailText: Phaser.GameObjects.Text | null = null;
    if (incomingChallenge || incomingDuelId) {
      const challengeY = layout.challengeY;
      const challengeH = layout.challengeHeight;
      const panelW = Math.min(W - 42, 330);
      this.add
        .rectangle(W / 2, challengeY, panelW, challengeH, 0x251020, 0.9)
        .setStrokeStyle(1.5, COLORS.gold, 0.78)
        .setDepth(4);
      challengeHeadline = this.add
        .text(W / 2, challengeY - challengeH / 2 + 8, incomingDuelId ? 'ДУЭЛЬ · ЗАГРУЗКА' : 'ВЫЗОВ ПОЛУЧЕН', {
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
        .text(W / 2, challengeY + challengeH / 2 - 9, detail, {
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
    }

    // ---- Run configuration -------------------------------------------------
    // Two cards side by side: the difficulty the next run will use and the control
    // mode. Both are interactive; both keep the real value of the product state.
    const cardGap = layout.cardGap;
    const cardW = layout.cardWidth;
    const cardH = layout.cardHeight;
    const cardY = layout.cardY;
    const cardLeftX = W / 2 - layout.contentWidth / 2 + cardW / 2;
    const cardRightX = W / 2 - layout.contentWidth / 2 + cardW + cardGap + cardW / 2;

    const createConfigCard = (
      name: string,
      x: number,
      accent: number
    ): {
      bg: Phaser.GameObjects.Rectangle;
      surface: Phaser.GameObjects.Graphics;
      rail: Phaser.GameObjects.Rectangle;
      label: Phaser.GameObjects.Text;
      value: Phaser.GameObjects.Text;
      desc: Phaser.GameObjects.Text;
    } => {
      const left = x - cardW / 2;
      // No stroke on the plate: the specimen surface below owns the frame, so a
      // framed panel never shows two parallel border lines.
      const bg = this.add
        .rectangle(x, cardY, cardW, cardH, VISUAL.panel, 0.97)
        .setDepth(5)
        .setName(name)
        .setInteractive({ useHandCursor: true });
      const surface = createSpecimenSurface(this, x, cardY, cardW, cardH, {
        fill: VISUAL.panel, accent, detail: 'quiet',
      }).setDepth(5);
      const rail = this.add.rectangle(left + 5, cardY, 5, cardH - 10, accent, 0.92).setDepth(6);
      const label = this.add
        .text(left + 14, cardY - cardH / 2 + 11, '', {
          fontFamily: UI_FONT,
          fontSize: layout.compact ? '10px' : '11px',
          fontStyle: '700',
          color: UI_TEXT.secondary,
          letterSpacing: 0.8,
        })
        .setOrigin(0, 0.5)
        .setResolution(2)
        .setName(`${name}-label`)
        .setDepth(6);
      const value = this.add
        .text(left + 14, cardY - cardH / 2 + 28, '', {
          fontFamily: FONT,
          fontSize: layout.compact ? '13px' : '15px',
          fontStyle: 'bold',
          color: UI_TEXT.primary,
        })
        .setOrigin(0, 0.5)
        .setResolution(2)
        .setName(`${name}-value`)
        .setDepth(6);
      const desc = this.add
        .text(left + 14, cardY + cardH / 2 - 11, '', {
          fontFamily: UI_FONT,
          // The readability contract floors the description of a run-configuration
          // card at 11px on a compact viewport and at 13px on a tall one.
          fontSize: layout.compact ? '11px' : '13px',
          fontStyle: '650',
          color: UI_TEXT.secondary,
          wordWrap: { width: cardW - 28, useAdvancedWrap: true },
          // Two lines are allowed everywhere: the one-line variant of the copy
          // is chosen by the fit, not by the viewport, so the text is never cut
          // in the middle of a line.
          maxLines: 2,
        })
        .setOrigin(0, 0.5)
        .setResolution(2)
        .setName(`${name}-desc`)
        .setDepth(6);
      return { bg, surface, rail, label, value, desc };
    };

    const difficultyCard = createConfigCard('ofeliya-menu-difficulty-selector', cardLeftX, COLORS.cyan);
    const controlCard = createConfigCard('ofeliya-menu-control-selector', cardRightX, COLORS.magenta);
    difficultyCard.label.setText('СЛОЖНОСТЬ');
    controlCard.label.setText('УПРАВЛЕНИЕ');

    // The step indicator of the difficulty scale, next to the value of the card.
    const difficultySteps = this.add
      .text(W / 2 - layout.contentWidth / 2 + cardW - 12, cardY - cardH / 2 + 28, '', {
        fontFamily: UI_FONT,
        fontSize: layout.compact ? '11px' : '12px',
        color: VISUAL_TEXT.muted,
      })
      .setOrigin(1, 0.5)
      .setResolution(2)
      .setName('ofeliya-menu-difficulty-selector-steps')
      .setDepth(6);

    // A saved run dims the two run-configuration cards: they configure the next
    // run and must never look like they change the run that is going on.
    const dimmed = Boolean(resumeCheckpoint);
    const cardAlpha = dimmed ? 0.6 : 1;
    const hoverAlpha = dimmed ? 0.72 : 1;
    const applyCardDim = (card: typeof difficultyCard): void => {
      card.bg.setAlpha(cardAlpha);
      card.surface.setAlpha(cardAlpha);
      card.rail.setAlpha(cardAlpha);
      card.label.setAlpha(cardAlpha);
      card.value.setAlpha(cardAlpha);
      card.desc.setAlpha(cardAlpha);
    };


    const renderDifficulty = () => {
      const profile = getDifficultyProfile(selectedDifficulty);
      const duelLocked = incomingDuelId !== null && !duelUnavailable;
      const challengeLocked = Boolean(incomingChallenge) || duelLocked;
      const difficultyAccent =
        challengeLocked || profile.id === 'strained' ? COLORS.gold : COLORS.cyan;
      difficultyCard.value.setText(
        challengeLocked
          ? toTitleCase(getDifficultyProfile('standard').shortLabel)
          : `${toTitleCase(profile.label)} ›`
      );
      difficultyCard.value.setColor(profile.id === 'strained' || challengeLocked ? '#ffe066' : '#fff4ec');
      difficultySteps.setText(MENU_COPY.difficultySteps[profile.id] ?? '');
      // The description of a run-configuration card stays inside the card: the
      // full copy is used when it fits, and the one-line variant of the same
      // fact takes its place when it does not. The readability floor of the
      // description is never lowered to make it fit.
      const difficultyHint =
        profile.id === 'strained' ? 'сложнее' : profile.id === 'easy' ? 'спокойнее' : 'базовый';
      if (challengeLocked) {
        difficultyCard.desc.setText(duelLocked ? 'фиксировано дуэлью' : 'фиксировано вызовом');
      } else if (resumeCheckpoint) {
        difficultyCard.desc.setText(MENU_COPY.nextRunHint);
      } else {
        difficultyCard.desc.setText(cardW < 170 ? difficultyHint : profile.description);
        if (difficultyCard.desc.getBounds().bottom > cardY + cardH / 2) {
          difficultyCard.desc.setText(difficultyHint);
        }
      }
      difficultyCard.rail.setFillStyle(difficultyAccent, 0.94);
      difficultyCard.bg.setFillStyle(
        profile.id === 'strained' ? 0x29251e : VISUAL.panel,
        0.97
      );
      drawSpecimenSurface(difficultyCard.surface, cardW, cardH, {
        fill: profile.id === 'strained' ? 0x29251e : VISUAL.panel,
        accent: difficultyAccent, detail: 'quiet',
      });
    };
    renderDifficulty();
    applyCardDim(difficultyCard);
    applyCardDim(controlCard);
    difficultyCard.bg.on('pointerup', () => {
      Sfx.play('click');
      PlatformBridge.haptic('light');
      if (incomingChallenge || (incomingDuelId && !duelUnavailable)) return;
      selectedDifficulty = nextDifficultyId(selectedDifficulty);
      writeDifficultySelection(selectedDifficulty);
      this.registry.set('difficultyId', selectedDifficulty);
      renderDifficulty();
    });
    difficultyCard.bg.on('pointerover', () => difficultyCard.bg.setAlpha(hoverAlpha));
    difficultyCard.bg.on('pointerout', () => difficultyCard.bg.setAlpha(0.97));

    const renderControlMode = () => {
      const duelFixed = duelLoading || Boolean(incomingDuel);
      controlCard.value.setText(
        duelLoading
          ? 'ЗАГРУЗКА'
          : duelFixed
            ? toTitleCase(controlModeCompactLabel(selectedControlMode))
            : `${toTitleCase(controlModeCompactLabel(selectedControlMode))} ›`
      );
      // The control card obeys the same rule as the difficulty card: the full
      // copy when it fits, the one-line variant of the same fact when it does
      // not. The hint is the compact copy of the control mode, so it names the
      // same difference as the full description.
      const controlHint = controlModeTinyHint(selectedControlMode);
      if (duelLoading) {
        controlCard.desc.setText('фиксировано');
      } else if (duelFixed) {
        controlCard.desc.setText('задано вызовом');
      } else if (resumeCheckpoint) {
        controlCard.desc.setText(MENU_COPY.nextRunHint);
      } else {
        controlCard.desc.setText(
          cardW < 170 ? controlHint : controlModeCompactDescription(selectedControlMode)
        );
        if (controlCard.desc.getBounds().bottom > cardY + cardH / 2) {
          controlCard.desc.setText(controlHint);
        }
      }
      const controlAccent =
        selectedControlMode === 'two-hand'
          ? COLORS.cyan
          : selectedControlMode === 'dual-move'
            ? COLORS.purple
            : COLORS.magenta;
      controlCard.rail.setFillStyle(controlAccent, 0.95);

      drawSpecimenSurface(controlCard.surface, cardW, cardH, {
        fill: VISUAL.panel, accent: controlAccent, detail: 'quiet',
      });
    };
    renderControlMode();
    applyCardDim(controlCard);
    controlCard.bg.on('pointerup', () => {
      Sfx.play('click');
      PlatformBridge.haptic('light');
      if (duelLoading || incomingDuel) return;
      selectedControlMode = nextControlMode(selectedControlMode);
      writeControlMode(selectedControlMode);
      this.registry.set('controlMode', selectedControlMode);
      renderControlMode();
    });
    controlCard.bg.on('pointerover', () => controlCard.bg.setAlpha(hoverAlpha));
    controlCard.bg.on('pointerout', () => controlCard.bg.setAlpha(0.96));

    // ---- Primary action ----------------------------------------------------
    // One shared primary CTA style: a mint plate with dark, high-contrast text.
    // The run configuration is the caption of the primary action. It lives
    // inside the button, so the menu spends no separate band on it and the
    // hero keeps its room.
    const startButtonCaption = this.add
      .text(W / 2, layout.ctaY + 9, '', {
        fontFamily: UI_FONT,
        fontSize: layout.compact ? '11px' : '12px',
        fontStyle: '650',
        color: CTA.caption,
        align: 'center',
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setName('ofeliya-menu-action-caption')
      .setDepth(6);

    const startButtonText = this.add
      .text(W / 2, layout.ctaY - 9, '', {
        fontFamily: FONT,
        fontSize: layout.compact ? '17px' : '21px',
        fontStyle: 'bold',
        color: CTA.text,
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setName('ofeliya-menu-action')
      .setDepth(6);

    const btnBg = this.add
      .rectangle(W / 2, layout.ctaY, layout.ctaWidth, layout.ctaHeight, CTA.fill, 0.97)
      .setStrokeStyle(2, CTA.stroke, 1)
      .setName('ofeliya-menu-action-bg')
      .setDepth(5)
      .setInteractive({ useHandCursor: true });
    this.add
      .rectangle(W / 2, layout.ctaY - layout.ctaHeight / 2 + 3, layout.ctaWidth - 16, 1, CTA.fillHover, 0.72)
      .setDepth(6);

    const renderStartLabel = () => {
      startButtonText.setText(
        incomingDuelId
          ? 'ЗАГРУЗКА ДУЭЛИ…'
          : incomingChallenge
            ? 'ПРИНЯТЬ ВЫЗОВ'
            : resumeCheckpoint
              ? MENU_COPY.resume
              : MENU_COPY.start
      );
    };
    renderStartLabel();

    const renderRunConfiguration = () => {
      if (incomingDuel) {
        startButtonCaption.setText(`тот же забег · быстрее ${fmtTime(incomingDuel.targetTimeMs)}`);
        return;
      }
      if (resumeCheckpoint) {
        const resumeStage =
          STAGES.find((stage) => stage.id === resumeCheckpoint.director.stageId) ?? STAGES[0];
        // The caption names the run that will be resumed. The configuration
        // cards are marked as belonging to the next run on the cards themselves.
        startButtonCaption.setText(
          joinSegments([
            toTitleCase(resumeStage.name),
            fmtTime(resumeCheckpoint.runState.run.timeMs),
            `Уровень ${resumeCheckpoint.runState.stage.level}`,
            toTitleCase(getDifficultyProfile(resumeCheckpoint.difficultyId).shortLabel),
          ])
        );
        return;
      }
      const stage = STAGES[0];
      startButtonCaption.setText(
        joinSegments([toTitleCase(stage.name), toTitleCase(getDifficultyProfile(selectedDifficulty).shortLabel)])
      );
    };
    renderRunConfiguration();

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
    btnBg.on('pointerover', () => btnBg.setFillStyle(CTA.fillHover, 1));
    btnBg.on('pointerout', () => btnBg.setFillStyle(CTA.fill, 0.97));
    btnBg.on('pointerdown', () => btnBg.setFillStyle(CTA.fillPressed, 1));

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
          renderRunConfiguration();
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
        // The duel is a head-to-head on one fixed seed. The line says what it
        // is; it never promises a reward and never uses a ranking disclaimer.
        challengeDetailText?.setText(
          `тот же забег · ${controlModeLabel(challenge.controlMode)} · личная дуэль`
        );
        startButtonText.setText('ПРИНЯТЬ ДУЭЛЬ');
        renderDifficulty();
        renderControlMode();
        renderRunConfiguration();
        void trackDuelEvent(challenge.challengeId, 'open', PlatformBridge);
      });
    }

    if (resumeCheckpoint) {
      // A proper touch target: the visible label is small, the hit area is not.
      const newRunW = Math.min(layout.contentWidth, 190);
      const newRunHit = this.add
        .rectangle(W / 2, layout.secondaryY, newRunW, layout.secondaryHeight, VISUAL.panelRaised, 0.9)
        .setStrokeStyle(1, COLORS.cyan, 0.45)
        .setDepth(7)
        .setName('ofeliya-menu-new-run')
        .setInteractive({ useHandCursor: true });
      this.add
        .text(W / 2, layout.secondaryY, MENU_COPY.newRun, {
          fontFamily: FONT,
          fontSize: layout.compact ? '11px' : '12px',
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
    // ---- Navigation grid --------------------------------------------------
    // The four meta destinations are a 2x2 grid. Four columns would be cramped at
    // 320px, and a grid keeps the navigation visually apart from the audio row.
    const gridW = layout.gridWidth;
    const colGap = 10;
    const cellW = (gridW - colGap) / 2;
    const gridLeft = W / 2 - gridW / 2;
    const codexSave = SaveSystem.get();
    const codexFound = codexSave.evolutionsSeen.length + codexSave.legendarySeen.length;
    const navItems: Array<{ name: string; label: string; badge?: string; onTap: () => void }> = [
      { name: 'ofeliya-menu-nav-rating', label: MENU_COPY.rating, onTap: () => this.showSocialHub() },
      { name: 'ofeliya-menu-nav-tasks', label: MENU_COPY.tasks, onTap: () => this.showQuestBoard() },
      { name: 'ofeliya-menu-nav-codex', label: MENU_COPY.codex, badge: `${codexFound}/9`, onTap: () => this.showCodex() },
      { name: 'ofeliya-menu-nav-collection', label: MENU_COPY.collection, onTap: () => this.showCollectionBoard() },
    ];
    navItems.forEach((item, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const cx = gridLeft + cellW / 2 + col * (cellW + colGap);
      const cy = layout.gridTop + layout.gridRowHeight / 2 +
        row * (layout.gridRowHeight + layout.gridGap);
      const plate = this.add
        .rectangle(cx, cy, cellW, layout.gridRowHeight, VISUAL.panel, 0.92)
        .setStrokeStyle(1, COLORS.stroke, 0.5)
        .setDepth(5)
        .setName(item.name)
        .setInteractive({ useHandCursor: true });
      this.add
        .text(cx, cy, item.label, {
          fontFamily: FONT,
          fontSize: layout.compact ? '12px' : '13px',
          fontStyle: 'bold',
          color: '#c9f6ff',
          letterSpacing: 0.6,
        })
        .setOrigin(0.5)
        .setResolution(2)
        .setDepth(6);
      if (item.badge) {
        this.add
          .text(cx + cellW / 2 - 10, cy, item.badge, {
            fontFamily: UI_FONT,
            fontSize: layout.compact ? '9px' : '10px',
            fontStyle: '700',
            color: VISUAL_TEXT.muted,
          })
          .setOrigin(1, 0.5)
          .setResolution(2)
          .setDepth(6);
      }
      plate.on('pointerup', () => {
        Sfx.play('click');
        PlatformBridge.haptic('light');
        item.onTap();
      });
      plate.on('pointerover', () => plate.setFillStyle(VISUAL.panelRaised, 0.96));
      plate.on('pointerout', () => plate.setFillStyle(VISUAL.panel, 0.92));
    });

    // ---- Audio row --------------------------------------------------------
    // Three switches and nothing else: the menu says on/off, never a percentage.
    // The stored volume is only written when the player taps a switch.
    let lastMusicVolume = Sfx.getMusicVolume() > 0 ? Sfx.getMusicVolume() : 0.75;
    let lastSfxVolume = Sfx.getSfxVolume() > 0 ? Sfx.getSfxVolume() : 0.75;
    const audioItems: Array<{
      name: string;
      label: string;
      isOn: () => boolean;
      toggle: () => boolean;
    }> = [
      {
        name: 'ofeliya-menu-audio-music',
        label: MENU_COPY.music,
        isOn: () => Sfx.getMusicVolume() > 0,
        toggle: () => {
          const current = Sfx.getMusicVolume();
          if (current > 0) {
            lastMusicVolume = current;
            Sfx.setMusicVolume(0);
          } else {
            Sfx.setMusicVolume(lastMusicVolume);
          }
          return Sfx.getMusicVolume() > 0;
        },
      },
      {
        name: 'ofeliya-menu-audio-sound',
        label: MENU_COPY.sound,
        isOn: () => !Sfx.muted,
        toggle: () => !Sfx.toggle(),
      },
      {
        name: 'ofeliya-menu-audio-effects',
        label: MENU_COPY.effects,
        isOn: () => Sfx.getSfxVolume() > 0,
        toggle: () => {
          const current = Sfx.getSfxVolume();
          if (current > 0) {
            lastSfxVolume = current;
            Sfx.setSfxVolume(0);
          } else {
            Sfx.setSfxVolume(lastSfxVolume);
          }
          return Sfx.getSfxVolume() > 0;
        },
      },
    ];
    const audioGap = 8;
    const audioCellW = (gridW - audioGap * 2) / 3;
    const audioLeft = W / 2 - gridW / 2;
    audioItems.forEach((item, index) => {
      const cx = audioLeft + audioCellW / 2 + index * (audioCellW + audioGap);
      const plate = this.add
        .rectangle(cx, layout.audioY, audioCellW, MIN_TOUCH, VISUAL.panelRaised, 0.55)
        .setStrokeStyle(1, COLORS.stroke, 0.35)
        .setDepth(5)
        .setName(item.name)
        .setInteractive({ useHandCursor: true });
      const label = this.add
        .text(cx, layout.audioY, '', {
          fontFamily: UI_FONT,
          fontSize: layout.compact ? '11px' : '12px',
          fontStyle: '650',
          color: UI_TEXT.secondary,
        })
        .setOrigin(0.5)
        .setResolution(2)
        .setDepth(6);
      const renderAudio = (): void => {
        const on = item.isOn();
        label.setText(`${item.label}: ${on ? MENU_COPY.on : MENU_COPY.off}`);
        label.setColor(on ? '#c89aaf' : UI_TEXT.disabled);
        plate.setFillStyle(on ? VISUAL.panelRaised : VISUAL.panel, on ? 0.75 : 0.4);
      };
      renderAudio();
      plate.on('pointerup', () => {
        const on = item.toggle();
        renderAudio();
        if (on) Sfx.play('click');
      });
      plate.on('pointerover', () => plate.setAlpha(1));
      plate.on('pointerout', () => plate.setAlpha(1));
    });

    // ---- Legal row --------------------------------------------------------
    // The technical release information lives in the About surface, not here.
    const legalWidth = gridW - MIN_TOUCH - 8;
    const legalCenter = gridLeft + legalWidth / 2;
    this.add
      .text(legalCenter, layout.legalY, MENU_COPY.legal, {
        fontFamily: UI_FONT,
        fontSize: layout.compact ? '11px' : '12px',
        fontStyle: '700',
        color: '#c9f6ff',
        align: 'center',
        wordWrap: { width: legalWidth, useAdvancedWrap: true },
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setDepth(6);
    const legalHit = this.add
      .rectangle(legalCenter, layout.legalY, legalWidth, MIN_TOUCH, 0x000000, 0.001)
      .setDepth(5)
      .setName('ofeliya-menu-legal')
      .setInteractive({ useHandCursor: true });
    legalHit.on('pointerup', () => {
      Sfx.play('click');
      showLegalOverlay();
    });

    // ---- Hidden diagnostics gesture ----------------------------------------
    // The visible build information lives in the About surface, so the five-tap
    // gesture keeps a target of its own: it carries the same line, but it is
    // drawn without ink and it never shows a raw host token.
    let diagnosticTapCount = 0;
    let diagnosticTapTimer: number | null = null;
    const diagnosticX = gridLeft + gridW - MIN_TOUCH / 2;
    this.add
      .text(diagnosticX, layout.legalY, `mini-app · ${platformLabel(PlatformBridge.kind)} · ${RELEASE_SHORT}`, {
        fontFamily: FONT,
        fontSize: '9px',
        color: '#654454',
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setAlpha(0.001)
      .setDepth(5);
    const diagnosticTarget = this.add
      .rectangle(diagnosticX, layout.legalY, MIN_TOUCH, MIN_TOUCH, 0x000000, 0.001)
      .setDepth(5)
      .setName('ofeliya-menu-diagnostics')
      .setInteractive({ useHandCursor: true });
    diagnosticTarget.on('pointerup', () => {
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
      this.collectionBoard?.destroy();this.collectionBoard=null;
      this.questBoard?.destroy();
      this.questBoard = null;
      this.socialHub?.destroy();
      this.socialHub = null;
      this.profileLoadGeneration += 1;
      this.founderBadge?.destroy();
      this.founderBadge = null;
    });

    // The result screen can send the player into the codex: the flag is consumed
    // by the menu that opens next.
    if (this.registry.get('openCodexOnMenu') === true) {
      this.registry.remove('openCodexOnMenu');
      this.showCodex();
    }

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
    if (this.socialHub || this.codexOverlay || this.questBoard || this.collectionBoard) return;
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

  /**
   * Open one of the three meta surfaces.
   *
   * The surfaces replace each other: a dock inside one of them opens the next,
   * so the player never has to close a modal before opening another one.
   */
  private openMetaSurface(target: MetaDockTarget): void {
    if (target === 'tasks') this.showQuestBoard();
    else if (target === 'codex') this.showCodex();
    else this.showCollectionBoard();
  }

  private showQuestBoard(): void {
    if (this.questBoard || this.codexOverlay || this.socialHub || this.collectionBoard) return;
    this.questBoard = new QuestBoard(
      this,
      () => { this.questBoard = null; },
      (target) => this.openMetaSurface(target)
    );
  }

  private showCollectionBoard(): void {
    if (this.collectionBoard || this.codexOverlay || this.socialHub || this.questBoard) return;
    if (!clientFlags().collection.enabled) return;
    this.collectionBoard = new CollectionBoard(
      this,
      () => { this.collectionBoard = null; },
      (target) => this.openMetaSurface(target)
    );
  }

  private showCodex(): void {
    if (this.codexOverlay || this.socialHub || this.questBoard || this.collectionBoard) return;

    const W = this.scale.width;
    const H = this.scale.height;
    const compact = H < 650;
    const save = SaveSystem.get();
    const overlay = this.add.container(0, 0).setDepth(40).setName('ofeliya-codex');
    this.codexOverlay = overlay;

    const panelW = Math.min(W - 22, 400);
    const panelH = Math.min(H - 34, 650);
    const dismiss = () => {
      if (this.codexOverlay !== overlay) return;
      PlatformBridge.setBackHandler(null);
      overlay.destroy();
      this.codexOverlay = null;
    };
    // The same modal frame as the other meta surfaces: centered title, a top-right
    // close control with a real hit area, and no second close button at the bottom.
    const frame = createModalFrame(this, overlay, {
      x: W / 2,
      y: H / 2,
      width: panelW,
      height: panelH,
      title: META_COPY.codex,
      compact,
      withDock: true,
      onClose: dismiss,
    });

    const top = H / 2 - panelH / 2;
    const left = W / 2 - panelW / 2;

    const discovered = save.evolutionsSeen.length + save.legendarySeen.length;
    overlay.add(
      this.add
        .text(W / 2, top + 50, META_COPY.codexSubtitle(discovered, CODEX_RECORD_TOTAL, save.runs), {
          fontFamily: UI_FONT,
          fontSize: compact ? '11px' : '13px',
          fontStyle: '700',
          color: VISUAL_TEXT.host,
        })
        .setOrigin(0.5)
        .setResolution(2)
    );


    const body = this.add.container(0, 0);
    overlay.add(body);

    type CodexPage = 'synergies' | 'legendary' | 'mastery';
    let page: CodexPage = 'synergies';
    const tabs: Array<{
      id: CodexPage;
      label: string;
      x: number;
      text: Phaser.GameObjects.Text;
      underline: Phaser.GameObjects.Rectangle;
    }> = [];
    const tabY = top + 82;
    const tabDefs: Array<[CodexPage, string, number]> = [
      ['synergies', 'СИНЕРГИИ', W / 2 - 104],
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

      if (page === 'synergies') {
        addText(W / 2, bodyTop, 'КРИТИЧЕСКИЕ МУТАЦИИ', compact ? 13 : 15, VISUAL_TEXT.warning, panelW - 42, 'center');
        addText(
          W / 2,
          bodyTop + (compact ? 18 : 22),
          CODEX_SYNERGY_SUB,
          // The section note is body text: it must clear the readability floor
          // of the repository on every viewport.
          compact ? 11 : 13,
          VISUAL_TEXT.muted,
          panelW - 42,
          'center'
        );
        const evolutionIds: EvolutionId[] = ['prism', 'halo', 'singularity'];
        evolutionIds.forEach((id, index) => {
          const found = save.evolutionsSeen.includes(id);
          const y = bodyTop + (compact ? 40 : 54) + index * (compact ? 76 : 86);
          const row = createSpecimenSurface(
            this, W / 2, y + (compact ? 24 : 28), panelW - 34, compact ? 62 : 72,
            { fill: VISUAL.panelRaised, accent: found ? VISUAL.warning : VISUAL.line, detail: 'quiet' },
          );
          body.add(row);
          // A locked synergy names its own recipe: three identical "not open"
          // cards told the player nothing.
          addText(
            left + 28,
            y,
            found ? `◆  ${EVOLUTION_NAMES[id]}` : `◇  ${CODEX_SYNERGY_TITLES[index]}`,
            compact ? 13 : 15,
            found ? VISUAL_TEXT.warning : VISUAL_TEXT.muted
          );
          addText(
            left + 49,
            y + 22,
            found
              ? 'Критическая форма зарегистрирована в КОДЕКСЕ.'
              : CODEX_SYNERGY_RECIPES[index],
            compact ? 12 : 13,
            VISUAL_TEXT.muted,
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
        const standardBest = save.bestCampaignClearMs > 0 ? fmtTime(save.bestCampaignClearMs) : null;
        const strainedBest =
          save.bestStrainedCampaignClearMs > 0 ? fmtTime(save.bestStrainedCampaignClearMs) : null;
        addText(W / 2, bodyTop, META_COPY.mastery, compact ? 13 : 15, VISUAL_TEXT.warning, panelW - 42, 'center');
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
          masteryModeLine('Стандарт', save.standardCampaignClears, standardBest),
          compact ? 12 : 13,
          save.standardCampaignClears > 0 ? VISUAL_TEXT.immune : VISUAL_TEXT.muted
        );
        addText(
          left + 28,
          bodyTop + 81,
          masteryModeLine('Напряжение', save.strainedCampaignClears, strainedBest),
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
          // One line per branch: the state is always spelled out in words, and
          // the next step never is a bare imperative.
          const state = track.complete ? CODEX_BRANCH_COMPLETE : track.nextGoal;
          addText(
            left + 28,
            y,
            `${track.complete ? '◆' : '◇'} ${track.label} · ${track.progress}/${track.max} — ${state}`,
            compact ? 11 : 13,
            track.complete ? VISUAL_TEXT.host : VISUAL_TEXT.ivory,
            panelW - 56
          ).setFontStyle('700');
        });
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

    // The internal dock of the meta surfaces: Задачи дня · Кодекс · Коллекция.
    // Рейтинг is a top-level destination and is deliberately not part of it.
    const dock = createMetaDock(this, overlay, {
      x: W / 2,
      y: top + panelH - 34,
      width: panelW - 32,
      active: 'codex',
      compact,
      onSelect: (target) => {
        if (target === 'codex') return;
        dismiss();
        this.openMetaSurface(target);
      },
    });
    dock.setActive('codex');
    PlatformBridge.setBackHandler(dismiss);

    render();
  }

  private onResize(): void {
    this.scene.restart();
  }
}
