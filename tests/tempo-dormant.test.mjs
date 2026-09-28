import test from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import {
  mainnetFetch,
  runAutomaticSettlement,
  runtimeConfig,
} from "../sites/worker/mainnet.mjs";
import { paymentHealth } from "../sites/worker/payment-health.mjs";

const settlementKey = "0x" + "0a".repeat(32);
const settlementSigner = privateKeyToAccount(settlementKey).address;
const dormantEnv = {
  WM_MODE: "tempo-mainnet",
  WM_BOUNTY_ESCROW_VERSION: "6",
  WM_ALLOW_ESCROW_V6: "true",
  WM_BOUNTY_ESCROW_ADDRESS: "0x" + "66".repeat(20),
  WM_ESCROW_SETTLEMENT_SIGNER: settlementSigner,
  WM_SETTLEMENT_PRIVATE_KEY: settlementKey,
  WM_RESULT_SIGNING_READY: "true",
};

function emptyRecoveryDb() {
  const queries = [];
  return {
    queries,
    prepare(sql) {
      queries.push(sql);
      return {
        bind() {
          return this;
        },
        async first() {
          return null;
        },
        async all() {
          return { results: [] };
        },
        async run() {
          return { meta: { changes: 0 } };
        },
      };
    },
  };
}

test("paid challenges default to dormant without payment health, RPC, or MPP work", async () => {
  const config = runtimeConfig(dormantEnv, "https://foundry.example");
  assert.equal(config.enabled, true);
  assert.equal(config.paidChallengesEnabled, false);
  assert.equal(config.acceptingNewBounties, false);

  let balanceReads = 0;
  let deploymentReads = 0;
  const unavailableDb = {
    prepare() {
      throw Error("dormant payment health must not read D1");
    },
  };
  const health = await paymentHealth(
    unavailableDb,
    config,
    async () => {
      balanceReads += 1;
      return 0n;
    },
    async () => {
      deploymentReads += 1;
      return "0x";
    },
  );
  assert.deepEqual(health, {
    state: "dormant",
    ready: false,
    fresh: true,
    checkedAt: null,
    reason: config.paidChallengesReason,
  });
  assert.equal(balanceReads, 0);
  assert.equal(deploymentReads, 0);

  for (const [path, verify] of [
    ["/api/rules", (body) => {
      assert.deepEqual(body.features, { friendlyChallenges: true, paidChallenges: false });
      assert.equal(body.paymentHealth.state, "dormant");
      assert.equal(body.directEscrow, null);
      assert.equal(body.mpp.enabled, false);
    }],
    ["/.well-known/war-machines.json", (body) => {
      assert.deepEqual(body.features, { friendlyChallenges: true, paidChallenges: false });
      assert.equal(body.payments.enabled, false);
      assert.equal(body.payments.recoveryAvailable, true);
    }],
    ["/api/health", (body) => {
      assert.deepEqual(body.features, { friendlyChallenges: true, paidChallenges: false });
      assert.equal(body.activation, "dormant");
      assert.equal(body.directEscrow, false);
      assert.equal(body.mppAgentApi, false);
    }],
    ["/api/openapi.json", (body) => {
      assert.match(body.info.description, /free, server-verified friendly challenges/i);
      assert.ok(body.paths["/friendly-challenges"]);
      assert.equal(body.paths["/bounties"], undefined);
    }],
  ]) {
    const response = await mainnetFetch(
      new Request("https://foundry.example" + path),
      { ...dormantEnv, DB: unavailableDb },
      { waitUntil() { throw Error("dormant public reads must not schedule payment work"); } },
      () => new Response("missing", { status: 404 }),
    );
    assert.equal(response.status, 200);
    verify(await response.json());
  }
});

test("dormant mode rejects a fresh paid request before session or payment processing", async () => {
  const db = emptyRecoveryDb();
  const response = await mainnetFetch(
    new Request("https://foundry.example/api/bounties", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "dormant-create-request-0001",
      },
      body: JSON.stringify({}),
    }),
    { ...dormantEnv, DB: db },
    undefined,
    () => new Response("missing", { status: 404 }),
  );
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.match(body.error, /paid challenges are disabled/i);
  assert.equal(db.queries.length, 2);
  assert.ok(db.queries.every((sql) => /payment_holds|payment_kv/.test(sql)));
  assert.ok(db.queries.every((sql) => !/sessions|accounts/i.test(sql)));
});

test("dormant mode also blocks the live Tempo wallet balance without a session or RPC read", async () => {
  const db = emptyRecoveryDb();
  const response = await mainnetFetch(
    new Request("https://foundry.example/api/me/wallet"),
    { ...dormantEnv, DB: db },
    undefined,
    () => new Response("missing", { status: 404 }),
  );
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.match(body.error, /paid challenges are disabled/i);
  assert.equal(db.queries.length, 0);
});

test("dormant scheduled work returns before settlement or RPC work when no recovery exists", async () => {
  const db = emptyRecoveryDb();
  const originalFetch = globalThis.fetch;
  let rpcCalls = 0;
  globalThis.fetch = async () => {
    rpcCalls += 1;
    throw Error("dormant recovery scan must not call RPC without a stored obligation");
  };
  try {
    await runAutomaticSettlement({ ...dormantEnv, DB: db }, "test");
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(rpcCalls, 0);
  assert.equal(db.queries.length, 3);
  assert.ok(db.queries.every((sql) => /attempts|payment_holds|payment_kv/.test(sql)));
});
