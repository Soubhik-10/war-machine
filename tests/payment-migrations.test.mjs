import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { encodeAbiParameters, keccak256, padHex, stringToHex, toHex } from "viem";
import {
  paymentMigrationConstants,
  repairMislabeledBounties,
} from "../sites/worker/payment-migrations.mjs";

const escrow = "0x9999999999999999999999999999999999999999";
const creator = "0x1234567890123456789012345678901234567890";
const termsHash = "0x" + "ab".repeat(32);
const config = { escrowVersion: "5", escrowAddress: escrow };

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

class D1Fixture {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
  }
  prepare(sql) {
    return new Statement(this.sqlite.prepare(sql));
  }
  async migrate() {
    for (const name of [
      "0000_war_machines.sql",
      "0001_tempo_mainnet.sql",
      "0002_direct_escrow.sql",
      "0003_paid_reveal.sql",
      "0005_automatic_settlement.sql",
      "0006_reset_bounty_board_v3.sql",
      "0007_attempt_identity.sql",
      "0008_escrow_policy_identity.sql",
    ]) {
      this.sqlite.exec(await readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8"));
    }
  }
  close() {
    this.sqlite.close();
  }
}

const createdTopic = keccak256(
  stringToHex("BountyCreated(uint256,address,uint128,uint128,uint64,bytes32)"),
);

function receiptFor({ id, reward = 1000000n, entry = 10000n, creatorAddress = creator, eventEscrow = escrow, status = "0x1", tx = "0x" + "01".repeat(32) }) {
  const data = encodeAbiParameters(
    [{ type: "uint128" }, { type: "uint128" }, { type: "uint64" }, { type: "bytes32" }],
    [reward, entry, 1893456000n, termsHash],
  );
  return {
    status,
    transactionHash: tx,
    logs: [{
      address: eventEscrow,
      topics: [createdTopic, toHex(BigInt(id), { size: 32 }), padHex(creatorAddress, { size: 32 })],
      data,
    }],
  };
}

async function insertBounty(db, {
  id,
  policy = paymentMigrationConstants.LEGACY_POLICY,
  tx = "0x" + "01".repeat(32),
  bountyId = "7",
  reward = "1000000",
  entry = "10000",
  rowCreator = creator,
  status = "completed",
  listed = 0,
  includeAuthoritative = true,
} = {}) {
  db.sqlite.prepare(
    "INSERT INTO accounts (id,token_hash,name,balance,created,payout_address) VALUES (?,?,?,?,?,?)",
  ).run("owner-" + id, "token-" + id, "Owner", 0, 1, rowCreator);
  db.sqlite.prepare(
    "INSERT INTO bounties (id,owner,title,blueprint,entry,reward,status,listed,created,updated,entry_units,reward_units,reserve_units,platform_fee_bps,fee_policy_version,platform_recipient,escrow_bounty_id,terms_hash,escrow_create_tx) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    id,
    "owner-" + id,
    "Old bounty",
    "{}",
    0,
    0,
    status,
    listed,
    1,
    2,
    entry,
    reward,
    reward,
    250,
    policy,
    escrow,
    includeAuthoritative ? bountyId : null,
    includeAuthoritative ? termsHash : null,
    includeAuthoritative ? tx : null,
  );
}

test("repairs one proven V5 creation while preserving status, listing, and terms", async () => {
  const db = new D1Fixture();
  await db.migrate();
  try {
    const tx = "0x" + "11".repeat(32);
    await insertBounty(db, { id: "repair-one", tx, status: "completed", listed: 0 });
    let confirmations = 0;
    const result = await repairMislabeledBounties(db, config, async (hash) => {
      confirmations++;
      assert.equal(hash, tx);
      return receiptFor({ id: 7, tx });
    });
    assert.deepEqual(result, { scanned: 1, repaired: 1, skipped: 0 });
    assert.deepEqual({ ...db.sqlite.prepare("SELECT status,listed,entry_units,reward_units,fee_policy_version,terms_hash FROM bounties WHERE id=?").get("repair-one") }, {
      status: "completed",
      listed: 0,
      entry_units: "10000",
      reward_units: "1000000",
      fee_policy_version: paymentMigrationConstants.CURRENT_POLICY,
      terms_hash: termsHash,
    });
    assert.equal(confirmations, 1);
    assert.equal((await repairMislabeledBounties(db, config, async () => receiptFor({ id: 7, tx }))).scanned, 0);
  } finally {
    db.close();
  }
});

