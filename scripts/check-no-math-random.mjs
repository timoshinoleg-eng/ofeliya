/**
 * Determinism lint (harness track B): gameplay code must not draw from
 * unseeded randomness or the wall clock.
 *
 * Fails when `Math.random` or `Date.now` appears in `src/game/**`, except:
 *
 * - `src/game/RunRng.ts` — the one-time seed fallback inside
 *   `generateRunSeed`, used only when `crypto.getRandomValues` is
 *   unavailable (restricted WebViews). It is NOT a gameplay roll, and an
 *   explicit seed makes the path unreachable. The exception needs BOTH an
 *   explicit marker comment in the code (`check-no-math-random: allowed`,
 *   on the call line or directly above it) AND the allowlist entry below.
 * - `Date.now` in `src/game/meta/**`, `src/game/shop/**` and
 *   `src/game/collection/**` — the commerce/meta domain (booster and
 *   season-pass expiry, receipts, sync queue timestamps, collection
 *   unlock timestamps). Those are real-world wall-clock values, not run
 *   simulation state, so they are outside the determinism scope.
 *   `Math.random` stays banned there too.
 *
 * Everything else in `src/game/**` — including the simulation subdirs
 * (achievements, daily, lab, skins) — must use the seeded `RunRng`
 * streams and injected time. Comments are stripped before matching, so
 * mentioning `Math.random()` in a doc comment is fine.
 *
 * Usage: `npm run test:no-math-random`
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const GAME_DIR = join(ROOT, 'src/game');
const MARKER = 'check-no-math-random: allowed';

/** Files whose Math.random/Date.now call is allowed, with the reason. */
const CALL_ALLOWLIST = new Map([
  [
    'src/game/RunRng.ts',
    'one-time seed fallback in generateRunSeed (crypto unavailable); not a gameplay roll',
  ],
]);

/** Directories where Date.now (wall clock) is allowed; Math.random never is. */
const DATE_NOW_DIRS = [
  { dir: 'src/game/meta/', reason: 'meta progression: booster/season-pass expiry is real-world time' },
  { dir: 'src/game/shop/', reason: 'commerce: receipts, grants and sync timestamps are real-world time' },
  { dir: 'src/game/collection/', reason: 'meta progression: collection/achievement timestamps are real-world time; the clock is injectable' },
];

const PATTERNS = [
  { name: 'Math.random', regex: /\bMath\.random\b/g },
  { name: 'Date.now', regex: /\bDate\.now\b/g },
];

/**
 * Strip `//` and `/* ... *\/` comments while respecting string literals, so
 * `//` inside a URL or a doc comment mentioning Math.random() cannot trip
 * the gate. Template-literal interpolations are kept: `${Math.random()}`
 * is a real call and must be caught.
 */
function stripComments(source) {
  let out = '';
  let i = 0;
  let quote = null; // "'", '"', or '`' while inside a string literal
  let escaped = false;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (quote) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const block = end === -1 ? source.slice(i) : source.slice(i, end + 2);
      // Keep newlines so line numbers stay aligned with the original file.
      out += block.replace(/[^\n]/g, ' ');
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function listTsFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listTsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.ts')) found.push(full);
  }
  return found;
}

function lineNumberBefore(text, index) {
  return text.slice(0, index).split('\n').length;
}

function main() {
  if (!statSync(GAME_DIR, { throwIfNoEntry: false })?.isDirectory()) {
    console.error('check-no-math-random: src/game/ not found — run from the repo root');
    process.exit(1);
  }

  const violations = [];
  const allowlistHits = new Set();

  for (const file of listTsFiles(GAME_DIR)) {
    const rel = relative(ROOT, file).replaceAll('\\', '/');
    const raw = readFileSync(file, 'utf8');
    const stripped = stripComments(raw);
    const rawLines = raw.split('\n');

    for (const { name, regex } of PATTERNS) {
      for (const match of stripped.matchAll(regex)) {
        const line = lineNumberBefore(stripped, match.index);

        // Date.now in the commerce/meta domain is real-world time, allowed.
        if (name === 'Date.now' && DATE_NOW_DIRS.some(({ dir }) => rel.startsWith(dir))) {
          continue;
        }

        const reason = CALL_ALLOWLIST.get(rel);
        if (reason !== undefined) {
          const markerOnLine =
            rawLines[line - 1]?.includes(MARKER) || rawLines[line - 2]?.includes(MARKER);
          if (!markerOnLine) {
            violations.push(
              `${rel}:${line}: ${name} is allowlisted but lacks the '${MARKER}' ` +
                `comment on the call line or directly above it`
            );
          } else {
            allowlistHits.add(rel);
          }
          continue;
        }

        violations.push(
          `${rel}:${line}: ${name} in gameplay code — use a seeded RunRng stream ` +
            `or injected time instead`
        );
      }
    }
  }

  // Keep the allowlist honest: an entry with no matching call is stale.
  for (const rel of CALL_ALLOWLIST.keys()) {
    if (!allowlistHits.has(rel)) {
      violations.push(
        `${rel}: stale allowlist entry — no ${MARKER} call found; remove the entry`
      );
    }
  }

  if (violations.length > 0) {
    console.error('check-no-math-random: FAILED\n' + violations.map((v) => `  ${v}`).join('\n'));
    process.exit(1);
  }
  console.log('no unseeded randomness in src/game: ok');
}

main();
