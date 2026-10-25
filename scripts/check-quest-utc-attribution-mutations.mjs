import { execFileSync } from 'node:child_process';
import { readdirSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Adversarial gate for the UTC attribution of the no-damage streak (issue #237).
 *
 * The quest core mutation gate (`scripts/check-quest-core-mutations.mjs`) proves the
 * guarantees of the quest core as a whole. This gate covers the temporal attribution
 * that the repair added: the midnight split of a streak. Every mutation below breaks
 * exactly one of the rules of that split, and the contract checks have to go red for
 * every one of them — otherwise the rule is not really covered.
 *
 * Two suites take part:
 *
 *  - `scripts/check-quest-utc-attribution.mjs` — the attribution itself, against an
 *    independent calendar reference model.
 *  - `scripts/check-quest-runtime.mjs` — the producer contracts, including the F-5
 *    terminal force: the final suppressed sample has to be flushed at the finish, so
 *    that a streak of 60 real seconds stays 60 and never falls back to 59.
 *
 * The whole run happens in a non-UTC time zone on purpose: the attribution is a
 * calendar question, and a local-time regression is only visible when the device is
 * not on UTC.
 */

function copyFixture(source, target) {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name), to = join(target, entry.name);
    if (entry.isDirectory()) copyFixture(from, to);
    else writeFileSync(to, readFileSync(from));
  }
}

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-quest-utc-mutants-'));
const TIME_ZONE = 'Asia/Tokyo';
const SUITES = [
  'scripts/check-quest-utc-attribution.mjs',
  'scripts/check-quest-runtime.mjs',
];

