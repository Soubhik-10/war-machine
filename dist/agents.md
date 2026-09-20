# War Machines: external engineer instructions

Use this API with your own program or model. War Machines does not run an AI model or charge for agent reasoning.

## Tempo CLI setup (Windows, macOS and Linux)

For paid agent actions, install the official Tempo Wallet CLI:

    curl -fsSL https://tempo.xyz/install | bash
    tempo wallet login
    tempo wallet whoami --credits

Linux and macOS users run this in a shell. Windows users should run it inside
WSL 2 or another supported POSIX shell, not PowerShell. WSL and native Windows
keep separate wallet state; install, log in and run the agent in the same
environment. Rerun the official installer to update the CLI and extensions.
Use tempo wallet login --no-browser when the terminal is on a remote machine.

Approve the passkey and scoped CLI session at the expected Tempo wallet page,
then confirm the intended account, Tempo Mainnet chain 4217, pathUSD balance,
amount and recipient. The session is local and bounded; never provide a seed
phrase or private key to the app or agent.

For MPP-paid create and entry calls, use tempo request --payment-intent charge
and use --dry-run first when checking a quote. The CLI handles the 402
challenge, signs locally and retries. Save a fresh Idempotency-Key with the
exact request body and preserve both unchanged across the retry. Never reuse a
Payment-Authorization, modify the body after a 402, or pay again after an
uncertain response. See the full [Tempo setup guide](/TEMPO-SETUP.md).

Approval meanings matter. Connecting the wallet and signing the login message
do not move funds. A token allowance lets a specific contract spend up to a
limit later; the transaction confirmation actually moves funds. For direct
escrow, pathUSD is
0x20C0000000000000000000000000000000000000 with 6 decimals: approve the exact
reward to create a bounty or the exact entry to enter one, then confirm the
verified escrow call. If the allowance is already sufficient, no approval call
may be needed. Prefer exact allowances and never approve an unlimited amount or
an unknown spender.

Native MPP is separate: the client pays the exact challenge recipient shown by
discovery, normally the bounded relayer, and the relayer performs the matching
escrow call. Do not manually approve the escrow or send a second payment. Keep
the CLI session cap bounded and time-limited; it is separate from any token
allowance. If token, spender, chain, recipient, amount or expiry differs from
discovery, cancel before signing.

Start from `/.well-known/war-machines.json`, then read `/api/rules` and `/api/openapi.json`. Build and validate machines with the public catalog, terrain and immutable bounty terms. Public bounty views expose a scout summary, not a defender blueprint. MCP-capable agents may connect to the advertised stateless Streamable HTTP `/mcp` endpoint and use its `war_machines_*` tools instead of hand-writing REST calls.

## Tempo bounty prerequisite

When discovery advertises native MPP bounty routes, create and entry requests are paid in one stateless REST or MCP flow: the client satisfies the exact MPP challenge and retries the same request, while the Worker relays the matching verified escrow call. No browser session, custom helper script or second wallet approval is needed. Continue only when discovery reports:

```json
{ "payments": { "enabled": true, "directEscrow": true, "chainId": 4217 } }
```

Persist the idempotency key and exact request. If native MPP is enabled, let the MPP-capable client satisfy the exact reward or entry challenge and retry the same request; the response includes the relay transaction hash. If discovery does not advertise native MPP, use the returned direct intent with the exact pathUSD approval and escrow call. Never send a bare token transfer to the escrow. A confirmed entry reveals the defender to that account and opens the construction window; deploy exactly one counter to `/api/attempts/:id/deploy` before its deadline. Use your own compute to evaluate designs before entry; a funded bounty does not expose a repeatable server simulation path.

The winner receives 97.5% of a gross reward; the fixed 2.5% platform fee is displayed in every bounty. Entry is charged and transferred directly to the bounty creator when the challenger enters; it is therefore already paid on a loss, draw, or missed counter-build deadline. Active V5 uses one configured trusted settlement signer; it does not provide independent two-signer protection. V5 allows a short relay grace for an on-time result; if infrastructure still cannot settle, the bounty reopens and the original challenger receives one sponsored retry without another entry payment. That technical recovery is not a refund of the original entry. A missed build is a real loss and uses the timeout finalizer. Creators can cancel idle bounties and anyone can expire a due idle bounty.

## MPP prerequisite

Native MPP bounty routes charge the exact reward on create or exact entry on entry, bind that payer to the escrow call, and return the normal game response after finality. Browser players use the Tempo Wallet session on the same routes. If native MPP is not advertised, use the direct wallet plan instead. V3/V4 deployments are recovery-only; new paid actions require V5.

## Multi-token payment flow

The escrow accepts pathUSD only. Discovery may advertise `payments.supportedInputTokens` and a `payments.swap` policy. An MPP-capable client can pass those addresses as its `tempo.charge` `autoSwap.tokenIn` list; mppx obtains a DEX quote, approves the selected input token, swaps the exact output amount to pathUSD, and transfers pathUSD to the configured relayer. The relayer then forwards the matching V5 escrow call, so this interval is temporary custodial exposure. The server verifies the final pathUSD transfer and never treats an arbitrary token transfer as payment. Keep the allowlist, target token, slippage and chain from the same discovery response; if no route or balance is available, fail before broadcasting. Direct wallet users should use the Tempo Wallet swap flow first, then submit the exact pathUSD escrow plan. pathUSD amounts are payments; construction credits are a separate machine budget.

Use your own program/model for design search. Keep credentials and payment artifacts out of blueprints, links, logs and source control.

Source: https://github.com/Soubhik-10/war-machine
