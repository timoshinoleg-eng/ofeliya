# OFELIYA production on Cloud.ru VM

OFELIYA production stays on the existing Cloud.ru VM / shared hub host. Render is not the production target.

## Host layout

- application checkout: `/opt/ofeliya` by default;
- release env: `/opt/ofeliya/.env`;
- compose file: `deploy/compose.production.yml`;
- shared external Docker network: `HUB_SHARED_NETWORK` (historically the hub/quiz-battle network);
- public namespace: `/ofeliya/`;
- dedicated MAX bot webhook: `/ofeliya/bot/webhook`.

Do not publish OFELIYA under `/hub/*`. That route belongs to `timoshinoleg-eng/hub` and can make MAX open the wrong/legacy app.

## One-time production host requirements

The Cloud.ru VM must have:

- git;
- Docker Engine;
- Docker Compose v2;
- access to `https://github.com/timoshinoleg-eng/ofeliya.git`;
- the shared Docker network referenced by `HUB_SHARED_NETWORK`;
- the CA bundle referenced by `HUB_EXTRA_CA_CERT`;
- `/opt/ofeliya/.env`, created from `deploy/ofeliya.env.example` with real release values.

Never commit the real `.env`, bot token, webhook secret, SSH key or legal/private account credentials.

## Caddy ingress

The existing production Caddy host must include the contents of `deploy/Caddyfile.ofeliya` before any catch-all `handle` block. Keep the Hub block (`deploy/Caddyfile.hub` in the Hub repository) separate.

After a Caddy change, validate before reload using the host's existing Caddy installation. Do not replace the complete host Caddyfile from this repository.

The MAX Mini App URL must be the Cloud.ru-backed HTTPS URL ending in `/ofeliya/`, not the Render QA URL.

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

### Optional repository/environment variable

- `CLOUDRU_OFELIYA_APP_DIR` — defaults to `/opt/ofeliya`.

## Deployment order

`deploy/deploy-cloudru.sh` performs a fail-closed rollout:

1. validates the release SHA and production env;
2. checks that the SHA belongs to `origin/main`;
3. validates the Compose config before changing running containers;
4. builds immutable `bot`, `score`, and `static` images;
5. updates `score` and `static` first;
6. checks their internal health;
7. updates `bot` last;
8. the GitHub workflow performs an external HTTPS smoke against `CLOUDRU_OFELIYA_URL`.

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
