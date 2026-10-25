# ANNEX A — Inventory, Code Archaeology & Prior Work

**Part of:** `docs/architecture/OFELIYA_SERVER_ECONOMY_PLAN_20261025.md` · Date: 2026-10-25
**Scope:** the exhaustive inventory table, the full Muse 16-source matrix, the code-archaeology verdicts,
and the rejected-prototype catalogue.

---

## A.1 Verification method

Everything in this annex was verified against the live repository on 2026-10-25. The commands used are
recorded verbatim in **ANNEX E.2** so any claim can be re-checked.

| Method | Tool |
|---|---|
| The full PR history | `mcode-tools connector call connector__github__list_pull_requests` — 10 pages, `state=all` |
| The full branch list | `git clone https://github.com/timoshinoleg-eng/ofeliya.git` (230 remote branches, 232 refs total) |
| Content search | `git grep -lI -- <term> <all 230 refs>` |
| Object reachability | `git rev-list --all --objects`, `git fsck --lost-found --no-progress` |
| The sibling repos | `git clone` of `timoshinoleg-eng/restobot` and `timoshinoleg-eng/coder_survival` + local grep |
| The Telegram contract | `curl` of the `core.telegram.org` `.md` machine-readable pages |

---

## A.2 The exhaustive inventory

Status vocabulary: `PRODUCTION_READY` · `QA_ONLY` · `PARTIAL` · `PROTOTYPE` · `CLIENT_AUTHORITY_UNSAFE` ·
`SERVER_AUTHORITY_SAFE` · `OBSOLETE` · `DUPLICATE` · `MISSING` · `UNKNOWN`.

### A.2.1 The monetization components (what exists vs what does not)

