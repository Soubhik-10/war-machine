import test from "node:test";
import assert from "node:assert/strict";
import * as Challenge from "../node_modules/mppx/dist/Challenge.js";
import * as MppCredential from "../node_modules/mppx/dist/Credential.js";
import * as MppProof from "../node_modules/mppx/dist/tempo/Proof.js";
import { privateKeyToAccount } from "viem/accounts";
import {
  journaledCharge,
  paymentJournalKey,
  readJournal,
  recoverCharge,
  writeJournal,
} from "../sites/worker/payment-journal.mjs";
import { mainnetOpenApi } from "../sites/worker/openapi.mjs";
import { PRESETS, packChallenge } from "../dist/data.mjs";
import { CLIENT_ENGINE_HASH } from "../dist/release.mjs";
import { authorizeMppResume, mppCharge } from "../sites/worker/mainnet.mjs";

class KvDb {
  constructor() {
    this.values = new Map();
  }

  prepare(sql) {
    return new KvStatement(this, sql);
  }

  async batch(statements) {
    return Promise.all(statements.map((statement) => statement.run()));
  }
}

class KvStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  async first() {
    if (!this.sql.includes("SELECT value FROM payment_kv")) return null;
    const value = this.db.values.get(this.args[0]);
    return value === undefined ? null : { value };
  }

  async run() {
    const [key, raw] = this.args;
    if (this.sql.includes("ON CONFLICT(key) DO NOTHING")) {
      if (this.db.values.has(key)) return { meta: { changes: 0 } };
      this.db.values.set(key, raw);
      return { meta: { changes: 1 } };
    }
    if (this.sql.includes("DELETE FROM payment_kv")) {
      const existed = this.db.values.delete(key);
      return { meta: { changes: existed ? 1 : 0 } };
    }
    this.db.values.set(key, raw);
    return { meta: { changes: 1 } };
  }
}

const payer = "0x1111111111111111111111111111111111111111";
const otherPayer = "0x2222222222222222222222222222222222222222";
const credential = (hash, source = `pkh:tempo:4217:${payer}`) => ({
  source,
  payload: { type: "hash", hash },
});
const binding = {
  amount: "1000000",
  recipient: "0x3333333333333333333333333333333333333333",
  token: "0x4444444444444444444444444444444444444444",
  chainId: 4217,
};
const methodFor = ({ sender = payer, mode = "push", onBroadcast } = {}) => ({
  async validate() {
    return { details: { sender, mode } };
  },
  async broadcast() {
    onBroadcast?.();
    return { method: "tempo", status: "success", reference: "0xreceipt" };
  },
});

test("journaled charge records one paid transaction and recovery reuses its hash", async () => {
  const db = new KvDb();
  let sdkBroadcasts = 0;
  let confirms = 0;
  const wrapped = journaledCharge(methodFor({ onBroadcast: () => sdkBroadcasts++ }), {
    db,
    operation: "agent-bounty-create:once",
    credentialDigest: "digest-a",
    binding,
    confirm: async () => { confirms += 1; },
  });
  const args = { credential: credential("0x" + "11".repeat(32)) };
  await wrapped.broadcast(args);
  assert.equal(sdkBroadcasts, 1);
  assert.equal(confirms, 1);
  const saved = await readJournal(db, paymentJournalKey("agent-bounty-create:once"));
  assert.equal(saved.phase, "paid");
  assert.equal(saved.transactionHash, args.credential.payload.hash);
  let recoveryBroadcasts = 0;
  const recovered = await recoverCharge(db, "agent-bounty-create:once", binding, {
    confirm: async () => {},
    broadcast: async () => { recoveryBroadcasts += 1; },
  });
  assert.equal(recovered.phase, "paid");
  assert.equal(recoveryBroadcasts, 0);
});

test("a paid operation does not invoke the SDK broadcast again on the same credential", async () => {
  const db = new KvDb();
  let sdkBroadcasts = 0;
  const wrapped = journaledCharge(methodFor({ onBroadcast: () => sdkBroadcasts++ }), {
    db,
    operation: "agent-bounty-create:exact-once",
    credentialDigest: "digest-a",
    binding,
    confirm: async () => {},
  });
  const args = { credential: credential("0x" + "66".repeat(32)) };
  await wrapped.broadcast(args);
  await assert.rejects(wrapped.broadcast(args), /already paid|recover|original payment/);
  assert.equal(sdkBroadcasts, 1);
});

test("an operation cannot replace its first transaction with a second credential", async () => {
  const db = new KvDb();
  let sdkBroadcasts = 0;
  const wrapped = journaledCharge(methodFor({ onBroadcast: () => sdkBroadcasts++ }), {
    db,
    operation: "agent-bounty-create:one-transaction",
    credentialDigest: "digest-a",
    binding,
    confirm: async () => {},
  });
  await wrapped.broadcast({ credential: credential("0x" + "77".repeat(32)) });
  await assert.rejects(
    wrapped.broadcast({ credential: credential("0x" + "88".repeat(32)) }),
    /already paid|already has a payment|original payment/,
  );
  assert.equal(sdkBroadcasts, 1);
});

