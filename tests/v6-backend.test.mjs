import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { privateKeyToAccount } from "viem/accounts";
import { encodeAbiParameters, keccak256, stringToHex } from "viem";
import {
  runtimeConfig,
  assertV6MigrationReady,
  automaticTimeoutState,
  validateEscrowAttestation,
  mainnetFetch,
  mppEnterBounty,
} from "../sites/worker/mainnet.mjs";
import { packChallenge, PRESETS } from "../dist/data.mjs";

const signerKey = "0x" + "0a".repeat(32);
const signer = privateKeyToAccount(signerKey);
const base = {
  WM_MODE: "tempo-mainnet",
  WM_BOUNTY_ESCROW_ADDRESS: "0x6666666666666666666666666666666666666666",
  WM_ESCROW_SETTLEMENT_SIGNER: signer.address,
  WM_SETTLEMENT_PRIVATE_KEY: signerKey,
  WM_RESULT_SIGNING_READY: "true",
  WM_BOUNTY_RELAYER_ADDRESS: "0x7777777777777777777777777777777777777777",
  WM_BOUNTY_RELAYER_PRIVATE_KEY: "0x" + "09".repeat(32),
  WM_AGENT_BOUNTY_MPP_ENABLED: "true",
  WM_AGENT_BOUNTY_MPP_MAX: "1.00",
  MPP_SECRET_KEY: "m".repeat(32),
};

const KNOWN_V5_ESCROW = "0x399A5BB89E814Cc3d7232f428796C56003D78983";
const V6_ESCROW = base.WM_BOUNTY_ESCROW_ADDRESS;
const BOUNTY_ID = "11111111-1111-4111-8111-111111111111";
const ATTEMPT_ID = "22222222-2222-4222-8222-222222222222";
const HOLD_ID = "33333333-3333-4333-8333-333333333333";
const TX_HASH = "0x" + "cd".repeat(32);
const creator = "0x1234567890123456789012345678901234567890";
const challenger = "0x2345678901234567890123456789012345678901";
const blueprint = packChallenge(PRESETS[0], "foundry", 0);
const blueprintJson = JSON.stringify(blueprint).replaceAll("'", "''");

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
  async batch(statements) {
    return Promise.all(statements.map((statement) => statement.run()));
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
    ])
      this.sqlite.exec(
        await readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8"),
      );
  }
  close() {
    this.sqlite.close();
  }
}

const addrTopic = (address) =>
  "0x" + address.slice(2).toLowerCase().padStart(64, "0");
const uintTopic = (value) =>
  "0x" + BigInt(value).toString(16).padStart(64, "0");
const words = (...values) =>
  "0x" + values.map((value) => BigInt(value).toString(16).padStart(64, "0")).join("");
const timeoutTopic = keccak256(
  stringToHex("TimedOutAttemptRefunded(uint256,uint64,address,address,uint128)"),
);
const v6Domain = (address) =>
  keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
      ],
      [
        keccak256(
          stringToHex(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
          ),
        ),
        keccak256(stringToHex("War Machines Bounty Escrow")),
        keccak256(stringToHex("6")),
        4217n,
        address,
      ],
    ),
  );

async function seedD1(db, { pendingHold = false } = {}) {
  await db.migrate();
  const stamp = Date.now();
  db.sqlite.exec(`
    INSERT INTO accounts (id,token_hash,name,balance,created,payout_address)
      VALUES ('creator','creator-token','Creator',0,${stamp},'${creator}'),
             ('challenger','challenger-token','Challenger',0,${stamp},'${challenger}');
    INSERT INTO bounties (id,owner,title,blueprint,entry,reward,status,listed,active_attempt,created,updated,entry_units,reward_units,reserve_units,escrow_bounty_id,escrow_attempt_nonce,escrow_attempt_deadline,fee_policy_version,platform_fee_bps)
      VALUES ('${BOUNTY_ID}','creator','V6 fixture','${blueprintJson}',0,0,'busy',1,'${ATTEMPT_ID}',${stamp},${stamp},'10000','1000000','1000000','42',7,${stamp - 300000},'pathusd-direct-escrow-v6',250);
    INSERT INTO attempts (id,bounty,account,blueprint,seed,status,created,updated,escrow_entry_tx,participant_name,show_address)
      VALUES ('${ATTEMPT_ID}','${BOUNTY_ID}','challenger','${blueprintJson}',1,'engineering',${stamp},${stamp},'0x${"aa".repeat(32)}','Challenger',0);
    INSERT INTO settlement_jobs (attempt,created,updated) VALUES ('${ATTEMPT_ID}',${stamp},${stamp});
    INSERT INTO sessions (id,token_hash,account,expires,created)
      VALUES ('session-challenger','${createHash("sha256").update("v6-test-session").digest("hex")}','challenger',${stamp + 3600000},${stamp});
    INSERT INTO payment_holds (id,account,bounty,request_key,digest,body,amount_units,purpose,expires,status,created,updated)
      VALUES ('${HOLD_ID}','challenger','${BOUNTY_ID}','timeout-forfeit-fixture','fixture','{}','0','direct-timeout-forfeit',${stamp + 3600000},'awaiting-onchain',${stamp},${stamp});
  `);
  if (pendingHold)
    db.sqlite.exec(
      `INSERT INTO payment_holds (id,account,bounty,request_key,digest,body,amount_units,purpose,expires,status,created,updated) VALUES ('pending-v6-hold','creator','${BOUNTY_ID}','pending-v6','fixture','{}','10000','direct-create',${stamp + 3600000},'awaiting-onchain',${stamp},${stamp})`,
    );
}

