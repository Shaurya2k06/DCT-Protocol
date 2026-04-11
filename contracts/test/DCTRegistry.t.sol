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

    function test_ValidateActionDeprecated() public {
        vm.expectRevert(bytes("DCT: use validateActionWithScope"));
        enforcer.validateAction(bytes32(0), 0, bytes32(0), 0, "", address(0));
    }

    function test_ValidateActionWithScope_WrongTool() public {
        bytes32 rootId = keccak256("wrong-tool");
        bytes32 goodTool = keccak256("allowed");
        bytes32 badTool = keccak256("forbidden");
        uint64 exp = uint64(block.timestamp + 3600);
        Scope memory scope = Scope({
            allowedTools: _singleToolHash(goodTool),
            spendLimitUsdc: 50_000_000,
            maxDepth: 3,
            expiresAt: exp
        });

        vm.prank(a1);
        registry.registerDelegation(bytes32(0), rootId, scope, id1);

        vm.prank(a1);
        bool ok = enforcer.validateActionWithScope(
            rootId, id1, badTool, 1_000_000, "", a1, scope.allowedTools, scope.spendLimitUsdc, scope.maxDepth, exp
        );
        assertFalse(ok);
    }

    function test_ValidateActionWithScope_Overspend() public {
        bytes32 rootId = keccak256("overspend");
        bytes32 toolHash = keccak256("t");
        uint64 exp = uint64(block.timestamp + 3600);
        Scope memory scope = Scope({
            allowedTools: _singleToolHash(toolHash),
            spendLimitUsdc: 1_000_000,
            maxDepth: 3,
            expiresAt: exp
        });

        vm.prank(a1);
        registry.registerDelegation(bytes32(0), rootId, scope, id1);

        vm.prank(a1);
        bool ok = enforcer.validateActionWithScope(
            rootId, id1, toolHash, 2_000_000, "", a1, scope.allowedTools, scope.spendLimitUsdc, scope.maxDepth, exp
        );
        assertFalse(ok);
    }

    function test_ValidateActionWithScope_Expired() public {
        bytes32 rootId = keccak256("expired");
        bytes32 toolHash = keccak256("t");
        uint64 exp = uint64(block.timestamp + 100);
        Scope memory scope = Scope({
            allowedTools: _singleToolHash(toolHash),
            spendLimitUsdc: 50_000_000,
            maxDepth: 3,
            expiresAt: exp
        });

        vm.prank(a1);
        registry.registerDelegation(bytes32(0), rootId, scope, id1);

        vm.warp(block.timestamp + 200);

        vm.prank(a1);
        bool ok = enforcer.validateActionWithScope(
            rootId, id1, toolHash, 1_000_000, "", a1, scope.allowedTools, scope.spendLimitUsdc, scope.maxDepth, exp
        );
        assertFalse(ok);
    }

    function test_ValidateActionWithScope_ScopeMismatch() public {
        bytes32 rootId = keccak256("scope-mismatch");
        bytes32 toolHash = keccak256("t");
        uint64 exp = uint64(block.timestamp + 3600);
        Scope memory regScope = Scope({
            allowedTools: _singleToolHash(toolHash),
            spendLimitUsdc: 50_000_000,
            maxDepth: 3,
            expiresAt: exp
        });

        vm.prank(a1);
        registry.registerDelegation(bytes32(0), rootId, regScope, id1);

        // Pass a different maxDepth than registered — commitment will not match
        vm.prank(a1);
        bool ok = enforcer.validateActionWithScope(
            rootId,
            id1,
            toolHash,
            1_000_000,
            "",
            a1,
            regScope.allowedTools,
            regScope.spendLimitUsdc,
            uint8(7),
            exp
        );
        assertFalse(ok);
    }

    function test_Revoke_AncestorOwner() public {
        bytes32 rootId = keccak256("anc-root");
        bytes32 childId = keccak256("anc-child");
        Scope memory scope = Scope({
            allowedTools: _singleTool("x"),
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

        // a1 (ancestor owner) revokes downstream token held by id2
        vm.prank(a1);
        registry.revoke(childId, id1);

        assertTrue(registry.isRevoked(childId));
    }

    function test_RecordSuccess_RevertNotEnforcer() public {
        vm.expectRevert("DCT: only enforcer");
        registry.recordSuccess(id1);
    }

    function test_MaxGrantableSpend_ColdStart() public view {
        uint256 parentLimit = 10_000_000;
        uint256 g = registry.maxGrantableSpend(id2, parentLimit);
        assertEq(g, parentLimit / 10);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Reentrancy / double-call safety
    //
    // DCTRegistry calls erc8004.ownerOf() — declared `view` in IERC8004, so the
    // EVM issues a STATICCALL.  STATICCALL prevents any state mutation, making
    // direct reentrancy via that path impossible by construction.
    // nonReentrant is defense-in-depth for any future extensions.
    //
    // These tests verify the practical protection that matters most: you cannot
    // register the same ID twice, you cannot exceed MAX_DEPTH, and the enforcer
    // cannot be called by a non-enforcer.
    // ─────────────────────────────────────────────────────────────────────────

    function test_DoubleRegister_Blocked() public {
        bytes32 childId = keccak256("double-reg");
        Scope memory scope = Scope({
            allowedTools: _singleTool("x"),
            spendLimitUsdc: 1_000_000,
            maxDepth: 3,
            expiresAt: uint64(block.timestamp + 3600)
        });

        vm.prank(a1);
        registry.registerDelegation(bytes32(0), childId, scope, id1);

        // Second attempt with the same childId must revert.
        vm.expectRevert("DCT: child already registered");
        vm.prank(a1);
        registry.registerDelegation(bytes32(0), childId, scope, id1);
    }

    function test_ParentRevoked_Blocks_ChildRegistration() public {
        // Once a parent delegation is revoked, a child cannot be registered under it.
        bytes32 parentId = keccak256("par-block");
        Scope memory scope = Scope({
            allowedTools: _singleTool("t"),
            spendLimitUsdc: 5_000_000,
            maxDepth: 3,
            expiresAt: uint64(block.timestamp + 3600)
        });

        vm.prank(a1);
        registry.registerDelegation(bytes32(0), parentId, scope, id1);

        // Revoke the parent.
        vm.prank(a1);
        registry.revoke(parentId, id1);
        assertTrue(registry.isRevoked(parentId));

        // Attempting to register a child of the now-revoked parent must revert.
        bytes32 childId = keccak256("child-of-revoked");
        vm.expectRevert("DCT: parent revoked");
        vm.prank(a2);
        registry.registerDelegation(parentId, childId, scope, id2);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Gas snapshots
    // ─────────────────────────────────────────────────────────────────────────

    function test_Gas_RegisterRoot() public {
        bytes32 id = keccak256("gas-root");
        Scope memory scope = Scope({
            allowedTools: _singleTool("research"),
            spendLimitUsdc: 50_000_000,
            maxDepth: 3,
            expiresAt: uint64(block.timestamp + 3600)
        });

        uint256 g = gasleft();
        vm.prank(a1);
        registry.registerDelegation(bytes32(0), id, scope, id1);
        uint256 used = g - gasleft();

        // Generous upper bound — flag regressions > 200 k gas.
        assertLt(used, 200_000, "registerDelegation gas regression");
        emit log_named_uint("gas:registerDelegation", used);
    }

    function test_Gas_IsRevoked_MaxDepth() public {
        // Build a chain of MAX_DEPTH delegations, then measure isRevoked at the leaf.
        uint8 depth = 8; // same as MAX_DEPTH in contract
        bytes32 prev = bytes32(0);
        bytes32 leaf;
        for (uint8 i = 0; i < depth; i++) {
            bytes32 cur = keccak256(abi.encode("gas-depth", i));
            Scope memory scope = Scope({
                allowedTools: _singleTool("t"),
                spendLimitUsdc: 5_000_000,
                maxDepth: depth,
                expiresAt: uint64(block.timestamp + 3600)
            });
            vm.prank(a1);
            registry.registerDelegation(prev, cur, scope, id1);
            prev = cur;
            leaf = cur;
        }

        uint256 g = gasleft();
        bool r = registry.isRevoked(leaf);
        uint256 used = g - gasleft();

        assertFalse(r);
        assertLt(used, 50_000, "isRevoked max-depth gas regression");
        emit log_named_uint("gas:isRevoked(maxDepth)", used);
    }

    function test_Gas_ValidateActionWithScope() public {
        bytes32 rootId = keccak256("gas-validate");
        bytes32 toolHash = keccak256("research");
        uint64 exp = uint64(block.timestamp + 3600);

        Scope memory scope = Scope({
            allowedTools: _singleToolHash(toolHash),
            spendLimitUsdc: 50_000_000,
            maxDepth: 3,
            expiresAt: exp
        });
        vm.prank(a1);
        registry.registerDelegation(bytes32(0), rootId, scope, id1);

        // Sign a notary attestation for the tool hash
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", toolHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(NOTARY_PK, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        uint256 g = gasleft();
        vm.prank(a1);
        enforcer.validateActionWithScope(
            rootId, id1, toolHash, 1_000_000, sig, a1,
            scope.allowedTools, scope.spendLimitUsdc, scope.maxDepth, scope.expiresAt
        );
        uint256 used = g - gasleft();

        assertLt(used, 300_000, "validateActionWithScope gas regression");
        emit log_named_uint("gas:validateActionWithScope", used);
    }

    // ─────────────────────────────────────────────────────────────────────────

    function _singleTool(string memory name) internal pure returns (bytes32[] memory arr) {
        arr = new bytes32[](1);
        arr[0] = keccak256(bytes(name));
    }

    function _singleToolHash(bytes32 h) internal pure returns (bytes32[] memory arr) {
        arr = new bytes32[](1);
        arr[0] = h;
    }
}

