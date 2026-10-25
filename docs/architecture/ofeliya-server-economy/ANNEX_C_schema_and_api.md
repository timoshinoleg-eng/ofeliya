# ANNEX C — Database Schema, RPC & API Contracts

**Part of:** `docs/architecture/OFELIYA_SERVER_ECONOMY_PLAN_20261025.md` · Date: 2026-10-25
**Scope:** the executable DDL, the RPC and edge-function specification, and the full endpoint contracts.

---

## C.1 The substrate, verified

| Fact | Evidence |
|---|---|
| The project uses **Supabase/Postgres** | `deploy/ofeliya-state.sql` — `create schema ofeliya_private`, `jsonb`, `bigint`, `timestamptz`, `plpgsql` |
| It is **not** D1, **not** SQLite, **not** MySQL | Zero DB deps in `package.json`; zero D1/SQLite/Prisma references outside prose |
| It is **not** on the app server | The Node app calls a Deno Deploy edge function, which calls PostgREST `/rest/v1/rpc/ofeliya_state_call` with `service_role` |
| The state RPC returns `409` on a conflict | `deploy/ofeliya-state-function.ts` — `return json(result, result.error ? 409 : 200)` |
| The app has **no SQL driver** | `package.json` — the runtime deps are only `@maxhub/max-bot-api` and `phaser` |

**Therefore:** the money path should **mirror** the state path — a Postgres schema + a `SECURITY INVOKER`
RPC + a token-gated edge function + a thin client. This keeps `SUPABASE_SERVICE_ROLE_KEY` **out of the
game server**. A leak of that key from the game server would be catastrophic.

---

## C.2 The migration model

**OFELIYA has no migration framework.** `deploy/ofeliya-state.sql` is a single idempotent script applied
**once, manually**, with no `schema_migrations` table and no version history.

The money schema must do better, because money DDL must be replayable and auditable:

```
deploy/ofeliya-pay/
  000_schema.sql        -- the schema, the grants, the RLS
  001_migrations.sql    -- the schema_migrations table
  010_catalog.sql       -- the catalog table
  020_operations.sql    -- the operation ledger
  030_entitlements.sql  -- the entitlement read model
  040_grants_log.sql    -- the audit trail
  050_reconcile.sql     -- the reconcile findings
  900_rpc.sql           -- the money RPC
```

Each script is idempotent (`create table if not exists`, `create or replace function`), and each records
its version in `ofeliya_pay.schema_migrations(version text primary key, applied_at timestamptz)`.

**`ofeliya_private.state` is untouched by the money work.** The state blob and the money tables are never
written in the same transaction.

---

## C.3 The DDL

### C.3.1 `000_schema.sql`

```sql
create schema if not exists ofeliya_pay;
revoke all on schema ofeliya_pay from public, anon, authenticated;
grant usage on schema ofeliya_pay to service_role;

create table if not exists ofeliya_pay.schema_migrations (
  version    text primary key,
  applied_at timestamptz not null default now()
);

-- The money path must never expose anything to anon/authenticated/public.
alter default privileges in schema ofeliya_pay revoke all on tables from public, anon, authenticated;
alter default privileges in schema ofeliya_pay revoke all on functions from public, anon, authenticated;
```

### C.3.2 `010_catalog.sql` — the authoritative SKU catalog

```sql
create table if not exists ofeliya_pay.catalog_sku (
  sku                text primary key,
  kind               text not null check (kind in ('COSMETIC','LAB_BRANCH','LAB_LEVEL','PRESTIGE')),
  title              text not null,
  description        text not null default '',
  price_stars        integer not null check (price_stars > 0),
  currency           text not null default 'XTR' check (currency = 'XTR'),
  entitlement_kind   text not null check (entitlement_kind in ('COSMETIC','STAT','PRESTIGE')),
  entitlement_key    text not null,
  entitlement_level  integer,
  max_level          integer,
  one_time_per_user  boolean not null default false,
  max_level_per_user integer,
  prerequisite_sku   text references ofeliya_pay.catalog_sku(sku),
  superseded_by      text references ofeliya_pay.catalog_sku(sku),
  version            integer not null default 1,
  enabled            boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint ck_catalog_level check (
    (entitlement_level is null and max_level is null)
    or (entitlement_level is not null and max_level is not null and entitlement_level <= max_level)
  )
);
create index if not exists ix_ofeliya_catalog_enabled
  on ofeliya_pay.catalog_sku (enabled);
create index if not exists ix_ofeliya_catalog_prereq
  on ofeliya_pay.catalog_sku (prerequisite_sku);

alter table ofeliya_pay.catalog_sku enable row level security;
grant select, insert, update on ofeliya_pay.catalog_sku to service_role;
```

