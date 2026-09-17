# Tempo mainnet operations

War Machines uses a non-upgradeable pathUSD bounty escrow on Tempo Mainnet. V3 is the direct-wallet deployment; V4 adds a narrowly bounded native MPP relayer for agent create/entry calls. The Worker verifies the resulting contract event and stores immutable game terms.

| Item         | Value                                                                          |
| ------------ | ------------------------------------------------------------------------------ |
| Chain        | Tempo Mainnet `4217`                                                           |
| Token        | pathUSD `0x20C0000000000000000000000000000000000000` (6 decimals)              |
| Escrow       | [Bounty Escrow v2](https://explore.tempo.xyz/address/0x7ce840C9A852721E9b87d1FA028D0a988aee0f8e) — source verified |
| Fee          | 2.5% of a winning gross reward to `0xc20131e9132888993de6519D486E5558A5DbCb7A` |
| Settlement   | Two fixed EIP-712 result signatures within a 600-second attempt window         |
| Verification | [Sourcify match](https://contracts.tempo.xyz/verify-ui/jobs/c14fe4d2-651b-4adc-9670-19b5e726ffb8) |

The table retains the historical deployed escrow reference. The current Worker pins V3 at `0xb14a3aA99C9349094612143089F55aE5372DeB24`; native MPP requires the separately deployed V4 address and its configured relayer.

## Bounty flow

1. In direct mode, the creator approves the exact gross reward and calls `createBounty` directly from their wallet. In V4 native MPP mode, the agent pays the exact reward to the configured relayer and the relayer calls `createBountyFor` with the payer address.
2. In direct mode, a challenger approves the exact entry and calls `enterBounty` directly from their wallet. In V4 native MPP mode, the agent pays the exact entry and the relayer calls `enterBountyFor` with the payer address. That confirmed entry reveals the defender only to the challenger; public routes retain a cost, mass, part-count, weapon-count, terrain and limit summary.
3. The challenger gets the current construction window, then deploys one counter before the deadline. The worker records the deterministic replay and its hash.
4. The configured result signer quorum signs the escrow's exact EIP-712 settlement payload. Anyone can relay `settleAttempt`; the escrow verifies the signatures and sends the winner payout, platform fee, and entry recipient payment itself.
5. A creator can cancel an idle bounty. A loss or draw pays the entry to the bounty creator once two result signatures attest it. A missed clock or unsigned timeout can be finalized onchain by anyone; it also pays the entry to the creator. Only idle bounties can expire and return their unused reward.

## Local result signing

For the current small private trial, result keystores remain only in local encrypted Foundry keystores. The Site, D1 database, Git repository, browser bundle, and environment settings contain no signer password or private key.

After an attempt reaches **awaiting signatures**, run this from the desktop repository. Foundry asks locally for each keystore password; the script only sends two completed signatures back to the API and never broadcasts a transaction.

```powershell
.\scripts\attest-escrow-result.ps1 -AttemptId <attempt UUID> -Origin https://your-site.example
```

Then the browser shows **Settle onchain**, which submits the verified contract call from a wallet. The signer service must attest before the escrow deadline. When it does not, `forfeitTimedOutAttempt` is the public onchain finalizer and sends the entry to the bounty creator.

This manual operation is acceptable only for an extremely small private rehearsal. A public release needs separate signer operators, a reviewed replay/attestation service, monitoring, and an independent Solidity/security review.

## Native MPP bounty mode

V4 enables a native MPP payment challenge on `POST /api/bounties` and `POST /api/bounties/:id/attempts`. The client satisfies the exact reward or entry challenge and retries the same request; the Worker persists the payment, relays the matching V4 method, verifies finality and returns the normal bounty or attempt response. The relayer is not allowed to choose a different payer, recipient, reward, entry, terms hash or bounty ID.

```text
WM_BOUNTY_ESCROW_VERSION=4
WM_BOUNTY_ESCROW_ADDRESS=<deployed V4 escrow address>
WM_BOUNTY_RELAYER_ADDRESS=<same address passed to the V4 constructor>
WM_BOUNTY_RELAYER_PRIVATE_KEY=<Worker secret for that relayer>
WM_AGENT_BOUNTY_MPP_ENABLED=true
WM_AGENT_BOUNTY_MPP_MAX=1.00
MPP_SECRET_KEY=<32+ character server secret>
```

The relayer must hold enough pathUSD for reward/entry forwarding and fee payment, and must approve the deployed V4 escrow for the configured maximum relay amount. The Worker secret is the only private value in this list; never put it in Git, D1 or the browser. A zero-value MPP proof remains available for later deploy, settle and control calls.

The optional `/api/agent/practice` charge remains separately configured with `WM_AGENT_MPP_ENABLED`, `WM_AGENT_MPP_RECIPIENT` and `WM_AGENT_MPP_PRICE`.

## Site configuration

For the current direct-wallet deployment:

```text
WM_MODE=tempo-mainnet
WM_BOUNTY_ESCROW_VERSION=3
WM_BOUNTY_ESCROW_ADDRESS=0xb14a3aA99C9349094612143089F55aE5372DeB24
```

For V4 native MPP, set `WM_BOUNTY_ESCROW_VERSION=4` and replace the address with the newly deployed V4 address. The Worker fails closed when the version/address/relayer configuration is incomplete. `WM_TEMPO_RPC_URL` is optional and defaults to `https://rpc.tempo.xyz`.

Do not send pathUSD straight to the escrow address. Use the contract methods prepared by the game, or call the verified ABI yourself after checking its terms. The contract is source-verified, not independently audited.
