and it is built last so that it cannot be mistaken for the money system.

### 10.1 SKU model

```sql
ofeliya_pay.catalog_sku (
  sku                 text primary key,      -- e.g. 'cosmetic.skin.gilded_prime.v1'
  kind                text not null,         -- COSMETIC | LAB_BRANCH | LAB_LEVEL | PRESTIGE
  title               text not null,
  description         text not null default '',
  price_stars         integer not null check (price_stars > 0),
  currency            text not null default 'XTR' check (currency = 'XTR'),
  entitlement_kind    text not null,         -- COSMETIC | STAT | PRESTIGE
  entitlement_key     text not null,         -- e.g. 'skin.gilded_prime' | 'lab.magnet'
  entitlement_level   integer,               -- NULL = level decided by server from current state
  max_level           integer,               -- cap for leveled entitlements
  one_time_per_user   boolean not null default false,
  max_level_per_user  integer,               -- for repeatable levels
  prerequisite_sku    text,                  -- FK to catalog_sku(sku)
  version             integer not null default 1,
  enabled             boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
)
```

### 10.2 Price authority

| Rule | Statement |
|---|---|
| Server price | `catalog_sku.price_stars`. The **only** price that is ever charged |
| Client price | **Informational.** Rendered from `/api/storefront/catalog`. May be stale by seconds |
| Price mismatch at settlement | The server compares `SuccessfulPayment.total_amount` to its own recomputed amount. Mismatch → **do not grant**, mark the operation `PRICE_MISMATCH`, alert |
| Price changes | Bump `catalog_sku.version`. A new version does **not** alter existing operations (`operations` stores the amount it was priced at) |

### 10.3 Availability

| State | Server behaviour |
|---|---|
| `enabled = false` | The SKU is not purchasable. `404` on purchase. It **stays visible** in the catalog with `available: false` so the client can render "coming soon" instead of a broken row |
| Sold out / capped | `409` (one-time) or `422` (level maxed) |
| `prerequisite_sku` unmet | `422` with the missing prerequisite id, so the client can render it |
| Expired offer | `410` |

### 10.4 SKU migration (old → new)

Never mutate a SKU's meaning in place. Instead:

1. Create a **new SKU row** (`version` bumped, or a new id).
2. Leave the old row `enabled = false`.
3. Keep a `catalog_sku.supersedes` / `superseded_by` link.
4. **Entitlements are keyed by `entitlement_key` + `level`, not by SKU.** So a SKU rename or repricing
   does not invalidate an existing grant.

> This is the single most important schema decision: **entitlement identity ≠ purchase identity.**
> It is what makes refunds, re-pricing, and SKU migration safe.

### 10.5 Localization

- The catalog carries `title`/`description` as **server-provided** strings for the active locale, or as
  keys the client resolves locally.
- **Prices are locale-independent** — Stars have no locale formatting. Display as `⭐ N`.
- The client may localize the *description*; it may not localize the *price* or the *effect*.

### 10.6 Restore purchases

```
POST /api/storefront/restore {platform, initData}
→ identity → userKey → all ENTITLED entitlements → 200 {entitlements}
```

Restore is **not** a payment operation and **not** a grant — it is a read. It must not create, extend or
mutate any entitlement. It must be safe to call repeatedly and from any device.

### 10.7 Pending purchase UI states

| Server state | Client rendering |
|---|---|
| `PENDING` | "Ожидание оплаты…" — a spinner, a cancel affordance that only cancels the *intent* |
| `PAID` | "Оплата получена, выдаём…" — brief; the client should poll |
| `ENTITLED` | Success + the newly unlocked item highlighted |
| `REFUND_PENDING` | "Возврат в обработке" — **not** an error; the entitlement is shown as *pending revocation*, not as active |
| `REFUNDED` | "Возврат оформлен" — entitlement shown as revoked |
| `FAILED` / `REJECTED` | A clear error with a human-readable reason |
| *(unknown / unreachable)* | **Fail closed**: show "не удалось подтвердить оплату" — **never** "оплачено" |

### 10.8 Error states

