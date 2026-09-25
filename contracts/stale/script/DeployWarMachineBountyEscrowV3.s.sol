// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "../src/WarMachineBountyEscrow.sol";
import {WarMachineBountyEscrowV3} from "../src/WarMachineBountyEscrowV3.sol";

interface VmV3Deploy {
    function envAddress(string calldata name) external view returns (address value);
    function envUint(string calldata name) external view returns (uint256 value);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @dev The settlement address is public configuration. Its key is stored only as
/// a server-side runtime secret after deployment, never in this checkout.
contract DeployWarMachineBountyEscrowV3 {
    VmV3Deploy private constant vm =
        VmV3Deploy(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant TEMPO_PATH_USD = 0x20C0000000000000000000000000000000000000;

    function run() external returns (WarMachineBountyEscrowV3 deployed) {
        address pauseGuardian = vm.envAddress("WM_ESCROW_PAUSE_GUARDIAN");
        address settlementSigner = vm.envAddress("WM_ESCROW_SETTLEMENT_SIGNER");
        uint64 attemptWindow = uint64(vm.envUint("WM_ESCROW_ATTEMPT_WINDOW_SECONDS"));

        vm.startBroadcast();
        deployed = new WarMachineBountyEscrowV3(
            IERC20(TEMPO_PATH_USD), pauseGuardian, attemptWindow, _one(settlementSigner), 1
        );
        vm.stopBroadcast();
    }

    function _one(address signer) private pure returns (address[] memory signers) {
        signers = new address[](1);
        signers[0] = signer;
    }
}
