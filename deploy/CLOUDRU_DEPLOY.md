# OFELIYA production on Cloud.ru VM

OFELIYA production stays on the existing Cloud.ru VM / shared hub host. Render is not the production target.

## Host layout

- application checkout: `/opt/ofeliya/current` on the existing legacy-layout host (or `/opt/ofeliya` when that root is already a git checkout);
- release env: `/opt/ofeliya/.env`;
- base compose file: `deploy/compose.production.yml`; dedicated hosts may also keep untracked `deploy/compose.production.dedicated.local.yml` and `deploy/compose.caddy.yml`, which the deploy script auto-detects;
- Compose project: `OFELIYA_COMPOSE_PROJECT`; legacy shared mode defaults to `ofeliya`, while the current dedicated host auto-detects project `deploy` from its local dedicated override;
- shared-network alias: `OFELIYA_SHARED_NETWORK`; shared mode defaults to `quiz-battle_default`, while dedicated mode defaults to `<compose-project>_ofeliya` so the legacy logical network resolves to the dedicated project's real network;
- public namespace: `/ofeliya/`;
- MAX bot mode: `shared` by default; Ofeliya reuses the existing Quizika/Hub bot identity while Hub remains the sole webhook owner.
- dedicated webhook `/ofeliya/bot/webhook` is only used when `OFELIYA_BOT_MODE=dedicated`.

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

The existing production Caddy host must include the contents of `deploy/Caddyfile.ofeliya` before any catch-all `handle` block. Keep the Hub block (`deploy/Caddyfile.hub` in the Hub repository) separate.

After a Caddy change, validate before reload using the host's existing Caddy installation. Do not replace the complete host Caddyfile from this repository.

The MAX Mini App URL must be the Cloud.ru-backed HTTPS URL ending in `/ofeliya/`, not the Render QA URL.


## MAX bot ownership

`OFELIYA_BOT_MODE=shared` remains supported for a shared Hub host. The current separate `chatgpt-ofeliya-1` production VM runs `dedicated` and keeps its bot env in `/opt/ofeliya/.env`. In dedicated mode the deploy script never requires `/opt/hub/.env` and includes the host-local dedicated Compose/Caddy overrides when present.

Do not switch bot ownership or webhook paths during a code deploy. Dedicated mode requires `/ofeliya/bot/webhook`; shared mode leaves Hub as the webhook owner.

## GitHub production deployment

Workflow: `.github/workflows/deploy-cloudru.yml`.

It is intentionally `workflow_dispatch` only until Cloud.ru production access has been verified. It deploys only a full immutable SHA already contained in `main`.

Configure GitHub environment `cloudru-production` with:

### Required secrets

- `CLOUDRU_DEPLOY_HOST` — public IP/DNS of the existing Cloud.ru VM;
- `CLOUDRU_DEPLOY_USER` — SSH login;
- `CLOUDRU_DEPLOY_SSH_KEY` — private SSH key accepted by that VM.

### Optional secret

- `CLOUDRU_DEPLOY_PORT` — defaults to `22`.

### Required repository/environment variable

- `CLOUDRU_OFELIYA_URL` — exact public HTTPS Mini App URL, including `/ofeliya/`.

### Optional repository/environment variables

- `CLOUDRU_OFELIYA_APP_DIR` — defaults to `/opt/ofeliya`;
- `CLOUDRU_OFELIYA_COMPOSE_PROJECT` — explicit Compose project override; current dedicated production uses `deploy`;
- `CLOUDRU_OFELIYA_SHARED_NETWORK` — explicit legacy-network alias override; current dedicated production uses `deploy_ofeliya`.

The release `.env` is parsed as dotenv data, not shell-sourced. Values containing spaces therefore do not need shell quoting, and a stale `OFELIYA_RELEASE` entry in the file cannot override the immutable SHA supplied by the workflow.

## Deployment order

`deploy/deploy-cloudru.sh` performs a fail-closed rollout:

1. validates the immutable release SHA and parses production dotenv without executing it as shell;
2. resolves shared vs dedicated bot mode plus the host's Compose project/network overrides;
3. checks that the SHA belongs to `origin/main`;
4. auto-includes the host-local dedicated Compose/Caddy overrides when present;
5. validates the effective Compose config before changing running containers;
6. builds immutable `bot`, `score`, and `static` images;
7. updates `score` and `static`, retrying their internal health probes;
8. updates the dedicated bot last (or keeps it stopped in shared mode);
9. the GitHub workflow performs an external HTTPS smoke against `CLOUDRU_OFELIYA_URL`.

If the public URL variable is absent or the HTTPS smoke fails, the workflow fails and must not be treated as a verified release.

## Composio / Cloud.ru control plane

The existing Cloud.ru bridge is `cloudru-mcp` (Cloudflare Worker, MCP endpoint `/mcp`). Its current v0.3 contract can inspect Cloud.ru projects/VMs/disks/subnets/security groups and perform guarded VM power actions. It does not replace SSH application deployment.

Use Composio for Cloud.ru control-plane verification (correct project, VM, public interface, VM state). Use the GitHub workflow + SSH for deterministic application rollout to the VM.

## Post-deploy MAX gate

After the Cloud.ru public smoke passes:

1. configure the Ofeliya MAX bot's Mini App URL to the Cloud.ru `/ofeliya/` URL;
2. fully close and reopen the Mini App in MAX;
3. verify real MAX viewport, renderer, audio, BackButton, haptics and challenge sharing;
4. verify that the loaded release matches the expected release marker and not an old service-worker cache.