const MUTATIONS = [
  {
    name: 'CONTROL: a semantically empty change',
    control: true,
    edits: [
      {
        file: 'questEngine.ts',
        find: '  private duplicateEvents = 0;',
        replace: '  private duplicateEvents = 0; // control',
      },
    ],
  },

  // --- the midnight boundary ------------------------------------------------------------------

  {
    name: 'the midnight boundary is exclusive',
    edits: [
      {
        file: 'questEngine.ts',
        find: 'if (!(previousAtMs < dayStart && currentAtMs >= dayStart)) return null;',
        replace: 'if (!(previousAtMs < dayStart && currentAtMs > dayStart)) return null;',
      },
    ],
  },
  {
    // The previous sample that sits exactly on the midnight belongs to the new day
    // already, so the interval does not reach across it. The F-5 contract catches it.
    name: 'the midnight boundary is inclusive',
    edits: [
      {
        file: 'questEngine.ts',
        find: 'if (!(previousAtMs < dayStart && currentAtMs >= dayStart)) return null;',
        replace: 'if (!(previousAtMs <= dayStart && currentAtMs >= dayStart)) return null;',
      },
    ],
  },
  {
    name: 'the day bucket is the day after the current one',
    edits: [
      {
        file: 'questEngine.ts',
        find: 'const dayStart = Date.parse(`${this.state.dayKey}T00:00:00.000Z`);',
        replace: 'const dayStart = Date.parse(`${this.state.dayKey}T00:00:00.000Z`) + 86_400_000;',
      },
    ],
  },
  {
    name: 'the day bucket is the day before the current one',
    edits: [
      {
        file: 'questEngine.ts',
        find: 'const dayStart = Date.parse(`${this.state.dayKey}T00:00:00.000Z`);',
        replace: 'const dayStart = Date.parse(`${this.state.dayKey}T00:00:00.000Z`) - 86_400_000;',
      },
    ],
  },

  // --- the interval split ----------------------------------------------------------------------

  {
    name: 'the interval ends are swapped',
    edits: [
      {
        file: 'questEngine.ts',
        find: 'const insideDay = currentAtMs - dayStart;',
        replace: 'const insideDay = dayStart - currentAtMs;',
      },
    ],
  },
  {
    name: 'the observation interval is not split at all',
    edits: [
      {
        file: 'questEngine.ts',
        find: 'return currentStreakMs - Math.min(advance, insideDay);',
        replace: 'return currentStreakMs - advance;',
      },
    ],
  },
  {
    name: 'the streak is not capped by the part of the interval inside the day',
    edits: [
      {
        file: 'questEngine.ts',
        find: 'return currentStreakMs - Math.min(advance, insideDay);',
        replace: 'return currentStreakMs - insideDay;',
      },
    ],
  },
  {
    // Equivalent: a streak that did not advance is credited zero seconds by the
    // rollover baseline as well, so splitting it cannot change the counter.
    name: 'a streak that did not advance is still split',
    equivalent: true,
    edits: [
      {
        file: 'questEngine.ts',
        find: 'if (advance <= 0) return null;',
        replace: 'if (advance < 0) return null;',
      },
    ],
  },

  // --- the rounding ---------------------------------------------------------------------------

  {
    name: 'the streak of the day is rounded up instead of down',
    edits: [
      {
        file: 'questEngine.ts',
        find: 'progress = Math.floor(progress / 1000);',
        replace: 'progress = Math.ceil(progress / 1000);',
      },
    ],
  },
  {
    name: 'the streak of the day is rounded to the nearest second',
    edits: [
      {
        file: 'questEngine.ts',
        find: 'progress = Math.floor(progress / 1000);',
        replace: 'progress = Math.round(progress / 1000);',
      },
    ],
  },

  // --- the anchor -----------------------------------------------------------------------------

  {
    name: 'the wall clock of the sample is not persisted',
    edits: [
      {
        file: 'questEngine.ts',
        find: 'if (Number.isFinite(event.at)) this.state.lastTickAtMs = event.at;\n        else delete this.state.lastTickAtMs;',
        replace: 'delete this.state.lastTickAtMs;',
      },
    ],
  },
  {
    name: 'the wall clock of the sample is never read',
    edits: [
      {
        file: 'questEngine.ts',
        find: 'this.state.lastTickAtMs ?? Number.NaN,',
        replace: 'Number.NaN,',
      },
    ],
  },
  {
    // Equivalent: the restored streak is the anchor of the first sample after the
    // restore, so that sample cannot advance the streak and cannot be split.
    name: 'a restored run keeps the wall clock of the previous run',
    equivalent: true,
    edits: [
      {
        file: 'questEngine.ts',
        find: '    delete this.state.lastTickTimeMs;\n    delete this.state.lastTickAtMs;',
        replace: '    delete this.state.lastTickTimeMs;',
      },
    ],
  },

  // --- the F-5 terminal force -----------------------------------------------------------------

  {
    // Damage can offset the streak clock from whole run seconds. A suppressed
    // sample can then complete a streak second before the next hit resets it.
    name: 'the final suppressed sample is omitted',
    edits: [
      {
        file: 'questRuntime.ts',
        find: `    if (hit && this.lastTimeMs > this.sentTimeMs) {
      this.send({kind:'run_tick',timeMs:this.lastTimeMs,noDamageMs:this.streakMs},\`tick:\${this.lastTimeMs}\`);
      this.sentTimeMs = this.lastTimeMs;
    }`,
        replace: `    if (hit && this.lastTimeMs > this.sentTimeMs) {
      // the suppressed sample was not flushed
    }`,
      },
    ],
  },
  {
    name: 'the final suppressed sample is delivered twice',
    edits: [
      {
        file: 'questRuntime.ts',
        find: `      this.send({kind:'run_tick',timeMs:this.lastTimeMs,noDamageMs:this.streakMs},\`tick:\${this.lastTimeMs}\`);
      this.sentTimeMs = this.lastTimeMs;`,
        replace: `      this.send({kind:'run_tick',timeMs:this.lastTimeMs,noDamageMs:this.streakMs},\`tick:\${this.lastTimeMs}\`);`,
      },
    ],
  },
  {
    name: 'a forced sample may replace the pending one',
    edits: [
      {
        file: 'questRuntime.ts',
        find: 'const pending = this.lastTimeMs > this.sentTimeMs && noDamageMs === this.streakMs;',
        replace: 'const pending = this.lastTimeMs > this.sentTimeMs;',
      },
    ],
  },
];

