# MetaMask Delegation Framework (ERC-7710)

Contracts in this repo use **Foundry** (`forge build`, `forge test`).

`DCTEnforcer.sol` is a **standalone** contract suitable for direct calls from the Node SDK. To attach the same rules inside MetaMask’s DelegationManager, add the upstream package and a thin caveat wrapper:

```bash
cd contracts
forge install MetaMask/delegation-framework@v1.3.0
# merge remappings from delegation-framework/remappings.txt into foundry.toml
```

Then implement a contract that inherits `CaveatEnforcer` from `lib/delegation-framework`, override `beforeHook`, and `abi.decode` the same `terms` layout you pass from `@metamask/delegation-toolkit`.

This repository ships **DCTRegistry + DCTEnforcer** first; DelegationManager wiring is deployment-specific.
