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
