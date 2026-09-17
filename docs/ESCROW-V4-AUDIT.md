# V4 escrow audit notes

This is a review of `contracts/src/WarMachineBountyEscrowV4.sol` and its deployment script. It is a code-level audit record, not a third-party security audit.

## Findings

| Severity | Finding | Consequence | Required operating control |
| --- | --- | --- | --- |
| High | V4 is deployed with `MAX_SETTLEMENT_SIGNERS = 1` and a 1-of-1 quorum. | Compromise or loss of the single result signer can fabricate or block every settlement. | Keep the signer key out of the Worker where possible; use an independently reviewed 2-of-2 contract version before public funds. |
| High | `createBountyFor` and `enterBountyFor` spend the immutable relayer's token balance and allowance. | A compromised relayer can burn its allowance or create griefing transactions, although it cannot change the escrow fee recipient or settlement result. | Use a dedicated low-balance relayer, exact allowances, per-request limits, nonce lanes and an emergency pause guardian. |
| Medium | Guardian, relayer, signer set and token are immutable. | A lost key or bad deployment cannot be rotated or upgraded. | Verify constructor arguments and bytecode before funding; keep a replacement deployment procedure. |
| Medium | Settlement is an off-chain deterministic-game oracle. | Valid signatures prove signer approval, not that the replay was honest. | Persist the exact replay, engine hash, seed, terms hash and settlement payload; independently review the signer service. |
| Low | The contract rejects `TechnicalRefund` in `settleAttempt`; only win or loss/draw are valid onchain outcomes. | A technical failure must use the application recovery path or a separately reviewed contract version. | Keep technical-failure handling fail-closed and never invent a winning result. |

## Verified invariants

- The token is immutable and is the constructor's pathUSD address; arbitrary TIP-20 tokens cannot be deposited, reserved or paid out.
- Reward reserves increase only when a bounty is created and are released on a winner, creator cancellation or idle expiry. Losses, draws and a missed counter deadline reopen the bounty while the reward remains reserved.
- The relayer methods preserve the payer address as the creator or challenger argument, and only the immutable relayer can call them.
- The 2.5% fee recipient and fee basis points are immutable constants. A winner receives `reward - floor(reward * 250 / 10000)`.
- Exact balance-delta checks reject fee-on-transfer or silently short-paying token behavior.
- EIP-712 signatures bind chain ID, contract address, bounty ID, attempt nonce, result hash and expiry. Signatures must be unique, sorted and low-s.

## Multi-token decision

Do not add an arbitrary-token escrow branch to V4. The application now publishes an operator allowlist of Tempo stablecoins and uses mppx `autoSwap` to atomically approve, swap the exact pathUSD output through Tempo's DEX and transfer pathUSD. The Worker verifies the pathUSD transfer before invoking `createBountyFor` or `enterBountyFor`. This keeps one accounting unit and avoids token-specific reserve, fee and payout bugs. Adding a token to the allowlist is an operational change; changing the escrow token requires a new deployment and migration.

## Pre-deployment checks

1. Compile and run the V4 Foundry tests.
2. Verify the constructor token, guardian, relayer, signer and 600-second window in the deployment output.
3. Confirm the relayer has the exact pathUSD allowance and enough pathUSD for the configured MPP maximum plus Tempo transaction fees.
4. Confirm `WM_BOUNTY_ESCROW_ADDRESS` and `WM_ESCROW_SETTLEMENT_SIGNER` match the new V4 constructor and that the Worker reports `activation: ready`.
5. Run one tiny create, one tiny entry, a deterministic win, a deterministic loss and a timeout on a fresh database. Check the explorer events and final token balances before raising limits.
