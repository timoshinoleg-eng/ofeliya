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
<https://core.telegram.org/bots/api/types/precheckoutquery.md> ·
<https://core.telegram.org/bots/api/methods/getstartransactions.md> ·
<https://core.telegram.org/bots/api/types/startransaction.md> ·
<https://core.telegram.org/bots/api/types/startransactions.md> ·
<https://core.telegram.org/bots/api/types/transactionpartneruser.md> ·
<https://core.telegram.org/bots/api-changelog>

### D.1.7 The transaction-history surface — `getStarTransactions` and friends

> Added by the factual correction. The first revision of this package asserted that *"Telegram provides no
> API to list a bot's payments"*. **That was wrong**, and the whole reconciliation architecture was
> rebuilt on the correct facts (main plan §9.2.1, §9.5).

#### D.1.7.1 `getStarTransactions`

| Parameter | Type | Required | The documented description |
|---|---|---|---|
| `offset` | Integer | Optional | *"Number of transactions to skip in the response"* |
| `limit` | Integer | Optional | *"The maximum number of transactions to be retrieved. Values between 1-100 are accepted. Defaults to 100."* |

> *"Returns the bot's Telegram Star transactions in chronological order. On success, returns a StarTransactions
> object."*

**Version:** added in **Bot API 7.5** (June 18, 2024) — *"Added the method getStarTransactions that can be used
to get the list of all Telegram Star transactions for the bot."*

**Three properties that shape the whole design:**

1. It is a **list**, not a lookup. There is **no** Bot API method that returns one transaction by id.
2. Its pagination is a **positional skip count**, not a server-issued cursor. There is **no** `date`/`since`
   filter. A durable checkpoint is therefore *our* construction (main plan §14.7), not a documented guarantee.
3. The documentation states **no retention limit**. Completeness is an assumption to be verified in the test
   environment (main plan §18.5, R-T7), not a fact to be relied on.

#### D.1.7.2 `StarTransaction`

| Field | Type | The documented description | The design consequence |
|---|---|---|---|
| `id` | String | *"Unique identifier of the transaction. **Coincides with the identifier of the original transaction for refund transactions.** Coincides with `SuccessfulPayment.telegram_payment_charge_id` for successful incoming payments from users."* | The id is the **money identity**, not a transaction identity. A charge and its refund **share one id** ⇒ the dedupe key must include the direction |
| `amount` | Integer | *"Integer amount of Telegram Stars transferred by the transaction"* | The amount comparison for the price check. Compare with a tolerance if `nanostar_amount` is non-zero |
| `nanostar_amount` | Integer | Optional · *"The number of 1/1000000000 shares of Telegram Stars transferred by the transaction; from 0 to 999999999"* (Bot API 8.1, Dec 4 2024) | **Fractional Stars are possible.** An exact integer comparison can fail on a fractional charge ⇒ compare `amount` ± `nanostar_amount` |
| `date` | Integer | *"Date the transaction was created in Unix time"* | The ordering key and the overlap window anchor |
| `source` | TransactionPartner | Optional · *"Source of an incoming transaction (e.g., a user purchasing goods or services, Fragment refunding a failed withdrawal). Only for incoming transactions."* | **Present ⇒ the direction is incoming.** The absent/`receiver`-present shape distinguishes a purchase from a refund |
| `receiver` | TransactionPartner | Optional · *"Receiver of an outgoing transaction (e.g., **a user for a purchase refund**, Fragment for a withdrawal). Only for outgoing transactions."* | **`receiver` ⇒ the direction is outgoing.** A refund to a user is the exact shape a reconciliation looks for |

**Header note (verbatim):** *"if the buyer initiates a chargeback with the payment provider from whom they
acquired Stars (e.g., Apple, Google) following this transaction, the refunded Stars will be deducted from the
bot's balance. This is outside of Telegram's control."* — ⇒ there is **no** chargeback event; only a balance
effect (main plan §14.2, R10).

