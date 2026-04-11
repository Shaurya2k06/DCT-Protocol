// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Script, console2} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {DCTRegistry} from "../src/DCTRegistry.sol";
import {DCTEnforcer} from "../src/DCTEnforcer.sol";
import {NotaryAttestationVerifier} from "../src/NotaryAttestationVerifier.sol";
import {TestAgentRegistry} from "../src/mocks/TestAgentRegistry.sol";

/// @notice UUPS proxy deployment. Set PRIVATE_KEY in environment.
/// @dev For production: set ERC8004_IDENTITY_REGISTRY. Optional NOTARY_SIGNER_ADDRESS (defaults to deployer).
contract DeployDCT is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPk);
        address notary = vm.envOr("NOTARY_SIGNER_ADDRESS", deployer);

        vm.startBroadcast(deployerPk);

        address erc8004Addr;
        bool local = vm.envOr("DEPLOY_LOCAL_IDENTITY_REGISTRY", false);

        if (local) {
            TestAgentRegistry t = new TestAgentRegistry();
            erc8004Addr = address(t);
            t.register(deployer, "ipfs://deployer-agent");
        } else {
            erc8004Addr = vm.envAddress("ERC8004_IDENTITY_REGISTRY");
        }

        NotaryAttestationVerifier notaryImpl = new NotaryAttestationVerifier();
        ERC1967Proxy notaryProxy = new ERC1967Proxy(
            address(notaryImpl),
            abi.encodeCall(NotaryAttestationVerifier.initialize, (notary, deployer))
        );
        address notaryAddrProxy = address(notaryProxy);

        DCTRegistry regImpl = new DCTRegistry();
        ERC1967Proxy regProxy = new ERC1967Proxy(
            address(regImpl),
            abi.encodeCall(DCTRegistry.initialize, (erc8004Addr, deployer))
        );
        DCTRegistry reg = DCTRegistry(address(regProxy));

        DCTEnforcer enfImpl = new DCTEnforcer();
        ERC1967Proxy enfProxy = new ERC1967Proxy(
            address(enfImpl),
            abi.encodeCall(
                DCTEnforcer.initialize,
                (address(reg), erc8004Addr, notaryAddrProxy, deployer)
            )
        );

        reg.setEnforcer(address(enfProxy));

        vm.stopBroadcast();

        console2.log("ERC8004IdentityRegistry:", erc8004Addr);
        console2.log("NotaryAttestationVerifier (proxy):", notaryAddrProxy);
        console2.log("DCTRegistry (proxy):", address(reg));
        console2.log("DCTEnforcer (proxy):", address(enfProxy));
        console2.log("notarySigner:", notary);
    }
}
