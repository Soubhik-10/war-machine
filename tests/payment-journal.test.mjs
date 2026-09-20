import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  paymentJournalKey,
  readJournal,
  recoverCharge,
  writeJournal,
} from "../sites/worker/payment-journal.mjs";
import { boundedUnits, MAX_ESCROW_TOKEN_UNITS } from "../sites/worker/mainnet.mjs";

class D1 {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    for (const name of ["0000_war_machines", "0001_tempo_mainnet"])
      this.sqlite.exec(
        readFileSync(new URL(`../drizzle/${name}.sql`, import.meta.url), "utf8"),
      );
  }
  prepare(sql) {
    const statement = this.sqlite.prepare(sql);
    let args = [];
    const wrapper = {
      bind(...values) {
        args = values;
        return wrapper;
      },
      async first() {
        return statement.get(...args) || null;
      },
      async run() {
        return { meta: { changes: Number(statement.run(...args).changes) } };
      },
    };
    return wrapper;
  }
}

test("payment recovery reconciles object and mainnet-style string journals and rejects changed terms", async (t) => {
  const db = new D1();
  t.after(() => db.sqlite.close());
  const operation = "bounty-create:attempt-1";
  const binding = {
    amount: "1000000",
    recipient: "0x1111111111111111111111111111111111111111",
    token: "0x2222222222222222222222222222222222222222",
    chainId: 4217,
  };
  await writeJournal(db, paymentJournalKey(operation), {
    operation,
    binding: JSON.stringify(binding),
    source: "0x3333333333333333333333333333333333333333",
    credentialDigest: "digest",
    transactionHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    raw: "0xdeadbeef",
    phase: "validated",
  });

  let confirmed = 0;
  let broadcast = 0;
  const recovered = await recoverCharge(db, operation, { ...binding }, {
    confirm: async () => { confirmed += 1; },
    broadcast: async () => { broadcast += 1; },
  });
  assert.equal(recovered.phase, "paid");
  assert.equal(confirmed, 1);
  assert.equal(broadcast, 0);
  assert.equal((await readJournal(db, paymentJournalKey(operation))).phase, "paid");

  await assert.rejects(
    recoverCharge(db, operation, { ...binding, amount: "1000001" }, {
      confirm: async () => {},
      broadcast: async () => {},
    }),
    (error) => error.status === 409 && /terms differ/.test(error.message),
  );

  const objectOperation = "bounty-create:attempt-2";
  await writeJournal(db, paymentJournalKey(objectOperation), {
    operation: objectOperation,
    binding,
    transactionHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    phase: "validated",
  });
  const objectRecovered = await recoverCharge(db, objectOperation, JSON.stringify(binding), {
    confirm: async () => {},
    broadcast: async () => {},
  });
  assert.equal(objectRecovered.phase, "paid");
});

test("matching malformed bindings cannot authorize journal recovery", async (t) => {
  const db = new D1();
  t.after(() => db.sqlite.close());
  await writeJournal(db, paymentJournalKey("malformed"), { binding: {}, phase: "paid" });
  await assert.rejects(recoverCharge(db, "malformed", {}, {
    confirm: async () => assert.fail("Malformed terms must not reach RPC"),
    broadcast: async () => assert.fail("Malformed terms must not broadcast"),
  }), /terms differ/);
});

test("escrow amount validation rejects uint128 overflow before payment preparation", () => {
  assert.throws(
    () => boundedUnits(MAX_ESCROW_TOKEN_UNITS.toString()),
    /maximum|range|exceed/i,
  );
});

test("receipt reconciliation wins over an expired or quarantined journal", async (t) => {
  const db = new D1();
  t.after(() => db.sqlite.close());
  const operation = "bounty-create:late-receipt";
  const binding = {
    amount: "1000000",
    recipient: "0x1111111111111111111111111111111111111111",
    token: "0x2222222222222222222222222222222222222222",
    chainId: 4217,
  };
  await writeJournal(db, paymentJournalKey(operation), {
    operation,
    binding,
    source: "0x3333333333333333333333333333333333333333",
    transactionHash: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    raw: "0xdeadbeef",
    validBefore: 1,
    recoveryRequired: true,
    phase: "validated",
  });
  let broadcasts = 0;
  const recovered = await recoverCharge(db, operation, binding, {
    confirm: async () => ({ status: "success" }),
    broadcast: async () => { broadcasts += 1; },
  });
  assert.equal(recovered.phase, "paid");
  assert.equal(broadcasts, 0);
});
