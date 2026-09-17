// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {MockTIP20} from "./MockTIP20.sol";
import {WarMachineBountyEscrowV4} from "../src/WarMachineBountyEscrowV4.sol";

interface VmV4 {
    function addr(uint256 privateKey) external returns (address keyAddr);
    function expectRevert() external;
    function prank(address caller) external;
}

contract WarMachineBountyEscrowV4Test {
    VmV4 private constant vm = VmV4(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant CREATOR = address(0xC0FFEE);
    address private constant CHALLENGER = address(0xC0DE);
    address private constant RELAYER = address(0xBEEF);
    address private constant GUARDIAN = address(0xA11CE55);

    MockTIP20 private token;
    WarMachineBountyEscrowV4 private escrow;

    function setUp() public {
        token = new MockTIP20();
        address[] memory signers = new address[](1);
        signers[0] = address(0xCAFE);
        escrow = new WarMachineBountyEscrowV4(token, GUARDIAN, RELAYER, 10 minutes, signers, 1);

        token.mint(CREATOR, 10_000_000);
        token.mint(CHALLENGER, 10_000_000);
        token.mint(RELAYER, 10_000_000);
        vm.prank(CREATOR);
        token.approve(address(escrow), type(uint256).max);
        vm.prank(CHALLENGER);
        token.approve(address(escrow), type(uint256).max);
        vm.prank(RELAYER);
        token.approve(address(escrow), type(uint256).max);
    }

    function testRelayerPreservesCreatorAndChallengerIdentity() public {
        vm.prank(RELAYER);
        uint256 bountyId = escrow.createBountyFor(
            CREATOR, keccak256("mpp-terms"), 1_000_000, 100_000, 0
        );
        vm.prank(RELAYER);
        escrow.enterBountyFor(CHALLENGER, bountyId);

        WarMachineBountyEscrowV4.Bounty memory bounty = escrow.getBounty(bountyId);
        _eqAddress(bounty.creator, CREATOR, "creator identity changed");
        _eqAddress(bounty.challenger, CHALLENGER, "challenger identity changed");
        _eq(token.balanceOf(address(escrow)), 1_000_000, "reward reserve is wrong");
        _eq(token.balanceOf(CREATOR), 9_100_000, "entry was not paid to creator");
        _eq(token.balanceOf(RELAYER), 8_900_000, "relayer amount is wrong");
    }

    function testDirectV4CallsRemainAvailable() public {
        vm.prank(CREATOR);
        uint256 bountyId = escrow.createBounty(keccak256("direct-terms"), 1_000_000, 100_000, 0);
        vm.prank(CHALLENGER);
        escrow.enterBounty(bountyId);
        _eq(token.balanceOf(address(escrow)), 1_000_000, "direct reward reserve is wrong");
        _eq(token.balanceOf(CREATOR), 9_100_000, "direct entry was not paid");
    }

    function testOnlyRelayerCanUseRelayedCalls() public {
        vm.expectRevert();
        escrow.createBountyFor(CREATOR, keccak256("blocked"), 1_000_000, 100_000, 0);

        vm.prank(RELAYER);
        uint256 bountyId = escrow.createBountyFor(
            CREATOR, keccak256("mpp-terms"), 1_000_000, 100_000, 0
        );
        vm.expectRevert();
        escrow.enterBountyFor(CHALLENGER, bountyId);
    }

    function testCancelReleasesRelayedReward() public {
        vm.prank(RELAYER);
        uint256 bountyId = escrow.createBountyFor(
            CREATOR, keccak256("cancel-terms"), 1_000_000, 100_000, 0
        );
        vm.prank(RELAYER);
        escrow.cancelBountyFor(CREATOR, bountyId);
        _eq(token.balanceOf(CREATOR), 10_000_000, "cancel did not return reward to creator");
        _eq(escrow.reservedRewards(), 0, "cancel left a reserved reward");
    }

    function _eq(uint256 actual, uint256 expected, string memory message) private pure {
        if (actual != expected) revert(message);
    }

    function _eqAddress(address actual, address expected, string memory message) private pure {
        if (actual != expected) revert(message);
    }
}
