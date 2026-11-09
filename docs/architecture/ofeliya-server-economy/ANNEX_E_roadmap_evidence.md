# ANNEX E — Roadmap, Agent Ownership, Open Questions & Evidence Log

**Part of:** `docs/architecture/OFELIYA_SERVER_ECONOMY_PLAN_20261025.md` · Date: 2026-10-25
**Scope:** the implementation roadmap in detail, the parallel-agent architecture, the open questions, the
Go/No-Go criteria, and the full verification evidence.

---

## E.1 The implementation roadmap in detail

The ordering is derived from the audit: the ledger substrate already exists (Supabase Postgres), so **S0
is schema, not infrastructure**. Each phase is independently mergeable and independently revertable.

### E.1.1 S0 — the authoritative schema + invariants

| | |
|---|---|
| **The changed subsystem** | `deploy/ofeliya-pay/*.sql` (new), `deploy/ofeliya-pay-function.ts` (new), the `ofeliya_pay` schema on the existing Supabase project |
| **Dependencies** | none |
| **Tests** | I1 (the atomic grant), I7 (RLS/grants), I8 (the edge gateway) |
| **Acceptance criteria** | `ofeliya_pay` exists and is unreachable from `anon`/`authenticated`/`public`; every unique constraint in Annex C §C.3 is present; a repeated write with the same charge id is rejected; the edge function returns `401`/`413`/`400`/`503` correctly; `search_path = ''` on every function |
| **Rollback** | drop the schema; nothing else depends on it |
| **Parallelizable?** | ✅ yes — an agent can own `deploy/ofeliya-pay/**` exclusively |
| **Do not** | touch `ofeliya_private.state`; add a SQL driver to the game server; reuse `OFELIYA_STATE_TOKEN` |

### E.1.2 S1 — the catalog + the read model

| | |
|---|---|
| **The changed subsystem** | the `catalog_sku` seeding, `GET /api/storefront/catalog` |
| **Dependencies** | S0 |
| **Tests** | T5 (SKU resolution), C1 (the client cannot express a price) |
| **Acceptance criteria** | the catalog is the only price source; a disabled SKU → `404` but still visible in the catalog; the version is exposed; the client renders `priceStars` as informational only |
| **Rollback** | revert the endpoint |
| **Parallelizable?** | ✅ yes |

### E.1.3 S2 — an idempotent purchase operation (no real Stars)

| | |
|---|---|
| **The changed subsystem** | the `operations` write path, `POST /api/storefront/purchase`, the `FakeStarsProvider` |
| **Dependencies** | S0, S1 |
| **Tests** | T1–T4, I2, E1, E2 |
| **Acceptance criteria** | the same `opId` twice → one row; a different SKU with the same `opId` → `409` **and no write**; no grant without a charge; the fingerprint binds the user + the type + the SKU + the amount + the entitlement target + the catalog version |
| **Rollback** | disable the endpoint (`503`); the schema stays |
| **Parallelizable?** | ⚠️ it shares `server/index.mjs` with other server work — **serialize with the other server-touching agents** |

### E.1.4 S3 — the entitlement

| | |
|---|---|
| **The changed subsystem** | `entitlements`, `grants_log`, `GET /api/storefront/state` |
| **Dependencies** | S2 |
| **Tests** | I1, T8, C1 |
| **Acceptance criteria** | the grant is atomic with the operation; the client cannot author an entitlement; the state read model never exposes a raw uid / initData |
| **Rollback** | `GET /state` returns empty; the purchases are disabled |
| **Parallelizable?** | ⚠️ the same file as S2 |

### E.1.5 S4 — the synthetic payment adapter

| | |
|---|---|
| **The changed subsystem** | the `FakeStarsProvider` → the real provider interface; the `pre_checkout_query` handler |
| **Dependencies** | S2, S3 |
| **Tests** | T9, T10, E3, E6, E7 |
| **Acceptance criteria** | the 10s deadline is met with a measured margin (target < 2s of the budget); the amount is re-read from the catalog; a mismatch grants nothing; a non-`XTR` currency is rejected; the kill switch fails closed with a redacted message |
| **Rollback** | swap the adapter back to the fake |
| **Parallelizable?** | ✅ yes (a new file) |

### E.1.6 S4.5 — the transaction-history reconciliation foundation  *(new)*

