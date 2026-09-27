import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-run-identity-'));
const require = createRequire(import.meta.url);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/game/RunIdentity.ts',
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

  const { assessRunIdentity, masteryTracks, nextMasteryGoal } = require(
    join(temp, 'game/RunIdentity.js')
  );

  const base = (over = {}) => ({
    stacks: {},
    stageBuilds: {},
    evolutions: [],
    legendaryIds: [],
    hostCellsInfected: 0,
    ...over,
  });

  const projectile = assessRunIdentity(
    base({
      stageBuilds: {
        bloodstream: {
          level: 8,
          stacks: { dmg: 3, pierce: 2, multi: 2 },
          evolutions: ['prism'],
        },
      },
      evolutions: ['prism'],
      legendaryIds: ['split-geometry'],
    })
  );
  assert(projectile.id === 'projectile' && projectile.focused, 'projectile focus was not recognized');
  assert(projectile.signals.includes('ГИПЕРШИП'), 'projectile evolution signal missing');

  const control = assessRunIdentity(
    base({
      stacks: { orbit: 3, nova: 2, speed: 2 },
      evolutions: ['halo'],
      legendaryIds: ['zero-point'],
    })
  );
  assert(control.id === 'orbit-control' && control.focused, 'orbit/control focus was not recognized');

  const lysis = assessRunIdentity(
    base({
      stacks: { infect: 3, lysis: 3, factory: 2 },
      evolutions: ['singularity'],
      legendaryIds: ['lysis-chain'],
      hostCellsInfected: 6,
    })
  );
  assert(lysis.id === 'infection-lysis' && lysis.focused, 'infection/lysis focus was not recognized');
  assert(lysis.signals.includes('клеточный маршрут'), 'host-cell tactical signal missing');

  const hybrid = assessRunIdentity(
    base({ stacks: { dmg: 1, orbit: 1, infect: 1 }, hostCellsInfected: 1 })
  );
  assert(hybrid.id === 'hybrid' && !hybrid.focused, 'shallow mixed build should stay hybrid');

  // Per-stage reset must not double-count the same stack investment.
  const once = assessRunIdentity(base({ stacks: { dmg: 3, pierce: 2 } }));
  const repeated = assessRunIdentity(
    base({
      stacks: { dmg: 3, pierce: 2 },
      stageBuilds: {
        bloodstream: { level: 8, stacks: { dmg: 3, pierce: 2 }, evolutions: [] },
        heart: { level: 8, stacks: { dmg: 3, pierce: 2 }, evolutions: [] },
      },
    })
  );
  assert(once.score === repeated.score, 'stage reset double-counted build depth');

  const tracks = masteryTracks({
    evolutionsSeen: ['prism', 'halo'],
    legendarySeen: ['split-geometry'],
  });
  const projectileTrack = tracks.find((track) => track.id === 'projectile');
  const controlTrack = tracks.find((track) => track.id === 'orbit-control');
  const lysisTrack = tracks.find((track) => track.id === 'infection-lysis');
  assert(projectileTrack?.complete && projectileTrack.progress === 2, 'projectile mastery did not complete');
  assert(controlTrack?.progress === 1 && /НУЛЕВУЮ ТОЧКУ/.test(controlTrack.nextGoal), 'control next goal drifted');
  assert(lysisTrack?.progress === 0 && /СИНГУЛЯРНОСТЬ/.test(lysisTrack.nextGoal), 'lysis first mastery goal drifted');

  assert(
    /ветка освоена/i.test(nextMasteryGoal(projectile, {
      evolutionsSeen: ['prism'],
      legendarySeen: ['split-geometry'],
    })),
    'completed focused track did not report mastery'
  );

  const source = readFileSync(resolve('src/game/RunIdentity.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert(!/Math\.random\s*\(/.test(source), 'RunIdentity must stay deterministic');
  assert(!/from ['"]phaser['"]/.test(source), 'RunIdentity must stay Phaser-free');

  console.log('run identity/mastery deterministic smoke: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
