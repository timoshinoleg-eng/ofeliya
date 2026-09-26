// Deterministic smoke for the donor-adapted onboarding state machine
// (donor: ricardo-foundry/canvas-vampire-survivors src/tutorial.js, MIT).
//
// Covers: hold-threshold movement step (incl. deadzone + stuck-input guard),
// time-accumulated auto-attack step, event-notified pickup/level-up/pause
// steps that ignore foreign notifications, finish/skip lifecycle, and counter
// reset on restart.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-onboarding-'));
const require = createRequire(import.meta.url);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/systems/onboardingState.ts',
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

  const { OnboardingState, ONBOARDING_STEPS } = require(join(temp, 'systems/onboardingState.js'));

  assert(ONBOARDING_STEPS.length === 5, 'five steps expected');
  assert(OnboardingState.TOTAL_STEPS === 5, 'TOTAL_STEPS matches');

  // --- step 1: move requires a sustained non-zero vector ---
  const a = new OnboardingState();
  a.start();
  assert(a.currentStep?.id === 'move', 'starts on the move step');
  a.tick(0.2, { x: 1, y: 0 });
  assert(a.currentStep?.id === 'move', 'a partial hold does not advance');
  a.tick(0.3, { x: 0, y: 0 });
  assert(a.currentStep?.id === 'move', 'zero-vector frames do not accumulate');
  a.tick(0.2, { x: 1, y: 0 });
  assert(a.currentStep?.id === 'autoAttack', 'advances after 0.4 s of held input');

  // stuck / sub-deadzone input must not fast-forward
  const b = new OnboardingState();
  b.start();
  b.tick(10, { x: 0.01, y: 0 });
  assert(b.currentStep?.id === 'move', 'sub-deadzone vector never advances');

  // --- step 2: auto-attack accumulates gameplay time without an event ---
  a.tick(0.7, null);
  assert(a.currentStep?.id === 'autoAttack', 'below the auto-attack threshold stays');
  a.tick(0.8, null);
  assert(a.currentStep?.id === 'pickup', 'advances after 1.5 s of gameplay time');

  // --- step 3: pickup is event-driven; foreign notifications are ignored ---
  a.notifyLevelUp();
  assert(a.currentStep?.id === 'pickup', 'levelUp notify ignored during the pickup step');
  a.tick(100, null);
  assert(a.currentStep?.id === 'pickup', 'tick is a no-op for event steps');
  a.notifyPickup();
  assert(a.currentStep?.id === 'levelUp', 'pickup notify advances');

  // --- step 4: level-up ---
  a.notifyPause();
  assert(a.currentStep?.id === 'levelUp', 'pause notify ignored during the levelUp step');
  a.notifyLevelUp();
  assert(a.currentStep?.id === 'pause', 'levelUp notify advances');

  // --- step 5: pause completes the machine ---
  a.notifyPause();
  assert(a.completed === true && a.active === false, 'finishes after the last step');
  a.notifyPickup();
  assert(a.completed === true, 'notifications after finish are no-ops');
  assert(a.currentStep === null, 'no current step after finish');

  // --- skip ---
  const c = new OnboardingState();
  c.start();
  c.skip();
  assert(c.skipped === true && c.active === false, 'skip ends the machine');

  // --- restart resets counters ---
  const d = new OnboardingState();
  d.start();
  d.tick(0.4, { x: 1, y: 0 });
  assert(d.currentStep?.id === 'autoAttack', 'reached autoAttack before restart');
  d.tick(1.4, null);
  d.start();
  assert(d.currentStep?.id === 'move', 'restart returns to the first step');
  d.tick(0.39, { x: 1, y: 0 });
  assert(d.currentStep?.id === 'move', 'counters were reset on restart');
  d.tick(0.01, { x: 1, y: 0 });
  assert(d.currentStep?.id === 'autoAttack', 'fresh accumulation works after restart');

  console.log('onboarding state machine smoke: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
