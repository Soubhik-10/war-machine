import * as Mppx from "../../node_modules/mppx/dist/server/Mppx.js";
import { tempo } from "../../node_modules/mppx/dist/tempo/server/Methods.js";
import { createClient, http } from "viem/tempo";
import {
  encodeFunctionData,
  getAddress,
  parseAbi,
  recoverMessageAddress,
  recoverTypedDataAddress,
} from "viem";
import {
  ARENAS,
  DEFAULT_RULES,
  MAX_MODULES,
  PARTS,
  PRESETS,
  clone,
  environmentProfile,
  normalizeRules,
  packChallenge,
  stats,
  terrainAt,
  unpackChallenge,
  validate,
} from "../../dist/data.mjs";
import { Battle } from "../../dist/engine.mjs";
import { engineeringReport } from "../../dist/engineering.mjs";
import { CLIENT_ENGINE_HASH } from "../../dist/release.mjs";
import { PLATFORM_FEE_BPS, PLATFORM_FEE_POLICY } from "../../dist/economy.mjs";
import { PART_GUIDANCE } from "../../dist/part-guidance.mjs";
import {
  PATH_USD_DECIMALS,
  PATH_USD_TOKEN,
  PLATFORM_FEE_RECIPIENT,
  TEMPO_MAINNET_CHAIN_ID,
  pathUsdToUnits,
  payoutQuote,
  unitsToPathUsd,
} from "./pathusd.mjs";

const now = () => Date.now(),
  id = () => crypto.randomUUID(),
  json = (value) => JSON.stringify(value);
const fail = (status, message) => {
  const error = Error(message);
  error.status = status;
  throw error;
};
const check = (value, message, status = 400) => {
  if (!value) fail(status, message);
  return value;
};
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const fields = (value, allowed) => {
  check(
    value && typeof value === "object" && !Array.isArray(value),
    "Expected a JSON object.",
  );
  check(
    Object.keys(value).every((key) => allowed.includes(key)),
    "Unknown field in request.",
  );
};
const integer = (value, min, max, label) =>
  check(
    Number.isSafeInteger(value) && value >= min && value <= max,
    `${label} must be a whole number from ${min} to ${max}.`,
  );
const text = (value, max, label) => {
  check(
    typeof value === "string" &&
      value.trim().length > 0 &&
      value.trim().length <= max &&
      !/[\u0000-\u001f]/.test(value),
    `Invalid ${label}.`,
  );
  return value.trim();
};
const signInMessage = (value) => {
  check(
    typeof value === "string" &&
      value.length > 0 &&
      value.length <= 1000 &&
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),
    "Invalid sign-in message.",
  );
  return value;
};
const parse = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    fail(500, "Stored game data is invalid.");
  }
};
const validKey = (value) =>
  check(
    typeof value === "string" && /^[A-Za-z0-9_-]{16,100}$/.test(value),
    "Supply a unique Idempotency-Key (16–100 letters, numbers, _ or -).",
  );
