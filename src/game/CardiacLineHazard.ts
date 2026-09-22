/**
 * Deterministic phase-two line hazard for CARDIAC TITAN.
 *
 * The warning -> beam lifecycle is adapted from the isolated line-hazard pattern in
 * ianis66666/factory-overload (MIT), but rewritten as a Phaser-free OFELIYA director so
 * scheduling/geometry can be tested independently and driven by a run-seeded RNG.
 */
export const CARDIAC_LINE_HAZARD = {
  initialDelayMs: 4_400,
  intervalMs: 5_200,
  telegraphMs: 850,
  activeMs: 280,
  offsetRangePx: 118,
  warningHalfThicknessPx: 30,
  beamHalfThicknessPx: 17,
  damage: 14,
} as const;

export interface CardiacLineHazardSpec {
  serial: number;
  centerX: number;
  centerY: number;
  angle: number;
  halfLength: number;
  warningHalfThickness: number;
  beamHalfThickness: number;
  damage: number;
  fireAtMs: number;
  endAtMs: number;
}

export type CardiacLineHazardEvent =
  | { type: 'telegraph'; hazard: CardiacLineHazardSpec }
  | { type: 'fire'; hazard: CardiacLineHazardSpec }
  | { type: 'end'; serial: number }
  | { type: 'clear' };

export interface CardiacLineHazardUpdate {
  nowMs: number;
  enabled: boolean;
  canSchedule: boolean;
  originX: number;
  originY: number;
  halfLength: number;
}

interface ActiveHazard {
  hazard: CardiacLineHazardSpec;
  fired: boolean;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(0.999999999, value));
}

export class CardiacLineHazardDirector {
  private enabled = false;
  private nextTelegraphAtMs = 0;
  private serial = 0;
  private active: ActiveHazard | null = null;

  reset(): void {
    this.enabled = false;
    this.nextTelegraphAtMs = 0;
    this.serial = 0;
    this.active = null;
  }

  update(
    input: CardiacLineHazardUpdate,
    random: () => number
  ): CardiacLineHazardEvent[] {
    const nowMs = Math.max(0, input.nowMs);
    const events: CardiacLineHazardEvent[] = [];

    if (!input.enabled) {
      if (this.enabled || this.active) events.push({ type: 'clear' });
      this.reset();
      return events;
    }

    if (!this.enabled) {
      this.enabled = true;
      this.nextTelegraphAtMs = nowMs + CARDIAC_LINE_HAZARD.initialDelayMs;
    }

    if (this.active) {
      if (!this.active.fired && nowMs >= this.active.hazard.fireAtMs) {
        this.active.fired = true;
        events.push({ type: 'fire', hazard: this.active.hazard });
      }
      if (nowMs >= this.active.hazard.endAtMs) {
        events.push({ type: 'end', serial: this.active.hazard.serial });
        this.active = null;
      }
    }

    if (
      !this.active &&
      input.canSchedule &&
      nowMs >= this.nextTelegraphAtMs
    ) {
      const angle = clampUnit(random()) * Math.PI * 2;
      const offset =
        (clampUnit(random()) * 2 - 1) * CARDIAC_LINE_HAZARD.offsetRangePx;
      const perpendicularX = -Math.sin(angle);
      const perpendicularY = Math.cos(angle);
      const fireAtMs = nowMs + CARDIAC_LINE_HAZARD.telegraphMs;
      const hazard: CardiacLineHazardSpec = {
        serial: ++this.serial,
        centerX: input.originX + perpendicularX * offset,
        centerY: input.originY + perpendicularY * offset,
        angle,
        halfLength: Math.max(260, input.halfLength),
        warningHalfThickness: CARDIAC_LINE_HAZARD.warningHalfThicknessPx,
        beamHalfThickness: CARDIAC_LINE_HAZARD.beamHalfThicknessPx,
        damage: CARDIAC_LINE_HAZARD.damage,
        fireAtMs,
        endAtMs: fireAtMs + CARDIAC_LINE_HAZARD.activeMs,
      };
      this.active = { hazard, fired: false };
      this.nextTelegraphAtMs = nowMs + CARDIAC_LINE_HAZARD.intervalMs;
      events.push({ type: 'telegraph', hazard });
    }

    return events;
  }
}

export function pointInsideCardiacLineHazard(
  x: number,
  y: number,
  hazard: Pick<
    CardiacLineHazardSpec,
    'centerX' | 'centerY' | 'angle' | 'halfLength'
  >,
  halfThickness: number,
  radiusPadding = 0
): boolean {
  const directionX = Math.cos(hazard.angle);
  const directionY = Math.sin(hazard.angle);
  const offsetX = x - hazard.centerX;
  const offsetY = y - hazard.centerY;
  const along = offsetX * directionX + offsetY * directionY;
  if (Math.abs(along) > hazard.halfLength + Math.max(0, radiusPadding)) return false;
  const perpendicular = Math.abs(offsetX * -directionY + offsetY * directionX);
  return perpendicular <= Math.max(0, halfThickness) + Math.max(0, radiusPadding);
}
