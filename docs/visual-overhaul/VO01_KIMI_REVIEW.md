# Independent Review — VO01 Frozen Diff

**Review basis:** supplied text only. No tools executed, no tests run, no repository inspected. All judgments below are derived solely from the frozen diff and the two attached file bodies. Anything that cannot be proven from the supplied text is marked as a question, not assumed.

---

## 1. Confirmed

1. **QA gating is DEV/release-matrix-QA-only.** `src/main.ts` installs `window.__renderSnapshot` inside the existing `if (import.meta.env.DEV || releaseMatrixQa)` block, alongside the pre-existing `__game`/`__viewportManager` hooks. No new production exposure path is introduced by this diff. Evidence: `main.ts` hunk at line ~349.

2. **Production opacity test exists and targets the right invariant.** `tests/render-snapshot-opacity.mjs` asserts `['undefined','undefined','undefined']` for `__game`, `__viewportManager`, `__renderSnapshot` on what appears to be a preview build (`:4173`) with a `debug=1` query — i.e., it verifies the query string cannot unlock hooks.

3. **Snapshot is read-only by construction.** `renderSnapshot` only reads (`getBoundingClientRect`, `scale`, `renderer`, `gl.getParameter`, `getBounds`, camera fields). No writes to canvas, cameras, input, or buffers. The smoke test additionally verifies read-only/detached behavior by comparing before/after canvas/input state and by mutating the returned object and re-sampling.

4. **No identity/credentials in snapshot.** The snapshot schema contains only geometry/renderer/camera/text-metrics fields. The smoke asserts `'text' in text === false`, so text *content* is excluded; only bounds/resolution are captured. The mocked bridge user (`id: 42, first_name: 'QA'`) is test fixture data, not captured into the snapshot.

5. **No timers or retained history in the snapshot module.** `RenderSnapshot.ts` contains no `setTimeout`/`setInterval`, no module-level mutable state; each call builds fresh objects. Matches the packet's "avoid timers/log histories; on-demand is enough."

6. **DPR matrix coverage.** The smoke loops `for (const dpr of [1,2,3]) for (const renderer of ['webgl','canvas'])` — 6 combinations, each with menu/game/resize(×2)/resume phases. This matches the required "DPR1/2/3 WebGL/Canvas resize and input mapping."

7. **Bounded traversal.** Text sampling is capped (`visited > 256`, `texts.length >= 4`, `depth > 8`), and the smoke asserts `scene.texts.length <= 4`. Consistent with "bounded" requirement.

8. **RESIZE logical-coordinate invariant is asserted, not changed.** The diff does not touch `ViewportManager` (shown only as context) or any scale config. The smoke asserts `gameSize == baseSize == displaySize == renderer.size == host` and `displayScale == {1,1}` — i.e., it *pins* the existing RESIZE behavior rather than altering it.

9. **Input mapping is verified through Phaser's own transform.** Pointer position is checked against CSS coordinates (`|p.x - x| < 1`) and `camera.getWorldPoint` is compared against the analytic `scrollX + width/2 + (x - width/2)/zoom` formula, at three points (corners + center), per phase. This validates logical input mapping under RESIZE at each DPR.

10. **Canvas-renderer guard preserved and tested.** The smoke asserts `snapshot.renderer.gl === null` for canvas, `text.resolution === 1` for canvas texts, and the nested-Text fixture expects `resolution === (renderer.type === 1 ? 1 : 2)` — the Canvas guard behavior is exercised, not removed.

11. **Prior HiDPI claim not re-asserted.** The packet explicitly says "Do not claim actual HiDPI or real MAX performance," and the diff contains no config-resolution change. Consistent with the refuted claim staying refuted — this diff is diagnostics-only.

## 2. Refuted

1. **"Snapshot hook could leak into ordinary production via this diff."** Refuted as far as the supplied text shows: installation is inside the pre-existing DEV/`releaseMatrixQa` gate, and the opacity test covers the query-param attack vector. *Caveat:* whether `releaseMatrixQa` can ever be true in an ordinary production build is not determinable from the supplied text — see Questions Q1.