| | |
|---|---|
| **The changed subsystem** | `ofeliya_pay.telegram_transactions` + `telegram_scan_checkpoint`, the provider's `listStarTransactions` / `getStarBalance`, the scan worker, the checkpoint logic, the three-valued refund outcome in the provider adapter |
| **Dependencies** | S0, S4 (the provider interface) |
| **Tests** | T13, T14, T15, I13 |
| **Acceptance criteria** | the mirror is written and deduplicated by `tx_key` — **the direction is part of the key**, so a refund that shares its original's id is **not** dropped; the checkpoint advances **only** in the same transaction as the page; the overlap is applied; the ordering-violation guard forces a full re-scan and alerts; the provider classifies a timeout as `UNKNOWN`, not as a failure |
| **Rollback** | disable the scan; the mirror and the checkpoint stay |
| **Parallelizable?** | ✅ mostly (a new file) — it **shares the provider module with S4**, so serialize that one file |
| **Do not** | make any Telegram call from this phase beyond the read API; make a repair that moves money; put the checkpoint outside the page transaction |

> **Why this phase exists and why it sits here.** In the first revision the reconciliation was S6 — *after*
> the refunds. That ordering meant the first thing built on the money system was the part that could
> silently lose a user's paid value. Now the evidence comes first: the refund's unknown-outcome branch
> (`REFUND_RECONCILE`) and its history-gated re-issue both **require** the transaction history, so S4.5
> is a hard predecessor of S5, and S5 + S6 land together (main plan §21.4).

### E.1.7 S5 — the refunds

| | |
|---|---|
| **The changed subsystem** | the refund path, the refund worker, `refundStarPayment` |
| **Dependencies** | S3, S4, **S4.5** |
| **Tests** | T3, T13, E5, E8, E12, I12 |
| **Acceptance criteria** | the five-state machine `REFUND_REQUESTED → REFUND_PENDING → REFUNDED \| REFUND_FAILED \| REFUND_RECONCILE`; the Telegram call is issued **outside** every transaction; an **unknown** outcome becomes `REFUND_RECONCILE` and **never** a failure; a confirmed failure **restores** the entitlement; a repeated refund command makes **no** Telegram call; the history check precedes every call; `REFUNDED` ⇒ revoked, always |
| **Rollback** | disable the refunds; the operations and the state machine stay |
| **Parallelizable?** | ⚠️ the same file as S2/S3 |
| **Do not** | call Telegram from the operator request; keep the external call inside a transaction; treat a timeout as a failure |


### E.1.8 S6 — the reconciliation

| | |
|---|---|
| **The changed subsystem** | the R1–R10 detectors, the auto-repair allowlist, the manual unresolved queue, `reconcile_findings`, the admin endpoint |
| **Dependencies** | S3, S5, **S4.5** |
| **Tests** | I6, I11 |
| **Acceptance criteria** | each finding type is detected; the **allowlisted** repairs are automatic and audited; everything else is queued with its evidence; the job is safe during a purchase **and** during a refund; a repair without a confirmed Telegram charge is rejected; the auto-repair **denylist** is enforced in code |
| **Rollback** | disable the job; the mirror stays |
| **Parallelizable?** | ✅ yes |
| **Do not** | auto-repair a grant without a confirmed Telegram transaction; auto-revoke an entitlement whose grant source is unknown; re-price anything |


### E.1.9 S7 — the Telegram Stars test environment

| | |
|---|---|
| **The changed subsystem** | the real provider, the bot wiring, the test-env bot |
| **Dependencies** | S4, **S4.5**, S5 |
| **Tests** | R-T1…R-T7d |
| **Acceptance criteria** | a real test-env Stars payment completes end-to-end and grants exactly one entitlement; a real test-env refund revokes it; the `successful_payment` fields match the documented contract exactly; **the transaction history returns the charge (R-T7a) and the refund (R-T7b)**; the pagination behaves (R-T7c); **the history's completeness and ordering are verified (R-T7d)** — this is the assumption the checkpoint depends on, so it is measured, not assumed |
| **Rollback** | keep the fake as the default; a flag selects the real one |
| **Parallelizable?** | ✅ yes — but **must not run concurrently with S5** on the same bot token |


### E.1.10 S8 — the Storefront UI

