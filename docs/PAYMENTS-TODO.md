# War Machines — implementation and payment handoff

Updated 12 September 2026. **Demo bounty gameplay is implemented. Payments, wallets, MPP, Tempo and mainnet are not.** This document distinguishes the delivered local implementation from the next developer's TODOs.

**Hosting constraint:** do not publish/redeploy on OpenAI Sites or enable paid hosting, API billing, purchases or automatic overages without a new explicit user instruction. The game runs locally with no OpenAI model calls. The earlier owner-private Site remains a separate hosted artifact. See HOSTING.md for the status check and limitations; account invoices were not accessible.

Source baseline: Soubhik-10/war-machine, commit `9953540bae6e1e6d98c82fbcbf3d9c5b2df5afde`. This update adds the backend/UI and changes game balance. It has not been publicly deployed.

## 1. Delivered gameplay

- [x] Keep the 42-part workshop, 9×9×3 grid, front direction, doctrine, upgrades, paint, normal friend links, free simulation and cameras.
- [x] Create a bounty from the current machine with title, entry, reward, duration, arena and standard/custom/unlimited construction caps.
- [x] Reserve the full reward before listing; immutable accepted defender, rules, arena and engine/balance/terrain hash.
- [x] Stable `/#bounty=ID` sharing; listed/unlisted board, live contract state, closed receipts. Unlisted is not private.
- [x] Free practice and counter editing with locked contract limits; signup from a shared link returns to that contract.
- [x] One official active attempt per bounty, enforced by SQLite transaction and partial unique index.
- [x] Backend revalidates builds, applies account caps, generates seed/starting side, simulates and records win/loss/draw. No human referee and no client-result submission endpoint.
- [x] Duplicate-request protection; queued/running recovery with fencing tokens; bounded CPU/memory/ticks; one payout or refund only.
- [x] Profiles, persistent demo balances, reward reserves, append-only credit ledger entries, entry/daily caps, attempt history, owner-key backup, restricted agent keys and revocation.
- [x] Verified receipt → exact current-version replay → refit workflow. Local playback cannot award credits and restores the user's workshop draft on exit.
- [x] Meaningful coolant/rubble arenas, center-route terrain placement, hazard-aware steering, surface legends/minimap colors, ridge projectile occlusion and terrain regression tests.
- [x] Railgun/reverse-speed/ram balance changes, missile height guidance, mortar leading and cosmetic RNG isolation. Factory comparisons are evidence, not proof of universal balance.
- [x] Independent agent HTTP API and dependency-free example client. Agents bring their own model/compute; the game hosts no agent program.

- [x] Agent discovery, OpenAPI schema, named-part validation, environment analysis, guest server practice, CLI and a dry-run local candidate-selection loop.
- [x] New climate equipment and three arenas: cold generation, desert heat, brine drain, proportional mixed running gear.
- [x] Login-free landing/workshop/practice; accounts for bounties, bookmarks and official history; Forge/Glacier/Ember colorways.

## 2. Run and maintain

Run `node server.mjs` or `play-local.bat`, then open `http://127.0.0.1:8770/`. Tested runtime: Node 22.21.1, built-in `node:sqlite`, worker threads. No npm install. Use a compatible runtime; Node 22 prints an experimental SQLite warning. `serve.py` remains available for static-only sandbox play.

| File | Responsibility |
| --- | --- |
| `dist/data.mjs` | Shared parts/rules/validation/codecs, arena metadata and balance versions |
| `dist/engine.mjs` | Deterministic headless/browser simulation; no model calls |
| `dist/bounties.mjs`, `bounties.css` | Board, creation, terms, accounts, ledger, attempts and replay entry |
| `dist/app.mjs` | Workshop/practice/replay integration and contract context |
| `server/store.mjs` | SQLite schema, transactions, authorization, canonical input, caps, ledger and lifecycle |
| `server/battle-worker.mjs` | Runs the pinned engine in a bounded worker |
| `server.mjs` | Same-origin static/API server, request limits and durable queue processing |
| `var/war-machines.sqlite` | Local persisted game data; ignored, never ship in source or serve publicly |
| `tests/` | Mechanics, codec, renderer, economy, concurrency and HTTP integration tests |
| `examples/agent-client.mjs` | Explicit submission/status/retry client; no AI/payment SDK |