test("a transaction hash claimed by another operation is rejected before SDK broadcast", async () => {
  const db = new KvDb();
  const hash = "0x" + "22".repeat(32);
  const first = journaledCharge(methodFor(), {
    db,
    operation: "agent-bounty-create:first",
    credentialDigest: "digest-a",
    binding,
    confirm: async () => {},
  });
  await first.broadcast({ credential: credential(hash) });
  let broadcasts = 0;
  const second = journaledCharge(methodFor({ onBroadcast: () => broadcasts++ }), {
    db,
    operation: "agent-bounty-create:second",
    credentialDigest: "digest-b",
    binding,
    confirm: async () => {},
  });
  await assert.rejects(
    second.broadcast({ credential: credential(hash) }),
    /already belongs to a different operation/,
  );
  assert.equal(broadcasts, 0);
});

test("payer source mismatch is rejected before the journal can broadcast", async () => {
  const db = new KvDb();
  let broadcasts = 0;
  const wrapped = journaledCharge(methodFor({ onBroadcast: () => broadcasts++ }), {
    db,
    operation: "agent-bounty-entry:payer",
    credentialDigest: "digest-a",
    binding,
    confirm: async () => {},
  });
  await assert.rejects(
    wrapped.broadcast({ credential: credential("0x" + "33".repeat(32), `pkh:tempo:4217:${otherPayer}`) }),
    /does not match the verified payer/,
  );
  assert.equal(broadcasts, 0);
});

test("recovery rejects missing or malformed saved payment bindings", async () => {
  const db = new KvDb();
  const operation = "agent-bounty-entry:binding";
  await writeJournal(db, paymentJournalKey(operation), {
    operation,
    binding: { ...binding, recipient: undefined },
    source: payer,
    transactionHash: "0x" + "44".repeat(32),
    raw: null,
    phase: "validated",
  });
  await assert.rejects(
    recoverCharge(db, operation, binding, { confirm: async () => {}, broadcast: async () => {} }),
    /Saved payment terms differ/,
  );
  await writeJournal(db, paymentJournalKey(operation), {
    operation,
    binding: "not-json",
    source: payer,
    transactionHash: "0x" + "44".repeat(32),
    raw: null,
    phase: "validated",
  });
  await assert.rejects(
    recoverCharge(db, operation, binding, { confirm: async () => {}, broadcast: async () => {} }),
    /Saved payment terms differ/,
  );
});

test("validated recovery rebroadcasts only the saved raw transaction after a lost receipt", async () => {
  const db = new KvDb();
  const operation = "agent-bounty-create:lost-rpc";
  const hash = "0x" + "55".repeat(32);
  const raw = "0x76" + "aa".repeat(40);
  await writeJournal(db, paymentJournalKey(operation), {
    operation,
    binding,
    source: payer,
    transactionHash: hash,
    raw,
    phase: "validated",
  });
  let confirms = 0;
  let broadcastRaw;
  const recovered = await recoverCharge(db, operation, binding, {
    confirm: async () => {
      confirms += 1;
      if (confirms === 1) throw new Error("receipt RPC unavailable");
    },
    broadcast: async (value) => { broadcastRaw = value; },
  });
  assert.equal(broadcastRaw, raw);
  assert.equal(recovered.phase, "paid");
  assert.equal((await readJournal(db, paymentJournalKey(operation))).phase, "paid");
});