**The critical column is `entitlement_key`**, not `sku`. The entitlement identity is
`(entitlement_key, level)`; the SKU is only *how it was bought*. This decouples the grant from the
purchase, which is what makes refunds, re-pricing and SKU migration safe.

### C.3.3 `020_operations.sql` — the append-only operation ledger

```sql
create table if not exists ofeliya_pay.operations (
  id                          uuid primary key default gen_random_uuid(),
  kind                        text not null check (kind in ('PURCHASE','REFUND','SPEND','GRANT')),
  user_key                    text not null,
  op_id                       text not null,
  op_fingerprint              text not null,
  sku                         text references ofeliya_pay.catalog_sku(sku),
  amount_stars                integer not null default 0,
  currency                    text not null default 'XTR' check (currency = 'XTR'),
  catalog_version             integer,
  invoice_payload             text,
  telegram_payment_charge_id  text,
  provider_payment_charge_id  text,
  entitlement_key             text,
  entitlement_level           integer,
  parent_operation_id         uuid references ofeliya_pay.operations(id),
  status                      text not null check (status in (
                                 'PENDING','ENTITLED','FAILED','REJECTED',
                                 'REFUND_PENDING','REFUNDED','REFUND_FAILED','LATE')),
  entitlement_snapshot        jsonb,
  raw_payload                 jsonb,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint uq_operations_user_op unique (user_key, kind, op_id)
);

-- The external money identity. One Telegram charge -> exactly one operation.
create unique index if not exists uq_operations_charge
  on ofeliya_pay.operations (telegram_payment_charge_id)
  where telegram_payment_charge_id is not null;

-- The DB-level one-time-SKU guard. A refunded purchase frees the slot again
-- (deliberate: refund = can rebuy). This closes the concurrent double-intent
-- race that an application-level pre-check cannot.
create unique index if not exists uq_operations_one_time_sku
  on ofeliya_pay.operations (user_key, sku)
  where sku is not null
    and status in ('PENDING','ENTITLED','LATE')
    and sku in ('cosmetic.skin.gilded_prime.v1', 'lab.branch.prestige_tier.v1');

create index if not exists ix_operations_user_created
  on ofeliya_pay.operations (user_key, created_at desc);
create index if not exists ix_operations_status
  on ofeliya_pay.operations (status);
create index if not exists ix_operations_parent
  on ofeliya_pay.operations (parent_operation_id);
create index if not exists ix_operations_user_fp
  on ofeliya_pay.operations (user_key, op_fingerprint);

alter table ofeliya_pay.operations enable row level security;
grant select, insert, update on ofeliya_pay.operations to service_role;
```

> **Note on the one-time list.** The literal `sku in (...)` list is a **v1 compromise** — it must be kept
> in sync with `catalog_sku.one_time_per_user`. The catalog-driven alternative is a `BEFORE INSERT`
> trigger that reads the catalog, at the cost of a per-row catalog lookup on every insert. For a v1
> catalog of a handful of SKUs, the literal is acceptable **and must be documented as such**. A drift
> check in the reconcile job should verify that the list matches the catalog.

> **Note on `gen_random_uuid()`.** It is built into PostgreSQL 13+. Confirm the Supabase version before
> relying on it; otherwise use `uuid-ossp`'s `uuid_generate_v4()` or generate the id in the RPC.

> **Note on `status`.** `PAID` is deliberately **absent**. Because the operation insert and the entitlement
> upsert happen in one transaction, an observer can never see a charged-but-not-granted state. `LATE` is
> the state for a charge whose intent TTL had already expired (main plan Annex B.4).

### C.3.4 `030_entitlements.sql` — the current-state read model

