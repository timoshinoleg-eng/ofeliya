/**
 * Client feature flags contract — ported Phase 2 (events.doubleRna,
 * difficulty.earlyGame) on top of the existing ClientFeatureFlags resolver.
 *
 * Covers the pure logic (resolveClientFlags): defaults, boolean `?flag.`
 * overrides, numeric `?flag.` overrides, the QA gate (overrides inert
 * without qaTools), and invalid values ignored. Compiles the TS module
 * with tsc like the other node-side contract tests.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-client-flags-'));
const require = createRequire(import.meta.url);

const assert = (condition, message) => {
  if (!condition) throw new Error(`client-feature-flags: ${message}`);
};
const eq = (actual, expected, message) =>
  assert(actual === expected, `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
const deepEq = (actual, expected, message) =>
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/systems/ClientFeatureFlags.ts',
      '--target', 'ES2020',
      '--module', 'commonjs',
      '--moduleResolution', 'node',
      '--rootDir', 'src',
      '--outDir', temp,
      '--skipLibCheck', 'true',
      '--esModuleInterop', 'true',
    ],
    { stdio: 'inherit' }
  );

  const { resolveClientFlags } = require(join(temp, 'systems/ClientFeatureFlags.js'));

  // Defaults: Phase 2 flags are inert (doubleRna off, earlyGame 1 = authored).
  deepEq(
    resolveClientFlags(),
    {
      skins: { gallery: true },
      collection: { enabled: true },
      juice: { enhanced: true },
      telemetry: { web: false },
      events: { doubleRna: false },
      difficulty: { earlyGame: 1 },
    },
    'defaults'
  );

  // Boolean override, QA-gated.
  eq(
    resolveClientFlags({ qaTools: true, search: '?flag.events.doubleRna=true' }).events.doubleRna,
    true,
    'doubleRna override on'
  );
  eq(
    resolveClientFlags({ qaTools: true, search: '?flag.events.doubleRna=1' }).events.doubleRna,
    false,
    'doubleRna "1" ignored: this resolver accepts only true/false (pre-existing convention)'
  );
  eq(
    resolveClientFlags({ qaTools: true, search: '?flag.events.doubleRna=false' }).events.doubleRna,
    false,
    'doubleRna override off'
  );
  eq(
    resolveClientFlags({ search: '?flag.events.doubleRna=true' }).events.doubleRna,
    false,
    'doubleRna override inert without qaTools'
  );
  eq(
    resolveClientFlags({ qaTools: true, search: '?flag.events.doubleRna=yes' }).events.doubleRna,
    false,
    'doubleRna garbage value ignored'
  );

  // Numeric override, QA-gated, 0 < n <= 10.
  eq(
    resolveClientFlags({ qaTools: true, search: '?flag.difficulty.earlyGame=1.25' }).difficulty.earlyGame,
    1.25,
    'earlyGame override 1.25'
  );
  eq(
    resolveClientFlags({ qaTools: true, search: '?flag.difficulty.earlyGame=0.5' }).difficulty.earlyGame,
    0.5,
    'earlyGame override 0.5'
  );
  eq(
    resolveClientFlags({ qaTools: true, search: '?flag.difficulty.earlyGame=10' }).difficulty.earlyGame,
    10,
    'earlyGame override 10 (upper bound)'
  );
  eq(
    resolveClientFlags({ qaTools: true, search: '?flag.difficulty.earlyGame=0' }).difficulty.earlyGame,
    1,
    'earlyGame 0 ignored (must be > 0)'
  );
  eq(
    resolveClientFlags({ qaTools: true, search: '?flag.difficulty.earlyGame=-2' }).difficulty.earlyGame,
    1,
    'earlyGame negative ignored'
  );
  eq(
    resolveClientFlags({ qaTools: true, search: '?flag.difficulty.earlyGame=11' }).difficulty.earlyGame,
    1,
    'earlyGame above 10 ignored'
  );
  eq(
    resolveClientFlags({ qaTools: true, search: '?flag.difficulty.earlyGame=abc' }).difficulty.earlyGame,
    1,
    'earlyGame non-numeric ignored'
  );
  eq(
    resolveClientFlags({ search: '?flag.difficulty.earlyGame=2' }).difficulty.earlyGame,
    1,
    'earlyGame override inert without qaTools'
  );

  // Unknown flags are ignored; pre-existing flags still resolve.
  deepEq(
    resolveClientFlags({ qaTools: true, search: '?flag.unknown.key=1&flag.juice.enhanced=false' }),
    {
      skins: { gallery: true },
      collection: { enabled: true },
      juice: { enhanced: false },
      telemetry: { web: false },
      events: { doubleRna: false },
      difficulty: { earlyGame: 1 },
    },
    'unknown keys ignored, known flags resolve'
  );

  // Results are frozen (no accidental mutation of the shared flags object).
  const frozen = resolveClientFlags();
  assert(Object.isFrozen(frozen) && Object.isFrozen(frozen.events) && Object.isFrozen(frozen.difficulty),
    'resolved flags are frozen');

  console.log('client-feature-flags: OK');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
