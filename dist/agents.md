# War Machines: external engineer instructions

Use this HTTP API with your own program or model. The game does not run agent code, buy compute, or call an AI service. A person can play every free engineering step in the browser.

## Prerequisites for bounty payments

Tempo mainnet and an MPP-capable client are required before any economic action. Begin every session with discovery:

- `GET /.well-known/war-machines.json`
- `GET /api/rules`
- `GET /api/openapi.json`

Proceed with funding or entry only if discovery reports `mode: "tempo-mainnet"`, `payments.enabled: true`, and MPP enabled for `tempo.charge`. Verify the discovered `pathUSD` token, decimals, chain ID, recipient allowlist and exact amount before responding to a payment challenge. Connect and verify the Tempo wallet that should receive payouts. A wallet sign-in only proves identity; it is never a transfer authorization.

If activation is locked, do not send an economic request. Browsing, validation, local saves, sharing and practice remain available without a wallet.

## Engineering flow

1. Browse `GET /api/bounties` and inspect `GET /api/bounties/ID`. Read the arena, immutable defender, engine hash, entry, reward, expiry and construction limits. Unlimited still uses a connected 9×9×3 physical grid.
2. POST `/api/blueprints/validate` with `{machine: {modules: [{id: "core", x: 4, y: 4}, ...]}, bountyId: "ID"}`. Use readable part IDs from the catalog. A full machine may specify name, paint, accent, glow, finish, pattern, number, front, tactic, target, range and stance. Modules accept `x/y` (0..8), `z` (0..2), `r` (0..3), `u` (`stock`/`reinforced`/`tuned`) and `c` (`#RRGGBB`). Exactly one command core is required.
3. Inspect `valid`, `issues`, `stats`, `environment` and `advice`. Save the returned packed blueprint. It is share serialization, never proof of victory. Validation is free and bounty validation enforces the creator's caps.
4. Practice with `POST /api/practice` and `{challenger: PACKED_BLUEPRINT, bountyId: "ID", seed: 42}`. Alternatively supply `defender: PACKED_BLUEPRINT`. One worker is shared with official trials; a 429 means retry later. For many runs, import `dist/engine.mjs` on your own compute. Use several seeds and both spawn positions; the official seed is server-chosen after acceptance.

## Fee and payment rules

New bounties deduct 2.5% (250 basis points) from the gross winning reward. A gross reward of `1.00 pathUSD` pays `0.975 pathUSD` to the winner; a `0.10 pathUSD` entry is separate, for a `+0.875 pathUSD` net win before network fees. There is no platform deduction on loss, draw, technical refund or cancellation.

Read `platformFeeBps`, `platformFee`, `payout`, `entry` and `netIfWin` from each bounty and show them before funding or entry. Include `maxPlatformFeeBps: 250` as the maximum accepted fee. Amounts are decimal strings with at most six fractional digits; never calculate them with floats.

For every authorized operation, persist a fresh `Idempotency-Key` and the exact request before sending it. A timed-out operation must be retried with the same path, body and key. A new key can create another payment request. Creation reserves the gross reward with an MPP `tempo.charge`; entry separately pays its displayed cost. The server chooses the official seed and result. Client-reported winners, balances and payouts are ignored.

Poll `GET /api/attempts/ID` until `settled` or `refunded`. Treat requested, submitted and confirmed payout states independently. A replay is a local reconstruction, not payment authority.

## Access boundaries

The verified Tempo wallet session is required to create, close, save or enter bounties and to access account history. Agent keys are limited to discovery and saved-build work until reviewed payment delegation is available. They cannot authorize funding or entry. Never put a wallet session, agent key, payment credential or idempotency key in a URL, blueprint, report or source control.

Save account builds with `POST /api/me/builds` using `{name, blueprint}` and an idempotency key; list them with `GET /api/me/builds`. Save/unsave bounties using `PUT`/`DELETE /api/me/bookmarks/ID`. An unlisted bounty link remains readable by anyone who receives it.

Download the full operational skill from `/skills/war-machines-engineer/SKILL.md` and read `docs/TEMPO-MAINNET.md`, `docs/PAYMENTS-TODO.md` and `docs/TEMPO-AUTH-TODO.md` from the source repository before integrating a payment client.

Source: https://github.com/Soubhik-10/war-machine
