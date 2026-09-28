# Free Challenges API

Free Challenges are isolated from wallets, Tempo, MPP, accounts, credits, and
escrow. A browser supplies a UUID client ID; the Worker stores only its
SHA-256 hash.

## Lifecycle

1. `POST /api/friendly-challenges` posts a 24-hour machine invite.
2. `POST /api/friendly-challenges/{challengeId}/accept` locks both packed
   blueprints, the arena, rules, objective, engine version, and a server-issued
   seed.
3. The Worker runs the headless deterministic battle itself. The accepting
   browser never submits a winner, damage total, replay, or rating change.
4. `GET /api/friendly-replays/{matchId}` returns the locked terms and compact
   battle telemetry for playback and share cards.

Completed match rows outlive their listing so a replay link remains valid.
Unaccepted listings are removed at their 24-hour expiry.

## Create a challenge

`POST /api/friendly-challenges`

```json
{
  "challengerName": "Ada",
  "title": "Can you break this build?",
  "clientId": "0d78007b-45ce-4ff7-8f97-074c17c56b0b",
  "blueprint": { "...": "packed machine challenge" },
  "rated": true
}
```

`rated` defaults to `false`. It records the creator's consent only; the
accepting player must also send `rated: true` for the match to affect rankings.

## Accept a challenge

`POST /api/friendly-challenges/{challengeId}/accept`

```json
{
  "clientId": "1cb37c11-95a1-4afd-929b-d639f70e7f52",
  "participantName": "Bea",
  "blueprint": { "...": "packed machine challenge using the locked terms" },
  "rated": true
}
```

The server rejects a different arena, ruleset, or objective. Repeating an
accept from the same browser returns the same match record; another browser
cannot replace the locked challenger build.

The successful response has this stable shape:

```json
{
  "id": "match UUID",
  "challengeId": "invite UUID",
  "status": "complete",
  "challengerName": "Bea",
  "defenderName": "Ada",
  "rated": true,
  "result": {
    "winner": 0,
    "outcome": "challenger",
    "time": 64.5,
    "damage": [412, 298],
    "reason": "Machine destroyed"
  },
  "replay": {
    "challenger": { "...": "locked packed blueprint" },
    "defender": { "...": "locked packed blueprint" },
    "arena": "foundry",
    "seed": 9182,
    "rules": { "...": "locked rules" },
    "objective": "reactor"
  },
  "rating": {
    "rated": true,
    "before": 1000,
    "after": 1024,
    "delta": 24,
    "opponentBefore": 1000,
    "opponentAfter": 976
  },
  "verifiedAt": 1790000000000
}
```

`winner` is `0` for the accepting challenger, `1` for the defender who posted
the invite, and `-1` for a draw.

## Replays and rankings

- `GET /api/friendly-matches/{matchId}` reads the compact match record.
- `POST /api/friendly-matches/{matchId}/verify` resumes a rare interrupted
  server verification without accepting a new player or changing the seed.
- `GET /api/friendly-replays/{matchId}` includes compact combat telemetry.
- `GET /api/friendly-leaderboard?scope=global`
- `GET /api/friendly-leaderboard?scope=season`
- `GET /api/friendly-leaderboard?scope=global&arena=foundry`
- `GET /api/friendly-leaderboard?scope=global&machineClass=heavy`

Global and seasonal rankings use Elo. New players use K=48 for their first ten
verified rated matches, then K=32. A draw has score 0.5. After three rated
matches between the same two browser identities in 24 hours, later matches
remain playable and replayable but do not change ratings.
