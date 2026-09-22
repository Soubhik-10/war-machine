import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { purgePreV6Bounties } from "../sites/worker/legacy-purge.mjs";
import { mainnetFetch } from "../sites/worker/mainnet.mjs";
import { packChallenge, PRESETS } from "../dist/data.mjs";

class D1 {
  constructor() { this.sqlite = new DatabaseSync(":memory:"); }
  prepare(sql) {
    const statement = this.sqlite.prepare(sql);
    return { bind(...args) { return this.statement(args); }, statement(args = []) {
      return { async first() { return statement.get(...args) || null; },
        async all() { return { results: statement.all(...args) }; },
        async run() { return { meta: { changes: Number(statement.run(...args).changes) } }; } };
    }, async first() { return statement.get() || null; },
      async all() { return { results: statement.all() }; },
      async run() { return { meta: { changes: Number(statement.run().changes) } }; } };
  }
  async batch(statements) { return Promise.all(statements.map(statement => statement.run())); }
  close() { this.sqlite.close(); }
}

test("V6 cleanup removes proven pre-V6 app rows, preserves V6 and unknown orphans, and reruns safely", async (t) => {
  const db = new D1();
  t.after(() => db.close());
  for (const name of ["0000_war_machines.sql", "0001_tempo_mainnet.sql", "0002_direct_escrow.sql", "0003_paid_reveal.sql", "0005_automatic_settlement.sql", "0006_reset_bounty_board_v3.sql", "0007_attempt_identity.sql", "0008_escrow_policy_identity.sql", "0009_board_pagination.sql", "0010_free_email_challenges.sql"])
    db.sqlite.exec(await readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8"));
  const blueprint = JSON.stringify(packChallenge(PRESETS[0], "foundry", 0));
  db.sqlite.prepare("INSERT INTO accounts (id,token_hash,name,balance,created) VALUES ('owner','token','Owner',0,1)").run();
  const bounties = db.sqlite.prepare("INSERT INTO bounties (id,owner,title,blueprint,entry,reward,status,listed,created,updated,fee_policy_version) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
  for (const [id, status, policy] of [["old-open", "open", "pathusd-direct-escrow-v5"], ["old-busy", "busy", "pathusd-direct-escrow-v5"], ["old-unsettled", "busy", "pathusd-direct-escrow-v5"], ["current-v6", "open", "pathusd-direct-escrow-v6"], ["free-current", "open", "free-email-v1"]])
    bounties.run(id, "owner", id, blueprint, 0, 0, status, 1, 1, 1, policy);
  const attempts = db.sqlite.prepare("INSERT INTO attempts (id,bounty,account,blueprint,seed,status,created,updated) VALUES (?,?,?,?,?,?,?,?)");
  attempts.run("old-attempt", "old-unsettled", "owner", blueprint, 42, "queued", 1, 1);
  attempts.run("v6-attempt", "current-v6", "owner", blueprint, 42, "queued", 1, 1);
  db.sqlite.prepare("UPDATE attempts SET match_record='{}' WHERE id IN ('old-attempt','v6-attempt')").run();
  db.sqlite.prepare("INSERT INTO bookmarks (account,bounty,created) VALUES ('owner','old-open',1),('owner','current-v6',1)").run();
  const holds = db.sqlite.prepare("INSERT INTO payment_holds (id,account,bounty,request_key,digest,body,amount_units,purpose,expires,status,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
  holds.run("old-hold", "owner", "old-open", "old-key", "digest", "{}", "100", "direct-entry", 100, "held", 1, 1);
  holds.run("v6-hold", "owner", "current-v6", "v6-key", "digest", "{}", "100", "direct-entry", 100, "held", 1, 1);
  holds.run("unknown-hold", "owner", "unlinked", "unknown-key", "digest", "{}", "100", "mpp-create", 100, "held", 1, 1);
  holds.run("old-orphan", "owner", "unlinked-old", "old-orphan-key", "digest", '{"escrowVersion":"5"}', "100", "direct-create", 100, "held", 1, 1);
  holds.run("v6-orphan", "owner", "unlinked-v6", "v6-orphan-key", "digest", '{"escrowVersion":"6"}', "100", "direct-create", 100, "held", 1, 1);
  db.sqlite.prepare("INSERT INTO idempotency (account,key,kind,digest,ref,created) VALUES ('owner','old-key','entry','digest','old-attempt',1),('owner','v6-key','entry','digest','v6-attempt',1)").run();
  db.sqlite.prepare("INSERT INTO financial_operations (id,kind,account,ref,amount_units,recipient,status,created,updated) VALUES ('old-op','payout','owner','old-attempt','100','owner','requested',1,1),('v6-op','payout','owner','v6-attempt','100','owner','requested',1,1)").run();
  db.sqlite.prepare("INSERT INTO payment_kv (key,value) VALUES ('bounty-release:old-open','{}'),('bounty-release:current-v6','{}'),('settlement-broadcast:old-attempt','{}'),('unknown-journal','{\"phase\":\"paid\"}')").run();
  db.sqlite.prepare("INSERT INTO payment_kv (key,value) VALUES ('mpp-bounty-state:old-orphan','{\"escrowVersion\":\"5\"}'),('mpp-bounty-state:v6-orphan','{\"escrowVersion\":\"6\"}')").run();
  assert.deepEqual(await purgePreV6Bounties(db, { escrowVersion: "5" }), { ran: false });
  assert.deepEqual(await purgePreV6Bounties(db, { escrowVersion: "6" }), { ran: true, removedBounties: 3 });
  const rows = (table, column = "id") => db.sqlite.prepare(`SELECT ${column} FROM ${table} ORDER BY ${column}`).all().map(row => row[column]);
  assert.deepEqual(rows("bounties"), ["current-v6", "free-current"]);
  assert.deepEqual(rows("attempts"), ["v6-attempt"]);
  assert.deepEqual(rows("settlement_jobs", "attempt"), ["v6-attempt"]);
  assert.deepEqual(rows("settlement_audit", "attempt"), ["v6-attempt"]);
  assert.deepEqual(rows("payment_holds"), ["unknown-hold", "v6-hold", "v6-orphan"]);
  assert.deepEqual(rows("financial_operations"), ["v6-op"]);
  assert.deepEqual(rows("bookmarks", "bounty"), ["current-v6"]);
  assert.deepEqual(rows("idempotency", "key"), ["v6-key"]);
  assert.ok(rows("payment_kv", "key").includes("bounty-release:current-v6"));
  assert.ok(!rows("payment_kv", "key").includes("bounty-release:old-open"));
  assert.ok(!rows("payment_kv", "key").includes("mpp-bounty-state:old-orphan"));
  assert.ok(rows("payment_kv", "key").includes("mpp-bounty-state:v6-orphan"));
  assert.deepEqual(await purgePreV6Bounties(db, { escrowVersion: "6" }), { ran: false });
  assert.throws(() => db.sqlite.prepare("DELETE FROM attempts WHERE id='v6-attempt'").run(), /immutable match/);
  const oldDetail = await mainnetFetch(new Request("https://local.test/api/bounties/old-open"), { DB: db, WM_MODE: "tempo-mainnet", WM_BOUNTY_ESCROW_VERSION: "6", WM_ALLOW_ESCROW_V6: "true", WM_BOUNTY_ESCROW_ADDRESS: "0x6666666666666666666666666666666666666666" }, { waitUntil() {} }, () => new Response("missing", { status: 404 }));
  assert.equal(oldDetail.status, 404, await oldDetail.text());
});