#### D.1.7.3 `StarTransactions`

| Field | Type | Description |
|---|---|---|
| `transactions` | Array of `StarTransaction` | *"The list of transactions"* |

#### D.1.7.4 `TransactionPartnerUser` — where the **subject** comes from

| Field | Type | The documented description |
|---|---|---|
| `type` | String | *"Type of the transaction partner, always \"user\""* |
| `transaction_type` | String | *"Type of the transaction, currently one of \"invoice_payment\" for payments via invoices, \"paid_media_payment\" for payments for paid media, \"gift_purchase\" for gifts sent by the bot, \"premium_purchase\" for Telegram Premium subscriptions gifted by the bot, \"business_account_transfer\" for direct transfers from managed business accounts"* |
| `user` | User | *"Information about the user"* |
| `invoice_payload` | String | Optional · *"Bot-specified invoice payload. **Can be available only for \"invoice_payment\" transactions**"* (Bot API 8.0, Nov 17 2024) |
| `subscription_period` | Integer | Optional |
| `affiliate` | AffiliateInfo | Optional |

**This is the single most important row in this annex.** Two facts follow:

- The **payer** is recoverable from `source.user.id` — the server does **not** need the client to tell it who
  paid, and a client-supplied user id is never trusted.
- The **subject** (what was bought) is recoverable from `source.invoice_payload` — **but only because the
  bot chose to put a self-describing payload there**. A `paid_media_payment` carries `paid_media_payload`
  instead, and a `gift_purchase` carries no payload at all. ⇒ the payload design is not cosmetic; it is the
  difference between an auto-recoverable payment and a manual one (main plan §17).

#### D.1.7.5 `getMyStarBalance`

> *"A method to get the current Telegram Stars balance of the bot. Requires no parameters. On success, returns
> a StarAmount object."* — added in **Bot API 9.1** (July 3, 2025).

Its only architectural role: the bot's balance **minus** the sum of the ledger's expected net receipts is a
**balance-level** signal for chargebacks and for unrecorded withdrawals. It is a *derived* signal — it
localises a problem to a period, it does **not** identify a transaction (main plan §14.2, R10).

#### D.1.7.6 The MTProto counterparts — for reference only

