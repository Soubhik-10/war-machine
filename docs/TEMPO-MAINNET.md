# Tempo Mainnet operations

War Machines' live payment rail is the non-upgradeable V6 pathUSD escrow on
Tempo Mainnet. V6 is the only active contract version in this repository;
versions V1–V5 are archived for historical reference and recovery.

| Item | Live setting |
| --- | --- |
| Chain | Tempo Mainnet, chain ID `4217` |
| Token | pathUSD, `0x20C0000000000000000000000000000000000000` (6 decimals) |
| Escrow | Verified V6 address from live discovery; do not use an archived address |
| Winning reward fee | 2.5% (250 bps); verify recipient and exact net in the live payment plan |
| Settlement | One configured V6 EIP-712 signer |
| Agent payments | Native MPP through the configured bounded relayer when enabled |

The Worker should use `WM_BOUNTY_ESCROW_VERSION=6`. Treat the discovery
document and verified V6 deployment as the source of truth for current payment
details. Never publish secret keys in this document or in source control.

## Bounty flow

1. The creator funds the gross reward; the challenger separately pays the
   disclosed entry. The escrow holds the reward and entry reserves.
2. The challenger deploys a counter during the active attempt window. The
   Worker records the match, verifies the deterministic result, and prepares
   the settlement.
3. A settled win pays the challenger the reward less the 2.5% fee and pays the
   held entry to the creator. A settled loss or draw pays the entry to the
   creator and reopens the bounty.
4. If an active attempt is not settled by the contract timeout, the V6
   failsafe refunds the held entry to the challenger and reopens the bounty.
   An open bounty has no forced lifetime; only the active attempt is timed.

The creator can cancel only an idle bounty. Timeout calls cannot confiscate the
held entry. The app must verify the finalized receipt and matching contract
event before marking an outcome or refund complete.

## Worker configuration

```text
WM_MODE=tempo-mainnet
WM_BOUNTY_ESCROW_VERSION=6
WM_ALLOW_ESCROW_V6=true
WM_BOUNTY_ESCROW_ADDRESS=<verified deployed V6 address>
WM_ESCROW_SETTLEMENT_SIGNER=<configured V6 result signer>
WM_BOUNTY_RELAYER_ADDRESS=<configured V6 relayer>
```

For native MPP, also configure its protected secret, bounded maximum, and
relayer private key in the approved server-side secret store. Confirm the
relayer matches the deployed V6 contract and is funded/approved before
enabling new MPP payments. Keep browser wallet calls direct to the verified
escrow plan. Never make a bare token transfer to the escrow address.

## Release and historical versions

Routine UI, docs, or Worker releases do not redeploy the immutable V6 contract.
Do not run the V6 deploy helper as part of a routine app release. A new escrow
deployment requires its own explicit operational review, address/bytecode
verification, funding/allowance plan, and rollout approval.

V1–V5 source, tests, scripts, and deployment examples live under
[`contracts/stale/`](../contracts/stale/README.md). Their already-deployed
contracts remain immutable. Existing balances and attempts cannot be moved
automatically; reconcile them against the original contract and finalized
receipts. Archiving local files does not alter those obligations.

See [PAYMENTS-OPERATIONS.md](PAYMENTS-OPERATIONS.md) and
[BOUNTY-ESCROW.md](BOUNTY-ESCROW.md) for payment and contract semantics.
