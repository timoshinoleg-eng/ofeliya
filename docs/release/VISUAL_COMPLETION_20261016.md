# Visual completion — 16 October 2026

Continuation of Vascular Archive from verified public7a0d829 (PR216). Current branch visual/completion-20261016 keeps main unchanged and does not merge existing PRs. User authorizes finishing and improving the existing overhaul and its validated deployment.

## Implemented finish

- Player mutations have separate geometry and value structure: eight celadon/ivory spear blades, six warm segmented shield plates, three violet outer arcs with a compact core. Different radii/depths survive combined mode; packaged artwork remains restrained inner detail. Existing eight visual objects and animation clocks, CanvasTexture identities, physics radius/RNG/damage/input are preserved. NORMAL blend avoids stacking glow.
- SocialHub uses shared matte membrane/palette, metadata from11px, two-line tables with32px row spacing, clear status/retry/disabled states. Original three visible rows and hidden counts,44px actions and callbacks remain.
- Codex's three pages use the same membrane and semantic palette. Content, progress semantics, navigation and targets are retained.
- Result report measures wrapped rows at11px in a clipped drag/wheel viewport, with pinned retry/share/menu actions. Async status reserves three lines. Header surface follows measured title/stats. The old flatten/shrink MobileLayoutGuard deliberately yields to this layout. Action pointer ownership prevents a scroll released over a button from activating it; long share copy is fitted by font size without horizontal compression.
- Pause heading/copy use the shared palette and quieter shadow.

## Executed verification

The original expanded result fixture failed the11px metadata floor. After implementation,320x568,360x640 and390x844 pass long victory and resumed/Strained result, nonoverlapping measured rows, clip/action separation, scrolling when needed, drag-release over retry without activation, long share hit-target fit, Social rich/network-error states and all three Codex pages inside viewport. Actual PNGs are in evidence/visual-completion-after. The first result capture exposed legacy guard repositioning; it was resolved and captures regenerated.

Independent source review found and resolved scroll-release ownership P2. Subsequent source review and native review of result/scrolled/social/error/Codex/live-combat frames found no P1/P2. Minor social hidden-count footer spacing is a nonblocking detail. Hosted exact-head checks/publication below must be verified before declaring the candidate live.

Presentation contracts (including executed SocialHub method checks), TypeScript and whitespace passed. Existing art-startup regression covers Canvas/WebGL same-object packaged recovery and captures individual and combined mutation states. CI runs the new rich-result/social/Codex browser contract and uploads its actual screenshots.

Matched desktop motion probe uses100seeded enemy spawns, running AI/physics/Game.update/Player.preUpdate, elevated playerHP and disabled level-choice collection. Before uses original7a0d829 Player module via test-only Vite transform; after uses working Player. Each renderer captures240consecutive rAF intervals (~4s): p50~16.7ms andp95~16.8ms both before/after. Canvas over33.34ms fraction0→0; WebGL0.0083→0.0125 (two→three samples). Active enemies differ slightly103–105; this is a short evolving desktop/software-rendered workload, not identical combat pixels, GPU time, sustained/device FPS or thermals. Videos and cadence.json are in evidence/visual-motion/{before,after}.

## Completion boundaries

Confirmed implementation gaps in mutation distinction, SocialHub/Codex consistency and expanded result readability are addressed. Existing biological atlases, reward/projectile kit and production density gate are retained: an absent additional atlas is not proof of a visual defect, and unmeasured global2x density is not enabled. Physical MAX/Telegram/iOS, phone readability/input/thermals, sustained dense combat and newcomer/full-campaign acceptance remain separate real-world checks. Main integration still needs its own permission.

Hosted CI exposed two remaining result-header spacing defects hidden by the former legacy guard. Header time/stats now use measured 8px minimum gaps; report/scroll hint reserves additional CTA separation. Legacy challenge/layout smoke contracts now inspect nested report rows and actual world bounds, retaining verdict/share semantics, readable fonts, clip containment, button padding and pointer ownership. The original challenge/share smoke passed locally after the fix; final hosted results are recorded in companion PR215.
