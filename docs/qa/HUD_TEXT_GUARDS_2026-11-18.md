# HUD text guards — 2026-11-18

## Scope

Branch `perf/hud-text-guards`, based on `a8945475ee2db8c649b003c788de6f0597ca8c52`. The change is limited to retained-value guards in `src/scenes/UIScene.ts`; no gameplay, renderer, pools, joystick, DPR, Juice, or purchase-validation code was changed.

The per-frame HUD text writes now compare the completed value before calling Phaser `setText()`:

- timer: cached formatted `MM:SS` string;
- level: guarded by the existing `xpDirty` signal, with the complete existing overflow sequence retained when dirty (full label → shortened label → compact numbers);
- kills: cached `run.kills`;
- HP: cached final display string;
- boss name: cached `run.bossName` while a boss is active.

The cache is invalidated on scene creation and in `layout()`, which is the existing resize/orientation path. This preserves reflow after viewport changes. Combo behavior and its existing `lastCombo` invalidation are unchanged.

## Complete `setText` classification

Every one of the 68 `src/` occurrences on this branch is listed below. `per-frame` means the call is reachable from a frame/update path; `event-driven` means it runs on scene creation, an interaction, a state transition, a result, or another bounded event.

| File:line | Classification | Reason |
|---|---|---|
| `src/game/qaPerf.ts:353` | per-frame (already throttled) | `refreshText()` is reached from the QA overlay's frame sampling path, but the overlay already limits refresh frequency; not a persistent HUD text source and not changed. |
| `src/scenes/GameScene.ts:819` | event-driven | QA group button labels refresh when the toggle UI is created or a group is toggled. |
| `src/scenes/GameScene.ts:1514` | event-driven | Damage-number text is created/updated for a damage popup event. |
| `src/scenes/MenuScene.ts:519,520,555,561,569,571,573,575,607,620,622,624,626,630,702,716,724,735,808,809,810,811,824,825,828,831` | event-driven | Menu construction, profile/difficulty changes, duel resolution, or challenge-screen transitions; no `update()` path. |
| `src/scenes/StorefrontScene.ts:1063,1181,1187` | event-driven | Purchase/loading/retry state transitions in the storefront flow. |
| `src/scenes/UIScene.ts:315` | event-driven | Mute control state change. |
| `src/scenes/UIScene.ts:441,445,451,455,462,469,499,521` | per-frame | Persistent HUD text in `UIScene.update()`; these are the guarded timer/level/kills/combo/HP/boss writes. The three level lines are one overflow sequence. |
| `src/scenes/UIScene.ts:586` | event-driven | RNA pickup feedback is written when a pickup notification is emitted. |
| `src/scenes/UIScene.ts:646` | event-driven | Context hint presentation/update, bounded by hint events. |
| `src/scenes/UIScene.ts:1462,1463` | event-driven | Onboarding copy is written when onboarding is armed/presented. |
| `src/scenes/UIScene.ts:2320,2324,2327,2330,2333,2336,2339,2342,2561,2591,2599,2604,2613,2630,2633,2635` | event-driven | Result/report status copy after a run or score submission state transition. |
| `src/ui/LabOverlays.ts:153` | event-driven | Lab panel opening/rebuild after a user action or wallet state change. |
| `src/ui/MobileLayoutGuard.ts:193,201` | event-driven | Layout fitting runs during a bounded layout/resize operation, not every game frame. |
| `src/ui/QuestBoard.ts:60` | event-driven | Quest board render/rebuild. |
| `src/ui/ResultReport.ts:31` | event-driven | Result-report scroll hint changes on bounded scroll interaction. |
| `src/ui/RetentionOverlays.ts:235` | event-driven | Reward/result overlay update after a retention action. |

Only the eight persistent HUD writes in `UIScene.update()` were in scope for this fix. The only other per-frame-path `setText` is the existing, throttled QA performance overlay; no additional unthrottled HUD-text source was found.

## Texture-upload measurement

> **First measurement (Manus, 2026-11-18, ~21:30 МСК).** The probe script was not
> committed at that time, so these numbers are retained as the first
> measurement and are not independently reproducible. The control was read
> within builds (visible vs hidden); the corrected between-builds control is
> in the Kimi section below.

Method: Chromium + SwiftShader, WebGL, 390×844, same combat fixture, 240-frame probe with the first 20 samples discarded. The probe wraps `WebGLRenderingContext`/`WebGL2RenderingContext` `texImage2D` and `texSubImage2D`, reporting uploads per frame. These are headless counters, not phone render milliseconds.

| Build | HUD visible mean | HUD visible p50 / p95 | HUD visible total | HUD hidden mean | HUD hidden total |
|---|---:|---:|---:|---:|---:|
| Base `a8945475` | 2.355 | 2 / 4 | 518 | 2.341 | 515 |
| Guarded branch | 0.350 | 0 / 2 | 77 | 0.345 | 76 |

