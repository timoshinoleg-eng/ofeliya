# ANNEX B — Threat Model, Idempotency Contract & Race Matrix

**Part of:** `docs/architecture/OFELIYA_SERVER_ECONOMY_PLAN_20261025.md` · Date: 2026-10-25
**Scope:** the expanded adversarial threat model, the executable test catalogue, and the detailed race
matrix.

---

## B.1 The threat model in full

Format: `attack/failure → expected invariant → required defense → test`.
Test ids: `T#` unit · `I#` integration · `C#` contract · `E#` synthetic E2E · `R#` race.

| # | Attack / failure | Expected invariant | Required defense | Test |
|---|---|---|---|---|
| 1 | **Duplicate purchase request** — the client retries the same `opId` with the same params | Exactly one operation, one grant, one charge | `UNIQUE(user_key, kind, op_id)`; a fingerprint match returns a `200` replay of the stored result | T4, I2, E2 |
| 2 | **Same `opId`, different SKU** | No second grant; the request is rejected | The fingerprint includes the SKU → a mismatch returns **`409` FAIL CLOSED** | T4, R3 |
| 3 | **Same `opId`, different branch/level** | No second grant; the request is rejected | The fingerprint includes the *computed entitlement target* (the branch + the level), never the client's word | T4, R3 |
| 4 | **Same `opId`, different user** | No cross-user leakage | `opId` is scoped by `user_key`; the unique index is `(user_key, kind, op_id)`; the fingerprint includes `userKey` | T4, R4 |
| 5 | **Replay of an old successful response** | No new grant | The operation already exists → the stored result is replayed; `operations` is append-only, so it cannot re-fire | T4, I2 |
| 6 | **Response `branchId` mismatch** vs the request | The client must not apply it | The server returns the **authoritative** entitlement snapshot; the client compares and **ignores** a mismatch (it renders nothing and re-fetches) | C2, E3 |
| 7 | **Response SKU mismatch** | The client must not apply it | As #6 — the client never trusts the response fields; it re-reads `/api/storefront/state` | C2 |
| 8 | **Response `opId` mismatch** | The client must not apply it | As #6, plus the client aborts the pending flow | C2 |
| 9 | **The client retries after a timeout** | No double charge, no double grant | The same `opId` + the same params → a replay; the external anchor `telegram_payment_charge_id UNIQUE` blocks a second charge row | I2, E3 |
| 10 | **The server committed, the client timed out** | The user is not charged without delivery | The replay returns `ENTITLED` + the entitlement, and the client converges. If the runtime was mid-restart, the **charge-without-delivery guard** fulfils rather than drops (port `alertPaymentWhileDisabled`) | E3, I4 |
| 11 | **Telegram confirms twice** | One operation, one grant | `UNIQUE(telegram_payment_charge_id)` | T3, R1 |
| 12 | **The webhook is duplicated** | An idempotent no-op | As #11 | E2 |
| 13 | **The webhook is reordered** (a refund before the purchase confirm) | A refund must not resurrect or corrupt the state | A refund requires a **terminal** purchase operation; an early refund is parked `REFUND_PENDING` and retried, never applied to a non-existent grant | R5 |
| 14 | **A refund races with a spend** | No spend on a revoked entitlement | **v1 has no spendable currency** → the class is eliminated. If a wallet is added: the spend is refused when `entitlements.revoked_at IS NOT NULL` | R6 |
| 15 | **A refund races with a purchase** | No double-grant, no lost refund | `pg_advisory_xact_lock(userId)` serializes both paths; the refund waits | R7 |
| 16 | **A purchase races with a purchase** (different SKUs, the same user) | Both or neither — never one | The same advisory lock; distinct `opId`s → distinct operations; the lock serializes them | R8 |
| 17 | **A balance update is lost** | *(eliminated in v1)* | If a wallet exists: derive it from the ledger, never increment a counter | n/a (v1) → T7 (later) |
| 18 | **A stale client cache** | The client never shows a false entitlement | The client renders from `/api/storefront/state`; the cache is display-only; a purchase completion forces a re-read | C3, E4 |
| 19 | **Two browser/device sessions** | One grant, one charge | The server-side idempotency + the advisory lock; the second session sees the same entitlement on a re-read | R9 |
| 20 | **Offline / reconnect** | No phantom unlock | On reconnect the client re-reads the server state; the local storage holds no paid entitlement | C3, E4 |
| 21 | **A malicious `localStorage` edit** | Zero effect on the paid value | The paid entitlement lives **only** server-side; the client copy is decorative | T8, C1 |
| 22 | **A forged client entitlement** | Rejected | The server never accepts an entitlement from the client; it is a derived read model | T8, C1 |
| 23 | **A forged price** | Rejected | The server recomputes the amount from the catalog; the client's amount is ignored; the final `total_amount` in `SuccessfulPayment` must equal the server's amount | T5, I5 |
| 24 | **A forged currency** | Rejected | Only `XTR` is accepted; `decidePreCheckout` rejects anything else | T5 |
| 25 | **Reordered API responses** | No stale application | Every state-changing response carries the operation id + a monotonic `stateVersion`; the client discards a response older than what it has applied | C3 |
| 26 | **A rollback after a server success** | The grant survives | The grant lives in Postgres `ofeliya_pay`, not in the client save; a client rollback re-reads and re-converges | C3, E4 |
| 27 | **The server crashes between the ledger write and the entitlement write** | No half-grant | **One DB transaction** covering the operation insert + the entitlement upsert (main plan §12) | I1, R10 |
| 28 | **The bot restarts between `pre_checkout_query` and `successful_payment`** | No orphan grant | The purchase-intent row is `PENDING`; the fulfillment is driven by the `successful_payment` update alone | I4 |
| 29 | **An operator replays an old `invoice_payload`** | No second grant | The `invoice_payload` carries the op id; the operation is already terminal → a replay, no new grant | T4, E2 |
| 30 | **An operator mis-runs a reconcile repair** | No silent mutation | The repairs are **manual, audited and idempotent** (main plan §14.4) | I6 |
| 31 | **A forged `initData`** | Rejected | `validateInitData` — the signature is the identity; a forged uid is never trusted | I7, C1 |
| 32 | **A forwarded invoice paid by someone else** | The payment is bound to the payer | The `SuccessfulPayment.from` / the operation's `user_key` must match; the charge id is the anchor, not the payload | I5, T5 |
| 33 | **A multi-chat / inline invoice paid by many users** | Each payment grants its own payer | The operation is created per payer at `pre_checkout_query` time; the `invoice_payload` is bound to one user; Telegram's own warning — *"It is critical to make sure your bot only accepts multiple payments when the order can be processed correctly"* — is why the intent is created per payer, never per invoice | T5, R12 |
| 34 | **The catalog is edited mid-flight** (the price changes between the intent and the charge) | The user is not over- or under-charged silently | The operation stores the amount it was priced at; at settlement the server compares against its own recomputed amount → `PRICE_MISMATCH`, no grant, an alert | E6, T10 |
| 35 | **A disabled SKU is still shown in the client's cached catalog** | No purchase of a disabled SKU | The server rejects it (`404`); the client cache is not authoritative | T5 |

