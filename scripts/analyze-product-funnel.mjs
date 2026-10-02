#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = resolve(process.argv[2] ?? process.env.ANALYTICS_STORE ?? 'server/data/store.json');
const raw = JSON.parse(readFileSync(source, 'utf8'));
const events = Array.isArray(raw.analyticsEvents) ? raw.analyticsEvents : [];
const day = 86_400_000;
const funnel = ['app_open', 'run_start', 'run_60s', 'boss1', 'heart', 'replay'];
const byActor = new Map();
for (const row of events) {
  if (!row || typeof row !== 'object' || typeof row.actor !== 'string' || typeof row.event !== 'string') continue;
  if (!byActor.has(row.actor)) byActor.set(row.actor, []);
  byActor.get(row.actor).push(row);
}
for (const rows of byActor.values()) rows.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));

const actorsFor = (name) => new Set(events.filter((e) => e?.event === name).map((e) => e.actor));
const counts = funnel.map((name) => [name, actorsFor(name).size]);
const base = Math.max(1, counts[0]?.[1] ?? 0);
console.log(`Analytics source: ${source}`);
console.log(`Events: ${events.length}; unique actors: ${byActor.size}`);
console.log('\nCore funnel (unique verified actors):');
for (const [name, count] of counts) console.log(`${name.padEnd(12)} ${String(count).padStart(6)}  ${(count / base * 100).toFixed(1)}% of app_open`);

const onboarding = events.filter((e) => e?.event === 'onboarding_step');
const steps = ['move', 'autoAttack', 'pickup', 'levelUp', 'infect'];
console.log('\nFirst-60s onboarding:');
for (const step of steps) {
  const rows = onboarding.filter((e) => e?.props?.step === step && e?.props?.outcome === 'completed');
  const actors = new Set(rows.map((e) => e.actor));
  const times = rows.map((e) => Number(e?.props?.runTimeMs)).filter(Number.isFinite).sort((a,b)=>a-b);
  const median = times.length ? times[Math.floor(times.length / 2)] : null;
  console.log(`${step.padEnd(12)} actors=${String(actors.size).padStart(5)} median=${median == null ? '—' : `${Math.round(median/1000)}s`}`);
}
const exits = events.filter((e) => e?.event === 'onboarding_exit');
const exitCounts = new Map();
for (const e of exits) {
  const key = `${e?.props?.reason ?? 'unknown'} @ ${e?.props?.step ?? 'unknown'}`;
  exitCounts.set(key, (exitCounts.get(key) ?? 0) + 1);
}
if (exitCounts.size) {
  console.log('\nOnboarding exits:');
  for (const [key, count] of [...exitCounts].sort((a,b)=>b[1]-a[1])) console.log(`${key}: ${count}`);
}

let eligible = 0, returnedD1 = 0;
for (const rows of byActor.values()) {
  const opens = rows.filter((r) => r.event === 'app_open' && Number.isFinite(r.ts));
  if (!opens.length) continue;
  const first = opens[0].ts;
  const lastTs = events.reduce((m,e)=>Math.max(m, Number(e?.ts)||0), 0);
  if (lastTs < first + 2 * day) continue; // cohort must have a complete next-day observation window
  eligible += 1;
  if (opens.some((r) => r.ts >= first + day && r.ts < first + 2 * day)) returnedD1 += 1;
}
console.log(`\nD1 return: ${returnedD1}/${eligible || 0}${eligible ? ` (${(returnedD1/eligible*100).toFixed(1)}%)` : ''}`);

const referralOpens = events.filter((e) => e?.event === 'referral' && e?.props?.action === 'open');
const referralActors = new Set(referralOpens.map((e) => e.actor));
const referralStarters = new Set();
for (const actor of referralActors) {
  const rows = byActor.get(actor) ?? [];
  const firstRef = rows.find((e) => e.event === 'referral' && e?.props?.action === 'open');
  if (firstRef && rows.some((e) => e.event === 'run_start' && (e.ts ?? 0) >= (firstRef.ts ?? 0))) referralStarters.add(actor);
}
console.log(`Referral open → run_start: ${referralStarters.size}/${referralActors.size}${referralActors.size ? ` (${(referralStarters.size/referralActors.size*100).toFixed(1)}%)` : ''}`);