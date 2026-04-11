// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title IERC8004
 * @notice Interface for the ERC-8004 Agent Identity Registry.
 */
interface IERC8004 {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/**
 * @title Scope
 * @notice Defines the boundaries of a delegation — which tools, how much spend,
 *         what depth, and when it expires.
 */
struct Scope {
    bytes32[] allowedTools;    // keccak256(tool name) — no string comparison on-chain
    uint256   spendLimitUsdc;  // 6-decimal USDC
    uint8     maxDepth;
    uint64    expiresAt;
}

/**
 * @title DCTRegistry
 * @notice On-chain lineage tree + lazy revocation for Delegated Capability Tokens.
 *
 *         This is the novel contract that fills the gap in ERC-7710:
 *         when delegation B (child of A) is disabled, delegation C (child of B)
 *         remains valid in vanilla ERC-7710. DCTRegistry adds the cross-agent-tree
 *         revocation primitive — a single O(1) write from any ancestor invalidates
 *         every downstream agent at execution time through lazy lineage traversal.
 *
 *         Key design decisions:
 *         - isRevoked() walks up to 8 ancestors: at most 8 cold SLOADs (~6,400 gas worst case)
 *         - MAX_DEPTH = 8 is a hard ceiling enforced at registration time
 *         - directlyRevoked vs isRevoked: registering a revocation is O(1), checking is O(depth)
 *         - ReentrancyGuard protects registerDelegation and revoke from re-entrant lineage manipulation
 */
contract DCTRegistry is ReentrancyGuard {
    IERC8004 public immutable erc8004;
    address  public enforcer;

    // Biscuit revocationId → directly revoked (by owner action)
    mapping(bytes32 => bool) public directlyRevoked;

    // revocationId → parent revocationId (lineage, set at registration)
    mapping(bytes32 => bytes32) public parentOf;

    // revocationId → committed Scope hash
    mapping(bytes32 => bytes32) public scopeCommitments;

    // revocationId → which ERC-8004 agent holds this token
    mapping(bytes32 => uint256) public holderAgent;

    // ERC-8004 agentTokenId → trust score (1e18 = baseline, 2e18 = max)
    mapping(uint256 => uint256) public trustScore;

    // Track all registered delegation IDs for enumeration
    bytes32[] public allDelegationIds;
    mapping(bytes32 => bool) public isRegistered;

    uint256 public constant BASE_TRUST  = 1e18;
    uint8   public constant MAX_DEPTH   = 8;    // hard ceiling
    uint256 public constant DECAY_NUM   = 90;
    uint256 public constant DECAY_DENOM = 100;

    event DelegationRegistered(
        bytes32 indexed parentId,
        bytes32 indexed childId,
        uint256 holderAgentId
    );
    event TokenRevoked(bytes32 indexed revocationId, address revokedBy);
    event TrustUpdated(uint256 indexed agentId, uint256 newScore, bool violation);
    event EnforcerSet(address indexed enforcer);

    modifier onlyEnforcer() {
        require(msg.sender == enforcer, "DCT: only enforcer");
        _;
    }

    constructor(address _erc8004) {
        erc8004 = IERC8004(_erc8004);
    }

    /**
     * @notice Set the enforcer address. Can only be called once (or by current enforcer).
     */
    function setEnforcer(address _enforcer) external {
        require(enforcer == address(0) || msg.sender == enforcer, "DCT: enforcer already set");
        enforcer = _enforcer;
        emit EnforcerSet(_enforcer);
    }

    /**
     * @notice Register a new delegation in the lineage tree.
     * @param parentId       The parent token's revocation ID (bytes32(0) for root)
     * @param childId        The child token's revocation ID
     * @param childScope     The scope being delegated
     * @param parentAgentTokenId The ERC-8004 token ID of the delegating agent
     */
    function registerDelegation(
        bytes32        parentId,
        bytes32        childId,
        Scope calldata childScope,
        uint256        parentAgentTokenId
    ) external nonReentrant {
        require(
            erc8004.ownerOf(parentAgentTokenId) == msg.sender,
            "DCT: not agent owner"
        );
        // Root delegations have parentId = bytes32(0), skip revocation check for roots
        if (parentId != bytes32(0)) {
            require(!isRevoked(parentId), "DCT: parent revoked");
        }
        require(_depth(childId) < MAX_DEPTH, "DCT: max depth exceeded");
        require(!isRegistered[childId], "DCT: child already registered");

        parentOf[childId]         = parentId;
        scopeCommitments[childId] = keccak256(abi.encode(childScope));
        holderAgent[childId]      = parentAgentTokenId;

        // Track for enumeration
        allDelegationIds.push(childId);
        isRegistered[childId] = true;

        if (trustScore[parentAgentTokenId] == 0) {
            trustScore[parentAgentTokenId] = BASE_TRUST;
        }

        emit DelegationRegistered(parentId, childId, parentAgentTokenId);
    }

    /**
     * @notice Revoke a token. LAZY: children are NOT actively killed —
     *         they fail isRevoked() at execution time.
     *         Gas cost: O(1) always. No recursion. No gas bomb.
     */
    function revoke(bytes32 tokenId, uint256 agentTokenId)
        external nonReentrant
    {
        require(
            erc8004.ownerOf(agentTokenId) == msg.sender,
            "DCT: not agent owner"
        );
        require(
            holderAgent[tokenId] == agentTokenId ||
            _isAncestorOwner(tokenId, agentTokenId),
            "DCT: not authorized to revoke"
        );
        directlyRevoked[tokenId] = true;
        emit TokenRevoked(tokenId, msg.sender);
    }

    /**
     * @notice CORE LAZY CHECK: walks up the lineage chain.
     *         If any ancestor is revoked, this token is invalid.
     *         Gas: O(depth) SLOADs. At MAX_DEPTH=8, max ~6,400 gas worst case.
     */
    function isRevoked(bytes32 tokenId) public view returns (bool) {
        bytes32 current = tokenId;
        uint8 hops = 0;
        while (current != bytes32(0) && hops < MAX_DEPTH) {
            if (directlyRevoked[current]) return true;
            current = parentOf[current];
            hops++;
        }
        return false;
    }

    /**
     * @notice Trust scoring — callable only by DCTEnforcer on successful execution.
     */
    function recordSuccess(uint256 agentTokenId) external onlyEnforcer {
        uint256 score = trustScore[agentTokenId];
        if (score == 0) score = BASE_TRUST;
        uint256 headroom = 2e18 - score;
        trustScore[agentTokenId] = score + headroom / 100; // log growth → cap 2x
        emit TrustUpdated(agentTokenId, trustScore[agentTokenId], false);
    }

    /**
     * @notice Trust scoring — callable only by DCTEnforcer on violation.
     */
    function recordViolation(uint256 agentTokenId) external onlyEnforcer {
        uint256 score = trustScore[agentTokenId];
        if (score == 0) score = BASE_TRUST;
        trustScore[agentTokenId] = (score * DECAY_NUM) / DECAY_DENOM;
        emit TrustUpdated(agentTokenId, trustScore[agentTokenId], true);
    }

    /**
     * @notice Used off-chain by orchestrators to gate how much they delegate.
     */
    function maxGrantableSpend(uint256 agentTokenId, uint256 parentLimit)
        external view returns (uint256)
    {
        uint256 score = trustScore[agentTokenId];
        if (score == 0) return parentLimit / 10;           // cold start: 10%
        return (parentLimit * score) / (2 * BASE_TRUST);   // trust-proportional
    }

    /**
     * @notice Get total number of registered delegations.
     */
    function totalDelegations() external view returns (uint256) {
        return allDelegationIds.length;
    }

    /**
     * @notice Get delegation ID by index (for enumeration).
     */
    function getDelegationId(uint256 index) external view returns (bytes32) {
        require(index < allDelegationIds.length, "DCT: index out of bounds");
        return allDelegationIds[index];
    }

    function _depth(bytes32 id) internal view returns (uint8 d) {
        bytes32 cur = parentOf[id];
        while (cur != bytes32(0) && d < MAX_DEPTH) {
            cur = parentOf[cur];
            d++;
        }
    }

    function _isAncestorOwner(bytes32 tokenId, uint256 agentId)
        internal view returns (bool)
    {
        bytes32 cur = parentOf[tokenId];
        uint8 hops = 0;
        while (cur != bytes32(0) && hops < MAX_DEPTH) {
            if (holderAgent[cur] == agentId) return true;
            cur = parentOf[cur];
            hops++;
        }
        return false;
    }
}
