import { GEM, NOVA, ORBIT, PLAYER, WEAPON } from './config';
import { mathRandom, type Rng } from './SeededRng';
import type { EvolutionId } from './UpgradeSystem';

export function xpForLevel(level: number): number {
  return Math.floor(6 + level * 4 + level * level * 0.35);
}

/** Состояние одного забега: статы игрока и прогресс. */
export class RunState {
  /**
   * Источник случайности: Math.random в обычном режиме, сидированный rng
   * в daily-режиме (seed от даты → одинаковый забег у всех игроков).
   */
  rng: Rng = mathRandom;

  level = 1;
  xp = 0;
  xpNext = xpForLevel(1);
  kills = 0;
  timeMs = 0;

  /** Текущая серия убийств и сколько ей осталось (мс) — см. COMBO в config. */
  combo = 0;
  comboTimer = 0;
  comboBest = 0;

  /** Текущая и лучшая серия без получения урона. */
  noDamageMs = 0;
  maxNoDamageMs = 0;

  hp = PLAYER.hp;
  maxHp = PLAYER.hp;

  damageMul = 1;
  fireRateMul = 1;
  speedMul = 1;
  magnetMul = 1;
  projectiles = 1;
  pierce = 0;
  orbitBlades = 0;
  novaLevel = 0;
  regen = 0;
  /** K3: КОМЕТА — уровень (0 = нет). */
  cometLevel = 0;
  /** K3: ФОКУС-ЛЕНЗА — множитель скорости пуль. */
  bulletSpeedMul = 1;

  stacks: Record<string, number> = {};
  evolutions = new Set<EvolutionId>();

  get bulletDamage(): number {
    return WEAPON.damage * this.damageMul;
  }

  get bulletPierce(): number {
    return this.pierce + (this.hasEvolution('prism') ? 1 : 0);
  }

  get fireInterval(): number {
    return WEAPON.fireIntervalMs / this.fireRateMul;
  }

  get bladeDamage(): number {
    return ORBIT.damage * this.damageMul;
  }

  get magnetRadius(): number {
    return GEM.magnetRadius * this.magnetMul;
  }

  get novaDamage(): number {
    return NOVA.damage * (1 + 0.6 * (this.novaLevel - 1)) * this.damageMul;
  }

  get novaRadius(): number {
    return NOVA.radius * (1 + 0.18 * (this.novaLevel - 1));
  }

  get novaInterval(): number {
    return NOVA.intervalMs * Math.max(0.55, 1 - 0.1 * (this.novaLevel - 1));
  }

  /** K3: КОМЕТА — каждые N залпов (уровень 1: 5, 2: 4, 3: 3; 0 — выкл). */
  get cometEvery(): number {
    return this.cometLevel > 0 ? Math.max(3, 6 - this.cometLevel) : 0;
  }

  /** K3: урон кометы (база × damageMul × множитель уровня). */
  get cometDamage(): number {
    return WEAPON.damage * this.damageMul * (2 + 0.5 * this.cometLevel);
  }

  /** K3: скорость и время жизни пули (ФОКУС-ЛЕНЗА). */
  get bulletSpeed(): number {
    return WEAPON.bulletSpeed * this.bulletSpeedMul;
  }

  get bulletLifetimeMs(): number {
    return WEAPON.bulletLifetimeMs * (1 + 0.15 * this.stackOf('lens'));
  }

  addXp(v: number): number {
    this.xp += v;
    let levels = 0;
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext;
      this.level += 1;
      this.xpNext = xpForLevel(this.level);
      levels += 1;
    }
    return levels;
  }

  tickNoDamage(delta: number): void {
    this.noDamageMs += delta;
    if (this.noDamageMs > this.maxNoDamageMs) this.maxNoDamageMs = this.noDamageMs;
  }

  resetNoDamage(): void {
    this.noDamageMs = 0;
  }

  stackOf(id: string): number {
    return this.stacks[id] ?? 0;
  }

  bump(id: string): void {
    this.stacks[id] = (this.stacks[id] ?? 0) + 1;
  }

  hasEvolution(id: EvolutionId): boolean {
    return this.evolutions.has(id);
  }

  addEvolution(id: EvolutionId): boolean {
    if (this.evolutions.has(id)) return false;
    this.evolutions.add(id);
    return true;
  }
}
