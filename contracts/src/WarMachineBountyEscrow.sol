// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Minimal ERC-20 interface. pathUSD is a TIP-20 / ERC-20 compatible token on Tempo.
interface IERC20 {
    function balanceOf(address account) external view returns (uint256);

    function transfer(address to, uint256 amount) external returns (bool);

    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice A non-upgradeable, pathUSD bounty escrow for War Machines.
/// @dev It holds reserves itself. The settlement quorum only attests an already-running attempt;
///      it cannot choose an amount, recipient, fee, or withdraw unrelated reserves.
contract WarMachineBountyEscrow {
    uint16 public constant PLATFORM_FEE_BPS = 250;
    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint8 public constant MIN_SETTLEMENT_QUORUM = 2;
    uint8 public constant MAX_SETTLEMENT_SIGNERS = 5;
    // A paid build needs three to five minutes plus time for the two result
    // attestations to be relayed. Shorter windows turn signer latency into a
    // player loss, so deployments cannot opt into one accidentally.
    uint64 public constant MIN_ATTEMPT_WINDOW = 8 minutes;
    uint64 public constant MAX_ATTEMPT_WINDOW = 1 hours;
    /// @notice The disclosed 2.5% reward-fee recipient. It is part of the deployed bytecode,
    ///         not a deploy-time setting that could be accidentally substituted.
    address public constant PLATFORM_FEE_RECIPIENT = 0xc20131e9132888993de6519D486E5558A5DbCb7A;

    bytes32 public constant SETTLEMENT_TYPEHASH = keccak256(
        "Settlement(uint256 bountyId,uint64 attemptNonce,uint8 outcome,bytes32 resultHash,uint64 validUntil)"
    );
    bytes32 private constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant NAME_HASH = keccak256("War Machines Bounty Escrow");
    bytes32 private constant VERSION_HASH = keccak256("2");
    // secp256k1n / 2. Rejecting high-s signatures prevents signature malleability.
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

    /// @notice The signed, immutable result summary. Full replay data remains off-chain and is
    ///         committed by resultHash for auditing.
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
        uint128 entry
    );
    event NewBountiesPauseSet(bool paused);
    event NewEntriesPauseSet(bool paused);

    IERC20 public immutable token;
    address public immutable pauseGuardian;
    uint64 public immutable attemptWindow;
    uint8 public immutable settlementQuorum;
    bytes32 public immutable DOMAIN_SEPARATOR;

    uint256 public nextBountyId = 1;
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

    constructor(
        IERC20 token_,
        address pauseGuardian_,
        uint64 attemptWindow_,
        address[] memory settlementSigners_,
        uint8 settlementQuorum_
    ) {
        if (address(token_) == address(0) || pauseGuardian_ == address(0)) {
            revert InvalidAddress();
        }
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
            if (signer == address(0) || isSettlementSigner[signer]) {
                revert InvalidSignerConfiguration();
            }
            isSettlementSigner[signer] = true;
        }

