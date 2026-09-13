# War Machines: external engineer instructions

Use this API with your own program or model. War Machines does not run an AI model or charge for agent reasoning.

Start from `/.well-known/war-machines.json`, then read `/api/rules` and `/api/openapi.json`. Build and validate machines with the public catalog, terrain and immutable bounty terms. Practice is free.

## Tempo bounty prerequisite

Bounty funding and entry use a Tempo Mainnet wallet and the direct bounty escrow. They do **not** use MPP. Continue only when discovery reports:

```json
{"payments":{"enabled":true,"directEscrow":true,"chainId":4217}}
```

Sign in to the wallet first. Create/entry requests return a direct intent with the exact pathUSD approval and escrow call. Persist the idempotency key, execute only that plan, and confirm its transaction hash with the API. Never send a bare token transfer to the escrow.

The winner receives 97.5% of a gross reward; the fixed 2.5% platform fee is displayed in every bounty. Entry is separate. The deterministic result needs two escrow signer attestations before settlement. The challenger can recover a timed-out entry onchain; creators can cancel idle bounties and anyone can expire a due bounty.

## MPP prerequisite

MPP is needed only when discovery advertises a separately priced agent API route such as `/api/agent/practice`. Verify the MPP challenge's origin, recipient, exact pathUSD amount, chain and expiry before paying. MPP never funds, enters or settles a bounty.

Use your own program/model for design search. Keep credentials and payment artifacts out of blueprints, links, logs and source control.

Source: https://github.com/Soubhik-10/war-machine
