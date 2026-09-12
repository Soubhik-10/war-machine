# Hosting and cost boundary

User requirement, 12 September 2026: **Do not incur OpenAI hosting charges. Do not publish or redeploy this game on OpenAI Sites, enable paid hosting, add an API billing account, purchase credits, or enable automatic paid overages without a new explicit user instruction.** The user intends to choose their own host.

This implementation runs on the user's computer with Node and a local SQLite database. It has no OpenAI API calls, remote model inference, hosted database dependency, analytics, external asset CDN, or automatic deployment step. The optional Tempo/MPP SDKs do not provision hosting or transact in default demo mode. Browser API requests go to `/api` on the same game server.

The old **War Machines — The Foundry** Site was checked on 12 September 2026. It is still active, version 1, and accessible only to its owner. No access, deployment, billing or deletion settings were changed. Keeping source local does not delete that earlier Site. The current Sites tools expose no account invoice or hosting spend-cap control, so this check does not certify an invoice balance. Current official guidance says public-beta Sites usage is included up to plan-specific limits; it is not a permanent pricing guarantee. Source: https://help.openai.com/en/articles/20001339

## Run the complete game locally

Use Node 22.21.1 or a compatible newer runtime with `node:sqlite` and worker threads, then run `npm ci` for the pinned authentication/payment dependencies.

```sh
npm ci
node server.mjs
```

Open `http://127.0.0.1:8770/`. By default the server listens only on loopback and stores demo accounts, contracts, attempts and the credit ledger in `var/war-machines.sqlite`. Back up this database before replacing a running installation. Never commit or publicly serve `var/`.

## Later self-hosting

Choose a host separately. The complete game requires a persistent Node process, worker threads and a durable writable disk for SQLite. A static host supports the workshop and ordinary machine links, but cannot verify official bounties or maintain shared balances. Sites/Cloudflare Workers/Appwrite are not drop-in hosts for this Node/SQLite server; they need a deliberate runtime/database adapter.

There is no automatic deployment in this repository. Do not add a deployment workflow that can generate usage bills. Confirm the provider's actual limits, sleep/expiry behavior, persistence, hard spending cap and overage policy before choosing any advertised free tier. Keep billing disabled rather than relying on an email usage alert. No host has been selected or provisioned for this update.

For a user-approved deployment: terminate HTTPS in a reverse proxy, retain the original Host header, configure `HOST=0.0.0.0` only when intentionally exposing the service, set `PORT`, and point `DATABASE_PATH` at a persistent volume. Use one application instance per SQLite database. Set proxy request/body/rate limits, add robust identity and abuse controls before public competition, and budget CPU for the bounded simulation worker. Demo sign-up intentionally grants play credits; it is not resistant to multiple-account farming and must never back real money.

Deploy engine changes through a restart, never by editing a live process's simulation files. Engine-incompatible idle contracts are archived and their reserves returned. Accepted incompatible jobs are refunded. Historical receipts remain readable; exact old replay playback requires retaining that engine release.

Tempo wallet/passkey and MPP code is available only behind the fail-closed configuration in [TEMPO-MAINNET.md](TEMPO-MAINNET.md). No host or live deployment is authorized. Demo credits have no monetary value and must never be converted into tokens.

## Releasing simulation changes

After editing `dist/engine.mjs` or `dist/data.mjs`, run `node scripts/stamp-release.mjs`, then run the tests and restart the server. Commit the generated `dist/release.mjs` with the source. Startup refuses a mismatched stamp; stale browser tabs must reload before using the new contract engine. This guards replay consistency and does not publish or deploy anything.

## Agent season 02 resource boundaries

Source changes and a GitHub push do not publish or configure hosting. Guest API practice shares the bounded single worker with official trials, is limited to four requests/minute/IP and yields to pending official work. Agent candidate searches run on the agent owner’s own computer. No AI calls, managed wallets, relayers, fee sponsors, paid RPC or hosting purchase is enabled. Production HTTPS, durable disk, backups and host sizing remain a separate user-controlled deployment task.
