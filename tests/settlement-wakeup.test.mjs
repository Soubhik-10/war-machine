import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { acquireSettlementRunnerLease, settlementWakeupRequest } from "../sites/worker/mainnet.mjs";

test("only payment mutations and focused dynamic reads wake settlement", () => {
  const wakes = [
    ["POST", "/api/bounties"],
    ["POST", "/api/bounties/abc/attempts"],
    ["POST", "/api/escrow/intents/abc/confirm"],
    ["GET", "/api/attempts/11111111-1111-4111-8111-111111111111"],
    ["GET", "/api/me/attempts"],
    ["GET", "/api/bounties/11111111-1111-4111-8111-111111111111"],
    ["GET", "/api/bounties?scope=mine"],
    ["GET", "/api/bounties?scope=history"],
  ];
  const quiet = [
    ["GET", "/"], ["GET", "/app.mjs"], ["GET", "/api/rules"],
    ["GET", "/api/health"], ["GET", "/api/bounties"],
    ["GET", "/api/bounties?scope=public"], ["GET", "/api/bounties?scope=saved"],
    ["GET", "/.well-known/war-machines.json"],
  ];
  for (const [method, path] of wakes)
    assert.equal(settlementWakeupRequest(method, new URL(path, "https://local.test")), true, `${method} ${path}`);
  for (const [method, path] of quiet)
    assert.equal(settlementWakeupRequest(method, new URL(path, "https://local.test")), false, `${method} ${path}`);
});

test("overlapping wakeups share the D1 runner lease and may retry after expiry", async (t) => {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec("CREATE TABLE payment_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const db = { prepare(sql) {
    const statement = sqlite.prepare(sql);
    return { bind(...args) {
      return { async run() { return { meta: { changes: Number(statement.run(...args).changes) } }; } };
    } };
  } };
  assert.equal(await acquireSettlementRunnerLease(db, 1_000), true);
  assert.equal(await acquireSettlementRunnerLease(db, 1_000), false);
  assert.equal(await acquireSettlementRunnerLease(db, 31_000), false);
  assert.equal(await acquireSettlementRunnerLease(db, 31_001), true);
});
