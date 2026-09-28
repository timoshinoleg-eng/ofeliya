#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FRAME_MS = 1000 / 60;

function decay(base, deltaMs) {
  return Math.pow(base, deltaMs / FRAME_MS);
}

function simulate(base, fps, durationMs) {
  const stepMs = 1000 / fps;
  const steps = Math.round(durationMs / stepMs);
  let value = 1;
  for (let i = 0; i < steps; i += 1) {
    value *= decay(base, stepMs);
  }
  return value;
}

for (const base of [0.82, 0.85]) {
  const at60 = simulate(base, 60, 1000);
  const at30 = simulate(base, 30, 1000);
  const at120 = simulate(base, 120, 1000);
  assert.ok(Math.abs(at30 - at60) < 1e-12, `30 Hz drift for base ${base}`);
  assert.ok(Math.abs(at120 - at60) < 1e-12, `120 Hz drift for base ${base}`);
}

const enemy = readFileSync(new URL('../src/game/Enemy.ts', import.meta.url), 'utf8');
const gem = readFileSync(new URL('../src/game/Gem.ts', import.meta.url), 'utf8');

assert.match(enemy, /Math\.pow\(0\.82,\s*delta\s*\/\s*\(1000\s*\/\s*60\)\)/);
assert.doesNotMatch(enemy, /knockX\s*\*=\s*0\.82/);
assert.doesNotMatch(enemy, /knockY\s*\*=\s*0\.82/);

assert.match(gem, /Math\.pow\(0\.85,\s*delta\s*\/\s*\(1000\s*\/\s*60\)\)/);
assert.doesNotMatch(gem, /velocity\.x\s*\*\s*0\.85/);
assert.doesNotMatch(gem, /velocity\.y\s*\*\s*0\.85/);

console.log('Frame-rate decay smoke: OK (30/60/120 Hz equivalent over equal elapsed time)');
