# Mutation art recovery — 16 October 2026

The current live visual baseline is44c6579. On cold public startup, some optional mutation-art requests were cancelled before the1800ms Boot deadline even though the packaged WebP files returned200 independently. Boot correctly stayed usable through procedural fallback, but its canonical bake removed raw textures and never revisited that fallback. The consequence was a permanently simplified mutation silhouette for that page session.

The recovery branch preserves the fast startup and existing packaged artwork. During the original bake, it records whether each of the three mutation textures actually used packaged pixels. After the first render, only known fallback textures request their existing same-origin files again. Requests are bounded to two attempts per key,8000ms per attempt with a750ms retry delay. Three keys are the maximum concurrent workload. Failures leave the usable fallback intact.

Successful image loads are staged at the existing256×256 backing and copied into the same CanvasTexture object, followed by the Phaser texture refresh. Existing Player images retain their frame, scale, alpha, blend, depth and authoritative body. There is no per-frame loader/texture poll and no retained raw GPU texture. Recovery is shared across Menu/Game restarts within the same game; destruction cancels requests, timeouts and late callbacks. Unknown/replaced/already-packaged textures are never overwritten.

No Player, enemy, RNG, checkpoint, audio, score, server, input or service configuration changes belong to this fix. The original three512×512 WebP files and provenance hashes are unchanged. This is reliable delivery of the established art, not an unreviewed redesign of every mutation or the complete visual overhaul.

## Verification

- `npm run test:mutation-art-recovery`: five executed production-module contracts cover first-render gating/deduplication, same-object bounded refresh, finite timeout/retry, destruction cleanup and texture/provenance replacement races.
- `npm run test:presentation`: includes the new recovery contracts alongside core-art16, VFX12, atmosphere9, audio20, biological animation, pinned23audio assets and boss presentation.
- `npx tsc --noEmit`: passed during implementation.
- Real delayed-image Canvas/WebGL startup and final exact-head CI/review/publication evidence are recorded after execution; test presence is not runtime acceptance.

Keep physical-phone MAX/Telegram/iOS, frame-time/thermals and newcomer gates separate. Existing auto-deploy/main tracking must remain unchanged; publication uses an explicitly authorized tested pushed commit and fresh state backup, without merging main.

Local browser result: all four available/missing/stalled/Android-stalled startup scenarios passed below6000ms. Canvas and WebGL each recovered all three delayed images after Menu became usable; the existing256px texture and canvas identities were preserved and every RGBA pixel matched an independent decode of the packaged file. Four actual rendered Player states (three individual mutations and combined) changed in both renderers. Sixteen paired frames plus recovery.json are in the workspace evidence/mutation-art directory. This is a frozen Player presentation fixture, not a device/performance run.

The negative control removes the recovery call only in Vite's test transform and fails because no late image requests occur. Independent production-source review found no concrete P1/P2, including cancellation, bounded retry, texture replacement races and same-object WebGL refresh. The initial screenshot fixture exceeded both image retry windows (~19s); captures now read the real canvas synchronously inside postrender and release images within2.5s. Production deadlines remain unchanged.

Independent static review: all16Canvas/WebGL frames reviewed. No blocking crop, shift or overexposure. Prism retains a spiked silhouette; halo/singularity/combined share a red-green rosette palette more than their procedural fallbacks. Keep existing scale/alpha for this delivery fix; distinct mutation silhouettes remain a separate visual backlog item. Static fixtures do not prove movement, crowded combat or physical-device acceptance.

Product commit:7a0d8292a47a42dae9eeb8d7623ced9affa75c20. Dependent PR216 targets PR214 branch. Hosted CI38863701636 and visual matrix38863701150 are pending; this document must not be read as publication proof yet.

Fresh pre-publication backup: revision152,74scores,4profiles,1registration; gzip roundtrip passed, SHA2569c8dfebc51e052269da53f42f39f3fde1adee89292328f1f28a8fc14a901fa9a. Remote reads only; snapshot and credentials are private and excluded from this repository. Old release44c6579 remains live until exact-head CI and pinned publication complete.

## Verified publication

All exact-head checks passed for7a0d8292a47a42dae9eeb8d7623ced9affa75c20: build, browser-smoke, production-contract (CI38863701636) and visual-matrix (38863701150). Render Free deploy dep-db8sqinf3r2c73f9u5f0 became live2026-10-16T07:08:41.804Z (10:08:41 Moscow). Public release marker, HTML/runtime/service-worker hashes and main JS were verified; ready/health/remote persistence are healthy. State revision152→153, all74 immutable score rows,4profile values and1registration retained unchanged. Service configuration and main aba70324 remain unchanged. PR216 remains open and depends on214; no merge occurred.

See exact-head-checks.json, triggered.json, before-readback.json and after-readback.json. All are sanitized; private before/after snapshots are excluded. Public browser result follows separately. Earlier pending paragraphs above are chronological snapshots, superseded only by these measured final results.

## Public browser verification

Installed desktop Chrome, real public URL, no mocked network, fake initData or QA hooks. Menu startup at320×568,360×640,390×740 passed; page exceptions, console errors, HTTP errors and CSP violations all zero. At320and390, two original mutation XHRs each aborted at Boot's deadline and each was followed by an image HTTP200 response: recovery therefore occurred on the actual public release. At360all original mutation requests completed. See browser/report.json. Public touch at390 reached mutation choice, active field and onboarding step3; the final frame visibly contains the packaged player art. These observations do not establish movement displacement, physical MAX/Telegram/iOS, sustained dense-combat FPS/thermals or newcomer acceptance.

Final source tree is clean. Product PR216 remains open; documentation stays in companion PR215. Preserve existing auto-deploy/main settings: a future successful main deployment may supersede this pinned candidate.