One server instance per SQLite database is the supported deployment shape. At most 16 queued/running trials globally; one worker at a time. Jobs have a 6002-tick bound, 30-second wall timeout, 192 MiB old-generation heap limit and 45-second recoverable lease. Lease identity is a fresh UUID plus persisted attempt count; stale completion is rejected. Three abandoned leases cause a refund. No browser tab or in-memory lock is the source of bounty ownership.

Restart through an intentional release, not by changing live simulation files. Worker startup verifies the engine content hash. Incompatible idle contracts are archived and reserves returned; accepted incompatible work is refunded. This release retains historical receipts, but does **not** bundle a multi-version engine registry: old exact replay needs that release restored. Do not silently replay under different physics.

Use `docs/AGENT-API.md` for the exact implemented request/response contract. State names: bounty `open/busy/claimed/expired/cancelled/archived`; attempt `queued/running/settled/refunded`, with win/loss/draw in the settled receipt. Engine winner 0 means challenger, 1 defender, -1 draw regardless of the randomly assigned physical starting side.

## 3. Economics and authorization

Demo only: 1,000 starting credits; default entry 10, reward 100, net win +90. Win closes the single reward. Loss/draw consumes entry and reopens if eligible. Technical failure refunds entry. Cancellation/expiry returns the unused reserve, but must wait for an accepted attempt to settle. Account owners cannot claim their own contract; this is not protection from multi-account abuse.

Entry/reward independently 0–1,000,000,000 whole demo credits; no required ratio; duration 0–8,760 hours, with 0 meaning no expiry; 20 active contracts per account. New personal caps default to null (no cap); owners can choose either cap, and zero means free entries only. Refunds adjust the day of their original attempt. All agent keys share account caps and balance. Agent keys can fund bounties, but cannot increase entry caps or mint/revoke keys; they can close their account’s idle contracts. Reward reservations are separate from daily entry caps and bounded by available balance.

Construction Standard remains 1,200 credits / 32 parts / 360 t / 8 weapons. Custom can remove caps individually; Unlimited removes all four. Physical 243-socket, support, connected-core and ground-only rules always apply. The backend revalidates the challenger's build under the defender's immutable caps. Money-like numbers are checked as integers, never clamped or accepted from client balances.

Creation and entry require persisted idempotency keys. Clients save uncertain requests and retry with the same key/body/path. Server lookup happens before rechecking busy/closed state so a retry returns the accepted attempt. Credit entries, attempt creation and bounty lock commit together; results and ledger changes also commit together. Worker results never arrive through a public endpoint.

## 4. Verification and balance

Verification is recorded in BALANCE-REPORT.md and PLAYTEST.md; the current suite contains 107 tests. Run `node --test tests/*.test.mjs`. Tests cover win/loss/draw/refund, double-submit, two-client race, old worker fencing, expiry while active, restart persistence, cap enforcement, key revocation, malformed/over-limit builds, wrong-origin writes and real worker/browser-engine agreement. Terrain-on/off fixtures prove coolant cooling and wheel-speed changes, tread advantage on rubble, and low-shot blockage by a ridge. Rendering randomness is isolated from gameplay.

The accompanying BALANCE-REPORT.md records baseline/rerun samples, changed costs and observed weaknesses. Factory designs spend different budgets; two seeds per pairing are screening evidence only. Do not advertise a universally fair cash competition from these results. Random physical starting sides reduce systematic entrant-slot advantage but do not establish perfect map or first-hit symmetry.

## 5. Remaining gameplay/operations backlog

- [ ] Broader equal-budget weapon fixtures and held-out seeds for all 42 parts; adversarial optimization, mirrored matchups, EMP uptime, shield/repair stacking and passive integrity scoring.
- [ ] Mobile hardware performance and maximum-size battle load tests on the eventual deployment host; local timings are not cloud CPU allowances.
- [x] Search, arena/maximum-entry filters, Available/My contracts/Saved/Closed views and account bookmarks.
- [ ] Server cursor pagination, exact class filters and scalable search beyond the latest 100 contracts.
- [ ] Optional maximum attempt count per bounty; currently expiry/claim/cancel bound its life.
- [ ] Separate per-agent reward-funding allowance and narrower scopes if agents should only enter; currently keys share account funds with disclosed limits.
- [ ] Durable account recovery/authentication, signup abuse controls, administrator tools, DB backups/restore drills, metrics and alerts before a public launch. Demo anonymous grants are intentionally farmable.
- [ ] If scaling horizontally, replace the local worker/SQLite adapter with a durable cloud queue and transactional DB while preserving the lifecycle invariants.
- [ ] Retained version registry for exact replay across releases. Current safe policy archives/refunds incompatible live work and keeps historical receipts.
- [ ] Optional terrain-footprint sampling and dynamic rubble from destroyed cover. Current effects sample the core location consistently; rubble patches are fixed map features.
- [ ] Choose a host only under the no-paid-hosting constraint in HOSTING.md. No host, billing plan or automatic deployment is provisioned by this update.