```sql
create table if not exists ofeliya_pay.entitlements (
  user_key            text not null,
  entitlement_key     text not null,
  level               integer not null default 0,
  source_operation_id uuid references ofeliya_pay.operations(id),
  granted_at          timestamptz not null default now(),
  revoked_at          timestamptz,
  metadata            jsonb not null default '{}'::jsonb,
  primary key (user_key, entitlement_key),
  constraint ck_entitlements_level check (level >= 0)
);
create index if not exists ix_entitlements_source
  on ofeliya_pay.entitlements (source_operation_id);
create index if not exists ix_entitlements_revoked
  on ofeliya_pay.entitlements (revoked_at)
  where revoked_at is not null;

alter table ofeliya_pay.entitlements enable row level security;
grant select, insert, update on ofeliya_pay.entitlements to service_role;
```

**A soft revoke (`revoked_at`), never a delete.** The ledger is the history; the entitlement is the state.
A refunded entitlement must still be visible to the audit and to the reconcile.

### C.3.5 `040_grants_log.sql` — the audit trail

```sql
create table if not exists ofeliya_pay.grants_log (
  id           bigserial primary key,
  user_key     text not null,
  operation_id uuid references ofeliya_pay.operations(id),
  action       text not null,
  reason       text,
  actor        text not null default 'system',
  context      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists ix_grants_log_user
  on ofeliya_pay.grants_log (user_key, created_at desc);

alter table ofeliya_pay.grants_log enable row level security;
grant select, insert on ofeliya_pay.grants_log to service_role;
```

### C.3.6 `050_reconcile.sql` — the findings

```sql
create table if not exists ofeliya_pay.reconcile_findings (
  finding_key   text primary key,
  kind          text not null,
  operation_id  uuid references ofeliya_pay.operations(id),
  severity      text not null check (severity in ('low','medium','high')),
  detail        jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  resolved_at   timestamptz,
  resolution    text
);
create index if not exists ix_reconcile_open
  on ofeliya_pay.reconcile_findings (kind, first_seen_at)
  where resolved_at is null;

alter table ofeliya_pay.reconcile_findings enable row level security;
grant select, insert, update on ofeliya_pay.reconcile_findings to service_role;
```

### C.3.7 `060_telegram_mirror.sql` — the Telegram transaction mirror + the scan checkpoint

The mirror of source **A** (main plan §14.1) and the durable scan position (§14.6). These two tables are
what turn "we read Telegram once" into "we have a durable, deduplicated, replayable view of every Telegram
Star transaction".

```sql
-- The mirror of the bot's Telegram Star transaction history.
-- One row per (transaction, direction). NOT one row per id: the Bot API states that a
-- refund "Coincides with the identifier of the original transaction", so a charge and
-- its refund share an id and are distinguished by direction.
create table if not exists ofeliya_pay.telegram_transactions (
  tx_key          text primary key,          -- sha256(tx_id || direction || amount || tx_date)
  tx_id           text not null,             -- StarTransaction.id
                                                  --   == telegram_payment_charge_id for an incoming payment
                                                  --   == the ORIGINAL id for a refund
  direction       text not null check (direction in ('IN','OUT')),
  amount          integer not null,          -- StarTransaction.amount
  nanostar_amount integer,                   -- StarTransaction.nanostar_amount (optional, fractional Stars)
  tx_date         timestamptz not null,      -- StarTransaction.date
  source_type     text,                      -- 'user' | 'fragment' | 'telegram_api' | ...
  source_tx_type  text,                      -- 'invoice_payment' | 'paid_media_payment' | 'gift_purchase' | ...
  payer_user_id   bigint,                    -- TransactionPartnerUser.user.id (an IN transaction only)
  invoice_payload text,                      -- TransactionPartnerUser.invoice_payload -- the subject-recovery hook
  peer_user_id    bigint,                    -- TransactionPartnerUser.user.id (an OUT transaction only)
  raw             jsonb not null default '{}'::jsonb,
  first_seen_at   timestamptz not null default now(),
  constraint uq_telegram_tx unique (tx_id, direction)
);

create index if not exists ix_telegram_tx_dir_date
  on ofeliya_pay.telegram_transactions (direction, tx_date desc);
create index if not exists ix_telegram_tx_payer
  on ofeliya_pay.telegram_transactions (payer_user_id)
  where payer_user_id is not null;

alter table ofeliya_pay.telegram_transactions enable row level security;
grant select, insert on ofeliya_pay.telegram_transactions to service_role;
```