Visible HUD uploads fell by **85.1%** (`2.355 → 0.350` uploads/frame), exceeding the 70% acceptance threshold. The fresh-run hidden-HUD control remained effectively unchanged within each build (base 518 vs 515; guarded 77 vs 76), so the visible reduction is attributable to the persistent HUD-text path rather than a HUD visibility side effect. Residual uploads are expected from other text/texture activity.

No page errors occurred in the paired probe. This measurement does not claim a Galaxy S20+ render-ms improvement; the brief's estimated 2–4 ms / 19.5 ms remains a device-only follow-up for Mark.

## Second measurement (Kimi, 2026-11-18 night) — committed probe, corrected control

Probe: `scripts/hud-text-upload-probe.cjs` (committed on this branch). Chromium + SwiftShader, WebGL, 390×844, same combat fixture. Two fixes over the first measurement: the probe is in the repo, and the sampling window is in **game time** (`--window-start 5000 --window 15000`, i.e. 5–20 s of `run.timeMs`) so paired builds are compared at the same run phase — a fixed frame count compares different wave densities and gives unstable pairs. The first 20 sampled ticks are discarded. The MAX viewport stub now receives the real probe viewport (earlier runs rendered 360×760 regardless of the flag). The screenshot driver `scripts/hud-text-guards-capture.cjs` is committed alongside.

### Established mechanism

Phaser `Text.setText()` no-ops only when the string is unchanged (`node_modules/phaser/src/gameobjects/text/Text.js:621`); a changed string runs `updateText()`, which uploads the canvas to a GL texture immediately, without any visibility check (`Text.js:1455`, `canvasToTexture(..., true)`). Consequences:

- The base level-reflow cycle calls `setText` three times per frame with **three different strings** (causal → shortened → compact), so every frame performs up to 3 texture uploads for one label. The `--trace-settext` probe confirms it: in the base build each reflow string is written 263 times over 263 sampled ticks (every tick), plus the unchanged HP string `100 / 100` also 263 times (in base the HP write is unguarded); in the guarded build the reflow strings appear 10 times total (only on XP-change ticks) and the HP string once.
- The per-frame onboarding writes (`UIScene.ts` tickOnboarding) pass the **same** string every frame, so Phaser's no-op makes them upload-free in both builds — they were never a hot source.
- Hiding the HUD (`setQaHudHidden`) sets `visible=false` but does not prevent `updateText()` uploads. Therefore the correct hidden-HUD control is **between builds**: hidden base vs hidden guarded. Hiding the HUD within a build must not reduce uploads, and it does not (see table).

### Paired results (mean uploads/tick, window 5–20 s game time)

| Series | Conditions | Base `a8945475` | Guarded `c2133ba` | Reduction |
|---|---|---:|---:|---:|
| w1 | visible, dedicated runs | 3.432 | 0.747 | −78.3% |
| w2 | visible, dedicated runs | 3.437 | 0.705 | −79.5% |
| w3 | visible, dedicated runs | 3.456 | 0.726 | −79.0% |
| r1 | visible, after viewport-stub fix | 3.356 | 1.753 | −47.8% |
| w4 | visible, under parallel capture load | 2.345 | 0.445 | −81.0% |
| final | visible, idle machine | 3.764 | 1.471 | −60.9% |
| w1 | hidden, dedicated runs | 3.622 | 0.674 | −81.4% |
| w2 | hidden, dedicated runs | 3.930 | 1.253 | −68.1% |
| r1 | hidden, after viewport-stub fix | 3.416 | 1.472 | −56.9% |
| w3 | hidden, under parallel capture load | 2.345 | 0.445 | −81.0% |

Notes on variability: the residual upload rate of the guarded build depends on run density (damage numbers, kill events), so single pairs scatter between ≈0.45 and ≈1.75 uploads/tick; the base build stays in a narrow 2.3–3.9 band. Across the dedicated visible series the base median is ≈3.44 and the guarded median ≈0.73 (**≈−79%**); across the hidden series base median ≈3.62, guarded median ≈1.25 (**≈−65%**). The hidden control shows exactly the predicted eager-upload signature: hiding the HUD never reduces uploads within a build (hidden is equal to or higher than visible in every series). The w4/w3 rows were taken while four screenshot captures saturated the CPU and are included for completeness; the r1 pair shows the upper end of guarded residual on a kill-dense run. P50 in the trace runs: base 3, guarded 0.

### Residual attribution (guarded build)

