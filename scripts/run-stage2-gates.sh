#!/usr/bin/env bash
# Runs the OFELIYA gate suite and records the exit code of every gate.
#
# The repository already has the canonical gate list in `.github/workflows/ci.yml` and the
# npm scripts in `package.json`. This runner is the local convenience: one command, one
# log, one summary line per gate.
#
#   bash scripts/run-stage2-gates.sh              # run every gate
#   GATE_LOG=/tmp/gates.log bash scripts/run-stage2-gates.sh
#
# The log path can be overridden with GATE_LOG. It defaults to a file in the system
# temporary directory, so the script never writes into the repository.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}" || exit 1

LOG="${GATE_LOG:-${TMPDIR:-/tmp}/ofeliya-gates-$(date -u +%Y%m%dT%H%M%SZ).log}"
: > "${LOG}" || exit 1

GATES=(
  "typecheck|npx tsc --noEmit"
  "test:quest-core|npm run test:quest-core"
  "test:quest-core-mutations|npm run test:quest-core-mutations"
  "test:save|npm run test:save"
  "test:challenge|npm run test:challenge"
  "test:duel|npm run test:duel"
  "test:viewport|npm run test:viewport"
  "test:b2b4-fixes|npm run test:b2b4-fixes"
  "test:daily-v2|npm run test:daily-v2"
  "test:daily-history|npm run test:daily-history"
  "test:streaks|npm run test:streaks"
  "test:run-identity|npm run test:run-identity"
  "test:impact-budget|npm run test:impact-budget"
  "test:runtime-quality|npm run test:runtime-quality"
  "test:telegraphs|npm run test:telegraphs"
  "test:presentation|npm run test:presentation"
  "test:language|npm run test:language"
  "test:tokens|npm run test:tokens"
  "server:test|npm run server:test"
  "test:server-policy|npm run test:server-policy"
  "build|npm run build"
  "test:bundle-shape|npm run test:bundle-shape"
)

PASS=0
FAIL=0
for gate in "${GATES[@]}"; do
  name="${gate%%|*}"
  cmd="${gate#*|}"
  echo "=== ${name} ===" >> "${LOG}"
  if [ "${name}" = "build" ]; then
    VITE_RELEASE_SHA="$(git rev-parse HEAD)" timeout 900 bash -c "${cmd}" >> "${LOG}" 2>&1
  else
    timeout 900 bash -c "${cmd}" >> "${LOG}" 2>&1
  fi
  code=$?
  if [ ${code} -eq 0 ]; then
    echo "RESULT ${name} PASS" >> "${LOG}"
    PASS=$((PASS + 1))
  else
    echo "RESULT ${name} FAIL exit=${code}" >> "${LOG}"
    FAIL=$((FAIL + 1))
  fi
  echo "${name}: $([ ${code} -eq 0 ] && echo PASS || echo FAIL)"
done

echo "GATES_TOTAL=${#GATES[@]} PASS=${PASS} FAIL=${FAIL}"
echo "log: ${LOG}"
[ ${FAIL} -eq 0 ]