### B.2 The residual risks that do not disappear with good code

| Risk | Why it survives | Mitigation |
|---|---|---|
| **Chargeback / dispute** | Telegram documents it: *"if the buyer initiates a chargeback with the relevant payment provider … the funds may be debited from your balance. This is outside of Telegram's control."* | Fulfill on `successful_payment`, not on final settlement; keep `raw_payload`; define the revocation path (main plan §13.3) |
| **Supabase Free pausing the project** | `deploy/RENDER.md`: *"Supabase Free may pause inactive projects."* A paused project makes the ledger unreachable → the purchases **fail closed**, so the revenue dies but nothing is mis-sold | Move off the Free tier **before** real money (main plan §23.3) |
| **Render Free sleeping after 15 idle minutes** | The same document | A sleeping server can blow the 10-second `pre_checkout_query` deadline → the payment path needs a **non-sleeping host** |
| **Single-process lock semantics** | `withProfileLock` is in-memory | Use `pg_advisory_xact_lock` (DB-wide) for every money path |
| **Entitlement-grant ≠ value-delivered** | The game is client-side; a granted entitlement can be "used" before the server sees it | Acceptable for cosmetics. **For paid permanent power, the grant must be re-read at run start** (main plan §11.2) |
| **A late webhook after the intent TTL** | The Telegram payment is real; our intent is gone | The charge-without-delivery path (B.4) fulfils or parks it — it is never silently dropped |
| **The client lying about "I did not receive it"** | The server granted it; the user says otherwise | The `grants_log` + the operation row is the evidence; the support runbook reads them |

