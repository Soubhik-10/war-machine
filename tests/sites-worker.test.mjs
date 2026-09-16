import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { privateKeyToAccount } from "viem/accounts";
import worker from "../sites/worker/index.mjs";
import {
  reopenDefendedBounties,
  runtimeConfig,
  validateEscrowAttestation,
} from "../sites/worker/mainnet.mjs";
import { packChallenge, PRESETS } from "../dist/data.mjs";
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
  }
  prepare(sql) {
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
  }
  close() {
    this.sqlite.close();
  }
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
  const response = await worker.fetch(json(url, method, body, token, key), env);
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
});

test("MPP practice advertises a bounded Tempo charge and returns a challenge before payment", async (t) => {
  const DB = new D1Mock();
  await DB.migrate();
  t.after(() => DB.close());
  const escrow = "0xb14a3aA99C9349094612143089F55aE5372DeB24",
    recipient = "0x4444444444444444444444444444444444444444",
    signer = privateKeyToAccount("0x" + "04".repeat(32)),
    env = {
      DB,
      WM_MODE: "tempo-mainnet",
      WM_BOUNTY_ESCROW_ADDRESS: escrow,
      WM_AGENT_MPP_ENABLED: "true",
      WM_AGENT_MPP_RECIPIENT: recipient,
      WM_AGENT_MPP_PRICE: "0.01",
      MPP_SECRET_KEY: "m".repeat(32),
    };
  const mppConfig = runtimeConfig(env, "https://foundry.example");
  assert.equal(mppConfig.agentMppEnabled, true);
  assert.equal(
    runtimeConfig(
      { ...env, WM_AGENT_MPP_RECIPIENT: escrow },
      "https://foundry.example",
    ).agentMppEnabled,
    false,
  );
  assert.equal(
    runtimeConfig(
      { ...env, WM_AGENT_MPP_PRICE: "1.000001" },
      "https://foundry.example",
    ).agentMppEnabled,
    false,
  );
  const discovery = await worker.fetch(
    new Request("https://foundry.example/.well-known/war-machines.json"),
    env,
  );
  const discoveryBody = await discovery.json();
  assert.equal(discoveryBody.payments.mpp, true);
  assert.equal(discoveryBody.mcp.endpoint, "/mcp");
  assert.equal(discoveryBody.mcp.transport, "streamable-http");
  assert.deepEqual(discoveryBody.payments.mppRoutes, [
    {
      path: "/api/agent/practice",
      price: "0.01",
      recipient,
    },
  ]);
  const openapi = await call(env, "/api/openapi.json");
  assert.equal(openapi.status, 200);
  assert.match(
    openapi.body.paths["/agent/practice"].post.description,
    /Payment-Authorization/,
  );

  const mppEntryChallenge = await worker.fetch(
    new Request("https://foundry.example/api/bounties", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "mpp_create_fixture_0001",
      },
      body: JSON.stringify({}),
    }),
    env,
  );
  assert.equal(mppEntryChallenge.status, 402);
  assert.match(
    mppEntryChallenge.headers.get("www-authenticate"),
    /Payment/i,
  );

  const challenge = await call(env, "/api/auth/challenge", "POST", {
    chainId: 4217,
  });
  const signature = await signer.signMessage({
    message: challenge.body.message,
  });
  const verified = await call(env, "/api/auth/verify", "POST", {
    address: signer.address,
    message: challenge.body.message,
    signature,
  });
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  const response = await worker.fetch(
    new Request("https://foundry.example/api/agent/practice", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: verified.headers.get("set-cookie"),
        "idempotency-key": "mpp_practice_fixture_0001",
      },
      body: JSON.stringify({
        challenger: packChallenge(PRESETS[0], "foundry", 0),
        defender: packChallenge(PRESETS[1], "foundry", 0),
        seed: 7,
      }),
    }),
    env,
  );
  assert.equal(response.status, 402);
  assert.match(response.headers.get("www-authenticate"), /Payment/i);
  assert.equal(
    DB.sqlite
      .prepare("SELECT COUNT(*) AS total FROM financial_operations")
      .get().total,
    0,
  );
  assert.equal(
    DB.sqlite.prepare("SELECT COUNT(*) AS total FROM idempotency").get().total,
    0,
  );
});

test("stateless MCP exposes War Machines tools and preserves the MPP challenge", async (t) => {
  const DB = new D1Mock();
  await DB.migrate();
  t.after(() => DB.close());
  const env = {
    DB,
    WM_MODE: "tempo-mainnet",
    WM_BOUNTY_ESCROW_ADDRESS:
      "0xb14a3aA99C9349094612143089F55aE5372DeB24",
    WM_AGENT_MPP_ENABLED: "true",
    WM_AGENT_MPP_RECIPIENT: "0x4444444444444444444444444444444444444444",
    WM_AGENT_MPP_PRICE: "0.01",
    MPP_SECRET_KEY: "m".repeat(32),
  };
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
  );
  assert.equal(init.status, 200);
  const initBody = await init.json();
  assert.equal(initBody.result.serverInfo.name, "war-machines");
  assert.equal(initBody.result.protocolVersion, "2025-11-25");

  const listed = await worker.fetch(
    new Request("https://foundry.example/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    }),
    env,
  );
  assert.equal(listed.status, 200);
  const listedBody = await listed.json();
  const toolNames = listedBody.result.tools.map((item) => item.name);
  assert.ok(toolNames.includes("war_machines_create_bounty"));
  assert.ok(toolNames.includes("war_machines_settle_attempt"));

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
          arguments: { idempotencyKey: "mcp_create_fixture_0001" },
        },
      }),
    }),
    env,
  );
  assert.equal(mutation.status, 402);
  assert.match(mutation.headers.get("www-authenticate"), /Payment/i);
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
  assert.match(source, /Tempo RPC/i);
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
});

test("completed paid bounties retain a public replay window", async () => {
  const [workerSource, client] = await Promise.all([
    readFile(new URL("../sites/worker/mainnet.mjs", import.meta.url), "utf8"),
    readFile(new URL("../dist/bounties.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(workerSource, /COMPLETED_BOUNTY_BOARD_MS = 10 \* 60 \* 1000/);
  assert.match(
    workerSource,
    /status IN \('completed','claimed'\) AND updated>=\?/,
  );
  assert.match(client, /REPLAY & RESULT · 10 MINUTES/);
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
      listed: true,
    },
    owner.token,
    "create_worker_bounty_0001",
  );
  assert.equal(created.status, 201);
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
    },
    challenger.token,
    "enter_worker_bounty_0001",
  );
  assert.equal(entered.status, 202);
  assert.equal(entered.body.status, "settled");
  assert.ok(["win", "loss", "draw"].includes(entered.body.result.outcome));
  const publicAttempt = await call(env, "/api/attempts/" + entered.body.id);
  assert.equal(publicAttempt.status, 200);
  assert.equal(publicAttempt.body.replay.versions.hash.length, 64);
});
