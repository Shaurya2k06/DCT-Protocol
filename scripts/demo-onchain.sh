#!/usr/bin/env bash
# One command from repo root: load server/.env and run full on-chain + DB audit demo (Base Sepolia).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -f "$ROOT/server/.env" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$ROOT/server/.env"
  set +a
fi
cd "$ROOT/server"
exec npm run demo:onchain
