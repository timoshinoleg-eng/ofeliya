import Phaser from 'phaser';
import {
  COLORS,
  COMBO,
  FONT,
  JUICE,
  ORBIT,
  PLAYER,
  POSTFX,
  PROGRESSION,
  WEAPON,
  type EnemyKind,
} from '../game/config';
import {
  evaluateAchievements,
  getAchievementDef,
  type AchievementId,
} from '../game/AchievementSystem';
import { rollRunChoices } from '../game/EvolutionSystem';
import {
  getLegendaryDefinition,
  guaranteedLegendaryChoices,
  type LegendaryId,
} from '../game/LegendarySystem';
import { HEARTBEAT_PULSE_PROFILE, HeartbeatPulseDirector, type HeartbeatPulseEvent } from '../game/HeartbeatPulseDirector';
import {
  HEART_SAFE_POCKET,
  heartSafePocketProfile,
} from '../game/HeartPacing';
import {
  CARDIAC_LINE_HAZARD,
  CardiacLineHazardDirector,
  canScheduleCardiacLineHazardBeforeHeartbeat,
  pointInsideCardiacLineHazard,
  type CardiacLineHazardSpec,
} from '../game/CardiacLineHazard';
import {
  getDifficultyProfile,
  heartbeatProfileForDifficulty,
  pickEliteModifier,
  readDifficultySelection,
  type DifficultyId,
  type DifficultyProfile,
} from '../game/DifficultyProfile';
import { IDENTITY } from '../game/identity';
import { readControlMode, type ControlMode } from '../game/ControlMode';
import { generateRunSeed, RunRng } from '../game/RunRng';
import { ImpactDirector } from '../game/ImpactDirector';
import { Player } from '../game/Player';
import { Enemy } from '../game/Enemy';
import { Bullet } from '../game/Bullet';
import { Gem } from '../game/Gem';
import type { RunResult, RunSnapshot } from '../game/RunContracts';
import { RunMilestones } from '../game/RunMilestones';
import { RunState } from '../game/RunState';
import {
  StageDirector,
  type RunEndReason,
  type StageDirectorEvent,
} from '../game/StageDirector';
import { STAGES, difficultyForStage, type StageDefinition } from '../game/StageDefinitions';
import type { EvolutionId, UpgradeDef } from '../game/UpgradeSystem';
import { WaveDirector } from '../game/WaveDirector';
import { AtmosphereSystem } from '../systems/AtmosphereSystem';
import { PlatformBridge } from '../platform';
import { SaveSystem } from '../systems/SaveSystem';
import {
  isCheckpointSafePhase,
  RUN_CHECKPOINT_SCHEMA_VERSION,
  RunCheckpoint,
  validateRunCheckpoint,
  type RunCheckpointData,
} from '../systems/RunCheckpoint';
import { readDailyIntent, shouldCheckpoint } from '../game/DailyRunIntent';
import { SCORE_CAMPAIGN_VERSION, SCORE_RULESET_VERSION } from '../game/RunVersions';
import {
  ADAPTIVE_AUDIO_TUNING,
  clamp01,
  enemyThreatWeight,
  normalizeNearbyThreat,
  type DangerInput,
} from '../systems/adaptiveAudioMath';
import { AdaptiveAudioDirector } from '../systems/AdaptiveAudioDirector';
import { SfxAdaptiveSink } from '../systems/SfxAdaptiveSink';
import { MUSIC_TRACK_COUNT, Sfx } from '../systems/Sfx';
import { VfxSystem } from '../systems/VfxSystem';
import { EnemyHealthOverlay } from '../systems/EnemyHealthOverlay';
import { VideoInterstitial } from '../systems/VideoInterstitial';
import { PERFORMANCE } from '../systems/PerformanceProfile';
import {
  HostCellSystem,
  type HostCellInteractionEvent,
  type HostCellLysisEvent,
} from '../systems/HostCellSystem';
import { trackProductEvent, type ProductEvent, type ProductEventProps } from '../systems/AnalyticsClient';
import type { UIScene } from './UIScene';

interface CoreMark {
  serial: number;
  hits: number;
  lastHitAt: number;
  windowUntil: number;
}

type HostCellHintType = 'approach' | 'enter' | 'exit';

interface ComprehensionPresentationState {
  runSeed: string;
  events: ProductEvent[];
  hostCellHints: HostCellHintType[];
  hostCellSlotsWithHint: number[];
}

const COMPREHENSION_STATE_KEY = 'ofeliya_comprehension_v1';

export class GameScene extends Phaser.Scene {
  player!: Player;
  runState!: RunState;

  private atmosphere!: AtmosphereSystem;
  private vignette!: Phaser.GameObjects.Image;
  private vfx!: VfxSystem;
  private enemyHealth!: EnemyHealthOverlay;
  private hostCells!: HostCellSystem;
  private firstRunComprehension = false;
  private hostCellsCompletedThisRun = 0;
  private hostCellHintEventsShown = new Set<HostCellHintType>();
  private hostCellSlotsWithHint = new Set<number>();
  private comprehensionEventsSent = new Set<ProductEvent>();
  private bullets!: Phaser.Physics.Arcade.Group;
  private enemies!: Phaser.Physics.Arcade.Group;
  private gems!: Phaser.Physics.Arcade.Group;
  private blades: Phaser.GameObjects.Image[] = [];
  private haloRing: Phaser.GameObjects.Arc | null = null;
  private wave!: WaveDirector;
  private stageDirector!: StageDirector;
  private milestones!: RunMilestones;
  private aimMarker!: Phaser.GameObjects.Image;
  private playerBar!: Phaser.GameObjects.Graphics;

  private nextFireAt = 0;
  private novaAcc = 0;
  private queuedLevels = 0;
  awaitingChoice = false;
  pendingChoices: UpgradeDef[] = [];
  legendaryRewardPending = false;
  private pendingEvolutionCeremony: EvolutionId | null = null;
  private pendingLegendaryCeremony: LegendaryId | null = null;
  private newAchievements: AchievementId[] = [];
  private achievementCheckAcc = 0;
  private hitStopUntil = 0;
  private hitStopped = false;
  private dmgTexts: Phaser.GameObjects.Text[] = [];
  private playerImpactCue: Phaser.GameObjects.Graphics | null = null;
  private dmgCursor = 0;
  private lastDmgAt = 0;
  private lastDmg: { obj: Phaser.GameObjects.Text; value: number; at: number } | null = null;
  private trail: Phaser.GameObjects.Image[] = [];
  private trailCursor = 0;
  private trailAcc = 0;
  private visualEnemyDensity = 0;
  private visualDensityRefreshAt = 0;
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  private introHint: Phaser.GameObjects.Container | null = null;
  private transitionGeneration = 0;
  difficulty!: DifficultyProfile;
  runSeed = '';
  controlMode!: ControlMode;
  resumed = false;
  private checkpointAccMs = 0;
  private dailyRun = false;
  private gameplayRng!: RunRng;
  private audio!: AdaptiveAudioDirector;
  private audioAccMs = 0;
  private heartbeatPulse!: HeartbeatPulseDirector;
  private cardiacHazard = new CardiacLineHazardDirector();
  private cardiacHazardRng!: RunRng;
  private cardiacHazardVisual: {
    serial: number;
    warning: Phaser.GameObjects.Rectangle;
    beam: Phaser.GameObjects.Rectangle;
  } | null = null;
  private impact = new ImpactDirector();
  private zeroPointNextAt = 0;
  private zeroPointUntil = 0;
  private zeroPointX = 0;
  private zeroPointY = 0;
  private coreMarks = new WeakMap<Enemy, CoreMark>();
  private heartbeatLegendaryWindowUntil = 0;
  private heartbeatLegendarySpent = false;
  private heartbeatSafeIndicator: Phaser.GameObjects.Arc | null = null;
  private heartbeatSafeX = 0;
  private heartbeatSafeY = 0;
  private heartbeatSafeRadius: number = HEART_SAFE_POCKET.normal.radius;
  private heartbeatProtectedUntil = 0;
  private heartbeatOpportunityUntil = 0;
  private heartbeatBeatIndex = 0;
  private lastCarrierUsed = false;
  private bossDefeatCeremony: {
    token: number;
    stageId: string;
    completeAt: number;
  } | null = null;
  private stageTransition: {
    token: number;
    from: StageDefinition;
    to: StageDefinition;
    timer: Phaser.Time.TimerEvent | null;
    committing: boolean;
    earliestCommitAt: number;
  } | null = null;

  constructor() {
    super('Game');
  }