| | |
|---|---|
| **The changed subsystem** | the client scene, the pending states, the error states |
| **Dependencies** | S1, S3, S4 |
| **Tests** | C2, C3, C4, E1, E4 |
| **Acceptance criteria** | the client renders the server state only; an unreachable ledger never renders "оплачено"; the restore flow works; the `test:muse-client` and `test:muse-convergence` contracts still pass |
| **Rollback** | hide the storefront tab |
| **Parallelizable?** | ✅ yes — **a different agent can own `src/**`** |


### E.1.11 S9 — the paid Lab progression

| | |
|---|---|
| **The changed subsystem** | the `LAB_BRANCH`/`LAB_LEVEL` SKUs, the server-computed next level, the client intent protocol |
| **Dependencies** | S2–S4 + the §11.2 decision |
| **Tests** | T6, R3 |
| **Acceptance criteria** | the client sends an *intent*; the server computes the level; the same `opId` cannot buy a different level; the refund/downgrade rule is implemented |
| **Rollback** | mark the Lab SKUs `enabled=false` |
| **Parallelizable?** | ⚠️ depends on the §11.2 decision (combat power ⇒ v1.1) |


### E.1.12 The parallelism map

```
S0 ──▶ S1 ──┬──▶ S2 ──┬──▶ S3 ──┬──▶ S4 ──┬──▶ S4.5 ──▶ S5 ──▶ S6
             │         │         │         │            │         │
             │         │         │         │            │         └──▶ S7 (needs S4 + S4.5 + S5)
             │         │         │         │            │
             │         │         │         │            └──▶ S7 (the history verification can run early)
             │         │         │         │
             └─────────┴─────────┴─────────┴──▶ S8 (client-only; needs the S1+S3 read models)
                                                └──▶ S9 (needs S2–S4 + the §11.2 decision)
```

**The file-ownership conflicts.** S2, S3 and S5 all touch `server/index.mjs`, the project's single hottest
server file. **Do not run two agents on `server/index.mjs` simultaneously.** Either serialize them, or
split `server/index.mjs` into a router that imports `server/routes/storefront.mjs` — a mechanical
refactor worth doing in S0/S1 to unlock parallelism. S4.5 shares **one** file with S4 (the provider
module) — serialize that one file and nothing else.

---

## E.2 The evidence log

Every claim in this package was verified on 2026-10-25. The commands are recorded so any of them can be
re-checked independently.