test("skips wrong emitter, amount, ID, reverted status, uncertain receipt, and incomplete rows", async () => {
  const db = new D1Fixture();
  await db.migrate();
  try {
    const cases = [
      ["bad-emitter", (tx) => receiptFor({ id: 7, tx, eventEscrow: "0x8888888888888888888888888888888888888888" })],
      ["bad-amount", (tx) => receiptFor({ id: 7, tx, reward: 999n })],
      ["bad-id", (tx) => receiptFor({ id: 8, tx })],
      ["bad-status", (tx) => receiptFor({ id: 7, tx, status: "0x0" })],
      ["uncertain", () => { throw new Error("RPC not finalized"); }],
      ["missing-fields", () => receiptFor({ id: 7 })],
    ];
    for (let index = 0; index < cases.length; index++) {
      const [id] = cases[index];
      await insertBounty(db, { id, bountyId: String(index + 7), includeAuthoritative: id !== "missing-fields" });
    }
    const txById = new Map(cases.map(([id], index) => [id, "0x" + (index + 20).toString(16).padStart(2, "0").repeat(32)]));
    const result = await repairMislabeledBounties(db, config, async (tx) => {
      const id = [...txById.entries()].find(([, value]) => value === tx)?.[0];
      return cases.find(([candidate]) => candidate === id)?.[1](tx);
    }, { limit: 5 });
    assert.equal(result.repaired, 0);
    assert.equal(result.scanned, 5);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM bounties WHERE fee_policy_version=?").get(paymentMigrationConstants.LEGACY_POLICY).count, 6);
  } finally {
    db.close();
  }
});

test("cursor lets a later batch reach a matching row after five genuine V4 rows", async () => {
  const db = new D1Fixture();
  await db.migrate();
  try {
    const txById = new Map();
    for (let index = 0; index < 5; index++) {
      const id = `0${index}-genuine-v4`;
      const tx = "0x" + String(index + 40).padStart(2, "0").repeat(32);
      txById.set(id, tx);
      await insertBounty(db, { id, tx, bountyId: String(index + 20) });
    }
    const matchingId = "zz-mislabeled-v5";
    const matchingTx = "0x" + "77".repeat(32);
    txById.set(matchingId, matchingTx);
    await insertBounty(db, { id: matchingId, tx: matchingTx, bountyId: "77" });
    const confirm = async (tx) => {
      if (tx !== matchingTx) throw new Error("genuine V4 row is not eligible");
      return receiptFor({ id: 77, tx });
    };
    assert.deepEqual(await repairMislabeledBounties(db, config, confirm), { scanned: 5, repaired: 0, skipped: 5 });
    assert.deepEqual(await repairMislabeledBounties(db, config, confirm), { scanned: 1, repaired: 1, skipped: 0 });
    assert.equal(db.sqlite.prepare("SELECT fee_policy_version FROM bounties WHERE id=?").get(matchingId).fee_policy_version, paymentMigrationConstants.CURRENT_POLICY);
  } finally {
    db.close();
  }
});

test("migration is a no-op outside escrow version five and never exceeds five rows", async () => {
  const db = new D1Fixture();
  await db.migrate();
  try {
    for (let index = 0; index < 7; index++) await insertBounty(db, { id: `bound-${index}`, tx: "0x" + String(index + 90).padStart(2, "0").repeat(32), bountyId: String(index + 90) });
    let confirmations = 0;
    const result = await repairMislabeledBounties(db, { ...config, escrowVersion: "6" }, async () => {
      confirmations++;
      return receiptFor({ id: 90 });
    });
    assert.deepEqual(result, { scanned: 0, repaired: 0, skipped: 0, reason: "escrow-version-not-v5" });
    assert.equal(confirmations, 0);
    const bounded = await repairMislabeledBounties(db, config, async (tx) => {
      confirmations++;
      return receiptFor({ id: 90, tx });
    });
    assert.equal(bounded.scanned, paymentMigrationConstants.MAX_BATCH);
    assert.equal(confirmations, paymentMigrationConstants.MAX_BATCH);
  } finally {
    db.close();
  }
});