  create(): void {
    const requestedResume = this.registry.get('runCheckpointResume') as
      | RunCheckpointData
      | undefined;
    this.registry.remove('runCheckpointResume');
    const resume = requestedResume ? validateRunCheckpoint(requestedResume) : null;
    if (requestedResume && !resume) RunCheckpoint.clear();

    this.stageDirector = new StageDirector(STAGES);
    if (resume) this.stageDirector.restore(resume.director);

    const selectedDifficulty =
      resume?.difficultyId ??
      ((this.registry.get('difficultyId') as DifficultyId | undefined) ?? readDifficultySelection());
    this.difficulty = getDifficultyProfile(selectedDifficulty);
    this.registry.set('difficultyId', this.difficulty.id);

    const requestedSeed = this.registry.get('runSeedOverride') as string | number | undefined;
    // The separate Daily intent is authoritative for fail-closed checkpoint policy.
    // Even if the ticket/seed state is later corrupted, this run must never become resumable
    // as an ordinary run. Non-daily launch paths clear the marker in MenuScene.
    const dailyIntent = readDailyIntent(this.registry);
    this.dailyRun = dailyIntent !== null;
    this.gameplayRng = new RunRng(resume?.runSeed ?? requestedSeed ?? generateRunSeed());
    if (resume) this.gameplayRng.restore(resume.rng);
    this.runSeed = this.gameplayRng.seed;
    this.registry.set('runSeed', this.runSeed);
    this.registry.remove('runSeedOverride');
    // Separate seeded RNG: the phase-two boss hazard must never shift checkpointed gameplay streams.
    // Boss phases are not resumable checkpoints, so this director can reset safely with the scene.
    this.cardiacHazardRng = new RunRng(`${this.runSeed}-cardiac-hazard`);
    this.cardiacHazard.reset();
    this.cardiacHazardVisual = null;

    this.controlMode =
      resume?.controlMode ??
      ((this.registry.get('controlMode') as ControlMode | undefined) ?? readControlMode());
    this.registry.set('controlMode', this.controlMode);
    this.registry.set('performanceTier', PERFORMANCE.tier);
    this.registry.set('performancePostFx', PERFORMANCE.postFx);

    this.heartbeatPulse = new HeartbeatPulseDirector(
      heartbeatProfileForDifficulty(this.difficulty)
    );
    if (resume) this.heartbeatPulse.restore(resume.heartbeat);
    this.runState = new RunState(this.stageDirector.currentStage);
    if (resume) this.runState.restoreFromCheckpoint(resume.runState);
    this.resumed = resume !== null;
    this.firstRunComprehension = SaveSystem.get().runs === 0;
    this.hostCellsCompletedThisRun = resume ? this.runState.run.hostCellsInfected : 0;
    this.hostCellHintEventsShown = new Set();
    this.hostCellSlotsWithHint = new Set();
    this.restoreComprehensionPresentationState();
    this.checkpointAccMs = 0;
    // Adaptive audio foundation: one deterministic bed per run plus danger-driven tension layers.
    // The director only observes gameplay; StageDirector keeps lifecycle authority.
    this.audio = new AdaptiveAudioDirector(new SfxAdaptiveSink(), { bedCount: MUSIC_TRACK_COUNT });
    this.audioAccMs = 0;
    this.audio.start(
      this.runSeed,
      this.stageDirector.currentStage.order,
      this.stageDirector.currentStage.theme.heartbeatMs
    );
    PlatformBridge.setBackHandler(() => this.exitToMenu());
    this.queuedLevels = 0;
    this.awaitingChoice = false;
    this.pendingChoices = [];
    this.legendaryRewardPending = false;
    this.pendingEvolutionCeremony = null;
    this.pendingLegendaryCeremony = null;
    this.newAchievements = [];
    this.achievementCheckAcc = 0;
    this.nextFireAt = 0;
    this.novaAcc = 0;
    this.blades = [];
    this.haloRing = null;
    this.hitStopUntil = 0;
    this.hitStopped = false;
    this.lastDmg = null;
    this.lastDmgAt = 0;
    this.dmgCursor = 0;
    this.introHint = null;
    this.transitionGeneration = 0;
    this.bossDefeatCeremony = null;
    this.stageTransition = null;
    if (!resume) this.heartbeatPulse.reset();
    this.impact.reset();
    this.zeroPointNextAt = 0;
    this.zeroPointUntil = 0;
    this.zeroPointX = 0;
    this.zeroPointY = 0;
    this.coreMarks = new WeakMap<Enemy, CoreMark>();
    this.heartbeatLegendaryWindowUntil = 0;
    this.heartbeatLegendarySpent = false;
    this.heartbeatSafeIndicator?.destroy();
    this.heartbeatSafeIndicator = null;
    this.heartbeatSafeX = 0;
    this.heartbeatSafeY = 0;
    this.heartbeatProtectedUntil = 0;
    this.heartbeatOpportunityUntil = 0;
    this.heartbeatBeatIndex = 0;
    this.lastCarrierUsed = false;
    this.physics.world.resume();

    const W = this.scale.width;
    const H = this.scale.height;
    this.cameras.main.setBackgroundColor(COLORS.bg);

    this.atmosphere = new AtmosphereSystem(this);
    this.vignette = this.add
      .image(W / 2, H / 2, 'vignette')
      .setScrollFactor(0)
      .setDepth(28)
      .setDisplaySize(W * 1.25, H * 1.25);

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
    this.vfx = new VfxSystem(this);
    this.enemyHealth = new EnemyHealthOverlay(this);
    this.hostCells = new HostCellSystem(
      this,
      this.player,
      (event) => this.onHostCellLysis(event),
      () => ({
        infectionRadius: this.runState.infectionRadius,
        infectionMs: this.runState.infectionDurationMs,
        rna: this.runState.hostLysisRna,
        lysisRadius: this.runState.hostLysisRadius,
        lysisDamage: this.runState.hostLysisDamage,
      }),
      () => this.gameplayRng.next('host-cell'),
      (event) => this.onHostCellInteraction(event),
      (slotIndex) => this.onHostCellSpawn(slotIndex)
    );

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

    this.trail = [];
    for (let i = 0; i < JUICE.trailPool; i++) {
      this.trail.push(
        this.add
          .image(0, 0, 'virus-player')
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

    this.wave = new WaveDirector(
      this,
      this.enemies,
      this.stageDirector.currentStage,
      this.difficulty,
      () => this.gameplayRng.next('enemy-kind'),
      () => this.gameplayRng.next('enemy-spawn')
    );
    this.milestones = new RunMilestones(this);
    if (resume) this.restoreCheckpointRuntime(resume);
    else this.handleStageEvents(this.stageDirector.startRun());
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
    this.saveCheckpointNow();

    // Stage 4 videos are lazy: never requested before an active run exists.
    VideoInterstitial.preload('defeat');
    if (this.stageDirector.currentStage.id === 'bloodstream') {
      VideoInterstitial.preload('bloodstreamToHeart');
    } else if (this.stageDirector.currentStage.id === 'heart') {
      VideoInterstitial.preload('victory');
    }

    if (!resume && SaveSystem.get().runs === 0) this.showIntroHint();

    this.scale.on('resize', this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.onResize, this);
      PlatformBridge.setBackHandler(null);

      // Phaser has already begun shutting down scene plugins before user SHUTDOWN listeners run.
      // Do not call cameras / physics / tweens / scene-object teardown here: those systems own
      // their cleanup and may already be unavailable. Clear only our plain references and
      // cross-scene registry state; create() rebuilds every gameplay subsystem on the next run.
      this.stageTransition = null;
      this.bossDefeatCeremony = null;
      this.introHint = null;
      this.cardiacHazard.reset();
      this.cardiacHazardVisual = null;
      this.transitionGeneration += 1;
      // Audio is not a Phaser subsystem, so it is safe (and required) to release it here:
      // every restart path must not leak the bed, layer nodes or the visibility listener.
      this.audio?.stop();
      Sfx.stopMusic();
      this.registry.remove('run');
      this.registry.remove('runResult');
      this.registry.remove('joy');
      this.registry.remove('aimJoy');
    });
  }

  private exitToMenu(): void {
    this.saveCheckpointNow();
    this.cancelStageTransition();
    this.audio.stop();
    Sfx.stopMusic();
    if (this.scene.isActive('UI') || this.scene.isPaused('UI')) this.scene.stop('UI');
    this.scene.stop();
    this.scene.start('Menu');
  }

  update(time: number, delta: number): void {
    this.maybeCompleteBossDefeatCeremony(time);
    if (this.stageDirector.phase === 'RUN_ENDED') return;
    // A stage transition is a frozen transaction: no movement, combat, wave spawns or stage clocks.
    // The UI scene stays live and either the guarded timer or tap commits exactly one reset.
    if (this.stageDirector.phase === 'STAGE_TRANSITION' || this.stageDirector.phase === 'BOSS_DEFEATED') return;
    if (this.hitStopped) {
      if (time < this.hitStopUntil) return;
      this.hitStopped = false;
      this.physics.world.resume();
    }
    this.runState.tick(delta);
    if (time >= this.visualDensityRefreshAt) {
      this.visualDensityRefreshAt = time + 90;
      this.visualEnemyDensity = this.enemies.countActive(true);
      this.vfx.setCombatDensity(this.visualEnemyDensity);
    }
    const st = this.runState.stage;
    const stage = this.stageDirector.currentStage;
    this.achievementCheckAcc += delta;
    if (this.achievementCheckAcc >= 500) {
      this.achievementCheckAcc = 0;
      this.captureAchievements(false, true);
    }

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

    if (len > 0.1) {
      this.trailAcc += delta;
      if (this.trailAcc >= JUICE.trailEveryMs) {
        this.trailAcc = 0;
        this.spawnTrail();
      }
    } else {
      this.trailAcc = JUICE.trailEveryMs;
    }

    if (time < this.player.hurtUntil) {
      this.player.setAlpha(Math.sin(time / 45) > 0 ? 0.55 : 1);
    } else {
      this.player.setAlpha(1);
      if (this.player.tintFill) this.player.clearTint();
    }

    this.tryFire(time);
    this.syncBlades(time);
    this.updateLegendarySystems(time, delta);

    if (st.novaLevel > 0) {
      this.novaAcc += delta;
      if (this.novaAcc >= this.runState.novaInterval) {
        this.novaAcc = 0;
        this.fireNova();
      }
    }

    if (st.regen > 0) st.hp = Math.min(st.maxHp, st.hp + (st.regen * delta) / 1000);

    // Keep the established frame order: firing resolves before timeline presentations and spawns.
    this.handleStageEvents(this.stageDirector.update(st.timeMs));
    this.updateAdaptiveAudio(delta);
    this.updateHeartbeatSignature(stage, st.timeMs);
    this.wave.update(delta);
    this.enemyHealth.update(time);
    this.updateCardiacLineHazard(time);
    this.hostCells.update(time, delta, st.timeMs);
    this.atmosphere.update(time, delta, st.timeMs, stage.durationMs);

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
      // Progression supersedes onboarding; never render tutorial copy beneath a mutation modal.
      this.dismissIntroHint(true);
      this.pendingChoices = rollRunChoices(
        this.runState,
        3,
        () => this.gameplayRng.next('progression')
      );
      this.awaitingChoice = true;
      if (this.pendingChoices.length > 0) this.trackComprehensionOnce('first_mutation_opened');
      this.queuedLevels -= 1;
    }

