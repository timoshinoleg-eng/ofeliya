- [ ] The payment host **does not sleep** and can answer `pre_checkout_query` inside 10s with a measured margin.
- [ ] A Telegram **test-environment** purchase has completed end-to-end (§18.5) — including a refund.
- [ ] The `/terms` and `/support` bot commands exist (Telegram's own live checklist).
- [ ] A dispute/chargeback runbook exists, with an owner and an escalation path.
- [ ] A way to obtain a Telegram-side transaction listing for disputes exists (Q5).
- [ ] A kill switch exists and is tested: flipping it makes `pre_checkout_query` fail closed — and any
      already-charged payment is still fulfilled (§14, the `alertPaymentWhileDisabled` discipline).

### 23.4 Product

- [ ] The refund policy (Q10) is written and published.
- [ ] The storefront renders pending/refund/error states honestly (§10.7).
- [ ] The client cannot author value (§17, contract C1).
- [ ] The client has been verified to render **only** server state — including the offline and
      stale-cache cases.

### 23.5 Explicit stop conditions

- [ ] If the ledger is unreachable, **no invoice is presented** and **no grant happens**. Verified by
      deliberately breaking the DB during a test-env purchase.

---

## Appendix A — Evidence log

| Check | Command / source | Result |
|---|---|---|
| PR inventory | `mcode-tools connector call connector__github__list_pull_requests` (10 pages, `state=all`) | 219 unique PRs, #13–#243; 0 monetization PRs |
| Branch inventory | `git branch -r` | 230 remote branches |
| Content search (payment primitives) | `git grep -lI` over all 230 refs | `opId`, `invoice_payload`, `telegram_payment`, `sendInvoice`, `createInvoiceLink`, `refundStar`, `trg_wallet`, `wallet_ledger`, `restore_purchase` → **0 files** |
| Patch files | `git rev-list --all --objects \| grep '\.patch$'` | **0** |
| Dangling objects | `git fsck --lost-found --no-progress` | none |
| DB technology | grep for `D1\|sqlite\|postgres\|prisma\|mongodb` + `package.json` deps | Only `deploy/ofeliya-state.sql` (Postgres) + `deploy/CLOUDRU_DEPLOY.md` prose; **no DB driver dependency** |
| Billing deferral | `ARCHITECTURE_NOTES.md:274`, `README.md:202` | Billing explicitly out of scope, with a stated exit condition |
| Muse matrix | `docs/qa/MINIMAX_MUSE_CONVERGENCE_20261025.md` §2, §7 | 16 sources: 7 implemented, 3 partial, 6 excluded |
| Client boundary | `src/game/collection/ClientCollection.ts` | `CollectionSnapshot` has no wallet/balance/currency/purchase |
| Lab boundary | `src/ui/CollectionBoard.ts` | "ИССЛЕДОВАНИЯ · БЕЗ УСИЛЕНИЙ"; no purchase control |
| Idempotency precedent | `server/index.mjs` (Daily V2) | `submissionId` + `submissionHash` → `409` on mismatch |
| Entitlement precedent | `server/index.mjs` | `PROFILE_CATALOG`, `ENTITLEMENT_SOURCES`, `grantProfileItem`, `withProfileLock` |
| Postgres substrate | `deploy/ofeliya-state.sql` @ `413807daa5` | `ofeliya_private.state`, RLS, `service_role`, `ofeliya_state_call`, revision + commit-id idempotency |
| Stars prior art | `coder_survival` `backend/migrations/001_init.sql`, `060_*.sql`, `backend/src/routes/{buy,internalPayments}.js`, `bot/src/payments.js`, `bot/src/createBot.js:209-231` | A real `star_payments` schema + confirm/refund endpoints + a fail-closed kill switch |
| Telegram Stars contract | `core.telegram.org/bots/payments-stars`, `/bots/api/methods/*`, `/bots/api/types/*` | Field names quoted verbatim in §9.2 |
| Sibling repos | 58 repos via `search_repositories`; `restobot` and `coder_survival` cloned and grepped | `restobot` has **no** Stars/payment code; `coder_survival` is the only real prior art |

## Appendix B — File index (all cited artifacts)

**OFELIYA `main` (`6144b4d18`)**
- `server/index.mjs` — `33d8ba12d5` — routes, idempotency, entitlement primitives
- `server/durable-state.mjs` — `5ae90a6789`
- `server/telegram-users.mjs` — `b8e7d0ef98`
- `deploy/ofeliya-state.sql` — `413807daa5`
- `deploy/ofeliya-state-function.ts` — `b4cf904b97`
- `deploy/RENDER.md` — the hosting/Supabase/state-writer contract
- `ARCHITECTURE_NOTES.md` — §"Server profile foundation (V1)", §"Still deferred"
- `README.md` — §"Профили игрока"

**OFELIYA Muse branch `qa/minimax-muse-convergence-20261025`**
- `docs/qa/MINIMAX_MUSE_CONVERGENCE_20261025.md` — `431ad9dd3f` — the 16-source matrix + §7
- `src/game/collection/ClientCollection.ts` — `c26ac4c427`
- `src/ui/CollectionBoard.ts` — `8957be32f8`
- `src/systems/ClientFeatureFlags.ts` — `36bb5e13fa`
- `scripts/check-muse-collection.mjs` — `dd4cfb4693`
- `scripts/check-muse-convergence-adversarial.mjs` — `c76f888519`

**OFELIYA merged commits**
- #100 `763628e548` — server-authoritative Daily V2 tickets
- #104 `d1aebf329` — harden Daily V2 ticket authority
- #117 `64624b18bf` — server profile / inventory foundation v1
- #119 `d549a9534` — server-proven founder badge
- #188 `94ba99153d` — Render Free with durable private state
- #223 `6144b4d18` — current `main` HEAD

**`timoshinoleg-eng/coder_survival` `main`** (the payment prior art)
- `backend/migrations/001_init.sql` — `purchases`, `star_payments`
- `backend/migrations/060_*.sql` — the partial unique index
- `backend/src/routes/buy.js` — the purchase intent endpoint
- `backend/src/routes/internalPayments.js` — the confirm/refund endpoints
- `bot/src/payments.js` — the fail-closed gate
- `bot/src/createBot.js` — the `pre_checkout_query` / `successful_payment` handlers
- `backend/tests/payments*.{js,mjs}` — the test shapes

**Telegram documentation**
- <https://core.telegram.org/bots/payments-stars>
- <https://core.telegram.org/bots/payments-stars.md>
- <https://core.telegram.org/bots/api/methods/sendinvoice.md>
- <https://core.telegram.org/bots/api/methods/createinvoicelink.md>
- <https://core.telegram.org/bots/api/methods/refundstarpayment.md>
- <https://core.telegram.org/bots/api/types/successfulpayment.md>
- <https://core.telegram.org/bots/api/types/precheckoutquery.md>
