| `updated_at` | The **only** mutable column on an operation row besides `status`. History is otherwise append-only |
| RLS | `alter table ofeliya_pay.* enable row level security;` + `grant ... to service_role` — mirroring `ofeliya_private` |
| RPC | One `ofeliya_pay_call(op text, ...)` function per the existing pattern, or a dedicated money gateway function |

### 15.4 What can be reused from the existing migrations

**There are no existing "migrations" in OFELIYA** in the DDL sense — `deploy/ofeliya-state.sql` is a
single idempotent script with `create schema if not exists` / `create table` (no `if not exists` on the
table) that is applied **once, manually**. So:

- There is **no migration framework** to reuse. The money schema should be a **separate, versioned,
  ordered script set** (e.g. `deploy/ofeliya-pay/001_catalog.sql`, `002_operations.sql`, …) with a
  `schema_migrations` table, because money DDL must be replayable and auditable.
- The **discipline** is reusable verbatim: private schema, revoke from `public`/`anon`/`authenticated`,
  grant to `service_role`, `security invoker`, `set search_path = ''`.
- The `ofeliya_private.state` table is **untouched** by the money work.

---

## 16. API contracts

Minimal surface — six endpoints. Everything else is an implementation detail.

### 16.1 `GET /api/storefront/catalog`

```
→ no auth required for the catalog itself; auth required for "owned" decoration
← 200 {
    catalogVersion: 42,
    skus: [
      { sku, kind, title, description, priceStars, currency:'XTR',
        entitlement: { kind, key, maxLevel },
        available: true, unavailableReason: null,
        oneTimePerUser: false, prerequisiteSku: null }
    ]
  }
```
- Idempotency: N/A (read-only, no side effects).
- Failure: `503` if the catalog cannot be read → the storefront renders "магазин временно недоступен".
- The client treats `priceStars` as **informational** only.

### 16.2 `GET /api/storefront/state`

```
→ { platform:'telegram', initData }
← 200 {
    userKey,                       // opaque, e.g. 'telegram:123…'
    entitlements: [ { key, level, kind, revoked:false } ],
    purchases: [ { opId, sku, status, amountStars, createdAt } ],
    stateVersion: 1732            // monotonic; the client discards older responses
  }
```
- Auth: `validateInitData` → `403` on an invalid signature.
- Idempotency: N/A (read-only).
- This is the **only** source the client renders entitlements from.

### 16.3 `POST /api/storefront/purchase` — create the intent

```
→ { platform, initData, opId, sku }
← 202 {
    opId, sku, status:'PENDING',
    payment: { currency:'XTR', amountStars, invoicePayload },
    stateVersion
  }
```
Server validation order: identity → `opId` shape → SKU exists & enabled → prerequisite → entitlement
state → idempotency (fingerprint) → create the intent.
- `200` if the operation already exists with the **same** fingerprint (replay, with `replayed:true`).
- `409` `IDEMPOTENCY_KEY_REUSE` if the same `opId` has a different fingerprint.
- `409` `ONE_TIME_ALREADY_OWNED` for a one-time SKU already owned.
- `422` for unsatisfiable state (maxed, prerequisite missing).
- `404` unknown/disabled SKU. `400` malformed `opId`. `503` ledger unavailable → **no intent created**.
- `invoicePayload` is server-minted, ≤128 bytes, opaque, and encodes the operation id.

### 16.4 `POST /api/storefront/fulfill` — the money endpoint

This is the endpoint the **bot** calls when Telegram delivers `successful_payment`. It is **not** a
public client endpoint.

```
→ { platform, initData, successfulPayment: {…} }   // or a bot-authenticated variant
← 200 { opId, status:'ENTITLED', entitlement:{key,level}, stateVersion }
```
Server validation: identity → `currency === 'XTR'` → `total_amount === operations.amount_stars` →
`invoice_payload` resolves to a live `PENDING` operation owned by this user → charge id not already
used → transaction (§12.1).
- `409` `CHARGE_ID_ALREADY_APPLIED` if the charge id exists → returns the **original** result (replay).
- `409` `PRICE_MISMATCH` if the amount differs → the operation is marked `REJECTED`, **nothing is granted**, and an alert fires.
- `422` if the intent is expired or already terminal.
- `503` if the ledger is unavailable → **nothing is granted**. The charge-without-delivery guard (§14) handles the late arrival.

### 16.5 `POST /api/storefront/restore`

