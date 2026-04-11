// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/**
 * @title IDCTRegistry
 * @notice Interface for the DCTRegistry contract.
 */
interface IDCTRegistry {
    function isRevoked(bytes32 tokenId) external view returns (bool);
    function scopeCommitments(bytes32 tokenId) external view returns (bytes32);
    function recordSuccess(uint256 agentTokenId) external;
    function recordViolation(uint256 agentTokenId) external;
}

/**
 * @title IERC8004Identity
 * @notice Interface for ERC-8004 ownerOf lookup.
 */
interface IERC8004Identity {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/**
 * @title ITLSNVerifierEnforcer
 * @notice Interface for TLSNotary on-chain verifier.
 */
interface ITLSNVerifierEnforcer {
    function verify(
        bytes calldata attestation,
        bytes32 expectedEndpointHash
    ) external view returns (bool);
}

/**
 * @title Scope (local copy for decoding)
 */
struct EnforcerScope {
    bytes32[] allowedTools;
    uint256   spendLimitUsdc;
    uint8     maxDepth;
    uint64    expiresAt;
}

/**
 * @title DCTEnforcer
 * @notice UUPS-upgradeable caveat enforcer for the DCT Protocol (direct calls or future DelegationManager).
 */
contract DCTEnforcer is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    IDCTRegistry          public registry;
    IERC8004Identity      public erc8004;
    ITLSNVerifierEnforcer public tlsnVerifier;

    event ActionValidated(
        bytes32 indexed revocationId,
        uint256 indexed agentTokenId,
        bytes32 toolHash,
        uint256 spendAmount
    );
    event ActionRejected(
        bytes32 indexed revocationId,
        uint256 indexed agentTokenId,
        string reason
    );

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _registry,
        address _erc8004,
        address _tlsnVerifier,
        address initialOwner
    ) external initializer {
        __Ownable_init(initialOwner);
        __UUPSUpgradeable_init();
        registry     = IDCTRegistry(_registry);
        erc8004      = IERC8004Identity(_erc8004);
        tlsnVerifier = ITLSNVerifierEnforcer(_tlsnVerifier);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    function validateAction(
        bytes32 revocationId,
        uint256 agentTokenId,
        bytes32 toolHash,
        uint256 spendAmount,
        bytes calldata tlsnAttestation,
        address redeemer
    ) external returns (bool) {
        if (registry.isRevoked(revocationId)) {
            emit ActionRejected(revocationId, agentTokenId, "DCT: token revoked");
            registry.recordViolation(agentTokenId);
            return false;
        }

        if (erc8004.ownerOf(agentTokenId) != redeemer) {
            emit ActionRejected(revocationId, agentTokenId, "DCT: wrong agent");
            return false;
        }

        bytes32 committed = registry.scopeCommitments(revocationId);
        if (committed == bytes32(0)) {
            emit ActionRejected(revocationId, agentTokenId, "DCT: unknown token");
            return false;
        }

        if (tlsnAttestation.length > 0) {
            if (!tlsnVerifier.verify(tlsnAttestation, toolHash)) {
                emit ActionRejected(revocationId, agentTokenId, "DCT: invalid TLS attestation");
                registry.recordViolation(agentTokenId);
                return false;
            }
        }

        registry.recordSuccess(agentTokenId);
        emit ActionValidated(revocationId, agentTokenId, toolHash, spendAmount);
        return true;
    }

    function validateActionWithScope(
        bytes32 revocationId,
        uint256 agentTokenId,
        bytes32 toolHash,
        uint256 spendAmount,
        bytes calldata tlsnAttestation,
        address redeemer,
        bytes32[] calldata allowedTools,
        uint256 spendLimitUsdc,
        uint8 maxDepth,
        uint64 expiresAt
    ) external returns (bool) {
        if (registry.isRevoked(revocationId)) {
            emit ActionRejected(revocationId, agentTokenId, "DCT: token revoked");
            registry.recordViolation(agentTokenId);
            return false;
        }

        if (erc8004.ownerOf(agentTokenId) != redeemer) {
            emit ActionRejected(revocationId, agentTokenId, "DCT: wrong agent");
            return false;
        }

        bytes32 committed = registry.scopeCommitments(revocationId);
        if (committed == bytes32(0)) {
            emit ActionRejected(revocationId, agentTokenId, "DCT: unknown token");
            return false;
        }

        EnforcerScope memory scope = EnforcerScope({
            allowedTools: allowedTools,
            spendLimitUsdc: spendLimitUsdc,
            maxDepth: maxDepth,
            expiresAt: expiresAt
        });

        bytes32 computedHash = keccak256(abi.encode(scope));
        if (computedHash != committed) {
            emit ActionRejected(revocationId, agentTokenId, "DCT: scope mismatch");
            registry.recordViolation(agentTokenId);
            return false;
        }

        bool toolAllowed = false;
        for (uint256 i = 0; i < allowedTools.length; i++) {
            if (allowedTools[i] == toolHash) {
                toolAllowed = true;
                break;
            }
        }
        if (!toolAllowed) {
            emit ActionRejected(revocationId, agentTokenId, "DCT: tool not allowed");
            registry.recordViolation(agentTokenId);
            return false;
        }

        if (spendAmount > spendLimitUsdc) {
            emit ActionRejected(revocationId, agentTokenId, "DCT: spend exceeds limit");
            registry.recordViolation(agentTokenId);
            return false;
        }

        if (block.timestamp > expiresAt) {
            emit ActionRejected(revocationId, agentTokenId, "DCT: token expired");
            registry.recordViolation(agentTokenId);
            return false;
        }

        if (tlsnAttestation.length > 0) {
            if (!tlsnVerifier.verify(tlsnAttestation, toolHash)) {
                emit ActionRejected(revocationId, agentTokenId, "DCT: invalid TLS attestation");
                registry.recordViolation(agentTokenId);
                return false;
            }
        }

        registry.recordSuccess(agentTokenId);
        emit ActionValidated(revocationId, agentTokenId, toolHash, spendAmount);
        return true;
    }

    uint256[50] private __gap;
}
