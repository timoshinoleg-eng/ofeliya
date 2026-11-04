import { PLAYER } from './config';
import { RunState } from './RunState';
import { EVOLUTION_NAMES, type UpgradeDef } from './UpgradeSystem';

/**
 * C2: mutation cards show «было → стало» + synergy tag.
 *
 * The card's own effect line (def.name) already states the relative bonus
 * («Снаряды: урон +25%»). This module adds the absolute values around one
 * stack: the stat before applying the card and the stat after applying it,
 * computed from the live RunState — never from hardcoded audit numbers.
 *
 * How the after-value is produced: the current stage is shallow-cloned and
 * the card's real apply() runs against the clone, so the numbers always
 * follow the game's own formulas (including getters like bulletDamage and
 * magnetRadius). The passed-in state is never mutated.
 *
 * Display contract (kept deliberately compact so the segment fits the
 * existing effect plate on 320 px screens without a card redesign):
 * - bare values only, no per-stat labels: «10 → 12,5»;
 * - multi-stat cards list values in the same order the card name mentions
 *   them («+30% урон · +8% радиус» → «26 → 33,8 · 150 → 162»);
 * - the evolution tag, when the card has an evolutionHint, is appended as
 *   « · → <NAME>» with the name taken from EVOLUTION_NAMES, never invented.
 * - evolution/legendary ceremony cards and unknown ids return null: they
 *   have no stack stat to compare.
 */

export interface BeforeAfterStat {
  /** Internal label (documentation + tests); not rendered on the card. */
  label: string;
  before: string;
  after: string;
}

/** One decimal, Russian comma separator, trailing «,0» trimmed («10», «12,5»). */
function fmt1(n: number): string {
  return n.toFixed(1).replace('.', ',').replace(/,0$/, '');
}

/** Two decimals, Russian comma separator («1,82», «2,09»). */
function fmt2(n: number): string {
  return n.toFixed(2).replace('.', ',');
}

function fmtInt(n: number): string {
  return String(Math.round(n));
}

function cloneState(s: RunState): RunState {
  const clone = new RunState({ id: s.stage.id, order: s.stage.order });
  clone.stage = {
    ...s.stage,
    stacks: { ...s.stage.stacks },
    evolutions: new Set(s.stage.evolutions),
  };
  return clone;
}

type StatReader = (s: RunState) => { label: string; text: string };

function stat(label: string, read: (s: RunState) => string): StatReader {
  return (s: RunState) => ({ label, text: read(s) });
}

/** One reader per changed stat, in the order the card name mentions them. */
const READERS: Record<string, StatReader[]> = {
  dmg: [stat('Урон снарядов', (s) => fmt1(s.bulletDamage))],
  rate: [stat('Выстрелов в секунду', (s) => fmt2(1000 / s.fireInterval))],
  multi: [stat('Снаряды в залпе', (s) => fmtInt(s.stage.projectiles))],
  pierce: [stat('Пробитие целей', (s) => fmtInt(s.stage.pierce))],
  speed: [stat('Скорость', (s) => fmt1(PLAYER.speed * s.stage.speedMul))],
  hp: [stat('Макс. прочность', (s) => fmtInt(s.stage.maxHp))],
  magnet: [stat('Радиус подбора РНК', (s) => fmt1(s.magnetRadius))],
  orbit: [stat('Спутники', (s) => fmtInt(s.stage.orbitBlades))],
  nova: [stat('Уровень волны', (s) => fmtInt(s.stage.novaLevel))],
  infect: [
    stat('Время заражения', (s) => fmtInt(s.infectionDurationMs)),
    stat('Радиус заражения', (s) => fmt1(s.infectionRadius)),
  ],
  lysis: [
    stat('Урон взрыва', (s) => fmt1(s.hostLysisDamage)),
    stat('Радиус взрыва', (s) => fmt1(s.hostLysisRadius)),
  ],
  factory: [
    stat('РНК с клетки', (s) => fmtInt(s.hostLysisRna)),
    stat('Урон взрыва', (s) => fmt1(s.hostLysisDamage)),
  ],
  regen: [stat('Регенерация', (s) => fmt1(s.stage.regen))],
  heal: [stat('Прочность', (s) => fmtInt(s.stage.hp))],
};

export function getUpgradeBeforeAfter(s: RunState, def: UpgradeDef): BeforeAfterStat[] | null {
  if (def.kind === 'evolution' || def.kind === 'legendary') return null;
  const readers = READERS[def.id];
  if (!readers) return null;
  const after = cloneState(s);
  def.apply(after);
  return readers.map((read) => {
    const before = read(s);
    const next = read(after);
    return { label: before.label, before: before.text, after: next.text };
  });
}

/**
 * The segment appended to the card's effect line, e.g.
 * «10 → 12,5 · → ГИПЕРШИП» or «26 → 33,8 · 150 → 162» (no hint).
 * Returns null when the card has nothing to compare.
 */
export function formatUpgradeEffectSuffix(s: RunState, def: UpgradeDef): string | null {
  const lines = getUpgradeBeforeAfter(s, def);
  if (!lines) return null;
  const values = lines.map((l) => `${l.before} → ${l.after}`).join(' · ');
  if (def.evolutionHint) return `${values} · → ${EVOLUTION_NAMES[def.evolutionHint]}`;
  return values;
}
