// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title NotaryAttestationVerifier
 * @notice Cryptographic verification (not a stub): recovers signer from a 65-byte ECDSA
 *         signature over digest = keccak256(abi.encodePacked("DCT_TLSN", expectedEndpointHash)).
 *         The SDK must produce the same digest and sign with `notarySigner`'s private key
 *         (e.g. TLSNotary notary key or your delegated attestation service).
 */
contract NotaryAttestationVerifier {
    using ECDSA for bytes32;

    address public immutable notarySigner;

    constructor(address _notarySigner) {
        require(_notarySigner != address(0), "DCT: zero notary");
        notarySigner = _notarySigner;
    }

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
}
