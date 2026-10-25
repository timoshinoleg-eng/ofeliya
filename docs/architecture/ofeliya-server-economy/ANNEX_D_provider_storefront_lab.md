# ANNEX D — Telegram Stars Provider, Storefront, Lab, Refunds & Reconciliation

**Part of:** `docs/architecture/OFELIYA_SERVER_ECONOMY_PLAN_20261025.md` · Date: 2026-10-25
**Scope:** the verified Telegram Stars contract, the provider interface, the storefront rules and the
catalog, the permanent Lab progression design, the refund runbook and the reconciliation design.

---

## D.1 The Telegram Stars contract — the full field reference

All field names below were quoted verbatim from the official `core.telegram.org` pages listed at the
end of this section.

### D.1.1 `sendInvoice`

| Parameter | Type | Required | Notes (verbatim from the docs) |
|---|---|---|---|
| `chat_id` | Integer or String | Yes | "Unique identifier for the target chat or username of the target bot, supergroup or channel in the format `@username`" |
| `message_thread_id` | Integer | Optional | "Unique identifier for the target message thread (topic) of a forum" |
| `direct_messages_topic_id` | Integer | Optional | "Identifier of the direct messages topic to which the message is sent" |
| `title` | String | Yes | "Product name, 1-32 characters" |
| `description` | String | Yes | "Product description, 1-255 characters" |
| `payload` | String | Yes | "Bot-defined invoice payload, 1-128 bytes. This will not be displayed to the user, use it for your internal processes." |
| `provider_token` | String | Optional | "Pass an empty string for payments in Telegram Stars" |
| `currency` | String | Yes | "Pass `XTR` for payments in Telegram Stars" |
| `prices` | Array of LabeledPrice | Yes | "Must contain exactly one item for payments in Telegram Stars" |
| `max_tip_amount` | Integer | Optional | "Not supported for payments in Telegram Stars" |
| `suggested_tip_amounts` | Array of Integer | Optional | "At most 4 suggested tip amounts" |
| `start_parameter` | String | Optional | "Unique deep-linking parameter… If left empty, forwarded copies of the sent message will have a Pay button, allowing multiple users to pay directly from the forwarded message, using the same invoice" |
| `provider_data` | String | Optional | "JSON-serialized data about the invoice, which will be shared with the payment provider" |
| `photo_url` | String | Optional | "URL of the product photo for the invoice" |
| `photo_size` / `photo_width` / `photo_height` | Integer | Optional | the photo geometry |
| `need_name` | Boolean | Optional | "Ignored for payments in Telegram Stars" |
| `need_phone_number` | Boolean | Optional | "Ignored for payments in Telegram Stars" |
| `need_email` | Boolean | Optional | "Ignored for payments in Telegram Stars" |
| `need_shipping_address` | Boolean | Optional | "Ignored for payments in Telegram Stars" |
| `send_phone_number_to_provider` | Boolean | Optional | "Ignored for payments in Telegram Stars" |
| `send_email_to_provider` | Boolean | Optional | "Ignored for payments in Telegram Stars" |
| `is_flexible` | Boolean | Optional | "Ignored for payments in Telegram Stars" |
| `disable_notification` | Boolean | Optional | "Sends the message silently" |
| `protect_content` | Boolean | Optional | "Protects the contents of the sent message from forwarding and saving" |
| `allow_paid_broadcast` | Boolean | Optional | "Pass True to allow up to 1000 messages per second… The relevant Stars will be withdrawn from the bot's balance" |
| `message_effect_id` | String | Optional | "Unique identifier of the message effect to be added" |
| `suggested_post_parameters` | SuggestedPostParameters | Optional | for direct-messages chats only |
| `reply_parameters` | ReplyParameters | Optional | |
| `reply_markup` | InlineKeyboardMarkup | Optional | "If empty, one `Pay total price` button will be shown. If not empty, the first button must be a Pay button." |

### D.1.2 `createInvoiceLink`

The same parameters as `sendInvoice`, minus the chat/topic/message parameters, plus:

| Parameter | Notes |
|---|---|
| `business_connection_id` | "For payments in Telegram Stars only." |
| `subscription_period` | "The number of seconds the subscription will be active for before the next payment. The currency must be set to `XTR` (Telegram Stars) if the parameter is used. Currently, it must always be `2592000` (30 days) if specified. Any number of subscriptions can be active for a given bot at the same time, including multiple concurrent subscriptions from the same user. Subscription price must no exceed 10000 Telegram Stars." |

**Design implication:** `createInvoiceLink` works inside a Mini App (it returns a URL), while `sendInvoice`
requires the bot to message the user. For a Mini App storefront, `createInvoiceLink` is usually the right
primitive — but it must be created **server-side** with the server-minted payload, never by the client.

### D.1.3 `SuccessfulPayment`

| Field | Type | Notes |
|---|---|---|
| `currency` | String | "Three-letter ISO 4217 currency code, or `XTR` for payments in Telegram Stars" |
| `total_amount` | Integer | "Total price in the *smallest units* of the currency (integer, **not** float/double)" |
| `invoice_payload` | String | "Bot-specified invoice payload" |
| `subscription_expiration_date` | Integer | Optional — "Expiration date of the subscription, in Unix time; for recurring payments only" |
| `is_recurring` | True | Optional — "True, if the payment is a recurring payment for a subscription" |
| `is_first_recurring` | True | Optional — "True, if the payment is the first payment for a subscription" |
| `shipping_option_id` | String | Optional |
| `order_info` | OrderInfo | Optional |
| `telegram_payment_charge_id` | String | **"Telegram payment identifier"** ← the external anchor |
| `provider_payment_charge_id` | String | "Provider payment identifier" |

The object's header note is important:

> *"if the buyer initiates a chargeback with the relevant payment provider following this transaction, the
> funds may be debited from your balance. This is outside of Telegram's control."*

### D.1.4 `PreCheckoutQuery`

| Field | Type |
|---|---|
| `id` | String — "Unique query identifier" |
| `from` | User — "User who sent the query" |
| `currency` | String |
| `total_amount` | Integer |
| `invoice_payload` | String |
| `shipping_option_id` | String (optional) |
| `order_info` | OrderInfo (optional) |

### D.1.5 `refundStarPayment`

| Parameter | Type | Required |
|---|---|---|
| `user_id` | Integer | Yes — "Identifier of the user whose payment will be refunded" |
| `telegram_payment_charge_id` | String | Yes — "Telegram payment identifier" |

Returns **True** on success.

### D.1.6 The documentation statements that drive the design

| Statement | The design consequence |
|---|---|
| *"Your bot must reply using answerPreCheckoutQuery within 10 seconds after receiving this update or the transaction is canceled."* | The `pre_checkout_query` handler must be fast and must **never** block on the ledger (main plan §12.1) |
| *"You must always check that you received a successful_payment update before delivering the goods or services purchased by the user – simply answering a pre_checkout_query does not guarantee a successful order or payment."* | **The central rule.** The grant happens on `successful_payment`, never on `pre_checkout_query` |
| *"It is critical to make sure your bot only accepts multiple payments when the order can be processed correctly. This is especially important if you are using multi-chat, inline or single-chat, multi-use invoices."* | The intent is created **per payer**, never per invoice. A forwarded invoice must not grant the forwarder the payer's entitlement |
| *"Store the SuccessfulPayment's telegram_payment_charge_id – it may be needed to issue a refund in the future"* | The charge id is stored UNIQUE (main plan §8.3) |
| *"If a single-chat invoice is sent in the chat with @merchantbot, it can only be paid once."* | A single-chat invoice is the safe default for a one-shot purchase |
| *"You can freely test payments in Telegram Stars by connecting your bot to Telegram's dedicated test environment."* | The test environment is the real integration gate (main plan §18.5) |
| *"Use backups to make sure that you don't lose data about your users' payments."* | The ledger must be backed up and restore-drilled before real money |
| *"You as the bot owner have full responsibility in case any conflicts or disputes arise. You must be prepared to correctly process disputes and chargebacks."* | The dispute runbook is a Go/No-Go item (main plan §23.3) |
| *"make sure that your bot can respond to a /terms command… Your Terms and Conditions should be written in a clear way and easy to understand by your users. The users must confirm that they have read and agree to your terms before they make the purchase."* | `/terms` and `/support` are Go/No-Go items |

