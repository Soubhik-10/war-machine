# Hosting operations

## Public deployment

The canonical public deployment is [warmachine.live](https://warmachine.live). The app, API, discovery document, and shared challenge links use this origin.

It runs the bundled Worker with D1 binding `DB` and the following live runtime configuration:

```text
WM_MODE=tempo-mainnet
WM_BOUNTY_ESCROW_VERSION=6
WM_ALLOW_ESCROW_V6=true
WM_BOUNTY_ESCROW_ADDRESS=<verified deployed V6 escrow>
WM_ESCROW_SETTLEMENT_SIGNER=<public V6 settlement signer>
WM_BOUNTY_RELAYER_ADDRESS=<public V6 relayer>
WM_TEMPO_SUPPORTED_TOKENS=0x20C0000000000000000000000000000000000000,0x20C000000000000000000000b9537d11c60E8b50
WM_TEMPO_SWAP_SLIPPAGE_BPS=100
```

The Worker serves the game, account build vault, bounty metadata, wallet identity flow, direct escrow transaction plans, native MPP bounty relaying, receipt verification, deterministic simulations, and result-attestation state. The active V6 relayer key is stored only as a protected runtime secret; it is never sent to the browser or persisted in D1.

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
- Never put a payout custody key, signer private key, or wallet seed phrase in public Site configuration, frontend code, D1, Git, or browser storage. The active V6 signer and relayer keys belong only in protected server-side Worker secret bindings. The V6 relayer is a bounded forwarding secret: native MPP payments are temporarily held by that relayer until the matching escrow call, so keep its balance, allowance and exposure small.
- V6 uses one fixed settlement signer; keep its key separate from the relayer and guardian. This is a trusted-operator model, not independent multi-signer protection.
- Keep native MPP bounty charging enabled only with the reviewed V6 escrow, relayer address/key, `WM_AGENT_BOUNTY_MPP_*` values, and `MPP_SECRET_KEY` intentionally configured. The relayer must be funded and approved for the deployed V6 escrow.
- The V6 escrow is the only active version for new paid bounty actions. Older contracts and recovery material are archived under [`contracts/stale/`](../contracts/stale/README.md); legacy Worker reads/recovery must not be used for new bounties.

## Release compatibility

After editing `dist/engine.mjs` or `dist/data.mjs`, run `node scripts/stamp-release.mjs`, run the tests, rebuild the Site bundle, and deploy the generated `dist/release.mjs`. This keeps result commitments and replays tied to the correct engine release.
