#!/usr/bin/env bash
set -Eeuo pipefail
# External Telegram webhook registration survives code rollback. Never roll out
# code from before the webhook endpoint was introduced; changing transport mode
# requires its own operator migration with Bot API verification.
sha="${1:-}"
webhook_floor="edb1b9a706f019e37a1ef148a55f07faaf2c1f59"
[[ "$sha" =~ ^[0-9a-fA-F]{40}$ ]] || { echo 'Invalid compatibility SHA' >&2; exit 4; }
git cat-file -e "${sha}^{commit}"
if ! git merge-base --is-ancestor "$webhook_floor" "$sha"; then
  echo "Refusing release/rollback: $sha predates Telegram webhook compatibility ($webhook_floor)" >&2
  exit 4
fi
