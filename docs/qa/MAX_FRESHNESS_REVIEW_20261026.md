# MAX launch-data freshness — read-only impact review (2026-10-26)

Base ce8ecb84ced1afa09870f2f00f9a0328257fd11c. No validator/server/bot change in UX PR.

## Exact implementation and callers

server/index.mjs:447 validateInitData(initData, token, now=Date.now()). Line469 rejects nonfinite age, future beyond300s, past beyond86,400s. Duplicate keys and HMAC integrity are independently checked. MAX_TOKEN and TG_TOKEN are separate (lines43–49), but both use the **same 24h freshness predicate**.

Paths: verifyDuelIdentity:611 (run capabilities and duel operations), verifyMessengerProfileIdentity:1155 (profile state), Telegram prepare-share:1270 (TG only), analytics:1318 (platform token), score ingestion:1591 (platform token). Legacy malformed or invalid messenger data does not downgrade to anonymous trusted identity.

Official sources checked2026-10-26:

- https://dev.max.ru/docs/webapps/bridge — auth_date recommendation: invalidate after1h.
- https://dev.max.ru/docs/webapps/validation — signature algorithm and duplicate-key requirements.
- https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app — validate signature and check auth_date against outdated data; no shared MAX-specific1h policy imposed here.

## Security impact

A captured authentic initData can authenticate as its user during the accepted age window; HMAC validates integrity, not uniqueness of use. Reducing MAX24h to1h reduces that replay window by23h. It is not proof of signature bypass, token disclosure, observed abuse, or a new gameplay P0. Existing rate limits, run capability/expiry/identity matching, score/daily dedup and duel ownership still matter and must remain.

Changing the shared86,400 literal to3,600 would also change Telegram behavior at every caller. Applying it only in one MAX route leaves inconsistent acceptance across others. The policy must be explicitly platform-scoped, ideally behind a single messenger-verification helper, with TG retaining its current policy until separately authorized.

## Compatibility impact: not proven regression-free

A real MAX client may keep the same launch initData while a Mini App is paused/resumed or open for over1h. Score outbox retries, end-of-run submission, daily ticket/capability flows and profile writes may occur after the shorter cutoff even if the run began legitimately. A checkpoint itself contains no new signed launch credential. Current clients' credential refresh/relaunch behavior was not physically verified. Therefore this is **not demonstrably compatibility-neutral** and no executable validator patch is mixed into this UX PR.

Recommended separate patch design (not implemented): retain exported validator default24h for old/TG callers; add explicit max-age option/platform-scoped messenger helper; apply MAX1h consistently to intended authentication boundaries; decide and test in-flight run-capability and outbox policy before rollout. Do not add a lax invalid-MAX fallback. If legitimate long-lived sessions cannot reauthenticate, token/session lifetime design is required rather than an unexplained global cutoff.

## Required tests for that separate patch

- Signed MAX ages0,3599,3600,3601,86399; exact boundary semantics explicit. TG corresponding cases retain prior24h acceptance.
- Future skew at+300/+301s, NaN/missing auth_date, expired data, wrong platform token, tampering, duplicate keys and hash-length mismatch remain rejected appropriately.
- All relevant profile/analytics/score/run-start/duel routes tested with controlled clock, both platforms. Telegram share unchanged.
- Valid Standard run capability begun before cutoff and finished after it; paused native MAX return; F5/checkpoint; ordinary/daily outbox retry after1h; offline/relaunch with fresh initData. Define expected response/recovery rather than calling resulting403s harmless.
- Legacy saved scores/checkpoints/processed IDs preserve compatibility; no migrations or forced deletion. Missing MAX token remains fail-closed.

Disposition: separate recommended security work; compatibility gate open. No validator edit, no webhook/bot/deploy action.
