# Phase 0 source inventory — 15 October 2026 (Moscow)

Read-only source/GitHub/HTTP audit. Checkout `aba70324d13592fbcd86894fb29f395ac201f48a` was clean. No product code, branches, merge or deployment changed. Canonical AGENTS, Product Bible, Architecture, Plan, release gates, third-party notices and repository handoff/state inspected. Browser and visual acceptance belong to the coordinator; **none of the candidates below is freshly visually confirmed by this audit**.

## Exact state

- Remote `main`: `aba70324d13592fbcd86894fb29f395ac201f48a`, commit UTC 2026-10-14 21:28:41 (15 October 00:28:41 Moscow). See `main.json` and `main-checks.json`.
- Public canonical `/ofeliya/release.json`: `30a534fbf1656979c20434d4f4d724eea69c385f`, version `0.4.1-rc.1`. This is live marker readback, **not proof of new main publication**. See `public-release.json`.
- `OFELIYA_FRONTEND_HANDOFF_2026-10-14.md` not found among repository/workspace files or Downloads matching OFELIYA handoff. Downloads contains only 8 October handoffs. Do not invent 14 October handoff contents.
- Repository handoff/state first sections still describe the pre-final PR211 branch and pending checks. Their prior production/device facts are historical evidence; GitHub/readback outrank those claims for current state.

| PR | State | Exact head | Returned head checks |
|---|---|---|---|
|204|OPEN|41cd0101b88355ef9d0c479ee425c6203254c62c|build/browser-smoke/production-contract SUCCESS|
|207|OPEN|d9d7f5ef75661662b571f05fb4588f110fea092a|build/browser-smoke/production-contract SUCCESS|
|208|OPEN|0e606ca322ad14e00494a2defc2dafe61d254367|build/visual-matrix/browser-smoke/production-contract SUCCESS|
|209|OPEN|6adab4bf5a9ebee849bf3c6ef64b6dbf710fe3ca|build/browser-smoke/production-contract SUCCESS|
|210|OPEN|aae35c9c7f75f47c6ba9ac03b81a7431aca8cf3c|build/browser-smoke/production-contract SUCCESS|
|212|OPEN|729e5a482b8b88566ea2df996bf441461a591fe2|menu-keyboard-smoke/build/browser-smoke/production-contract SUCCESS|
|185|MERGED|7a6fc1f113033ef4698641c76370dd08e5ed50c5|build/browser-smoke/production-contract SUCCESS|

Per-PR raw JSON retains base/head branch, file set, merge identity and check URLs. Green checks do not establish current-main integration, phones or visual excellence.

## Changed-file intersection graph

- 204↔210: `GameScene.ts`, `UIScene.ts`; preserve cached-HUD optimization and reduced-motion semantics when redesigning.
- 210↔212: `MenuScene.ts`; keyboard/focus contract and motion preference may intersect presentation refactor.
- All of 207/208/209/210/212 intersect `.github/workflows/ci.yml` and `package.json`.
- 207 owns `VideoInterstitial.ts`; 209 owns `LegalOverlay.ts`; 208 owns cadence/matrix evidence. Reuse their scope, avoid duplicate implementations.
- 185 is already merged and touches all three scenes, Player/Enemy, audio, mutation art, HUD tokens and provenance. Treat its asset/audio/current HUD work as existing baseline.

## Previous audit classification

| Artifact | Class and disposition |
|---|---|
|`VISUAL_POLISH_AUDIT_V3.md`|Historical visual evidence from old CI35544902951 and Samsung/MAX captures; useful candidate list, not current screenshots. HUD/dense/reveal/legendary findings need recheck because PR185 changed HUD and art afterward.|
|`docs/visual-overhaul/DESIGN_20261007.md`, `VO_TRACEABILITY_20261008.md`|Historical design/traceability; preserve pools, geometry, motion and provenance constraints, do not claim residuals remain unchanged.|
|`CONTINUATION_ACCEPTANCE_20261008.md`|Historical measured browser evidence, explicit partial creative/HiDPI/device coverage. Existing six-frame atlas is real; no current phone acceptance implied.|
|`HIDPI_FEASIBILITY_20261008.md`, evidence JSON|Historical QA prototype evidence; source still explicitly limits density experiment to DEV/matrix. Production 2x remains absent.|
|`VO*_KIMI*.md`, `FINAL_CODE_REVIEW_20261007.md`|Historical source reviews tied to frozen diffs. Text-only Kimi is not image review, and failed/empty route responses are not approval.|
|`docs/plans/2026-10-15-review-followups.md`|Startup/persistence plan with stale unchecked hosted steps; main commit211 supersedes some status. Unrelated server work is protected.|

## Current visual source inventory

