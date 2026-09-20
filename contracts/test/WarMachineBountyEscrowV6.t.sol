// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {MockTIP20} from "./MockTIP20.sol";
import {WarMachineBountyEscrowV6} from "../src/WarMachineBountyEscrowV6.sol";

interface VmV6 {
    function addr(uint256 privateKey) external returns (address keyAddr);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 newTimestamp) external;
    function prank(address caller) external;
    function expectRevert() external;
}

contract WarMachineBountyEscrowV6Test {
    VmV6 private constant vm = VmV6(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant SIGNER_KEY = 0xCAFE;
    address private constant CREATOR = address(0xC0FFEE);
    address private constant CHALLENGER = address(0xC0DE);
    address private constant RELAYER = address(0xBEEF);
    address private constant GUARDIAN = address(0xA11CE55);
    uint128 private constant REWARD = 1_000_000;
    uint128 private constant ENTRY = 100_000;

    MockTIP20 private token;
    WarMachineBountyEscrowV6 private escrow;

    function setUp() public {
        token = new MockTIP20();
        address[] memory signers = new address[](1);
        signers[0] = vm.addr(SIGNER_KEY);
        escrow = new WarMachineBountyEscrowV6(token, GUARDIAN, RELAYER, 10 minutes, signers, 1);
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

    function testV6UsesOneSignerAndVersionSixDomain() public view {
        _eq(escrow.settlementQuorum(), 1, "quorum must be one");
        _eq(escrow.MIN_SETTLEMENT_QUORUM(), 1, "minimum quorum changed");
        _eq(escrow.MAX_SETTLEMENT_SIGNERS(), 1, "maximum signer count changed");
        if (escrow.DOMAIN_SEPARATOR() == bytes32(0)) revert("missing V6 domain");
    }

    function testEntryIsHeldAndWinPaysCreatorEntry() public {
        uint256 bountyId = _createAndEnter();
        _eq(token.balanceOf(address(escrow)), REWARD + ENTRY, "reward and entry must be escrowed");
        _eq(escrow.reservedRewards(), REWARD, "reward reserve wrong");
        _eq(escrow.reservedEntries(), ENTRY, "entry reserve wrong");
        WarMachineBountyEscrowV6.Bounty memory bounty = escrow.getBounty(bountyId);
        WarMachineBountyEscrowV6.Settlement memory settlement = WarMachineBountyEscrowV6.Settlement({
            bountyId: bountyId,
            attemptNonce: bounty.attemptNonce,
            outcome: WarMachineBountyEscrowV6.Outcome.ChallengerWon,
            resultHash: keccak256("win"),
            validUntil: bounty.attemptDeadline
        });
        escrow.settleAttempt(settlement, _signature(settlement));
        _eq(token.balanceOf(CHALLENGER), 10_000_000 - ENTRY + 975_000, "winner payout wrong");
        _eq(token.balanceOf(CREATOR), 10_000_000 - REWARD + ENTRY, "creator entry wrong");
        _eq(token.balanceOf(address(escrow)), 0, "escrow reserve must clear");
        _eq(escrow.reservedEntries(), 0, "entry reserve must clear");
    }

    function testLossTransfersHeldEntryToCreator() public {
        uint256 bountyId = _createAndEnter();
        WarMachineBountyEscrowV6.Bounty memory bounty = escrow.getBounty(bountyId);
        WarMachineBountyEscrowV6.Settlement memory settlement = WarMachineBountyEscrowV6.Settlement({
            bountyId: bountyId,
            attemptNonce: bounty.attemptNonce,
            outcome: WarMachineBountyEscrowV6.Outcome.ChallengerLostOrDrew,
            resultHash: keccak256("loss"),
            validUntil: bounty.attemptDeadline
        });
        escrow.settleAttempt(settlement, _signature(settlement));
        _eq(token.balanceOf(CHALLENGER), 10_000_000 - ENTRY, "loss charged wrong amount");
        _eq(token.balanceOf(CREATOR), 10_000_000 - REWARD + ENTRY, "creator did not receive entry");
        _eq(escrow.reservedEntries(), 0, "entry reserve must clear");
    }

    function testBothPermissionlessTimeoutEntrypointsRefundEntry() public {
        uint256 first = _createAndEnter();
        WarMachineBountyEscrowV6.Bounty memory a = escrow.getBounty(first);
        vm.warp(uint256(a.attemptDeadline) + escrow.SETTLEMENT_GRACE());
        escrow.forfeitTimedOutAttempt(first);
        _eq(token.balanceOf(CHALLENGER), 10_000_000, "forfeit path must refund challenger");
        _eq(escrow.reservedEntries(), 0, "forfeit left entry reserve");

        uint256 second = _createAndEnter();
        WarMachineBountyEscrowV6.Bounty memory b = escrow.getBounty(second);
        vm.warp(uint256(b.attemptDeadline) + escrow.SETTLEMENT_GRACE());
        vm.prank(address(0x1234));
        escrow.reopenTimedOutAttempt(second);
        _eq(token.balanceOf(CHALLENGER), 10_000_000, "reopen path must refund challenger");
        _eq(escrow.reservedEntries(), 0, "reopen left entry reserve");
        vm.expectRevert();
        escrow.reopenTimedOutAttempt(second);
    }

    function testActiveBountyCannotCancelOrExpire() public {
        uint256 bountyId = _createAndEnter();
        vm.prank(CREATOR);
        vm.expectRevert();
        escrow.cancelBounty(bountyId);
        vm.expectRevert();
        escrow.expireBounty(bountyId);
    }

    function testConstructorRejectsTwoSigners() public {
        address[] memory signers = new address[](2);
        signers[0] = vm.addr(SIGNER_KEY);
        signers[1] = vm.addr(0xBAD);
        vm.expectRevert();
        new WarMachineBountyEscrowV6(token, GUARDIAN, RELAYER, 10 minutes, signers, 2);
    }

    function testUntrustedSignatureCannotSettle() public {
        uint256 bountyId = _createAndEnter();
        WarMachineBountyEscrowV6.Bounty memory bounty = escrow.getBounty(bountyId);
        WarMachineBountyEscrowV6.Settlement memory settlement = WarMachineBountyEscrowV6.Settlement({
            bountyId: bountyId,
            attemptNonce: bounty.attemptNonce,
            outcome: WarMachineBountyEscrowV6.Outcome.ChallengerWon,
            resultHash: keccak256("untrusted"),
            validUntil: bounty.attemptDeadline
        });
        bytes[] memory untrusted = _signatureWithKey(settlement, 0xBAD);
        vm.expectRevert();
        escrow.settleAttempt(settlement, untrusted);
        _eq(escrow.reservedEntries(), ENTRY, "invalid signature released entry");
    }

    function testSettlementReplayAndWrongNonceAreRejected() public {
        uint256 bountyId = _createAndEnter();
        WarMachineBountyEscrowV6.Bounty memory bounty = escrow.getBounty(bountyId);
        WarMachineBountyEscrowV6.Settlement memory settlement = WarMachineBountyEscrowV6.Settlement({
            bountyId: bountyId,
            attemptNonce: bounty.attemptNonce,
            outcome: WarMachineBountyEscrowV6.Outcome.ChallengerLostOrDrew,
            resultHash: keccak256("replay"),
            validUntil: bounty.attemptDeadline
        });
        bytes[] memory signatures = _signature(settlement);
        escrow.settleAttempt(settlement, signatures);
        vm.expectRevert();
        escrow.settleAttempt(settlement, signatures);
        settlement.attemptNonce = bounty.attemptNonce + 1;
        bytes[] memory wrongNonce = _signature(settlement);
        vm.expectRevert();
        escrow.settleAttempt(settlement, wrongNonce);
    }

    function testTimeoutRefundStartsAtExactGraceBoundary() public {
        uint256 bountyId = _createAndEnter();
        WarMachineBountyEscrowV6.Bounty memory bounty = escrow.getBounty(bountyId);
        vm.warp(uint256(bounty.attemptDeadline) + escrow.SETTLEMENT_GRACE() - 1);
        vm.expectRevert();
        escrow.forfeitTimedOutAttempt(bountyId);
        vm.warp(uint256(bounty.attemptDeadline) + escrow.SETTLEMENT_GRACE());
        escrow.forfeitTimedOutAttempt(bountyId);
        _eq(token.balanceOf(CHALLENGER), 10_000_000, "boundary refund missing");
    }

    function testRelayedEntryRefundUsesTheActualChallenger() public {
        vm.prank(RELAYER);
        uint256 bountyId = escrow.createBountyFor(CREATOR, keccak256("relayed"), REWARD, ENTRY, 0);
        vm.prank(RELAYER);
        escrow.enterBountyFor(CHALLENGER, bountyId);
        WarMachineBountyEscrowV6.Bounty memory bounty = escrow.getBounty(bountyId);
        vm.warp(uint256(bounty.attemptDeadline) + escrow.SETTLEMENT_GRACE());
        vm.prank(address(0x1234));
        escrow.reopenTimedOutAttempt(bountyId);
        _eq(token.balanceOf(CHALLENGER), 10_000_000 + ENTRY, "relayed timeout paid wrong account");
        _eq(token.balanceOf(RELAYER), 10_000_000 - REWARD - ENTRY, "relayer reward funding changed unexpectedly");
        _eq(token.balanceOf(CREATOR), 10_000_000, "creator received a confiscated entry");
    }

    function _createAndEnter() private returns (uint256 bountyId) {
        vm.prank(CREATOR);
        bountyId = escrow.createBounty(keccak256(abi.encode(bountyId, block.timestamp)), REWARD, ENTRY, 0);
        vm.prank(CHALLENGER);
        escrow.enterBounty(bountyId);
    }

    function _signature(WarMachineBountyEscrowV6.Settlement memory settlement)
        private
        returns (bytes[] memory signatures)
    {
        return _signatureWithKey(settlement, SIGNER_KEY);
    }

    function _signatureWithKey(WarMachineBountyEscrowV6.Settlement memory settlement, uint256 key)
        private
        returns (bytes[] memory signatures)
    {
        bytes32 digest = escrow.hashSettlement(settlement);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        signatures = new bytes[](1);
        signatures[0] = abi.encodePacked(r, s, v);
    }

    function _eq(uint256 actual, uint256 expected, string memory message) private pure {
        if (actual != expected) revert(message);
    }
}
