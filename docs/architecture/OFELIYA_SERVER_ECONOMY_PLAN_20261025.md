| Paid currency (Stars) | **External.** Telegram holds it. OFELIYA never stores a Stars balance | Telegram; OFELIYA stores *amounts charged* in `operations.amount_stars` (an immutable receipt, not a balance) |
| Earned currency | **None.** No server-side spendable currency exists in v1 | n/a |
| Promotional currency | **None in v1.** If added later: server-derived from `operations` + `grants_log`, never client-settable | `ofeliya_pay` ledger |
| Server-side balance | **Deliberately absent in v1** (§1.3) | Deferred to a later phase; if built, **derived** from the ledger, never a mutable counter |

> **Invariant:** `balance(user) = Σ ledger_entries(user)` if a wallet is ever introduced. No `UPDATE
> balances SET x = x + n`. This is why v1 avoids it.

#### Purchase operation

| Field | Authority | Notes |
|---|---|---|
| `opId` (idempotency key) | **Client-proposed, server-bound** | Client may propose; server stores the binding fingerprint and rejects mismatches |
| `opFingerprint` | **Server** | `sha256(userKey \| opType \| sku \| amount \| entitlementTarget \| catalogVersion)` |
| invoice id | **Server** | `invoice_payload` is minted by the server, ≤128 bytes, opaque to the client |
| `telegram_payment_charge_id` | **Telegram** | Stored UNIQUE — the external anchor |
| `provider_payment_charge_id` | **Telegram** | Nullable for Stars |
| SKU id | **Client may request; server resolves** | Server rejects unknown/disabled SKUs |
| user / `userKey` | **Server** | Derived from `validateInitData`; the client's claimed uid is never trusted |
| entitlement target | **Server** | Computed from SKU + current entitlement state |
| amount | **Server** | Recomputed from the catalog on every request; the client's number is discarded |
| status | **Server** | State machine in §14 |
| `currency` | **Server** | Always `XTR`; a non-XTR `pre_checkout_query` is rejected |

#### Entitlement

| Entitlement class | Authority | v1? |
|---|---|---|
| Cosmetic (skin/palette) | **Server** — `ofeliya_pay.entitlements` | ✅ v1 |
| Lab branch | **Server** | ✅ v1 (paid permanent progression, §12) |
| Permanent stat (HP/damage/move/magnet/income) | **Server** | ⚠️ v1.1 — see §12.2 for the ordering risk |
| Prestige | **Server** | ⚠️ v1.1 — cosmetic/prestige only, no combat effect |
| Restore state | **Server** | ✅ v1 (reinstall → restore) |
| Earned (achievement) cosmetic | **Client-authoritative is acceptable** | Already shipped; it is *not* paid value. The client may keep owning achievement cosmetics locally — but a *paid* cosmetic must come from the server |

#### Refund

| Field | Authority |
|---|---|
| requested | Server (operator/admin action) |
| accepted | Server |
| completed | Server — **only after Telegram confirms `refundStarPayment` returned `true`** |
| entitlement revoked | Server — soft-revoke (`revoked_at`), ledger row immutable |
| currency restored | Server — only if/when a wallet exists; in v1, "restored" = entitlement revoked |

#### Reconciliation

| Layer | Authority |
|---|---|
| Server state | **Authoritative** — `ofeliya_pay` |
| Telegram state | **Authoritative for money** — but **not queryable**: Telegram exposes no payment-list API (§15.3) |
| Client cached state | **Never authoritative.** A cache hint only; the client must re-read from the server |

---

## 6. Threat model

Format: `attack/failure → expected invariant → required defense → test`.
`T#` = unit, `I#` = integration, `C#` = contract, `E#` = synthetic E2E, `R#` = race/concurrency.

