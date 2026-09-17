# Tempo mainnet operations

War Machines uses a non-upgradeable pathUSD bounty escrow on Tempo Mainnet. The game worker prepares an exact wallet transaction, verifies the resulting contract event, and stores immutable game terms. It never receives player pathUSD or holds a payout key.

| Item         | Value                                                                          |
| ------------ | ------------------------------------------------------------------------------ |
| Chain        | Tempo Mainnet `4217`                                                           |
| Token        | pathUSD `0x20C0000000000000000000000000000000000000` (6 decimals)              |
| Escrow       | [Bounty Escrow v2](https://explore.tempo.xyz/address/0x7ce840C9A852721E9b87d1FA028D0a988aee0f8e) — source verified |
| Fee          | 2.5% of a winning gross reward to `0xc20131e9132888993de6519D486E5558A5DbCb7A` |
| Settlement   | Two fixed EIP-712 result signatures within a 600-second attempt window         |
| Verification | [Sourcify match](https://contracts.tempo.xyz/verify-ui/jobs/c14fe4d2-651b-4adc-9670-19b5e726ffb8) |

## Bounty flow

1. The creator approves the exact gross reward and calls `createBounty` directly from their wallet.
2. A challenger approves the exact entry and calls `enterBounty` directly from their wallet. That confirmed entry reveals the defender only to the challenger; public routes retain a cost, mass, part-count, weapon-count, terrain and limit summary.
3. The challenger gets the current construction window, then deploys one counter before the deadline. The worker records the deterministic replay and its hash.
4. Two result keystores sign the escrow's exact EIP-712 settlement payload. Anyone can relay `settleAttempt`; the escrow verifies both signatures and sends the winner payout, platform fee, and entry recipient payment itself.
5. A creator can cancel an idle bounty. A loss or draw pays the entry to the bounty creator once two result signatures attest it. A missed clock or unsigned timeout can be finalized onchain by anyone; it also pays the entry to the creator. Only idle bounties can expire and return their unused reward.

## Local result signing

For the current small private trial, result keystores remain only in local encrypted Foundry keystores. The Site, D1 database, Git repository, browser bundle, and environment settings contain no signer password or private key.

After an attempt reaches **awaiting signatures**, run this from the desktop repository. Foundry asks locally for each keystore password; the script only sends two completed signatures back to the API and never broadcasts a transaction.

```powershell
.\scripts\attest-escrow-result.ps1 -AttemptId <attempt UUID> -Origin https://your-site.example
```

Then the browser shows **Settle onchain**, which submits the verified contract call from a wallet. The signer service must attest before the escrow deadline. When it does not, `forfeitTimedOutAttempt` is the public onchain finalizer and sends the entry to the bounty creator.

This manual operation is acceptable only for an extremely small private rehearsal. A public release needs separate signer operators, a reviewed replay/attestation service, monitoring, and an independent Solidity/security review.

## MPP scope

MPP is deliberately separate from bounty funding. Standard MPP Tempo charges transfer or settle service payments; they cannot call this escrow's `createBounty` or `enterBounty` functions. The Worker can expose separately priced agent API work only when all of these are configured:

```text
WM_AGENT_MPP_ENABLED=true
WM_AGENT_MPP_RECIPIENT=<separate service payee address>
WM_AGENT_MPP_PRICE=<exact positive pathUSD decimal>
MPP_SECRET_KEY=<32+ character server secret>
```

That enables `POST /api/agent/practice` for MPP-capable agents. It is a separately priced simulation service: it never funds a bounty, pays an entry, decides a winner, or receives the 2.5% bounty fee.

## Site configuration

Set only the pinned public escrow address to enable wallet bounty calls:

```text
WM_MODE=tempo-mainnet
WM_BOUNTY_ESCROW_ADDRESS=0x7ce840C9A852721E9b87d1FA028D0a988aee0f8e
```

The Worker fails closed when the address differs. `WM_TEMPO_RPC_URL` is optional and defaults to `https://rpc.tempo.xyz`.

Do not send pathUSD straight to the escrow address. Use the contract methods prepared by the game, or call the verified ABI yourself after checking its terms. The contract is source-verified, not independently audited.