const rpcReceipt = ({ entry = 10000n, creatorAddress = creator, challengerAddress = challenger, nonce = 7n } = {}) => ({
  status: "0x1",
  blockNumber: "0x10",
  blockHash: "0x" + "ef".repeat(32),
  logs: [
    {
      address: V6_ESCROW,
      topics: [timeoutTopic, uintTopic(42), uintTopic(nonce), addrTopic(challengerAddress)],
      data: words(BigInt("0x" + creatorAddress.slice(2)), entry),
    },
  ],
});

async function confirmTimeoutVariant(variant = {}) {
  const db = new D1Fixture();
  await seedD1(db);
  const oldFetch = globalThis.fetch;
  const receiptValue = rpcReceipt(variant);
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(init.body);
    const result =
      body.method === "eth_getTransactionReceipt"
        ? receiptValue
        : body.method === "eth_getBlockByNumber"
          ? body.params[0] === "finalized"
            ? { number: "0x10" }
            : { hash: "0x" + "ef".repeat(32) }
          : body.method === "eth_chainId"
            ? "0x1079"
            : null;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const response = await mainnetFetch(
      new Request(`https://foundry.example/api/escrow/intents/${HOLD_ID}/confirm`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "wm_session=v6-test-session",
        },
        body: JSON.stringify({ transactionHash: TX_HASH }),
      }),
      {
        DB: db,
        ...base,
        WM_BOUNTY_ESCROW_VERSION: "6",
        WM_ALLOW_ESCROW_V6: "true",
        WM_TEMPO_RPC_URL: "https://tempo-rpc.fixture",
      },
      { waitUntil() {} },
    );
    return { response, db };
  } finally {
    globalThis.fetch = oldFetch;
  }
}

test("V6 remains opt-in and publishes one signer with a two-minute grace", () => {
  const disabled = runtimeConfig({ ...base, WM_BOUNTY_ESCROW_VERSION: "6" }, "https://foundry.example");
  assert.equal(disabled.enabled, false);
  assert.match(disabled.reason, /ALLOW_ESCROW_V6/);
  const config = runtimeConfig({ ...base, WM_BOUNTY_ESCROW_VERSION: "6", WM_ALLOW_ESCROW_V6: "true" }, "https://foundry.example");
  assert.equal(config.enabled, true);
  assert.equal(config.acceptingNewBounties, true);
  assert.equal(config.settlementGraceSeconds, 120);
  assert.equal(config.settlementSigners.length, 1);
  assert.ok(/^0x[0-9a-f]{64}$/i.test(config.v6DomainSeparator));
});

test("V6 admission ignores ordinary funded V5 rows because escrows are separate", async () => {
  const db = {
    prepare(sql) {
      return {
        bind() { return this; },
        async all() { return { results: [] }; },
      };
    },
  };
  await assertV6MigrationReady(db, { escrowVersion: "6" });
  const clean = { prepare() { return { bind() { return this; }, async all() { return { results: [] }; } }; } };
  await assertV6MigrationReady(clean, { escrowVersion: "6" });
});

test("V6 settlement signatures use the version 6 domain and never offer V5 technical retry", async () => {
  const config = runtimeConfig({ ...base, WM_BOUNTY_ESCROW_VERSION: "6", WM_ALLOW_ESCROW_V6: "true" }, "https://foundry.example");
  const payload = { bountyId: "7", attemptNonce: "1", outcome: 0, resultHash: "0x" + "ab".repeat(32), validUntil: Math.floor(Date.now() / 1000) + 60 };
  const signature = await signer.signTypedData({
    domain: { name: "War Machines Bounty Escrow", version: "6", chainId: config.chainId, verifyingContract: config.escrowAddress },
    types: { Settlement: [
      { name: "bountyId", type: "uint256" }, { name: "attemptNonce", type: "uint64" },
      { name: "outcome", type: "uint8" }, { name: "resultHash", type: "bytes32" }, { name: "validUntil", type: "uint64" },
    ] },
    primaryType: "Settlement",
    message: { bountyId: 7n, attemptNonce: 1n, outcome: 0, resultHash: payload.resultHash, validUntil: BigInt(payload.validUntil) },
  });
  const recovered = await validateEscrowAttestation(config, payload, [signature]);
  assert.equal(recovered.length, 1);
  assert.equal(config.technicalRetryEnabled, false);
  assert.equal(automaticTimeoutState({ status: "engineering", build_deadline: 1 }, { escrow_attempt_deadline: Date.now() - 121000 }, Date.now(), config), "onchain-finalizer");
});

