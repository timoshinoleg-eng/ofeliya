# OFELIYA on Render Free

One Node 22 web service serves `dist` at `/ofeliya/` and proxies `/api/*`, `/ofeliya/api/*` and
`/health` to the score server in the same process. Telegram uses
`/ofeliya/api/telegram/webhook` (also `/api/telegram/webhook`) with the existing secret validation. The existing MAX
handlers are mounted at `/ofeliya/bot/webhook` when the dedicated MAX credentials
are configured. Hosting startup does not poll, register or remove subscriptions;
the canonical webhook URLs remain unchanged through DNS cutover.

Build: `npm ci && VITE_RELEASE_SHA="$RENDER_GIT_COMMIT" npm run build:max`

Start: `node server/hosting.mjs`

Readiness: `/ready` aggregates score persistence/capacity and configuration of
required MAX/Telegram integrations. `/health` retains the API health contract.
Use `/ready` for deployment acceptance; it does not prove external Bot API uptime.
Optional unconfigured integrations are explicitly disabled, while malformed
configured MAX startup leaves Telegram/static hosting alive and readiness503.

The internal API binds127.0.0.1. Public forwarding headers are replaced by the
gateway; forwarding is trusted only with both `HOST_TRUSTED_PROXY_HOPS` and explicit
`HOST_TRUSTED_PROXY_IPS`. Default is0, so unknown Render proxy topology groups IP
limits conservatively rather than trusting attacker-supplied XFF. To preserve
real client IPs, verify the actual connecting proxy addresses first. Direct API
mode uses `TRUSTED_PROXY_HOPS=0`; explicit0 is valid. An external frontend origin
must be listed in comma-separated `ALLOW_ORIGINS`; same-host clients need no entry.
Gateway CSP hashes the actual shipped inline HTML bootstrap. Both real messenger
embeds remain device acceptance gates.

Runtime secrets: `TG_BOT_TOKEN`, `TG_WEBHOOK_SECRET`, `OFELIYA_STATE_URL`,
`OFELIYA_STATE_TOKEN`. Set `GAME_URL` to the HTTPS game URL and retain the existing
`OFELIYA_TELEGRAM_GAME_URL` direct Mini App link. Legal/build values are unchanged
from the previous release. Do not use a shared MAX token as `MAX_BOT_TOKEN`.

For MAX retain `OFELIYA_BOT_TOKEN`, `OFELIYA_BOT_USERNAME`,
`OFELIYA_BOT_MODE=dedicated`, `OFELIYA_BOT_WEBHOOK_DOMAIN`,
`OFELIYA_BOT_WEBHOOK_PATH=/ofeliya/bot/webhook` and
`OFELIYA_BOT_WEBHOOK_SECRET` (at least 32 characters). The SDK callback shares
Render's public port; `OFELIYA_BOT_WEBHOOK_PORT` is only validated as legacy config
and defaults to 8788. MAX score authentication uses explicit `MAX_BOT_TOKEN`, or
the existing `OFELIYA_MAX_BOT_TOKEN`/dedicated bot token when not explicitly set.
No Hub/Chatbot24 credential fallback is used. Without a MAX bot token the MAX
webhook returns 503, so a Telegram-only deployment does not look MAX-ready.

## State

The hosted Telegram webhook/API is the sole registry writer. Valid private/start
registration marks its own generation and returns200 only after the current full
snapshot is acknowledged. A503 causes Telegram redelivery. Local tg_users.json is
a mirror of that authoritative remote snapshot; do not merge competing files by
mtime. Long polling refuses remote-state or configured webhook mode. Never run a
second registry writer or rewrite pending commit UUID/payload on retry.

Render Free files disappear on restart, redeploy and idle shutdown. Production
therefore **requires both state environment variables**. A dedicated private
Supabase snapshot holds scores, profiles and the exported Telegram user list.
Deploy `ofeliya-state.sql` once; initialize row1 with the current JSON export.
Deploy `ofeliya-state-function.ts` after replacing its hash placeholder with
SHA256 of a cryptographically random64hex server key. Keep the key in Render
secrets, never in Vite variables or the repository.

The Edge Function implements its own bearer authentication, so its gateway JWT
check is disabled. Its RPC is invoker-only, executable only by `service_role`;
the table is in an unexposed schema with RLS and no anon/authenticated grants.

Startup claims a writer generation and restores the complete snapshot before
listening. Responses wait for changed state to reach Supabase. Commits use a
revision and idempotency UUID. An overlapping old deploy cannot overwrite the
new writer. Temporary write errors return503; ambiguous acknowledgements retry
the same commit. `/health` reports remote persistence health and revision.

## Cutover

1. Verify the build, `/health`, assets and signed Telegram profile on Render.
2. Drain the old score server; export its final `store.json`, `profiles.json` and
   `tg_users.json` and keep an independent backup.
3. Import the final snapshot while the target is stopped, then restart Render.
4. Verify counts and persistence after a fresh deploy/restart before changing
   Telegram webhook/menu and the canonical domain. Preserve the canonical domain
   to retain browser local storage and BotFather Mini App configuration.
5. Back up other Cloud.ru workloads independently before deleting VM disks,
   floating IPs, backups and registry. Keep genuinely free Object Storage.

Render Free sleeps after15idle minutes and may take about a minute to start.
750instance hours are shared by the workspace; bandwidth/build allowances also
apply. Supabase Free may pause inactive projects. No keepalive bypass is added.

## Verified production cutover (2026-10-11)

Production service: `ofeliya-game` (`srv-db5ro5vlk1mc73b0v0eg`), Render Free,
Frankfurt, main with checksPass automatic deployment. Canonical DNS is a
non-proxied CNAME to `ofeliya-game.onrender.com`; Render verifies domain/TLS.
MAX and Telegram retain their canonical bot identities and webhook URLs.
`OFELIYA_TELEGRAM_OUTBOUND_ENABLED=1` restores prepared sharing; the live API
returned200 without sending a chat message. Supabase restore after restart
remains healthy. Cloud.ru OFELIYA VM/disk/IP are deleted; other workloads remain.


Render build filters ignore only `memory/**`, `PROJECT_IDENTITY.md` and
`deploy/RENDER.md`; documentation updates do not redeploy the runtime.
The retired Cloud.ru deployment workflow is disabled.

## State writer isolation

Supabase state access key was rotated in the existing Free project. The new
Render uses the replacement; the old key returns401 for read and writer claim,
so the inaccessible preview cannot steal production persistence. A 24-hour
management token was scoped only to this project and Edge Functions. No keys
are committed. Main CI38158081443 passed all three jobs for runtime d92325b.

## Independent free S3 backup (2026-10-12)

Private remote-state snapshots now have an independent Cloud.ru S3 copy.
Daily execution is a local Windows task at20:00 Europe/Moscow, not a Render
cron service. Download/hash/JSON round-trip was verified without claiming
a full production restore. Task needs the owner computer and Windows session.
Use only the existing standard-class bucket and conservative size limits.
Managed BI activation is pending; no paid database or SNAT is authorized.
