# OFELIYA Stage 0 — Worker-first Telegram webhook architecture and release gates

Status: **draft / not live**. Issue: #294. Source of truth: `main` after `a8945475ee2db8c649b003c788de6f0597ca8c52`.
**Pre-cutover restriction:** do not modify the current Telegram webhook, Render secrets, D1 schema, or `VITE_PAYMENTS_API_URL` during coding and pre-cutover QA. **The controlled cutover itself is authorized only when every pre-cutover release gate passes and the owner approves the live switch.** Post-cutover gates are checked immediately afterward; rollback is mandatory if they fail.

## Problem and decision

Telegram allows one active webhook per bot. Current ingress `Telegram → Render Free (/api/telegram/webhook) → Cloudflare Worker (/api/webhook)` delays `pre_checkout_query` when Render sleeps (measured cold start 18.84 s). Telegram requires `answerPreCheckoutQuery` within 10 s from arrival, not 10 s from worker start. Retrying a timed-out checkout is not a reliable recovery.

**Decision:** route Telegram ingress to an always-on Cloudflare Worker, **not** through Render. Preserve the existing Worker payment handler, v17 D1 trigger-based wallet, grant snapshots and idempotency. For nonpayment updates, forward to the current Render handler with its original semantics; treat failures as retryable instead of responding 200 without processing. No always-on paid Render or artificial keep-alive.

## Ingress contract and classification

New independent `POST /api/telegram/ingress` route (keep legacy `POST /api/webhook` for Render→Worker rollback).

* Fail closed unless `TG_WEBHOOK_SECRET` exists and exactly matches `X-Telegram-Bot-Api-Secret-Token`. This ingress secret is **distinct** from legacy `WEBHOOK_SECRET` and `ADMIN_TOKEN`. Never log token, original body or launch parameters.
* Enforce body size (256 KiB, including streaming body read), Content-Type and schema, reject malformed JSON; never expose BOT_TOKEN, invoice_payload/charge IDs, chat IDs or user data in public errors.
* Route payment updates `pre_checkout_query`, `message.successful_payment`, `subscription` directly into the **existing** Worker payment handler / D1 implementation, with no Render subrequest and with valid source authentication. Make it impossible to bypass webhook signature by invoking internal handler from public JSON.
* Route all other updates (e.g. `/start`, `/help`, `/paysupport`, referral start parameters, unknown types) to the old Render webhook, preserving its response JSON and status. **The new Worker `TG_WEBHOOK_SECRET` must be exactly the value already configured as Render `TG_WEBHOOK_SECRET`, not a different new value.** Do not rotate the live Render secret as part of this rollout. Copy through secure configuration UI only, never through logs, comments or source. The relay must set `redirect: 'manual'`; treat all 3xx as a failed relay, preventing secret leakage on redirects. HTTPS URL fixed to the canonical Render service. Timeout explicitly bounded; 503 on failure so Telegram may retry. Do not synthesize a 200 reply when Render has not persisted referral state.
* Retain legacy endpoint `/api/webhook` and existing Render webhook for rollback. Keep `drop_pending_updates=false` on all controlled cutovers. Do not silently discard pending updates.
* Bot API `getWebhookInfo` before and after the switch: record URL (redact secret path), `allowed_updates`, `pending_update_count`, errors and `max_connections`. `setWebhook` must preserve supported message, pre_checkout_query and subscription types. Confirm official current API for update types before calling.
* Confirm that `pre_checkout_query` is answered by Telegram **within <10s end-to-end**, including transport margin and D1. No grant on precheckout. Only validated `successful_payment` creates the atomic payments+ledger grant.

## Risks requiring independent review

1. **Single webhook:** ensure the migration does not break bot commands and referrals; examine render cold-start command latency, 503 retry and at-least-once delivery.
2. **Security:** distinct secrets, no dual authorization with legacy secret on public ingress, arbitrary forwarding/SSRF prevention, origin/host validation, rate limits, body size and log scrubbing.
3. **Idempotency:** repeated `update_id`, `pre_checkout_query`, `successful_payment`, subscription renewal and refund; avoid duplicate notifications and grant. D1 trigger must remain the single grant writer.
4. **Failure ordering:** Telegram 200 may be sent only after handler responsibility is safely completed; Worker termination and downstream 500/timeout should not silently lose an event.
5. **Bot API semantics:** `allowed_updates`, `secret_token`, `drop_pending_updates=false`, latest subscription update name and error responses.
6. **Rollback:** prior Render webhook settings captured; switch back without modifying D1 or recreating invoice; honor updates in flight on both endpoints.

## Safe implementation sequence