- Typography: `config.ts:24–26` uses self-hosted Chakra Petch display, native system UI for body; `index.html:49–59` registers 400/700 woff2. Font readiness timeout700ms (`main.ts:26,149`). No Play production default. Glyph coverage not measured here.
- Tokens: `ui/tokens.ts` BP/spacing/panel/border/scrim/button/touch/clamps/semantic colors; `hudTokens.ts` HUD geometry/type floors. Tokens intentionally preserve old literals and do not yet define shared type/radius/elevation/motion recipes. Many scene styles remain local.
- Art: ten WebP entries in `ArtMetrics.ts` (7 core +3 critical mutations); bounded 4x backing converted to stable logical dimensions. `public/art/provenance.json` and notices record generated original assets. RNA/projectiles/world remain chiefly procedural. Six-frame boot-baked biological atlases cover player and antibody only.
- Menu/HUD: `MenuScene.ts` combines specimen backdrop, title, selectors, record/challenge/resume, primary CTA and utilities. `UIScene.ts` owns in-run HUD plus pause, transition, mutation/legendary/evolution and result overlays; `SocialHub.ts` remains another local styling owner.
- FX: `VfxSystem.ts` four retained emitters plus pooled rings, contact-direction hints, density-sensitive hit count; no new renderer. Atmosphere uses three RBC depth bands and fixed image pools with distinct Heart fibers. Enemy telegraphs are gameplay-sensitive; do not hide or throttle them to fix density.
- Quality: `PerformanceProfile.ts` reduced/full has8/14 RBC,2/4 host decor,12/24 particles, combat budgets150/250 and burst220/350. PostFX false for both. RuntimeQualityGovernor only adjusts cosmetic detail. These numbers are presentation contracts, not entity caps.
- HiDPI: text `setResolution(2)` with Canvas clamp is separate from framebuffer. `main.ts:359–368` makes actual2x density DEV/matrix opt-in only. Adapter is pinned Phaser3.90 internals with pixel/GPU/quality/context fallback; do not enable broad production2x as an aesthetic shortcut.

## Top 20 candidates to verify against fresh captures

Effort S: <half day; M: half–2 days; L: >2 days. Risk refers to regression risk. All entries are **source hypotheses or historical visual leads**, not newly confirmed defects. Select actual issues after matching coordinator screenshots at390×844,360×640,320×568 and dense100/150/200.

|#|Candidate and source anchor|Cause/evidence scope|Effort/risk|
|---|---|---|---|
|1|Fragmented type hierarchy `ui/tokens.ts:14`, `MenuScene.ts:191`, `UIScene.ts:213`|No shared typography roles; sizes selected per element. Source confirmed fragmentation, appearance unconfirmed.|M/low|
|2|Inconsistent surfaces/radius `tokens.ts:21`, `MenuScene.ts:397`, `SocialHub.ts:79`|Some semantic palette aliases but local rectangles/strokes remain. Compare main/modal/social recipes.|M/low|
|3|Display body mismatch `config.ts:24–26`, `MenuScene.ts:244,258`|Latin display/Cyrillic system fallback may differ in metrics. Actual glyph/fallback required.|M/medium|
|4|Main menu secondary density `MenuScene.ts:288–381,392,818–954`|Challenge/resume/records/selectors/utilities share proportional vertical space. Stress combined states first.|M/medium|
|5|Weak subtitle hierarchy `MenuScene.ts:205,229`|12px product line and9/10px microcopy; compact reading requires device-size capture.|S/low|
|6|Muted utility contrast `MenuScene.ts:847`|Muted sound color `#755266`; inspect against live surface before contrast claim.|S/low|
|7|CTA/surface styling fragmentation `tokens.ts:45`, `UIScene.ts:2552`|Result-button primary opacity0.18 versus other local button fills. Candidate common recipe.|M/low|
|8|HUD transparent plate `UIScene.ts:194`, `hudTokens.ts:42`|Plate alpha0.5 over world may compete with dense motion; history flags HUD. Current PR185 changes must be assessed.|S/medium|
|9|HUD small health/kill/boss labels `hudTokens.ts:41`|12/14/13px floors; hierarchy candidate, not overlap finding.|S/medium|
|10|Compact HUD horizontal pressure `hudTokens.ts:40`, `UIScene.ts:257,279`|Fixed right reserved168, HP pad156, combo and controls; retain tested bounds, rerun peaks.|M/medium|
|11|Mutation card label hierarchy `UIScene.ts:1456,1551,1571`|Card icon22/26 vs segment/details11/13 and11/12; source alone cannot establish readability.|M/medium|
|12|Legendary header/support spacing `UIScene.ts:1335,1368`|Historical audit reports crowding; header23/27, body13/15. Need long trophy/Heart copy capture.|M/medium|
|13|Result long-run visual density `UIScene.ts:2161–2243`|Several9/10px record/build rows; best combo/legendary/full campaign stress recommended.|M/medium|
|14|Heavy hero/title shadow language `MenuScene.ts:200`, `UIScene.ts:742,1914,2119`|Blur7/16/20 mixes local treatments; may soften hierarchy despite postFX disabled.|S/low|
|15|Social microcopy/status size `SocialHub.ts:101,309,319,333`|9–11px labels differ from main modal body and color tokens; fresh hub/loading/error view required.|M/low|
|16|Dense enemy outline convergence `Enemy.ts:994,999,1102`|Repeated bright white/color edges; historical dense screenshots lead, current200 capture required.|L/high|
|17|Boss reveal and live HUD competition `UIScene.ts:893–919`, `hudTokens.ts:37`|Historical visual lead; reveal19/22px alongside strip. Verify actual overlap/salience after PR185.|M/medium|
|18|Missing authored role animation cycles `BiologicalAnimation.ts:3`, `Enemy.ts:438–460`|Only player/antibody six-frame idle; runner/brute are whole-sprite transforms. Source confirmed limited coverage, not proven visual defect.|L/medium|
|19|Reward/projectile visual-kit gap `ArtMetrics.ts:2–14`|No RNA/projectile/icon entries in art kit. Existing procedural fallback may be effective; do not add assets without silhouette evidence.|L/medium|
|20|High-DPI framebuffer softness `main.ts:359–368`, `RenderDensityExperiment.ts:16`|Production main buffer1x is source confirmed; visual impact/performance on device unmeasured. Keep QA gate.|L/high|

No measured FPS, thermals, motion readability, real-device ergonomics or newcomer acceptance is claimed. No assets need replacing solely because they are procedural. Preserve ArtMetrics/body geometry, fixed pools, one-hand controls, RNG/checkpoint/anti-cheat/server contracts.
