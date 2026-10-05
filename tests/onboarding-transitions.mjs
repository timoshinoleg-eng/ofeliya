import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync('src/systems/onboardingState.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, { module, exports: module.exports });
const { OnboardingState } = module.exports;
const events = [];
const onboarding = new OnboardingState((step) => events.push(step));
onboarding.start();
onboarding.tick(0.4, { x: 1, y: 0 });
onboarding.tick(1.5);
onboarding.notifyPickup();
// This notification happens in showLevelUp BEFORE the next UI tick.
onboarding.notifyLevelUp();
onboarding.notifyLevelUp();
assert.deepEqual(events, ['move', 'autoAttack', 'pickup', 'levelUp']);
onboarding.tick(10);
onboarding.notifyInfection();
onboarding.notifyInfection();
assert.deepEqual(events, ['move', 'autoAttack', 'pickup', 'levelUp', 'infect']);
onboarding.start();
onboarding.skip();
assert.equal(events.length, 5, 'skip is not a completed step');
console.log('onboarding transitions emit exactly once including out-of-tick levelUp: ok');
