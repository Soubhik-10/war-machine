# Tempo mainnet operations

> **Custody safety change, 12 September 2026:** the former MPP charge plus server-signer payout
> path is permanently disabled in `sites/worker/mainnet.mjs`. Setting its old environment values
> cannot enable it. `contracts/WarMachineBountyEscrow.sol` is the planned non-custodial replacement,
> but it is not deployed or connected to the browser/backend yet. The public Site accepts no Tempo
> funds until the contract deployment gate in [BOUNTY-ESCROW.md](BOUNTY-ESCROW.md) is complete.

The Tempo integration is implemented but disabled by default. It does not deploy, fund, host, or transact merely by installing dependencies or starting the normal demo server.

## Network and asset

- Network: Tempo mainnet, chain ID `4217`
- RPC: `https://rpc.tempo.xyz`
- Explorer: `https://explore.tempo.xyz`
- Payment asset: pathUSD, `0x20c0000000000000000000000000000000000000`, 6 decimals
- Incoming payments: MPP `tempo.charge`, verified by the server
- Finality: MPP waits for the configured transaction confirmation before accepting the API operation

The application accepts decimal pathUSD amounts at its public game API boundary, including cent values such as `0.01` and `0.10`. Every persisted financial operation is stored as an exact 6-decimal base-unit string; no floating-point token math is used. A `0.01` pathUSD entry is stored as `10000` base units, and a `1.00` reward pays `0.975` to the winner after the 2.5% fee.

## Custody and economic policy

Reward funding and entry payments go to the configured escrow address. The escrow signer pays winner payouts and technical/cancellation/expiry refunds. A winning reward is split durably: the winner obligation is submitted and confirmed first, then the 2.5% platform-fee obligation becomes eligible. The fee recipient is fixed at `0xc20131e9132888993de6519D486E5558A5DbCb7A`; the server rejects a substituted destination. Ambiguous RPC failures are marked `failed-needs-reconciliation` and are never retried blindly.

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
WM_LEDGER_NAMESPACE=tempo-mainnet:4217:0x20c0000000000000000000000000000000000000

TEMPO_ESCROW_RECIPIENT=0x...
TEMPO_ENTRY_RECIPIENT=0x...     # must equal escrow in this release
TEMPO_PLATFORM_RECIPIENT=0xc20131e9132888993de6519D486E5558A5DbCb7A
TEMPO_ESCROW_PRIVATE_KEY=0x...
MPP_SECRET_KEY=<at least 32 random bytes>

WM_MAX_OPERATION_UNITS=1000000
WM_MAX_OUTSTANDING_UNITS=10000000
WM_QUOTE_TTL_SECONDS=180
WM_PAYMENT_PAUSED=false
```

### ChatGPT Sites + D1 deployment

The public Site uses D1 for the database, so it does **not** use `DATABASE_PATH`. Its `drizzle/0001_tempo_mainnet.sql` migration adds wallet sessions, MPP replay storage, payment holds, exact-unit bounties, and a payout queue. Set the same named runtime values in the Site environment, except `DATABASE_PATH`; keep `TEMPO_ESCROW_PRIVATE_KEY` and `MPP_SECRET_KEY` as Site secrets. Set `WM_PUBLIC_ORIGIN` to the exact deployed HTTPS origin.

Before the secrets and the dedicated escrow address are supplied, set `WM_MODE=tempo-mainnet` only if you want the Site to show its payment-activation lock. It will issue no demo credits and reject every economic request with 503. Do not set `WM_MAINNET_ENABLE=tempo-mainnet-real-funds` until the signer, recipients, limits, and live wallet rehearsal are complete.

The private key and MPP secret are server-only secrets. Do not put them in the browser bundle, repository, logs, support tickets, or a shared `.env` file. Use a dedicated, minimally funded signer with an operator-owned backup and rotation procedure. The normal demo database is rejected in paid mode, and financial rows carry the environment, token, unique operation ID, amount, recipient, and independent settlement state.

`WM_PAYMENT_PAUSED=true` is the stop switch. It prevents paid-mode startup. Removing the explicit mainnet enable phrase also prevents startup.

## Before accepting funds

pathUSD is Tempo's first predeployed USD TIP-20 and an optional DEX quote token. Confirm with counsel, your users and your payment provider that it is appropriate for this particular use before taking a bounty payment; MPP can authorize and settle a payment but does not provide an escrow marketplace or decide a game winner.

The repository implementation is not launch approval. Before setting the gates above:

1. Complete jurisdiction/provider review for paid-entry prize activity.
2. Verify the final HTTPS origin, RP ID, recipients, asset address, RPC, and signer recovery with two operators.
3. Back up and restore the dedicated database in a rehearsal.
4. Exercise wallet cancellation, wrong network/recipient/token, expired and duplicated quotes, late payment, insufficient balance, payout failure, and restart reconciliation on an isolated environment.
5. Add alerts for `failed-needs-reconciliation`, long-lived `submitted` operations, reserve shortfall, and unexpected escrow transfers.
6. Start with deliberately small operation/outstanding limits and fund no more than the reviewed loss budget.

No mainnet transaction, deployment, hosted service, relayer, fee sponsor, or paid RPC is created by this repository change.
