# Autonomous Campaign Harness — implementation report (2026-11-18)

Coordinator: Muse. Branch `feat/autonomous-campaign-harness`, base main
`65e36935` (PR #295 merged during the work; original base `e65635f`).
Local HEAD `e937e32f`, remote HEAD `ad8a3839` (verified via ls-remote,
tree identical). 39 commits, linear history, no merges.

Spec: `ofeliya-autonomous-campaign-harness-design-2026-11-18.md`
(merged design, 7 sections + appendices A–C). Where the document was
wrong, the document was corrected in place (marked) and the correction
is listed in §5 below.

## 1. Per-track status

| Track | Commits | Status | What |
|---|---|---|---|
| A — Test API | 5 | DONE, integrated | `src/test-support/installAutonomousHarness.ts` (12 API methods per §1.3), `harnessTypes.d.ts`, vendored sync SHA-256, gate in `main.ts` (`DEV \|\| VITE_QA_TOOLS`), `check-harness-absent.mjs` + assert in `check-build-shape.mjs`. Determinism proof: 600 stepped frames, two fresh pages, identical scalars / 8 RNG streams / `stateHash` / `inputHash`. |
| B — Determinism | 4 | DONE, integrated | RNG migration (explicit `RunRng` param; `pickEliteModifier`→`elite`, `rollChoices`/`rollLegendaryChoice`/`guaranteedLegendaryChoices`/`weightedPick`→`progression`), `check-rng.mjs` extension, `check-no-math-random.mjs` + `test:no-math-random`, `verify-campaign-replay.mjs`. One borderline change: argument-only substitution at the 4 `rollChoices` call sites in `GameScene.update` (closure → `this.gameplayRng`, identical draw order, no logic change). |
| C — Bot + runner | 12 | IN PROGRESS (agent still running) | `scripts/autonomous-campaign.cjs` + `scripts/autopilot/` (CampaignBot, ThreatModel, MovementPolicy, BossPolicies, UpgradePolicy), invariants §4.2, watchdog §4.4, renderer-snapshot handshake (App. C), `--visual-profile`, `--qa-hide`. 5 tuning cycles committed (cycle 5 = survivability, regressed — see §3). |
| D — Report + CI | 5 | DONE, integrated | `scripts/lib/campaign-report.cjs` (zero-dep, validated run.json + series.json + single-file index.html), fixture, npm scripts, job `campaign-harness` in `ci.yml`, `campaign-nightly.yml`, job `campaign-release-gate` in `release-visual-matrix.yml`. |
| E — Appendix C + A+B acceptance | 10 | DONE, integrated | `advance()` parallel-call guard, `time-parity-smoke.cjs`, `harness-acceptance.cjs`, `audio-diagnostics-smoke.cjs`, `scripts/lib/visual-profiles.cjs`, nightly matrix (3 profiles). |
| Coordinator fixes | 3 | DONE | Replay choice-wait: bounded wait for the mutation modal (600f diagnostic bound) + live shift logging + log-only-on-success (see §3). |

Game code changed ONLY: new `src/test-support/` + ~10 lines in `main.ts`
+ RNG migration (incl. the 4 argument-only call-site substitutions).
Everything else is `scripts/` + workflows + `package.json`. `Joystick.ts`
and `scripts/check-profile-client.mjs:162` untouched.

## 2. Verification (coordinator, integration worktree)

- `npx tsc --noEmit` clean; normal build green; QA build
  (`VITE_QA_TOOLS=1` + `VITE_RELEASE_MATRIX_QA=1`) green, API in its own
  chunk `installAutonomousHarness-*.js`.
- `test:harness-absent` green on the normal bundle (API physically
  absent), exit 1 on the QA bundle (negative control).
- `test:bundle-shape` green.
- 13 node suites green: `test:rng`, `test:challenge`, `test:checkpoint`,
  `test:legendary`, `test:difficulty`, `test:stages`, `test:wave-events`,
  `test:duel`, `test:save`, `test:pacing`, `test:mini-boss`,
  `test:no-math-random`, `test:campaign-report`.
- Integrated files verified byte-identical to each track branch.
- Rebase onto new main `65e36935` (PR #295): 31/31 clean, zero conflicts;
  re-verified (tsc + build + harness-absent) after rebase.

### Acceptance criteria A+B (track E, `test:harness-acceptance`) — 4/5

- (0) `advance()` guard: PASS (parallel call rejected, guard resets on error).
- (1) Stable delta 1000/60 over 1000 steps: PASS (max relative error 7.27e-14).
- (2) Subsystems under stepping: TimerEvent PASS (delayedCall 1000 ms fired
  at step 61), physics PASS (120 px/s over 60 frames: 60 WORLD_STEP, dx
  exactly 120 px), stage transition PASS (step 6, stageTimeMs 300000),
  **Tween FAIL** — `TweenManager.getDelta()` runs on `Date.now()`, not
  synthetic time (500 ms tween finished at step 142/135 instead of 31,
  wall 503/504 ms). Design §2.2 claim was wrong.
- (3) 3600 steps with yield: PASS (drift vs freeze-accounted expectation
  2.98e-9 ms; vs recorded deltas 0).
- (4) Replay, same seed + input log, 3600 steps: PASS (stateHash
  `87e550e4…`, inputHash `d89b38c6…` identical in both legs and two runs).

### Time parity 1x vs 4x (track E, `test:time-parity`) — DIVERGED

First divergence frame 107: runTimeMs 1600.0000000000027 vs
1583.333333333336 (exactly 1 frame); gap persists (telegraphs 10393 vs
10003 frames-with, dipped frames 10296 vs 11224, stateHash differs).
Cause: the Juice hit-stop dip runs on wall-clock (tween.js /
`performance.now()`, `Juice.ts`) and presses `scene.time.timeScale` /
`world.timeScale` (floor 0.06, ~190 ms wall); the freeze itself is
deterministic (scene time, `GameScene.hitStop`, min-gap 170 ms), but the
dip trajectory depends on wall-ms/frame (1x ≈ 5.6, 4x ≈ 7.3 ms) → a
different number of frozen frames per run. The 1x leg does not reproduce
between launches either (runTimeMs at 12000 frames: 194166.67 vs
194416.67 — 15 frames).

### Audio diagnostics (track E) — AUDIO_OK

`test:audio-diagnostics` twice: state `running`, sampleRate 44100,
currentTime +0.63/+0.60 s per 1 s wall, `onended=true`. Threshold lowered
0.5 → 0.3 (0.63 observed under load). No `gc()` / `--expose-gc` anywhere
in harness scripts, `src/test-support/`, `scripts/`, workflows, `tests/`.

## 3. End-to-end runs (coordinator, Canvas `?renderer=canvas`, speed 4)

Canvas was used because SwiftShader WebGL is 30–50× slower (18000 frames
in 82 s vs 2380+ s for 12000) and loses its context under OOM
(`installWebGLRecovery` → `location.reload()`); the first WebGL attempt
died at 60 s when vite was OOM-killed. All runs below: score accepted by
the local score server, all invariants PASS, deaths are LEGIT_DEATH
(hp-log + telegraphs distinguish them from bugs).

| Run | Bot | Result | Sim | Kills | Note |
|---|---|---|---|---|---|
| std-001 | cycle 2 | defeat, bloodstream | 132 s | 52 | HP bleed 100→1 |
| std-001 | cycle 4 | defeat, bloodstream | 257 s | 377 | HP 19→7→1→−8 in ~13 s at ~240 enemies |
| std-002 | cycle 4 | defeat, bloodstream | 138 s | 214 | death is systematic, not seed-specific |
| str-001 (strained, until first-boss) | cycle 4 | defeat, bloodstream | 264 s | 443 | died just before the 300 s boss |
| std-001 | cycle 5 | defeat, bloodstream | 122 s | 61 | regression: 19 enemies nearby at death |
| std-001 (repeat) | cycle 5 | defeat, bloodstream | 154 s | 64 | 8 enemies nearby at death |

Cycle 5 (survivability) regressed: DPS fell ~6× (3 mutation choices vs
5), the bot flees instead of fighting and still dies — not from crowd
pressure (8–19 enemies nearby) but presumably from elites/brutes it can
no longer kill, or telegraphs while fleeing. Diagnosis sent to track C;
cycle 6 must restore cycle-4 DPS with targeted protection, not fleeing.

### Campaign replay of a recorded bot log — NOT ACHIEVED

`verify-campaign-replay.mjs` on the std-001 cycle-4 inputs.json (257 s
sim, 5 choices): choice 2 (`legendary:last-carrier` @1104) applied only
after +254 frames; choice 3 (`multi` @2574) never saw its modal within
600 frames. Level-up timing in the replay lags the recorded run by
seconds — same root cause as parity (wall-clock Juice dip + different
stepping wall-profiles between the bot runner and the replay script).
Coordinator hardened the script (bounded modal wait with live shift
logging) so the replay fails with a diagnosis instead of crashing at
the first shifted choice — but hash comparison at campaign scale is
unachievable until the game changes (see §6).

## 4. What was NOT done and why

- **First Standard run to victory over CARDIAC TITAN — NO.** The bot
  dies in bloodstream on every seed tried (122–264 s sim, first boss at
  300 s). Track C is still tuning; cycle 5 regressed.
- **Determinism replay at campaign scale — NO.** Diverges by mechanism
  (Juice dip, §3); needs a game change — Mark's decision.
- **Strained smoke to the first boss — NO** (died at 264 s, 36 s short).
  The strained path itself works end-to-end (difficulty, profile,
  invariants, score accepted).
- **Full 20-run series locally — intentionally NOT run** (60–80 min;
  nightly's job in CI).
- **PR — NOT opened.** The `campaign-harness` CI job runs a full
  Standard campaign (`--seed pr-smoke --difficulty standard`, no
  `--until`); with the current bot it exits 1 → CI red. Opening now
  would deliver red. Also unproven: WebGL speed on GitHub runners vs
  the 30-min job timeout.
- **Physical-device / S20+ acceptance — not done** (owner's).
- **Nightly workflow never executed end-to-end** (no runner in track E's
  worktree at the time; stitching is the coordinator's — done at
  integration, but the workflow itself has not run).

## 5. Design divergences (document corrected in place)

1. §2.3: `Math.random` count wrong — 9 files/11 occurrences → 5 gameplay
   calls + `RunRng` fallback (`AnomalyPrime`/`Sfx`/`PaymentLedger` are
   comments only); `Date.now` allowlisted in `meta/`/`shop/`/`collection/`.
2. §3.3: the game DOES track the safe pocket itself
   (`heartbeatSafeX/Y/radius` in GameScene); the bot reads it from the API.
3. §2.2: stepping details — smoothStep off during stepping, `resume()` is
   not bare `loop.start()`, hash ticks run-relative, deterministic clock
   epoch 0, stepped campaigns must stay stepped.
4. §2.4: `inputs.json` gained a `transitions` array (stage-transition acks).
5. §6.1: build runs BEFORE `test:harness-absent`; release gate is a
   separate job (two different builds, 60-min timeout, tags/dispatch only).
6. §6.3/§6.5: invariants accepted in boolean AND object forms.
7. §2.2 (NEW, track E): TweenManager is NOT synthetic-time
   (`getDelta()` on `Date.now()`); Juice dip is on `performance.now()`.
8. §2.4 (NEW, track E): parity 1x vs 4x DIVERGED (frame 107, Juice dip).
9. §2.4 (NEW, coordinator): campaign replay of bot logs not achievable
   with the current game code (+254f at choice 2, >600f at choice 3).
10. §6.1 (NEW, track E): Canvas 30–50× faster than SwiftShader WebGL for
    logic-stress nightly legs (`?renderer=canvas`).
11. App. C items 6–7 verified already-compliant: no "render off" in
    stepped mode anywhere; no global `Date.now`/`performance.now`
    pinning (the only `addInitScript` seeds localStorage + WebApp mock).

Appendix C 9-point status: 1 (guard), 2 (parity test), 4 (audio), 5
(visual profiles), 9 (acceptance) — implemented by track E; 3 (snapshot
screenshots), 8 (no Angular Planner, no arena-edge rule) — implemented
by track C; 6, 7 — verified compliant, nothing to implement.

## 6. Decisions needed from Mark

1. **Juice wall-clock dip** (blocks parity + campaign replay): move Juice
   to scene time (game change, freeze exception), disable hit-stop in
   stepped/QA mode (changes what is tested), or accept nondeterminism
   and compare with tolerances/windows instead of exact frames.
2. **Bot tuning direction**: cycle 5 regressed (fleeing kills DPS). Track
   C continues; if the bot cannot win Standard soon, the PR gate needs
   re-scoping (e.g. gate on run completion + invariants instead of
   victory) — a design decision, not a coordinator call.
3. **PR timing**: open now as draft with known-red CI, or wait for a
   winning bot. Coordinator recommends waiting: the `campaign-harness`
   job is designed to fail until the bot wins.

## 7. Verdicts

- **NOT READY FOR MERGE.** The harness infrastructure (API, determinism
  tooling, report generator, CI wiring) is complete, verified, and
  pushed — but the two acceptance gates that require a winning bot are
  unmet, and the `campaign-harness` CI job would be red.
- **Harness code: READY FOR REVIEW.** tsc/build/harness-absent/
  bundle-shape green; 13 node suites green; A+B acceptance 4/5 with the
  Tween FAIL diagnosed, not hidden; parity DIVERGED with a root cause.
- **Nightly: NOT READY.** Same bot blocker, plus the nightly workflow
  has never executed end-to-end and WebGL speed on CI runners is
  unproven against the 120-min timeout.
- **NOT READY FOR LIVE CAMPAIGNS.** No full Standard victory exists yet
  on any seed; no Strained run has reached the first boss.

## 8. Environment notes (for the next session)

- VM memory pressure is the main operational risk: vite was OOM-killed
  twice, two VM reboots killed long parity legs, one service restart
  killed a push mid-flight (no-op, retried cleanly) and the vite server.
  Ports: 5173 round-4 (do not touch), 5175 track C, 5176 coordinator/E.
- `/usr/bin/google-chrome` symlink may vanish on VM recreation; the
  runner falls back to Playwright bundled Chromium.
- REST push helper replays commits with NEW SHAs: after a REST push,
  plain `gh-update-branch.py` miscomputes `rev-list` (66 commits instead
  of 2, then HTTP 422 on a tree). Use `--force-onto <new-base>` for
  subsequent pushes of this branch.
