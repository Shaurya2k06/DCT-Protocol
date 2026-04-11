#!/usr/bin/env bash
# Deploy UUPS DCT stack to Base Sepolia only (chain 84532). Requires PRIVATE_KEY and RPC.
set -euo pipefail
cd "$(dirname "$0")/.."

# forge-std vm.envUint expects 0x-prefixed hex
if [[ -n "${PRIVATE_KEY:-}" && "${PRIVATE_KEY}" != 0x* ]]; then
  export PRIVATE_KEY="0x${PRIVATE_KEY#0x}"
fi

export ERC8004_IDENTITY_REGISTRY="${ERC8004_IDENTITY_REGISTRY:-0x8004A818BFB912233c491871b3d84c89A494BD9e}"
unset DEPLOY_LOCAL_IDENTITY_REGISTRY || true

RPC="${BASE_SEPOLIA_RPC_URL:-}"
if [[ -z "${RPC}" ]]; then
  if [[ -z "${ALCHEMY_API_KEY:-}" ]]; then
    echo "Set BASE_SEPOLIA_RPC_URL or ALCHEMY_API_KEY" >&2
    exit 1
  fi
  RPC="https://base-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}"
fi

echo "RPC: ${RPC%%\?*}…"
forge script script/DeployDCT.s.sol:DeployDCT --rpc-url "$RPC" --broadcast "$@"

echo ""
echo "Next: node scripts/sync-addresses-from-broadcast.mjs --chain 84532 --erc8004 ${ERC8004_IDENTITY_REGISTRY}"
