# Operator-only Telegram Stars purchase smoke (public storefront disabled)

Release runbook for issue #294 and draft PR #300. **Do not execute before explicit approval of a real purchase and controlled webhook cutover.**

## Preconditions

- Actual Telegram webhook points to the Worker-first ingress and getWebhookInfo has been verified.
- D1 v17 and secrets are checked, rollback is ready, owner has approved one low-value charge.
- Production VITE_PAYMENTS_API_URL remains unset, public storefront is disabled.
- Never paste or log bot tokens, initData, admin credentials, or charge IDs into chat/GitHub.

## Collect an authentic initData for an operator account

Open the OFELIYA Telegram Mini App through its normal Telegram entrypoint. In an authorized Telegram desktop WebView debugging console, if available, use:

~~~javascript
copy(window.Telegram.WebApp.initData)
~~~

Only the signed initData string is appropriate. Do not copy initDataUnsafe or fabricate data. If the console is unavailable, do not attempt to bypass signature validation; use a separately authorized QA-only route to collect real initData. It is short-lived.

## PowerShell: request one signed invoice without enabling storefront

The operator runs the following locally. The sensitive input is hidden by Read-Host -AsSecureString and is not entered into command history. No invoice is paid automatically. The Telegram dialog still requires human confirmation. The product currency.rna-pack-s costs 35 Stars according to current catalog; recheck price before execution.

~~~powershell
$ErrorActionPreference = 'Stop'
$secret = Read-Host 'Paste fresh Telegram.WebApp.initData' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try { $initData = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
if ([string]::IsNullOrWhiteSpace($initData)) { throw 'Empty Telegram initData' }
$nonce = [Guid]::NewGuid().ToString('N') # retain privately for D1 reconciliation
$payload = @{
  initData = $initData
  productId = 'currency.rna-pack-s'
  nonce = $nonce
} | ConvertTo-Json -Compress
$initData = $null
$response = Invoke-RestMethod -Method POST -ContentType 'application/json' -Uri 'https://ofeliya-payments.chatbot24-cloud.workers.dev/api/invoice' -Body $payload -TimeoutSec 15
$payload = $null
if (-not $response.invoiceUrl) { throw 'Invoice not issued' }
if ($response.nonce -ne $nonce) { throw 'Invoice nonce mismatch; abort without opening' }
$invoice = [Uri]$response.invoiceUrl
if ($invoice.Scheme -ne 'https' -or $invoice.Host -ne 't.me') { throw 'Untrusted invoice URL; abort' }
Write-Host 'Invoice created; Telegram will request explicit payment confirmation.'
Start-Process $invoice.AbsoluteUri
~~~

This command sends the request from the operator machine, not through the browser, and therefore does not require loosening production CSP or activating the purchase UI. Do not paste command outputs with signed values into public logs.

## Required reconciliation

After one owner-approved real purchase, perform authenticated read-only D1 checks. The local PowerShell variable `$nonce` remains available in that operator session to match the D1 `orders.nonce` and `payments.nonce`; do not paste it into public chat or GitHub:
- Order is paid with the intended user, product, price, and nonce.
- Exactly one payment exists with the actual nonempty Telegram charge ID.
- One RNA ledger grant exists, increasing purchased_rna by exactly 500.
- A replay of the identical update in an isolated authorized test adds zero additional RNA; **never forge successful_payment on production**.
- Verify authenticated wallet / verify endpoints, then the approved refund and subscription admin procedures separately.
- Actual 30-day subscription renewal can only be observed after the first renewal period; it is not proven by synthetic tests.

If a paid charge exists without wallet credit, stop testing, preserve D1, reconcile and resolve the charge.

This is a backend test while storefront is disabled; a separate controlled end-user purchase UI test is still required before public release.
