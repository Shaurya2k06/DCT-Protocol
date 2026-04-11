#!/usr/bin/env bash
# Upgrade DCTEnforcer UUPS proxy on Base Sepolia (chain 84532).
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -n "${PRIVATE_KEY:-}" && "${PRIVATE_KEY}" != 0x* ]]; then
  export PRIVATE_KEY="0x${PRIVATE_KEY#0x}"
fi

RPC="${BASE_SEPOLIA_RPC_URL:-}"
if [[ -z "${RPC}" ]]; then
  if [[ -z "${ALCHEMY_API_KEY:-}" ]]; then
    echo "Set BASE_SEPOLIA_RPC_URL or ALCHEMY_API_KEY" >&2
    exit 1
  fi
  RPC="https://base-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}"
fi

if [[ -z "${DCT_ENFORCER_PROXY:-}" ]]; then
  echo "Set DCT_ENFORCER_PROXY to the DCTEnforcer proxy (e.g. from addresses.json)" >&2
  exit 1
fi

echo "RPC: ${RPC%%\?*}…"
echo "DCT_ENFORCER_PROXY=$DCT_ENFORCER_PROXY"
forge script script/UpgradeDCTEnforcer.s.sol:UpgradeDCTEnforcer --rpc-url "$RPC" --broadcast "$@"
