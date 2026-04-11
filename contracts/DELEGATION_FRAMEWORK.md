# MetaMask Delegation Framework (ERC-7710) integration

`DCTEnforcer.sol` in this repo is a **standalone** contract with the same validation logic as a custom `CaveatEnforcer` in the [Delegation Framework](https://github.com/MetaMask/delegation-framework). The framework is distributed for Foundry (`forge install metamask/delegation-framework@v1.3.0`), not as a stable npm Solidity package.

To wire DCT into DelegationManager on-chain:

1. Add the framework as a git submodule under `contracts/lib/delegation-framework/`.
2. Create `contracts/DCTEnforcerCaveat.sol` that inherits `CaveatEnforcer`, copies the body of `validateActionWithScope` into `beforeHook`, and uses `ModeCode` / `Caveat` types from the framework.
3. Point `terms` encoding at the same `abi.encode` layout your toolkit uses for caveats.

Off-chain, use `@metamask/delegation-toolkit` to build delegations whose caveat payloads match what `DCTEnforcerCaveat` decodes.

This repository ships the **registry + enforcer validation** path first; full Gator/DelegationManager deployment is environment-specific.
