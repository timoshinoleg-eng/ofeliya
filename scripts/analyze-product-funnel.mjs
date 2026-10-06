#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = resolve(process.argv[2] ?? process.env.ANALYTICS_STORE ?? 'server/data/store.json');
const raw = JSON.parse(readFileSync(source, 'utf8'));
const events = Array.isArray(raw?.analyticsEvents) ? raw.analyticsEvents : [];
const day = 86_400_000;
const comprehensionNames = [
  'host_cell_approached',
  'infection_started',
  'infection_interrupted',
  'infection_resumed',
  'first_lysis',
  'second_host_cell_completed_without_hint',
];
const comprehensionNameSet = new Set(comprehensionNames);
const funnel = ['app_open', 'run_start', 'run_60s', 'boss1', 'heart', 'replay'];
const byActor = new Map();
for (const row of events) {
  if (!row || typeof row !== 'object' || typeof row.actor !== 'string' || typeof row.event !== 'string') continue;
  const actorKey = `${typeof row.platform === 'string' ? row.platform : 'unknown'}\u0000${row.actor}`;
  if (!byActor.has(actorKey)) byActor.set(actorKey, []);
  byActor.get(actorKey).push(row);
}
for (const rows of byActor.values()) rows.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));

const actorKeyFor = (row) => typeof row?.actor === 'string' && row.actor.length
  ? `${typeof row.platform === 'string' && row.platform.length ? row.platform : 'unknown'}\u0000${row.actor}`
  : null;
const actorsFor = (name) => new Set(events.filter((e) => e?.event === name).map(actorKeyFor).filter(Boolean));
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
const referralActors = new Set(referralOpens.map(actorKeyFor).filter(Boolean));
const referralStarters = new Set();
for (const actor of referralActors) {
  const rows = byActor.get(actor) ?? [];
  const firstRef = rows.find((e) => e.event === 'referral' && e?.props?.action === 'open');
  if (firstRef && rows.some((e) => e.event === 'run_start' && (e.ts ?? 0) >= (firstRef.ts ?? 0))) referralStarters.add(actor);
}
console.log(`Referral open → run_start: ${referralStarters.size}/${referralActors.size}${referralActors.size ? ` (${(referralStarters.size/referralActors.size*100).toFixed(1)}%)` : ''}`);

// This section intentionally reports observed telemetry, not inferred player understanding.
// A missing event may be a delivery gap; it is never described as a comprehension failure.
const contextFields = ['analyticsRunId', 'runTimeMs', 'firstRun', 'release'];
const isRunIdValid = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(value);
const isRunTimeValid = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const validPropsObject = (row) => row?.props && typeof row.props === 'object' && !Array.isArray(row.props);
const contextKey = (row, props) => `${row.platform}\u0000${row.actor}\u0000${props.analyticsRunId}`;
const ensureRun = (key) => {
  if (!runs.has(key)) runs.set(key, { events: new Map(), firstRuns: new Set(), firstRunUnknown: false, start: null });
  return runs.get(key);
};
const comprehensionRows = events.filter((row) => comprehensionNameSet.has(row?.event));
const actorsByEvent = new Map(comprehensionNames.map((name) => [name, new Set()]));
const actorEvents = new Map();
let legacyRows = 0;
let malformedRows = 0;
let unknownFirstRunRows = 0;
let missingReleaseRows = 0;
const runs = new Map();

// run_start defines the attempt denominator even when no comprehension event arrived.
for (const row of events) {
  if (row?.event !== 'run_start') continue;
  if (!validPropsObject(row)) continue;
  const props = row.props;
  if (!Object.hasOwn(props, 'analyticsRunId') || !Object.hasOwn(props, 'runTimeMs')) continue;
  if (!isRunIdValid(props.analyticsRunId) || !isRunTimeValid(props.runTimeMs)) continue;
  if (!actorKeyFor(row) || typeof row.platform !== 'string' || !row.platform.length) continue;
  if (Object.hasOwn(props, 'firstRun') && typeof props.firstRun !== 'boolean') continue;
  if (Object.hasOwn(props, 'release') && typeof props.release !== 'string') continue;
  const run = ensureRun(contextKey(row, props));
  if (run.start == null || props.runTimeMs < run.start) run.start = props.runTimeMs;
  if (typeof props.firstRun === 'boolean') run.firstRuns.add(props.firstRun);
  else run.firstRunUnknown = true;
  if (typeof props.release !== 'string') missingReleaseRows += 1;
}

for (const row of comprehensionRows) {
  const actorKey = actorKeyFor(row);
  if (actorKey) {
    actorsByEvent.get(row.event).add(actorKey);
    if (!actorEvents.has(actorKey)) actorEvents.set(actorKey, new Set());
    actorEvents.get(actorKey).add(row.event);
  }
  const validProps = validPropsObject(row);
  const props = validProps ? row.props : {};
  const hasAnyContext = contextFields.some((field) => Object.hasOwn(props, field));
  if (!validProps) {
    malformedRows += 1;
    continue;
  }
  if (!hasAnyContext) {
    if (!actorKey || typeof row.platform !== 'string' || !row.platform.length) {
      malformedRows += 1;
      continue;
    }
    legacyRows += 1;
    continue;
  }
  if (!Object.hasOwn(props, 'analyticsRunId') || !Object.hasOwn(props, 'runTimeMs')) {
    legacyRows += 1;
    continue;
  }
  if (!isRunIdValid(props.analyticsRunId) || !isRunTimeValid(props.runTimeMs) ||
      (Object.hasOwn(props, 'firstRun') && typeof props.firstRun !== 'boolean') ||
      (Object.hasOwn(props, 'release') && typeof props.release !== 'string') ||
      !actorKey || typeof row.platform !== 'string' || !row.platform.length) {
    malformedRows += 1;
    continue;
  }
  const key = contextKey(row, props);
  const run = ensureRun(key);
  if (typeof props.firstRun === 'boolean') run.firstRuns.add(props.firstRun);
  else {
    run.firstRunUnknown = true;
    unknownFirstRunRows += 1;
  }
  if (typeof props.release !== 'string') missingReleaseRows += 1;
  // Events are one-shot. Duplicate deliveries count once; retain the earliest game-time observation.
  const previous = run.events.get(row.event);
  if (previous == null || props.runTimeMs < previous) run.events.set(row.event, props.runTimeMs);
}

