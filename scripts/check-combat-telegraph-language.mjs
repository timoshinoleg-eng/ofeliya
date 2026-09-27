import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-telegraph-language-'));
const require = createRequire(import.meta.url);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/game/CombatTelegraphLanguage.ts',
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

  const {
    COMBAT_TELEGRAPH_PATTERNS,
    combatTelegraphPulse,
    combatTelegraphCountdown,
  } = require(join(temp, 'game/CombatTelegraphLanguage.js'));

  const normal = COMBAT_TELEGRAPH_PATTERNS.normal;
  const dangerous = COMBAT_TELEGRAPH_PATTERNS.dangerous;
  const critical = COMBAT_TELEGRAPH_PATTERNS.critical;

  assert(normal.ringCount < dangerous.ringCount, 'dangerous warning must add radial geometry');
  assert(dangerous.ringCount < critical.ringCount, 'critical warning must add another radial layer');
  assert(normal.tickCount < dangerous.tickCount, 'dangerous warning needs non-color tick cues');
  assert(dangerous.tickCount < critical.tickCount, 'critical warning needs stronger tick density');
  assert(
    normal.laneChevronCount < dangerous.laneChevronCount &&
      dangerous.laneChevronCount < critical.laneChevronCount,
    'directional severity must be encoded by chevron count'
  );
  assert(
    normal.pulseHz < dangerous.pulseHz && dangerous.pulseHz < critical.pulseHz,
    'animation rhythm must escalate with threat level'
  );
  assert(
    normal.lineWidth < dangerous.lineWidth && dangerous.lineWidth < critical.lineWidth,
    'outline weight must escalate with threat level'
  );

  for (const level of ['normal', 'dangerous', 'critical']) {
    const early = combatTelegraphCountdown(level, 0);
    const late = combatTelegraphCountdown(level, 1);
    assert(late.alpha > early.alpha, `${level} countdown must become more opaque near impact`);
    assert(late.scale < early.scale, `${level} countdown must contract toward impact`);

    for (const t of [0, 125, 500, 1500, 10_000]) {
      const pulse = combatTelegraphPulse(level, t);
      assert(pulse.alpha >= 0 && pulse.alpha <= 1, `${level} pulse alpha out of range`);
      assert(pulse.scale > 0.8 && pulse.scale < 1.2, `${level} pulse scale out of range`);
    }
  }

  const source = readFileSync(resolve('src/game/CombatTelegraphLanguage.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert(!/Math\.random\s*\(/.test(source), 'telegraph language must remain deterministic');
  assert(!/from ['"]phaser['"]/.test(source), 'telegraph decision language must stay Phaser-free');

  const enemySource = readFileSync(resolve('src/game/Enemy.ts'), 'utf8');
  assert(
    /drawDirectionalCombatTelegraph/.test(enemySource) &&
      /drawRadialCombatTelegraph/.test(enemySource),
    'enemy windups are not using the shared telegraph renderer'
  );
  assert(
    /combatTelegraphPulse\('dangerous'/.test(enemySource) &&
      /combatTelegraphCountdown\('critical'/.test(enemySource),
    'enemy telegraph rhythm is not using the shared threat language'
  );

  const rendererSource = readFileSync(resolve('src/game/CombatTelegraphRenderer.ts'), 'utf8');
  assert(
    /tickCount/.test(rendererSource) &&
      /laneChevronCount/.test(rendererSource) &&
      /DARK_UNDERLAY/.test(rendererSource),
    'renderer lost geometry/contrast channels required for color-independent warnings'
  );

  console.log('combat telegraph language deterministic smoke: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