const base64url = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
const randomSecret = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
};
const hex = async (value) => {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};
const response = (value, status = 200, headers = {}) =>
  new Response(json(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
const cookie = (request, name) =>
  request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(name + "="))
    ?.slice(name.length + 1) || null;

// The deployed escrow gives each entered attempt five minutes in total. Keep
// two minutes for independent result attestations and settlement, then use any
// larger window from a later escrow deployment for cost-scaled construction.
const MIN_BUILD_SECONDS = 180;
const MAX_BUILD_SECONDS = 300;
const SETTLEMENT_RESERVE_SECONDS = 120;

function scoutBlueprint(blueprint) {
  const challenge = unpackChallenge(blueprint, true);
  const machine = challenge.machine;
  const s = stats(machine);
  return {
    cost: s.cost,
    mass: s.mass,
    parts: s.parts,
    weapons: s.weapons,
    height: s.height,
    arena: challenge.arena,
    rules: challenge.rules,
    climate:
      ARENAS.find((arena) => arena.id === challenge.arena)?.climate?.name ||
      null,
  };
}

function requestedBuildSeconds(blueprint) {
  const scout = scoutBlueprint(blueprint);
  const limit = scout.rules.credits || Math.max(1200, scout.cost);
  const proportion = Math.min(1, scout.cost / Math.max(1, limit));
  return Math.round(
    MIN_BUILD_SECONDS + (MAX_BUILD_SECONDS - MIN_BUILD_SECONDS) * proportion,
  );
}

async function canRevealDefender(db, row, accountId) {
  if (!accountId) return false;
  if (row.owner === accountId) return true;
  const entered = await db
    .prepare("SELECT 1 FROM attempts WHERE bounty=? AND account=? LIMIT 1")
    .bind(row.id, accountId)
    .first();
  return !!entered;
}

function canonicalBlueprint(input, locked) {
  fields(input, [
    "v",
    "n",
    "p",
    "t",
    "g",
    "d",
    "s",
    "a",
    "e",
    "b",
    "q",
    "fr",
    "ac",
    "gl",
    "pt",
    "no",
    "f",
    "m",
  ]);
  if (input.q)
    fields(input.q, ["mode", "combat", "credits", "parts", "mass", "weapons"]);
  try {
    const packed = locked
      ? { ...input, a: locked.a, e: 0, q: locked.q, b: locked.b }
      : input;
    const challenge = unpackChallenge(packed);
    return packChallenge(
      challenge.machine,
      challenge.arena,
      0,
      challenge.rules,
    );
  } catch (error) {
    fail(400, error.message || "Invalid blueprint.");
  }
}

export function runtimeConfig(env, origin) {
  if (env.WM_MODE !== "tempo-mainnet") return { mode: "demo", enabled: false };
  // Funds never pass through this Worker. The address is pinned to the verified, immutable
  // V2 deployment rather than accepting an operator-substituted token or custodial recipient.
  const escrow = "0x7ce840C9A852721E9b87d1FA028D0a988aee0f8e";
  if (
    String(env.WM_BOUNTY_ESCROW_ADDRESS || "").toLowerCase() !==
    escrow.toLowerCase()
  )
    return {
      mode: "tempo-mainnet",
      enabled: false,
      reason:
        "Set WM_BOUNTY_ESCROW_ADDRESS to the verified War Machines Tempo escrow before enabling direct bounty transactions.",
    };
  const mppRecipient = String(env.WM_AGENT_MPP_RECIPIENT || ""),
    mppPrice = String(env.WM_AGENT_MPP_PRICE || "");
  let mppPriceUnits = null;
  try {
    mppPriceUnits = pathUsdToUnits(mppPrice, {
      allowZero: false,
      maxUnits: 1_000_000_000_000_000n,
    });
  } catch {}
  const agentMppEnabled =
    env.WM_AGENT_MPP_ENABLED === "true" &&
    /^0x[0-9a-fA-F]{40}$/.test(mppRecipient) &&
    typeof env.MPP_SECRET_KEY === "string" &&
    env.MPP_SECRET_KEY.length >= 32 &&
    mppPriceUnits !== null;
  return {
    mode: "tempo-mainnet",
    enabled: true,
    directEscrow: true,
    escrowAddress: getAddress(escrow),
    token: PATH_USD_TOKEN,
    chainId: TEMPO_MAINNET_CHAIN_ID,
    decimals: PATH_USD_DECIMALS,
    rpcUrl: env.WM_TEMPO_RPC_URL || "https://rpc.tempo.xyz",
    origin,
    agentMppEnabled,
    agentMppRecipient: agentMppEnabled ? getAddress(mppRecipient) : null,
    agentMppPriceUnits: mppPriceUnits,
    mppSecret: agentMppEnabled ? env.MPP_SECRET_KEY : null,
    // The deployed escrow needs two independent attestations before it can
    // settle a result. This worker intentionally has no signer keys and no
    // signing service yet, so accepting another paid bounty would strand new
    // entries at the same point. Keep account access and existing-bounty
    // settlement status online,
    // while failing closed for new funding and entries. A reviewed signer
    // service must explicitly set this readiness flag only after both
    // independent signers are live.
    acceptingNewBounties: env.WM_RESULT_SIGNING_READY === "true",
    settlementReason:
      "New paid bounties are paused until the two independent result signers are online.",
    reason: null,
  };
}

function catalog(config) {
  const paid = config.enabled,
    acceptingNewBounties = paid && config.acceptingNewBounties;
  return {
    mode: "tempo-mainnet",
    apiVersion: "3.2-direct-escrow",
    discovery: "/.well-known/war-machines.json",
    openapi: "/api/openapi.json",
    terrainInfo: Object.fromEntries(
      ARENAS.flatMap((arena) => arena.terrain).map((terrain) => [
        terrain.type,
        terrain,
      ]),
    ),
    economics: {
      platformFee: PLATFORM_FEE_POLICY,
      creditScale: 10 ** PATH_USD_DECIMALS,
      amountUnit: "pathUSD",
      network: {
        chainId: TEMPO_MAINNET_CHAIN_ID,
        token: PATH_USD_TOKEN,
        decimals: PATH_USD_DECIMALS,
        explorer: "https://explore.tempo.xyz",
      },
      maxInteger: 1000000000,
      entryMin: "0.01",
      rewardMin: "0.01",
      rewardMustExceedEntry: false,
      personalCapsDefault: null,
      hours: { min: 0, max: 8760, zero: "No expiry" },
    },
    guest: [
      "build",
      "save local blueprints",
      "share machines",
      "browse",
      "validate",
      "practice",
      ...(acceptingNewBounties
        ? [
            "create and fund a bounty with Tempo Wallet",
            "enter a bounty with Tempo Wallet",
          ]
        : ["inspect existing direct-escrow bounties"]),
    ],
    loginRequired: [
      "save bounty",
      "save account builds",
      "private account history",
    ],
    walletAuth: paid
      ? {
          enabled: true,
          siwe: "/api/auth/challenge",
          verify: "/api/auth/verify",
        }
      : "locked",
    mpp: {
      enabled: !!config.agentMppEnabled,
      method: "tempo",
      intent: "charge",
      scope:
        "Agent API routes only. Bounty reward and entry funding use direct escrow calls.",
      ...(config.agentMppEnabled
        ? {
            routes: [
              {
                path: "/api/agent/practice",
                price: unitsToPathUsd(config.agentMppPriceUnits),
                recipient: config.agentMppRecipient,
              },
            ],
          }
        : {}),
    },
    directEscrow: paid
      ? {
          enabled: true,
          acceptingNewBounties,
          settlement: acceptingNewBounties
            ? { ready: true }
            : { ready: false, reason: config.settlementReason },
          address: config.escrowAddress,
          token: config.token,
          chainId: config.chainId,
          requiredCalls: [
            "approve",
            "createBounty",
            "enterBounty",
            "cancelBounty",
            "forfeitTimedOutAttempt",
            "expireBounty",
            "settleAttempt",
          ],
          paidReveal: {
            defender:
              "Concealed until the challenger confirms enterBounty onchain.",
            buildWindowSeconds: {
              minimum: MIN_BUILD_SECONDS,
              maximum: MAX_BUILD_SECONDS,
              settlementReserveSeconds: SETTLEMENT_RESERVE_SECONDS,
            },
          },
        }
      : null,
    activation: paid
      ? acceptingNewBounties
        ? undefined
        : { ready: false, reason: config.settlementReason }
      : { ready: false, reason: config.reason },
    versions: { hash: CLIENT_ENGINE_HASH },
    startingCredits: 0,
    parts: PARTS.map((part) => ({ ...part, ...PART_GUIDANCE[part.id] })),
    arenas: ARENAS,
    defaultRules: DEFAULT_RULES,
    examples: PRESETS.map((machine) => packChallenge(machine, "foundry", 0)),
    rules: {
      oneActiveAttempt: true,
      combat: "auto",
      timeLimitSeconds: 100,
      drawIntegrityThreshold: 0.025,
      entryRefund:
        "Technical simulation failure only. Losses, draws and missed counter deadlines pay the entry to the bounty creator.",
      spending:
        "No application spending cap. Each bounty reward and entry amount is separately confirmed in Tempo Wallet.",
      paidReveal:
        "Public scouts expose only cost, mass, part count, weapon count, arena and limits. A confirmed entry reveals the exact defender to that challenger only.",
      timeout:
        "Missing the counter-build deadline is a loss. The signed escrow settlement sends the entry to the bounty creator and reopens the bounty.",
      payments: paid
        ? acceptingNewBounties
          ? "Direct Tempo mainnet pathUSD escrow. Agents may separately use MPP only for explicitly priced API work; MPP never funds or enters a bounty."
          : config.settlementReason
        : "Payments are unavailable until escrow configuration is complete. No synthetic credits are issued.",
    },
  };
}

const discovery = (config) => ({
  name: "War Machines",
  version: "3.2",
  mode: "tempo-mainnet",
  description:
    "Engineer autonomous machines with your own code or model. Same deterministic game engine as browser players.",
  base: "/api",
  openapi: "/api/openapi.json",
  instructions: "/agents.md",
  skill: "/skills/war-machines-engineer/SKILL.md",
  catalog: "/api/rules",
  payments: config.enabled
    ? {
        enabled: true,
        directEscrow: true,
        acceptingNewBounties: !!config.acceptingNewBounties,
        settlement: config.acceptingNewBounties
          ? { ready: true }
          : { ready: false, reason: config.settlementReason },
        mpp: !!config.agentMppEnabled,
        mppScope: config.agentMppEnabled
          ? "Priced agent API routes only; never bounty funding or entry."
          : "MPP agent billing is not configured.",
        ...(config.agentMppEnabled
          ? {
              mppRoutes: [
                {
                  path: "/api/agent/practice",
                  price: unitsToPathUsd(config.agentMppPriceUnits),
                  recipient: config.agentMppRecipient,
                },
              ],
            }
          : {}),
        tempoMainnet: true,
        currency: "pathUSD",
        token: PATH_USD_TOKEN,
        decimals: PATH_USD_DECIMALS,
        chainId: TEMPO_MAINNET_CHAIN_ID,
        escrow: config.escrowAddress,
        platformFeeBps: 250,
        payout: "winner receives 97.5% of gross reward",
      }
    : {
        enabled: false,
        directEscrow: false,
        mpp: false,
        tempoMainnet: true,
        currency: "pathUSD",
        cashValue: true,
        reason: config.reason,
      },
  authentication: {
    guest: ["catalog", "bounties", "validation", "practice"],
    account: [
      "create/cancel bounty",
      "official entry",
      "save builds",
      "history",
    ],
    scheme: "Tempo wallet session",
  },
  invariants: {
    oneActiveAttemptPerBounty: true,
    creatorSetsEconomics: true,
    paidReveal:
      "The defender blueprint is not served until this account has a confirmed escrow entry.",
    results: "deterministic replay; two escrow signer attestations required",
    timeout:
      "counter-build expiry settles as a loss; entry goes to bounty creator",
    practicePays: false,
    officialSeed: "server chosen",
  },
});

const openapi = {
  openapi: "3.1.0",
  info: {
    title: "War Machines Tempo mainnet API",
    version: "3.3",
    description:
      "Public bounty responses expose scouts only. A confirmed direct escrow entry reveals the defender to that challenger and unlocks one timed counter deployment.",
  },
  paths: {
    "/rules": { get: {} },
    "/auth/challenge": { post: {} },
    "/auth/verify": { post: {} },
    "/bounties": { get: {}, post: {} },
    "/bounties/{id}": {
      get: {
        description:
          "Returns a scout unless this wallet created or entered the bounty.",
      },
    },
    "/bounties/{id}/attempts": {
      post: {
        description:
          "Prepares direct enterBounty. Body: maxEntry and maxPlatformFeeBps only.",
      },
    },
    "/attempts/{id}": {
      get: {
        description:
          "Creator and paid challenger only. Engineering status includes the private defender and build deadline for the challenger.",
      },
    },
    "/attempts/{id}/deploy": {
      post: {
        description:
          "Paid challenger submits one validated counter blueprint before the reported build deadline.",
      },
    },
    "/me/wallet": {
      get: {
        description:
          "Returns the signed-in wallet address and its live pathUSD token balance.",
      },
    },
    "/me/builds": { get: {}, post: {} },
  },
};

async function bodyOf(request) {
  const length = Number(request.headers.get("content-length") || 0);
  check(length <= 65536, "Request exceeds 64 KiB.", 413);
  check(
    request.headers.get("content-type")?.split(";")[0] === "application/json",
    "Use application/json.",
    415,
  );
  try {
    return await request.json();
  } catch {
    fail(400, "Invalid JSON.");
  }
}
async function dbAuth(db, request) {
  const raw = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (raw) {
    const token = await hex(raw);
    const row = await db
      .prepare(
        "SELECT id,account,name,'agent' AS role FROM agent_keys WHERE token_hash=? AND revoked=0",
      )
      .bind(token)
      .first();
    if (row) return row;
  }
  const value = cookie(request, "wm_session");
  if (!value) return null;
  const token = await hex(value),
    session = await db
      .prepare("SELECT account FROM sessions WHERE token_hash=? AND expires>?")
      .bind(token, now())
      .first();
  if (!session) return null;
  const row = await db
    .prepare("SELECT id,name,payout_address FROM accounts WHERE id=?")
    .bind(session.account)
    .first();
  return row ? { ...row, account: row.id, role: "owner" } : null;
}
const requireAuth = (auth) =>
  check(
    auth,
    "Connect a Tempo wallet for bounty actions. Building and practice are open to guests.",
    401,
  );
const requireOwner = (auth) =>
  check(
    auth?.role === "owner",
    "Tempo bounty funding and entry require the connected payout wallet.",
    403,
  );
async function prior(db, account, key, kind, body) {
  validKey(key);
  const digest = await hex(json(body)),
    row = await db
      .prepare(
        "SELECT kind,digest,ref FROM idempotency WHERE account=? AND key=?",
      )
      .bind(account, key)
      .first();
  if (row) {
    check(
      row.kind === kind && row.digest === digest,
      "That idempotency key was used for a different request.",
      409,
    );
    return row.ref;
  }
  return null;
}
async function remember(db, account, key, kind, body, ref) {
  await db
    .prepare(
      "INSERT INTO idempotency (account,key,kind,digest,ref,created) VALUES (?,?,?,?,?,?)",
    )
    .bind(account, key, kind, await hex(json(body)), ref, now())
    .run();
}
async function amount(value, label, config, { allowZero = false } = {}) {
  try {
    return pathUsdToUnits(value, {
      allowZero,
      maxUnits: config.maxOperationUnits,
    });
  } catch (error) {
    fail(400, `${label}: ${error.message}`);
  }
}
const display = (value) => unitsToPathUsd(value);

async function account(db, accountId) {
  const row = await db
    .prepare(
      "SELECT id,name,payout_address,entry_cap_units,daily_cap_units FROM accounts WHERE id=?",
    )
    .bind(accountId)
    .first();
  check(row, "Account not found.", 404);
  const reserveRows = await db
    .prepare(
      "SELECT reward_units FROM bounties WHERE owner=? AND status IN ('open','busy') AND reward_units IS NOT NULL",
    )
    .bind(accountId)
    .all();
  const day = new Date(now()).setUTCHours(0, 0, 0, 0),
    spentRows = await db
      .prepare(
        "SELECT b.entry_units FROM attempts a JOIN bounties b ON b.id=a.bounty WHERE a.account=? AND a.created>=? AND a.status!='refunded' AND b.entry_units IS NOT NULL",
      )
      .bind(accountId, day)
      .all();
  const sum = (rows) =>
    rows.results.reduce(
      (total, item) =>
        total + BigInt(item.reward_units ?? item.entry_units ?? 0),
      0n,
    );
  return {
    id: row.id,
    name: row.name,
    balance: "0",
    entryCap:
      row.entry_cap_units === null ? null : display(row.entry_cap_units),
    dailyCap:
      row.daily_cap_units === null ? null : display(row.daily_cap_units),
    spentToday: display(sum(spentRows)),
    reserved: display(sum(reserveRows)),
    mode: "tempo-mainnet",
    payoutAddress: row.payout_address,
    identities: [
      {
        scheme: "tempo",
        chain: String(TEMPO_MAINNET_CHAIN_ID),
        address: row.payout_address,
      },
    ],
    versions: { hash: CLIENT_ENGINE_HASH },
  };
}
async function ledger(db, accountId) {
  const rows = await db
    .prepare(
      "SELECT kind,amount_units,ref,created,status FROM financial_operations WHERE account=? ORDER BY created DESC LIMIT 100",
    )
    .bind(accountId)
    .all();
  return rows.results.map((row) => ({
    kind: row.kind,
    amount: display(row.amount_units),
    ref: row.ref,
    created: row.created,
    status: row.status,
  }));
}
async function payoutAddress(db, accountId) {
  const row = await db
    .prepare("SELECT payout_address FROM accounts WHERE id=?")
    .bind(accountId)
    .first();
  return check(
    row?.payout_address,
    "Connect a Tempo payout wallet before funding or entering a bounty.",
    409,
  );
}
async function bountyRow(db, bountyId) {
  const row = await db
    .prepare("SELECT * FROM bounties WHERE id=?")
    .bind(bountyId)
    .first();
  return check(row, "Bounty not found.", 404);
}
async function bountyView(db, row, viewer = null, history = false) {
  const owner = await db
      .prepare("SELECT name FROM accounts WHERE id=?")
      .bind(row.owner)
      .first(),
    quote = payoutQuote(
      row.reward_units,
      row.entry_units,
      row.platform_fee_bps ?? PLATFORM_FEE_BPS,
    ),
    count = await db
      .prepare("SELECT COUNT(*) AS total FROM attempts WHERE bounty=?")
      .bind(row.id)
      .first();
  const blueprint = parse(row.blueprint);
  const revealed = await canRevealDefender(db, row, viewer);
  const value = {
    id: row.id,
    owner: row.owner,
    ownerName: owner?.name || "Unknown engineer",
    title: row.title,
    scout: scoutBlueprint(blueprint),
    defenderRevealed: revealed,
    entry: display(row.entry_units),
    reward: display(row.reward_units),
    ...quote,
    status: row.status,
    listed: !!row.listed,
    created: row.created,
    expires: row.expires || null,
    links: {
      share: "/#bounty=" + row.id,
      self: "/api/bounties/" + row.id,
      attempts: "/api/bounties/" + row.id + "/attempts",
    },
    versions: { hash: CLIENT_ENGINE_HASH },
    compatible: true,
    activeAttempt: row.active_attempt,
    attempts: count.total,
    funded:
      ["open", "busy"].includes(row.status) &&
      row.reserve_units === row.reward_units,
  };
  if (revealed) value.blueprint = blueprint;
  if (history) {
    const rows = await db
      .prepare(
        "SELECT id,result,created,updated FROM attempts WHERE bounty=? AND status IN ('settled','refunded') ORDER BY created DESC LIMIT 20",
      )
      .bind(row.id)
      .all();
    value.history = rows.results.map((attempt) => ({
      id: attempt.id,
      result: attempt.result ? parse(attempt.result) : null,
      created: attempt.created,
      updated: attempt.updated,
    }));
  }
  return value;
}
async function recordFinancial(
  db,
  {
    kind,
    account,
    ref,
    amountUnits,
    recipient,
    status = "requested",
    providerRef = null,
  },
) {
  if (BigInt(amountUnits) <= 0n) return null;
  const record = id();
  await db
    .prepare(
      "INSERT OR IGNORE INTO financial_operations (id,kind,account,ref,amount_units,recipient,status,provider_ref,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      record,
      kind,
      account,
      ref,
      String(amountUnits),
      recipient,
      status,
      providerRef,
      now(),
      now(),
    )
    .run();
  return await db
    .prepare("SELECT * FROM financial_operations WHERE kind=? AND ref=?")
    .bind(kind, ref)
    .first();
}
async function outgoing(db, kind, account, ref, units, recipient) {
  return recordFinancial(db, {
    kind,
    account,
    ref,
    amountUnits: units,
    recipient,
    status: "requested",
  });
}

function mppStore(db) {
  return {
    async get(key) {
      const row = await db
        .prepare("SELECT value FROM payment_kv WHERE key=?")
        .bind(key)
        .first();
      return row ? parse(row.value) : null;
    },
    async put(key, value) {
      await db
        .prepare(
          "INSERT INTO payment_kv (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .bind(key, json(value))
        .run();
    },
    async delete(key) {
      await db.prepare("DELETE FROM payment_kv WHERE key=?").bind(key).run();
    },
    async update(key, fn) {
      const current = await this.get(key),
        change = fn(current);
      if (change.op === "set") await this.put(key, change.value);
      if (change.op === "delete") await this.delete(key);
      return change.result;
    },
    async tryClaim(key, expires) {
      const marker = json({ type: "mppx:replay", expires });
      const result = await db
        .prepare(
          "INSERT INTO payment_kv (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(json_extract(payment_kv.value,'$.expires') AS INTEGER)<?",
        )
        .bind(key, marker, now())
        .run();
      return result.meta.changes === 1;
    },
  };
}
function gateway(db, config) {
  const method = tempo.charge({
    currency: config.token,
    decimals: config.decimals,
    chainId: config.chainId,
    testnet: false,
    store: mppStore(db),
    waitForConfirmation: true,
    sponsorBudget: false,
  });
  const mppx = Mppx.create({
    methods: [method],
    secretKey: config.mppSecret,
    realm: new URL(config.origin).hostname,
    requiresAuth: true,
  });
  return async (
    request,
    { amountUnits, recipient, operation, description, meta, expires },
  ) => {
    const handler = mppx.charge({
      amount: display(amountUnits),
      recipient,
      externalId: operation,
      description,
      meta,
      expires: new Date(expires).toISOString(),
    });
    const result = await handler(request);
    if (result.status === 402)
      return { paid: false, response: result.challenge };
    const receipt = result.withReceipt(new Response(null, { status: 204 }));
    return {
      paid: true,
      receipt: receipt.headers.get("payment-receipt") || null,
    };
  };
}

async function expire(db) {
  const current = now(),
    holds = await db
      .prepare("SELECT * FROM payment_holds WHERE status='held' AND expires<=?")
      .bind(current)
      .all();
  for (const hold of holds.results) {
    await db.batch([
      db
        .prepare(
          "UPDATE payment_holds SET status='expired',updated=? WHERE id=? AND status='held'",
        )
        .bind(current, hold.id),
      db
        .prepare(
          "UPDATE bounties SET status='open',active_attempt=NULL,updated=? WHERE id=? AND active_attempt=?",
        )
        .bind(current, hold.bounty, "hold:" + hold.id),
    ]);
  }
  const bounties = await db
    .prepare(
      "SELECT * FROM bounties WHERE status='open' AND expires IS NOT NULL AND expires<=?",
    )
    .bind(current)
    .all();
  for (const bounty of bounties.results) {
    const owner = await payoutAddress(db, bounty.owner);
    await outgoing(
      db,
      "reward-refund",
      bounty.owner,
      bounty.id,
      bounty.reserve_units,
      owner,
    );
    await db
      .prepare(
        "UPDATE bounties SET status='expired',reserve_units='0',updated=? WHERE id=? AND status='open'",
      )
      .bind(current, bounty.id)
      .run();
  }
}

async function settleAttempt(db, attempt, row) {
  let result;
  try {
    const challenger = parse(attempt.blueprint),
      defender = parse(row.blueprint);
    result = {
      ...new Battle(
        unpackChallenge(challenger).machine,
        unpackChallenge(defender).machine,
        defender.a,
        attempt.seed,
        { mode: "auto", swapSpawns: !!(attempt.seed & 1) },
      ).run(),
      seed: attempt.seed,
    };
  } catch {
    result = null;
  }
  if (!result || ![-1, 0, 1].includes(result.winner)) {
    const recipient = await payoutAddress(db, attempt.account);
    await outgoing(
      db,
      "entry-refund",
      attempt.account,
      attempt.id,
      row.entry_units,
      recipient,
    );
    await db.batch([
      db
        .prepare(
          "UPDATE attempts SET status='refunded',error=?,updated=? WHERE id=?",
        )
        .bind(
          "Simulation unavailable; entry refund requested.",
          now(),
          attempt.id,
        ),
      db
        .prepare(
          "UPDATE bounties SET status='open',active_attempt=NULL,updated=? WHERE id=?",
        )
        .bind(now(), row.id),
    ]);
    return;
  }
  const quote = payoutQuote(
      row.reward_units,
      row.entry_units,
      row.platform_fee_bps ?? PLATFORM_FEE_BPS,
    ),
    win = result.winner === 0,
    receipt = {
      ...result,
      outcome: win ? "win" : result.winner === 1 ? "loss" : "draw",
      entry: display(row.entry_units),
      grossReward: win ? display(row.reward_units) : "0",
      reward: win ? quote.payout : "0",
      payout: win ? quote.payout : "0",
      platformFee: win ? quote.platformFee : "0",
      platformFeeBps: row.platform_fee_bps ?? PLATFORM_FEE_BPS,
      feePolicyVersion: quote.feePolicyVersion,
      net: win ? quote.netIfWin : "-" + display(row.entry_units),
      verifiedAt: now(),
    };
  if (win) {
    const recipient = await payoutAddress(db, attempt.account);
    await outgoing(
      db,
      "winner-payout",
      attempt.account,
      attempt.id,
      quote.payoutUnits,
      recipient,
    );
    await outgoing(
      db,
      "platform-fee",
      "platform",
      attempt.id,
      quote.platformFeeUnits,
      (await runtimeRecipient(row)).platformRecipient,
    );
    receipt.payoutStatus = "requested";
    await db.batch([
      db
        .prepare(
          "UPDATE attempts SET status='settled',result=?,updated=? WHERE id=?",
        )
        .bind(json(receipt), now(), attempt.id),
      db
        .prepare(
          "UPDATE bounties SET status='claimed',active_attempt=NULL,winner=?,reserve_units='0',updated=? WHERE id=?",
        )
        .bind(attempt.id, now(), row.id),
    ]);
    return;
  }
  await db.batch([
    db
      .prepare(
        "UPDATE attempts SET status='settled',result=?,updated=? WHERE id=?",
      )
      .bind(json(receipt), now(), attempt.id),
    db
      .prepare(
        "UPDATE bounties SET status='open',active_attempt=NULL,updated=? WHERE id=?",
      )
      .bind(now(), row.id),
  ]);
}

async function runtimeRecipient(row) {
  return {
    platformRecipient:
      row.platform_recipient || getAddress(PLATFORM_FEE_RECIPIENT),
  };
}

async function createBounty(db, request, auth, body, key, config) {
  requireOwner(auth);
  fields(body, [
    "title",
    "blueprint",
    "entry",
    "reward",
    "hours",
    "listed",
    "maxPlatformFeeBps",
  ]);
  const old = await prior(db, auth.account, key, "create", body);
  if (old)
    return {
      paid: true,
      value: await bountyView(db, await bountyRow(db, old), auth.account, true),
    };
  check(
    body.maxPlatformFeeBps === PLATFORM_FEE_BPS,
    "Acknowledge the 2.5% winning-reward platform fee with maxPlatformFeeBps: 250.",
    409,
  );
  integer(body.hours, 0, 8760, "Duration");
  check(typeof body.listed === "boolean", "Choose board visibility.");
  const entry = await amount(body.entry, "Entry", config),
    reward = await amount(body.reward, "Gross reward", config, {
      allowZero: false,
    }),
    blueprint = canonicalBlueprint(body.blueprint),
    title = text(body.title, 70, "bounty title"),
    count = await db
      .prepare(
        "SELECT COUNT(*) AS total FROM bounties WHERE owner=? AND status IN ('open','busy','funding')",
      )
      .bind(auth.account)
      .first(),
    reserves = await db
      .prepare(
        "SELECT reserve_units FROM bounties WHERE status IN ('open','busy') AND reserve_units IS NOT NULL",
      )
      .all();
  check(count.total < 20, "Close an existing bounty first.", 409);
  check(
    reserves.results.reduce(
      (total, row) => total + BigInt(row.reserve_units),
      0n,
    ) +
      reward <=
      config.maxOutstandingUnits,
    "Reward would exceed the configured escrow liability ceiling.",
    409,
  );
  const digest = await hex(json(body));
  let hold = await db
    .prepare(
      "SELECT * FROM payment_holds WHERE account=? AND request_key=? AND digest=? AND purpose='reward-funding' AND status='held' AND expires>?",
    )
    .bind(auth.account, key, digest, now())
    .first();
  if (!hold) {
    const bounty = id(),
      created = now(),
      expires = created + config.quoteTtlMs;
    await db
      .prepare(
        "INSERT INTO payment_holds (id,account,bounty,request_key,digest,body,amount_units,purpose,expires,status,provider_ref,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        bounty,
        auth.account,
        bounty,
        key,
        digest,
        json({
          title,
          blueprint,
          entry: String(entry),
          reward: String(reward),
          hours: body.hours,
          listed: body.listed,
        }),
        String(reward),
        "reward-funding",
        expires,
        "held",
        null,
        created,
        created,
      )
      .run();
    hold = await db
      .prepare("SELECT * FROM payment_holds WHERE id=?")
      .bind(bounty)
      .first();
  }
  const bounty = hold.bounty,
    created = hold.created,
    expires = hold.expires,
    payment = await gateway(db, config)(request, {
      amountUnits: hold.amount_units,
      recipient: config.escrowRecipient,
      operation: "reward:" + bounty,
      description: "Fund War Machines bounty reward",
      meta: { kind: "reward-funding", bounty },
      expires,
    });
  if (!payment.paid) return { paid: false, response: payment.response };
  await recordFinancial(db, {
    kind: "reward-funded",
    account: auth.account,
    ref: bounty,
    amountUnits: hold.amount_units,
    recipient: config.escrowRecipient,
    status: "confirmed",
    providerRef: payment.receipt,
  });
  try {
    await db.batch([
      db
        .prepare(
          "INSERT INTO bounties (id,owner,title,blueprint,entry,reward,status,listed,expires,active_attempt,winner,created,updated,entry_units,reward_units,reserve_units,platform_fee_bps,fee_policy_version,platform_recipient) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          bounty,
          auth.account,
          title,
          json(blueprint),
          0,
          0,
          "open",
          body.listed ? 1 : 0,
          body.hours ? created + body.hours * 3600000 : null,
          null,
          null,
          created,
          now(),
          String(entry),
          String(reward),
          String(reward),
          PLATFORM_FEE_BPS,
          "pathusd-mainnet-v1",
          config.platformRecipient,
        ),
      db
        .prepare(
          "UPDATE payment_holds SET status='accepted',provider_ref=?,updated=? WHERE id=?",
        )
        .bind(payment.receipt, now(), bounty),
      db
        .prepare(
          "INSERT INTO idempotency (account,key,kind,digest,ref,created) VALUES (?,?,?,?,?,?)",
        )
        .bind(
          auth.account,
          key,
          "create",
          await hex(json(body)),
          bounty,
          now(),
        ),
    ]);
  } catch (error) {
    const refund = await payoutAddress(db, auth.account);
    await outgoing(db, "reward-refund", auth.account, bounty, reward, refund);
    await db
      .prepare(
        "UPDATE payment_holds SET status='refund-required',updated=? WHERE id=?",
      )
      .bind(now(), bounty)
      .run();
    throw error;
  }
  return {
    paid: true,
    value: await bountyView(
      db,
      await bountyRow(db, bounty),
      auth.account,
      true,
    ),
    receipt: payment.receipt,
  };
}

async function enterBounty(db, request, auth, bountyId, body, key, config) {
  requireOwner(auth);
  fields(body, ["blueprint", "maxEntry", "maxPlatformFeeBps"]);
  const previous = await prior(
    db,
    auth.account,
    key,
    "enter:" + bountyId,
    body,
  );
  if (previous)
    return { paid: true, value: await attemptView(db, previous, auth.account) };
  const row = await bountyRow(db, bountyId);
  check(
    auth.account !== row.owner,
    "You can practice against your own bounty, but cannot claim it.",
    403,
  );
  check(
    row.status === "open",
    "This bounty is busy or closed. No payment was accepted.",
    409,
  );
  check(!row.expires || row.expires > now(), "This bounty has expired.", 409);
  const maxEntry = await amount(body.maxEntry, "Maximum entry", config),
    entry = BigInt(row.entry_units);
  check(maxEntry >= entry, "Entry exceeds your quoted maximum.", 409);
  check(
    body.maxPlatformFeeBps >= row.platform_fee_bps &&
      body.maxPlatformFeeBps <= 10000,
    "Platform fee exceeds your accepted maximum.",
    409,
  );
  const blueprint = canonicalBlueprint(body.blueprint, parse(row.blueprint)),
    me = await account(db, auth.account);
  if (me.entryCap !== null)
    check(
      pathUsdToUnits(me.entryCap) >= entry,
      "Entry exceeds your per-attempt spending cap.",
      409,
    );
  if (me.dailyCap !== null)
    check(
      pathUsdToUnits(me.spentToday) + entry <= pathUsdToUnits(me.dailyCap),
      "Your daily entry budget is exhausted.",
      409,
    );
  const digest = await hex(json(body)),
    existing = await db
      .prepare(
        "SELECT * FROM payment_holds WHERE account=? AND bounty=? AND request_key=? AND digest=? AND status='held' AND expires>?",
      )
      .bind(auth.account, bountyId, key, digest, now())
      .first();
  let hold = existing;
  if (!hold) {
    const holdId = id(),
      expires = now() + config.quoteTtlMs,
      locked = await db
        .prepare(
          "UPDATE bounties SET status='busy',active_attempt=?,updated=? WHERE id=? AND status='open'",
        )
        .bind("hold:" + holdId, now(), bountyId)
        .run();
    check(
      locked.meta.changes === 1,
      "Another challenger entered first. No payment was accepted.",
      409,
    );
    try {
      await db
        .prepare(
          "INSERT INTO payment_holds (id,account,bounty,request_key,digest,body,amount_units,purpose,expires,status,provider_ref,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          holdId,
          auth.account,
          bountyId,
          key,
          digest,
          json({ blueprint }),
          String(entry),
          "entry",
          expires,
          "held",
          null,
          now(),
          now(),
        )
        .run();
      hold = await db
        .prepare("SELECT * FROM payment_holds WHERE id=?")
        .bind(holdId)
        .first();
    } catch (error) {
      await db
        .prepare(
          "UPDATE bounties SET status='open',active_attempt=NULL,updated=? WHERE id=? AND active_attempt=?",
        )
        .bind(now(), bountyId, "hold:" + holdId)
        .run();
      throw error;
    }
  }
  const payment = await gateway(db, config)(request, {
    amountUnits: entry,
    recipient: config.entryRecipient,
    operation: "entry:" + hold.id,
    description: "Enter War Machines bounty",
    meta: { kind: "entry", bounty: bountyId, hold: hold.id },
    expires: hold.expires,
  });
  if (!payment.paid) return { paid: false, response: payment.response };
  await recordFinancial(db, {
    kind: "entry-paid",
    account: auth.account,
    ref: hold.id,
    amountUnits: entry,
    recipient: config.entryRecipient,
    status: "confirmed",
    providerRef: payment.receipt,
  });
  const seedBytes = new Uint32Array(1);
  crypto.getRandomValues(seedBytes);
  const attempt = id();
  try {
    await db.batch([
      db
        .prepare(
          "INSERT INTO attempts (id,bounty,account,blueprint,seed,status,result,error,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          attempt,
          bountyId,
          auth.account,
          json(blueprint),
          seedBytes[0],
          "running",
          null,
          null,
          now(),
          now(),
        ),
      db
        .prepare(
          "UPDATE payment_holds SET status='accepted',provider_ref=?,updated=? WHERE id=?",
        )
        .bind(payment.receipt, now(), hold.id),
      db
        .prepare(
          "UPDATE bounties SET active_attempt=?,updated=? WHERE id=? AND active_attempt=?",
        )
        .bind(attempt, now(), bountyId, "hold:" + hold.id),
      db
        .prepare(
          "INSERT INTO idempotency (account,key,kind,digest,ref,created) VALUES (?,?,?,?,?,?)",
        )
        .bind(auth.account, key, "enter:" + bountyId, digest, attempt, now()),
    ]);
  } catch (error) {
    const recipient = await payoutAddress(db, auth.account);
    await outgoing(db, "entry-refund", auth.account, hold.id, entry, recipient);
    await db.batch([
      db
        .prepare(
          "UPDATE payment_holds SET status='refund-required',updated=? WHERE id=?",
        )
        .bind(now(), hold.id),
      db
        .prepare(
          "UPDATE bounties SET status='open',active_attempt=NULL,updated=? WHERE id=?",
        )
        .bind(now(), bountyId),
    ]);
    throw error;
  }
  await settleAttempt(
    db,
    {
      id: attempt,
      account: auth.account,
      blueprint: json(blueprint),
      seed: seedBytes[0],
    },
    row,
  );
  return {
    paid: true,
    value: await attemptView(db, attempt, auth.account),
    receipt: payment.receipt,
  };
}

async function attemptView(db, attemptId, viewer) {
  const attempt = await db
    .prepare("SELECT * FROM attempts WHERE id=?")
    .bind(attemptId)
    .first();
  check(attempt, "Attempt not found.", 404);
  const bounty = await bountyRow(db, attempt.bounty),
    challenger = viewer === attempt.account,
    creator = viewer === bounty.owner,
    done = ["settled", "refunded"].includes(attempt.status);
  check(
    challenger || creator,
    "Only the bounty creator and paid challenger can inspect this attempt.",
    403,
  );
  const value = {
    id: attempt.id,
    bounty: attempt.bounty,
    account: attempt.account,
    economics: payoutQuote(
      bounty.reward_units,
      bounty.entry_units,
      bounty.platform_fee_bps ?? PLATFORM_FEE_BPS,
    ),
    status: attempt.status,
    created: attempt.created,
    updated: attempt.updated,
    result: attempt.result ? parse(attempt.result) : null,
    error: attempt.error,
    bountyTitle: bounty.title,
    escrowAttemptDeadline: challenger
      ? Number(bounty.escrow_attempt_deadline || 0)
      : null,
  };
  if (challenger && attempt.status === "engineering") {
    const deadline = Number(attempt.build_deadline || 0);
    value.defender = parse(bounty.blueprint);
    value.build = {
      deadline,
      remainingSeconds: Math.max(0, Math.ceil((deadline - now()) / 1000)),
      requestedSeconds: Number(attempt.build_requested_seconds || 0),
      settlementDeadline: Number(bounty.escrow_attempt_deadline || 0),
    };
  }
  const counterBlueprint = attempt.blueprint ? parse(attempt.blueprint) : null;
  if (
    counterBlueprint &&
    (done ||
      ["awaiting-signatures", "ready-to-settle"].includes(attempt.status)) &&
    (challenger || creator)
  )
    value.replay = {
      challenger: counterBlueprint,
      defender: parse(bounty.blueprint),
      arena: parse(bounty.blueprint).a,
      seed: attempt.seed,
      swapSpawns: !!(attempt.seed & 1),
      versions: { hash: CLIENT_ENGINE_HASH },
    };
  if (attempt.settlement_payload) {
    const payload = parse(attempt.settlement_payload);
    value.escrowSettlement = {
      bountyId: payload.bountyId,
      attemptNonce: payload.attemptNonce,
      outcome: payload.outcome,
      resultHash: payload.resultHash,
      validUntil: payload.validUntil,
      signatures: payload.signatures || [],
      state: attempt.status,
      transactionHash: attempt.escrow_settlement_tx || null,
    };
  }
  return value;
}

async function lockedBountyBlueprint(db, bountyId, viewer) {
  const bounty = await bountyRow(db, bountyId);
  check(
    await canRevealDefender(db, bounty, viewer),
    "Enter this bounty before inspecting its defender blueprint.",
    403,
  );
  return parse(bounty.blueprint);
}

async function inspection(db, body, viewer) {
  fields(body, ["blueprint", "machine", "arena", "rules", "bountyId"]);
  check(
    !!body.blueprint !== !!body.machine,
    "Supply either blueprint or machine.",
  );
  const locked = body.bountyId
    ? await lockedBountyBlueprint(db, body.bountyId, viewer)
    : null;
  let packed;
  if (body.machine) {
    fields(body.machine, [
      "name",
      "paint",
      "accent",
      "glow",
      "pattern",
      "number",
      "finish",
      "front",
      "modules",
      "tactic",
      "target",
      "range",
      "stance",
    ]);
    check(
      Array.isArray(body.machine.modules) &&
        body.machine.modules.length <= MAX_MODULES,
      "Supply at most 243 modules.",
    );
    for (const module of body.machine.modules)
      check(
        PARTS.some((part) => part.id === module.id),
        "Unknown part ID.",
      );
    packed = packChallenge(
      { ...clone(PRESETS[0]), ...body.machine },
      locked?.a || body.arena || "foundry",
      0,
      locked?.q || normalizeRules(body.rules || DEFAULT_RULES),
    );
  } else packed = canonicalBlueprint(body.blueprint, locked);
  const challenge = unpackChallenge(packed, true),
    s = stats(challenge.machine),
    issues = validate(challenge.machine, challenge.rules),
    arena = ARENAS.find((item) => item.id === challenge.arena),
    environment = [...new Set(arena.terrain.map((item) => item.type))].map(
      (type) => {
        const terrain = arena.terrain.find((item) => item.type === type),
          surface = terrainAt(
            arena,
            terrain.x + terrain.w / 2,
            terrain.y + terrain.h / 2,
            9,
          ),
          profile = environmentProfile(s, arena, surface);
        return {
          type,
          speed: s.speed * arena.friction * profile.traction,
          grip: profile.grip,
          generation: s.power * profile.power,
          cooling: s.cooling * profile.cooling,
          ambientHeat: profile.heat,
          environmentDrain: profile.drain,
        };
      },
    );
  return {
    valid: !issues.length,
    issues,
    stats: s,
    rules: challenge.rules,
    arena: challenge.arena,
    blueprint: packChallenge(
      challenge.machine,
      challenge.arena,
      0,
      challenge.rules,
    ),
    machine: challenge.machine,
    environment,
    advice: engineeringReport(
      challenge.machine,
      challenge.rules,
      challenge.arena,
    ),
    versions: { hash: CLIENT_ENGINE_HASH },
  };
}
async function practice(db, body, viewer) {
  fields(body, ["challenger", "defender", "bountyId", "seed"]);
  check(
    !!body.defender !== !!body.bountyId,
    "Supply a defender blueprint for practice.",
  );
  const locked = body.bountyId
      ? await lockedBountyBlueprint(db, body.bountyId, viewer)
      : null,
    challenger = canonicalBlueprint(body.challenger, locked),
    defender = locked || canonicalBlueprint(body.defender),
    seed = body.seed ?? 42;
  integer(seed, 0, 4294967295, "Seed");
  const a = unpackChallenge(challenger),
    b = unpackChallenge(defender),
    result = {
      ...new Battle(a.machine, b.machine, b.arena, seed, {
        mode: "auto",
        swapSpawns: !!(seed & 1),
      }).run(),
      seed,
    };
  return {
    kind: "practice",
    official: false,
    creditsChanged: 0,
    versions: { hash: CLIENT_ENGINE_HASH },
    result,
  };
}

async function signInChallenge(db, body, origin) {
  fields(body, ["chainId"]);
  check(
    body.chainId === TEMPO_MAINNET_CHAIN_ID,
    "Use Tempo mainnet (chain 4217).",
    400,
  );
  const nonce = randomSecret(),
    created = now(),
    expires = created + 5 * 60 * 1000,
    message = `War Machines Tempo sign-in\nDomain: ${new URL(origin).host}\nURI: ${origin}\nChain ID: ${TEMPO_MAINNET_CHAIN_ID}\nNonce: ${nonce}\nIssued At: ${new Date(created).toISOString()}\nExpiration Time: ${new Date(expires).toISOString()}`;
  await db
    .prepare(
      "INSERT INTO wallet_challenges (id,message_hash,expires,used,created) VALUES (?,?,?,?,?)",
    )
    .bind(id(), await hex(message), expires, 0, created)
    .run();
  return { message };
}
async function verifyWallet(db, body, config) {
  fields(body, ["address", "message", "signature"]);
  const message = signInMessage(body.message),
    signature = body.signature;
  check(
    typeof signature === "string" &&
      /^0x[0-9a-fA-F]+$/.test(signature) &&
      signature.length <= 20_000,
    "Invalid wallet signature.",
    400,
  );
  const challenge = await db
    .prepare(
      "SELECT * FROM wallet_challenges WHERE message_hash=? AND expires>? AND used=0",
    )
    .bind(await hex(message), now())
    .first();
  check(
    challenge,
    "This sign-in challenge expired. Connect your wallet again.",
    401,
  );
  let address;
  try {
    address = getAddress(body.address);
    // Tempo Wallet may produce a WebAuthn/P256 signature envelope instead of a
    // 65-byte ECDSA signature. Tempo's viem client verifies both formats and,
    // for keychain accounts, also checks the active on-chain authorization.
    const verified =
      signature.length === 132
        ? getAddress(await recoverMessageAddress({ message, signature })) ===
          address
        : await createClient({ transport: http(config.rpcUrl) }).verifyMessage({
            address,
            message,
            signature,
          });
    check(
      verified,
      "Wallet signature does not match the selected address.",
      401,
    );
  } catch (error) {
    if (error.status) throw error;
    fail(401, "Wallet signature could not be verified.");
  }
  const used = await db
    .prepare("UPDATE wallet_challenges SET used=1 WHERE id=? AND used=0")
    .bind(challenge.id)
    .run();
  check(
    used.meta.changes === 1,
    "This sign-in challenge was already used.",
    409,
  );
  let identity = await db
      .prepare(
        "SELECT account FROM identities WHERE scheme='tempo' AND chain=? AND address=?",
      )
      .bind(String(TEMPO_MAINNET_CHAIN_ID), address)
      .first(),
    accountId = identity?.account;
  if (!accountId) {
    accountId = id();
    await db.batch([
      db
        .prepare(
          "INSERT INTO accounts (id,token_hash,name,balance,entry_cap,daily_cap,created,payout_address,entry_cap_units,daily_cap_units) VALUES (?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          accountId,
          "wallet:" + accountId,
          "Tempo engineer",
          0,
          null,
          null,
          now(),
          address,
          null,
          null,
        ),
      db
        .prepare(
          "INSERT INTO identities (scheme,chain,address,account,created) VALUES ('tempo',?,?,?,?)",
        )
        .bind(String(TEMPO_MAINNET_CHAIN_ID), address, accountId, now()),
    ]);
  } else
    await db
      .prepare("UPDATE accounts SET payout_address=? WHERE id=?")
      .bind(address, accountId)
      .run();
  const token = randomSecret(),
    expires = now() + 30 * 24 * 60 * 60 * 1000;
  await db
    .prepare(
      "INSERT INTO sessions (id,token_hash,account,expires,created) VALUES (?,?,?,?,?)",
    )
    .bind(id(), await hex(token), accountId, expires, now())
    .run();
  return {
    me: await account(db, accountId),
    headers: {
      "set-cookie": `wm_session=${token}; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`,
    },
  };
}

async function reconcile(db, config) {
  try {
    const client = createClient({
        account: config.signer,
        feeToken: config.token,
        transport: http(config.rpcUrl),
      }),
      submitted = await db
        .prepare(
          "SELECT * FROM financial_operations WHERE status='submitted' ORDER BY updated ASC LIMIT 4",
        )
        .all();
    for (const operation of submitted.results) {
      try {
        const receipt = await client.getTransactionReceipt({
          hash: operation.provider_ref,
        });
        if (receipt.status === "success")
          await db
            .prepare(
              "UPDATE financial_operations SET status='confirmed',updated=? WHERE id=?",
            )
            .bind(now(), operation.id)
            .run();
        else
          await db
            .prepare(
              "UPDATE financial_operations SET status='failed-needs-reconciliation',updated=? WHERE id=?",
            )
            .bind(now(), operation.id)
            .run();
      } catch {}
    }
    const outstanding = await db
      .prepare(
        "SELECT amount_units FROM financial_operations WHERE status IN ('requested','sending','submitted')",
      )
      .all();
    if (
      outstanding.results.reduce(
        (total, row) => total + BigInt(row.amount_units),
        0n,
      ) > config.maxOutstandingUnits
    ) {
      console.error(
        "War Machines payout queue paused: outstanding liability ceiling reached.",
      );
      return;
    }
    const operation = await db
      .prepare(
        "SELECT * FROM financial_operations f WHERE f.status='requested' AND (f.kind!='platform-fee' OR EXISTS (SELECT 1 FROM financial_operations winner WHERE winner.kind='winner-payout' AND winner.ref=f.ref AND winner.status='confirmed')) ORDER BY f.created ASC LIMIT 1",
      )
      .first();
    if (!operation) return;
    const acquired = await db
      .prepare(
        "UPDATE financial_operations SET status='sending',updated=? WHERE id=? AND status='requested'",
      )
      .bind(now(), operation.id)
      .run();
    if (acquired.meta.changes !== 1) return;
    try {
      const tx = await client.token.transfer({
        token: config.token,
        to: operation.recipient,
        amount: BigInt(operation.amount_units),
      });
      await db
        .prepare(
          "UPDATE financial_operations SET status='submitted',provider_ref=?,updated=? WHERE id=?",
        )
        .bind(tx, now(), operation.id)
        .run();
    } catch {
      await db
        .prepare(
          "UPDATE financial_operations SET status='failed-needs-reconciliation',updated=? WHERE id=?",
        )
        .bind(now(), operation.id)
        .run();
    }
  } catch (error) {
    console.error("War Machines payout reconciliation:", error);
  }
}

// Direct escrow adapter -----------------------------------------------------
// The Worker only creates immutable game-term intents and checks receipts. It
// never signs token transfers, receives funds or controls a payout key.
const TOKEN_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
]);
const ESCROW_ABI = parseAbi([
  "function approve(address spender,uint256 amount) returns (bool)",
  "function createBounty(bytes32 termsHash,uint128 reward,uint128 entry,uint64 expiresAt) returns (uint256)",
  "function enterBounty(uint256 bountyId)",
  "function cancelBounty(uint256 bountyId)",
  "function forfeitTimedOutAttempt(uint256 bountyId)",
  "function expireBounty(uint256 bountyId)",
  "function settleAttempt((uint256 bountyId,uint64 attemptNonce,uint8 outcome,bytes32 resultHash,uint64 validUntil) settlement,bytes[] signatures)",
]);
const ESCROW_EVENTS = {
  created: "0x8efb9ae6fa203b97084e8481d1a346804fe0b74f6771b412acbb06080d3fc60b",
  entered: "0xe1c145c9979da15902ab996aa4dc96efd960b46a04ce9a3516a8b76affc85395",
  cancelled:
    "0x329fa6d5d5547698be130ca491e4fc9476ab88b3c2a44f412d1670585daeadf3",
  expired: "0x273c6c1aa010a64004ccb6c3b3b61101d59f480e439e06b20d471260dc6071dd",
  timedOut:
    "0xb92806ef23ff7f73544c7018ae5c0c865c4103b6c6a9a497430e6e8961763298",
  settled: "0xf1bd0b9955d3af8c0f3ef37ea58ba05a0df5b81798cb73c84f62c093fa013e66",
};
const ESCROW_SETTLEMENT_SIGNERS = [
  "0x39Af67Ee9700C62aAa5d87cCc34F937c47e6150a",
  "0x9fD9719d8DE2f92F49a00068dFEA59006f6FD902",
].map(getAddress);
const ESCROW_SETTLEMENT_TYPES = {
  Settlement: [
    { name: "bountyId", type: "uint256" },
    { name: "attemptNonce", type: "uint64" },
    { name: "outcome", type: "uint8" },
    { name: "resultHash", type: "bytes32" },
    { name: "validUntil", type: "uint64" },
  ],
};
const SECP256K1N_HALF =
  0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;
