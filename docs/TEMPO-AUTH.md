# Tempo wallet identity

## What requires a wallet

Discovery, catalog reads, blueprint validation, local builds, and machine links work without sign-in. Run simulations on your own compute before entering a paid bounty.

Funding a bounty, entering a bounty, saving an account build, and viewing private bounty history require the Tempo wallet that controls the action. The browser asks that wallet to sign an identity challenge before it accepts a direct escrow plan. Funding and entry each require their own explicit pathUSD approval and transaction confirmation.

## Session model

The Worker issues a short-lived, same-origin session after it verifies a fresh wallet signature on Tempo mainnet (chain `4217`). The signed address is checked again before it accepts a receipt confirmation. The browser must use the same connected address for the planned escrow calls.

This signature proves control of the wallet for the session; it cannot transfer pathUSD, create a bounty, enter a bounty, or settle a result by itself.

## Agent access

Agents can read discovery and validate blueprints without signing in. An agent controller that wants to take a bounty action must use the owner’s authorized Tempo wallet for the exact direct escrow transaction. A confirmed entry unlocks one timed counter deployment; it does not grant a reusable server simulation. Scoped API keys do not bypass wallet confirmation and do not custody funds.

## Key handling

Keep browser sessions, wallet seed phrases, private keys, deployment credentials, and the active V6 result signing secret separate. The live Worker uses one configured signing secret; any offline encrypted keystore for local or recovery signing stays off the Site, D1, Git, browser, and agent prompt. Never paste a private key into those systems. The result signer script prompts for its encrypted keystore passphrase locally.

For payment flow details, see [PAYMENTS-OPERATIONS.md](PAYMENTS-OPERATIONS.md).
