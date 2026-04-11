# MetaMask Delegation Framework (ERC-7710)

Contracts in this repo use **Foundry** (`forge build`, `forge test`).

`DCTEnforcer.sol` is a **standalone** contract suitable for direct calls from the Node SDK.

**Installed:** `lib/delegation-framework` (v1.3.x) with remappings merged in `remappings.txt` (DCT contracts keep using `lib/openzeppelin-contracts`).

**Stub adapter:** `src/integrations/DCTCaveatEnforcer.sol` inherits MetaMask’s `CaveatEnforcer`. Extend it with `beforeHook` / `afterHook` and `abi.decode` the same `terms` layout you pass from the delegation toolkit.

```bash
cd contracts
forge install MetaMask/delegation-framework@v1.3.0
```

This repository ships **DCTRegistry + DCTEnforcer** first; full DelegationManager wiring is deployment-specific.
