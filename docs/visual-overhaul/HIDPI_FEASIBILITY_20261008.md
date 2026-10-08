# Phaser 3.90 bounded density investigation — 8 October 2026

Confirmed viable for a narrow main-framebuffer QA experiment. Do not enable automatically for users before full-game and device evidence.

## Verified engine behavior

- `ScaleManager.js:831` resize writes identical logical `gameSize`, `baseSize` and backing `canvas.width/height`. There is no useful game-config renderer `resolution` switch in this installed version.
- `ScaleManager.js:976` computes input `displayScale` from logical `baseSize` divided by DOM canvas bounds; preserve these values.
- `WebGLRenderer.js:1420` resize uses the same dimensions for logical orthographic projection and physical GL viewport. Its initial scissor reads **physical** `gl.drawingBufferHeight`.
- `WebGLRenderer.js:1688` setScissor converts top-down Y using `renderer.drawingBufferHeight`; keep that field logical for default framebuffer. `resetViewport:1792` also overwrites it from physical GL height.
- `CanvasRenderer.js:302` resize only assigns renderer geometry. `resetTransform:316` and camera/game-object render transforms overwrite an earlier `ctx.scale`; scale the main-context `setTransform` arguments per instance instead.
- `TransformMatrix.js:688/708` copyToContext/setToContext and sprite/particle/Graphics Canvas paths ultimately use native context transforms; keep object/camera geometry untouched.
- Current OFELIYA `PerformanceProfile.ts` explicitly disables camera postFX for both tiers. No active custom-pipeline/renderTexture/mask paths found. Scene code contains a guarded postFX path; this has not been tested under density.

## Draft and executed proof

`hidpi-adapter-draft.cjs` is a throwaway adapter, outside the product repository. It scales only physical canvas and default-framebuffer GL operations, keeps logical WebGL projection and renderer resize notifications, scales only Canvas main-context setTransform, and resynchronizes backing size on **every** Scale resize event (including repeated same-size resize, which otherwise overwrites backing size while renderer onResize skips).

Run `node work/hidpi-paired-proof.cjs`. It uses installed Phaser 3.90 and native Playwright Chromium/SwiftShader. Result: **PASS 12 cells** = WebGL/Canvas × DPR1/2/3 × density1/2. For initial and resized stages the proof compares unchanged scale dimensions/displayScale, camera viewport/zoom, rectangle and Text getBounds, actual interactive hit coordinates. It additionally proves exact physical scaling of a red object raster while a custom camera viewport exercises scissor handling. JSON: `hidpi-paired-evidence.json`.

Example density2: logical320×400, backing640×800, camera zoom1, displayScale1; rectangle logical60,75,40,30 maps exactly to physical pixels120…199 and150…209. The stronger custom-viewport proof shifts this as expected and preserves logical pointer hit100,120.

## Actual OFELIYA prototype proof

Executed `node work/hidpi-game-proof.cjs` against live dev5188. **PASS WebGL and Canvas** with paired1x/2x actual Menu and Game screenshots, unchanged camera and every visible Text geometry,200enemies plus1boss, actual visible boss bar (`bossBack.visible=true`,104fill commands), actual DOM mouse click100,200 resolving to Phaser interactive hit100,200, and repeated390×800 resize resolving to780×1600 backing. Both rows have zero pageerrors. Snapshot evidence and10screenshots are in `work/hidpi-game-proof/`. The prototype was injected into browser memory; product code was untouched.

This is a frozen presentation fixture: Game.update and enemy movement are frozen and physics paused to compare the same geometry. It verifies raster/layout/input behavior, **not runtime FPS**, full control gameplay, host bridge behavior or thermal stability. Tutorial overlay remains visible intentionally; this fixture is not a newcomer comprehension study. Boss200+1 actors confirms density coverage but not crowd-readability acceptance.

The10PNGscreenshots are all780×1688 or780×1600 because browser screenshot DPR2 applies to CSS output even when backing is1x. Actual backing sizes are independently recorded in JSON. Thus equal screenshot dimensions do not imply equal render density. Native visual inspection confirms dense art detail is retained in2x; Canvas text stays softer owing to the existing resolution1guard.

`RenderDensityAdapter.draft.ts` is the TS integration draft with discrete1/2density,4Mpixel and GPU dimension caps, matrix overload and disposal. Caller must gate it to explicit QA and reduced tier1x. The proof executed the JavaScript adapter draft, not this TypeScript integration file; parent must type-check and retest the final integrated version.

## Limits and integration recommendation

This is isolated-scene correctness evidence, not a dense OFELIYA performance result. Text geometry is verified; higher text texture detail requires the existing WebGL Text resolution policy. Existing Canvas Text resolution1 guard must remain, avoiding the known Phaser source-resolution drawing bug. Scaling backing alone cannot restore details absent from source textures.

Integrate only behind an explicit QA density override, with default1x, max2x, reduced-tier automatic1x, pixel cap, GPU dimension cap and clean disposal. Prefer a discrete2x→1x budget fallback over the draft's fractional budget density; rounded fractional dimensions need independent X/Y physical ratios to avoid subpixel/scissor drift. Pin/assert Phaser3.90 because this adapter depends on internals. Keep offscreen/postFX disabled or fail closed pending dedicated tests. Never alter camera zoom, physics/body scales, Scale baseSize/gameSize, or Joystick.