| Check | The command / source | The result |
|---|---|---|
| The PR inventory | `mcode-tools connector call connector__github__list_pull_requests` (10 pages, `state=all`) | 219 unique PRs, #13–#243; **0** monetization PRs |
| The branch inventory | `git branch -r` | 230 remote branches; 232 refs in total (incl. the tag `pre-v0.4.1`) |
| The content search (the payment primitives) | `git grep -lI -- <term> $(git for-each-ref --format='%(refname)' refs/remotes/origin)` | `opId`, `invoice_payload`, `telegram_payment`, `sendInvoice`, `createInvoiceLink`, `refundStar`, `trg_wallet`, `wallet_ledger`, `restore_purchase` → **0 files** |
| The patch files | `git rev-list --all --objects \| grep '\.patch$'` | **0** — the Muse patch sources are not in GitHub |
| The dangling objects | `git fsck --lost-found --no-progress` | none — no deleted payment branch is hiding in the object store |
| The database technology | a grep for `D1\|sqlite\|postgres\|prisma\|mongodb` + `package.json` | only `deploy/ofeliya-state.sql` (Postgres) + prose in the deploy docs; **no DB driver dependency** |
| The billing deferral | `ARCHITECTURE_NOTES.md:274`, `README.md:202` | billing is explicitly out of scope, with a stated exit condition |
| The Muse matrix | `docs/qa/MINIMAX_MUSE_CONVERGENCE_20261025.md` §2 and §7 | 16 sources: 7 implemented, 3 partial, 6 excluded |
| The client boundary | `src/game/collection/ClientCollection.ts` | `CollectionSnapshot` has no wallet / balance / currency / purchase |
| The Lab boundary | `src/ui/CollectionBoard.ts` | "ИССЛЕДОВАНИЯ · БЕЗ УСИЛЕНИЙ"; no purchase control |
| The idempotency precedent | `server/index.mjs` (the Daily V2 path) | `submissionId` + `submissionHash` → `409` on a mismatch (`server/index.mjs:1636,1708`) |
| The entitlement precedent | `server/index.mjs:1007,1009,1129,1054,1151` | `ENTITLEMENT_SOURCES`, `PROFILE_CATALOG`, `grantProfileItem`, `withProfileLock`, `verifyMessengerProfileIdentity` |
| The Postgres substrate | `deploy/ofeliya-state.sql` @ `413807daa5` | `ofeliya_private.state`, RLS, `service_role`, `ofeliya_state_call`, a revision + a commit-id idempotency |
| The hosting facts | `deploy/RENDER.md:80–135` | Supabase Free may pause inactive projects; Render Free sleeps after 15 idle minutes; the production cutover was verified 2026-10-11 |
| The Stars prior art | `coder_survival`: `backend/migrations/001_init.sql`, `060_*.sql`, `backend/src/routes/{buy,internalPayments}.js`, `bot/src/payments.js`, `bot/src/createBot.js:209–231` | a real `star_payments` schema + the confirm/refund endpoints + a fail-closed kill switch |
| **The prior art's refund — corrected** | `grep -rn 'refundStarPayment' coder_survival` | **ZERO** matches outside a comment. The `POST /telegram/refund` route contains **no Telegram call** and does **not** reverse the item effects. The first revision of this package mis-described it as *"the Bot API `refundStarPayment` FIRST"* — that was **wrong** (Annex A §A.4.5, main plan §3.3, §21.5) |
| The Telegram Stars contract | `core.telegram.org/bots/payments-stars`, `/bots/api/methods/*`, `/bots/api/types/*` | the field names quoted verbatim in Annex D §D.1 |
| **The transaction-history surface (the correction)** | `core.telegram.org/bots/api` §`getStarTransactions` · §`StarTransaction` · §`StarTransactions` · §`TransactionPartnerUser` · §`getMyStarBalance`; `core.telegram.org/bots/api-changelog` | `getStarTransactions` **exists** (Bot API 7.5, June 18 2024); `StarTransaction.id` *"Coincides with the identifier of the original transaction for refund transactions. Coincides with `SuccessfulPayment.telegram_payment_charge_id` for successful incoming payments from users"*; `TransactionPartnerUser.invoice_payload` *"Can be available only for 'invoice_payment' transactions"* (Bot API 8.0); `nanostar_amount` (8.1); `getMyStarBalance` (9.1). The current Bot API is **10.3, August 24, 2026** |
| **The MTProto Stars surface** | `core.telegram.org/method/payments.getStarsTransactions` · `…getStarsTransactionsByID` · `…refundStarsCharge` · `core.telegram.org/api/stars` | `payments.getStarsTransactions` — *"Both users and bots can use this method"*, `offset` = *"obtained from the returned next_offset"* · `payments.getStarsTransactionsByID` — ***"Only users can use this method"*** ⇒ **not available to a bot** · `payments.refundStarsCharge` — *"Only bots can use this method"*, typed errors `CHARGE_ALREADY_REFUNDED` / `CHARGE_ID_EMPTY` / `USER_ID_INVALID` |
| **The pre-checkout deadline** | `core.telegram.org/bots/payments-stars` | *"Your bot must reply using answerPrecheckoutQuery within **10 seconds** after receiving this update or the transaction is canceled."* |
| **The hosting constraint** | `render.com/docs/free` | *"Render spins down a Free web service that goes **15 minutes** without receiving any inbound traffic."* · *"A Free web service spins back up whenever it next receives an HTTP request or new WebSocket connection. This process takes **about one minute**."* — a ~60 s cold start against a 10 s deadline |
| The org-wide picture | `mcode-tools connector call connector__github__search_repositories` → 58 repos; `restobot` and `coder_survival` cloned and grepped | `restobot` has **no** Stars/payment code; `coder_survival` is the only real prior art |

### E.2.1 The exact reproduction commands