| # | Attack / failure | Expected invariant | Required defense | Test |
|---|---|---|---|---|
| 1 | Duplicate purchase request (same opId, same params) | Exactly one operation, one grant, one charge | `UNIQUE(user_key, kind, op_id)`; fingerprint match → `200` replay of stored result | T4, I2, E2 |
| 2 | Same `opId`, **different SKU** | No second grant; request rejected | Fingerprint includes SKU → mismatch → **`409 FAIL CLOSED`** | T4, R3 |
| 3 | Same `opId`, **different branch/level** | No second grant; request rejected | Fingerprint includes the *computed entitlement target* (branch + level), not the client's word | T4, R3 |
| 4 | Same `opId`, **different user** | No cross-user leakage | `opId` scoped by `user_key`; the unique index is `(user_key, kind, op_id)`; fingerprint includes `userKey` | T4, R4 |
| 5 | Replay of an old successful response | No new grant | Operation already exists → replay stored result; `operations` is append-only so it cannot re-fire | T4, I2 |
| 6 | Response `branchId` mismatch vs request | Client must not apply | Server returns the **authoritative** entitlement snapshot; client compares and **ignores** a mismatch (renders nothing, re-fetches) | C2, E3 |
| 7 | Response SKU mismatch | Client must not apply | Same as #6 — client never trusts response fields; it re-reads `/api/storefront/state` | C2 |
| 8 | Response `opId` mismatch | Client must not apply | Same as #6 — plus the client aborts the pending flow | C2 |
| 9 | Client retries after timeout | No double charge, no double grant | Same opId + same params → replay; the external anchor `telegram_payment_charge_id UNIQUE` blocks a second charge row | I2, E3 |
| 10 | Server committed, client timed out | User is not charged without delivery | Replay returns `ENTITLED` + entitlement; client converges. If the runtime was mid-restart, the **charge-without-delivery guard** fulfils rather than drops (port `alertPaymentWhileDisabled`) | E3, I4 |
| 11 | Telegram confirms twice | One operation, one grant | `UNIQUE(telegram_payment_charge_id)` | T3, R1 |
| 12 | Webhook duplicated | Idempotent no-op | Same as #11 | E2 |
| 13 | Webhook reordered (refund before purchase confirm) | Refund must not resurrect/corrupt state | Refund requires a **terminal** purchase operation; a refund arriving first is parked `REFUND_PENDING` and retried, never applied to a non-existent grant | R5 |
| 14 | Refund races with spend | No spend on a revoked entitlement | **v1 has no spendable currency** → class eliminated. If a wallet is added: spend is refused when `entitlements.revoked_at IS NOT NULL` | R6 |
| 15 | Refund races with purchase (same SKU) | No double-grant, no lost refund | `pg_advisory_xact_lock(userId)` serializes both paths; refund waits | R7 |
| 16 | Purchase races with purchase (different SKUs, same user) | Both or neither — never one | Same advisory lock; distinct `opId`s → distinct operations; the lock serializes | R8 |
| 17 | Balance update lost | *(eliminated in v1)* | If a wallet exists: derive from ledger, never increment a counter | n/a (v1) → T7 (later) |
| 18 | Stale client cache | Client never shows a false entitlement | Client renders from `/api/storefront/state`; cache is display-only; purchase completion forces a re-read | C3, E4 |
| 19 | Two browser/device sessions | One grant, one charge | Server-side idempotency + advisory lock; the second session sees the same entitlement on re-read | R9 |
| 20 | Offline / reconnect | No phantom unlock | On reconnect the client re-reads server state; local storage holds no paid entitlement | C3, E4 |
| 21 | Malicious `localStorage` edit | Zero effect on paid value | Paid entitlement lives **only** server-side; the client copy is decorative | T8, C1 |
| 22 | Forged client entitlement | Rejected | Server never accepts an entitlement from the client; it is a derived read model | T8, C1 |
| 23 | Forged price | Rejected | Server recomputes the amount from the catalog; the client's amount is ignored; the final `total_amount` in `SuccessfulPayment` must equal the server's amount | T5, I5 |
| 24 | Forged currency | Rejected | Only `XTR` accepted; `decidePreCheckout` rejects anything else | T5 |
| 25 | Reordered API responses | No stale application | Every state-changing response carries the operation id + a monotonic `stateVersion`; the client discards a response older than what it has applied | C3 |
| 26 | Rollback after server success | The grant survives | The grant lives in Postgres `ofeliya_pay`, not in the client save; a client rollback re-reads and re-converges | C3, E4 |
| 27 | Server crash between ledger write and entitlement write | No half-grant | **One DB transaction** covering operation insert + entitlement upsert (§13). The ledger is never written without the entitlement | I1, R10 |
| 28 | Bot restart between `pre_checkout_query` and `successful_payment` | No orphan grant | The purchase intent row is `PENDING`; fulfillment is driven by the `successful_payment` update alone | I4 |
| 29 | Operator replays an old `invoice_payload` | No second grant | `invoice_payload` carries the op id; the operation is already terminal → replay, no new grant | T4, E2 |
| 30 | Admin/ops mis-runs a reconcile repair | No silent mutation | Repairs are **manual, audited and idempotent** (§15.4) | I6 |

