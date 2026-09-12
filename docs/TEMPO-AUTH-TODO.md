# Tempo identity and agent authorization — implementation TODO

Status: **planned, not connected**. The demo currently uses hashed owner/agent bearer tokens. Guest building, local saves, machine links, browsing, validation and practice are implemented without login. Bounty creation, bookmarks, official entries and account history require an account. Preserve this boundary when adding wallets.

Tempo supports EVM wallet accounts and WebAuthn/P-256 passkey accounts. Its embedded passkeys are tied to the application's relying-party domain; a production key manager needs recoverable public-key/account mapping rather than only browser storage. See the [official passkey guide](https://docs.tempo.xyz/guide/use-accounts/embed-passkeys) and [transaction authentication documentation](https://docs.tempo.xyz/learn/tempo/modern-transactions). These provide building blocks; they do not automatically authenticate this game's backend.

For compatible Ethereum message-signing wallets, [ERC-4361](https://eips.ethereum.org/EIPS/eip-4361) specifies an off-chain login proof with domain, URI, chain and nonce binding. Verify the signature and message on the server before issuing a session. Check the selected Tempo account's signature format: secp256k1, P-256, WebAuthn and contract signatures are not interchangeable. Do not assume every passkey supports an EOA `personal_sign` verifier.

The work below is an application design proposal. Verify exact supported methods and SDK versions against current official sources when implementing; no wallet SDK or chain configuration is installed here.

## AUTH-01 — identities and migration

- [ ] Add identities with account ID, scheme, chain/network, canonical wallet address, credential/public-key reference, created/verified dates. Enforce uniqueness in the database.
- [ ] Choose the final HTTPS origin and passkey relying-party ID before enrollment. Document domain changes, subdomains, localhost development and a recovery path; changing domain can strand domain-bound credentials.
- [ ] Add an account recovery/export flow and a supported remote public-key registry. Never store private keys or seed phrases on the game server.
- [ ] Linking an existing demo account requires both its owner credential and a fresh proof from the new wallet. Do not merge accounts merely because a client supplies an address. Demo grants stay demo credits and never become claimable tokens.

Acceptance: the same verified identity recovers saved contracts on another supported device; an unrelated wallet cannot take over an existing account; guest workshop data remains available without login.

## AUTH-02 — server-verified login

- [ ] Add `POST /api/auth/challenge`, `POST /api/auth/verify`, `GET /api/auth/session`, `POST /api/auth/logout`. These routes do not exist in the current demo.
- [ ] Generate a cryptographically random, short-lived, single-use nonce. Persist its hash, session binding, intended origin, chain, purpose and expiry. Rate-limit issue/verify attempts.
- [ ] For EOA SIWE, parse the exact standard message and verify all bindings plus signature. For contract accounts, use the appropriate ERC-1271 check on the intended chain. Define behavior for counterfactual accounts explicitly.
- [ ] For Tempo passkeys, use the supported WebAuthn proof flow: verify challenge, RP ID hash, allowed origin, user verification, algorithm and credential ownership on the server. Handle synced-credential counter semantics correctly; a wallet connection event alone proves nothing to our API.
- [ ] Consume the nonce atomically and rotate session identity. Use Secure, HttpOnly, SameSite cookies for browser sessions, CSRF/origin protection, bounded idle/absolute expiry and server revocation. Current demo owner tokens in localStorage should not become production wallet sessions.
- [ ] Treat account/chain changes, logout and credential revocation as session events. Reject arbitrary payout-address substitution; changing a payout destination requires fresh ownership proof and explicit approval.
- [ ] Login should prove identity without a transfer or on-chain transaction. Do not make guest play depend on wallet balance or gas. Server/RPC costs are a separate hosting decision.

Acceptance: replayed/expired nonces, wrong origin/RP/chain, unverified addresses, malformed signatures and stolen session fixation attempts fail without modifying accounts or funds.

## AUTH-03 — delegated agents

- [ ] Keep browser owners and headless agents distinct. A human may enroll with a passkey; an external agent normally uses its own approved signer or a revocable scoped credential. Do not require unattended agents to emulate Face ID prompts.
- [ ] Extend agent credentials with scopes (`read`, `bookmark`, `create`, `cancel-own`, `enter`), optional contract restrictions, expiry, per-entry and cumulative spend, and a **separate reward-funding allowance**. Current demo keys share account-wide entry caps and may reserve any available reward balance.
- [ ] Owners choose those limits and may revoke or reduce them; agents cannot expand their own permissions. Null/unlimited must be explicit in the owner UI. Reserve simultaneous spending atomically across credentials.
- [ ] If using Tempo access keys, verify their supported call/contract scopes, expiry and token-spending semantics. On-chain key restrictions supplement application authorization; they do not replace it.
- [ ] Bind each agent's application identity to the chosen MPP identity mechanism and each operation. A valid payment is not automatic permission to edit another owner's contract, change caps, or redirect a prize.

Acceptance: an agent can scout, validate, practice, save, create and enter within owner-granted scopes, but cannot escalate, spend past a concurrent cap, or use a revoked key. Existing idempotent retries resolve to the original permitted operation.

## AUTH-04 — UI and costs

- [ ] Keep a visible “Continue without signing in” path. Prompt for login only when creating/saving a bounty or entering an official attempt. Preserve the selected contract and draft across login.
- [ ] Explain what is being signed: login, delegation, entry payment, reward funding or payout destination change. Each is a separate operation with its own confirmation and authority.
- [ ] Add connected identity, active sessions, delegated keys, chosen caps, revocation and recovery to the bounty account screen.
- [ ] Do not auto-enable a relayer, fee sponsor, hosted wallet, OpenAI hosting or paid RPC. The owner has explicitly prohibited paid hosting/billing without new authorization. Record operator and player costs before enabling any funded feature.
- [ ] Exercise mobile wallet deep links, browser cancellation, expired challenges, device recovery, domain migration and accessibility with real supported wallets/devices.

Implement in order: identity model → test-only verified login → guest/login UX → scoped agents → payment adapter. See [PAYMENTS-TODO.md](PAYMENTS-TODO.md) for MPP quotes, the single-slot race, settlement, refunds and mainnet gates.
