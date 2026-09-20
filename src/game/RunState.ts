import { GEM, NOVA, ORBIT, PLAYER, WEAPON } from './config';
import type { StageDefinition, StageId } from './StageDefinitions';
import type { EvolutionId } from './UpgradeSystem';
import type { LegendaryId } from './LegendarySystem';

export function xpForLevel(level: number): number {
  // Strain Zero must reward the player almost immediately: the opening mutation is intentionally
  // cheaper, while the existing progression curve resumes from level 2 onward.
  if (level <= 1) return 5;
  return Math.floor(6 + level * 4 + level * level * 0.35);
}

export interface StageBuildSnapshot {
  level: number;
  stacks: Record<string, number>;
  evolutions: EvolutionId[];
}

export interface RunProgressState {
  timeMs: number;
  kills: number;
  hostCellsInfected: number;
  comboBest: number;
  maxNoDamageMs: number;
  bossesDefeated: number;
  currentStageOrder: number;
  highestStageOrder: number;
  bossClearTimesMs: Record<string, number>;
  evolutionsSeen: Set<EvolutionId>;
  legendaryIds: Set<LegendaryId>;
  legendaryPity: number;
  legendaryOffersSeen: number;
  highestLevel: number;
  stageBuilds: Partial<Record<StageId, StageBuildSnapshot>>;
}

export interface StageProgressState {
  id: StageId;
  order: number;
  timeMs: number;
  level: number;
  xp: number;
  xpNext: number;
  kills: number;
  hostCellsInfected: number;
  combo: number;
  comboTimer: number;
  noDamageMs: number;
  hp: number;
  maxHp: number;
  damageMul: number;
  fireRateMul: number;
  speedMul: number;
  magnetMul: number;
  projectiles: number;
  pierce: number;
  orbitBlades: number;
  novaLevel: number;
  regen: number;
  infectionSpeedMul: number;
  infectionRadiusMul: number;
  lysisDamageMul: number;
  lysisRadiusMul: number;
  lysisRnaBonus: number;
  stacks: Record<string, number>;
  evolutions: Set<EvolutionId>;
}

export interface RunProgressCheckpoint
  extends Omit<RunProgressState, 'evolutionsSeen' | 'legendaryIds' | 'stageBuilds'> {
  evolutionsSeen: EvolutionId[];
  legendaryIds: LegendaryId[];
  stageBuilds: Partial<Record<StageId, StageBuildSnapshot>>;
}

export interface StageProgressCheckpoint extends Omit<StageProgressState, 'evolutions'> {
  evolutions: EvolutionId[];
}

export interface RunStateCheckpoint {
  run: RunProgressCheckpoint;
  stage: StageProgressCheckpoint;
}

function createStageProgress(stage: Pick<StageDefinition, 'id' | 'order'>): StageProgressState {
  return {
    id: stage.id,
    order: stage.order,
    timeMs: 0,
    level: 1,
    xp: 0,
    xpNext: xpForLevel(1),
    kills: 0,
    hostCellsInfected: 0,
    combo: 0,
    comboTimer: 0,
    noDamageMs: 0,
    hp: PLAYER.hp,
    maxHp: PLAYER.hp,
    damageMul: 1,
    fireRateMul: 1,
    speedMul: 1,
    magnetMul: 1,
    projectiles: 1,
    pierce: 0,
    orbitBlades: 0,
    novaLevel: 0,
    regen: 0,
    infectionSpeedMul: 1,
    infectionRadiusMul: 1,
    lysisDamageMul: 1,
    lysisRadiusMul: 1,
    lysisRnaBonus: 0,
    stacks: {},
    evolutions: new Set<EvolutionId>(),
  };
}

/** Run-wide records and resettable stage combat progression. */
export class RunState {
  readonly run: RunProgressState;
  stage: StageProgressState;

  constructor(initialStage: Pick<StageDefinition, 'id' | 'order'>) {
    this.run = {
      timeMs: 0,
      kills: 0,
      hostCellsInfected: 0,
      comboBest: 0,
      maxNoDamageMs: 0,
      bossesDefeated: 0,
      currentStageOrder: initialStage.order,
      highestStageOrder: initialStage.order,
      bossClearTimesMs: {},
      evolutionsSeen: new Set<EvolutionId>(),
      legendaryIds: new Set<LegendaryId>(),
      legendaryPity: 0,
      legendaryOffersSeen: 0,
      highestLevel: 1,
      stageBuilds: {},
    };
    this.stage = createStageProgress(initialStage);
  }

  get bulletDamage(): number {
    return WEAPON.damage * this.stage.damageMul;
  }

  get bulletPierce(): number {
    return this.stage.pierce + (this.hasEvolution('prism') ? 1 : 0);
  }

  get fireInterval(): number {
    return WEAPON.fireIntervalMs / this.stage.fireRateMul;
  }

  get bladeDamage(): number {
    return ORBIT.damage * this.stage.damageMul;
  }

  get magnetRadius(): number {
    return GEM.magnetRadius * this.stage.magnetMul;
  }

  get novaDamage(): number {
    return NOVA.damage * (1 + 0.6 * (this.stage.novaLevel - 1)) * this.stage.damageMul;
  }

  get novaRadius(): number {
    return NOVA.radius * (1 + 0.18 * (this.stage.novaLevel - 1));
  }