2. **"Snapshot mutates render state to take samples."** Refuted by construction (read-only API surface) and by the smoke's before/after equality check on canvas size and pointer position. *Caveat:* `gl.getParameter(gl.VIEWPORT)` is a read; `getBounds()` on Text can internally recompute layout but does not mutate render state — acceptable.

3. **"The diff changes resolution/rendering/gameplay."** Within the supplied text: refuted. The only runtime change is the added hook assignment; `ViewportManager.ts` is context-only. *Caveat:* the smoke fixture does mutate gameplay (`scene.update = () => {}`, `physics.pause()`, adds a Text object) — but that is test-side instrumentation in a QA session, not a production code path. See Findings F5 for the risk this creates.

## 3. Questions

- **Q1 (gating):** How is `releaseMatrixQa` derived? If it is build-time (e.g., env var baked by Vite `define`), dead-code elimination may or may not strip the hook; if it is runtime (query/host check), the opacity test only covers `debug=1`, not the actual `releaseMatrixQa` trigger. The supplied text does not show its definition. This is the single most important unknown for the "ordinary production must expose no hooks" requirement.
- **Q2 (host element):** `renderSnapshot(game, host)` — what is `host` in `main.ts`? Presumably the `#game` container managed by `ViewportManager`. Not shown in the diff hunk; if `host` were ever `document.body` or null, `host.getBoundingClientRect()` would throw or report wrong bounds. Likely fine, but unverifiable from supplied text.
- **Q3 (scene keys):** `['Menu','Game','UI']` are hardcoded. If scene keys change or a scene doesn't exist, `game.scene.getScene(key)` returns undefined and `scene.cameras` throws — `getScene` on a missing key returns undefined in Phaser 3.90, and `undefined.cameras` is a TypeError. The smoke only covers the happy path. Is there a guarantee these three keys always exist at snapshot time?
- **Q4 (resize determinism):** The smoke waits on `window.__game.scale.width === width` after `setViewportSize` + manual `resize` event dispatch. In the real app, `ViewportManager.sync()` is async (bridge race up to 320 ms). The mocked `getViewportSize` resolves immediately, so the test passes, but does the 250 ms `sleep` plus `waitForFunction` fully cover the async sync path on slow CI? Flakiness risk, not correctness.
- **Q5 (visibilitychange):** The resume phase dispatches `document.dispatchEvent(new Event('visibilitychange'))` but cannot set `document.visibilityState` (read-only). `ViewportManager.onVisibility` only syncs when `visibilityState === 'visible'`. In headless Chromium the page is already `'visible'`, so the handler runs — but the test name implies a hidden→visible cycle that never actually occurs. Is the intent only "handler runs without error," or was a real visibility transition meant to be simulated (e.g., via CDP `Emulation.setEmulatedMedia`/`Page.setWebLifecycleState`)?
- **Q6 (text fixture pollution):** The smoke adds `'QA nested'` Text to the live Game scene and never removes it. Subsequent `sample('game')` and resize/resume samples then include this fixture text in `texts` (up to the cap of 4). Intended? It is asserted in the fixture block itself, but later phases' `texts` content is now fixture-dependent.
- **Q7 (renderer.type constants):** Assertions use `state.rendererType !== 2` (WebGL) / `!== 1` (Canvas). Phaser 3.90 defines `CONST.WEBGL = 2`, `CONST.CANVAS = 1` — consistent with installed Phaser 3.90 per the refuted-claim context. Confirm these literals are asserted against `Phaser.Constants` somewhere, or accept the magic numbers (they are stable in Phaser 3.x).
- **Q8 (Windows path):** `chrome || undefined` on win32 lets playwright-core use its bundled Chromium — but `playwright-core` does not download browsers; if no executable is found, launch fails. Is CI guaranteed Linux, or is there a documented Windows prerequisite?
- **Q9 (artifacts on win32):** default `/tmp/browser-smoke` is invalid on Windows. Only relevant if the smoke is ever run locally on Windows; `OFELIYA_ARTIFACTS` env override exists. Acceptable?

## 4. Spec Compliance

