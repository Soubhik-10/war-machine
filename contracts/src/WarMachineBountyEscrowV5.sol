// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "./WarMachineBountyEscrow.sol";

/// @notice A non-upgradeable pathUSD bounty escrow with a settlement grace period and a narrowly scoped agent relayer.
/// @dev Direct callers retain V3 semantics. The relayer methods are for MPP-paid agent
///      operations: the Worker verifies the payer's MPP receipt, then the relayer submits
///      the exact contract call. The relayer is not allowed to choose a different payer,
///      recipient, reward, entry, or settlement result.
contract WarMachineBountyEscrowV5 {
    uint16 public constant PLATFORM_FEE_BPS = 250;
    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint8 public constant MIN_SETTLEMENT_QUORUM = 1;
    uint8 public constant MAX_SETTLEMENT_SIGNERS = 1;
    uint64 public constant MIN_ATTEMPT_WINDOW = 8 minutes;
    uint64 public constant MAX_ATTEMPT_WINDOW = 1 hours;
    address public constant PLATFORM_FEE_RECIPIENT = 0xc20131e9132888993de6519D486E5558A5DbCb7A;

    bytes32 public constant SETTLEMENT_TYPEHASH = keccak256(
        "Settlement(uint256 bountyId,uint64 attemptNonce,uint8 outcome,bytes32 resultHash,uint64 validUntil)"
    );
    bytes32 private constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant NAME_HASH = keccak256("War Machines Bounty Escrow");
    bytes32 private constant VERSION_HASH = keccak256("5");
    uint256 private constant SECP256K1N_HALF =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    enum BountyStatus {
        None,
        Open,
        Active,
        Claimed,
        Cancelled,
        Expired
    }

    enum Outcome {
        ChallengerWon,
        ChallengerLostOrDrew,
        TechnicalRefund
    }

    struct Bounty {
        address creator;
        address challenger;
        uint128 reward;
        uint128 entry;
        uint64 expiresAt;
        uint64 attemptDeadline;
        uint64 attemptNonce;
        BountyStatus status;
        bytes32 termsHash;
    }

    struct Settlement {
        uint256 bountyId;
        uint64 attemptNonce;
        Outcome outcome;
        bytes32 resultHash;
        uint64 validUntil;
    }

    error AmountZero();
    error AttemptNotTimedOut();
    error BountyUnavailableAfterExpiry();
    error BountyNotOpen();
    error CallerIsCreator();
    error CallerNotCreator();
    error CallerNotRelayer();
    error DirectNativeCurrencyRejected();
    error ExpiryRequired();
    error InvalidAddress();
    error InvalidAttemptWindow();
    error InvalidOutcome();
    error InvalidSignature();
    error InvalidSignerConfiguration();
    error InvalidStatus();
    error InvalidTermsHash();
    error InvalidTime();
    error NewBountiesPaused();
    error NewEntriesPaused();
    error Reentrancy();
    error SignatureExpired();
    error SignatureQuorumNotMet();
    error SignaturesNotSorted();
    error TokenBalanceMismatch();
    error TokenTransferFailed();

    event BountyCreated(
        uint256 indexed bountyId,
        address indexed creator,
        uint128 reward,
        uint128 entry,
        uint64 expiresAt,
        bytes32 termsHash
    );
    event AttemptEntered(
        uint256 indexed bountyId,
        uint64 indexed attemptNonce,
        address indexed challenger,
        uint64 attemptDeadline
    );
    event AttemptSettled(
        uint256 indexed bountyId,
        uint64 indexed attemptNonce,
        address indexed challenger,
        Outcome outcome,
        bytes32 resultHash,
        uint128 winnerPayout,
        uint128 platformFee,
        uint128 creatorEntry
    );
    event BountyCancelled(uint256 indexed bountyId, address indexed creator, uint128 reward);
    event BountyExpired(uint256 indexed bountyId, address indexed creator, uint128 reward);
    event TimedOutAttemptForfeited(
        uint256 indexed bountyId,
        uint64 indexed attemptNonce,
        address indexed challenger,
        address creator,
        uint128 entryPaidAtEntry
    );
    event TimedOutAttemptReopened(
        uint256 indexed bountyId,
        uint64 indexed attemptNonce,
        address indexed challenger,
        address creator,
        uint128 entryPaidAtEntry
    );
    event NewBountiesPauseSet(bool paused);
    event NewEntriesPauseSet(bool paused);

    IERC20 public immutable token;
    address public immutable pauseGuardian;
    address public immutable agentRelayer;
    uint64 public immutable attemptWindow;
    /// @notice Grace after the match deadline for a verified result to reach the escrow.
    uint64 public constant SETTLEMENT_GRACE = 2 minutes;
    uint8 public immutable settlementQuorum;
    bytes32 public immutable DOMAIN_SEPARATOR;

    uint256 public nextBountyId = 1;
    uint256 public reservedRewards;
    bool public newBountiesPaused;
    bool public newEntriesPaused;
    bool private locked;
    mapping(address signer => bool approved) public isSettlementSigner;
    mapping(uint256 bountyId => Bounty bounty) private bounties;

    modifier nonReentrant() {
        if (locked) revert Reentrancy();
        locked = true;
        _;
        locked = false;
    }

    modifier onlyPauseGuardian() {
        if (msg.sender != pauseGuardian) revert InvalidAddress();
        _;
    }

    modifier onlyAgentRelayer() {
        if (msg.sender != agentRelayer) revert CallerNotRelayer();
        _;
    }

    constructor(
        IERC20 token_,
        address pauseGuardian_,
        address agentRelayer_,
        uint64 attemptWindow_,
        address[] memory settlementSigners_,
        uint8 settlementQuorum_
    ) {
        if (
            address(token_) == address(0) || pauseGuardian_ == address(0)
                || agentRelayer_ == address(0)
        ) revert InvalidAddress();
        if (attemptWindow_ < MIN_ATTEMPT_WINDOW || attemptWindow_ > MAX_ATTEMPT_WINDOW) {
            revert InvalidAttemptWindow();
        }
        uint256 signerCount = settlementSigners_.length;
        if (
            signerCount < MIN_SETTLEMENT_QUORUM || signerCount > MAX_SETTLEMENT_SIGNERS
                || settlementQuorum_ < MIN_SETTLEMENT_QUORUM || settlementQuorum_ > signerCount
        ) revert InvalidSignerConfiguration();

        for (uint256 i; i < signerCount; ++i) {
            address signer = settlementSigners_[i];
            if (signer == address(0) || signer == agentRelayer_ || isSettlementSigner[signer]) {
                revert InvalidSignerConfiguration();
            }
            isSettlementSigner[signer] = true;
        }

        token = token_;
        pauseGuardian = pauseGuardian_;
        agentRelayer = agentRelayer_;
        attemptWindow = attemptWindow_;
        settlementQuorum = settlementQuorum_;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)
            )
        );
    }

    function createBounty(bytes32 termsHash, uint128 reward, uint128 entry, uint64 expiresAt)
        external
        nonReentrant
        returns (uint256 bountyId)
    {
        _validateCreate(termsHash, reward, expiresAt);
        _pullExact(msg.sender, reward);
        bountyId = _create(msg.sender, termsHash, reward, entry, expiresAt);
    }

    /// @notice Creates a bounty for an MPP-authenticated payer after the relayer has verified
    ///      and received the matching payment. The relayer must approve this escrow for reward.
    function createBountyFor(
        address creator,
        bytes32 termsHash,
        uint128 reward,
        uint128 entry,
        uint64 expiresAt
    ) external onlyAgentRelayer nonReentrant returns (uint256 bountyId) {
        _validateCreate(termsHash, reward, expiresAt);
        if (creator == address(0)) revert InvalidAddress();
        _pullExact(agentRelayer, reward);
        bountyId = _create(creator, termsHash, reward, entry, expiresAt);
    }

    function enterBounty(uint256 bountyId) external nonReentrant {
        _enter(bountyId, msg.sender, msg.sender);
    }

    /// @notice Enters for an MPP-authenticated challenger after the relayer has received the
    ///      exact entry payment. The relayer pays the creator from its approved balance.
    function enterBountyFor(address challenger, uint256 bountyId)
        external
        onlyAgentRelayer
        nonReentrant
    {
        if (challenger == address(0)) revert InvalidAddress();
        _enter(bountyId, challenger, agentRelayer);
    }

    function settleAttempt(Settlement calldata settlement, bytes[] calldata signatures)
        external
        nonReentrant
    {
        Bounty storage bounty = bounties[settlement.bountyId];
        if (bounty.status != BountyStatus.Active) revert InvalidStatus();
        if (settlement.attemptNonce != bounty.attemptNonce) revert InvalidStatus();
        if (uint8(settlement.outcome) > uint8(Outcome.ChallengerLostOrDrew)) {
            revert InvalidOutcome();
        }
        if (settlement.validUntil == 0 || settlement.validUntil > bounty.attemptDeadline) {
            revert InvalidTime();
        }
        // The signed result expires at the match deadline, but the contract accepts that
        // already-bounded result during the short relay grace period. A fresh result cannot
        // be manufactured after the grace period because the attempt is then finalized as a loss.
        if (block.timestamp < bounty.attemptDeadline && settlement.validUntil < block.timestamp) {
            revert SignatureExpired();
        }
        if (block.timestamp >= bounty.attemptDeadline + SETTLEMENT_GRACE) revert InvalidTime();

        _verifyQuorum(settlement, signatures);

        address challenger = bounty.challenger;
        uint128 reward = bounty.reward;
        bounty.challenger = address(0);
        bounty.attemptDeadline = 0;

        if (settlement.outcome == Outcome.ChallengerWon) {
            uint128 fee = uint128(uint256(reward) * PLATFORM_FEE_BPS / BPS_DENOMINATOR);
            uint128 payout = reward - fee;
            bounty.status = BountyStatus.Claimed;
            _releaseReward(reward);
            _pushExact(challenger, payout);
            if (fee != 0) _pushExact(PLATFORM_FEE_RECIPIENT, fee);
            emit AttemptSettled(
                settlement.bountyId,
                settlement.attemptNonce,
                challenger,
                settlement.outcome,
                settlement.resultHash,
                payout,
                fee,
                0
            );
            return;
        }

        bounty.status = BountyStatus.Open;
        emit AttemptSettled(
            settlement.bountyId,
            settlement.attemptNonce,
            challenger,
            settlement.outcome,
            settlement.resultHash,
            0,
            0,
            0
        );
    }

    function forfeitTimedOutAttempt(uint256 bountyId) external nonReentrant {
        Bounty storage bounty = bounties[bountyId];
        if (bounty.status != BountyStatus.Active) revert InvalidStatus();
        if (block.timestamp < bounty.attemptDeadline + SETTLEMENT_GRACE) revert AttemptNotTimedOut();

        uint128 entry = bounty.entry;
        address challenger = bounty.challenger;
        address creator = bounty.creator;
        uint64 attemptNonce = bounty.attemptNonce;
        bounty.challenger = address(0);
        bounty.attemptDeadline = 0;
        bounty.status = BountyStatus.Open;
        emit TimedOutAttemptForfeited(bountyId, attemptNonce, challenger, creator, entry);
    }

    /// @notice Reopens an attempt after the settlement grace when the result
    /// could not be relayed for infrastructure reasons. The entry was already
    /// paid directly to the creator at entry time, so this path never invents
    /// a refund and never labels the challenger as having lost the match.
    function reopenTimedOutAttempt(uint256 bountyId) external nonReentrant {
        Bounty storage bounty = bounties[bountyId];
        if (bounty.status != BountyStatus.Active) revert InvalidStatus();
        if (block.timestamp < bounty.attemptDeadline + SETTLEMENT_GRACE) revert AttemptNotTimedOut();

        uint128 entry = bounty.entry;
        address challenger = bounty.challenger;
        address creator = bounty.creator;
        uint64 attemptNonce = bounty.attemptNonce;
        bounty.challenger = address(0);
        bounty.attemptDeadline = 0;
        bounty.status = BountyStatus.Open;
        emit TimedOutAttemptReopened(bountyId, attemptNonce, challenger, creator, entry);
    }

    function cancelBounty(uint256 bountyId) external nonReentrant {
        _cancel(bountyId, msg.sender);
    }

    /// @notice Allows the relayer to cancel an MPP-created bounty for its verified creator.
    function cancelBountyFor(address creator, uint256 bountyId)
        external
        onlyAgentRelayer
        nonReentrant
    {
        _cancel(bountyId, creator);
    }

    function expireBounty(uint256 bountyId) external nonReentrant {
        Bounty storage bounty = bounties[bountyId];
        if (bounty.status != BountyStatus.Open) revert InvalidStatus();
        if (bounty.expiresAt == 0 || block.timestamp < bounty.expiresAt) revert ExpiryRequired();

        bounty.challenger = address(0);
        bounty.attemptDeadline = 0;
        bounty.status = BountyStatus.Expired;
        _releaseReward(bounty.reward);
        _pushExact(bounty.creator, bounty.reward);
        emit BountyExpired(bountyId, bounty.creator, bounty.reward);
    }

    function setNewBountiesPaused(bool paused) external onlyPauseGuardian {
        newBountiesPaused = paused;
        emit NewBountiesPauseSet(paused);
    }

    function setNewEntriesPaused(bool paused) external onlyPauseGuardian {
        newEntriesPaused = paused;
        emit NewEntriesPauseSet(paused);
    }

    function getBounty(uint256 bountyId) external view returns (Bounty memory) {
        return bounties[bountyId];
    }

    function hashSettlement(Settlement calldata settlement) external view returns (bytes32) {
        return _hashTypedData(settlement);
    }

    function _validateCreate(bytes32 termsHash, uint128 reward, uint64 expiresAt) private view {
        if (newBountiesPaused) revert NewBountiesPaused();
        if (termsHash == bytes32(0)) revert InvalidTermsHash();
        if (reward == 0) revert AmountZero();
        if (expiresAt != 0 && expiresAt <= block.timestamp) revert InvalidTime();
    }

    function _create(
        address creator,
        bytes32 termsHash,
        uint128 reward,
        uint128 entry,
        uint64 expiresAt
    ) private returns (uint256 bountyId) {
        bountyId = nextBountyId++;
        bounties[bountyId] = Bounty({
            creator: creator,
            challenger: address(0),
            reward: reward,
            entry: entry,
            expiresAt: expiresAt,
            attemptDeadline: 0,
            attemptNonce: 0,
            status: BountyStatus.Open,
            termsHash: termsHash
        });
        reservedRewards += reward;
        emit BountyCreated(bountyId, creator, reward, entry, expiresAt, termsHash);
    }

    function _enter(uint256 bountyId, address challenger, address payer) private {
        if (newEntriesPaused) revert NewEntriesPaused();
        Bounty storage bounty = _openBounty(bountyId);
        if (challenger == bounty.creator) revert CallerIsCreator();

        if (bounty.entry != 0) _transferFromExact(payer, bounty.creator, bounty.entry);
        bounty.challenger = challenger;
        unchecked {
            ++bounty.attemptNonce;
        }
        bounty.attemptDeadline = uint64(block.timestamp + attemptWindow);
        bounty.status = BountyStatus.Active;
        emit AttemptEntered(bountyId, bounty.attemptNonce, challenger, bounty.attemptDeadline);
    }

    function _cancel(uint256 bountyId, address caller) private {
        Bounty storage bounty = bounties[bountyId];
        if (bounty.status != BountyStatus.Open) revert BountyNotOpen();
        if (caller != bounty.creator) revert CallerNotCreator();
        bounty.status = BountyStatus.Cancelled;
        _releaseReward(bounty.reward);
        _pushExact(bounty.creator, bounty.reward);
        emit BountyCancelled(bountyId, bounty.creator, bounty.reward);
    }

    function _releaseReward(uint128 amount) private {
        reservedRewards -= amount;
    }

    function _openBounty(uint256 bountyId) private view returns (Bounty storage bounty) {
        bounty = bounties[bountyId];
        if (bounty.status != BountyStatus.Open) revert BountyNotOpen();
        if (bounty.expiresAt != 0 && block.timestamp >= bounty.expiresAt) {
            revert BountyUnavailableAfterExpiry();
        }
    }

    function _hashTypedData(Settlement calldata settlement) private view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                SETTLEMENT_TYPEHASH,
                settlement.bountyId,
                settlement.attemptNonce,
                settlement.outcome,
                settlement.resultHash,
                settlement.validUntil
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    function _verifyQuorum(Settlement calldata settlement, bytes[] calldata signatures)
        private
        view
    {
        if (signatures.length != settlementQuorum) revert SignatureQuorumNotMet();
        bytes32 digest = _hashTypedData(settlement);
        address previous;
        uint256 approvals;
        for (uint256 i; i < signatures.length; ++i) {
            address signer = _recover(digest, signatures[i]);
            if (signer <= previous) revert SignaturesNotSorted();
            previous = signer;
            if (isSettlementSigner[signer]) {
                unchecked {
                    ++approvals;
                }
            }
        }
        if (approvals < settlementQuorum) revert SignatureQuorumNotMet();
    }

    function _recover(bytes32 digest, bytes calldata signature)
        private
        pure
        returns (address signer)
    {
        if (signature.length != 65) revert InvalidSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v != 27 && v != 28 || uint256(s) > SECP256K1N_HALF) revert InvalidSignature();
        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
    }

    function _pullExact(address from, uint128 amount) private {
        uint256 beforeBalance = token.balanceOf(address(this));
        _callToken(abi.encodeCall(IERC20.transferFrom, (from, address(this), amount)));
        if (token.balanceOf(address(this)) != beforeBalance + amount) {
            revert TokenBalanceMismatch();
        }
    }

    function _transferFromExact(address from, address to, uint128 amount) private {
        uint256 beforeBalance = token.balanceOf(to);
        _callToken(abi.encodeCall(IERC20.transferFrom, (from, to, amount)));
        if (token.balanceOf(to) != beforeBalance + amount) {
            revert TokenBalanceMismatch();
        }
    }

    function _pushExact(address to, uint128 amount) private {
        if (amount == 0) return;
        uint256 beforeBalance = token.balanceOf(address(this));
        _callToken(abi.encodeCall(IERC20.transfer, (to, amount)));
        if (token.balanceOf(address(this)) != beforeBalance - amount) {
            revert TokenBalanceMismatch();
        }
    }

    function _callToken(bytes memory callData) private {
        (bool ok, bytes memory returnData) = address(token).call(callData);
        if (!ok || (returnData.length != 0 && !abi.decode(returnData, (bool)))) {
            revert TokenTransferFailed();
        }
    }

    receive() external payable {
        revert DirectNativeCurrencyRejected();
    }

    fallback() external payable {
        revert DirectNativeCurrencyRejected();
    }
}
