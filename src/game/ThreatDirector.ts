export type ThreatBand = 'calm' | 'engaged' | 'high' | 'critical';

export interface ThreatInput {
  nearbyPressure01: number;
  hpFraction: number;
  escapeSpaceRatio: number;
  elitePressure01: number;
  bossPhase01: number;
}

export interface ThreatPacingDirective {
  /** >= 1 slows normal wave spawning. */
  spawnIntervalMultiplier: number;
  /** >= 1 slows boss-minion spawning. */
  bossMinionIntervalMultiplier: number;
  /** <= 1 trims normal batch size under sustained pressure. */
  batchScale: number;
  /** False while pressure is high enough that stacking dangerous patterns would be unfair. */
  allowDangerousCombinations: boolean;
  /** Advisory recovery window for future encounter integrations. */
  recoveryWindowMs: number;
}

export interface ThreatAssessment {
  rawThreat: number;
  smoothedThreat: number;
  recentDamageDanger: number;
  band: ThreatBand;
  directive: ThreatPacingDirective;
}

export interface ThreatDamageEvent {
  atMs: number;
  fraction: number;
}

export interface ThreatDirectorSnapshot {
  smoothedThreat: number;
  band: ThreatBand;
  lastUpdateAtMs: number | null;
  damageEvents: ThreatDamageEvent[];
}

export interface ThreatDirectorTuning {
  damageWindowMs: number;
  damageHalfLifeMs: number;
  criticalDamageFraction: number;
  attackTauMs: number;
  releaseTauMs: number;
  engagedEnter: number;
  engagedExit: number;
  highEnter: number;
  highExit: number;
  criticalEnter: number;
  criticalExit: number;
}

export const THREAT_TUNING: ThreatDirectorTuning = {
  damageWindowMs: 4_500,
  damageHalfLifeMs: 1_600,
  criticalDamageFraction: 0.45,
  attackTauMs: 450,
  releaseTauMs: 2_400,
  engagedEnter: 0.3,
  engagedExit: 0.22,
  highEnter: 0.6,
  highExit: 0.46,
  criticalEnter: 0.78,
  criticalExit: 0.62,
};

const ZERO_DIRECTIVE: ThreatPacingDirective = {
  spawnIntervalMultiplier: 1,
  bossMinionIntervalMultiplier: 1,
  batchScale: 1,
  allowDangerousCombinations: true,
  recoveryWindowMs: 0,
};

