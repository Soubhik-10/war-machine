import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { privateKeyToAccount } from "viem/accounts";
import { encodeFunctionData } from "viem";
import worker from "../sites/worker/index.mjs";
import {
  reopenDefendedBounties,
  automaticTimeoutState,
  archivePreV5Bounties,
  runtimeConfig,
  validateEscrowAttestation,
} from "../sites/worker/mainnet.mjs";
import { packChallenge, DEFAULT_RULES, PARTS, PRESETS, partSpec } from "../dist/data.mjs";
import { runBattleMetaReport, BATTLE_META_RETENTION_MS } from "../sites/worker/battle-meta.mjs";
import {
  pathUsdToUnits,
  payoutQuote,
  unitsToPathUsd,
  PATH_USD_TOKEN,
} from "../sites/worker/pathusd.mjs";

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
    this.prepareCount = 0;
  }
  prepare(sql) {
    this.prepareCount += 1;
    return new Statement(this.sqlite.prepare(sql));
  }
  async batch(statements) {
    return Promise.all(statements.map((statement) => statement.run()));
  }
  async migrate() {
    this.sqlite.exec(
      await readFile(
        new URL("../drizzle/0000_war_machines.sql", import.meta.url),
        "utf8",
      ),
    );
    this.sqlite.exec(
      await readFile(
        new URL("../drizzle/0001_tempo_mainnet.sql", import.meta.url),
        "utf8",
      ),
    );
    this.sqlite.exec(
      await readFile(
        new URL("../drizzle/0002_direct_escrow.sql", import.meta.url),
        "utf8",
      ),
    );
    this.sqlite.exec(
      await readFile(
        new URL("../drizzle/0003_paid_reveal.sql", import.meta.url),
        "utf8",
      ),
    );
    this.sqlite.exec(
      await readFile(
        new URL("../drizzle/0005_automatic_settlement.sql", import.meta.url),
        "utf8",
      ),
    );
    this.sqlite.exec(
      await readFile(
        new URL("../drizzle/0006_reset_bounty_board_v3.sql", import.meta.url),
        "utf8",
      ),
    );
    this.sqlite.exec(
      await readFile(
        new URL("../drizzle/0007_attempt_identity.sql", import.meta.url),
        "utf8",
      ),
    );
    this.sqlite.exec(
      await readFile(
        new URL("../drizzle/0008_escrow_policy_identity.sql", import.meta.url),
        "utf8",
      ),
    );
    this.sqlite.exec(
      await readFile(
        new URL("../drizzle/0009_board_pagination.sql", import.meta.url),
        "utf8",
      ),
    );
    this.sqlite.exec(
      await readFile(
        new URL("../drizzle/0010_friendly_challenges.sql", import.meta.url),
        "utf8",
      ),
    );
    this.sqlite.exec(
      await readFile(
        new URL("../drizzle/0011_battle_meta.sql", import.meta.url),
        "utf8",
      ),
    );
  }
  close() {
    this.sqlite.close();
  }
}