### 6.1 Residual risks that do not disappear with good code

| Risk | Why it survives | Mitigation |
|---|---|---|
| **Chargeback / dispute** | Telegram documents it: *"if the buyer initiates a chargeback with the relevant payment provider … the funds may be debited from your balance. This is outside of Telegram's control."* | Fulfill on `successful_payment`, not on final settlement; keep `raw_payload`; define a revocation path (§14.3) |
| **Supabase Free pausing the project** | `deploy/RENDER.md` states *"Supabase Free may pause inactive projects."* A paused project means the ledger is unreachable → purchases must **fail closed** and users see a clear retry, not a phantom grant | Move to a paid/production Postgres tier **before** real money (§20 Go/No-Go) |
| **Render Free sleeping after 15 idle minutes** | Same doc | A sleeping server means a 10-second `pre_checkout_query` deadline can be missed → §12.3 requires a **warm, non-sleeping** payment host |
| **Single-process lock semantics** | `withProfileLock` is in-memory | Use `pg_advisory_xact_lock` (DB-wide) for all money paths |
| **Entitlement-grant ≠ value-delivered** | The game is client-side; a granted entitlement can be "used" before the server sees it | Acceptable for cosmetics. **For paid permanent power, the grant must be re-read at run start** (§12.2) |

---

## 7. Idempotency contract

### 7.1 The key

```
opId            = client-proposed, opaque, /^[A-Za-z0-9_-]{16,64}$/
                  (same shape OFELIYA already uses for submissionId)
```

### 7.2 The binding

The server computes and stores:

```
opFingerprint = sha256(
    userKey            # server-derived from validated initData
  | opType             # "PURCHASE" | "REFUND"
  | sku                # server-resolved sku id
  | amountStars        # server-computed
  | entitlementTarget  # server-computed: e.g. "lab.branch.magnet.level.3"
  | catalogVersion     # pins price to the catalog version used
)
```

Bound to, at minimum, all five required dimensions: **user · operation type · subject/SKU ·
amount · entitlement target** — plus `catalogVersion`, which pins the price so a later catalog edit
cannot silently reinterpret an old operation.

### 7.3 Repeat semantics

| Situation | Response | Code |
|---|---|---|
| New `opId`, no prior row | Create operation | `202` (intent) |
| Same `opId`, **same fingerprint**, operation non-terminal | Return current operation state (pending) | `200` |
| Same `opId`, **same fingerprint**, operation terminal | Return stored result + authoritative snapshot | `200` |
| Same `opId`, **different fingerprint** | **Reject. Do not return the previous success.** | **`409` `IDEMPOTENCY_KEY_REUSE`** |
| Same `telegram_payment_charge_id`, any opId | Second charge → already recorded | `200` replay (of the original) |
| Same `telegram_payment_charge_id`, different `opId`/fingerprint | Conflict — impossible in practice; must alert | `409` `CHARGE_ID_CONFLICT` |

**The fail-closed rule, stated once:** a repeated idempotency key whose parameters differ **must never**
return success or a duplicate of the earlier operation. It returns `409` and changes nothing.

This is *not* a new invention for OFELIYA — it is the `submissionId` / `submissionHash` contract from
`server/index.mjs` (`33d8ba12d5`), generalised.

### 7.4 Two keys, two purposes — do not conflate them

| Key | Origin | Purpose | Uniqueness |
|---|---|---|---|
| `opId` | Client-proposed | Idempotent **retry** of one logical intent | `UNIQUE(user_key, kind, op_id)` |
| `telegram_payment_charge_id` | Telegram | The **money** identity; a second charge for it is a bug or an attack | `UNIQUE(telegram_payment_charge_id)` |

