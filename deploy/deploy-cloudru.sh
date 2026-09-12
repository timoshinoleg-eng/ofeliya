#!/usr/bin/env bash
set -Eeuo pipefail

: "${OFELIYA_RELEASE:?OFELIYA_RELEASE must be an immutable git SHA}"

APP_ROOT="${OFELIYA_APP_DIR:-/opt/ofeliya}"
ENV_FILE="${OFELIYA_ENV_FILE:-${APP_ROOT}/.env}"
REPO_URL="${OFELIYA_REPO_URL:-https://github.com/timoshinoleg-eng/ofeliya.git}"
COMPOSE_FILE="deploy/compose.production.yml"
# Shared Cloud.ru host: never allow Ofeliya into Hub's Compose project.
COMPOSE_PROJECT="ofeliya"

if [[ ! "${OFELIYA_RELEASE}" =~ ^[0-9a-fA-F]{40}$ ]]; then
  echo "OFELIYA_RELEASE must be a full 40-character git SHA" >&2
  exit 2
fi

command -v git >/dev/null || { echo "git is required" >&2; exit 2; }
command -v docker >/dev/null || { echo "docker is required" >&2; exit 2; }
docker compose version >/dev/null 2>&1 || { echo "docker compose v2 is required" >&2; exit 2; }

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Production env file is missing: ${ENV_FILE}" >&2
  echo "Create it from deploy/ofeliya.env.example and fill real Ofeliya values first." >&2
  exit 3
fi

required_env_keys=(
  OFELIYA_BOT_TOKEN OFELIYA_BOT_USERNAME
  OFELIYA_BOT_WEBHOOK_DOMAIN OFELIYA_BOT_WEBHOOK_PORT
  OFELIYA_BOT_WEBHOOK_PATH OFELIYA_BOT_WEBHOOK_SECRET OFELIYA_GAME_URL
  OFELIYA_EXTRA_CA_CERT OFELIYA_SHARED_NETWORK
  OFELIYA_DEVELOPER_LEGAL_NAME OFELIYA_DEVELOPER_REGISTRATION
  OFELIYA_DEVELOPER_ADDRESS OFELIYA_SUPPORT_EMAIL
)
for key in "${required_env_keys[@]}"; do
  if ! grep -Eq "^${key}=.+" "${ENV_FILE}"; then
    echo "Production env value is missing: ${key}" >&2
    exit 3
  fi
done

if ! grep -Eq '^OFELIYA_BOT_WEBHOOK_PATH=/ofeliya/bot/webhook$' "${ENV_FILE}"; then
  echo 'OFELIYA_BOT_WEBHOOK_PATH must be /ofeliya/bot/webhook' >&2
  exit 3
fi

if [[ -d "${APP_ROOT}/.git" ]]; then
  CHECKOUT_DIR="${APP_ROOT}"
else
  CHECKOUT_DIR="${OFELIYA_CHECKOUT_DIR:-${APP_ROOT}/current}"
fi

if [[ ! -d "${CHECKOUT_DIR}/.git" ]]; then
  mkdir -p "$(dirname "${CHECKOUT_DIR}")"
  git clone "${REPO_URL}" "${CHECKOUT_DIR}"
fi
cd "${CHECKOUT_DIR}"
git remote set-url origin "${REPO_URL}"
git fetch --prune origin main
git cat-file -e "${OFELIYA_RELEASE}^{commit}"

if ! git merge-base --is-ancestor "${OFELIYA_RELEASE}" origin/main; then
  echo "Refusing deploy: ${OFELIYA_RELEASE} is not contained in origin/main" >&2
  exit 4
fi

git checkout --detach "${OFELIYA_RELEASE}"
git reset --hard "${OFELIYA_RELEASE}"

export OFELIYA_RELEASE
export OFELIYA_ENV_FILE="${ENV_FILE}"

compose() {
  docker compose -p "${COMPOSE_PROJECT}" --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" "$@"
}

# Fail before changing running containers if release configuration is incomplete.
compose config --quiet

# Build all immutable images first. Existing containers continue serving until up succeeds.
compose build bot score static

# Data/API and frontend first; bot/webhook is switched last.
compose up -d score static
compose exec -T static \
  wget -q -O /dev/null http://127.0.0.1:8080/

compose exec -T score \
  node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Only after static + score are healthy do we update the MAX bot process.
compose up -d bot
compose ps

printf 'OFELIYA deployed on Cloud.ru host at SHA %s (project=%s checkout=%s)\n' \
  "${OFELIYA_RELEASE}" "${COMPOSE_PROJECT}" "${CHECKOUT_DIR}"