test("all free browser battles are replay-verified, retained for a week, and included in meta reports", async (t) => {
  const DB = new D1Mock();
  await DB.migrate();
  t.after(() => DB.close());
  const env = { DB, WM_META_REPORT_INTERVAL_HOURS: "12" }, ctx = { waitUntil() {} }, seed = 8124,
    challenger = packChallenge(PRESETS[0], "foundry", seed, DEFAULT_RULES),
    defender = packChallenge(PRESETS[1], "foundry", seed, DEFAULT_RULES),
    clientBattleId = "123e4567-e89b-42d3-a456-426614174000",
    payload = { clientBattleId, kind: "browser-practice", engineHash: (await import("../dist/release.mjs")).CLIENT_ENGINE_HASH, challenger, defender, seed, mode: DEFAULT_RULES.combat, swapSpawns: false, objective: "reactor", commands: [] };
  const accepted = await call(env, "/api/meta/battles", "POST", payload);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.stored, true);
  assert.equal(accepted.body.engineHash, payload.engineHash);
  const duplicate = await call(env, "/api/meta/battles", "POST", payload);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.duplicate, true);
  const stored = DB.sqlite.prepare("SELECT source,settled_at,battle_json FROM battle_meta_logs WHERE client_battle_id=?").get(clientBattleId);
  assert.equal(stored.source, "browser-practice");
  assert.ok(stored.settled_at);
  const snapshot = JSON.parse(stored.battle_json);
  assert.equal(snapshot.kind, "browser-practice");
  assert.equal("participantName" in snapshot, false);
  const mainnetAccepted = await call({ ...env, WM_MODE: "tempo-mainnet" }, "/api/meta/battles", "POST", {
    ...payload,
    clientBattleId: "123e4567-e89b-42d3-a456-426614174001",
    kind: "browser-friendly",
  });
  assert.equal(mainnetAccepted.status, 200);
  assert.equal(mainnetAccepted.body.stored, true);
  const at = Date.now();
  assert.equal((await runBattleMetaReport(DB, { intervalHours: 12, at })).matches, 2);
  const reports = await call(env, "/api/meta/reports", "GET");
  assert.equal(reports.status, 200);
  assert.equal(reports.body.intervalHours, 12);
  assert.equal(reports.body.reports[0].report.sample.matches, 2);
  assert.deepEqual(reports.body.reports[0].report.groups.map((group) => group.source).sort(), ["browser-friendly", "browser-practice"]);
  assert.equal(reports.body.reports[0].report.groups[0].engineHash, payload.engineHash);
  assert.equal(BATTLE_META_RETENTION_MS, 7 * 24 * 60 * 60 * 1000);
  const staleId = "stale-meta-test";
  DB.sqlite.prepare("INSERT INTO battle_meta_logs (id,source,captured_at,settled_at,engine_hash,arena,seed,winner,duration,battle_json) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(staleId, "browser-practice", at - BATTLE_META_RETENTION_MS - 1, at - BATTLE_META_RETENTION_MS - 1, "old", "foundry", seed, -1, 1, "{}");
  await DB.prepare("DELETE FROM battle_meta_logs WHERE captured_at<?").bind(at - BATTLE_META_RETENTION_MS).run();
  assert.equal(DB.sqlite.prepare("SELECT id FROM battle_meta_logs WHERE id=?").get(staleId), undefined);
});
function seedHealthyPayment(DB, env) {
  DB.sqlite.prepare("INSERT INTO payment_kv (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(
      `payment-health:4217:${env.WM_BOUNTY_ESCROW_ADDRESS}:v${env.WM_BOUNTY_ESCROW_VERSION}:s${env.WM_ESCROW_SETTLEMENT_SIGNER}:r${env.WM_BOUNTY_RELAYER_ADDRESS}`,
      JSON.stringify({ ready: true, checkedAt: Date.now(), reason: null, signerBalanceUnits: "1000000", relayerBalanceUnits: "1000000", overdueAttempts: 0 }),
    );
}
const json = (url, method = "GET", body, token, key) =>
  new Request("https://foundry.example" + url, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: "Bearer " + token } : {}),
      ...(key ? { "idempotency-key": key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const call = async (env, url, method, body, token, key) => {
  const response = await worker.fetch(json(url, method, body, token, key), env, {
    waitUntil() {},
  });
  return {
    status: response.status,
    body: await response.json(),
    headers: response.headers,
  };
};

test("pathUSD uses exact base units for cents and preserves the 2.5% fee quote", () => {
  assert.equal(
    pathUsdToUnits("0.01", { allowZero: false }).toString(),
    "10000",
  );
  assert.equal(
    pathUsdToUnits("1.234567", { allowZero: false }).toString(),
    "1234567",
  );
  assert.throws(
    () => pathUsdToUnits("0.0000001", { allowZero: false }),
    /at most 6 decimal places/,
  );
  assert.equal(unitsToPathUsd("100000"), "0.1");
  const quote = payoutQuote("1000000", "100000");
  assert.equal(quote.platformFee, "0.025");
  assert.equal(quote.payout, "0.975");
  assert.equal(quote.netIfWin, "0.875");
});

test("mainnet board pages public scouts with bounded reads and hides unlisted, expired, and defender data", async (t) => {
  const DB = new D1Mock();
  await DB.migrate();
  t.after(() => DB.close());
  const stamp = Date.now(), blueprint = JSON.stringify(packChallenge(PRESETS[0], "foundry", 0));
  DB.sqlite.prepare("INSERT INTO accounts (id,token_hash,name,balance,created,payout_address) VALUES (?,?,?,?,?,?)")
    .run("board-owner", "board-owner-token", "Board owner", 0, stamp, "0x" + "11".repeat(20));
  const insert = DB.sqlite.prepare("INSERT INTO bounties (id,owner,title,blueprint,entry,reward,status,listed,expires,created,updated,entry_units,reward_units,reserve_units,platform_fee_bps,fee_policy_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  for (let index = 0; index < 101; index += 1) {
    const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    insert.run(id, "board-owner", "Scout " + index, blueprint, 0, 0, "open", 1, null, stamp - index, stamp - index, "10000", "1000000", "1000000", 250, "pathusd-direct-escrow-v5");
  }
  insert.run("10000000-0000-4000-8000-000000000000", "board-owner", "Unlisted", blueprint, 0, 0, "open", 0, null, stamp, stamp, "10000", "1000000", "1000000", 250, "pathusd-direct-escrow-v5");
  insert.run("20000000-0000-4000-8000-000000000000", "board-owner", "Expired", blueprint, 0, 0, "open", 1, stamp, stamp, stamp, "10000", "1000000", "1000000", 250, "pathusd-direct-escrow-v5");
  DB.sqlite.prepare("INSERT INTO accounts (id,token_hash,name,balance,created,payout_address) VALUES (?,?,?,?,?,?)")
    .run("board-entrant", "board-entrant-token", "Board entrant", 0, stamp, "0x" + "22".repeat(20));
  const sessions = DB.sqlite.prepare("INSERT INTO sessions (id,token_hash,account,expires,created) VALUES (?,?,?,?,?)");
  sessions.run("owner-session", createHash("sha256").update("owner-board-cookie").digest("hex"), "board-owner", stamp + 60_000, stamp);
  sessions.run("entrant-session", createHash("sha256").update("entrant-board-cookie").digest("hex"), "board-entrant", stamp + 60_000, stamp);
  DB.sqlite.prepare("INSERT INTO attempts (id,bounty,account,blueprint,seed,status,created,updated) VALUES (?,?,?,?,?,?,?,?)")
    .run("40000000-0000-4000-8000-000000000000", "10000000-0000-4000-8000-000000000000", "board-entrant", blueprint, 42, "engineering", stamp, stamp);
  const env = { DB, WM_MODE: "tempo-mainnet", WM_BOUNTY_ESCROW_VERSION: "5", WM_BOUNTY_ESCROW_ADDRESS: "0x5555555555555555555555555555555555555555" };
  const ctx = { waitUntil() {} };
  DB.prepareCount = 0;
  const first = await worker.fetch(new Request("https://foundry.example/api/bounties?limit=50"), env, ctx);
  assert.equal(first.status, 200);
  const firstRows = await first.json(), cursor = first.headers.get("x-next-cursor");
  assert.equal(firstRows.length, 50);
  assert.ok(cursor);
  assert.ok(DB.prepareCount <= 3, `expected a bounded three-query public page, got ${DB.prepareCount}`);
  assert.equal(firstRows.some((row) => row.title === "Unlisted" || row.title === "Expired" || row.blueprint), false);
  insert.run("30000000-0000-4000-8000-000000000000", "board-owner", "Historical", blueprint, 0, 0, "open", 1, null, stamp, stamp, "10000", "1000000", "1000000", 250, "pathusd-direct-escrow-v4");
  DB.sqlite.prepare("INSERT INTO bookmarks (account,bounty,created) VALUES (?,?,?)")
    .run("board-entrant", "30000000-0000-4000-8000-000000000000", stamp);
  const second = await worker.fetch(new Request("https://foundry.example/api/bounties?limit=50&cursor=" + encodeURIComponent(cursor)), env, ctx);
  assert.equal(second.status, 200);
  const secondRows = await second.json();
  const third = await worker.fetch(new Request("https://foundry.example/api/bounties?limit=50&cursor=" + encodeURIComponent(second.headers.get("x-next-cursor"))), env, ctx);
  assert.equal(third.status, 200);
  const thirdRows = await third.json();
  const ids = [...firstRows, ...secondRows, ...thirdRows].map((row) => row.id);
  assert.equal(ids.length, 101);
  assert.equal(new Set(ids).size, ids.length);
  const owner = await worker.fetch(new Request("https://foundry.example/api/bounties?scope=mine&limit=100", { headers: { cookie: "wm_session=owner-board-cookie" } }), env, ctx);
  assert.equal(owner.status, 200);
  const ownerRows = await owner.json();
  for (const title of ["Unlisted", "Expired", "Historical"])
    assert.ok(ownerRows.some(row => row.title === title), `owner scope omitted ${title}`);
  const saved = await worker.fetch(new Request("https://foundry.example/api/bounties?scope=saved", { headers: { cookie: "wm_session=entrant-board-cookie" } }), env, ctx);
  assert.equal(saved.status, 200);
  assert.deepEqual((await saved.json()).map(row => row.title), ["Historical"]);
  const history = await worker.fetch(new Request("https://foundry.example/api/bounties?scope=history", { headers: { cookie: "wm_session=entrant-board-cookie" } }), env, ctx);
  assert.equal(history.status, 200);
  assert.ok((await history.json()).some(row => row.title === "Unlisted"), "entrant history includes its unlisted attempt");
  const anonymous = await worker.fetch(new Request("https://foundry.example/api/bounties?scope=mine"), env, ctx);
  assert.equal(anonymous.status, 401);
  const invalidLimit = await worker.fetch(new Request("https://foundry.example/api/bounties?limit=101"), env, ctx);
  const invalidCursor = await worker.fetch(new Request("https://foundry.example/api/bounties?cursor=not-a-cursor"), env, ctx);
  assert.equal(invalidLimit.status, 400);
  assert.equal(invalidCursor.status, 400);
  const catalog = await (await worker.fetch(new Request("https://foundry.example/api/rules"), { DB })).json();
  for (const part of PARTS) for (const grade of ["stock", "reinforced", "tuned"])
    assert.equal(catalog.parts.find((candidate) => candidate.id === part.id).effectiveStats[grade].hp, partSpec({ id: part.id, u: grade }).hp);
});

test("settlement attestations bind the exact V3 Tempo escrow typed data", async () => {
  const one = privateKeyToAccount("0x" + "01".repeat(32)),
    config = {
      chainId: 4217,
      escrowAddress: "0xb14a3aA99C9349094612143089F55aE5372DeB24",
    },
    payload = {
      bountyId: "7",
      attemptNonce: "1",
      outcome: 0,
      resultHash: "0x" + "ab".repeat(32),
      validUntil: 4_000_000_000,
      signatures: [],
    },
    typed = {
      domain: {
        name: "War Machines Bounty Escrow",
        version: "3",
        chainId: 4217,
        verifyingContract: config.escrowAddress,
      },
      types: {
        Settlement: [
          { name: "bountyId", type: "uint256" },
          { name: "attemptNonce", type: "uint64" },
          { name: "outcome", type: "uint8" },
          { name: "resultHash", type: "bytes32" },
          { name: "validUntil", type: "uint64" },
        ],
      },
      primaryType: "Settlement",
      message: {
        bountyId: 7n,
        attemptNonce: 1n,
        outcome: 0,
        resultHash: payload.resultHash,
        validUntil: 4000000000n,
      },
    },
    signature = await one.signTypedData(typed);
  const validated = await validateEscrowAttestation(
    config,
    payload,
    [signature],
    [one.address],
  );
  assert.equal(validated.length, 1);
  assert.equal(validated[0].signer, one.address);
  await assert.rejects(
    () =>
      validateEscrowAttestation(
        config,
        payload,
        [signature, signature],
        [one.address],
      ),
    /exactly one/i,
  );
});

test("Tempo mode is fail-closed and never falls back to sandbox credits", async (t) => {
  const DB = new D1Mock();
  await DB.migrate();
  t.after(() => DB.close());
  const env = { DB, WM_MODE: "tempo-mainnet" };
  const health = await call(env, "/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.body.mode, "tempo-mainnet");
  assert.equal(health.body.paymentsEnabled, false);
  const session = await call(env, "/api/session", "POST", {
    name: "No sandbox",
  });
  assert.equal(session.status, 503);
  assert.match(session.body.error, /WM_BOUNTY_ESCROW_ADDRESS/i);
  const rules = await call(env, "/api/rules");
  assert.equal(rules.status, 200);
  assert.equal(rules.body.startingCredits, 0);
  assert.equal(rules.body.mpp.enabled, false);
  const practice = await call(env, "/api/practice", "POST", {
    challenger: packChallenge(PRESETS[0], "foundry", 0),
    defender: packChallenge(PRESETS[1], "foundry", 0),
    seed: 42,
  });
  assert.equal(practice.status, 410);
  assert.match(practice.body.error, /paid entry.*timed counter deployment/i);
});

test("native MPP exposes only paid bounty routes and uses the standard Authorization header", async (t) => {
  const DB = new D1Mock();
  await DB.migrate();
  t.after(() => DB.close());
  const relayer = privateKeyToAccount("0x" + "09".repeat(32)),
    settlementKey = "0x" + "0a".repeat(32),
    settlement = privateKeyToAccount(settlementKey),
    env = {
      DB,
      WM_MODE: "tempo-mainnet",
      WM_BOUNTY_ESCROW_VERSION: "5",
      WM_BOUNTY_ESCROW_ADDRESS:
        "0x5555555555555555555555555555555555555555",
      WM_ESCROW_SETTLEMENT_SIGNER: settlement.address,
      WM_SETTLEMENT_PRIVATE_KEY: settlementKey,
      WM_RESULT_SIGNING_READY: "true",
      WM_BOUNTY_RELAYER_ADDRESS: relayer.address,
      WM_BOUNTY_RELAYER_PRIVATE_KEY: "0x" + "09".repeat(32),
      WM_AGENT_BOUNTY_MPP_ENABLED: "true",
      WM_AGENT_BOUNTY_MPP_MAX: "1.00",
      MPP_SECRET_KEY: "m".repeat(32),
    };
  const config = runtimeConfig(env, "https://foundry.example");
  seedHealthyPayment(DB, env);
  assert.equal(config.agentBountyMppEnabled, true);
  assert.equal(config.agentMppEnabled, undefined);
  const ctx = { waitUntil() {} };
  const discovery = await worker.fetch(
    new Request("https://foundry.example/.well-known/war-machines.json"),
    env,
    ctx,
  );
  const discoveryBody = await discovery.json();
  assert.equal(discoveryBody.settlementCapacity.signer.role, "settlement-signer");
  assert.equal(discoveryBody.settlementCapacity.signer.minimumUnits, "10000");
  assert.equal(typeof discoveryBody.settlementCapacity.fresh, "boolean");
  assert.equal(discoveryBody.payments.mpp, true);
  assert.deepEqual(discoveryBody.payments.mppRoutes, [
    {
      path: "/api/bounties",
      method: "POST",
      price: "request.reward",
      recipient: relayer.address,
    },
    {
      path: "/api/bounties/{id}/attempts",
      method: "POST",
      price: "request.entry",
      recipient: relayer.address,
    },
  ]);
  const openapi = await call(env, "/api/openapi.json");
  assert.equal(openapi.status, 200);
  assert.equal(openapi.body.paths["/agent/practice"], undefined);
  assert.equal(
    openapi.body.components.securitySchemes.mppProof.name,
    "Authorization",
  );
  assert.ok(openapi.body.components.schemas.SettlementCapacity);
  assert.equal(openapi.body.components.schemas.Rules.properties.settlementCapacity.$ref, "#/components/schemas/SettlementCapacity");

  const challenge = await worker.fetch(
    new Request("https://foundry.example/api/bounties", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "mpp_create_fixture_0001",
      },
      body: JSON.stringify({
        title: "Native MPP fixture",
        blueprint: packChallenge(PRESETS[0], "foundry", 0),
        entry: "0.01",
        reward: "0.02",
        hours: 1,
        listed: false,
        maxPlatformFeeBps: 250,
      }),
    }),
    env,
    ctx,
  );
  assert.equal(challenge.status, 402);
  const wwwAuthenticate = challenge.headers.get("www-authenticate");
  assert.match(wwwAuthenticate, /Payment/i);
  assert.doesNotMatch(wwwAuthenticate, /header=/i);
});

test("legacy V4 discovery is recovery-only even when its relayer is configured", async () => {
  const relayer = privateKeyToAccount("0x" + "09".repeat(32));
  const env = {
    WM_MODE: "tempo-mainnet",
    WM_BOUNTY_ESCROW_VERSION: "4",
    WM_BOUNTY_ESCROW_ADDRESS: "0x5555555555555555555555555555555555555555",
    WM_BOUNTY_RELAYER_ADDRESS: relayer.address,
    WM_BOUNTY_RELAYER_PRIVATE_KEY: "0x" + "09".repeat(32),
    WM_AGENT_BOUNTY_MPP_ENABLED: "true",
    WM_AGENT_BOUNTY_MPP_MAX: "1.00",
    MPP_SECRET_KEY: "m".repeat(32),
  };
  const config = runtimeConfig(env, "https://foundry.example");
  assert.equal(config.agentBountyMppEnabled, true);
  assert.deepEqual(config.settlementSigners, []);
  const settlementKey = "0x" + "0a".repeat(32),
    settlement = privateKeyToAccount(settlementKey),
    readyConfig = runtimeConfig(
      {
        ...env,
        WM_ESCROW_SETTLEMENT_SIGNER: settlement.address,
        WM_SETTLEMENT_PRIVATE_KEY: settlementKey,
        WM_RESULT_SIGNING_READY: "true",
      },
      "https://foundry.example",
    );
  assert.deepEqual(readyConfig.settlementSigners, [settlement.address]);
  assert.equal(readyConfig.automaticSettlementReady, true);
  const DB = new D1Mock();
  await DB.migrate();
  try {
    const discovery = await worker.fetch(
      new Request("https://foundry.example/.well-known/war-machines.json"),
      { ...env, DB },
    );
    const body = await discovery.json();
    assert.equal(body.payments.mpp, false);
    assert.equal(body.payments.mppRoutes, undefined);
    assert.equal(body.version, "4.0");
    assert.deepEqual(body.payments.supportedInputTokens, [
      PATH_USD_TOKEN,
      "0x20C000000000000000000000b9537d11c60E8b50",
    ]);
    assert.deepEqual(body.payments.swap, {
      targetToken: PATH_USD_TOKEN,
      slippageBps: 100,
      atomic: true,
      description:
        "MPP clients swap an allowlisted Tempo stablecoin into pathUSD in the same transaction before payment.",
    });
    const guarded = await worker.fetch(
      new Request("https://foundry.example/api/bounties", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "mpp_guarded_create_0001",
        },
        body: JSON.stringify({
          title: "Guarded native bounty",
          blueprint: packChallenge(PRESETS[0], "foundry", 0),
          entry: "0.01",
          reward: "0.02",
          hours: 0,
          listed: true,
          maxPlatformFeeBps: 250,
        }),
      }),
      { ...env, DB },
    );
    assert.equal(guarded.status, 503);
    assert.equal(
      DB.sqlite.prepare("SELECT COUNT(*) AS total FROM payment_holds").get()
        .total,
      0,
    );
  } finally {
    DB.close();
  }
  assert.equal(
    runtimeConfig(
      { ...env, WM_BOUNTY_RELAYER_ADDRESS: "0x6666666666666666666666666666666666666666" },
      "https://foundry.example",
    ).agentBountyMppEnabled,
    false,
  );
});

