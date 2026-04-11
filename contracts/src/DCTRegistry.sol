// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

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
    bytes32[] allowedTools;
    uint256   spendLimitUsdc;
    uint8     maxDepth;
    uint64    expiresAt;
}

/**
 * @title DCTRegistry
 * @notice UUPS-upgradeable lineage tree + lazy revocation for Delegated Capability Tokens.
 */
contract DCTRegistry is Initializable, ReentrancyGuardUpgradeable, OwnableUpgradeable, UUPSUpgradeable {
    IERC8004 public erc8004;
    address  public enforcer;

    mapping(bytes32 => bool) public directlyRevoked;
    mapping(bytes32 => bytes32) public parentOf;
    mapping(bytes32 => bytes32) public scopeCommitments;
    mapping(bytes32 => uint256) public holderAgent;
    mapping(uint256 => uint256) public trustScore;

    bytes32[] public allDelegationIds;
    mapping(bytes32 => bool) public isRegistered;

    uint256 public constant BASE_TRUST  = 1e18;
    uint8   public constant MAX_DEPTH   = 8;
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

    constructor() {
        _disableInitializers();
    }

    function initialize(address _erc8004, address initialOwner) external initializer {
        __Ownable_init(initialOwner);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
        erc8004 = IERC8004(_erc8004);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    function setEnforcer(address _enforcer) external {
        require(enforcer == address(0) || msg.sender == enforcer, "DCT: enforcer already set");
        enforcer = _enforcer;
        emit EnforcerSet(_enforcer);
    }

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
        if (parentId != bytes32(0)) {
            require(!isRevoked(parentId), "DCT: parent revoked");
        }
        require(_depth(childId) < MAX_DEPTH, "DCT: max depth exceeded");
        require(!isRegistered[childId], "DCT: child already registered");

        parentOf[childId]         = parentId;
        scopeCommitments[childId] = keccak256(abi.encode(childScope));
        holderAgent[childId]      = parentAgentTokenId;

        allDelegationIds.push(childId);
        isRegistered[childId] = true;

        if (trustScore[parentAgentTokenId] == 0) {
            trustScore[parentAgentTokenId] = BASE_TRUST;
        }

        emit DelegationRegistered(parentId, childId, parentAgentTokenId);
    }

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

    function recordSuccess(uint256 agentTokenId) external onlyEnforcer {
        uint256 score = trustScore[agentTokenId];
        if (score == 0) score = BASE_TRUST;
        uint256 headroom = 2e18 - score;
        trustScore[agentTokenId] = score + headroom / 100;
        emit TrustUpdated(agentTokenId, trustScore[agentTokenId], false);
    }

    function recordViolation(uint256 agentTokenId) external onlyEnforcer {
        uint256 score = trustScore[agentTokenId];
        if (score == 0) score = BASE_TRUST;
        trustScore[agentTokenId] = (score * DECAY_NUM) / DECAY_DENOM;
        emit TrustUpdated(agentTokenId, trustScore[agentTokenId], true);
    }

    function maxGrantableSpend(uint256 agentTokenId, uint256 parentLimit)
        external view returns (uint256)
    {
        uint256 score = trustScore[agentTokenId];
        if (score == 0) return parentLimit / 10;
        return (parentLimit * score) / (2 * BASE_TRUST);
    }

    function totalDelegations() external view returns (uint256) {
        return allDelegationIds.length;
    }

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

    uint256[50] private __gap;
}