```
→ { platform, initData }
← 200 { entitlements: [ { key, level, kind } ] }
```
- Read-only. Never creates or mutates. Safe to call from any device, any number of times.
- `403` on an invalid signature. No `503` fallback to local data — the client shows "не удалось
  восстановить покупки" rather than a stale local copy.

### 16.6 `POST /api/admin/reconcile` — admin only

```
→ { op:'scan' }                    → 200 { findings: [...] }
→ { op:'repair', findingKey, reason, chargeReference? }
                                     → 200 { applied:true } | 409 { error:'manual-review-required' }
```
- Auth: an **admin token**, not a game session. Separate from `OFELIYA_STATE_TOKEN`.
- `scan` is read-only and idempotent. `repair` requires an explicit `reason` and writes `grants_log`.
- Repairs that would grant value without a charge reference are **rejected** (§14.4).

### 16.7 API summary

| Endpoint | Auth | Method | Idempotent | Writes money state |
|---|---|---|---|---|
| `GET /catalog` | none | GET | n/a | no |
| `GET /state` | initData | GET | n/a | no |
| `POST /purchase` | initData | POST | ✅ by `opId` | creates the intent |
| `POST /fulfill` | bot | POST | ✅ by charge id | ✅ grants |
| `POST /restore` | initData | POST | ✅ read-only | no |
| `POST /admin/reconcile` | admin token | POST | ✅ | only on explicit repair |

---

## 17. Client/server trust matrix

| Field | Client may send? | Server trusts? | Server recomputes? | Persisted where |
|---|---|---|---|---|
| `platform` | ✅ | ✅ (allowlist `max`/`telegram`) | — | — |
| `initData` | ✅ | ✅ (signature) | — | — |
| user id / uid | ❌ **derived only** | ✅ derived | ✅ from `validateInitData` | `operations.user_key`, `entitlements.user_key` |
| `opId` | ✅ | ⚠️ only as a *proposal* | ✅ bound into the fingerprint | `operations.op_id` |
| `opFingerprint` | ❌ | — | ✅ computed | `operations.op_fingerprint` |
| SKU | ✅ (request) | ⚠️ only to *look up* | ✅ resolved → price + entitlement target | `operations.sku` |
| price / amount | ❌ | ❌ | ✅ from `catalog_sku` | `operations.amount_stars` |
| currency | ❌ | ❌ (always `XTR`) | ✅ | `operations.currency` |
| branchId | ❌ (intent only) | ❌ | ✅ the server decides the next legal branch/level | `operations.entitlement_key/level` |
| level / newLevel | ❌ | ❌ | ✅ server computes from the current entitlement | `entitlements.level` |
| Stars transaction id | ❌ | ❌ from the client | ✅ from Telegram's `successful_payment` | `operations.telegram_payment_charge_id` (UNIQUE) |
| invoice payload | ❌ | ❌ from the client | ✅ server-minted | `operations.invoice_payload` |
| entitlement | ❌ | ❌ | ✅ derived from `entitlements` | `ofeliya_pay.entitlements` |
| wallet balance | ❌ | ❌ | ✅ derived from the ledger | *(none in v1)* |
| purchase status | ❌ | ❌ | ✅ | `operations.status` |
| refund status | ❌ | ❌ | ✅ | `operations.status` (`REFUND_*`) |
| catalog version | ❌ | ❌ | ✅ | `operations.catalog_version` |
| `stateVersion` | ❌ (read) | — | ✅ monotonic | response only |
| admin token / reason | ✅ (admin) | ✅ | — | `grants_log` |

**Reading the matrix:** every row where "Client may send" is ✅ and "Server trusts" is ⚠️ or ❌ is a
place where the client *suggests* and the server *decides*. Those are the only legitimate request
fields. Everything else is either derived or forbidden.

---

## 18. Testing strategy

### 18.1 Unit (pure, fast, no DB)

| ID | Subject | Assertion |
|---|---|---|
| T1 | fingerprint | The same inputs → the same fingerprint; any single changed input → a different fingerprint |
| T2 | `opId` shape | `/^[A-Za-z0-9_-]{16,64}$/`; rejects empty, unicode, over-length, wrong charset |
| T3 | charge-id uniqueness mapping | A duplicate `telegram_payment_charge_id` → `409`/replay, never a second grant |
| T4 | idempotency resolver | Same key + same fingerprint → replay; same key + different fingerprint → `409` **and no write** |
| T5 | SKU resolution | Unknown → 404; disabled → 404; wrong currency → rejected; amount recomputed from the catalog |
| T6 | entitlement progression | The server computes the next legal level; an out-of-range request is refused; prerequisites are checked |
| T7 | ledger derivation | The derived balance equals the sum of the ledger rows |
| T8 | client-side distrust | A forged entitlement/price/balance in the request is ignored — the server value wins |
| T9 | `decidePreCheckout` | Non-`XTR` → reject; `PAYMENTS_ENABLED !== 'true'` → reject; the rejection message carries no raw identifiers |
| T10 | price mismatch | `total_amount != server amount` → `PRICE_MISMATCH`, no grant |

