// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20, WarMachineBountyEscrow} from "../src/WarMachineBountyEscrow.sol";

interface Vm {
    function envAddress(string calldata name) external view returns (address value);
    function envUint(string calldata name) external view returns (uint256 value);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @dev Usage is documented in docs/BOUNTY-ESCROW.md. Nothing here reads a private key from an
///      environment variable: use Foundry's interactive wallet flow for a real deployment.
contract DeployWarMachineBountyEscrow {
    // keccak256("hevm cheat code")
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant TEMPO_PATH_USD = 0x20C0000000000000000000000000000000000000;

    function run() external returns (WarMachineBountyEscrow deployed) {
        address pauseGuardian = vm.envAddress("WM_ESCROW_PAUSE_GUARDIAN");
        uint256 signerCount = vm.envUint("WM_ESCROW_SIGNER_COUNT");
        uint8 quorum = uint8(vm.envUint("WM_ESCROW_SIGNER_QUORUM"));
        uint64 attemptWindow = uint64(vm.envUint("WM_ESCROW_ATTEMPT_WINDOW_SECONDS"));
        address[] memory signers = new address[](signerCount);
        for (uint256 i; i < signerCount; ++i) {
            signers[i] = vm.envAddress(string.concat("WM_ESCROW_SIGNER_", _toString(i + 1)));
        }

        vm.startBroadcast();
        deployed = new WarMachineBountyEscrow(
            IERC20(TEMPO_PATH_USD), pauseGuardian, attemptWindow, signers, quorum
        );
        vm.stopBroadcast();
    }

    function _toString(uint256 value) private pure returns (string memory) {
        if (value == 0) return "0";
        uint256 digits;
        uint256 cursor = value;
        while (cursor != 0) {
            unchecked {
                ++digits;
            }
            cursor /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            unchecked {
                --digits;
            }
            buffer[digits] = bytes1(uint8(48 + value % 10));
            value /= 10;
        }
        return string(buffer);
    }
}
