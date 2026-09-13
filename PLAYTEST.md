# Verification record

Current implementation and balance evidence: [docs/BALANCE-REPORT.md](docs/BALANCE-REPORT.md).

## Latest release checks

- Direct Tempo mainnet escrow is pinned to chain 4217 and pathUSD.
- Creator funding, challenger entry, cancellation, expiry, refund, signature registration, and settlement receipt verification are covered by Worker tests.
- The Solidity escrow suite covers payout calculation, platform fee, signer quorum, deadline recovery, cancellation, expiry, pause behavior, and access control.
- Factory, terrain, construction, deterministic replay, mobile layout, camera, part guidance, and agent API checks run in the project test suite.
- The landing page, Bounties, and Agents page identify the live direct-escrow flow; MPP is only described for separately priced agent services.

## Controlled value rehearsal

Before increasing a bounty amount, run a two-wallet rehearsal that covers:

1. Creator approval and bounty creation.
2. Challenger approval and entry.
3. Win, loss, draw, and technical-refund outcomes.
4. Both result signer attestations and on-chain settlement.
5. Creator cancellation, expiry release, and challenger deadline recovery.
6. Incorrect token approval, malformed receipt, late attestation, and paused-contract behavior.

The public release uses direct wallet calls and a manual two-signer result operation. It does not claim automated settlement or an independent security audit.