**Sources fetched:** <https://core.telegram.org/bots/payments-stars> ·
<https://core.telegram.org/bots/payments-stars.md> ·
<https://core.telegram.org/bots/api/methods/sendinvoice.md> ·
<https://core.telegram.org/bots/api/methods/createinvoicelink.md> ·
<https://core.telegram.org/bots/api/methods/refundstarpayment.md> ·
<https://core.telegram.org/bots/api/types/successfulpayment.md> ·
<https://core.telegram.org/bots/api/types/precheckoutquery.md>

---

## D.2 The provider interface

The provider must be an interface with **two implementations** — a fake and the real one — so that the
whole system can be exercised without real money.

```
interface PaymentProvider {
  createInvoice(ctx, {opId, sku, amountStars, invoicePayload, title, description}) -> InvoiceSpec
  handlePreCheckout(query) -> { ok, errorMessage?, reason? }        // a PURE decision
  handleSuccessfulPayment(payment) -> { opId, status, entitlement }  // the grant path
  refund({ userId, telegramPaymentChargeId }) -> { ok: boolean }
}
```

| Implementation | Purpose |
|---|---|
| `FakeStarsProvider` | Scriptable: a delayed charge, a duplicate charge, a wrong amount, a provider error, a timeout. Drives the whole E2E suite (main plan §18.4) |
| `TelegramStarsProvider` | The real one, calling the Bot API through `server/telegram-api.mjs` (OFELIYA has no `grammy`) |

**The selection must be by an environment flag, with the fake as the default.** The real provider is
enabled only in a deliberate test-environment deployment. A production flag flip must be audited.

### D.2.1 The fail-closed gate (ported verbatim from `coder_survival`)

```
parsePaymentsEnabled(raw):  raw === 'true'      // strict; "TRUE"/"True"/"  true  " are all DISABLED
decidePreCheckout(query):
    if !paymentsEnabled:  reject, reason = PAYMENTS_DISABLED_CODE
    if query.currency != 'XTR': reject, reason = UNSUPPORTED_CURRENCY
    else: accept
```

**Why the strict parse matters:** a near-miss must fail *safe*, not be guessed into an opt-in. `"TRUE"`
is not `"true"`, and treating it as an opt-in would be a fail-open bug in the one place where fail-open is
unacceptable.

### D.2.2 The `pre_checkout_query` handler — the 10-second budget

```
onPreCheckout(query):
  t0 = now()
  answer = decidePreCheckout(query)        // pure, no I/O
  if !answer.ok: return answerPreCheckoutQuery(false, {error_message})

  // a BOUNDED read; never the advisory lock, never a write
  op = await rpc.readIntent(query.invoice_payload, timeout = 3s)
  if op is missing:  return answerPreCheckoutQuery(false, {error_message: 'the offer is no longer valid'})
  if op.amount != serverPrice(op.sku): return answerPreCheckoutQuery(false, {error_message: 'the price changed'})
  if !op.userKey == query.from:          return answerPreCheckoutQuery(false, {error_message: '...'})

  return answerPreCheckoutQuery(true)
```

**Budget:** the pure decision is <1 ms; the bounded read is ≤3s; the total must stay under ~5s to leave
a margin against the 10s deadline on a cold start. If the host is a sleeping Render instance, the cold
start alone can exceed the budget — **this is why the payment path needs a non-sleeping host.**

---

## D.3 The storefront

The Storefront is a **presentation layer over an authoritative catalog**. It is built last so it cannot
be mistaken for the money system.

### D.3.1 The SKU model

