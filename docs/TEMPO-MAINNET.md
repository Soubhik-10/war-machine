# Tempo mainnet operations

War Machines uses a non-upgradeable pathUSD bounty escrow on Tempo Mainnet. V3 and V4 are historical deployments; V5 is the current direct-wallet and native-MPP release. It adds a bounded relayer and a two-minute settlement grace so an on-time result is not turned into a player loss by a short relay outage. Active V5 intentionally has one trusted settlement signer; it does not provide independent two-signer protection. The Worker verifies the resulting contract event and stores immutable game terms.

| Item         | Value                                                                          |
| ------------ | ------------------------------------------------------------------------------ |
| Chain        | Tempo Mainnet `4217`                                                           |
| Token        | pathUSD `0x20C0000000000000000000000000000000000000` (6 decimals)              |
| Escrow       | [Bounty Escrow v2](https://explore.tempo.xyz/address/0x7ce840C9A852721E9b87d1FA028D0a988aee0f8e) — source verified |
| Fee          | 2.5% of a winning gross reward to `0xc20131e9132888993de6519D486E5558A5DbCb7A` |
| Settlement   | One configured EIP-712 result signer within a 600-second attempt window plus 120-second V5 relay grace |
| Verification | [Sourcify match](https://contracts.tempo.xyz/verify-ui/jobs/c14fe4d2-651b-4adc-9670-19b5e726ffb8) |

The table retains the historical deployed escrow reference. The current Worker can read V3/V4 records, but new paid actions require the separately deployed V5 address, its configured relayer and its settlement signer.

## Bounty flow

1. In direct mode, the creator approves the exact gross reward and calls `createBounty` directly from their wallet. In V5 native MPP mode, the agent pays the exact reward to the configured relayer and the relayer calls `createBountyFor` with the payer address.
2. In direct mode, a challenger approves the exact entry and calls `enterBounty` directly from their wallet. In V5 native MPP mode, the agent pays the exact entry and the relayer calls `enterBountyFor` with the payer address. That confirmed entry reveals the defender only to the challenger; public routes retain a cost, mass, part-count, weapon-count, terrain and limit summary.
3. The challenger gets the current construction window, then deploys one counter before the deadline. The worker records the deterministic replay and its hash.
4. The configured result signer signs the escrow's exact EIP-712 settlement payload. Anyone can relay `settleAttempt`; V5 accepts a bounded result during its two-minute relay grace and the escrow sends the winner payout and platform fee itself.
5. A creator can cancel an idle bounty. A loss or draw reopens the bounty and leaves the already-paid entry with the creator. A missed build deadline is a real loss and is finalized with `forfeitTimedOutAttempt`. If an on-time result misses the V5 settlement grace for infrastructure reasons, the Worker calls `reopenTimedOutAttempt`, marks the attempt technical rather than lost, and gives that challenger one sponsored retry without another entry payment. This technical path is a retry credit, not a refund of the original entry. Only idle bounties can expire and return their unused reward.

## Local result signing

The active ChatGPT Sites deployment keeps the one V5 settlement signing secret in a protected server-side Worker secret binding. It is never sent to the browser or stored in D1, Git, public configuration, or logs. An offline encrypted Foundry keystore remains an optional local or recovery path; it is not the active two-signer model.

After an attempt reaches **awaiting signatures**, the trusted Worker signs and submits the exact settlement transaction using that configured signer. An operator may run the desktop script for a local or recovery operation; it must use one approved signer and must not be described as independent multi-signer protection.

```powershell
.\scripts\attest-escrow-result.ps1 -AttemptId <attempt UUID> -Origin https://your-site.example
```

The Worker updates the settlement state after the signer submission and finalized receipt. V5 still accepts the verified result during its two-minute grace. When a committed result cannot be relayed after grace, the Worker uses `reopenTimedOutAttempt` and issues the one-time free retry. Only a missing build uses `forfeitTimedOutAttempt` and records a user loss.

This manual operation is an optional local or recovery rehearsal. The active V5 release uses one trusted Worker signer; keep the trial amount bounded, monitor settlement, and obtain an independent Solidity/security review before increasing exposure.

## Native MPP bounty mode

V5 enables a native MPP payment challenge on `POST /api/bounties` and `POST /api/bounties/:id/attempts`. The client satisfies the exact reward or entry challenge and retries the same request; the Worker persists the payment, relays the matching V5 method, verifies finality and returns the normal bounty or attempt response. The relayer is not allowed to choose a different payer, recipient, reward, entry, terms hash or bounty ID.

```text
WM_BOUNTY_ESCROW_VERSION=5
WM_BOUNTY_ESCROW_ADDRESS=<deployed V5 escrow address>
WM_ESCROW_SETTLEMENT_SIGNER=<public signer passed to the V5 constructor>
WM_BOUNTY_RELAYER_ADDRESS=<same address passed to the V5 constructor>
WM_BOUNTY_RELAYER_PRIVATE_KEY=<Worker secret for that relayer>
WM_AGENT_BOUNTY_MPP_ENABLED=true
WM_AGENT_BOUNTY_MPP_MAX=1.00
MPP_SECRET_KEY=<32+ character server secret>
```

The relayer must hold enough pathUSD for reward/entry forwarding and fee payment, and must approve the deployed V5 escrow for the configured maximum relay amount. Native MPP temporarily places the payer's pathUSD under the bounded relayer's control before the matching escrow call; reconcile failed forwards and keep the exposure bounded. The Worker secret is the only private value in this list; never put it in Git, D1 or the browser. Native MPP is used for paid bounty creation and entry; browser sessions continue to use the Tempo Wallet path for the same operations.


### Allowlisted stablecoin inputs

The escrow deliberately remains single-token: it holds and settles pathUSD, which keeps reward reserves, exact balance deltas and payout accounting unambiguous. V5 MPP clients can still pay from other operator-reviewed Tempo stablecoins. Set the public `WM_TEMPO_SUPPORTED_TOKENS` list and optional `WM_TEMPO_SWAP_SLIPPAGE_BPS` (0–500; default 100). The mppx client uses `autoSwap` to quote and atomically approve, swap the exact pathUSD output, and transfer pathUSD to the MPP recipient. The Worker verifies the pathUSD transfer and relays only the matching V5 call. A source token is never sent directly to the escrow, and an unlisted token or missing DEX route fails before broadcast.

```text
WM_TEMPO_SUPPORTED_TOKENS=0x20C0000000000000000000000000000000000000,0x20C000000000000000000000b9537d11c60E8b50
WM_TEMPO_SWAP_SLIPPAGE_BPS=100
```

All TIP-20 source addresses must be checked against Tempo Mainnet liquidity before adding them. Testnet-only faucet tokens are not automatically valid mainnet inputs.

## Site configuration

For the current direct-wallet deployment:

```text
WM_MODE=tempo-mainnet
WM_BOUNTY_ESCROW_VERSION=3
WM_BOUNTY_ESCROW_ADDRESS=0xb14a3aA99C9349094612143089F55aE5372DeB24
```

For V5 native MPP, set `WM_BOUNTY_ESCROW_VERSION=5`, replace the address with the newly deployed V5 address, and set `WM_ESCROW_SETTLEMENT_SIGNER` to the public signer passed to the V5 constructor. The Worker fails closed when the version/address/signer/relayer configuration is incomplete. `WM_TEMPO_RPC_URL` is optional and defaults to `https://rpc.tempo.xyz`.

Do not send pathUSD straight to the escrow address. Use the contract methods prepared by the game, or call the verified ABI yourself after checking its terms. The contract is source-verified, not independently audited.