### 18.2 Integration (real Postgres)

| ID | Subject | Assertion |
|---|---|---|
| I1 | atomic grant | Killing the transaction between the operation insert and the entitlement upsert leaves **neither** |
| I2 | retry | The same `opId` twice → one operation, one entitlement, identical responses |
| I3 | advisory lock | Two concurrent sessions for one user serialize |
| I4 | charge-without-delivery | A `successful_payment` arriving after the intent TTL is still fulfilled (or explicitly parked), never silently dropped |
| I5 | amount enforcement | A mismatched `total_amount` grants nothing |
| I6 | reconcile | Each finding type is detected; the repair is idempotent and audited |
| I7 | RLS / grants | `anon`/`authenticated`/`public` cannot read `ofeliya_pay`; only `service_role` can |
| I8 | the edge gateway | An unauthorized token → `401`; an oversized body → `413`; an unknown op → `400` |

### 18.3 Contract (client ↔ server schema)

| ID | Subject | Assertion |
|---|---|---|
| C1 | The client never authors value | The client's request schema **cannot express** a price, a level, an entitlement or a balance |
| C2 | Response integrity | The client discards a response whose `opId`/SKU/branch does not match the request, and re-fetches |
| C3 | Monotonic state | A response with a `stateVersion` lower than the applied one is ignored |
| C4 | Fail-closed rendering | A failed/unreachable state never renders "оплачено" |
| C5 | The Muse boundary still holds | The collection still has no wallet; the Lab still has no purchase control; the feature flags still have no economy entries |

### 18.4 E2E synthetic (a fake payment provider)

A `FakeStarsProvider` implements `sendInvoice` / `pre_checkout_query` / `successful_payment` /
`refundStarPayment` with scriptable behaviours.

| ID | Scenario |
|---|---|
| E1 | Happy path: purchase → entitlement → the client renders it |
| E2 | Duplicate webhook → one grant, the second is a no-op |
| E3 | Timeout after the server commits → the client retries → it converges, no double grant |
| E4 | Reinstall / clear local storage → restore returns the same entitlements |
| E5 | Refund → the entitlement is revoked → the client shows it as revoked |
| E6 | A price change between the intent and the charge → `PRICE_MISMATCH`, no grant |
| E7 | The provider confirms with a different `total_amount` → refused |

### 18.5 Real Telegram Stars (test environment)