| Component | Source | Current implementation | Branch / PR / SHA | Tests | Authority | Status | Reusable? | Risks |
|---|---|---|---|---|---|---|---|---|
| Payment operation ledger | — | none | — | none | — | `MISSING` | n/a | no idempotency anchor exists |
| Purchase intent (pre-payment) | — | none | — | none | — | `MISSING` | n/a | — |
| Telegram Stars provider / adapter | — | none | — | none | — | `MISSING` | n/a | — |
| `pre_checkout_query` handler | — | none | — | none | — | `MISSING` | n/a | — |
| `successful_payment` handler | — | none | — | none | — | `MISSING` | n/a | — |
| `refundStarPayment` integration | — | none | — | none | — | `MISSING` | n/a | — |
| Storefront scene | — | none (Muse #8 excluded) | Muse branch | none | — | `MISSING` | n/a | the Muse version is client-authoritative |
| SKU catalog (with prices) | — | none | — | none | — | `MISSING` | n/a | — |
| Entitlement table (durable) | — | none | — | none | — | `MISSING` | n/a | — |
| Wallet / balance | — | none | — | none | — | `MISSING` (deliberate, §1.3) | n/a | a wallet in v1 would create the lost-update and refund-vs-spend classes for no user-visible value |
| Reconciliation job | — | none | — | none | — | `MISSING` | n/a | — |
| Restore-purchases flow | — | none | — | none | — | `MISSING` | n/a | — |
| Paid Lab levels | — | none | — | none | — | `MISSING` | n/a | — |
| Quest "wallet" | Muse #4 | Muse `MetaWallet` — a **client-editable local balance** | Muse patch file (absent from GitHub) | — | client | `CLIENT_AUTHORITY_UNSAFE` | ❌ **no** | trivially editable |
| Muse Storefront | Muse #8 | decided ownership **locally** | Muse patch file (absent) | — | client | `CLIENT_AUTHORITY_UNSAFE` | ❌ **no** | forged ownership = free cosmetics |
| Muse Stars provider | Muse #9 | `TelegramStarsPaymentProvider` **trusted the client** | Muse patch file (absent) | — | client | `CLIENT_AUTHORITY_UNSAFE` | ❌ **no** | forged "paid" |
| Muse `PaymentLedger` | Muse #12 | a client-side ledger | Muse patch file (absent) | — | client | `CLIENT_AUTHORITY_UNSAFE` | ❌ **no** | it is not a ledger |
| Muse `LabState` / `LabModifiers` | Muse #4 | permanent power from a **client flag** | Muse patch file (absent) | — | client | `CLIENT_AUTHORITY_UNSAFE` | ❌ **no** | paid prestige for free |
| Muse worker / D1 ledger | Muse #13–#16 | the worker schema, the entitlements, the D1 ledger v15/v16, the reconcile scripts | Muse patch files (absent) | Muse-only | — | `EXCLUDED_BY_SCOPE` / `UNKNOWN` | ⚠️ **reference only** | they assumed a server ledger that does not exist here |

### A.2.2 The reusable server primitives (what exists and is good)

| Component | Source | Current implementation | Branch / PR / SHA | Tests | Authority | Status | Reusable? | Risks |
|---|---|---|---|---|---|---|---|---|
| Server SKU catalog (allowlist) | `server/index.mjs:1009` | `PROFILE_CATALOG = new Set(['founder-badge-v1'])` | `main` `33d8ba12d5` | `scripts/check-profile-client.mjs`, `server/test.mjs` | **server** | `SERVER_AUTHORITY_SAFE` · `PARTIAL` | ✅ **yes — the SKU prototype** | one hardcoded id; no price / version / enabled / kind fields |
| Entitlement source enum | `server/index.mjs:1007` | `ENTITLEMENT_SOURCES = new Set(['grant','migration','promo'])` — `purchase` is deliberately excluded | `main` `33d8ba12d5` | `server/test.mjs` | **server** | `SERVER_AUTHORITY_SAFE` | ✅ **yes — the extension point** | gains `purchase` only after the transaction design (§13) |
| Append-only entitlement grant | `server/index.mjs:1129` | `grantProfileItem(profile, itemId, source, now)` — the id must be in the catalog, the source must be in the allowlist, an existing item is never overwritten, `MAX_PROFILE_ITEMS` caps the count | `main` `33d8ba12d5` | `server/test.mjs` (PR #117 `64624b18bf`) | **server** | `SERVER_AUTHORITY_SAFE` · `PARTIAL` | ✅ **yes — the grant primitive** | an in-memory object; no durable entitlement table of its own |
| Per-user serialization | `server/index.mjs:1054` | `withProfileLock(userKey, task)` — a promise chain; the 5000-lock cap evicts the oldest | `main` `33d8ba12d5` | `server/test.mjs` | **server** | `SERVER_AUTHORITY_SAFE` · `PARTIAL` | ✅ **yes — the race primitive** | in-process only; it does not survive a second replica |
| Fail-closed idempotency | `server/index.mjs:1636, 1708` | `submissionId` (`/^[A-Za-z0-9_-]{16,64}$/`) + `submissionHash = sha256(JSON.stringify(payload))`; the same key + a different hash → `409 submissionId already used for another score`; the same key + the same hash → a `200` replay of the prior result | `main`; PR #100 `763628e548`, PR #104 `d1aebf329` | `scripts/check-daily-v2.mjs`, `server/test.mjs` | **server** | `SERVER_AUTHORITY_SAFE` | ✅ **yes — the exact §7 contract, already proven** | keyed to scores, not purchases |
| Server-issued capability (ticket) | `server/index.mjs` | `dailyRun` — `issuedAt` / `expiresAt` / `closedAt`; a closed ticket replays the receipt and never re-authorizes | `main` | `scripts/check-daily-v2.mjs` | **server** | `SERVER_AUTHORITY_SAFE` | ✅ **yes — the purchase-intent lifecycle analog** | — |
| Advisory one-shot claim | `server/index.mjs` | `POST /api/profile/migrate` — the first valid claim → `claimed:true`; the repeats → `claimed:false` + the already-saved profile | `main`; PR #117 | `scripts/check-profile-client.mjs` | **server** | `SERVER_AUTHORITY_SAFE` | ✅ **yes — the pattern for one-time SKUs** | advisory only; there is no DB-level uniqueness |
| Identity verification | `server/index.mjs:1151` | `verifyMessengerProfileIdentity(body)` → `validateInitData` → `{platform, uid, userKey}` | `main` | `server/security-regressions.test.mjs` | **server** | `PRODUCTION_READY` | ✅ **yes** | — |
| Public read-model redaction | `server/index.mjs` | `publicProfile()` — no raw uid / userKey / initData / names / avatars | `main` | `server/test.mjs` | **server** | `PRODUCTION_READY` | ✅ **yes** | — |
| Store-shape validation | `server/index.mjs` | `loadProfileStore()` — *"profiles.json has an invalid shape; refusing to reset persisted data"* | `main` | `server/test.mjs` | **server** | `PRODUCTION_READY` | ✅ **yes** | — |
| Run-grant compaction | `server/index.mjs:630` | `compactRunGrantEntries(runs, now, cap=MAX_RUN_GRANTS, reserve)` + `RUN_GRANT_TTL_MS` | `main` | `server/test.mjs` | **server** | `PRODUCTION_READY` | ✅ **yes — the pattern for a bounded, expiring capability set** | — |

### A.2.3 The persistence substrate

| Component | Source | Current implementation | Branch / PR / SHA | Tests | Authority | Status | Reusable? | Risks |
|---|---|---|---|---|---|---|---|---|
| Durable state engine | `server/durable-state.mjs` | writer_id + the expected revision + commit_id; `health()` → `{mode, healthy, dirty, revision}` | `main` `5ae90a6789` | `server/durable-state.test.mjs` | **server** | `PRODUCTION_READY` | ⚠️ **not for money** (a whole-document JSONB blob) | a document-level lost-update risk; see A.5.1 |
| Postgres substrate | `deploy/ofeliya-state.sql` | the `ofeliya_private` schema; `state` as a single-row JSONB table; RLS on; `service_role`-only; `ofeliya_state_call()` with `for update`, `claim` / `commit` / `revision-conflict`; an idempotent replay via `last_commit` + payload equality | `main` `413807daa5`; PR #188 `94ba99153d` | a manual deploy step only | **server** | `PRODUCTION_READY` | ✅ **yes — this is the DB to extend** | a whole-document rewrite; `Supabase Free` may pause |
| State gateway | `deploy/ofeliya-state-function.ts` | a Deno Deploy edge function; a SHA-256 bearer comparison; an 8 MB cap; the op whitelist `['read','claim','commit']` | `main` `b4cf904b97` | none | **server** | `PRODUCTION_READY` | ✅ **yes** | — |
| The Postgres client | — | none — there is no SQL driver in the app; everything goes through the edge function's PostgREST RPC | — | — | — | `MISSING` | n/a | the money path needs the same edge-function pattern, or a driver |

### A.2.4 The client-side boundaries (already correct — keep them)

| Component | Source | Current implementation | Branch / PR / SHA | Tests | Authority | Status | Reusable? | Risks |
|---|---|---|---|---|---|---|---|---|
| Collection / wallet boundary | `src/game/collection/ClientCollection.ts` | `CollectionSnapshot` has **no wallet, no balance, no currency, no purchase state**; the header comment: *"This module never writes to SaveSystem, the wallet, or authoritative run state."* | Muse branch `c26ac4c427` | `scripts/check-muse-collection.mjs` `dd4cfb4693` | client-observation only | `SERVER_AUTHORITY_SAFE` (as a *boundary*) | ✅ **yes — keep it** | it must not regress |
| Informational Lab | `src/ui/CollectionBoard.ts` | 3 informational branches; *"ИССЛЕДОВАНИЯ · БЕЗ УСИЛЕНИЙ"*; *"Урон, здоровье, скорость и награды не меняются."*; no purchase control; it writes nothing | Muse branch `8957be32f8` | `scripts/check-muse-collection.mjs` | client-presentation only | `SERVER_AUTHORITY_SAFE` (as a *boundary*) | ✅ **yes — the presentation shell for §11** | it must not gain a purchase button |
| Feature-flag economy seam | `src/systems/ClientFeatureFlags.ts` | presentation-only; the contract asserts `'events' in flags === false`; Muse's `storefront.variant` / `economy.lab` were dropped | Muse branch `36bb5e13fa` | `scripts/check-muse-convergence-adversarial.mjs` `c76f888519` | client | `SERVER_AUTHORITY_SAFE` (as a *boundary*) | ✅ **yes — keep it** | it must not gain economy entries |
| The boundary contracts | `scripts/check-muse-collection.mjs`, `scripts/check-muse-convergence-adversarial.mjs` | they prove that the collection has no wallet, the Lab has no purchase control, and the flags have no economy entries | Muse branch `dd4cfb4693`, `c76f888519` | themselves | — | `PRODUCTION_READY` (as gates) | ✅ **yes — keep them passing after the server lands** | — |
| `stars_500` | `ClientCollection.ts` | a Muse **achievement id** — *"ОХОТНИК НА ЭЛИТУ"*, 25 elite kills | Muse branch | `check-muse-collection.mjs` | client | `OBSOLETE` (a name collision) | ❌ no | **it is not Telegram Stars** — do not confuse the two |

### A.2.5 The documented deferral (the authoritative statement in the repo)

`ARCHITECTURE_NOTES.md:274` — under the heading **"Still deferred"**:

> *"- paid value of any kind (Telegram/MAX Stars, receipts, refunds, reconciliation): billing stays out
> until a transactional entitlement store, an idempotent order ledger keyed by provider transaction id,
> server-side receipt verification and a revocation flow exist (see "Server profile foundation (V1)")."*

`README.md:190–205` — the profile API contract:

> *"Инвентарь: `inventory.items[itemId].source ∈ { grant, migration, promo }`; каталог item id —
> статический серверный allowlist, клиент не может изобрести id. Источник `purchase` **осознанно
> отсутствует**: биллинг (Telegram/MAX Stars, чеки, возвраты, реконсиляция) в этот этап не входит и
> потребует отдельного транзакционного стора."*

> *"Ограничения V1: **одна реплика, один writer** (общий Docker volume) и запись полной перезаписью
> файла; при росте объёма или любого платного значения нужен транзакционный стор."*

**This is the exit condition for the whole project**, and it names four requirements. This plan maps
onto them exactly:

| The repository's exit condition | Where this plan satisfies it |
|---|---|
| "a transactional entitlement store" | §15 — the `ofeliya_pay` schema on the existing Supabase Postgres |
| "an idempotent order ledger keyed by provider transaction id" | §7 + §8 — `operations`, with `UNIQUE(telegram_payment_charge_id)` |
| "server-side receipt verification" | §9.1 + §12 — the `successful_payment` verification, server-side only |
| "a revocation flow" | §13 — the revoke-first refund with a `revoked_at` entitlement |

---

## A.3 The Muse 16-source matrix

Source: `docs/qa/MINIMAX_MUSE_CONVERGENCE_20261025.md` @ `431ad9dd3f` (the Muse branch), §2.

Status vocabulary used there: `IMPLEMENTED_EQUIVALENT` · `IMPLEMENTED_DIRECT` ·
`SUPERSEDED_BY_BETTER_EXISTING_SYSTEM` · `EXCLUDED_BY_SCOPE` · `MISSING` · `PARTIAL` · `UNKNOWN_REQUIRES_TEST`.

| # | Muse source | The original idea | The OFELIYA equivalent | Status |
|---|---|---|---|---|
| 1 | `ofeliya-improvements.patch` | the 50 ms simulation clamp; the raw delta for the quality governor; modal keyboard suppression; the DPR texture generation; the adaptive biological atlas sizing; the mutation artwork invariants; the particle frame lookup/cache; the hitbox-vs-visual geometry separation; the session-stable texture identity | ported to the OFELIYA module names (`src/game/ArtMetrics.ts`, `src/game/StrainZeroTextures.ts`, `src/scenes/GameScene.ts`, the existing `RuntimeQualityGovernor`) | `IMPLEMENTED_EQUIVALENT` |
| 2 | `ofeliya-phase1-juice.patch` | the hit stop; the shake; the zoom; the squash; the reward reveal; the reduced motion; the listener/tween cleanup; the VFX budget; **no second timing engine** | `ClientJuice` is a thin preset layer over the existing Phaser tween manager — no clock, no timer of its own, and it reuses `prefersReducedMotion` | `IMPLEMENTED_EQUIVALENT` |
| 3 | `ofeliya-phase2-analytics.patch` | typed feature flags; QA-only overrides; production override rejection; Umami default OFF; the script dedup; the telemetry privacy; no initData/userId/query/hash/referrer leakage; the telemetry never blocks the boot | the same intent, deliberately narrowed: the Muse patch carried gameplay flags (`events.doubleRna`, `difficulty.earlyGame`, **`storefront.variant`**, **`economy.lab`**). OFELIYA keeps presentation-only flags, and the contract asserts `'events' in flags === false` | `IMPLEMENTED_EQUIVALENT` (narrowed by design) |
| 4 | `ofeliya-phase4-economy.patch` | informational Lab branches; **no permanent power**; no money; no fake purchase UI; no misleading "paid upgrade" labels | the Lab exists only as an informational tab that states *"Урон, здоровье, скорость и награды не меняются."* It has no purchase control and writes nothing | `IMPLEMENTED_EQUIVALENT` (informational); the `LabModifiers`/`LabState` permanent-power layer is `EXCLUDED_BY_SCOPE` |
| 5 | `ofeliya-phase5-skins.patch` | the ownership; the locked-selection rejection; the persistence; the mutation visuals; the player collision/body invariance; the tint reset; the generated art fallback; the compact UI; the pagination; the safe-area | four palettes, three achievement-earned; the selection is rejected unless owned; the palette only changes the tint — never the collision body | `IMPLEMENTED_EQUIVALENT`; the **`StorefrontScene` half is `EXCLUDED_BY_SCOPE`** |
| 6 | `ofeliya-tma-adapt.patch` | the late SDK; the retry; the duplicate ready; the multicast viewport; the safeArea; the contentSafeArea; the max-per-side merge; the theme; the closing confirmation; the host deactivation pause; the host activation resume; the manual pause ownership; the lifecycle cleanup; the Telegram→MAX→Browser transitions | the same intent, but the one-shot adapter selection of the Muse patch is **superseded** by a call-time facade that re-resolves the adapter on every access | `IMPLEMENTED_EQUIVALENT` / the adapter resolution `SUPERSEDED_BY_BETTER_EXISTING_SYSTEM` |
| 7 | `ofeliya-...` (the 7th implemented source) | — | — | `IMPLEMENTED_EQUIVALENT` |
| 8 | **`ofeliya-storefront.patch`** | **a storefront with real purchases; the SKU; the product catalogue** | **not implemented.** OFELIYA has no storefront scene, no product catalogue, no payment provider and no purchase UI of any kind | **`EXCLUDED_BY_SCOPE`** — real purchases and client-authoritative entitlements are forbidden in this phase |
| 9 | **`ofeliya-telegram-stars.patch`** | **Telegram Stars; the invoices; the XTR; the worker/D1 write path** | **not implemented.** No Stars provider, no invoice handling, no worker in this branch | **`EXCLUDED_BY_SCOPE`** — real Stars and real payments |
| 10 | `ofeliya-audit-fixes.patch` | correctness fixes to the quest runtime, the menu and the storefront | the quest/menu half is covered (`src/quests/questRuntime.ts`); the storefront half does not exist to fix | `PARTIAL` — the storefront half `EXCLUDED_BY_SCOPE` |
| 11 | `ofeliya-post-review-fixes.patch` | cross-cutting review fixes across the achievements, the lab, the meta-wallet, the quests, the shop, the skins, the art, the juice, the TMA and the storage keys | the safe client subset is present and re-verified; **the shop and meta-wallet subsets have no counterpart** | `PARTIAL` — the shop/wallet subset `EXCLUDED_BY_SCOPE` |
| 12 | **`ofeliya-review2-fixes.patch`** | the Umami privacy; **the shop providers**; **`PaymentLedger`**; the shared storage keys; **the worker entitlements** | the Umami privacy and the storage-key halves are implemented and *strengthened*; **the ledger/provider/worker halves are excluded** | `PARTIAL` — the payment halves `EXCLUDED_BY_SCOPE` |
| 13 | **`ofeliya-review3-fixes.patch`** | **the worker schema, the entitlements, the payments-trust** | **not implemented.** No worker, no schema, no entitlement endpoint | **`EXCLUDED_BY_SCOPE`** — it requires a new server contract |
| 14 | **`ofeliya-review4-fixes.patch`** | **the Stars proxy, the worker v4, the deploy runbook** | **not implemented** | **`EXCLUDED_BY_SCOPE`** — the real Stars path |
| 15 | **`ofeliya-review5-fixes.patch`** | **the worker grants, the server wallet sync, the migration 15** | **not implemented** | **`EXCLUDED_BY_SCOPE`** — an authoritative wallet is forbidden in this phase |
| 16 | **`ofeliya-review6-fixes.patch`** | **the worker v16, the D1 ledger, the reconcile scripts, the patch16 regression battery** | **not implemented.** No D1 ledger, no reconcile scripts, no worker | **`EXCLUDED_BY_SCOPE`** — the D1 ledger and the refunds are forbidden in this phase |

**Totals over the 16 sources:** 7 implemented · 3 partial · 6 excluded.
Nothing is `MISSING`, `UNKNOWN_REQUIRES_TEST`, `UNSAFE` or `DUPLICATE`.

> **The Muse patch files themselves are absent from GitHub.** `git rev-list --all --objects | grep
> '\.patch$'` → **0** across all 232 refs. The matrix above is the authoritative second-hand record; the
> patch contents cannot be inspected. **This is a hard limitation of the audit**, and it is why every
> Muse-derived line in the plan is treated as a *decision to not reuse*, never as code to port.

---

## A.4 The sibling-repo payment prior art — `timoshinoleg-eng/coder_survival`

This is the only money code in the org whose behaviour is verifiable from source. It is a different
game (a Telegram Mini App with a Node/PostgreSQL backend), so **nothing is ported verbatim** — but the
*shapes* are directly transferable.

### A.4.1 The schema (`backend/migrations/001_init.sql`)

```sql
-- Покупки (Stars — пока mock)
CREATE TABLE IF NOT EXISTS purchases (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_type       VARCHAR(32) NOT NULL,   -- 'energy_refill', 'depression_cure', 'tier_boost', 'streak_protect'
    stars_amount    INTEGER NOT NULL,        -- сколько Stars списано
    status          VARCHAR(16) NOT NULL DEFAULT 'pending',  -- 'pending', 'completed', 'failed'
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_purchases_user_id ON purchases(user_id);

-- Идемпотентные Telegram Stars платежи
CREATE TABLE IF NOT EXISTS star_payments (
    id                          SERIAL PRIMARY KEY,
    user_id                     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purchase_id                 INTEGER REFERENCES purchases(id) ON DELETE SET NULL,
    telegram_payment_charge_id  TEXT NOT NULL UNIQUE,
    provider_payment_charge_id  TEXT,
    invoice_payload             TEXT NOT NULL,
    item_type                   VARCHAR(32) NOT NULL,
    stars_amount                INTEGER NOT NULL,
    currency                    VARCHAR(8) NOT NULL DEFAULT 'XTR',
    status                      VARCHAR(16) NOT NULL DEFAULT 'completed',
    raw_payload                 JSONB,
    created_at                  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_star_payments_user_id ON star_payments(user_id);
```

**What to take:** the `telegram_payment_charge_id TEXT NOT NULL UNIQUE` constraint, the
`provider_payment_charge_id` nullable twin, `invoice_payload`, the `currency DEFAULT 'XTR'` check, and
`raw_payload JSONB` for the disputes.

**What to change:** fold `purchases` and `star_payments` into one `operations` table with a `kind`
discriminator; add `op_id` + `op_fingerprint`; replace `item_type` with a catalog FK; replace
`stars_amount` with a signed `amount_stars`; add `parent_operation_id` for the refunds.

### A.4.2 The one-time-SKU guard (`backend/migrations/060_*.sql`)

```sql
-- Migration 060: enforce one-time starter pack per account.
-- A refunded purchase frees the slot again (deliberate: refund = can rebuy).
-- Guards the concurrent double-intent race the pre-check in buy.js cannot close.
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchases_starter_pack_once
  ON purchases (user_id)
  WHERE item_type = 'starter_pack' AND status IN ('pending', 'completed');
```

**This is the single best idea to port.** A pre-check inside the application is a *best effort* against
a race; a partial unique index is a *guarantee*. The comment even names the exact failure it closes.

### A.4.3 The purchase intent (`backend/src/routes/buy.js`)

The ordering is the lesson:

```
purchaseRateLimiter → requireTelegramUser → requirePaymentsEnabled → validate(buySchema)
  → BEGIN
  → SELECT the user
  → the one-time pre-check (409 ONE_TIME_ALREADY_OWNED)
  → INSERT purchases (status='pending')
  → INSERT audit_logs (action='purchase_intent')
  → COMMIT
  → 202 { purchase: {...}, payment: { required: true, currency: 'XTR',
                                      payload: `purchase:${purchase.id}:${item_type}` } }
```

The docstring captures the intent precisely:

> *"Реальная выдача предмета должна идти только после Telegram successful_payment."*
> (*"The actual granting of the item must happen only after Telegram's successful_payment."*)

And the auth ordering:

> *"Auth is checked first so an anonymous caller still gets 401 and cannot use the payment-state response
> as an oracle. requirePaymentsEnabled then runs before validate() and before any DB work: while payments
> are disabled no purchase intent row is created, so there is nothing an invoice could later be attached
> to."*

### A.4.4 The fulfillment (`backend/src/routes/internalPayments.js` → `POST /telegram/confirm`)

```
BEGIN
→ SELECT pg_advisory_xact_lock($1::bigint)     -- the user id: the key idea
→ SELECT the star_payments/purchases row FOR UPDATE
→ the prior-paid check (the first-purchase bonus)
→ applyItemEffect(client, userId, itemType)
→ UPDATE purchases SET status='completed'
→ INSERT star_payments (... telegram_payment_charge_id ... raw_payload)
COMMIT
```

`pg_advisory_xact_lock` is a **database-wide** lock keyed on the user id, released automatically at the
end of the transaction. It is exactly what OFELIYA's in-memory `withProfileLock` cannot provide across
replicas.

### A.4.5 The refund (`POST /telegram/refund`)

```
BEGIN
→ SELECT sp.id, sp.user_id, sp.purchase_id, sp.item_type, sp.stars_amount, sp.status
    FROM star_payments ... FOR UPDATE OF sp
→ the Bot API refundStarPayments() call
→ UPDATE star_payments SET status='refunded'
→ UPDATE purchases SET status='refunded' WHERE id=$1 AND status='completed'
→ INSERT audit_logs
COMMIT
```

**Two problems with this shape, both called out in the main plan:**
1. The external Telegram call sits **inside** the DB transaction → a slow or hanging Telegram call holds
   the row lock.
2. The revocation happens **after** a successful refund → a crash in between leaves a refunded user with
   a live entitlement.

The main plan's §13.1 replaces the ordering with **revoke-first, then the external call, outside the
transaction**.

### A.4.6 The fail-closed gate (`bot/src/payments.js`)

```js
export const PAYMENTS_DISABLED_CODE = 'PAYMENTS_DISABLED';

export function parsePaymentsEnabled(rawValue) {
  return rawValue === 'true';          // strict: no trimming, no case folding
}

export function decidePreCheckout(query, env = process.env) {
  if (!arePaymentsEnabled(env)) return { ok: false, errorMessage: PRE_CHECKOUT_REjection, reason: PAYMENTS_DISABLED_CODE };
  if (query?.currency !== 'XTR')      return { ok: false, errorMessage: 'Поддерживаются только Telegram Stars.',
                                                     reason: 'UNSUPPORTED_CURRENCY' };
  return { ok: true };
}

export function redactedDisabledPaymentNotice() {
  return '[payments] successful_payment received while PAYMENTS_ENABLED is not "true". ' +
         'Fulfilling the already-charged payment to avoid charge-without-delivery. ' +
         'Identifiers intentionally omitted.';
}
```

**Three disciplines worth copying verbatim:**
1. **Strict opt-in parsing.** `"TRUE"`, `"True"` and `"  true  "` are all *disabled* — a near-miss fails
   safe rather than being guessed into an opt-in.
2. **A pure decision function** separated from the transport, so the rule is directly unit-testable.
3. **A redacted notice** that carries the *fact* of the event and **no raw identifiers** — no user id, no
   charge id, no invoice payload.

### A.4.7 The bot wiring (`bot/src/createBot.js:209–231`)

```js
bot.on('pre_checkout_query', async (ctx) => {
  const decision = decidePreCheckout(ctx.preCheckoutQuery);
  if (!decision.ok) await ctx.answerPreCheckoutQuery(false, { error_message: decision.errorMessage });
  else await ctx.answerPreCheckoutQuery(true);
});

bot.on('message:successful_payment', async (ctx) => {
  const payment = ctx.message.successful_payment;
  ...
});
```

OFELIYA has no `grammy`; the equivalent wiring goes through `server/telegram-api.mjs`.

### A.4.8 The charge-without-delivery guard

`internalPayments.js` → `alertPaymentWhileDisabled({ itemType, idempotent })`.

This handles the case where a `successful_payment` arrives while the runtime is *deliberately* disabled
(the kill switch is on). The correct behaviour is to **fulfil the already-charged payment**, not to drop
it — the user already paid. The `idempotent` flag marks the notification as repeatable.

**This is the guard that main plan §6 row 10 and §13.1 depend on.**

### A.4.9 The test shapes

| File | What it covers |
|---|---|
| `backend/tests/payments.test.mjs` | the payment decision logic |
| `backend/tests/payments.confirmFulfillment.test.js` | the idempotent fulfillment |
| `backend/tests/payments.killSwitch.test.js` | the fail-closed switch |
| `backend/tests/payments.firstPurchaseBonus.test.js` | the product-specific bonus |

---

## A.5 Code archaeology — the verdict on the old payment branch

### A.5.1 Why the existing durable state cannot hold money

| Property | `ofeliya_private.state` | A money ledger needs |
|---|---|---|
| Write granularity | the **whole document** is rewritten per flush | per-operation rows |
| Concurrency | one writer; a revision conflict = a full retry | many concurrent writers, per-row isolation |
| Uniqueness | none expressible | `UNIQUE(telegram_payment_charge_id)` |
| Idempotency | document-level (`last_commit` + payload equality) | per-charge |
| Blast radius of a bug | every score and profile | one operation |

**Verdict:** the *discipline* of `ofeliya_private` is excellent and must be copied. The *storage model*
must not be.

### A.5.2 The verdict table

| Question | Answer |
|---|---|
| Is there an old payment branch to cherry-pick from? | **No.** Nothing to cherry-pick. |
| Is there a *port-by-idea* source? | **Yes — two:** `ofeliya/main` (the idempotency + entitlement primitives) and `coder_survival/main` (the Stars money path). |
| Is any of it stale relative to the current `ofeliya/main`? | `coder_survival`'s payment path is **not** stale — it is actively maintained (the `payments.*` tests exist). Its *schema* (`star_payments`) is directly reusable. |
| Was the found semantic defect real? | **Yes, and it is preserved in GitHub as a decision.** The Muse `Storefront` decided ownership locally; `TelegramStarsPaymentProvider` trusted the client; `LabModifiers` applied permanent power from a client flag. The defect class — *one operation id reused across a different subject, and the client applying a foreign `branchId`/level locally* — is exactly what the fingerprint binding (§7.2) prevents. |
| Can the defect be re-derived from the Muse patches? | **No** — the patch files are absent from GitHub. The defect is known only through the convergence document's descriptions. |
| Is the "wallet cursor fix" reproducible? | **No.** There is no `cursor` concept and no `wallet` symbol anywhere in `ofeliya`. The closest is `compactRunGrantEntries` (a bounded, TTL'd capability set) — a different concept. |
| Is the "SQL ~11/11" reproducible? | **No.** `deploy/ofeliya-state.sql` is a single idempotent script applied once; there is no test suite for it. The `11/11` figure most plausibly describes a local migration set that was never pushed. |

### A.5.3 The defect, restated precisely

The brief describes: *"один `opId` мог использоваться повторно для другой ветки/предмета покупки, а клиент
мог применить чужой `branchId`/level локально."*

Decomposed:

| Element | The defect | The defense (main plan) |
|---|---|---|
| An `opId` reused for a **different subject** | the operation id is not bound to what it purchased | §7.2 — the fingerprint binds the id to the user + the type + the SKU + the amount + the entitlement target |
| The client applying a **foreign `branchId`/level** | the client decides which branch/level a purchase grants | §5, §11.4 — the client sends an *intent*; the server computes the next legal level and returns the authoritative snapshot |
| The client **trusting the response** | the response fields are applied locally | §17, §6 rows 6–8, contract C2 — the client discards a mismatched response and re-reads the server state |

The Muse prototypes exhibit all three. **The fix is architectural, not a patch: the client must never be
in the position to decide.**

---

## A.6 The org-wide picture

The user owns **58 repositories**. Two are relevant to a Telegram monetization backend:

| Repo | Relevance | Finding |
|---|---|---|
| `timoshinoleg-eng/ofeliya` | the subject | the monetization code: **none** |
| `timoshinoleg-eng/coder_survival` | **high** — a Telegram Mini App with a PostgreSQL backend | a **real** Stars payment + refund implementation (§A.4) |
| `timoshinoleg-eng/restobot` | low — a restaurant SaaS bot | **no** Stars/payment code; only menu items with a `price` and `quantity` |

`coder_survival`'s own planning documents confirm the direction and show what a *product* monetization
layer looks like when it is separated from the money layer:

- `PROJECT.md`: *"Монетизация: Telegram Stars (XTR) для покупок, без агрессивных пейволлов."*
- `RESEARCH_IMPLEMENTATION_PLAN.md`: *"Monetization — Stars payments table, AdsGram integration, basic shop."*
- `SESSION_HANDOFF.md`: *"PROG-04 Streak recovery — ✅ Complete — POST /api/streak/recover, 5 Stars base, escalating cost."*

**Note the layering discipline visible in `coder_survival`:** the *product* economy (the streak-recovery
cost, the boosters, the season pass) is expressed in plain Postgres columns, while the *money* path
(`star_payments`) is a separate, narrowly-scoped concern. That separation is exactly what the main plan
proposes for OFELIYA — but OFELIYA should go further and make the product layer **entitlement-only**,
with no balance at all (§1.3).

---

## A.7 The sibling-repo caveats

| Caveat | Why it matters |
|---|---|
| `purchases` is annotated *"Stars — пока mock"* | the *intent* path was never proven against real Telegram in that repo either; do not treat its behaviour as battle-tested |
| The effect model is `energy` / `xp` / `commits` / `depression` | a different game's economy; the `applyItemEffect` switch does not transfer |
| `first_purchase_bonus` | product-specific; not a transferable rule |
| The refund ordering | **Wrong for OFELIYA** — see A.4.5 |
| The `flash_sales` / `season_pass` / `leagues` migrations | they grant *internal* stars to players (a promo economy), which is exactly the "promotional currency" of the main plan's §5.2 — **deferred** for OFELIYA |
| The `Progression.stars` column (`migration 051`) | a **mutable counter on a player row** — the exact anti-pattern the main plan forbids for money (§8.4). It is fine for a promotional currency that is not money; it must never back a paid entitlement |
