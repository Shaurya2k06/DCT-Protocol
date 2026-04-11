// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {DCTRegistry, Scope} from "../src/DCTRegistry.sol";
import {DCTEnforcer} from "../src/DCTEnforcer.sol";
import {NotaryAttestationVerifier} from "../src/NotaryAttestationVerifier.sol";
import {TestAgentRegistry} from "../src/mocks/TestAgentRegistry.sol";

contract DCTRegistryTest is Test {
    TestAgentRegistry internal erc8004;
    NotaryAttestationVerifier internal tlsn;
    DCTRegistry internal registry;
    DCTEnforcer internal enforcer;

    uint256 internal constant NOTARY_PK =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    address internal notaryAddr;
    address internal a1;
    address internal a2;
    address internal a3;

    uint256 internal id1;
    uint256 internal id2;
    uint256 internal id3;

    function setUp() public {
        notaryAddr = vm.addr(NOTARY_PK);
        a1 = address(0x1);
        a2 = address(0x2);
        a3 = address(0x3);

        erc8004 = new TestAgentRegistry();

        NotaryAttestationVerifier notaryImpl = new NotaryAttestationVerifier();
        tlsn = NotaryAttestationVerifier(
            address(
                new ERC1967Proxy(
                    address(notaryImpl),
                    abi.encodeCall(NotaryAttestationVerifier.initialize, (notaryAddr, address(this)))
                )
            )
        );

        DCTRegistry regImpl = new DCTRegistry();
        registry = DCTRegistry(
            address(
                new ERC1967Proxy(
                    address(regImpl),
                    abi.encodeCall(DCTRegistry.initialize, (address(erc8004), address(this)))
                )
            )
        );

        DCTEnforcer enfImpl = new DCTEnforcer();
        enforcer = DCTEnforcer(
            address(
                new ERC1967Proxy(
                    address(enfImpl),
                    abi.encodeCall(
                        DCTEnforcer.initialize,
                        (address(registry), address(erc8004), address(tlsn), address(this))
                    )
                )
            )
        );

        registry.setEnforcer(address(enforcer));

        vm.prank(a1);
        id1 = erc8004.register(a1, "ipfs://agent1");
        vm.prank(a2);
        id2 = erc8004.register(a2, "ipfs://agent2");
        vm.prank(a3);
        id3 = erc8004.register(a3, "ipfs://agent3");
    }

    function test_RegisterRoot() public {
        bytes32 parentId = bytes32(0);
        bytes32 childId = keccak256("root-token-1");
        Scope memory scope = Scope({
            allowedTools: new bytes32[](1),
            spendLimitUsdc: 50_000_000,
            maxDepth: 3,
            expiresAt: uint64(block.timestamp + 3600)
        });
        scope.allowedTools[0] = keccak256("research");

        vm.prank(a1);
        registry.registerDelegation(parentId, childId, scope, id1);

        assertEq(registry.holderAgent(childId), id1);
        assertEq(registry.parentOf(childId), parentId);
        assertTrue(registry.isRegistered(childId));
    }

    function test_RevertNonOwnerRegister() public {
        bytes32 childId = keccak256("root-token-2");
        Scope memory scope = Scope({
            allowedTools: new bytes32[](0),
            spendLimitUsdc: 10_000_000,
            maxDepth: 2,
            expiresAt: uint64(block.timestamp + 3600)
        });

        vm.prank(a2);
        vm.expectRevert("DCT: not agent owner");
        registry.registerDelegation(bytes32(0), childId, scope, id1);
    }

    function test_LazyRevokeCascade() public {
        bytes32 rootId = keccak256("root");
        bytes32 childId = keccak256("child");
        bytes32 gcId = keccak256("grandchild");

        Scope memory scope = Scope({
            allowedTools: _singleTool("fetch"),
            spendLimitUsdc: 50_000_000,
            maxDepth: 3,
            expiresAt: uint64(block.timestamp + 3600)
        });

        vm.prank(a1);
        registry.registerDelegation(bytes32(0), rootId, scope, id1);

        Scope memory cScope = scope;
        cScope.spendLimitUsdc = 10_000_000;
        vm.prank(a2);
        registry.registerDelegation(rootId, childId, cScope, id2);

        Scope memory gcScope = scope;
        gcScope.spendLimitUsdc = 2_000_000;
        vm.prank(a3);
        registry.registerDelegation(childId, gcId, gcScope, id3);

        assertFalse(registry.isRevoked(rootId));
        assertFalse(registry.isRevoked(childId));
        assertFalse(registry.isRevoked(gcId));

        vm.prank(a1);
        registry.revoke(rootId, id1);

        assertTrue(registry.isRevoked(rootId));
        assertTrue(registry.isRevoked(childId));
        assertTrue(registry.isRevoked(gcId));
    }

    function test_ValidateActionWithScope() public {
        bytes32 rootId = keccak256("scope-ok");
        bytes32 toolHash = keccak256("web_fetch");
        uint64 exp = uint64(block.timestamp + 3600);
        Scope memory scope = Scope({
            allowedTools: _singleToolHash(toolHash),
            spendLimitUsdc: 50_000_000,
            maxDepth: 3,
            expiresAt: exp
        });

        vm.prank(a1);
        registry.registerDelegation(bytes32(0), rootId, scope, id1);

        vm.prank(a1);
        bool ok = enforcer.validateActionWithScope(
            rootId, id1, toolHash, 5_000_000, "", a1, scope.allowedTools, scope.spendLimitUsdc, scope.maxDepth, exp
        );
        assertTrue(ok);
    }

    function test_NotaryVerifier() public view {
        bytes32 toolHash = keccak256("web_fetch");
        bytes32 digest = keccak256(abi.encodePacked("DCT_TLSN", toolHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(NOTARY_PK, digest);
        bytes memory att = abi.encodePacked(r, s, v);
        assertTrue(tlsn.verify(att, toolHash));
    }

    function _singleTool(string memory name) internal pure returns (bytes32[] memory arr) {
        arr = new bytes32[](1);
        arr[0] = keccak256(bytes(name));
    }

    function _singleToolHash(bytes32 h) internal pure returns (bytes32[] memory arr) {
        arr = new bytes32[](1);
        arr[0] = h;
    }
}