```sql
ofeliya_pay.catalog_sku (
  sku, kind, title, description,
  price_stars, currency,
  entitlement_kind, entitlement_key, entitlement_level, max_level,
  one_time_per_user, max_level_per_user,
  prerequisite_sku, superseded_by,
  version, enabled, created_at, updated_at
)
```
The full DDL: **ANNEX C §C.3.2**.

### D.3.2 The price rules

| Rule | Statement |
|---|---|
| The server price | `catalog_sku.price_stars` — the **only** price ever charged |
| The client price | **Informational.** Rendered from `/api/storefront/catalog`. It may be stale by seconds |
| A price mismatch at settlement | The server compares `SuccessfulPayment.total_amount` to its own recomputed amount. A mismatch → **no grant**, `PRICE_MISMATCH`, an alert |
| A price change | Bump `catalog_sku.version`. A new version does **not** alter the existing operations — each operation stores the amount it was priced at, and the fingerprint pins `catalogVersion` |
| Tips | `max_tip_amount` / `suggested_tip_amounts` are **not supported for XTR** — do not attempt them |

### D.3.3 Availability

| State | The server behaviour | The client rendering |
|---|---|---|
| `enabled = true`, the prerequisites met | purchasable | the buy button is live |
| `enabled = false` | `404` on purchase | the row is **still visible** with `available: false` → "скоро" — never a broken row |
| A one-time SKU already owned | `409 ONE_TIME_ALREADY_OWNED` | "Уже приобретено" + the owned item |
| The max level reached | `422 ENTITLEMENT_MAXED` | "Максимальный уровень достигнут" |
| A prerequisite missing | `422 PREREQUISITE_MISSING` (with the id) | the prerequisite is shown |
| The offer expired | `410 OFFER_EXPIRED` | "Предложение истекло" + a refresh |

### D.3.4 SKU migration (old → new)

Never mutate a SKU's meaning in place:

1. Create a **new SKU row** (a bumped `version`, or a new id).
2. Leave the old row `enabled = false`.
3. Link them with `catalog_sku.superseded_by`.
4. **Entitlements are keyed by `entitlement_key` + `level`, not by SKU.** A SKU rename or reprice does not
   invalidate an existing grant.

> This is the single most important schema decision: **entitlement identity ≠ purchase identity.** It is
> what makes refunds, re-pricing and SKU migration safe.

### D.3.5 Localization

- The catalog carries the server-provided `title`/`description` for the active locale, or keys the client
  resolves locally.
- **Prices are locale-independent** — Stars have no locale formatting. Display as `⭐ N`.
- The client may localize the *description*; it may not localize the *price* or the *effect*.

### D.3.6 Restore purchases

`POST /api/storefront/restore` is a **read**. It must not create, extend or mutate any entitlement. It
must be safe to call repeatedly and from any device. It is the answer to the reinstall scenario.

### D.3.7 The pending purchase UI

| The server state | The client rendering |
|---|---|
| `PENDING` | "Ожидание оплаты…" — a spinner and a cancel affordance that cancels only the *intent* |
| `ENTITLED` | success, with the newly unlocked item highlighted |
| `REFUND_PENDING` | "Возврат в обработке" — **not** an error. The entitlement shows as *pending revocation*, not as active |
| `REFUNDED` | "Возврат оформлен" — the entitlement shows as revoked |
| `FAILED` / `REJECTED` | a clear error with a human-readable reason |
| *(unknown / unreachable)* | **Fail closed**: "не удалось подтвердить оплату" — **never** "оплачено" |

### D.3.8 The error states

| Code | The client behaviour |
|---|---|
| `409 IDEMPOTENCY_KEY_REUSE` | "Этот запрос уже использован с другими параметрами." — **do not auto-retry** |
| `409 ONE_TIME_ALREADY_OWNED` | "Уже приобретено." — re-read the state and show the owned item |
| `404 SKU_UNAVAILABLE` | hide/disable the buy button |
| `422 ENTITLEMENT_MAXED` | "Максимальный уровень достигнут." |
| `422 PREREQUISITE_MISSING` | show the prerequisite |
| `410 OFFER_EXPIRED` | "Предложение истекло." — offer a refresh |
| `503 LEDGER_UNAVAILABLE` | "Платёж временно недоступен. Попробуйте позже." — **and issue no invoice** |

