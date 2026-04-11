# MetaMask Delegation Framework (ERC-7710)

Contracts in this repo use **Foundry** (`forge build`, `forge test`).

## Two execution paths

| Path | What runs | When to use |
|------|-----------|-------------|
| **Direct DCT** | `DCTEnforcer.validateAction` / `validateActionWithScope` (Node SDK, EOA signer) | Default: Biscuit → server → enforcer tx |
| **ERC-7710 caveats** | `DCTCaveatEnforcer` extends MetaMask `CaveatEnforcer` | DelegationManager redemption: `beforeHook` checks `DCTRegistry.isRevoked` for `terms = abi.encode(bytes32 revocationId)` |
| **ERC-4337** | `POST /api/aa/execute-scope` (Pimlico bundler + paymaster) | Gas sponsorship; owner still signs the UserOp |

`DCTEnforcer.sol` is **not** a `CaveatEnforcer` subclass — it is the on-chain validation engine. **`DCTCaveatEnforcer.sol`** is the adapter for MetaMask’s delegation pipeline.

## Deploy `DCTCaveatEnforcer` (after `DCTRegistry` is known)

```bash
export PRIVATE_KEY=0x...
export DCT_REGISTRY_ADDRESS=<DCTRegistry proxy from DeployDCT>
forge script script/DeployDCTCaveat.s.sol:DeployDCTCaveat --rpc-url "$BASE_SEPOLIA_RPC_URL" --broadcast
node scripts/export-abis.mjs
```

Set `DCT_CAVEAT_ENFORCER_ADDRESS` or add `DCTCaveatEnforcer` to `server/addresses.json`. Optional: `DELEGATION_MANAGER_ADDRESS` for your chain’s `DelegationManager` (see MetaMask docs / `lib/delegation-framework` broadcasts).

## Installed dependency

`lib/delegation-framework` (v1.3.x) with remappings in `remappings.txt`.

```bash
cd contracts
forge install MetaMask/delegation-framework@v1.3.0
```

## App integration

- **GET** `http://localhost:3000/api/integrations/delegation-framework` — EntryPoint v0.7, optional DelegationManager / caveat addresses, Pimlico status.
- **POST** `/api/aa/execute-scope` — Biscuit authorize + UserOp to `DCTEnforcer` (requires `PIMLICO_API_KEY`; ERC-8004 NFT must be held by the **smart account** address returned in the response).

Full DelegationManager **redeem** flows belong in a wallet / `@metamask/delegation-toolkit` client; this repo exposes addresses and the DCT caveat contract for hook registration.