const word = (value, index = 0) => {
  const raw = String(value || "0x").replace(/^0x/, "");
  return BigInt("0x" + raw.slice(index * 64, index * 64 + 64));
};
const bytesWord = (value, index = 0) =>
  "0x" +
  String(value || "0x")
    .replace(/^0x/, "")
    .slice(index * 64, index * 64 + 64);
const topicAddress = (value) =>
  getAddress("0x" + String(value).replace(/^0x/, "").slice(-40));
const validHash = (value) =>
  typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
const validSignature = (value) =>
  typeof value === "string" &&
  /^0x[0-9a-fA-F]{130}$/.test(value) &&
  ["1b", "1c"].includes(value.slice(-2).toLowerCase()) &&
  BigInt("0x" + value.slice(66, 130)) <= SECP256K1N_HALF;
const directPlan = (config, call, approvalUnits = 0n) => ({
  chainId: config.chainId,
  token: config.token,
  escrow: config.escrowAddress,
  approval:
    approvalUnits > 0n
      ? {
          to: config.token,
          data: encodeFunctionData({
            abi: ESCROW_ABI,
            functionName: "approve",
            args: [config.escrowAddress, approvalUnits],
          }),
          amount: approvalUnits.toString(),
        }
      : null,
  call: { to: config.escrowAddress, data: call },
});
const settlementMessage = (payload) => ({
  bountyId: BigInt(payload.bountyId),
  attemptNonce: BigInt(payload.attemptNonce),
  outcome: Number(payload.outcome),
  resultHash: payload.resultHash,
  validUntil: BigInt(payload.validUntil),
});
const settlementTypedData = (config, payload) => ({
  domain: {
    name: "War Machines Bounty Escrow",
    version: "2",
    chainId: config.chainId,
    verifyingContract: config.escrowAddress,
  },
  types: ESCROW_SETTLEMENT_TYPES,
  primaryType: "Settlement",
  message: settlementMessage(payload),
});
async function rpc(config, method, params) {
  const reply = await fetch(config.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: json({ jsonrpc: "2.0", id: 1, method, params }),
  });
  check(
    reply.ok,
    "Tempo RPC is unavailable. Retry without sending a different transaction.",
    503,
  );
  const value = await reply.json();
  check(
    !value.error,
    value.error?.message || "Tempo RPC rejected the request.",
    502,
  );
  return value.result;
}
async function pathUsdBalance(config, address) {
  const data = encodeFunctionData({
    abi: TOKEN_ABI,
    functionName: "balanceOf",
    args: [getAddress(address)],
  });
  const result = await rpc(config, "eth_call", [
    { to: config.token, data },
    "latest",
  ]);
  try {
    return display(BigInt(result));
  } catch {
    fail(502, "Tempo RPC returned an invalid pathUSD balance.");
  }
}
async function receipt(config, hash) {
  check(validHash(hash), "Transaction hash is invalid.");
  const value = await rpc(config, "eth_getTransactionReceipt", [hash]);
  check(
    value,
    "The wallet transaction is not confirmed yet. Retry this confirmation with the same transaction hash.",
    409,
  );
  check(
    value.status === "0x1",
    "The wallet transaction reverted; no bounty funds were accepted.",
    409,
  );
  return value;
}
function eventLog(receiptValue, config, topic) {
  const found = (receiptValue.logs || []).find(
    (log) =>
      String(log.address).toLowerCase() ===
        config.escrowAddress.toLowerCase() &&
      String(log.topics?.[0] || "").toLowerCase() === topic,
  );
  check(
    found,
    "Confirmed transaction did not emit the expected escrow event.",
    409,
  );
  return found;
}
function boundedUnits(value, allowZero = false) {
  try {
    return pathUsdToUnits(value, {
      allowZero,
      maxUnits: 1_000_000_000_000_000n,
    });
  } catch (error) {
    fail(400, error.message);
  }
}
async function directCreateIntent(db, auth, body, key, config) {
  requireOwner(auth);
  check(config.acceptingNewBounties, config.settlementReason, 503);
  fields(body, [
    "title",
    "blueprint",
    "entry",
    "reward",
    "hours",
    "listed",
    "maxPlatformFeeBps",
  ]);
  validKey(key);
  check(
    body.maxPlatformFeeBps === PLATFORM_FEE_BPS,
    "Acknowledge the 2.5% winning-reward platform fee with maxPlatformFeeBps: 250.",
    409,
  );
  integer(body.hours, 0, 8760, "Duration");
  check(typeof body.listed === "boolean", "Choose board visibility.");
  const entry = boundedUnits(body.entry),
    reward = boundedUnits(body.reward),
    blueprint = canonicalBlueprint(body.blueprint),
    title = text(body.title, 70, "bounty title"),
    accountAddress = await payoutAddress(db, auth.account),
    digest = await hex(json(body));
  let hold = await db
    .prepare(
      "SELECT * FROM payment_holds WHERE account=? AND request_key=? AND purpose='direct-create' ORDER BY created DESC LIMIT 1",
    )
    .bind(auth.account, key)
    .first();
  if (hold) {
    check(
      hold.digest === digest,
      "That idempotency key was used for a different request.",
      409,
    );
    if (hold.status === "accepted")
      return {
        final: true,
        value: await bountyView(
          db,
          await bountyRow(db, hold.bounty),
          auth.account,
          true,
        ),
      };
    return directPlanFromCreate(config, hold);
  }
  const count = await db
    .prepare(
      "SELECT COUNT(*) AS total FROM bounties WHERE owner=? AND status IN ('open','busy')",
    )
    .bind(auth.account)
    .first();
  check(count.total < 20, "Close an existing bounty first.", 409);
  const bounty = id(),
    created = now(),
    expiresAt = body.hours
      ? Math.floor((created + body.hours * 3600000) / 1000)
      : 0,
    expires = expiresAt ? expiresAt * 1000 : null,
    terms = {
      version: "war-machines-direct-escrow-v2",
      engineHash: CLIENT_ENGINE_HASH,
      creator: accountAddress,
      title,
      defender: blueprint,
      entry: entry.toString(),
      reward: reward.toString(),
      expiresAt,
      listed: body.listed,
      platformFeeBps: PLATFORM_FEE_BPS,
    };
  const termsHash = "0x" + (await hex(json(terms)));
  await db
    .prepare(
      "INSERT INTO payment_holds (id,account,bounty,request_key,digest,body,amount_units,purpose,expires,status,provider_ref,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      id(),
      auth.account,
      bounty,
      key,
      digest,
      json({
        title,
        blueprint,
        entry: entry.toString(),
        reward: reward.toString(),
        listed: body.listed,
        expires,
        expiresAt,
        termsHash,
        creator: accountAddress,
      }),
      reward.toString(),
      "direct-create",
      created + 24 * 60 * 60 * 1000,
      "awaiting-onchain",
      null,
      created,
      created,
    )
    .run();
  hold = await db
    .prepare(
      "SELECT * FROM payment_holds WHERE account=? AND request_key=? AND purpose='direct-create' ORDER BY created DESC LIMIT 1",
    )
    .bind(auth.account, key)
    .first();
  return directPlanFromCreate(config, hold);
}
function directPlanFromCreate(config, hold) {
  const value = parse(hold.body),
    reward = BigInt(value.reward),
    entry = BigInt(value.entry),
    call = encodeFunctionData({
      abi: ESCROW_ABI,
      functionName: "createBounty",
      args: [value.termsHash, reward, entry, BigInt(value.expiresAt)],
    });
  return {
    direct: true,
    intentId: hold.id,
    kind: "create-bounty",
    termsHash: value.termsHash,
    expiresAt: value.expiresAt,
    plan: directPlan(config, call, reward),
  };
}
async function directEntryIntent(db, auth, bountyId, body, key, config) {
  requireOwner(auth);
  check(config.acceptingNewBounties, config.settlementReason, 503);
  fields(body, ["maxEntry", "maxPlatformFeeBps"]);
  validKey(key);
  const row = await bountyRow(db, bountyId);
  check(
    row.status === "open",
    "This bounty is busy or closed. No wallet transaction was prepared.",
    409,
  );
  check(
    row.escrow_bounty_id,
    "This legacy bounty is not backed by the direct escrow.",
    409,
  );
  check(auth.account !== row.owner, "You cannot enter your own bounty.", 403);
  check(!row.expires || row.expires > now(), "This bounty has expired.", 409);
  const entry = BigInt(row.entry_units),
    maximum = boundedUnits(body.maxEntry);
  check(maximum >= entry, "Entry exceeds your quoted maximum.", 409);
  check(
    body.maxPlatformFeeBps >= row.platform_fee_bps &&
      body.maxPlatformFeeBps <= 10000,
    "Platform fee exceeds your accepted maximum.",
    409,
  );
  const digest = await hex(json(body));
  let hold = await db
    .prepare(
      "SELECT * FROM payment_holds WHERE account=? AND bounty=? AND request_key=? AND purpose='direct-entry' ORDER BY created DESC LIMIT 1",
    )
    .bind(auth.account, bountyId, key)
    .first();
  if (hold) {
    check(
      hold.digest === digest,
      "That idempotency key was used for a different request.",
      409,
    );
    if (hold.status === "accepted")
      return {
        final: true,
        value: await attemptView(db, hold.provider_ref, auth.account),
      };
    return directPlanFromEntry(config, hold, row);
  }
  const created = now();
  await db
    .prepare(
      "INSERT INTO payment_holds (id,account,bounty,request_key,digest,body,amount_units,purpose,expires,status,provider_ref,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      id(),
      auth.account,
      bountyId,
      key,
      digest,
      json({ escrowBountyId: row.escrow_bounty_id }),
      entry.toString(),
      "direct-entry",
      created + 24 * 60 * 60 * 1000,
      "awaiting-onchain",
      null,
      created,
      created,
    )
    .run();
  hold = await db
    .prepare(
      "SELECT * FROM payment_holds WHERE account=? AND bounty=? AND request_key=? AND purpose='direct-entry' ORDER BY created DESC LIMIT 1",
    )
    .bind(auth.account, bountyId, key)
    .first();
  return directPlanFromEntry(config, hold, row);
}
function directPlanFromEntry(config, hold, row) {
  const call = encodeFunctionData({
    abi: ESCROW_ABI,
    functionName: "enterBounty",
    args: [BigInt(row.escrow_bounty_id)],
  });
  return {
    direct: true,
    intentId: hold.id,
    kind: "enter-bounty",
    bounty: row.id,
    plan: directPlan(config, call, BigInt(hold.amount_units)),
  };
}
async function confirmDirectIntent(db, auth, intentId, hash, config) {
  requireOwner(auth);
  const hold = await db
    .prepare(
      "SELECT * FROM payment_holds WHERE id=? AND account=? AND purpose IN ('direct-create','direct-entry')",
    )
    .bind(intentId, auth.account)
    .first();
  check(hold, "Direct escrow intent not found.", 404);
  if (hold.status === "accepted") {
    return hold.purpose === "direct-create"
      ? {
          kind: "bounty",
          value: await bountyView(
            db,
            await bountyRow(db, hold.bounty),
            auth.account,
            true,
          ),
        }
      : {
          kind: "attempt",
          value: await attemptView(db, hold.provider_ref, auth.account),
        };
  }
  check(
    hold.status === "awaiting-onchain",
    "This escrow intent cannot be confirmed.",
    409,
  );
  const receiptValue = await receipt(config, hash),
    saved = parse(hold.body),
    creator = await payoutAddress(db, auth.account);
  if (hold.purpose === "direct-create") {
    const log = eventLog(receiptValue, config, ESCROW_EVENTS.created);
    check(log.topics?.length === 3, "Escrow create event is malformed.", 409);
    check(
      topicAddress(log.topics[2]) === getAddress(saved.creator),
      "The creating wallet does not match this bounty intent.",
      403,
    );
    check(
      word(log.data, 0) === BigInt(saved.reward) &&
        word(log.data, 1) === BigInt(saved.entry) &&
        word(log.data, 2) === BigInt(saved.expiresAt) &&
        bytesWord(log.data, 3).toLowerCase() === saved.termsHash.toLowerCase(),
      "Escrow create event does not match these immutable bounty terms.",
      409,
    );
    const escrowBountyId = BigInt(log.topics[1]).toString(),
      created = now();
    await db.batch([
      db
        .prepare(
          "INSERT INTO bounties (id,owner,title,blueprint,entry,reward,status,listed,expires,active_attempt,winner,created,updated,entry_units,reward_units,reserve_units,platform_fee_bps,fee_policy_version,platform_recipient,escrow_bounty_id,terms_hash,escrow_create_tx) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          hold.bounty,
          auth.account,
          saved.title,
          json(saved.blueprint),
          0,
          0,
          "open",
          saved.listed ? 1 : 0,
          saved.expires,
          null,
          null,
          created,
          created,
          saved.entry,
          saved.reward,
          saved.reward,
          PLATFORM_FEE_BPS,
          "pathusd-direct-escrow-v2",
          PLATFORM_FEE_RECIPIENT,
          escrowBountyId,
          saved.termsHash,
          hash,
        ),
      db
        .prepare(
          "UPDATE payment_holds SET status='accepted',provider_ref=?,updated=? WHERE id=? AND status='awaiting-onchain'",
        )
        .bind(hash, created, hold.id),
      db
        .prepare(
          "INSERT INTO idempotency (account,key,kind,digest,ref,created) VALUES (?,?,?,?,?,?)",
        )
        .bind(
          auth.account,
          hold.request_key,
          "create",
          hold.digest,
          hold.bounty,
          created,
        ),
    ]);
    return {
      kind: "bounty",
      value: await bountyView(
        db,
        await bountyRow(db, hold.bounty),
        auth.account,
        true,
      ),
    };
  }
  const row = await bountyRow(db, hold.bounty),
    log = eventLog(receiptValue, config, ESCROW_EVENTS.entered);
  check(log.topics?.length === 4, "Escrow entry event is malformed.", 409);
  check(
    BigInt(log.topics[1]).toString() === row.escrow_bounty_id,
    "Entry transaction targets a different bounty.",
    409,
  );
  check(
    topicAddress(log.topics[3]) === getAddress(creator),
    "The entering wallet does not match this attempt intent.",
    403,
  );
  const nonce = word(log.topics[2]).toString(),
    deadline = word(log.data, 0),
    seedBytes = new Uint32Array(1);
  crypto.getRandomValues(seedBytes);
  const attempt = id(),
    updated = now(),
    requestedSeconds = requestedBuildSeconds(parse(row.blueprint)),
    escrowDeadline = Number(deadline) * 1000,
    buildDeadline = Math.min(
      updated + requestedSeconds * 1000,
      escrowDeadline - SETTLEMENT_RESERVE_SECONDS * 1000,
    );
  check(
    buildDeadline >= updated + 150 * 1000,
    "The escrow confirmation left too little build time. Do not deploy a counter; the immutable timeout path will finalize the entry to the bounty creator.",
    409,
  );
  await db.batch([
    db
      .prepare(
        "INSERT INTO attempts (id,bounty,account,blueprint,seed,status,result,error,created,updated,escrow_entry_tx,settlement_payload,build_deadline,build_requested_seconds) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        attempt,
        row.id,
        auth.account,
        json(null),
        seedBytes[0],
        "engineering",
        null,
        null,
        updated,
        updated,
        hash,
        null,
        buildDeadline,
        requestedSeconds,
      ),
    db
      .prepare(
        "UPDATE bounties SET status='busy',active_attempt=?,escrow_attempt_nonce=?,escrow_attempt_deadline=?,updated=? WHERE id=? AND status='open'",
      )
      .bind(attempt, Number(nonce), Number(deadline) * 1000, updated, row.id),
    db
      .prepare(
        "UPDATE payment_holds SET status='accepted',provider_ref=?,updated=? WHERE id=?",
      )
      .bind(attempt, updated, hold.id),
    db
      .prepare(
        "INSERT INTO idempotency (account,key,kind,digest,ref,created) VALUES (?,?,?,?,?,?)",
      )
      .bind(
        auth.account,
        hold.request_key,
        "enter:" + row.id,
        hold.digest,
        attempt,
        updated,
      ),
  ]);
  return {
    kind: "attempt",
    value: await attemptView(db, attempt, auth.account),
  };
}