| MTProto method | Who may call it | The documented note | The delta vs the Bot API |
|---|---|---|---|
| `payments.getStarsTransactions` (#69da4557) | *"Both users and bots can use this method"* | `peer` = *"Fetch the transaction history of the peer (inputPeerSelf or **a bot we own**)"*; `offset` = *"obtained from the returned next_offset, initially an empty string"*; flags `inbound` / `outbound` / `ascending` | An **opaque server-issued cursor** and **filters**. No date filter either |
| `payments.getStarsTransactionsByID` (#2dca16b8) | ***"Only users can use this method"*** | `id` = a vector of `InputStarsTransaction` (which carries a `refund` flag to disambiguate a refund from its original) | ⚠️ **Not available to a bot on either surface.** The by-id lookup that MTProto appears to offer is a *user* feature |
| `payments.refundStarsCharge` (#25ae8f4a) | *"Only bots can use this method"* | typed errors: `CHARGE_ALREADY_REFUNDED`, `CHARGE_ID_EMPTY`, `USER_ID_INVALID`, `USER_BOT_REQUIRED` | **Typed errors** where the Bot API has a bare boolean |
| `payments.getStarsStatus` (#4ea9b3bf) | — | *"The method will also return the last 5 star transactions."* | A summary, not a history |

**Verdict:** the Bot API covers every capability OFELIYA needs. MTProto adds a durable cursor, filters and
typed refund errors — at the cost of a new credential class (`api_id`/`api_hash`/a session) and the loss of
the by-id lookup for bots. It is an **optional operational/forensic upgrade**, never a critical-path
dependency (main plan §9.5, §22 Q11).

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

  // --- the read side (added by the factual correction) ---
  // The transaction history is NOT optional. Without it there is no reconciliation.
  listStarTransactions({ offset, limit }) -> { transactions: StarTransactionView[] }
  getStarBalance() -> { amountStars }                                 // Bot API 9.1
}

interface StarTransactionView {
  id: string            // == telegram_payment_charge_id for an incoming payment;
                        // == the ORIGINAL id for a refund
  amount: number
  nanostarAmount?: number
  date: number          // unix seconds
  direction: 'IN' | 'OUT'          // derived: 'IN' if source is present, else 'OUT'
  sourceType?: string              // 'user' | 'fragment' | 'telegram_api' | ...
  sourceTxType?: string            // 'invoice_payment' | 'paid_media_payment' | ...
  payerUserId?: number             // TransactionPartnerUser.user.id (IN)
  invoicePayload?: string          // TransactionPartnerUser.invoice_payload (IN, invoice_payment only)
  peerUserId?: number              // TransactionPartnerUser.user.id (OUT)
}
```

> **`direction` is derived, not supplied by Telegram.** The Bot API has no direction flag: it is implied by
> whether `source` (incoming) or `receiver` (outgoing) is present. The derivation lives in the adapter, so
> every consumer of the history gets a single consistent direction — and so the `tx_key` dedupe (main plan
> §14.6) has exactly one definition.

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

> The state machine, the entitlement policy, the durable sequence, the race/crash analysis and the
> idempotency contract are specified in the main plan **§13.1–§13.8**. This annex carries the
> **provider-level** detail that belongs here: what the Telegram call actually returns, how the
> `refundStarPayment` boolean maps onto the states, and what the provider interface must expose.

### D.5.1 The provider's refund call — and what it cannot tell us

```ts
// The provider's refund contract. The shape matters: it returns a THREE-valued result,
// not a boolean, because the caller must be able to distinguish "failed" from "unknown".
type RefundOutcome =
  | { kind: 'CONFIRMED_SUCCESS' }
  | { kind: 'CONFIRMED_FAILURE'; reason?: string }
  | { kind: 'UNKNOWN'; reason: 'timeout' | 'transport_error' | 'no_response' };

interface PaymentProvider {
  // ... the rest of the interface
  refund({ userId, telegramPaymentChargeId }): Promise<RefundOutcome>;
  listStarTransactions({ offset, limit }): Promise<{ transactions: StarTransactionView[] }>;
  getStarBalance(): Promise<{ amountStars: number }>;
}
```

**Why the provider returns three values, not one.** The Bot API's `refundStarPayment` returns a bare
`true`/`false`. A transport timeout and a `false` are **indistinguishable at the call site**, and the first
revision of this package mapped **both** to "the refund failed" while leaving the entitlement revoked. The
adapter's job is to separate them:

| The wire outcome | The adapter's classification | The rule |
|---|---|---|
| HTTP 200, `true` | `CONFIRMED_SUCCESS` | Telegram accepted the refund |
| HTTP 200, `false` | `CONFIRMED_FAILURE` | Telegram declined it |
| a timeout / a socket error / a 5xx / a malformed body | **`UNKNOWN`** | the outcome is undetermined — **not** a failure |
| HTTP 200 with a body that is not `true`/`false` | **`UNKNOWN`** | the contract was not honoured — treat it as undetermined, not as a failure |

> **A `false` is only a confirmed failure when the response was actually received and parsed.** Anything
> else is `UNKNOWN`. This is the single most important line in the provider adapter, and it is what stops a
> network blip from destroying a user's paid value.

**A note on the MTProto alternative.** The MTProto counterpart `payments.refundStarsCharge` returns typed
errors — `CHARGE_ALREADY_REFUNDED`, `CHARGE_ID_EMPTY`, `USER_ID_INVALID` — so it distinguishes *"already
refunded"* from *"refunded"*. The Bot API does not. The design therefore **does not probe** with a repeat
call: it **observes** the Telegram history instead (§13.6). MTProto remains an optional upgrade, never a
dependency (main plan §9.5.1).

### D.5.2 The state machine (the annex view)

The canonical machine is in the main plan **§13.2**. What the provider adds is the mapping from the wire to
the state:

| The provider outcome | The state transition | The entitlement |
|---|---|---|
| `CONFIRMED_SUCCESS` | `REFUND_PENDING` → **`REFUNDED`** | **permanently revoked** |
| `CONFIRMED_FAILURE` | `REFUND_PENDING` → **`REFUND_FAILED`** | **restored** to `ENTITLED` |
| `UNKNOWN` | `REFUND_PENDING` → **`REFUND_RECONCILE`** | **suspended** — not revoked, not restored |
| — | `REFUND_RECONCILE` → `REFUNDED` / `REFUND_FAILED` | decided by the **Telegram history**, not by a repeat call |

### D.5.3 The entitlement during the pending window

The policy, the comparison of the three options and the per-class recommendation are in the main plan
**§13.3**. The provider-level consequence:

| The entitlement class | During `REFUND_REQUESTED` / `REFUND_PENDING` / `REFUND_RECONCILE` | After `REFUNDED` | After `REFUND_FAILED` |
|---|---|---|---|
| a **paid cosmetic** | **usable** | revoked | usable |
| **paid gameplay power / Lab progression** | **suspended** (`suspended_at` is set; the client renders "возврат в обработке") | revoked (`revoked_at` is set) | usable again (`suspended_at` is cleared) |

### D.5.4 The durable sequence, in provider terms

The full transaction sequence is in the main plan **§13.4**. The provider-specific rules:

1. **Exactly one caller.** Only the refund worker may call `refundStarPayment`. Not the operator console,
   not a support script, not an admin endpoint, not a cron job.
2. **No transaction is held across the call.** The provider call is issued *after* the claim transaction has
   committed and *before* the outcome transaction begins (§13.4).
3. **A bounded timeout.** The call has a hard timeout (e.g. 15 s) — long enough for a slow Telegram
   response, short enough that the worker's lease is not the thing that expires.
4. **The lease is not the truth.** The lease (`lease_expires_at`) only decides *who retries*. **The
   Telegram history decides what happened.** A worker that takes over a stale lease **checks the history
   first** and finalises without calling Telegram if the refund is already visible.
5. **The history check precedes every call**, including a re-issue after `REFUND_FAILED` (main plan
   §13.6).

### D.5.5 The operator runbook

The runbook is in the main plan **§13.8**. The one rule that must be repeated here, because it is the one
an operator is most likely to break under pressure:

> **Never call `refundStarPayment` by hand.** A refund is a state machine, not an API call. The command
> creates a durable `REFUND_REQUESTED` operation; the worker performs the call; the Telegram history
> decides the outcome. A manual call creates exactly the state the whole design exists to prevent — *money
> returned, nothing recorded*.

## D.6 The reconciliation design in full

### D.6.1 What it must detect

> The authoritative catalogue — with the evidence, the severity, the automatic/manual split, the safe
> outcome and the **detectability class** of every case — is in the main plan **§14.2**. This table is the
> index into it.

| Finding | The query (sketch) | Severity | Main plan |
|---|---|---|---|
| A **Telegram payment with no local operation** | an `IN` mirror row with no `operations.telegram_payment_charge_id` match | 🔴 high | **R1** |
| A **local operation without an entitlement** | `operations.status='ENTITLED'` AND no matching `entitlements` row | 🔴 high | **R2** |
| An **entitlement without a payment** | `entitlements` rows with no non-revoked granting `operations` row | 🔴 high | **R3** |
| A **refund without a revoke** | an `OUT` mirror row for a known charge id while the entitlement has `revoked_at IS NULL` | 🔴 high | **R4** |
| A **revoke without a confirmed refund** | `operations.status='REFUNDED'` AND no `OUT` mirror row for the charge id | 🟠 medium | **R5** |
| A **duplicate external transaction** | two mirror rows with the same `tx_id` and the same `direction` | 🔴 high | **R6** |
| One **charge id on several operations** | prevented by `uq_operations_charge`; re-checked for pre-constraint rows | 🔴 high | **R7** |
| One **`opId` with a different fingerprint** | the stored `op_fingerprint` ≠ the recomputed one | 🟠 medium | **R8** |
| A **price / SKU / catalog-version mismatch** | `operations.amount_stars !=` the catalog price at `catalog_version`; or the mirror amount ≠ the operation amount | 🟠 / 🔴 | **R9** |
| A **balance drift** | `getMyStarBalance` ≠ the ledger's expected net receipts | 🟠 medium | **R10** |
| An **orphan intent** | `operations.status='PENDING'` older than the intent TTL | 🟢 low | (operational, not a money case) |
| A **level above the max** | `entitlements.level > catalog_sku.max_level` | 🔴 high | (a grant bug) |

### D.6.2 The job shape

- **Periodic** (e.g. hourly incremental, **weekly full**) and **on-demand** (an admin endpoint).
- **Observe → compare → classify → repair only when deterministic** (main plan §14.5). The auto-repair
  allowlist is short and each entry has a written reason; everything else goes to
  `ofeliya_pay.reconcile_findings` with a `finding_key` (idempotent across runs).
- The admin endpoint returns the findings; anything not on the allowlist is a separate, explicit, audited
  operation.
- It must be safe to run **during** a purchase: it reads committed rows only (MVCC), it never flags a
  `PENDING` operation, and it never takes the advisory lock for long. A repair takes the same advisory lock
  as the write path, so a repair and a purchase cannot interleave.
- It must be safe to run **during** a refund: a `REFUND_PENDING` / `REFUND_RECONCILE` operation is resolved
  from the mirror, never re-issued.

### D.6.3 The Telegram reconciliation facts (corrected)

> **CORRECTION.** The first revision of this package said: *"Telegram provides no API to list a bot's
> payments. There is no 'list my transactions' method."* **That was factually wrong.** The Bot API has
> exposed `getStarTransactions` — the bot's own Telegram Star transaction list — since **Bot API 7.5
> (June 18, 2024)**. The full field reference is in **D.1.7**; the capability matrix is in the main plan
> **§9.5**.

What changes:

| The first revision claimed | The verified reality |
|---|---|
| *"a Telegram payment with no local operation" can only be found by a manual export from the Telegram side* | It can be found **automatically** by scanning `getStarTransactions` and comparing it with the local ledger. The manual export is now a **dispute-handling convenience**, not the detection mechanism |
| *"There is no 'list my transactions' method"* | There is: `getStarTransactions`, with `offset` (a skip count) and `limit` (1–100) |
| *"cannot be detected automatically"* (Annex D §D.6.1, the last row) | **Detection is automatic.** What stays manual is the *repair* when the evidence is ambiguous (main plan §14.4) |
| Open question Q5 — *"how do we obtain a Telegram-side payment listing?"* | **Answered.** `getStarTransactions` is the listing. The remaining question is the *operator console* over it, not its existence |

What does **not** change: a **client-side report** ("I paid and got nothing") is still only a *trigger*, never
evidence; and Telegram's own live checklist still says *"Use backups to make sure that you don't lose data
about your users' payments."*

The complete reconciliation architecture — the three sources of truth, the R1–R9 mismatch catalogue with
their detectability classes, the worker and the checkpoint — is in the main plan **§14**.

### D.6.4 The scan loop — how the history is read

```ts
// Pseudocode. The details that matter are the atomicity and the ordering guard.
async function scanTelegramTransactions(reason: 'SCHEDULED' | 'MANUAL' | 'INCIDENT') {
  const cp = await loadCheckpoint();                     // one row per bot
  let offset = (cp.mode === 'FULL' || reason === 'MANUAL') ? 0 : max(0, cp.last_offset - OVERLAP);
  const pageLimit = 100;                                // the Bot API maximum
  let guard = 0;

  while (guard++ < MAX_PAGES) {
    const page = await provider.listStarTransactions({ offset, limit: pageLimit });
    if (!page.transactions.length) break;               // the end of the history

    const rows = page.transactions.map(toMirrorRow);    // direction is derived in the adapter
    const newest = rows.reduce((m, r) => Math.max(m, r.tx_date), 0);

    // --- the ordering-violation guard: the blind-spot detector ---
    if (cp.mode !== 'FULL' && cp.last_date && newest < cp.last_date) {
      await raiseAlert('telegram-scan-ordering-violation');
      await setMode('FULL');                             // force a complete re-scan
      break;
    }

    // --- the page and the checkpoint move in ONE transaction ---
    await db.tx(async (t) => {
      await t.query(insertIntoMirror(rows, { onConflict: 'do nothing' }));   // the tx_key dedupes
      await t.query(updateCheckpoint({
        last_offset: offset + rows.length,
        last_date:   newest,
        last_tx_key: rows[rows.length - 1].tx_key,
        mode:        'INCREMENTAL'
      }));
    });

    offset += rows.length;
    if (rows.length < pageLimit) break;                 // a short page = the end
  }
}
```

**Four properties, and why each one is there.**

| Property | Why it exists |
|---|---|
| The **overlap** re-read of the last `OVERLAP` transactions | closes the gap where a transaction is appended *while* we are paging. The `tx_key` makes the re-ingest a no-op |
| The **checkpoint moves in the same transaction as the page** | a crash mid-page rolls back both ⇒ the mirror is never ahead of the checkpoint and a partial scan can never advance the position |
| The **ordering-violation guard** | the Bot API's `offset` is a positional skip count, not a cursor (main plan §14.6). If a transaction comes back with a `date` older than the newest one already ingested, the append-only assumption is broken ⇒ force a full re-scan and alert |
| The **weekly full scan** (`mode='FULL'`, `offset=0`) | the backstop against a compaction, a reordering, a lost page or a checkpoint bug. At OFELIYA's scale it costs ⌈n/100⌉ API calls — the cheapest insurance in the system |

> **The honest limitation.** The Bot API provides **no durable cursor**. The checkpoint is our own
> construction, valid only while the list is append-only and chronologically ordered. The documentation
> states the ordering (*"in chronological order"*); it does not explicitly guarantee append-only behaviour,
> and it states **no retention guarantee**. That is why the design is layered (overlap + guard + weekly full
> scan + a test-environment verification of history completeness) and why MTProto's opaque `next_offset` is
> recorded as a **later, optional** upgrade — never a dependency (main plan §9.5.1, §14.6).

### D.6.5 The safe repair strategy

```
detect → record the finding → a human reviews → an explicit repair command → an audit log → re-run to confirm
```

1. **Never auto-repair a money action.** A repair that grants an entitlement is a money action *unless* it
   is on the main plan §14.5 auto-repair allowlist, and each allowlist entry has a written reason why it is
   deterministic. Everything else is manual.
2. Every repair writes to `grants_log` with `reason`, `finding_id` and the operator identity.
3. The repairs are **idempotent** — running them twice changes nothing the second time.
4. A repair that would grant value **without** a matching Telegram charge requires a charge reference — the
   transaction id from the mirror, or a dispute reference — otherwise it is rejected with
   `manual-review-required`.
5. The reconcile job must be safe to run **during** a purchase: it reads committed rows only, never flags a
   `PENDING` operation, and never blocks the write path.
6. The reconcile job must be safe to run **during** a refund: a repair takes the same advisory lock as the
   write path, so a repair and a refund cannot interleave.

