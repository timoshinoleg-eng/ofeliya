# Review follow-ups implementation plan

**Goal:** Close verified startup recovery and Telegram image CI gaps; investigate deferred server persistence findings before choosing a fix.

**Scope:** Remaining recommendations from the 2026-10-14 review. Preserve gameplay, Joystick, score versions, production data and free hosting configuration. Existing main30a534f is the baseline; work only on fix/review-followups-20261015.

- [x] Reproduce Boot/Menu exceptions and stalls with real Phaser/browser fixtures. Keep the startup boundary pending until the first usable Menu frame; clean up failure listeners and late scene work. Six extended cases and existing browser regressions pass.
- [ ] Build the actual telegram-bot Docker target and import it with networking disabled, fake credentials and an explicit deadline. CI steps added; local Docker Desktop cannot start, so image validation must be confirmed by hosted CI.
- [x] Independently confirm registry-health and profile-migration persistence behavior in isolated tests. Both regressions observed RED, fixed, and verified GREEN including signed read isolation, retries and durable restore. Full server suite passes.
- [ ] Review the complete diff, update four project memory documents, run relevant tests and exact-head CI, and create a reviewable PR. Keep physical device/FPS/newcomer gates explicit.

Use receiving-code-review, systematic-debugging and test-driven-development: verify each finding, observe a failing regression, apply the smallest fix, then verify the passing regression.
