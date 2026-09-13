import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { privateKeyToAccount } from "viem/accounts";
import worker from "../sites/worker/index.mjs";
import { validateEscrowAttestation } from "../sites/worker/mainnet.mjs";
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

test("settlement attestations bind the exact Tempo escrow typed data and canonical signer order", async () => {
  const one = privateKeyToAccount("0x" + "01".repeat(32)),
    two = privateKeyToAccount("0x" + "02".repeat(32)),
    config = {
      chainId: 4217,
      escrowAddress: "0x461eefD1c4bcbE76C470487cF18b892fCD76d494",
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
        version: "1",
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
    signatures = [
      await two.signTypedData(typed),
      await one.signTypedData(typed),
    ];
  const validated = await validateEscrowAttestation(
    config,
    payload,
    signatures,
    [one.address, two.address],
  );
  assert.equal(validated.length, 2);
  assert.deepEqual(
    validated.map((item) => item.signer),
    [one.address, two.address].sort((left, right) =>
      left.toLowerCase().localeCompare(right.toLowerCase()),
    ),
  );
  await assert.rejects(
    () =>
      validateEscrowAttestation(
        config,
        payload,
        [signatures[0], signatures[0]],
        [one.address, two.address],
      ),
    /two different/,
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

test("Tempo wallet sign-in verifies an EIP-191 account and issues a session", async (t) => {
  const DB = new D1Mock();
  await DB.migrate();
  t.after(() => DB.close());
  const signer = privateKeyToAccount("0x" + "03".repeat(32));
  const env = {
    DB,
    WM_MODE: "tempo-mainnet",
    WM_BOUNTY_ESCROW_ADDRESS: "0x461eefD1c4bcbE76C470487cF18b892fCD76d494",
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
});

test("official bounty trials replay before the signing result is shown", async () => {
  const [client, app] = await Promise.all([
    readFile(new URL("../dist/bounties.mjs", import.meta.url), "utf8"),
    readFile(new URL("../dist/app.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(client, /wm-watched-official-replay-/);
  assert.match(client, /await watchOfficialReplay\(a\);/);
  assert.match(client, /id="watch-official-replay"/);
  assert.match(client, /Use a saved build/);
  assert.match(client, /data-deploy-build/);
  assert.match(app, /Continue to result/);
  assert.match(app, /bountyUI\.attempt\(officialAttemptId\)/);
  assert.match(app, /deploy-official-counter/);
  assert.match(app, /bountyUI\.deploy\(bountyContext\.attemptId\)/);
});

test("direct escrow intents bind exact terms to the confirmed create and entry events", async (t) => {
  const DB = new D1Mock();
  await DB.migrate();
  t.after(() => DB.close());
  const escrow = "0x461eefD1c4bcbE76C470487cF18b892fCD76d494",
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
  const prepared = await post(
    "/api/bounties",
    body,
    "direct_create_fixture_0001",
  );
  assert.equal(prepared.status, 202);
  assert.equal(prepared.body.direct, true);
  assert.equal(prepared.body.plan.escrow, escrow);
  assert.equal(prepared.body.plan.approval.amount, "1000000");
  let activeReceipt = {
    status: "0x1",
    logs: [
      {
        address: escrow,
        topics: [
          "0x8efb9ae6fa203b97084e8481d1a346804fe0b74f6771b412acbb06080d3fc60b",
          "0x" + pad(7),
          addressTopic,
        ],
        data:
          "0x" +
          pad(1000000) +
          pad(10000) +
          pad(prepared.body.expiresAt) +
          prepared.body.termsHash.slice(2),
      },
    ],
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url) === "https://tempo-rpc.fixture")
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: activeReceipt }),
        { headers: { "content-type": "application/json" } },
      );
    return originalFetch(url);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const created = await post(
    "/api/escrow/intents/" + prepared.body.intentId + "/confirm",
    { transactionHash: "0x" + "aa".repeat(32) },
    "direct_create_confirm_0001",
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.reward, "1");
  assert.equal(created.body.entry, "0.01");
  assert.equal(
    DB.sqlite
      .prepare("SELECT escrow_bounty_id,terms_hash FROM bounties WHERE id=?")
      .get(created.body.id).escrow_bounty_id,
    "7",
  );
  const entry = await post(
    "/api/bounties/" + created.body.id + "/attempts",
    {
      maxEntry: "0.01",
      maxPlatformFeeBps: 250,
    },
    "direct_entry_fixture_0001",
    challengerSession,
  );
  assert.equal(entry.status, 202, JSON.stringify(entry.body));
  assert.equal(entry.body.plan.approval.amount, "10000");
  activeReceipt = {
    status: "0x1",
    logs: [
      {
        address: escrow,
        topics: [
          "0xe1c145c9979da15902ab996aa4dc96efd960b46a04ce9a3516a8b76affc85395",
          "0x" + pad(7),
          "0x" + pad(1),
          "0x" + challengerWallet.slice(2).padStart(64, "0"),
        ],
        data: "0x" + pad(Math.floor(Date.now() / 1000) + 300),
      },
    ],
  };
  const entered = await post(
    "/api/escrow/intents/" + entry.body.intentId + "/confirm",
    { transactionHash: "0x" + "bb".repeat(32) },
    "direct_entry_confirm_0001",
    challengerSession,
  );
  assert.equal(entered.status, 202, JSON.stringify(entered.body));
  assert.equal(entered.body.status, "engineering");
  assert.deepEqual(entered.body.defender, blueprint);
  assert.ok(entered.body.build.remainingSeconds >= 150);
  const publicBounty = await worker.fetch(
      new Request("https://foundry.example/api/bounties/" + created.body.id),
      env,
    ),
    publicBountyBody = await publicBounty.json();
  assert.equal(publicBounty.status, 200);
  assert.equal(publicBountyBody.blueprint, undefined);
  assert.equal(publicBountyBody.scout.cost > 0, true);
  const anonymousAttempt = await worker.fetch(
    new Request("https://foundry.example/api/attempts/" + entered.body.id),
    env,
  );
  assert.equal(anonymousAttempt.status, 403);
  const anonymousPractice = await call(env, "/api/practice", "POST", {
    challenger: packChallenge(PRESETS[1], "foundry", 0, blueprint.q),
    bountyId: created.body.id,
    seed: 42,
  });
  assert.equal(anonymousPractice.status, 403);
  const challengerBlueprint = packChallenge(
      PRESETS[1],
      "foundry",
      0,
      blueprint.q,
    ),
    deployed = await post(
      "/api/attempts/" + entered.body.id + "/deploy",
      { blueprint: challengerBlueprint },
      "direct_deploy_fixture_0001",
      challengerSession,
    );
  assert.equal(deployed.status, 200, JSON.stringify(deployed.body));
  assert.equal(deployed.body.status, "awaiting-signatures");
  assert.deepEqual(deployed.body.replay.challenger, challengerBlueprint);
  assert.deepEqual(deployed.body.replay.defender, blueprint);
  assert.equal(deployed.body.replay.seed, deployed.body.result.seed);
  assert.equal(deployed.body.result.settlement.bountyId, "7");
  assert.equal(deployed.body.result.settlement.signatures.length, 0);
  const settlement = DB.sqlite
      .prepare("SELECT settlement_payload FROM attempts WHERE id=?")
      .get(deployed.body.id),
    payload = JSON.parse(settlement.settlement_payload);
  payload.signatures = ["0x" + "11".repeat(65), "0x" + "22".repeat(65)];
  DB.sqlite
    .prepare(
      "UPDATE attempts SET status='ready-to-settle',settlement_payload=? WHERE id=?",
    )
    .run(JSON.stringify(payload), deployed.body.id);
  const winner = payload.outcome === 0,
    settlementPayout = winner ? 975000 : 0,
    settlementFee = winner ? 25000 : 0,
    creatorEntry = payload.outcome < 2 ? 10000 : 0;
  activeReceipt = {
    status: "0x1",
    logs: [
      {
        address: escrow,
        topics: [
          "0xf1bd0b9955d3af8c0f3ef37ea58ba05a0df5b81798cb73c84f62c093fa013e66",
          "0x" + pad(7),
          "0x" + pad(1),
          "0x" + challengerWallet.slice(2).padStart(64, "0"),
        ],
        data:
          "0x" +
          pad(payload.outcome) +
          payload.resultHash.slice(2) +
          pad(settlementPayout) +
          pad(settlementFee) +
          pad(creatorEntry),
      },
    ],
  };
  const settled = await post(
    "/api/attempts/" + deployed.body.id + "/settlement-confirm",
    { transactionHash: "0x" + "cc".repeat(32) },
    "direct_settlement_confirm_0001",
    challengerSession,
  );
  assert.equal(settled.status, 200, JSON.stringify(settled.body));
  assert.equal(settled.body.status, "settled");
  assert.equal(settled.body.result.payout, winner ? "0.975" : "0");
  assert.equal(
    DB.sqlite
      .prepare("SELECT status FROM bounties WHERE id=?")
      .get(created.body.id).status,
    winner ? "claimed" : "open",
  );
  const preparedCancel = await post(
    "/api/bounties",
    { ...body, title: "Cancellable fixture" },
    "direct_create_fixture_0002",
  );
  activeReceipt = {
    status: "0x1",
    logs: [
      {
        address: escrow,
        topics: [
          "0x8efb9ae6fa203b97084e8481d1a346804fe0b74f6771b412acbb06080d3fc60b",
          "0x" + pad(8),
          addressTopic,
        ],
        data:
          "0x" +
          pad(1000000) +
          pad(10000) +
          pad(preparedCancel.body.expiresAt) +
          preparedCancel.body.termsHash.slice(2),
      },
    ],
  };
  const cancellable = await post(
    "/api/escrow/intents/" + preparedCancel.body.intentId + "/confirm",
    { transactionHash: "0x" + "dd".repeat(32) },
    "direct_create_confirm_0002",
  );
  const cancel = await post(
    "/api/bounties/" + cancellable.body.id + "/cancel",
    {},
    "direct_cancel_fixture_0001",
  );
  assert.equal(cancel.status, 202, JSON.stringify(cancel.body));
  activeReceipt = {
    status: "0x1",
    logs: [
      {
        address: escrow,
        topics: [
          "0x329fa6d5d5547698be130ca491e4fc9476ab88b3c2a44f412d1670585daeadf3",
          "0x" + pad(8),
          addressTopic,
        ],
        data: "0x" + pad(1000000),
      },
    ],
  };
  const cancelled = await post(
    "/api/escrow/intents/" + cancel.body.intentId + "/confirm",
    { transactionHash: "0x" + "ee".repeat(32) },
    "direct_cancel_confirm_0001",
  );
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.status, "cancelled");
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