| Code | Client behaviour |
|---|---|
| `409 IDEMPOTENCY_KEY_REUSE` | "Этот запрос уже использован с другими параметрами." — do not auto-retry |
| `409 ONE_TIME_ALREADY_OWNED` | "Уже приобретено." — re-read state and show the owned item |
| `404 SKU_UNAVAILABLE` | Hide/disable the buy button |
| `422 ENTITLEMENT_MAXED` | "Максимальный уровень достигнут." |
| `422 PREREQUISITE_MISSING` | Show the prerequisite |
| `410 OFFER_EXPIRED` | "Предложение истекло." — offer a refresh |
| `503 LEDGER_UNAVAILABLE` | "Платёж временно недоступен. Попробуйте позже." — **and issue no invoice** |

---

## 11. Permanent Lab progression

The highest-risk game layer. The existing Lab is **informational only**
(*"Урон, здоровье, скорость и награды не меняются."*) and that boundary is enforced by
`scripts/check-muse-collection.mjs`.

### 11.1 Three tiers

| Tier | Definition | Authority | v1 |
|---|---|---|---|
| **Safe informational Lab** | What exists today: 3 branches, no effect, no write | client presentation | ✅ shipped |
| **Earned progression** | Progression the player earns in-game, not paid | client/server (existing) | ✅ shipped (quests, achievements) |
| **Paid permanent progression** | Permanent stat/power bought with Stars | **server** | ⚠️ v1.1 — see §11.2 |

### 11.2 The ordering risk (why paid power is v1.1, not v1)

A paid permanent stat changes **gameplay**, which means:

- It becomes a **balance** problem, not just a plumbing problem.
- It can be **spent** in a run → a refund creates a "power without payment" or "payment without power"
  window.
