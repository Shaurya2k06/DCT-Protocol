# DCT Protocol contracts (Foundry)

## Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- Dependencies are vendored under `lib/` (`forge-std`, `openzeppelin-contracts`)

## Commands

```bash
forge build
forge test
node scripts/export-abis.mjs   # copy ABIs → ../client/src/abi and ../server/abi
```

## Deploy (UUPS proxies)

Contracts are **UUPS-upgradeable** (implementations + `ERC1967Proxy`). Upgrade authority is the **deployer** (`Ownable` on each implementation).

Set `PRIVATE_KEY` (uint256 hex). For Base Sepolia production, set `ERC8004_IDENTITY_REGISTRY`. For local test registry, set `DEPLOY_LOCAL_IDENTITY_REGISTRY=true`.

```bash
export PRIVATE_KEY=...
forge script script/DeployDCT.s.sol:DeployDCT --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast
```

Optional: `NOTARY_SIGNER_ADDRESS` (defaults to deployer).

After deploy, use **proxy addresses** from the script logs for `client/src/addresses.json` and `server/addresses.json` (not the implementation addresses). For a second network, copy to `server/addresses.local.json` and set `ADDRESSES_FILE` and `RPC_URL` accordingly.

Upgrades (owner only): call `upgradeToAndCall` on the proxy via the implementation’s `UUPSUpgradeable` interface, or use OpenZeppelin upgrades tooling.

## MetaMask Delegation Framework

See [DELEGATION_FRAMEWORK.md](./DELEGATION_FRAMEWORK.md). This repo ships `DCTEnforcer` for direct validation; wiring a `CaveatEnforcer` subclass for DelegationManager is a follow-up using `forge install MetaMask/delegation-framework`.
