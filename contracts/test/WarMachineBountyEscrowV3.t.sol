// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {MockTIP20} from "./MockTIP20.sol";
import {WarMachineBountyEscrowV3} from "../src/WarMachineBountyEscrowV3.sol";

interface VmV3 {
    function addr(uint256 privateKey) external returns (address keyAddr);
    function expectRevert() external;
    function prank(address caller) external;
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
}

contract WarMachineBountyEscrowV3Test {
    VmV3 private constant vm = VmV3(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant SETTLEMENT_KEY = 0xA11CE;
    uint256 private constant UNTRUSTED_KEY = 0xB0B;
    address private constant CREATOR = address(0xC0FFEE);
    address private constant CHALLENGER = address(0xC0DE);
    address private constant GUARDIAN = address(0xA11CE55);
    address private constant FEE_RECIPIENT = 0xc20131e9132888993de6519D486E5558A5DbCb7A;

    MockTIP20 private token;
    WarMachineBountyEscrowV3 private escrow;

    function setUp() public {
        token = new MockTIP20();
        address[] memory signers = new address[](1);
        signers[0] = vm.addr(SETTLEMENT_KEY);
        escrow = new WarMachineBountyEscrowV3(token, GUARDIAN, 10 minutes, signers, 1);
        token.mint(CREATOR, 10_000_000);
        token.mint(CHALLENGER, 10_000_000);
        vm.prank(CREATOR);
        token.approve(address(escrow), type(uint256).max);
        vm.prank(CHALLENGER);
        token.approve(address(escrow), type(uint256).max);
    }

    function testOneSignaturePaysWinnerAndTheFixedFeeRecipient() public {
        uint256 bountyId = _createAndEnter();
        escrow.settleAttempt(_settlement(bountyId), _oneSignature(_settlement(bountyId)));

        _eq(token.balanceOf(CHALLENGER), 10_875_000, "winner payout is wrong");
        _eq(token.balanceOf(CREATOR), 9_100_000, "creator entry is wrong");
        _eq(token.balanceOf(FEE_RECIPIENT), 25_000, "platform fee is wrong");
    }

    function testRejectsUntrustedOrExtraSignatures() public {
        uint256 bountyId = _createAndEnter();
        WarMachineBountyEscrowV3.Settlement memory settlement = _settlement(bountyId);
        bytes32 digest = escrow.hashSettlement(settlement);
        bytes[] memory untrusted = new bytes[](1);
        untrusted[0] = _signature(digest, UNTRUSTED_KEY);
        vm.expectRevert();
        escrow.settleAttempt(settlement, untrusted);

        bytes[] memory extra = new bytes[](2);
        extra[0] = _signature(digest, SETTLEMENT_KEY);
        extra[1] = _signature(digest, SETTLEMENT_KEY);
        vm.expectRevert();
        escrow.settleAttempt(settlement, extra);
    }

    function testEntryPaysCreatorImmediatelyAndIsNotPaidAgainOnLoss() public {
        uint256 bountyId = _createAndEnter();
        _eq(token.balanceOf(CHALLENGER), 9_900_000, "entry was not charged at entry");
        _eq(token.balanceOf(CREATOR), 9_100_000, "creator did not receive entry immediately");
        _eq(token.balanceOf(address(escrow)), 1_000_000, "escrow must hold reward only");

        WarMachineBountyEscrowV3.Settlement memory settlement = _settlement(bountyId);
        settlement.outcome = WarMachineBountyEscrowV3.Outcome.ChallengerLostOrDrew;
        escrow.settleAttempt(settlement, _oneSignature(settlement));

        _eq(token.balanceOf(CREATOR), 9_100_000, "loss paid the entry twice");
        _eq(token.balanceOf(address(escrow)), 1_000_000, "loss released the reward");
    }

    function testTechnicalRefundIsNotAnEntryRefundPath() public {
        uint256 bountyId = _createAndEnter();
        WarMachineBountyEscrowV3.Settlement memory settlement = _settlement(bountyId);
        settlement.outcome = WarMachineBountyEscrowV3.Outcome.TechnicalRefund;
        bytes[] memory signature = _oneSignature(settlement);
        vm.expectRevert();
        escrow.settleAttempt(settlement, signature);
    }

    function testDeploymentRejectsAnythingButOneSignerAndOneQuorum() public {
        address[] memory noSigners = new address[](0);
        vm.expectRevert();
        new WarMachineBountyEscrowV3(token, GUARDIAN, 10 minutes, noSigners, 0);

        address[] memory twoSigners = new address[](2);
        twoSigners[0] = vm.addr(SETTLEMENT_KEY);
        twoSigners[1] = vm.addr(UNTRUSTED_KEY);
        vm.expectRevert();
        new WarMachineBountyEscrowV3(token, GUARDIAN, 10 minutes, twoSigners, 1);
    }

    function _createAndEnter() private returns (uint256 bountyId) {
        vm.prank(CREATOR);
        bountyId = escrow.createBounty(keccak256("v3-terms"), 1_000_000, 100_000, 0);
        vm.prank(CHALLENGER);
        escrow.enterBounty(bountyId);
    }

    function _settlement(uint256 bountyId)
        private
        view
        returns (WarMachineBountyEscrowV3.Settlement memory)
    {
        return WarMachineBountyEscrowV3.Settlement({
            bountyId: bountyId,
            attemptNonce: escrow.getBounty(bountyId).attemptNonce,
            outcome: WarMachineBountyEscrowV3.Outcome.ChallengerWon,
            resultHash: keccak256("v3-replay-and-result"),
            validUntil: uint64(block.timestamp + 1 minutes)
        });
    }

    function _oneSignature(WarMachineBountyEscrowV3.Settlement memory settlement)
        private
        returns (bytes[] memory signatures)
    {
        signatures = new bytes[](1);
        signatures[0] = _signature(escrow.hashSettlement(settlement), SETTLEMENT_KEY);
    }

    function _signature(bytes32 digest, uint256 key) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _eq(uint256 actual, uint256 expected, string memory message) private pure {
        if (actual != expected) revert(message);
    }
}