### D.3.9 The reusable client shell

The Storefront reuses what already exists in the Muse branch:

| Asset | Reused for |
|---|---|
| `src/ui/CollectionBoard.ts` — the paginated gallery, the compact safe-area frame, the "owned vs locked" model | the Storefront layout and the owned/locked rendering |
| `src/game/collection/ClientCollection.ts` — the ownership model | **not** as an authority — the client collection stays a *cosmetic achievement* store; the paid cosmetics come from the server |
| `src/systems/ClientFeatureFlags.ts` — the presentation-only flag shape | **not** extended with any economy flag |

**The `test:muse-client` and `test:muse-convergence` contracts must keep passing after the server lands.**
They are the regression gate against a client-side economy reappearing.

---

## D.4 The permanent Lab progression

The highest-risk game layer. The existing Lab is **informational only** and that boundary is enforced by
`scripts/check-muse-collection.mjs`.

### D.4.1 Three tiers

| Tier | Definition | Authority | v1 |
|---|---|---|---|
| **Safe informational Lab** | what exists today: 3 branches, no effect, no write | client presentation | ✅ shipped |
| **Earned progression** | earned in-game, not paid | client/server (existing) | ✅ shipped |
| **Paid permanent progression** | permanent stat/power bought with Stars | **server** | ⚠️ v1.1 — see D.4.2 |

### D.4.2 The ordering risk

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

**If combat power must ship:** the grant must be **re-read at run start** and `paid_power_used_at` recorded
on the score, so the ranked play can be partitioned.

### D.4.3 The per-parameter specification

| Question | The rule |
|---|---|
| The server representation | `entitlements(user_key, entitlement_key='lab.<param>')` → `level integer`, `source_operation_id`, `granted_at`, `revoked_at` |
| The validation | the server computes the legal next level from the current level. **The client never sends `newLevel`.** |
| The max level | `catalog_sku.max_level` (and `max_level_per_user` for repeatable purchases) |
| The pricing | `catalog_sku.price_stars` per level. A *level-up* SKU prices the **next** level, not an arbitrary one |
| The prerequisite graph | `catalog_sku.prerequisite_sku`; the server checks the whole chain |
| The refund behaviour | a soft-revoke of the entitlement row; **the ledger row is never deleted**; an already-consumed effect is not clawed back (a documented, accepted asymmetry) |
| The downgrade behaviour | on a refund, the entitlement reverts to the highest level that is still paid-for. Refunding level 3 while levels 1–2 remain paid → level 2 |
| The save compatibility | the client save stores **nothing** that grants power. It may cache the last known level, refreshed from the server at every run start |
| The gameplay application point | the server-granted level is fetched at run start and passed into the run as read-only state; the run must not be able to mutate it |
| The fingerprint's entitlement target | `lab.<param>.level.<N>` — so the same `opId` cannot be reused for a different level |

### D.4.4 The client protocol — intent, not state

```
❌ FORBIDDEN                                  ✅ REQUIRED
POST {branch:'magnet', newLevel:7}            POST {opId:'...', sku:'lab.magnet.level.up'}
                                               → the server: lock the user → read the current level
                                               → validate the max/prereq/price
                                               → the fingerprint binds to lab.magnet.level.7
                                               → charge → grant the level
```

The server computes "the next legal level" and prices *that*. The client cannot ask for level 7 — it can
only ask to **advance**, and the server decides by how much.

**This is precisely the defect class described in the brief** — "the client could apply a foreign
`branchId`/level locally". The fix is architectural: the client must never be in the position to decide.

### D.4.5 What is not paid permanent power

- Anything that alters a **ranked** score's comparability without partitioning.
- Anything that can be **bought twice** and stacked without a cap.
- Anything enforced **client-side only** — the entire Muse `LabModifiers` failure mode.