test("stateless MCP exposes War Machines tools and preserves the MPP challenge", async (t) => {
  const DB = new D1Mock();
  await DB.migrate();
  t.after(() => DB.close());
  const env = {
    DB,
    WM_MODE: "tempo-mainnet",
    WM_BOUNTY_ESCROW_VERSION: "5",
    WM_BOUNTY_ESCROW_ADDRESS:
      "0xb14a3aA99C9349094612143089F55aE5372DeB24",
    WM_ESCROW_SETTLEMENT_SIGNER: privateKeyToAccount("0x" + "0a".repeat(32)).address,
    WM_SETTLEMENT_PRIVATE_KEY: "0x" + "0a".repeat(32),
    WM_RESULT_SIGNING_READY: "true",
    WM_BOUNTY_RELAYER_ADDRESS: privateKeyToAccount("0x" + "09".repeat(32)).address,
    WM_BOUNTY_RELAYER_PRIVATE_KEY: "0x" + "09".repeat(32),
    WM_AGENT_BOUNTY_MPP_ENABLED: "true",
      WM_AGENT_BOUNTY_MPP_MAX: "1.00",
      MPP_SECRET_KEY: "m".repeat(32),
  };
  seedHealthyPayment(DB, env);
  const ctx = { waitUntil() {} };
  const init = await worker.fetch(
    new Request("https://foundry.example/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-11-25" },
      }),
    }),
    env,
    ctx,
  );
  assert.equal(init.status, 200);
  const initBody = await init.json();
  assert.equal(initBody.result.serverInfo.name, "war-machines");
  assert.equal(initBody.result.protocolVersion, "2025-11-25");

  const initWithTrailingSlash = await worker.fetch(
    new Request("https://foundry.example/mcp/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 11,
        method: "initialize",
        params: { protocolVersion: "2025-11-25" },
      }),
    }),
    env,
    ctx,
  );
  assert.equal(initWithTrailingSlash.status, 200);

  const initWithApiPrefix = await worker.fetch(
    new Request("https://foundry.example/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 12,
        method: "initialize",
        params: { protocolVersion: "2025-11-25" },
      }),
    }),
    env,
    ctx,
  );
  assert.equal(initWithApiPrefix.status, 200);

  const listed = await worker.fetch(
    new Request("https://foundry.example/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    }),
    env,
    ctx,
  );
  assert.equal(listed.status, 200);
  const listedBody = await listed.json();
  const toolNames = listedBody.result.tools.map((item) => item.name);
  assert.ok(toolNames.includes("war_machines_create_bounty"));
  assert.ok(toolNames.includes("war_machines_settle_attempt"));
  assert.ok(toolNames.includes("war_machines_get_activity"));

  const read = await worker.fetch(
    new Request("https://foundry.example/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "war_machines_get_rules", arguments: {} },
      }),
    }),
    env,
    ctx,
  );
  assert.equal(read.status, 200);
  const readBody = await read.json();
  assert.equal(readBody.result.structuredContent.mpp.enabled, true);

  const mutation = await worker.fetch(
    new Request("https://foundry.example/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "war_machines_create_bounty",
          arguments: {
            title: "MCP fixture",
            blueprint: packChallenge(PRESETS[0], "foundry", 0),
            entry: "0.01",
            reward: "0.02",
            hours: 1,
            listed: false,
            maxPlatformFeeBps: 250,
            idempotencyKey: "mcp_create_fixture_0001",
          },
        },
      }),
    }),
    env,
    ctx,
  );
  assert.equal(mutation.status, 402);
  assert.match(mutation.headers.get("www-authenticate"), /Payment/i);
});

