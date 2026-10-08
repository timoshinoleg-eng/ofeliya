# Independent final HiDPI code review - 2026-10-08

Reviewer: independent Codex fallback. Kimi density review was unavailable after provider HTTP 403 quota exhaustion; this is not a Kimi approval. Read-only product-source review; no browser rerun by this reviewer.

## Confirmed

No Critical or Important correctness finding substantiated in the current bounded QA-only Phaser 3.90 scenario.

- main.ts gates installation inside DEV or VITE_RELEASE_MATRIX_QA=1, and additionally requires explicit renderDensity=2 plus DPR>=2. Ordinary production has no executable installation branch; actual tree-shaking must be demonstrated by build inspection.
- Adapter keeps renderer/projection/Scale dimensions logical. Default-framebuffer viewport/scissor are doubled; offscreen bindings use ratio1. Canvas patches only main-context setTransform. Actual installed Phaser3.90 resize/scissor/resetViewport/Canvas preRender and input transform paths were inspected.
- Density is discrete1/2, capped at4M physical pixels and GL texture/renderbuffer dimensions; static reduced/postFX and runtime-low select1x. Bounds/displayScale refresh after CSS resize resolves the previously stale pointer ratio.
- Teardown restores hooks/listeners once. pendingDestroy guard avoids resize/renderer notifications during Game teardown. Installed Game.runDestroy destroys scenes, emits DESTROY, then destroys renderer. ScaleManager's earlier listener cleans resources but retains gameSize/baseSize objects; DataManager.destroy retains its emitter, so subsequent off calls remain valid.
- Prior DOMMatrix alias, paired-proof pageerror assertion and adapter teardown-comment issues are fixed. Integrated smoke now includes360x640 and real Game.destroy with post-teardown error check.

## Refuted

- My initial suspicion that ScaleManager.destroy nulls gameSize and would directly throw through width/height getters was disproved by installed Size.destroy, which clears parent/snapTo only.
- Headless RAF samples and frozen201-actor paired rendering do not establish phone FPS, thermals, live progression or target-shell acceptance. Both scripts describe their fixtures accordingly.

## Questions / remaining evidence boundaries

- Final pendingDestroy TypeScript shape cast and exact final-head typecheck are coordinator-owned (Phaser declaration omits this installed internal field).
- Context loss/restore, RenderTexture, bitmap masks, shader fragment-coordinate behavior and postFX remain unverified. Existing app context-loss handler normally reloads to Canvas. No compatibility approval for these paths.
- release-visual-matrix.yml currently runs the existing12-case matrix, not either density script, and its PR path filter excludes main.ts/the new adapter/density scripts. No hosted density check is established by this workflow today.
- Coordinator reports six integrated renderer/DPR cells, four viewports, teardown, paired frozen rendering/input and runtime-low fallback passed. Those are coordinator-run results, not independently rerun results by this reviewer.

Verdict: code review passes for opt-in QA experiment within the stated current-renderer scope; no merge/deploy or real-device acceptance approval.

Coordinator resolution: final explicit pendingDestroy internal shape cast typechecks. New dedicated render-density-qa.yml executes both density scripts on relevant PR changes; this supplements, rather than changes, the existing visual matrix. Hosted results will be linked after publication.
