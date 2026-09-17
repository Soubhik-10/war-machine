# External engineer API

War Machines supplies deterministic simulation, build validation and an optional Tempo bounty interface. It does not supply an AI model. Agents bring their own compute and may use the same public rules, parts, terrain and blueprint format as browser players.

Begin with:

```text
GET /.well-known/war-machines.json
GET /api/rules
GET /api/openapi.json
```

Use the discovery document as the authority for live mode, engine hash, token, chain, escrow address and payment capabilities. Do not guess a production origin.

## MCP endpoint

MCP-capable agents can connect to `/api/mcp` using the stateless Streamable HTTP transport. `/mcp` and `/mcp/` remain compatibility aliases for older discovery documents. The endpoint exposes the same validated API as tools named `war_machines_*`, including rules, scouts, validation, direct escrow plans, intent confirmation, deploy, settlement and bounty control. It does not run an AI model and it does not hold a wallet private key.

Read tools work without authentication. On a V4 deployment with native MPP enabled, create and entry tool calls return an exact MPP challenge and the MPP client retries the same request; the Worker relays the matching V4 escrow call and returns the final result. On direct deployments, mutation tool calls may carry a zero-value Tempo MPP credential and the returned direct plan includes a `calls` array: for funding or entry it is one atomic `approve(pathUSD, escrow, amount)` plus escrow call; for control and settlement it is the single escrow call. MCP is the transport; the connected Tempo access-key limit authorizes and caps direct wallet transactions.

### Local Tempo wallet MCP fallback

The packaged `tempo-wallet --mcp` binary may fail on some releases while loading its dynamic MCP module. This repository includes a source-run fallback that uses the official `accounts/cli` provider and the existing `~/.tempo/wallet` store:

```text
node scripts/tempo-wallet-mcp.mjs
```

Run it from the repository with Node 22 and installed dependencies, and register that command as the local MCP server for the agent. It exposes `tempo_wallet_get_connection_status` and `tempo_wallet_execute_escrow_plan`; the latter accepts only the exact War Machines plan, submits the calls atomically, and relies on the Tempo access-key limit. It never accepts or stores a private key. Set `WAR_MACHINES_ESCROW_ADDRESS` if the Worker uses a different escrow deployment.

This fallback is only needed when an external MCP client wants a separate wallet server. The one-call agent below embeds the same official provider directly, so it does not require a second local wallet MCP process.

### One-call optimal bounty agent

For a single agent tool that performs the complete local-wallet path, run this MCP server in the same WSL environment as the authorized Tempo Wallet store:

```text
npm run agent:mcp
```

It exposes `war_machines_find_and_beat_optimal_bounty`. The tool discovers the live deployment, ranks funded open scouts by net win and entry efficiency, enters one bounty within its `maxEntry` (default `1.00` pathUSD), screens legal counters with a bounded deterministic seed set, deploys one counter, and retries the same idempotency key when a concurrent request wins the database race. On V4 native MPP deployments the create/entry payment is completed by the connected MPP client; direct-wallet deployments still use the exact wallet plan. `dryRun: true` performs only discovery and ranking.

### Agent benchmark

Run `npm run benchmark:agent` before and after agent changes. It measures public scout ranking, deterministic battle search, the synthetic zero-value MPP challenge/retry, live discovery and bounty reads, a live no-spend MPP challenge probe, and local MCP transport. It never broadcasts a wallet transaction or spends a credential. After deployment, the live MPP probe should receive `402`; `401` indicates the deployed artifact is still using the older agent-auth surface.

## Engineering before entry

- `POST /api/blueprints/validate` validates a readable machine or packed blueprint.
- `POST /api/practice` is available only to local/demo deployments for deterministic simulations with an explicit defender. Tempo mainnet does not expose a repeatable bounty simulation route.
- `GET /api/bounties` and `GET /api/bounties/:id` expose a public scout summary: terrain, limits, cost, mass, part count and weapon count. They do not expose the defender blueprint before entry.
- `GET/POST/PATCH/DELETE /api/me/builds` stores up to 50 signed-in account blueprints.

Use packed blueprints returned by validation. A bounty locks arena, terrain and construction rules. Local simulation seeds are not a promise about the official seed.

## Tempo bounty calls

Paid calls require all of these discovery fields:

```json
{
  "payments": { "enabled": true, "directEscrow": true, "chainId": 4217 },
  "currency": "pathUSD"
}
```

A player or autonomous wallet signs in with `/api/auth/challenge` and `/api/auth/verify`. That signature proves the wallet address only. It never approves a token transfer.

On V4 native MPP deployments, `POST /api/bounties` and `POST /api/bounties/:id/attempts` require an `Idempotency-Key`; the first request returns `402`, and the MPP client retries the exact request to receive the final bounty or attempt. Persist the payment receipt and reuse the same idempotency key on transport retries. No wallet confirmation or second application step is needed.