```sql
-- The durable scan position. One row per bot.
--
-- IMPORTANT: the Bot API's `offset` is a POSITIONAL SKIP COUNT, not a server-issued
-- cursor. This row is therefore OUR construction, and it is valid only while the
-- transaction list is append-only and chronologically ordered. It is defended by
-- (a) the overlap re-read, (b) the ordering-violation guard, (c) the weekly full
-- re-scan, and (d) the test-environment verification of history completeness.
create table if not exists ofeliya_pay.telegram_scan_checkpoint (
  bot_key       text primary key,
  mode          text not null default 'INCREMENTAL' check (mode in ('INCREMENTAL','FULL')),
  last_offset   integer not null default 0,   -- the number of transactions fully ingested
  last_date     timestamptz,                  -- the newest tx_date ingested (the ordering guard)
  last_tx_key   text,
  last_scan_at  timestamptz,
  full_scan_at  timestamptz                   -- the last completed full (offset=0) scan
);

alter table ofeliya_pay.telegram_scan_checkpoint enable row level security;
grant select, insert, update on ofeliya_pay.telegram_scan_checkpoint to service_role;
```

**The write rule (the whole point of this table).** The checkpoint row and the page of mirrored transactions
are written **in the same database transaction**. A crash mid-page rolls back both, so the mirror is never
ahead of the checkpoint and a partial scan can never advance the position. This is what makes an incremental
scan safe to retry.

**The dedupe key.** `tx_key = sha256(tx_id || direction || amount || tx_date)`. The `direction` component is
**not optional**: without it, the re-ingest of a refund would collide with its original charge and the refund
would be silently dropped — the exact failure the whole correction exists to prevent.

### C.3.8 `900_rpc.sql` — the money RPC

The pattern is copied from `ofeliya_private.ofeliya_state_call`: `security invoker`, an empty
`search_path`, and the grants restricted to `service_role`.

