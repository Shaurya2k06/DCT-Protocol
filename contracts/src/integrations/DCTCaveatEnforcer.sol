// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import { CaveatEnforcer } from "delegation-framework/enforcers/CaveatEnforcer.sol";
import { ModeCode } from "delegation-framework/utils/Types.sol";

/// @dev Minimal registry surface for caveat checks (DelegationManager redemption path).
interface IDCTRegistryCaveat {
    function isRevoked(bytes32 tokenId) external view returns (bool);
}

/// @title DCTCaveatEnforcer
/// @notice ERC-7710 `CaveatEnforcer` wired to `DCTRegistry`: `terms` MUST be `abi.encode(bytes32 revocationId)`.
///         Use together with MetaMask `DelegationManager` — this is separate from direct `DCTEnforcer` calls.
/// @dev Pair with `DCTEnforcer` for full validation: caveats gate redemption; enforcer validates execution scope.
contract DCTCaveatEnforcer is CaveatEnforcer {
    IDCTRegistryCaveat public immutable dctRegistry;

    constructor(address _dctRegistry) {
        require(_dctRegistry != address(0), "DCT: zero registry");
        dctRegistry = IDCTRegistryCaveat(_dctRegistry);
    }

    /// @inheritdoc CaveatEnforcer
    function beforeHook(
        bytes calldata terms,
        bytes calldata,
        ModeCode mode,
        bytes calldata,
        bytes32,
        address,
        address
    ) public view override onlySingleCallTypeMode(mode) {
        if (terms.length == 0) return;
        bytes32 revocationId = abi.decode(terms, (bytes32));
        require(!dctRegistry.isRevoked(revocationId), "DCT: caveat revoked");
    }

    /// @inheritdoc CaveatEnforcer
    function afterHook(
        bytes calldata,
        bytes calldata,
        ModeCode mode,
        bytes calldata,
        bytes32,
        address,
        address
    ) public override onlySingleCallTypeMode(mode) {}
}