console.log('\nComprehension telemetry (observed events, not a measure of understanding):');
console.log(`Comprehension rows=${comprehensionRows.length}; contextual runs=${runs.size}; legacy/partial uncorrelated rows=${legacyRows}; malformed-context rows=${malformedRows}`);
console.log(`Rows with missing firstRun metadata: ${unknownFirstRunRows} (valid run ID/time stays sequenced; affected runs stay out of first-run/returning subsets)`);
console.log(`Rows with missing release metadata: ${missingReleaseRows}`);
console.log('Unique identifiable actors by event (platform + actor; identifiers withheld):');
for (const name of comprehensionNames) {
  console.log(`${name.padEnd(48)} actors=${String(actorsByEvent.get(name).size).padStart(5)}`);
}
const uniqueEventActors = new Set([...actorEvents].filter(([, names]) => names.size).map(([actor]) => actor));
console.log(`Unique identifiable actors across comprehension events: ${uniqueEventActors.size}`);
console.log(`Context coverage: contextual rows=${comprehensionRows.length - legacyRows - malformedRows}; legacy/partial uncorrelated rows=${legacyRows}; malformed/invalid rows=${malformedRows}`);

const chain = ['host_cell_approached', 'infection_started', 'first_lysis', 'second_host_cell_completed_without_hint'];

function chainDepth(run, runStart) {
  let previous = runStart;
  let depth = 0;
  for (const name of chain) {
    const time = run.events.get(name);
    if (time == null || time < previous) break;
    previous = time;
    depth += 1;
  }
  return depth;
}
function summarizeRuns(selected, label) {
  const anchored = selected.filter((run) => run.start != null);
  const depths = anchored.map((run) => chainDepth(run, run.start));
  const denominator = anchored.length;
  console.log(`${label}: run_start observed=${denominator}; missing run_start=${selected.length - denominator}; firstRun unknown=${selected.filter((run) => run.firstRunUnknown || run.firstRuns.size !== 1).length}; firstRun conflicts=${selected.filter((run) => run.firstRuns.size > 1).length}`);
  for (let depth = 1; depth <= chain.length; depth += 1) {
    const count = depths.filter((value) => value >= depth).length;
    console.log(`  observed ordered through ${chain[depth - 1]}: ${count}/${denominator}${denominator ? ` (${(count / denominator * 100).toFixed(1)}%)` : ''}`);
  }
  const complete = anchored.filter((run) => chainDepth(run, run.start) === chain.length);
  const times = anchored
    .filter((run) => run.events.has('first_lysis') && run.events.get('first_lysis') >= run.start)
    .map((run) => run.events.get('first_lysis') - run.start)
    .sort((a, b) => a - b);
  const median = times.length
    ? (times.length % 2 ? times[(times.length - 1) / 2] : (times[times.length / 2 - 1] + times[times.length / 2]) / 2)
    : null;
  console.log(`  fully observed chain: ${complete.length}/${denominator}${denominator ? ` (${(complete.length / denominator * 100).toFixed(1)}%)` : ''}; missing milestones remain unknown, not failures`);
  console.log(`  median first-lysis game time from run_start: ${median == null ? '—' : `${median} ms`} (n=${times.length} runs with both timestamps; denominator is not all starts)`);
}

console.log(`Run sequencing: order uses runTimeMs (equal times allowed), never receipt timestamps; runs with absent run_start=${runs.size - [...runs.values()].filter((run) => run.start != null).length}; incomplete/ambiguous milestone observations are unknown`);
summarizeRuns([...runs.values()], '  All contextual runs');
const firstRunRuns = [...runs.values()].filter((run) => !run.firstRunUnknown && run.firstRuns.size === 1 && run.firstRuns.has(true));
const returningRuns = [...runs.values()].filter((run) => !run.firstRunUnknown && run.firstRuns.size === 1 && run.firstRuns.has(false));
const unknownRuns = [...runs.values()].filter((run) => run.firstRunUnknown || run.firstRuns.size !== 1);
console.log(`First-run metadata subset: firstRun=true runs=${firstRunRuns.length}; firstRun=false runs=${returningRuns.length}; unknown/conflicting runs=${unknownRuns.length}`);
summarizeRuns(firstRunRuns, '  First-run subset');

for (const name of ['infection_interrupted', 'infection_resumed']) {
  const rowActors = actorsByEvent.get(name).size;
  const legacyCount = comprehensionRows.filter((row) => row.event === name).filter((row) => {
    const props = row?.props && typeof row.props === 'object' && !Array.isArray(row.props) ? row.props : {};
    return !contextFields.some((field) => Object.hasOwn(props, field));
  }).length;
  const contextualCount = [...runs.values()].filter((run) => run.events.has(name)).length;
  console.log(`First observed ${name}: contextual runs=${contextualCount}; identifiable actors=${rowActors}; legacy rows=${legacyCount} (does not count repeats, causes, or same-cell resume)`);
}