---

## D.5 The refund design in full

### D.5.1 The state machine

```
        ┌──────────────┐
        │ PENDING      │  the intent exists; the invoice was presented; not yet charged
        └──────┬───────┘
               │ successful_payment received & verified
        ┌──────▼───────┐
        │ ENTITLED     │  charged AND granted, in one transaction
        └──────┬───────┘
               │ a refund is requested
        ┌──────▼────────────┐
        │ REFUND_PENDING    │  the entitlement is ALREADY soft-revoked; the Bot API call is in flight
        └──────┬────────────┘
               │ refundStarPayment() returned true
        ┌──────▼───────┐
        │ REFUNDED     │  the charge was returned; the entitlement is revoked
        └──────────────┘

  The failure side: PENDING → FAILED (the checkout was rejected / the TTL expired)
                   ENTITLED → REJECTED (an amount or currency mismatch)
                   REFUND_PENDING → REFUND_FAILED (the Telegram call failed; the entitlement stays revoked)
```

### D.5.2 The ordering — the most important detail in this annex

```
BEGIN;
  SELECT * FROM operations WHERE id=$purchase FOR UPDATE;
  if status <> 'ENTITLED': ROLLBACK; return 409;
  UPDATE entitlements SET revoked_at=now() WHERE ...;       -- ① revoke FIRST
  UPDATE operations SET status='REFUND_PENDING' WHERE ...;   -- ② mark in-flight
COMMIT;

  result = telegram.refundStarPayment(user_id, telegram_payment_charge_id)   -- ③ outside the tx
  if result === true:
      UPDATE operations SET status='REFUNDED' WHERE id=$purchase;           -- ④
  else:
      -- ⑤ the charge was NOT returned, but the entitlement is already revoked.
      --    This is the SAFE direction (we under-deliver rather than over-deliver).
      --    Mark REFUND_FAILED and alert; do NOT silently restore the entitlement.
```

**Why revoke-first:** if the process dies between ① and ④, the user has *less* than they paid for —
annoying but safe and fixable. If we revoked *after* a successful refund, a crash in between leaves a
refunded user with a live entitlement — money taken, value delivered, and no audit trail.
**Fail toward under-delivery.**

> The `coder_survival` implementation does the opposite (the Bot API call first, inside the transaction).
> **Do not port that ordering.** Port the shape, not the sequence.

### D.5.3 The permissible intermediate states

| State | Meaning | The user sees | Safe? |
|---|---|---|---|
| `PENDING` | the intent exists; no charge | "Ожидание оплаты" | ✅ |
| `ENTITLED` | charged and granted | ✅ | ✅ |
| `REFUND_PENDING` | revoked; the Telegram call is in flight | "Возврат в обработке" | ✅ (the user sees it revoked) |
| `REFUNDED` | the charge was returned | "Возврат оформлен" | ✅ |
| `REFUND_FAILED` | the Telegram call failed; the entitlement stays revoked | "Возврат требует обработки" + an alert | ✅ (under-delivery, recoverable) |
| `REJECTED` | an amount/currency mismatch | "Оплата не распознана" + an alert | ✅ |
| `FAILED` | the intent expired / the checkout was rejected | "Оплата не завершена" | ✅ |

**Simplification:** because the operation insert and the entitlement upsert happen in one transaction, an
observer can never see a charged-but-not-granted state. **`PAID` is collapsed into `ENTITLED`** and only
the states above are exposed. This is the "don't complicate the state machine without necessity" rule.

### D.5.4 The refund-vs-spend race

In v1 there is no spend, so the race is impossible. In v2:

> A spend is refused if the entitlement it draws on has `revoked_at IS NOT NULL`.
> The spend's transaction takes `pg_advisory_xact_lock(userKey)`, the same lock the refund takes.

The lock is the whole defense. A spend that starts before the refund commits completes and is **not**
clawed back; a spend that starts after is refused.

### D.5.5 The operator runbook

