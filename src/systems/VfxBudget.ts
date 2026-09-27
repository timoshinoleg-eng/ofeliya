/**
 * Token-bucket VFX limiter with a protected burst reserve.
 *
 * Normal hit/pickup traffic can consume the sustained pool but cannot drain the final reserve.
 * Boss/elite/legendary burst requests may use the whole pool, so important feedback still reads
 * after a dense exchange without increasing the overall burst capacity.
 */
export class VfxBudget {
  private readonly sustainedPerSecond: number;
  private readonly burstCapacity: number;
  private readonly protectedReserve: number;
  private tokens: number;
  private reserveArmed = true;
  private lastAt = 0;

  constructor(sustainedPerSecond: number, burstCapacity: number) {
    this.sustainedPerSecond = Math.max(1, Math.floor(sustainedPerSecond));
    this.burstCapacity = Math.max(this.sustainedPerSecond, Math.floor(burstCapacity));
    this.protectedReserve = Math.max(1, Math.floor(this.burstCapacity * 0.2));
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
    if (this.tokens >= this.burstCapacity) this.reserveArmed = true;

    const request = Math.max(0, Math.floor(wanted));
    const eventCap = burst ? this.burstCapacity : this.sustainedPerSecond;
    const spendable = burst
      ? Math.floor(this.tokens)
      : this.reserveArmed
        ? Math.max(0, Math.floor(this.tokens - this.protectedReserve))
        : Math.floor(this.tokens);
    const granted = Math.min(request, eventCap, spendable);
    this.tokens -= granted;
    if (burst && granted > 0) this.reserveArmed = false;
    return granted;
  }

  get debugState(): {
    tokens: number;
    burstCapacity: number;
    protectedReserve: number;
    reserveArmed: boolean;
    sustainedPerSecond: number;
  } {
    return {
      tokens: this.tokens,
      burstCapacity: this.burstCapacity,
      protectedReserve: this.protectedReserve,
      reserveArmed: this.reserveArmed,
      sustainedPerSecond: this.sustainedPerSecond,
    };
  }

  reset(now = 0): void {
    this.lastAt = Math.max(0, now);
    this.tokens = this.burstCapacity;
    this.reserveArmed = true;
  }
}