const ZERO_ASSESSMENT: ThreatAssessment = {
  rawThreat: 0,
  smoothedThreat: 0,
  recentDamageDanger: 0,
  band: 'calm',
  directive: ZERO_DIRECTIVE,
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function expApproach(current: number, target: number, dtMs: number, tauMs: number): number {
  if (dtMs <= 0 || tauMs <= 0) return current;
  const alpha = 1 - Math.exp(-dtMs / tauMs);
  return current + (target - current) * alpha;
}

/**
 * Deterministic pressure governor. It observes gameplay but never decides damage, kills or collisions.
 * All risk channels are oriented the same way: larger values mean more danger.
 */
export class ThreatDirector {
  private readonly tuning: ThreatDirectorTuning;
  private damageEvents: ThreatDamageEvent[] = [];
  private smoothedThreat = 0;
  private band: ThreatBand = 'calm';
  private lastUpdateAtMs: number | null = null;
  private assessment: ThreatAssessment = ZERO_ASSESSMENT;

  constructor(tuning: ThreatDirectorTuning = THREAT_TUNING) {
    this.tuning = tuning;
  }

  get current(): ThreatAssessment {
    return this.assessment;
  }

  recordDamage(damage: number, maxHp: number, nowMs: number): void {
    if (!Number.isFinite(damage) || damage <= 0 || !Number.isFinite(maxHp) || maxHp <= 0) return;
    const atMs = Number.isFinite(nowMs) ? Math.max(0, nowMs) : 0;
    this.pruneDamage(atMs);
    this.damageEvents.push({ atMs, fraction: clamp01(damage / maxHp) });
  }

  update(input: ThreatInput, nowMs: number): ThreatAssessment {
    const safeNow = Number.isFinite(nowMs)
      ? Math.max(0, nowMs)
      : (this.lastUpdateAtMs ?? 0);
    const dtMs =
      this.lastUpdateAtMs === null ? 0 : Math.max(0, Math.min(1_000, safeNow - this.lastUpdateAtMs));
    this.lastUpdateAtMs = safeNow;

    const nearby = clamp01(input.nearbyPressure01);
    const hpDeficit = 1 - clamp01(input.hpFraction);
    const blockedSpace = 1 - clamp01(input.escapeSpaceRatio);
    const elite = clamp01(input.elitePressure01);
    const boss = clamp01(input.bossPhase01);
    const recentDamage = this.recentDamageDanger(safeNow);

    // Every term is monotonic in danger. There are deliberately no negative danger weights.
    const hpDanger = hpDeficit * 0.65 + hpDeficit * hpDeficit * 0.35;
    const weighted =
      nearby * 0.34 +
      hpDanger * 0.18 +
      blockedSpace * 0.16 +
      recentDamage * 0.2 +
      elite * 0.07 +
      boss * 0.05;

    // Small positive synergies recognize bad combinations without making any one channel dominant.
    const synergy =
      hpDanger * blockedSpace * 0.08 +
      recentDamage * blockedSpace * 0.06 +
      nearby * elite * 0.04;

    const rawThreat = clamp01(weighted + synergy);
    const tau = rawThreat >= this.smoothedThreat ? this.tuning.attackTauMs : this.tuning.releaseTauMs;
    this.smoothedThreat =
      this.lastUpdateAtMs === safeNow && dtMs === 0 && this.assessment === ZERO_ASSESSMENT
        ? rawThreat
        : clamp01(expApproach(this.smoothedThreat, rawThreat, dtMs, tau));
    this.band = this.nextBand(this.band, this.smoothedThreat);

    const pressure = clamp01((this.smoothedThreat - this.tuning.engagedEnter) / (1 - this.tuning.engagedEnter));
    const highPressure = clamp01(
      (this.smoothedThreat - this.tuning.highExit) / (1 - this.tuning.highExit)
    );
    const directive: ThreatPacingDirective = {
      // Only relieve excessive pressure. Low threat never speeds the authored encounter up.
      spawnIntervalMultiplier: 1 + pressure * 0.28,
      bossMinionIntervalMultiplier: 1 + highPressure * 0.18,
      batchScale: 1 - highPressure * 0.22,
      allowDangerousCombinations: this.smoothedThreat < 0.72,
      recoveryWindowMs: Math.round(highPressure * 900),
    };

    this.assessment = {
      rawThreat,
      smoothedThreat: this.smoothedThreat,
      recentDamageDanger: recentDamage,
      band: this.band,
      directive,
    };
    return this.assessment;
  }

  snapshot(nowMs: number): ThreatDirectorSnapshot {
    const safeNow = Number.isFinite(nowMs) ? Math.max(0, nowMs) : (this.lastUpdateAtMs ?? 0);
    this.pruneDamage(safeNow);
    return {
      smoothedThreat: this.smoothedThreat,
      band: this.band,
      lastUpdateAtMs: this.lastUpdateAtMs,
      damageEvents: this.damageEvents.map((event) => ({ ...event })),
    };
  }

  restore(snapshot: ThreatDirectorSnapshot | undefined, nowMs: number): void {
    if (!snapshot) {
      this.reset(nowMs);
      return;
    }
    const safeNow = Number.isFinite(nowMs) ? Math.max(0, nowMs) : 0;
    this.smoothedThreat = clamp01(snapshot.smoothedThreat);
    this.band = this.isBand(snapshot.band) ? snapshot.band : 'calm';
    this.lastUpdateAtMs = safeNow;
    // Stage time resumes from the checkpointed value, so retained timestamps stay meaningful.
    this.damageEvents = Array.isArray(snapshot.damageEvents)
      ? snapshot.damageEvents
          .filter(
            (event) =>
              Number.isFinite(event.atMs) &&
              Number.isFinite(event.fraction) &&
              event.atMs >= 0 &&
              event.atMs <= safeNow
          )
          .map((event) => ({ atMs: event.atMs, fraction: clamp01(event.fraction) }))
      : [];
    this.pruneDamage(safeNow);
    this.assessment = {
      rawThreat: this.smoothedThreat,
      smoothedThreat: this.smoothedThreat,
      recentDamageDanger: this.recentDamageDanger(safeNow),
      band: this.band,
      directive: this.directiveFor(this.smoothedThreat),
    };
  }

  reset(nowMs = 0): void {
    const safeNow = Number.isFinite(nowMs) ? Math.max(0, nowMs) : 0;
    this.damageEvents = [];
    this.smoothedThreat = 0;
    this.band = 'calm';
    this.lastUpdateAtMs = safeNow;
    this.assessment = { ...ZERO_ASSESSMENT, directive: { ...ZERO_DIRECTIVE } };
  }

  private recentDamageDanger(nowMs: number): number {
    this.pruneDamage(nowMs);
    if (this.damageEvents.length === 0) return 0;
    let weightedFraction = 0;
    for (const event of this.damageEvents) {
      const age = Math.max(0, nowMs - event.atMs);
      const decay = Math.pow(0.5, age / this.tuning.damageHalfLifeMs);
      weightedFraction += event.fraction * decay;
    }
    return clamp01(weightedFraction / this.tuning.criticalDamageFraction);
  }

  private pruneDamage(nowMs: number): void {
    const cutoff = nowMs - this.tuning.damageWindowMs;
    this.damageEvents = this.damageEvents.filter((event) => event.atMs >= cutoff);
  }

  private nextBand(current: ThreatBand, threat: number): ThreatBand {
    if (current === 'critical' && threat >= this.tuning.criticalExit) return 'critical';
    if (threat >= this.tuning.criticalEnter) return 'critical';

    if ((current === 'high' || current === 'critical') && threat >= this.tuning.highExit) {
      return 'high';
    }
    if (threat >= this.tuning.highEnter) return 'high';

    if (current !== 'calm' && threat >= this.tuning.engagedExit) return 'engaged';
    if (threat >= this.tuning.engagedEnter) return 'engaged';
    return 'calm';
  }

  private directiveFor(threat: number): ThreatPacingDirective {
    const pressure = clamp01((threat - this.tuning.engagedEnter) / (1 - this.tuning.engagedEnter));
    const highPressure = clamp01((threat - this.tuning.highExit) / (1 - this.tuning.highExit));
    return {
      spawnIntervalMultiplier: 1 + pressure * 0.28,
      bossMinionIntervalMultiplier: 1 + highPressure * 0.18,
      batchScale: 1 - highPressure * 0.22,
      allowDangerousCombinations: threat < 0.72,
      recoveryWindowMs: Math.round(highPressure * 900),
    };
  }

  private isBand(value: unknown): value is ThreatBand {
    return value === 'calm' || value === 'engaged' || value === 'high' || value === 'critical';
  }
}