```bash
git clone https://github.com/timoshinoleg-eng/ofeliya.git
cd ofeliya

# The PR inventory (via the GitHub connector)
mcode-tools connector call connector__github__list_pull_requests \
  --args '{"owner":"timoshinoleg-eng","repo":"ofeliya","state":"all","per_page":30,"page":1,
           "fields":["number","title","state","merged","merged_at","head","base"]}'

# The monetization content search across every branch
REFS=$(git for-each-ref --format='%(refname)' refs/remotes/origin)
for kw in opId invoice_payload telegram_payment sendInvoice createInvoiceLink \
          refundStar trg_wallet wallet_ledger restore_purchase; do
  echo "$kw -> $(git grep -lI -- "$kw" $REFS 2>/dev/null | wc -l)"
done

# The Muse patch files
git rev-list --all --objects | grep -c '\.patch$'

# The dangling objects
git fsck --lost-found --no-progress

# The line-numbered citations used throughout the package
git show origin/main:server/index.mjs | grep -n 'ENTITLEMENT_SOURCES\|PROFILE_CATALOG = \|grantProfileItem\|withProfileLock\|verifyMessengerProfileIdentity\|submissionId already used'
git show origin/main:ARCHITECTURE_NOTES.md | grep -n 'paid value of any kind'
git show origin/main:README.md | grep -n 'биллинг (Telegram/MAX Stars'

# The sibling-repo prior art
git clone https://github.com/timoshinoleg-eng/coder_survival.git
grep -rn 'refundStarPayment\|sendInvoice\|pre_checkout_query\|successful_payment' coder_survival/backend coder_survival/bot
sed -n '60,82p' coder_survival/backend/migrations/001_init.sql
```

---

## E.3 The file index

### OFELIYA `main` (`6144b4d18`)

| File | SHA | Why it is cited |
|---|---|---|
| `server/index.mjs` | `33d8ba12d5` | the routes, the idempotency contract, the entitlement primitives, the per-user lock |
| `server/durable-state.mjs` | `5ae90a6789` | the durable-state engine |
| `server/telegram-users.mjs` | `b8e7d0ef98` | the registry pattern (the atomic write + the fail-before-publish discipline) |
| `deploy/ofeliya-state.sql` | `413807daa5` | the Postgres discipline to copy |
| `deploy/ofeliya-state-function.ts` | `b4cf904b97` | the edge-gateway pattern to mirror |
| `deploy/RENDER.md` | — | the hosting/Supabase/state-writer contract; the Free-tier limits |
| `ARCHITECTURE_NOTES.md` | — | the "Server profile foundation (V1)" and "Still deferred" sections |
| `README.md` | — | the "Профили игрока" API contract |
| `package.json` | — | the runtime deps (no DB driver) and the CI script wiring |

### OFELIYA Muse branch `qa/minimax-muse-convergence-20261025`

| File | SHA | Why it is cited |
|---|---|---|
| `docs/qa/MINIMAX_MUSE_CONVERGENCE_20261025.md` | `431ad9dd3f` | the 16-source matrix (§2) and `DEFERRED_SERVER_AND_MONETIZATION` (§7) |
| `src/game/collection/ClientCollection.ts` | `c26ac4c427` | the no-wallet boundary |
| `src/ui/CollectionBoard.ts` | `8957be32f8` | the informational Lab + the gallery shell |
| `src/systems/ClientFeatureFlags.ts` | `36bb5e13fa` | the presentation-only flag boundary |
| `scripts/check-muse-collection.mjs` | `dd4cfb4693` | the contract that proves there is no client-side economy |
| `scripts/check-muse-convergence-adversarial.mjs` | `c76f888519` | the adversarial contracts |

### The OFELIYA merged commits cited

| PR | SHA | What it introduced |
|---|---|---|
| #100 | `763628e548` | the server-authoritative Daily V2 tickets (the `submissionId`/`submissionHash` contract) |
| #104 | `d1aebf329` | hardening the Daily V2 ticket authority |
| #117 | `64624b18bf` | the server profile / inventory foundation v1 (`PROFILE_CATALOG`, `ENTITLEMENT_SOURCES`, `grantProfileItem`) |
| #119 | `d549a9534` | the server-proven founder badge |
| #188 | `94ba99153d` | Render Free with a durable private state (the Supabase + edge-function substrate) |
| #223 | `6144b4d18` | the current `main` HEAD |

### `timoshinoleg-eng/coder_survival` `main` — the payment prior art

