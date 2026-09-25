import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_RULES,
  PRESETS,
  packChallenge,
} from "../dist/data.mjs";
import {
  FRIENDLY_CHALLENGE_TTL_MS,
  handleFriendlyChallenges,
} from "../server/friendly-challenges.mjs";

class FriendlyDb {
  rows = [];

  prepare(sql) {
    const statement = {
      values: [],
      bind(...values) {
        this.values = values;
        return this;
      },
      run: async () => {
        if (sql.startsWith("DELETE FROM friendly_challenges")) {
          const previous = this.rows.length;
          this.rows = this.rows.filter((row) => row.expires > statement.values[0]);
          return { meta: { changes: previous - this.rows.length } };
        }
        if (sql.startsWith("INSERT INTO friendly_challenges")) {
          const [id, creator_hash, challenger_name, title, blueprint, engine_hash, created, expires] = statement.values;
          this.rows.push({ id, creator_hash, challenger_name, title, blueprint, engine_hash, created, expires });
          return { meta: { changes: 1 } };
        }
        throw Error(`Unexpected SQL: ${sql}`);
      },
      first: async () => {
        if (sql.includes("COUNT(*)") && sql.includes("creator_hash"))
          return { total: this.rows.filter((row) => row.creator_hash === statement.values[0] && row.expires > statement.values[1]).length };
        if (sql.includes("COUNT(*)"))
          return { total: this.rows.filter((row) => row.expires > statement.values[0]).length };
        if (sql.includes("WHERE id=?")) {
          const row = this.rows.find((item) => item.id === statement.values[0] && item.expires > statement.values[1]);
          return row ? { ...row } : null;
        }
        throw Error(`Unexpected SQL: ${sql}`);
      },
      all: async () => ({ results: this.rows.filter((row) => row.expires > statement.values[0]).map((row) => ({ ...row })) }),
    };
    return statement;
  }
}

const response = (value, status = 200) => ({ value, status });
const post = (db, body, timestamp) =>
  handleFriendlyChallenges({
    db,
    request: new Request("https://warmachine.live/api/friendly-challenges", { method: "POST" }),
    path: "/api/friendly-challenges",
    method: "POST",
    body,
    response,
    timestamp,
  });

test("friendly challenges expire exactly 24 hours after creation and board reads purge them", async () => {
  const db = new FriendlyDb();
  const timestamp = 1_800_000_000_000;
  const blueprint = packChallenge(PRESETS[0], "foundry", 0, DEFAULT_RULES);
  const created = await post(db, {
    challengerName: "Pilot One",
    title: "Try my build",
    clientId: crypto.randomUUID(),
    blueprint,
  }, timestamp);

  assert.equal(created.status, 201);
  assert.equal(created.value.expires - created.value.created, FRIENDLY_CHALLENGE_TTL_MS);
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].challenger_name, "Pilot One");
  assert.equal("creator_hash" in created.value, false);

  const board = await handleFriendlyChallenges({
    db,
    request: new Request("https://warmachine.live/api/friendly-challenges"),
    path: "/api/friendly-challenges",
    method: "GET",
    body: {},
    response,
    timestamp: created.value.expires,
  });
  assert.deepEqual(board.value, []);
  assert.equal(db.rows.length, 0);
});

test("friendly challenge creation is isolated and bounded per browser", async () => {
  const db = new FriendlyDb();
  const timestamp = 1_800_000_000_000;
  const blueprint = packChallenge(PRESETS[0], "foundry", 0, DEFAULT_RULES);
  const clientId = crypto.randomUUID();
  for (let index = 0; index < 3; index += 1) {
    const result = await post(db, {
      challengerName: "Pilot One",
      title: `Friendly ${index}`,
      clientId,
      blueprint,
    }, timestamp + index);
    assert.equal(result.status, 201);
  }
  await assert.rejects(
    post(db, {
      challengerName: "Pilot One",
      title: "One too many",
      clientId,
      blueprint,
    }, timestamp + 4),
    /three active friendly challenges/,
  );
  assert.equal(db.rows.length, 3);
});