A purchase is complete when **both** are recorded. Either alone is insufficient:
`opId` alone could be a retry; `charge_id` alone could be a forwarded invoice paid by someone else.

### 7.5 HTTP semantics for the purchase endpoint

| Code | Meaning |
|---|---|
| `202` | Intent accepted; an invoice must be presented. Body carries the server-minted `invoice_payload` and the amount |
| `200` | Idempotent replay of a known operation (same fingerprint) — carries the same shape as the original response, plus `replayed: true` |
| `409` | Idempotency-key reuse with different parameters, or a one-time-SKU conflict, or a charge-id conflict |
| `400` | Malformed request (bad `opId` shape) |
| `401` / `403` | Missing or invalid `initData` signature |
| `404` | Unknown or disabled SKU |
| `410` | Offer expired (intent TTL) |
| `422` | Valid request, unsatisfiable state (entitlement already maxed, prerequisites unmet) |
| `429` | Rate limited |
| `503` | Ledger unreachable → **fail closed**; the user is not charged and no entitlement is granted |

**503 is the critical one.** If the financial store is unavailable, the purchase must not proceed. The
client shows a retry, and **no invoice is presented**.

---

## 8. Ledger architecture

### 8.1 Decision

**Append-only operation ledger + a materialized current-state read model, in the existing Supabase
Postgres. Not event sourcing.**

Rationale:

| Criterion | Append-only ledger | Event sourcing | Mutable counter row |
|---|---|---|---|
| Auditability of money | ✅ every state change is a row | ✅ | ❌ history lost |
| Idempotency for free | ✅ `UNIQUE` on the external id | ⚠️ needs projection logic | ❌ |
| Implementation cost for OFELIYA's scale | ✅ one table + one index set | ❌ overkill | ✅ |
| Refund modelling | ✅ a refund is a new operation referencing the original | ✅ | ❌ |
| Recovery from a bad projection | ✅ rebuild from the ledger | ✅ | ❌ |
| Fit with the existing stack | ✅ same Postgres, same RPC pattern | ❌ | ⚠️ |

OFELIYA is a single small game with a modest user base. **Event sourcing would be architecture for its
own sake.** The ledger is not an event log — it is a table of *operations*, each of which is a business
event with a durable identity.

### 8.2 Transaction boundaries

**One Postgres transaction** covers the entire money mutation:

```
BEGIN;
  -- 1. lock the user (serializes all money paths for this user)
  SELECT pg_advisory_xact_lock(hashtextextended(user_key, 0));
  -- 2. idempotency check
  SELECT * FROM ofeliya_pay.operations WHERE user_key=$1 AND kind='PURCHASE' AND op_id=$2 FOR UPDATE;
      -- missing            -> continue
      -- found, same fp     -> ROLLBACK; return stored result (replay)
      -- found, other fp    -> ROLLBACK; 409
  -- 3. charge-id check
  SELECT 1 FROM ofeliya_pay.operations WHERE telegram_payment_charge_id=$3;  -- -> replay / conflict
  -- 4. INSERT operation  (UNIQUE violations -> mapped to 409/replay)
  -- 5. UPSERT entitlement
  -- 6. INSERT grant/audit row
COMMIT;
```

Everything that must be atomic — the operation row, the entitlement, the audit row — is in the same
transaction. The **only** thing outside a transaction is the Telegram API call for a *refund*
(§9.4), because a network call must not hold a row lock.

### 8.3 Unique constraints (the heart of the design)

| Constraint | Purpose |
|---|---|
| `operations.telegram_payment_charge_id UNIQUE` | One Telegram charge → one operation. Blocks double-credit on a duplicated webhook |
| `operations (user_key, kind, op_id) UNIQUE` | One logical intent per user. Blocks duplicate grants on a retry |
| `operations.op_fingerprint` (stored, indexed with user_key) | Detects key reuse with different parameters → `409` |
| `entitlements (user_key, entitlement_key) PRIMARY KEY` | One row per entitlement → entitlement is a *state*, not a log |
| `catalog_sku.sku PRIMARY KEY` | The catalog is the only SKU namespace |
| Partial unique index, one-time SKUs | *(see below)* |

**One-time SKU guard** (ported in spirit from `coder_survival` migration `060`):

