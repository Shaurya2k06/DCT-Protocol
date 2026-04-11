// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Script.sol";
import "../src/mocks/TestAgentRegistry.sol";
import "../src/DCTRegistry.sol";
import "../src/DCTEnforcer.sol";
import "../src/NotaryAttestationVerifier.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address notarySigner = vm.envAddress("NOTARY_SIGNER");
        vm.startBroadcast(deployerKey);

        TestAgentRegistry erc8004   = new TestAgentRegistry();
        NotaryAttestationVerifier v = new NotaryAttestationVerifier(notarySigner);
        DCTRegistry registry        = new DCTRegistry(address(erc8004));
        DCTEnforcer enforcer        = new DCTEnforcer(
            address(registry),
            address(erc8004),
            address(v)
        );

        // Wire enforcer into registry
        registry.setEnforcer(address(enforcer));

        vm.stopBroadcast();

        // Print addresses for environment variables
        console.log("ERC8004_ADDRESS  =", address(erc8004));
        console.log("VERIFIER_ADDRESS =", address(v));
        console.log("REGISTRY_ADDRESS =", address(registry));
        console.log("ENFORCER_ADDRESS =", address(enforcer));
    }
}
