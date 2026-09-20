[Reading 134 lines from start (total: 134 lines, 0 remaining)]

export type HeartbeatPulseEvent =
  | { type: 'heartbeat-telegraph'; bossActive: boolean; impactAtMs: number }
  | { type: 'heartbeat-impact'; bossActive: boolean; pressureUntilMs: number }
  | { type: 'heartbeat-pressure-ended' };

export interface HeartbeatPulseSnapshot {
  nextImpactAtMs: number;
  telegraphedImpactAtMs: number | null;
  pressureUntilMs: number | null;
  pressureBoss: boolean;
  bossWasActive: boolean;
}

export interface HeartbeatPulseProfile {
  firstImpactAtMs: number;
  intervalMs: number;
  bossIntervalMs: number;
  bossFirstImpactDelayMs: number;
  telegraphLeadMs: number;
  pressureDurationMs: number;
  pressureMultiplier: number;
  bossPressureMultiplier: number;
}

export const HEARTBEAT_PULSE_PROFILE: HeartbeatPulseProfile = {
  firstImpactAtMs: 12_000,
  intervalMs: 18_000,
  bossIntervalMs: 7_200,
  bossFirstImpactDelayMs: 3_200,
  telegraphLeadMs: 700,
  pressureDurationMs: 1_050,
  pressureMultiplier: 1.18,
  bossPressureMultiplier: 1.34,
};

export class HeartbeatPulseDirector {
  private readonly profile: HeartbeatPulseProfile;
  private nextImpactAtMs: number;
  private telegraphedImpactAtMs: number | null = null;
  private pressureUntilMs: number | null = null;
  private pressureBoss = false;
  private bossWasActive = false;

  constructor(profile: HeartbeatPulseProfile = HEARTBEAT_PULSE_PROFILE) {
    this.profile = profile;
    this.nextImpactAtMs = profile.firstImpactAtMs;
  }

  reset(stageTimeMs = 0): void {
    this.nextImpactAtMs = stageTimeMs + this.profile.firstImpactAtMs;
    this.telegraphedImpactAtMs = null;
    this.pressureUntilMs = null;
    this.pressureBoss = false;
    this.bossWasActive = false;
  }

  update(stageTimeMs: number, bossActive: boolean): HeartbeatPulseEvent[] {
    const now = Math.max(0, stageTimeMs);
    const events: HeartbeatPulseEvent[] = [];
    if (this.pressureUntilMs !== null && now >= this.pressureUntilMs) {
      this.pressureUntilMs = null;
      this.pressureBoss = false;
      events.push({ type: 'heartbeat-pressure-ended' });
    }

    if (bossActive && !this.bossWasActive) {
      const accelerated = now + this.profile.bossFirstImpactDelayMs;
      if (this.nextImpactAtMs > accelerated) {
        this.nextImpactAtMs = accelerated;
        this.telegraphedImpactAtMs = null;
      }
    }
    this.bossWasActive = bossActive;

    if (
      now >= this.nextImpactAtMs - this.profile.telegraphLeadMs &&
      this.telegraphedImpactAtMs !== this.nextImpactAtMs
    ) {
      this.telegraphedImpactAtMs = this.nextImpactAtMs;
      events.push({ type: 'heartbeat-telegraph', bossActive, impactAtMs: this.nextImpactAtMs });
    }

    if (now >= this.nextImpactAtMs) {
      this.pressureBoss = bossActive;
      this.pressureUntilMs = now + this.profile.pressureDurationMs;
      events.push({
        type: 'heartbeat-impact',
        bossActive,
        pressureUntilMs: this.pressureUntilMs,
      });
      this.nextImpactAtMs = now + (bossActive ? this.profile.bossIntervalMs : this.profile.intervalMs);
      this.telegraphedImpactAtMs = null;
    }

    return events;
  }
  snapshot(): HeartbeatPulseSnapshot {
    return {
      nextImpactAtMs: this.nextImpactAtMs,
      telegraphedImpactAtMs: this.telegraphedImpactAtMs,
      pressureUntilMs: this.pressureUntilMs,
      pressureBoss: this.pressureBoss,
      bossWasActive: this.bossWasActive,
    };
  }

  restore(snapshot: HeartbeatPulseSnapshot): void {
    this.nextImpactAtMs = snapshot.nextImpactAtMs;
    this.telegraphedImpactAtMs = snapshot.telegraphedImpactAtMs;
    this.pressureUntilMs = snapshot.pressureUntilMs;
    this.pressureBoss = snapshot.pressureBoss;
    this.bossWasActive = snapshot.bossWasActive;
  }

  get pressureMultiplier(): number {
    if (this.pressureUntilMs === null) return 1;
    return this.pressureBoss
      ? this.profile.bossPressureMultiplier
      : this.profile.pressureMultiplier;
  }

  get debugState(): {
    nextImpactAtMs: number;
    telegraphedImpactAtMs: number | null;
    pressureUntilMs: number | null;
  } {
    return {
      nextImpactAtMs: this.nextImpactAtMs,
      telegraphedImpactAtMs: this.telegraphedImpactAtMs,
      pressureUntilMs: this.pressureUntilMs,
    };
  }
}


[executed on device: chatgpt-ops-1 (ca22b74b-ed01-4519-b9df-03edbe57a1ba)]