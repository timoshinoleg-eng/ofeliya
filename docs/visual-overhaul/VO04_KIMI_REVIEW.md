# Independent Review: Task 4 Audible Audio Mix

## Scope
Reviewed frozen diff `c247ba4..5c53377`: `src/systems/Sfx.ts`, `src/systems/audioMixMath.ts`, `tests/audio-mix.mjs`, `ARCHITECTURE_NOTES.md`. No tests executed; analysis is static only.

## Confirmed

1. **Normalization math** (`audioMixMath.ts:14-33`): `scanNormalizationTrim` scans all channels once, returns 1 for silence/NaN/Infinity/empty, caps at `min(12, .63/peak)`. Matches spec exactly.
2. **Constants**: `MASTER_GAIN=.8`, `MUSIC_GAIN=.65`, `MUSIC_BED_TRIMS=[.47,.37,.71,1.14,2,.32,.5]`, all ten role gains match spec values.
3. **Graph**: `bed source → bedTrim → musicGain → filter → master → compressor → destination`; compressor params (-8/6/4/.003/.12) set in `ensure()`. Layer bus shares filter; bio feeds master directly (bypasses filter), matching notes.
4. **Duck isolation**: `duckMusic` writes only `musicGain`; `bedTrim` untouched. `musicGainForDuck` preserves the 0.02 floor and clamping.
5. **Visibility authority**: `isSuspended()` ORs retained flag with live `document.hidden`; checked in `ensure`, `resumeAudioContext` (including post-resume re-suspend), `spawnMusic`, `playBuf`, `tone`, `play`, `armMusicUnlockRetry`, and `setSuspended(false)` from director teardown cannot override a hidden document. Spec requirement met.
6. **Actual vs requested bed**: `actualBedIndex` set only on successful decode, reset on stop/bed change; `bedIndex` (requested) never mutated by fallback. Correct.
7. **Diagnostics**: `debugAudioState` is frozen, identity-free, bounded static error string replaces raw exception text. Test asserts key set and frozenness.
8. **Throttles**: `THROTTLE_MS` unchanged; role gain replaces `MANIFEST.vol` only at the `playBuf` call site.
9. **Late-load races**: abort + requestId checks at each loop iteration and post-decode; `playBuf`/`tone` re-check `muted`/`isSuspended`/`state==='running'` at spawn time.
10. **Teardown**: `stopMusic` stops layer tones via `layerTones`, bio, bed source; `tone` cleanup disconnects on `ended`; SFX source/gain disconnect on `ended`.

## Refuted
None — no claimed behavior found contradicted in the supplied code.

## Questions
1. `tests/audio-mix.mjs` footer prints "17/17" but only 16 `await test(...)` blocks are present in the frozen text. Is the 17th test truncated from the packet, or is the count wrong? If the file on disk matches this packet, the summary line is misleading (cosmetic).
2. `play()` early-returns on `isSuspended()` **before** the throttle stamp — confirmed correct (no throttle consumption while hidden), but worth confirming this was intended vs. stamping.
3. `setRunIntensity` still gates on `!this.musicWanted || this.muted` but not `isSuspended()`; it calls `ensureBioAmbience()` which now guards suspension, and gain scheduling on a suspended context is harmless. Confirm intentional.

## Findings

### Critical
None.

### Important
None.

### Minor

1. **`tests/audio-mix.mjs` final line**: prints `17/17 contracts passed` with 16 test blocks visible in the frozen packet. Fix: correct the count or add the missing test. Cosmetic/reporting only.

2. **`Sfx.ts` `playCue`/`playHeartbeat`** (unchanged lines): guard only `this.muted`, not `isSuspended()`. They fall through to `tone()`, which does guard suspension and context state, so no incorrect behavior — just a redundant `ensure()` call path while hidden. No fix required; optional symmetry with `play()`.

3. **`debugAudioState.gains.master`** when `ctx` exists reports live `gain.value`, but the fallback when `ctx` is null reports `muted ? 0 : MASTER_GAIN` — consistent. However `gains.music` reports the live automated value which may be mid-duck ramp; documented as a snapshot, acceptable.

4. **`audioMixMath.ts` `MUSIC_BED_TRIMS` typed `as const`** but indexed by `actualBedIndex: number` in `spawnMusic` — TS allows indexing a readonly tuple with `number` only if the index type is widened; `MUSIC_BED_TRIMS[this.actualBedIndex]` with `number` index on a tuple yields the union type, fine at runtime since `actualBedIndex` is always `< MUSIC_TRACK_COUNT` (set from `trackIndex` modulo). No defect; typecheck reportedly passes (not verified by me).

5. **`loadMusicBed` catch swallows per-track errors silently** (previously retained `lastError`). Final message is now a static safe string, which is the intended diagnostics hardening; the per-track `console.warn` for fallback still fires only on success-after-failure. Acceptable trade-off, documented.

## Spec Compliance: **PASS**
All checkbox items with verifiable code evidence are implemented: normalization scan-once with silent→1, bounded trim, exact constants, role gains replacing coefficients, single compressor with exact params, distinct bed trim node, authoritative visibility suspension (including pre-context retention, pending-resume re-suspend, teardown-false override), safe diagnostics, preserved throttles/retry/cancellation/mute, actual-vs-requested bed separation, manual pause (mute) not suspending the context.

## Quality: **Approved**
No Critical or Important defects found in the supplied implementation. The only discrepancy is the test-count footer (Minor). I did not run `test:audio`, focused tests, `test:save`, `test:rng`, or typecheck; reported 15/15 (or 17/17) and typecheck results are taken as claims, not verified here. Root actual-sample QA is explicitly out of scope per the task.

Controller note: committed tests/audio-mix.mjs has17 await test calls at lines64,76,84,99,113,119,133,140,148,155,166,172,181,187,198,206,225. The16-test counting question is refuted. There are11 SFX roles. Substantive PASS requires no production fixes.
