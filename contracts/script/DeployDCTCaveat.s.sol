// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Script, console2} from "forge-std/Script.sol";
import {DCTCaveatEnforcer} from "../src/integrations/DCTCaveatEnforcer.sol";

/// @notice Deploy DCTCaveatEnforcer for DelegationManager caveats (Base Sepolia or local).
contract DeployDCTCaveat is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address registry = vm.envAddress("DCT_REGISTRY_ADDRESS");

        vm.startBroadcast(deployerPk);

        DCTCaveatEnforcer caveats = new DCTCaveatEnforcer(registry);

        vm.stopBroadcast();

        console2.log("DCTCaveatEnforcer:", address(caveats));
        console2.log("dctRegistry:", registry);
    }
}
