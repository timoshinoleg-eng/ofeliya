**Scoped Re-Review: Task2 Fix Round 1**

**Verdict on Prior Findings:**

1. **Mixed ordinary/important retention on downgrade** — **ADDRESSED**  
   New test explicitly constructs 6 important effects (singularity, legendary, boss kill) older than 6 ordinary pickups, then applies `setRuntimeQualityScale(.45)`. Assertions verify all ordinary circles are dead/invisible while all important circles remain alive/visible, confirming the retention logic prioritizes importance over insertion order during reduction.

2. **Stale callback ignored after preemption** — **ADDRESSED**  
   Test simulates preemption by replacing a circle’s tween, then manually invokes the stale `oldTween.onComplete()`. Assertions confirm the replacement tween remains active, the circle stays visible at the new coordinates, and subsequent pool operations do not steal the entry. This validates the generation guard independently of the scene adapter’s cancellation.

3. **Public nearest palette far/tie behavior** — **ADDRESSED**  
   Test covers far colors (black→blood, white→white) and a genuine Euclidean tie (RGB 242,246,244 equidistant to white and immune palettes). It asserts deterministic selection of the first palette entry (white) across 10 iterations, locking in the tie-breaking behavior.

4. **Hit rings subject to ordinary pool cap while particles remain budgeted** — **ADDRESSED**  
   Test saturates the ordinary circle pool with 9 pickups, then invokes `hit()`. Assertions verify no new circles are created (`f.circles` deep-equals prior state) while particle tokens are still spent (`f.particles[1].emitted` contains the 3-particle spark burst), confirming the separation between circle pool caps and particle budgets.

**New Breakage in Fix Diff:**  
None identified. The added tests are well-scoped, use existing fixtures, and assert boundary behaviors without introducing production code changes or test anti-patterns.

**Overall: PASS**