| File | What it provides |
|---|---|
| `backend/migrations/001_init.sql` | `purchases` and `star_payments` (`telegram_payment_charge_id TEXT NOT NULL UNIQUE`) |
| `backend/migrations/060_*.sql` | the partial unique index for the one-time SKU |
| `backend/src/routes/buy.js` | the purchase-intent endpoint (`202`, the `purchase:<id>:<item>` payload) |
| `backend/src/routes/internalPayments.js` | the confirm/refund endpoints (`pg_advisory_xact_lock`, `FOR UPDATE`, the audit log) |
| `bot/src/payments.js` | the fail-closed gate (the strict `=== 'true'` parse, the pure `decidePreCheckout`, the redacted notice) |
| `bot/src/createBot.js:209–231` | the `pre_checkout_query` / `successful_payment` handlers |
| `backend/tests/payments*.{js,mjs}` | the test shapes to reproduce |

---

## E.4 The agent architecture — the ownership map in full

### E.4.1 The principles

1. **One owner per file.** No two agents edit the same file concurrently.
2. **Producers never verify their own work.** Codex and Kimi audit; they do not write the audited code.
3. **Shared authority files are single-writer.** `server/index.mjs`, the SQL schema and `package.json` are
   single-writer and are the integration bottleneck.
4. **Gates are read-only.** A reviewer's first action is never to write.

### E.4.2 The ownership map

| Area | The files | The owner | The reviewer |
|---|---|---|---|
| The money schema + the RPC | `deploy/ofeliya-pay/**`, `deploy/ofeliya-pay-function.ts` | **MiniMax** (one agent, exclusive) | **Kimi** (adversarial: the constraints, the RLS, the fail-open risks) |
| The server routes | `server/routes/storefront.mjs` (new), `server/storefront/**` | **MiniMax** (exclusive) | **Codex** (the gate: the contracts, the idempotency, the error paths) |
| The `server/index.mjs` router wiring | `server/index.mjs` | **a single integrator** (Codex) after the route module is merged | Codex's self-check + Kimi's diff review |
| The bot / the Telegram provider | `server/telegram-payments.mjs`, `server/bot.mjs` | **MiniMax** (exclusive) | **Kimi** (the 10s deadline, re-entrancy, the redaction) |
| The client Storefront | `src/scenes/StorefrontScene.ts`, `src/systems/StorefrontClient.ts`, `src/ui/**` | **MiniMax** (exclusive) | **Codex** (the contract: the client renders only the server state) |
| The Lab progression (the client half) | `src/ui/CollectionBoard.ts`, `src/systems/LabClient.ts` | **MiniMax** (exclusive) | **Codex** |
| The tests — unit/integration | `scripts/check-*.mjs`, `server/*.test.mjs` | **lightweight agents** (one per area, mechanical) | **Codex** (the gate: the suite actually covers §6) |
| The race/concurrency tests | `server/storefront-race.test.mjs` | **Kimi** (the author; its own review is replaced by Codex) | Codex |
| The contract tests | `tests/storefront-contract.mjs` | **a lightweight agent** | Codex |
| The docs / the runbook / the threat model | `docs/**` | **a lightweight agent** | Codex |
| The CI wiring | the `package.json` scripts only (`.github/workflows/**` is **not writable** by the connected App) | **a single integrator** | — |
| The release gate | the whole PR series | — | **Codex** (an independent gate, the exact-head CI read) |

### E.4.3 The agent roles

| Agent | The role | Explicitly forbidden |
|---|---|---|
| **MiniMax** | the large autonomous implementations: the schema, the server routes, the client scenes | touching more than its owned file set; merging |
| **Codex** | the independent gate/review: the contract conformance, the CI evidence, the PR-series integration | writing the code it reviews |
| **Kimi** | the adversarial security & race review: the §6 threat model as executable tests, the concurrency matrix | shipping fixes to its own findings without Codex's re-review |
| **Lightweight agents** | the mechanical work: the test scaffolding, the docs, the runbooks, the CI script wiring | architectural decisions |

### E.4.4 The sequence

```
1. Codex gates the client physical acceptance (#241+#242+#243) → main.
2. MiniMax: the S0 schema (exclusive) → the Codex gate → the Kimi schema review.
3. MiniMax: S1 the catalog → the Codex gate.
4. MiniMax: S2+S3 (one agent, sequential — they share server/index.mjs)
   → the Codex gate → the Kimi race review.
5. Kimi: the race/concurrency test suite → the Codex gate.
6. MiniMax: S4 the fake adapter + S5 the refunds + S6 the reconcile
   → the Codex gate → the Kimi threat-model review.
7. MiniMax: S7 the real Telegram test env (an isolated bot) → the Codex gate.
8. MiniMax: S8 the Storefront client → the Codex contract gate.
9. The decision point: §11.2 — combat power or not → then S9.
```

