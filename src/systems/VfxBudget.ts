/**
 * Token-bucket VFX limiter. The normal budget is the sustained particles/second target;
 * burst budget is the temporary reservoir available to boss/legendary events.
 */
export class VfxBudget {
  private readonly sustainedPerSecond: number;
  private readonly burstCapacity: number;
  private tokens: number;
  private lastAt = 0;

  constructor(sustainedPerSecond: number, burstCapacity: number) {
    this.sustainedPerSecond = Math.max(1, Math.floor(sustainedPerSecond));
    this.burstCapacity = Math.max(this.sustainedPerSecond, Math.floor(burstCapacity));
    this.tokens = this.burstCapacity;
  }

  request(wanted: number, now: number, burst = false): number {
    const safeNow = Number.isFinite(now) ? Math.max(0, now) : this.lastAt;
    const elapsed = Math.max(0, safeNow - this.lastAt);
    this.lastAt = safeNow;
    this.tokens = Math.min(
      this.burstCapacity,
      this.tokens + (elapsed * this.sustainedPerSecond) / 1000
    );

    const request = Math.max(0, Math.floor(wanted));
    const eventCap = burst ? this.burstCapacity : this.sustainedPerSecond;
    const granted = Math.min(request, eventCap, Math.floor(this.tokens));
    this.tokens -= granted;
    return granted;
  }

  reset(now = 0): void {
    this.lastAt = Math.max(0, now);
    this.tokens = this.burstCapacity;
  }
}
