# OFELIYA production rollout / rollback

Canonical runbook for the MAX production stack after post-Astra hardening.

Current validated release tree before this runbook PR:

- `main`: `d5cc5fc560a8cbe129fed2b547c32e6fc2b85d7e`
- app runtime cache id: `ofeliya-20260911-v041` (`public/runtime-config.js`)
- public Mini App prefix: `/hub/`
- services: `bot`, `score`, `static`
- score data: persistent `/app/server/data`

The commands below assume the repository is already present on the production host. Replace only values explicitly written as `<...>`.

## 1. Release gate before touching production

Do not deploy unless the exact `main` SHA has a green GitHub Actions CI run.

```bash
git fetch origin
git checkout main
git reset --hard origin/main
git rev-parse HEAD
```

Expected SHA for this RC baseline:

```text
d5cc5fc560a8cbe129fed2b547c32e6fc2b85d7e
```

Run local/static contracts as a second gate:

```bash
npm ci
npm run build
npm run smoke
npm run server:test
npm run smoke:bot
node scripts/check-deploy-contract.mjs
```

## 2. Required production inputs

`deploy/compose.production.yml` reads container secrets/settings from `/opt/hub/.env`. Confirm these are present without printing secret values:

```bash
for key in \
  BOT_TOKEN \
  OFELIYA_BOT_USERNAME \
  OFELIYA_BOT_WEBHOOK_DOMAIN \
  OFELIYA_BOT_WEBHOOK_PORT \
  OFELIYA_BOT_WEBHOOK_PATH \
  OFELIYA_BOT_WEBHOOK_SECRET \
  GAME_URL
do
  grep -q "^${key}=" /opt/hub/.env || { echo "missing ${key}"; exit 1; }
done
```

Production webhook contract:

```text
OFELIYA_BOT_WEBHOOK_DOMAIN=https://<public-host>
OFELIYA_BOT_WEBHOOK_PORT=8788
OFELIYA_BOT_WEBHOOK_PATH=/hub/bot/webhook
OFELIYA_BOT_WEBHOOK_SECRET=<32+ random characters>
GAME_URL=https://<public-host>/hub/
```

`MAX_BOT_TOKEN` is optional for score verification because `BOT_TOKEN` is the production fallback. `TG_BOT_TOKEN`, `VK_SECURE_KEY`, analytics and VK ad variables are optional unless those channels are being enabled.

Compose interpolation variables are **not** taken from the service `env_file`; export them in the deployment shell (or pass an explicit Compose env file):

```bash
export OFELIYA_RELEASE=v0.4.1-d5cc5fc5
export HUB_EXTRA_CA_CERT=<absolute-path-to-existing-extra-ca.crt>
export HUB_SHARED_NETWORK=<shared-docker-network-name>

test -r "$HUB_EXTRA_CA_CERT"
docker network inspect "$HUB_SHARED_NETWORK" >/dev/null
```

Validate the rendered Compose model before building anything:

```bash
docker compose -f deploy/compose.production.yml config -q
```

## 3. Verify Caddy routing contract

The shared production Caddyfile must include `deploy/Caddyfile.ofeliya` **before** its catch-all handler. Required routes are:

```text
/hub/runtime-config.js  -> ofeliya-static:8080 (no-store from nginx)
/hub/bot/webhook       -> ofeliya-bot:8788
/hub/*                  -> ofeliya-static:8080
```

The static nginx then proxies internal `/api/*` to `ofeliya-score:8787`.

Before reload, validate the real shared Caddy config using the host's normal Caddy/container command. Do not replace the shared Caddyfile with `deploy/Caddyfile.ofeliya`; it is a route fragment.

## 4. Capture rollback state

Record the currently running image tag before changing containers:

```bash
PREV_RELEASE="$(docker inspect "$(docker compose -f deploy/compose.production.yml ps -q static)" \
  --format '{{.Config.Image}}' | sed 's/.*://')"
printf 'previous release: %s\n' "$PREV_RELEASE"
test -n "$PREV_RELEASE"
```

Keep the old images until the release is accepted. Do not run image pruning during rollout.

Back up the score store without exposing it in logs:

```bash
sudo mkdir -p /opt/hub/backups/ofeliya
BACKUP="/opt/hub/backups/ofeliya/store-$(date -u +%Y%m%dT%H%M%SZ).json"
docker compose -f deploy/compose.production.yml exec -T score \
  sh -c 'test -f /app/server/data/store.json && cat /app/server/data/store.json || printf "%s" "{\"scores\":[],\"refs\":[],\"refRewards\":{}}"' \
  | sudo tee "$BACKUP" >/dev/null
sudo test -s "$BACKUP"
```

Code rollback normally **must not** restore this data backup because the current change does not introduce a store-schema migration. The backup is for corruption/emergency recovery only.

## 5. Build RC images

