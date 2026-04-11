// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Script, console2} from "forge-std/Script.sol";
import {DCTEnforcer} from "../src/DCTEnforcer.sol";

/// @notice UUPS upgrade of DCTEnforcer (e.g. deprecate unsafe validateAction).
/// @dev Requires PRIVATE_KEY (proxy owner) and DCT_ENFORCER_PROXY.
///
///   export DCT_ENFORCER_PROXY=0x...   # DCTEnforcer ERC1967 proxy
///   forge script script/UpgradeDCTEnforcer.s.sol:UpgradeDCTEnforcer \
///     --rpc-url $RPC_URL --broadcast
///
/// Or: ./scripts/upgrade-dct-enforcer-base-sepolia.sh
contract UpgradeDCTEnforcer is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address proxy = vm.envAddress("DCT_ENFORCER_PROXY");

        vm.startBroadcast(deployerPk);

        DCTEnforcer newImpl = new DCTEnforcer();

        DCTEnforcer(proxy).upgradeToAndCall(address(newImpl), "");

        vm.stopBroadcast();

        console2.log("DCTEnforcer upgraded");
        console2.log("  Proxy:   ", proxy);
        console2.log("  New impl:", address(newImpl));
    }
}
