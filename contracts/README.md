# DCT Protocol contracts (Foundry)

**Local Anvil workflow (Step 2 / Step 3):** see [`../docs/LOCAL_DEV.md`](../docs/LOCAL_DEV.md).

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

### Base Sepolia (84532) — testnet only

Set `PRIVATE_KEY` (uint256 hex). Defaults `ERC8004_IDENTITY_REGISTRY` to the [canonical Base Sepolia ERC-8004 registry](https://8004.org) unless you override it.

```bash
export PRIVATE_KEY=...
export ALCHEMY_API_KEY=...   # or set BASE_SEPOLIA_RPC_URL to any Base Sepolia JSON-RPC
./scripts/deploy-base-sepolia.sh
```

Optional: `NOTARY_SIGNER_ADDRESS` (defaults to deployer).

**Private key:** Forge expects `PRIVATE_KEY` with a `0x` prefix (the deploy script normalizes this if yours omits it).

After a successful broadcast, sync app address files (reads `broadcast/DeployDCT.s.sol/84532/run-latest.json`):

```bash
node scripts/sync-addresses-from-broadcast.mjs --chain 84532 --erc8004 0x8004A818BFB912233c491871b3d84c89A494BD9e
```

Then set server `RPC_URL` or `ALCHEMY_API_KEY` to Base Sepolia and optional contract overrides (`DCT_REGISTRY_ADDRESS`, etc.) — see `server/.env.example`.

Committed templates: `server/addresses.base-sepolia.json` and `client/src/addresses.base-sepolia.json` (official ERC-8004 only; fill DCT proxies after deploy or use env overrides).

**End-to-end demo (new wallet → ERC-8004 → Biscuit → registry → enforcer → revoke + Postgres audit):** from repo root, `./scripts/demo-onchain.sh` (loads `server/.env`). Or `cd server && npm run demo:onchain`.

### Local Anvil

```bash
anvil
export PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
export DEPLOY_LOCAL_IDENTITY_REGISTRY=true
forge script script/DeployDCT.s.sol:DeployDCT --rpc-url http://127.0.0.1:8545 --broadcast
node scripts/sync-addresses-from-broadcast.mjs --chain 31337
```

Use **proxy addresses** from logs or the sync script (not implementation addresses). For a second network, set `ADDRESSES_FILE` and matching `RPC_URL`.

### Upgrade DCTEnforcer (UUPS)

After pulling a new `DCTEnforcer` implementation (e.g. `validateAction` deprecated), upgrade the **proxy** (owner = deployer wallet):

```bash
export PRIVATE_KEY=0x...   # same owner that deployed
export DCT_ENFORCER_PROXY=0x256a633fa2c990a64ec4adf79685f59490a241f8   # from addresses.json
# RPC: same as deploy
./scripts/upgrade-dct-enforcer-base-sepolia.sh
```

Or manually:

```bash
forge script script/UpgradeDCTEnforcer.s.sol:UpgradeDCTEnforcer \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --broadcast
```

Other upgrades (owner only): same pattern — deploy new implementation, `upgradeToAndCall` on the proxy; see `script/UpgradeNotaryVerifier.s.sol`.

## MetaMask Delegation Framework

See [DELEGATION_FRAMEWORK.md](./DELEGATION_FRAMEWORK.md). After `DCTRegistry` is deployed, deploy **`DCTCaveatEnforcer`** (checks `isRevoked` in `beforeHook`):

```bash
export DCT_REGISTRY_ADDRESS=<DCTRegistry proxy>
npm run deploy:caveat
```

Then set `DCT_CAVEAT_ENFORCER_ADDRESS` or add the address to `server/addresses.json`. The API exposes **`GET /api/integrations/delegation-framework`** and **`POST /api/aa/execute-scope`** (ERC-4337 + Pimlico).