test("private activity view reports agent progress without private build data", async (t) => {
  const DB = new D1Mock();
  await DB.migrate();
  t.after(() => DB.close());
  const account = "activity-owner",
    session = "activity-session-token",
    stamp = Date.now();
  DB.sqlite
    .prepare(
      "INSERT INTO accounts (id,token_hash,name,balance,created,payout_address,entry_cap_units,daily_cap_units) VALUES (?,?,?,?,?,?,?,?)",
    )
    .run(account, "unused", "Activity owner", 0, stamp, "0x" + "11".repeat(20), null, null);
  DB.sqlite
    .prepare("INSERT INTO sessions (id,token_hash,account,expires,created) VALUES (?,?,?,?,?)")
    .run(
      "activity-session",
      createHash("sha256").update(session).digest("hex"),
      account,
      stamp + 60_000,
      stamp,
    );
  DB.sqlite
    .prepare(
      "INSERT INTO bounties (id,owner,title,blueprint,entry,reward,status,listed,created,updated,entry_units,reward_units,reserve_units,platform_fee_bps,fee_policy_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "activity-bounty",
      account,
      "Visible activity target",
      "{\"secretBlueprint\":true}",
      0,
      0,
      "busy",
      1,
      stamp,
      stamp + 2,
      "50000",
      "200000",
      "200000",
      250,
      "pathusd-direct-escrow-v3",
    );
  DB.sqlite
    .prepare(
      "INSERT INTO attempts (id,bounty,account,blueprint,seed,status,result,created,updated) VALUES (?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "activity-attempt",
      "activity-bounty",
      account,
      "{\"secretCounter\":true}",
      7,
      "engineering",
      null,
      stamp + 1,
      stamp + 3,
    );
  DB.sqlite
    .prepare(
      "INSERT INTO payment_holds (id,account,bounty,request_key,digest,body,amount_units,purpose,expires,status,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "activity-intent",
      account,
      "activity-bounty",
      "activity-key",
      "digest",
      "{\"private\":true}",
      "200000",
      "direct-create",
      stamp + 60_000,
      "awaiting-onchain",
      stamp + 4,
      stamp + 4,
    );
  const response = await worker.fetch(
    new Request("https://foundry.example/api/me/activity", {
      headers: { cookie: "wm_session=" + session },
    }),
    {
      DB,
      WM_MODE: "tempo-mainnet",
      WM_BOUNTY_ESCROW_ADDRESS:
        "0xb14a3aA99C9349094612143089F55aE5372DeB24",
    },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.events.some((event) => /Agent is engineering/.test(event.message)));
  assert.ok(body.events.some((event) => /Waiting for wallet/.test(event.message)));
  assert.ok(body.events.every((event) => !JSON.stringify(event).includes("secret")));
});