async function deployCounter(db, auth, attemptId, body, key) {
  requireOwner(auth);
  fields(body, ["blueprint"]);
  validKey(key);
  const attempt = await db
    .prepare("SELECT * FROM attempts WHERE id=?")
    .bind(attemptId)
    .first();
  check(attempt, "Attempt not found.", 404);
  const bounty = await bountyRow(db, attempt.bounty);
  check(
    attempt.account === auth.account,
    "Only the paid challenger can deploy this counter.",
    403,
  );
  check(
    attempt.status === "engineering",
    "This counter has already been deployed or the attempt has ended.",
    409,
  );
  check(
    now() < Number(attempt.build_deadline) &&
      now() < Number(bounty.escrow_attempt_deadline),
    "The engineering window closed. The entry is forfeited to the bounty creator.",
    409,
  );
  const old = await prior(db, auth.account, key, "deploy:" + attemptId, body);
  if (old) return attemptView(db, old, auth.account);
  const defender = parse(bounty.blueprint),
    challenger = canonicalBlueprint(body.blueprint, defender),
    settlementDeadline = Math.floor(
      Number(bounty.escrow_attempt_deadline) / 1000,
    ),
    updated = now();
  let simulation;
  try {
    const result = {
        ...new Battle(
          unpackChallenge(challenger).machine,
          unpackChallenge(defender).machine,
          defender.a,
          attempt.seed,
          { mode: "auto", swapSpawns: !!(attempt.seed & 1) },
        ).run(),
        seed: attempt.seed,
      },
      outcome = result.winner === 0 ? 0 : 1,
      resultHash =
        "0x" +
        (await hex(
          json({
            version: "war-machines-settlement-v2",
            engineHash: CLIENT_ENGINE_HASH,
            bountyId: bounty.escrow_bounty_id,
            attemptNonce: bounty.escrow_attempt_nonce,
            outcome,
            challenger,
            defender,
            result,
          }),
        ));
    simulation = {
      ...result,
      outcome:
        result.winner === 0 ? "win" : result.winner === 1 ? "loss" : "draw",
      settlement: {
        bountyId: bounty.escrow_bounty_id,
        attemptNonce: String(bounty.escrow_attempt_nonce),
        outcome,
        resultHash,
        validUntil: Math.max(0, settlementDeadline - 1),
        signatures: [],
      },
    };
  } catch {
    simulation = {
      outcome: "technical-refund",
      settlement: {
        bountyId: bounty.escrow_bounty_id,
        attemptNonce: String(bounty.escrow_attempt_nonce),
        outcome: 2,
        resultHash: "0x" + (await hex("technical-refund:" + attempt.id)),
        validUntil: Math.max(0, settlementDeadline - 1),
        signatures: [],
      },
    };
  }
  const applied = await db
    .prepare(
      "UPDATE attempts SET blueprint=?,status='awaiting-signatures',result=?,settlement_payload=?,updated=? WHERE id=? AND status='engineering'",
    )
    .bind(
      json(challenger),
      json(simulation),
      json(simulation.settlement),
      updated,
      attempt.id,
    )
    .run();
  check(
    applied.meta.changes === 1,
    "This counter was already deployed in another request.",
    409,
  );
  await remember(
    db,
    auth.account,
    key,
    "deploy:" + attemptId,
    body,
    attempt.id,
  );
  return attemptView(db, attempt.id, auth.account);
}