---

## B.3 The idempotency contract — the exact algorithm

### B.3.1 The fingerprint

```
opFingerprint = sha256(
    userKey            # server-derived from the validated initData
  | opType             # "PURCHASE" | "REFUND"
  | sku                # server-resolved sku id
  | amountStars        # server-computed
  | entitlementTarget  # server-computed, e.g. "lab.branch.magnet.level.3"
  | catalogVersion     # pins the price to the catalog version used
)
```

The separator `|` matters: it prevents `("ab","c")` from colliding with `("a","bc")`.

**Every one of the five dimensions the brief requires is present:**

| Required dimension | Where it appears in the fingerprint |
|---|---|
| user | `userKey` |
| operation type | `opType` |
| subject / SKU | `sku` |
| amount / price | `amountStars` |
| entitlement target | `entitlementTarget` |

`catalogVersion` is the sixth, added so a later catalog edit cannot silently reinterpret an old operation.

### B.3.2 The resolver

```
resolve(opId, fingerprint):
  row = SELECT * FROM operations WHERE user_key=? AND kind=? AND op_id=?
  if row is null:                     -> CREATE (the new-operation path)
  if row.op_fingerprint == fingerprint:
        if row.status is terminal:    -> REPLAY (the stored result + the snapshot)
        else:                         -> IN_PROGRESS (the current state)
  else:                               -> CONFLICT (409 IDEMPOTENCY_KEY_REUSE, no write)
```

**The `CONFLICT` branch must not write anything** — not a status change, not an audit row that could be
mistaken for an attempt to fulfil.

### B.3.3 The two keys

| Key | Origin | Purpose | Uniqueness |
|---|---|---|---|
| `opId` | Client-proposed | The idempotent **retry** of one logical intent | `UNIQUE(user_key, kind, op_id)` |
| `telegram_payment_charge_id` | Telegram | The **money** identity — a second charge for it is a bug or an attack | `UNIQUE(telegram_payment_charge_id)` |

A purchase is complete when **both** are recorded.

- `opId` alone is insufficient: it could be a retry of an intent that never got charged.
- `charge_id` alone is insufficient: a forwarded invoice can be paid by a different user.

### B.3.4 The status codes

| Code | Meaning | Client action |
|---|---|---|
| `202` | The intent is accepted; an invoice must be presented | Open the invoice UI |
| `200` | An idempotent replay (the same fingerprint) | Treat it exactly like the original response |
| `409 IDEMPOTENCY_KEY_REUSE` | The same key, different parameters | **Do not auto-retry.** Show an error; the client must generate a *new* `opId` only if the user explicitly retries with corrected parameters |
| `409 ONE_TIME_ALREADY_OWNED` | A one-time SKU is already owned | Re-read the state and show the owned item |
| `409 CHARGE_ID_ALREADY_APPLIED` | The charge id exists | Show the original result (a replay) |
| `409 CHARGE_ID_CONFLICT` | The same charge id with a different `opId`/fingerprint | Show an error; **alert the operator** — this should never happen |
| `422 PRICE_MISMATCH` | The charged amount ≠ the server's amount | Show an error; **alert the operator**; nothing is granted |
| `503 LEDGER_UNAVAILABLE` | The financial store is unreachable | Show a retry; **no invoice is presented** |