- It interacts with the **seeded-duel / trusted-score** contract: a player with paid power and a player
  without are not comparable. `server/index.mjs` already separates *Strained* from *Standard* ranking
  (PR #43) for exactly this class of reason.

**Recommendation:** v1 ships **paid cosmetics + a non-combat permanent Lab branch** (e.g. a collection
branch, a badge, a prestige tier). Paid **combat power** (HP / damage / movement / magnet / income)
waits until:

1. the ledger has run in production with real money for a defined soak period, **and**
2. a ranking policy exists that separates paid-power players from free players **and**
3. a refund semantics decision is made: *does a refund remove power the player already used?* (it cannot
   — so either power is non-combat, or refunds of used power are impossible by design).

**If combat power must ship**, the answer is to make the grant **re-read at run start** and to record
`paid_power_used_at` on the score, so ranked play can be partitioned.

### 11.3 Per-parameter specification

For every paid parameter, the server must be able to answer all ten questions:

| Question | Rule |
|---|---|
| Server representation | `entitlements(user_key, entitlement_key='lab.<param>')` → `level integer`, `source_operation_id`, `granted_at`, `revoked_at` |
| Validation | Server computes the legal next level from the current level. **The client never sends `newLevel`.** |
| Max level | `catalog_sku.max_level` (and `max_level_per_user` for repeatable purchases) |
| Pricing | `catalog_sku.price_stars` per level; a *level-up* SKU prices the **next** level, not an arbitrary one |
| Prerequisite graph | `catalog_sku.prerequisite_sku`; the server checks the whole chain |
| Refund behaviour | Soft-revoke the entitlement row; **the ledger row is never deleted**; the already-consumed effect is not clawed back (a documented, accepted asymmetry) |
| Downgrade behaviour | On refund, the entitlement reverts to the highest level that is still paid-for. With a leveled entitlement, refunding level 3 while levels 1–2 remain paid → level 2 |
| Save compatibility | The client save stores **nothing** that grants power. It may store a *cache* of the last known level, which is refreshed from the server on every run start |
| Gameplay application point | The server-granted level is fetched at run start and passed into the run as read-only state; the run must not be able to mutate it |
| Entitlement target in the fingerprint | `lab.<param>.level.<N>` — so the same `opId` cannot be reused for a different level |

### 11.4 The client protocol (intent, not state)

```
❌ FORBIDDEN                            ✅ REQUIRED
POST {branch:'magnet', newLevel:7}      POST {opId:'...', sku:'lab.magnet.level.up'}
                                         → server: lock user → read current level
                                         → validate max/prereq/price
                                         → fingerprint binds to lab.magnet.level.7
                                         → charge → grant level
```

The server computes "the next legal level" and prices *that*. The client cannot ask for level 7 —
it can only ask to **advance**, and the server decides by how much.

### 11.5 What is *not* paid permanent power

For the avoidance of doubt, none of these may be sold in v1 or v1.1:

- Anything that alters a **ranked** score's comparability without partitioning (§11.2).
- Anything that can be **bought twice** and stacked without a cap.
- Anything that is only enforced **client-side** (the entire Muse `LabModifiers` failure mode).

---

## 12. Transaction design — the critical purchase

### 12.1 The transaction

| # | Step | Inside the DB tx? | Fails how |
|---|---|---|---|
| 1 | **Validate user** — `validateInitData(initData)` → `userKey` | ✗ (before) | `401`/`403` |
| 2 | **Validate SKU** — `catalog_sku` lookup, `enabled` check | ✗ (before) | `404` |
| 3 | **Validate current entitlement** — read `entitlements` for the target key | ✗ (before, re-read inside) | `422` |
| 4 | **Validate idempotency** — `opId` shape; fingerprint; existing operation lookup | **yes** | `400` / `409` |
| 5 | **Verify external payment** — `successful_payment`: currency `XTR`, `total_amount` == server amount, `invoice_payload` → live `PENDING` op owned by this user | ✗ (before) | `409` / `422` |
| 6 | **Create immutable operation** — `INSERT operations` (`kind='PURCHASE'`) | **yes** | `409` on unique violation |
| 7 | **Grant entitlement** — `UPSERT entitlements` + `INSERT grants_log` | **yes** | rollback |
| 8 | **Commit** | — | — |
| 9 | **Return authoritative snapshot** | — | — |

**Steps 4, 6, 7 are in one transaction.** Steps 1–3 and 5 are reads/validations that happen *before* and
are *re-verified* inside the transaction (step 3) — but the money-bearing writes (6, 7) are atomic.

### 12.2 The money-spend transaction (when a wallet exists, v2+)

Additional steps inside the same transaction:

```
SELECT balance FROM wallet_derived WHERE user_key=$1 FOR UPDATE;   -- or ledger scan
  → if insufficient: ROLLBACK, 422
  → INSERT operations(kind='SPEND', amount_signed=-N)
```

The balance is derived from the ledger, so a `FOR UPDATE` on a materialized balance is a **cache lock**,
not the authority. The authority is the ledger row.

### 12.3 The 10-second constraint

`pre_checkout_query` must be answered within 10 seconds. That rules out any DB path that can block.
Therefore:

- The `pre_checkout_query` handler must **not** take the user advisory lock or contend on the
  operations table.
- It must read the catalog and the operation row with a **short, bounded** query and a hard timeout
  (e.g. 3s), then answer.
- If the ledger is slow or unreachable → answer `false` (**fail closed**).
- A sleeping host (Render Free sleeps after 15 idle minutes — `deploy/RENDER.md`) will blow the 10s
  deadline. **The payment path needs a non-sleeping host** (see §16 Go/No-Go).

---

## 13. Refund design

### 13.1 State machine

```
        ┌──────────────┐
        │ PENDING      │  intent created, invoice presented, not yet charged
        └──────┬───────┘
               │ successful_payment received & verified
        ┌──────▼───────┐
        │ PAID         │  Telegram charged. Ledger row written.
        └──────┬───────┘
               │ entitlement upserted (same transaction as PAID→ENTITLED)
        ┌──────▼───────┐
        │ ENTITLED     │  grant exists. User-visible.
        └──────┬───────┘
               │ refund requested
        ┌──────▼────────────┐
        │ REFUND_PENDING    │  Bot API call in flight. Entitlement ALREADY soft-revoked.
        └──────┬────────────┘
               │ refundStarPayment() returned true
        ┌──────▼───────┐
        │ REFUNDED     │  charge returned. Entitlement revoked.
        └──────────────┘

  Terminal-failure side: PENDING → FAILED (checkout rejected / TTL)  ·  PAID → REJECTED (amount mismatch)
```

**Invariant that must never break:** `REFUNDED` ⇒ the entitlement is revoked.
The dangerous state is `refund completed → entitlement still active`. The design prevents it by
**revoking the entitlement *before* calling Telegram**, not after:

```
BEGIN;
  SELECT * FROM operations WHERE id=$purchase FOR UPDATE;
  if status <> 'ENTITLED': ROLLBACK; return 409;
  UPDATE entitlements SET revoked_at=now() WHERE ...;       -- ① revoke FIRST
  UPDATE operations SET status='REFUND_PENDING' WHERE ...;   -- ② mark in-flight
COMMIT;

  result = telegram.refundStarPayment(user_id, telegram_payment_charge_id)   -- ③ outside tx
  if result === true:
      UPDATE operations SET status='REFUNDED' WHERE id=$purchase;           -- ④
  else:
      -- ⑤ the charge was NOT returned, but the entitlement is already revoked.
      --    This is the SAFE direction (we under-deliver rather than over-deliver).
      --    Mark REFUND_FAILED and alert; do NOT silently restore the entitlement.
```

**Why revoke-first:** if the process dies between ① and ④, the user has *less* than they paid for —
annoying but safe and fixable. If we revoked *after* a successful refund, a crash in between leaves a
refunded user with a live entitlement — money taken, value delivered, and no audit trail. **Fail
toward under-delivery.**

> The `coder_survival` implementation does the opposite (Bot API call first, inside the transaction).
> **Do not port that ordering.** Port the shape, not the sequence.

### 13.2 Permissible intermediate states

| State | Meaning | User-visible | Safe? |
|---|---|---|---|
| `PENDING` | Intent exists, no charge | "Ожидание оплаты" | ✅ |
| `PAID` | Charged, entitlement not yet written | transitional only | ⚠️ must not be observable — write `PAID` and `ENTITLED` in one tx (§13.3) |
| `ENTITLED` | Grant live | ✅ | ✅ |
| `REFUND_PENDING` | Revoked, Telegram call in flight | "Возврат в обработке" | ✅ (user sees revoked) |
| `REFUNDED` | Charge returned | "Возврат оформлен" | ✅ |
| `REFUND_FAILED` | Telegram call failed; entitlement stays revoked | "Возврат требует обработки" + alert | ✅ (under-delivery, recoverable) |
| `REJECTED` | Amount/currency mismatch | "Оплата не распознана" + alert | ✅ |
| `FAILED` | Intent expired / checkout rejected | "Оплата не завершена" | ✅ |

### 13.3 Simplification: collapse `PAID` into `ENTITLED`

Since the operation insert and the entitlement upsert happen in one transaction, an observer can never
see `PAID` without `ENTITLED`. **Collapse them.** Keep `PAID` only as an internal sub-state of the
transaction if it aids debugging — but never expose it as an API state. This is exactly the "don't
complicate the state machine without necessity" rule.

### 13.4 Refund race with spend

In v1 there is no spend, so the race is impossible. In v2, the rule is:

> A spend is refused if the entitlement it draws on has `revoked_at IS NOT NULL`.
> The spend's transaction takes `pg_advisory_xact_lock(userKey)`, the same lock the refund takes.

The lock is the whole defense. A spend that starts before the refund commits will complete and is
**not** clawed back; a spend that starts after will be refused.

---

## 14. Reconciliation

### 14.1 What it must detect

| Finding | Query (sketch) | Severity |
|---|---|---|
| **Local operation without entitlement** | `operations.status='ENTITLED'` AND no matching `entitlements` row | 🔴 high — user paid, got nothing |
| **Entitlement without payment** | `entitlements` rows with no non-revoked granting `operations` row | 🔴 high — free entitlement |
| **Refund without revoke** | `operations.status='REFUNDED'` AND the entitlement row has `revoked_at IS NULL` | 🔴 high — refund paid out, value retained |
| **Revoked without refund** | `entitlements.revoked_at IS NOT NULL` AND no `REFUNDED`/`REFUND_PENDING` operation | 🟠 medium — possibly a manual revoke |
| **Duplicate external transaction** | prevented by `UNIQUE(telegram_payment_charge_id)`; the job re-checks for violations that predate the constraint | 🔴 high |
| **Orphan intent** | `operations.status='PENDING'` older than the intent TTL | 🟢 low |
| **Price mismatch** | `operations.amount_stars != catalog price at the operation's catalog version` | 🟠 medium |
| **Telegram payment with no local operation** | ⚠️ **cannot be detected automatically** — see §14.3 | 🔴 high (manual only) |
| **Entitlement level exceeds `max_level`** | `entitlements.level > catalog_sku.max_level` | 🔴 high — a grant bug |

### 14.2 Job shape

- **Periodic** (e.g. hourly) and **on-demand** (admin endpoint).
- **Read-only** — it *finds*; it does not *fix*. Findings are written to
  `ofeliya_pay.reconcile_findings` with a `finding_key` (idempotent across runs).
- The admin endpoint returns the findings; repair is a separate, explicit, audited operation.

### 14.3 The hard truth about Telegram reconciliation

**Telegram provides no API to list a bot's payments.** There is no "list my transactions" method.
Therefore:

- **"Telegram payment with no local operation"** can only be found by:
  - a **manual export** from the Telegram side (support/dispute resolution), or
  - a **client-side report** ("I paid and got nothing") — which is *not* authoritative but is a useful
    trigger, or
  - the `successful_payment` webhook arriving **late** (after our intent TTL expired) — this *is*
    detectable server-side, and is exactly the charge-without-delivery case.
- **This is a real operational constraint, not an oversight.** It must be stated in the runbook and
  reflected in the Go/No-Go criteria (§16): the operator needs a way to receive Telegram-side
  transaction listings for dispute handling. Telegram's own live checklist says
  *"Use backups to make sure that you don't lose data about your users' payments."*

### 14.4 Safe repair strategy

```
detect → record finding → human reviews → explicit repair command → audit log → re-run to confirm
```

Rules:

1. **Never auto-repair.** A repair that grants an entitlement is a money action.
2. Every repair writes to `grants_log` with `reason`, `finding_id`, and the operator identity.
3. Repairs are **idempotent** — running them twice changes nothing the second time.
4. A repair that would grant a value **without** a matching charge requires a charge reference
   (from the Telegram-side export) — otherwise it is rejected.
5. The reconcile job must be safe to run **during** a purchase (it reads; it must not take the advisory
   lock for long, and must not block writes).

---

## 15. Database

### 15.1 The actual stack (verified — do not assume otherwise)

| Fact | Evidence |
|---|---|
| The project uses **Supabase/Postgres** | `deploy/ofeliya-state.sql` — `create schema ofeliya_private`, `jsonb`, `bigint`, `timestamptz`, `plpgsql` |
| It is **not** D1, **not** SQLite, **not** MySQL | Zero DB deps in `package.json`; zero D1/SQLite/Prisma references outside docs |
| It is **not** on the app server | The Node app talks to a Deno Deploy edge function which calls PostgREST `/rest/v1/rpc/ofeliya_state_call` with `service_role` |
| The state RPC returns `409` on conflict | `deploy/ofeliya-state-function.ts` — `return json(result, result.error ? 409 : 200)` |
| Runtime deps | `@maxhub/max-bot-api`, `phaser` only — **a SQL client must be added** for the money path (or, preferably, money goes through the same edge-function pattern) |

> **Architectural consequence.** The money path **should mirror** the existing state path: a Postgres
> schema + a `SECURITY INVOKER` RPC + a token-gated edge function + a thin client. That keeps the
> service-role key **out of the app server**, which is the single most important property (a leak of
> `SUPABASE_SERVICE_ROLE_KEY` from the game server would be catastrophic).

### 15.2 Proposed schema

New schema `ofeliya_pay`, same project, same discipline:

```sql
create schema if not exists ofeliya_pay;
revoke all on schema ofeliya_pay from public, anon, authenticated;
grant usage on schema ofeliya_pay to service_role;

-- ---------- catalog ----------
create table ofeliya_pay.catalog_sku (
  sku                text primary key,
  kind               text not null,
  title              text not null,
  description        text not null default '',
  price_stars        integer not null check (price_stars > 0),
  currency           text not null default 'XTR' check (currency = 'XTR'),
  entitlement_kind   text not null,
  entitlement_key    text not null,
  entitlement_level  integer,
  max_level          integer,
  one_time_per_user  boolean not null default false,
  prerequisite_sku   text references ofeliya_pay.catalog_sku(sku),
  superseded_by      text references ofeliya_pay.catalog_sku(sku),
  version            integer not null default 1,
  enabled            boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index ix_ofeliya_catalog_enabled on ofeliya_pay.catalog_sku (enabled);

-- ---------- operation ledger (append-only) ----------
create table ofeliya_pay.operations (
  id                        uuid primary key default gen_random_uuid(),
  kind                      text not null check (kind in ('PURCHASE','REFUND','SPEND','GRANT')),
  user_key                  text not null,                    -- 'telegram:<uid>' | 'max:<uid>'
  op_id                     text not null,                    -- client-proposed idempotency key
  op_fingerprint            text not null,                    -- sha256 binding (§7.2)
  sku                       text,
  amount_stars              integer not null default 0,       -- signed for SPEND
  currency                  text not null default 'XTR',
  catalog_version           integer,
  invoice_payload           text,
  telegram_payment_charge_id text,
  provider_payment_charge_id text,
  entitlement_key           text,
  entitlement_level         integer,
  parent_operation_id       uuid references ofeliya_pay.operations(id),
  status                    text not null,
  entitlement_snapshot      jsonb,
  raw_payload               jsonb,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint uq_operations_user_op unique (user_key, kind, op_id)
);
create unique index uq_operations_charge
  on ofeliya_pay.operations (telegram_payment_charge_id)
  where telegram_payment_charge_id is not null;
create unique index uq_operations_one_time_sku
  on ofeliya_pay.operations (user_key, sku)
  where sku is not null
    and status in ('PENDING','PAID','ENTITLED')
    and sku in (/* server-side one-time list, v1 literal — see §8.3 */);
create index ix_operations_user_created on ofeliya_pay.operations (user_key, created_at desc);
create index ix_operations_status on ofeliya_pay.operations (status);
create index ix_operations_parent on ofeliya_pay.operations (parent_operation_id);
create index ix_operations_user_fp on ofeliya_pay.operations (user_key, op_fingerprint);

-- ---------- entitlement read model ----------
create table ofeliya_pay.entitlements (
  user_key           text not null,
  entitlement_key    text not null,
  level              integer not null default 0,
  source_operation_id uuid references ofeliya_pay.operations(id),
  granted_at         timestamptz not null default now(),
  revoked_at         timestamptz,
  metadata           jsonb not null default '{}'::jsonb,
  primary key (user_key, entitlement_key)
);
create index ix_entitlements_source on ofeliya_pay.entitlements (source_operation_id);
create index ix_entitlements_revoked on ofeliya_pay.entitlements (revoked_at) where revoked_at is not null;

-- ---------- audit ----------
create table ofeliya_pay.grants_log (
  id            bigserial primary key,
  user_key      text not null,
  operation_id  uuid references ofeliya_pay.operations(id),
  action        text not null,
  reason        text,
  actor         text not null default 'system',
  context       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index ix_grants_log_user on ofeliya_pay.grants_log (user_key, created_at desc);

-- ---------- reconciliation ----------
create table ofeliya_pay.reconcile_findings (
  finding_key   text primary key,
  kind          text not null,
  operation_id  uuid references ofeliya_pay.operations(id),
  severity      text not null,
  detail        jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  resolved_at   timestamptz,
  resolution    text
);
```

### 15.3 Constraint notes

| Item | Note |
|---|---|
| `gen_random_uuid()` | `pgcrypto`/`pg13+` built-in — confirm on the Supabase version |
| `raw_payload` | The full `SuccessfulPayment` JSONB — needed for disputes and for the reconcile |
| `op_fingerprint` | Stored and indexed; **not** unique (a legitimate different opId with the same params is fine) |
| `uq_operations_one_time_sku` | The literal SKU list is a v1 compromise. Document it; migrate to a catalog-driven trigger later |
| `parent_operation_id` | Self-FK: a refund points at its purchase |
