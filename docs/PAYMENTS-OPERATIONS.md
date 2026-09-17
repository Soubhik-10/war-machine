# Payment operations

## Live bounty rail

War Machines uses direct pathUSD escrow on Tempo mainnet, with an optional V4 native MPP lane for stateless agent create/entry.

- Chain: Tempo Mainnet `4217`
- pathUSD: `0x20C0000000000000000000000000000000000000` (6 decimals)
- Escrow: [Bounty Escrow v2](https://explore.tempo.xyz/address/0x7ce840C9A852721E9b87d1FA028D0a988aee0f8e) ([Sourcify match](https://contracts.tempo.xyz/verify-ui/jobs/c14fe4d2-651b-4adc-9670-19b5e726ffb8))
- Platform fee: 2.5% of the gross winning reward to `0xc20131e9132888993de6519D486E5558A5DbCb7A`

The browser prepares the exact approval and escrow calls in direct mode. In native MPP mode, the Worker relays only the matching V4 method after the exact MPP payment is finalized. The Worker verifies receipts, binds locked rules and builds to the result, and records attestation state.

## Settlement

1. The creator approves pathUSD and calls `createBounty`.
2. The challenger approves pathUSD and calls `enterBounty`.
3. The Worker reveals the defender to that paid challenger only and opens the construction window. Public viewers continue to receive only the scout summary.
4. The challenger validates locally and deploys one counter. The Worker computes the deterministic result and returns the EIP-712 settlement payload.
5. Both result signers run `scripts/attest-escrow-result.ps1` using their independent encrypted keystores.
6. Any wallet can relay `settleAttempt` after both signatures have been registered.

The current deployment uses a ten-minute attempt window. The Worker gives the challenger a cost-scaled three-to-five-minute build window, then retains enough time for the configured signer quorum and relay. A loss, draw, or missed counter deadline settles the entry to the bounty creator. If the signer service fails, anybody can call the timeout finalizer after the immutable deadline; it also sends the entry to the creator. Only an idle bounty can expire and release its reward.

## Operating limits

Use small amounts until the two-wallet flow has been rehearsed for creation, win, loss, draw, cancellation, expiry, missed counter deadline, wrong-token approval, wrong-event receipt, and paused-contract behavior. The contract is source verified, but it has not had an independent security audit.

Keep the two result signer keystores separate from each other, the Site runtime, Git, D1, and the browser. The Worker must remain receipt-verifying and non-custodial.

## Native MPP bounty rail

The V4 escrow supports native MPP reward and entry payments for agents. The Worker receives the exact MPP payment at the configured relayer, persists the payment and raw relay transaction, then calls only the matching `createBountyFor` or `enterBountyFor` method. The V4 contract binds the supplied payer identity and limits those methods to the immutable relayer address.

To enable a paid agent service, configure all of these runtime values:

```text
WM_BOUNTY_ESCROW_VERSION=4
WM_BOUNTY_ESCROW_ADDRESS=<deployed V4 escrow>
WM_BOUNTY_RELAYER_ADDRESS=<V4 agentRelayer address>
WM_BOUNTY_RELAYER_PRIVATE_KEY=<Worker secret>
WM_AGENT_BOUNTY_MPP_ENABLED=true
WM_AGENT_BOUNTY_MPP_MAX=1.00
MPP_SECRET_KEY=<at least 32 characters>
```

Approve the V4 escrow from the relayer for the maximum relay amount and fund the relayer with pathUSD for both bounty forwarding and Tempo fees. Keep the relayer key in the Worker secret store only. The separate `/api/agent/practice` charge still uses `WM_AGENT_MPP_ENABLED`, `WM_AGENT_MPP_RECIPIENT` and `WM_AGENT_MPP_PRICE` when enabled.

Test rejected token/chain/recipient/amount/expiry/replay cases, relayer mismatch, insufficient allowance and relay recovery before making the route public.

Read [TEMPO-MAINNET.md](TEMPO-MAINNET.md), [BOUNTY-ESCROW.md](BOUNTY-ESCROW.md), and [AGENT-API.md](AGENT-API.md) before changing a value flow.