```sql
create or replace function ofeliya_pay.purchase_call(
  op            text,
  user_key      text default null,
  op_id         text default null,
  op_fingerprint text default null,
  sku           text default null,
  amount_stars  integer default null,
  entitlement_key text default null,
  entitlement_level integer default null,
  charge_id     text default null,
  provider_charge_id text default null,
  invoice_payload text default null,
  raw_payload   jsonb default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_user text := user_key;
  v_row  ofeliya_pay.operations;
  v_cat  ofeliya_pay.catalog_sku;
  v_next integer;
begin
  if op = 'create_intent' then
    -- 1. the SKU must exist and be enabled
    select * into v_cat from ofeliya_pay.catalog_sku where ofeliya_pay.catalog_sku.sku = purchase_call.sku;
    if not found or not v_cat.enabled then
      return jsonb_build_object('error', 'sku-unavailable');
    end if;

    -- 2. the idempotency check, under the user lock
    perform pg_advisory_xact_lock(hashtextextended(v_user, 0));
    select * into v_row from ofeliya_pay.operations
      where user_key = v_user and kind = 'PURCHASE' and ofeliya_pay.operations.op_id = purchase_call.op_id;
    if found then
      if v_row.op_fingerprint <> purchase_call.op_fingerprint then
        return jsonb_build_object('error', 'idempotency-key-reuse');   -- FAIL CLOSED, no write
      end if;
      return jsonb_build_object('replayed', true, 'operation', row_to_json(v_row));
    end if;

    -- 3. the one-time guard (also enforced by the partial unique index)
    if v_cat.one_time_per_user then
      if exists (select 1 from ofeliya_pay.operations
                   where user_key = v_user and sku = purchase_call.sku
                     and status in ('PENDING','ENTITLED','LATE')) then
        return jsonb_build_object('error', 'one-time-already-owned');
      end if;
    end if;

    -- 4. the server computes the amount and the entitlement target
    insert into ofeliya_pay.operations
      (kind, user_key, op_id, op_fingerprint, sku, amount_stars, currency,
       catalog_version, entitlement_key, entitlement_level, status, invoice_payload)
    values
      ('PURCHASE', v_user, purchase_call.op_id, purchase_call.op_fingerprint, purchase_call.sku,
       v_cat.price_stars, v_cat.currency, v_cat.version,
       v_cat.entitlement_key, v_cat.entitlement_level, 'PENDING', purchase_call.invoice_payload)
    returning * into v_row;
    return jsonb_build_object('operation', row_to_json(v_row));

  elsif op = 'fulfill' then
    perform pg_advisory_xact_lock(hashtextextended(v_user, 0));

    -- the charge id is the external anchor
    select * into v_row from ofeliya_pay.operations
      where telegram_payment_charge_id = purchase_call.charge_id;
    if found then
      return jsonb_build_object('replayed', true, 'operation', row_to_json(v_row));
    end if;

    select * into v_row from ofeliya_pay.operations
      where user_key = v_user and kind = 'PURCHASE' and op_id = purchase_call.op_id
      for update;
    if not found then
      return jsonb_build_object('error', 'intent-not-found');
    end if;
    if v_row.status = 'ENTITLED' then
      return jsonb_build_object('replayed', true, 'operation', row_to_json(v_row));
    end if;
    if v_row.status not in ('PENDING','LATE') then
      return jsonb_build_object('error', 'intent-not-fulfillable');
    end if;

    -- the amount must equal the server's own recomputed amount
    select * into v_cat from ofeliya_pay.catalog_sku where ofeliya_pay.catalog_sku.sku = v_row.sku;
    if purchase_call.amount_stars is distinct from v_cat.price_stars then
      update ofeliya_pay.operations set status = 'REJECTED', updated_at = now() where id = v_row.id;
      return jsonb_build_object('error', 'price-mismatch');
    end if;

    -- the next legal level is computed by the server, never by the client
    select coalesce(max(level), 0) + 1 into v_next
      from ofeliya_pay.entitlements
      where user_key = v_user and entitlement_key = v_row.entitlement_key and revoked_at is null;

    update ofeliya_pay.operations
       set status = 'ENTITLED',
           telegram_payment_charge_id = purchase_call.charge_id,
           provider_payment_charge_id = purchase_call.provider_charge_id,
           amount_stars = purchase_call.amount_stars,
           entitlement_level = v_next,
           raw_payload = purchase_call.raw_payload,
           entitlement_snapshot = jsonb_build_object('key', v_row.entitlement_key, 'level', v_next),
           updated_at = now()
     where id = v_row.id
    returning * into v_row;

    insert into ofeliya_pay.entitlements (user_key, entitlement_key, level, source_operation_id)
    values (v_user, v_row.entitlement_key, v_next, v_row.id)
    on conflict (user_key, entitlement_key) do update
      set level = excluded.level, source_operation_id = excluded.source_operation_id,
          granted_at = now(), revoked_at = null;

    insert into ofeliya_pay.grants_log (user_key, operation_id, action, context)
    values (v_user, v_row.id, 'entitlement_granted',
            jsonb_build_object('key', v_row.entitlement_key, 'level', v_next));

    return jsonb_build_object('operation', row_to_json(v_row));

  elsif op = 'refund_begin' then
    -- REVOKE FIRST, then call Telegram OUTSIDE this transaction.
    perform pg_advisory_xact_lock(hashtextextended(v_user, 0));
    select * into v_row from ofeliya_pay.operations
      where id = purchase_call.op_id for update;
    if not found or v_row.status <> 'ENTITLED' then
      return jsonb_build_object('error', 'not-refundable');
    end if;

    update ofeliya_pay.entitlements
       set revoked_at = now()
     where user_key = v_user and entitlement_key = v_row.entitlement_key
       and revoked_at is null and source_operation_id = v_row.id;

    update ofeliya_pay.operations set status = 'REFUND_PENDING', updated_at = now()
     where id = v_row.id returning * into v_row;

    insert into ofeliya_pay.grants_log (user_key, operation_id, action, context)
    values (v_user, v_row.id, 'refund_started', jsonb_build_object('charge', v_row.telegram_payment_charge_id));

    return jsonb_build_object('operation', row_to_json(v_row));

  elsif op = 'refund_settle' then
    update ofeliya_pay.operations
       set status = case when purchase_call.raw_payload->>'ok' = 'true'
                         then 'REFUNDED' else 'REFUND_FAILED' end,
           updated_at = now()
     where id = purchase_call.op_id
    returning * into v_row;

    insert into ofeliya_pay.grants_log (user_key, operation_id, action, context)
    values (v_user, v_row.id, 'refund_settled', purchase_call.raw_payload);

    return jsonb_build_object('operation', row_to_json(v_row));

  elsif op = 'state' then
    return jsonb_build_object(
      'entitlements', coalesce((
        select jsonb_agg(row_to_json(e)) from ofeliya_pay.entitlements e
         where e.user_key = v_user and e.revoked_at is null), '[]'::jsonb),
      'purchases', coalesce((
        select jsonb_agg(row_to_json(o)) from ofeliya_pay.operations o
         where o.user_key = v_user and o.kind = 'PURCHASE'
         order by o.created_at desc limit 50), '[]'::jsonb)
    );
  end if;

  raise exception 'invalid ofeliya_pay operation';
end;
$$;

revoke all on function ofeliya_pay.purchase_call(text,text,text,text,text,integer,text,integer,text,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function ofeliya_pay.purchase_call(text,text,text,text,text,integer,text,integer,text,text,text,jsonb)
  to service_role;
```

