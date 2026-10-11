# OFELIYA on Render Free

One Node 22 web service serves `dist` at `/ofeliya/` and proxies `/api/*` and
`/health` to the score server in the same process. No MAX polling bot is started.
Telegram uses `/api/telegram/webhook` with the existing secret validation.

Build: `npm ci && VITE_RELEASE_SHA="$RENDER_GIT_COMMIT" npm run build:max`

Start: `node server/hosting.mjs`

Runtime secrets: `TG_BOT_TOKEN`, `TG_WEBHOOK_SECRET`, `OFELIYA_STATE_URL`,
`OFELIYA_STATE_TOKEN`. Set `GAME_URL` to the HTTPS game URL and retain the existing
`OFELIYA_TELEGRAM_GAME_URL` direct Mini App link. Legal/build values are unchanged
from the previous release. Do not use a shared MAX token as `MAX_BOT_TOKEN`.

## State

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