Everything below is future payment work. Do not convert demo credits to real funds or add a wallet SDK as a shortcut.

## 6. Detailed MPP / Tempo / mainnet TODO

### 6.1 Decisions to record before integration

- [ ] Choose the payment provider/method and verify compatibility with the final host's runtime and terms. General Sites backend support does not establish support for every payment method, contract, or long-running job.
- [ ] Record chain ID, RPC endpoints, token address, decimals, finality policy and explorer from current official network/token documentation. Do not copy testnet addresses or infer decimals from a currency label.
- [ ] Choose a funding/custody model: a payment provider or a separately designed escrow contract. A request-payment SDK is not automatically a bounty escrow/payout system.
- [ ] Decide who receives entry fees, whether any fee is refunded for a draw, who pays network fees, and what happens to unused rewards. The implemented rules must match the UI and terms before anyone pays.
- [ ] Review the proposed paid-entry/prize activity for the launch jurisdictions and provider rules before enabling actual funds.
- [ ] Document operational ownership, refund support, incident handling and key recovery. Never depend on a developer's personal wallet remaining online.

### 6.2 Separate money from gameplay

- [ ] Introduce a funding adapter with quote, verify incoming funds, reserve/release reward, settle win/loss, request refund and reconcile operations. Preserve the demo adapter for tests.
- [ ] Use integers/decimal strings in token base units. Never use floating-point dollars or silently convert demo credits to real tokens.
- [ ] Separate demo, testnet and mainnet databases/ledgers, credentials, endpoints and UI modes. Environment/currency are required fields on every financial operation.
- [ ] Use append-only accounting with unique operation identifiers. Establish conservation invariants for available funds, reserves, fees, refunds and payouts.
- [ ] Ledger state and on-chain/provider state are separate. An accepted API request is not evidence of final settlement.

### 6.3 Wallet identity and spending authority

See [TEMPO-AUTH-TODO.md](TEMPO-AUTH-TODO.md) for the implementation sequence, proposed endpoints, wallet/passkey verification, guest boundary, migration, scoped agents and acceptance tests. Wallet connection, verified application login and payment authority are separate.

- [ ] Prove wallet control with a domain-bound nonce challenge containing expiry, intended chain and purpose. Prevent replay. Explicitly bind it to the account/agent and intended payout address.
- [ ] Keep participant private keys on their own infrastructure or approved signer. Do not ask users to paste wallet keys into our game, logs or support chat.
- [ ] Keep payout credentials in a server secret/signer, with minimal authority, rotation and documented backup/recovery.
- [ ] Enforce owner-approved maximum fee, total spend, expiry and credential revocation independently of MPP transport.
- [ ] Authenticate the agent's account separately from verifying a payment. A payment alone need not establish which account may edit a bounty or change its payout address.

### 6.4 MPP request charging

- [ ] Publish API docs and machine-readable discovery with supported payment methods, currencies and fee policy.
- [ ] Return an MPP `402 Payment Required` challenge for an eligible unpaid official-attempt request; keep rules, public browsing and local practice free.
- [ ] Bind the quote to bounty/revision, validated blueprint hash, owner/agent, amount, currency, network, recipient, operation ID and expiry using the selected SDK/protocol's supported binding mechanism plus an application record where needed.
- [ ] Verify payment server-side with the supported SDK/provider. Never trust an arbitrary transaction hash, a client “paid” boolean or a receipt from a different operation.
- [ ] Reject wrong recipient, token, amount, network, expired quote, replayed receipt and mismatched submitted blueprint.
- [ ] Make a retried paid request resolve to the same official attempt. Retain proof/receipt references and a unique payment-to-operation mapping.
- [ ] Return a job/status URL after acceptance; polling an existing job must not charge again.

### 6.5 Payment latency versus single active attempt

Payment integration adds a race that the demo-credit transaction does not have. Specify it deliberately:

