export type ImpactType =
  | 'normal_hit'
  | 'critical_hit'
  | 'enemy_death'
  | 'elite_spawn'
  | 'elite_death'
  | 'level_up'
  | 'rare_pick'
  | 'legendary_pick'
  | 'lysis'
  | 'heartbeat_warning'
  | 'heartbeat_impact'
  | 'boss_phase';

const HIT_STOP_MS: Record<ImpactType, number> = {
  normal_hit: 0,
  critical_hit: 12,
  enemy_death: 0,
  elite_spawn: 0,
  elite_death: 20,
  level_up: 0,
  rare_pick: 0,
  legendary_pick: 220,
  lysis: 0,
  heartbeat_warning: 0,
  heartbeat_impact: 0,
  boss_phase: 28,
};

export class ImpactDirector {
  private lastShakeAt = Number.NEGATIVE_INFINITY;
  private fullscreenUntil = 0;

  hitStopMs(type: ImpactType): number {
    return HIT_STOP_MS[type];
  }

  allowCameraShake(now: number, cooldownMs = 100): boolean {
    if (now - this.lastShakeAt < cooldownMs) return false;
    this.lastShakeAt = now;
    return true;
  }

  acquireFullscreen(now: number, durationMs: number): boolean {
    if (now < this.fullscreenUntil) return false;
    this.fullscreenUntil = now + Math.max(0, durationMs);
    return true;
  }

  reset(): void {
    this.lastShakeAt = Number.NEGATIVE_INFINITY;
    this.fullscreenUntil = 0;
  }
}
