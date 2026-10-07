# Presentation overhaul acceptance — 7 October 2026

Base main: `d7797bc67bbda063d2fc3de68026101b0b061121`. Branch: `visual/overhaul-20261007`. Deliverable is a reviewable PR; no merge or production deployment.

## Recovered work

The interrupted local Codex recovery log ended with a usage-limit error. Saved cloud worktrees/commits were retained. Tasks1–4 already existed; recovered Task5 art integration and completed Task6 Menu/HUD without repeating those implementations.

Seven generated assets total247,338bytes, locally packaged and provenance recorded. Fourfold backing compensation preserves logical display/body geometry. General canvas density stays1x; this is not a general Retina/HiDPI renderer implementation.

## Evidence

| Check | Result |
| --- | --- |
| Pure presentation contracts | PASS via `npm run test:presentation`; production TS against documented I/O adapters |
| Existing contract batch |39/42localPASS, including server75checks; rollback and Compose additionallyPASS on HONOR, one real-device evidence gate unavailable |
| Actual Phaser world geometry |76WebGL/Canvas rows equal frozen pre-art baseline, including breathing, roles/elites/bosses, recycling and host checkpoint restore |
| Art startup | Available1587ms, missing658ms, stalled2912ms, Android stalled2569ms; unchanged6000ms gate. Seven distinct stalled requests, no retries; Android six-download default raised to seven |
| Elite readability | PASS after correcting test expectations for Phaser floored half sizes; no body-production change |
| Render diagnostics | WebGL/Canvas × DPR1/2/3 PASS; resize/resume and input mapping checked |
| Compact/mobile UI | Five viewport matrix, restart-safe resume, result resize and multitouch/control modes PASS |
| Legendary layouts | Four viewport probePASS before decorative-only finish; unchanged modal implementation |
| HUD | HONOR native Windows ChromiumPASS at320×568,360×600,390×740,412×915,360×760,390×844 with kills0/99/999/2142/5560/99999 |
| Audio | Retained actual-source seven-bed offline busy mix evidence:4,032,000finite samples, zero hardclip, peak0.846494; no phone loudness or procedural-extrema claim |
| Startup font/viewport/renderer contracts | PASS after isolating font gate from optional image loading;900ms font assertion unchanged |
| Ordinary production | BuildPASS; diagnostic hook absent from JS and runtime even with debug query; bundle shapePASS |
| Independent review | Fresh whole-branch code reviewPASS, Kimi static reviewexit0/PASS; scoped fixture/CI corrections reviewed separately |
| Dense visual matrix | HONOR integrated7f4cb4fPASS:390×740,100/150/200 × WebGL/Canvas × full/reduced,12captures and visual-parityPASS. Native launcher path only changed in temporary fixture; all browser flags/assertions/metrics retained |

## Failures preserved and limitations

- Local rollback policy test lacked historical git object `d74d317...`; local Compose test lacked Docker. Both passed on HONOR after fetching current origin/main. The first native rollback attempt used a stale inherited origin/main; that failure is preserved. Neither deployment code path was changed in this presentation task. Hosted CI remains required.
- `test:mobile-evidence` has no real-device `artifacts/mobile-acceptance.json`. MAX Android/iOS16-point and Telegram real-device/audio unlock/performance acceptance remain external release gates.
- Linux DejaVu HUD kill-label overlap also reproduced untouched base main. The corresponding native Windows six-viewport HUD gate passed. Do not attribute this fallback-font portability issue to the decorative finish; do not claim universal phone-font acceptance.
- Initial art stall >6s was real: Phaser retried each1800ms image twice. Optional-art retries are now captured as0 and prior Loader policy restored. Real stalled-XHR evidence proves recovery.
- The new elite source-world assertion initially ignored Phaser body flooring. Fixed fixture measures the preserved actual floor; the frozen76-row geometry comparison remains exact.
- The first density capture run had an extra host cell because physics pause does not stop `Game.update`; four-line test-only update freeze preserves fixed capture density without altering any gameplay or readability thresholds.
- Kimi’s C1 discussion about hidden-SFX fallback contradicts the explicit authoritative silence/visibility contract and its own finalPASS. Intentional silence during hidden/muted state is covered by the17audio contracts. No production change was made for this refuted concern. Optional future music-track/trim-array coupling is a maintenance note, not a current defect.
- Browser rendering uses Chromium153/SwiftShader; no mobile FPS, thermals, perceptual music-quality or device readiness inference.

Focused tests are wired into CI; ordinary production opacity remains a separately run build/preview check. Existing dependency/build warnings are retained, not suppressed.

## Final matrix recovery

Cloud Chromium153/SwiftShader produced partial captures but twice hit the existing30s locator screenshot stability wait; no thresholds were changed. HONOR ran final integrated7f4cb4f in the native configured Chromium with only the Unix executable path replaced in an untracked temporary driver copy. The missing pngjs test dependency was installed in a separate tooling directory, not the project manifest. All12captures and metric comparisons passed. Numerical evidence is retained in FINAL_MATRIX_EVIDENCE_20261007.json. Root inspected final native Canvas/full200 capture and final compact menu; this establishes controlled raster/density parity, not mobile gameplay performance.

Publication branch: `visual/recovered-overhaul-20261007`. Updating the older remote `visual/overhaul-20261007` was rejected as non-fast-forward; it was left intact. A fresh recovery branch carries the tested final tree and evidence without overwriting that history.