function runSuites(cwd) {
  for (const suite of SUITES) {
    try {
      execFileSync(process.execPath, [suite], {
        cwd,
        stdio: 'pipe',
        env: { ...process.env, TZ: TIME_ZONE },
      });
    } catch (error) {
      const stdout = error.stdout ? error.stdout.toString() : '';
      const stderr = error.stderr ? error.stderr.toString() : '';
      return { ok: false, output: `${stdout}\n${stderr}` };
    }
  }
  return { ok: true, output: '' };
}

let caught = 0;
let controls = 0;
let equivalents = 0;
const failures = [];

try {
  copyFixture(resolve('src/quests'), join(temp, 'src/quests'));
  copyFixture(resolve('scripts'), join(temp, 'scripts'));
  symlinkSync(join(resolve('.'), 'node_modules'), join(temp, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');

  const baseline = runSuites(temp);
  if (!baseline.ok) {
    console.error('the unmutated quest core must pass the attribution checks before any mutation runs');
    console.error(baseline.output);
    process.exit(1);
  }

  for (const mutation of MUTATIONS) {
    // The whole quest core is restored before every mutation. Without this a mutation
    // would inherit the previous mutation's content and would prove nothing at all.
    copyFixture(resolve('src/quests'), join(temp, 'src/quests'));

    const touched = new Map();
    let applicable = true;

    for (const edit of mutation.edits) {
      const path = join(temp, 'src/quests', edit.file);
      const pristine = touched.has(edit.file)
        ? touched.get(edit.file)
        : readFileSync(resolve('src/quests', edit.file), 'utf8').replace(/\r\n/g, '\n');
      if (!pristine.includes(edit.find)) {
        failures.push(`${mutation.name}: the mutation no longer matches the source of ${edit.file}`);
        applicable = false;
        break;
      }
      touched.set(edit.file, pristine.replace(edit.find, edit.replace));
    }
    if (!applicable) continue;

    for (const [file, content] of touched) {
      writeFileSync(join(temp, 'src/quests', file), content);
    }

    const result = runSuites(temp);

    if (mutation.control) {
      if (result.ok) {
        controls += 1;
      } else {
        failures.push(`${mutation.name}: the control mutation must not change the result`);
      }
      continue;
    }

    if (mutation.equivalent) {
      // An equivalent mutant has to leave the result untouched. That is the proof that
      // the rule it touches cannot be observed, so it is reported instead of counted.
      if (result.ok) {
        equivalents += 1;
      } else {
        failures.push(`${mutation.name}: the equivalent mutation changed the result`);
      }
      continue;
    }

    if (result.ok) {
      failures.push(`${mutation.name}: the attribution checks still passed`);
      continue;
    }

    // A compile error is not proof of anything. The mutation has to be caught by the
    // contract checks actually running, otherwise the guarantee it stands for is not
    // covered.
    if (/error TS\d+/.test(result.output)) {
      failures.push(`${mutation.name}: the contract checks failed to compile instead of failing a check`);
      continue;
    }

    // A catch has to be a real failed check, not an infrastructure accident.
    if (!/AssertionError/.test(result.output)) {
      failures.push(`${mutation.name}: the contract checks did not fail a check, they failed in some other way`);
      continue;
    }

    caught += 1;
  }

  const mutants = MUTATIONS.length - controls - equivalents;
  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    console.error(
      `quest UTC attribution mutations: ${caught}/${mutants} caught, ${failures.length} missed`
    );
    process.exit(1);
  }

  console.log(
    `quest UTC attribution mutations: ${caught}/${mutants} caught, ` +
      `${equivalents} equivalent, ${controls} control unchanged (time zone ${TIME_ZONE})`
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