> **Note on the `create_intent` step 4.** The `invoice_payload` is minted by the server. It must be
> ≤128 bytes (Telegram's limit), opaque to the client, and encode the operation id so that the
> `successful_payment` can be routed back to the operation. A natural encoding is
> `ofeliya:<base64url(op_id)>` — short, opaque, and reversible by the server.

> **Note on the level computation.** `v_next` is `max(level) + 1` over the *non-revoked* entitlement. If
> the entitlement was revoked by a refund, the next purchase re-grants at the correct level — this is the
> "refund frees the slot" rule.

---

## C.4 The edge function

The pattern is copied from `deploy/ofeliya-state-function.ts` — a Deno Deploy function with its own
bearer authentication.

```ts
// deploy/ofeliya-pay-function.ts
const TOKEN_SHA256 = '__OFELIYA_PAY_TOKEN_SHA256__';

Deno.serve(async (req: Request) => {
  try {
    const token = req.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
    if (!/^[a-f0-9]{64}$/.test(token)) return json({ error: 'unauthorized' }, 401);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    const hex = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
    if (hex !== TOKEN_SHA256) return json({ error: 'unauthorized' }, 401);

    if (req.method !== 'POST') return json({ error: 'method' }, 405);
    if (Number(req.headers.get('content-length') ?? 0) > 1_000_000) return json({ error: 'too-large' }, 413);

    const input = await req.json();
    if (!['create_intent','fulfill','refund_begin','refund_settle','state'].includes(input.op)) {
      return json({ error: 'operation' }, 400);
    }
    // NOTE: the admin reconcile op is deliberately NOT in this whitelist.
    // It has its own edge function / token, so a compromise of the payment
    // token cannot trigger a manual grant.

    const response = await fetch(Deno.env.get('SUPABASE_URL') + '/rest/v1/rpc/purchase_call', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        authorization: 'Bearer ' + Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return json({ error: 'database-unavailable' }, 503);
    const result = await response.json();
    return json(result, result.error ? 409 : 200);
  } catch {
    return json({ error: 'state-unavailable' }, 503);
  }
});
```

**The two deliberate differences from the state function:**

1. **A separate token.** `OFELIYA_PAY_TOKEN` ≠ `OFELIYA_STATE_TOKEN`. A leak of the state token must
   not grant money operations.
2. **The admin reconcile op is not in the whitelist.** A manual grant must not be reachable with the
   payment token. It needs its own path.

**Also note:** the `503` on a database failure is the *fail-closed* path. The client must never present an
invoice when this returns 503.

---

## C.5 The full endpoint contracts

### C.5.1 `GET /api/storefront/catalog`

**Request** — none required. The optional `Authorization`-equivalent is the platform + `initData` if the
client wants "owned" decoration.

**Response `200`**
```json
{
  "catalogVersion": 42,
  "skus": [
    {
      "sku": "cosmetic.skin.gilded_prime.v1",
      "kind": "COSMETIC",
      "title": "Золотая Прима",
      "description": "...",
      "priceStars": 250,
      "currency": "XTR",
      "entitlement": { "kind": "COSMETIC", "key": "skin.gilded_prime", "maxLevel": null },
      "available": true,
      "unavailableReason": null,
      "oneTimePerUser": true,
      "prerequisiteSku": null
    }
  ]
}
```

**Idempotency** — N/A (read-only).

**Failure modes** — `503` if the catalog cannot be read → the storefront renders "магазин временно
недоступен"; `500` on an internal error.

**The client's duty** — treat `priceStars` as **informational**. The server recomputes it.

### C.5.2 `GET /api/storefront/state`

**Request** — `{ platform: 'telegram' | 'max', initData }`.

**Response `200`**
```json
{
  "userKey": "telegram:123456789",
  "entitlements": [ { "key": "skin.gilded_prime", "level": 1, "kind": "COSMETIC", "revoked": false } ],
  "purchases":  [ { "opId": "abc...", "sku": "cosmetic.skin.gilded_prime.v1", "status": "ENTITLED",
                    "amountStars": 250, "createdAt": "2026-10-25T09:00:00Z" } ],
  "stateVersion": 1732
}
```

**Server validation** — `validateInitData`; the `userKey` is derived, never sent.

**Idempotency** — N/A (read-only).

**Failure modes** — `403` on an invalid signature; `422` on a malformed body; `503` if the ledger is
unavailable → **the client must not fall back to local state**; it shows "не удалось загрузить покупки".

### C.5.3 `POST /api/storefront/purchase`

**Request**
```json
{ "platform": "telegram", "initData": "...", "opId": "b3f1c2d4e5a6789012345678", "sku": "cosmetic.skin.gilded_prime.v1" }
```

**Server validation, in order** — identity → the `opId` shape → the SKU exists and is enabled → the
prerequisite → the entitlement state → the idempotency (the fingerprint) → create the intent.

**Response `202`**
```json
{
  "opId": "b3f1c2d4e5a6789012345678",
  "sku": "cosmetic.skin.gilded_prime.v1",
  "status": "PENDING",
  "payment": { "currency": "XTR", "amountStars": 250, "invoicePayload": "ofeliya:..." },
  "stateVersion": 1733
}
```

**Response `200`** — the same shape plus `"replayed": true`, when the operation already exists with the
same fingerprint.

**Failure modes** — `400` a malformed `opId`; `401`/`403` an invalid signature; `404` an unknown or
disabled SKU; `409 IDEMPOTENCY_KEY_REUSE`; `409 ONE_TIME_ALREADY_OWNED`; `410 OFFER_EXPIRED`; `422` an
unsatisfiable state; `429` rate limited; `503` the ledger is unavailable → **no intent is created**.

### C.5.4 `POST /api/storefront/fulfill`

Called by the **bot**, not by the client.

**Request**
```json
{
  "platform": "telegram",
  "initData": "...",
  "successfulPayment": {
    "currency": "XTR", "total_amount": 250, "invoice_payload": "ofeliya:...",
    "telegram_payment_charge_id": "...", "provider_payment_charge_id": "..."
  }
}
```

**Server validation** — identity → `currency === 'XTR'` → the payload resolves to a live `PENDING`
operation owned by this user → the charge id is unused → the amount equals the server's recomputed
amount → the transaction.

**Response `200`**
```json
{ "opId": "...", "status": "ENTITLED", "entitlement": { "key": "skin.gilded_prime", "level": 1 },
  "stateVersion": 1734 }
```

**Failure modes** — `409 CHARGE_ID_ALREADY_APPLIED` → returns the **original** result (a replay);
`409 PRICE_MISMATCH` → the operation is marked `REJECTED`, nothing is granted, an alert fires;
`422 INTENT_EXPIRED` / `INTENT_NOT_FULFILLABLE`; `503` the ledger is unavailable → nothing is granted
and the webhook is retried.

### C.5.5 `POST /api/storefront/restore`

**Request** — `{ platform, initData }`.
**Response `200`** — `{ "entitlements": [ { "key": "...", "level": 1, "kind": "COSMETIC" } ] }`.
**Idempotency** — it is a read; safe to call repeatedly, from any device.
**Failure modes** — `403` an invalid signature; `503` → the client shows "не удалось восстановить
покупки" and **must not** fall back to the local cache.

### C.5.6 `POST /api/admin/reconcile`

**Auth** — an admin token, separate from `OFELIYA_PAY_TOKEN` and from `OFELIYA_STATE_TOKEN`.

**Request** — `{ "op": "scan" }` or
`{ "op": "repair", "findingKey": "...", "reason": "...", "chargeReference": "..." }`.

**Response `200`** — `{ "findings": [ ... ] }` or `{ "applied": true }`.

**Failure modes** — `401`/`403`; `409 { "error": "manual-review-required" }` when a repair would grant
value without a charge reference; `422` an unknown `findingKey`.

---

## C.6 The API summary

| Endpoint | Auth | Method | Idempotent | Writes money state |
|---|---|---|---|---|
| `GET /api/storefront/catalog` | none (optional initData) | GET | n/a | no |
| `GET /api/storefront/state` | initData | GET | n/a | no |
| `POST /api/storefront/purchase` | initData | POST | ✅ by `opId` | creates the intent |
| `POST /api/storefront/fulfill` | the bot | POST | ✅ by the charge id | ✅ grants |
| `POST /api/storefront/restore` | initData | POST | ✅ read-only | no |
| `POST /api/admin/reconcile` | an admin token | POST | ✅ | only on an explicit repair |

**Six endpoints.** Anything else is an implementation detail.

---

## C.7 The client/server trust matrix (the full table)

| Field | The client may send? | The server trusts? | The server recomputes? | Persisted where |
|---|---|---|---|---|
| `platform` | ✅ | ✅ (the allowlist `max`/`telegram`) | — | — |
| `initData` | ✅ | ✅ (the signature) | — | — |
| the user id / uid | ❌ **derived only** | ✅ derived | ✅ from `validateInitData` | `operations.user_key`, `entitlements.user_key` |
| `opId` | ✅ | ⚠️ only as a *proposal* | ✅ bound into the fingerprint | `operations.op_id` |
| `opFingerprint` | ❌ | — | ✅ computed | `operations.op_fingerprint` |
| the SKU | ✅ (a request) | ⚠️ only to *look up* | ✅ resolved → the price + the entitlement target | `operations.sku` |
| the price / amount | ❌ | ❌ | ✅ from `catalog_sku` | `operations.amount_stars` |
| the currency | ❌ | ❌ (always `XTR`) | ✅ | `operations.currency` |
| `branchId` | ❌ (an intent only) | ❌ | ✅ the server decides the next legal branch/level | `operations.entitlement_key` / `entitlement_level` |
| the level / `newLevel` | ❌ | ❌ | ✅ the server computes it from the current entitlement | `entitlements.level` |
| the Stars transaction id | ❌ | ❌ from the client | ✅ from Telegram's `successful_payment` | `operations.telegram_payment_charge_id` (UNIQUE) |
| the invoice payload | ❌ | ❌ from the client | ✅ server-minted | `operations.invoice_payload` |
| the entitlement | ❌ | ❌ | ✅ derived from `entitlements` | `ofeliya_pay.entitlements` |
| the wallet balance | ❌ | ❌ | ✅ derived from the ledger | *(none in v1)* |
| the purchase status | ❌ | ❌ | ✅ | `operations.status` |
| the refund status | ❌ | ❌ | ✅ | `operations.status` (`REFUND_*`) |
| the catalog version | ❌ | ❌ | ✅ | `operations.catalog_version` |
| `stateVersion` | ❌ (a read) | — | ✅ monotonic | the response only |
| the admin token / reason | ✅ (admin) | ✅ | — | `grants_log` |

**Reading the matrix** — every row where "the client may send" is ✅ and "the server trusts" is ⚠️ or ❌
is a place where the client *suggests* and the server *decides*. Those are the only legitimate request
fields. Everything else is either derived or forbidden.