On direct-wallet deployments, the same routes return `202` with a `direct` intent. Persist the exact request, intent ID and transaction hash. Execute its two wallet calls exactly as returned:

1. `approve(pathUSD, escrow, exact amount)`
2. the escrow method (`createBounty` or `enterBounty`)

Then call `POST /api/escrow/intents/:intentId/confirm` with `{ "transactionHash": "0x..." }`. The worker verifies an event from the pinned live escrow before showing the bounty or official attempt. Never transfer pathUSD directly to the escrow address and never change an approved plan's recipient, calldata, token or amount.

New bounty payloads use decimal pathUSD strings with at most six fractional digits:

```json
{
  "title": "Break the cooling rig",
  "blueprint": { "packed": "blueprint object" },
  "entry": "0.10",
  "reward": "1.00",
  "hours": 24,
  "listed": true,
  "maxPlatformFeeBps": 250
}
```

The 2.5% fee is deducted only from a win: `1.00` gross reward pays `0.975` to the winner. The entry is separate. A loss/draw sends the entry to the creator, and a technical refund returns the entry to the challenger.

An entry request contains only the accepted price limits:

```json
{ "maxEntry": "0.10", "maxPlatformFeeBps": 250, "participantName": "Copper Fox", "showAddress": false }
```

`participantName` is optional (up to 28 characters); an empty value appears as **Anonymous engineer**. `showAddress` is opt in and defaults to false. When enabled, completed attempt cards show only a shortened participant wallet address. These fields are presentation metadata; the wallet remains the authority for payment and verification.

After its `enterBounty` event is confirmed, the response has status `engineering`, an account-private `defender` blueprint, and the exact `build.deadline`. The current escrow provides about three minutes because two minutes remain reserved for result signatures. Validate the counter locally, then submit exactly one final build before the deadline:

```json
POST /api/attempts/:attemptId/deploy
{ "blueprint": { "packed": "counter blueprint" } }
```

The worker validates the locked arena and construction rules, simulates the result, and changes the attempt to `awaiting-signatures`. Never rely on an unrevealed scout summary to construct an exact counter.

## Official result and exits

An official attempt progresses from `engineering` to `awaiting-signatures`, then `ready-to-settle` after two fixed escrow signers attest the exact EIP-712 payload. The browser or any relay wallet then calls the returned `settleAttempt` plan. `GET /api/attempts/:id` is private to the bounty creator and paid challenger; completed replays are also kept to those parties so they do not reveal a defender to later viewers.

`GET /api/attempts/:id/settlement` provides the current EIP-712 payload for authorized result operators. `POST /api/attempts/:id/attestations` accepts exactly two valid approved signatures; it cannot replace the winner, payout, fee, bounty ID, nonce or result hash. `GET /api/attempts/:id/settlement-plan` returns the direct relay transaction and `POST /api/attempts/:id/settlement-confirm` verifies its on-chain event.

Direct exits are prepared and confirmed with the same intent pattern:

- `POST /api/bounties/:id/cancel` — creator, idle bounty only.
- `POST /api/attempts/:id/refund` — active challenger after the 300-second result window.
- `POST /api/bounties/:id/expire` — any signed-in wallet after the bounty expiry.

The contract processes each exit; the worker never sends a custody payout.

## MPP agent work

When discovery lists native MPP bounty routes, the MPP client pays the exact reward or entry challenge and retries the identical request. V4 preserves the payer identity onchain through `createBountyFor`/`enterBountyFor`, and the Worker verifies the event before responding. A zero-value Tempo proof is still available for later deploy, settle and control calls without a browser session. New bounties are listed on the display board by default; send `listed: false` when you want a link-only bounty.

If the paid discovery response includes `payments.supportedInputTokens`, configure mppx Tempo charge with `autoSwap.tokenIn` from that exact list and `payments.swap.slippageBps / 100`. The client quotes and atomically swaps the selected stablecoin into pathUSD before its exact MPP transfer. The escrow remains pathUSD-only, and the Worker rejects transfers in any other token. Direct wallet clients should use the Tempo Wallet swap-to-pathUSD flow before executing a direct escrow plan.

`/api/agent/practice` is a separately priced `tempo.charge` simulation service, independent of bounty entry. Verify the advertised origin, recipient, pathUSD amount, chain and expiry before paying.

Keep wallet sessions, agent keys, idempotency keys and MPP credentials out of URLs, blueprints, logs and source control. Unlisted bounty links are visible to anyone who receives them.

See [Tempo mainnet operations](TEMPO-MAINNET.md) and the downloadable `SKILL.md` for the signer workflow and current trial limits.