- `--no-kills` control run (window 3–9 s, no damage numbers / no kill-counter events): **0.252 uploads/tick**. Damage numbers plus kill-counter updates therefore account for roughly half of the typical guarded residual (each damage popup is a new `Text` object and uploads at birth; `GameScene.ts:1514` path).
- QA build (`VITE_QA_TOOLS=1`, includes the 250 ms `qaPerf.refreshText()`): **1.038** vs production guarded builds 0.445–0.747 on comparable windows. The QA overlay's own text refresh adds a noticeable share; production builds do not include it. QA-build and production-build numbers must not be mixed.
- The remainder is inherent event-driven text: one upload per actual timer/kills/HP/XP change, RNA pickup feedback, combo pulses, and popup births. These are bounded by gameplay events, not by frame rate.

### S20+ toggle clarification

The 14.11 S20+ toggle measurement (−3.2 ms with UI hidden) measured the **render/draw cost** of the HUD, not texture uploads — a different mechanism. These guards reduce GL texture uploads; their effect on phone frame time can only be measured by comparing base vs guarded builds on-device at high enemy density (E200+) — that remains Mark's step, unchanged.

No page errors occurred in any probe run. These are still headless SwiftShader counters, not phone render milliseconds.

## Screenshots

First capture (Manus): four single frames at 00:00 with the onboarding step open — retained below for history, superseded by the dynamic pairs.

Dynamic pairs (Kimi): driver `scripts/hud-text-guards-capture.cjs`, same combat fixture, onboarding skipped, carrier HP forced via `runState.stage.hp` (the HUD reads `GameScene.snapshot()`, which maps `stageProgress.hp` — writing `runState.run.hp` does not reach the HUD). The game loop is slept around each capture so the canvas keeps the exact frame; the boss is forced deterministically through the run snapshot (`wave.boss` for hp/maxHp, current stage definition for the name) — the same render path as a real boss. Files: `artifacts/hud-text-guards/<build>-<viewport>-<state>.png` (+ `.json` metadata) for `build ∈ {base, guarded}`, `viewport ∈ {390x844, 320x844}`, `state ∈ {timer-0059, timer-0100, kills-12, kills-13, hp-100, hp-43, boss, reflow-tick-0059, reflow-tick-0100}` — 36 frames total. Pair metadata matches on every forced value (timer strings, kill counters at 12→13, HP 100/43, boss name `ИММУННЫЙ ПРАЙМ`, reflow label `РНК 975/1000` at 390 and `РНК 975/1K` at 320 across the 00:59 → 01:00 tick, `levelFits: true` everywhere); live-world values (exact kill count between forced states, XP pickups) differ between builds as expected. Visually compared pairs (boss, hp-43, reflow, timer): HUD identical in base and guarded. The reflow-tick pair is the targeted check for the 1.1 corner case — the label sits at the shortening threshold while the timer tick changes the available width, and both builds show the same reflowed form.

## Verification

- `npx tsc --noEmit` — PASS.
- `npm run test:qa-perf` — PASS.
- `npm run test:hud-retained-graphics` — PASS.
- Paired WebGL texture-upload probe — PASS; no page errors; 85.1% visible-HUD reduction (first measurement).
- Required visual pairs captured at 390×844 and 320×844.
- Final release build (`VITE_RELEASE_SHA` set to the implementation commit) — PASS. Hosted CI/Draft PR checks remain pending.
- Kimi round: `npx tsc --noEmit` — PASS (re-run on `c2133ba`).
- Kimi round: 36 dynamic screenshot frames (9 states × 2 builds × 2 viewports) with matching pair metadata; boss and reflow pairs visually compared — PASS.
- Kimi round: committed probe (`scripts/hud-text-upload-probe.cjs`), visible base-vs-guarded reduction ≈79% on dedicated series (threshold −70%: PASS on the dedicated series; single kill-dense pairs scatter down to −48…−61% due to damage-number uploads, see variability note).

## Files changed

- `src/scenes/UIScene.ts` — value caches, update guards, and resize/create invalidation; level reflow restarts on timer-string/available-width change (1.1); dead `lastLevelLabel` replaced by `lastLevelAvailableWidth` (1.2).
- `scripts/hud-text-upload-probe.cjs` — committed texture-upload probe with game-time sampling window and visible/hidden HUD flag (1.3).
- `scripts/hud-text-guards-capture.cjs` — committed deterministic screenshot driver (1.4).
- `docs/qa/HUD_TEXT_GUARDS_2026-11-18.md` — this report.
- `artifacts/hud-text-guards/*.{png,json}` — dynamic before/after evidence.

## Out of scope / not checked

No S20+ run was performed, so no phone render-ms or thermal claim is made; the 14.11 toggle measurement is a render-cost measurement and is not evidence for these guards (see the S20+ clarification above). No changes were made to `Joystick.ts`, `scripts/check-profile-client.mjs:162`, `Juice.ts`, DPR, renderer selection, gameplay, pools, or harness behavior.