async function forfeitExpiredEngineeringAttempt(db, auth, attemptId, key) {
  requireOwner(auth);
  const old = await prior(db, auth.account, key, "forfeit:" + attemptId, {});
  if (old) return attemptView(db, old, auth.account);
  const attempt = await db
    .prepare("SELECT * FROM attempts WHERE id=?")
    .bind(attemptId)
    .first();
  check(attempt, "Attempt not found.", 404);
  check(
    attempt.account === auth.account,
    "Only the paid challenger can finalize this timed-out attempt.",
    403,
  );
  const bounty = await bountyRow(db, attempt.bounty);
  if (
    ["awaiting-signatures", "ready-to-settle", "settled"].includes(
      attempt.status,
    )
  )
    return attemptView(db, attempt.id, auth.account);
  check(
    attempt.status === "engineering",
    "This attempt has already ended.",
    409,
  );
  const buildDeadline = Number(attempt.build_deadline || 0),
    settlementDeadline = Math.floor(
      Number(bounty.escrow_attempt_deadline || 0) / 1000,
    );
  check(
    buildDeadline > 0 && now() >= buildDeadline,
    "The counter clock is still running.",
    409,
  );
  check(
    settlementDeadline > Math.floor(now() / 1000),
    "The escrow attestation window has elapsed. This immutable escrow can no longer transfer the entry to the creator.",
    409,
  );
  const resultHash =
      "0x" +
      (await hex(
        json({
          version: "war-machines-settlement-v2",
          engineHash: CLIENT_ENGINE_HASH,
          bountyId: bounty.escrow_bounty_id,
          attemptNonce: bounty.escrow_attempt_nonce,
          outcome: 1,
          challenger: null,
          defender: parse(bounty.blueprint),
          reason: "counter-build-timeout",
          buildDeadline,
          seed: attempt.seed,
        }),
      )),
    settlement = {
      bountyId: bounty.escrow_bounty_id,
      attemptNonce: String(bounty.escrow_attempt_nonce),
      outcome: 1,
      resultHash,
      validUntil: Math.max(0, settlementDeadline - 1),
      signatures: [],
    },
    result = {
      seed: attempt.seed,
      winner: 1,
      outcome: "loss",
      reason: "counter-build-timeout",
      time: 0,
      damage: [0, 0],
      integrity: [0, 1],
      entry: display(bounty.entry_units),
      grossReward: "0",
      reward: "0",
      payout: "0",
      platformFee: "0",
      platformFeeBps: bounty.platform_fee_bps ?? PLATFORM_FEE_BPS,
      net: "-" + display(bounty.entry_units),
      verifiedAt: now(),
      settlement,
    };
  const applied = await db
    .prepare(
      "UPDATE attempts SET status='awaiting-signatures',result=?,settlement_payload=?,error=NULL,updated=? WHERE id=? AND status='engineering'",
    )
    .bind(json(result), json(settlement), now(), attempt.id)
    .run();
  check(
    applied.meta.changes === 1,
    "This timed-out attempt was already finalized.",
    409,
  );
  await remember(db, auth.account, key, "forfeit:" + attemptId, {}, attempt.id);
  return attemptView(db, attempt.id, auth.account);
}

