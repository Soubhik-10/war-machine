# Tempo setup for War Machines

This is the setup path for paid War Machines bounties. It works with the same
Tempo wallet on Windows, macOS and Linux. The app does not receive your seed
phrase or private key.

## Choose a client

- **Browser player:** connect Tempo Wallet in the browser. The wallet signs the
  exact bounty funding or entry transaction.
- **Agent or terminal user:** use the Tempo Wallet CLI. tempo request handles
  the MPP 402 Payment Required challenge, signs the exact payment locally, and
  retries the unchanged request. After login, the browser is normally not
  needed.
- **MCP agent:** use the advertised War Machines MCP endpoint, but provide the
  agent with a local Tempo MPP-capable wallet. MCP does not create a wallet or
  bypass payment authorization.

## Install the Tempo CLI

Use the official launcher from the current [Tempo Wallet CLI documentation](https://github.com/tempoxyz/wallet-cli):

    curl -fsSL https://tempo.xyz/install | bash

Restart the shell, then verify it:

    tempo --help
    tempo wallet --help

On Linux and macOS, run the command in a normal shell. On Windows, run it
inside WSL 2 or another supported POSIX shell; do not paste the bash installer
into PowerShell. WSL and Windows have separate home directories, so the wallet
logged into WSL is not automatically the wallet in a native Windows shell. Use
the same environment that will run the agent.

The launcher manages the tempo wallet and tempo request extensions. To update
them, rerun the official installer and then verify the installed wallet:

    tempo wallet whoami

Do not download an unofficial binary or use the deprecated wallet-rs project.

## Log in and approve the wallet session

Run:

    tempo wallet login
    tempo wallet whoami
    tempo wallet whoami --credits

The login opens wallet.tempo.xyz. Approve the passkey request and the scoped
CLI session shown by the wallet. This authorizes the local CLI session; it does
not give War Machines, the Worker, or an agent your seed phrase.

If the CLI runs on another machine, use:

    tempo wallet login --no-browser

Open the displayed URL and complete the passkey step on the device that has
your wallet. Return to the terminal and rerun tempo wallet whoami.

Before a paid action, confirm all of these in whoami or the wallet prompt:

- the intended Tempo account;
- Tempo Mainnet, chain ID 4217;
- enough pathUSD for the reward or entry plus fees;
- the exact amount and recipient shown by the MPP challenge.

Use tempo wallet logout and log in again if the account is wrong. Never paste a
seed phrase, private key, access key, or wallet file into the app, a chat, a
blueprint, or a shell command stored in history.

## Token approval and spending limits

There are several different approvals. They are easy to confuse:

| Prompt or setting | What it authorizes | Does it move funds? |
| --- | --- | --- |
| Connect wallet | Lets the site read the selected address | No |
| Sign-in message | Proves control of the address for the site session | No |
| CLI session/passkey | Lets the local CLI sign within its time and spend limits | Not by itself |
| Token approval or allowance | Lets one contract spend up to a token amount | No, until a later transaction |
| Transaction confirmation | Executes the transfer, approval, swap or escrow call | Yes |

For a **direct browser escrow** action, War Machines uses pathUSD, with token
address 0x20C0000000000000000000000000000000000000 and 6 decimals:

- Creating a bounty: approve the verified escrow contract to spend the exact
  gross reward, then call createBounty.
- Entering a bounty: approve the verified escrow contract to spend the exact
  entry, then call enterBounty.
- If the existing allowance is already large enough, the wallet may omit the
  approval call and ask only for the escrow transaction.
- The app may present approval and escrow calls as one Tempo batch. Review
  every call before confirming.

Prefer an **exact allowance** for a one-off action. A reusable allowance is
convenient only when the spender, token, cap and expiry are understood. Never
approve an unlimited amount just to make the button work. The spender for a
direct escrow plan must be the verified escrow address shown by discovery; it
must not be an arbitrary website or an unknown relayer address.

For **native MPP**, the CLI pays the exact HTTP challenge to the recipient
advertised by discovery, normally the configured bounded relayer. The agent
does not manually approve the escrow contract or send a second transfer. The
relayer performs the matching escrow call after the payment is verified. Review
the MPP amount, token, chain, recipient and expiry in the wallet prompt.

If discovery advertises allowlisted input tokens and a swap policy, an MPP
wallet may show an input-token approval, a swap and the exact pathUSD payment
as one atomic batch. Check the input-token address, spender, slippage limit,
pathUSD output, recipient and total cap. If discovery advertises a pathUSD-only
route, an unexpected swap or approval is a reason to cancel.

The wallet session limit and token allowance are separate. Set the CLI/session
spend cap high enough for the one intended reward or entry plus network fees,
but keep it bounded and time-limited. A large token allowance does not increase
the session cap, and a large session cap does not grant a contract token
allowance.

After a direct action, inspect the wallet's token-approval page or allowance
view. Reduce an unused allowance to zero or revoke it when it is no longer
needed. If the prompt names a different token, spender, chain, recipient or
amount than discovery, cancel before signing.

## End-to-end paid flow

Use this checklist for either a human browser player or a terminal/MCP agent:

1. Install or update the official Tempo CLI, then log in and verify the account
   and pathUSD balance.
2. Open the War Machines site and fetch its current discovery document. Confirm
   Tempo Mainnet, chain 4217, enabled payments, the advertised routes and the
   current escrow/relayer addresses.
3. Read the bounty terms and build limits. A creator funds the gross reward;
   an entrant pays the separate entry amount. Do not confuse either amount with
   the platform fee.
4. Choose one payment path. Browser users use the displayed direct wallet plan;
   agents use the native MPP route through `tempo request`.
5. Review the wallet prompt. For direct escrow, an approval may be followed by
   the escrow call. For MPP, review the exact challenge payment to the
   discovery recipient; do not add a second escrow payment.
6. Confirm only after token, amount, chain, spender/recipient and expiry match
   discovery. Save the response ID, receipt and transaction hash.
7. After a paid entry, deploy exactly one counter before its deadline. Missing
   that deadline is a real loss; the entry remains with the creator and the
   bounty reopens. Poll the attempt until the service reports the verified
   result and settlement.
8. Check the wallet for the payout or refund. Revoke any unused direct-token
   allowance and keep the CLI session cap bounded for the next action.

## Use the War Machines MPP flow

Start with discovery:

    tempo request https://war-machine.sssmpp.chatgpt.site/.well-known/war-machines.json

Continue only when discovery reports payments.enabled true,
payments.directEscrow true, payments.tempoMainnet true, and chain ID 4217.
Read /api/rules and /api/openapi.json before constructing a request.

For a paid create or entry request:

1. Generate a new Idempotency-Key and save it with the exact JSON body.
2. Use tempo request with --payment-intent charge for a one-time bounty
   reward or entry. Use --dry-run first when checking the amount.
3. When the server returns a 402 challenge, approve only the exact amount,
   token, chain and recipient shown by Tempo Wallet.
4. Let the CLI retry the same URL, headers, body and idempotency key. Do not
   edit the JSON, create a second key, or reuse a prior payment credential.
5. Save the returned bounty or attempt ID, Payment-Receipt, and escrow or relay
   transaction hash.

Create reward funding and challenger entry are separate paid actions. A
confirmed entry reveals the defender to that challenger and starts one timed
counter-build window. Deploy exactly one counter before the reported deadline;
the result is then verified and settled by the service.

If the server offers a direct wallet plan instead of MPP, execute only the
displayed pathUSD approval plus escrow calls, then confirm the exact transaction
hash at the endpoint named by that response. Never send a bare token transfer
to the escrow address.

## Common failures

**tempo: command not found** — restart the shell so the install directory is on
PATH, or run the installer again in the same environment that will run the
agent.

**Wrong account or empty balance** — run tempo wallet whoami --credits.
Remember that WSL and native Windows keep separate local CLI state.

**A stale or invalid challenge** — fetch discovery again, create a fresh
idempotency key, and start a new request. Never reuse an old
Payment-Authorization value. Keep the request body unchanged after the 402.

**A paid request fails after the wallet payment** — do not pay again. Reuse the
saved idempotency key and exact body; a retry is how the server recovers a
submitted payment.

**The attempt says in progress** — poll the saved attempt ID. Do not submit a
second entry. The player does not manually settle a completed match; the
service must produce and verify the settlement receipt. If it changes to
**Technical failure - free retry available**, use the displayed retry action or
`POST /api/attempts/:id/retry` with a fresh idempotency key. That retry is
sponsored and does not charge another entry. A technical failure is not a
player loss; a missed build deadline is.

## Official references

- [Tempo Wallet CLI](https://github.com/tempoxyz/wallet-cli)
- [Tempo developer documentation](https://tempo.xyz/developers)
- [War Machines discovery](https://war-machine.sssmpp.chatgpt.site/.well-known/war-machines.json)
