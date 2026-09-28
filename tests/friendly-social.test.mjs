import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import worker from "../sites/worker/index.mjs";
import { DEFAULT_RULES, PRESETS, packChallenge } from "../dist/data.mjs";
import {
  FRIENDLY_REPEAT_RATING_LIMIT,
  calculateFriendlyRating,
  friendlySeason,
  purgeFriendlyChallenges,
  verifyFriendlyBattle,
} from "../server/friendly-challenges.mjs";

class Statement {
  constructor(statement) {
    this.statement = statement;
    this.args = [];
  }
  bind(...args) {
    this.args = args;
    return this;
  }
  async first() {
    return this.statement.get(...this.args) || null;
  }
  async all() {
    return { results: this.statement.all(...this.args) };
  }
  async run() {
    const result = this.statement.run(...this.args);
    return { meta: { changes: Number(result.changes) } };
  }
}

class D1Mock {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.sqlite.exec("PRAGMA foreign_keys = ON");
  }
  prepare(sql) {
    return new Statement(this.sqlite.prepare(sql));
  }
  async batch(statements) {
    return Promise.all(statements.map((statement) => statement.run()));
  }
  async migrate() {
    for (const migration of [
      "0000_war_machines.sql",
      "0010_friendly_challenges.sql",
      "0011_battle_meta.sql",
      "0012_social_challenges.sql",
    ])
      this.sqlite.exec(
        await readFile(new URL(`../drizzle/${migration}`, import.meta.url), "utf8"),
      );
  }
  close() {
    this.sqlite.close();
  }
}

