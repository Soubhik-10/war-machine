# Hosting and cost boundary

User request, 12 September 2026: deploy an owner-private ChatGPT Sites release after the backend is production-ready. Do not purchase credits, enable automatic paid overages, or expose a paid bounty flow solely because a Site exists. A Site deployment remains separate from Tempo mainnet activation.

This implementation runs on the user's computer with Node and a local SQLite database. It has no OpenAI API calls, remote model inference, hosted database dependency, analytics, external asset CDN, or automatic deployment step. The optional Tempo/MPP SDKs do not provision hosting or transact in default demo mode. Browser API requests go to `/api` on the same game server.

The old **War Machines — The Foundry** Site was checked on 12 September 2026. It is still active, version 1, and accessible only to its owner. No access, deployment, billing or deletion settings were changed. Keeping source local does not delete that earlier Site. The current Sites tools expose no account invoice or hosting spend-cap control, so this check does not certify an invoice balance. Current official guidance says public-beta Sites usage is included up to plan-specific limits; it is not a permanent pricing guarantee. Source: https://help.openai.com/en/articles/20001339

## Run the complete game locally

Use Node 22.21.1 or a compatible newer runtime with `node:sqlite` and worker threads, then run `npm ci` for the pinned authentication/payment dependencies.

```sh
npm ci
node server.mjs
```

Open `http://127.0.0.1:8770/`. By default the server listens only on loopback and stores demo accounts, bounties, attempts and the credit ledger in `var/war-machines.sqlite`. Back up this database before replacing a running installation. Never commit or publicly serve `var/`.

## Later self-hosting

Choose a host separately. The complete game requires a persistent Node process, worker threads and a durable writable disk for SQLite. A static host supports the workshop and ordinary machine links, but cannot verify official bounties or maintain shared balances. Sites/Cloudflare Workers/Appwrite are not drop-in hosts for this Node/SQLite server; they need a deliberate runtime/database adapter.

ChatGPT Sites deployment is authorized for an owner-private release. It must not be used to publish the present Node/SQLite server as if it were a working backend: Sites expects a Worker-compatible server and durable bindings, while this server uses Node's SQLite and worker threads. Port account, ledger and queue storage to D1 (or use a separate production Node host) before deploying verified bounties or any payment path. Confirm the provider's actual limits, sleep/expiry behavior, persistence, hard spending cap and overage policy before accepting funds.

For a user-approved deployment: terminate HTTPS in a reverse proxy, retain the original Host header, configure `HOST=0.0.0.0` only when intentionally exposing the service, set `PORT`, and point `DATABASE_PATH` at a persistent volume. Use one application instance per SQLite database. Set proxy request/body/rate limits, add robust identity and abuse controls before public competition, and budget CPU for the bounded simulation worker. Demo sign-up intentionally grants play credits; it is not resistant to multiple-account farming and must never back real money.

Deploy engine changes through a restart, never by editing a live process's simulation files. Engine-incompatible idle bounties are archived and their reserves returned. Accepted incompatible jobs are refunded. Historical receipts remain readable; exact old replay playback requires retaining that engine release.

Tempo wallet and MPP code is available only behind the fail-closed configuration in [TEMPO-MAINNET.md](TEMPO-MAINNET.md). A deployment does not authorize mainnet activation. Demo credits have no monetary value and must never be converted into tokens.

## Releasing simulation changes

After editing `dist/engine.mjs` or `dist/data.mjs`, run `node scripts/stamp-release.mjs`, then run the tests and restart the server. Commit the generated `dist/release.mjs` with the source. Startup refuses a mismatched stamp; stale browser tabs must reload before using the new bounty engine. This guards replay consistency and does not publish or deploy anything.

## Agent season 02 resource boundaries

Source changes and a GitHub push do not publish or configure hosting. Guest API practice shares the bounded single worker with official trials, is limited to four requests/minute/IP and yields to pending official work. Agent candidate searches run on the agent owner’s own computer. No AI calls, managed wallets, relayers, fee sponsors, paid RPC or hosting purchase is enabled. Production HTTPS, durable disk, backups and host sizing remain a separate user-controlled deployment task.
