# Payment operations

## Live bounty rail

War Machines uses direct pathUSD escrow on Tempo mainnet, with a V5 native MPP lane for stateless agent create/entry. V5 is required for new paid bounties because it adds settlement grace and technical recovery.

- Chain: Tempo Mainnet `4217`
- pathUSD: `0x20C0000000000000000000000000000000000000` (6 decimals)
- Escrow: [Bounty Escrow v2](https://explore.tempo.xyz/address/0x7ce840C9A852721E9b87d1FA028D0a988aee0f8e) ([Sourcify match](https://contracts.tempo.xyz/verify-ui/jobs/c14fe4d2-651b-4adc-9670-19b5e726ffb8))
- Platform fee: 2.5% of the gross winning reward to `0xc20131e9132888993de6519D486E5558A5DbCb7A`

The browser prepares the exact approval and escrow calls in direct mode. In native MPP mode, the Worker relays only the matching V5 method after the exact MPP payment is finalized. The Worker verifies receipts, binds locked rules and builds to the result, and records attestation state.

## Settlement

1. The creator approves pathUSD and calls `createBounty`.
2. The challenger approves pathUSD and calls `enterBounty`.
3. The Worker reveals the defender to that paid challenger only and opens the construction window. Public viewers continue to receive only the scout summary.
4. The challenger validates locally and deploys one counter. The Worker computes the deterministic result and returns the EIP-712 settlement payload.
5. The trusted Sites Worker uses the configured V5 settlement signing secret to produce the one required signature. An operator may use `scripts/attest-escrow-result.ps1` with an encrypted keystore for a local or recovery run; the active V5 trial has one signer and therefore relies on that trusted operator. The independent multi-signer procedure below is retained as legacy/future deployment guidance.
6. Any wallet can relay `settleAttempt` after the configured signer signature has been registered.

The current deployment uses a ten-minute attempt window. The Worker gives the challenger a cost-scaled three-to-five-minute build window, then retains time for the configured signer and relay plus a two-minute V5 grace. A loss, draw, or missed counter deadline settles the entry to the bounty creator. If settlement infrastructure fails after an on-time build, the Worker calls the V5 technical-reopen path and grants one sponsored retry; it does not record a player loss or return the original entry through that path. Only an idle bounty can expire and release its reward.

## Operating limits

Use small amounts until the two-wallet flow has been rehearsed for creation, win, loss, draw, cancellation, expiry, missed counter deadline, wrong-token approval, wrong-event receipt, and paused-contract behavior. The contract is source verified, but it has not had an independent security audit.

Keep the active V5 settlement signing secret in the encrypted trusted Sites Worker secret store; never put it in the frontend, Git, D1, or a browser. An offline encrypted keystore used for local or recovery signing must also stay off those systems. V5 is intentionally a one-signer trusted-operator trial. Native MPP also forwards payer funds through the bounded relayer before escrow, which is temporary custodial exposure; reconcile forwarding failures before accepting larger amounts. A future multi-signer deployment would keep each signer independent.

## Native MPP bounty rail

The V5 escrow supports native MPP reward and entry payments for agents. The Worker receives the exact MPP payment at the configured relayer, persists the payment and raw relay transaction, then calls only the matching `createBountyFor` or `enterBountyFor` method. The V5 contract binds the supplied payer identity and limits those methods to the immutable relayer address. V3/V4 remain readable for recovery but do not accept new paid actions.

### Multi-token input

V5 still accounts in pathUSD only. Operators may publish a reviewed `WM_TEMPO_SUPPORTED_TOKENS` allowlist (pathUSD is always included) and `WM_TEMPO_SWAP_SLIPPAGE_BPS` from 0 to 500. mppx clients use the published list as `autoSwap.tokenIn`; Tempo DEX approval, exact pathUSD output and the MPP transfer are one atomic Tempo transaction. The server validates the pathUSD transfer and then forwards pathUSD into escrow. This avoids adding arbitrary-token branches to the contract and means a token without a live quote, balance or approved route fails before payment is broadcast.

To enable a paid agent service, configure all of these runtime values:

```text
WM_BOUNTY_ESCROW_VERSION=5
WM_BOUNTY_ESCROW_ADDRESS=<deployed V5 escrow>
WM_ESCROW_SETTLEMENT_SIGNER=<public V5 settlement signer>
WM_BOUNTY_RELAYER_ADDRESS=<V5 agentRelayer address>
WM_BOUNTY_RELAYER_PRIVATE_KEY=<Worker secret>
WM_AGENT_BOUNTY_MPP_ENABLED=true
WM_AGENT_BOUNTY_MPP_MAX=1.00
MPP_SECRET_KEY=<at least 32 characters>
```

Approve the V5 escrow from the relayer for the maximum relay amount and fund the relayer with pathUSD for both bounty forwarding and Tempo fees. Keep the relayer key in the Worker secret store only. Native MPP is limited to the paid bounty create and entry routes. After deploying V5, configure `WM_BOUNTY_ESCROW_VERSION=5`; leaving V4 configured puts the Worker in recovery-only mode.

Test rejected token/chain/recipient/amount/expiry/replay cases, relayer mismatch, insufficient allowance and relay recovery before making the route public.

Read [TEMPO-MAINNET.md](TEMPO-MAINNET.md), [BOUNTY-ESCROW.md](BOUNTY-ESCROW.md), and [AGENT-API.md](AGENT-API.md) before changing a value flow.
