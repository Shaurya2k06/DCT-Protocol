// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Script, console2} from "forge-std/Script.sol";
import {NotaryAttestationVerifier} from "../src/NotaryAttestationVerifier.sol";

/// @notice UUPS upgrade of NotaryAttestationVerifier to add proofCommitments + verifyAndCommit.
/// @dev Run after contracts/src/NotaryAttestationVerifier.sol has been updated.
///
///   forge script script/UpgradeNotaryVerifier.s.sol:UpgradeNotaryVerifier \
///     --rpc-url $RPC_URL --broadcast
///
/// Requires PRIVATE_KEY (must be the proxy owner) and NOTARY_VERIFIER_PROXY in env.
contract UpgradeNotaryVerifier is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address proxy = vm.envAddress("NOTARY_VERIFIER_PROXY");

        vm.startBroadcast(deployerPk);

        // Deploy new implementation
        NotaryAttestationVerifier newImpl = new NotaryAttestationVerifier();

        // UUPS upgrade — calls upgradeToAndCall on the proxy
        NotaryAttestationVerifier(proxy).upgradeToAndCall(address(newImpl), "");

        vm.stopBroadcast();

        console2.log("NotaryAttestationVerifier upgraded");
        console2.log("  Proxy:          ", proxy);
        console2.log("  New impl:       ", address(newImpl));
        console2.log("  verifyAndCommit:", true);
        console2.log("  proofCommitments mapping added");
    }
}
