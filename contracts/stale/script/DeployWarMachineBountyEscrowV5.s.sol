// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "../src/WarMachineBountyEscrow.sol";
import {WarMachineBountyEscrowV5} from "../src/WarMachineBountyEscrowV5.sol";

interface VmV4Deploy {
    function envAddress(string calldata name) external view returns (address value);
    function envUint(string calldata name) external view returns (uint256 value);
    function startBroadcast() external;
    function stopBroadcast() external;
}
/// @dev Public deployment inputs only. The relayer key is kept in the Worker secret store
/// and is never read by this deployment script.
contract DeployWarMachineBountyEscrowV5 {
    VmV4Deploy private constant vm =
        VmV4Deploy(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant TEMPO_PATH_USD = 0x20C0000000000000000000000000000000000000;

    function run() external returns (WarMachineBountyEscrowV5 deployed) {
        address pauseGuardian = vm.envAddress("WM_ESCROW_PAUSE_GUARDIAN");
        address agentRelayer = vm.envAddress("WM_ESCROW_AGENT_RELAYER");
        address settlementSigner = vm.envAddress("WM_ESCROW_SETTLEMENT_SIGNER");
        uint64 attemptWindow = uint64(vm.envUint("WM_ESCROW_ATTEMPT_WINDOW_SECONDS"));

        vm.startBroadcast();
        deployed = new WarMachineBountyEscrowV5(
            IERC20(TEMPO_PATH_USD),
            pauseGuardian,
            agentRelayer,
            attemptWindow,
            _one(settlementSigner),
            1
        );
        vm.stopBroadcast();
    }

    function _one(address signer) private pure returns (address[] memory signers) {
        signers = new address[](1);
        signers[0] = signer;
    }
}
