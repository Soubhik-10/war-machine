// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "../src/WarMachineBountyEscrow.sol";
import {WarMachineBountyEscrowV6} from "../src/WarMachineBountyEscrowV6.sol";

interface VmV6Deploy {
    function envAddress(string calldata name) external view returns (address value);
    function envUint(string calldata name) external view returns (uint256 value);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @dev Reads public constructor addresses only. The encrypted deployer keystore
/// is supplied to Forge by the caller and no relayer or settlement private key is read.
contract DeployWarMachineBountyEscrowV6 {
    VmV6Deploy private constant vm = VmV6Deploy(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant TEMPO_PATH_USD = 0x20C0000000000000000000000000000000000000;

    function run() external returns (WarMachineBountyEscrowV6 deployed) {
        address pauseGuardian = vm.envAddress("WM_ESCROW_PAUSE_GUARDIAN");
        address agentRelayer = vm.envAddress("WM_ESCROW_AGENT_RELAYER");
        address settlementSigner = vm.envAddress("WM_ESCROW_SETTLEMENT_SIGNER");
        uint64 attemptWindow = uint64(vm.envUint("WM_ESCROW_ATTEMPT_WINDOW_SECONDS"));
        vm.startBroadcast();
        deployed = new WarMachineBountyEscrowV6(
            IERC20(TEMPO_PATH_USD), pauseGuardian, agentRelayer, attemptWindow, _one(settlementSigner), 1
        );
        vm.stopBroadcast();
    }

    function _one(address signer) private pure returns (address[] memory signers) {
        signers = new address[](1);
        signers[0] = signer;
    }
}
