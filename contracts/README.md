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

## Deploy

Set `PRIVATE_KEY` (uint256 hex). For Base Sepolia production, set `ERC8004_IDENTITY_REGISTRY`. For local test registry, set `DEPLOY_LOCAL_IDENTITY_REGISTRY=true`.

```bash
export PRIVATE_KEY=...
forge script script/DeployDCT.s.sol:DeployDCT --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast
```

Optional: `NOTARY_SIGNER_ADDRESS` (defaults to deployer).

After deploy, update `client/src/addresses.json` and `server/addresses.json` from the broadcast output under `broadcast/`.

## MetaMask Delegation Framework

See [DELEGATION_FRAMEWORK.md](./DELEGATION_FRAMEWORK.md). This repo ships `DCTEnforcer` for direct validation; wiring a `CaveatEnforcer` subclass for DelegationManager is a follow-up using `forge install MetaMask/delegation-framework`.
