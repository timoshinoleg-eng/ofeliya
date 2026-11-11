/**
 * Run result — real Codex openings.
 *
 * The defect (base 2bd6320): the result plate «Открыто в Кодексе» used
 * `newAchievements.length` as the Codex count, although Codex entries come
 * from the known legendaries and evolutions (`SaveSystem.legendarySeen` /
 * `evolutionsSeen`). So a run that opened a legendary but unlocked no
 * achievement showed NO plate at all, and a run that unlocked achievements
 * but opened nothing claimed «+N записей» that did not exist.
 *
 * This test exercises the fix's pure core: `computeNewCodexEntries` takes
 * the run's chosen ids and the save's seen sets BEFORE `recordRun` and
 * returns exactly the entries the run opened for the first time.
 * Achievements are deliberately NOT an input: a new achievement without an
 * opening must produce an empty diff (state 1), and an opening without an
 * achievement must still be listed (state 2).
 *
 * Method (same pattern as tests/mutation-before-after.mjs): the real
 * TypeScript source is compiled to a temp dir and required, so the test
 * exercises the game's own code.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);

const temp = mkdtempSync(join(resolve('.'), '.tmp-ofeliya-codex-'));
writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'commonjs' }));

const assert = (condition, message) => {
  if (!condition) throw new Error(`run-result-codex-openings: ${message}`);
};
const eq = (actual, expected, message) =>
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/game/runCodexOpenings.ts',
      '--target',
      'ES2020',
      '--module',
      'commonjs',
      '--moduleResolution',
      'node',
      '--rootDir',
      'src',
      '--outDir',
      temp,
      '--skipLibCheck',
      'true',
      '--esModuleInterop',
      'true',
    ],
    { stdio: 'inherit' }
  );

  // eslint-disable-next-line no-require-imports
  const { computeNewCodexEntries } = require(join(temp, 'game/runCodexOpenings.js'));

  const diff = (runLegendary, runEvolutions, seenLegendary, seenEvolutions) =>
    computeNewCodexEntries(runLegendary, runEvolutions, seenLegendary, seenEvolutions);

  // 1. New achievement without an opening: the run chose nothing new for the
  // Codex. The old plate would have shown «+1 запись» from the achievement
  // count; the diff must be empty.
  eq(diff([], [], [], []), [], 'achievement without opening');

  // 2. First opening of a legendary: named, with its kind.
  eq(
    diff(['core-predator'], [], [], []),
    [{ kind: 'legendary', id: 'core-predator' }],
    'first legendary opening'
  );

  // 3. Repeat choice of a known card: it stays in the run list, but it is
  // not a new opening.
  eq(diff(['core-predator'], [], ['core-predator'], []), [], 'repeat choice of a known card');

  // 4. Two openings in different tabs: evolution first (synergies), then
  // legendary — the order the result screen renders them in.
  eq(
    diff(['zero-point'], ['singularity'], [], []),
    [
      { kind: 'evolution', id: 'singularity' },
      { kind: 'legendary', id: 'zero-point' },
    ],
    'two openings in different tabs'
  );

  // 5. No openings: everything the run chose was already known.
  eq(
    diff(['core-predator'], ['singularity'], ['core-predator'], ['singularity']),
    [],
    'no openings'
  );

  // 6. A run cannot choose the same card twice, but the diff must not
  // duplicate it if it ever sees a duplicated list.
  eq(
    diff(['core-predator', 'core-predator'], [], [], []),
    [{ kind: 'legendary', id: 'core-predator' }],
    'duplicated run ids are deduped'
  );

  // 7. A known evolution next to a new legendary: only the legendary opens.
  eq(
    diff(['zero-point'], ['singularity'], [], ['singularity']),
    [{ kind: 'legendary', id: 'zero-point' }],
    'known evolution next to a new legendary'
  );

  console.log('run-result-codex-openings: ok (7 cases)');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