Before activation: full menu/HUD/game scenes and76geometry rows; both control modes and modal input; dense100/150/200 full/reduced; viewport/bridge resize and visibility resume; scissor/flash/fade; renderer context-loss recovery; real MAX Android/iOS and Telegram with thermal/frame-time/memory evidence. Add diagnostics reporting actual canvas backing and effective density to avoid treating DPR emulation as true HiDPI rendering.

Context-loss boundary: existing `main.ts` listens for `webglcontextlost`, prevents default, remembers session Canvas fallback and reloads once. Density should remain independently opt-in on the reloaded Canvas path or conservatively return1x there. Draft sync suppresses GL work when renderer.contextLost. A context restore without reload and Phaser renderer resource rebuild has not been tested; wrappers are bound to the initial renderer/context instance. Resize or disposal mid-render is unsafe because it invalidates main-framebuffer state; install/sync at boot/Scale resize boundaries. PostFX, RenderTexture, bitmap masks and shader frag-coordinate paths need dedicated evidence before claiming compatibility; scaled default framebuffer operations leave offscreen targets1x by design, which can lose detail or produce wrong compositing under untested shaders.

## Integrated QA slice and fresh verification

The final repository adapter is `src/systems/RenderDensityExperiment.ts`. Explicit `?renderDensity=2` only applies inside DEV/release-matrix QA and DPR>=2. Ordinary production stays1x; maximum2x,4M physical pixels and GPU dimension limits, static reduced/runtime-low fallback1x. Phaser3.90 pinned at runtime. No gameplay/Joystick/score/RNG/physics/camera-scale changes.

Final TypeScript check PASS. `render-density-smoke.cjs` PASS six WebGL/Canvas×DPR1/2/3 cells with390×844,320×568,360×640,412×915, actual input transforms, scene pause/resume, already-visible handler and real Game.destroy/no pageerrors. `render-density-paired-proof.cjs` uses the actual TS adapter through Vite, not the initial throwaway JS: identical visible Text/camera geometry, actual DOM hit100,200, repeated390×800 resize,201actors and visible boss bar. Runtime-low fallback and recovery verified. Extra static-tier/pixel-cap assertions are included. Capture JSON is stored separately.

Native visual inspection of final WebGL paired201actor frames confirms materially sharper text/art at2x. Both screenshots780×1688; measured backing changes390×844→780×1688. Canvas retains the existing Text resolution1 guard, so framebuffer improvement does not solve all text softness. Crowded presentation still needs temporal phone judgment.

One-hand/twin-stick/dual-move multitouch control contract PASS with explicit density2/DPR2/full. No production control source changed. Synthetic already-visible dispatch is not OS background/foreground acceptance. Frozen dense snapshots and headless RAF samples are not mobile FPS or sustained performance evidence.2x quadruples framebuffer area; a4Mpixel cap does not itself establish a memory/thermal budget.

Integration exposed and fixed a real stale CSS/input-ratio issue after Scale resize; explicit canvas CSS dimensions require bounds/displayScale refresh after the resize event. TypeScript declarations omit Phaser's installed pendingDestroy internal field; an explicit shape cast and teardown smoke cover that guard. Earlier fixture resize timeout and HMR reload failures were resolved by actual host viewport sync and stable-source reruns; assertions were not relaxed.

Independent Codex final source review: no substantiated Critical/Important findings within the stated current QA scenario. Full report: HIDPI_CODE_REVIEW_20261008.md. Kimi's additional HiDPI review was blocked by provider403quota, preserved as a limitation; no Kimi approval is claimed for this adapter. Earlier polish Kimi review is separate. Dedicated hosted workflow render-density-qa.yml uploads density pairs/snapshots; exact checks linked after publication.

Remaining gates: actual WebGL context recovery, offscreen targets/masks/postFX, host WebView touch/audio lifecycle and real MAX Android/iOS + Telegram performance/thermals. This is a reviewable QA experiment, not production HiDPI readiness. Do not automatically activate it or merge/deploy without the user's authorization.

Final extra guards PASS for both renderers: static-tier reduced1x, runtime-low1x/full2x, larger1100×1000host exceeds4Mphysical pixel budget and falls back1100×1000backing. Initial cap fixture failed because RESIZE used unchanged390×800host; setting the actual larger host fixed the fixture, cap/assertions preserved. Final ordinary build fc50baa + production diagnostic/query opacity and actualDPR2backing1x PASS; bundle shape PASS. Full final evidence: HIDPI_INTEGRATED_EVIDENCE_20261008.json and HIDPI_SMOKE_EVIDENCE_20261008.json.

## First hosted density fixture correction

Initial dedicated run37709559621 passed all six renderer/DPR/viewport/teardown cells, but Canvas paired pointer probe produced no hit despite transform100,200. The instantaneous Playwright click and100ms wait could complete before a slow software Canvas frame consumed it. Fixture now holds a real mouse down until actual Phaser pointerdown is observed, then releases. Exact100,200 assertion and all layout/backing/cap/error checks remain unchanged; no production code changed. Fresh local/hosted reruns are required. Ordinary compiled QA six cells PASS at9756283, supplementing dev adapter proof.

Source-level cause refinement: installed InputPlugin.setInteractive queues the new probe in _pendingInsertion; preUpdate transfers it to _list. A DOM click before the first resumed scene preUpdate cannot hit it. The fixture explicitly waits until the real InputPlugin list contains the enabled probe before pressing, then waits for pointerdown. No synthetic emit and no input-source change. This corrects the earlier timing hypothesis; final hosted proof is required.
