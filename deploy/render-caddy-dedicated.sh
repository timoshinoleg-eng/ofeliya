#!/usr/bin/env sh
set -eu

host="${1:-}"
fragment="${2:-deploy/Caddyfile.ofeliya}"

case "$host" in
  ""|.*|*.|*[!A-Za-z0-9.-]*)
    echo "invalid Caddy host: $host" >&2
    exit 2
    ;;
esac

[ -f "$fragment" ] || {
  echo "Caddy route fragment not found: $fragment" >&2
  exit 2
}

printf '%s {\n' "$host"
printf '\tredir / /ofeliya/ 308\n'
sed 's/^/\t/' "$fragment"
printf '}\n'

[executed on device: chatgpt-ops-1 (ca22b74b-ed01-4519-b9df-03edbe57a1ba)]