        token = token_;
        pauseGuardian = pauseGuardian_;
        attemptWindow = attemptWindow_;
        settlementQuorum = settlementQuorum_;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)
            )
        );
    }

    /// @notice Opens a funded bounty. `termsHash` must commit the defender, combat engine release,
    ///         terrain, cost caps, fee policy copy, and public rules displayed to participants.
    function createBounty(bytes32 termsHash, uint128 reward, uint128 entry, uint64 expiresAt)
        external
        nonReentrant
        returns (uint256 bountyId)
    {
        if (newBountiesPaused) revert NewBountiesPaused();
        if (termsHash == bytes32(0)) revert InvalidTermsHash();
        if (reward == 0) revert AmountZero();
        if (expiresAt != 0 && expiresAt <= block.timestamp) revert InvalidTime();

        bountyId = nextBountyId++;
        bounties[bountyId] = Bounty({
            creator: msg.sender,
            challenger: address(0),
            reward: reward,
            entry: entry,
            expiresAt: expiresAt,
            attemptDeadline: 0,
            attemptNonce: 0,
            status: BountyStatus.Open,
            termsHash: termsHash
        });

        _pullExact(msg.sender, reward);
        emit BountyCreated(bountyId, msg.sender, reward, entry, expiresAt, termsHash);
    }

    /// @notice Escrows one entry payment and starts the oracle settlement window.
    ///         The creator cannot enter their own bounty.
    function enterBounty(uint256 bountyId) external nonReentrant {
        if (newEntriesPaused) revert NewEntriesPaused();
        Bounty storage bounty = _openBounty(bountyId);
        if (msg.sender == bounty.creator) revert CallerIsCreator();

        uint128 entry = bounty.entry;
        if (entry != 0) _pullExact(msg.sender, entry);

        bounty.challenger = msg.sender;
        unchecked {
            ++bounty.attemptNonce;
        }
        bounty.attemptDeadline = uint64(block.timestamp + attemptWindow);
        bounty.status = BountyStatus.Active;
        emit AttemptEntered(bountyId, bounty.attemptNonce, msg.sender, bounty.attemptDeadline);
    }

    /// @notice Settles the active attempt. The backend supplies a 2-of-N (or configured quorum)
    ///         EIP-712 attestation. Signers can only select an outcome for this active challenger.
    function settleAttempt(Settlement calldata settlement, bytes[] calldata signatures)
        external
        nonReentrant
    {
        Bounty storage bounty = bounties[settlement.bountyId];
        if (bounty.status != BountyStatus.Active) revert InvalidStatus();
        if (settlement.attemptNonce != bounty.attemptNonce) revert InvalidStatus();
        if (uint8(settlement.outcome) > uint8(Outcome.TechnicalRefund)) revert InvalidOutcome();
        if (settlement.validUntil < block.timestamp) revert SignatureExpired();
        // No result can be manufactured after the active-attempt deadline.
        // The public timeout finalizer below settles that liveness failure as
        // a disclosed loss to the bounty creator instead.
        if (
            block.timestamp >= bounty.attemptDeadline
                || settlement.validUntil > bounty.attemptDeadline
        ) {
            revert InvalidTime();
        }

        _verifyQuorum(settlement, signatures);

        address challenger = bounty.challenger;
        uint128 reward = bounty.reward;
        uint128 entry = bounty.entry;
        bounty.challenger = address(0);
        bounty.attemptDeadline = 0;

        if (settlement.outcome == Outcome.ChallengerWon) {
            uint128 fee = uint128(uint256(reward) * PLATFORM_FEE_BPS / BPS_DENOMINATOR);
            uint128 payout = reward - fee;
            bounty.status = BountyStatus.Claimed;
            _pushExact(challenger, payout);
            if (fee != 0) _pushExact(PLATFORM_FEE_RECIPIENT, fee);
            if (entry != 0) _pushExact(bounty.creator, entry);
            emit AttemptSettled(
                settlement.bountyId,
                settlement.attemptNonce,
                challenger,
                settlement.outcome,
                settlement.resultHash,
                payout,
                fee,
                entry
            );
            return;
        }

        if (settlement.outcome == Outcome.ChallengerLostOrDrew) {
            // The bounty stays funded and may be attempted again. The creator receives the
            // explicitly disclosed entry amount; it is never silently retained by the platform.
            bounty.status = BountyStatus.Open;
            if (entry != 0) _pushExact(bounty.creator, entry);
            emit AttemptSettled(
                settlement.bountyId,
                settlement.attemptNonce,
                challenger,
                settlement.outcome,
                settlement.resultHash,
                0,
                0,
                entry
            );
            return;
        }

        bounty.status = BountyStatus.Open;
        if (entry != 0) _pushExact(challenger, entry);
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

    /// @notice Finalizes an unsigned active attempt after its immutable deadline.
    ///         Anybody may call it; it never pays the caller. The entry follows the
    ///         disclosed loss/draw route to the bounty creator and the reward stays funded.
    function forfeitTimedOutAttempt(uint256 bountyId) external nonReentrant {
        Bounty storage bounty = bounties[bountyId];
        if (bounty.status != BountyStatus.Active) revert InvalidStatus();
        if (block.timestamp < bounty.attemptDeadline) revert AttemptNotTimedOut();

        uint128 entry = bounty.entry;
        address challenger = bounty.challenger;
        address creator = bounty.creator;
        uint64 attemptNonce = bounty.attemptNonce;
        bounty.challenger = address(0);
        bounty.attemptDeadline = 0;
        bounty.status = BountyStatus.Open;
        if (entry != 0) _pushExact(creator, entry);
        emit TimedOutAttemptForfeited(bountyId, attemptNonce, challenger, creator, entry);
    }

    /// @notice Cancels an open bounty. A creator may never pull reserves while a challenger is active.
    function cancelBounty(uint256 bountyId) external nonReentrant {
        Bounty storage bounty = bounties[bountyId];
        if (bounty.status != BountyStatus.Open) revert BountyNotOpen();
        if (msg.sender != bounty.creator) revert CallerNotCreator();
        bounty.status = BountyStatus.Cancelled;
        _pushExact(bounty.creator, bounty.reward);
        emit BountyCancelled(bountyId, bounty.creator, bounty.reward);
    }

    /// @notice Expiry returns an idle bounty's unused reward reserve. An active bounty must
    ///         first settle or reach the public timeout finalizer, so expiry can never refund
    ///         an active challenger's entry.
    function expireBounty(uint256 bountyId) external nonReentrant {
        Bounty storage bounty = bounties[bountyId];
        if (bounty.status != BountyStatus.Open) revert InvalidStatus();
        if (bounty.expiresAt == 0 || block.timestamp < bounty.expiresAt) revert ExpiryRequired();

        bounty.challenger = address(0);
        bounty.attemptDeadline = 0;
        bounty.status = BountyStatus.Expired;
        _pushExact(bounty.creator, bounty.reward);
        emit BountyExpired(bountyId, bounty.creator, bounty.reward);
    }

    /// @notice Stops new funding only. It cannot freeze settlements, cancellation, expiry, or timeout finalization.
    function setNewBountiesPaused(bool paused) external onlyPauseGuardian {
        newBountiesPaused = paused;
        emit NewBountiesPauseSet(paused);
    }

    /// @notice Stops new entries only. It cannot freeze withdrawals owed to participants.
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
        if (signatures.length < settlementQuorum) revert SignatureQuorumNotMet();
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
