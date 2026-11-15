# DPR-aware canvas (cap 2x) — implementation & evidence report

Date: 2026-11-15. Branch: `feat/dpr-aware-canvas-2bd6320` (from `main @ 2bd6320b`, verified unchanged).
Brief: «DPR-aware канвас OFELIYA (кап 2x) — чёткость рендера». Merge/deploy: Mark only.

## 1. Problem (recap)

Phaser 3.90 keeps the canvas backing store equal to the CSS size (`ScaleManager.resize`
writes `canvas.width = baseSize.width`). On S20+ (DPR 2.8125) the browser upscales the
1x render ~2.8x — text and art cannot be sharp. Phaser 3.90 has no `resolution` option
for the Scale Manager and `zoom` is off-limits (it redefines the coordinate system that
117 call sites in 19 files read via `scale.width/height`).

## 2. Mechanism (chosen and why)

`src/platform/dprCanvas.ts` — `installDprAwareCanvas(game)`, wired in `src/main.ts`
right after `installMobileLayoutGuard`. Density `= min(window.devicePixelRatio || 1, 2)`,
recomputed on every ScaleManager resize.

The mechanism is the same family as the already-proven QA-only
`src/systems/RenderDensityExperiment.ts` (same pinned Phaser 3.90 internals, validated on
main), minus its experiment gates and with DPR as the selector instead of a query param:

- **Logical state stays untouched.** `scale.width/height`, `renderer.width/height`, the
  projection matrix and `drawingBufferHeight` remain CSS-pixel values. No game code path
  sees a different coordinate system.
- **WebGL.** `canvas.width/height = CSS × density` (CSS size pinned via inline style —
  Phaser's ScaleManager does not set the style at zoom 1, without this the canvas would
  display at buffer size). `gl.viewport`/`gl.scissor` are wrapped to multiply by the
  density **only while the default (backbuffer) framebuffer is bound** (`gl.bindFramebuffer`
  is tracked), so logical camera scissors — including Phaser's Y-flip against
  `drawingBufferHeight` — land on physical pixels, while render targets keep their own
  pixel space. `renderer.resize` is overridden so Phaser's own post-resize path re-applies
  the physical buffer instead of resetting it; `renderer.resetViewport` is overridden to
  stay consistent.
- **Canvas 2D fallback.** The game context's `setTransform` is wrapped to multiply by the
  density (every logical-space transform becomes physical; this is the Canvas equivalent of
  the viewport split — verified against the CanvasRenderer source), and `renderer.resize`
  sizes the buffer. The existing canvas-text resolution guard (`main.ts`
  `installCanvasTextResolutionGuard`) is untouched: Canvas keeps resolution-1 text, which
  stays inside `getBounds()` as before.
- **DPR 1.** Density is 1: the wrappers multiply by one and `renderer.resize` performs
  exactly the sequence Phaser performs — behavior as today, no extra buffer work.
- PostFX is disabled in both performance tiers on this base (`PERFORMANCE.postFx = false`),
  so the camera postFX pipeline is not an active render path; no FBO-scissor edge cases
  exist in this game (no `RenderTexture`/`DynamicTexture`/crop usage in `src/`).

Why not the alternatives: zoom × 2 game size — forbidden, redefines coordinates (§3.3);
`resolution` config — does not exist in Phaser 3.90 GameConfig for the Scale Manager;
patching only `renderer.resize` once — Phaser re-resizes on every ScaleManager resize and
would reset the buffer (8 scene/control listeners on the same event), so the fix
re-installs from a `scale.on('resize')` listener registered after the renderer's own.

## 3. Files changed

- `src/platform/dprCanvas.ts` — new module (all of the above, ~230 lines).
- `src/main.ts` — import + install + destroy wiring; the `?renderDensity=2` auto-install
  gate now also requires `dprCanvas.scale === 1`: on DPR ≥ 2 devices the production path
  already renders 2x, stacking the QA experiment would patch twice (4x). The pre-fix
  experiment harness is adapted in this PR (follow-up commit, see §6): `renderer-smoke`
  expects the new `CSS × min(DPR, 2)` contract and `render-density-paired-proof` verifies
  density against dprCanvas itself instead of stacking the experiment on it.
- `scripts/dpr-capture.cjs`, `scripts/dpr-render-ms.cjs`, `scripts/dpr-tap-probe.cjs` —
  evidence tooling (uncommitted QA drivers, same family as existing `scripts/*-smoke.cjs`).

