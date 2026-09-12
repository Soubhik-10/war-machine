# Tempo mainnet operations

The Tempo integration is implemented but disabled by default. It does not deploy, fund, host, or transact merely by installing dependencies or starting the normal demo server.

## Network and asset

- Network: Tempo mainnet, chain ID `4217`
- RPC: `https://rpc.tempo.xyz`
- Explorer: `https://explore.tempo.xyz`
- Payment asset: USDC.e, `0x20C000000000000000000000b9537d11c60E8b50`, 6 decimals
- Incoming payments: MPP `tempo.charge`, verified by the server
- Finality: MPP waits for the configured transaction confirmation before accepting the API operation

The application accepts whole-token entry and reward values at its public game API boundary. Every persisted financial operation is stored as an exact base-unit decimal string; no floating-point token math is used.

## Custody and economic policy

Reward funding and entry payments go to the configured escrow address. The escrow signer pays winner payouts and technical/cancellation/expiry refunds. A winning reward is split durably: the winner obligation is submitted and confirmed first, then the 2.5% platform-fee obligation becomes eligible. Ambiguous RPC failures are marked `failed-needs-reconciliation` and are never retried blindly.

Entry fees are retained by the arena escrow after a loss or draw. They are refunded only for a technical failure or a paid quote that arrives too late to become an attempt. Network fees are paid separately by the wallet and are not deducted from the advertised reward or entry. Unused rewards return to the creator after an idle cancellation or expiry.

This is a custodial application design, not a trustless escrow contract. The operator controls the escrow signer and remains responsible for solvency, reconciliation, support, and lawful operation.

## Fail-closed activation

Use a dedicated database and HTTPS origin. The server refuses paid mode unless every required gate and recipient check passes.

```text
WM_MODE=tempo-mainnet
WM_MAINNET_ENABLE=tempo-mainnet-real-funds
WM_LEGAL_REVIEWED=true
WM_PUBLIC_ORIGIN=https://your-reviewed-origin.example
DATABASE_PATH=/dedicated/path/tempo-mainnet.sqlite
WM_LEDGER_NAMESPACE=tempo-mainnet:4217:0x20c000000000000000000000b9537d11c60e8b50

TEMPO_ESCROW_RECIPIENT=0x...
TEMPO_ENTRY_RECIPIENT=0x...     # must equal escrow in this release
TEMPO_PLATFORM_RECIPIENT=0x...  # must differ from escrow
TEMPO_ESCROW_PRIVATE_KEY=0x...
MPP_SECRET_KEY=<at least 32 random bytes>

WM_MAX_OPERATION_UNITS=1000000
WM_MAX_OUTSTANDING_UNITS=10000000
WM_QUOTE_TTL_SECONDS=180
WM_PAYMENT_PAUSED=false
```

The private key and MPP secret are server-only secrets. Do not put them in the browser bundle, repository, logs, support tickets, or a shared `.env` file. Use a dedicated, minimally funded signer with an operator-owned backup and rotation procedure. The normal demo database is rejected in paid mode, and financial rows carry the environment, token, unique operation ID, amount, recipient, and independent settlement state.

`WM_PAYMENT_PAUSED=true` is the stop switch. It prevents paid-mode startup. Removing the explicit mainnet enable phrase also prevents startup.

## Before accepting funds

The repository implementation is not launch approval. Before setting the gates above:

1. Complete jurisdiction/provider review for paid-entry prize activity.
2. Verify the final HTTPS origin, RP ID, recipients, asset address, RPC, and signer recovery with two operators.
3. Back up and restore the dedicated database in a rehearsal.
4. Exercise wallet cancellation, wrong network/recipient/token, expired and duplicated quotes, late payment, insufficient balance, payout failure, and restart reconciliation on an isolated environment.
5. Add alerts for `failed-needs-reconciliation`, long-lived `submitted` operations, reserve shortfall, and unexpected escrow transfers.
6. Start with deliberately small operation/outstanding limits and fund no more than the reviewed loss budget.

No mainnet transaction, deployment, hosted service, relayer, fee sponsor, or paid RPC is created by this repository change.