  get novaInterval(): number {
    return NOVA.intervalMs * Math.max(0.55, 1 - 0.1 * (this.stage.novaLevel - 1));
  }

  get infectionRadius(): number {
    return 58 * this.stage.infectionRadiusMul;
  }

  get infectionDurationMs(): number {
    return 1250 / this.stage.infectionSpeedMul;
  }

  get hostLysisDamage(): number {
    return 26 * this.stage.lysisDamageMul;
  }

  get hostLysisRadius(): number {
    return 150 * this.stage.lysisRadiusMul;
  }

  get hostLysisRna(): number {
    return 4 + this.stage.lysisRnaBonus;
  }

  tick(delta: number): void {
    this.run.timeMs += delta;
    this.stage.timeMs += delta;
    this.stage.noDamageMs += delta;
    if (this.stage.noDamageMs > this.run.maxNoDamageMs) {
      this.run.maxNoDamageMs = this.stage.noDamageMs;
    }
    if (this.stage.combo <= 0) return;
    this.stage.comboTimer -= delta;
    if (this.stage.comboTimer <= 0) {
      this.stage.combo = 0;
      this.stage.comboTimer = 0;
    }
  }

  recordKill(comboWindowMs: number): void {
    this.run.kills += 1;
    this.stage.kills += 1;
    this.stage.combo += 1;
    this.stage.comboTimer = comboWindowMs;
    if (this.stage.combo > this.run.comboBest) this.run.comboBest = this.stage.combo;
  }

  recordHostCellInfected(): void {
    this.run.hostCellsInfected += 1;
    this.stage.hostCellsInfected += 1;
  }

  recordBossDefeated(bossId: string): void {
    if (Object.prototype.hasOwnProperty.call(this.run.bossClearTimesMs, bossId)) return;
    this.run.bossesDefeated += 1;
    this.run.bossClearTimesMs[bossId] = this.run.timeMs;
  }

  resetStageProgression(stage: Pick<StageDefinition, 'id' | 'order'>): void {
    this.captureStageBuild();
    this.stage = createStageProgress(stage);
    this.run.currentStageOrder = stage.order;
    this.run.highestStageOrder = Math.max(this.run.highestStageOrder, stage.order);
  }

  addXp(value: number): number {
    this.stage.xp += value;
    let levels = 0;
    while (this.stage.xp >= this.stage.xpNext) {
      this.stage.xp -= this.stage.xpNext;
      this.stage.level += 1;
      this.run.highestLevel = Math.max(this.run.highestLevel, this.stage.level);
      this.stage.xpNext = xpForLevel(this.stage.level);
      levels += 1;
    }
    return levels;
  }

  captureStageBuild(): void {
    this.run.stageBuilds[this.stage.id] = {
      level: this.stage.level,
      stacks: { ...this.stage.stacks },
      evolutions: [...this.stage.evolutions],
    };
  }

  resetNoDamage(): void {
    this.stage.noDamageMs = 0;
  }

  stackOf(id: string): number {
    return this.stage.stacks[id] ?? 0;
  }

  bump(id: string): void {
    this.stage.stacks[id] = (this.stage.stacks[id] ?? 0) + 1;
  }

  hasEvolution(id: EvolutionId): boolean {
    return this.stage.evolutions.has(id);
  }

  addEvolution(id: EvolutionId): boolean {
    if (this.stage.evolutions.has(id)) return false;
    this.stage.evolutions.add(id);
    this.run.evolutionsSeen.add(id);
    return true;
  }

  hasLegendary(id: LegendaryId): boolean {
    return this.run.legendaryIds.has(id);
  }

  addLegendary(id: LegendaryId): boolean {
    if (this.run.legendaryIds.has(id) || this.run.legendaryIds.size >= 2) return false;
    this.run.legendaryIds.add(id);
    return true;
  }

  noteLegendaryOffer(shown: boolean): void {
    this.run.legendaryOffersSeen += 1;
    this.run.legendaryPity = shown ? 0 : this.run.legendaryPity + 1;
  }

  snapshotForCheckpoint(): RunStateCheckpoint {
    return {
      run: {
        ...this.run,
        bossClearTimesMs: { ...this.run.bossClearTimesMs },
        evolutionsSeen: [...this.run.evolutionsSeen],
        legendaryIds: [...this.run.legendaryIds],
        stageBuilds: Object.fromEntries(
          Object.entries(this.run.stageBuilds).map(([id, build]) => [
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
      },
      stage: {
        ...this.stage,
        stacks: { ...this.stage.stacks },
        evolutions: [...this.stage.evolutions],
      },
    };
  }

  restoreFromCheckpoint(snapshot: RunStateCheckpoint): void {
    Object.assign(this.run, {
      ...snapshot.run,
      bossClearTimesMs: { ...snapshot.run.bossClearTimesMs },
      evolutionsSeen: new Set(snapshot.run.evolutionsSeen),
      legendaryIds: new Set(snapshot.run.legendaryIds),
      stageBuilds: Object.fromEntries(
        Object.entries(snapshot.run.stageBuilds).map(([id, build]) => [
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
    });
    this.stage = {
      ...snapshot.stage,
      stacks: { ...snapshot.stage.stacks },
      evolutions: new Set(snapshot.stage.evolutions),
    };
  }
}