```
1. The support ticket arrives: "I paid and got nothing."
2. Look up the user_key from the verified initData (never from the ticket).
3. Query the operations by (user_key, created_at desc) and by telegram_payment_charge_id.
4. If the operation is PENDING and the charge id is absent:
     → the payment never completed, or the webhook was lost.
       Check the Telegram-side transaction listing (the manual step — D.6.3).
       If a charge exists → run the charge-without-delivery fulfilment (Annex B.4).
       If no charge exists → tell the user nothing was charged.
5. If the operation is ENTITLED and the entitlement is missing:
     → a grant bug. Run the reconcile scan; repair manually with a reason.
6. If the operation is REFUND_PENDING:
     → the Telegram call is in flight or it failed. Re-issue the refundStarPayment
       (it is idempotent from the user's perspective: the money is either returned or not).
       Never restore the entitlement without a successful refund confirmation.
```

---

## D.6 The reconciliation design in full

### D.6.1 What it must detect

| Finding | The query (sketch) | Severity |
|---|---|---|
| A **local operation without an entitlement** | `operations.status='ENTITLED'` AND no matching `entitlements` row | 🔴 high |
| An **entitlement without a payment** | `entitlements` rows with no non-revoked granting `operations` row | 🔴 high |
| A **refund without a revoke** | `operations.status='REFUNDED'` AND the entitlement has `revoked_at IS NULL` | 🔴 high |
| A **revoke without a refund** | `entitlements.revoked_at IS NOT NULL` AND no `REFUNDED`/`REFUND_PENDING` operation | 🟠 medium |
| A **duplicate external transaction** | prevented by `UNIQUE(telegram_payment_charge_id)`; the job re-checks for violations that predate the constraint | 🔴 high |
| An **orphan intent** | `operations.status='PENDING'` older than the intent TTL | 🟢 low |
| A **price mismatch** | `operations.amount_stars !=` the catalog price at the operation's `catalog_version` | 🟠 medium |
| A **level above the max** | `entitlements.level > catalog_sku.max_level` | 🔴 high |
| A **Telegram payment with no local operation** | ⚠️ **cannot be detected automatically** — D.6.3 | 🔴 high (manual) |

### D.6.2 The job shape

- **Periodic** (e.g. hourly) and **on-demand** (an admin endpoint).
- **Read-only** — it *finds*; it does not *fix*. The findings go to `ofeliya_pay.reconcile_findings` with
  a `finding_key` (idempotent across runs).
- The admin endpoint returns the findings; the repair is a separate, explicit, audited operation.
- It must be safe to run **during** a purchase: it reads committed rows only (MVCC), it never flags a
  `PENDING` operation, and it never takes the advisory lock for long.

### D.6.3 The hard truth about Telegram reconciliation

**Telegram provides no API to list a bot's payments.** There is no "list my transactions" method.
Therefore **"a Telegram payment with no local operation"** can only be found by:

- a **manual export** from the Telegram side (support / dispute resolution), or
- a **client-side report** ("I paid and got nothing") — not authoritative, but a useful trigger, or
- a **late `successful_payment` webhook** arriving after our intent TTL expired — this *is* detectable
  server-side, and is exactly the charge-without-delivery case.

**This is a real operational constraint, not an oversight.** It must be in the runbook and reflected in the
Go/No-Go criteria: the operator needs a way to receive Telegram-side transaction listings for dispute
handling. Telegram's own live checklist says *"Use backups to make sure that you don't lose data about
your users' payments."*

### D.6.4 The safe repair strategy

```
detect → record the finding → a human reviews → an explicit repair command → an audit log → re-run to confirm
```

1. **Never auto-repair.** A repair that grants an entitlement is a money action.
2. Every repair writes to `grants_log` with `reason`, `finding_id` and the operator identity.
3. The repairs are **idempotent** — running them twice changes nothing the second time.
4. A repair that would grant value **without** a matching charge requires a charge reference (from the
   Telegram-side export) — otherwise it is rejected with `manual-review-required`.
5. The reconcile job must be safe to run **during** a purchase.
