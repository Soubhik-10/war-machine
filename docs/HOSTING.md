# Hosting operations

## Public deployment

The public deployment is [war-machine.sssmpp.chatgpt.site](https://war-machine.sssmpp.chatgpt.site).

It runs the bundled Worker with D1 binding `DB` and the following live runtime configuration:

```text
WM_MODE=tempo-mainnet
WM_BOUNTY_ESCROW_ADDRESS=0x461eefD1c4bcbE76C470487cF18b892fCD76d494
```

The Worker serves the game, account build vault, bounty metadata, wallet identity flow, direct escrow transaction plans, receipt verification, deterministic simulations, and result-attestation state. It does not store a private key or hold pathUSD.

## Deploying a change

1. Run `npm test`, `npm run build:sites`, and `npm run package:sites`.
2. Push the exact commit to the registered Sites source repository.
3. Save and deploy the matching archive through the Sites connector.
4. Confirm the deployment has succeeded and preserve the D1 binding.
5. After any runtime environment change, deploy a saved version so that the new revision applies.

The site is public. Keep the audience unchanged unless the owner explicitly chooses a different audience.

## Local development

```sh
npm ci
node server.mjs
```

This starts a loopback-only local sandbox at `http://127.0.0.1:8770/` with SQLite data in `var/war-machines.sqlite`. It is useful for workshop and simulation development, but it is not the public Tempo payment rail.

For a static-only workshop preview:

```sh
python serve.py --open
```

Static hosting supports local saves, exports, ordinary challenge links, and free practice. Shared bounties require the Worker/D1 deployment.

## Mainnet safeguards

- Keep `WM_BOUNTY_ESCROW_ADDRESS` pinned to the verified deployed escrow.
- Never add a backend custody key, signer private key, or wallet seed phrase to Site runtime variables, D1, Git, or browser storage.
- Keep the two result signers independent and encrypted; see [PAYMENTS-OPERATIONS.md](PAYMENTS-OPERATIONS.md).
- MPP service charging is off until every `WM_AGENT_MPP_*` value and `MPP_SECRET_KEY` have been intentionally configured. It is separate from bounty funds.
- Use controlled small amounts while the manual two-signer settlement operation is in place.

## Release compatibility

After editing `dist/engine.mjs` or `dist/data.mjs`, run `node scripts/stamp-release.mjs`, run the tests, rebuild the Site bundle, and deploy the generated `dist/release.mjs`. This keeps result commitments and replays tied to the correct engine release.