function directControlPlan(config, row, action) {
  const bountyId = BigInt(row.escrow_bounty_id);
  const functionName =
    action === "cancel"
      ? "cancelBounty"
      : action === "timeout-forfeit"
        ? "forfeitTimedOutAttempt"
        : "expireBounty";
  return directPlan(
    config,
    encodeFunctionData({ abi: ESCROW_ABI, functionName, args: [bountyId] }),
  );
}
async function directControlIntent(
  db,
  auth,
  bountyId,
  action,
  body,
  key,
  config,
) {
  requireOwner(auth);
  fields(body, []);
  validKey(key);
  const row = await bountyRow(db, bountyId);
  check(
    row.escrow_bounty_id,
    "This legacy bounty is not backed by the direct escrow.",
    409,
  );
  if (action === "cancel") {
    check(
      auth.account === row.owner,
      "Only the bounty creator can close it.",
      403,
    );
    check(
      row.status === "open",
      "An active bounty cannot be closed. Settle its result or wait for its published expiry.",
      409,
    );
  } else if (action === "timeout-forfeit") {
    check(
      row.status === "busy" && row.active_attempt,
      "There is no active bounty attempt to finalize.",
      409,
    );
    const attempt = await db
      .prepare("SELECT * FROM attempts WHERE id=?")
      .bind(row.active_attempt)
      .first();
    check(
      attempt?.account === auth.account,
      "Only the paid challenger can submit this timeout finalizer.",
      403,
    );
    check(
      Number(row.escrow_attempt_deadline || 0) <= now(),
      "The escrow signer window is still running.",
      409,
    );
  } else {
    check(row.status === "open", "Only an idle bounty can expire.", 409);
    check(
      row.expires && row.expires <= now(),
      "This bounty is not expired yet.",
      409,
    );
  }
  const purpose = "direct-" + action,
    digest = await hex(json(body));
  let hold = await db
    .prepare(
      "SELECT * FROM payment_holds WHERE account=? AND bounty=? AND request_key=? AND purpose=? ORDER BY created DESC LIMIT 1",
    )
    .bind(auth.account, bountyId, key, purpose)
    .first();
  if (hold) {
    check(
      hold.digest === digest,
      "That idempotency key was used for a different request.",
      409,
    );
    if (hold.status === "accepted")
      return {
        final: true,
        value: await bountyView(
          db,
          await bountyRow(db, bountyId),
          auth.account,
          true,
        ),
      };
    return {
      direct: true,
      intentId: hold.id,
      kind: action,
      bounty: bountyId,
      plan: directControlPlan(config, row, action),
    };
  }
  const created = now();
  await db
    .prepare(
      "INSERT INTO payment_holds (id,account,bounty,request_key,digest,body,amount_units,purpose,expires,status,provider_ref,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      id(),
      auth.account,
      bountyId,
      key,
      digest,
      json({ action, escrowBountyId: row.escrow_bounty_id }),
      "0",
      purpose,
      created + 24 * 60 * 60 * 1000,
      "awaiting-onchain",
      null,
      created,
      created,
    )
    .run();
  hold = await db
    .prepare(
      "SELECT * FROM payment_holds WHERE account=? AND bounty=? AND request_key=? AND purpose=? ORDER BY created DESC LIMIT 1",
    )
    .bind(auth.account, bountyId, key, purpose)
    .first();
  return {
    direct: true,
    intentId: hold.id,
    kind: action,
    bounty: bountyId,
    plan: directControlPlan(config, row, action),
  };
}
async function confirmDirectControl(db, auth, intentId, hash, config) {
  requireOwner(auth);
  const hold = await db
    .prepare(
      "SELECT * FROM payment_holds WHERE id=? AND account=? AND purpose IN ('direct-cancel','direct-timeout-forfeit','direct-expire')",
    )
    .bind(intentId, auth.account)
    .first();
  check(hold, "Direct escrow control intent not found.", 404);
  if (hold.status === "accepted")
    return await bountyView(
      db,
      await bountyRow(db, hold.bounty),
      auth.account,
      true,
    );
  check(
    hold.status === "awaiting-onchain",
    "This escrow control intent cannot be confirmed.",
    409,
  );
  const row = await bountyRow(db, hold.bounty),
    receiptValue = await receipt(config, hash),
    action = hold.purpose.slice("direct-".length),
    updated = now();
  if (action === "cancel") {
    const log = eventLog(receiptValue, config, ESCROW_EVENTS.cancelled);
    check(
      log.topics?.length === 3 &&
        BigInt(log.topics[1]).toString() === row.escrow_bounty_id,
      "Escrow cancellation event targets a different bounty.",
      409,
    );
    check(
      topicAddress(log.topics[2]) === (await payoutAddress(db, row.owner)) &&
        word(log.data, 0) === BigInt(row.reward_units),
      "Escrow cancellation event does not match this bounty.",
      409,
    );
    await db.batch([
      db
        .prepare(
          "UPDATE bounties SET status='cancelled',active_attempt=NULL,reserve_units='0',updated=? WHERE id=?",
        )
        .bind(updated, row.id),
      db
        .prepare(
          "UPDATE payment_holds SET status='accepted',provider_ref=?,updated=? WHERE id=?",
        )
        .bind(hash, updated, hold.id),
    ]);
  } else if (action === "timeout-forfeit") {
    const active = row.active_attempt,
      attempt = active
        ? await db
            .prepare("SELECT * FROM attempts WHERE id=?")
            .bind(active)
            .first()
        : null,
      log = eventLog(receiptValue, config, ESCROW_EVENTS.timedOut);
    check(attempt, "The active attempt is missing.", 409);
    check(
      log.topics?.length === 4 &&
        BigInt(log.topics[1]).toString() === row.escrow_bounty_id &&
        BigInt(log.topics[2]).toString() === String(row.escrow_attempt_nonce) &&
        topicAddress(log.topics[3]) ===
          (await payoutAddress(db, attempt.account)) &&
        topicAddress(bytesWord(log.data, 0)) ===
          (await payoutAddress(db, row.owner)) &&
        word(log.data, 1) === BigInt(row.entry_units),
      "Escrow timeout finalizer does not match this active bounty attempt.",
      409,
    );
    const prior = attempt.result ? parse(attempt.result) : {},
      result = {
        ...prior,
        outcome: "loss",
        reason: "escrow-timeout-forfeit",
        winner: 1,
        entry: display(row.entry_units),
        grossReward: "0",
        payout: "0",
        platformFee: "0",
        platformFeeBps: row.platform_fee_bps ?? PLATFORM_FEE_BPS,
        net: "-" + display(row.entry_units),
        payoutStatus: "settled-onchain",
        verifiedAt: updated,
      };
    await db.batch([
      db
        .prepare(
          "UPDATE attempts SET status='settled',result=?,escrow_settlement_tx=?,updated=? WHERE id=? AND status IN ('engineering','awaiting-signatures','ready-to-settle')",
        )
        .bind(json(result), hash, updated, attempt.id),
      db
        .prepare(
          "UPDATE bounties SET status='open',active_attempt=NULL,escrow_attempt_deadline=NULL,updated=? WHERE id=?",
        )
        .bind(updated, row.id),
      db
        .prepare(
          "UPDATE payment_holds SET status='accepted',provider_ref=?,updated=? WHERE id=?",
        )
        .bind(hash, updated, hold.id),
    ]);
  } else {
    const log = eventLog(receiptValue, config, ESCROW_EVENTS.expired);
    check(
      log.topics?.length === 3 &&
        BigInt(log.topics[1]).toString() === row.escrow_bounty_id &&
        topicAddress(log.topics[2]) === (await payoutAddress(db, row.owner)) &&
        word(log.data, 0) === BigInt(row.reward_units),
      "Escrow expiry event does not match this bounty.",
      409,
    );
    await db.batch([
      db
        .prepare(
          "UPDATE bounties SET status='expired',active_attempt=NULL,escrow_attempt_deadline=NULL,reserve_units='0',updated=? WHERE id=?",
        )
        .bind(updated, row.id),
      db
        .prepare(
          "UPDATE payment_holds SET status='accepted',provider_ref=?,updated=? WHERE id=?",
        )
        .bind(hash, updated, hold.id),
    ]);
  }
  return await bountyView(db, await bountyRow(db, row.id), auth.account, true);
}
function settlementWire(config, payload) {
  const typed = settlementTypedData(config, payload);
  return {
    domain: typed.domain,
    types: typed.types,
    primaryType: typed.primaryType,
    message: {
      bountyId: String(payload.bountyId),
      attemptNonce: String(payload.attemptNonce),
      outcome: Number(payload.outcome),
      resultHash: payload.resultHash,
      validUntil: String(payload.validUntil),
    },
  };
}
async function settlementRecord(db, attemptId) {
  const attempt = await db
    .prepare("SELECT * FROM attempts WHERE id=?")
    .bind(attemptId)
    .first();
  check(attempt, "Attempt not found.", 404);
  check(
    ["awaiting-signatures", "ready-to-settle"].includes(attempt.status),
    "This attempt is no longer awaiting escrow settlement.",
    409,
  );
  check(
    attempt.settlement_payload,
    "This attempt has no settlement commitment.",
    409,
  );
  return {
    attempt,
    payload: parse(attempt.settlement_payload),
    bounty: await bountyRow(db, attempt.bounty),
  };
}
function settlementPlan(config, payload) {
  check(
    Array.isArray(payload.signatures) && payload.signatures.length === 2,
    "Both independent result signatures are required before settlement.",
    409,
  );
  const call = encodeFunctionData({
    abi: ESCROW_ABI,
    functionName: "settleAttempt",
    args: [settlementMessage(payload), payload.signatures],
  });
  return {
    direct: true,
    kind: "settle-attempt",
    plan: directPlan(config, call),
  };
}
async function settlementInfo(db, attemptId, config) {
  const { attempt, payload } = await settlementRecord(db, attemptId);
  return {
    attemptId,
    status: attempt.status,
    settlement: {
      bountyId: payload.bountyId,
      attemptNonce: payload.attemptNonce,
      outcome: payload.outcome,
      resultHash: payload.resultHash,
      validUntil: payload.validUntil,
      signatures: payload.signatures || [],
    },
    typedData: settlementWire(config, payload),
    signing: { quorum: 2, signers: ESCROW_SETTLEMENT_SIGNERS },
  };
}
export async function validateEscrowAttestation(
  config,
  payload,
  signatures,
  approvedSigners = ESCROW_SETTLEMENT_SIGNERS,
) {
  check(
    Array.isArray(signatures) && signatures.length === 2,
    "Submit exactly two result signatures.",
    400,
  );
  const approved = new Set(
      approvedSigners.map((value) => getAddress(value).toLowerCase()),
    ),
    typed = settlementTypedData(config, payload),
    recovered = [];
  for (const signature of signatures) {
    check(
      validSignature(signature),
      "A result signature is malformed or non-canonical.",
      400,
    );
    let signer;
    try {
      signer = getAddress(
        await recoverTypedDataAddress({ ...typed, signature }),
      );
    } catch {
      fail(
        400,
        "A result signature does not match the escrow settlement typed data.",
      );
    }
    check(
      approved.has(signer.toLowerCase()),
      "A result signature was not made by an approved escrow signer.",
      403,
    );
    recovered.push({ signer, signature });
  }
  recovered.sort((left, right) =>
    left.signer.toLowerCase().localeCompare(right.signer.toLowerCase()),
  );
  check(
    recovered[0].signer.toLowerCase() !== recovered[1].signer.toLowerCase(),
    "Result signatures must come from two different approved signers.",
    409,
  );
  return recovered;
}
async function attestSettlement(db, attemptId, body, config) {
  fields(body, ["signatures"]);
  const { attempt, payload } = await settlementRecord(db, attemptId);
  check(
    Number(payload.validUntil) >= Math.floor(now() / 1000),
    "The attestation window has elapsed. This immutable escrow cannot settle the recorded result.",
    409,
  );
  const recovered = await validateEscrowAttestation(
    config,
    payload,
    body.signatures,
  );
  payload.signatures = recovered.map((item) => item.signature);
  payload.attestedAt = now();
  if (attempt.status !== "ready-to-settle")
    await db
      .prepare(
        "UPDATE attempts SET status='ready-to-settle',settlement_payload=?,updated=? WHERE id=? AND status='awaiting-signatures'",
      )
      .bind(json(payload), now(), attempt.id)
      .run();
  return settlementPlan(config, payload);
}
async function confirmSettlement(db, attemptId, hash, config) {
  const { attempt, payload, bounty } = await settlementRecord(db, attemptId);
  check(
    attempt.status === "ready-to-settle",
    "Both signatures must be accepted before the settlement transaction can be confirmed.",
    409,
  );
  const receiptValue = await receipt(config, hash),
    log = eventLog(receiptValue, config, ESCROW_EVENTS.settled);
  check(
    log.topics?.length === 4 &&
      BigInt(log.topics[1]).toString() === String(payload.bountyId) &&
      BigInt(log.topics[2]).toString() === String(payload.attemptNonce),
    "Escrow settlement event targets a different attempt.",
    409,
  );
  check(
    topicAddress(log.topics[3]) ===
      (await payoutAddress(db, attempt.account)) &&
      Number(word(log.data, 0)) === Number(payload.outcome) &&
      bytesWord(log.data, 1).toLowerCase() === payload.resultHash.toLowerCase(),
    "Escrow settlement event does not match the signed result.",
    409,
  );
  const quote = payoutQuote(
      bounty.reward_units,
      bounty.entry_units,
      bounty.platform_fee_bps ?? PLATFORM_FEE_BPS,
    ),
    outcome = Number(payload.outcome),
    expectedPayout = outcome === 0 ? BigInt(quote.payoutUnits) : 0n,
    expectedFee = outcome === 0 ? BigInt(quote.platformFeeUnits) : 0n,
    expectedCreatorEntry = outcome < 2 ? BigInt(bounty.entry_units) : 0n;
  check(
    word(log.data, 2) === expectedPayout &&
      word(log.data, 3) === expectedFee &&
      word(log.data, 4) === expectedCreatorEntry,
    "Escrow settlement amounts do not match the immutable bounty terms.",
    409,
  );
  const prior = attempt.result ? parse(attempt.result) : {},
    result = {
      ...prior,
      outcome:
        outcome === 0 ? "win" : outcome === 1 ? "loss" : "technical-refund",
      entry: display(bounty.entry_units),
      grossReward: outcome === 0 ? display(bounty.reward_units) : "0",
      payout: outcome === 0 ? quote.payout : "0",
      platformFee: outcome === 0 ? quote.platformFee : "0",
      platformFeeBps: bounty.platform_fee_bps ?? PLATFORM_FEE_BPS,
      net:
        outcome === 0
          ? quote.netIfWin
          : outcome === 1
            ? "-" + display(bounty.entry_units)
            : "0",
      payoutStatus: "settled-onchain",
      verifiedAt: now(),
      settlement: { ...payload, transactionHash: hash },
    };
  const updated = now(),
    attemptStatus = outcome === 2 ? "refunded" : "settled",
    bountyStatus = outcome === 0 ? "claimed" : "open";
  await db.batch([
    db
      .prepare(
        "UPDATE attempts SET status=?,result=?,escrow_settlement_tx=?,settlement_payload=?,updated=? WHERE id=? AND status=?",
      )
      .bind(
        attemptStatus,
        json(result),
        hash,
        json(payload),
        updated,
        attempt.id,
        "ready-to-settle",
      ),
    db
      .prepare(
        "UPDATE bounties SET status=?,active_attempt=NULL,escrow_attempt_deadline=NULL,winner=?,reserve_units=?,updated=? WHERE id=?",
      )
      .bind(
        bountyStatus,
        outcome === 0 ? attempt.id : null,
        outcome === 0 ? "0" : bounty.reward_units,
        updated,
        bounty.id,
      ),
  ]);
  return await attemptView(db, attempt.id, attempt.account);
}

