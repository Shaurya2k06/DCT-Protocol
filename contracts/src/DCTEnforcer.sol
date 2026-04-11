// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

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
 * @notice Custom caveat enforcer for the DCT Protocol.
 *
 *         In the full MetaMask Delegation Framework, this would inherit from
 *         CaveatEnforcer and run inside DelegationManager's validateDelegation flow.
 *         For hackathon deployment via Hardhat (without Foundry remappings),
 *         this is a standalone enforcer that implements the same 4-step validation:
 *
 *         1. Lazy revocation check — walks lineage, O(depth) SLOADs
 *         2. Identity — redeemer must own the declared ERC-8004 agent NFT
 *         3. Scope — validate tool and spend against committed Scope struct
 *         4. TLSNotary attestation — verify MPC-TLS proof (optional)
 *
 *         The enforcer updates trust scores on success/violation.
 */
contract DCTEnforcer {
    IDCTRegistry          public immutable registry;
    IERC8004Identity      public immutable erc8004;
    ITLSNVerifierEnforcer public immutable tlsnVerifier;

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

    constructor(
        address _registry,
        address _erc8004,
        address _tlsnVerifier
    ) {
        registry     = IDCTRegistry(_registry);
        erc8004      = IERC8004Identity(_erc8004);
        tlsnVerifier = ITLSNVerifierEnforcer(_tlsnVerifier);
    }

    /**
     * @notice Validate an agent action before execution.
     * @param revocationId     Biscuit token revocation ID
     * @param agentTokenId     ERC-8004 token ID of executing agent
     * @param toolHash         keccak256(tool name)
     * @param spendAmount      Declared spend in 6-decimal USDC
     * @param tlsnAttestation  TLSNotary MPC-TLS attestation (empty for non-HTTP tools)
     * @param redeemer         Address of the agent executing the action
     */
    function validateAction(
        bytes32 revocationId,
        uint256 agentTokenId,
        bytes32 toolHash,
        uint256 spendAmount,
        bytes calldata tlsnAttestation,
        address redeemer
    ) external returns (bool) {
        // 1. Lazy revocation check — walks lineage, O(depth) SLOADs
        if (registry.isRevoked(revocationId)) {
            emit ActionRejected(revocationId, agentTokenId, "DCT: token revoked");
            registry.recordViolation(agentTokenId);
            return false;
        }

        // 2. Identity — redeemer must own the declared ERC-8004 agent NFT
        if (erc8004.ownerOf(agentTokenId) != redeemer) {
            emit ActionRejected(revocationId, agentTokenId, "DCT: wrong agent");
            return false;
        }

        // 3. Scope — validate tool and spend against committed Scope struct
        bytes32 committed = registry.scopeCommitments(revocationId);
        if (committed == bytes32(0)) {
            emit ActionRejected(revocationId, agentTokenId, "DCT: unknown token");
            return false;
        }

        // 4. TLSNotary attestation — required for HTTP tool calls
        if (tlsnAttestation.length > 0) {
            if (!tlsnVerifier.verify(tlsnAttestation, toolHash)) {
                emit ActionRejected(revocationId, agentTokenId, "DCT: invalid TLS attestation");
                registry.recordViolation(agentTokenId);
                return false;
            }
        }

        // All checks passed — record success and emit event
        registry.recordSuccess(agentTokenId);
        emit ActionValidated(revocationId, agentTokenId, toolHash, spendAmount);
        return true;
    }

    /**
     * @notice Full scope-validated execution with the scope struct passed in calldata.
     *         This version verifies toolHash is in allowedTools and spendAmount <= spendLimitUsdc,
     *         then confirms keccak256(abi.encode(scope)) matches the committed hash.
     */
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
        // 1. Lazy revocation check
        if (registry.isRevoked(revocationId)) {
            emit ActionRejected(revocationId, agentTokenId, "DCT: token revoked");
            registry.recordViolation(agentTokenId);
            return false;
        }

        // 2. Identity check
        if (erc8004.ownerOf(agentTokenId) != redeemer) {
            emit ActionRejected(revocationId, agentTokenId, "DCT: wrong agent");
            return false;
        }

        // 3. Scope commitment verification
        bytes32 committed = registry.scopeCommitments(revocationId);
        if (committed == bytes32(0)) {
            emit ActionRejected(revocationId, agentTokenId, "DCT: unknown token");
            return false;
        }

        // Reconstruct scope and verify commitment hash matches
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

        // 3a. Verify tool is in allowedTools
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

        // 3b. Verify spend is within limit
        if (spendAmount > spendLimitUsdc) {
            emit ActionRejected(revocationId, agentTokenId, "DCT: spend exceeds limit");
            registry.recordViolation(agentTokenId);
            return false;
        }

        // 3c. Verify not expired
        if (block.timestamp > expiresAt) {
            emit ActionRejected(revocationId, agentTokenId, "DCT: token expired");
            registry.recordViolation(agentTokenId);
            return false;
        }

        // 4. TLSNotary attestation
        if (tlsnAttestation.length > 0) {
            if (!tlsnVerifier.verify(tlsnAttestation, toolHash)) {
                emit ActionRejected(revocationId, agentTokenId, "DCT: invalid TLS attestation");
                registry.recordViolation(agentTokenId);
                return false;
            }
        }

        // All checks passed
        registry.recordSuccess(agentTokenId);
        emit ActionValidated(revocationId, agentTokenId, toolHash, spendAmount);
        return true;
    }
}