1. Read-only inventory: GitHub state, Worker secrets by **name only**, D1 schema, Render env **names only**, Bot API `getWebhookInfo` via authorized bot service (never print token).
2. Implement and unit-test ingress in an isolated branch. Endpoints should be tested with fake D1 and fake Telegram Bot API, not production token or live Stars.
3. Test error paths: no/mismatched secret 403, oversize/malformed 400/413, no config 503, D1 down 503, Render down 503, stale/duplicate update, unauthorized admin 401, invalid invoice reject, successful_payment idempotency. Simulate downstream Render >20 s and precheckout under 10 s. Verify `/start ref_...` and `/paysupport` are forwarded unaltered and bot reply schema is preserved.
4. CI, TypeScript, worker build, production compatibility + independent review (Muse security/architecture, CodeRabbit on PR).
5. Deploy Worker code **with new ingress route dormant**; prove legacy route untouched and reject tests against new ingress fail closed. Set Worker `TG_WEBHOOK_SECRET` **identically to Render's existing `TG_WEBHOOK_SECRET`** using the secret UI. Before any switch, perform an authenticated nonpayment ingress smoke against the dormant endpoint and verify the command is accepted by Render and its reply is forwarded. Never send synthetic payment-success objects to the production Worker. No webhook switch yet.
6. Snapshot actual Telegram webhook configuration; controlled `setWebhook(new URL,secret_token,allowed_updates,drop_pending_updates=false)` only at explicit final release gate; smoke all commands & referrals first, then precheckout under idle, legitimate Stars grant and refund in controlled amounts.
7. Rollback plan: restore old Render URL, secret and allowed_updates with `drop_pending_updates=false`; preserve D1 journal, reconcile payments, retry pending. Do not downgrade D1 or clear pending updates.
8. Leave `VITE_PAYMENTS_API_URL` disabled during **operator backend payment smoke**. Generate a real signed invoice using the human-reviewed local PowerShell procedure in `docs/stars-operator-payment-smoke.md`, which accepts fresh Telegram Mini App `initData` via hidden prompt and directly calls Worker `/api/invoice` without enabling the storefront or relaxing CSP. First purchase must be explicitly human-approved; then reconcile `payments`, `wallet_ledger`, `wallets`, refund and subscription controls. Only after the backend gate passes: controlled client UI verification, then gradual public storefront enablement.

## Explicit non-goals

Do not change Phaser game RNG, audio, Umami, render hosting tier, server authoritative economy, game score, wallet migration, D1 schema or its contents. No live Stars, no switches, no paid upgrades within the coding PR.

## Pre-cutover release gates — all mandatory while Telegram still targets Render

- [ ] Independent security review: authentication, secret separation, redirect prevention, body bounds, failure retry and rate limiting PASS
- [ ] Existing `/api/webhook` compatibility PASS; D1 v17 and backup valid
- [ ] Direct `/api/telegram/ingress` classification/auth/size and Render failure suite PASS
- [ ] Complete fake D1 lifecycle: precheckout acceptance/denial, successful payment exactly once, batch failure/retry, subscription and refund PASS
- [ ] CI, browser smoke and independent CodeRabbit/Muse review accepted
- [ ] `getWebhookInfo` current URL, allowed updates, pending count and errors recorded; restore parameters documented
- [ ] Dormant Worker endpoint deployed and tested without changing active Telegram `setWebhook`
- [ ] Worker `TG_WEBHOOK_SECRET` matches existing Render `TG_WEBHOOK_SECRET`; authenticated `/start ref_...`, `/help` and `/paysupport` relay tests PASS
- [ ] **Explicit owner-approved release decision** with instant rollback contacts/tools available

## Controlled cutover and post-cutover acceptance

**Only after all pre-cutover gates:** setWebhook to the Worker ingress using the exact existing Telegram ingress secret, preserving `allowed_updates`; set `drop_pending_updates=false`. Verify `getWebhookInfo` and pending delivery without creating duplicate hooks.

- [ ] `/start`, `/help`, `/paysupport`, referral registration and command replies work on the **actual bot**
- [ ] Actual precheckout after long Render idle is answered by Telegram within 10s end-to-end with safety margin
- [ ] Controlled legitimate low-value Stars payment through `docs/stars-operator-payment-smoke.md` (no public storefront), D1 payment+wallet grant, duplicate webhook replay, refund and subscription lifecycle reconciled
- [ ] Only after all payment checks: `VITE_PAYMENTS_API_URL` enabled on Render and purchase UI allowed
- [ ] Any failure triggers `setWebhook` rollback to the captured Render URL and old allowed_updates, with `drop_pending_updates=false` and D1 transaction reconciliation