```sql
CREATE UNIQUE INDEX uq_ofeliya_one_time_sku
  ON ofeliya_pay.operations (user_key, sku)
  WHERE sku IN (/* server-side list of one-time SKUs */)
    AND status IN ('PENDING','PAID','ENTITLED');
```

The list of one-time SKUs must come from the catalog (`catalog_sku.one_time_per_user`), not a literal
in the index — implement it as a **partial index per rule** or as a trigger that reads the catalog.
A literal list is acceptable for v1 (a handful of SKUs) but must be documented as such.

> *"A refunded purchase frees the slot again (deliberate: refund = can rebuy)"* — `coder_survival`
> migration 060. Adopt the same rule.

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
the refund transaction in §9.4. It is also derivable from `operations` — and a reconcile job
(§10) must be able to prove the two agree.

```
entitlement(user, key) = level of the latest non-revoked
                          entitlement-granting operation for (user, key)
```

### 8.6 Refund representation

A refund is **a new operation row** (`kind='REFUND'`, `parent_operation_id` → the purchase), *plus* a
status transition on the original purchase row and a soft-revoke on the entitlement. The purchase's
`operations` row is not deleted — its `status` moves forward, never backward.

### 8.7 Reconcile representation

Findings are **rows**, not log lines: `ofeliya_pay.reconcile_findings(finding_key UNIQUE, kind,
operation_id, detail JSONB, first_seen_at, resolved_at, resolution)`. Repeat runs are idempotent via
`finding_key`.

### 8.8 Why NOT the existing `ofeliya_private.state` JSONB blob

The current durable-state store rewrites the **entire document** on each flush, guarded by a revision
and a single writer. That is fine for scores and profiles. It is **not** acceptable for money:

- A whole-document rewrite means a money mutation rewrites unrelated rows → larger blast radius, larger
  conflict window.
- There is no way to express `UNIQUE(telegram_payment_charge_id)` in it.
- The revision conflict model is **last-writer-wins at document level**; concurrent purchases for
  different users would collide on the same document.
- `last_commit` + payload equality gives *document-level* idempotency, not per-charge idempotency.

**Decision: `ofeliya_pay` lives beside `ofeliya_private` in the same Supabase project, accessed through
a new RPC in the same style.** The state blob and the money tables are never written in the same
transaction.

---

## 9. Telegram Stars

### 9.1 Division of responsibility

#### Telegram owns
- The invoice UI and the Stars balance.
- `XTR` as the only currency for digital goods and services.
- `telegram_payment_charge_id` — the unique payment identifier.
- `refundStarPayment(user_id, telegram_payment_charge_id)` → `true` on success.
- The 10-second `pre_checkout_query` deadline.
- Chargeback handling (out of its own control, but it defines the identifier).
- The **test environment** for Stars payments.

#### OFELIYA server owns
- Minting the `invoice_payload` (≤128 bytes) and binding it to a server operation.
- Answering `pre_checkout_query` **within 10 seconds** — with the amount and currency re-read from the
  server catalog, never from the client's request.
- Verifying `successful_payment`: `currency === 'XTR'`, `total_amount === operations.amount_stars`,
  `invoice_payload` resolves to a live `PENDING` operation owned by this user.
- Idempotency (§7).
- The ledger, the entitlement grant, the refund record, the reconciliation.
- Failing closed when the ledger is unreachable.

#### Client owns
- Initiating the UI (open the storefront, request an invoice).
- Showing `PENDING` / `PAID` / `ENTITLED` / `REFUNDED` exactly as the server reports them.
- Requesting authoritative state and rendering it.
- **Never** deciding that a payment succeeded.

### 9.2 Verified API facts (fetched from `core.telegram.org`)

