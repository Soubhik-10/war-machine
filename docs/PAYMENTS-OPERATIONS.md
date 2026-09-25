# Payment operations

## Live bounty rail

War Machines uses the V6 pathUSD escrow on Tempo Mainnet (chain `4217`). V6 is
the sole active escrow version for new paid actions. Always use the address,
token, fee, and payment route in the current discovery response; old deployment
records are historical and must not be treated as the active escrow.

- Token: pathUSD, `0x20C0000000000000000000000000000000000000` (6 decimals).
- Winning reward fee: 2.5% of gross reward (250 bps); confirm exact net payout
  before authorizing funding.
- Payment methods: direct Tempo Wallet escrow plan for browser users, or the
  advertised native MPP challenge for agents when enabled.

Funding and entry are separate payments. The creator funds the gross reward;
the challenger pays the entry. The escrow holds both while an attempt is active.

## Settlement and the timeout failsafe

1. The creator funds an idle bounty through the V6 escrow.
2. The challenger pays the separate entry and the V6 attempt window starts.
3. The challenger submits a valid counter; the Worker records and simulates the
   match, then prepares the signed settlement.
4. On a settled win, the challenger receives the gross reward less the 2.5%
   platform fee, and the creator receives the held entry. On a settled loss or
   draw, the creator receives the held entry and the bounty reopens.
5. If an entered attempt is not settled by the on-chain timeout, V6's technical
   failsafe returns the held entry to the challenger and reopens the bounty.
   The timeout refund is not a player loss and does not charge a second entry.

The creator may cancel only an idle bounty. The bounty can remain open
indefinitely until entered or cancelled; the timeout is for an active attempt,
not for an open bounty. Use the on-chain attempt window as the source of truth
for exact deadlines.

## V6 operations and safety

The live Worker configuration uses:

```text
WM_BOUNTY_ESCROW_VERSION=6
WM_ALLOW_ESCROW_V6=true
WM_BOUNTY_ESCROW_ADDRESS=<verified deployed V6 escrow>
WM_ESCROW_SETTLEMENT_SIGNER=<public V6 settlement signer>
WM_BOUNTY_RELAYER_ADDRESS=<V6 agent relayer>
WM_AGENT_BOUNTY_MPP_ENABLED=true
WM_AGENT_BOUNTY_MPP_MAX=<approved bounded amount>
MPP_SECRET_KEY=<protected server secret, at least 32 characters>
```

The signer private key, relayer private key, and MPP secret belong only in
approved protected server-side secret storage. The relayer must match the
immutable V6 relayer, have the reviewed pathUSD allowance, and hold enough
pathUSD for the bounded forwarding amount and Tempo fees. MPP is enabled only
when its secret, relayer, and spend cap pass the Worker readiness checks.

For direct wallet actions, review the exact token, amount, chain, recipient,
escrow address, and calls before signing. For MPP, review the exact challenge
recipient and amount; do not make a second escrow payment. Never send a bare
pathUSD transfer to the escrow.

The 2.5% fee applies to a winning gross reward, not to the separate entry. Use
the exact payout in the current transaction plan/discovery rather than
calculating or guessing from an old bounty record.

## Historical contracts

V1–V5 sources, tests, deployment scripts, and sample configuration are archived
under [`contracts/stale/`](../contracts/stale/README.md). Do not use them for
new funding or deployment. Existing historical bounties and transactions still
belong to their original immutable contracts; reconcile those obligations
against finalized chain receipts. Archiving does not delete on-chain data,
change the live V6 contract, or migrate any funds.

Read [TEMPO-MAINNET.md](TEMPO-MAINNET.md),
[BOUNTY-ESCROW.md](BOUNTY-ESCROW.md), and
[AGENT-API.md](AGENT-API.md) before changing a value flow.
