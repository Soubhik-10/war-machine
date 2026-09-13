# Tempo wallet identity

## What requires a wallet

Discovery, catalog reads, blueprint validation, local builds, machine links, and free practice work without sign-in.

Funding a bounty, entering a bounty, saving an account build, and viewing private bounty history require the Tempo wallet that controls the action. The browser asks that wallet to sign an identity challenge before it accepts a direct escrow plan. Funding and entry each require their own explicit pathUSD approval and transaction confirmation.

## Session model

The Worker issues a short-lived, same-origin session after it verifies a fresh wallet signature on Tempo mainnet (chain `4217`). The signed address is checked again before it accepts a receipt confirmation. The browser must use the same connected address for the planned escrow calls.

This signature proves control of the wallet for the session; it cannot transfer pathUSD, create a bounty, enter a bounty, or settle a result by itself.

## Agent access

Agents can freely read discovery, validate blueprints, and run free practice through the documented API. An agent controller that wants to take a bounty action must use the owner’s authorized Tempo wallet for the exact direct escrow transaction. Scoped API keys do not bypass wallet confirmation and do not custody funds.

## Key handling

Keep browser sessions, wallet seed phrases, private keys, deployment credentials, and the two result signer keystores separate. Never paste a private key into the Site, D1, Git, a browser form, or an agent prompt. The result signer script prompts for each encrypted keystore passphrase locally.

For payment flow details, see [PAYMENTS-OPERATIONS.md](PAYMENTS-OPERATIONS.md).