Not touched: `Joystick.ts`, `scripts/check-profile-client.mjs:162`, sizes/fonts/layouts/
gameplay, `setResolution` calls, the canvas-text guard, `roundPixels`. Bundle
619.71 → 621.91 kB (+2.2 kB, the new module).

## 4. Probe (before touching the game)

Minimal Phaser boot (`artifacts/dpr-probe/probe.html`: one `Text` + one 1px lines,
same `dprCanvas` module bundled via esbuild), DSF=1 and DSF=2, both renderers
(`artifacts/dpr-probe/probe-results.json`):

- DSF=2: canvas 780×480 vs CSS 390×240 (backing 2x), `scale`/`renderer` stay 390×240,
  zero page errors, both renderers. DSF=1: identical sizes to stock Phaser.
- Coordinates not broken: the 1px line at logical y=120 lands exactly on physical rows
  239–240; text band scales 1:1 (logical 46–67 → physical 92–134).
- Edges: max 1px step 244 (contrast limit), 10→90% rise = **0 px** (hard 2x edges);
  pixels >100: 2147 (webgl) / 548 (canvas).

## 5. Acceptance evidence (§6)

### 5.1 Backing store

`scripts/dpr-capture.cjs` (DSF=2, `page.locator('canvas').screenshot` compositor readback):

- DSF=2, both renderers, all scenes: `canvas.width === cssW × 2` (320→640×1136,
  390→780×1688), CSS size and `scale.width/height` unchanged
  (`artifacts/dpr-after/meta.json`).
- DSF=1: canvas === CSS === scale (probe §4 and render-ms runs at OFELIYA_DSF=1).
- Resize persistence: 390×844 → 320×568 → 390×844 keeps backing = CSS × 2 at every step,
  zero errors (`artifacts/dpr-probe/resize-check.cjs`).

### 5.2 Sharpness (main criterion)

Same §6.2 recipe (`numpy` one-pixel step) on identical scenes (menu / battle / mutation
modal / result; 320×568 and 390×844; WebGL + Canvas). Baseline = this branch's parent
code, same harness.

| shot | before max step | after max step | before px>100 | after px>100 |
|---|---|---|---|---|
| webgl-320 menu | 101 | 197 | 17 | 11018 |
| webgl-320 battle | 95 | 175 | 0 | 1697 |
| webgl-320 mutation | 114 | 199 | 249 | 1732 |
| webgl-320 result | 101 | 184 | 4 | 7419 |
| webgl-390 menu | 101 | 184 | 24 | 13979 |
| webgl-390 battle | 95 | 176 | 0 | 1694 |
| webgl-390 mutation | 114 | 200 | 337 | 2104 |
| webgl-390 result | 101 | 184 | 86 | 7900 |
| canvas-320 menu | 92 | 194 | 0 | 643 |
| canvas-320 battle | 87 | 175 | 0 | 314 |
| canvas-320 mutation | 95 | 196 | 0 | 132 |
| canvas-320 result | 90 | 176 | 0 | 209 |
| canvas-390 menu | 87 | 173 | 0 | 739 |
| canvas-390 battle | 88 | 176 | 0 | 303 |
| canvas-390 mutation | 97 | 211 | 0 | 236 |
| canvas-390 result | 87 | 175 | 0 | 212 |

Criterion met everywhere: max 1px step ≥ 100 (was 87–114), pixels >100 from ~0 to
hundreds–thousands. Text edges 10→90% on the «МУТАЦИЯ» header crop: **3 px before →
1 px after** (criterion ≤ 2 px; 579 hard edges vs 197 soft). PNG evidence:
`artifacts/dpr-baseline/*.png`, `artifacts/dpr-after/*.png`.

### 5.3 Layout unchanged

Visual pair comparison of menu/battle/mutation/result at 320 and 390, WebGL + Canvas:
positions and sizes identical in CSS px; only sharpness differs (same scenes as §5.2,
same deterministic pose recipe as `scripts/continuation-capture.cjs`). `npm run build`
(tsc --noEmit + vite build) green.

### 5.4 Input

`scripts/dpr-tap-probe.cjs` at DSF=2 (real CDP touch events, backing 780×1688):

