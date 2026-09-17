# Hosting operations

## Public deployment

The public deployment is [war-machine.sssmpp.chatgpt.site](https://war-machine.sssmpp.chatgpt.site).

It runs the bundled Worker with D1 binding `DB` and the following live runtime configuration:

```text
WM_MODE=tempo-mainnet
WM_BOUNTY_ESCROW_VERSION=3
WM_BOUNTY_ESCROW_ADDRESS=0xb14a3aA99C9349094612143089F55aE5372DeB24
```

The Worker serves the game, account build vault, bounty metadata, wallet identity flow, direct escrow transaction plans, native MPP bounty relaying when V4 is enabled, receipt verification, deterministic simulations, and result-attestation state. Only the optional V4 relayer key is stored as a secret runtime variable; it is never sent to the browser or persisted in D1.

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

Static hosting supports local saves, exports, ordinary challenge links, and local simulations. Shared bounties require the Worker/D1 deployment.

## Mainnet safeguards

- Keep `WM_BOUNTY_ESCROW_ADDRESS` pinned to the verified deployed escrow.
- Never add a backend custody key, signer private key, or wallet seed phrase to Site runtime variables, D1, Git, or browser storage.
- Keep the two result signers independent and encrypted; see [PAYMENTS-OPERATIONS.md](PAYMENTS-OPERATIONS.md).
- Native MPP bounty charging is off until V4, the relayer address/key, `WM_AGENT_BOUNTY_MPP_*` values and `MPP_SECRET_KEY` have been intentionally configured. The relayer key must stay in the Worker secret store and the relayer must be funded/approved for the deployed V4 escrow.
- Use controlled small amounts while the manual two-signer settlement operation is in place.

## Release compatibility

After editing `dist/engine.mjs` or `dist/data.mjs`, run `node scripts/stamp-release.mjs`, run the tests, rebuild the Site bundle, and deploy the generated `dist/release.mjs`. This keeps result commitments and replays tied to the correct engine release.