| Method / object | Verified facts |
|---|---|
| `sendInvoice` | `payload` = **1–128 bytes**, bot-defined, not shown to the user; `provider_token` = **empty string for XTR**; `currency` = `"XTR"`; `prices` = **exactly one `LabeledPrice` for XTR**; `max_tip_amount`/`suggested_tip_amounts` **not supported for XTR**; `need_name`, `need_phone_number`, `need_email`, `need_shipping_address`, `send_phone_number_to_provider`, `send_email_to_provider`, `is_flexible` are **ignored for XTR**; `title` 1–32 chars; `description` 1–255 chars; `start_parameter` controls forward behaviour |
| `createInvoiceLink` | same as above plus `subscription_period` — **must be `2592000`** (30 days), currency must be `XTR`, subscription price **must not exceed 10000 Stars**, multiple concurrent subscriptions per user allowed. `business_connection_id` is **XTR-only** |
| `SuccessfulPayment` | `currency`, `total_amount`, `invoice_payload`, `subscription_expiration_date`, `is_recurring`, `is_first_recurring`, `shipping_option_id`, `order_info`, **`telegram_payment_charge_id`**, `provider_payment_charge_id` |
| `PreCheckoutQuery` | `id`, `from`, `currency`, `total_amount`, `invoice_payload`, `shipping_option_id`, `order_info` |
| `FailedPayment` | the failure counterpart (fields per Bot API) |
| `refundStarPayment` | `user_id` (Integer, **required**), `telegram_payment_charge_id` (String, **required**) → returns `true` on success |
| Docs statement | *"Your bot must reply using answerPreCheckoutQuery within 10 seconds after receiving this update or the transaction is canceled."* |
| Docs statement | *"You must always check that you received a successful_payment update before delivering the goods or services purchased by the user."* |
| Docs statement | *"It is critical to make sure your bot only accepts multiple payments when the order can be processed correctly."* (multi-chat / inline invoice warning) |
| Docs statement | *"Store the SuccessfulPayment's telegram_payment_charge_id – it may be needed to issue a refund in the future."* |
| Testing | *"You can freely test payments in Telegram Stars by connecting your bot to Telegram's dedicated test environment."* |
| Live checklist | `/terms` and `/support` commands; *"Use backups to make sure that you don't lose data about your users' payments."*; *"You as the bot owner have full responsibility in case any conflicts or disputes arise. You must be prepared to correctly process disputes and chargebacks."* |

> Sources fetched: `https://core.telegram.org/bots/payments-stars`,
> `https://core.telegram.org/bots/payments-stars.md`,
> `https://core.telegram.org/bots/api/methods/{sendinvoice,createinvoicelink,refundstarpayment}.md`,
> `https://core.telegram.org/bots/api/types/{successfulpayment,precheckoutquery}.md`.
> Field names quoted verbatim from those pages.

### 9.3 The Stars flow in OFELIYA

```
client                OFELIYA server                         Telegram
  │ POST /api/storefront/purchase {opId, sku}
  │────────────────────────────────▶ validate initData → userKey
  │                                  resolve SKU → amount, target
  │                                  fingerprint(opId)
  │                                  BEGIN; lock user; INSERT operation(PENDING)
  │◀──────────── 202 {opId, invoice_payload, amount, currency:'XTR'}
  │ open invoice UI
  │──────────────────────────────────────────────────────▶ sendInvoice(XTR)
  │◀────────────────────────────────────────────────────── pre_checkout_query
  │                                  ◀────────────────────── (within 10s)
  │                                  re-read catalog → answerPreCheckoutQuery(true|false)
  │◀────────────────────────────────────────────────────── successful_payment
  │                                  ◀──────────────────────
  │                                  verify currency+amount+payload
  │                                  BEGIN; lock user; INSERT operation(PAID→ENTITLED);
  │                                  UPSERT entitlement; COMMIT
  │ GET /api/storefront/state
  │────────────────────────────────▶ authoritative snapshot
  │◀──────────── 200 {entitlements, purchases}
```

### 9.4 Two answers are required, and only one of them is the grant

| Update | Meaning | Server obligation |
|---|---|---|
| `pre_checkout_query` | *"May I charge?"* | Answer **≤10s**. Re-answering `true` does **not** entitle. If the ledger is down → answer `false` with a human-readable reason (**fail closed**, do not let a charge start that cannot be fulfilled) |
| `successful_payment` | *"The charge happened."* | **This** is where the entitlement is granted, in a transaction |

A charge that starts but cannot be fulfilled is a **charge-without-delivery** — the worst class of bug
in this system. Therefore: if the ledger is unreachable at `pre_checkout_query` time, **reject the
checkout**. Do not accept and hope.

---

## 10. Storefront

The Storefront is a **presentation layer over an authoritative catalog**. It is the last thing built,
