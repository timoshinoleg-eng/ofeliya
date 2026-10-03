#!/usr/bin/env bash
set -Eeuo pipefail

: "${OFELIYA_RELEASE:?OFELIYA_RELEASE must be an immutable git SHA}"

APP_ROOT="${OFELIYA_APP_DIR:-/opt/ofeliya}"
RELEASE_ENV_FILE="${OFELIYA_ENV_FILE:-${APP_ROOT}/.env}"
REPO_URL="${OFELIYA_REPO_URL:-https://github.com/timoshinoleg-eng/ofeliya.git}"

if [[ ! "${OFELIYA_RELEASE}" =~ ^[0-9a-fA-F]{40}$ ]]; then
  echo "OFELIYA_RELEASE must be a full 40-character git SHA" >&2
  exit 2
fi

command -v git >/dev/null || { echo "git is required" >&2; exit 2; }
command -v docker >/dev/null || { echo "docker is required" >&2; exit 2; }
docker compose version >/dev/null 2>&1 || { echo "docker compose v2 is required" >&2; exit 2; }

# Parse dotenv as data, never as shell. Process environment wins over file values,
# so OFELIYA_RELEASE cannot be replaced by a stale value stored in .env.
load_env_file() {
  local file="$1" line key value
  [[ -f "$file" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "${line//[[:space:]]/}" ]] && continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" == *"="* ]] || {
      echo "Invalid dotenv line in $file" >&2
      exit 3
    }
    key="${line%%=*}"
    value="${line#*=}"
    key="${key#"${key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || {
      echo "Invalid dotenv key in $file: $key" >&2
      exit 3
    }
    if (( ${#value} >= 2 )); then
      if [[ ("${value:0:1}" == '"' && "${value: -1}" == '"') ||
            ("${value:0:1}" == "'" && "${value: -1}" == "'") ]]; then
        value="${value:1:${#value}-2}"
      fi
    fi
    if [[ ! -v "$key" ]]; then
      export "$key=$value"
    fi
  done < "$file"
}

[[ -f "${RELEASE_ENV_FILE}" ]] || {
  echo "Ofeliya release env missing: ${RELEASE_ENV_FILE}" >&2
  exit 3
}
load_env_file "${RELEASE_ENV_FILE}"

BOT_MODE="${OFELIYA_BOT_MODE:-dedicated}"
[[ "${BOT_MODE}" == dedicated ]] || {
  echo "OFELIYA_BOT_MODE must be dedicated; Hub/Chatbot24 bot sharing is retired" >&2
  exit 3
}
BOT_ENV_FILE="${RELEASE_ENV_FILE}"
export OFELIYA_BOT_ENV_FILE="${RELEASE_ENV_FILE}"
# The dedicated Ofeliya MAX app token may be explicit; otherwise use the same dedicated
# bot token. Never inherit bot credentials or usernames from another project.
export OFELIYA_MAX_BOT_TOKEN="${OFELIYA_MAX_BOT_TOKEN:-${OFELIYA_BOT_TOKEN:-}}"

# Telegram stays optional for MAX-only releases, but becomes fail-closed once any
# Telegram release value is configured.
TELEGRAM_ENABLED=0
if [[ -n "${TG_BOT_TOKEN:-}${VITE_TG_BOT_USERNAME:-}${VITE_TELEGRAM_APP_SHORT_NAME:-}${OFELIYA_TELEGRAM_GAME_URL:-}" ]]; then
  TELEGRAM_ENABLED=1
  [[ -n "${TG_BOT_TOKEN:-}" ]] || { echo "Telegram wiring incomplete: TG_BOT_TOKEN is missing" >&2; exit 3; }
  [[ -n "${VITE_TG_BOT_USERNAME:-}" ]] || { echo "Telegram wiring incomplete: VITE_TG_BOT_USERNAME is missing" >&2; exit 3; }
  [[ "${VITE_TG_BOT_USERNAME}" =~ ^[A-Za-z0-9_]{1,64}$ ]] || {
    echo "VITE_TG_BOT_USERNAME must contain only A-Z a-z 0-9 _ and omit @" >&2
    exit 3
  }
  if [[ -n "${VITE_TELEGRAM_APP_SHORT_NAME:-}" && ! "${VITE_TELEGRAM_APP_SHORT_NAME}" =~ ^[A-Za-z0-9_]{1,64}$ ]]; then
    echo "VITE_TELEGRAM_APP_SHORT_NAME must contain only A-Z a-z 0-9 _" >&2
    exit 3
  fi
  if [[ -z "${OFELIYA_TELEGRAM_GAME_URL:-}" ]]; then
    if [[ -n "${VITE_TELEGRAM_APP_SHORT_NAME:-}" ]]; then
      export OFELIYA_TELEGRAM_GAME_URL="https://t.me/${VITE_TG_BOT_USERNAME}/${VITE_TELEGRAM_APP_SHORT_NAME}?startapp=play"
    else
      export OFELIYA_TELEGRAM_GAME_URL="https://t.me/${VITE_TG_BOT_USERNAME}?startapp=play"
    fi
  fi
  [[ "${OFELIYA_TELEGRAM_GAME_URL}" == https://t.me/* ]] || {
    echo "OFELIYA_TELEGRAM_GAME_URL must use https://t.me/" >&2
    exit 3
  }
  export OFELIYA_TELEGRAM_API_IP="${OFELIYA_TELEGRAM_API_IP:-149.154.167.220}"
  [[ "${OFELIYA_TELEGRAM_API_IP}" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || {
    echo "OFELIYA_TELEGRAM_API_IP must be an IPv4 address" >&2
    exit 3
  }
fi

DEDICATED_LOCAL_FILE="deploy/compose.production.dedicated.local.yml"
CADDY_LOCAL_FILE="deploy/compose.caddy.yml"
if [[ -n "${OFELIYA_COMPOSE_PROJECT:-}" ]]; then
  COMPOSE_PROJECT="${OFELIYA_COMPOSE_PROJECT}"
elif [[ -f "${APP_ROOT}/${DEDICATED_LOCAL_FILE}" ]]; then
  # Existing dedicated Cloud.ru host uses project=deploy.
  COMPOSE_PROJECT="deploy"
else
  COMPOSE_PROJECT="ofeliya"
fi
[[ "${COMPOSE_PROJECT}" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || {
  echo "Invalid OFELIYA_COMPOSE_PROJECT: ${COMPOSE_PROJECT}" >&2
  exit 3
}

export OFELIYA_EXTRA_CA_CERT="${OFELIYA_EXTRA_CA_CERT:-${APP_ROOT}/certs/ca-certificates.crt}"
if [[ ! -s "${OFELIYA_EXTRA_CA_CERT}" ]]; then
  system_ca=/etc/ssl/certs/ca-certificates.crt
  [[ -s "${system_ca}" ]] || { echo "System CA bundle missing: ${system_ca}" >&2; exit 3; }
  mkdir -p "$(dirname "${OFELIYA_EXTRA_CA_CERT}")"
  cp "${system_ca}" "${OFELIYA_EXTRA_CA_CERT}"
fi
export OFELIYA_SHARED_NETWORK="${OFELIYA_SHARED_NETWORK:-${COMPOSE_PROJECT}_ofeliya}"

required_env_keys=(
  OFELIYA_BOT_TOKEN OFELIYA_MAX_BOT_TOKEN OFELIYA_BOT_USERNAME OFELIYA_GAME_URL
  OFELIYA_EXTRA_CA_CERT OFELIYA_SHARED_NETWORK
  OFELIYA_DEVELOPER_LEGAL_NAME OFELIYA_DEVELOPER_REGISTRATION
  OFELIYA_DEVELOPER_ADDRESS OFELIYA_SUPPORT_EMAIL
)
required_env_keys+=(
  OFELIYA_BOT_WEBHOOK_DOMAIN OFELIYA_BOT_WEBHOOK_PORT
  OFELIYA_BOT_WEBHOOK_PATH OFELIYA_BOT_WEBHOOK_SECRET
)
for key in "${required_env_keys[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    echo "Production env value is missing: ${key}" >&2
    exit 3
  fi
done

if [[ "${OFELIYA_BOT_WEBHOOK_PATH}" != /ofeliya/bot/webhook ]]; then
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
export OFELIYA_ENV_FILE="${RELEASE_ENV_FILE}"

compose_files=(-f deploy/compose.production.yml)
CADDY_COMPOSE_PATH=""
for local_file in "${DEDICATED_LOCAL_FILE}" "${CADDY_LOCAL_FILE}"; do
  selected_file=""
  if [[ -f "${CHECKOUT_DIR}/${local_file}" ]]; then
    selected_file="${CHECKOUT_DIR}/${local_file}"
  elif [[ "${CHECKOUT_DIR}" != "${APP_ROOT}" && -f "${APP_ROOT}/${local_file}" ]]; then
    selected_file="${APP_ROOT}/${local_file}"
  fi
  if [[ -n "${selected_file}" ]]; then
    compose_files+=(-f "${selected_file}")
    if [[ "${local_file}" == "${CADDY_LOCAL_FILE}" ]]; then
      CADDY_COMPOSE_PATH="${selected_file}"
    fi
  fi
done

compose() {
  docker compose -p "${COMPOSE_PROJECT}" \
    --env-file "${RELEASE_ENV_FILE}" \
    "${compose_files[@]}" "$@"
}

retry() {
  local attempts="$1" delay="$2"
  shift 2
  local i
  for ((i=1; i<=attempts; i++)); do
    if "$@"; then return 0; fi
    if (( i == attempts )); then return 1; fi
    sleep "${delay}"
  done
}

sync_caddy_edge() {
  [[ -n "${CADDY_COMPOSE_PATH}" ]] || return 0

  [[ "${OFELIYA_BOT_WEBHOOK_DOMAIN}" == https://* ]] || {
    echo "OFELIYA_BOT_WEBHOOK_DOMAIN must use https:// for Caddy rendering" >&2
    return 1
  }
  local edge_host="${OFELIYA_BOT_WEBHOOK_DOMAIN#https://}"
  edge_host="${edge_host%%/*}"

  local caddy_dir dedicated_file candidate backup caddy_id
  caddy_dir="$(dirname "${CADDY_COMPOSE_PATH}")"
  dedicated_file="${caddy_dir}/Caddyfile.dedicated"
  [[ -f "${dedicated_file}" ]] || {
    echo "Dedicated Caddyfile missing: ${dedicated_file}" >&2
    return 1
  }

  candidate="$(mktemp)"
  backup="$(mktemp)"

  sh deploy/render-caddy-dedicated.sh "${edge_host}" deploy/Caddyfile.ofeliya > "${candidate}"
  cp "${dedicated_file}" "${backup}"

  caddy_id="$(compose ps -q caddy)"
  [[ -n "${caddy_id}" ]] || {
    echo "Caddy service is not running; refusing an unverified edge update" >&2
    rm -f "${candidate}" "${backup}"
    return 1
  }

  docker cp "${candidate}" "${caddy_id}:/tmp/ofeliya-Caddyfile.candidate"
  if ! docker exec "${caddy_id}" caddy validate       --config /tmp/ofeliya-Caddyfile.candidate --adapter caddyfile; then
    rm -f "${candidate}" "${backup}"
    return 1
  fi

  # Preserve the bind-mounted inode so the running container sees the new file immediately.
  cat "${candidate}" > "${dedicated_file}"
  if ! docker exec "${caddy_id}" caddy reload       --config /etc/caddy/Caddyfile --adapter caddyfile; then
    echo "Caddy reload failed; restoring previous edge config" >&2
    cat "${backup}" > "${dedicated_file}"
    docker exec "${caddy_id}" caddy reload       --config /etc/caddy/Caddyfile --adapter caddyfile || true
    rm -f "${candidate}" "${backup}"
    return 1
  fi

  rm -f "${candidate}" "${backup}"
  echo "Caddy edge synced from versioned deploy/Caddyfile.ofeliya"
}

compose config --quiet
build_services=(score static bot)
if (( TELEGRAM_ENABLED )); then
  build_services+=(telegram-bot)
fi
compose build "${build_services[@]}"
compose up -d score static

retry 12 2 compose exec -T static wget -q -O /dev/null http://127.0.0.1:8080/
retry 12 2 compose exec -T score node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

compose --profile dedicated-bot up -d bot
if (( TELEGRAM_ENABLED )); then
  compose --profile telegram up -d telegram-bot
else
  compose --profile telegram stop telegram-bot >/dev/null 2>&1 || true
  compose --profile telegram rm -f telegram-bot >/dev/null 2>&1 || true
fi

sync_caddy_edge
compose ps
printf 'OFELIYA deployed on Cloud.ru at SHA %s (project=%s bot_mode=%s telegram=%s network=%s)\n' \
  "${OFELIYA_RELEASE}" "${COMPOSE_PROJECT}" "${BOT_MODE}" "${TELEGRAM_ENABLED}" "${OFELIYA_SHARED_NETWORK}"