- [ ] Before asking a user to pay, atomically hold the available bounty for a short-lived quote. Display busy to other entrants; do not charge losers of that race.
- [ ] Rate-limit/limit unpaid quote holds to prevent an agent monopolizing a bounty for free.
- [ ] When timely valid payment is verified, atomically convert the hold into the existing accepted attempt. The same hold cannot start two battles.
- [ ] If payment arrives late, the quote has expired, or the bounty is no longer available, record and refund/credit it exactly once under the published policy. Do not drop received funds or take a reward already promised elsewhere.
- [ ] Account for eventual finality, delayed notifications and provider/RPC outages. A status timeout is not proof that no payment occurred.
- [ ] Test the full sequence with two agents, delays, duplicate requests, expired holds and worker crashes.

### 6.6 Bounty funding and rewards

- [ ] Require confirmed reward funding/reservation before a real bounty is listed as claimable.
- [ ] Keep accepted-attempt reserves protected through expiry and crash recovery.
- [ ] Implement payout states such as requested/submitted/confirmed/failed-needs-reconciliation. A pending payout is not displayed as received cash.
- [ ] Allocate a unique payout/refund identity. Before retrying after an ambiguous response, reconcile the previous transfer; do not blindly send another one.
- [ ] Persist payout destination, amount, currency and network at the appropriate immutable acceptance point. Any later address change requires explicit ownership verification and must not rewrite settled history.
- [ ] Maintain a reconciliation job comparing ledger obligations with provider/chain events. Alert on stuck jobs, missing confirmations, unexpected transfers and reserve shortfalls.
- [ ] If using a custom escrow contract, separately specify and review creator funding, winner authorization, cancellation, deadlines, dispute/admin powers, pause behavior and upgradeability. MPP does not decide the winner or implement this contract for us.

### 6.7 Supply-chain and production readiness

- [ ] Prefer the official maintained SDK for the selected language and payment method; pin exact versions and commit the dependency lockfile.
- [ ] Review package provenance, transitive dependencies, install scripts, licenses and vulnerability reports. Do not add an unrelated wallet/UI framework merely to obtain one payment helper.
- [ ] Keep dependencies and credentials off the static client unless they are intentionally public/client-safe.
- [ ] Start integration tests on an isolated test network. Exercise wrong chain/token/recipient, insufficient funds, reverted/delayed transactions, receipt replay, duplicate payouts, server restarts and rate limits.
- [ ] Benchmark the real host with maximum legal bounty builds and bounded concurrency. Local Node timings do not establish Sites/Appwrite CPU allowances.
- [ ] Keep money operations disabled by default. Require explicit production configuration and reviewed destinations before enabling mainnet.
- [ ] Launch with small per-operation and total outstanding-funds ceilings, monitoring and a documented stop switch. Do not automatically promote a testnet deployment to mainnet.
- [ ] Publish final economic rules, exact fees, payout timing and failure/refund behavior before taking actual funds.

## 7. Primary integration references

These describe protocol/provider capabilities, not an already implemented payment flow in this game. Recheck versions and network configuration when implementation starts.

- [Machine Payments Protocol overview and source](https://github.com/tempoxyz/mpp): request payments through HTTP 402 and official SDK links.
- [MPP TypeScript SDK (`mppx`)](https://github.com/wevm/mppx): server verification, client handling, charge/session examples and receipts.
- [MPP documentation](https://mpp.dev/): current integration and discovery documentation.
- [Tempo documentation](https://docs.tempo.xyz/): current network, token and transaction details; fill configuration from verified documentation at implementation time.
- [ChatGPT Sites documentation](https://learn.chatgpt.com/docs/sites): supported hosting, data storage and plan-dependent limits.
- [Creating and managing Sites](https://help.openai.com/en/articles/20001339): current payment-provider and hosting terms guidance. Verify the chosen MPP/Tempo arrangement specifically before deployment.

## 8. Done means

The demo release is complete when two separate clients or external agents can create/share a funded demo bounty, obey its exact build/economic caps, contend safely for its one attempt slot, receive a backend-produced result, and see a consistent single reward/refund outcome after reload and restart. Terrain must measurably affect the battle and the balance report must disclose its actual test coverage. Mainnet remains disabled until the payment TODOs are implemented and verified separately.

## Releasing simulation changes

After editing `dist/engine.mjs` or `dist/data.mjs`, run `node scripts/stamp-release.mjs`, then run the tests and restart the server. Commit the generated `dist/release.mjs` with the source. Startup refuses a mismatched stamp; stale browser tabs must reload before using the new contract engine. This guards replay consistency and does not publish or deploy anything.