| Requirement | Verdict | Evidence |
|---|---|---|
| DEV/QA-only bounded render snapshot | **PASS** (conditional on Q1) | `main.ts` gate; bounded traversal caps |
| No general resolution/input/gameplay changes | **PASS** | Only hook assignment added; ViewportManager untouched |
| Ordinary production exposes no hooks | **PASS** (conditional on Q1) | Opacity test asserts all three hooks undefined |
| Preserve Phaser RESIZE logical coordinates | **PASS** | `displayScale == {1,1}`, `gameSize == baseSize == displaySize == host` asserted; no config change |
| Preserve controls | **PASS** (as far as shown) | Input mapping asserted via pointer + `getWorldPoint`; no input code touched in diff. Joystick/safe-area behavior not exercised by this diff — preserved by omission, not by test |
| Preserve release gate | **PASS** (unverifiable but no weakening shown) | No gate-related files in diff |
| No identity/credentials in snapshot | **PASS** | Schema is geometry-only; `'text' in text === false` asserted |
| Tests DPR1/2/3 WebGL/Canvas resize + input mapping | **PASS** | 6-combination loop; resize phases ×2; pointer/world assertions per phase |
| Prior HiDPI config claim stays refuted | **PASS** | No config-resolution change; packet forbids HiDPI claims |

**Overall: Spec PASS, conditional on Q1 (releaseMatrixQa derivation) and Q3 (scene-key robustness).**

## 5. Findings

### Critical

**F1 — `getScene` on a missing/inactive-boot scene can throw, breaking the QA hook itself.**
Evidence: `RenderSnapshot.ts`: `const scene = game.scene.getScene(key); const camera = scene.cameras?.main;` — `scene.cameras?.` uses optional chaining on `cameras`, but if `getScene(key)` returns `undefined` (key not registered), `scene.cameras` is a property access on `undefined` → TypeError. Phaser 3.90's `SceneManager.getScene` returns `null`/undefined for unknown keys. The three keys are hardcoded; if `UI` is ever renamed or not yet added when the hook fires (e.g., snapshot called during Menu before UI scene exists), the entire snapshot — and the smoke test — throws.
Feasible fix: `const scene = game.scene.getScene(key); if (!scene) return { key, active: false, paused: false, camera: null, texts: [] };` before touching `.cameras`. One-line guard; keeps the hook total (never throws) which is the right property for a diagnostics tool.

### Important

**F2 — Opacity test does not prove the hook is stripped from production builds; it proves the gate is false at runtime.**
Evidence: `render-snapshot-opacity.mjs` loads `?renderer=canvas&debug=1` on `:4173` and checks the hooks are undefined. If `releaseMatrixQa` is a runtime-evaluated expression (not build-time constant), the code path `window.__renderSnapshot = ...` still exists in the shipped bundle — merely unreachable. "Ordinary production must expose no hooks" is satisfied behaviorally, but the packet's "debug hook must not exist in ordinary production" reads stronger ("must not exist"). If the requirement is literal non-existence in the bundle, this needs a build-time `define` + a bundle grep test (e.g., assert the string `__renderSnapshot` is absent from the production chunk), not a runtime typeof check.
Feasible fix: either (a) confirm `releaseMatrixQa` is a build-time constant replaced by Vite `define` and add a static bundle assertion (`!bundle.includes('__renderSnapshot')`), or (b) downgrade the packet wording to "must not be reachable." Coordinator decision.

