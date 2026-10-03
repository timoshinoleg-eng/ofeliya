# OFELIYA production on Cloud.ru VM

OFELIYA production runs on its own dedicated Cloud.ru VM `chatgpt-ofeliya-1`. Render and the legacy Chatbot24/Hub host are not production targets.

## Host layout

- application checkout: `/opt/ofeliya/current` on the existing legacy-layout host (or `/opt/ofeliya` when that root is already a git checkout);
- release env: `/opt/ofeliya/.env`;
- base compose file: `deploy/compose.production.yml`; dedicated hosts may also keep untracked `deploy/compose.production.dedicated.local.yml` and `deploy/compose.caddy.yml`, which the deploy script auto-detects;
- Compose project: `OFELIYA_COMPOSE_PROJECT`; the current dedicated host uses project `deploy`;
- external network: `OFELIYA_SHARED_NETWORK`; the current dedicated host uses `deploy_ofeliya` (the variable name is retained for deployment compatibility only);
- public namespace: `/ofeliya/`;
- MAX bot mode: `dedicated` only;
- dedicated webhook: `/ofeliya/bot/webhook`.

Do not publish OFELIYA under `/hub/*`. That route belongs to `timoshinoleg-eng/hub` and can make MAX open the wrong/legacy app.

## One-time production host requirements

The Cloud.ru VM must have:

- git;
- Docker Engine;
- Docker Compose v2;
- access to `https://github.com/timoshinoleg-eng/ofeliya.git`;
- the shared Docker network referenced by `OFELIYA_SHARED_NETWORK`;
- the CA bundle referenced by `OFELIYA_EXTRA_CA_CERT`;
- `/opt/ofeliya/.env`, created from `deploy/ofeliya.env.example` with real release values.

Never commit the real `.env`, bot token, webhook secret, SSH key or legal/private account credentials.

## Caddy ingress

The dedicated production Caddy host must include the contents of `deploy/Caddyfile.ofeliya` before any catch-all `handle` block. It must not import or depend on the Hub/Chatbot24 Caddy configuration.

After a Caddy change, validate before reload using the host's existing Caddy installation. Do not replace the complete host Caddyfile from this repository.

The MAX Mini App URL must be the Cloud.ru-backed HTTPS URL ending in `/ofeliya/`, not the Render QA URL.


## MAX bot ownership

The current `chatgpt-ofeliya-1` production VM runs `OFELIYA_BOT_MODE=dedicated` and keeps all bot/runtime env in `/opt/ofeliya/.env`. Shared Hub/Chatbot24 bot ownership is retired and must fail closed.

Do not switch bot ownership or webhook paths during a code deploy. Production requires `/ofeliya/bot/webhook` and the canonical Ofeliya bot identity from `PROJECT_IDENTITY.md`.

## GitHub production deployment

Workflow: `.github/workflows/deploy-cloudru.yml`.

The workflow is intentionally manual (`workflow_dispatch`) and deploys only a full immutable SHA already contained in `main`. Manual dispatch is not sufficient by itself: the selected SHA must also have a completed successful `CI` run from a `push` to `main`; red, cancelled, PR-only, or CI-unknown SHAs are rejected before SSH.

Production access goes through the restricted bastion command `deploy <SHA>`. Configure GitHub environment `cloudru-production` with:

### Required secret

- `CLOUDRU_BASTION_SSH_KEY` — private key accepted by the restricted production bastion.

The workflow currently pins the established bastion endpoint `ubuntu@176.108.246.251:22`. The remote key is used only for the restricted `deploy <SHA>` command; application secrets stay in `/opt/ofeliya/.env` on the production host.

### Required repository/environment variable

- `CLOUDRU_OFELIYA_URL` — exact public HTTPS Mini App URL, including `/ofeliya/`.

### Optional repository/environment variables

- `CLOUDRU_OFELIYA_APP_DIR` — defaults to `/opt/ofeliya`;
- `CLOUDRU_OFELIYA_COMPOSE_PROJECT` — explicit Compose project override; current dedicated production uses `deploy`;
- `CLOUDRU_OFELIYA_SHARED_NETWORK` — explicit external-network override; current dedicated production uses `deploy_ofeliya`.

The release `.env` is parsed as dotenv data, not shell-sourced. Values containing spaces therefore do not need shell quoting, and a stale `OFELIYA_RELEASE` entry in the file cannot override the immutable SHA supplied by the workflow.

## Deployment order

`deploy/deploy-cloudru.sh` performs a fail-closed rollout:

1. validates the immutable release SHA and parses production dotenv without executing it as shell;
2. validates dedicated bot ownership plus the host's Compose project/network overrides;
3. checks that the SHA belongs to `origin/main`;
4. auto-includes the host-local dedicated Compose/Caddy overrides when present;
5. validates the effective Compose config before changing running containers;
6. builds immutable `bot`, `score`, and `static` images;
7. updates `score` and `static`, retrying their internal health probes;
8. updates the dedicated bot last;
9. before changing production, the workflow captures the currently served 40-character SHA from `release.json` as the rollback target;
10. the GitHub workflow verifies the selected SHA has a green `CI` push-run on `main`;
11. after rollout, the workflow performs an external HTTPS parity smoke against `CLOUDRU_OFELIYA_URL`: `release.json`, `index.html`, `sw.js`, and `runtime-config.js` hashes/release markers must agree, and MAX CSP / Referrer-Policy / Permissions-Policy / HSTS must be present;
12. if the SSH rollout or external parity smoke fails, the workflow immediately invokes the same restricted `deploy <SHA>` path with the captured previous SHA, verifies public `release.json` is back on that SHA, and then deliberately leaves the workflow red.

A release is verified only when rollout and public parity both pass. A red workflow that successfully rolled back is still a failed release and must be investigated before retrying.

## Composio / Cloud.ru control plane

The existing Cloud.ru bridge is `cloudru-mcp` (Cloudflare Worker, MCP endpoint `/mcp`). Its current v0.3 contract can inspect Cloud.ru projects/VMs/disks/subnets/security groups and perform guarded VM power actions. It does not replace SSH application deployment.

Use Composio for Cloud.ru control-plane verification (correct project, VM, public interface, VM state). Use the GitHub workflow + SSH for deterministic application rollout to the VM.

## Rollback

The normal rollback path is the same immutable deployment command used for a forward release: `deploy <previous-main-SHA>`. The GitHub workflow captures the currently live SHA before every rollout and performs this rollback automatically on rollout/parity failure.

For an operator-initiated rollback, dispatch the workflow with the known-good full 40-character SHA. The SHA must still satisfy the release-identity floor, be contained in `main`, and have a successful main CI run. Do not delete previous SHA-tagged images until the replacement release has passed public parity and the MAX real-device gate.

## Post-deploy MAX real-device gate

Automation cannot establish behavior inside the real MAX mobile client. After the Cloud.ru public parity smoke passes and before treating the release as MAX-review-ready:

1. configure/confirm the Ofeliya MAX bot Mini App URL points to the Cloud.ru `/ofeliya/` URL;
2. fully close and reopen the Mini App in the current MAX Android client;
3. confirm the splash clears after `ready()`, vertical host swipes do not steal drag controls, and the viewport/safe layout survives rotation/resume;
4. exercise one-hand, twin-stick, Pause/BackButton, audio after resume/video, haptics, and challenge sharing/share fallback;
5. confirm the loaded release marker equals the deployed SHA and is not an old service-worker cache;
6. record the device/MAX version and tested release SHA in the release notes or PR before MAX review.

`ready()` and `disableVerticalSwipes()` are intentional shipped-SDK calls and must remain in the MAX adapter.

## Telegram production wiring

Telegram is optional for MAX-only releases. It becomes enabled automatically when Telegram
release values are present in `/opt/ofeliya/.env`.

Required together:

- `TG_BOT_TOKEN` — dedicated Telegram bot token (never a MAX/Chatbot24 token);
- `VITE_TG_BOT_USERNAME` — Telegram bot username without `@`.

Optional:

- `VITE_TELEGRAM_APP_SHORT_NAME` — direct Mini App short name from BotFather;
- `OFELIYA_TELEGRAM_GAME_URL` — explicit `https://t.me/...` launch URL. If omitted, deployment
  derives a Main Mini App link from the username/short name.

When Telegram is configured, deployment builds/starts the separate `telegram-bot` Compose profile.
The score service and Telegram bot share only `ofeliya-score-data` so referral/user state remains
consistent. MAX webhook ownership and credentials remain isolated.

The public CSP allows both the MAX bridge and Telegram WebApp SDK/Web embedding. Release parity
checks fail if either messenger origin disappears.

BotFather still has to point the Telegram Main Mini App to:
`https://ofeliya.freeveol.dpdns.org/ofeliya/`.

### Versioned Caddy edge sync

The Cloud.ru host keeps the site label/TLS wrapper in local deploy/Caddyfile.dedicated, while
the route/security policy is versioned as deploy/Caddyfile.ofeliya.

Every deployment now renders the local dedicated file from the selected release, validates the
candidate with the running Caddy binary, updates the bind-mounted file in place, and reloads Caddy.
If validation or reload fails, the previous edge file is restored and the release fails closed.
This keeps public CSP/security headers in lockstep with the immutable application release instead
of leaving an old local edge policy active.