Build all three images from the exact checked-out SHA:

```bash
docker compose -f deploy/compose.production.yml build --pull bot score static
```

Confirm immutable release tags exist:

```bash
docker image inspect "ofeliya-runtime:${OFELIYA_RELEASE}" >/dev/null
docker image inspect "ofeliya-score:${OFELIYA_RELEASE}" >/dev/null
docker image inspect "ofeliya-static:${OFELIYA_RELEASE}" >/dev/null
```

## 6. Roll out

```bash
docker compose -f deploy/compose.production.yml up -d --no-build --remove-orphans
docker compose -f deploy/compose.production.yml ps
```

`score` must become healthy before `static` starts. `static` has its own HTTP healthcheck. The bot is fail-closed in production: missing/unsafe webhook settings cause process exit instead of falling back to polling.

Inspect startup logs:

```bash
docker compose -f deploy/compose.production.yml logs --tail=100 score static bot
```

Block the rollout if there are repeated restarts, `Unsafe production bot config`, score persistence errors, nginx upstream/DNS errors, or webhook startup errors.

## 7. HTTP acceptance checks

Set the public origin once:

```bash
export PUBLIC_ORIGIN=https://<public-host>
```

Static/runtime checks:

```bash
curl -fsS -o /dev/null "$PUBLIC_ORIGIN/hub/"
curl -fsSI "$PUBLIC_ORIGIN/hub/runtime-config.js" | grep -i 'cache-control: no-store'
curl -fsS "$PUBLIC_ORIGIN/hub/runtime-config.js" | grep -q 'ofeliya-20260911-v041'
```

Score route through the full Caddy -> nginx -> score path:

```bash
curl -fsS "$PUBLIC_ORIGIN/hub/api/ref?user=rc-check&platform=max" | grep -q '"ok":true'
```

The historical unauthenticated referral write must stay blocked:

```bash
test "$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
  -H 'Content-Type: application/json' \
  --data '{"from":"x","to":"y","platform":"max"}' \
  "$PUBLIC_ORIGIN/hub/api/ref")" = "403"
```

Internal score health:

```bash
docker compose -f deploy/compose.production.yml exec -T score \
  node -e "fetch('http://127.0.0.1:8787/health').then(async r=>{console.log(await r.text());process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"
```

## 8. MAX acceptance checks

Use a real MAX client, not only a desktop browser:

1. Open the bot and press `Играть в OFELIYA`.
2. Confirm Mini App opens at the production `/hub/` URL.
3. Confirm the URL acquires `?app=ofeliya-20260911-v041`; one redirect is expected, a redirect loop is not.
4. Start a run and confirm touch movement, dodge, sound and background/resume behavior.
5. Complete or intentionally end a run and confirm result UI appears and `ЕЩЁ РАЗ` immediately starts a new run.
6. Submit a real authenticated result; the global/daily leaderboard must accept it through signed MAX `initData`.
7. Confirm a victory cannot be recorded before 5:00.
8. Reopen the Mini App from the bot after closing it; verify the new build is still served and no stale WebView bundle returns.
9. Check bot logs after launch for webhook errors.

Release-specific note: `SHARE.maxBot` in `src/game/share.ts` is still empty, so bot-style `startapp` share/referral deep links are not release-verified yet. This does not block core gameplay, score submission or opening the Mini App from the bot, but it does block calling viral sharing fully production-ready.

## 9. Acceptance decision

Accept the release only when all are true:

- GitHub CI green on the deployed SHA;
- three production containers stable;
- score and static healthchecks healthy;
- `/hub/`, runtime config and `/hub/api/*` routing pass;
- legacy referral POST returns 403;
- real MAX bot -> Mini App launch passes;
- one authenticated MAX score reaches the leaderboard;
- no WebView stale-build regression after close/reopen.

## 10. Code rollback

If acceptance fails, keep score data and revert only the containers first:

```bash
export OFELIYA_RELEASE="$PREV_RELEASE"
docker compose -f deploy/compose.production.yml config -q
docker compose -f deploy/compose.production.yml up -d --no-build --remove-orphans
docker compose -f deploy/compose.production.yml ps
```

Then repeat the HTTP and MAX launch checks. If Caddy routing was changed during the rollout, restore the previously validated shared Caddyfile and reload it using the host's normal procedure.

Do **not** restore `store.json` for an ordinary code rollback. Restore the backup only if the persistent store itself is proven corrupt; stop `score` first and keep the failed store as a second forensic copy.

## 11. Post-release

After an observation window with stable containers and successful MAX sessions:

- keep at least the immediately previous image tag for fast rollback;
- keep the pre-release score backup;
- record deployed Git SHA + `OFELIYA_RELEASE` in the release notes;
- only then consider pruning older Docker images;
- do not delete the Astra recovery refs/tags used as historical rollback points.
