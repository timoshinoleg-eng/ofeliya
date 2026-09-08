import { GEM, NOVA, ORBIT, PLAYER, WEAPON } from './config';
import type { EvolutionId } from './UpgradeSystem';

export function xpForLevel(level: number): number {
  return Math.floor(6 + level * 4 + level * level * 0.35);
}

/** Состояние одного забега: статы игрока и прогресс. */
export class RunState {
  level = 1;
  xp = 0;
  xpNext = xpForLevel(1);
  kills = 0;
  timeMs = 0;

  /** Текущая серия убийств и сколько ей осталось (мс) — см. COMBO в config. */
  combo = 0;
  comboTimer = 0;
  comboBest = 0;

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

  stacks: Record<string, number> = {};
  /** Эволюции живут только в рамках текущего забега; meta-history появится в #6. */
  evolutions = new Set<EvolutionId>();

  get bulletDamage(): number {
    return WEAPON.damage * this.damageMul;
  }

  get bulletPierce(): number {
    // ПРИЗМА получает небольшой механический отпечаток, но основная награда — presentation.
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

  /** Возвращает количество полученных уровней. */
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
