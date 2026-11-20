# OFELIYA Audio C+ v4 — integration review (2026-11-20)

## Scope and release boundary

PR #302 targets current `main` via integration merge `e1da02f` (parent: main `91242a8` plus audio `911e811`). Six newly synthesized C+ compositions are shipped as 12 OGG/MP3 files and are only selected with `?audio=cplus`. The default seven CC0 music beds and existing gameplay, RNG, networking, payments and video are unchanged.

**Decision: code candidate, NOT a production music switch.** No PR merge to main or deployment is part of this review. The audio opt-in is useful for device QA; it must not become the default without the listed acceptance gates.

## Verified results

- Independent package gate: 263/263 PASS before the independently remeasured WAV seam assertion was added; the subsequent negative gate covers that new assertion.
- Negative QA: 28/28 PASS. With updated SHA-256, intentionally wrong sample rates, mono, an audible loop discontinuity and True Peak excursions are rejected for the actual reason.
- C+ WebAudio: 19/19 PASS after separating bed and stinger loads, ensuring both start after unmute, stopping fading beds on teardown and restoring the correct act/boss role.
- C+ director: 10/10 PASS; existing music asset manifest: 23 assets PASS; C+ manifest: 12 assets PASS.
- Comparison stand reproducibility: 22/22 PASS, including six measured C+ tracks, game SFX role-gain mapping, normalized SFX, async playback invalidation and served HTTP origin.
- Decoded source consistency: initial 12/12 local pass; cross-platform CI uncovered MP3 encoder-dependent differences, addressed by a tight OGG content check and independent same-package MP3-vs-OGG check (24/24 local pass). On commit `d25d7f3`, both standard CI and full audio QA completed successfully.
- On the current integration, TypeScript, Vite build, RNG, bundle shape and QA deterministic checks passed. Changes after `d25d7f3` require their own final GitHub CI.

## Review findings remediated

1. C+ bed and result-signal requests had a shared cancellation token, allowing one to cancel the other. The tokens and AbortControllers are now independent.
2. A faded-out bed could survive immediate menu exit because only the current bed reference was retained; every outgoing source is tracked and stopped at teardown.
3. Muted transition from an already-playing act bed into a boss could resume the old act. Muted role changes now release the previous active and fading sources.
4. The comparison stand could start two asynchronous track loads after a quick switch. A playback generation now invalidates old requests before/after await, and Stop all invalidates them.
5. The stand played raw SFX instead of production gains. It now derives `roleGain` from `SFX_ROLE_GAINS` and applies the same decoded-sample peak normalization as `Sfx.ts`.

## Remaining release blockers

- Final GitHub CI on the latest commit, including the full Linux regeneration and browser-smoke jobs.
- Human listening in the actual game: act changes, bosses, 10+ repeated loops, Victory/Defeat, `bossphase` and `hit` audibility against music.
- Physical Galaxy S20+ Telegram WebView QA: initial user unlock, mute/unmute, suspend/resume, restart and variable mobile network.
- iOS Safari/WebView check of OGG decode failure followed by MP3 fallback.
- Clarify what happens when **both** C+ formats fail: the opt-in currently keeps gameplay intact but does not provide a default-CC0 automatic fallback. Add the fallback before any default rollout.
- Do not publish or ship v3 audition material with unconfirmed `Beneath_the_Membrane.mp3` rights. The new full-audio CI uses an absent v3 directory specifically to check clean stand builds.
- Percentage rollout (5% → 25% → 100%) requires a separately implemented remote flag and kill switch. The current query-string opt-in does not support percentage targeting.

## Rollout sequence

1. Keep the feature behind `?audio=cplus`; finish all CI and spot checks.
2. Real device listening with SFX attention and documented A/B observations.
3. Implement CC0 fallback, kill switch and instrumentation in a separate integration PR; validate with OGG/MP3 error injection.
4. Run a limited, reversible canary only after controls are verified; watch audio load/decode errors, abandoned sessions and WebView lifecycle faults.
5. Switch default only after QA and canary acceptance; retain original CC0 files and document the rollback procedure.