---

## B.4 The charge-without-delivery guard

The single most important operational path, and the one most often forgotten.

```
Timeline:
  t0  the client requests the intent  → the operation is PENDING
  t1  the invoice is presented          → the user taps Pay
  t2  Telegram charges the user          → the funds leave the account
  t3  the successful_payment arrives     → the server grants

The failure modes:
  ✗ t2 happens, t3 never arrives (a bot restart, a network partition, a deploy)
  ✗ t2 happens, t3 arrives but the ledger is down
  ✗ t2 happens, t3 arrives but the runtime is deliberately disabled (the kill switch)
```

**The rule: once Telegram has charged, the user is owed the goods.** The server must never drop a
charge on the floor.

| Situation | Required behaviour |
|---|---|
| The runtime is disabled by the kill switch | **Fulfil anyway** (port `alertPaymentWhileDisabled`), and alert. The kill switch stops *new* purchases; it must not strand money already taken. The notice carries **no raw identifiers**. |
| The ledger is unreachable | The charge cannot be fulfilled immediately. The webhook is **retried**; the intent's TTL must be long enough to absorb a restart. If the retry budget is exhausted, the finding lands in the reconcile queue for a manual grant (§14.4) |
| The intent's TTL expired before `successful_payment` arrived | Do **not** refuse outright. The operation is `PENDING` → it moves to a `LATE` state, the entitlement is granted under the lock, and the anomaly is alerted. A real charge must never be a silent loss |
| The intent was already `ENTITLED` (a duplicate webhook) | A replay: return the original result. No second grant |

**The TTl is therefore a financial parameter, not a cleanup parameter.** It must exceed the worst-case
restart + retry window of the payment host, with a wide margin. Recommended: **≥ 1 hour** for the intent
TTL, with the reconciliation as the backstop.

---

## B.5 The race matrix in full

| ID | Concurrency scenario | The expected result | The mechanism that guarantees it |
|---|---|---|---|
| R1 | The same purchase × 2 simultaneously (the same `opId`) | Exactly **one** operation, **one** entitlement, **one** charge. The second gets a `200` replay | `UNIQUE(user_key, kind, op_id)` + `pg_advisory_xact_lock` |
| R2 | Two simultaneous purchases with different `opId`s but the same SKU | Two operations, two entitlements, two charges — legal: they are two intents. If the SKU is one-time → the second is `409 ONE_TIME_ALREADY_OWNED` | the partial unique index on `(user_key, sku)` |
| R3 | The same `opId` with a **different subject** (SKU A vs SKU B) | The second is **`409 IDEMPOTENCY_KEY_REUSE`**, and **nothing is written**. The fingerprints differ | the fingerprint comparison under the lock |
| R4 | The same `opId` from **two different users** | Two independent operations — `opId` is scoped by `user_key`. No cross-user effect | the composite unique index `(user_key, kind, op_id)` |
| R5 | A refund webhook arrives **before** the purchase fulfillment | The refund finds no terminal purchase → it is **parked** (`REFUND_PENDING`, no revoke) and retried. It never applies to a non-existent grant | the refund's `SELECT ... FOR UPDATE` finds no `ENTITLED` row → it parks |
| R6 | A refund vs a **spend** | *(v1: no spend)*. In v2: the spend is refused if the entitlement is revoked | the advisory lock + the `revoked_at IS NULL` check in the spend's transaction |
| R7 | A refund vs an **entitlement use** | The revoke is visible immediately (revoke-first, main plan §13.1). A concurrent use may complete — a documented asymmetry | the soft-revoke is committed before the external call |
| R8 | Two **different** SKUs purchased simultaneously by one user | Both succeed, serialized by the advisory lock. Both entitlements are present | the advisory lock serializes; the rows are distinct |
| R9 | Two **devices** purchase the same one-time SKU simultaneously | One succeeds; the other is `409 ONE_TIME_ALREADY_OWNED`. The partial unique index is the backstop even if the advisory lock is bypassed | the partial unique index on `(user_key, sku)` |
| R10 | A **crash between the ledger write and the entitlement write** | Neither exists — one transaction | the single DB transaction (main plan §12) |
| R11 | The **reconcile runs during a purchase** | The reconcile reads committed rows only. It may observe an operation in `PENDING` — it does not flag it, and it never blocks the write path | MVCC: the reader sees the pre-commit snapshot |
| R12 | Two `successful_payment` updates for the **same charge id**, concurrently | One insert wins; the other gets `409 CHARGE_ID_ALREADY_APPLIED` → a replay of the original. One grant | `UNIQUE(telegram_payment_charge_id)` |
| R13 | A **refund and a purchase** of the same SKU concurrently | The purchase completes first → the refund sees `ENTITLED` → revokes. Or the refund parks first → the purchase completes → the refund retries and revokes. Either way the end state is consistent | the advisory lock + the refund's retry loop |
| R14 | Two purchases for the **same one-time SKU** where the first is **refunded** concurrently | The refund frees the slot (the partial index excludes `REFUNDED`), so a new purchase may succeed | the partial index's `status IN ('PENDING','PAID','ENTITLED')` predicate |
| R15 | The **admin reconcile repair** runs concurrently with a purchase | The repair is a single audited statement under the same lock; it cannot double-grant | the advisory lock + the `grants_log` |

