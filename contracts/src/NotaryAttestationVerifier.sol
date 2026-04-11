// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title NotaryAttestationVerifier
 * @notice UUPS-upgradeable. Recovers signer from a 65-byte ECDSA signature over
 *         digest = keccak256(abi.encodePacked("DCT_TLSN", expectedEndpointHash)).
 */
contract NotaryAttestationVerifier is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    using ECDSA for bytes32;

    address public notarySigner;

    constructor() {
        _disableInitializers();
    }

    function initialize(address _notarySigner, address initialOwner) external initializer {
        __Ownable_init(initialOwner);
        __UUPSUpgradeable_init();
        require(_notarySigner != address(0), "DCT: zero notary");
        notarySigner = _notarySigner;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    function verify(bytes calldata attestation, bytes32 expectedEndpointHash)
        external
        view
        returns (bool)
    {
        if (attestation.length != 65) return false;
        bytes32 digest = keccak256(abi.encodePacked("DCT_TLSN", expectedEndpointHash));
        address recovered = digest.recover(attestation);
        return recovered == notarySigner;
    }

    uint256[50] private __gap;
}