const request = (path, method = "GET", body) =>
  new Request(`https://warmachine.example${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

const call = async (env, path, method, body) => {
  const response = await worker.fetch(request(path, method, body), env, {
    waitUntil() {},
  });
  return { status: response.status, body: await response.json() };
};

test("friendly ratings use published Elo math and keep a provisional first ten matches", () => {
  const equal = calculateFriendlyRating({ winner: 0 });
  assert.equal(equal.challenger.delta, 24);
  assert.equal(equal.defender.delta, -24);
  assert.equal(equal.challenger.k, 48);
  assert.equal(equal.defender.k, 48);

  const experienced = calculateFriendlyRating({
    challengerMatches: 10,
    defenderMatches: 11,
    winner: -1,
  });
  assert.equal(experienced.challenger.delta, 0);
  assert.equal(experienced.defender.delta, 0);
  assert.equal(experienced.challenger.k, 32);
  assert.equal(friendlySeason(Date.UTC(2026, 8, 28)), "2026-Q3");
  assert.equal(FRIENDLY_REPEAT_RATING_LIMIT, 3);
});

test("server verification is deterministic and records a compact replay", () => {
  const challenger = packChallenge(PRESETS[0], "foundry", 0, DEFAULT_RULES);
  const defender = packChallenge(PRESETS[1], "foundry", 0, DEFAULT_RULES);
  const first = verifyFriendlyBattle({ challenger, defender, seed: 9182 });
  const second = verifyFriendlyBattle({ challenger, defender, seed: 9182 });
  assert.deepEqual(first.result, second.result);
  assert.deepEqual(first.replay, second.replay);
  assert.ok(["challenger", "defender", "draw"].includes(first.result.outcome));
  assert.equal(first.replay.kind, "server-friendly");
  assert.equal("winner" in first.replay.result, true);
});

test("expired declined challenges remove their decline rows with the invite", async (t) => {
  const db = new D1Mock();
  await db.migrate();
  t.after(() => db.close());
  const env = { DB: db };
  const creator = "10000000-0000-4000-8000-000000000011";
  const decliner = "20000000-0000-4000-8000-000000000012";
  const blueprint = packChallenge(PRESETS[0], "foundry", 0, DEFAULT_RULES);
  const created = await call(env, "/api/friendly-challenges", "POST", {
    challengerName: "Creator",
    title: "Decline cleanup",
    clientId: creator,
    blueprint,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const declined = await call(
    env,
    `/api/friendly-challenges/${created.body.id}/decline`,
    "POST",
    { clientId: decliner },
  );
  assert.equal(declined.status, 200, JSON.stringify(declined.body));
  assert.equal(
    await purgeFriendlyChallenges(db, Number(created.body.expires)),
    1,
  );
  assert.equal(
    db.sqlite.prepare("SELECT COUNT(*) AS total FROM friendly_challenge_declines").get().total,
    0,
  );
});

test("a rated challenge locks both builds, verifies server-side, persists its replay, and updates boards once", async (t) => {
  const db = new D1Mock();
  await db.migrate();
  t.after(() => db.close());
  const env = { DB: db };
  const creator = "10000000-0000-4000-8000-000000000001";
  const challenger = "20000000-0000-4000-8000-000000000002";
  const defenderBlueprint = packChallenge(PRESETS[1], "foundry", 0, DEFAULT_RULES);
  const challengerBlueprint = packChallenge(PRESETS[0], "foundry", 0, DEFAULT_RULES);

  const created = await call(env, "/api/friendly-challenges", "POST", {
    challengerName: "Defender",
    title: "A fair rated match",
    clientId: creator,
    blueprint: defenderBlueprint,
    rated: true,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.rated, true);

  const accepted = await call(
    env,
    `/api/friendly-challenges/${created.body.id}/accept`,
    "POST",
    {
      clientId: challenger,
      participantName: "Challenger",
      blueprint: challengerBlueprint,
      rated: true,
    },
  );
  assert.equal(accepted.status, 201, JSON.stringify(accepted.body));
  assert.equal(accepted.body.status, "complete");
  assert.equal(accepted.body.challengerName, "Challenger");
  assert.equal(accepted.body.defenderName, "Defender");
  assert.equal(accepted.body.rated, true);
  assert.ok(accepted.body.verifiedAt);
  assert.equal(accepted.body.replay.arena, "foundry");
  assert.deepEqual(accepted.body.replay.challenger, challengerBlueprint);
  assert.deepEqual(accepted.body.replay.defender, defenderBlueprint);
  assert.ok([0, 1, -1].includes(accepted.body.result.winner));
  assert.equal(typeof accepted.body.rating.before, "number");
  assert.equal(typeof accepted.body.rating.opponentAfter, "number");

  const retry = await call(
    env,
    `/api/friendly-challenges/${created.body.id}/accept`,
    "POST",
    {
      clientId: challenger,
      participantName: "Challenger",
      blueprint: challengerBlueprint,
      rated: true,
    },
  );
  assert.equal(retry.status, 201, JSON.stringify(retry.body));
  assert.equal(retry.body.id, accepted.body.id);
  assert.equal(
    db.sqlite.prepare("SELECT COUNT(*) AS total FROM friendly_match_runs").get().total,
    1,
  );
  assert.equal(
    db.sqlite.prepare("SELECT COUNT(*) AS total FROM friendly_rating_events WHERE scope='global'").get().total,
    2,
  );

  const replay = await call(env, `/api/friendly-replays/${accepted.body.id}`, "GET");
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.id, accepted.body.id);
  assert.equal(replay.body.telemetry.kind, "server-friendly");
  assert.equal("creatorHash" in JSON.parse(JSON.stringify(replay.body.telemetry)), false);
  assert.equal(
    replay.body.links.share,
    `/?friendlyMatch=${accepted.body.id}#friendly`,
  );

  const board = await call(env, "/api/friendly-leaderboard?scope=global", "GET");
  assert.equal(board.status, 200, JSON.stringify(board.body));
  assert.equal(board.body.ratingBasis, "verified Elo");
  assert.equal(board.body.rankings.length, 2);
  assert.deepEqual(
    board.body.rankings.map((row) => row.name).sort(),
    ["Challenger", "Defender"],
  );

  const details = await call(env, `/api/friendly-challenges/${created.body.id}`, "GET");
  assert.equal(details.status, 200, JSON.stringify(details.body));
  assert.equal(details.body.match.id, accepted.body.id);
  assert.equal(details.body.status, "accepted");
});
