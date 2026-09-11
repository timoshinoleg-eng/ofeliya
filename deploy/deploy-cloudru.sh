#!/usr/bin/env bash
set -Eeuo pipefail

: "${OFELIYA_RELEASE:?OFELIYA_RELEASE must be an immutable git SHA}"

APP_DIR="${OFELIYA_APP_DIR:-/opt/ofeliya}"
ENV_FILE="${OFELIYA_ENV_FILE:-${APP_DIR}/.env}"
REPO_URL="${OFELIYA_REPO_URL:-https://github.com/timoshinoleg-eng/ofeliya.git}"
COMPOSE_FILE="deploy/compose.production.yml"

if [[ ! "${OFELIYA_RELEASE}" =~ ^[0-9a-fA-F]{40}$ ]]; then
  echo "OFELIYA_RELEASE must be a full 40-character git SHA" >&2
  exit 2
fi

command -v git >/dev/null || { echo "git is required" >&2; exit 2; }
command -v docker >/dev/null || { echo "docker is required" >&2; exit 2; }
docker compose version >/dev/null 2>&1 || { echo "docker compose v2 is required" >&2; exit 2; }

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Production env file is missing: ${ENV_FILE}" >&2
  echo "Create it from deploy/ofeliya.env.example and fill real MAX/legal values first." >&2
  exit 3
fi

if [[ ! -d "${APP_DIR}/.git" ]]; then
  parent="$(dirname "${APP_DIR}")"
  mkdir -p "${parent}"
  git clone "${REPO_URL}" "${APP_DIR}"
fi

cd "${APP_DIR}"
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

# Fail before changing running containers if release configuration is incomplete.
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" config --quiet

# Build all immutable images first. Existing containers continue serving until up succeeds.
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" build bot score static

# Data/API and frontend first; bot/webhook is switched last.
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d score static

docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T static \
  wget -q -O /dev/null http://127.0.0.1:8080/

docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T score \
  node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Only after static + score are healthy do we update the MAX bot process.
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d bot

docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps

printf 'OFELIYA deployed on Cloud.ru host at SHA %s\n' "${OFELIYA_RELEASE}"