test("a settled defense reopens the bounty and keeps its reward funded", async (t) => {
  const DB = new D1Mock();
  await DB.migrate();
  t.after(() => DB.close());
  const stamp = Date.now();
  DB.sqlite
    .prepare(
      "INSERT INTO accounts (id,token_hash,name,balance,created) VALUES (?,?,?,?,?)",
    )
    .run("creator", "creator-token", "Creator", 0, stamp);
  DB.sqlite
    .prepare(
      "INSERT INTO accounts (id,token_hash,name,balance,created) VALUES (?,?,?,?,?)",
    )
    .run("challenger", "challenger-token", "Challenger", 0, stamp);
  DB.sqlite
    .prepare(
      "INSERT INTO bounties (id,owner,title,blueprint,entry,reward,status,listed,created,updated,entry_units,reward_units,reserve_units) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "reopened-bounty",
      "creator",
      "Resolved target",
      "{}",
      0,
      0,
      "open",
      1,
      stamp,
      stamp,
      "10000",
      "1000000",
      "1000000",
    );
  DB.sqlite
    .prepare(
      "INSERT INTO attempts (id,bounty,account,blueprint,seed,status,result,created,updated,escrow_settlement_tx) VALUES (?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "reopened-attempt",
      "reopened-bounty",
      "challenger",
      "{}",
      1,
      "settled",
      JSON.stringify({ outcome: "loss", payoutStatus: "settled-onchain" }),
      stamp,
      stamp,
      "0x" + "ab".repeat(32),
    );
  DB.sqlite
    .prepare(
      "UPDATE bounties SET status='completed',fee_policy_version='pathusd-direct-escrow-v3' WHERE id=?",
    )
    .run("reopened-bounty");
  await reopenDefendedBounties(DB);
  const reopened = DB.sqlite
    .prepare("SELECT status,reserve_units FROM bounties WHERE id=?")
    .get("reopened-bounty");
  assert.equal(reopened.status, "open");
  assert.equal(reopened.reserve_units, "1000000");
});

test("expired engineering attempts move to the public onchain finalizer path", () => {
  const stamp = Date.now(),
    attempt = { status: "engineering", build_deadline: stamp - 10_000 },
    bounty = { escrow_attempt_deadline: stamp - 5_000 };
  assert.equal(automaticTimeoutState(attempt, bounty, stamp), "onchain-finalizer");
  assert.equal(
    automaticTimeoutState(
      { ...attempt, build_deadline: stamp + 10_000 },
      bounty,
      stamp,
    ),
    "build-window-open",
  );
  assert.equal(
    automaticTimeoutState(
      attempt,
      { escrow_attempt_deadline: stamp + 5_000 },
      stamp,
    ),
    "signable-loss",
  );
});

test("pre-V5 bounties leave the board without deleting recoverable escrow records", async (t) => {
  const DB = new D1Mock();
  await DB.migrate();
  t.after(() => DB.close());
  const stamp = Date.now();
  DB.sqlite.exec(`
    INSERT INTO accounts (id,token_hash,name,balance,created) VALUES ('creator','creator-token','Creator',0,${stamp});
    INSERT INTO bounties (id,owner,title,blueprint,entry,reward,status,listed,created,updated,entry_units,reward_units,reserve_units,escrow_bounty_id,fee_policy_version) VALUES
      ('legacy','creator','Legacy','{}',0,0,'open',1,${stamp},${stamp},'10000','1000000','1000000','1','pathusd-direct-escrow-v4'),
      ('current','creator','Current','{}',0,0,'open',1,${stamp},${stamp},'10000','1000000','1000000','1','pathusd-direct-escrow-v5');
  `);
  await archivePreV5Bounties(DB);
  const rows = DB.sqlite
    .prepare("SELECT id,listed,fee_policy_version FROM bounties ORDER BY id")
    .all();
  assert.deepEqual(
    rows.map((row) => ({ ...row })),
    [
      { id: "current", listed: 1, fee_policy_version: "pathusd-direct-escrow-v5" },
      { id: "legacy", listed: 0, fee_policy_version: "pathusd-direct-escrow-v4" },
    ],
  );
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS total FROM bounties").get().total, 2);
});

test("a withdrawn, claimed or depleted bounty is never reopened by recovery", async (t) => {
  const DB = new D1Mock();
  await DB.migrate();
  t.after(() => DB.close());
  const stamp = Date.now();
  DB.sqlite.exec(`
    INSERT INTO accounts (id,token_hash,name,balance,created) VALUES ('creator','creator-token','Creator',0,${stamp}),('challenger','challenger-token','Challenger',0,${stamp});
    INSERT INTO bounties (id,owner,title,blueprint,entry,reward,status,listed,created,updated,entry_units,reward_units,reserve_units,fee_policy_version) VALUES
      ('depleted','creator','Depleted','{}',0,0,'completed',1,${stamp},${stamp},'10000','1000000','0','pathusd-direct-escrow-v3'),
      ('claimed','creator','Claimed','{}',0,0,'completed',1,${stamp},${stamp},'10000','1000000','1000000','pathusd-direct-escrow-v3');
    UPDATE bounties SET winner='paid-attempt' WHERE id='claimed';
    INSERT INTO attempts (id,bounty,account,blueprint,seed,status,result,created,updated,escrow_settlement_tx) VALUES
      ('depleted-attempt','depleted','challenger','{}',1,'settled','{"outcome":"loss","payoutStatus":"settled-onchain"}',${stamp},${stamp},'0x${"ab".repeat(32)}'),
      ('claimed-attempt','claimed','challenger','{}',1,'settled','{"outcome":"loss","payoutStatus":"settled-onchain"}',${stamp},${stamp},'0x${"cd".repeat(32)}');
  `);
  await reopenDefendedBounties(DB);
  const states = DB.sqlite
    .prepare("SELECT id,status FROM bounties ORDER BY id")
    .all()
    .map(({ id, status }) => ({ id, status }));
  assert.deepEqual(states, [
    { id: "claimed", status: "completed" },
    { id: "depleted", status: "completed" },
  ]);
});

