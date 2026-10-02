#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const required = [
  'android-launch','android-first-run','android-full-run','android-background-resume',
  'android-restart','android-share','android-daily-invite','android-viewport',
  'ios-launch','ios-first-run','ios-full-run','ios-background-resume',
  'ios-restart','ios-share','ios-daily-invite','ios-viewport',
];
const file = resolve(process.argv[2] ?? 'artifacts/mobile-acceptance.json');
const doc = JSON.parse(readFileSync(file, 'utf8'));
if (!Array.isArray(doc.checks)) throw new Error('checks[] is required');
const byId = new Map(doc.checks.map((c) => [c.id, c]));
const failures = [];
for (const id of required) {
  const check = byId.get(id);
  if (!check) { failures.push(`${id}: missing`); continue; }
  if (check.status !== 'pass') failures.push(`${id}: status=${check.status ?? 'missing'}`);
  if (typeof check.device !== 'string' || !check.device.trim()) failures.push(`${id}: device missing`);
  if (typeof check.clientVersion !== 'string' || !check.clientVersion.trim()) failures.push(`${id}: clientVersion missing`);
  if (typeof check.evidence !== 'string' || !check.evidence.trim()) failures.push(`${id}: evidence missing`);
  if (!Number.isFinite(Date.parse(check.testedAt ?? ''))) failures.push(`${id}: testedAt invalid`);
}
if (failures.length) {
  console.error('mobile acceptance evidence: FAIL');
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log(`mobile acceptance evidence: PASS (${required.length}/${required.length})`);