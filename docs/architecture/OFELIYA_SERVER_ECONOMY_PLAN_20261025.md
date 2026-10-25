# OFELIYA — Server-Authoritative Economy / Telegram Stars / Storefront / Lab Progression

**Architecture package for the next major stage.**
Date: 2026-10-25 · Author: independent architecture/research owner · Repo: `timoshinoleg-eng/ofeliya`

> **Scope.** Research and design only. No runtime, client, server or database code was modified. No
> payment was executed. Nothing was merged, deployed, or pushed to `main`. Branches #241 / #242 / #243
> were read but not touched.
>
> **Governing principle.** Monetization is not a UI feature. It is a financial system that must assume a
> hostile, retrying, multi-device client. **The UI is a renderer of server state, never a decision maker.**

**Deep-dive annexes** (each an independent file in `docs/architecture/ofeliya-server-economy/`):
`ANNEX_A_inventory_and_prior_work.md` · `ANNEX_B_threat_model.md` · `ANNEX_C_schema_and_api.md` ·
`ANNEX_D_provider_storefront_lab.md` · `ANNEX_E_roadmap_evidence.md`

---

## 0. Revision 2 — the factual correction

**Revision 1 of this package contained a material factual error. It is corrected here, and the
architecture that depended on it has been rebuilt.**

| | Revision 1 (wrong) | Revision 2 (corrected) |
|---|---|---|
| The Telegram transaction history | *"Telegram provides no API to list a bot's payments. There is no 'list my transactions' method."* → a charge without a local operation could **only** be found by a manual Telegram-side export | **`getStarTransactions` exists** (Bot API 7.5, June 18, 2024) and returns the bot's own Star transaction history, paginated by `offset`/`limit` (§9.2.1). A charge without a local operation is **automatically detectable** |
| Reconciliation | A **manual** procedure | A **three-source** machine comparison with a per-case detectability class (§14.4–§14.8) |
| Refunds | *"Revoke first, then call Telegram"* — one terminal `REFUND_FAILED` state, and an unknown external outcome is treated as a failure | An explicit **five-state** machine with a `REFUND_RECONCILE` state, so an **unknown** outcome is never mistaken for a failure (§13) |
| The Bot API vs MTProto distinction | Not distinguished | A full **capability matrix**, and the rule that OFELIYA builds on the **Bot API only** (§9.5) |

**What did *not* change.** The governing principle, the authority model, the append-only ledger, the
idempotency contract, the entitlement design, the Storefront rules and the Go/No-Go discipline are all
unchanged. The correction **widens** what is provable; it does not weaken the safety rules.

> **The principle, restated after the correction:**
> **Do not trust the local ledger alone, and do not trust the Telegram update stream alone.**
> Payment recovery is built by **matching the external Telegram transaction facts against the internal
> immutable operation ledger and the authoritative entitlement state** — and by refusing to guess when the
> evidence is ambiguous.

**Revision 2 is still documentation-only.** No runtime, client, server or database code changed. No payment,
no refund and no Telegram Stars API call was made.

---

## 1. Executive summary

### 1.1 Headline finding

**OFELIYA has no monetization code. Not a prototype, not a stub — none at all.**

