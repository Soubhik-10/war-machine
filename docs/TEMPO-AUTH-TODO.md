# Tempo identity and agent authorization — implementation status

Status: **implemented for the fail-closed Tempo mainnet mode; production device and operations verification remains open**. Demo mode retains hashed owner/agent bearer tokens. Guest building, local saves, machine links, browsing, validation and practice remain available without login.

Tempo supports EVM wallet accounts and WebAuthn/P-256 passkey accounts. Its embedded passkeys are tied to the application's relying-party domain; a production key manager needs recoverable public-key/account mapping rather than only browser storage. See the [official passkey guide](https://docs.tempo.xyz/guide/use-accounts/embed-passkeys) and [transaction authentication documentation](https://docs.tempo.xyz/learn/tempo/modern-transactions). These provide building blocks; they do not automatically authenticate this game's backend.

For compatible Ethereum message-signing wallets, [ERC-4361](https://eips.ethereum.org/EIPS/eip-4361) specifies an off-chain login proof with domain, URI, chain and nonce binding. Verify the signature and message on the server before issuing a session. Check the selected Tempo account's signature format: secp256k1, P-256, WebAuthn and contract signatures are not interchangeable. Do not assume every passkey supports an EOA `personal_sign` verifier.

The checked work below uses pinned `accounts` 0.16.0 and `viem` 2.55.13 packages. Reverify SDK and network configuration before deployment; see [TEMPO-MAINNET.md](TEMPO-MAINNET.md).

## AUTH-01 — identities and migration

- [x] Add identities with account ID, scheme, chain/network, canonical wallet address or credential reference, created/verified dates and database uniqueness.
- [ ] Choose the final HTTPS origin and passkey relying-party ID before enrollment. Document domain changes, subdomains, localhost development and a recovery path; changing domain can strand domain-bound credentials.
- [ ] Add an account recovery/export flow and a supported remote public-key registry. Never store private keys or seed phrases on the game server.
- [ ] Linking an existing demo account requires both its owner credential and a fresh proof from the new wallet. Do not merge accounts merely because a client supplies an address. Demo grants stay demo credits and never become claimable tokens.

Acceptance: the same verified identity recovers saved contracts on another supported device; an unrelated wallet cannot take over an existing account; guest workshop data remains available without login.

## AUTH-02 — server-verified login

- [x] Add wallet challenge/verify/session/logout and passkey registration/login/logout routes through the official Accounts handlers.
- [x] Use cryptographically random, short-lived, single-use challenges in an atomic SQLite KV store and rate-limit authentication routes.
- [x] Use the official Tempo Accounts authentication handler for chain/domain-bound EOA and supported contract/account signature verification.
- [x] Use the official WebAuthn handler for challenge, RP/origin, user-verification, algorithm, credential and counter checks; persist only public credential material.
- [x] Consume challenges atomically and use separate bounded Secure/HttpOnly/SameSite browser session cookies with same-origin request protection. Demo localStorage tokens do not become paid sessions.
- [ ] Treat account/chain changes, logout and credential revocation as session events. Reject arbitrary payout-address substitution; changing a payout destination requires fresh ownership proof and explicit approval.
- [x] Keep login free of transfers/on-chain transactions and preserve guest building, browsing and practice without wallet balance or gas.

Acceptance: replayed/expired nonces, wrong origin/RP/chain, unverified addresses, malformed signatures and stolen session fixation attempts fail without modifying accounts or funds.

## AUTH-03 — delegated agents

- [x] Keep browser wallet/passkey owners and headless bearer-token agents distinct; external agents do not emulate interactive passkey prompts.
- [x] Extend agent credentials with scopes (`read`, `bookmark`, `create`, `cancel-own`, `enter`), optional contract restrictions, expiry, per-entry/cumulative spend, and a separate reward-funding allowance.
- [ ] Owners choose those limits and may revoke or reduce them; agents cannot expand their own permissions. Null/unlimited must be explicit in the owner UI. Reserve simultaneous spending atomically across credentials.
- [x] Do not use Tempo access keys in this release; application-scoped credentials remain the enforceable delegation boundary.
- [x] Bind each agent operation to its authenticated account and application scope before MPP verification; payment alone grants no unrelated account permission.

Acceptance: an agent can scout, validate, practice, save, create and enter within owner-granted scopes, but cannot escalate, spend past a concurrent cap, or use a revoked key. Existing idempotent retries resolve to the original permitted operation.

## AUTH-04 — UI and costs

- [x] Keep a visible “Continue as guest” path and preserve selected contracts/drafts while requiring identity only for account actions.
- [x] Explain that login proves identity only; every entry/reward charge receives a separate itemized wallet confirmation and network-cost notice.
- [ ] Add connected identity, active sessions, delegated keys, chosen caps, revocation and recovery to the bounty account screen.
- [x] Do not enable a relayer, sponsor, hosted wallet, hosting deployment or paid RPC; paid startup is explicitly gated and player network fees are separate.
- [ ] Exercise mobile wallet deep links, browser cancellation, expired challenges, device recovery, domain migration and accessibility with real supported wallets/devices.

The original implementation order was identity model → verified login → guest/login UX → scoped agents → payment adapter. The remaining unchecked items are production enrollment, migration/recovery, session lifecycle, editable delegation, and real wallet/device testing. See [PAYMENTS-TODO.md](PAYMENTS-TODO.md) for settlement and mainnet gates.
