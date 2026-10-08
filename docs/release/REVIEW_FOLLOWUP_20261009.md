# Verified review follow-up — 2026-10-09

Base: main `716292b78c5b2e53485170bcb8a4cc2780f9df04`. This is a bounded dependency/docs patch,
not device acceptance or a release deployment. Canonical identity: `PROJECT_IDENTITY.md`.

## Changes and evidence

- Update only the locked transitive dev dependency `source-map-js` from 1.2.1 to 1.2.2
  (GHSA-68fv-2mgg-jv7q). No direct dependency, gameplay or score-contract change.
- CI run 37775488149 passed build/browser-smoke/production-contract. Deploy run 37777242773
  passed rollout/public HTTPS parity and skipped rollback. Current public identity still requires
  a fresh fetch: the 09.10 attempt from this environment failed to connect.
- Preserve the original fixture investigation as history; current handoff supersedes its
  pre-merge/no-deployment statements.
- Keep `test:mobile-evidence` strict. `RELEASE_VALIDATION.md` section 8.1 already explains an
  explicit external JSON path. CI cannot generate genuine phone acceptance.
- The existing server has a 20,000-score cap, 2,000 verified reserve, health capacity counters,
  coalesced 250ms persistence and an explicit red workflow after rollback. Do not implement
  Kimi's suggested fixes as if these mechanisms were missing.

## Capacity: measure before migration

Obtain `/health` from the actual score service using authorized read-only access. Do not assume
the edge exposes the service's root `/health`. Capture timestamp, served release, `scores`,
`scoreCapacity` and `storePersistence`; these counters contain no player identity.
Record two or more samples across representative busy/quiet windows. If no pruning/restoration
occurs between them, the score-count delta gives accepted new rows over the measured interval.
DAU alone does not establish submission volume or peak requests per second.

Forecast without assuming unlimited growth:

- overall remaining = `max(0, 20_000 - scores)`;
- remaining before unverified admission stops = `max(0, 18_000 - scores)`;
- days to overall full = overall remaining / measured accepted new rows per day, only for a
  positive observed rate and a stated observation window;
- zero arrivals means no rate-based forecast, not guaranteed unlimited capacity.

If 1,000 DAU each submit five newly accepted results per day, 5,000/day is 0.058/s average.
From empty, total capacity fills in four days and unverified admissions stop at about 3.6 days.
This is a scenario, not measured production usage; burst rates require separate evidence.

Proposed operational escalation, not an installed monitor: investigate at 80% occupancy or an
estimated seven days to full; treat 90% (the unverified cutoff), capacity-related 503 or unhealthy
persistence as requiring action. Verify alert delivery before describing monitoring as enabled.
Do not automatically restart the service to solve capacity: persisted scores remain on restart.

## Archive/retention contract before any deletion

Current behavior retains rows and refuses new results at capacity. This patch does not delete,
rotate or raise limits. A future migration must define and test:

1. Replay retention: `(platform, uid, submissionId)`, payload hash and accepted result/scoreId
   remain recoverable for the supported client retry window. Duplicate submissions must not
   become new results or lose mismatch rejection after archive/restart.
2. Daily integrity: retained tickets' scoreId references and repeated accepted Daily replies stay
   consistent. Define the lifetime of tickets/retry evidence rather than evicting blindly.
3. Leaderboard history: preserve intended all-time/weekly/season bests and daily statistics in
   archived queries or durable aggregates. Confirm compatibility with each ruleset/campaign.
4. Separation: preserve profiles.json, referrals and still-valid run/duel capabilities. Scores
   and duel snapshots are separate; do not prune all arrays under one generic policy.
5. Recovery: take a verified DATA_DIR backup including store.json and profiles.json, exercise
   restore, define rollback compatibility and run the migration on an offline copy first.
6. Capacity/performance: measure admission, top-query latency and flush delay at the existing
   boundary; monitor backlog and failed persistence. Atomic rename/fsync is not a data backup.

A second writer requires transactional/shared persistence and shared limiter policy. In-process
rate buckets are an acknowledged single-instance limitation; this follow-up does not add Redis.

## Android, telemetry and first-session evidence

User reports Samsung S20+ and latest MAX. Numeric Android/MAX versions must accompany recordings.
Use the real canonical MAX bot, record the loaded release, and follow `RELEASE_VALIDATION.md` §8.
Record all eight Android ids plus manual checks; leave all iOS/TG statuses pending until tested.
Validate the completed external evidence file via `npm run test:mobile-evidence -- PATH` when the
required Android+iOS set is available. Never convert missing evidence into a passing skip.

Before measuring comprehension, confirm signed production events arrive and persist from an
actual messenger session, with release/platform and occurrence times. Do not expose raw initData,
UIDs, tokens or DATA_DIR contents in shared evidence. Missing events are delivery gaps.

PR #177 (`feat/comprehension-report`) remains open: its run-scoped report is not deployed main.
The current aggregate funnel and the proposed correlated report prove different things; review
that PR separately before relying on run-level chains. Do not modify parallel PR #183 in this patch.

After delivery is verified, observe 5-8 newcomers without coaching. Record first movement/kill/RNA/
mutation/infection/lysis, interpretation errors, first minute, first boss and desire to replay.
Use these observations plus delivered events to select at most three gameplay changes. A failed
test fixture, a missing event, or a module import is not evidence of player misunderstanding.

## Browser smoke follow-up

Run the exact same SHA more than once before classifying a remaining failure as flaky. Save the
first failing assertion, active/paused scene state, uiBlocked/choice state and frame/clock evidence.
Use scene events or satisfied state predicates where the test expects progression; preserve
actual gameplay deadlines. Do not relax assertions or freeze production updates to hide defects.
