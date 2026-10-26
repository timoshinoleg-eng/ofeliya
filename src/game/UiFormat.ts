/**
 * OFELIYA — player-facing number formatting.
 *
 * Presentation-only. No gameplay imports, no state, no side effects, no timers.
 *
 * Rules this module owns:
 *  - a counter never wraps in the middle of a number (non-breaking thousands space);
 *  - a progress pair always reads `current / target`;
 *  - a countdown to the next UTC midnight always reads `HH:MM`.
 *
 * The canonical vocabulary stays in docs/GAME_LANGUAGE_BIBLE.md.
 */

/** U+00A0 NO-BREAK SPACE — keeps `2 617` on one line and on one word-wrap unit. */
export const NBSP = ' ';

/**
 * Thousands-separated integer.
 *
 * Non-negative, finite, floored. A counter is never shown as a negative number and
 * never as `NaN`: an unknown value is the caller's decision to omit, not this
 * function's decision to invent.
 */
export function fmtInt(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return safe
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** `current / target` — the progress pair used by quest cards and counters. */
export function fmtProgress(current: number, target: number): string {
  return `${fmtInt(current)} / ${fmtInt(target)}`;
}

/**
 * Countdown to the next UTC midnight, `HH:MM`.
 *
 * The quest rotation resets at UTC midnight, so the countdown is a duration under
 * 24 hours and is rendered as hours and minutes — `MM:SS` would either truncate the
 * last minute or spill into a three-digit minute count.
 */
export function fmtCountdown(ms: number): string {
  const safe = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  const totalMinutes = Math.floor(safe / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Title case for a canonical RU label that is stored in upper case.
 *
 * `КРОВОТОК` -> `Кровоток`, `СТАНДАРТ` -> `Стандарт`. The canonical terms themselves
 * do not change; only their presentation inside sentence-style menu copy does.
 */
export function toTitleCase(label: string): string {
  const lower = label.toLocaleLowerCase('ru-RU');
  return lower.charAt(0).toLocaleUpperCase('ru-RU') + lower.slice(1);
}

/**
 * Join the parts of a line with the `·` separator, skipping the empty ones.
 *
 * A missing value must remove its own segment, not leave a dangling `·`.
 */
export function joinSegments(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter((part) => part.length > 0)
    .join(' · ');
}
