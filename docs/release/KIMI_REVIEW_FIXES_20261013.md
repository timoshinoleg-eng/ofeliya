# Kimi review follow-up — 2026-10-13

Base: main `26fcc8816feed6c102bdbf05cfa8cfa0fba739e3` (PR195/196).
Branch: `fix/kimi-review-20261013`. No direct main commits or production changes.
User authorized this sequence after the independent review of all three supplied analyses.

## Fixed contracts

1. Restored incompatible daily tickets are never reused. New tickets have new IDs;
   previous contracts remain immutable. Client rejects older/future ruleset or
   campaign tickets before gameplay, leaves launch registry untouched, and asks
   the player to refresh. HTTP tests cover restored v2 and old campaign state,
   accepted v3 submissions, reuse, and server-date parity.
2. Anomaly attacks commit phase, timing, radius, damage and dash speed at warning
   time through recovery. Respawn/reset discards commitments. Expired waves and
   warning windows suppressed by a live anomaly are consumed instead of replayed.
3. Heartbeat composition applies daily multipliers to Standard. All six authored
   profiles have exact golden vectors. GameScene clears dailyMutator each create.
4. Historical RNG states are mandatory. Only pre-anomaly v2 checkpoints, identified
   by absence of wave.anomalySpawned, may omit the additive anomaly stream.
5. Daily preview uses authenticated server challengeDateKey; no device-clock guess
   or accidental reuse of the player's latest (possibly old) result date. Server
   returns serverTime/nextDayAt; the panel refreshes at the relative server midnight.
6. New pure/component/browser regressions are required in CI, including actual
   Phaser lifecycle daily→ordinary→daily and negative startup scenarios.
7. Hosted API binds loopback. Gateway replaces public XFF unless both explicit
   public hop count and trusted connecting peers are configured. Standalone defaults
   to zero trust; explicit0 is preserved. Origin reflection requires same host or
   explicit allowlist. Responses vary by Origin. Internal errors/identity fields
   are not exposed in500/refReward; platform-aware self-referral remains unchanged.
8. Hosted webhook/API owns Telegram registrations. It marks registry-only changes
   and awaits the complete durable snapshot before acknowledgement. Files are
   mirrors in remote mode, not competing mtime authorities. Pending commit UUID
   and payload remain frozen during retry. A registration arriving meanwhile is
   committed next. Polling refuses remote/webhook mode. Duel create/event/attempt
   acknowledges only after local/remote persistence; disk failure is unhealthy.
9. Gateway emits CSP with hashes of the actual inline HTML bootstrap, and `/ready`
   aggregates API health and required messenger configuration. Disabled optional
   messengers are explicit. This checks configuration, not external Bot API uptime.
10. One startup boundary covers release/bridge/boot exceptions and a15s deadline;
    failure removes splash and offers retry. Abort guards prevent late startup;
    viewport listeners are cleaned up on failure/game destruction.
11. source-map-js is pinned1.2.2 (dependency part of pending PR184). No unrelated
    dependency upgrade. Browser/checkpoint smoke drivers now run on Windows too.

## Mixed-version rollout policy

Ruleset remains3/campaign2: these fixes implement the already authored contract.
Explicit v2 fresh scores, grants and duels still fail closed. Ordinary v2 checkpoints
remain playable as resumed runs, without trusted ranking. Pending v2 outbox payloads
retain their original version and submission ID; terminal422 removes that entry.
Old accepted results may still fail version preflight on a lost-ACK retry after
upgrade. This release does not rewrite old results or invent a rank acceptance.
The new daily client has visible compatibility feedback; general result/local save
remains available when ranking is rejected. HMAC still proves identity/capability,
not execution of an unmodified gameplay client.

## Verification

Observed RED→GREEN: persisted daily reuse, incompatible client preflight, actual
heartbeat composition, missing RNG, reused scene reset, anomaly attack/wave behavior,
and boot-failure viewport cleanup. HTTP fault injection verifies zero-hop spoofing,
origin policy, neutral errors, registry-only remote failure/retry/restart and local
duel disk failure. Browser exercises midnight refresh, scene reuse and startup
exceptions/stall. The built gateway is tested with enforced CSP in Chromium.

Local checks passed: TypeScript, QA build:max, server75/75 + new suites, startup,
presentation, game gates, score outbox25/25, rollback/server policy. npm audit reports
zero vulnerabilities. Final hosted CI and exact commit identity must be read from
the PR/run; a local build is not evidence of deployment or mobile performance.

## Release gates still requiring external evidence

- Full hosted CI for final branch HEAD; never substitute an earlier green run.
- Real Render release.json and asset parity after any authorized release. Old
  Cloud.ru targets are retired; no paid resource or keepalive workaround.
- Current private backup + isolated restore before migration/release. Fixture
  restore is verified; previous production backups are historical evidence.
- Samsung S20+ identified by owner. Android/MAX/Telegram numerical versions and
  actual launch/full run/background/save/reopen/share/daily results are pending.
- MAX iOS and Telegram actual-device evidence, newcomer comprehension and mobile
  performance measurements remain open. No60fps or full release-readiness claim.

PR184 remains a separate draft; this branch contains its dependency change, not
an automatic merge/close of the prior PR or its old handoff files. The security
work was reconstructed and tested against current main; the other machine's dirty
patch was unavailable and was not blindly imported.