test("fresh signed zero proof resumes a paid operation only for the original payer and exact operation", async () => {
  const db = new KvDb();
  const account = privateKeyToAccount(`0x${"12".repeat(32)}`);
  const other = privateKeyToAccount(`0x${"34".repeat(32)}`);
  const config = {
    agentBountyMppEnabled: true,
    agentBountyMppRecipient: binding.recipient,
    token: binding.token,
    chainId: binding.chainId,
    decimals: 6,
    mppSecret: "m".repeat(32),
    origin: "https://arena.example",
    rpcUrl: "http://127.0.0.1:9",
  };
  const operation = "agent-bounty-create:zero-proof";
  await writeJournal(db, paymentJournalKey(operation), {
    operation,
    binding,
    source: account.address,
    credentialDigest: "original-paid-credential",
    transactionHash: "0x" + "99".repeat(32),
    raw: null,
    phase: "paid",
    receipt: { status: "success", reference: "0x" + "99".repeat(32) },
  });

  const zeroProofFor = async (resumeOperation, signer) => {
    const quote = await mppCharge(
      db,
      config,
      new Request("https://arena.example/api/resume"),
      {
        amountUnits: 0n,
        recipient: config.agentBountyMppRecipient,
        operation: "resume:" + resumeOperation,
        description: "resume authorization",
        meta: { kind: "agent-auth", scope: "read", engineHash: CLIENT_ENGINE_HASH },
        expires: Date.now() + 5 * 60 * 1000,
      },
    );
    assert.equal(quote.paid, false);
    const challenge = Challenge.fromResponse(quote.response);
    const signature = await signer.signTypedData(
      MppProof.typedData({
        account: signer.address,
        chainId: binding.chainId,
        challengeId: challenge.id,
        realm: challenge.realm,
      }),
    );
    return MppCredential.serialize(
      MppCredential.from({
        challenge,
        payload: { signature, type: "proof" },
        source: MppProof.proofSource({ address: signer.address, chainId: binding.chainId }),
      }),
    );
  };

  const originalProof = await zeroProofFor(operation, account);
  assert.equal(
    await authorizeMppResume(
      db,
      config,
      new Request("https://arena.example/api/resume", {
        headers: { Authorization: originalProof },
      }),
      operation,
      { source: account.address },
    ),
    null,
  );

  const wrongPayerProof = await zeroProofFor(operation, other);
  await assert.rejects(
    authorizeMppResume(
      db,
      config,
      new Request("https://arena.example/api/resume", {
        headers: { Authorization: wrongPayerProof },
      }),
      operation,
      { source: account.address },
    ),
    /original payer|does not identify/i,
  );

  const wrongOperationProof = await zeroProofFor(operation + ":other-operation", account);
  const wrongOperationResult = await authorizeMppResume(
    db,
    config,
    new Request("https://arena.example/api/resume", {
      headers: { Authorization: wrongOperationProof },
    }),
    operation,
    { source: account.address },
  );
  assert.equal(wrongOperationResult.paid, false);
  assert.equal(wrongOperationResult.response.status, 402);
});

test("expired saved transactions are quarantined without a replacement broadcast", async () => {
  const db = new KvDb();
  const operation = "agent-bounty-entry:expired";
  const hash = "0x" + "99".repeat(32);
  await writeJournal(db, paymentJournalKey(operation), {
    operation,
    binding,
    source: payer,
    transactionHash: hash,
    raw: "0xdeadbeef",
    validBefore: Math.floor(Date.now() / 1000) - 1,
    phase: "validated",
  });
  let broadcasts = 0;
  await assert.rejects(
    recoverCharge(db, operation, binding, { confirm: async () => { throw Error("receipt missing"); }, broadcast: async () => { broadcasts += 1; } }),
    /expired before finality|recovery is required/,
  );
  assert.equal(broadcasts, 0);
  assert.equal((await readJournal(db, paymentJournalKey(operation))).recoveryRequired, true);
});

test("a late receipt wins over an expired deadline and is marked paid without rebroadcast", async () => {
  const db = new KvDb();
  const operation = "agent-bounty-entry:late-receipt";
  const hash = "0x" + "aa".repeat(32);
  await writeJournal(db, paymentJournalKey(operation), {
    operation,
    binding,
    source: payer,
    transactionHash: hash,
    raw: "0x76" + "bb".repeat(40),
    validBefore: Math.floor(Date.now() / 1000) - 1,
    phase: "validated",
  });
  let broadcasts = 0;
  const paid = await recoverCharge(db, operation, binding, {
    confirm: async () => ({ status: "success", reference: hash }),
    broadcast: async () => { broadcasts += 1; },
  });
  assert.equal(paid.phase, "paid");
  assert.equal(broadcasts, 0);
  assert.equal((await readJournal(db, paymentJournalKey(operation))).phase, "paid");
});

test("OpenAPI build rules match packed blueprint fields and all schema references resolve", () => {
  const packed = packChallenge(PRESETS[0], "foundry", 0);
  const q = mainnetOpenApi.components.schemas.Blueprint.properties.q;
  assert.deepEqual(
    Object.keys(packed.q).sort(),
    ["combat", "credits", "mass", "mode", "parts", "weapons"],
  );
  assert.deepEqual(q.required, ["mode", "credits", "parts", "mass", "weapons", "combat"]);
  assert.equal(q.properties.parts.type.includes("integer"), true);

  const serialized = JSON.parse(JSON.stringify(mainnetOpenApi));
  const refs = [];
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (typeof value.$ref === "string") refs.push(value.$ref);
    for (const child of Object.values(value)) visit(child);
  };
  visit(serialized);
  for (const target of refs) {
    const parts = target.replace(/^#\//, "").split("/");
    let current = serialized;
    for (const part of parts) current = current?.[part.replaceAll("~1", "/").replaceAll("~0", "~")];
    assert.ok(current, `unresolved OpenAPI reference ${target}`);
  }
});