    this.checkpointAccMs = Math.min(2500, this.checkpointAccMs + delta);
    if (this.checkpointAccMs >= 2500 && this.saveCheckpointNow()) {
      this.checkpointAccMs = 0;
    }
  }

  spawnEnemy(kind: EnemyKind, x: number, y: number, elite: boolean): Enemy | null {
    const e = this.enemies.get(x, y) as Enemy | null;
    if (!e) return null;
    const isBoss = kind === 'boss';
    const stage = this.stageDirector.currentStage;
    const { hpScale, dmgScale } = difficultyForStage(stage, this.runState.stage.timeMs);
    const eliteModifier = elite
      ? pickEliteModifier(this.difficulty, () => this.gameplayRng.next('elite'))
      : null;
    e.activate(this, kind, x, y, {
      elite,
      hpScale: isBoss
        ? stage.difficulty.bossHpScale * this.difficulty.bossHpMultiplier
        : hpScale * this.difficulty.enemyHpMultiplier,
      dmgScale: isBoss
        ? stage.difficulty.bossDamageScale * this.difficulty.bossDamageMultiplier
        : dmgScale * this.difficulty.enemyDamageMultiplier,
      speedScale: isBoss
        ? this.difficulty.bossSpeedMultiplier
        : this.difficulty.enemySpeedMultiplier,
      eliteModifier,
      textureKey: isBoss ? stage.boss.textureKey : undefined,
      color: isBoss ? stage.theme.accentColor : undefined,
      bossBehavior: isBoss ? stage.boss.behavior : undefined,
      heartbeatMs: isBoss ? stage.theme.heartbeatMs : undefined,
    });
    if (kind === 'boss') {
      Sfx.play('boss');
      this.atmosphere.pulse(stage.theme.dangerColor, 0.32);
      this.shake(320, 0.008);
      const bossVideoId =
        stage.id === 'bloodstream'
          ? 'immunePrimeIntro'
          : stage.id === 'heart'
            ? 'cardiacTitanIntro'
            : undefined;
      this.getUiScene()?.showBossReveal(
        stage.boss.name,
        stage.boss.textureKey,
        stage.theme.accentColor,
        bossVideoId
      );
      PlatformBridge.haptic('heavy');
    } else if (elite) {
      Sfx.play('elite');
      this.atmosphere.pulse(COLORS.gold, 0.12);
    }
    return e;
  }

  onEnemyDied(e: Enemy): void {
    this.enemyHealth?.hide(e);
    const st = this.runState.stage;
    this.runState.recordKill(COMBO.windowMs);
    this.trackComprehensionOnce('first_enemy_kill', {
      kind: e.kind,
      elite: e.isElite,
      boss: e.isBoss,
    });
    this.captureAchievements(false, true);
    this.vfx.kill(e.x, e.y, e.color, e.isBoss ? 'boss' : e.isElite ? 'elite' : 'normal');
    if (e.isElite && e.eliteModifier === 'volatile') this.triggerVolatileElite(e);
    if (e.isElite || e.isBoss) {
      this.hitStop(this.impact.hitStopMs(e.isBoss ? 'boss_phase' : 'elite_death'));
      const s = JUICE.shakeEliteKill;
      this.shake(s.duration, s.intensity);
    }
    if (e.xpValue > 0) {
      // The first readable pickup teaches the mutation loop immediately instead of requiring
      // five scattered one-XP drops before the player sees the first choice.
      const value =
        st.kills === 1 ? Math.max(PROGRESSION.firstKillXpFloor, e.xpValue) : e.xpValue;
      this.spawnGem(e.x, e.y, value);
    }
    if (e.isBoss && this.wave.boss === e) {
      this.wave.boss = null;
      this.shake(400, 0.01);
      const defeatedStageId = this.stageDirector.currentStage.id;
      const ceremonyToken = ++this.transitionGeneration;
      this.awaitingChoice = false;
      this.pendingChoices = [];
      this.queuedLevels = 0;
      this.pendingEvolutionCeremony = null;
      this.pendingLegendaryCeremony = null;
      this.getUiScene()?.dismissProgressionForStageBoundary();
      this.runState.recordBossDefeated(this.stageDirector.currentStage.boss.id);
      this.handleStageEvents(this.stageDirector.bossDefeated());
      this.bossDefeatCeremony = {
        token: ceremonyToken,
        stageId: defeatedStageId,
        completeAt: this.time.now + 550,
      };
    }
  }

  private triggerVolatileElite(enemy: Enemy): void {
    const radius = 88;
    const x = enemy.x;
    const y = enemy.y;
    const blast = this.add
      .circle(x, y, 16, COLORS.red, 0.12)
      .setStrokeStyle(2.4, COLORS.red, 0.88)
      .setDepth(24)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: blast,
      scale: radius / 16,
      alpha: 0,
      duration: 320,
      ease: 'Quad.Out',
      onComplete: () => blast.destroy(),
    });
    this.atmosphere.pulse(COLORS.red, 0.1);

    const distance = Math.hypot(this.player.x - x, this.player.y - y);
    const now = this.time.now;
    if (distance > radius || now < this.player.hurtUntil) return;

    this.runState.stage.hp -= Math.max(6, enemy.dmg * 0.55);
    this.runState.resetNoDamage();
    this.player.markHurt(now);
    Sfx.play('hurt');
    PlatformBridge.haptic('medium');
    this.cameras.main.flash(110, 255, 60, 90);
    this.shake(120, 0.0045);

    if (
      this.runState.stage.hp <= 0 &&
      this.runState.hasLegendary('last-carrier') &&
      !this.lastCarrierUsed
    ) {
      this.activateLastCarrier();
      return;
    }
    if (this.runState.stage.hp <= 0) this.finish(false);
  }

  private onHostCellLysis(event: HostCellLysisEvent): void {
    this.runState.recordHostCellInfected();
    this.hostCellsCompletedThisRun += 1;
    const hadContextualHint = this.hostCellSlotsWithHint.delete(event.slotIndex);
    this.persistComprehensionPresentationState();
    if (
      this.firstRunComprehension &&
      this.hostCellsCompletedThisRun === 2 &&
      !hadContextualHint
    ) {
      this.trackComprehensionOnce('second_host_cell_completed_without_hint');
    }
    this.vfx.lysis(event.x, event.y, event.radius * 0.72, event.radius);
    this.atmosphere.pulse(COLORS.green, 0.14);
    Sfx.play('nova');
    PlatformBridge.haptic('medium');

    for (let i = 0; i < event.rna; i++) {
      const a =
        (i / event.rna) * Math.PI * 2 + this.gameplayRng.next('loot') * 0.35;
      const r = 18 + this.gameplayRng.next('loot') * 24;
      this.spawnGem(event.x + Math.cos(a) * r, event.y + Math.sin(a) * r, 1);
    }

    const list = this.enemies.getChildren() as Enemy[];
    const rhythmLysisMultiplier = this.time.now <= this.heartbeatOpportunityUntil ? 1.35 : 1;
    let enemiesHit = 0;
    let enemiesKilled = 0;
    for (const e of list) {
      if (!e.active) continue;
      const dx = e.x - event.x;
      const dy = e.y - event.y;
      const d = Math.hypot(dx, dy);
      if (d > event.radius + e.radius) continue;
      const dd = d || 1;
      this.vfx.hit(e.x, e.y, COLORS.green);
      const wasAlive = e.active && e.hp > 0;
      const dealt = e.takeDamage(
        event.damage * rhythmLysisMultiplier,
        (dx / dd) * 210,
        (dy / dd) * 210,
        'lysis'
      );
      if (dealt > 0) enemiesHit += 1;
      if (wasAlive && !e.active) enemiesKilled += 1;
    }
    if (this.runState.hasLegendary('lysis-chain')) this.triggerLysisChain(event, list);
    this.trackComprehensionOnce('first_lysis', {
      enemiesHit,
      enemiesKilled,
      rna: event.rna,
      stage: this.stageDirector.currentStage.id,
    });
  }

  private onHostCellInteraction(event: HostCellInteractionEvent): void {
    const analyticsEvent: Record<HostCellInteractionEvent['type'], ProductEvent> = {
      approach: 'host_cell_approached',
      enter: 'infection_started',
      exit: 'infection_interrupted',
      resume: 'infection_resumed',
    };
    this.trackComprehensionOnce(analyticsEvent[event.type], { progress: event.progress });

    if (!this.firstRunComprehension) return;
    if (event.type === 'resume') return;
    if (
      this.hostCellsCompletedThisRun > 0 &&
      (event.type === 'approach' || event.type === 'enter')
    ) {
      return;
    }
    if (this.hostCellHintEventsShown.has(event.type)) return;

    const copy = {
      approach: 'КЛЕТКА ОРГАНИЗМА · ЗАРАЗИ РЯДОМ',
      enter: 'ЗАРАЖЕНИЕ НАЧАЛОСЬ · ОСТАВАЙСЯ РЯДОМ',
      exit: 'ВНЕ ЗОНЫ · ЗАРАЖЕНИЕ ОСЛАБЕВАЕТ',
      resume: '',
    }[event.type];
    const ui = this.getUiScene();
    if (ui) {
      ui.showContextHint(copy);
      this.hostCellHintEventsShown.add(event.type);
      this.hostCellSlotsWithHint.add(event.slotIndex);
      this.persistComprehensionPresentationState();
    }
  }

  private onHostCellSpawn(slotIndex: number): void {
    if (this.hostCellSlotsWithHint.delete(slotIndex)) {
      this.persistComprehensionPresentationState();
    }
  }

  private hitStop(ms: number): void {
    if (ms <= 0 || this.stageDirector.phase === 'RUN_ENDED') return;
    const now = this.time.now;
    if (now < this.hitStopUntil + JUICE.hitStopMinGapMs) return;
    this.hitStopUntil = now + ms;
    this.hitStopped = true;
    this.physics.world.pause();
  }

  private showDamage(x: number, y: number, amount: number): void {
    if (amount <= 0) return;
    const now = this.time.now;
    const last = this.lastDmg;
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

  private spawnTrail(): void {
    const t = this.trail[this.trailCursor];
    this.trailCursor = (this.trailCursor + 1) % this.trail.length;
    this.tweens.killTweensOf(t);
    t.setPosition(this.player.x, this.player.y)
      .setVisible(true)
      .setAlpha(this.runState.hasEvolution('halo') ? 0.34 : 0.23)
      .setTint(this.runState.hasEvolution('halo') ? COLORS.gold : COLORS.white)
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
    t.setFontSize(crit ? 20 : 15);
    t.setColor(crit ? '#ffe066' : '#f2fbff');
    t.setStroke(crit ? '#5c3a00' : '#08131a', crit ? 4 : 3);
  }

  private showPlayerImpactCue(sourceX: number, sourceY: number): void {
    const cue = this.playerImpactCue ?? this.add.graphics().setDepth(29);
    this.playerImpactCue = cue;
    this.tweens.killTweensOf(cue);

    const dx = sourceX - this.player.x;
    const dy = sourceY - this.player.y;
    const distance = Math.hypot(dx, dy) || 1;
    const ux = dx / distance;
    const uy = dy / distance;

    cue.clear().setVisible(true).setAlpha(1).setScale(1).setPosition(this.player.x, this.player.y);
    cue.lineStyle(3, COLORS.red, 0.92);
    cue.strokeCircle(0, 0, 22);
    cue.lineStyle(5, COLORS.white, 0.7);
    cue.beginPath();
    cue.moveTo(ux * 24, uy * 24);
    cue.lineTo(ux * 43, uy * 43);
    cue.strokePath();
    cue.fillStyle(COLORS.red, 0.9);
    cue.fillCircle(ux * 47, uy * 47, 4);

    this.tweens.add({
      targets: cue,
      alpha: 0,
      scale: 1.24,
      duration: 230,
      ease: 'Quad.Out',
      onComplete: () => cue.setVisible(false),
    });
  }

  onGemCollected(value: number): void {
    Sfx.play('pickup');
    this.vfx.pickup(this.player.x, this.player.y);
    this.queuedLevels += this.runState.addXp(value);
    this.getUiScene()?.notifyRnaPickup(value);
    this.trackComprehensionOnce('first_rna_pickup', { value });
  }

  acceptChoiceClick(id: string): boolean {
    return this.awaitingChoice && this.pendingChoices.some((choice) => choice.id === id);
  }

  chooseUpgrade(id: string): boolean {
    const def = this.pendingChoices.find((c) => c.id === id);
    // Stale or fabricated ids must be a pure no-op: do not burn queued levels, pity,
    // reward state or progression RNG just because an old pointer event arrived late.
    if (!def) return this.awaitingChoice;
    const rewardChoice = this.legendaryRewardPending;
    def.apply(this.runState);
    this.trackComprehensionOnce('first_mutation_selected', {
      id: def.id,
      kind: def.kind ?? 'upgrade',
      archetype: def.legendaryId
        ? getLegendaryDefinition(def.legendaryId).archetype
        : def.evolutionId ?? def.family,
    });
    if (def.kind === 'evolution' && def.evolutionId) {
      this.pendingEvolutionCeremony = def.evolutionId;
      this.syncPlayerMutationSilhouette();
      this.atmosphere.pulse(COLORS.gold, 0.3);
    } else if (def.kind === 'legendary' && def.legendaryId) {
      this.pendingLegendaryCeremony = def.legendaryId;
      this.vfx.legendary(this.player.x, this.player.y, COLORS.gold);
      this.atmosphere.pulse(COLORS.gold, 0.34);
      this.shake(180, 0.004);
      this.hitStop(this.impact.hitStopMs('legendary_pick'));
      if (def.legendaryId === 'zero-point') this.zeroPointNextAt = this.time.now + 12_000;
    } else {
      this.runState.bump(id);
    }
    this.captureAchievements(false, false);
    Sfx.play('click');
    PlatformBridge.notify('success');
    if (rewardChoice) this.legendaryRewardPending = false;
    if (this.queuedLevels > 0) {
      this.queuedLevels -= 1;
      this.pendingChoices = rollRunChoices(
        this.runState,
        3,
        () => this.gameplayRng.next('progression')
      );
      return true;
    }
    this.awaitingChoice = false;
    this.pendingChoices = [];
    return false;
  }

  private syncPlayerMutationSilhouette(): void {
    const st = this.runState;
    this.player.setMutationState(
      st.hasEvolution('prism'),
      st.hasEvolution('halo'),
      st.hasEvolution('singularity')
    );
  }

  consumeEvolutionCeremony(): EvolutionId | null {
    const id = this.pendingEvolutionCeremony;
    this.pendingEvolutionCeremony = null;
    return id;
  }

  consumeLegendaryCeremony(): LegendaryId | null {
    const id = this.pendingLegendaryCeremony;
    this.pendingLegendaryCeremony = null;
    return id;
  }

  onPrimeMembraneBreak(boss: Enemy): void {
    if (
      !boss.active ||
      !boss.isBoss ||
      this.stageDirector.currentStage.id !== 'bloodstream'
    ) {
      return;
    }
    this.vfx.legendary(boss.x, boss.y, COLORS.green);
    this.atmosphere.pulse(COLORS.green, 0.2);
    this.shake(150, 0.005);
    PlatformBridge.haptic('heavy');
  }

  onBossPhaseChanged(boss: Enemy): void {
    if (!boss.active || !boss.isBoss) return;
    const stage = this.stageDirector.currentStage;
    this.atmosphere.pulse(stage.theme.dangerColor, 0.22);
    this.vfx.legendary(boss.x, boss.y, stage.theme.dangerColor);
    this.shake(220, 0.006);
    PlatformBridge.haptic('heavy');
  }

  triggerBossPressureWave(boss: Enemy, radius: number, damage: number): void {
    if (
      !boss.active ||
      !boss.isBoss ||
      this.stageDirector.phase !== 'BOSS_ACTIVE' ||
      this.stageDirector.currentStage.boss.behavior !== 'pressure-wave'
    ) {
      return;
    }

    const wave = this.add
      .circle(boss.x, boss.y, 24, COLORS.red, 0.035)
      .setStrokeStyle(boss.bossPhase === 2 ? 4 : 3, COLORS.red, 0.94)
      .setDepth(25)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: wave,
      scale: radius / 24,
      alpha: 0,
      duration: boss.bossPhase === 2 ? 360 : 430,
      ease: 'Quad.Out',
      onComplete: () => wave.destroy(),
    });
    this.atmosphere.pulse(COLORS.red, boss.bossPhase === 2 ? 0.24 : 0.16);
    this.shake(boss.bossPhase === 2 ? 180 : 130, boss.bossPhase === 2 ? 0.006 : 0.004);

    const distance = Math.hypot(this.player.x - boss.x, this.player.y - boss.y);
    const now = this.time.now;
    if (distance > radius || now < this.player.hurtUntil) return;

    this.runState.stage.hp -= Math.max(8, damage);
    this.runState.resetNoDamage();
    this.player.markHurt(now);
    Sfx.play('hurt');
    PlatformBridge.haptic('medium');
    this.cameras.main.flash(110, 255, 64, 92);
    if (
      this.runState.stage.hp <= 0 &&
      this.runState.hasLegendary('last-carrier') &&
      !this.lastCarrierUsed
    ) {
      this.activateLastCarrier();
      return;
    }
    if (this.runState.stage.hp <= 0) this.finish(false);
  }

  getEnemyPressureMultiplier(): number {
    if (this.stageDirector.currentStage.signatureMechanic !== 'heartbeat-pulse') return 1;
    if (this.time.now <= this.heartbeatProtectedUntil) return 1;
    return this.heartbeatPulse.pressureMultiplier;
  }

  getCombatVisualDensity(): number {
    return this.visualEnemyDensity;
  }

  private updateHeartbeatSignature(stage: StageDefinition, stageTimeMs: number): void {
    if (stage.signatureMechanic !== 'heartbeat-pulse') return;
    const bossActive =
      this.stageDirector.phase === 'BOSS_ACTIVE' && stage.boss.behavior === 'heartbeat-pulse';
    for (const event of this.heartbeatPulse.update(stageTimeMs, bossActive)) {
      this.handleHeartbeatPulseEvent(stage, event);
    }
  }

  private updateCardiacLineHazard(time: number): void {
    const stage = this.stageDirector.currentStage;
    const boss = this.wave.boss;
    const enabled =
      stage.id === 'heart' &&
      stage.boss.behavior === 'heartbeat-pulse' &&
      this.stageDirector.phase === 'BOSS_ACTIVE' &&
      Boolean(boss?.active && boss.bossPhase === 2);
    const timeUntilHeartbeatImpactMs =
      this.heartbeatPulse.debugState.nextImpactAtMs - this.runState.stage.timeMs;
    const canSchedule =
      this.heartbeatSafeIndicator === null &&
      time > this.heartbeatOpportunityUntil &&
      canScheduleCardiacLineHazardBeforeHeartbeat(
        timeUntilHeartbeatImpactMs,
        HEARTBEAT_PULSE_PROFILE.telegraphLeadMs
      );
    const halfLength = Math.hypot(this.scale.width, this.scale.height) / 2 + 180;

    const events = this.cardiacHazard.update(
      {
        nowMs: time,
        enabled,
        canSchedule,
        originX: this.player.x,
        originY: this.player.y,
        halfLength,
      },
      () => this.cardiacHazardRng.next('enemy-spawn')
    );

    for (const event of events) {
      if (event.type === 'telegraph') {
        this.showCardiacLineHazard(event.hazard);
      } else if (event.type === 'fire') {
        this.fireCardiacLineHazard(event.hazard);
      } else if (event.type === 'end') {
        this.clearCardiacLineHazardVisual(event.serial);
      } else {
        this.clearCardiacLineHazardVisual();
      }
    }
  }

  private showCardiacLineHazard(hazard: CardiacLineHazardSpec): void {
    this.clearCardiacLineHazardVisual();
    const danger = this.stageDirector.currentStage.theme.dangerColor;
    const warning = this.add
      .rectangle(
        hazard.centerX,
        hazard.centerY,
        hazard.halfLength * 2,
        hazard.warningHalfThickness * 2,
        danger,
        0.08
      )
      .setStrokeStyle(2.2, danger, 0.86)
      .setRotation(hazard.angle)
      .setDepth(25)
      .setBlendMode(Phaser.BlendModes.ADD);
    const beam = this.add
      .rectangle(
        hazard.centerX,
        hazard.centerY,
        hazard.halfLength * 2,
        hazard.beamHalfThickness * 2,
        0xffd6df,
        0.9
      )
      .setStrokeStyle(1.5, 0xffffff, 0.9)
      .setRotation(hazard.angle)
      .setDepth(27)
      .setVisible(false)
      .setBlendMode(Phaser.BlendModes.ADD);

    this.cardiacHazardVisual = { serial: hazard.serial, warning, beam };
    this.tweens.add({
      targets: warning,
      alpha: 0.34,
      duration: 170,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    });
    this.atmosphere.pulse(danger, 0.08);
  }

  private fireCardiacLineHazard(hazard: CardiacLineHazardSpec): void {
    const visual = this.cardiacHazardVisual;
    if (!visual || visual.serial !== hazard.serial) return;

    this.tweens.killTweensOf(visual.warning);
    visual.warning.setVisible(false);
    visual.beam.setVisible(true);
    this.atmosphere.pulse(this.stageDirector.currentStage.theme.dangerColor, 0.2);
    this.shake(85, 0.0035);
    PlatformBridge.haptic('light');

    const playerPadding = Math.max(this.player.displayWidth, this.player.displayHeight) * 0.28;
    if (
      !pointInsideCardiacLineHazard(
        this.player.x,
        this.player.y,
        hazard,
        hazard.beamHalfThickness,
        playerPadding
      ) ||
      this.time.now < this.player.hurtUntil
    ) {
      return;
    }

    this.runState.stage.hp -= hazard.damage * this.difficulty.bossDamageMultiplier;
    this.runState.resetNoDamage();
    this.player.markHurt(this.time.now);
    Sfx.play('hurt');
    PlatformBridge.haptic('medium');
    this.cameras.main.flash(100, 255, 70, 105);
    this.shake(130, 0.0055);

    if (
      this.runState.stage.hp <= 0 &&
      this.runState.hasLegendary('last-carrier') &&
      !this.lastCarrierUsed
    ) {
      this.activateLastCarrier();
      return;
    }
    if (this.runState.stage.hp <= 0) this.finish(false);
  }

  private resetCardiacLineHazard(): void {
    this.cardiacHazard.reset();
    this.clearCardiacLineHazardVisual();
  }

  private clearCardiacLineHazardVisual(serial?: number): void {
    const visual = this.cardiacHazardVisual;
    if (!visual || (serial !== undefined && visual.serial !== serial)) return;
    this.tweens.killTweensOf(visual.warning);
    visual.warning.destroy();
    visual.beam.destroy();
    this.cardiacHazardVisual = null;
  }

  /**
   * Throttled adaptive-audio tick. The enemy scan is the only O(n) part, so it runs at the
   * director's evaluation cadence while the director's own smoothing stays frame-rate independent.
   * Reads gameplay state only: no gameplay RNG is consumed and no timing value is changed.
   */
  private updateAdaptiveAudio(delta: number): void {
    this.audioAccMs += delta;
    if (this.audioAccMs < ADAPTIVE_AUDIO_TUNING.updateIntervalMs) return;
    const dtMs = this.audioAccMs;
    this.audioAccMs = 0;
    this.audio.update(this.collectDangerInput(), dtMs);
    this.registry.set('adaptiveAudio', this.audio.debugState);
  }

  private collectDangerInput(): DangerInput {
    const stage = this.stageDirector.currentStage;
    const st = this.runState.stage;
    const px = this.player.x;
    const py = this.player.y;
    const scanRadius = ADAPTIVE_AUDIO_TUNING.scanRadius;
    let totalWeight = 0;
    for (const enemy of this.enemies.getChildren() as Enemy[]) {
      if (!enemy.active || enemy.isBoss) continue;
      totalWeight += enemyThreatWeight(
        enemy.kind,
        enemy.isElite,
        Math.hypot(enemy.x - px, enemy.y - py),
        scanRadius
      );
    }
    const boss = this.wave.boss;
    const bossHpFraction = boss && boss.active && boss.maxHp > 0 ? clamp01(boss.hp / boss.maxHp) : 1;
    return {
      nearbyThreat: normalizeNearbyThreat(totalWeight),
      hpFraction: st.maxHp > 0 ? clamp01(st.hp / st.maxHp) : 1,
      bossActive: this.stageDirector.phase === 'BOSS_ACTIVE',
      bossHpFraction,
      stageOrder: stage.order,
    };
  }

  private handleHeartbeatPulseEvent(stage: StageDefinition, event: HeartbeatPulseEvent): void {
    if (event.type === 'heartbeat-telegraph') {
      this.audio.onHeartbeat('telegraph', event.bossActive);
      this.atmosphere.pulse(
        event.bossActive ? stage.theme.dangerColor : stage.theme.accentColor,
        event.bossActive ? 0.12 : 0.07
      );
      this.showHeartbeatTelegraph(stage, event.bossActive, event.impactAtMs);
      return;
    }
    if (event.type !== 'heartbeat-impact') return;
    // Audio beat fires on the real impact event, so the layer is aligned with gameplay timing.
    this.audio.onHeartbeat('impact', event.bossActive);
    this.atmosphere.heartbeatPulse(
      event.bossActive ? stage.theme.dangerColor : stage.theme.accentColor,
      event.bossActive ? 0.4 : 0.3
    );
    this.shake(event.bossActive ? 150 : 100, event.bossActive ? 0.0045 : 0.0026);
    PlatformBridge.haptic(event.bossActive ? 'medium' : 'light');

    const distanceToSafe = Math.hypot(
      this.player.x - this.heartbeatSafeX,
      this.player.y - this.heartbeatSafeY
    );
    const synchronized = distanceToSafe <= this.heartbeatSafeRadius;
    const pocket = heartSafePocketProfile(event.bossActive);
    this.heartbeatSafeIndicator?.destroy();
    this.heartbeatSafeIndicator = null;

    if (synchronized) {
      this.heartbeatProtectedUntil = this.time.now + pocket.protectedMs;
      this.heartbeatOpportunityUntil = this.time.now + pocket.opportunityMs;
      this.atmosphere.pulse(COLORS.green, 0.12);
      this.vfx.legendary(this.player.x, this.player.y, COLORS.green);
      PlatformBridge.haptic('light');
      if (this.runState.hasLegendary('myocardial-rhythm')) {
        this.heartbeatLegendaryWindowUntil =
          this.time.now + HEART_SAFE_POCKET.legendaryWindowMs;
        this.heartbeatLegendarySpent = false;
      }
    } else {
      this.heartbeatProtectedUntil = 0;
      this.heartbeatOpportunityUntil = 0;
      this.heartbeatLegendaryWindowUntil = 0;
      this.heartbeatLegendarySpent = false;
    }
  }

  private showHeartbeatTelegraph(
    stage: StageDefinition,
    bossActive: boolean,
    impactAtMs: number
  ): void {
    const color = bossActive ? stage.theme.dangerColor : stage.theme.accentColor;
    const rings = [
      this.add.circle(this.player.x, this.player.y, 28).setStrokeStyle(2.4, color, 0.92).setDepth(27),
      this.add.circle(this.player.x, this.player.y, 44).setStrokeStyle(1.8, COLORS.white, 0.68).setDepth(27),
      this.add.circle(this.player.x, this.player.y, 62).setStrokeStyle(1.2, color, 0.46).setDepth(27),
    ];
    rings[0].setScale(2.15).setAlpha(0.28);
    rings[1].setScale(1.75).setAlpha(0.22);
    rings[2].setScale(1.48).setAlpha(0.14);
    this.tweens.add({
      targets: rings,
      scale: 0.92,
      alpha: bossActive ? 0.86 : 0.68,
      duration: 620,
      ease: 'Quad.In',
      onComplete: () => rings.forEach((ring) => ring.destroy()),
    });

    // The beat now asks for a positional response: move into the marked diastole pocket.
    this.heartbeatSafeIndicator?.destroy();
    this.heartbeatBeatIndex += 1;
    const angle =
      ((impactAtMs * 0.00117 + this.heartbeatBeatIndex * 1.91) % (Math.PI * 2)) - Math.PI;
    const pocket = heartSafePocketProfile(bossActive);
    this.heartbeatSafeRadius = pocket.radius;
    this.heartbeatSafeX = this.player.x + Math.cos(angle) * pocket.offset;
    this.heartbeatSafeY = this.player.y + Math.sin(angle) * pocket.offset;
    this.heartbeatSafeIndicator = this.add
      .circle(this.heartbeatSafeX, this.heartbeatSafeY, this.heartbeatSafeRadius, COLORS.green, 0.08)
      .setStrokeStyle(3, COLORS.green, 0.9)
      .setDepth(26);
    this.tweens.add({
      targets: this.heartbeatSafeIndicator,
      scale: 0.82,
      alpha: 0.84,
      duration: 620,
      ease: 'Quad.In',
    });
  }

  private maybeCompleteBossDefeatCeremony(now: number): void {
    const ceremony = this.bossDefeatCeremony;
    if (!ceremony || now < ceremony.completeAt) return;
    this.bossDefeatCeremony = null;
    if (this.transitionGeneration !== ceremony.token) return;
    if (this.stageDirector.phase !== 'BOSS_DEFEATED') return;
    if (this.stageDirector.currentStage.id !== ceremony.stageId) return;
    this.handleStageEvents(this.stageDirector.completeBossDefeat());
  }

  private beginStageTransition(from: StageDefinition, to: StageDefinition): void {
    if (this.stageDirector.phase !== 'STAGE_TRANSITION' || this.stageTransition) return;

    const token = ++this.transitionGeneration;
    const transaction = {
      token,
      from,
      to,
      timer: null as Phaser.Time.TimerEvent | null,
      committing: false,
      earliestCommitAt: this.time.now + 350,
    };
    this.stageTransition = transaction;

    this.dismissIntroHint(true);
    this.awaitingChoice = false;
    this.pendingChoices = [];
    this.queuedLevels = 0;
    this.pendingEvolutionCeremony = null;
    this.registry.set('joy', { x: 0, y: 0 });
    (this.player.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
    this.aimMarker.setVisible(false);
    this.physics.world.pause();

    const videoAttempted =
      this.getUiScene()?.showStageTransition(
        from.name,
        to.name,
        to.theme.accentColor,
        () => this.requestStageTransitionCommit(token),
        from.id === 'bloodstream' && to.id === 'heart' ? 'bloodstreamToHeart' : undefined
      ) ?? false;
    // The UI calls the same guarded commit callback when video ends, is skipped, or falls back.
    // This timer is only a hard lifecycle guard; procedural fallback keeps the original 2.4 s pace.
    transaction.timer = this.time.delayedCall(videoAttempted ? 8500 : 2400, () =>
      this.commitStageTransition(token)
    );
  }

  private requestStageTransitionCommit(token: number): void {
    const transaction = this.stageTransition;
    if (!transaction || transaction.token !== token || transaction.committing) return;
    const remaining = transaction.earliestCommitAt - this.time.now;
    if (remaining > 0) {
      transaction.timer?.remove(false);
      transaction.timer = this.time.delayedCall(remaining, () => this.commitStageTransition(token));
      return;
    }
    this.commitStageTransition(token);
  }

  private commitStageTransition(token: number): void {
    const transaction = this.stageTransition;
    if (!transaction || transaction.token !== token || transaction.committing) return;
    if (this.stageDirector.phase !== 'STAGE_TRANSITION') return;

    transaction.committing = true;
    transaction.timer?.remove(false);
    transaction.timer = null;
    this.stageDirector.completeTransition();

    if (this.stageDirector.currentStage.id !== transaction.to.id) {
      this.stageTransition = null;
      this.physics.world.resume();
      this.finish(false, 'abandoned');
      return;
    }

    this.resetStageWorld(transaction.to);
    if (transaction.to.id === 'heart') VideoInterstitial.preload('victory');
    if (transaction.from.id === 'bloodstream' && transaction.to.id === 'heart') {
      const rewardChoices = guaranteedLegendaryChoices(
        this.runState,
        2,
        () => this.gameplayRng.next('progression')
      );
      if (rewardChoices.length > 0) {
        this.pendingChoices = rewardChoices;
        this.awaitingChoice = true;
        this.legendaryRewardPending = true;
      }
    }
    this.stageTransition = null;
    this.getUiScene()?.hideStageTransition();
    const stageStartEvents = this.stageDirector.startStage();
    if (stageStartEvents.length === 0) {
      this.physics.world.resume();
      this.finish(false, 'abandoned');
      return;
    }
    this.handleStageEvents(stageStartEvents);
    this.physics.world.resume();
    PlatformBridge.haptic('medium');
    this.registry.set('run', this.snapshot());
  }

  private resetStageWorld(nextStage: StageDefinition): void {
    this.milestones.reset();
    this.enemyHealth.clear();
    this.getUiScene()?.discardContextHint();
    this.hostCells.resetStage();
    this.resetCardiacLineHazard();
    this.wave.boss = null;

    for (const enemy of this.enemies.getChildren() as Enemy[]) {
      if (enemy.active) enemy.deactivateForStageReset();
    }
    for (const bullet of this.bullets.getChildren() as Bullet[]) {
      if (bullet.active) bullet.deactivateForStageReset();
    }
    for (const gem of this.gems.getChildren() as Gem[]) {
      if (gem.active) gem.deactivateForStageReset();
    }

    this.runState.resetStageProgression(nextStage);
    this.queuedLevels = 0;
    this.awaitingChoice = false;
    this.pendingChoices = [];
    this.legendaryRewardPending = false;
    this.pendingEvolutionCeremony = null;
    this.novaAcc = 0;
    this.nextFireAt = this.time.now + 250;
    this.achievementCheckAcc = 0;
    this.hitStopUntil = 0;
    this.hitStopped = false;
    this.zeroPointUntil = 0;
    this.zeroPointNextAt = this.runState.hasLegendary('zero-point') ? this.time.now + 12_000 : 0;
    this.coreMarks = new WeakMap<Enemy, CoreMark>();
    this.heartbeatLegendaryWindowUntil = 0;
    this.heartbeatLegendarySpent = false;
    this.heartbeatSafeIndicator?.destroy();
    this.heartbeatSafeIndicator = null;
    this.heartbeatProtectedUntil = 0;
    this.heartbeatOpportunityUntil = 0;
    this.heartbeatBeatIndex = 0;
    this.lastDmg = null;
    this.lastDmgAt = 0;
    this.trailCursor = 0;
    this.trailAcc = 0;

    for (const text of this.dmgTexts) {
      this.tweens.killTweensOf(text);
      text.setVisible(false).setActive(false).setAlpha(0);
    }
    for (const trail of this.trail) {
      this.tweens.killTweensOf(trail);
      trail.setVisible(false).setAlpha(0);
    }
    for (const blade of this.blades) {
      this.tweens.killTweensOf(blade);
      blade.setVisible(false);
    }
    this.haloRing?.setVisible(false);

    const centerX = this.scale.width / 2;
    const centerY = this.scale.height / 2;
    this.player.setMutationState(false, false, false);
    this.player.hurtUntil = 0;
    this.player.clearTint().setAlpha(1).setRotation(0).setScale(0.9).setPosition(centerX, centerY);
    (this.player.body as Phaser.Physics.Arcade.Body).reset(centerX, centerY);
    this.aimMarker.setVisible(false);
    this.playerBar.clear();
    this.registry.set('joy', { x: 0, y: 0 });
  }

  private restoreCheckpointRuntime(checkpoint: RunCheckpointData): void {
    const stage = this.stageDirector.currentStage;
    this.cameras.main.setBackgroundColor(stage.theme.backgroundColor);
    this.atmosphere.setStage(stage);
    this.wave.restore(stage, checkpoint.wave);
    this.hostCells.restore(checkpoint.hostCells);

    const { playerX, playerY } = checkpoint.runtime;
    this.player.setMutationState(false, false, false);
    this.player.setPosition(playerX, playerY).clearTint().setAlpha(1);
    this.player.hurtUntil = 0;
    (this.player.body as Phaser.Physics.Arcade.Body).reset(playerX, playerY);
    this.syncPlayerMutationSilhouette();

    this.lastCarrierUsed = checkpoint.runtime.lastCarrierUsed;
    this.heartbeatBeatIndex = checkpoint.runtime.heartbeatBeatIndex;
    this.zeroPointNextAt = this.runState.hasLegendary('zero-point')
      ? this.time.now + Math.max(250, checkpoint.runtime.zeroPointNextInMs)
      : 0;
  }

  saveCheckpointNow(): boolean {
    // Option 1: a daily run is never checkpointed (its ticket is reusable, the run is not resumable).
    if (!shouldCheckpoint(this.dailyRun)) return false;
    if (
      !isCheckpointSafePhase(this.stageDirector.phase) ||
      this.awaitingChoice ||
      this.legendaryRewardPending ||
      this.pendingEvolutionCeremony !== null ||
      this.pendingLegendaryCeremony !== null ||
      this.stageTransition !== null ||
      this.bossDefeatCeremony !== null ||
      this.hitStopped ||
      this.time.now < this.zeroPointUntil
    ) {
      return false;
    }

    const heartbeat = this.heartbeatPulse.snapshot();
    if (
      heartbeat.telegraphedImpactAtMs !== null ||
      heartbeat.pressureUntilMs !== null ||
      heartbeat.bossWasActive
    ) {
      return false;
    }

    const checkpoint: RunCheckpointData = {
      schemaVersion: RUN_CHECKPOINT_SCHEMA_VERSION,
      rulesetVersion: SCORE_RULESET_VERSION,
      campaignVersion: SCORE_CAMPAIGN_VERSION,
      savedAtEpochMs: Date.now(),
      runSeed: this.runSeed,
      difficultyId: this.difficulty.id,
      controlMode: this.controlMode,
      resumed: this.resumed,
      director: this.stageDirector.snapshot(),
      runState: this.runState.snapshotForCheckpoint(),
      rng: this.gameplayRng.snapshot(),
      wave: this.wave.snapshot(),
      heartbeat,
      hostCells: this.hostCells.snapshot(),
      runtime: {
        playerX: this.player.x,
        playerY: this.player.y,
        lastCarrierUsed: this.lastCarrierUsed,
        heartbeatBeatIndex: this.heartbeatBeatIndex,
        zeroPointNextInMs:
          this.zeroPointNextAt > this.time.now ? this.zeroPointNextAt - this.time.now : 0,
      },
    };
    return RunCheckpoint.save(checkpoint);
  }

  private cancelStageTransition(resumePhysics = true): void {
    const transaction = this.stageTransition;
    if (transaction) {
      transaction.timer?.remove(false);
      transaction.timer = null;
    }
    this.stageTransition = null;
    this.bossDefeatCeremony = null;
    this.transitionGeneration += 1;
    this.getUiScene()?.hideStageTransition();
    // During Scene shutdown the Arcade Physics plugin may already have released its world.
    // Resuming is only needed for live gameplay cancellation, never during teardown.
    if (resumePhysics) this.physics.world.resume();
  }

  private getUiScene(): UIScene | null {
    if (!this.scene.isActive('UI') && !this.scene.isPaused('UI')) return null;
    return this.scene.get('UI') as UIScene;
  }

  showEnemyHealth(enemy: Enemy): void {
    this.enemyHealth?.show(enemy, this.time.now);
  }

  hideEnemyHealth(enemy: Enemy): void {
    this.enemyHealth?.hide(enemy);
  }

  private restoreComprehensionPresentationState(): void {
    this.comprehensionEventsSent = new Set<ProductEvent>();
    this.hostCellHintEventsShown = new Set<HostCellHintType>();
    try {
      const raw = localStorage.getItem(COMPREHENSION_STATE_KEY);
      if (!raw) return;
      const stored = JSON.parse(raw) as Partial<ComprehensionPresentationState>;
      if (stored.runSeed !== this.runSeed) {
        localStorage.removeItem(COMPREHENSION_STATE_KEY);
        return;
      }
      if (Array.isArray(stored.events)) {
        for (const event of stored.events) {
          if (typeof event === 'string') this.comprehensionEventsSent.add(event as ProductEvent);
        }
      }
      if (Array.isArray(stored.hostCellHints)) {
        for (const hint of stored.hostCellHints) {
          if (hint === 'approach' || hint === 'enter' || hint === 'exit') {
            this.hostCellHintEventsShown.add(hint);
          }
        }
      }
      if (Array.isArray(stored.hostCellSlotsWithHint)) {
        for (const slotIndex of stored.hostCellSlotsWithHint) {
          if (Number.isInteger(slotIndex) && slotIndex >= 0 && slotIndex < 6) {
            this.hostCellSlotsWithHint.add(slotIndex);
          }
        }
      }
    } catch {
      try {
        localStorage.removeItem(COMPREHENSION_STATE_KEY);
      } catch {
        // Storage can be unavailable in hardened webviews; gameplay must remain unaffected.
      }
    }
  }

  private persistComprehensionPresentationState(): void {
    try {
      const state: ComprehensionPresentationState = {
        runSeed: this.runSeed,
        events: [...this.comprehensionEventsSent],
        hostCellHints: [...this.hostCellHintEventsShown],
        hostCellSlotsWithHint: [...this.hostCellSlotsWithHint],
      };
      localStorage.setItem(COMPREHENSION_STATE_KEY, JSON.stringify(state));
    } catch {
      // Presentation telemetry must never affect gameplay if storage is unavailable.
    }
  }

  private clearComprehensionPresentationState(): void {
    try {
      localStorage.removeItem(COMPREHENSION_STATE_KEY);
    } catch {
      // Ignore storage failures during run teardown.
    }
  }

  private trackComprehensionOnce(event: ProductEvent, props: ProductEventProps = {}): void {
    if (this.comprehensionEventsSent.has(event)) return;
    this.comprehensionEventsSent.add(event);
    this.persistComprehensionPresentationState();
    void trackProductEvent(event, PlatformBridge, props);
  }

  private handleStageEvents(events: readonly StageDirectorEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case 'stage-started':
          if (
            this.runState.stage.id !== event.stage.id ||
            this.runState.stage.order !== event.stage.order
          ) {
            this.runState.resetStageProgression(event.stage);
          }
          this.cameras.main.setBackgroundColor(event.stage.theme.backgroundColor);
          this.atmosphere.setStage(event.stage);
          this.heartbeatPulse.reset();
          this.wave.startStage(event.stage);
          this.audio.setStage(event.stage.order, event.stage.theme.heartbeatMs);
          break;
        case 'milestone':
          this.milestones.show(event.milestone);
          break;
        case 'boss-spawn-requested':
          if (event.stage.id === 'bloodstream') {
            this.hostCells.ensureOpportunityNearPlayer();
          }
          if (!this.wave.spawnBoss()) {
            this.stageDirector.retryBossSpawn();
            break;
          }
          this.audio.onBossSpawn();
          break;
        case 'run-ended':
          this.finish(event.reason === 'campaign-complete', event.reason);
          break;
        case 'boss-warning': {
          this.audio.onBossWarning();
          this.atmosphere.pulse(event.stage.theme.dangerColor, 0.28);
          const bossVideoId =
            event.stage.id === 'bloodstream'
              ? 'immunePrimeIntro'
              : event.stage.id === 'heart'
                ? 'cardiacTitanIntro'
                : undefined;
          if (bossVideoId) VideoInterstitial.preload(bossVideoId);
          PlatformBridge.haptic('medium');
          break;
        }
        case 'boss-defeated':
          // Kill VFX/hit-stop are emitted by onEnemyDied; the director event owns lifecycle only.
          break;
        case 'stage-transition-requested':
          this.audio.onStageTransition();
          this.beginStageTransition(event.from, event.to);
          break;
      }
    }
  }

  finish(win: boolean, reason: RunEndReason = win ? 'campaign-complete' : 'defeat'): void {
    if (this.registry.get('runResult')) return;
    if (this.stageDirector.phase !== 'RUN_ENDED') this.stageDirector.endRun(reason);
    this.resetCardiacLineHazard();
    RunCheckpoint.clear();
    this.clearComprehensionPresentationState();
    this.runState.captureStageBuild();
    const run = this.runState.run;
    const stage = this.runState.stage;
    const evolutions = [...run.evolutionsSeen];
    const boss1ClearMs = run.bossClearTimesMs['immune-prime'] ?? 0;
    const records = SaveSystem.recordRun(
      win,
      run.timeMs,
      run.kills,
      run.highestLevel,
      evolutions,
      {
        boss1ClearMs,
        legendaryIds: [...run.legendaryIds],
        difficultyId: this.difficulty.id,
      },
      this.difficulty.id === 'standard' && !this.resumed
    );
    this.captureAchievements(true, false);
    this.milestones.reset();
    this.registry.set('run', this.snapshot());
    const result: RunResult = {
      win,
      reason,
      difficultyId: this.difficulty.id,
      runSeed: this.runSeed,
      controlMode: this.controlMode,
      resumed: this.resumed,
      timeMs: run.timeMs,
      kills: run.kills,
      hostCellsInfected: run.hostCellsInfected,
      level: stage.level,
      highestLevel: run.highestLevel,
      comboBest: run.comboBest,
      stageId: stage.id,
      stageOrder: stage.order,
      bossesDefeated: run.bossesDefeated,
      boss1ClearMs,
      stacks: { ...stage.stacks },
      evolutions,
      legendaryIds: [...run.legendaryIds],
      stageBuilds: Object.fromEntries(
        Object.entries(run.stageBuilds).map(([id, build]) => [
          id,
          build
            ? {
                level: build.level,
                stacks: { ...build.stacks },
                evolutions: [...build.evolutions],
              }
            : build,
        ])
      ),
      newAchievements: [...this.newAchievements],
      records,
    };
    this.registry.set('runResult', result);
    this.audio.onRunEnd(win);
    Sfx.play(win ? 'victory' : 'gameover');
    PlatformBridge.notify(win ? 'success' : 'error');
    this.cameras.main.resetFX();
    this.scene.pause();
  }

  private tryFire(time: number): void {
    const target = this.preferredEnemy(WEAPON.range);
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
    const n = this.runState.stage.projectiles;
    const spread = (WEAPON.spreadDeg * Math.PI) / 180;
    const prism = this.runState.hasEvolution('prism');
    const rhythmDamageMultiplier = time <= this.heartbeatOpportunityUntil ? 1.18 : 1;
    for (let i = 0; i < n; i++) {
      const a = ang + (i - (n - 1) / 2) * spread;
      const b = this.bullets.get(this.player.x, this.player.y) as Bullet | null;
      if (b) {
        b.fire(
          time,
          a,
          this.runState.bulletDamage * rhythmDamageMultiplier,
          this.runState.bulletPierce,
          prism
        );
      }
    }
  }

  private preferredEnemy(range: number): Enemy | null {
    const aim = this.registry.get('aimJoy') as { x: number; y: number } | undefined;
    const mag = aim ? Math.hypot(aim.x, aim.y) : 0;
    if (!aim || mag < 0.18) return this.nearestEnemy(range);

    const ax = aim.x / mag;
    const ay = aim.y / mag;
    let best: Enemy | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const e of this.enemies.getChildren() as Enemy[]) {
      if (!e.active) continue;
      const dx = e.x - this.player.x;
      const dy = e.y - this.player.y;
      const d = Math.hypot(dx, dy);
      if (d <= 0 || d >= range) continue;
      const dot = (dx / d) * ax + (dy / d) * ay;
      // Right stick expresses a broad priority sector, not pixel-perfect manual aiming.
      if (dot < 0.28) continue;
      const threatBias = e.isBoss ? 0.16 : e.isElite ? 0.08 : 0;
      const score = dot * 2.2 - (d / range) * 0.48 + threatBias;
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }

    return best ?? this.nearestEnemy(range);
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
    const want = st.stage.orbitBlades;
    const halo = st.hasEvolution('halo');
    while (this.blades.length < want) {
      this.blades.push(this.add.image(this.player.x, this.player.y, 'blade').setDepth(12));
    }

    if (halo && want > 0) {
      if (!this.haloRing) {
        this.haloRing = this.add
          .circle(this.player.x, this.player.y, ORBIT.radius)
          .setStrokeStyle(2, COLORS.gold, 0.52)
          .setDepth(11)
          .setBlendMode(Phaser.BlendModes.ADD);
      }
      this.haloRing
        .setVisible(true)
        .setPosition(this.player.x, this.player.y)
        .setAlpha(0.42 + Math.sin(now / 110) * 0.15);
    } else {
      this.haloRing?.setVisible(false);
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
      b.setVisible(true)
        .setPosition(
          this.player.x + Math.cos(a) * ORBIT.radius,
          this.player.y + Math.sin(a) * ORBIT.radius
        )
        .setRotation(a + Math.PI / 2)
        .setTint(halo ? COLORS.gold : COLORS.white)
        .setBlendMode(halo ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL)
        .setScale(halo ? 1.22 : 1);
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
          this.vfx.hit(e.x, e.y, halo ? COLORS.gold : e.color);
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
    const singularity = st.hasEvolution('singularity');
    Sfx.play('nova');
    PlatformBridge.haptic('light');
    if (singularity) this.vfx.singularity(this.player.x, this.player.y, st.novaRadius);
    else this.vfx.nova(this.player.x, this.player.y, st.novaRadius);
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

  private onBulletHit = (obj1: unknown, obj2: unknown): void => {
    const b = obj1 as Bullet;
    const e = obj2 as Enemy;
    if (!b.active || !e.active) return;
    if (b.lastHit === e && this.time.now - b.lastHitAt < 220) return;
    b.lastHit = e;
    b.lastHitAt = this.time.now;
    const bv = (b.body as Phaser.Physics.Arcade.Body).velocity;
    const vm = Math.hypot(bv.x, bv.y) || 1;
    let damage = this.applyCorePredator(e, b.damage);
    if (
      e.isBoss &&
      this.stageDirector.currentStage.id === 'heart' &&
      this.time.now <= this.heartbeatOpportunityUntil
    ) {
      damage *= 1.35;
    }
    const rhythmBurst = this.consumeMyocardialRhythm();
    this.vfx.hit(e.x, e.y, b.prism ? COLORS.gold : e.color);
    const dealtDamage = e.takeDamage(damage, (bv.x / vm) * 130, (bv.y / vm) * 130);
    if (dealtDamage > 0) {
      this.trackComprehensionOnce('first_enemy_hit', {
        kind: e.kind,
        elite: e.isElite,
        boss: e.isBoss,
      });
    }
    Sfx.play('hit');
    this.showDamage(e.x, e.y, dealtDamage);
    this.trySplitProjectile(b, bv);
    if (rhythmBurst) this.triggerRhythmBurst(e, dealtDamage);
    if (b.pierceLeft > 0) b.pierceLeft -= 1;
    else b.disableBody(true, true);
  };

  private onPlayerHit = (obj1: unknown, obj2: unknown): void => {
    const e = obj2 as Enemy;
    if (!e.active || this.stageDirector.phase === 'RUN_ENDED') return;
    const now = this.time.now;
    if (now < this.player.hurtUntil) return;
    this.runState.stage.hp -= e.dmg;
    this.runState.resetNoDamage();
    this.player.markHurt(now);
    Sfx.play('hurt');
    PlatformBridge.haptic('medium');
    this.cameras.main.flash(140, 255, 60, 100);
    const s = JUICE.shakeHurt;
    this.shake(s.duration, s.intensity);
    this.hitStop(this.impact.hitStopMs('critical_hit'));
    this.showPlayerImpactCue(e.x, e.y);
    const dx = e.x - this.player.x;
    const dy = e.y - this.player.y;
    const d = Math.hypot(dx, dy) || 1;
    e.takeDamage(0, (dx / d) * 240, (dy / d) * 240);
    if (
      this.runState.stage.hp <= 0 &&
      this.runState.hasLegendary('last-carrier') &&
      !this.lastCarrierUsed
    ) {
      this.activateLastCarrier();
      return;
    }
    if (this.runState.stage.hp <= 0) this.finish(false);
  };

  private updateLegendarySystems(time: number, delta: number): void {
    if (!this.runState.hasLegendary('zero-point')) {
      this.zeroPointUntil = 0;
      return;
    }
    if (this.zeroPointNextAt <= 0) this.zeroPointNextAt = time + 12_000;
    if (time >= this.zeroPointNextAt && time >= this.zeroPointUntil) {
      if (this.beginZeroPoint(time)) this.zeroPointNextAt = time + 12_000;
      else this.zeroPointNextAt = time + 1_000;
    }
    if (time < this.zeroPointUntil) this.applyZeroPointPull(delta);
  }

  private beginZeroPoint(time: number): boolean {
    let target: Enemy | null = null;
    let best = Number.POSITIVE_INFINITY;
    for (const e of this.enemies.getChildren() as Enemy[]) {
      if (!e.active || e.isBoss) continue;
      const d = Math.hypot(e.x - this.player.x, e.y - this.player.y);
      if (d < best) {
        best = d;
        target = e;
      }
    }
    if (!target) return false;
    this.zeroPointX = target.x;
    this.zeroPointY = target.y;
    this.zeroPointUntil = time + 2_500;
    this.vfx.singularity(this.zeroPointX, this.zeroPointY, 170);
    this.atmosphere.pulse(COLORS.purple, 0.18);
    return true;
  }

  private applyZeroPointPull(delta: number): void {
    const force = Math.min(26, Math.max(3, delta * 0.7));
    for (const e of this.enemies.getChildren() as Enemy[]) {
      if (!e.active || e.isBoss) continue;
      const dx = this.zeroPointX - e.x;
      const dy = this.zeroPointY - e.y;
      const d = Math.hypot(dx, dy);
      if (d <= 1 || d > 190) continue;
      e.applyKnock((dx / d) * force, (dy / d) * force);
    }
  }

  private trySplitProjectile(source: Bullet, velocity: { x: number; y: number }): void {
    if (
      !this.runState.hasLegendary('split-geometry') ||
      source.splitUsed ||
      source.generation >= 2
    ) {
      return;
    }
    source.splitUsed = true;
    const angle = Math.atan2(velocity.y, velocity.x);
    const offset = (32 * Math.PI) / 180;
    for (let i = 0; i < 2; i++) {
      const child = this.bullets.get(source.x, source.y) as Bullet | null;
      if (!child) break;
      child.fire(
        this.time.now,
        angle + (i === 0 ? -offset : offset),
        source.damage * 0.45,
        0,
        true,
        source.generation + 1
      );
    }
  }

  private applyCorePredator(target: Enemy, baseDamage: number): number {
    if (!this.runState.hasLegendary('core-predator') || (!target.isElite && !target.isBoss)) {
      return baseDamage;
    }
    const now = this.time.now;
    let mark = this.coreMarks.get(target);
    if (!mark || mark.serial !== target.spawnSerial || now - mark.lastHitAt > 1_600) {
      mark = { serial: target.spawnSerial, hits: 0, lastHitAt: now, windowUntil: 0 };
    }
    mark.lastHitAt = now;
    if (now < mark.windowUntil) {
      this.coreMarks.set(target, mark);
      return baseDamage * 1.75;
    }
    mark.hits += 1;
    if (mark.hits >= 4) {
      mark.hits = 0;
      mark.windowUntil = now + 1_500;
      this.vfx.legendary(target.x, target.y, COLORS.red);
      this.atmosphere.pulse(COLORS.red, 0.08);
    }
    this.coreMarks.set(target, mark);
    return baseDamage;
  }

  private consumeMyocardialRhythm(): boolean {
    if (
      !this.runState.hasLegendary('myocardial-rhythm') ||
      this.runState.stage.id !== 'heart' ||
      this.heartbeatLegendarySpent ||
      this.time.now > this.heartbeatLegendaryWindowUntil
    ) {
      return false;
    }
    this.heartbeatLegendarySpent = true;
    return true;
  }

  private triggerRhythmBurst(target: Enemy, damage: number): void {
    const x = target.x;
    const y = target.y;
    const radius = 92;
    this.vfx.legendary(x, y, this.stageDirector.currentStage.theme.accentColor);
    for (const e of this.enemies.getChildren() as Enemy[]) {
      if (!e.active || e === target) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      const d = Math.hypot(dx, dy);
      if (d > radius + e.radius) continue;
      const dd = d || 1;
      e.takeDamage(damage, (dx / dd) * 110, (dy / dd) * 110);
    }
  }

  private triggerLysisChain(event: HostCellLysisEvent, list: Enemy[]): void {
    const candidates = list
      .filter((e) => e.active && Math.hypot(e.x - event.x, e.y - event.y) > event.radius + e.radius)
      .sort(
        (a, b) =>
          Math.hypot(a.x - event.x, a.y - event.y) - Math.hypot(b.x - event.x, b.y - event.y)
      )
      .slice(0, 2);
    candidates.forEach((target, index) => {
      const serial = target.spawnSerial;
      this.time.delayedCall(140 + index * 80, () => {
        if (!target.active || target.spawnSerial !== serial) return;
        this.vfx.hit(target.x, target.y, COLORS.green);
        target.takeDamage(event.damage * 0.3);
      });
    });
  }

  private activateLastCarrier(): void {
    this.lastCarrierUsed = true;
    const st = this.runState.stage;
    st.hp = 1;
    st.xp = Math.floor(st.xp * 0.75);
    for (const enemy of this.enemies.getChildren() as Enemy[]) {
      if (enemy.active && !enemy.isBoss) enemy.deactivateForStageReset();
    }
    this.vfx.legendary(this.player.x, this.player.y, COLORS.green);
    this.atmosphere.pulse(COLORS.green, 0.4);
    this.cameras.main.flash(180, 120, 255, 160);
    this.shake(260, 0.009);
    this.player.setMutationState(true, true, true);
    this.time.delayedCall(8_000, () => {
      if (!this.player.active) return;
      this.syncPlayerMutationSilhouette();
    });
  }

  private shake(duration: number, intensity: number): void {
    if (this.impact.allowCameraShake(this.time.now)) {
      this.cameras.main.shake(duration, intensity);
    }
  }

  private onGemTouch = (obj1: unknown, obj2: unknown): void => {
    (obj2 as Gem).collect();
  };

  private spawnGem(x: number, y: number, value: number): void {
    const g = this.gems.get(x, y) as Gem | null;
    if (g) {
      g.activate(this, x, y, value);
      return;
    }
    const first = this.gems.getFirstAlive() as Gem | null;
    if (first) first.value += value;
  }

  private captureAchievements(runRecorded: boolean, showToast: boolean): void {
    const unlocked = evaluateAchievements(this.runState, runRecorded);
    for (const id of unlocked) {
      if (!this.newAchievements.includes(id)) this.newAchievements.push(id);
      if (showToast) this.showAchievementToast(id);
    }
  }

  private showAchievementToast(id: AchievementId): void {
    const W = this.scale.width;
    const H = this.scale.height;
    const def = getAchievementDef(id);
    const y = Math.max(155, H * 0.25) + ((this.newAchievements.length - 1) % 2) * 62;
    const c = this.add.container(W / 2, y).setScrollFactor(0).setDepth(44).setAlpha(0);
    const panelW = Math.min(W - 36, 340);
    const panel = this.add
      .rectangle(0, 0, panelW, 52, 0x101522, 0.94)
      .setStrokeStyle(1.5, COLORS.gold, 0.82);
    const title = this.add
      .text(-panelW / 2 + 14, -16, 'ДОСТИЖЕНИЕ', {
        fontFamily: FONT,
        fontSize: '9px',
        fontStyle: 'bold',
        color: '#ffe066',
      })
      .setResolution(2);
    const name = this.add
      .text(-panelW / 2 + 14, 0, def.name, {
        fontFamily: FONT,
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#e8f4ff',
      })
      .setResolution(2);
    c.add([panel, title, name]);
    Sfx.play('levelup');
    PlatformBridge.haptic('light');
    this.tweens.add({
      targets: c,
      alpha: 1,
      y: y + 6,
      duration: 160,
      yoyo: true,
      hold: 900,
      onComplete: () => c.destroy(),
    });
  }

  private showIntroHint(): void {
    this.dismissIntroHint(true);
    const W = this.scale.width;
    const H = this.scale.height;
    const c = this.add.container(0, 0).setDepth(60);
    this.introHint = c;
    const panelW = Math.min(W - 28, 370);
    const panelY = H * 0.3 + 8;

    const panel = this.add
      .rectangle(W / 2, panelY, panelW, 86, 0x12070c, 0.68)
      .setStrokeStyle(1, COLORS.magenta, 0.18);
    const title = this.add
      .text(W / 2, H * 0.275, IDENTITY.copy.introTitle, {
        fontFamily: FONT,
        fontSize: W < 370 ? '14px' : '16px',
        fontStyle: 'bold',
        color: '#ff78c8',
        align: 'center',
        lineSpacing: 3,
        wordWrap: { width: panelW - 24 },
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setShadow(0, 0, 'rgba(255,79,181,0.34)', 8, true, true);
    const sub = this.add
      .text(W / 2, H * 0.275 + 45, IDENTITY.copy.introSub, {
        fontFamily: FONT,
        fontSize: W < 370 ? '10px' : '11px',
        color: '#d9b7c5',
        align: 'center',
        wordWrap: { width: panelW - 26 },
      })
      .setOrigin(0.5)
      .setResolution(2);
    c.add([panel, title, sub]);

    c.setAlpha(0);
    this.tweens.add({ targets: c, alpha: 1, duration: 220 });
    this.time.delayedCall(4600, () => {
      if (!c.active || this.introHint !== c) return;
      this.introHint = null;
      this.tweens.add({ targets: c, alpha: 0, duration: 260, onComplete: () => c.destroy() });
    });
  }

  private dismissIntroHint(immediate = false): void {
    const c = this.introHint;
    if (!c) return;
    this.introHint = null;
    this.tweens.killTweensOf(c);
    if (immediate) {
      c.destroy();
      return;
    }
    this.tweens.add({
      targets: c,
      alpha: 0,
      duration: 110,
      ease: 'Quad.Out',
      onComplete: () => c.destroy(),
    });
  }

  private snapshot(): RunSnapshot {
    const run = this.runState.run;
    const stageProgress = this.runState.stage;
    const stage = this.stageDirector.currentStage;
    return {
      hp: stageProgress.hp,
      maxHp: stageProgress.maxHp,
      level: stageProgress.level,
      xp: stageProgress.xp,
      xpNext: stageProgress.xpNext,
      timeMs: run.timeMs,
      stageTimeMs: stageProgress.timeMs,
      kills: run.kills,
      combo: stageProgress.combo,
      bossHp: this.wave.boss?.hp ?? 0,
      bossMax: this.wave.boss?.maxHp ?? 0,
      bossName: stage.boss.name,
      stageId: stage.id,
      stageOrder: stage.order,
      stageName: stage.name,
      phase: this.stageDirector.phase,
    };
  }

  private onResize(): void {
    const W = this.scale.width;
    const H = this.scale.height;
    this.atmosphere.resize();
    this.vignette.setPosition(W / 2, H / 2).setDisplaySize(W * 1.25, H * 1.25);
  }
}