test("the V3 board reset removes only retired V2 bounty records", async (t) => {
  const db = new DatabaseSync(":memory:"),
    migrations = [
      "0000_war_machines.sql",
      "0001_tempo_mainnet.sql",
      "0002_direct_escrow.sql",
      "0003_paid_reveal.sql",
      "0004_reset_bounty_board.sql",
      "0005_automatic_settlement.sql",
    ];
  t.after(() => db.close());
  for (const filename of migrations)
    db.exec(
      await readFile(
        new URL(`../drizzle/${filename}`, import.meta.url),
        "utf8",
      ),
    );
  db.exec(`
    INSERT INTO accounts (id,token_hash,name,balance,created) VALUES ('owner','owner-token','Owner',0,1),('challenger','challenger-token','Challenger',0,1);
    INSERT INTO bounties (id,owner,title,blueprint,entry,reward,status,listed,created,updated,fee_policy_version) VALUES
      ('old-bounty','owner','Old','{}',0,0,'busy',1,1,1,'pathusd-direct-escrow-v2'),
      ('current-bounty','owner','Current','{}',0,0,'open',1,1,1,'pathusd-direct-escrow-v3');
    INSERT INTO attempts (id,bounty,account,blueprint,seed,status,created,updated) VALUES ('old-attempt','old-bounty','challenger','{}',1,'engineering',1,1);
    INSERT INTO bookmarks (account,bounty,created) VALUES ('owner','old-bounty',1);
    INSERT INTO payment_holds (id,account,bounty,request_key,digest,body,amount_units,purpose,expires,status,created,updated) VALUES ('old-hold','owner','old-bounty','old-key','digest','{}','1','direct-create',1,'awaiting-onchain',1,1);
    INSERT INTO financial_operations (id,kind,account,ref,amount_units,recipient,status,created,updated) VALUES ('old-operation','settle','owner','old-attempt','1','owner','queued',1,1);
    INSERT INTO settlement_jobs (attempt,created,updated) VALUES ('old-attempt',1,1);
    INSERT INTO idempotency (account,key,kind,digest,ref,created) VALUES ('owner','old-key','create','digest','old-bounty',1);
  `);
  db.exec(
    await readFile(
      new URL("../drizzle/0006_reset_bounty_board_v3.sql", import.meta.url),
      "utf8",
    ),
  );
  for (const table of [
    "attempts",
    "bookmarks",
    "payment_holds",
    "financial_operations",
    "settlement_jobs",
    "idempotency",
  ])
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total,
      0,
    );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS total FROM bounties").get().total,
    1,
  );
  assert.equal(
    db.prepare("SELECT id FROM bounties").get().id,
    "current-bounty",
  );
});

test("Tempo wallet sign-in verifies an EIP-191 account and issues a session", async (t) => {
  const DB = new D1Mock();
  await DB.migrate();
  t.after(() => DB.close());
  const signer = privateKeyToAccount("0x" + "03".repeat(32));
  const env = {
    DB,
    WM_MODE: "tempo-mainnet",
    WM_BOUNTY_ESCROW_ADDRESS: "0xb14a3aA99C9349094612143089F55aE5372DeB24",
    WM_TEMPO_RPC_URL: "https://tempo-rpc.fixture",
  };
  const challenge = await call(env, "/api/auth/challenge", "POST", {
    chainId: 4217,
  });
  assert.equal(challenge.status, 200);
  const signature = await signer.signMessage({
    message: challenge.body.message,
  });
  const verified = await call(env, "/api/auth/verify", "POST", {
    address: signer.address,
    message: challenge.body.message,
    signature,
  });
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  assert.equal(verified.body.me.payoutAddress, signer.address);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), env.WM_TEMPO_RPC_URL);
    const rpcRequest = JSON.parse(init.body);
    assert.equal(rpcRequest.method, "eth_call");
    assert.equal(
      rpcRequest.params[0].to.toLowerCase(),
      PATH_USD_TOKEN.toLowerCase(),
    );
    assert.match(rpcRequest.params[0].data, /^0x70a08231[0-9a-f]{64}$/i);
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: "0x" + 4125000n.toString(16).padStart(64, "0"),
      }),
      { headers: { "content-type": "application/json" } },
    );
  };
  try {
    const wallet = await worker.fetch(
      new Request("https://foundry.example/api/me/wallet", {
        headers: { cookie: verified.headers.get("set-cookie") },
      }),
      env,
    );
    assert.equal(wallet.status, 200);
    assert.deepEqual(await wallet.json(), {
      address: signer.address,
      balance: "4.125",
      currency: "pathUSD",
      decimals: 6,
    });
    const logout = await worker.fetch(
      new Request("https://foundry.example/api/auth/logout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: verified.headers.get("set-cookie"),
        },
        body: "{}",
      }),
      env,
    );
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
    const signedOut = await worker.fetch(
      new Request("https://foundry.example/api/me", {
        headers: { cookie: verified.headers.get("set-cookie") },
      }),
      env,
    );
    assert.equal(signedOut.status, 401);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const replay = await call(env, "/api/auth/verify", "POST", {
    address: signer.address,
    message: challenge.body.message,
    signature,
  });
  assert.equal(replay.status, 401);
});