Telegram provides a **dedicated test environment** for Stars payments
(*"You can freely test payments in Telegram Stars by connecting your bot to Telegram's dedicated test
environment"*).

| ID | Scenario |
|---|---|
| R-T1 | A test-env invoice completes and the entitlement is granted |
| R-T2 | The `pre_checkout_query` deadline is met with a measurable margin |
| R-T3 | `refundStarPayment` in the test environment returns `true` and the entitlement is revoked |
| R-T4 | The `successful_payment` fields match the documented contract exactly (field names, types) |

**Precondition:** the bot must be connected to the test environment, and the production bot token must
**never** be used for a test. No real payment is executed in this audit or in the pre-Go/No-Go phases.

### 18.6 What is explicitly out of scope for testing

- Real-money charges (production Stars) — only after §16's Go/No-Go.
- Chargeback simulation — Telegram does not expose an API for it; handled procedurally.

---

## 19. Race matrix

| ID | Concurrency scenario | Expected result |
|---|---|---|
| R1 | The same purchase × 2 simultaneously (same `opId`) | Exactly **one** operation, **one** entitlement, **one** charge. The second gets a `200` replay. `UNIQUE(user_key,kind,op_id)` + the advisory lock enforce it |
| R2 | The same `opId` × 2 with **different** `opId` values but the same SKU | Two operations, two entitlements, two charges — legal, because they are two intents. If the SKU is one-time → the second is `409 ONE_TIME_ALREADY_OWNED` |
| R3 | The same `opId` with a **different subject** (SKU A vs SKU B) | The second is **`409 IDEMPOTENCY_KEY_REUSE`**, and **nothing is written**. The fingerprint differs |
| R4 | The same `opId` from **two different users** | Two independent operations — `opId` is scoped by `user_key`. No cross-user effect |
| R5 | A refund webhook arrives **before** the purchase fulfillment | The refund finds no terminal purchase → it is **parked** (`REFUND_PENDING`, no revoke) and retried. It never applies to a non-existent grant |
| R6 | Refund vs **spend** | *(v1: no spend)*. In v2: the spend is refused if the entitlement is revoked; the advisory lock serializes both |
| R7 | Refund vs **entitlement use** | The revoke is visible immediately (revoke-first, §13.1). A concurrent use may complete — documented asymmetry |
| R8 | Two **different** SKUs purchased simultaneously by one user | Both succeed, serialized by the advisory lock. Both entitlements present |
| R9 | Two **devices** purchase the same one-time SKU simultaneously | One succeeds; the other is `409 ONE_TIME_ALREADY_OWNED`. The partial unique index is the backstop even if the advisory lock is bypassed |
| R10 | A **crash between the ledger write and the entitlement write** | Neither exists — one transaction (§12.1). Verified by I1 |
| R11 | **Reconcile runs during a purchase** | The reconcile reads committed rows only. It may observe an operation in `PENDING` — it does not flag it, and it never blocks the write path |
| R12 | Two `successful_payment` updates for the **same charge id**, concurrently | One insert wins; the other gets `409 CHARGE_ID_ALREADY_APPLIED` → replay of the original. One grant |

---

## 20. Implementation roadmap

Ordering is derived from the audit: the ledger substrate already exists (Supabase), so **S0 is schema,
not infrastructure**. Each phase is independently mergeable and independently revertable.

| Phase | Changed subsystem | Depends on | Tests | Acceptance criteria | Rollback | Parallelizable? |
|---|---|---|---|---|---|---|
| **S0 — authoritative schema + invariants** | `deploy/ofeliya-pay/*.sql` (new), a money RPC in the `ofeliya-state-function.ts` style | — | I1, I7, I8 | `ofeliya_pay` exists; RLS denies `anon`/`authenticated`; the unique constraints exist; a repeated `commit`-style write is rejected | Drop the schema; nothing else depends on it | ✅ yes — a separate agent can own `deploy/ofeliya-pay/**` |
| **S1 — catalog + read model** | `catalog_sku` seeding, `GET /api/storefront/catalog` | S0 | T5, C1 | The catalog is the only price source; a disabled SKU is `404`; the client cannot express a price | Revert the endpoint | ✅ yes |
| **S2 — idempotent purchase operation (no real Stars)** | `operations` write path, `POST /api/storefront/purchase`, a `FakeStarsProvider` | S0, S1 | T1–T4, I2, E1, E2 | The same `opId` twice → one row; a different SKU with the same `opId` → `409`; no grant without a charge | Disable the endpoint (503); the schema stays | ⚠️ shares `server/index.mjs` with other server work — **serialize with other server-touching agents** |
| **S3 — entitlement** | `entitlements`, `grants_log`, `GET /api/storefront/state` | S2 | I1, T8, C1 | The grant is atomic with the operation; the client cannot author an entitlement | `GET /state` returns empty; purchases disabled | ⚠️ same file as S2 |
| **S4 — synthetic payment adapter** | `FakeStarsProvider` → the real provider interface; the `pre_checkout_query` handler | S2, S3 | T9, T10, E3, E6, E7 | The 10s deadline is met with margin; the amount is re-read from the catalog; a mismatch grants nothing | Swap the adapter back to the fake | ✅ yes (a new file) |
| **S5 — refunds** | `POST /api/admin/reconcile` (refund path), `refundStarPayment` | S3, S4 | T3, E5 | Revoke-first ordering; `REFUNDED` ⇒ revoked, always; a failed Telegram call leaves the entitlement revoked | Disable refunds | ⚠️ same file |
| **S6 — reconciliation** | The scan job + `reconcile_findings` + the admin endpoint | S3, S5 | I6 | Each finding type is detected; repairs are manual and audited; the job is safe during a purchase | Disable the job | ✅ yes |
| **S7 — Telegram Stars test environment** | The real provider, the bot wiring, the test-env bot | S4 | R-T1…R-T4 | A real test-env Stars payment completes end-to-end and grants exactly one entitlement | Keep the fake as the default; a flag selects the real one | ✅ yes — but **must not run concurrently with S5** on the same bot token |
| **S8 — Storefront UI** | The client scene, the pending states, the error states | S1, S3, S4 | C2, C3, C4, E1, E4 | The client renders the server state only; an unreachable ledger never renders "оплачено"; the restore flow works | Hide the storefront tab | ✅ yes — **a different agent can own `src/**`** |
| **S9 — paid Lab progression** | `LAB_BRANCH`/`LAB_LEVEL` SKUs, the server-computed next level, the client intent protocol | S2–S4 | T6, R3 | The client sends an *intent*; the server computes the level; the same `opId` cannot buy a different level; the refund/downgrade rule is implemented | Mark the Lab SKUs `enabled=false` | ⚠️ depends on the §11.2 decision (combat power ⇒ v1.1) |

### 20.1 Parallelism map

```
S0 ──▶ S1 ──┬──▶ S2 ──┬──▶ S3 ──┬──▶ S4 ──┬──▶ S5 ──▶ S6
             │         │         │         │         │
             │         │         │         │         └──▶ S7 (needs S4)
             │         │         │         │
             └─────────┴─────────┴─────────┴──▶ S8 (client-only, needs S1+S3 read models)
                                                └──▶ S9 (needs S2–S4 + the §11.2 decision)
```

**File-ownership conflicts** (this is why S2/S3/S5 are marked ⚠️): they all touch `server/index.mjs`,
which is the project's single hottest server file. **Do not run two agents on `server/index.mjs`
simultaneously.** Either serialize them, or split `server/index.mjs` into a router that imports
`server/routes/storefront.mjs` — a mechanical refactor worth doing in S0/S1 to unlock parallelism.

---

## 21. Agent architecture for the next stage

### 21.1 Principles

1. **One owner per file.** No two agents edit the same file concurrently.
2. **Producers never verify their own work.** Codex and Kimi audit; they do not write the audited code.
3. **Shared authority files are single-writer.** `server/index.mjs`, the SQL schema, and `package.json`
   are single-writer and are the integration bottleneck.
4. **Gates are read-only.** A reviewer's first action is never to write.

### 21.2 Ownership map

| Area | Files | Owner | Reviewer |
|---|---|---|---|
| Money schema + RPC | `deploy/ofeliya-pay/**`, `deploy/ofeliya-pay-function.ts` | **MiniMax** (one agent, exclusive) | **Kimi** (adversarial: constraints, RLS, fail-open risks) |
| Server routes | `server/routes/storefront.mjs` (new), `server/storefront/**` | **MiniMax** (exclusive) | **Codex** (gate: contracts, idempotency, error paths) |
| `server/index.mjs` router wiring | `server/index.mjs` | **single integrator** (Codex) after the route module is merged | Codex self-check + Kimi diff review |
| Bot / Telegram provider | `server/telegram-payments.mjs`, `server/bot.mjs` | **MiniMax** (exclusive) | **Kimi** (10s deadline, re-entrancy, redaction) |
| Client Storefront | `src/scenes/StorefrontScene.ts`, `src/systems/StorefrontClient.ts`, `src/ui/**` | **MiniMax** (exclusive) | **Codex** (contract: the client renders only server state) |
| Lab progression (client half) | `src/ui/CollectionBoard.ts`, `src/systems/LabClient.ts` | **MiniMax** (exclusive) | **Codex** |
| Tests — unit/integration | `scripts/check-*.mjs`, `server/*.test.mjs` | **lightweight agents** (one per area, mechanical) | **Codex** (gate: the suite actually covers §7) |
| Race/concurrency tests | `server/storefront-race.test.mjs` | **Kimi** (author + own review is replaced by Codex) | Codex |
| Contract tests | `tests/storefront-contract.mjs` | **lightweight agent** | Codex |
| Docs / runbook / threat model | `docs/**` | **lightweight agent** | Codex |
| CI wiring | `package.json` scripts only (`.github/workflows/**` is **not writable** by the connected App) | **single integrator** | — |
| Release gate | the whole PR series | — | **Codex** (independent gate, exact-head CI read) |

### 21.3 Agent roles

| Agent | Role | Explicitly forbidden |
|---|---|---|
| **MiniMax** | Large autonomous implementations: the schema, the server routes, the client scenes | Touching more than its owned file set; merging |
| **Codex** | Independent gate/review: contract conformance, CI evidence, PR-series integration | Writing the code it reviews |
| **Kimi** | Adversarial security & race review: the §7 threat model as executable tests, the concurrency matrix | Shipping fixes to its own findings without Codex's re-review |
| **Lightweight agents** | Mechanical work: test scaffolding, docs, runbooks, the CI script wiring | Architectural decisions |

### 21.4 Sequence

```
1. Codex gates the client physical acceptance (#241+#242+#243) → main.
2. MiniMax: S0 schema (exclusive) → Codex gate → Kimi schema review.
3. MiniMax: S1 catalog → Codex gate.
4. MiniMax: S2+S3 (one agent, sequential — they share server/index.mjs) → Codex gate → Kimi race review.
5. Kimi: race/concurrency test suite → Codex gate.
6. MiniMax: S4 fake adapter + S5 refunds + S6 reconcile → Codex gate → Kimi threat-model review.
7. MiniMax: S7 real Telegram test env (isolated bot) → Codex gate.
8. MiniMax: S8 Storefront client → Codex contract gate.
9. Decision point: §11.2 — combat power or not → then S9.
```

---

## 22. Open questions

| # | Question | Why it matters | Who decides | Blocking |
|---|---|---|---|---|
| Q1 | Do we sell **combat power** at all, or only cosmetics + non-combat Lab branches? | Determines whether paid power needs ranking partitioning and refund semantics (§11.2) | Product owner | S9 |
| Q2 | Which host runs the payment path? Render Free sleeps after 15 idle minutes → the 10s `pre_checkout_query` deadline is at risk | A missed deadline = a cancelled checkout; a cold start could exceed 10s | Ops | **S7** |
| Q3 | Do we move Supabase off the **Free** tier before real money? *"Supabase Free may pause inactive projects"* → the ledger becomes unreachable → purchases fail closed (correct, but revenue dies) | Availability of the financial system | Ops | **Go/No-Go** |
| Q4 | Is `createInvoiceLink` or `sendInvoice` the right primitive? `sendInvoice` requires the bot to message the user; `createInvoiceLink` works inside a Mini App | Determines the client UX and the forwarding/multiple-payment risk | Product + UX | S7 |
| Q5 | How do we obtain a **Telegram-side payment listing** for disputes? Telegram exposes no payment-list API | §14.3 — the only way to detect "paid but no local operation" | Ops | Go/No-Go |
| Q6 | Do we add a spendable currency in v2? | The entire balance/refund-vs-spend class (§1.3) | Product | v2 |
| Q7 | Is `premium_pass`-style **recurring** Stars in scope? (`createInvoiceLink` supports `subscription_period=2592000`, price ≤ 10000 Stars) | Recurring payments change the refund and the entitlement model entirely | Product | v2 |
| Q8 | Which entity holds the money — OFELIYA directly, or a MAX-platform account? | Affects the account, the tax treatment and the reconciliation | Product + legal | Go/No-Go |
| Q9 | Do we split `server/index.mjs` into modules before S2, to unblock parallel agents? | The ownership map is much cleaner if we do | Engineering | S0/S1 |
| Q10 | What is the **refund policy** window and who may trigger it? | Determines `REFUND_PENDING` handling and the operator runbook | Product + support | S5 |

---

## 23. Go/No-Go criteria for real money

All must be **true** before a single real Stars charge is accepted.

### 23.1 Correctness

- [ ] The §7 threat model is executable: every row has a passing test.
- [ ] The §19 race matrix has a passing test per row (R1–R12).
- [ ] The idempotency contract (§7) is proven: same key + different params → `409` + **no write**.
- [ ] The refund invariant is proven: `REFUNDED` ⇒ the entitlement is revoked, in every path including
      a crash between the revoke and the Telegram call.
- [ ] The atomicity test (I1) proves no half-grant.
- [ ] The reconcile job detects every finding type in §14.1 and its repair is audited + idempotent.

### 23.2 Security

- [ ] `ofeliya_pay` is unreadable by `anon` / `authenticated` / `public`; only `service_role` can.
- [ ] The service-role key is **not** present on the game server (it lives only in the edge function).
- [ ] Every RPC sets `search_path = ''` and is `security invoker`.
- [ ] The admin reconcile endpoint requires a dedicated admin token, not a game session.
- [ ] No log line contains a raw `initData`, `telegram_payment_charge_id`, or `invoice_payload` in a
      user-visible or analytics context (the `redactedDisabledPaymentNotice` discipline).
- [ ] An independent adversarial review (Kimi) has signed off on the whole money path.

### 23.3 Operational

- [ ] The ledger is on a **non-pausing** Postgres tier, with backups and a restore drill.