test("V6 rejects the known V5 escrow address before it can accept funds", () => {
  const config = runtimeConfig(
    {
      ...base,
      WM_BOUNTY_ESCROW_VERSION: "6",
      WM_BOUNTY_ESCROW_ADDRESS: KNOWN_V5_ESCROW,
      WM_ALLOW_ESCROW_V6: "true",
    },
    "https://foundry.example",
  );
  assert.equal(config.enabled, false);
  assert.match(config.reason, /V5|different|address/i);
});

test("V6 config exposes the exact EIP712 version 6 domain separator", () => {
  const config = runtimeConfig(
    { ...base, WM_BOUNTY_ESCROW_VERSION: "6", WM_ALLOW_ESCROW_V6: "true" },
    "https://foundry.example",
  );
  assert.equal(config.v6DomainSeparator, v6Domain(V6_ESCROW));
  assert.equal(config.settlementSigners.length, 1);
  assert.equal(config.technicalRetryEnabled, false);
});

test("V6 migration guard blocks funded V4 rows and pending escrow holds", async () => {
  const db = new D1Fixture();
  await seedD1(db, { pendingHold: true });
  db.sqlite.exec(
    `INSERT INTO bounties (id,owner,title,blueprint,entry,reward,status,listed,created,updated,entry_units,reward_units,reserve_units,escrow_bounty_id,fee_policy_version) VALUES ('44444444-4444-4444-8444-444444444444','creator','Mislabelled V4','${blueprintJson}',0,0,'completed',1,1,1,'10000','1000000','1000000','4','pathusd-direct-escrow-v4')`,
  );
  await assert.rejects(
    assertV6MigrationReady(db, { escrowVersion: "6" }),
    (error) => error.status === 503 && /V5|funded|pending/i.test(error.message),
  );
  db.sqlite.exec(
    "DELETE FROM bounties WHERE fee_policy_version='pathusd-direct-escrow-v4'",
  );
  await assert.rejects(
    assertV6MigrationReady(db, { escrowVersion: "6" }),
    (error) => error.status === 503 && /pending|hold|funded|active/i.test(error.message),
  );
  db.close();
});

test("V6 board keeps listed V5 bounties visible and read-only", async () => {
  const db = new D1Fixture();
  await db.migrate();
  const stamp = Date.now();
  db.sqlite.exec(`
    INSERT INTO accounts (id,token_hash,name,balance,created,payout_address)
      VALUES ('legacy-owner','legacy-owner-token','Legacy owner',0,${stamp},'${creator}');
    INSERT INTO bounties (id,owner,title,blueprint,entry,reward,status,listed,created,updated,entry_units,reward_units,reserve_units,escrow_bounty_id,fee_policy_version,platform_fee_bps)
      VALUES ('55555555-5555-4555-8555-555555555555','legacy-owner','Legacy V5 challenge','${blueprintJson}',0,0,'open',0,${stamp},${stamp},'10000','1000000','1000000','55','pathusd-direct-escrow-v5',250);
  `);
  const env = {
    ...base,
    WM_BOUNTY_ESCROW_VERSION: "6",
    WM_ALLOW_ESCROW_V6: "true",
    DB: db,
  };
  try {
    const result = await mainnetFetch(
      new Request("https://foundry.example/api/bounties"),
      env,
      { waitUntil() {} },
      () => new Response("not found", { status: 404 }),
    );
    assert.equal(result.status, 200);
    const rows = await result.json();
    const legacy = rows.find((row) => row.id === "55555555-5555-4555-8555-555555555555");
    assert.equal(legacy.escrowVersion, "5");
    assert.equal(legacy.legacy, true);
    assert.equal(legacy.readOnly, true);
    assert.equal(legacy.canEnter, false);
    assert.match(legacy.compatibilityReason, /Legacy V5 challenge.*read-only/);
  } finally {
    db.close();
  }
});

