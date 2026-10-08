# VO01 Fix Round 1 — Scoped Re-Review

## Prior Findings Verdicts

### F1 — Missing scene null guard: **ADDRESSED**

Evidence: `src/systems/RenderSnapshot.ts` adds `if (!scene) return { key, active: false, paused: false, camera: null, texts: [] };` before `scene.cameras?.main`. The new focused test `tests/render-snapshot-missing-scenes.mjs` removes UI/Game/Menu from the real SceneManager via `game.scene.remove(key)` and asserts all three canonical keys return the empty diagnostic record shape. Validation doc records RED (exit 1, `null.cameras`) pre-fix and GREEN post-fix. Guard placement is correct — before any scene property access.

### F2 — Ordinary production static hook removal: **ADDRESSED**

Evidence: `src/main.ts` (supplied context) gates hooks on `import.meta.env.DEV || import.meta.env.VITE_RELEASE_MATRIX_QA === '1'` — both are build-time substitutions, not runtime query checks. The opacity test now performs a two-layer check: (1) static scan of every `dist/assets/*.js` chunk asserting the literal string `__renderSnapshot` is absent, with a non-empty-chunks guard; (2) browser check with `?renderer=canvas&debug=1` asserting all three hooks are `undefined`. This covers both minification-renaming risk and runtime-query-activation risk. The ordinary production build (`VITE_RELEASE_MATRIX_QA=0`) passed exit 0 per the evidence table.

### F3 — Fixture mutation controlled; nested fixture destroyed: **ADDRESSED**

Evidence: The pre-start update freeze now carries an explicit comment scoping it to the QA context with the rationale (Phaser captures update before CREATE; restoring later would break control-smoke isolation). The nested fixture is wrapped in `try { … } finally { container.destroy(); text.destroy(); }` — destruction is guaranteed even on assertion failure. Both `container` and `text` are destroyed, and the subsequent `sample('game')` runs after the finally block, so later snapshots cannot contain the QA text. Physics pause remains documented as fixture isolation.

### F4 — Honest scene-resume / visible-signal coverage: **ADDRESSED**

Evidence: The resume step performs a real `scene.pause('Game')` / `scene.resume('Game')`, then asserts `document.visibilityState === 'visible'` (throwing otherwise) before dispatching synthetic `visibilitychange`. The inline comment and validation doc both state plainly: this is an already-visible handler smoke; hidden→visible transition, OS background/foreground, and real MAX resume are **not** covered. The assertion upgrade (throw if not visible) makes the fixture precondition explicit rather than silently vacuous. Scope is now honestly bounded.

### F5 — Intrinsic assertions pin current baseline: **ADDRESSED**

Evidence: The `intrinsic === { width, height }` assertion now carries a comment: "Pins Phaser 3.90 RESIZE's current intrinsic=CSS baseline, not real HiDPI. A future framebuffer-density design must deliberately revise this expectation." This converts a silent coupling into a documented, intentional baseline pin. The WebGL renderer-type check similarly documents `WEBGL=2, CANVAS=1` as Phaser 3.90 constants with minification rationale.

## New Breakage Scan (fix diff only)

**Critical: none.**

**Important: none.**

Minor observations (not flagged as breakage, within spec tolerance):

1. `render-snapshot-missing-scenes.mjs` uses `page.route('https://st.max.ru/**', … fulfill({ body: '' }))` — consistent with the existing opacity test pattern; no new external dependency.
2. The opacity test's sessionStorage marker key `ofeliya_startup_nav_v1` is an existing startup artifact, not a new hook; readiness no longer relies on a fixed 1000 ms timeout, which is a strict improvement in determinism.
3. Artifact path change `/tmp/browser-smoke` → `os.tmpdir()` join is cross-platform correct and env-overridable; no behavior change on Linux CI.
4. Missing-scenes test asserts `deepEqual` on the full scenes array including key order `['Menu','Game','UI']` — matches the canonical map order in `RenderSnapshot.ts`; brittle only if that order changes, which would be a deliberate spec change.
5. Validation doc honestly notes builds are stamped with pre-fix HEAD SHA `6204e33`, not the fix commit — acceptable for local evidence, correctly disclosed.

## Spec Compliance

- DEV/QA-only diagnostic hook: confirmed — build-time env gate, static bundle scan, runtime opacity assertion.
- Content-free bounded snapshot: confirmed — empty-record shape for missing scenes adds no game state.
- No renderer gameplay or input change: confirmed — production code delta is one null guard; all other changes are test scripts and comments.
- No new auth/config/routing operations; no dependency changes.

## Overall Verdict: **PASS**

All five prior findings (F1–F5) are addressed with direct code evidence and recorded test evidence. No new Critical or Important breakage introduced in the fix diff. Residual risks (hidden transitions, real HiDPI, device safe-area, CI latency) are explicitly disclosed as out of scope and honestly bounded in the validation document.