### E.4.5 The hard rule

> **No two agents may write the same shared authority file concurrently.**
> `server/index.mjs`, `deploy/ofeliya-pay/**`, `package.json` and the CI scripts each have exactly one
> owner at any moment in the sequence. If the owner changes, the change is a hand-off, not a parallel edit.

---

## E.5 The open questions

| # | The question | Why it matters | Who decides | Blocking |
|---|---|---|---|---|
| Q1 | Do we sell **combat power** at all, or only cosmetics + non-combat Lab branches? | It determines whether the paid power needs the ranking partitioning and the refund semantics (main plan §11.2) | the product owner | S9 |
| Q2 | Which host runs the payment path? | Render's own docs: a Free web service spins down after 15 idle minutes and *"This process takes about one minute"* — a ~60 s cold start against a **10 s** deadline. A missed deadline = a cancelled checkout | ops | **S7** |
| Q3 | Do we move Supabase off the **Free** tier before real money? | *"Supabase Free may pause inactive projects"* → the ledger becomes unreachable → the purchases fail closed (correct, but the revenue dies) | ops | **the Go/No-Go** |
| Q4 | Is `createInvoiceLink` or `sendInvoice` the right primitive? `sendInvoice` requires the bot to message the user; `createInvoiceLink` works inside a Mini App | It determines the client UX and the forwarding/multiple-payment risk | product + UX | S7 |
| Q5 | **RESOLVED by the factual correction:** the Bot API's `getStarTransactions` **is** the Telegram-side payment listing (Annex D §D.1.7). What remains open is the **operator console** over it and the retention policy for the local mirror | §14 — the automatic detection of "paid but no local operation" is now possible | ops | the Go/No-Go (the console only) |
| Q6 | Do we add a spendable currency in v2? | The entire balance / refund-vs-spend class (main plan §1.3) | product | v2 |
| Q7 | Is `premium_pass`-style **recurring** Stars in scope? (`createInvoiceLink` supports `subscription_period=2592000`, a price ≤ 10000 Stars) | The recurring payments change the refund and the entitlement model entirely | product | v2 |
| Q8 | Which entity holds the money — OFELIYA directly, or a MAX-platform account? | It affects the account, the tax treatment and the reconciliation | product + legal | the Go/No-Go |
| Q9 | Do we split `server/index.mjs` into the modules before S2, to unblock the parallel agents? | The ownership map is much cleaner if we do | engineering | S0/S1 |
| Q10 | What is the **refund policy** window, and who may trigger it? | It determines the `REFUND_REQUESTED` / `REFUND_RECONCILE` handling, who may trigger a refund, and the operator runbook (main plan §13.8) | product + support | S5 |

---

## E.6 The Go/No-Go criteria for real money

> **The authoritative checklist is the main plan §23.** It is grouped as **API · Ledger · Refund ·
> Reconciliation · Correctness · Security · Operations · Product · Stop conditions**, and it is the only
> copy — a second, divergent checklist is a liability, not a convenience. This section records only the
> **deltas that the factual correction introduced** relative to the first revision.

### E.6.1 What is new

