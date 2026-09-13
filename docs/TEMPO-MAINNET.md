# Tempo mainnet operations

## Current status

War Machines has a source-verified, non-upgradeable pathUSD bounty escrow on Tempo Mainnet:

- **Escrow:** [`0x461eefD1c4bcbE76C470487cF18b892fCD76d494`](https://explore.tempo.xyz/address/0x461eefD1c4bcbE76C470487cF18b892fCD76d494)
- **Chain:** Tempo Mainnet (`4217`)
- **Token:** pathUSD, `0x20C0000000000000000000000000000000000000`, 6 decimals
- **Fee:** fixed 2.5% of the gross winner reward to `0xc20131e9132888993de6519D486E5558A5DbCb7A`
- **Verification:** [Tempo contract verification record](https://contracts.tempo.xyz/verify-ui/jobs/bad196c7-ed62-47b3-863b-5adb3d682f5b)

The exact public configuration is versioned in [`contracts/deployments/tempo-mainnet.json`](../contracts/deployments/tempo-mainnet.json). The public Site still accepts **no Tempo funds**. Its legacy MPP charge plus server-signer payout route is permanently disabled in `sites/worker/mainnet.mjs`; environment variables cannot re-enable it.

## What must be built before paid bounties open

1. Direct browser wallet integration for `approve`, `createBounty`, `enterBounty`, timeout refund, creator cancellation and expiry.
2. A distinct, protected result service that replays each accepted match, saves a canonical result/replay hash, and obtains the escrow's two required EIP-712 settlement signatures.
3. Event indexing and durable reconciliation for the deployed escrow. The Site must treat on-chain events and view calls as the financial source of truth.
4. A real-wallet rehearsal using tiny amounts from two wallets, including invalid approvals, signer disagreement, timeout refund, expiry, cancellation, win, loss, draw and pause behavior.
5. An independent Solidity/security review, operator runbook, monitoring, key recovery, and a legal/provider review for paid-entry prize activity.

Until these are complete, game credits are demo-only and cannot be redeemed or converted to pathUSD.

## Security boundaries

- The escrow holds funds. The web backend must never custody player pathUSD or possess a general payout key.
- The pause guardian can stop new bounties and entries but cannot move funds or block exits.
- A settlement requires both configured signers. Put them in separate protected controls before public launch; do not store either key in ChatGPT Sites, D1, browser code, a repository, or a shared environment file.
- MPP `tempo.session` is an agent-to-service payment channel. It is useful for metered API work, but it cannot decide a game winner or replace the bounty escrow.
- A source-verified contract is not an independent security audit. The contract should not receive significant user funds before the review and rehearsal above.

Tempo references: [Foundry](https://docs.tempo.xyz/sdk/foundry), [contract verification](https://docs.tempo.xyz/quickstart/verify-contracts), [pathUSD](https://docs.tempo.xyz/protocol/exchange/pathUSD).