export async function mainnetFetch(request, env, ctx, serveStaticAsset) {
  const url = new URL(request.url),
    path = url.pathname,
    config = runtimeConfig(env, url.origin);
  if (path === "/.well-known/war-machines.json" && request.method === "GET")
    return response(discovery(config));
  if (!path.startsWith("/api/")) return serveStaticAsset(request);
  try {
    check(env.DB, "D1 storage is unavailable.");
    const db = env.DB,
      method = request.method;
    check(
      ["GET", "POST", "PATCH", "PUT", "DELETE"].includes(method),
      "Method not allowed.",
      405,
    );
    if (request.headers.get("origin"))
      check(
        new URL(request.headers.get("origin")).origin === url.origin,
        "Cross-origin API requests are not allowed.",
        403,
      );
    const body = ["POST", "PATCH"].includes(method)
        ? await bodyOf(request)
        : {},
      auth = await dbAuth(db, request);
    if (path === "/api/rules" && method === "GET")
      return response(catalog(config));
    if (path === "/api/openapi.json" && method === "GET")
      return response(openapi);
    if (path === "/api/health" && method === "GET")
      return response({
        ok: true,
        app: "war-machines",
        mode: "tempo-mainnet",
        paymentsEnabled: config.enabled,
        directEscrow: !!config.directEscrow,
        mppAgentApi: !!config.agentMppEnabled,
        activation: config.enabled
          ? config.acceptingNewBounties
            ? "ready"
            : "recovery-only"
          : "locked",
        engineHash: CLIENT_ENGINE_HASH,
      });
    if (path === "/api/blueprints/validate" && method === "POST")
      return response(await inspection(db, body, auth?.account));
    if (path === "/api/practice" && method === "POST")
      return response(await practice(db, body, auth?.account));
    if (path === "/api/auth/challenge" && method === "POST")
      return response(await signInChallenge(db, body, url.origin));
    if (path === "/api/auth/verify" && method === "POST") {
      const verified = await verifyWallet(db, body, config);
      return response({ me: verified.me }, 200, verified.headers);
    }
    if (path === "/api/auth/logout" && method === "POST") {
      const value = cookie(request, "wm_session");
      if (value)
        await db
          .prepare("DELETE FROM sessions WHERE token_hash=?")
          .bind(await hex(value))
          .run();
      return response({ ok: true }, 200, {
        "set-cookie":
          "wm_session=; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
      });
    }
    check(
      config.enabled,
      config.reason || "Mainnet payments are unavailable.",
      503,
    );
    if (path === "/api/agent/practice" && method === "POST") {
      check(
        config.agentMppEnabled,
        "MPP agent practice is not configured. Set a separate agent recipient, exact pathUSD price and MPP secret; this never enables bounty funding.",
        503,
      );
      const actor = requireAuth(auth),
        key = request.headers.get("idempotency-key");
      validKey(key);
      const operation = "agent-practice:" + actor.account + ":" + key,
        payment = await gateway(db, config)(request, {
          amountUnits: config.agentMppPriceUnits,
          recipient: config.agentMppRecipient,
          operation,
          description: "War Machines paid agent practice",
          meta: {
            kind: "agent-practice",
            engineHash: CLIENT_ENGINE_HASH,
            scope: "practice-only",
          },
          expires: now() + 5 * 60 * 1000,
        });
      if (!payment.paid) return payment.response;
      await recordFinancial(db, {
        kind: "agent-mpp-practice",
        account: actor.account,
        ref: operation,
        amountUnits: config.agentMppPriceUnits,
        recipient: config.agentMppRecipient,
        status: "confirmed",
        providerRef: payment.receipt,
      });
      return response(await practice(db, body, actor.account), 200, {
        "payment-receipt": payment.receipt,
      });
    }
    if (path === "/api/me/wallet" && method === "GET") {
      const me = await account(db, requireAuth(auth).account),
        address = me.payoutAddress;
      return response({
        address,
        balance: await pathUsdBalance(config, address),
        currency: "pathUSD",
        decimals: PATH_USD_DECIMALS,
      });
    }
    if (path === "/api/me" && method === "GET")
      return response(await account(db, requireAuth(auth).account));
    if (path === "/api/me" && method === "PATCH") {
      requireOwner(auth);
      fields(body, ["name", "entryCap", "dailyCap"]);
      const existing = await account(db, auth.account),
        entryCap = own(body, "entryCap") ? body.entryCap : existing.entryCap,
        dailyCap = own(body, "dailyCap") ? body.dailyCap : existing.dailyCap;
      let entryUnits = null,
        dailyUnits = null;
      try {
        entryUnits = entryCap === null ? null : pathUsdToUnits(entryCap);
        dailyUnits = dailyCap === null ? null : pathUsdToUnits(dailyCap);
      } catch (error) {
        fail(400, error.message);
      }
      await db
        .prepare(
          "UPDATE accounts SET name=?,entry_cap_units=?,daily_cap_units=? WHERE id=?",
        )
        .bind(
          own(body, "name") ? text(body.name, 28, "pilot name") : existing.name,
          entryUnits === null ? null : String(entryUnits),
          dailyUnits === null ? null : String(dailyUnits),
          auth.account,
        )
        .run();
      return response(await account(db, auth.account));
    }
    if (path === "/api/me/ledger" && method === "GET")
      return response(await ledger(db, requireAuth(auth).account));
    if (path === "/api/me/attempts" && method === "GET") {
      const rows = await db
        .prepare(
          "SELECT id FROM attempts WHERE account=? ORDER BY created DESC LIMIT 30",
        )
        .bind(requireAuth(auth).account)
        .all();
      return response(
        await Promise.all(
          rows.results.map((row) => attemptView(db, row.id, auth.account)),
        ),
      );
    }
    if (path === "/api/me/builds" && method === "GET") {
      requireOwner(auth);
      const rows = await db
        .prepare(
          "SELECT id,name,blueprint,created,updated FROM saved_builds WHERE account=? ORDER BY updated DESC LIMIT 50",
        )
        .bind(auth.account)
        .all();
      return response(
        rows.results.map((row) => ({
          ...row,
          blueprint: parse(row.blueprint),
        })),
      );
    }
    if (path === "/api/me/builds" && method === "POST") {
      requireOwner(auth);
      fields(body, ["name", "blueprint"]);
      const key = request.headers.get("idempotency-key"),
        old = await prior(db, auth.account, key, "save-build", body);
      if (old) {
        const row = await db
          .prepare(
            "SELECT id,name,blueprint,created,updated FROM saved_builds WHERE id=? AND account=?",
          )
          .bind(old, auth.account)
          .first();
        return response({ ...row, blueprint: parse(row.blueprint) });
      }
      const count = await db
        .prepare("SELECT COUNT(*) AS total FROM saved_builds WHERE account=?")
        .bind(auth.account)
        .first();
      check(
        count.total < 50,
        "Build vault is full. Delete a saved build first.",
        409,
      );
      const build = id(),
        saved = now(),
        blueprint = canonicalBlueprint(body.blueprint);
      await db.batch([
        db
          .prepare(
            "INSERT INTO saved_builds (id,account,name,blueprint,created,updated) VALUES (?,?,?,?,?,?)",
          )
          .bind(
            build,
            auth.account,
            text(body.name, 48, "build name"),
            json(blueprint),
            saved,
            saved,
          ),
        db
          .prepare(
            "INSERT INTO idempotency (account,key,kind,digest,ref,created) VALUES (?,?,?,?,?,?)",
          )
          .bind(
            auth.account,
            key,
            "save-build",
            await hex(json(body)),
            build,
            saved,
          ),
      ]);
      return response(
        {
          id: build,
          name: body.name.trim(),
          blueprint,
          created: saved,
          updated: saved,
        },
        201,
      );
    }
    let match = path.match(/^\/api\/me\/builds\/([a-f0-9-]{36})$/);
    if (match && method === "PATCH") {
      requireOwner(auth);
      fields(body, ["name", "blueprint"]);
      const key = request.headers.get("idempotency-key"),
        kind = "update-build:" + match[1],
        old = await prior(db, auth.account, key, kind, body);
      if (old) {
        const row = await db
          .prepare(
            "SELECT id,name,blueprint,created,updated FROM saved_builds WHERE id=? AND account=?",
          )
          .bind(old, auth.account)
          .first();
        return response({ ...row, blueprint: parse(row.blueprint) });
      }
      const name = text(body.name, 48, "build name"),
        blueprint = canonicalBlueprint(body.blueprint),
        updated = now(),
        result = await db
          .prepare(
            "UPDATE saved_builds SET name=?,blueprint=?,updated=? WHERE id=? AND account=?",
          )
          .bind(name, json(blueprint), updated, match[1], auth.account)
          .run();
      check(result.meta.changes === 1, "Saved build not found.", 404);
      await remember(db, auth.account, key, kind, body, match[1]);
      return response({
        id: match[1],
        name,
        blueprint,
        created: (
          await db
            .prepare("SELECT created FROM saved_builds WHERE id=?")
            .bind(match[1])
            .first()
        ).created,
        updated,
      });
    }
    if (match && method === "DELETE") {
      requireOwner(auth);
      const result = await db
        .prepare("DELETE FROM saved_builds WHERE id=? AND account=?")
        .bind(match[1], auth.account)
        .run();
      check(result.meta.changes === 1, "Saved build not found.", 404);
      return response({ deleted: true, id: match[1] });
    }
    if (path === "/api/me/bookmarks" && method === "GET") {
      const rows = await db
        .prepare(
          "SELECT bounty FROM bookmarks WHERE account=? ORDER BY created DESC LIMIT 200",
        )
        .bind(requireAuth(auth).account)
        .all();
      return response(
        await Promise.all(
          rows.results.map(async (row) =>
            bountyView(db, await bountyRow(db, row.bounty), auth.account, true),
          ),
        ),
      );
    }
    match = path.match(/^\/api\/me\/bookmarks\/([a-f0-9-]{36})$/);
    if (match && ["PUT", "DELETE"].includes(method)) {
      requireAuth(auth);
      await bountyRow(db, match[1]);
      if (method === "PUT")
        await db
          .prepare(
            "INSERT OR IGNORE INTO bookmarks (account,bounty,created) VALUES (?,?,?)",
          )
          .bind(auth.account, match[1], now())
          .run();
      else
        await db
          .prepare("DELETE FROM bookmarks WHERE account=? AND bounty=?")
          .bind(auth.account, match[1])
          .run();
      return response({ saved: method === "PUT", bounty: match[1] });
    }
    if (path === "/api/agents" && method === "GET") {
      requireOwner(auth);
      const rows = await db
        .prepare(
          "SELECT id,name,created,revoked FROM agent_keys WHERE account=? ORDER BY created DESC",
        )
        .bind(auth.account)
        .all();
      return response(
        rows.results.map((row) => ({
          ...row,
          revoked: !!row.revoked,
          scopes: ["read", "save-build"],
        })),
      );
    }
    if (path === "/api/agents" && method === "POST") {
      requireOwner(auth);
      fields(body, ["name"]);
      const count = await db
        .prepare(
          "SELECT COUNT(*) AS total FROM agent_keys WHERE account=? AND revoked=0",
        )
        .bind(auth.account)
        .first();
      check(count.total < 8, "Revoke an old agent key first.", 409);
      const token = randomSecret(),
        agent = id(),
        created = now();
      await db
        .prepare(
          "INSERT INTO agent_keys (id,account,token_hash,name,revoked,created) VALUES (?,?,?,?,0,?)",
        )
        .bind(
          agent,
          auth.account,
          await hex(token),
          text(body.name, 28, "agent name"),
          created,
        )
        .run();
      return response(
        { token, id: agent, scopes: ["read", "save-build"] },
        201,
      );
    }
    match = path.match(/^\/api\/agents\/([a-f0-9-]{36})$/);
    if (match && method === "DELETE") {
      requireOwner(auth);
      await db
        .prepare("UPDATE agent_keys SET revoked=1 WHERE id=? AND account=?")
        .bind(match[1], auth.account)
        .run();
      return response({ ok: true });
    }
    if (path === "/api/bounties" && method === "GET") {
      const rows = await db
        .prepare(
          "SELECT * FROM bounties WHERE (listed=1 OR owner=?) AND entry_units IS NOT NULL ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'busy' THEN 1 ELSE 2 END, created DESC LIMIT 100",
        )
        .bind(auth?.account || "")
        .all();
      return response(
        await Promise.all(
          rows.results.map((row) => bountyView(db, row, auth?.account, false)),
        ),
      );
    }
    if (path === "/api/bounties" && method === "POST") {
      const result = await directCreateIntent(
        db,
        auth,
        body,
        request.headers.get("idempotency-key"),
        config,
      );
      return result.final ? response(result.value, 200) : response(result, 202);
    }
    match = path.match(/^\/api\/escrow\/intents\/([a-f0-9-]{36})\/confirm$/);
    if (match && method === "POST") {
      fields(body, ["transactionHash"]);
      const hold = await db
        .prepare("SELECT purpose FROM payment_holds WHERE id=?")
        .bind(match[1])
        .first();
      check(hold, "Direct escrow intent not found.", 404);
      if (["direct-create", "direct-entry"].includes(hold.purpose)) {
        const result = await confirmDirectIntent(
          db,
          auth,
          match[1],
          body.transactionHash,
          config,
        );
        return response(result.value, result.kind === "bounty" ? 201 : 202);
      }
      return response(
        await confirmDirectControl(
          db,
          auth,
          match[1],
          body.transactionHash,
          config,
        ),
      );
    }
    match = path.match(
      /^\/api\/bounties\/([a-f0-9-]{36})(?:\/(attempts|cancel|timeout-forfeit|expire))?$/,
    );
    if (match) {
      const [, bountyId, action] = match;
      if (!action && method === "GET")
        return response(
          await bountyView(
            db,
            await bountyRow(db, bountyId),
            auth?.account,
            true,
          ),
        );
      if (action === "cancel" && method === "POST") {
        const result = await directControlIntent(
          db,
          auth,
          bountyId,
          "cancel",
          body,
          request.headers.get("idempotency-key"),
          config,
        );
        return result.final ? response(result.value) : response(result, 202);
      }
      if (action === "expire" && method === "POST") {
        const result = await directControlIntent(
          db,
          auth,
          bountyId,
          "expire",
          body,
          request.headers.get("idempotency-key"),
          config,
        );
        return result.final ? response(result.value) : response(result, 202);
      }
      if (action === "timeout-forfeit" && method === "POST") {
        const result = await directControlIntent(
          db,
          auth,
          bountyId,
          "timeout-forfeit",
          body,
          request.headers.get("idempotency-key"),
          config,
        );
        return result.final ? response(result.value) : response(result, 202);
      }
      if (action === "attempts" && method === "POST") {
        const result = await directEntryIntent(
          db,
          auth,
          bountyId,
          body,
          request.headers.get("idempotency-key"),
          config,
        );
        return result.final
          ? response(result.value, 200)
          : response(result, 202);
      }
    }
    match = path.match(
      /^\/api\/attempts\/([a-f0-9-]{36})\/(settlement|attestations|settlement-plan|settlement-confirm|forfeit)$/,
    );
    if (match) {
      const [, attemptId, action] = match;
      if (action === "settlement" && method === "GET")
        return response(await settlementInfo(db, attemptId, config));
      if (action === "attestations" && method === "POST")
        return response(await attestSettlement(db, attemptId, body, config));
      if (action === "settlement-plan" && method === "GET") {
        const { payload } = await settlementRecord(db, attemptId);
        return response(settlementPlan(config, payload));
      }
      if (action === "settlement-confirm" && method === "POST") {
        fields(body, ["transactionHash"]);
        return response(
          await confirmSettlement(db, attemptId, body.transactionHash, config),
        );
      }
      if (action === "forfeit" && method === "POST")
        return response(
          await forfeitExpiredEngineeringAttempt(
            db,
            auth,
            attemptId,
            request.headers.get("idempotency-key"),
          ),
        );
    }
    match = path.match(/^\/api\/attempts\/([a-f0-9-]{36})\/deploy$/);
    if (match && method === "POST")
      return response(
        await deployCounter(
          db,
          auth,
          match[1],
          body,
          request.headers.get("idempotency-key"),
        ),
      );
    match = path.match(/^\/api\/attempts\/([a-f0-9-]{36})$/);
    if (match && method === "GET")
      return response(await attemptView(db, match[1], auth?.account));
    fail(404, "API route not found.");
  } catch (error) {
    if (!error.status) console.error("War Machines Tempo API error:", error);
    return response(
      {
        error: error.status
          ? error.message
          : "Server error. Retry with the same idempotency key.",
      },
      error.status || 500,
    );
  }
}
