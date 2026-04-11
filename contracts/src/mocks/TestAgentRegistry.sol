// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";

/**
 * @title TestAgentRegistry
 * @notice Local / test-only minimal ERC-721 (e.g. Anvil). Production uses the
 *         canonical ERC-8004 Identity Registry on Base (see deploy script & addresses).
 */
contract TestAgentRegistry is ERC721, ERC721URIStorage {
    uint256 private _nextTokenId;

    mapping(uint256 => string) public agentURI;

    event AgentRegistered(uint256 indexed agentId, address indexed owner, string uri);

    constructor() ERC721("ERC8004 Test Agent", "AGENT") {}

    function register(address to, string calldata uri) external returns (uint256) {
        uint256 agentId = _nextTokenId++;
        _safeMint(to, agentId);
        _setTokenURI(agentId, uri);
        agentURI[agentId] = uri;
        emit AgentRegistered(agentId, to, uri);
        return agentId;
    }

    function totalAgents() external view returns (uint256) {
        return _nextTokenId;
    }

    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