test("V6 MPP entry rejects a legacy V5 bounty before charging", async () => {
  const db = new D1Fixture();
  await db.migrate();
  const stamp = Date.now();
  const legacyId = "66666666-6666-4666-8666-666666666666";
  db.sqlite.exec(`
    INSERT INTO accounts (id,token_hash,name,balance,created,payout_address)
      VALUES ('legacy-entry-owner','legacy-entry-owner-token','Legacy owner',0,${stamp},'${creator}');
    INSERT INTO bounties (id,owner,title,blueprint,entry,reward,status,listed,created,updated,entry_units,reward_units,reserve_units,escrow_bounty_id,fee_policy_version,platform_fee_bps)
      VALUES ('${legacyId}','legacy-entry-owner','Legacy entry','${blueprintJson}',0,0,'open',0,${stamp},${stamp},'10000','1000000','1000000','66','pathusd-direct-escrow-v5',250);
  `);
  const config = runtimeConfig(
    { ...base, WM_BOUNTY_ESCROW_VERSION: "6", WM_ALLOW_ESCROW_V6: "true" },
    "https://foundry.example",
  );
  try {
    await assert.rejects(
      mppEnterBounty(
        db,
        config,
        new Request("https://foundry.example/api/bounties/" + legacyId + "/attempts"),
        legacyId,
        { maxEntry: "0.02", maxPlatformFeeBps: 250, participantName: "Legacy", showAddress: false },
        "legacy-entry-key-1234",
      ),
      (error) => error.status === 409 && /read-only|legacy/i.test(error.message),
    );
    assert.equal(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM payment_holds WHERE purpose='mpp-entry'").get().count,
      0,
    );
  } finally {
    db.close();
  }
});

test("V6 timeout refund validates event amount, creator, challenger, and nonce", async () => {
  const wrongCases = [
    ["entry amount", { entry: 9999n }],
    ["creator", { creatorAddress: "0x3456789012345678901234567890123456789012" }],
    ["challenger", { challengerAddress: "0x3456789012345678901234567890123456789012" }],
    ["attempt nonce", { nonce: 8n }],
  ];
  for (const [label, variant] of wrongCases) {
    const { response, db } = await confirmTimeoutVariant(variant);
    assert.equal(response.status, 409, `${label} mismatch was accepted`);
    assert.equal(
      db.sqlite.prepare("SELECT status FROM payment_holds WHERE id=?").get(HOLD_ID).status,
      "awaiting-onchain",
    );
    assert.equal(
      db.sqlite.prepare("SELECT status FROM attempts WHERE id=?").get(ATTEMPT_ID).status,
      "engineering",
    );
    db.close();
  }
});

test("finalized V6 timeout refund is recorded with zero net, exact entry, and public history", async () => {
  const { response, db } = await confirmTimeoutVariant();
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  const result = body.history?.find((attempt) => attempt.id === ATTEMPT_ID)?.result;
  assert.ok(result, "finalized timeout refund is missing from public bounty history");
  assert.equal(result.outcome, "technical-refund");
  assert.equal(result.entry, "0.01");
  assert.equal(result.net, "0");
  assert.equal(result.refundStatus, "verified");
  assert.equal(result.refundStatusVerified, true);
  assert.equal(body.status, "open");
  assert.equal(body.activeAttempt, null);
  assert.equal(
    db.sqlite.prepare("SELECT status FROM payment_holds WHERE id=?").get(HOLD_ID).status,
    "accepted",
  );
  db.close();
});

test("a finalized V6 timeout confirmation is idempotent and cannot spend the hold twice", async () => {
  const first = await confirmTimeoutVariant();
  assert.equal(first.response.status, 200);
  await first.response.arrayBuffer();
  const before = first.db.sqlite
    .prepare("SELECT status,escrow_settlement_tx FROM attempts WHERE id=?")
    .get(ATTEMPT_ID);
  assert.deepEqual({ ...before }, {
    status: "technical-refund",
    escrow_settlement_tx: TX_HASH,
  });
  const second = await mainnetFetch(
    new Request(`https://foundry.example/api/escrow/intents/${HOLD_ID}/confirm`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "wm_session=v6-test-session",
      },
      body: JSON.stringify({ transactionHash: TX_HASH }),
    }),
    {
      DB: first.db,
      ...base,
      WM_BOUNTY_ESCROW_VERSION: "6",
      WM_ALLOW_ESCROW_V6: "true",
      WM_TEMPO_RPC_URL: "https://tempo-rpc.fixture",
    },
    { waitUntil() {} },
  );
  assert.equal(second.status, 200);
  await second.arrayBuffer();
  const after = first.db.sqlite
    .prepare("SELECT status,escrow_settlement_tx FROM attempts WHERE id=?")
    .get(ATTEMPT_ID);
  assert.deepEqual({ ...after }, { ...before });
  first.db.close();
});
