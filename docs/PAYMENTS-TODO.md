# War Machines — implementation and payment handoff

Updated 12 September 2026. **The Tempo mainnet code path is implemented and fail-closed; deployment, legal review, production operations, and live-funds verification remain open.** Demo mode is still the default and its credits never convert to tokens. See [TEMPO-MAINNET.md](TEMPO-MAINNET.md).

**Hosting constraint:** do not publish/redeploy on OpenAI Sites or enable paid hosting, API billing, purchases or automatic overages without a new explicit user instruction. The game runs locally with no OpenAI model calls. The earlier owner-private Site remains a separate hosted artifact. See HOSTING.md for the status check and limitations; account invoices were not accessible.

Source: [Soubhik-10/war-machine](https://github.com/Soubhik-10/war-machine). This local/demo release adds the bounty backend/UI, climate balance work and the disclosed platform-fee flow. It has not been publicly deployed.

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

Run `npm ci`, then `node server.mjs` or `play-local.bat`, and open `http://127.0.0.1:8770/`. Tested runtime: Node 22.21.1, built-in `node:sqlite`, worker threads. Node 22 prints an experimental SQLite warning. `serve.py` remains available for static-only sandbox play.

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

Demo only: 1,000 starting credits; default entry 10, gross reward 100, platform fee 2.5, winner payout 97.5, net win +87.5. New contracts snapshot a 2.5% (250 basis point) winning-reward fee; legacy contracts retain zero fee. Win closes the single reward. Loss/draw consumes entry and reopens if eligible. Technical failure refunds entry. Cancellation/expiry returns the unused reserve, but must wait for an accepted attempt to settle. Account owners cannot claim their own contract; this is not protection from multi-account abuse.

Entry/reward independently 0–1,000,000,000 whole demo credits; no required ratio; duration 0–8,760 hours, with 0 meaning no expiry; 20 active contracts per account. New personal caps default to null (no cap); owners can choose either cap, and zero means free entries only. Refunds adjust the day of their original attempt. All agent keys share account caps and balance. Agent keys can fund bounties, but cannot increase entry caps or mint/revoke keys; they can close their account’s idle contracts. Reward reservations are separate from daily entry caps and bounded by available balance.

Construction Standard remains 1,200 credits / 32 fitted parts plus one required command core / 360 t / 8 weapons. Custom can remove caps individually; Unlimited removes all four. Physical 243-socket, support, connected-core and ground-only rules always apply. The backend revalidates the challenger's build under the defender's immutable caps. Entry and gross reward inputs are checked as integers. SQLite balances and ledger amounts are integer thousandths of a credit; API balances and payouts use up to three decimal places. Fees use integer base-unit arithmetic with downward rounding. Balances are never accepted from clients.

Creation and entry require persisted idempotency keys. Clients save uncertain requests and retry with the same key/body/path. Server lookup happens before rechecking busy/closed state so a retry returns the accepted attempt. Credit entries, attempt creation and bounty lock commit together; results and ledger changes also commit together. Worker results never arrive through a public endpoint.

## 4. Verification and balance

Verification is recorded in BALANCE-REPORT.md and PLAYTEST.md; the current suite contains 133 tests. Run `npm test`. Tests cover win/loss/draw/refund, double-submit, two-client race, old worker fencing, expiry while active, restart persistence, cap enforcement, key revocation, malformed/over-limit builds, wrong-origin writes, real worker/browser-engine agreement, exact fee arithmetic, policy acknowledgement, atomic payout splitting, rollback, legacy-ledger migration, mainnet fail-closed configuration, identity challenge, paid holds, late refunds, settlement ordering and scoped paid agents. Terrain-on/off fixtures prove coolant cooling and wheel-speed changes, tread advantage on rubble, low-shot blockage by a ridge, and disclosed diminishing returns for repeated weapon banks. Rendering randomness is isolated from gameplay.

The accompanying BALANCE-REPORT.md records baseline/rerun samples, changed costs and observed weaknesses. Factory designs spend different budgets; two seeds per pairing are screening evidence only. Do not advertise a universally fair cash competition from these results. Random physical starting sides reduce systematic entrant-slot advantage but do not establish perfect map or first-hit symmetry.

## 5. Remaining gameplay/operations backlog

- [ ] Broader equal-budget weapon fixtures and held-out seeds for all 42 parts; adversarial optimization, mirrored matchups, EMP uptime, shield/repair stacking and passive integrity scoring.
- [ ] Mobile hardware performance and maximum-size battle load tests on the eventual deployment host; local timings are not cloud CPU allowances.
- [x] Search, arena/maximum-entry filters, Available/My contracts/Saved/Closed views and account bookmarks.
- [ ] Server cursor pagination, exact class filters and scalable search beyond the latest 100 contracts.
- [ ] Optional maximum attempt count per bounty; currently expiry/claim/cancel bound its life.
- [x] Separate per-agent reward-funding allowance, scopes, optional contract restrictions, expiry, per-entry cap, cumulative spend cap and revocation.
- [ ] Durable account recovery/authentication, signup abuse controls, administrator tools, DB backups/restore drills, metrics and alerts before a public launch. Demo anonymous grants are intentionally farmable.
- [ ] If scaling horizontally, replace the local worker/SQLite adapter with a durable cloud queue and transactional DB while preserving the lifecycle invariants.
- [ ] Retained version registry for exact replay across releases. Current safe policy archives/refunds incompatible live work and keeps historical receipts.
- [ ] Optional terrain-footprint sampling and dynamic rubble from destroyed cover. Current effects sample the core location consistently; rubble patches are fixed map features.
- [ ] Choose a host only under the no-paid-hosting constraint in HOSTING.md. No host, billing plan or automatic deployment is provisioned by this update.

The implementation items below are checked only where code and local tests now exist. Unchecked launch/operations items remain mandatory before accepting funds.

## 6. Detailed MPP / Tempo / mainnet TODO

### 6.0 Approved fee policy and settlement handoff

- [x] Owner approved **2.5% of gross winning reward**, with no minimum fee. Winner receives 97.5% before separate entry costs. Snapshot fee basis points on creation; never retroactively modify existing contracts.
- [x] Show gross reward, exact fee, winner payout, entry and net before creation/entry, on board cards, in receipts and agent documentation. Require explicit `maxPlatformFeeBps` for new economic requests.
- [x] Atomically split a verified win into winner payout and a separate platform-fee treasury. Loss, draw, refund, cancellation and expiry do not collect a payout fee. Entry fees remain separately accounted in the arena treasury.
- [x] Migrate old balances/ledger amounts once to integer thousandths while preserving value, history and legacy zero-fee terms. Keep physics/version hashes unchanged.
- [x] Publish downloadable `/skills/war-machines-engineer/SKILL.md`, with MPP and Tempo as paid-mode prerequisites, mode detection and spending boundaries.
- [x] Implement MPP-compatible client/server handling and Tempo wallet/passkey authorization. Discovery advertises payments only in paid mode.
- [x] Require explicitly configured and validated platform and escrow recipients; reject paid startup when they are missing, equal, malformed, or inconsistent with the signer.
- [x] Compute fee and winner amounts with integer arithmetic, then persist exact 6-decimal token base-unit strings.
- [x] Bind gross, fee basis points, fee policy version, exact fee, payout, entry, network cost and recipients to the immutable MPP metadata/application operation. Display network costs separately before consent.
- [x] Resolve paid entry policy: entry goes to arena escrow, remains there on loss/draw, and is refunded only for technical/late-payment failure. It is separate from the winning-reward fee.
- [x] Implement durable ordered winner/platform transfers and reconciliation. Platform submission depends on confirmed winner payout; ambiguous sends stop in `failed-needs-reconciliation` without blind retry.
- [ ] Test conservation, smallest supported reward, token rounding, zero-fee legacy terms, all non-win outcomes, revoked authority, insufficient funds and payout failure/recovery on an isolated test network.
- [ ] Do not convert demo balances or migrate demo grants to real money. No mainnet, paid hosting, automatic funding or fee sponsorship without explicit owner authorization.

Protocol references: [MPP challenge / credential / receipt flow](https://mpp.dev/blog/sessions-improved), [MPP credential verification](https://mpp.dev/sdk/typescript/server/Mppx.verifyCredential), [Tempo accounts](https://docs.tempo.xyz/guide/use-accounts). Verify SDK and chain configuration at integration time; do not blindly install unpinned packages.


### 6.1 Decisions to record before integration

- [x] Choose MPP `tempo.charge` with pinned official SDK versions. Final-host runtime/terms review is still a launch gate.
- [x] Record chain ID, RPC, token address, decimals, confirmation policy and explorer in [TEMPO-MAINNET.md](TEMPO-MAINNET.md).
- [x] Choose server-controlled custodial escrow with a dedicated signer and document that it is not a trustless contract.
- [x] Decide entry/refund/network-fee/unused-reward policy and reflect it in paid UI, receipts and operations documentation.
- [ ] Review the proposed paid-entry/prize activity for the launch jurisdictions and provider rules before enabling actual funds.
- [ ] Document operational ownership, refund support, incident handling and key recovery. Never depend on a developer's personal wallet remaining online.

### 6.2 Separate money from gameplay

- [x] Introduce MPP funding/verification and payout reconciliation adapters while preserving demo behavior and tests.
- [x] Use exact decimal strings in token base units for every financial operation; demo balances are never converted.
- [x] Require a dedicated mainnet database/ledger and record environment/currency on financial operations; paid and demo UI/discovery are distinct.
- [x] Use append-only financial operations with unique identities and idempotent reward, fee and refund allocation.
- [x] Keep accepted gameplay state distinct from requested/submitted/confirmed on-chain settlement state.

### 6.3 Wallet identity and spending authority

See [TEMPO-AUTH-TODO.md](TEMPO-AUTH-TODO.md) for the implementation sequence, proposed endpoints, wallet/passkey verification, guest boundary, migration, scoped agents and acceptance tests. Wallet connection, verified application login and payment authority are separate.

- [x] Prove wallet control with the official domain-bound Accounts challenge/session handler, short-lived atomic nonces and intended chain; verified wallet identity is the payout address.
- [x] Keep participant private keys in their wallet. The game accepts signatures and MPP credentials, never participant keys or seed phrases.
- [ ] Keep payout credentials in a server secret/signer, with minimal authority, rotation and documented backup/recovery.
- [x] Enforce maximum fee, per-entry/reward/cumulative spend, credential expiry and revocation independently of MPP transport.
- [x] Authenticate account/agent authority separately from MPP proof; payment alone grants no account mutation rights.

### 6.4 MPP request charging

- [x] Publish OpenAPI and machine-readable discovery with the active payment method, chain, token, decimals, recipients and fee policy.
- [x] Return an SDK-produced MPP `402 Payment Required` challenge only for reward funding and eligible official entries; browsing, rules and practice stay free.
- [x] Bind quotes to the operation, account, immutable blueprint/contract terms, exact amounts, currency, network, recipient and expiry.
- [x] Verify payments server-side with `mppx`; arbitrary hashes, booleans and unbound client receipts are not accepted.
- [x] Reject wrong recipient/token/network/amount, expired/replayed credentials and mismatched blueprints through fixed server configuration, SDK verification and application digests.
- [x] Resolve paid retries to the same bounty/attempt and retain proof references plus unique financial/payment operation mappings.
- [x] Return attempt IDs/status links after acceptance; polling does not invoke a charge.

### 6.5 Payment latency versus single active attempt

Payment integration adds a race that the demo-credit transaction does not have. Specify it deliberately:

- [x] Atomically hold the bounty before issuing an entry challenge so a losing racer is not asked to pay.
- [x] Limit each account to one live short-lived payment hold and apply API/auth rate limits.
- [x] Atomically convert one timely verified hold into one accepted attempt.
- [x] Record late/unusable confirmed payments and allocate one idempotent refund operation.
- [x] Preserve separate payment states for delayed finality/RPC outage; timeouts are not treated as proof of nonpayment.
- [x] Cover concurrent holds, duplicate acceptance, late refund and existing worker recovery with local automated tests.

### 6.6 Bounty funding and rewards

- [x] Require verified reward funding before a real bounty is listed.
- [x] Keep accepted-attempt reward reserves protected through expiry and crash recovery.
- [x] Implement requested/submitted/confirmed/failed-needs-reconciliation payout states and expose them separately from the battle result.
- [x] Allocate unique payout/refund identities and stop ambiguous transfers for reconciliation instead of retrying blindly.
- [x] Persist payout destination, amount, currency and network on immutable financial operations derived from verified identity.
- [ ] Maintain a reconciliation job comparing ledger obligations with provider/chain events. Alert on stuck jobs, missing confirmations, unexpected transfers and reserve shortfalls.
- [ ] If using a custom escrow contract, separately specify and review creator funding, winner authorization, cancellation, deadlines, dispute/admin powers, pause behavior and upgradeability. MPP does not decide the winner or implement this contract for us.

### 6.7 Supply-chain and production readiness

- [x] Use pinned official `mppx`, `accounts`, and `viem` versions with a committed lockfile.
- [ ] Review package provenance, transitive dependencies, install scripts, licenses and vulnerability reports. Do not add an unrelated wallet/UI framework merely to obtain one payment helper.
- [x] Bundle only public client code; MPP verification secret and escrow signer stay server-side.
- [ ] Start integration tests on an isolated test network. Exercise wrong chain/token/recipient, insufficient funds, reverted/delayed transactions, receipt replay, duplicate payouts, server restarts and rate limits.
- [ ] Benchmark the real host with maximum legal bounty builds and bounded concurrency. Local Node timings do not establish Sites/Appwrite CPU allowances.
- [x] Keep money operations disabled by default and require an explicit enable phrase, legal-review gate, HTTPS origin, dedicated database and reviewed destinations.
- [x] Enforce configurable per-operation/outstanding ceilings and document a payment stop switch. Production monitoring remains a launch task.
- [x] Publish the implemented economic, timing and failure/refund policy in [TEMPO-MAINNET.md](TEMPO-MAINNET.md).

## 7. Primary integration references

These are the implementation's primary protocol/provider references. Recheck versions and network configuration before deployment.

- [Machine Payments Protocol overview and source](https://github.com/tempoxyz/mpp): request payments through HTTP 402 and official SDK links.
- [MPP TypeScript SDK (`mppx`)](https://github.com/wevm/mppx): server verification, client handling, charge/session examples and receipts.
- [MPP documentation](https://mpp.dev/): current integration and discovery documentation.
- [Tempo documentation](https://docs.tempo.xyz/): current network, token and transaction details; fill configuration from verified documentation at implementation time.
- [ChatGPT Sites documentation](https://learn.chatgpt.com/docs/sites): supported hosting, data storage and plan-dependent limits.
- [Creating and managing Sites](https://help.openai.com/en/articles/20001339): current payment-provider and hosting terms guidance. Verify the chosen MPP/Tempo arrangement specifically before deployment.

## 8. Done means

The demo release satisfies the original completion criteria. The mainnet code remains disabled until every unchecked legal, operational, host, wallet-device and live-network verification task is completed by the operator.

## Releasing simulation changes

After editing `dist/engine.mjs` or `dist/data.mjs`, run `node scripts/stamp-release.mjs`, then run the tests and restart the server. Commit the generated `dist/release.mjs` with the source. Startup refuses a mismatched stamp; stale browser tabs must reload before using the new contract engine. This guards replay consistency and does not publish or deploy anything.