---

## B.6 The executable test catalogue

This is the catalogue a future implementation should turn into code. Each id is referenced from the main
plan's threat model and the roadmap's acceptance criteria.

### B.6.1 Unit — pure, fast, no DB

| ID | Subject | The assertion |
|---|---|---|
| T1 | The fingerprint | The same inputs → the same fingerprint; any single changed input → a different fingerprint. Also: the separator prevents `("ab","c")` colliding with `("a","bc")` |
| T2 | The `opId` shape | `/^[A-Za-z0-9_-]{16,64}$/`; rejects empty, unicode, over-length, the wrong charset |
| T3 | The charge-id uniqueness mapping | A duplicate `telegram_payment_charge_id` → `409`/a replay, never a second grant |
| T4 | The idempotency resolver | The same key + the same fingerprint → a replay; the same key + a different fingerprint → `409` **and no write** (assert the row count is unchanged) |
| T5 | The SKU resolution | Unknown → 404; disabled → 404; the wrong currency → rejected; the amount recomputed from the catalog; a forwarded invoice paid by another user → rejected |
| T6 | The entitlement progression | The server computes the next legal level; an out-of-range request is refused; the prerequisites are checked; the max level is enforced |
| T7 | The ledger derivation | The derived balance equals the sum of the ledger rows; a refund subtracts correctly |
| T8 | The client-side distrust | A forged entitlement / price / balance in the request is ignored — the server value wins |
| T9 | `decidePreCheckout` | Non-`XTR` → reject; `PAYMENTS_ENABLED !== 'true'` → reject (and `"TRUE"`, `"True"`, `"  true  "` are all *disabled*); the rejection message carries no raw identifiers |
| T10 | The price mismatch | `total_amount != the server amount` → `PRICE_MISMATCH`, no grant |
| T11 | The state machine | Every legal transition is accepted; every illegal transition is refused; the terminal states are terminal |
| T12 | The redaction | No log/notice output contains an `initData`, a charge id, or an invoice payload |

### B.6.2 Integration — real Postgres