test("browser wallet client uses Tempo Wallet rather than an injected provider", async () => {
  const source = await readFile(
    new URL("../scripts/tempo-client-entry.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /tempoWallet/);
  assert.match(source, /stringToHex\(message\)/);
  assert.match(
    source,
    /calls: calls\.map\(\(\{ to, data \}\) => \(\{ to, data \}\)\)/,
  );
  assert.match(source, /feeToken,/);
  assert.match(source, /calls\.push\(plan\.approval\)/);
  assert.match(source, /return hash;/);
  assert.doesNotMatch(source, /eth_getTransactionReceipt/);
  assert.match(source, /method: "wallet_disconnect"/);
  assert.match(source, /walletProvider\?\.store\?\.disconnect\?\.\(\)/);
  assert.match(source, /headers: \{ "Content-Type": "application\/json" \}/);
  assert.doesNotMatch(source, /window\.ethereum/);
});

test("source wallet MCP only accepts the exact atomic War Machines escrow plan", async () => {
  const { validateEscrowPlan } = await import(
    "../scripts/tempo-wallet-mcp.mjs"
  );
  const token = "0x20c0000000000000000000000000000000000000";
  const escrow = "0xb14a3aa99c9349094612143089f55ae5372deb24";
  const approval = {
    to: token,
    data: encodeFunctionData({
      abi: [{
        type: "function",
        name: "approve",
        stateMutability: "nonpayable",
        inputs: [
          { name: "spender", type: "address" },
          { name: "amount", type: "uint256" },
        ],
        outputs: [{ name: "", type: "bool" }],
      }],
      functionName: "approve",
      args: [escrow, 50_000n],
    }),
    amount: "50000",
  };
  const call = {
    to: escrow,
    data: encodeFunctionData({
      abi: [{
        type: "function",
        name: "enterBounty",
        stateMutability: "nonpayable",
        inputs: [{ name: "bountyId", type: "uint256" }],
        outputs: [],
      }],
      functionName: "enterBounty",
      args: [1n],
    }),
  };
  const checked = validateEscrowPlan({
    chainId: 4217,
    token,
    escrow,
    approval,
    call,
    calls: [approval, call],
  });
  assert.equal(checked.calls.length, 2);
  assert.throws(
    () => validateEscrowPlan({
      chainId: 4217,
      token,
      escrow,
      approval: { ...approval, amount: "1" },
      call,
      calls: [approval, call],
    }),
    /does not match its calldata/,
  );
  assert.throws(
    () => validateEscrowPlan({
      chainId: 4217,
      token,
      escrow,
      approval,
      call: { ...call, to: "0x4444444444444444444444444444444444444444" },
    }),
    /allowed War Machines escrow method|plan call/,
  );
});

test("paid bounty actions establish a Tempo session only when payment starts", async () => {
  const source = await readFile(
    new URL("../dist/bounties.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /async function ensurePaidWalletSession\(\)/);
  assert.match(source, /await ensurePaidWalletSession\(\);/);
  assert.match(source, /runtime\.paid \|\| me \? create\(\) : profile\(\)/);
  assert.match(source, /!runtime\.paid && !me/);
  assert.match(source, /OUTBOX_VERSION = 3/);
  assert.match(source, /async function confirmDirectIntent\(request\)/);
  assert.match(source, /request\.intentId && request\.transactionHash/);
  assert.match(source, /prepared\.transactionHash/);
  assert.match(source, /Discard request/);
  assert.match(source, /A wallet transaction is already saved for a different request/);
  assert.match(source, /No transaction hash means the wallet has not been charged/);
  assert.match(source, /entryInput\.value = "0\.01"/);
  assert.match(source, /Tempo RPC/i);
});

test("static assets use validators while HTML stays immediately refreshable", async () => {
  const { serveStaticAsset } = await import(
    `../sites/worker/static-assets.mjs?cache-test=${Date.now()}`
  );
  const first = serveStaticAsset(
    new Request("https://foundry.example/style.css"),
  );
  assert.equal(first.status, 200);
  assert.match(first.headers.get("cache-control"), /stale-while-revalidate/);
  const etag = first.headers.get("etag");
  assert.match(etag, /^"[0-9a-f]+"$/);
  const cached = serveStaticAsset(
    new Request("https://foundry.example/style.css", {
      headers: { "if-none-match": etag },
    }),
  );
  assert.equal(cached.status, 304);
  const document = serveStaticAsset(
    new Request("https://foundry.example/index.html"),
  );
  assert.equal(document.headers.get("cache-control"), "no-cache");

  const music = serveStaticAsset(
    new Request("https://foundry.example/audio/battle.ogg", {
      headers: { range: "bytes=10-109" },
    }),
  );
  assert.equal(music.status, 206);
  assert.equal(music.headers.get("content-type"), "audio/ogg");
  assert.equal(music.headers.get("accept-ranges"), "bytes");
  assert.match(music.headers.get("content-range"), /^bytes 10-109\/\d+$/);
  assert.equal(music.headers.get("content-length"), "100");
  assert.equal((await music.arrayBuffer()).byteLength, 100);
});

test("Tempo RPC transport failures remain retry-safe payment errors", async () => {
  const source = await readFile(
    new URL("../sites/worker/mainnet.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /Tempo RPC could not be reached/);
  assert.match(
    source,
    /Retry the saved request; do not submit another wallet payment/,
  );
  assert.match(source, /error\.status \|\| 503/);
});

test("direct escrow confirmation durably binds the first wallet transaction", async () => {
  const source = await readFile(
    new URL("../sites/worker/mainnet.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /transactionHash: validHash\(hold\.provider_ref\)/);
  assert.match(
    source,
    /UPDATE payment_holds SET provider_ref=\?,updated=\? WHERE id=\? AND status='awaiting-onchain' AND provider_ref IS NULL/,
  );
  assert.match(source, /already recovering a different wallet transaction/);
});

test("official bounty trials replay before the signing result is shown", async () => {
  const [client, app] = await Promise.all([
    readFile(new URL("../dist/bounties.mjs", import.meta.url), "utf8"),
    readFile(new URL("../dist/app.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(client, /wm-watched-official-replay-/);
  assert.match(client, /await watchOfficialReplay\(a\);/);
  assert.match(client, /async function autoplayOfficialReplay\(a\)/);
  assert.match(client, /if \(await autoplayOfficialReplay\(a\)\) return;/);
  assert.match(client, /id="watch-official-replay"/);
  assert.match(client, /Use a saved build/);
  assert.match(client, /data-deploy-build/);
  assert.match(app, /Continue to result/);
  assert.match(app, /bountyUI\.attempt\(officialAttemptId\)/);
  assert.match(app, /deploy-official-counter/);
  assert.match(app, /bountyUI\.deploy\(bountyContext\.attemptId\)/);
  assert.match(app, /BUILD WINDOW/);
  assert.match(client, /buildDeadline: Number\(a\.build\?\.deadline \|\| 0\)/);
});

test("completed paid bounties retain a public replay window", async () => {
  const [workerSource, client] = await Promise.all([
    readFile(new URL("../sites/worker/mainnet.mjs", import.meta.url), "utf8"),
    readFile(new URL("../dist/bounties.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(workerSource, /COMPLETED_BOUNTY_BOARD_MS = 10 \* 60 \* 1000/);
  assert.match(
    workerSource,
    /b\.status IN \('completed','claimed'\) AND b\.updated>=\?/,
  );
  assert.match(client, /RESULT .*10 MINUTES/);
  assert.match(client, /REWARD PAID/);
});

test("paid bounty creation does not accept funds without automatic settlement", async (t) => {
  const DB = new D1Mock();
  await DB.migrate();
  t.after(() => DB.close());
  const escrow = "0xb14a3aA99C9349094612143089F55aE5372DeB24",
    wallet = "0x1111111111111111111111111111111111111111",
    session = "direct-session-token",
    account = "11111111-1111-4111-8111-111111111111",
    challengerWallet = "0x2222222222222222222222222222222222222222",
    challengerSession = "direct-challenger-session",
    challengerAccount = "33333333-3333-4333-8333-333333333333";
  DB.sqlite
    .prepare(
      "INSERT INTO accounts (id,token_hash,name,balance,entry_cap,daily_cap,created,payout_address,entry_cap_units,daily_cap_units) VALUES (?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      account,
      "wallet:" + account,
      "Direct creator",
      0,
      null,
      null,
      Date.now(),
      wallet,
      null,
      null,
    );
  DB.sqlite
    .prepare(
      "INSERT INTO identities (scheme,chain,address,account,created) VALUES ('tempo',?,?,?,?)",
    )
    .run("4217", wallet, account, Date.now());
  DB.sqlite
    .prepare(
      "INSERT INTO sessions (id,token_hash,account,expires,created) VALUES (?,?,?,?,?)",
    )
    .run(
      "22222222-2222-4222-8222-222222222222",
      createHash("sha256").update(session).digest("hex"),
      account,
      Date.now() + 600000,
      Date.now(),
    );
  DB.sqlite
    .prepare(
      "INSERT INTO accounts (id,token_hash,name,balance,entry_cap,daily_cap,created,payout_address,entry_cap_units,daily_cap_units) VALUES (?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      challengerAccount,
      "wallet:" + challengerAccount,
      "Direct challenger",
      0,
      null,
      null,
      Date.now(),
      challengerWallet,
      null,
      null,
    );
  DB.sqlite
    .prepare(
      "INSERT INTO identities (scheme,chain,address,account,created) VALUES ('tempo',?,?,?,?)",
    )
    .run("4217", challengerWallet, challengerAccount, Date.now());
  DB.sqlite
    .prepare(
      "INSERT INTO sessions (id,token_hash,account,expires,created) VALUES (?,?,?,?,?)",
    )
    .run(
      "44444444-4444-4444-8444-444444444444",
      createHash("sha256").update(challengerSession).digest("hex"),
      challengerAccount,
      Date.now() + 600000,
      Date.now(),
    );
  const env = {
    DB,
    WM_MODE: "tempo-mainnet",
    WM_BOUNTY_ESCROW_ADDRESS: escrow,
    WM_TEMPO_RPC_URL: "https://tempo-rpc.fixture",
  };
  const request = (path, body, key, ownerSession = session) =>
    new Request("https://foundry.example" + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "wm_session=" + ownerSession,
        "idempotency-key": key,
      },
      body: JSON.stringify(body),
    });
  const post = async (path, body, key, ownerSession = session) => {
    const res = await worker.fetch(request(path, body, key, ownerSession), env);
    return { status: res.status, body: await res.json() };
  };
  const pad = (value) => BigInt(value).toString(16).padStart(64, "0"),
    addressTopic = "0x" + wallet.slice(2).padStart(64, "0"),
    blueprint = packChallenge(PRESETS[0], "foundry", 0),
    body = {
      title: "On-chain fixture",
      blueprint,
      entry: "0.01",
      reward: "1.00",
      maxPlatformFeeBps: 250,
      hours: 1,
      listed: true,
    };
  const paused = await post(
    "/api/bounties",
    body,
    "direct_create_fixture_0001",
  );
  assert.equal(paused.status, 503, JSON.stringify(paused.body));
  assert.match(paused.body.error, /WM_SETTLEMENT_PRIVATE_KEY/i);
  assert.equal(
    DB.sqlite.prepare("SELECT COUNT(*) AS total FROM payment_holds").get()
      .total,
    0,
  );
});

test("a fully populated legacy custody configuration still cannot issue a payment challenge or hold funds", async (t) => {
  const DB = new D1Mock();
  await DB.migrate();
  t.after(() => DB.close());
  const key = "0x" + "11".repeat(32),
    escrow = "0x1111111111111111111111111111111111111111";
  const env = {
    DB,
    WM_MODE: "tempo-mainnet",
    WM_MAINNET_ENABLE: "tempo-mainnet-real-funds",
    WM_PAYMENT_PAUSED: "false",
    WM_LEGAL_REVIEWED: "true",
    WM_PUBLIC_ORIGIN: "https://foundry.example",
    WM_LEDGER_NAMESPACE:
      "tempo-mainnet:4217:0x20c0000000000000000000000000000000000000",
    TEMPO_ESCROW_RECIPIENT: escrow,
    TEMPO_ENTRY_RECIPIENT: escrow,
    TEMPO_PLATFORM_RECIPIENT: "0xc20131e9132888993de6519D486E5558A5DbCb7A",
    TEMPO_ESCROW_PRIVATE_KEY: key,
    MPP_SECRET_KEY: "m".repeat(32),
    WM_MAX_OPERATION_UNITS: "100000000",
    WM_MAX_OUTSTANDING_UNITS: "1000000000",
  };
  const blueprint = packChallenge(PRESETS[0], "foundry", 0),
    request = new Request("https://foundry.example/api/bounties", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "tempo_cent_bounty_0001",
      },
      body: JSON.stringify({
        title: "Cent payment",
        blueprint,
        entry: "0.01",
        reward: "1.00",
        maxPlatformFeeBps: 250,
        hours: 1,
        listed: true,
      }),
    }),
    res = await worker.fetch(request, env),
    raw = await res.text();
  assert.equal(res.status, 503, raw);
  assert.match(raw, /WM_BOUNTY_ESCROW_ADDRESS/i);
  assert.equal(res.headers.get("www-authenticate"), null);
  assert.equal(
    DB.sqlite.prepare("SELECT COUNT(*) AS total FROM payment_holds").get()
      .total,
    0,
  );
});

test("Sites Worker + D1 supports private build vaults and authoritative sandbox settlement", async (t) => {
  const DB = new D1Mock();
  await DB.migrate();
  t.after(() => DB.close());
  const env = { DB, ASSETS: { fetch: () => new Response("asset") } };
  const home = await worker.fetch(new Request("https://foundry.example/"), env);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /WAR MACHINES/);
  const owner = (await call(env, "/api/session", "POST", { name: "Owner" }))
      .body,
    challenger = (
      await call(env, "/api/session", "POST", { name: "Challenger" })
    ).body;
  const blueprint = packChallenge(PRESETS[0], "foundry", 0),
    saved = await call(
      env,
      "/api/me/builds",
      "POST",
      { name: "Owner design", blueprint },
      owner.token,
      "save_worker_build_0001",
    );
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  const builds = await call(
    env,
    "/api/me/builds",
    "GET",
    undefined,
    owner.token,
  );
  assert.equal(builds.body.length, 1);
  assert.equal(builds.body[0].name, "Owner design");
  const updated = await call(
    env,
    "/api/me/builds/" + saved.body.id,
    "PATCH",
    { name: "Refitted owner design", blueprint },
    owner.token,
    "update_worker_build_0001",
  );
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.name, "Refitted owner design");
  const created = await call(
    env,
    "/api/bounties",
    "POST",
    {
      title: "Break the D1 fortress",
      blueprint,
      entry: 0,
      reward: 100,
      maxPlatformFeeBps: 250,
      hours: 1,
    },
    owner.token,
    "create_worker_bounty_0001",
  );
  assert.equal(created.status, 201);
  assert.equal(created.body.listed, true);
  assert.equal(created.body.platformFee, 2.5);
  assert.equal(created.body.payout, 97.5);
  const inspection = await call(env, "/api/blueprints/validate", "POST", {
    blueprint: packChallenge(PRESETS[1], "salt", 0),
    bountyId: created.body.id,
  });
  assert.equal(inspection.status, 200);
  assert.equal(inspection.body.arena, "foundry");
  const practice = await call(env, "/api/practice", "POST", {
    challenger: packChallenge(PRESETS[1], "salt", 0),
    bountyId: created.body.id,
    seed: 42,
  });
  assert.equal(practice.status, 200);
  assert.equal(practice.body.kind, "practice");
  const entered = await call(
    env,
    "/api/bounties/" + created.body.id + "/attempts",
    "POST",
    {
      blueprint: packChallenge(
        PRESETS[1],
        "foundry",
        0,
        created.body.blueprint.q,
      ),
      maxEntry: 0,
      maxPlatformFeeBps: 250,
      participantName: "Copper Fox",
      showAddress: false,
    },
    challenger.token,
    "enter_worker_bounty_0001",
  );
  assert.equal(entered.status, 202);
  assert.equal(entered.body.status, "settled");
  assert.ok(["win", "loss", "draw"].includes(entered.body.result.outcome));
  assert.equal(entered.body.participantName, "Copper Fox");
  assert.equal(entered.body.addressVisible, false);
  const publicAttempt = await call(env, "/api/attempts/" + entered.body.id);
  assert.equal(publicAttempt.status, 200);
  assert.equal(publicAttempt.body.participantName, "Copper Fox");
  assert.equal(publicAttempt.body.machineName, PRESETS[1].name);
  assert.equal(publicAttempt.body.addressVisible, false);
  const detail = await call(env, "/api/bounties/" + created.body.id);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.history[0].participantName, "Copper Fox");
  assert.equal(detail.body.history[0].addressVisible, false);
  assert.equal(publicAttempt.body.replay.versions.hash.length, 64);
});

test("free friendly challenges use their own table, share invite links, and are purged at 24 hours", async (t) => {
  const DB = new D1Mock();
  await DB.migrate();
  t.after(() => DB.close());
  const env = { DB, ASSETS: { fetch: () => new Response("asset") } };
  const blueprint = packChallenge(PRESETS[0], "foundry", 0);
  const created = await call(env, "/api/friendly-challenges", "POST", {
    challengerName: "Copper Fox",
    title: "Try my Foundry build",
    clientId: crypto.randomUUID(),
    blueprint,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.challengerName, "Copper Fox");
  assert.equal(created.body.expires - created.body.created, 24 * 60 * 60 * 1000);
  const board = await call(env, "/api/friendly-challenges");
  assert.equal(board.status, 200);
  assert.equal(board.body.length, 1);
  assert.equal(board.body[0].id, created.body.id);
  const detail = await call(env, "/api/friendly-challenges/" + created.body.id);
  assert.equal(detail.status, 200);
  assert.deepEqual(
    DB.sqlite.prepare("SELECT COUNT(*) AS count FROM accounts").get().count,
    0,
    "friendly challenges should not create profiles or wallet records",
  );
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS count FROM bounties").get().count, 0);
  DB.sqlite.prepare("UPDATE friendly_challenges SET expires=? WHERE id=?").run(Date.now() - 1, created.body.id);
  const afterExpiry = await call(env, "/api/friendly-challenges");
  assert.deepEqual(afterExpiry.body, []);
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS count FROM friendly_challenges").get().count, 0);
});
