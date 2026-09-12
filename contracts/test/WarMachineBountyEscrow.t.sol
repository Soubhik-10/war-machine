// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {MockTIP20} from "./MockTIP20.sol";
import {WarMachineBountyEscrow} from "../src/WarMachineBountyEscrow.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address keyAddr);
    function expectRevert() external;
    function prank(address caller) external;
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 newTimestamp) external;
}

contract WarMachineBountyEscrowTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant ORACLE_KEY = 0xA11CE;
    uint256 private constant SECOND_ORACLE_KEY = 0xB0B1;
    uint256 private constant UNTRUSTED_KEY = 0xB0B;
    uint256 private constant SECOND_UNTRUSTED_KEY = 0xB0B2;
    address private creator = address(0xC0FFEE);
    address private challenger = address(0xC0DE);
    address private constant feeRecipient = 0xc20131e9132888993de6519D486E5558A5DbCb7A;
    address private guardian = address(0xA11CE55);
    MockTIP20 private token;
    WarMachineBountyEscrow private escrow;

    function setUp() public {
        token = new MockTIP20();
        address[] memory signers = new address[](2);
        signers[0] = vm.addr(ORACLE_KEY);
        signers[1] = vm.addr(SECOND_ORACLE_KEY);
        escrow = new WarMachineBountyEscrow(token, guardian, 5 minutes, signers, 2);
        token.mint(creator, 10_000_000);
        token.mint(challenger, 10_000_000);
        vm.prank(creator);
        token.approve(address(escrow), type(uint256).max);
        vm.prank(challenger);
        token.approve(address(escrow), type(uint256).max);
    }

    function testWinnerGets975BpsRewardCreatorGetsEntryAndFeeIsFixed() public {
        uint256 bountyId = _create(1_000_000, 100_000, 0);
        _enter(bountyId);
        _settle(bountyId, WarMachineBountyEscrow.Outcome.ChallengerWon);

        _eq(token.balanceOf(challenger), 10_875_000, "winner payout / entry is wrong");
        _eq(token.balanceOf(creator), 9_100_000, "creator entry is wrong");
        _eq(token.balanceOf(feeRecipient), 25_000, "fee recipient is wrong");
        _eq(token.balanceOf(address(escrow)), 0, "escrow should have no released reserve");
        _eq(
            uint256(escrow.getBounty(bountyId).status),
            uint256(WarMachineBountyEscrow.BountyStatus.Claimed),
            "bounty should be claimed"
        );
    }

    function testLossPaysDisclosedEntryToCreatorAndLeavesRewardFunded() public {
        uint256 bountyId = _create(1_000_000, 100_000, 0);
        _enter(bountyId);
        _settle(bountyId, WarMachineBountyEscrow.Outcome.ChallengerLostOrDrew);

        _eq(token.balanceOf(challenger), 9_900_000, "loss entry is wrong");
        _eq(token.balanceOf(creator), 9_100_000, "creator should receive entry");
        _eq(token.balanceOf(address(escrow)), 1_000_000, "reward must remain reserved");
        _eq(
            uint256(escrow.getBounty(bountyId).status),
            uint256(WarMachineBountyEscrow.BountyStatus.Open),
            "bounty should reopen"
        );
    }

    function testUnresponsiveOracleCannotTrapEntry() public {
        uint256 bountyId = _create(1_000_000, 100_000, 0);
        _enter(bountyId);
        vm.warp(block.timestamp + 5 minutes);
        vm.prank(challenger);
        escrow.refundTimedOutAttempt(bountyId);

        _eq(token.balanceOf(challenger), 10_000_000, "challenger must recover timed-out entry");
        _eq(token.balanceOf(address(escrow)), 1_000_000, "reward should remain funded");
        _eq(
            uint256(escrow.getBounty(bountyId).status),
            uint256(WarMachineBountyEscrow.BountyStatus.Open),
            "bounty must reopen after timeout"
        );
    }

    function testExpiredActiveBountyReturnsBothParticipantsFunds() public {
        uint256 bountyId = _create(1_000_000, 100_000, uint64(block.timestamp + 2 minutes));
        _enter(bountyId);
        vm.warp(block.timestamp + 5 minutes);
        escrow.expireBounty(bountyId);

        _eq(token.balanceOf(creator), 10_000_000, "creator reward refund is wrong");
        _eq(token.balanceOf(challenger), 10_000_000, "challenger entry refund is wrong");
        _eq(token.balanceOf(address(escrow)), 0, "funds must not remain after expiry");
    }

    function testUntrustedSignatureCannotSettle() public {
        uint256 bountyId = _create(1_000_000, 100_000, 0);
        _enter(bountyId);
        WarMachineBountyEscrow.Settlement memory settlement =
            _settlement(bountyId, WarMachineBountyEscrow.Outcome.ChallengerWon);
        bytes32 digest = escrow.hashSettlement(settlement);
        bytes[] memory signatures = _sortedSignatures(digest, UNTRUSTED_KEY, SECOND_UNTRUSTED_KEY);
        vm.expectRevert();
        escrow.settleAttempt(settlement, signatures);

        _eq(token.balanceOf(address(escrow)), 1_100_000, "invalid signature moved funds");
    }

    function testReplayCannotSettleAnAlreadyClosedAttempt() public {
        uint256 bountyId = _create(1_000_000, 100_000, 0);
        _enter(bountyId);
        WarMachineBountyEscrow.Settlement memory settlement =
            _settlement(bountyId, WarMachineBountyEscrow.Outcome.ChallengerWon);
        bytes[] memory signatures = _quorumSignatures(settlement);
        escrow.settleAttempt(settlement, signatures);

        vm.expectRevert();
        escrow.settleAttempt(settlement, signatures);
    }

    function testTwoOfTwoQuorumRejectsOneSignatureAndAcceptsSortedDistinctSigners() public {
        address[] memory signers = new address[](2);
        signers[0] = vm.addr(ORACLE_KEY);
        signers[1] = vm.addr(SECOND_ORACLE_KEY);
        WarMachineBountyEscrow strict =
            new WarMachineBountyEscrow(token, guardian, 5 minutes, signers, 2);
        vm.prank(creator);
        token.approve(address(strict), type(uint256).max);
        vm.prank(challenger);
        token.approve(address(strict), type(uint256).max);
        vm.prank(creator);
        uint256 bountyId = strict.createBounty(keccak256("strict-terms"), 1_000_000, 100_000, 0);
        vm.prank(challenger);
        strict.enterBounty(bountyId);

        WarMachineBountyEscrow.Settlement memory settlement = WarMachineBountyEscrow.Settlement({
            bountyId: bountyId,
            attemptNonce: strict.getBounty(bountyId).attemptNonce,
            outcome: WarMachineBountyEscrow.Outcome.ChallengerWon,
            resultHash: keccak256("strict-replay-and-result"),
            validUntil: uint64(block.timestamp + 1 minutes)
        });
        bytes32 digest = strict.hashSettlement(settlement);
        bytes[] memory oneSignature = new bytes[](1);
        oneSignature[0] = _signature(digest, ORACLE_KEY);
        vm.expectRevert();
        strict.settleAttempt(settlement, oneSignature);

        bytes[] memory twoSignatures = new bytes[](2);
        address first = vm.addr(ORACLE_KEY);
        address second = vm.addr(SECOND_ORACLE_KEY);
        if (first < second) {
            twoSignatures[0] = _signature(digest, ORACLE_KEY);
            twoSignatures[1] = _signature(digest, SECOND_ORACLE_KEY);
        } else {
            twoSignatures[0] = _signature(digest, SECOND_ORACLE_KEY);
            twoSignatures[1] = _signature(digest, ORACLE_KEY);
        }
        strict.settleAttempt(settlement, twoSignatures);
        _eq(token.balanceOf(challenger), 10_875_000, "2-of-2 settlement did not pay the winner");
    }

    function testCreatorCannotCancelDuringAnActiveAttempt() public {
        uint256 bountyId = _create(1_000_000, 100_000, 0);
        _enter(bountyId);
        vm.expectRevert();
        vm.prank(creator);
        escrow.cancelBounty(bountyId);
    }

    function testGuardianCanOnlyPauseNewFundingAndEntries() public {
        vm.prank(guardian);
        escrow.setNewBountiesPaused(true);
        vm.expectRevert();
        _create(1_000_000, 100_000, 0);

        vm.prank(guardian);
        escrow.setNewBountiesPaused(false);
        uint256 bountyId = _create(1_000_000, 100_000, 0);
        vm.prank(guardian);
        escrow.setNewEntriesPaused(true);
        vm.expectRevert();
        vm.prank(challenger);
        escrow.enterBounty(bountyId);
        vm.prank(creator);
        escrow.cancelBounty(bountyId);
        _eq(token.balanceOf(creator), 10_000_000, "pause guardian must not trap cancellation funds");
    }

    function testNonGuardianCannotPauseFundingOrEntries() public {
        vm.expectRevert();
        vm.prank(creator);
        escrow.setNewBountiesPaused(true);
        vm.expectRevert();
        vm.prank(challenger);
        escrow.setNewEntriesPaused(true);
    }

    function testDeploymentRequiresAtLeastTwoSettlementSignersAndQuorum() public {
        address[] memory oneSigner = new address[](1);
        oneSigner[0] = vm.addr(ORACLE_KEY);
        vm.expectRevert();
        new WarMachineBountyEscrow(token, guardian, 5 minutes, oneSigner, 1);

        address[] memory twoSigners = new address[](2);
        twoSigners[0] = vm.addr(ORACLE_KEY);
        twoSigners[1] = vm.addr(SECOND_ORACLE_KEY);
        vm.expectRevert();
        new WarMachineBountyEscrow(token, guardian, 5 minutes, twoSigners, 1);
    }

    function _create(uint128 reward, uint128 entry, uint64 expiresAt) private returns (uint256) {
        vm.prank(creator);
        return escrow.createBounty(keccak256("terms"), reward, entry, expiresAt);
    }

    function _enter(uint256 bountyId) private {
        vm.prank(challenger);
        escrow.enterBounty(bountyId);
    }

    function _settlement(uint256 bountyId, WarMachineBountyEscrow.Outcome outcome)
        private
        view
        returns (WarMachineBountyEscrow.Settlement memory)
    {
        return WarMachineBountyEscrow.Settlement({
            bountyId: bountyId,
            attemptNonce: escrow.getBounty(bountyId).attemptNonce,
            outcome: outcome,
            resultHash: keccak256("replay-and-result"),
            validUntil: uint64(block.timestamp + 1 minutes)
        });
    }

    function _settle(uint256 bountyId, WarMachineBountyEscrow.Outcome outcome) private {
        WarMachineBountyEscrow.Settlement memory settlement = _settlement(bountyId, outcome);
        escrow.settleAttempt(settlement, _quorumSignatures(settlement));
    }

    function _quorumSignatures(WarMachineBountyEscrow.Settlement memory settlement)
        private
        returns (bytes[] memory signatures)
    {
        bytes32 digest = escrow.hashSettlement(settlement);
        return _sortedSignatures(digest, ORACLE_KEY, SECOND_ORACLE_KEY);
    }

    function _sortedSignatures(bytes32 digest, uint256 firstKey, uint256 secondKey)
        private
        returns (bytes[] memory signatures)
    {
        signatures = new bytes[](2);
        if (vm.addr(firstKey) < vm.addr(secondKey)) {
            signatures[0] = _signature(digest, firstKey);
            signatures[1] = _signature(digest, secondKey);
        } else {
            signatures[0] = _signature(digest, secondKey);
            signatures[1] = _signature(digest, firstKey);
        }
    }

    function _signature(bytes32 digest, uint256 signerKey) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _eq(uint256 actual, uint256 expected, string memory message) private pure {
        if (actual != expected) revert(message);
    }
}