| ID | Subject | The assertion |
|---|---|---|
| I1 | The atomic grant | Killing the transaction between the operation insert and the entitlement upsert leaves **neither** |
| I2 | A retry | The same `opId` twice → one operation, one entitlement, identical responses |
| I3 | The advisory lock | Two concurrent sessions for one user serialize |
| I4 | The charge-without-delivery | A `successful_payment` arriving after the intent TTL is still fulfilled (or explicitly parked), never silently dropped |
| I5 | The amount enforcement | A mismatched `total_amount` grants nothing |
| I6 | The reconcile | Each finding type is detected; the repair is idempotent and audited |
| I7 | RLS / grants | `anon`/`authenticated`/`public` cannot read `ofeliya_pay`; only `service_role` can |
| I8 | The edge gateway | An unauthorized token → `401`; an oversized body → `413`; an unknown op → `400` |
| I9 | The refund ordering | A crash between the revoke and the Telegram call leaves the entitlement **revoked** and the operation `REFUND_PENDING` — never a refunded-but-granted state |
| I10 | The one-time SKU | The partial unique index rejects a second concurrent intent for a one-time SKU; a refunded purchase frees the slot |

### B.6.3 Contract — the client ↔ server schema

| ID | Subject | The assertion |
|---|---|---|
| C1 | The client never authors value | The client's request schema **cannot express** a price, a level, an entitlement or a balance |
| C2 | The response integrity | The client discards a response whose `opId`/SKU/branch does not match the request, and re-fetches |
| C3 | Monotonic state | A response with a `stateVersion` lower than the applied one is ignored |
| C4 | Fail-closed rendering | A failed/unreachable state never renders "оплачено" |
| C5 | The Muse boundary still holds | The collection still has no wallet; the Lab still has no purchase control; the feature flags still have no economy entries |

### B.6.4 E2E synthetic — a fake payment provider

A `FakeStarsProvider` implements `sendInvoice` / `pre_checkout_query` / `successful_payment` /
`refundStarPayment` with scriptable behaviours (a delayed charge, a duplicate charge, a wrong amount, a
provider error).

| ID | Scenario |
|---|---|
| E1 | The happy path: a purchase → an entitlement → the client renders it |
| E2 | A duplicate webhook → one grant; the second is a no-op |
| E3 | A timeout after the server commits → the client retries → it converges; no double grant |
| E4 | A reinstall / cleared local storage → the restore returns the same entitlements |
| E5 | A refund → the entitlement is revoked → the client shows it as revoked |
| E6 | A price change between the intent and the charge → `PRICE_MISMATCH`, no grant |
| E7 | The provider confirms with a different `total_amount` → refused |
| E8 | The provider errors on the refund → the entitlement stays revoked; `REFUND_FAILED`; an alert fires |
| E9 | The ledger is unreachable → no invoice is presented; the checkout is rejected |
| E10 | The kill switch is flipped mid-flow → the `pre_checkout_query` is rejected; an already-charged payment is still fulfilled |

### B.6.5 Real Telegram Stars — the test environment

Telegram provides a **dedicated test environment** for Stars payments (*"You can freely test payments in
Telegram Stars by connecting your bot to Telegram's dedicated test environment"*).

| ID | Scenario |
|---|---|
| R-T1 | A test-env invoice completes and the entitlement is granted |
| R-T2 | The `pre_checkout_query` deadline is met with a measured margin (target: < 2s of the 10s budget) |
| R-T3 | `refundStarPayment` in the test environment returns `true` and the entitlement is revoked |
| R-T4 | The `successful_payment` fields match the documented contract exactly (the field names, the types) |
| R-T5 | The `invoice_payload` round-trips (≤128 bytes, opaque, parseable by the server) |
| R-T6 | A forwarded invoice paid by a second user → the second user gets their own grant, not the first's |

**Precondition:** the bot must be connected to the test environment, and the production bot token must
**never** be used for a test. **No real payment is executed** in this audit or in the pre-Go/No-Go phases.

### B.6.6 Out of scope for testing

- Real-money charges (production Stars) — only after the Go/No-Go criteria are met.
- Chargeback simulation — Telegram exposes no API for it; it is handled procedurally.
