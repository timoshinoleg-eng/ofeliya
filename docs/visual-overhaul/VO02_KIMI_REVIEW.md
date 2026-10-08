# Independent Scoped Code Review: Task2 (a4d20d1..ddbe943)

## Verdict: **PASS** with Important findings (non-blocking)

The commit successfully implements the spec requirements with genuine behavioral changes. All critical paths are correct, but there are Important gaps in edge-case handling and test coverage that don't block merge.

---

## Confirmed Spec Compliance

### ✅ **Phaser-only four retained emitters**
- All four emitters (`killEmitter`, `hitEmitter`, `pickupEmitter`, `rewardEmitter`) remain
- No new emitter types introduced
- All use `combat-particles` atlas texture

### ✅ **Baked colored atlas for Canvas palette parity**
- `COMBAT_PARTICLE_PALETTE` correctly maps 10 color names to `COLORS` constants
- `combatParticleFrame()` implements nearest-color matching with Euclidean distance in RGB space
- Atlas baking in `ensureStrainZeroTextures()` creates 20×40 canvas (10 colors × 2 silhouettes)
- Frames registered as `spark-{name}` and `chip-{name}` with correct cell offsets
- Comment explicitly notes Canvas renderer doesn't compensate `TextureSource.resolution`

### ✅ **Directed contact hit sparks**
- `hit()` accepts optional `direction` and `victimRadius` parameters
- Contact point correctly calculated: `contactX = x - dx * radius` (moves backward along direction)
- Emitter angle set to `atan2(dy, dx) * 180/PI + 180` with ±38° spread for directed hits
- Falls back to `{min: 0, max: 360}` for zero/invalid direction or legacy calls
- Test confirms: directed hit at `(100,80)` with `direction={x:1,y:0}`, `radius=20` emits at `(80,80)` with angle `{min:142, max:218}`

### ✅ **Membrane death fragments**
- `kill()` splits single budget grant: `chips = floor(granted * 0.4)`, sparks get remainder
- Both use same emitter with different frames (`chip-{color}` vs `spark-{color}`)
- Test confirms both `chip-cyan` and `spark-cyan` frames emitted for same kill event

### ✅ **One shared budget grant for kill layers**
- `kill()` calls `this.budget.request()` **once** with `this.count(base)`
- Chips and sparks divide the granted amount, not separate requests
- Test confirms: 80 normal kills saturate budget at 280 particles, boss kill adds only 30 more (310 total)

### ✅ **Bounded decorative circle pool full12/reduced6**
- `decorationCap` getter: `PERFORMANCE.tier === 'reduced' || runtimeQualityScale <= 0.65 ? 6 : 12`
- Pool lazily creates circles up to cap, reuses inactive entries
- Test confirms: 100 pickups create only 9 circles (12 - 3 reserve), singularity adds 3 more to reach 12

### ✅ **Protected reserve/preemption**
- Reserve: `decorationCap === 6 ? 2 : 3` slots for important decorations
- `acquireDecoration(false)` returns `null` if `activeCount >= cap - reserve`
- Important decorations preempt: sort by `Number(important) || serial`, take first (least important, oldest)
- Test confirms: 100 pickups + singularity = 12 circles, 100 more legendaries stay at 12

### ✅ **Shutdown cancellation**
- Constructor: `scene.events.once('shutdown', this.destroy, this)`
- `destroy()` kills all tweens, destroys all circles, sets `destroyed=true`, removes listener
- All public methods check `if (this.destroyed) return`
- Test confirms: after `scene.events.emit('shutdown')`, all particles dead, all circles dead, tweens empty

### ✅ **Backwards-compatible hit/kill optional parameters**
- `hit(x, y, color?, direction?, victimRadius?)` — new params optional
- `kill(x, y, color, importance?, direction?, victimRadius?)` — new params optional
- GameScene calls updated: `vfx.hit(..., {x: bv.x/vm, y: bv.y/vm}, e.radius)` and `vfx.kill(..., undefined, e.radius)`
- Test confirms: `hit(100, 80, COLORS.red)` without direction emits at `(100,80)` with `{min:0, max:360}`

### ✅ **Preserve damage/knockback/pierce/XP/event order**
- GameScene diff shows **only** VFX call changes
- `takeDamage()`, `Sfx.play()`, `showDamage()`, `trySplitProjectile()`, `triggerRhythmBurst()`, pierce logic all unchanged
- `onEnemyDied()` order: `recordKill()` → `trackComprehensionOnce()` → `captureAchievements()` → `vfx.kill()` → elite/boss logic (unchanged)

### ✅ **postFXoff**
- No post-FX pipeline changes in diff
- Comment: "no camera/shake channel is requested for ordinary hits"

### ✅ **No actor texture dimensions**
- `victimRadius` passed as parameter, not read from texture
- Test confirms: `hit(..., Infinity)` and `kill(..., 42)` work correctly

---

## Refuted Claims

None. All spec requirements are genuinely implemented.

---

## Questions

1. **Why does `hit()` use `setEmitterAngle()` but `kill()` uses `setEmitterAngle()` with different spread?**
   - `hit()`: ±38° (76° total)
   - `kill()`: ±75° (150° total)
   - Is this intentional for visual distinction, or should they be consistent?