- Menu «НАЧАТЬ ЗАРАЖЕНИЕ» tap → Game active. ✔
- Mutation card tap → `apply()` called, choice resolved. ✔
- Floating joystick press-drag (130,700 → 190,700) → registry `joy` {x:0,y:0} →
  {x:1,y:0} → back to {x:0,y:0}. ✔
- Zero page errors. (`artifacts/dpr-tap-probe.json`.)

### 5.5 Performance (SwiftShader, desktop — G; not the phone)

Deterministic load: 200 spawned enemies + CARDIAC TITAN boss fixture, frozen updates,
manual full-pipeline renders, 60 measured passes (same recipe as
`render-density-paired-proof.cjs`). Equal density 2 on both sides:
**before** = main 2bd6320 QA build with `?renderDensity=2` (experiment density 2);
**after** = this branch, plain URL (automatic density 2 at DSF=2).

| renderer | before avg/p50/p90 ms | after avg/p50/p90 ms |
|---|---|---|
| webgl | 8.74 / 5.70 / 11.20 | 6.05 / 5.50 / 7.90 |
| canvas | 1.99 / 1.90 / 2.50 | 1.75 / 1.70 / 1.90 |

DSF=1 control (patch passthrough): webgl 5.49 → 5.36 avg; canvas 1.61 → 1.83 — within
run-to-run spread. Caveats: SwiftShader software GL, not the S20+ GPU; per-run spread is
visible (p90 > avg); the qaPerf overlay text was not extractable via the harness, so the
table uses direct `performance.now()` around identical render calls — same probe
placement as the overlay's render segment. **No render-ms regression is measurable on
this harness at equal density**; the phone-side `?qaCompare=render` S20+ run remains the
strong variant (§6.5), to be executed by Codex/Mark — the fix only changes fill rate the
way the approved experiment already did.

### 5.6 Canvas fallback

`artifacts/dpr-after/canvas-*.png`: picture intact at 320/390, sharpness up (§5.2),
header text crisp and inside bounds — the resolution-1 canvas-text guard is in place and
unchanged.

### 5.7 Test suite (this environment)

- `npm run build` — green.
- test:viewport, test:qa-perf, test:readability-signal, test:runtime-quality,
  test:palette-contrast, test:b2b4-fixes, test:choice-integrity — green.
- test:integration-visual-browser, test:biological-impact-smoke — green
  (`utility variants PASS`, `motion browser PASS reduce/no-preference`,
  `3 cells captured; 0 contract deviations (strict)`).

Environment note (same as prior handoffs): some browser/device suites are not runnable
here; results above were produced against the local dev server on 127.0.0.1.

## 6. Honest limitations

- Device acceptance (S20+) not run from this environment: backing-store metadata,
  sharpness perception and the paired `?qaCompare=render` render-ms measurement on the
  phone remain for Codex/Mark (qaCompare tooling lives on QA branch #280 and must not be
  merged from).
- The pre-fix render-density QA harness (`render-density-qa.yml` / `render-density-*.cjs`)
  assumed it owns the density switch; on this branch the production path owns it at
  DPR ≥ 2. The `?renderDensity=2` auto-install is guarded off (double-patch would give
  4x). **Adapted in this PR (follow-up commit):** `scripts/renderer-smoke.cjs` now
  asserts backing/drawingBuffer/viewport = CSS × min(DPR, 2) — the DPR 3 case is the
  cap check (2x, never 3x) — while logical sizes, CSS bounds and input scale stay
  exactly CSS. `scripts/render-density-paired-proof.cjs` no longer installs the
  experiment on top of dprCanvas (in Canvas the two call-through resize wrappers
  fought: dprCanvas is innermost and wins, so the experiment's quality fallback
  could not drop the buffer to 1x; in WebGL the double-wrapped viewport/scissor
  would scale GL calls 4x). It now pairs a DSF=1 context (dprCanvas passthrough,
  1x) against a DSF=2 context (dprCanvas 2x): logical geometry must match, backing
  must differ by exactly 2x, input/resize are verified at 2x, and quality changes
  must NOT change the backing store (density is DPR-driven only — the new
  contract; the old quality-fallback-to-1x and 4M-cap assertions belonged to the
  experiment and are retired with it). One finding from the rework: the browser
  measures every text line ~1px taller/shorter at DSF=2 than at DSF=1 (verified
  on clean main 2bd6320, without dprCanvas — a font-metrics artifact, not a
  layout change), so the geometry comparison tolerates 2.5px per line in height
  and half that in y, while x/width, line count, camera and scale stay exact.
