# OFELIYA — product validation gate

## P0 — real MAX mobile acceptance

The release is not accepted by browser/CI alone. Create `artifacts/mobile-acceptance.json` outside the repository (or another evidence path) and validate it with:

`npm run test:mobile-evidence -- /path/to/mobile-acceptance.json`

Each check must contain `id`, `status: "pass"`, `device`, `clientVersion`, `testedAt` (ISO date/time), and `evidence` (video/screenshot/log reference). Required 16 checks:

1. `android-launch` — cold launch in the real MAX client.
2. `android-first-run` — first-run tutorial is readable and complete.
3. `android-full-run` — full campaign through result screen.
4. `android-background-resume` — background → foreground without broken input/audio/state.
5. `android-restart` — close/reopen and start a second fresh run.
6. `android-share` — native result share returns success in MAX.
7. `android-daily-invite` — invite link opens OFELIYA and reaches a playable start.
8. `android-viewport` — portrait resize/system bars do not cover controls or result actions.
9–16. Same checks on iOS (`ios-*`).

A verbal “works” is not evidence. The gate passes only when all 16 rows are reproducible and the validator is green.

## P1 — first 60 seconds

The tutorial now teaches the actual core loop: movement → auto-fire → RNA → mutation → host-cell infection. The final step explicitly distinguishes hostile immune cells from the larger host cell that must be entered and infected.

Telemetry records `onboarding_step` with `step`, `outcome`, and `runTimeMs`, plus `onboarding_exit` when the player explicitly skips. Existing comprehension events remain in place for enemy hit/kill, RNA, mutation and infection behaviors.

## P1 — decision funnel

Fresh instrumentation now emits the core product path:

`app_open → run_start → run_60s → boss1 → heart → replay`

Run-linked events include `runSeed` where available. `win/death`, successful `share`, `daily` launch and referral open are also recorded. Analyze the server store with:

`npm run analytics:funnel -- /path/to/store.json`

The report prints unique-actor conversion, onboarding completion timing, explicit onboarding exits, D1 return (only cohorts with a complete observation window), and referral open → run start conversion.

## P2 — Daily/social validation

Use real MAX-client invite tests. A successful share action is only the start of the path; the product metric is referral open → run start. For every manual Daily test, preserve the invite message evidence and the invited device's launch/run evidence alongside the mobile acceptance artifact.

## P2 — creative test

Creative hypothesis: “Ты — вирус, организм адаптируется.” The clip should show infection, mutation and immune escalation. Evaluate it on attributable referral opens and started runs, not raw views.