2. **Why does `acquireDecoration()` sort by `Number(a.important) - Number(b.important)` instead of `!a.important - !b.important`?**
   - `Number(true) = 1`, `Number(false) = 0`, so `0 - 1 = -1` sorts important first
   - This works, but `!a.important - !b.important` would be clearer intent

---

## Critical Findings

None. No blocking issues.

---

## Important Findings

### 1. **Missing test for `trimDecorations()` when `runtimeQualityScale` drops below 0.65**
- **Location:** `VfxSystem.ts:117-120`
- **Issue:** Test `'runtime reduction bounds existing and future decoration'` calls `setRuntimeQualityScale(0.45)` and expects 6 circles, but doesn't verify that `trimDecorations()` is called or that excess circles are destroyed
- **Evidence:** Test creates 12 circles with `legendary()`, then calls `setRuntimeQualityScale(0.45)`, asserts `circles.filter(c => !c.dead).length === 6`
- **Gap:** Test doesn't verify that the 6 destroyed circles are the **oldest non-important** ones, or that `trimDecorations()` prioritizes correctly
- **Impact:** If `trimDecorations()` has a bug (e.g., destroys important circles first), test won't catch it
- **Recommendation:** Add assertion that destroyed circles are non-important, or that important circles survive

### 2. **`acquireDecoration()` preemption logic doesn't verify tween cleanup**
- **Location:** `VfxSystem.ts:289-296`
- **Issue:** When preempting an active decoration, code calls `killTweensOf(entry.circle)` but doesn't verify the tween's `onComplete` won't fire later
- **Evidence:** `animate()` captures `serial` in closure: `onComplete: () => { if (entry.serial !== serial || this.destroyed) return; ... }`
- **Gap:** If a tween is killed but its `onComplete` was already queued in the event loop, it could fire with stale `serial` and incorrectly mark entry inactive
- **Impact:** Low — Phaser's `killTweensOf()` should remove tween immediately, but this isn't explicitly tested
- **Recommendation:** Add test that preempts an active decoration, then manually fires the old tween's `onComplete` to verify it's ignored

### 3. **`combatParticleFrame()` doesn't handle `color` values outside palette range**
- **Location:** `StrainZeroTextures.ts:15-28`
- **Issue:** Function finds nearest palette color, but test only checks `0x8fe7ff` → `spark-cyan` (close to `COLORS.cyan = 0x8fe8ff`)
- **Evidence:** Test: `hit(100, 80, 0x8fe7ff, ...)` expects `spark-cyan`
- **Gap:** No test for colors that are equidistant from two palette entries, or colors far from all entries (e.g., `0x000000` black)
- **Impact:** Low — function will always return *some* frame, but might not be visually appropriate
- **Recommendation:** Add test for edge cases: `0x000000`, `0xffffff`, equidistant colors

### 4. **`hit()` ring emission not tested for budget compliance**
- **Location:** `VfxSystem.ts:87-88`
- **Issue:** `hit()` calls `this.ring()` after emitting particles, but ring doesn't check budget
- **Evidence:** `ring()` calls `acquireDecoration(false)`, which returns `null` if pool full, but doesn't consume particle budget
- **Gap:** Test doesn't verify that `hit()` rings are subject to decoration pool limits
- **Impact:** Low — rings are decorative and bounded by pool, but explicit test would confirm
- **Recommendation:** Add test: saturate decoration pool with pickups, then call `hit()` and verify no ring created

---

## Minor Findings

### 1. **`lastHitAt` initialized to `-Infinity` instead of `0`**
- **Location:** `VfxSystem.ts:30`
- **Issue:** Changed from `0` to `-Infinity` to allow first hit immediately
- **Impact:** Correct behavior, but inconsistent with `VfxBudget.lastAt = 0`
- **Recommendation:** Document why `-Infinity` is correct here (first hit should always emit)

### 2. **`resetCircle()` doesn't reset `stroke` width**
- **Location:** `VfxSystem.ts:310-314`
- **Issue:** `setStrokeStyle(strokeWidth, color, strokeAlpha)` sets width, but if previous circle had different width, it's overwritten
- **Impact:** None — `strokeWidth` is always passed explicitly
- **Recommendation:** None — current code is correct

### 3. **Test fixture doesn't verify `setEmitterFrame()` is called before `emitParticleAt()`**
- **Location:** `tests/vfx-presentation.mjs:34-35`
- **Issue:** Fixture records `frame` on emitter, but doesn't verify order of `setEmitterFrame()` vs `emitParticleAt()`
- **Impact:** None — code always calls `frame()` before `emit()`, but test doesn't enforce
- **Recommendation:** Add assertion that `frame` is set before each `emitParticleAt()` call

---

## Summary

**Spec: PASS** — All requirements genuinely implemented with correct behavior.

**Blocking Issues:** None

**Important Gaps:** 4 (test coverage for edge cases and preemption cleanup)

**Recommendation:** Merge after adding tests for Important findings, or accept current coverage and monitor for edge-case bugs in production.