**F3 — Test fixture mutates the live game (`scene.update = () => {}`, `physics.pause()`, adds permanent Text), so later-phase samples measure a modified game.**
Evidence: smoke hunk — `game.scene.getScene('Game').update = () => {};` then `scene.physics.pause()` then `scene.add.text(10,10,'QA nested')` which is never removed. All subsequent `sample('game'/'resize'/'resume')` calls run against this altered scene. The dimension/input invariants being asserted are still meaningful (they're camera/scale-level, not gameplay-level), but the fixture permanently overrides a scene method by assignment, which also silently breaks if `Game` scene's update is later needed by any assertion added downstream.
Feasible fix: snapshot/restore — capture `const origUpdate = scene.update` and the added text reference, restore after the game-phase sample; or scope the mutation to the narrowest block and document that resize/resume phases intentionally run on the paused scene. At minimum, add a comment stating the mutation is deliberate and permanent for the session.

**F4 — `visibilitychange` phase does not simulate a visibility transition; the assertion name overstates coverage.**
Evidence: `document.dispatchEvent(new Event('visibilitychange'))` — `document.visibilityState` remains `'visible'` in headless Chromium; `ViewportManager.onVisibility` early-returns unless `'visible'`, so this does exercise the sync path, but no hidden→visible cycle occurs. The packet requires sampling "after viewport resize/resume" — the *pause/resume* of the scene is real (`scene.pause('Game'); scene.resume('Game')`), so the resume requirement is met via the scene API; only the visibility label is misleading.
Feasible fix: rename the phase to `'resume'` (it already is) and drop the synthetic visibilitychange dispatch, or use CDP to actually emulate visibility. Lowest cost: keep dispatch as a smoke that the handler is wired, but don't claim visibility-transition coverage in reports.

**F5 — `assert.deepEqual(snapshot.canvas.intrinsic, { width, height })` hard-codes the refuted assumption that intrinsic canvas size equals CSS host size at all DPRs.**
Evidence: smoke `sample()`: intrinsic canvas `{width,height}` is deep-equaled to `host` `{width,height}` where host comes from `getBoundingClientRect()` (CSS pixels). Under Phaser 3.90 RESIZE with no config resolution, `canvas.width` equals CSS width × 1 (resolution=1), so this passes — but it *encodes* the current (refuted-as-HiDPI-fix) behavior as the expected invariant. That's actually correct for a diagnostics-baseline test: it pins today's behavior so the future real HiDPI fix intentionally updates the test. However, if any future change sets `resolution: dpr`, this test fails at DPR2/3 even though rendering is correct.
Feasible fix: add a comment at the assertion: "pins resolution=1 baseline; update when HiDPI lands," or assert `intrinsic.width === width * (snapshot.dpr > 1 ? currentExpectedResolution : 1)` derived from a named constant. Comment is sufficient for VO01 scope.

### Minor

**F6 — Magic numbers for renderer type.** `state.rendererType !== 2` / `!== 1` and `game.renderer.type === 1` in the fixture. Phaser 3.90: `CONST.CANVAS = 1`, `CONST.WEBGL = 2`. Stable, but `Phaser.Constants.CANVAS`/`WEBGL` (available in the page via `window.Phaser` if exposed, or via the game's `Phaser` reference) would be self-documenting. Fix: optional; add a one-line comment citing Phaser 3.90 constants.

**F7 — `getViewportSize` mock returns strings (`String(innerWidth)`), matching the real bridge's stringly-typed API — good fidelity — but the smoke never asserts the parsed frame equals the viewport when safe-area insets are nonzero.** Headless Chromium has zero safe-area insets, so `computeViewportFrame` passthrough is the only path tested. Acceptable for VO01 (safe-area behavior explicitly out of scope to change), but note the coverage gap in the report. Fix: none required; document.

**F8 — `/tmp/browser-smoke` default and Linux-only Chrome paths remain in a file now partially win32-aware.** `process.platform !== 'win32'` guard and `OFELIYA_ARTIFACTS` override exist, so this is cosmetic inconsistency, not a bug. Fix: optional — default artifacts to `require('os').tmpdir() + '/browser-smoke'`.

**F9 — `first.canvas.intrinsic.width = -1` mutation-detachment check mutates a frozen-nothing object; fine, but the check would also pass if `renderSnapshot` returned deep-shared references that happen to be re-created per call.** The check is adequate for its purpose (aliasing of the *returned* object vs *live state*). No fix needed; noting precision.

**F10 — Opacity test waits a fixed `waitForTimeout(1000)` instead of a deterministic condition.** Minor flakiness surface on slow CI; the hook (if present) is installed synchronously at boot, so 1000 ms is generous. Fix: optional — wait on `window.__game !== undefined || document.querySelector('#game canvas')` plus one rAF.

## 6. Summary

The diff is a faithful, minimal implementation of the VO01 packet: diagnostics-only, gated, bounded, content-free, and it pins (rather than changes) RESIZE behavior across the full DPR/renderer matrix with genuine input-mapping assertions. No test results are claimed here — none were run.

**Blocking before acceptance:** F1 (one-line guard) and F2 (coordinator decision on "must not exist" vs "must not be reachable," ideally with a static bundle assertion). Q1 must be answered to close the gating question definitively. Everything else is polish or documentation.