| Search | Scope | Result |
|---|---|---|
| PR titles matching `payment\|stars\|wallet\|ledger\|refund\|storefront\|idempot\|reconcil\|premium\|purchas\|monetiz\|economy\|entitle\|sku\|billing\|shop` | all 219 PRs (#13–#243) | **0 monetization PRs** (hits are false positives on "recovery"/"startup") |
| `opId`, `invoice_payload`, `telegram_payment`, `sendInvoice`, `createInvoiceLink`, `refundStar`, `trg_wallet`, `wallet_ledger`, `restore_purchase` | all 230 remote branches | **0 files** |
| `*.patch` tracked anywhere | all 232 refs | **0 files** |
| dangling/unreachable objects | `git fsck --lost-found` | **none** |

The string `Stars` appears in exactly two substantive places on `main` — and **both say billing is out of
scope**: `ARCHITECTURE_NOTES.md:274` and `README.md:202`.

### 1.2 What that actually means

This is not a half-built payments system to fix. It is a **greenfield financial subsystem** landing *on
top of* a server that already has the right shape. Verified in code:

- OFELIYA already runs **Supabase/Postgres** in production (`ofeliya_private.state`, RLS,
  `service_role`-only, `ofeliya_state_call` RPC) — `deploy/ofeliya-state.sql`.
- The server already implements **fail-closed idempotency**: `409 submissionId already used for another
  score` with a request-content hash. This is exactly the primitive §8 of the brief demands.
- The server already has an **append-only entitlement grant** with a **static server catalog**
  (`PROFILE_CATALOG`), a **per-user serialization lock** (`withProfileLock`) and an **advisory-claim**
  migration endpoint.
- The Muse convergence work already **named and quarantined** every client-authoritative economy prototype.

The bad news is equally precise: the monetization work described in the brief (*"payment/refund isolated
line, wallet cursor fix, ~75/75 tests, SQL ~11/11, reconcile ~5/5"*) **is not in this repository and
cannot be verified here** (§3.4 of Annex A). But the org *does* contain a sibling project,
`timoshinoleg-eng/coder_survival`, with a **real, verifiable Stars implementation** — a far better port
source than the missing patches.

### 1.3 The single most consequential design decision

**Do not build a spendable currency wallet in v1.**

Stars is the only currency and it is **external** — held by Telegram, not by OFELIYA. What OFELIYA sells
is **entitlements** (a cosmetic, a permanent Lab level). There is no need for a server-side balance, no
`credits`, no `coins`, no `energy`. Every spend is a one-shot purchase operation against a server-priced
SKU.

Building a wallet in v1 would create the two hardest bug classes in the threat model — lost balance
updates, and refund-versus-spend races — for a feature with no user-visible value yet. **This single
omission removes ~35% of the attack surface in §6.**

A ledger schema is still designed (§9, §15) so a wallet can be added later without a rewrite, but the v1
implementation is deliberately scoped to entitlements only.

### 1.4 Shape of the recommended architecture

```
   Telegram (external authority)            OFELIYA server (financial authority)
   ┌────────────────────────────┐          ┌──────────────────────────────────────┐
   │ sendInvoice(currency:XTR)  │          │ POST /api/storefront/purchase        │
   │ PreCheckoutQuery           │──10s───▶│  → validate identity, resolve SKU,    │
   │  MUST answer ≤10s          │          │    fingerprint idempotency key       │
   │ SuccessfulPayment          │─────────▶│ POST /api/storefront/fulfill         │
   │  telegram_payment_charge_id│          │  → tx: INSERT operation (UNIQUE)     │
   │   UNIQUE                   │          │       UPSERT entitlement             │
   │ refundStarPayment          │◀─────────│       + grant_log                    │
   └────────────────────────────┘  refund  └──────────────────────────────────────┘
                                              │  Supabase/Postgres, schema ofeliya_pay
                                              ▼  append-only operations + materialized entitlements
```

**The client never decides `payment successful → permanently unlock`.** The server grants; the client
renders. This is not merely our preference — Telegram's own documentation states it:

> *"You must always check that you received a successful_payment update before delivering the goods or
> services purchased by the user – simply answering a pre_checkout_query does not guarantee a successful
> order or payment."* — <https://core.telegram.org/bots/payments-stars>

---

## 2. Current-state inventory

Status vocabulary: `PRODUCTION_READY` · `QA_ONLY` · `PARTIAL` · `PROTOTYPE` · `CLIENT_AUTHORITY_UNSAFE` ·
`SERVER_AUTHORITY_SAFE` · `OBSOLETE` · `DUPLICATE` · `MISSING` · `UNKNOWN`.

| Component | Source | Current implementation | Branch / PR / SHA | Tests | Authority | Status | Reusable? |
|---|---|---|---|---|---|---|---|
| Payment ledger · Stars provider · storefront · SKU catalog · entitlement table · wallet · reconciliation · restore flow | — | **none** | — | none | — | `MISSING` | n/a |
| Server SKU catalog (allowlist) | `server/index.mjs:1009` | `PROFILE_CATALOG = new Set(['founder-badge-v1'])` | `main` `33d8ba12d5` | `check-profile-client.mjs` | **server** | `SERVER_AUTHORITY_SAFE` · `PARTIAL` | ✅ **the SKU prototype** |
| Entitlement source enum | `server/index.mjs:1007` | `ENTITLEMENT_SOURCES = {grant, migration, promo}` — `purchase` deliberately excluded | `main` `33d8ba12d5` | `server/test.mjs` | **server** | `SERVER_AUTHORITY_SAFE` | ✅ **the extension point** |
| Append-only entitlement grant | `server/index.mjs:1129` | `grantProfileItem()` — the id ∈ the catalog, the source ∈ the allowlist, never overwrites | `main` `33d8ba12d5` | PR #117 `64624b18bf` | **server** | `SERVER_AUTHORITY_SAFE` · `PARTIAL` | ✅ **the grant primitive** |
| Per-user serialization | `server/index.mjs:1054` | `withProfileLock(userKey, task)` — a promise chain, a 5000-lock cap | `main` `33d8ba12d5` | `server/test.mjs` | **server** | `SERVER_AUTHORITY_SAFE` · `PARTIAL` | ✅ **the race primitive** (in-process only) |
| Fail-closed idempotency | `server/index.mjs:1636,1708` | `submissionId` + `submissionHash`; the same key + a different hash → `409`; the same key + the same hash → a `200` replay | `main`; #100 `763628e548`, #104 `d1aebf329` | `check-daily-v2.mjs` | **server** | `SERVER_AUTHORITY_SAFE` | ✅ **the exact §7 contract, already proven** |
| Server-issued capability (ticket) | `server/index.mjs` | `dailyRun` — `issuedAt`/`expiresAt`/`closedAt`; a closed ticket replays the receipt, never re-authorizes | `main` | `check-daily-v2.mjs` | **server** | `SERVER_AUTHORITY_SAFE` | ✅ **the intent-lifecycle analog** |
| Advisory one-shot claim | `server/index.mjs` | `POST /api/profile/migrate` — the first claim `claimed:true`, the repeats `claimed:false` | `main`; PR #117 | `check-profile-client.mjs` | **server** | `SERVER_AUTHORITY_SAFE` | ✅ **the one-time-SKU pattern** |
| Identity verification | `server/index.mjs:1151` | `verifyMessengerProfileIdentity()` → `validateInitData` → `{platform, uid, userKey}` | `main` | `security-regressions.test.mjs` | **server** | `PRODUCTION_READY` | ✅ **as-is** |
| Durable state engine | `server/durable-state.mjs` | writer_id + the expected revision + commit_id | `main` `5ae90a6789` | `durable-state.test.mjs` | **server** | `PRODUCTION_READY` | ⚠️ **not for money** (a whole-document JSONB blob) |
| Postgres substrate | `deploy/ofeliya-state.sql` | `ofeliya_private.state`, RLS, `service_role`-only, `ofeliya_state_call()` with `for update` / `claim` / `commit` / `revision-conflict` | `main` `413807daa5`; PR #188 | a manual deploy step | **server** | `PRODUCTION_READY` | ✅ **the DB to extend** |
| State gateway | `deploy/ofeliya-state-function.ts` | a Deno edge fn; a SHA-256 bearer compare; an 8 MB cap; the op whitelist | `main` `b4cf904b97` | none | **server** | `PRODUCTION_READY` | ✅ **yes** |
| Collection / wallet boundary | `src/game/collection/ClientCollection.ts` | `CollectionSnapshot` has **no wallet, no balance, no currency, no purchase state** | Muse branch `c26ac4c427` | `check-muse-collection.mjs` | client-observation only | `SERVER_AUTHORITY_SAFE` (as a *boundary*) | ✅ **keep it** |
| Informational Lab | `src/ui/CollectionBoard.ts` | 3 informational branches; *"Урон, здоровье, скорость и награды не меняются."*; no purchase control | Muse branch `8957be32f8` | `check-muse-collection.mjs` | client-presentation only | `SERVER_AUTHORITY_SAFE` (as a *boundary*) | ✅ **the presentation shell for §11** |
| Feature-flag economy seam | `src/systems/ClientFeatureFlags.ts` | presentation-only; the contract asserts `'events' in flags === false` | Muse branch `36bb5e13fa` | `check-muse-convergence-adversarial.mjs` | client | `SERVER_AUTHORITY_SAFE` (as a *boundary*) | ✅ **keep it** |
| Muse `MetaWallet` · `Storefront` · `TelegramStarsPaymentProvider` · `PaymentLedger` · `LabState`/`LabModifiers` | Muse #4, #8, #9, #12 | a client-editable balance; a locally-decided ownership; a client-trusted payment; a client-side ledger; permanent power from a client flag | Muse patch files (absent from GitHub) | — | client | `CLIENT_AUTHORITY_UNSAFE` | ❌ **no** — each is the exact defect class §7 prevents |
| Muse worker / D1 ledger | Muse #13–#16 | the worker schema, the entitlements, the D1 ledger v15/v16, the reconcile scripts | Muse patch files (absent) | Muse-only | — | `EXCLUDED_BY_SCOPE` / `UNKNOWN` | ⚠️ **reference only** |
| `stars_500` | `ClientCollection.ts` | a Muse **achievement id** (25 elite kills) | Muse branch | `check-muse-collection.mjs` | client | `OBSOLETE` (a name collision) | ❌ no — **not Telegram Stars** |

> The **risks** column and the full inventory — including every `MISSING` component, the persistence
> substrate and the client-side boundaries — are in **Annex A §A.2**.

> The **risks** column and the full 27-row inventory (including every `MISSING` component and the
> Muse-derived rows) are in **Annex A §A.2**.

### 2.1 Repository facts (verified)

| Fact | Value |
|---|---|
| Default branch · HEAD | `main` · `6144b4d181fd711294adb7bef7dfc2641c483bcf` (2026-10-21, PR #223) |
| Remote branches · total refs | 230 · 232 (incl. tag `pre-v0.4.1`) |
| Total PRs | 219 (#13 → #243) |
| Merged PRs relevant here | #100 `763628e548` · #104 `d1aebf329` · #117 `64624b18bf` · #119 `d549a9534` · #188 `94ba99153d` · #223 `6144b4d18` |
| Open QA-only PRs (untouched) | #241 `5a2e04332` · #242 `466536ba4` · #243 `5ba7652d6` |
| Backend runtime | Node 22 (`server/index.mjs`, 2084 lines, zero framework) |
| Runtime deps | `@maxhub/max-bot-api`, `phaser` — **no DB driver, no ORM, no SQL client** |
| Persistence | JSON files (`store.json`, `profiles.json`, `tg_users.json`) + Supabase Postgres JSONB snapshot |
| Hosting | Render Free (Frankfurt, `ofeliya-game`) + Supabase Free + Deno Deploy edge fn; Cloud.ru OFELIYA VM deleted 2026-10-11 |
| CI gates | `.github/workflows/ci.yml` — `build`, `browser-smoke` + per-area scripts wired via `package.json` |

### 2.2 What does not exist (must be built)

Payment intent · SKU catalog with prices · entitlement table · purchase operation ledger · Stars invoice
issuance · `pre_checkout_query` handling · `successful_payment` handling · `refundStarPayment` call ·
refund records · reconciliation job · storefront UI · paid Lab levels · restore-purchases flow ·
wallet/balance (deliberately deferred, §1.3).

Full archaeology, the Muse 16-source matrix, the rejected-prototype list and the reusable-asset index:
**Annex A**.

---

## 3. Reusable prior work

### 3.1 From OFELIYA `main` — high confidence

| Asset | SHA | What it solves | Verdict |
|---|---|---|---|
| `submissionId` + `submissionHash` + `409` | `33d8ba12d5` | The **exact** idempotency contract §7 demands, implemented and tested | **Port the pattern, not the code** — replace "score" with "purchase operation" |
| `PROFILE_CATALOG` + `ENTITLEMENT_SOURCES` + `grantProfileItem` + `withProfileLock` | `33d8ba12d5` | The SKU allowlist, the append-only grant, the per-user lock | Port the patterns; extend to a real catalog table and swap the in-memory lock for `pg_advisory_xact_lock` |
| `deploy/ofeliya-state.sql` + `ofeliya-state-function.ts` | `413807daa5`, `b4cf904b97` | The Postgres discipline (a private schema, RLS, `service_role`-only, `search_path=''`, `security invoker`) and the token-gated gateway | **Reuse the discipline verbatim** for `ofeliya_pay`; the money writer needs its own token (§20) |
| `ClientCollection.ts` + `CollectionBoard.ts` + the two `check-muse-*.mjs` contracts | `c26ac4c427`, `8957be32f8`, `dd4cfb4693`, `c76f888519` | The collection UI shell, the "owned vs locked" model, and the contracts that *prove* no client-side economy exists | **Reuse the shell** for the Storefront; keep the no-wallet boundary; **the contracts must keep passing after the server lands** |

The full table, with every primitive and its test coverage: **Annex A §A.2.2**.

### 3.2 From the Muse convergence branch — the authoritative decision record

`docs/qa/MINIMAX_MUSE_CONVERGENCE_20261025.md` @ `431ad9dd3f` is the single most valuable Muse artifact in
GitHub, and it is **not code**. Its **§2** is a 16-source matrix (`ofeliya-improvements` …
`ofeliya-review6-fixes`) with per-source status, the OFELIYA equivalent, the file and the test — totals:
7 implemented, 3 partial, 6 excluded. Its **§7 `DEFERRED_SERVER_AND_MONETIZATION`** is a per-item table
with exactly the columns this brief needs: *existing groundwork · reusable as-is · needs a new server
contract · must not be moved over from the client-authoritative Muse prototype · later E2E needed*. Its
rule: *"the Muse prototype is a client-authoritative design. It cannot be lifted into the product as-is;
the catalogue, identity, price, grant and refund concepts have to be re-derived against a server
contract, with the client reduced to a renderer of server state."*

**Cite this document rather than re-deriving it.** The full matrix: **Annex A §A.3**.

### 3.3 From sibling repo `timoshinoleg-eng/coder_survival` — the real payment prior art

This is where actual Stars money code lives in the org. Verified in that repo's `main`. It is a different
game (a Telegram Mini App with a Node/PostgreSQL backend), so **nothing is ported verbatim** — but the
*shapes* are directly transferable.

| Asset | What it solves | Verdict |
|---|---|---|
| `star_payments` (in `backend/migrations/001_init.sql`) | `telegram_payment_charge_id TEXT NOT NULL UNIQUE` — **the external idempotency anchor**; plus `provider_payment_charge_id`, `invoice_payload`, `stars_amount`, `currency DEFAULT 'XTR'`, `raw_payload JSONB` | ✅ **Port the schema** — rename to `operations`, add `op_id` / `op_fingerprint` |
| `backend/migrations/060_*.sql` | the partial unique index `ON purchases(user_id) WHERE item_type='starter_pack' AND status IN ('pending','completed')` — *"A refunded purchase frees the slot again (deliberate: refund = can rebuy). Guards the concurrent double-intent race the pre-check in buy.js cannot close."* | ✅ **Port in spirit** — the DB-level one-time-SKU guard |
| `backend/src/routes/buy.js` (`POST /api/buy`) | the purchase intent: rate-limiter → auth → payments-enabled → validate → `BEGIN` → the one-time check → `INSERT purchases(status='pending')` → `audit_logs` → `COMMIT` → **`202`** + `payment:{currency:'XTR', payload:'purchase:<id>:<item_type>'}` | ✅ **Port the shape**; tighten per §16 |
| `backend/src/routes/internalPayments.js` (`POST /telegram/confirm`) | `BEGIN` → **`pg_advisory_xact_lock(userId)`** → `SELECT purchase FOR UPDATE` → the prior-paid check → the effect → `UPDATE purchases status='completed'` → `INSERT star_payments` (UNIQUE charge id) → `COMMIT` | ✅ **Port the shape.** `pg_advisory_xact_lock` is the key idea |
| `backend/src/routes/internalPayments.js` (`POST /telegram/refund`) | `BEGIN` → `SELECT … FOR UPDATE OF sp` → the user check → `UPDATE star_payments status='refunded'` → `UPDATE purchases status='refunded'` → `audit_logs` → `COMMIT`. **The route contains NO Telegram call at all** — the comment claims *"the bot calls refundStarPayments() on the Bot API FIRST"*, but no such call exists anywhere in that repo | ⚠️ **Port the shape, not the semantics.** See the REUSE / PORT_WITH_CHANGE / DO_NOT_REUSE split in §21.5 |
| `bot/src/payments.js` | the fail-closed kill switch: `parsePaymentsEnabled` = strict `=== 'true'`; `decidePreCheckout()` rejects non-`XTR`; `redactedDisabledPaymentNotice()` carries **no raw identifiers** | ✅ **Port verbatim** — exactly the discipline §20 requires |
| `bot/src/createBot.js:209–231` | `bot.on('pre_checkout_query')` → `answerPreCheckoutQuery(false,{error_message})` / `(true)`; `bot.on('message:successful_payment')` | ✅ Port the wiring; OFELIYA has no `grammy` — use `server/telegram-api.mjs` |
| `internalPayments.js` → `alertPaymentWhileDisabled({itemType, idempotent})` | the charge-without-delivery guard — a payment landing while the runtime is disabled is **fulfilled**, not dropped | ✅ **Port the intent** (§6 row 10) |

**Not reusable:** the *"Stars — пока mock"* comment on `purchases` shows the intent path was partly mock;
the `energy`/`xp`/`commits` effect model is a different game's economy; `first_purchase_bonus` is
product-specific. The file-by-file walkthrough, the code excerpts and the caveats: **Annex A §A.4, §A.7**.


### 3.4 The historical numbers in the brief — not verifiable here

The brief cites *"payment/refund isolated line; wallet cursor fix; ~75/75 tests; SQL ~11/11; reconcile
~5/5; real Stars NOT_RUN; D1 production NOT_RUN; paid runtime disabled"*.

| Claim | Result |
|---|---|
| An isolated payment/refund line in this repo | **Not found.** 0 PRs, 0 branches, 0 files, 0 dangling objects |
| The Muse patch files (`ofeliya-storefront.patch`, `ofeliya-telegram-stars.patch`, `ofeliya-phase4-economy.patch`, `ofeliya-review3-fixes.patch`, `ofeliya-review6-fixes.patch`) | **Not in GitHub.** `git rev-list --all --objects \| grep '\.patch$'` → 0 |
| `wallet cursor` fix | No `cursor` concept exists in `ofeliya`; no `wallet` symbol anywhere |
| "paid runtime disabled" | **Matches `coder_survival` exactly** — the `PAYMENTS_ENABLED === 'true'` strict kill switch, `PAYMENTS_DISABLED_CODE` |
| "D1 production NOT_RUN" | Consistent: OFELIYA has **no D1**; the Muse patches #13–#16 were excluded and their files are absent |

**Conclusion.** The numbers most plausibly describe a **local, never-pushed worktree** (or work in
`coder_survival`, not `ofeliya`). **Do not treat them as a baseline, and do not treat them as a test
expectation for the new work.** The `coder_survival` implementation (§3.3) is the only payment code whose
behaviour is verifiable from source, and it should be the port source. The full archaeology: **Annex A §A.5**.

### 3.5 Was the found semantic defect real?

**Yes — and it is preserved in GitHub as a decision.** The Muse `Storefront` decided ownership locally;
`TelegramStarsPaymentProvider` trusted the client; `LabModifiers` applied permanent power from a client
flag. The defect class — *one operation id reused across a different subject, and the client applying a
foreign `branchId`/level locally* — is precisely what §8's fingerprint binding prevents. **The Muse
prototypes exhibit it; they must not be ported.**

Details: **Annex A**.

---

## 4. Rejected unsafe prototypes (must not be reused)

| Prototype | Where known | Why rejected | What we take instead |
|---|---|---|---|
| Muse `MetaWallet` | Muse patch #4 (absent); doc row 4 | A **local, client-editable balance** — a `localStorage` edit is free currency | Nothing. The "observation without authority" boundary is the correct pattern and is already contract-tested |
| Muse `Storefront` | Muse patch #8 (absent) | **The client decides ownership** — forged ownership = free cosmetics | Server catalog + server entitlement read model; the client renders |
| Muse `TelegramStarsPaymentProvider` | Muse patch #9 (absent) | **Trusted the client** on payment success | The server verifies `successful_payment`; the client only displays `payment_pending` |
| Muse `PaymentLedger` | Muse patch #12 (absent) | A client-side ledger is not a ledger — it is a number the client owns | An append-only Postgres `operations` table |
| Muse `LabState` / `LabModifiers` | Muse patch #4 (absent) | **Permanent power from a client flag** — paid prestige for free | The client sends an *intent* (`purchase branch/level`); the server computes the legal next level and grants it |
| Muse worker / D1 (patches #13–#16) | Muse patch files (absent) | Assumed a server ledger that **does not exist here**; schema versions 15/16 are unanchored | Re-derive against `ofeliya_pay` on the **existing Supabase Postgres** |
| Muse `storefront.variant` / `economy.lab` flags | Muse patch #3, dropped in OFELIYA | Feature flags are presentation-only; an economy flag is a client-side switch | No economy flags. Ever. `'events' in flags === false` stays |
| `stars_500` achievement id | `ClientCollection.ts` | **Name collision** with Telegram Stars | It is a kill-counter achievement; rename mentally |
| `coder_survival` refund path | `internalPayments.js` | **No Telegram call exists**; the route only flips the local rows, and *"item effects are deliberately NOT reversed"* — so a "refund" there means **money back, value kept** | The five-state refund machine with a durable outbox and a history-gated outcome (§13) |
| `coder_survival` "Stars — пока mock" purchases | `001_init.sql:52` | The intent was never proven against real Telegram | Take the schema, not the semantics; re-derive against §13 |

---

## 5. Authority model

### 5.1 The one rule

> **The client is never the authority for a paid entitlement or a paid balance.**
> The server is the only entity allowed to *conclude* that value was transferred.

Corollaries:

1. The client may **request** a SKU. It may not state a price, a level, a branch, a balance or an outcome.
2. The client may **send an idempotency key**. It may not choose what that key *means* — the server binds it.
3. The client may **render** a pending state. It may not render "unlocked" until the server says so.
4. A `successful_payment` update is a **claim from Telegram**, not a grant. The server verifies and grants.
5. If the server cannot reach its ledger, the purchase **fails closed**. It never "probably succeeded".

### 5.2 Authority boundaries per entity

**Currency**

| Class | v1 decision | Source of truth |
|---|---|---|
| Paid (Stars) | **External.** Telegram holds it. OFELIYA stores *amounts charged* in `operations.amount_stars` — an immutable receipt, not a balance | Telegram |
| Earned | **None.** No server-side spendable currency in v1 | n/a |
| Promotional | **None in v1.** If added later: server-derived from `operations` + `grants_log`, never client-settable | `ofeliya_pay` ledger |
| Server-side balance | **Deliberately absent in v1** (§1.3) | Deferred; if built, **derived** from the ledger, never a mutable counter |

> **Invariant:** `balance(user) = Σ ledger_entries(user)` if a wallet is ever introduced. No
> `UPDATE balances SET x = x + n`. This is why v1 avoids it.

**Purchase operation**

| Field | Authority | Notes |
|---|---|---|
| `opId` (idempotency key) | **Client-proposed, server-bound** | The server stores the binding fingerprint and rejects mismatches |
| `opFingerprint` | **Server** | `sha256(userKey \| opType \| sku \| amount \| entitlementTarget \| catalogVersion)` |
| invoice id | **Server** | `invoice_payload` is server-minted, ≤128 bytes, opaque to the client |
| `telegram_payment_charge_id` | **Telegram** | Stored UNIQUE — the external anchor |
| `provider_payment_charge_id` | **Telegram** | Nullable for Stars |
| SKU id | **Client may request; server resolves** | The server rejects unknown/disabled SKUs |
| user / `userKey` | **Server** | Derived from `validateInitData`; the client's claimed uid is never trusted |
| entitlement target | **Server** | Computed from the SKU + the current entitlement state |
| amount | **Server** | Recomputed from the catalog on every request |
| status | **Server** | State machine in §13 |
| `currency` | **Server** | Always `XTR`; a non-XTR `pre_checkout_query` is rejected |

**Entitlement**

| Class | Authority | v1 |
|---|---|---|
| Cosmetic (skin/palette) | **Server** — `ofeliya_pay.entitlements` | ✅ |
| Lab branch | **Server** | ✅ |
| Permanent stat (HP/damage/move/magnet/income) | **Server** | ⚠️ v1.1 — see §11.2 |
| Prestige | **Server** | ⚠️ v1.1 — cosmetic/prestige only, no combat effect |
| Restore state | **Server** | ✅ |
| Earned (achievement) cosmetic | Client-authoritative is acceptable | Shipped; it is *not* paid value |

**Refund**

| Field | Authority |
|---|---|
| requested · accepted | Server (operator/admin action) — recorded durably as a `REFUND_REQUESTED` operation |
| in flight | Server — `REFUND_PENDING`, held by a worker under a lease |
| **confirmed success** | **Telegram** — `refundStarPayment` returned `true`, **or** the Telegram history shows an outgoing transaction for that charge id ⇒ `REFUNDED` |
| **confirmed failure** | **Telegram** — the call returned `false` **and** the history shows no refund ⇒ `REFUND_FAILED` |
| **unknown outcome** | **Nobody knows** — a timeout, a lost response, a crashed worker ⇒ `REFUND_RECONCILE`. It is **never** recorded as a success or a failure |
| entitlement suspended | Server — `suspended_at` (temporary, for paid gameplay power during an unresolved refund, §13.3) |
| entitlement revoked | Server — soft-revoke (`revoked_at`, **permanent**); the ledger row is immutable |
| currency restored | Server — only if/when a wallet exists; in v1, "restored" = entitlement revoked |

**Reconciliation**

| Layer | Authority |
|---|---|
| Server state | **Authoritative** — `ofeliya_pay` |
| Telegram state | **Authoritative for money** — and **queryable**: the Bot API exposes `getStarTransactions`, the bot's own Telegram Star transaction history (§9.2, §9.5) |
| Client cached state | **Never authoritative.** A cache hint; the client must re-read from the server |

---

## 6. Threat model

Format: `attack/failure → expected invariant → required defense → test`.
`T#` unit · `I#` integration · `C#` contract · `E#` synthetic E2E · `R#` race.

| # | Attack / failure | Expected invariant | Required defense | Test |
|---|---|---|---|---|
| 1 | Duplicate purchase request (same opId, same params) | Exactly one operation, one grant, one charge | `UNIQUE(user_key, kind, op_id)`; fingerprint match → `200` replay | T4, I2, E2 |
| 2 | Same `opId`, **different SKU** | No second grant; request rejected | The fingerprint includes the SKU → mismatch → **`409 FAIL CLOSED`** | T4, R3 |
| 3 | Same `opId`, **different branch/level** | No second grant; request rejected | The fingerprint includes the *computed entitlement target*, not the client's word | T4, R3 |
| 4 | Same `opId`, **different user** | No cross-user leakage | `opId` is scoped by `user_key`; the unique index is `(user_key, kind, op_id)` | T4, R4 |
| 5 | Replay of an old successful response | No new grant | The operation exists → replay; `operations` is append-only so it cannot re-fire | T4, I2 |
| 6 | Response `branchId` mismatch vs the request | The client must not apply | The server returns the **authoritative** entitlement snapshot; the client compares and **ignores** a mismatch (renders nothing, re-fetches) | C2, E3 |
| 7 | Response SKU mismatch | The client must not apply | As #6 — the client never trusts response fields; it re-reads `/api/storefront/state` | C2 |
| 8 | Response `opId` mismatch | The client must not apply | As #6, plus the client aborts the pending flow | C2 |
| 9 | Client retries after a timeout | No double charge, no double grant | Same opId + same params → replay; `telegram_payment_charge_id UNIQUE` blocks a second charge row | I2, E3 |
| 10 | Server committed, client timed out | The user is not charged without delivery | Replay returns `ENTITLED` + the entitlement; the client converges. The **charge-without-delivery guard** fulfils rather than drops (port `alertPaymentWhileDisabled`) | E3, I4 |
| 11 | Telegram confirms twice | One operation, one grant | `UNIQUE(telegram_payment_charge_id)` | T3, R1 |
| 12 | Webhook duplicated | Idempotent no-op | As #11 | E2 |
| 13 | Webhook reordered (refund before purchase confirm) | A refund must not corrupt state | A refund requires a **terminal** purchase; an early refund is parked `REFUND_PENDING` and retried, never applied to a non-existent grant | R5 |
| 14 | Refund races with spend | No spend on a revoked entitlement | **v1 has no spendable currency** → class eliminated. If a wallet is added: a spend is refused when `entitlements.revoked_at IS NOT NULL` | R6 |
| 15 | Refund races with purchase | No double-grant, no lost refund | `pg_advisory_xact_lock(userId)` serializes both paths; the refund waits | R7 |
| 16 | Purchase races with purchase (different SKUs) | Both or neither — never one | The same advisory lock; distinct `opId`s → distinct operations | R8 |
| 17 | Balance update lost | *(eliminated in v1)* | If a wallet exists: derive from the ledger, never increment a counter | n/a (v1) → T7 (later) |
| 18 | Stale client cache | The client never shows a false entitlement | The client renders from `/api/storefront/state`; the cache is display-only; a purchase completion forces a re-read | C3, E4 |
| 19 | Two browser/device sessions | One grant, one charge | Server-side idempotency + the advisory lock; the second session sees the same entitlement on re-read | R9 |
| 20 | Offline / reconnect | No phantom unlock | On reconnect the client re-reads server state; local storage holds no paid entitlement | C3, E4 |
| 21 | Malicious `localStorage` edit | Zero effect on paid value | The paid entitlement lives **only** server-side; the client copy is decorative | T8, C1 |
| 22 | Forged client entitlement | Rejected | The server never accepts an entitlement from the client; it is a derived read model | T8, C1 |
| 23 | Forged price | Rejected | The server recomputes the amount from the catalog; `SuccessfulPayment.total_amount` must equal the server's amount | T5, I5 |
| 24 | Forged currency | Rejected | Only `XTR` is accepted; `decidePreCheckout` rejects anything else | T5 |
| 25 | Reordered API responses | No stale application | Every state-changing response carries the operation id + a monotonic `stateVersion`; the client discards an older response | C3 |
| 26 | Rollback after a server success | The grant survives | The grant lives in Postgres `ofeliya_pay`, not in the client save; a client rollback re-reads and re-converges | C3, E4 |
| 27 | Server crash between the ledger write and the entitlement write | No half-grant | **One DB transaction** covering the operation insert + the entitlement upsert (§13) | I1, R10 |
| 28 | Bot restart between `pre_checkout_query` and `successful_payment` | No orphan grant | The intent row is `PENDING`; fulfillment is driven by the `successful_payment` update alone | I4 |
| 29 | An operator replays an old `invoice_payload` | No second grant | `invoice_payload` carries the op id; the operation is terminal → replay, no new grant | T4, E2 |
| 30 | An operator mis-runs a reconcile repair | No silent mutation | Repairs are **manual, audited and idempotent** (§14.4) | I6 |

### 6.1 Residual risks that do not disappear with good code

| Risk | Why it survives | Mitigation |
|---|---|---|
| **Chargeback / dispute** | Telegram documents it: *"if the buyer initiates a chargeback with the relevant payment provider … the funds may be debited from your balance. This is outside of Telegram's control."* | Fulfill on `successful_payment`, not on final settlement; keep `raw_payload`; define a revocation path (§13.7) |
| **Supabase Free pausing the project** | `deploy/RENDER.md`: *"Supabase Free may pause inactive projects."* A paused project makes the ledger unreachable → purchases **fail closed**, so revenue dies but nothing is mis-sold | Move off the Free tier **before** real money (§23.3) |
| **Render Free sleeping after 15 idle minutes** | Same document | A sleeping server can blow the 10-second `pre_checkout_query` deadline → the payment path needs a **non-sleeping host** |
| **Single-process lock semantics** | `withProfileLock` is in-memory | Use `pg_advisory_xact_lock` (DB-wide) for every money path |
| **Entitlement-grant ≠ value-delivered** | The game is client-side; a granted entitlement can be "used" before the server sees it | Acceptable for cosmetics. **For paid permanent power, the grant must be re-read at run start** (§11.2) |

Full per-row detail, the idempotency contract and the complete race matrix: **Annex B**.

---

## 7. Idempotency contract

### 7.1 The key

```
opId = client-proposed, opaque, /^[A-Za-z0-9_-]{16,64}$/
       (the same shape OFELIYA already uses for submissionId)
```

### 7.2 The binding

The server computes and stores:

```
opFingerprint = sha256(
    userKey            # server-derived from validated initData
  | opType             # "PURCHASE" | "REFUND"
  | sku                # server-resolved sku id
  | amountStars        # server-computed
  | entitlementTarget  # server-computed, e.g. "lab.branch.magnet.level.3"
  | catalogVersion     # pins the price to the catalog version used
)
```

Bound to all five required dimensions — **user · operation type · subject/SKU · amount · entitlement
target** — plus `catalogVersion`, which pins the price so a later catalog edit cannot silently
reinterpret an old operation.

### 7.3 Repeat semantics

| Situation | Response | Code |
|---|---|---|
| New `opId`, no prior row | Create the operation | `202` (intent) |
| Same `opId`, **same fingerprint**, non-terminal | The current operation state (pending) | `200` |
| Same `opId`, **same fingerprint**, terminal | The stored result + the authoritative snapshot | `200` |
| Same `opId`, **different fingerprint** | **Reject. Do not return the previous success.** | **`409` `IDEMPOTENCY_KEY_REUSE`** |
| The same `telegram_payment_charge_id`, any `opId` | A second charge → already recorded | `200` replay (of the original) |
| The same charge id with a different `opId`/fingerprint | A conflict — impossible in practice; must alert | `409` `CHARGE_ID_CONFLICT` |

> **The fail-closed rule, stated once:** a repeated idempotency key whose parameters differ **must never**
> return success or a duplicate of the earlier operation. It returns `409` and changes nothing.

This is not new to OFELIYA — it is the `submissionId` / `submissionHash` contract from `server/index.mjs`
(`33d8ba12d5`), generalised.

### 7.4 Two keys, two purposes — do not conflate them

| Key | Origin | Purpose | Uniqueness |
|---|---|---|---|
| `opId` | Client-proposed | Idempotent **retry** of one logical intent | `UNIQUE(user_key, kind, op_id)` |
| `telegram_payment_charge_id` | Telegram | The **money** identity; a second charge for it is a bug or an attack | `UNIQUE(telegram_payment_charge_id)` |

A purchase is complete when **both** are recorded. Either alone is insufficient: `opId` alone could be a
retry; `charge_id` alone could be a forwarded invoice paid by someone else.

### 7.5 HTTP semantics

| Code | Meaning |
|---|---|
| `202` | The intent is accepted; an invoice must be presented. The body carries the server-minted `invoice_payload` and the amount |
| `200` | An idempotent replay of a known operation (the same fingerprint) — the same shape as the original response, plus `replayed: true` |
| `409` | Idempotency-key reuse with different parameters, a one-time-SKU conflict, or a charge-id conflict |
| `400` | A malformed request (a bad `opId` shape) |
| `401` / `403` | A missing or invalid `initData` signature |
| `404` | An unknown or disabled SKU |
| `410` | The offer expired (the intent TTL) |
| `422` | A valid request, an unsatisfiable state (already maxed, prerequisites unmet) |
| `429` | Rate limited |
| `503` | The ledger is unreachable → **fail closed**; the user is not charged and no entitlement is granted |

**`503` is the critical one.** If the financial store is unavailable, the purchase must not proceed. The
client shows a retry, and **no invoice is presented**.

---

## 8. Ledger architecture

### 8.1 Decision

**An append-only operation ledger + a materialized current-state read model, in the existing Supabase
Postgres. Not event sourcing.**

| Criterion | Append-only ledger | Event sourcing | Mutable counter row |
|---|---|---|---|
| Auditability of money | ✅ every state change is a row | ✅ | ❌ history lost |
| Idempotency for free | ✅ `UNIQUE` on the external id | ⚠️ needs projection logic | ❌ |
| Implementation cost at OFELIYA's scale | ✅ one table + an index set | ❌ overkill | ✅ |
| Refund modelling | ✅ a refund is a new operation referencing the original | ✅ | ❌ |
| Recovery from a bad projection | ✅ rebuild from the ledger | ✅ | ❌ |
| Fit with the existing stack | ✅ the same Postgres, the same RPC pattern | ❌ | ⚠️ |

OFELIYA is a single small game with a modest user base. **Event sourcing would be architecture for its
own sake.** The ledger is not an event log — it is a table of *operations*, each a business event with a
durable identity.

### 8.2 Transaction boundaries

**One Postgres transaction** covers the entire money mutation:

```
BEGIN;
  -- 1. lock the user (serializes all money paths for this user)
  SELECT pg_advisory_xact_lock(hashtextextended(user_key, 0));
  -- 2. idempotency check
  SELECT * FROM ofeliya_pay.operations
    WHERE user_key=$1 AND kind='PURCHASE' AND op_id=$2 FOR UPDATE;
      -- missing          -> continue
      -- found, same fp   -> ROLLBACK; return the stored result (replay)
      -- found, other fp  -> ROLLBACK; 409
  -- 3. charge-id check
  SELECT 1 FROM ofeliya_pay.operations WHERE telegram_payment_charge_id=$3;
  -- 4. INSERT operation   (UNIQUE violations -> mapped to 409/replay)
  -- 5. UPSERT entitlement
  -- 6. INSERT grant/audit row
COMMIT;
```

Everything that must be atomic — the operation row, the entitlement, the audit row — is in the same
transaction. The **only** thing outside a transaction is the Telegram API call for a *refund* (§13.4),
because a network call must not hold a row lock — and because a network call inside a transaction would
make the external side effect and the local record share a fate.

### 8.3 Unique constraints (the heart of the design)

| Constraint | Purpose |
|---|---|
| `operations.telegram_payment_charge_id UNIQUE` | One Telegram charge → one operation. Blocks double-credit on a duplicated webhook |
| `operations (user_key, kind, op_id) UNIQUE` | One logical intent per user. Blocks duplicate grants on a retry |
| `operations.op_fingerprint` (stored, indexed with `user_key`) | Detects key reuse with different parameters → `409` |
| `entitlements (user_key, entitlement_key) PRIMARY KEY` | One row per entitlement → an entitlement is a *state*, not a log |
| `catalog_sku.sku PRIMARY KEY` | The catalog is the only SKU namespace |
| A partial unique index for one-time SKUs | The DB-level one-time guard (below) |
| `operations (parent_operation_id) WHERE kind='REFUND' AND status IN ('REFUND_REQUESTED','REFUND_PENDING','REFUND_RECONCILE')` | **At most one non-terminal refund per purchase** — this is what makes a repeated refund command a no-op instead of a second Telegram call (§13.6) |

**One-time SKU guard** (ported in spirit from `coder_survival` migration `060`):

```sql
CREATE UNIQUE INDEX uq_ofeliya_one_time_sku
  ON ofeliya_pay.operations (user_key, sku)
  WHERE kind = 'PURCHASE'                       -- a REFUND row names the same sku; it must not hold the slot
    AND sku IN (/* server-side list of one-time SKUs */)
    AND status IN ('PENDING','ENTITLED','LATE');
```

> The `kind = 'PURCHASE'` filter is **load-bearing**, not cosmetic. A refund operation carries the sku it
> refunded; without the filter the refund row would keep occupying the one-time slot and a refunded
> purchase would **not** be re-buyable — exactly the opposite of the rule below.

The list must come from the catalog (`catalog_sku.one_time_per_user`), not a literal in the index —
implement it as a catalog-driven trigger, or accept a literal list for v1 (a handful of SKUs) and
document it as a v1 compromise.

> *"A refunded purchase frees the slot again (deliberate: refund = can rebuy)"* — `coder_survival`
> migration `060`. Adopt the same rule.

### 8.4 Balance derivation

**v1: no balance.** Stars is external; entitlements are not spendable.

If a wallet is ever added (v2+):

```
balance(user, currency) = Σ operations(amount_signed)
                           WHERE user_key = $1 AND status IN ('ENTITLED')
```

There is no `balances` table with a mutable `amount` column. A materialized balance may be added as a
**cache**, but it must be reconstructible from the ledger and must never be the source of truth.

### 8.5 Entitlement derivation

`entitlements` is materialized (a current-state table), written **only** by the transaction in §8.2 and
the refund transaction in §13.4. It is also derivable from `operations` — and the reconcile job (§14)
must be able to prove the two agree.

```
entitlement(user, key) = the level of the latest non-revoked
                          entitlement-granting operation for (user, key)
```

### 8.6 Refund representation

A refund is **a new operation row** (`kind='REFUND'`, `parent_operation_id` → the purchase), *plus* a
status transition on the original purchase row and a soft-revoke on the entitlement. The purchase's
`operations` row is never deleted — its `status` moves forward, never backward.

The refund operation carries its own `op_id` (the **refund operation id**), its own `op_fingerprint`, and the
**external anchor** `telegram_payment_charge_id` carried from the purchase. It is the durable record that a
Telegram call is *owed* — the **outbox** of the refund path (§13.4) — and it is what makes a repeated
refund command a no-op instead of a second call (§13.6).

The purchase's own status is **not** driven through the refund's intermediate states. The purchase stays
`ENTITLED`/`LATE`; the refund's lifecycle lives entirely on the refund operation row. This is what keeps
"the status moves forward, never backward" true for the purchase while allowing the refund to move
*back* from `REFUND_FAILED` (a new attempt) — as a **new operation**, never as a rewrite.

### 8.7 Reconcile representation

Findings are **rows**, not log lines:
`ofeliya_pay.reconcile_findings(finding_key UNIQUE, kind, operation_id, detail JSONB, first_seen_at,
resolved_at, resolution)`. Repeat runs are idempotent via `finding_key`.

Two more tables belong to the reconciliation:

| Table | Purpose | The key constraints |
|---|---|---|
| `telegram_transactions` | the **mirror** of the bot's Star transaction history — source **A** (§14.1) | `PRIMARY KEY (tx_key)` — `sha256(id ‖ direction ‖ amount ‖ date)`; **not** the id alone, because a refund shares its original's id; a `UNIQUE (tx_id, direction)`; an index on `(direction, tx_date)` |
| `telegram_scan_checkpoint` | the durable scan position | one row per bot; `last_offset`, `last_date`, `last_tx_key`, `mode` (`INCREMENTAL` / `FULL`), `last_scan_at` |

The mirror is what makes the reconciliation **evidence-based** rather than opinion-based: a finding cites a
mirror row, and the mirror row cites a Telegram transaction id that an operator can verify independently.

### 8.8 Why NOT the existing `ofeliya_private.state` JSONB blob

The current durable-state store rewrites the **entire document** on each flush, guarded by a revision and
a single writer. Fine for scores and profiles. **Not acceptable for money**:

- A whole-document rewrite means a money mutation rewrites unrelated rows → a larger blast radius and a
  larger conflict window.
- There is no way to express `UNIQUE(telegram_payment_charge_id)` in it.
- The revision conflict model is **last-writer-wins at document level**; concurrent purchases for
  different users would collide on the same document.
- `last_commit` + payload equality gives *document-level* idempotency, not per-charge idempotency.

**Decision:** `ofeliya_pay` lives beside `ofeliya_private` in the same Supabase project, accessed through a
new RPC in the same style. The state blob and the money tables are never written in the same transaction.

Full DDL: **Annex C**.

---

## 9. Telegram Stars

### 9.1 Division of responsibility

**Telegram owns** — the invoice UI and the Stars balance; `XTR` as the only currency for digital goods;
`telegram_payment_charge_id`; `refundStarPayment(user_id, telegram_payment_charge_id)` → `true`; the
10-second `pre_checkout_query` deadline; chargeback handling; and the **test environment**.

**OFELIYA server owns** — minting the `invoice_payload` (≤128 bytes) and binding it to a server
operation; answering `pre_checkout_query` **within 10 seconds** with the amount re-read from the server
catalog; verifying `successful_payment` (`currency === 'XTR'`, `total_amount === operations.amount_stars`,
the payload resolves to a live `PENDING` operation owned by this user); idempotency (§7); the ledger, the
entitlement grant, the refund record and the reconciliation; and **failing closed** when the ledger is
unreachable.

**Client owns** — initiating the UI; showing `PENDING` / `PAID` / `ENTITLED` / `REFUNDED` exactly as the
server reports them; requesting authoritative state and rendering it. **Never** deciding that a payment
succeeded.

### 9.2 Verified API facts (fetched from `core.telegram.org`)

| Method / object | Verified facts |
|---|---|
| `sendInvoice` | `payload` = **1–128 bytes**, bot-defined, not shown to the user; `provider_token` = **empty string for XTR**; `currency` = `"XTR"`; `prices` = **exactly one `LabeledPrice` for XTR**; `max_tip_amount` / `suggested_tip_amounts` **not supported for XTR**; `need_name`, `need_phone_number`, `need_email`, `need_shipping_address`, `send_phone_number_to_provider`, `send_email_to_provider`, `is_flexible` are **ignored for XTR**; `title` 1–32 chars; `description` 1–255 chars; `start_parameter` controls the forward behaviour |
| `createInvoiceLink` | the same as above plus `subscription_period` — **must be `2592000`** (30 days), the currency must be `XTR`, the subscription price **must not exceed 10000 Stars**, and multiple concurrent subscriptions per user are allowed. `business_connection_id` is **XTR-only** |
| `SuccessfulPayment` | `currency`, `total_amount`, `invoice_payload`, `subscription_expiration_date`, `is_recurring`, `is_first_recurring`, `shipping_option_id`, `order_info`, **`telegram_payment_charge_id`**, `provider_payment_charge_id` |
| `PreCheckoutQuery` | `id`, `from`, `currency`, `total_amount`, `invoice_payload`, `shipping_option_id`, `order_info` |
| `refundStarPayment` | `user_id` (Integer, **required**), `telegram_payment_charge_id` (String, **required**) → returns `true` on success. Added in **Bot API 7.4** (May 28, 2024) |
| **`getStarTransactions`** | *"Returns the bot's Telegram Star transactions in chronological order. On success, returns a StarTransactions object."* · `offset` (Integer, Optional) — *"Number of transactions to skip in the response"* · `limit` (Integer, Optional) — *"The maximum number of transactions to be retrieved. Values between 1-100 are accepted. Defaults to 100."* · Added in **Bot API 7.5** (June 18, 2024) |
| **`StarTransaction`** | `id` (String) — *"Unique identifier of the transaction. **Coincides with the identifier of the original transaction for refund transactions.** Coincides with `SuccessfulPayment.telegram_payment_charge_id` for successful incoming payments from users."* · `amount` (Integer) — *"Integer amount of Telegram Stars transferred by the transaction"* · `nanostar_amount` (Integer, Optional, **Bot API 8.1**, Dec 4 2024) — *"The number of 1/1000000000 shares of Telegram Stars transferred by the transaction; from 0 to 999999999"* · `date` (Integer, Unix time) · `source` (TransactionPartner, Optional) — *"Source of an incoming transaction (e.g., a user purchasing goods or services, Fragment refunding a failed withdrawal). Only for incoming transactions."* · `receiver` (TransactionPartner, Optional) — *"Receiver of an outgoing transaction (e.g., **a user for a purchase refund**, Fragment for a withdrawal). Only for outgoing transactions."* |
| **`StarTransactions`** | `transactions` (Array of `StarTransaction`) |
| **`TransactionPartnerUser`** | `type` = `"user"` · `transaction_type` — one of `"invoice_payment"` \| `"paid_media_payment"` \| `"gift_purchase"` \| `"premium_purchase"` \| `"business_account_transfer"` · `user` (User) · **`invoice_payload` (String, Optional, added in Bot API 8.0, Nov 17 2024)** — *"Bot-specified invoice payload. **Can be available only for "invoice_payment" transactions**"* · `subscription_period` (Integer, Optional) · `affiliate` (AffiliateInfo, Optional) |
| **`getMyStarBalance`** | *"A method to get the current Telegram Stars balance of the bot. Requires no parameters. On success, returns a StarAmount object."* — added in **Bot API 9.1** (July 3, 2025) |
| Docs | *"Your bot must reply using answerPreCheckoutQuery within 10 seconds after receiving this update or the transaction is canceled."* |
| Docs | *"You must always check that you received a successful_payment update before delivering the goods or services purchased by the user."* |
| Docs | *"It is critical to make sure your bot only accepts multiple payments when the order can be processed correctly."* (the multi-chat / inline invoice warning) |
| Docs | *"Store the SuccessfulPayment's telegram_payment_charge_id – it may be needed to issue a refund in the future."* |
| Testing | *"You can freely test payments in Telegram Stars by connecting your bot to Telegram's dedicated test environment."* |
| Live checklist | `/terms` and `/support` commands; *"Use backups to make sure that you don't lose data about your users' payments."*; *"You as the bot owner have full responsibility in case any conflicts or disputes arise. You must be prepared to correctly process disputes and chargebacks."* |

> Sources: `https://core.telegram.org/bots/payments-stars`, `…/payments-stars.md`,
> `…/bots/api/methods/{sendinvoice,createinvoicelink,refundstarpayment,getstartransactions}.md`,
> `…/bots/api/types/{successfulpayment,precheckoutquery,startransaction,startransactions,transactionpartneruser}.md`,
> `…/bots/api-changelog` (the version history of every field cited above).
> Field names quoted verbatim. The Bot API version current at the time of writing is **10.3 (August 24, 2026)**.

### 9.2.1 The transaction-history facts, in full

> **This subsection corrects a material factual error carried by the first revision of this package.**
> The first revision asserted: *"Telegram provides no API to list a bot's payments. There is no 'list my
> transactions' method."* **That assertion was wrong.** `getStarTransactions` has existed since
> **Bot API 7.5 (June 18, 2024)** and returns exactly the list the first revision said did not exist.
> Everything below is quoted or paraphrased from the official Telegram documentation.

| # | Question | The verified answer |
|---|---|---|
| 1 | **Which transactions does it return?** | The **bot's own** Telegram Star transactions, in both directions. *Incoming* (`source` set): a user purchasing goods or services, or Fragment refunding a failed withdrawal. *Outgoing* (`receiver` set): a refund to a user for a purchase, or a withdrawal to Fragment. Nothing belonging to another bot is included. |
| 2 | **Is there pagination?** | Yes — but it is **positional skip pagination, not a server-issued cursor**. `offset` = *"Number of transactions to skip in the response"*; `limit` = *"The maximum number of transactions to be retrieved. Values between 1-100 are accepted. Defaults to 100."* There is **no** `date`/`since` filter and **no** opaque cursor token in the Bot API. |
| 3 | **How are operations identified?** | By `StarTransaction.id` (String) — *"Unique identifier of the transaction."* For a successful incoming payment it **coincides with `SuccessfulPayment.telegram_payment_charge_id`**; for a refund it **coincides with the identifier of the original transaction**. ⚠️ Therefore `id` alone identifies the *money*, not the *transaction*: a charge and its refund share one id. The direction (`source` vs `receiver`) plus the amount and the date are needed to tell them apart (§14.2, R10 — the dedupe key). |
| 4 | **How are inbound payments represented?** | `source` = `TransactionPartnerUser` with `transaction_type = "invoice_payment"`, carrying `user` (the payer) and — since Bot API 8.0 — **`invoice_payload`**, the bot-specified payload, *"Can be available only for 'invoice_payment' transactions"*. |
| 5 | **How are refunds represented?** | As an **outgoing** transaction: `receiver` = `TransactionPartnerUser` (the refunded user), the **same `id`** as the original charge, the refund amount, and the refund date. The Bot API type carries **no** `refund` flag and **no** `original_transaction_id` — the shared `id` *is* the link. (The MTProto equivalent `starsTransaction` **does** carry a `refund` flag, and `inputStarsTransaction` carries a `refund` flag for its by-id lookup.) |
| 6 | **Can the original payment be found by `telegram_payment_charge_id`?** | **Yes.** For a successful incoming payment `StarTransaction.id` *is* the `telegram_payment_charge_id`, so a stored charge id is directly resolvable against the transaction history by scanning. |
| 7 | **Which fields are usable for reconciliation?** | `id` · `amount` · `nanostar_amount` (fractional Stars) · `date` · the direction (`source` / `receiver`) · and, for `invoice_payment`, `source.user.id` (the payer) and **`source.invoice_payload`** (the bot-specified payload — the subject-recovery hook, §17). |
| 8 | **Are there temporal or historical limits?** | **The Bot API documentation states none.** There is no retention statement, no date filter and no cap on how far back the history reaches; the only documented bound is `limit ≤ 100` per page. ⇒ **Treat history completeness as an assumption to be *verified in the test environment* (§18.5 R-T7), never as a documented guarantee.** |
| 9 | **Is it sufficient for full ledger reconstruction?** | **No — not by itself.** It supplies the *external money facts* (who paid, how much, when, whether it was refunded). It cannot say *which local operation* a payment belongs to unless the `invoice_payload` encodes the intent (§17), and it says nothing about what the user was actually given. Full reconstruction = the Telegram facts **matched against** the local ledger **and** the entitlement read model (§14.1). |
| 10 | **What does it NOT guarantee?** | (a) no documented completeness/retention guarantee; (b) **no per-transaction lookup by id** in the Bot API — list-and-filter only; (c) `refundStarPayment` returns a bare boolean, with **no error taxonomy**; (d) **no chargeback event** — an Apple/Google chargeback is only visible as a balance effect (*"the refunded Stars will be deducted from the bot's balance. This is outside of Telegram's control"*); (e) **no server-issued cursor** — a durable checkpoint is our own construction (§14.7); (f) `nanostar_amount` allows fractional Stars, so an exact integer amount comparison needs a tolerance; (g) the Bot API never explains *why* a refund failed. |

### 9.3 The flow

```
client                OFELIYA server                         Telegram
  │ POST /api/storefront/purchase {opId, sku}
  │────────────────────────────────▶ validate initData → userKey
  │                                  resolve SKU → amount, target
  │                                  fingerprint(opId)
  │                                  BEGIN; lock user; INSERT operation(PENDING)
  │◀──────────── 202 {opId, invoice_payload, amount, currency:'XTR'}
  │ open the invoice UI
  │──────────────────────────────────────────────────────▶ sendInvoice(XTR)
  │◀────────────────────────────────────────────────────── pre_checkout_query
  │                                  ◀────────────────────── (within 10s)
  │                                  re-read the catalog → answerPreCheckoutQuery(true|false)
  │◀────────────────────────────────────────────────────── successful_payment
  │                                  ◀──────────────────────
  │                                  verify currency + amount + payload
  │                                  BEGIN; lock user; INSERT operation(ENTITLED);
  │                                  UPSERT entitlement; COMMIT
  │ GET /api/storefront/state
  │────────────────────────────────▶ the authoritative snapshot
  │◀──────────── 200 {entitlements, purchases}
```

### 9.4 Two answers are required; only one is the grant

| Update | Meaning | Server obligation |
|---|---|---|
| `pre_checkout_query` | *"May I charge?"* | Answer **≤10s**. Re-answering `true` does **not** entitle. If the ledger is down → answer `false` with a human-readable reason (**fail closed** — do not start a charge that cannot be fulfilled) |
| `successful_payment` | *"The charge happened."* | **This** is where the entitlement is granted, in a transaction |

A charge that starts but cannot be fulfilled is a **charge-without-delivery** — the worst bug class in
this system. Therefore: if the ledger is unreachable at `pre_checkout_query` time, **reject the checkout**.
Do not accept and hope.

Storefront detail, the Lab progression design, refund and reconciliation design: **Annex D**.

### 9.5 Bot API vs MTProto — the capability matrix

Telegram exposes **two different API surfaces** for Stars. They are **not** interchangeable and they are
**not** the same capability set. OFELIYA is a **bot/server** architecture, so the rule is:

> **Prefer the Bot API. A design that *requires* an MTProto user session is out of scope by default.**
> MTProto may be added only as an explicitly-justified **operational / forensic** capability, with its own
> credentials scheme, and it must never be on the critical path of a purchase or a refund.

| Capability | Bot API | MTProto | Needed by OFELIYA? |
|---|---|---|---|
| **Receive a successful payment** | `successful_payment` update (webhook) | `updates` / the `MessageService` + `PaymentCharge` | **Yes — the Bot API.** It is the only path that carries `telegram_payment_charge_id`, `invoice_payload` and `total_amount` together |
| **Transaction history (the list)** | **`getStarTransactions`** — the bot's own history; `offset` (a skip count) + `limit` (1–100); *"in chronological order"* | `payments.getStarsTransactions` — *"Both users and bots can use this method"*; `peer` = *a bot we own*; `offset` is an **opaque string cursor** taken from the returned `next_offset`; flags `inbound` / `outbound` / `ascending` | **Yes — the Bot API.** MTProto is a *better-shaped* alternative (§9.5.1) but not a requirement |
| **Lookup one transaction by id** | ❌ **not available** — list-and-filter only | `payments.getStarsTransactionsByID` — **"Only users can use this method"** ⇒ **not available to a bot session either** | **No.** For a bot, neither surface offers a true by-id lookup ⇒ the architecture must scan-and-filter (§14.7) |
| **Refund** | `refundStarPayment(user_id, telegram_payment_charge_id)` → `true`/`false`; **no error taxonomy** | `payments.refundStarsCharge(user_id, charge_id)` — **"Only bots can use this method"**; **typed errors**: `CHARGE_ALREADY_REFUNDED`, `CHARGE_ID_EMPTY`, `USER_ID_INVALID`, `USER_BOT_REQUIRED` | **Yes — the Bot API.** MTProto's typed errors are the single most valuable optional upgrade (§9.5.1) |
| **Transaction status** | ✅ *implicit* — the direction of the entry in the history (`source` vs `receiver`) is the status | ✅ *explicit* — `starsTransaction` carries `refund`, `pending` and `failed` flags | **Yes — the Bot API**, via direction. The status is inferred, not declared |
| **Pagination** | `offset` (an **integer skip count**) + `limit` (1–100). **No server cursor, no date filter.** | `offset` is an **opaque string** obtained from the returned `next_offset`; `next_offset` is returned by `payments.starsStatus` | **Yes — the Bot API**, with the durability caveat in §14.7 |
| **Refund indication** | ✅ the refund appears as an **outgoing** transaction with the **same `id`** as the original charge and `receiver.type='user'` | ✅ the same, **plus** an explicit `refund` flag on `starsTransaction` | **Yes — the Bot API** |
| **Balance / history summary** | `getMyStarBalance` → a `StarAmount` (**Bot API 9.1**) | `payments.getStarsStatus` → `payments.starsStatus` (balance + the last 5 transactions); with `peer=inputPeerSelf` for the account | **Yes — the Bot API.** The balance is a **derived** signal, useful for detecting chargebacks (§14.2, R10) |
| **Access requirements** | A bot token only. **No `api_id`/`api_hash`, no phone-number login, no user session.** | `api_id` + `api_hash` + a session. A *bot* session is possible (a bot token over MTProto), but it is a **new credential class** that must be stored, rotated and audited like a production secret | **Bot API only** for v1 |
| **Chargeback visibility** | ❌ none per transaction — only the balance effect | ❌ none per transaction — the same balance effect | **Neither.** Procedural only (§14.2, R10) |

#### 9.5.1 What MTProto would add, and why it is *not* on the critical path

MTProto is genuinely better in **three** specific ways, and it is worth stating them precisely so the choice
is an argued one rather than a default:

1. **A durable cursor.** `payments.getStarsTransactions` returns `next_offset` — an **opaque server-issued
   string** — and the documentation says explicitly: *"Offset for pagination, obtained from the returned
   next_offset, initially an empty string"*. The Bot API's `offset` is an **integer skip count**, so a
   durable checkpoint built on it is *our* construction and depends on an append-only ordering assumption
   (§14.7). MTProto removes that dependency.
2. **A filterable history.** `inbound` / `outbound` / `ascending` flags. The Bot API has no filters — the
   scanner must fetch and classify every page itself.
3. **Typed refund errors.** `payments.refundStarsCharge` distinguishes `CHARGE_ALREADY_REFUNDED` from
   `CHARGE_ID_EMPTY` and `USER_ID_INVALID`. The Bot API returns a bare `false`. This matters directly: a
   repeated refund is **an error, not a harmless success**, and a bare boolean cannot tell "already
   refunded" from "refund failed" (§13.5).

**And it is worse in three ways, which is why it is deferred:**

1. **It is not a superset for bots.** `payments.getStarsTransactionsByID` is *"Only users can use this
   method"* — so the headline "look up one transaction" capability is **not** available to a bot on *either*
   surface. A bot that wants a by-id lookup must scan.
2. **It introduces a new credential class.** `api_id` + `api_hash` + a session file (or a bot token used over
   MTProto). That is a production secret with a different blast radius from the Bot API token, and it needs
   its own storage, rotation and audit story (§21.4).
3. **It buys nothing for the critical path.** The purchase path (`successful_payment`), the fulfillment
   path and the refund path are all satisfiable on the Bot API alone.

> **Decision (v1).** OFELIYA builds on the **Bot API only**. `getStarTransactions` is a **first-class
> dependency of the money system**, not an optional extra. MTProto is recorded as an **optional
> operational/forensic upgrade** (§22 Q11) with an explicit credential requirement, and **no Go/No-Go item
> may depend on it**. If a future requirement needs typed refund errors or a server-issued cursor, MTProto
> is added *alongside* — never *instead of* — the Bot API path.

---

## 10. Storefront

The Storefront is a **presentation layer over an authoritative catalog**. It is built last, so it cannot
be mistaken for the money system.

### 10.1 Rules

| Rule | Statement |
|---|---|
| Server price | `catalog_sku.price_stars`. The **only** price ever charged |
| Client price | **Informational.** Rendered from `/api/storefront/catalog`. May be stale by seconds |
| Price mismatch at settlement | The server compares `SuccessfulPayment.total_amount` to its own recomputed amount. A mismatch → **do not grant**, mark `PRICE_MISMATCH`, alert |
| Price changes | Bump `catalog_sku.version`. A new version does **not** alter existing operations (each operation stores the amount it was priced at) |
| Availability | `enabled = false` → not purchasable (`404`), but **still visible** in the catalog with `available: false` so the client can render "coming soon" |
| Sold out / capped | `409` (one-time) or `422` (level maxed) |
| Prerequisites | `422` with the missing prerequisite id, so the client can render it |
| Expired offer | `410` |

### 10.2 SKU migration (old → new)

Never mutate a SKU's meaning in place:

1. Create a **new SKU row** (a bumped `version`, or a new id).
2. Leave the old row `enabled = false`.
3. Link them with `catalog_sku.superseded_by`.
4. **Entitlements are keyed by `entitlement_key` + `level`, not by SKU.** A SKU rename or reprice does not
   invalidate an existing grant.

> This is the single most important schema decision: **entitlement identity ≠ purchase identity.** It is
> what makes refunds, re-pricing and SKU migration safe.

### 10.3 Localization, restore, pending UI

- **Localization** — the catalog carries server-provided `title`/`description` for the active locale, or
  keys the client resolves locally. **Prices are locale-independent** (Stars have no locale formatting);
  display as `⭐ N`. The client may localize the *description*; it may not localize the *price* or the *effect*.
- **Restore** — `POST /api/storefront/restore` is a **read**. It must not create, extend or mutate any
  entitlement. Safe to call repeatedly, from any device.
- **Pending UI** — `PENDING` → "Ожидание оплаты…"; `PAID` → "Оплата получена, выдаём…"; `ENTITLED` →
  success with the item highlighted; `REFUND_REQUESTED` / `REFUND_PENDING` → "Возврат в обработке"
  (**not** an error); `REFUND_RECONCILE` → "Возврат уточняется" — the outcome is genuinely unknown, and the
  client must **not** claim either that the money is back or that it is not; `REFUNDED` → "Возврат
  оформлен"; `REFUND_FAILED` → "Возврат не выполнен, покупка активна"; `FAILED`/`REJECTED` → a clear
  error; *(unknown/unreachable)* → **fail closed**: "не удалось подтвердить оплату" — **never** "оплачено".

  **The entitlement state the client renders** is a *separate* axis from the operation status:
  `revoked` (permanent), `suspended` (temporary — a refund is unresolved), `active`. A suspended entitlement
  is **not** revoked and **not** available: the client renders it as *temporarily unavailable*, and the
  server rejects any operation that depends on it (§13.3).

### 10.4 Error states

| Code | Client behaviour |
|---|---|
| `409 IDEMPOTENCY_KEY_REUSE` | "Этот запрос уже использован с другими параметрами." — do not auto-retry |
| `409 ONE_TIME_ALREADY_OWNED` | "Уже приобретено." — re-read the state and show the owned item |
| `404 SKU_UNAVAILABLE` | Hide/disable the buy button |
| `422 ENTITLEMENT_MAXED` | "Максимальный уровень достигнут." |
| `422 PREREQUISITE_MISSING` | Show the prerequisite |
| `410 OFFER_EXPIRED` | "Предложение истекло." — offer a refresh |
| `503 LEDGER_UNAVAILABLE` | "Платёж временно недоступен. Попробуйте позже." — **and issue no invoice** |

Full catalog schema and endpoint contracts: **Annex C**.

---

## 11. Permanent Lab progression

The highest-risk game layer. The existing Lab is **informational only** (*"Урон, здоровье, скорость и
награды не меняются."*) and that boundary is enforced by `scripts/check-muse-collection.mjs`.

### 11.1 Three tiers

| Tier | Definition | Authority | v1 |
|---|---|---|---|
| **Safe informational Lab** | What exists today: 3 branches, no effect, no write | client presentation | ✅ shipped |
| **Earned progression** | Earned in-game, not paid | client/server (existing) | ✅ shipped |
| **Paid permanent progression** | Permanent stat/power bought with Stars | **server** | ⚠️ v1.1 — see §11.2 |

### 11.2 The ordering risk (why paid power is v1.1, not v1)

A paid permanent stat changes **gameplay**, which means:

- It becomes a **balance** problem, not just plumbing.
- It can be **spent** in a run → a refund creates a "power without payment" or "payment without power" window.
- It interacts with the **seeded-duel / trusted-score** contract: a player with paid power and a player
  without are not comparable. `server/index.mjs` already separates *Strained* from *Standard* ranking
  (PR #43) for exactly this class of reason.

**Recommendation:** v1 ships **paid cosmetics + a non-combat permanent Lab branch** (a collection branch, a
badge, a prestige tier). Paid **combat power** (HP / damage / movement / magnet / income) waits until:

1. the ledger has run in production with real money for a defined soak period, **and**
2. a ranking policy separates paid-power players from free players, **and**
3. a refund semantics decision is made: *does a refund remove power the player already used?* (it cannot —
   so either the power is non-combat, or refunds of used power are impossible by design).

**If combat power must ship**, the grant must be **re-read at run start** and `paid_power_used_at` recorded
on the score, so ranked play can be partitioned.

### 11.3 Per-parameter specification

| Question | Rule |
|---|---|
| Server representation | `entitlements(user_key, entitlement_key='lab.<param>')` → `level integer`, `source_operation_id`, `granted_at`, `revoked_at` |
| Validation | The server computes the legal next level from the current level. **The client never sends `newLevel`.** |
| Max level | `catalog_sku.max_level` (and `max_level_per_user` for repeatable purchases) |
| Pricing | `catalog_sku.price_stars` per level; a *level-up* SKU prices the **next** level, not an arbitrary one |
| Prerequisite graph | `catalog_sku.prerequisite_sku`; the server checks the whole chain |
| Refund behaviour | Soft-revoke the entitlement row; **the ledger row is never deleted**; an already-consumed effect is not clawed back (a documented, accepted asymmetry) |
| Downgrade behaviour | On refund, the entitlement reverts to the highest level that is still paid-for. Refunding level 3 while levels 1–2 remain paid → level 2 |
| Save compatibility | The client save stores **nothing** that grants power. It may cache the last known level, refreshed from the server on every run start |
| Gameplay application point | The server-granted level is fetched at run start and passed into the run as read-only state; the run must not be able to mutate it |
| The fingerprint's entitlement target | `lab.<param>.level.<N>` — so the same `opId` cannot be reused for a different level |

### 11.4 The client protocol (intent, not state)

```
❌ FORBIDDEN                            ✅ REQUIRED
POST {branch:'magnet', newLevel:7}      POST {opId:'...', sku:'lab.magnet.level.up'}
                                         → server: lock user → read the current level
                                         → validate max/prereq/price
                                         → the fingerprint binds to lab.magnet.level.7
                                         → charge → grant the level
```

The server computes "the next legal level" and prices *that*. The client cannot ask for level 7 — it can
only ask to **advance**, and the server decides by how much.

### 11.5 What is not paid permanent power

None of these may be sold in v1 or v1.1:

- Anything that alters a **ranked** score's comparability without partitioning (§11.2).
- Anything that can be **bought twice** and stacked without a cap.
- Anything enforced **client-side only** (the entire Muse `LabModifiers` failure mode).

---

## 12. Transaction design — the critical purchase

| # | Step | Inside the DB tx? | Fails how |
|---|---|---|---|
| 1 | **Validate the user** — `validateInitData(initData)` → `userKey` | ✗ (before) | `401`/`403` |
| 2 | **Validate the SKU** — a `catalog_sku` lookup + an `enabled` check | ✗ (before) | `404` |
| 3 | **Validate the current entitlement** — read `entitlements` for the target key | ✗ (before; re-read inside) | `422` |
| 4 | **Validate idempotency** — the `opId` shape; the fingerprint; the existing operation lookup | **yes** | `400` / `409` |
| 5 | **Verify the external payment** — `successful_payment`: `currency === 'XTR'`, `total_amount == the server amount`, the payload → a live `PENDING` operation owned by this user | ✗ (before) | `409` / `422` |
| 6 | **Create the immutable operation** — `INSERT operations` (`kind='PURCHASE'`) | **yes** | `409` on a unique violation |
| 7 | **Grant the entitlement** — `UPSERT entitlements` + `INSERT grants_log` | **yes** | rollback |
| 8 | **Commit** | — | — |
| 9 | **Return the authoritative snapshot** | — | — |

**Steps 4, 6 and 7 are in one transaction.** Steps 1–3 and 5 are reads that happen before and are
*re-verified* inside the transaction (step 3) — but the money-bearing writes (6, 7) are atomic.

### 12.1 The 10-second constraint

`pre_checkout_query` must be answered within 10 seconds, so that rules out any DB path that can block:

- The handler must **not** take the user advisory lock or contend on the operations table.
- It must read the catalog and the operation row with a **short, bounded** query and a hard timeout
  (e.g. 3s), then answer.
- If the ledger is slow or unreachable → answer `false` (**fail closed**).
- A sleeping host (Render Free sleeps after 15 idle minutes) will blow the deadline. **The payment path
  needs a non-sleeping host** (§23.3).

---

## 13. Refund design

### 13.1 The adversarial review of *"revoke first"*

The first revision of this package proposed:

> **revoke the entitlement → call `refundStarPayment` → on `false` mark `REFUND_FAILED`, and leave the
> entitlement revoked.** *"Fail toward under-delivery."*

The underlying instinct — **a refunded user must not keep a live entitlement** — is correct and is
preserved. The **implementation** does not survive an adversarial review.

| # | The defect | Why it matters |
|---|---|---|
| 1 | **"Fixable" is false in the design as written.** The ledger is append-only and a status *"moves forward, never backward"* (§8.6); the entitlement carries `revoked_at` and there is **no un-revoke path**. A crash between the revoke and the Telegram call therefore leaves a **permanently** revoked entitlement with **no supported way to restore it** | the "safe" direction is not merely inconvenient — it is **irreversible**. The failure the design calls *fixable* is not fixable at all |
| 2 | **A `false` and a lost response are indistinguishable.** `refundStarPayment` returns a bare boolean. A timeout, a dropped response, a proxy error and a genuine refusal all look like `false`. The original mapped **all** of them to `REFUND_FAILED` + revoked | the system would **routinely** revoke a user's paid value while their money was in fact returned — money taken, value gone, no record of what happened. This is the worst outcome in the catalogue |
| 3 | **"Under-delivery is safe" holds only when the failure is cheap to undo.** Here the undo path does not exist, and the "un-delivery" is permanent paid value | the asymmetry the original relied on is not present. Failing toward under-delivery is a principle about *recoverability*, not about optimism |
| 4 | **The re-issue advice was wrong.** The first revision's runbook said: *"Re-issue the refundStarPayment (it is idempotent from the user's perspective: the money is either returned or not)."* A repeat call is **not** a harmless success. The Bot API returns a bare `true`/`false` with **no idempotency contract**, and the MTProto counterpart `payments.refundStarsCharge` has a typed error **`CHARGE_ALREADY_REFUNDED`** — Telegram explicitly distinguishes *"already refunded"* from *"refunded"* | a repeat call may return `false` and drive the machine down the **failure** branch, or be misread as *"not refunded"* while the money **was** returned. **A repeat call is not a safe probe** |
| 5 | **The external call was inside the transaction boundary in the shape that was being reacted to.** The original's own §13.1 pseudocode shows the Telegram call *outside* the `BEGIN…COMMIT` but the state update *after* it was a bare `UPDATE` — no lease, no `WHERE status='REFUND_PENDING'` guard, and no recovery path for a lost response | two workers, or a retried request, could each make a call. The design had no way to know whether a call had already been made |

**What the corrected design keeps.** The obligation *"a confirmed refund ⇒ the entitlement is revoked"* is
inviolable. **What it changes.** The system no longer guesses. It **waits for the external truth**, and it
distinguishes **confirmed success**, **confirmed failure**, and **unknown** — three different outcomes with
three different consequences.

### 13.2 The state machine

```
                    ┌──────────────┐
                    │ PENDING      │  the intent exists; the invoice was presented; not yet charged
                    └──────┬───────┘
                           │ successful_payment received & verified
                    ┌──────▼───────┐
                    │ ENTITLED     │  charged AND granted, in one transaction (§12 steps 6–7)
                    └──────┬───────┘
                           │ an operator requests a refund → the REFUND operation row is created
                           │ (a durable intent; the Telegram call has NOT been made)
                    ┌──────▼───────────────┐
                    │ REFUND_REQUESTED     │  the decision is durable; no worker has claimed it
                    └──────┬───────────────┘
                           │ a worker claims it (an atomic lease); the entitlement is SUSPENDED (§13.3)
                    ┌──────▼───────────────┐
                    │ REFUND_PENDING       │  the external call is in flight
                    └──────┬───────────────┘
                           │
        ┌──────────────────┼───────────────────────────┐
        │                  │                           │
  returns true      returns false            a timeout / a lost response
        │                  │                     / an unknown outcome
   ┌────▼─────────┐  ┌─────▼────────────┐  ┌────────▼────────────┐
   │ REFUNDED     │  │ REFUND_FAILED    │  │ REFUND_RECONCILE    │
   └──────────────┘  └──────────────────┘  └────────┬────────────┘
   the entitlement   the money was NOT      the outcome is UNKNOWN:
   is PERMANENTLY    returned; the          the entitlement stays suspended;
   revoked           entitlement is         a repeat refund is BLOCKED;
                     RESTORED              the Telegram history resolves it (§13.6)
```

**The three terminal outcomes, and why they are different.**

| Outcome | The evidence | The money | The entitlement | The next action |
|---|---|---|---|---|
| **Confirmed success** | `refundStarPayment` returned `true`, **or** the Telegram history shows an outgoing transaction for that charge id | **returned** | **permanently revoked** | none — the terminal state |
| **Confirmed failure** | `refundStarPayment` returned `false` **and** the history shows no refund for that charge id | **not returned** | **restored** to `ENTITLED` | the operator may re-issue (gated by the history check, §13.6) |
| **Unknown** | a timeout, a lost response, a crashed worker — anything that leaves the outcome undetermined | **unknown** | **suspended**, not revoked | `REFUND_RECONCILE` — the scan resolves it |

> **The single most important line in this section:** an **unknown** outcome is never recorded as a
> **failure**, and it is never recorded as a **success**. It is recorded as **unknown** — and "unknown" has
> its own state, its own operator message, and its own resolution path.

**The full state list, and one simplification that still holds.** `PENDING` · `ENTITLED` · `LATE` ·
`FAILED` · `REJECTED` · `REFUND_REQUESTED` · `REFUND_PENDING` · `REFUND_RECONCILE` · `REFUNDED` ·
`REFUND_FAILED`.

`PAID` is **still** deliberately absent: the operation insert and the entitlement upsert happen in one
transaction, so an observer can never see a charged-but-not-granted state (§12). `LATE` is the sibling of
`ENTITLED` — *"granted, but through the late-fulfilment path"* (§14.7.1) — and it is treated as granted
everywhere the entitlement is checked.

**The remaining transitions.**

| From | To | The trigger |
|---|---|---|
| `PENDING` | `FAILED` | the checkout was rejected, or the intent TTL expired with no charge |
| `ENTITLED` / `LATE` | `REJECTED` | an amount or currency mismatch at settlement |
| `REFUND_REQUESTED` | `ENTITLED` | **cancellation** — allowed **only** before the worker claims it, i.e. before any call could have been made |
| `REFUND_RECONCILE` | `REFUND_PENDING` | a **retry**, permitted **only** after the history check proves that no refund exists for that charge id |

**Cancellation is deliberately restricted.** Once the call is in flight (`REFUND_PENDING`) or its outcome is
unknown (`REFUND_RECONCILE`), the only legal next step is *resolution*, never *cancellation* — the money
may already be on its way back.

### 13.3 The entitlement during the pending window

The question the original design answered by revoking is answered here by a policy that depends on **what
the entitlement actually is**.

| | **A. it stays usable** | **B. it is temporarily suspended** | **C. it is permanently revoked immediately** |
|---|---|---|---|
| **Customer harm** | a cosmetic: **none**. gameplay power: the user keeps using power that may be returned | a cosmetic: a transient cosmetic loss — trivial. gameplay power: a transient loss of paid power — noticeable, but **recoverable** | **the worst**: the user loses the paid value **even when the refund failed** — the money was not returned and the value is gone |
| **Fraud exposure** | gameplay power: **real** — the paid power can be consumed in a run while the refund completes ⇒ *"power without money"* | **none** — the value is not usable while the outcome is unresolved | none |
| **Implementation complexity** | the lowest — no third state | medium — an `entitlements.suspended_at` column, a third client state, and a restore path | the lowest — `revoked_at` already exists — **but the restore path does not, and §13.1 shows why that is fatal** |
| **Crash recovery** | trivially recoverable — the entitlement was never touched | **recoverable** — a stuck suspension is a **delay**, not a loss; the reconcile resolves it and either restores or revokes | **not recoverable** in the original design — `revoked_at` is set and the ledger only moves forward |

**The recommendation.**

| The entitlement class | The policy | Why |
|---|---|---|
| **A paid cosmetic** — a skin, a palette, a badge | **A — it stays usable** until the refund is **confirmed** | a cosmetic has **no spend moment**, no transferable value and no combat effect. Suspending it buys nothing and only manufactures a support ticket. And the asymmetry already accepted in §11.3 applies: *"an already-consumed effect is not clawed back"* |
| **Paid gameplay progression / Lab power** | **B — it is suspended** from `REFUND_REQUESTED` until the outcome is confirmed | it **is** consumable. A keeps a *"power without money"* window open; C destroys the value whenever the refund merely **failed**. Suspension is the only option that is simultaneously fraud-safe and **reversible** |

**C is rejected for both classes.** *"Fail toward under-delivery"* is sound **only** when the failure is
cheap to undo. Here the undo path does not exist in the design, the money may not even have been returned,
and the user-visible outcome — *money returned **and** the value gone* — is the worst combination in the
catalogue. **The corrected design fails toward neither over-delivery nor under-delivery: it waits for the
external truth.**

**One consequence, written down so it is not forgotten.** The entitlement needs a **third** state:

```sql
-- entitlements.suspended_at  -- TEMPORARY. Distinct from revoked_at, which is PERMANENT.
-- The entitlement is usable iff  revoked_at IS NULL AND suspended_at IS NULL.
```

`suspended_at` is set when the refund enters `REFUND_REQUESTED`/`REFUND_PENDING`/`REFUND_RECONCILE` and
cleared on either terminal outcome (`REFUNDED` ⇒ `revoked_at` is set and `suspended_at` is cleared;
`REFUND_FAILED` ⇒ `suspended_at` is cleared and the entitlement is live again).

### 13.4 The durable sequence — the external call is never inside a database transaction

```
── tx 1 (short) ──────────────────────────────────────────────────────────
BEGIN;
  SELECT * FROM ofeliya_pay.operations WHERE id = $purchase FOR UPDATE;
  if status not in ('ENTITLED','LATE'):        ROLLBACK; return 409;
  if a REFUND operation exists for this purchase and is not terminal:
                                                 ROLLBACK; return 409 REFUND_ALREADY_IN_PROGRESS;

  INSERT INTO ofeliya_pay.operations (
      kind='REFUND', op_id=$refundOpId, op_fingerprint=$fp,
      parent_operation_id=$purchase, telegram_payment_charge_id=$chargeId,
      user_key=$user, entitlement_key=$ek, entitlement_level=$lvl,
      amount_stars=$amt, status='REFUND_REQUESTED')
    ON CONFLICT (user_key, kind, op_id) DO NOTHING;      -- the replay path
COMMIT;
── end tx 1 ──────────────────────────────────────────────────────────────
→ 202 { refundOpId, status:'REFUND_REQUESTED' }          -- the operator's request returns FAST

── tx 2 (short, by the worker) ───────────────────────────────────────────
BEGIN;
  UPDATE ofeliya_pay.operations
     SET status='REFUND_PENDING', lease_owner=$worker, lease_expires_at=now()+interval '2 minutes'
   WHERE id=$refundOpId AND status='REFUND_REQUESTED';   -- the ATOMIC claim
  if not updated:                   COMMIT; return;       -- another worker won
  UPDATE ofeliya_pay.entitlements SET suspended_at=now()  -- gameplay power only (§13.3)
   WHERE user_key=$user AND entitlement_key=$ek AND revoked_at IS NULL;
COMMIT;
── end tx 2 ──────────────────────────────────────────────────────────────

── step 3: the external call — OUTSIDE every transaction ─────────────────
  result = telegram.refundStarPayment(user_id, telegram_payment_charge_id)
            with a bounded timeout (e.g. 15 s) and NO transaction, NO row lock held
── end step 3 ────────────────────────────────────────────────────────────

── tx 3 (short) ──────────────────────────────────────────────────────────
BEGIN;
  if result === true:                                  -- CONFIRMED success
      UPDATE operations SET status='REFUNDED' WHERE id=$refundOpId;
      UPDATE entitlements SET revoked_at=now(), suspended_at=NULL WHERE ...;
  else if result === false:                            -- CONFIRMED failure
      UPDATE operations SET status='REFUND_FAILED' WHERE id=$refundOpId;
      UPDATE entitlements SET suspended_at=NULL WHERE ...;          -- RESTORE
  else:                                                -- UNKNOWN
      UPDATE operations SET status='REFUND_RECONCILE' WHERE id=$refundOpId;
      -- the entitlement stays suspended; a repeat refund is BLOCKED
COMMIT;
── end tx 3 ──────────────────────────────────────────────────────────────
```

**Why the call must not be inside a database transaction.** A Telegram network call inside a Postgres
transaction holds a row lock *and* a connection for the whole round-trip. The consequences are concrete,
not stylistic:

| The consequence | What it costs in production |
|---|---|
| The purchase row's lock is held for the whole network call | **every** other money path for that user blocks — a purchase, another refund, a reconcile repair. The refund path becomes the user's latency |
| A database connection is held for the whole network call | under a burst of refunds the pool is exhausted by **in-flight network calls**, not by work |
| The transaction's duration becomes the network's tail latency × the concurrency | on a free-tier Postgres with a small connection cap, that is an outage, not a slowdown |
| The external side effect and the local record share a fate | if the transaction rolls back **after** Telegram succeeded, **the money is returned and the ledger has no record of it** — the unrecoverable case |

**The outbox pattern.** The refund operation row **is** the outbox: it is the durable record that a call is
*owed*. The worker claims it, makes the call, records the outcome. If the worker dies, the row is still
there — `REFUND_REQUESTED` or `REFUND_PENDING` — and it is picked up again, **after** the history check
(§13.6). The refund path never depends on an operator's browser session staying open.

### 13.5 The races and the crash points

| # | The scenario | The state before | The failure | The final state | The mechanism that makes it safe |
|---|---|---|---|---|---|
| 1 | The worker **crashes before** the Telegram call | `REFUND_REQUESTED` | the process dies; the lease expires | another worker claims it → `REFUND_PENDING` → the call → a terminal state | the claim is an atomic conditional `UPDATE`; **exactly one** worker can hold the lease |
| 2 | The worker **crashes after** Telegram succeeded, before the DB write | `REFUND_PENDING`; the money is already returned | the process dies between the call and tx 3 | the sweeper takes over, **checks the Telegram history first**, sees the refund ⇒ `REFUNDED` | the **history** is the source of truth for the outcome; the call is **not** repeated |
| 3 | The call **times out** but Telegram actually succeeded | `REFUND_PENDING` | the outcome is undetermined | `REFUND_RECONCILE` → the scan resolves it → `REFUNDED` | an unknown outcome is **never** recorded as a failure |
| 4 | The call **definitely failed** (`false`, and the history confirms no refund) | `REFUND_PENDING` | a confirmed failure | `REFUND_FAILED`; the entitlement is **restored** | the user keeps what they paid for; the money was not returned |
| 5 | **Two refund workers** race for the same refund | `REFUND_REQUESTED` | both try to claim it | one call, one terminal state | the claim is `UPDATE … WHERE status='REFUND_REQUESTED'`; the loser updates nothing |
| 6 | **Two admins** start a refund for the same purchase | `ENTITLED` | both create a refund operation | one `REFUND_REQUESTED`; the other gets **`409 REFUND_ALREADY_IN_PROGRESS`** | a **partial unique index** allows at most one non-terminal refund per purchase (§13.6) |
| 7 | The **user starts another purchase** while a refund is pending | `ENTITLED` + a refund in flight | the purchase path takes the advisory lock | the purchase is allowed if the SKU is independent; it is **refused** if it depends on the suspended entitlement | the purchase validation reads the entitlement's suspension |
| 8 | The **reconcile worker** runs during a refund | any | the scan sees the intermediate state | it never re-issues a refund; it only **resolves** `REFUND_RECONCILE` | resolution is a state transition, never a call |
| 9 | The refund is **re-issued** after a `REFUND_FAILED` | `REFUND_FAILED` | the operator retries | a **new** refund operation; the call is made **only after the history check proves there is no refund** | a confirmed-failure state alone is not enough; the history is the final gate |

### 13.6 The idempotency of the refund operation

**The refund operation's identity.** A refund is a **first-class operation** in the same append-only ledger
— not a flag on the purchase.

| Field | The value | Why |
|---|---|---|
| `kind` | `'REFUND'` | it is an operation, not a mutation |
| `op_id` | the **refund operation id** — server-minted (`refund:<purchaseOpId>:<n>`) | the retry anchor |
| `parent_operation_id` | the purchase operation | the refund is bound to exactly one purchase |
| `telegram_payment_charge_id` | carried from the purchase | the external anchor |
| `user_key` | the refunded user | the scope |
| `entitlement_key` / `entitlement_level` | the affected entitlement | the target |
| `amount_stars` | the refunded amount | the amount |
| `op_fingerprint` | `sha256(parent_operation_id ‖ user_key ‖ entitlement_key ‖ amount_stars ‖ telegram_payment_charge_id)` | the binding |
| `status` | the refund state (§13.2) | the state machine |

**The rules.**

| Situation | The response | **A Telegram call?** |
|---|---|---|
| The same `op_id` + the **same** fingerprint | the **current state** — `200`, `replayed: true` | ❌ **no** |
| The same `op_id` + a **different** fingerprint | **`409 IDEMPOTENCY_KEY_REUSE`** — nothing is written | ❌ **no** |
| A **new** refund command for a purchase that already has a non-terminal refund | **`409 REFUND_ALREADY_IN_PROGRESS`** | ❌ **no** |
| A **new** refund command for a purchase whose refund is already `REFUNDED` | **`409 REFUND_ALREADY_COMPLETED`** | ❌ **no** |
| A **new** refund command for a purchase whose refund is `REFUND_FAILED` | a new refund operation is allowed — **but only after the history check proves that no refund exists** | ✅ yes, via the worker |
| A **repeated client HTTP request** (the operator's UI double-clicks) | the same as the first two rows | ❌ **no** |

> **The invariant, stated once:** *no Telegram refund call is ever made as a direct consequence of a
> repeated client request.* The call is made **only** by the worker that won the atomic claim, and **only**
> after the history check. Every other path is a state **read**.

**The database-level guard.**

```sql
-- At most ONE non-terminal refund per purchase. A REFUND_FAILED attempt is terminal
-- for THAT attempt, so a re-issue is allowed -- but only after the history check.
create unique index if not exists uq_operations_one_open_refund
  on ofeliya_pay.operations (parent_operation_id)
  where kind = 'REFUND'
    and status in ('REFUND_REQUESTED','REFUND_PENDING','REFUND_RECONCILE');
```

**The history check — the thing the first revision got wrong.** Before the worker makes (or re-makes) a
refund call it asks the Telegram history a single question: *does an outgoing transaction exist for this
charge id?*

- **Yes** → the money was already returned. The refund is **not** re-issued; the operation is finalised to
  `REFUNDED` and the entitlement is revoked.
- **No** → the call is made (the first time), or the attempt is recorded as a confirmed failure.

This one query replaces the *"it is idempotent from the user's perspective"* assumption with an **observed
fact**, and it is what makes the unknown-outcome path safe.

### 13.7 The refund-vs-spend race

In v1 there is no spend, so the race is impossible. In v2:

> A spend is refused if the entitlement it draws on has `revoked_at IS NOT NULL` **or** `suspended_at IS NOT NULL`.
> The spend's transaction takes `pg_advisory_xact_lock(userKey)` — the same lock the refund takes.

The lock is the whole defense. A spend that starts before the refund commits completes and is **not**
clawed back; a spend that starts after is refused. And because the refund **suspends** rather than revokes
until the outcome is confirmed, a *failed* refund restores the entitlement instead of leaving a permanent
loss.

### 13.8 The refund runbook

```
1. The support ticket arrives: "I want my money back" (or "my item is gone").
2. Identify the purchase: by (user_key, created_at desc), by opId, or by telegram_payment_charge_id.
   Never trust the ticket's own identifiers.
3. Read the operation:
     ENTITLED / LATE          → a refund may be requested (tx 1 of §13.4). The operator command returns 202.
     REFUND_REQUESTED         → the worker has not claimed it yet. Do not call Telegram by hand.
     REFUND_PENDING           → the call is in flight, or the outcome is unknown. DO NOT re-issue.
     REFUND_RECONCILE         → the outcome is unknown; the scan resolves it. A repeat refund is BLOCKED.
     REFUNDED                 → done. The entitlement is revoked. Nothing to do.
     REFUND_FAILED            → the call definitely failed and the entitlement is restored.
                                  A re-issue is allowed, but only via the normal command, which is
                                  history-gated.
4. "It says REFUND_FAILED but the money is back."  → the scan (R5) will move it to REFUND_RECONCILE and
   then to REFUNDED. Never resolve it by hand; the history check is the only authority.
5. Never call refundStarPayment from a support tool, a script, or a console. The only caller is the worker.
```

## 14. Reconciliation

### 14.1 The three sources of truth

Reconciliation is **not** a comparison of two databases. It is the disciplined matching of **three**
independent sources, each of which is authoritative for a *different* class of fact.

| Source | What it is | Authoritative for | How it is read |
|---|---|---|---|
| **A. Telegram** | the bot's Star transaction history — `getStarTransactions` (§9.2.1) | the **external money facts**: a charge happened, who paid, how much, when, and whether it was returned | a paged scan into a local mirror (`ofeliya_pay.telegram_transactions`) |
| **B. The OFELIYA operation ledger** | `ofeliya_pay.operations` — append-only | **our** decisions: what we intended, what we recorded, the two idempotency anchors (`opId`, `telegram_payment_charge_id`) | a local query |
| **C. The OFELIYA entitlement read model** | `ofeliya_pay.entitlements` | **what the user actually got** | a local query |

**Why three, and not two.**

| The pair that disagrees | What it means |
|---|---|
| B ↔ C | a **grant bug** — we recorded a purchase but the value never landed, or the value exists with no purchase |
| A ↔ B | a **money event we did not record** — Telegram charged (or returned) and our ledger is silent |
| A ↔ C | **the value and the money disagree** — the user holds paid value that Telegram says was returned, or holds nothing for a payment Telegram says was paid |

No single pair covers the system. A vs B alone would miss a grant bug; B vs C alone would miss every
charge without a local operation.

**The rule that makes it safe:** *no source is ever used as evidence for itself.* The ledger is not evidence
that a Telegram charge happened; the Telegram history is not evidence that a grant happened; the entitlement
row is not evidence that either is true. Every conclusion in §14.2 is drawn from **at least two** sources,
and a conclusion drawn from only one is a **finding**, never an action.

### 14.2 The mismatch catalogue

For every case: **evidence → severity → automatic action? → manual action → the safe outcome → the
detectability class** (§14.4 defines the classes).

| ID | The mismatch | Evidence | Severity | Automatic action? | Manual action | The safe outcome | Class |
|---|---|---|---|---|---|---|---|
| **R1** | **A: a charge exists · B: no operation** | an **inbound** A transaction with `source.type='user'` and `source.transaction_type='invoice_payment'`, whose `id` is absent from `operations.telegram_payment_charge_id` | 🔴 high — the user was charged | **Conditional.** If `source.invoice_payload` decodes to an operation of the same payer and the amount matches → the `LATE` fulfilment path (§14.7) grants it under the lock and alerts. Otherwise → **no auto-grant** | the unresolved queue, with the full Telegram facts attached (the id, the amount, the date, the payer id, the payload) | the user is never charged-and-denied: either the entitlement is granted, or a high-severity ticket exists within one scan interval | **FULLY_AUTOMATABLE** (detect) · the repair is **DETECTABLE_BUT_MANUAL_REPAIR** unless the payload resolves |
| **R2** | **B: `ENTITLED` · C: no entitlement** | `operations.status='ENTITLED'` and no `entitlements` row for `(user_key, entitlement_key)` | 🔴 high — paid, not delivered | **Yes.** The operation already stores the server-computed `entitlement_key`/`entitlement_level`, so the grant is fully determined by the ledger. Upsert the entitlement, write a `grants_log` row with `actor='reconcile'`, alert | none required — the operator reviews the alert | the entitlement exists; **no double grant** (the grant is an upsert keyed by `(user_key, entitlement_key)`) | **FULLY_AUTOMATABLE** |
| **R3** | **C: an entitlement exists · B: no confirmed payment operation** | an `entitlements` row whose `source_operation_id` is null or points at a non-paid operation, with no matching A transaction | 🔴 high — free value | **No.** The entitlement may be a legitimate promo / migration / admin grant (`ENTITLEMENT_SOURCES`, `grants_log`). Auto-revoking a granted badge is a customer-facing act | the operator checks `grants_log` for the actor; with no grant record at all it is a forged or buggy grant → revoke with a reason | the finding is not auto-resolved — a human decides; the entitlement is flagged in the operator console | **DETECTABLE_BUT_MANUAL_REPAIR** |
| **R4** | **A: a refund exists · C: still active** | an **outgoing** A transaction whose `id` matches an `operations.telegram_payment_charge_id` and whose `receiver.type='user'`, while `entitlements.revoked_at IS NULL` and no `REFUNDED` operation exists | 🔴 high — the money came back and the value stayed | **Yes.** The external fact is unambiguous: Telegram returned the Stars to this user. Record a `REFUND` operation (status `REFUNDED`) and revoke the entitlement in one transaction | an alert — a refund we did not initiate is either an operator action outside the system or a chargeback-adjacent event | the entitlement is revoked and the ledger records the external refund we did not perform | **FULLY_AUTOMATABLE** |
| **R5** | **B: `REFUNDED` · A: no refund observed** | `operations.status='REFUNDED'` with no outgoing A transaction carrying the matching id in the mirror | 🟠 medium — the mirror is stale, or the refund never happened | **Only after a bounded re-scan.** The worker re-scans the window around the refund's date; if the refund is still absent → the operation moves to `REFUND_RECONCILE` and the entitlement is **restored** to `ENTITLED` (the money was not returned), with an alert | if the re-scan is still ambiguous (the mirror is behind), the finding stays open | the operation never claims `REFUNDED` on local evidence alone, and the entitlement is not permanently revoked on an unconfirmed refund | **FULLY_AUTOMATABLE** (with the re-scan) |
| **R6** | **A: a duplicate Telegram transaction** | two A transactions with the same `id` **and** the same direction (two inbound charges under one id) | 🔴 high — a double charge | **Partially.** Locally: keep one operation, record the finding, **never grant twice** (`uq_operations_charge`) | the operator raises it with Telegram — **only Telegram can return a duplicate charge**; OFELIYA's own refund path can then be used on the duplicate id | one grant; the duplicate stays visible and refundable | **DETECTABLE_BUT_MANUAL_REPAIR** |
| **R7** | **One `telegram_payment_charge_id` linked to several operations** | `uq_operations_charge` makes this impossible for rows written after the constraint exists; the scan re-checks for pre-constraint violations | 🔴 high | **No** — repairing it means choosing which operation survives | the operator picks the survivor; the others are marked `REJECTED` with a reason | the constraint prevents recurrence; the scan surfaces a legacy violation | **DETECTABLE_BUT_MANUAL_REPAIR** |
| **R8** | **One `opId` used with a different subject/fingerprint** | `operations (user_key, kind, op_id)` unique + the stored `op_fingerprint` ≠ the recomputed one | 🟠 medium — this is the *designed* fail-closed path | **Yes, and preventive:** the write path returns `409 IDEMPOTENCY_KEY_REUSE` and writes nothing | only if two *existing* rows disagree (a corruption) → manual | no second grant; the key reuse is visible in the audit trail | **FULLY_AUTOMATABLE** (the prevention) · **DETECTABLE_BUT_MANUAL_REPAIR** (the corruption case) |
| **R9** | **The amount / SKU / catalog-version mismatch** | A's `amount` ≠ B's `operations.amount_stars`; or A's `source.invoice_payload` decodes to a different SKU than B's `operations.sku`; or B's `catalog_version` no longer resolves to the recorded price | 🟠 medium (catalog drift) · 🔴 high (an amount mismatch) | **No grant, ever.** The settlement path already refuses (`PRICE_MISMATCH`). The scanner records the finding; it never "fixes" a price | the operator decides between re-pricing + re-inviting, and refunding | the user is never charged the wrong amount and never granted the wrong SKU | **DETECTABLE_BUT_MANUAL_REPAIR** |
| **R10** | **The balance does not reconcile** | `getMyStarBalance` (Bot API 9.1) ≠ the ledger's expected net receipts, beyond a tolerance | 🟠 medium | **No** — it is a *derived* signal with **no transaction identity**. It localises a period; it does not identify a transaction | the operator compares the balance against the A mirror over the same window. The most likely cause is a chargeback — Telegram documents that a chargeback *"will be deducted from the bot's balance. This is outside of Telegram's control"* | a balance drift is never silently absorbed; it is an alert | **PARTIALLY_DETECTABLE** — the drift is visible; the *cause* is not attributable per transaction from the Bot API |

### 14.3 The Telegram reconciliation facts (corrected)

> **CORRECTION.** The first revision of this package asserted: *"Telegram provides no API to list a bot's
> payments. There is no 'list my transactions' method."* **That assertion was factually wrong.**
> `getStarTransactions` — the bot's own Telegram Star transaction history — has been part of the Bot API
> since **Bot API 7.5 (June 18, 2024)**. The full field reference is in **§9.2.1** and **Annex D §D.1.7**;
> the Bot API vs MTProto capability matrix is in **§9.5**.

The corrected consequences:

| The first revision claimed | The verified reality |
|---|---|
| *"Telegram payment with no local operation" can only be found by a **manual export** from the Telegram side* | It can be found **automatically**: scan `getStarTransactions` and compare it with the local ledger. A manual export becomes a **dispute-handling convenience**, not the detection mechanism |
| *"There is no 'list my transactions' method"* | There is: `getStarTransactions` — `offset` (a skip count) + `limit` (1–100, default 100), *"in chronological order"* |
| *"cannot be detected automatically"* | **Detection is now automatic.** What remains manual is the **repair** when the evidence is ambiguous — which is a different, and much smaller, problem |
| Q5 — *"how do we obtain a Telegram-side payment listing?"* | **Answered.** The listing is `getStarTransactions`. The remaining question is the operator console over it |

What does **not** change: a **client-side report** ("I paid and got nothing") remains a *trigger*, never
evidence; and Telegram's own live checklist still says *"Use backups to make sure that you don't lose data
about your users' payments."*

**The full reconciliation architecture — the three sources of truth (§14.1), the R1–R10 mismatch
catalogue (§14.2), the detectability classes (§14.4), the worker (§14.5), the checkpoint (§14.6) and
the charge-without-delivery path (§14.7) — is specified below.**

### 14.4 The detectability classes — what is and is not recoverable

Every case in §14.2 is classified. The classes are deliberately blunt, because the whole point of the
correction is to replace *"nothing can be checked automatically"* with a **precise** statement of what can.

| Class | The meaning |
|---|---|
| **FULLY_AUTOMATABLE** | the mismatch is detected with certainty, **and** the correct safe outcome can be applied by a machine with no human judgement |
| **DETECTABLE_BUT_MANUAL_REPAIR** | detected with certainty; the **repair** requires a human decision, or is a money action that a human must authorise |
| **PARTIALLY_DETECTABLE** | only **some instances** are visible; the rest are invisible to the available APIs |
| **NOT_DETECTABLE_FROM_AVAILABLE_API** | no available surface exposes it at all — a procedural gap, not a tooling gap |

> **The class is a property of the *case*, not of every *instance* of the case.**
> R1 is `FULLY_AUTOMATABLE` for detection and `DETECTABLE_BUT_MANUAL_REPAIR` for the repair, and it
> collapses to `FULLY_AUTOMATABLE` end-to-end **when the payload resolves**. Stating only one of the two
> is how the first revision went wrong.

#### 14.4.1 The summary

| ID | Detect | Repair | The one-line verdict |
|---|---|---|---|
| R1 | `FULLY_AUTOMATABLE` | conditional on the payload | a charge without a local operation is **found automatically**; the grant is automatic only when the payload names the intent |
| R2 | `FULLY_AUTOMATABLE` | `FULLY_AUTOMATABLE` | paid but not delivered is **fully automatic** — the operation stores the target |
| R3 | `FULLY_AUTOMATABLE` | `DETECTABLE_BUT_MANUAL_REPAIR` | free value is found automatically, revoked by a human |
| R4 | `FULLY_AUTOMATABLE` | `FULLY_AUTOMATABLE` | a Telegram refund with a live entitlement is **fully automatic** — Telegram is the authority for that fact |
| R5 | `FULLY_AUTOMATABLE` | `FULLY_AUTOMATABLE` (after a re-scan) | a local `REFUNDED` with no external refund is **self-healing** |
| R6 | `FULLY_AUTOMATABLE` | `DETECTABLE_BUT_MANUAL_REPAIR` | a duplicate charge is found automatically; only Telegram can return it |
| R7 | `FULLY_AUTOMATABLE` | `DETECTABLE_BUT_MANUAL_REPAIR` | prevented by a constraint; a legacy violation needs a human |
| R8 | `FULLY_AUTOMATABLE` | preventive | the write path already refuses it |
| R9 | `FULLY_AUTOMATABLE` | `DETECTABLE_BUT_MANUAL_REPAIR` | a price drift is found automatically; the price is never "fixed" by a machine |
| R10 | `PARTIALLY_DETECTABLE` | `DETECTABLE_BUT_MANUAL_REPAIR` | a balance drift is visible; the cause is not attributable per transaction |

#### 14.4.2 What is still **not** automatically recoverable

This list is the honest remainder. It is short, and it is *not* "everything".

| # | The residual gap | The class | Why it cannot be closed on the Bot API | What we do instead |
|---|---|---|---|---|
| 1 | **The subject of a payment whose payload does not resolve** — "detected external payment, subject unresolved" | `PARTIALLY_DETECTABLE` | `invoice_payload` is returned **only** for `"invoice_payment"` transactions, and only what the *bot* put there. A `paid_media_payment` carries `paid_media_payload`; a `gift_purchase` carries none | the finding goes to the manual queue; and the payload design (§17) is chosen so that **our own** payments are never in this class |
| 2 | **A chargeback (Apple / Google)** | `NOT_DETECTABLE_FROM_AVAILABLE_API` per transaction | Telegram documents the *effect* — *"the refunded Stars will be deducted from the bot's balance"* — but exposes **no** chargeback event, and `StarTransaction` carries no chargeback flag | the balance comparison (R10) raises a **period-level** alert; the resolution is procedural (Telegram's dispute terms) |
| 3 | **Why a refund failed** | `NOT_DETECTABLE_FROM_AVAILABLE_API` | `refundStarPayment` returns a bare `true`/`false` — there is no error taxonomy | the *outcome* is still fully determinate: the Telegram history shows the refund or does not (§13) |
| 4 | **Whether a refund call succeeded, at the instant it was made** | `PARTIALLY_DETECTABLE` | a timeout is indistinguishable from a failure at the call site | resolved **after the fact** by the Telegram history — this is exactly why `REFUND_RECONCILE` exists (§13) |
| 5 | **The completeness of the history before some cut-off** | `PARTIALLY_DETECTABLE` | the Bot API states **no** retention guarantee and offers **no** date filter | verified in the test environment (R-T7) and re-verified by the **weekly full scan** (§14.6) — a documented assumption, not a guarantee |
| 6 | **Whether the user actually consumed the paid value** | out of scope for the API | the game is client-side; a granted entitlement may have been used before a refund | a **product policy** question (§11.3), not an API question — paid permanent power is deferred to v1.1 for exactly this reason |

### 14.5 The reconciliation worker

```
observe → compare → classify → repair only when deterministic → otherwise queue for a human
```

**observe** — page through `getStarTransactions` via the provider interface
(`listStarTransactions({ offset, limit })` → `{ transactions: [...] }`, Annex D §D.6.5), write each
transaction into the mirror `ofeliya_pay.telegram_transactions`, and advance the checkpoint **in the same
database transaction as the page write** (§14.6).

**compare** — three joins, no more:

```sql
-- A ↔ B  : a charge we did not record
select t.id from ofeliya_pay.telegram_transactions t
  left join ofeliya_pay.operations o on o.telegram_payment_charge_id = t.id
 where t.direction = 'IN' and o.id is null;

-- B ↔ C  : a paid operation with no entitlement
--   ENTITLED and LATE are both 'granted' states: LATE means 'granted through the
--   late-fulfilment path' (main plan 14.7.1), so it must be covered too.
select o.id from ofeliya_pay.operations o
  left join ofeliya_pay.entitlements e
    on e.user_key = o.user_key and e.entitlement_key = o.entitlement_key
 where o.status in ('ENTITLED','LATE') and e.user_key is null;

-- A ↔ C  : an externally refunded charge whose entitlement is still live
select t.id from ofeliya_pay.telegram_transactions t
  join ofeliya_pay.operations o on o.telegram_payment_charge_id = t.id
  left join ofeliya_pay.entitlements e
    on e.user_key = o.user_key and e.entitlement_key = o.entitlement_key
 where t.direction = 'OUT' and (e.revoked_at is null or e.user_key is null);
```

**classify** — map each difference to a row of §14.2 (R1–R10) and write a `reconcile_findings` row keyed by
`finding_key`, so repeat runs are idempotent and an operator sees the *age* of a finding.

**repair** — only the deterministic cases, each in **one** database transaction, each audited in
`grants_log` with `actor='reconcile'`, the `finding_key`, and the evidence that justified it.

| The auto-repair allowlist | Why it is deterministic |
|---|---|
| **R2** — grant the missing entitlement for an `ENTITLED` operation | the operation stores the server-computed target; the grant is an upsert, so it cannot double-grant |
| **R4** — record the externally observed refund and revoke the entitlement | Telegram is the authority for "the money was returned"; the local ledger cannot contradict it |
| **R5** — move a locally `REFUNDED` operation to `REFUND_RECONCILE` and restore the entitlement, after a bounded re-scan | the local state was wrong about the external fact; the external fact is the truth |
| **`REFUND_RECONCILE` resolution** — finalise to `REFUNDED` (revoke) or to `REFUND_FAILED` (restore) | the Telegram history answers the question that the call site could not |

| The auto-repair denylist — **never, at any severity** | Why |
|---|---|
| granting value without a confirmed Telegram transaction | a grant is a money action; the ledger is not evidence |
| any money movement | a refund is always an explicit operator command (§13) |
| revoking an entitlement whose grant source is unknown (R3) | it may be a legitimate promo / migration grant |
| choosing between two conflicting operations (R7) | it requires a human judgement about which purchase was real |
| re-pricing or "correcting" an amount (R9) | the price is a product decision |

**Properties of the worker.**

- **Safe during a purchase.** It reads committed rows only (MVCC); it never flags a `PENDING` operation; it
  never holds the user advisory lock for long. A repair takes the same `pg_advisory_xact_lock(userKey)` as
  the write path, so a repair and a purchase cannot interleave.
- **Idempotent.** A repeat run over the same mirror yields the same findings (the `finding_key`) and the
  same repairs (upserts + `grants_log` rows keyed by the finding id).
- **Bounded.** One scan page = one HTTP call. A scan that fails leaves the checkpoint untouched and the
  worker retries with backoff. **A partial scan never advances the checkpoint** — the mirror is never
  ahead of the checkpoint.

### 14.6 The checkpoint and the scan cursor

**The problem, stated precisely.** The Bot API's pagination is **not** a cursor:

| Property | What the documentation actually says |
|---|---|
| The page size | `limit` — *"Values between 1-100 are accepted. Defaults to 100."* |
| The position | `offset` — *"Number of transactions to skip in the response"* — an **integer skip count** |
| The ordering | *"Returns the bot's Telegram Star transactions in chronological order."* |
| A server-issued cursor | ❌ **none** |
| A date filter | ❌ **none** |
| A retention guarantee | ❌ **none stated** |

⇒ **A durable checkpoint is our own construction**, and it depends on the assumption that the list is
**append-only and chronologically ordered**. The Bot API states the ordering; it does not explicitly
guarantee append-only behaviour. The design therefore makes the checkpoint *defensive* rather than
authoritative.

**The design.**

| Piece | The rule |
|---|---|
| The mirror | `ofeliya_pay.telegram_transactions` — every transaction ever seen, keyed by `tx_key` |
| The checkpoint | `ofeliya_pay.telegram_scan_checkpoint` — `last_offset`, `last_date`, `last_tx_key`, `last_scan_at`, `mode` |
| **Atomicity** | the checkpoint advances **only in the same transaction as the page write**. A crash mid-page rolls back both ⇒ the mirror is never ahead of the checkpoint |
| The dedupe key | `tx_key = sha256( id ‖ direction ‖ amount ‖ date )`, where `direction = 'IN'` if `source` is present else `'OUT'` |
| ⚠️ **not** `id` alone | the Bot API says the refund *"Coincides with the identifier of the original transaction"* ⇒ **a charge and its refund share one id**. Dedupe by id alone would silently drop every refund |
| The overlap | each scan re-reads the last `OVERLAP` transactions **before** the checkpoint (`OVERLAP = max(limit, 200)`) and re-ingests them; the dedupe key makes the re-ingest a no-op, and it closes the "a transaction was appended while we were paging" gap |
| The ordering-violation guard | if a scan returns a transaction whose `date` is **older** than `last_date`, the append-only assumption is violated ⇒ the worker forces `mode='FULL'` (a re-scan from `offset=0`) and raises an alert. **This is the blind-spot detector** |
| The periodic deep reconciliation | a **weekly full scan** from `offset=0` re-ingests everything and re-compares. It catches a compaction, a reordering, a lost page or a checkpoint bug |
| The manual full scan | an admin operation that sets `mode='FULL'` on demand — used for a dispute, an incident, or a release |
| The cost | ⌈n/100⌉ API calls for *n* transactions. At OFELIYA's scale this is negligible; **the weekly full scan is the cheapest insurance in the system** |

**The honest limitation, stated plainly.**

> The Bot API provides **no durable cursor**. `offset` is a positional skip count. A durable checkpoint is
> *our* construction and it depends on an append-only ordering assumption that the documentation implies
> (*"in chronological order"*) but does not explicitly guarantee.
>
> Therefore the checkpoint is backed by **four** independent safety nets: the **overlap**, the
> **ordering-violation guard**, the **weekly full re-scan**, and the **test-environment verification of
> history completeness** (R-T7). If any of them fails, the system degrades to *"the periodic full scan is
> the truth"* — **not** to *"the checkpoint is the truth"*.
>
> **MTProto would remove this dependency** (`next_offset` is an opaque server-issued string, documented as
> *"obtained from the returned next_offset"*), which is the single strongest reason to consider it later —
> and **not** a reason to make it a dependency now (§9.5.1, §22 Q11).

### 14.7 Charge-without-delivery, rewritten against the transaction API

The first revision could only handle this class through a late `successful_payment` webhook. **That is no
longer the only route** — the Telegram history is the backstop, and it covers the case the webhook cannot.

| # | The scenario | What the state looks like | How it is detected | The automatic action | What is not automatically recoverable |
|---|---|---|---|---|---|
| 1 | **The update arrives; the payment is recorded; the entitlement is not granted** | B: the operation is `ENTITLED`; C: no entitlement | **R2** — a pure local join, found on the next scan (seconds, not hours) | the grant is re-applied from the operation's own stored target; audited | nothing |
| 2 | **The process dies before the `successful_payment` handling completes** | A: the charge exists; B: no operation | **R1** — the Telegram scan finds the charge | if `source.invoice_payload` resolves → the `LATE` fulfilment path grants it (§14.7.1); otherwise a high-severity finding with the payload attached | the **subject**, if the payload does not resolve |
| 3 | **The update is lost / a webhook outage** | A: the charge exists; B: no operation, or a `PENDING` intent | **R1** — the *same* scan. The outage is invisible to us; **the charge is not** | as #2 | as #2 |
| 4 | **The history does not carry enough data to recover the subject** | A: a charge with no `invoice_payload` (e.g. a `paid_media_payment`) or an unresolvable payload | **R1** | **none** — the finding is classified **"detected external payment, subject unresolved"** and goes to the manual queue | the subject |

> **"A payment was detected"** and **"we know what was bought"** are two different claims, and the package
> keeps them apart. The first is **guaranteed** by `getStarTransactions`. The second is guaranteed **only**
> if the bot's `invoice_payload` is self-describing (§17). That is why the payload design is a *correctness
> requirement*, not a stylistic one — and why a `paid_media_payment` (which carries no
> `invoice_payload`) is explicitly out of scope for the Storefront.

#### 14.7.1 The `LATE` fulfilment path

The intent TTL is **not** a reason to refuse a charge. A `successful_payment` that arrives after the TTL is
still a real charge, and Telegram's own rule applies: *"You must always check that you received a
successful_payment update before delivering the goods or services purchased by the user."*

| The local state | The action |
|---|---|
| the operation exists as `PENDING` (or `LATE`) and the payload matches | grant under the advisory lock; `status='ENTITLED'`; audit |
| the operation **does not exist** (the intent was garbage-collected, or the intent API was down) and the payload decodes to a known SKU/catalog version | **create** the operation with `kind='PURCHASE'`, `status='LATE'` → `ENTITLED`, with the payload as the link; grant; audit; alert |
| the payload does not decode, or the amount does not match the catalog price at the payload's catalog version | **no grant.** `REJECTED` + a high-severity finding + an alert. A charge is never silently dropped and never silently granted |

**The intent TTL is therefore a financial parameter, not a cleanup parameter** (Annex B §B.4): it must
exceed the worst-case restart + retry window of the payment host, with a wide margin — **≥ 1 hour** is the
recommended value, with the reconciliation as the backstop.

### 14.8 The safe repair strategy

```
detect → record the finding → a human reviews → an explicit repair command → an audit log → re-run to confirm
```

1. **Never auto-repair a money action.** A repair that grants an entitlement is a money action *unless* it
   is on the §14.5 auto-repair allowlist, and each allowlist entry has a written reason why it is
   deterministic. Everything else is manual.
2. Every repair writes to `grants_log` with `reason`, `finding_id` and the operator identity.
3. Repairs are **idempotent** — running them twice changes nothing the second time.
4. A repair that would grant value **without** a matching Telegram charge requires a charge reference (the
   transaction id from the mirror, or a dispute reference) — otherwise it is rejected with
   `manual-review-required`.
5. The reconcile job must be safe to run **during** a purchase: it reads committed rows only, never
   flags a `PENDING` operation, and never blocks the write path.
6. The reconcile job must be safe to run **during** a refund: it takes the same advisory lock as the write
   path, so a repair and a refund cannot interleave.

### 14.9 The operator runbook — the reconciliation cases

```
1. "I paid and got nothing."
   a. Read the operations by (user_key, created_at desc) and by telegram_payment_charge_id.
   b. Run the scan (POST /api/admin/reconcile {op:'scan'}) — or wait for the next one.
   c. If a Telegram charge exists and the payload resolves:
        → the LATE fulfilment path grants it automatically. Confirm it, tell the user.
   d. If a Telegram charge exists and the payload does NOT resolve:
        → the finding is "detected external payment, subject unresolved".
        → ask the user for the receipt / the payload shown in their Telegram receipt, then repair manually
          with a reason.
   e. If no Telegram charge exists:
        → nothing was charged. Tell the user so. Do not grant anything.

2. "I was charged twice."
   → R6. Keep one grant; raise the duplicate with Telegram; refund the duplicate through the normal
     refund path (only Telegram can return a duplicate charge).

3. "I paid but my money came back / my item disappeared."
   → R4 (an external refund we did not initiate) or an ordinary REFUNDED operation.
   → The scan resolves it automatically and the entitlement is revoked. If the entitlement is still live,
     check the operation status: REFUND_RECONCILE means the outcome is not yet known — wait for the scan,
     do NOT restore the entitlement by hand.

4. The balance does not match the ledger.
   → R10. Compare the balance with the mirror over the same window. The most likely cause is a chargeback
     (Apple / Google) — Telegram states it is outside their control. Escalate procedurally; the balance
     alert is period-level only.

5. A refund that "did nothing".
   → Check the operation status. REFUND_REQUESTED → the worker has not claimed it yet.
     REFUND_PENDING → the call is in flight or the outcome is unknown; do NOT re-issue it manually.
     REFUND_RECONCILE → the outcome is unknown; the scan resolves it; a repeat refund is blocked.
     REFUND_FAILED → the call definitely failed; the entitlement is restored; re-issue is allowed.

---

## 15. Database

### 15.1 The actual stack (verified — do not assume otherwise)

| Fact | Evidence |
|---|---|
| The project uses **Supabase/Postgres** | `deploy/ofeliya-state.sql` — `create schema ofeliya_private`, `jsonb`, `bigint`, `timestamptz`, `plpgsql` |
| It is **not** D1, **not** SQLite, **not** MySQL | Zero DB deps in `package.json`; zero D1/SQLite/Prisma references outside docs |
| It is **not** on the app server | The Node app calls a Deno Deploy edge function which calls PostgREST `/rest/v1/rpc/ofeliya_state_call` with `service_role` |
| The state RPC returns `409` on conflict | `deploy/ofeliya-state-function.ts` — `return json(result, result.error ? 409 : 200)` |
| Runtime deps | `@maxhub/max-bot-api`, `phaser` only — **a SQL client must be added** for the money path, or (preferably) the money goes through the same edge-function pattern |

> **Architectural consequence.** The money path **should mirror** the existing state path: a Postgres
> schema + a `SECURITY INVOKER` RPC + a token-gated edge function + a thin client. That keeps the
> service-role key **out of the app server** — a leak of `SUPABASE_SERVICE_ROLE_KEY` from the game server
> would be catastrophic.

### 15.2 The proposed schema

A new schema `ofeliya_pay` in the same Supabase project, with the same discipline as `ofeliya_private`
(a private schema, RLS on, `service_role`-only, `search_path=''`, `security invoker`):

| Table | Purpose | The key constraints |
|---|---|---|
| `catalog_sku` | The authoritative SKU catalog | `PRIMARY KEY (sku)`; `price_stars > 0`; `currency = 'XTR'`; a self-FK on `prerequisite_sku` / `superseded_by` |
| `operations` | **The append-only ledger** | `UNIQUE (user_key, kind, op_id)`; a partial `UNIQUE (telegram_payment_charge_id) WHERE NOT NULL`; a partial `UNIQUE (user_key, sku)` for the one-time SKUs; indexes on `(user_key, created_at desc)`, `(status)`, `(parent_operation_id)`, `(user_key, op_fingerprint)` |
| `entitlements` | The current-state read model | `PRIMARY KEY (user_key, entitlement_key)`; a partial index on `revoked_at`; a partial index on `suspended_at` (`suspended_at` = **temporary**, `revoked_at` = **permanent**, §13.3) |
| `grants_log` | The audit trail | an index on `(user_key, created_at desc)` |
| `reconcile_findings` | The reconciliation findings | `PRIMARY KEY (finding_key)`; a partial index on the open findings |
| `telegram_transactions` | The mirror of the Telegram Star transaction history (source **A**) | `PRIMARY KEY (tx_key)`; `UNIQUE (tx_id, direction)`; an index on `(direction, tx_date)` |
| `telegram_scan_checkpoint` | The durable scan position | one row per bot; `mode` ∈ (`INCREMENTAL`, `FULL`) |

`updated_at` is the **only** mutable column on an operation row besides `status`; the history is otherwise
append-only. `raw_payload` keeps the full `SuccessfulPayment` JSONB — needed for the disputes and for the
reconcile.

### 15.3 What can be reused from the existing migrations

**There are no existing migrations in OFELIYA in the DDL sense.** `deploy/ofeliya-state.sql` is a single
idempotent script applied **once, manually**. So:

- There is **no migration framework** to reuse. The money schema should be a **separate, versioned, ordered
  script set** (e.g. `deploy/ofeliya-pay/001_catalog.sql`, `002_operations.sql`, …) with a
  `schema_migrations` table, because money DDL must be replayable and auditable.
- The **discipline** is reusable verbatim: a private schema, `revoke` from `public`/`anon`/`authenticated`,
  `grant` to `service_role`, `security invoker`, `set search_path = ''`.
- `ofeliya_private.state` is **untouched** by the money work.

The full DDL: **Annex C**.

---

## 16. API contracts

A minimal surface — six endpoints.

### 16.1–16.6 The six endpoints

The full request/response contracts, the SQL bodies and the edge-function code are in **Annex C §C.5**.
The essentials:

| Endpoint | Request | Server validation | Response | Idempotency | Failure modes |
|---|---|---|---|---|---|
| `GET /catalog` | none (an optional `initData` for the "owned" decoration) | — | `200 { catalogVersion, skus:[{sku, kind, title, priceStars, currency:'XTR', entitlement:{kind,key,maxLevel}, available, unavailableReason, oneTimePerUser, prerequisiteSku}] }` | n/a (a read) | `503` → "магазин временно недоступен" |
| `GET /state` | `{platform, initData}` | `validateInitData`; the `userKey` is derived, never sent | `200 { userKey, entitlements:[{key,level,kind,revoked}], purchases:[{opId,sku,status,amountStars,createdAt}], stateVersion }` | n/a (a read) | `403` an invalid signature; `422` a malformed body; `503` → **no fallback to the local cache** |
| `POST /purchase` | `{platform, initData, opId, sku}` | identity → the `opId` shape → the SKU exists and is enabled → the prerequisite → the entitlement state → the idempotency (the fingerprint) → create the intent | `202 { opId, sku, status:'PENDING', payment:{currency:'XTR', amountStars, invoicePayload}, stateVersion }` | ✅ by `opId`; a `200` replay with `replayed:true` when the fingerprint matches | `400`; `401`/`403`; `404`; `409 IDEMPOTENCY_KEY_REUSE`; `409 ONE_TIME_ALREADY_OWNED`; `410`; `422`; `429`; `503` → **no intent is created** |
| `POST /fulfill` | `{platform, initData, successfulPayment:{…}}` — **the bot, not the client** | identity → `currency==='XTR'` → the payload resolves to a live `PENDING` operation owned by this user → the charge id is unused → the amount equals the server's recomputed amount → the transaction | `200 { opId, status:'ENTITLED', entitlement:{key,level}, stateVersion }` | ✅ by the charge id; `409 CHARGE_ID_ALREADY_APPLIED` returns the original result | `409 PRICE_MISMATCH` → `REJECTED`, **nothing granted**, an alert fires; `422`; `503` → **nothing granted**, the webhook is retried |
| `POST /restore` | `{platform, initData}` | `validateInitData` | `200 { entitlements:[{key,level,kind}] }` | ✅ a read; safe from any device, any number of times | `403`; `503` → "не удалось восстановить покупки", **no local fallback** |
| `POST /admin/reconcile` | `{op:'scan'}` or `{op:'repair', findingKey, reason, chargeReference?}` | an **admin token**, separate from `OFELIYA_PAY_TOKEN` and `OFELIYA_STATE_TOKEN` | `200 { findings:[…] }` or `200 { applied:true }` | ✅; `scan` is read-only and idempotent | `401`/`403`; `409 manual-review-required` when a repair would grant value without a charge reference; `422` an unknown `findingKey` |

### 16.7 API summary

| Endpoint | Auth | Method | Idempotent | Writes money state |
|---|---|---|---|---|
| `GET /catalog` | none | GET | n/a | no |
| `GET /state` | initData | GET | n/a | no |
| `POST /purchase` | initData | POST | ✅ by `opId` | creates the intent |
| `POST /fulfill` | bot | POST | ✅ by the charge id | ✅ grants |
| `POST /restore` | initData | POST | ✅ read-only | no |
| `POST /admin/reconcile` | admin token | POST | ✅ | only on an explicit repair |

---

## 17. Client/server trust matrix

| Field | The client may send? | The server trusts? | The server recomputes? | Persisted where |
|---|---|---|---|---|
| `platform` · `initData` | ✅ | ✅ (the allowlist / the signature) | — | — |
| the user id / uid | ❌ **derived only** | ✅ derived | ✅ from `validateInitData` | `operations.user_key`, `entitlements.user_key` |
| `opId` | ✅ | ⚠️ only as a *proposal* | ✅ bound into the fingerprint | `operations.op_id` |
| `opFingerprint` | ❌ | — | ✅ computed | `operations.op_fingerprint` |
| the SKU | ✅ (a request) | ⚠️ only to *look up* | ✅ resolved → the price + the entitlement target | `operations.sku` |
| the price / amount · the currency | ❌ | ❌ | ✅ from `catalog_sku` | `operations.amount_stars`, `.currency` |
| `branchId` · the level / `newLevel` | ❌ (an intent only) | ❌ | ✅ the server decides the next legal branch/level | `operations.entitlement_key/level`, `entitlements.level` |
| the Stars transaction id · the invoice payload | ❌ | ❌ from the client | ✅ from Telegram / server-minted | `operations.telegram_payment_charge_id` (UNIQUE), `.invoice_payload` |
| the entitlement · the wallet balance | ❌ | ❌ | ✅ derived from `entitlements` / the ledger | `ofeliya_pay.entitlements` *(no balance in v1)* |
| the purchase status · the refund status | ❌ | ❌ | ✅ | `operations.status` |
| the catalog version | ❌ | ❌ | ✅ | `operations.catalog_version` |
| `stateVersion` | ❌ (a read) | — | ✅ monotonic | the response only |
| the admin token / reason | ✅ (admin) | ✅ | — | `grants_log` |

**Reading the matrix** — every row where "the client may send" is ✅ and "the server trusts" is ⚠️ or ❌ is
a place where the client *suggests* and the server *decides*. Those are the only legitimate request
fields. Everything else is either derived or forbidden.

The field-by-field version: **Annex C §C.7**.


---

## 18. Testing strategy

### 18.1 Unit (pure, fast, no DB)

| ID | Subject | Assertion |
|---|---|---|
| T1 | the fingerprint | The same inputs → the same fingerprint; any single changed input → a different fingerprint |
| T2 | the `opId` shape | `/^[A-Za-z0-9_-]{16,64}$/`; rejects empty, unicode, over-length, the wrong charset |
| T3 | the charge-id uniqueness mapping | A duplicate `telegram_payment_charge_id` → `409`/a replay, never a second grant |
| T4 | the idempotency resolver | The same key + the same fingerprint → a replay; the same key + a different fingerprint → `409` **and no write** |
| T5 | SKU resolution | Unknown → 404; disabled → 404; the wrong currency → rejected; the amount recomputed from the catalog |
| T6 | the entitlement progression | The server computes the next legal level; an out-of-range request is refused; the prerequisites are checked |
| T7 | the ledger derivation | The derived balance equals the sum of the ledger rows |
| T8 | client-side distrust | A forged entitlement/price/balance in the request is ignored — the server value wins |
| T9 | `decidePreCheckout` | Non-`XTR` → reject; `PAYMENTS_ENABLED !== 'true'` → reject; the rejection message carries no raw identifiers |
| T10 | the price mismatch | `total_amount != the server amount` → `PRICE_MISMATCH`, no grant |

### 18.2 Integration (real Postgres)

| ID | Subject | Assertion |
|---|---|---|
| I1 | the atomic grant | Killing the transaction between the operation insert and the entitlement upsert leaves **neither** |
| I2 | a retry | The same `opId` twice → one operation, one entitlement, identical responses |
| I3 | the advisory lock | Two concurrent sessions for one user serialize |
| I4 | charge-without-delivery | A `successful_payment` arriving after the intent TTL is still fulfilled (or explicitly parked), never silently dropped |
| I5 | the amount enforcement | A mismatched `total_amount` grants nothing |
| I6 | the reconcile | Each finding type is detected; the repair is idempotent and audited |
| I7 | RLS / grants | `anon`/`authenticated`/`public` cannot read `ofeliya_pay`; only `service_role` can |
| I8 | the edge gateway | An unauthorized token → `401`; an oversized body → `413`; an unknown op → `400` |

### 18.3 Contract (client ↔ server schema)

| ID | Subject | Assertion |
|---|---|---|
| C1 | the client never authors value | The client's request schema **cannot express** a price, a level, an entitlement or a balance |
| C2 | the response integrity | The client discards a response whose `opId`/SKU/branch does not match the request, and re-fetches |
| C3 | monotonic state | A response with a `stateVersion` lower than the applied one is ignored |
| C4 | fail-closed rendering | A failed/unreachable state never renders "оплачено" |
| C5 | the Muse boundary still holds | The collection still has no wallet; the Lab still has no purchase control; the feature flags still have no economy entries |

### 18.4 E2E synthetic (a fake payment provider)

A `FakeStarsProvider` implements `sendInvoice` / `pre_checkout_query` / `successful_payment` /
`refundStarPayment` with scriptable behaviours.

| ID | Scenario |
|---|---|
| E1 | The happy path: a purchase → an entitlement → the client renders it |
| E2 | A duplicate webhook → one grant; the second is a no-op |
| E3 | A timeout after the server commits → the client retries → it converges; no double grant |
| E4 | A reinstall / cleared local storage → the restore returns the same entitlements |
| E5 | A refund → the entitlement is revoked → the client shows it as revoked |
| E6 | A price change between the intent and the charge → `PRICE_MISMATCH`, no grant |
| E7 | The provider confirms with a different `total_amount` → refused |

### 18.5 Real Telegram Stars (test environment)

Telegram provides a **dedicated test environment** for Stars payments (*"You can freely test payments in
Telegram Stars by connecting your bot to Telegram's dedicated test environment"*).

| ID | Scenario |
|---|---|
| R-T1 | A test-env invoice completes and the entitlement is granted |
| R-T2 | The `pre_checkout_query` deadline is met with a measurable margin |
| R-T3 | `refundStarPayment` in the test environment returns `true` and the entitlement is revoked |
| R-T4 | The `successful_payment` fields match the documented contract exactly (the field names, the types) |

**Precondition:** the bot must be connected to the test environment, and the production bot token must
**never** be used for a test. No real payment is executed in this audit or in the pre-Go/No-Go phases.

### 18.6 Out of scope for testing

Real-money charges (production Stars) — only after §23. Chargeback simulation — Telegram exposes no API
for it; it is handled procedurally.

---

## 19. Race matrix

| ID | Concurrency scenario | The expected result |
|---|---|---|
| R1 | The same purchase × 2 simultaneously (the same `opId`) | Exactly **one** operation, **one** entitlement, **one** charge. The second gets a `200` replay. `UNIQUE(user_key,kind,op_id)` + the advisory lock enforce it |
| R2 | Two simultaneous purchases with different `opId`s but the same SKU | Two operations, two entitlements, two charges — legal: they are two intents. If the SKU is one-time → the second is `409 ONE_TIME_ALREADY_OWNED` |
| R3 | The same `opId` with a **different subject** (SKU A vs SKU B) | The second is **`409 IDEMPOTENCY_KEY_REUSE`**, and **nothing is written**. The fingerprints differ |
| R4 | The same `opId` from **two different users** | Two independent operations — `opId` is scoped by `user_key`. No cross-user effect |
| R5 | A refund webhook arrives **before** the purchase fulfillment | The refund finds no terminal purchase → it is **parked** (`REFUND_PENDING`, no revoke) and retried. It never applies to a non-existent grant |
| R6 | A refund vs **spend** | *(v1: no spend)*. In v2: the spend is refused if the entitlement is revoked; the advisory lock serializes both |
| R7 | A refund vs **entitlement use** | The entitlement is **suspended** the moment the refund is requested (§13.3). A concurrent use may complete — a documented asymmetry |
| R8 | Two **different** SKUs purchased simultaneously by one user | Both succeed, serialized by the advisory lock. Both entitlements are present |
| R9 | Two **devices** purchase the same one-time SKU simultaneously | One succeeds; the other is `409 ONE_TIME_ALREADY_OWNED`. The partial unique index is the backstop even if the advisory lock is bypassed |
| R10 | A **crash between the ledger write and the entitlement write** | Neither exists — one transaction (§12). Verified by I1 |
| R11 | The **reconcile runs during a purchase** | The reconcile reads committed rows only. It may observe an operation in `PENDING` — it does not flag it, and it never blocks the write path |
| R12 | Two `successful_payment` updates for the **same charge id**, concurrently | One insert wins; the other gets `409 CHARGE_ID_ALREADY_APPLIED` → a replay of the original. One grant |

---

## 20. Implementation roadmap

The ordering is derived from the audit: the ledger substrate already exists (Supabase), so **S0 is schema,
not infrastructure**. Each phase is independently mergeable and independently revertable.

| Phase | The changed subsystem | Depends on | Tests | Acceptance criteria | Rollback | Parallelizable? |
|---|---|---|---|---|---|---|
| **S0 — the authoritative schema + invariants** | `deploy/ofeliya-pay/*.sql` (new), a money RPC in the `ofeliya-state-function.ts` style | — | I1, I7, I8 | `ofeliya_pay` exists; RLS denies `anon`/`authenticated`; the unique constraints exist; a repeated write is rejected | Drop the schema; nothing else depends on it | ✅ yes — an agent can own `deploy/ofeliya-pay/**` exclusively |
| **S1 — the catalog + read model** | the `catalog_sku` seeding, `GET /api/storefront/catalog` | S0 | T5, C1 | The catalog is the only price source; a disabled SKU is `404`; the client cannot express a price | Revert the endpoint | ✅ yes |
| **S2 — an idempotent purchase operation (no real Stars)** | the `operations` write path, `POST /api/storefront/purchase`, a `FakeStarsProvider` | S0, S1 | T1–T4, I2, E1, E2 | The same `opId` twice → one row; a different SKU with the same `opId` → `409`; no grant without a charge | Disable the endpoint (503); the schema stays | ⚠️ shares `server/index.mjs` with other server work — **serialize with the other server-touching agents** |
| **S3 — the entitlement** | `entitlements`, `grants_log`, `GET /api/storefront/state` | S2 | I1, T8, C1 | The grant is atomic with the operation; the client cannot author an entitlement | `GET /state` returns empty; the purchases are disabled | ⚠️ the same file as S2 |
| **S4 — the synthetic payment adapter** | `FakeStarsProvider` → the real provider interface; the `pre_checkout_query` handler | S2, S3 | T9, T10, E3, E6, E7 | The 10s deadline is met with a margin; the amount is re-read from the catalog; a mismatch grants nothing | Swap the adapter back to the fake | ✅ yes (a new file) |
| **S5 — the refunds** | the refund path of `POST /api/admin/reconcile`, `refundStarPayment` | S3, S4 | T3, E5 | The revoke-first ordering; `REFUNDED` ⇒ revoked, always; a failed Telegram call leaves the entitlement revoked | Disable the refunds | ⚠️ the same file |
| **S6 — the reconciliation** | the scan job + `reconcile_findings` + the admin endpoint | S3, S5 | I6 | Each finding type is detected; the repairs are manual and audited; the job is safe during a purchase | Disable the job | ✅ yes |
| **S7 — the Telegram Stars test environment** | the real provider, the bot wiring, the test-env bot | S4 | R-T1…R-T4 | A real test-env Stars payment completes end-to-end and grants exactly one entitlement | Keep the fake as the default; a flag selects the real one | ✅ yes — but **must not run concurrently with S5** on the same bot token |
| **S8 — the Storefront UI** | the client scene, the pending states, the error states | S1, S3, S4 | C2, C3, C4, E1, E4 | The client renders the server state only; an unreachable ledger never renders "оплачено"; the restore flow works | Hide the storefront tab | ✅ yes — **a different agent can own `src/**`** |
| **S9 — the paid Lab progression** | the `LAB_BRANCH`/`LAB_LEVEL` SKUs, the server-computed next level, the client intent protocol | S2–S4 | T6, R3 | The client sends an *intent*; the server computes the level; the same `opId` cannot buy a different level; the refund/downgrade rule is implemented | Mark the Lab SKUs `enabled=false` | ⚠️ depends on the §11.2 decision (combat power ⇒ v1.1) |

### 20.1 The parallelism map

```
S0 ──▶ S1 ──┬──▶ S2 ──┬──▶ S3 ──┬──▶ S4 ──┬──▶ S5 ──▶ S6
             │         │         │         │         │
             │         │         │         │         └──▶ S7 (needs S4)
             │         │         │         │
             └─────────┴─────────┴─────────┴──▶ S8 (client-only; needs the S1+S3 read models)
                                                └──▶ S9 (needs S2–S4 + the §11.2 decision)
```

**File-ownership conflicts** (why S2/S3/S5 are ⚠️): they all touch `server/index.mjs`, the project's single
hottest server file. **Do not run two agents on `server/index.mjs` simultaneously.** Either serialize them,
or split `server/index.mjs` into a router that imports `server/routes/storefront.mjs` — a mechanical
refactor worth doing in S0/S1 to unlock parallelism.

---

## 21. Agent architecture for the next stage

### 21.1 The principles

1. **One owner per file.** No two agents edit the same file concurrently.
2. **Producers never verify their own work.** Codex and Kimi audit; they do not write the audited code.
3. **Shared authority files are single-writer.** `server/index.mjs`, the SQL schema and `package.json` are single-writer and are the integration bottleneck.
4. **Gates are read-only.** A reviewer's first action is never to write.

### 21.2 The ownership map

| Area | The files | The owner | The reviewer |
|---|---|---|---|
| The money schema + the RPC | `deploy/ofeliya-pay/**` | **MiniMax** (exclusive) | **Kimi** (the constraints, the RLS, the fail-open risks) |
| The server routes | `server/routes/storefront.mjs`, `server/storefront/**` | **MiniMax** (exclusive) | **Codex** (the contracts, the idempotency, the error paths) |
| The `server/index.mjs` router wiring | `server/index.mjs` | **a single integrator** (Codex) | Codex's self-check + Kimi's diff review |
| The bot / the Telegram provider | `server/telegram-payments.mjs`, `server/bot.mjs` | **MiniMax** (exclusive) | **Kimi** (the 10s deadline, re-entrancy, the redaction) |
| The client Storefront | `src/scenes/StorefrontScene.ts`, `src/systems/StorefrontClient.ts`, `src/ui/**` | **MiniMax** (exclusive) | **Codex** (the client renders only the server state) |
| The Lab progression (the client half) | `src/ui/CollectionBoard.ts`, `src/systems/LabClient.ts` | **MiniMax** (exclusive) | **Codex** |
| The tests — unit/integration | `scripts/check-*.mjs`, `server/*.test.mjs` | **lightweight agents** | **Codex** (the suite actually covers §6) |
| The race/concurrency tests | `server/storefront-race.test.mjs` | **Kimi** | Codex |
| The contract tests | `tests/storefront-contract.mjs` | **a lightweight agent** | Codex |
| The docs / the runbook | `docs/**` | **a lightweight agent** | Codex |
| The CI wiring | the `package.json` scripts only (`.github/workflows/**` is **not writable** by the connected App) | **a single integrator** | — |
| The release gate | the whole PR series | — | **Codex** (an independent gate, the exact-head CI read) |

### 21.3 The agent roles

| Agent | The role | Explicitly forbidden |
|---|---|---|
| **MiniMax** | the large autonomous implementations: the schema, the server routes, the client scenes | touching more than its owned file set; merging |
| **Codex** | the independent gate/review: the contract conformance, the CI evidence, the PR-series integration | writing the code it reviews |
| **Kimi** | the adversarial security & race review: the §6 threat model as executable tests, the concurrency matrix | shipping fixes to its own findings without Codex's re-review |
| **Lightweight agents** | the mechanical work: the test scaffolding, the docs, the runbooks, the CI wiring | architectural decisions |

### 21.4 The sequence

```
1. Codex gates the client physical acceptance (#241+#242+#243) → main.
2. MiniMax: the S0 schema → the Codex gate → the Kimi schema review.
3. MiniMax: S1 the catalog → the Codex gate.
4. MiniMax: S2+S3 (one agent, sequential — they share server/index.mjs) → the Codex gate → the Kimi race review.
5. Kimi: the race/concurrency test suite → the Codex gate.
6. MiniMax: S4 the fake adapter + S5 the refunds + S6 the reconcile → the Codex gate → the Kimi threat-model review.
7. MiniMax: S7 the real Telegram test env (an isolated bot) → the Codex gate.
8. MiniMax: S8 the Storefront client → the Codex contract gate.
9. The decision point: §11.2 — combat power or not → then S9.
```

> **The hard rule:** no two agents may write the same shared authority file concurrently. `server/index.mjs`,
> `deploy/ofeliya-pay/**`, `package.json` and the CI scripts each have exactly one owner at any moment in
> the sequence. If the owner changes, the change is a hand-off, not a parallel edit.

The full ownership map and the rationale: **Annex E §E.4**.


---

## 22. Open questions

| # | Question | Why it matters | Who decides | Blocking |
|---|---|---|---|---|
| Q1 | Do we sell **combat power**, or only cosmetics + non-combat Lab branches? | It decides whether the paid power needs the ranking partitioning and the refund semantics (§11.2) | the product owner | S9 |
| Q2 | Which host runs the payment path? Render Free sleeps after 15 idle minutes → the 10s `pre_checkout_query` deadline is at risk; a cold start could exceed 10s | ops | **S7** |
| Q3 | Do we move Supabase off the **Free** tier before real money? *"Supabase Free may pause inactive projects"* → the ledger becomes unreachable → the purchases fail closed (correct, but the revenue dies) | ops | **Go/No-Go** |
| Q4 | `createInvoiceLink` or `sendInvoice`? The first works inside a Mini App; the second requires the bot to message the user | It decides the client UX and the forwarding/multiple-payment risk | product + UX | S7 |
| Q5 | **RESOLVED by the factual correction:** the Bot API's `getStarTransactions` **is** the Telegram-side payment listing (§9.2.1). The open question is now the **operator console** over it, and the retention of the local mirror | §14 — the automatic detection of "paid but no local operation" is now possible | ops | Go/No-Go (the console only) |
| Q6 | Do we add a spendable currency in v2? | The entire balance / refund-vs-spend class (§1.3) | product | v2 |
| Q7 | Is `premium_pass`-style **recurring** Stars in scope? (`subscription_period=2592000`, a price ≤ 10000 Stars) | The recurring payments change the refund and the entitlement model entirely | product | v2 |
| Q8 | Which entity holds the money — OFELIYA directly, or a MAX-platform account? | It affects the account, the tax treatment and the reconciliation | product + legal | Go/No-Go |
| Q9 | Do we split `server/index.mjs` into modules before S2, to unblock the parallel agents? | The ownership map is much cleaner if we do | engineering | S0/S1 |
| Q10 | What is the **refund policy** window, and who may trigger it? | It decides the `REFUND_PENDING` handling and the operator runbook | product + support | S5 |


---

## 23. Go/No-Go criteria for real money

All must be **true** before a single real Stars charge is accepted.

**Correctness**
- [ ] The §6 threat model is executable — every row has a passing test.
- [ ] The §19 race matrix has a passing test per row (R1–R12).
- [ ] The idempotency contract (§7) is proven: the same key + different parameters → `409` + **no write**.
- [ ] The refund invariant is proven: `REFUNDED` ⇒ the entitlement is revoked, in every path including a crash between the revoke and the Telegram call.
- [ ] The atomicity test (I1) proves no half-grant.
- [ ] The reconcile job detects every finding type in §14.1, and its repair is audited + idempotent.

**Security**
- [ ] `ofeliya_pay` is unreadable by `anon` / `authenticated` / `public`; only `service_role` can.
- [ ] The service-role key is **not** present on the game server (it lives only in the edge function).
- [ ] Every RPC sets `search_path = ''` and is `security invoker`.
- [ ] The admin reconcile endpoint requires a dedicated admin token; the reconcile op is **not** in the payment function's whitelist.
- [ ] No log line contains a raw `initData`, `telegram_payment_charge_id` or `invoice_payload` in a user-visible or analytics context.
- [ ] An independent adversarial review (Kimi) has signed off on the whole money path.

**Operational**
- [ ] The ledger is on a **non-pausing** Postgres tier, with backups and a restore drill.
- [ ] The payment host **does not sleep** and answers `pre_checkout_query` inside 10s with a measured margin.
- [ ] A Telegram **test-environment** purchase has completed end-to-end (§18.5) — including a refund.
- [ ] The `/terms` and `/support` bot commands exist (Telegram's own live checklist).
- [ ] A dispute/chargeback runbook exists, with an owner and an escalation path.
- [ ] A way to obtain a Telegram-side transaction listing for the disputes exists (Q5).
- [ ] A kill switch exists and is tested: flipping it makes `pre_checkout_query` fail closed — and any already-charged payment is still fulfilled (§6 row 10).
- [ ] The intent TTL exceeds the worst-case restart + retry window of the payment host.

**Product**
- [ ] The refund policy (Q10) is written and published.
- [ ] The storefront renders the pending/refund/error states honestly (§10.3).
- [ ] The client cannot author value (§17, contract C1).
- [ ] The client renders **only** the server state — including the offline and stale-cache cases.

**The explicit stop conditions**
- [ ] If the ledger is unreachable, **no invoice is presented** and **no grant happens** — verified by deliberately breaking the DB during a test-env purchase.


---

**Evidence log, the full file index, the deep-dive annexes and the repository-verification commands:
`docs/architecture/ofeliya-server-economy/ANNEX_E_roadmap_evidence.md`.**
