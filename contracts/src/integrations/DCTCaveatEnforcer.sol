// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import { CaveatEnforcer } from "delegation-framework/enforcers/CaveatEnforcer.sol";

/// @title DCTCaveatEnforcer
/// @notice MetaMask DelegationManager caveat adapter — extend with `beforeHook` / `afterHook` and decode
///         `terms` to match the delegation-toolkit layout alongside on-chain DCTEnforcer rules.
/// @dev Empty subclass compiles against MetaMask delegation-framework v1.3.x; wire hooks when integrating DelegationManager.
contract DCTCaveatEnforcer is CaveatEnforcer {}
