import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { privateKeyToAccount } from "viem/accounts";
import { mainnetFetch } from "../sites/worker/mainnet.mjs";
import { packChallenge, PRESETS } from "../dist/data.mjs";

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
      "0009_board_pagination.sql",
      "0010_free_email_challenges.sql",
    ])
      this.sqlite.exec(
        await readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8"),
      );
  }
  close() {
    this.sqlite.close();
  }
}

const signerKey = "0x" + "0a".repeat(32);
const signer = privateKeyToAccount(signerKey);
const baseEnv = (DB) => ({
  DB,
  WM_MODE: "tempo-mainnet",
  WM_BOUNTY_ESCROW_VERSION: "6",
  WM_ALLOW_ESCROW_V6: "true",
  WM_BOUNTY_ESCROW_ADDRESS: "0x6666666666666666666666666666666666666666",
  WM_ESCROW_SETTLEMENT_SIGNER: signer.address,
  WM_SETTLEMENT_PRIVATE_KEY: signerKey,
  WM_RESULT_SIGNING_READY: "true",
  WM_EMAIL_AUTH_RESEND_API_KEY: "re_test_delivery_key",
  WM_EMAIL_AUTH_FROM: "War Machines <login@war-machines.test>",
  WM_EMAIL_AUTH_SECRET: "a-test-only-email-session-secret-with-at-least-32-characters",
});

const request = (path, { method = "GET", body, cookie, key } = {}) =>
  new Request("https://foundry.example" + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
      ...(key ? { "idempotency-key": key } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const invoke = (env, path, options) =>
  mainnetFetch(request(path, options), env, { waitUntil() {} }, () => new Response("asset", { status: 404 }));

const cookieValue = (response) => {
  const match = response.headers.get("set-cookie")?.match(/wm_email_session=([^;]+)/);
  assert.ok(match, "email sign-in should set a session cookie");
  return "wm_email_session=" + match[1];
};

async function signInByEmail(env, { email, name }) {
  const response = await invoke(env, "/api/auth/email/request", {
    method: "POST",
    body: { email, name, returnTo: "/#free-board" },
  });
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.ok, true);
  return body;
}

test("email-verified players can publish and complete a hosted free challenge without any payment or settlement job", async (t) => {
  const DB = new D1Fixture();
  await DB.migrate();
  t.after(() => DB.close());
  const env = baseEnv(DB), originalFetch = globalThis.fetch;
  const mail = [];
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.resend.com/emails");
    assert.equal(init.method, "POST");
    mail.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: "email_fixture" }), { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await signInByEmail(env, { email: "creator@example.test", name: "Creator" });
  assert.equal(mail.length, 1);
  assert.equal(mail[0].to[0], "creator@example.test");
  const creatorLink = mail[0].html.match(/href="([^"]+)"/)[1];
  const creatorVerify = await mainnetFetch(new Request(creatorLink), env, { waitUntil() {} }, () => new Response("asset"));
  assert.equal(creatorVerify.status, 303);
  const creatorCookie = cookieValue(creatorVerify);
  const reused = await mainnetFetch(new Request(creatorLink), env, { waitUntil() {} }, () => new Response("asset"));
  assert.equal(reused.status, 401);

  const me = await invoke(env, "/api/auth/email/me", { cookie: creatorCookie });
  assert.equal(me.status, 200);
  const creator = await me.json();
  assert.match(creator.id, /^[a-f0-9-]{36}$/);
  assert.equal(creator.name, "Creator");
  assert.equal(creator.kind, "email");

  const creation = await invoke(env, "/api/free/bounties", {
    method: "POST",
    cookie: creatorCookie,
    key: "free-create-creator-0001",
    body: {
      title: "Creator's hosted friend challenge",
      blueprint: packChallenge(PRESETS[0], "foundry", 0),
      hours: 24,
      listed: true,
    },
  });
  assert.equal(creation.status, 201);
  const bounty = await creation.json();
  assert.equal(bounty.kind, "free");
  assert.equal(bounty.free, true);
  assert.equal(bounty.official, true);
  assert.equal(bounty.entry, "0");
  assert.equal(bounty.reward, "0");
  assert.equal(bounty.platformFeeBps, 0);
  assert.equal(bounty.listed, true);
  assert.equal(bounty.versions.hash?.length, 64);

  const publicBoard = await invoke(env, "/api/free/bounties");
  assert.equal(publicBoard.status, 200);
  assert.ok((await publicBoard.json()).some((row) => row.id === bounty.id && row.kind === "free"));
  const noDeliveryBoard = await invoke(
    { ...env, WM_EMAIL_AUTH_RESEND_API_KEY: "", WM_EMAIL_AUTH_FROM: "", WM_EMAIL_AUTH_SECRET: "" },
    "/api/free/bounties",
  );
  assert.equal(noDeliveryBoard.status, 200, "the public free board stays available while email delivery is configured");

  await signInByEmail(env, { email: "friend@example.test", name: "Friend" });
  const friendLink = mail.at(-1).html.match(/href="([^"]+)"/)[1];
  const friendVerify = await mainnetFetch(new Request(friendLink), env, { waitUntil() {} }, () => new Response("asset"));
  assert.equal(friendVerify.status, 303);
  const friendCookie = cookieValue(friendVerify);

  const entered = await invoke(env, `/api/free/bounties/${bounty.id}/attempts`, {
    method: "POST",
    cookie: friendCookie,
    key: "free-enter-friend-00001",
    body: { blueprint: packChallenge(PRESETS[1], "foundry", 0), participantName: "Friend" },
  });
  assert.equal(entered.status, 201);
  const attempt = await entered.json();
  assert.equal(attempt.kind, "free");
  assert.equal(attempt.official, true);
  assert.equal(attempt.status, "settled");
  assert.ok(["win", "loss", "draw"].includes(attempt.result.outcome));
  assert.equal(attempt.payment.required, false);
  assert.equal(attempt.economics.entry, "0");
  assert.equal(attempt.replay.versions.hash, bounty.versions.hash);

  const sameAttempt = await invoke(env, `/api/free/bounties/${bounty.id}/attempts`, {
    method: "POST",
    cookie: friendCookie,
    key: "free-enter-friend-00001",
    body: { blueprint: packChallenge(PRESETS[1], "foundry", 0), participantName: "Friend" },
  });
  assert.equal(sameAttempt.status, 201);
  assert.equal((await sameAttempt.json()).id, attempt.id);
  const repeat = await invoke(env, `/api/free/bounties/${bounty.id}/attempts`, {
    method: "POST",
    cookie: friendCookie,
    key: "free-enter-friend-00002",
    body: { blueprint: packChallenge(PRESETS[1], "foundry", 0), participantName: "Friend" },
  });
  assert.equal(repeat.status, 409);

  const privateRun = await invoke(env, `/api/free/attempts/${attempt.id}`);
  assert.equal(privateRun.status, 403);
  const creatorRun = await invoke(env, `/api/free/attempts/${attempt.id}`, { cookie: creatorCookie });
  assert.equal(creatorRun.status, 200);
  assert.equal((await creatorRun.json()).id, attempt.id);
  assert.equal(
    DB.sqlite.prepare("SELECT COUNT(*) AS total FROM settlement_jobs").get().total,
    0,
    "free runs never create an escrow settlement job",
  );
  const stored = JSON.stringify(
    DB.sqlite.prepare("SELECT email_hash,display_name,return_to FROM email_login_tokens").all(),
  );
  assert.equal(stored.includes("@example.test"), false, "raw email addresses are not persisted in D1");
});
