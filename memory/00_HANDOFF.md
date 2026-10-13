# Current review fixes — 2026-10-13

Branch fix/kimi-review-20261013, based on main26fcc88. User approved the independent review follow-up plan. See docs/release/KIMI_REVIEW_FIXES_20261013.md for contracts, tests and mixed-version policy. Previous handoff is archived under memory/archive/2026-10-13-before-review-fixes/; older state/decisions/backlog remain as historical notes below.

Daily migration, anomaly attack/wave timing, heartbeat, scene reset, strict RNG migration, server-date preview and required CI regressions are implemented. Current security/data package adds explicit proxy trust, origin allowlist, neutral500/refReward privacy, webhook-owned registry durable acknowledgement, duel persistence, readiness/CSP and a full startup boundary. Dependency source-map-js1.2.2 is included; PR184 remains separate.

Local targeted, HTTP fault-injection and browser checks passed. Hosted final-head CI, deployment/public marker and physical phone acceptance must be verified separately; no production write or deployment performed. Samsung S20+ is available per owner, exact OS/client versions and real test evidence pending. MAX iOS remains pending. Preserve fail-closed mobile evidence; do not invent device FPS.

Next: inspect branch status and PR CI, keep exact-head evidence; complete physical MAX/Telegram acceptance and backup/release gates. Canonical production is Render Free with existing Supabase state; old Cloud.ru instructions in archive are historical. No paid infrastructure.
