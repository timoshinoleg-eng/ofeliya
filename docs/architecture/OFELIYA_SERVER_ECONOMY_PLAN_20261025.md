# OFELIYA — Server-Authoritative Economy / Telegram Stars / Storefront / Lab Progression

**Architecture package for the next major stage.**
Date: 2026-10-25 · Author: independent architecture/research owner · Repo: `timoshinoleg-eng/ofeliya`

> **Scope of this document.** Research and design only. No runtime, client, server or database code was
> modified. No payment was executed. Nothing was merged, deployed, or pushed to `main`. Branches
> `#241` / `#242` / `#243` were read but not touched.
>
> **Governing principle.** Monetization is not a UI feature. It is a financial system that must assume
> a hostile, retrying, multi-device client. The UI is a *renderer of server state*, never a decision maker.

---

## 1. Executive summary

### 1.1 The headline finding

**OFELIYA has no monetization code. Not a prototype, not a stub — none at all.**

Verified across the complete repository history:

| Search | Scope | Result |
|---|---|---|
| PR titles matching `payment\|stars\|wallet\|ledger\|refund\|storefront\|idempot\|reconcil\|premium\|purchas\|monetiz\|economy\|entitle\|sku\|billing\|shop` | all 219 PRs (#13–#243) | **0 monetization PRs** (all hits are false positives on words like "recovery"/"startup") |
| `opId`, `invoice_payload`, `telegram_payment`, `sendInvoice`, `createInvoiceLink`, `refundStar`, `trg_wallet`, `wallet_ledger`, `restore_purchase` | all 230 remote branches | **0 files** |
| `*.patch` tracked anywhere | all 232 refs | **0 files** |
| dangling/unreachable objects | `git fsck --lost-found` | **none** |

The `Stars` string appears in exactly two substantive places on `main` — and **both say billing is out of
scope**: `ARCHITECTURE_NOTES.md:274` and `README.md:202`.

### 1.2 What that actually means

This is not a "half-built payments system to fix". It is a **greenfield financial subsystem** that must
land *on top of* a server that already has the right shape.

The good news is substantial and was verified in code:

- OFELIYA already runs **Supabase/Postgres** in production (`ofeliya_private.state`, RLS, `service_role`-only).
- The server already implements **fail-closed idempotency** — `409 submissionId already used for another
  score` — with a request-content hash. This is exactly the primitive §8 of this brief asks for.
- The server already has an **append-only entitlement grant** with a **static server-side catalog**
  (`PROFILE_CATALOG`), a **per-user serialization lock** (`withProfileLock`), and an **advisory-claim**
  migration endpoint.
- The Muse convergence work already **named and quarantined** every client-authoritative economy prototype.

The bad news is equally precise: the monetization work described in the task brief
("payment/refund isolated line, wallet cursor fix, ~75/75 tests, SQL ~11/11, reconcile ~5/5") **is not in
this GitHub repository and cannot be verified here**. See §3.4 — but the org *does* contain a sibling
project with a real Stars implementation that is a far better port source.

### 1.3 The single most consequential design decision

**Do not build a spendable currency wallet in v1.**

Stars is the only currency, and it is *external* — held by Telegram, not by OFELIYA. What OFELIYA sells
is **entitlements** (a cosmetic, a permanent Lab level). There is no need for a server-side balance,
no `credits`, no `coins`, no `energy`. Every spend is a *one-shot purchase operation* against a
server-priced SKU.

Building a wallet in v1 would create the two hardest classes of bug in the threat model — lost balance
updates, and refund-versus-spend races — for a feature that has no user-visible value yet. **This single
omission removes ~35% of the attack surface in §7.**

A ledger schema is still designed here (§9, §16) so that a wallet can be *added later* without a rewrite,
but the v1 implementation is deliberately scoped to entitlements only.

### 1.4 Shape of the recommended architecture

```
   Telegram (external authority)          OFELIYA server (financial authority)
   ┌──────────────────────────┐          ┌────────────────────────────────────────┐
   │ sendInvoice(currency:XTR)│          │ POST /api/storefront/purchase          │
   │ PreCheckoutQuery         │──10s────▶│  → validate identity, resolve SKU,     │
   │  MUST answer ≤10s        │          │    fingerprint idempotency key          │
   │ SuccessfulPayment        │─────────▶│ POST /api/storefront/fulfill           │
   │  telegram_payment_charge_id UNIQUE │  → tx: INSERT operation (UNIQUE)       │
   │ refundStarPayment        │◀─────────│       UPSERT entitlement               │
   └──────────────────────────┘  refund  └────────────────────────────────────────┘
                                              │  Supabase/Postgres, schema ofeliya_pay
                                              ▼  (append-only operations + materialized entitlements)
```

**The client never decides `payment successful → permanently unlock`.** The server grants; the client
renders. This is not merely our preference — Telegram's own documentation states it:

> *"You must always check that you received a successful_payment update before delivering the goods or
> services purchased by the user – simply answering a pre_checkout_query does not guarantee a successful
> order or payment."*
> — <https://core.telegram.org/bots/payments-stars>

---

## 2. Current-state inventory

### 2.1 Inventory table

Status vocabulary: `PRODUCTION_READY` · `QA_ONLY` · `PARTIAL` · `PROTOTYPE` · `CLIENT_AUTHORITY_UNSAFE` ·
`SERVER_AUTHORITY_SAFE` · `OBSOLETE` · `DUPLICATE` · `MISSING` · `UNKNOWN`.

| Component | Source | Current implementation | Branch / PR / SHA | Tests | Authority | Status | Reusable? | Risks |
|---|---|---|---|---|---|---|---|---|
| Payment operation ledger | — | none | — | none | — | `MISSING` | n/a | no idempotency anchor exists |
| Telegram Stars provider | — | none | — | none | — | `MISSING` | n/a | — |
| Storefront scene / SKU catalog | — | none (Muse `#8` excluded) | Muse branch | none | — | `MISSING` | n/a | Muse version is client-authoritative |
| Server SKU catalog (allowlist) | `server/index.mjs` | `PROFILE_CATALOG = new Set(['founder-badge-v1'])` | `main` `33d8ba12d5` | `scripts/check-profile-client.mjs`, `server/test.mjs` | **server** | `SERVER_AUTHORITY_SAFE` · `PARTIAL` | ✅ **yes — the SKU prototype** | one hardcoded id; no price/version/enabled fields |
| Entitlement source enum | `server/index.mjs:1007` | `ENTITLEMENT_SOURCES = {grant, migration, promo}` — `purchase` deliberately excluded | `main` `33d8ba12d5` | `server/test.mjs` | **server** | `SERVER_AUTHORITY_SAFE` | ✅ **yes — the extension point** | must gain `purchase` only after §13 lands |
| Append-only entitlement grant | `server/index.mjs` | `grantProfileItem()` — id must be in catalog, source must be in allowlist, existing item never overwritten, `MAX_PROFILE_ITEMS` cap | `main` `33d8ba12d5` | `server/test.mjs` (PR #117, `64624b18bf`) | **server** | `SERVER_AUTHORITY_SAFE` · `PARTIAL` | ✅ **yes — the grant primitive** | in-memory object; no durable entitlement table of its own |
| Per-user serialization | `server/index.mjs` | `withProfileLock(userKey, task)` — promise-chain, 5000-lock cap | `main` `33d8ba12d5` | `server/test.mjs` | **server** | `SERVER_AUTHORITY_SAFE` · `PARTIAL` | ✅ **yes — race primitive** | single-process only; does not survive a second replica |
| Fail-closed idempotency | `server/index.mjs` (Daily V2) | `submissionId` (`/^[A-Za-z0-9_-]{16,64}$/`) + `submissionHash = sha256(payload)`; same key + different hash → `409`; same key + same hash → `200` replay | `main` `33d8ba12d5`; PR #100 `763628e548`, PR #104 `d1aebf329` | `scripts/check-daily-v2.mjs`, `server/test.mjs` | **server** | `SERVER_AUTHORITY_SAFE` | ✅ **yes — the exact §8 contract, already proven** | keyed to scores, not purchases |
| Server-issued capability (ticket) | `server/index.mjs` | `dailyRun` — `issuedAt`/`expiresAt`/`closedAt`; closed ticket replays receipt, does not re-authorize | `main` | `scripts/check-daily-v2.mjs` | **server** | `SERVER_AUTHORITY_SAFE` | ✅ **yes — the purchase-intent lifecycle analog** | — |
| Advisory one-shot claim | `server/index.mjs` | `POST /api/profile/migrate` — first valid claim `claimed:true`, repeats `claimed:false` + saved profile | `main`; PR #117 `64624b18bf` | `scripts/check-profile-client.mjs` | **server** | `SERVER_AUTHORITY_SAFE` | ✅ **yes — pattern for one-time SKUs** | advisory only; no hard uniqueness in DB |
| Identity verification | `server/index.mjs` | `verifyMessengerProfileIdentity()` → `validateInitData` → `{platform, uid, userKey}` | `main` | `server/security-regressions.test.mjs` | **server** | `PRODUCTION_READY` | ✅ **yes** | — |
| Durable state engine | `server/durable-state.mjs` | writer_id + expected revision + commit_id; `health()` | `main` `5ae90a6789` | `server/durable-state.test.mjs` | **server** | `PRODUCTION_READY` | ⚠️ **not for money** (whole-document JSONB blob) | lost-update risk at doc level; see §9 |
| Postgres substrate | `deploy/ofeliya-state.sql` | schema `ofeliya_private`, `state` single-row JSONB, RLS on, `service_role`-only, `ofeliya_state_call()` with `for update`, `claim`/`commit`/`revision-conflict`, idempotent replay via `last_commit` + payload equality | `main` `413807daa5`; PR #188 `94ba99153d` | manual deploy step only | **server** | `PRODUCTION_READY` | ✅ **yes — this is the DB to extend** | whole-doc rewrite; `Supabase Free` may pause |
| State gateway | `deploy/ofeliya-state-function.ts` | Deno Deploy edge fn; SHA-256 bearer compare; 8 MB cap; op whitelist `['read','claim','commit']` | `main` `b4cf904b97` | none | **server** | `PRODUCTION_READY` | ✅ **yes** | — |
| Collection / wallet boundary | `src/game/collection/ClientCollection.ts` | `CollectionSnapshot` has **no wallet, no balance, no currency, no purchase state** | Muse branch `c26ac4c427` | `scripts/check-muse-collection.mjs` `dd4cfb4693` | client-observation only | `SERVER_AUTHORITY_SAFE` (as a *boundary*) | ✅ **yes — keep it** | must not regress |
| Informational Lab | `src/ui/CollectionBoard.ts` | 3 informational branches; *"Урон, здоровье, скорость и награды не меняются."*; no purchase control, writes nothing | Muse branch `8957be32f8` | `scripts/check-muse-collection.mjs` | client-presentation only | `SERVER_AUTHORITY_SAFE` (as a *boundary*) | ✅ **yes — the presentation shell for §12** | must not gain a purchase button |
| Feature-flag economy seam | `src/systems/ClientFeatureFlags.ts` | presentation-only; contract asserts `'events' in flags === false`; Muse's `storefront.variant` / `economy.lab` dropped | Muse branch `36bb5e13fa` | `scripts/check-muse-convergence-adversarial.mjs` `c76f888519` | client | `SERVER_AUTHORITY_SAFE` (as a *boundary*) | ✅ **yes — keep it** | must not gain economy entries |
| Quest "wallet" | Muse `#4` | Muse `MetaWallet` — a **client-editable local balance** | Muse patch file (absent from GitHub) | — | client | `CLIENT_AUTHORITY_UNSAFE` | ❌ **no** | trivially editable |
| Muse Storefront | Muse `#8` | decided ownership **locally** | Muse patch file (absent) | — | client | `CLIENT_AUTHORITY_UNSAFE` | ❌ **no** | forged ownership |
| Muse Stars provider | Muse `#9` | `TelegramStarsPaymentProvider` **trusted the client** | Muse patch file (absent) | — | client | `CLIENT_AUTHORITY_UNSAFE` | ❌ **no** | forged "paid" |
| Muse `PaymentLedger` | Muse `#12` | client-side ledger | Muse patch file (absent) | — | client | `CLIENT_AUTHORITY_UNSAFE` | ❌ **no** | not a ledger |
| Muse `LabState` / `LabModifiers` | Muse `#4` | permanent power from a **client flag** | Muse patch file (absent) | — | client | `CLIENT_AUTHORITY_UNSAFE` | ❌ **no** | paid prestige for free |
| Muse worker / D1 ledger | Muse `#13–#16` | worker schema, entitlements, D1 ledger v15/v16, reconcile scripts | Muse patch files (absent) | Muse-only | — | `EXCLUDED_BY_SCOPE` / `UNKNOWN` | ⚠️ **reference only** | assumed a server ledger that does not exist here |
| `stars_500` | `ClientCollection.ts` | a Muse **achievement id** (kill counter) | Muse branch | `check-muse-collection.mjs` | client | `OBSOLETE` (name collision) | ❌ no | **do not confuse with Telegram Stars** |

### 2.2 Repository facts (verified)

| Fact | Value |
|---|---|
| Default branch | `main` |
| `main` HEAD | `6144b4d181fd711294adb7bef7dfc2641c483bcf` (2026-10-21, "Release OFELIYA Daily + B2/B4 + compact footer (#223)") |
| Remote branches | 230 |
| Total refs | 232 (incl. tag `pre-v0.4.1`) |
| Total PRs | 219 (#13 → #243) |
| Merged PRs relevant here | #100 `763628e548`, #104 `d1aebf329`, #117 `64624b18bf`, #119 `d549a9534`, #188 `94ba99153d`, #221, #223 `6144b4d18` |
| Open PRs (QA-only, untouched) | #241 `5a2e04332`, #242 `466536ba4`, #243 `5ba7652d6` |
| Backend runtime | Node 22 (`server/index.mjs`, 2084 lines, zero framework) |
| Runtime deps | `@maxhub/max-bot-api`, `phaser` — **no DB driver, no ORM, no SQL client** |
| Persistence | JSON files (`store.json`, `profiles.json`, `tg_users.json`) + Supabase Postgres JSONB snapshot |
| Hosting | Render Free (Frankfurt, `ofeliya-game`) + Supabase Free + Deno Deploy edge fn; Cloud.ru OFELIYA VM deleted 2026-10-11 |
| CI gates | `.github/workflows/ci.yml` — `build`, `browser-smoke`, + per-area scripts via `package.json` |

### 2.3 What does *not* exist (must be built)

Payment intent · SKU catalog with prices · entitlement table · purchase operation ledger ·
Stars invoice issuance · `pre_checkout_query` handling · `successful_payment` handling ·
`refundStarPayment` call · refund records · reconciliation job · storefront UI · paid Lab levels ·
restore-purchases flow · wallet/balance (deliberately deferred, §1.3).

---

## 3. Reusable prior work

### 3.1 Reusable from OFELIYA `main` — high confidence

| Asset | SHA | What it solves | Verdict |
|---|---|---|---|
| `server/index.mjs` — `submissionId` + `submissionHash` + `409` | `33d8ba12d5` | The **exact** idempotency contract §8 demands, already implemented and tested | **Port the pattern, not the code.** Replace "score" with "purchase operation" |
| `server/index.mjs` — `withProfileLock` | `33d8ba12d5` | Per-user read-modify-write serialization | Port pattern; replace with `pg_advisory_xact_lock` (multi-replica safe) |
| `server/index.mjs` — `PROFILE_CATALOG` + `ENTITLEMENT_SOURCES` + `grantProfileItem` | `33d8ba12d5` | Server-side SKU allowlist + append-only grant | Port pattern; extend to a real catalog table |
| `server/index.mjs` — `verifyMessengerProfileIdentity` | `33d8ba12d5` | Identity → `userKey` | **Reuse as-is** |
| `server/index.mjs` — `/api/profile/migrate` advisory claim | `33d8ba12d5` | One-shot claim semantics | Port pattern for one-time SKUs |
| `deploy/ofeliya-state.sql` | `413807daa5` | Postgres schema discipline: private schema, RLS, `service_role`-only, `search_path=''`, `security invoker` | **Reuse the discipline verbatim** for `ofeliya_pay` |
| `deploy/ofeliya-state-function.ts` | `b4cf904b97` | Token-gated single-writer gateway | Reuse the *pattern*; a financial writer needs a **different** auth model (see §20) |
| `src/game/collection/ClientCollection.ts` + `CollectionBoard.ts` | `c26ac4c427`, `8957be32f8` | Collection UI shell, gallery pagination, "owned vs locked" model | **Reuse the shell** for the Storefront; keep the no-wallet boundary |
| `scripts/check-muse-collection.mjs`, `check-muse-convergence-adversarial.mjs` | `dd4cfb4693`, `c76f888519` | The contracts that *prove* no client-side economy exists | **Reuse as regression gates** — they must keep passing after the server lands |

### 3.2 Reusable from the Muse convergence branch (`qa/minimax-muse-convergence-20261025`)

The single most valuable Muse artifact in GitHub is **not code — it is the decision record**:

`docs/qa/MINIMAX_MUSE_CONVERGENCE_20261025.md` @ `431ad9dd3f` contains:

- **§2** — a 16-source matrix (`ofeliya-improvements` … `ofeliya-review6-fixes`) with per-source status,
  the OFELIYA equivalent, the file, and the test. Totals: 7 implemented, 3 partial, 6 excluded.
- **§7 `DEFERRED_SERVER_AND_MONETIZATION`** — a per-item table with exactly the columns this brief needs:
  *existing groundwork · reusable as-is · needs a new server contract · must not be moved over from the
  client-authoritative Muse prototype · later E2E needed*.
- The rule: *"the Muse prototype is a client-authoritative design. It cannot be lifted into the product
  as-is; the catalogue, identity, price, grant and refund concepts have to be re-derived against a server
  contract, with the client reduced to a renderer of server state."*

**This document is the authoritative prior art for §4/§12 of this brief. Cite it rather than re-deriving.**

### 3.3 Reusable from sibling repo `timoshinoleg-eng/coder_survival` — **the real payment prior art**

This is where actual Stars money code lives in the org. Verified in `main` of that repo.

| Asset | Path | What it solves | Verdict |
|---|---|---|---|
| `star_payments` schema | `backend/migrations/001_init.sql` | `telegram_payment_charge_id TEXT NOT NULL UNIQUE` — **the external idempotency anchor**; plus `provider_payment_charge_id`, `invoice_payload`, `stars_amount`, `currency DEFAULT 'XTR'`, `status`, `raw_payload JSONB` | ✅ **Port the schema.** Rename `star_payments`→`operations`, add `op_id`/`op_fingerprint` |
| `purchases` schema | `backend/migrations/001_init.sql` | Intent table with `status ∈ (pending, completed, failed)` | ✅ Port as the intent half of `operations` |
| Partial unique index | `backend/migrations/060_*.sql` | `uq_purchases_starter_pack_once ON purchases(user_id) WHERE item_type='starter_pack' AND status IN ('pending','completed')` — *"A refunded purchase frees the slot again (deliberate: refund = can rebuy). Guards the concurrent double-intent race the pre-check in buy.js cannot close."* | ✅ **Port verbatim in spirit.** This is the DB-level one-time-SKU guard |
| Purchase intent endpoint | `backend/src/routes/buy.js` | `POST /api/buy`: rate-limiter → auth → payments-enabled → validate → `BEGIN` → one-time check → `INSERT purchases(status='pending')` → `audit_logs` → `COMMIT` → **`202`** + `payment:{currency:'XTR', payload:'purchase:<id>:<item_type>'}` | ✅ **Port the shape**; tighten per §17 |
| Fulfillment endpoint | `backend/src/routes/internalPayments.js` `POST /telegram/confirm` | `BEGIN` → **`pg_advisory_xact_lock(userId)`** → `SELECT purchase FOR UPDATE` → prior-paid check → `applyItemEffect` → `UPDATE purchases status='completed'` → `INSERT star_payments` (UNIQUE charge id) → `COMMIT` | ✅ **Port the shape.** `pg_advisory_xact_lock` is the key idea |
| Refund endpoint | `backend/src/routes/internalPayments.js` `POST /telegram/refund` | `BEGIN` → `SELECT star_payments FOR UPDATE OF sp` → **Bot API `refundStarPayment` FIRST** → `UPDATE star_payments status='refunded'` → `UPDATE purchases status='refunded' WHERE status='completed'` → `audit_logs` → `COMMIT` | ⚠️ **Port with care** — see §14. The external call inside a DB transaction can hold locks through a network timeout |
| Fail-closed kill switch | `bot/src/payments.js` | `parsePaymentsEnabled` = strict `=== 'true'`; `decidePreCheckout()` rejects non-`XTR`; `redactedDisabledPaymentNotice()` carries **no raw identifiers** | ✅ **Port verbatim.** Exactly the discipline §20 requires |
| Bot handlers | `bot/src/createBot.js:209–231` | `bot.on('pre_checkout_query')` → `answerPreCheckoutQuery(false,{error_message})` / `(true)`; `bot.on('message:successful_payment')` | ✅ Port the wiring; OFELIYA has no `grammy` — use `server/telegram-api.mjs` |
| Charge-without-delivery guard | `internalPayments.js` `alertPaymentWhileDisabled({itemType, idempotent})` | Handles a payment that lands while the runtime is disabled — fulfil rather than silently drop | ✅ **Port the intent** (see §7 row 10) |
| Tests | `backend/tests/payments.test.mjs`, `payments.confirmFulfillment.test.js`, `payments.killSwitch.test.js`, `payments.firstPurchaseBonus.test.js` | Test *shapes* to reproduce | ✅ Port the shapes, not the code |

**Not reusable from `coder_survival`:** the "Stars — пока mock" comment on `purchases` shows the *intent*
path was mock in part; the `energy`/`xp`/`commits` effect model is a different game's economy; the
`first_purchase_bonus` logic is product-specific.

### 3.4 The historical numbers in the brief — **not verifiable in this repository**

The brief cites *"payment/refund isolated line; wallet cursor fix; ~75/75 tests; SQL ~11/11; reconcile
~5/5; real Stars NOT_RUN; D1 production NOT_RUN; paid runtime disabled"*.

Verification performed:

| Claim | Result |
|---|---|
| An isolated payment/refund line in this repo | **Not found.** 0 PRs, 0 branches, 0 files, 0 dangling objects |
| The Muse patch files (`ofeliya-storefront.patch`, `ofeliya-telegram-stars.patch`, `ofeliya-phase4-economy.patch`, `ofeliya-review3-fixes.patch`, `ofeliya-review6-fixes.patch`) | **Not in GitHub.** `git rev-list --all --objects | grep '\.patch$'` → 0 |
| `wallet cursor` fix | No `cursor` concept exists in `ofeliya`; no `wallet` symbol anywhere |
| "paid runtime disabled" | **Matches `coder_survival` exactly** — `PAYMENTS_ENABLED === 'true'` strict kill switch, `PAYMENTS_DISABLED_CODE` |
| "D1 production NOT_RUN" | Consistent: OFELIYA has **no D1**; Muse patches `#13–#16` were excluded and their files are absent |

**Conclusion.** The numbers most plausibly describe a **local, never-pushed worktree** (or work in
`coder_survival`, not `ofeliya`). **Do not treat them as a baseline.** Do not treat them as a test
expectation for the new work either. The `coder_survival` implementation (§3.3) is the only payment code
whose behaviour is verifiable from source, and it should be the port source.

### 3.5 Code archaeology verdict on the old payment branch

| Question | Answer |
|---|---|
| Is there an old payment branch to cherry-pick from? | **No.** Nothing to cherry-pick. |
| Is there a *port-by-idea* source? | **Yes — two of them:** `ofeliya/main` (idempotency + entitlement primitives) and `coder_survival/main` (Stars money path). |
| Is any of it stale relative to current `main`? | `coder_survival`'s payment path is **not** stale — it is actively maintained (`payments.*` tests exist). Its *schema* (`star_payments`) is directly reusable. |
| Was the found semantic defect real? | **Yes, and it is preserved in GitHub as a decision.** The Muse `Storefront` decided ownership locally; `TelegramStarsPaymentProvider` trusted the client; `LabModifiers` applied permanent power from a client flag. The defect class — *one operation id reused across a different subject, and the client applying a foreign `branchId`/level locally* — is exactly what §8's fingerprint binding prevents. The Muse prototypes **exhibit** it; they must not be ported. |

---

## 4. Rejected unsafe prototypes (must not be reused)

| Prototype | Where known | Why rejected | What we take instead |
|---|---|---|---|
| Muse `MetaWallet` | Muse patch #4 (absent from GitHub); documented in Muse doc row 4 | A **local, client-editable balance**. `localStorage` edit = free currency | Nothing. The "observation without authority" boundary (`ClientCollection` exposes counters only) is the *correct* pattern and is already enforced by a contract test |
| Muse `Storefront` | Muse patch #8 (absent) | **Client decides ownership.** Forged ownership = free cosmetics | Server catalog + server entitlement read model; client renders |
| Muse `TelegramStarsPaymentProvider` | Muse patch #9 (absent) | **Trusted the client** on payment success | Server verifies `successful_payment`; client only displays `payment_pending` |
| Muse `PaymentLedger` | Muse patch #12 (absent) | Client-side ledger is not a ledger — it is a number the client owns | Append-only Postgres `operations` table |
| Muse `LabState` / `LabModifiers` | Muse patch #4 (absent) | **Permanent power from a client flag.** Paid prestige for free | Client sends *intent* (`purchase branch/level`); server computes the legal next level and grants it |
| Muse worker/D1 (patches #13–#16) | Muse patch files (absent) | Assumed a server ledger that **does not exist here**; schema versions 15/16 are unanchored | Re-derive against `ofeliya_pay` schema on the **existing Supabase Postgres** |
| Muse `storefront.variant` / `economy.lab` feature flags | Muse patch #3, dropped in OFELIYA | Feature flags are presentation-only; an economy flag is a client-side switch | No economy flags. Ever. The contract `'events' in flags === false` stays |
| `stars_500` achievement id | `ClientCollection.ts` | **Name collision** with Telegram Stars | Rename mentally; it is a kill-counter achievement |
| `coder_survival` refund-with-external-call-inside-transaction | `internalPayments.js` | Holds a row lock across a network call to Telegram; a slow refund can block the user's other purchases | Two-phase refund (§14) |
| `coder_survival` "Stars — пока mock" purchases table | `001_init.sql:52` | Schema says mock — the *intent* was never proven against real Telegram | Take the schema, not the semantics; re-derive against §13 |

---

## 5. Authority model

### 5.1 The one rule

> **The client is never the authority for a paid entitlement or a paid balance.**
> The server is the only entity allowed to *conclude* that value was transferred.

Derived corollaries:

1. The client may **request** a SKU. It may not state a price, a level, a branch, a balance, or an outcome.
2. The client may **send an idempotency key**. It may not choose what that key *means* — the server binds it.
3. The client may **render** a pending state. It may not render "unlocked" until the server says so.
4. A `successful_payment` update is a **claim from Telegram**, not a grant. The server verifies and grants.
5. If the server cannot reach its ledger, the purchase **fails closed**. It never "probably succeeded".

### 5.2 Authority boundaries per entity

#### Currency

| Currency class | v1 decision | Source of truth |
|---|---|---|