| The group | The new item | Why it is new |
|---|---|---|
| **API** | `getStarTransactions` reconciliation is verified (R-T7a) — the charge appears in the history with the expected id, direction and transaction type | the transaction history did not exist as a verified surface in the first revision |
| **API** | `refundStarPayment` is verified (R-T7b) — the refund appears as an **outgoing** transaction with the **same id** | the shared-id semantics are what make the history usable for refunds |
| **API** | pagination is tested (R-T7c) | the checkpoint depends on the pagination semantics |
| **API** | **history completeness and ordering are measured** (R-T7d) | the checkpoint depends on an append-only ordering assumption that the Bot API **states but does not guarantee**. It is now **verified in the test environment**, not assumed |
| **Ledger** | the refund operation's idempotency is proven — the same refund command twice ⇒ **one** operation and **zero** extra Telegram calls | the refund is a first-class operation in the ledger (§13.6) |
| **Refund** | the **unknown** outcome is recorded as `REFUND_RECONCILE` — never as a failure, never as a success | the first revision collapsed the two |
| **Refund** | the entitlement policy is implemented per class — cosmetic ⇒ usable, gameplay power ⇒ suspended, **never** a permanent revoke before confirmation | the first revision revoked unconditionally (§13.3) |
| **Refund** | the Telegram call is issued **outside** every database transaction — verified by inspection and by a lock-contention test | the first revision's pseudocode left the outcome write unguarded |
| **Reconciliation** | the **automatic** payment-vs-ledger scan runs; an `IN` transaction with no local operation is found | this is the case the first revision called *"manual only"* |
| **Reconciliation** | the entitlement mismatch detectors run, and both auto-repairs are automatic and audited | R2 and R4 are now deterministic |
| **Reconciliation** | the **manual unresolved queue** exists — and the unresolvable-payload case is **not** auto-resolved | the honest remainder (§14.4.2) |
| **Reconciliation** | the auto-repair **allowlist** and **denylist** are enforced in code | "never auto-repair" was too blunt; the precise rule is now explicit |
| **Reconciliation** | the checkpoint is proven — the mirror and the checkpoint move together; the overlap is applied; the `tx_key` dedupe keeps a refund that shares its original's id | the checkpoint is new (§14.6) |
| **Operations** | the **`/paysupport`** command exists and works | Telegram's own requirement: *"Your bots and mini apps must be able to respond to the command /paysupport and process user requests regarding payment issues"* |
| **Operations** | the **payment host** is stated as an invariant — an infrastructure that can reliably meet the 10 s deadline, with the margin **measured** | the first revision said "a non-sleeping host"; the invariant is sharper and the Render facts are now cited (§12.1.1) |
| **Operations** | the **alerts** are enumerated: an ordering violation, a balance drift, a high-severity finding, a stale `REFUND_RECONCILE`, a scan that missed its window | the first revision had no alert list |

### E.6.2 What is unchanged

The correctness, security and product groups carry over from the first revision **unchanged**, because the
correction did not weaken any of them: the threat model is still executable row by row, the idempotency
contract still fails closed, the atomicity test still proves no half-grant, `ofeliya_pay` is still
`service_role`-only, the service-role key is still not on the game server, the kill switch still fails
closed **and** still honours an already-charged payment, and the client still renders only the server
state.

### E.6.3 The one stop condition that is new

- [ ] If the history scan has **not** completed successfully within its window, the **refund** path is still
      allowed (a refund is not a new grant — refusing it would leave the user worse off), but the
      **auto-repair** path is **suspended**: a repair must never be based on a stale mirror.

## E.7 The audit's own safety statement

| Assertion | Status |
|---|---|
| No runtime code changed | ✅ only `docs/**` files were created or edited |
| No payment executed | ✅ **no Bot API payment, refund, or transaction-read method was called**; only the public documentation pages were fetched |
| No production changed | ✅ no deploy, no environment change, no secret read |
| No deploy | ✅ |
| No `main` merge | ✅ the branch `research/ofeliya-server-economy-architecture-20261025` was created from `main` and is not merged |
| PR #241 / #242 / #243 untouched | ✅ they were read for context only; no branch, no review, no comment |
| No client product code changed | ✅ |
| No fix PR created | ✅ the only PR is this documentation PR, in Draft |
| No real Stars test performed | ✅ the Telegram test environment was **not** contacted |
| No Telegram **write** call | ✅ `refundStarPayment`, `sendInvoice` and `answerPreCheckoutQuery` were never invoked — only the documentation pages describing them were read |
| No secret read or written | ✅ no bot token, no service-role key, no session |
| The only network access | ✅ `core.telegram.org` (the public documentation) and `render.com/docs` (the public documentation), plus read-only `git clone` of the two public repositories |

> **Revision 2 note.** The factual correction in revision 2 was made **entirely from the public
> documentation**. No Telegram account, bot, token or API call was involved in producing it — which is
> exactly why it is trustworthy: every claim in §9.2, §9.2.1, §9.5 and Annex D §D.1.7 is quoted or
> paraphrased from `core.telegram.org` and is recorded in the evidence log (§E.2).
