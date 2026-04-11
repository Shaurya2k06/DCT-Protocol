// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Script, console2} from "forge-std/Script.sol";
import {DCTRegistry} from "../src/DCTRegistry.sol";
import {DCTEnforcer} from "../src/DCTEnforcer.sol";
import {NotaryAttestationVerifier} from "../src/NotaryAttestationVerifier.sol";
import {TestAgentRegistry} from "../src/mocks/TestAgentRegistry.sol";

/// @notice Broadcast deployment. Set PRIVATE_KEY in environment.
/// @dev For production: set ERC8004_IDENTITY_REGISTRY (no local test registry).
///      Optional NOTARY_SIGNER_ADDRESS (defaults to deployer address).
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

        NotaryAttestationVerifier verifier = new NotaryAttestationVerifier(notary);
        DCTRegistry reg = new DCTRegistry(erc8004Addr);
        DCTEnforcer enf = new DCTEnforcer(address(reg), erc8004Addr, address(verifier));
        reg.setEnforcer(address(enf));

        vm.stopBroadcast();

        console2.log("ERC8004IdentityRegistry:", erc8004Addr);
        console2.log("NotaryAttestationVerifier:", address(verifier));
        console2.log("DCTRegistry:", address(reg));
        console2.log("DCTEnforcer:", address(enf));
        console2.log("notarySigner:", notary);
    }
}
