// One-call War Machines agent workflow.
//
// This module deliberately keeps wallet signing local. The Worker can issue a
// zero-value MPP proof, but it must never receive authority to spend the
// caller's wallet. The local runner uses the same Tempo access-key provider to
// preflight and sign the exact escrow plan returned by the Worker.

import { randomUUID } from "node:crypto";
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import { Provider, Storage } from "accounts/cli";
import { Mppx, tempo } from "mppx/client";
import { Challenge } from "mppx";
import { Battle } from "../dist/engine.mjs";
import {
  PRESETS,
  packChallenge,
  stats,
  unpackChallenge,
  validate,
} from "../dist/data.mjs";
import { validateEscrowPlan } from "./tempo-wallet-mcp.mjs";

export const DEFAULT_AGENT_BASE_URL =
  "https://warmachine.live";
export const TEMPO_CHAIN_ID = 4217;
export const PATHUSD_DECIMALS = 6;
export const TEMPO_USDC_TOKEN =
  "0x20C000000000000000000000b9537d11c60E8b50";
export const DEFAULT_TEMPO_INPUT_TOKENS = Object.freeze([
  "0x20C0000000000000000000000000000000000000",
  TEMPO_USDC_TOKEN,
]);
export const DEFAULT_SCREEN_SEEDS = Object.freeze([
  1,
  7,
  42,
  1337,
  1891596337,
]);

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const DEFAULT_BATTLE_WORKERS = Math.min(12, Math.max(1, availableParallelism()));

const randomKey = (prefix) =>
  `${prefix}_${randomUUID().replaceAll("-", "")}`.slice(0, 100);

export function pathUsdUnits(value) {
  const raw = typeof value === "number" ? String(value) : String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(raw))
    throw new Error("pathUSD amounts must be non-negative decimals with at most 6 places.");
  const [whole, fraction = ""] = raw.split(".");
  return BigInt(whole) * 10n ** 6n + BigInt(fraction.padEnd(6, "0"));
}

function signedPathUsdUnits(value) {
  const raw = typeof value === "number" ? String(value) : String(value ?? "").trim();
  if (!/^-?\d+(?:\.\d{1,6})?$/.test(raw))
    throw new Error("pathUSD amounts must be decimals with at most 6 places.");
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole, fraction = ""] = unsigned.split(".");
  const units = BigInt(whole) * 10n ** 6n + BigInt(fraction.padEnd(6, "0"));
  return negative ? -units : units;
}

const displayUnits = (units) => {
  const whole = units / 10n ** 6n;
  const fraction = (units % 10n ** 6n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}`;
};

const errorFrom = (status, body) => {
  const message =
    typeof body?.error === "string"
      ? body.error
      : typeof body?.message === "string"
        ? body.message
        : `War Machines request failed with HTTP ${status}.`;
  const error = new Error(message);
  error.status = status;
  error.body = body;
  return error;
};

async function jsonResponse(response) {
  const raw = await response.text();
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = { raw: raw.slice(0, 2000) };
  }
  if (!response.ok) throw errorFrom(response.status, body);
  return body;
}

function normalizedBaseUrl(value) {
  const url = new URL(value || DEFAULT_AGENT_BASE_URL);
  if (!/^https?:$/.test(url.protocol))
    throw new Error("baseUrl must use http or https.");
  return url.href.replace(/\/$/, "");
}

function rankPair(left, right) {
  if (left.netUnits !== right.netUnits)
    return left.netUnits > right.netUnits ? -1 : 1;
  const leftRatio = left.rewardUnits * right.entryUnits;
  const rightRatio = right.rewardUnits * left.entryUnits;
  if (leftRatio !== rightRatio) return leftRatio > rightRatio ? -1 : 1;
  if (left.rewardUnits !== right.rewardUnits)
    return left.rewardUnits > right.rewardUnits ? -1 : 1;
  if (left.entryUnits !== right.entryUnits)
    return left.entryUnits < right.entryUnits ? -1 : 1;
  return String(left.id).localeCompare(String(right.id));
}

/** Rank only public, funded, open scouts. No wallet or network side effects. */
export function rankBounties(
  bounties,
  { maxEntry = "1.00", titleQuery = "", now = Date.now() } = {},
) {
  const maximum = pathUsdUnits(maxEntry);
  const query = String(titleQuery).trim().toLowerCase();
  return (Array.isArray(bounties) ? bounties : [])
    .filter((bounty) => {
      if (!bounty || bounty.status !== "open" || bounty.funded === false) return false;
      if (query && !String(bounty.title || "").toLowerCase().includes(query)) return false;
      if (bounty.expires && Number(bounty.expires) <= now) return false;
      try {
        return pathUsdUnits(bounty.entry) <= maximum;
      } catch {
        return false;
      }
    })
    .map((bounty) => {
      const entryUnits = pathUsdUnits(bounty.entry);
      const rewardUnits = pathUsdUnits(bounty.reward);
      const payoutUnits = pathUsdUnits(bounty.payout || bounty.reward);
      const netUnits = signedPathUsdUnits(
        bounty.netIfWin ?? displayUnits(payoutUnits - entryUnits),
      );
      return {
        ...bounty,
        entryUnits,
        rewardUnits,
        payoutUnits,
        netUnits,
        score: Number(netUnits) / 10 ** PATHUSD_DECIMALS,
      };
    })
    .sort(rankPair);
}

function candidateBlueprints(defender, locked = unpackChallenge(defender)) {
  return PRESETS.map((machine, index) => {
    const issues = validate(machine, locked.rules);
    return {
      index,
      machine,
      packed: packChallenge(machine, locked.arena, 0, locked.rules, locked.objective || "reactor"),
      stats: stats(machine),
      issues,
    };
  }).filter((candidate) => candidate.issues.length === 0);
}

function compareCandidates(left, right) {
  return (
    right.wins - left.wins ||
    right.draws - left.draws ||
    right.meanIntegrity - left.meanIntegrity ||
    left.meanTime - right.meanTime ||
    left.stats.cost - right.stats.cost
  );
}

function summarizeCandidate(candidate, results) {
  const wins = results.filter((result) => result.winner === 0).length;
  const draws = results.filter((result) => result.winner < 0).length;
  const meanIntegrity = results.length
    ? results.reduce((total, result) => total + Number(result.integrity?.[0] || 0), 0) /
      results.length
    : 0;
  const meanTime =
    results.length
      ? results.reduce((total, result) => total + Number(result.time || 100), 0) / results.length
      : 100;
  return {
    ...candidate,
    wins,
    draws,
    losses: results.length - wins - draws,
    meanIntegrity,
    meanTime,
    results,
  };
}

function scoreCandidate(
  candidate,
  locked,
  seedList,
  existingResults = [],
  deadlineMs = Number.POSITIVE_INFINITY,
) {
  const seenSeeds = new Set(existingResults.map((result) => result.seed));
  const results = existingResults.slice();
  for (const seed of seedList.filter((value) => !seenSeeds.has(value))) {
    if (Date.now() >= deadlineMs) break;
    results.push((() => {
        const result = new Battle(
          candidate.machine,
          locked.machine,
          locked.arena,
          seed,
          { mode: "auto", swapSpawns: !!(seed & 1), objective: locked.objective || "reactor" },
        ).run();
        return { seed, winner: result.winner, time: result.time, integrity: result.integrity };
      })());
  }
  return summarizeCandidate(candidate, results);
}

function prepareCounterSearch(
  defender,
  {
    seeds = DEFAULT_SCREEN_SEEDS,
    maxCandidates = 12,
    initialSeeds = 2,
    shortlist = 3,
  } = {},
) {
  const locked = unpackChallenge(defender);
  const seedList = [...new Set([...seeds].map(Number))];
  if (
    !seedList.length ||
    seedList.some((seed) => !Number.isInteger(seed) || seed < 0 || seed > 4294967295)
  )
    throw new Error("screen seeds must be uint32 integers.");
  if (!Number.isInteger(initialSeeds) || initialSeeds < 1)
    throw new Error("initialSeeds must be a positive integer.");
  if (!Number.isInteger(shortlist) || shortlist < 1)
    throw new Error("shortlist must be a positive integer.");
  const candidates = candidateBlueprints(defender, locked).slice(0, maxCandidates);
  if (!candidates.length)
    throw new Error("No legal local counter is available for the locked rules.");
  const firstSeeds = seedList.slice(0, Math.min(initialSeeds, seedList.length));
  return {
    locked,
    candidates,
    seedList,
    firstSeeds,
    shouldScreen: firstSeeds.length < seedList.length && candidates.length > shortlist,
    shortlist,
  };
}

class BattleWorkerPool {
  constructor(count) {
    this.workers = Array.from(
      { length: count },
      () => new Worker(new URL("./agent-battle-worker.mjs", import.meta.url), { type: "module" }),
    );
  }

  run(candidates, locked, seedList, { deadlineMs = Number.POSITIVE_INFINITY } = {}) {
    const results = new Array(candidates.length);
    let next = 0;
    let completed = 0;
    let settled = false;
    return new Promise((resolve, reject) => {
      const handlers = [];
      const cleanup = () => {
        for (const [worker, onMessage, onError] of handlers) {
          worker.removeListener("message", onMessage);
          worker.removeListener("error", onError);
        }
      };
      let timer;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        cleanup();
        reject(error);
      };
      const finish = () => {
        if (settled || completed !== candidates.length) return;
        settled = true;
        if (timer) clearTimeout(timer);
        cleanup();
        resolve(results);
      };
      if (Number.isFinite(deadlineMs)) {
        const remaining = Math.max(0, deadlineMs - Date.now());
        timer = setTimeout(async () => {
          if (settled) return;
          settled = true;
          cleanup();
          await Promise.all(this.workers.map((worker) => worker.terminate()));
          resolve(null);
        }, remaining);
      }
      const assign = (worker) => {
        if (next >= candidates.length) return;
        const index = next++;
        try {
          worker.postMessage({
            index,
            candidate: { index: candidates[index].index, machine: candidates[index].machine },
            locked: { machine: locked.machine, arena: locked.arena },
            seeds: seedList,
          });
        } catch (error) {
          fail(error);
        }
      };
      for (const worker of this.workers) {
        const onMessage = (message) => {
          if (message.error) {
            fail(new Error(message.error));
            return;
          }
          results[message.index] = message.results;
          completed += 1;
          assign(worker);
          finish();
        };
        const onError = (error) => fail(error);
        handlers.push([worker, onMessage, onError]);
        worker.on("message", onMessage);
        worker.on("error", onError);
        assign(worker);
      }
    });
  }

  close() {
    return Promise.all(this.workers.map((worker) => worker.terminate()));
  }
}

function scoreCandidatesParallel(pool, candidates, locked, seedList, deadlineMs) {
  if (pool) return pool.run(candidates, locked, seedList, { deadlineMs }).then((rows) =>
    rows && rows.map((results, index) => summarizeCandidate(candidates[index], results)),
  );
  return Promise.resolve(candidates.map((candidate) => scoreCandidate(candidate, locked, seedList)));
}

/**
 * Fast deterministic matchup sweep. The official seed remains server-chosen;
 * this selects the most robust legal preset over a small fixed seed set. The
 * first pass scores every candidate on a small seed sample, then expands only
 * the shortlist across the remaining seeds. This keeps the agent responsive
 * without changing the deterministic tie-break rules for finalists.
 */
export function optimizeCounter(
  defender,
  options = {},
) {
  const { locked, candidates, seedList, firstSeeds, shouldScreen, shortlist } =
    prepareCounterSearch(defender, options);
  const deadlineMs = options.deadlineMs ?? Number.POSITIVE_INFINITY;
  let rows;
  let evaluatedMatches;
  if (Date.now() >= deadlineMs) {
    const selected = summarizeCandidate(candidates[0], []);
    return {
      locked,
      selected,
      candidates: [selected],
      evaluatedMatches: 0,
      screening: { initialSeeds: 0, shortlist: 1, totalSeeds: seedList.length, fallback: true },
    };
  }
  if (!shouldScreen) {
    rows = candidates.map((candidate) => scoreCandidate(candidate, locked, seedList, [], deadlineMs));
    evaluatedMatches = candidates.length * seedList.length;
  } else {
    const screened = candidates.map((candidate) =>
      scoreCandidate(candidate, locked, firstSeeds, [], deadlineMs),
    );
    const finalistIndexes = new Set(
      [...screened].sort(compareCandidates).slice(0, shortlist).map((row) => row.index),
    );
    const remainingSeeds = seedList.slice(firstSeeds.length);
    rows = screened.map((row) =>
      finalistIndexes.has(row.index)
        ? scoreCandidate(row, locked, remainingSeeds, row.results, deadlineMs)
        : row,
    );
    evaluatedMatches =
      candidates.length * firstSeeds.length + finalistIndexes.size * remainingSeeds.length;
  }
  rows.sort(compareCandidates);
  return {
    locked,
    selected: rows[0],
    candidates: rows,
    evaluatedMatches,
    screening: {
      initialSeeds: firstSeeds.length,
      shortlist: shouldScreen ? Math.min(shortlist, candidates.length) : candidates.length,
      totalSeeds: seedList.length,
      ...(Date.now() >= deadlineMs ? { fallback: true } : {}),
    },
  };
}

/**
 * Node-only version of the deterministic sweep. Matchups are independent, so
 * the agent runner evaluates them in a small worker pool while retaining the
 * same screening and tie-break policy as optimizeCounter.
 */
export async function optimizeCounterParallel(defender, options = {}) {
  const {
    locked,
    candidates,
    seedList,
    firstSeeds,
    shouldScreen,
    shortlist,
  } = prepareCounterSearch(defender, options);
  const deadlineMs = options.deadlineMs ?? Number.POSITIVE_INFINITY;
  if (Date.now() >= deadlineMs) {
    const selected = summarizeCandidate(candidates[0], []);
    return {
      locked,
      selected,
      candidates: [selected],
      evaluatedMatches: 0,
      screening: { initialSeeds: 0, shortlist: 1, totalSeeds: seedList.length, fallback: true },
    };
  }
  // A deadline is a caller safety boundary. Keep the work in this thread so
  // every matchup can observe it before starting another simulation.
  const workerCount = options.workerCount;
  const count = Math.min(
    candidates.length,
    Math.max(1, Math.floor(workerCount || DEFAULT_BATTLE_WORKERS)),
  );
  const pool = count > 1 ? new BattleWorkerPool(count) : null;
  let rows;
  let evaluatedMatches;
  try {
    if (!shouldScreen) {
      rows = pool
        ? await scoreCandidatesParallel(pool, candidates, locked, seedList, deadlineMs)
        : candidates.map((candidate) => scoreCandidate(candidate, locked, seedList, [], deadlineMs));
      if (!rows) {
        const selected = summarizeCandidate(candidates[0], []);
        return { locked, selected, candidates: [selected], evaluatedMatches: 0, screening: { initialSeeds: 0, shortlist: 1, totalSeeds: seedList.length, fallback: true } };
      }
      evaluatedMatches = candidates.length * seedList.length;
    } else {
      const screened = pool
        ? await scoreCandidatesParallel(pool, candidates, locked, firstSeeds, deadlineMs)
        : candidates.map((candidate) => scoreCandidate(candidate, locked, firstSeeds, [], deadlineMs));
      if (!screened) {
        const selected = summarizeCandidate(candidates[0], []);
        return { locked, selected, candidates: [selected], evaluatedMatches: 0, screening: { initialSeeds: 0, shortlist: 1, totalSeeds: seedList.length, fallback: true } };
      }
      const finalistIndexes = new Set(
        [...screened].sort(compareCandidates).slice(0, shortlist).map((row) => row.index),
      );
      const remainingSeeds = seedList.slice(firstSeeds.length);
      const finalists = candidates.filter((candidate) => finalistIndexes.has(candidate.index));
      const expanded = pool
        ? await scoreCandidatesParallel(pool, finalists, locked, remainingSeeds, deadlineMs)
        : finalists.map((candidate) => scoreCandidate(candidate, locked, remainingSeeds, [], deadlineMs));
      if (!expanded) {
        const selected = summarizeCandidate(candidates[0], []);
        return { locked, selected, candidates: [selected], evaluatedMatches: 0, screening: { initialSeeds: 0, shortlist: 1, totalSeeds: seedList.length, fallback: true } };
      }
      const expandedByIndex = new Map(expanded.map((row) => [row.index, row.results]));
      rows = screened.map((row) =>
        finalistIndexes.has(row.index)
          ? summarizeCandidate(row, row.results.concat(expandedByIndex.get(row.index)))
          : row,
      );
      evaluatedMatches =
        candidates.length * firstSeeds.length + finalists.length * remainingSeeds.length;
    }
    rows.sort(compareCandidates);
    return {
      locked,
      selected: rows[0],
      candidates: rows,
      evaluatedMatches,
      screening: {
        initialSeeds: firstSeeds.length,
        shortlist: shouldScreen ? Math.min(shortlist, candidates.length) : candidates.length,
        totalSeeds: seedList.length,
        ...(Date.now() >= deadlineMs ? { fallback: true } : {}),
      },
    };
  } finally {
    await pool?.close();
  }
}

export function createTempoWallet({ storagePath } = {}) {
  const storage = storagePath
    ? Storage.filesystem({ path: storagePath })
    : Storage.filesystem();
  return Provider.create({
    // Do not let accounts/cli replace global fetch: MPP-aware HTTP is scoped
    // to the client below, while RPC calls must remain ordinary RPC calls.
    mpp: { mode: "pull", polyfill: false },
    storage,
    open() {
      throw new Error(
        "Tempo Wallet is not connected. Authorize the access key once, then retry the agent command.",
      );
    },
  });
}

function mppInputTokens(value) {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error("Discovery did not advertise an authoritative Tempo input-token allowlist.");
  const values = value;
  const seen = new Set();
  const tokens = [];
  for (const value of values) {
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value))
      throw new Error("Discovery advertised an invalid Tempo input token.");
    const token = value.toLowerCase();
    if (!seen.has(token)) {
      seen.add(token);
      tokens.push(value);
    }
  }
  return tokens;
}

/**
 * Create an MPP client that can pay the server's canonical pathUSD charge
 * from any operator-allowlisted Tempo stablecoin. mppx inserts an approve +
 * DEX buy before the exact pathUSD transfer and keeps the whole payment
 * atomic; if no route or balance exists it fails before broadcasting.
 */
export function createMppClient(
  wallet,
  {
    supportedInputTokens,
    swapSlippageBps = 100,
    expectedRecipient,
    expectedAmount,
    expectedExternalId,
    expectedExternalIdPrefix,
    expectedResumeExternalId,
    expectedMeta,
  } = {},
) {
  const slippage = Number(swapSlippageBps);
  if (!Number.isInteger(slippage) || slippage < 0 || slippage > 500)
    throw new Error("swapSlippageBps must be a whole number from 0 to 500.");
  const recipient = expectedRecipient?.toLowerCase();
  if (recipient !== undefined && !/^0x[0-9a-f]{40}$/.test(recipient))
    throw new Error("The MPP recipient is not a valid Tempo address.");
  if (expectedAmount !== undefined && !/^\d+$/.test(String(expectedAmount)))
    throw new Error("The expected MPP amount must be integer token units.");
  return Mppx.create({
    methods: [
      tempo.charge({
        ...wallet.getMppxParameters(),
        expectedChainId: TEMPO_CHAIN_ID,
        expectedRecipients: recipient ? [recipient] : undefined,
        mode: "pull",
        autoSwap: {
          tokenIn: mppInputTokens(supportedInputTokens),
          slippage: slippage / 100,
        },
      }),
    ],
    onChallenge: async (challenge, helpers) => {
      Challenge.Schema.parse(challenge);
      if (challenge.method !== "tempo" || challenge.intent !== "charge")
        throw new Error("War Machines requires an MPP Tempo charge challenge.");
      const request = challenge.request || {};
      if (String(request.currency || "").toLowerCase() !==
          "0x20c0000000000000000000000000000000000000")
        throw new Error("The MPP challenge currency is not pathUSD.");
      if (recipient && String(request.recipient || "").toLowerCase() !== recipient)
        throw new Error("The MPP challenge recipient does not match discovery.");
      const zeroValueResume =
        String(request.amount) === "0" &&
        expectedResumeExternalId &&
        String(request.externalId || "") === expectedResumeExternalId &&
        challenge.meta?.kind === "agent-auth";
      if (
        expectedExternalId &&
        !zeroValueResume &&
        String(request.externalId || "") !== expectedExternalId
      )
        throw new Error("The MPP challenge operation is not bound to this request.");
      if (
        expectedAmount !== undefined &&
        String(request.amount) !== String(expectedAmount) &&
        !zeroValueResume
      )
        throw new Error("The MPP challenge amount does not match the requested operation.");
      if (
        expectedExternalIdPrefix &&
        !zeroValueResume &&
        !String(request.externalId || "").startsWith(expectedExternalIdPrefix)
      )
        throw new Error("The MPP challenge operation is not bound to this route.");
      if (expectedMeta && !zeroValueResume) {
        for (const [key, value] of Object.entries(expectedMeta)) {
          if (String(challenge.meta?.[key] ?? request.meta?.[key] ?? "") !== String(value))
            throw new Error(`The MPP challenge metadata is not bound to ${key}.`);
        }
      }
      // Challenge.fromResponse and tempo.charge perform the SDK's schema,
      // expiry and chain checks; only after those checks ask the wallet to sign.
      return helpers.createCredential();
    },
    maxPaymentRetries: 1,
    polyfill: false,
  });
}

async function apiJson(mppx, baseUrl, path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("accept", "application/json");
  const response = await mppx.fetch(`${baseUrl}${path}`, { ...init, headers });
  return jsonResponse(response);
}

function agentOperationExternalId(method, pathname, { idempotencyKey, body } = {}) {
  const upper = String(method || "GET").toUpperCase();
  let match = pathname.match(/^\/api\/attempts\/([a-f0-9-]{36})\/(retry|deploy|forfeit)$/);
  if (match && upper === "POST") {
    const prefix = match[2] === "retry" ? "agent-technical-retry" : `agent-${match[2]}`;
    return `${prefix}:${match[1]}:${idempotencyKey || "missing"}`;
  }
  match = pathname.match(/^\/api\/attempts\/([a-f0-9-]{36})\/settlement-confirm$/);
  if (match && upper === "POST")
    return `agent-settle:${match[1]}:${body?.transactionHash || ""}`;
  match = pathname.match(/^\/api\/bounties\/([a-f0-9-]{36})\/(cancel|expire|timeout-forfeit)$/);
  if (match && upper === "POST")
    return `agent-control:${match[2]}:${match[1]}:${idempotencyKey || "missing"}`;
  match = pathname.match(/^\/api\/escrow\/intents\/([a-f0-9-]{36})\/confirm$/);
  if (match && upper === "POST")
    return `agent-confirm:${match[1]}:${body?.transactionHash || ""}`;
  return `agent-private:${upper}:${pathname}`;
}

/** Make one authenticated REST call with a zero-value MPP proof when needed. */
export async function requestAgentApi(
  wallet,
  { baseUrl = DEFAULT_AGENT_BASE_URL, path, method = "GET", body, idempotencyKey } = {},
) {
  if (!wallet) throw new Error("A connected local Tempo wallet is required.");
  const base = normalizedBaseUrl(baseUrl);
  const discovery = await jsonResponse(
    await fetch(`${base}/.well-known/war-machines.json`, { headers: { accept: "application/json" } }),
  );
  if (discovery.mode !== "tempo-mainnet" || discovery.payments?.enabled !== true)
    throw new Error("The selected War Machines origin is not an enabled Tempo mainnet deployment.");
  if (discovery.payments.identityProofAvailable !== true)
    throw new Error("This origin does not advertise free MPP identity proofs for agent API access.");
  const mppRoute = discovery.payments.mppRoutes?.[0];
  const recipient = mppRoute?.recipient || discovery.payments.mppRecipient;
  if (!recipient)
    throw new Error("Discovery did not publish a bounded MPP recipient for authenticated agent access.");
  const requestUrl = new URL(path, `${base}/`),
    expectedExternalId = agentOperationExternalId(method, requestUrl.pathname, { idempotencyKey, body });
  const mppx = createMppClient(wallet, {
    supportedInputTokens: discovery.payments.supportedInputTokens,
    swapSlippageBps: discovery.payments.swap?.slippageBps,
    expectedRecipient: recipient,
    expectedAmount: "0",
    expectedExternalId,
  });
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (idempotencyKey !== undefined) headers["idempotency-key"] = idempotencyKey;
  return apiJson(mppx, base, path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function retryRequest(operation, { attempts = 4, delay = 250, shouldRetry } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt + 1 >= attempts || !shouldRetry?.(error)) throw error;
      await sleep(delay * 2 ** attempt);
    }
  }
  throw lastError;
}

const transientConfirm = (error) =>
  [409, 425, 429, 500, 502, 503, 504].includes(error?.status) &&
  !/different|mismatch|expired|invalid|not found/i.test(error?.message || "");

const transientDeployRace = (error) =>
  error?.status === 409 && /already deployed|another request|race/i.test(error.message || "");

const staleEntry = (error) =>
  error?.status === 409 &&
  /busy|closed|expired|not open|another challenger|not backed/i.test(error.message || "");

const staleChainEntry = (error) =>
  /BountyNotOpen|bounty.{0,24}(closed|expired|not open|active)|already.{0,16}attempt/i.test(
    error?.message || "",
  );

function walletTransactionRequest(from, checked) {
  return {
    from,
    chainId: TEMPO_CHAIN_ID,
    feeToken: checked.token,
    calls: checked.calls.map((call) => ({ ...call, value: 0n })),
  };
}

async function sendExactPlan(wallet, from, plan, maxSpend, escrow) {
  const checked = validateEscrowPlan(plan, { maxSpend, escrow });
  const transaction = walletTransactionRequest(from, checked);
  // eth_fillTransaction estimates the exact atomic call without broadcasting;
  // it catches stale API scouts and access-key policy failures before spend.
  await wallet.request({ method: "eth_fillTransaction", params: [transaction] });
  return wallet.request({
    method: "eth_sendTransaction",
    params: [transaction],
  });
}

async function connectedAccount(wallet) {
  const [accounts, chain] = await Promise.all([
    wallet.request({ method: "eth_accounts" }),
    wallet.request({ method: "eth_chainId" }),
  ]);
  if (!Array.isArray(accounts) || !accounts[0])
    throw new Error("No connected Tempo wallet account is available.");
  if (Number.parseInt(chain, 16) !== TEMPO_CHAIN_ID)
    throw new Error("The connected Tempo wallet is not on Tempo mainnet (4217).");
  return accounts[0];
}

function safeSummary(bounty) {
  return {
    id: bounty.id,
    title: bounty.title,
    entry: bounty.entry,
    reward: bounty.reward,
    payout: bounty.payout,
    netIfWin: bounty.netIfWin,
    scout: bounty.scout,
    score: bounty.score,
  };
}

export function terminalPaymentMode(attempt) {
  const payment = attempt?.payment || {};
  const paid =
    ["settled", "refunded"].includes(attempt?.status) &&
    payment.finalized === true &&
    !payment.technicalFailure;
  if (paid) return "paid";
  if (payment.technicalFailure || payment.retryAvailable) return "technical-recovery";
  if (["awaiting-signatures", "ready-to-settle", "queued", "running"].includes(attempt?.status))
    return "awaiting-settlement";
  if (attempt?.status === "refunded") return "lost";
  return "monitoring-timeout";
}

/** Run discovery → rank → preflight → enter → optimize → deploy → monitor. */
export async function runOptimalBounty({
  wallet,
  baseUrl = DEFAULT_AGENT_BASE_URL,
  maxEntry = "1.00",
  titleQuery = "",
  dryRun = false,
  participantName,
  showAddress = false,
  screenSeeds = DEFAULT_SCREEN_SEEDS,
  pollSeconds = 45,
} = {}) {
  if (!wallet) throw new Error("A connected local Tempo wallet is required.");
  const base = normalizedBaseUrl(baseUrl);
  pathUsdUnits(maxEntry);
  const [discoveryResponse, bountiesResponse, rulesResponse] = await Promise.all([
    fetch(`${base}/.well-known/war-machines.json`, {
      headers: { accept: "application/json" },
    }),
    fetch(`${base}/api/bounties`, { headers: { accept: "application/json" } }),
    fetch(`${base}/api/rules`, { headers: { accept: "application/json" } }),
  ]);
  const discovery = await jsonResponse(discoveryResponse);
  const rules = await jsonResponse(rulesResponse);
  if (discovery.mode !== "tempo-mainnet" || discovery.payments?.enabled !== true)
    throw new Error("The selected War Machines origin is not an enabled Tempo mainnet deployment.");
  if (
    discovery.payments.chainId !== TEMPO_CHAIN_ID ||
    String(discovery.payments.token).toLowerCase() !==
      "0x20c0000000000000000000000000000000000000" ||
    discovery.payments.directEscrow !== true
  )
    throw new Error("Discovery failed the pinned Tempo chain, token or escrow checks.");
  if (!dryRun && discovery.payments.acceptingNewBounties !== true)
    throw new Error("The live escrow is recovery-only; refusing to start a new paid entry.");
  if (
    discovery.versions?.hash &&
    rules.versions?.hash &&
    discovery.versions.hash !== rules.versions.hash
  )
    throw new Error("The live engine hash changed between discovery and rules; refusing to spend.");

  const bounties = await jsonResponse(bountiesResponse);
  const ranked = rankBounties(bounties, { maxEntry, titleQuery });
  if (!ranked.length)
    return {
      mode: "no-open-bounty",
      baseUrl: base,
      reason: "No funded open bounty matched the entry cap and title filter.",
      maxEntry,
    };
  if (dryRun)
    return {
      mode: "dry-run",
      baseUrl: base,
      maxEntry,
      ranked: ranked.map(safeSummary),
      selected: safeSummary(ranked[0]),
    };

  const inputTokens = discovery.payments.supportedInputTokens;
  const mppRoute = discovery.payments.mppRoutes?.find(
    (route) => route.path === "/api/bounties/{id}/attempts" && route.method === "POST",
  );
  const mppRecipient = mppRoute?.recipient || discovery.payments.mppRecipient;
  if (discovery.payments.mpp && !mppRecipient)
    throw new Error("Discovery did not bind the paid entry route to an MPP recipient.");
  const mppOptions = {
    supportedInputTokens: inputTokens,
    swapSlippageBps: discovery.payments.swap?.slippageBps,
    expectedRecipient: mppRecipient,
    expectedAmount: "0",
  };
  const from = await connectedAccount(wallet);
  const skipped = [];
  let entry;
  let selectedBounty;
  for (const bounty of ranked) {
    const key = randomKey("wm_enter");
    const mppx = createMppClient(wallet, {
      ...mppOptions,
      expectedAmount: pathUsdUnits(bounty.entry).toString(),
      expectedExternalIdPrefix: "entry:",
      expectedMeta: { kind: "entry", bounty: bounty.id },
      expectedResumeExternalId: `resume:agent-bounty-entry:${bounty.id}:${key}`,
    });
    const body = {
      maxEntry,
      maxPlatformFeeBps: 250,
      ...(participantName ? { participantName } : {}),
      ...(showAddress ? { showAddress: true } : {}),
    };
    let plan;
    try {
      plan = await apiJson(mppx, base, `/api/bounties/${bounty.id}/attempts`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify(body),
      });
    } catch (error) {
      if (staleEntry(error)) {
        skipped.push({ bounty: safeSummary(bounty), reason: error.message });
        continue;
      }
      throw error;
    }
    selectedBounty = bounty;
    if (plan.direct) {
      const maxSpend = pathUsdUnits(maxEntry).toString();
      validateEscrowPlan(plan.plan, {
        maxSpend,
        escrow: discovery.payments.escrow,
      });
      let transactionHash = plan.transactionHash;
      if (!transactionHash) {
        try {
          transactionHash = await sendExactPlan(
            wallet,
            from,
            plan.plan,
            maxSpend,
            discovery.payments.escrow,
          );
        } catch (error) {
          // Public scouts and chain state can briefly disagree. The preflight
          // is read-only, so a stale on-chain bounty is safe to skip; every
          // other provider error stops before any alternate spend is attempted.
          if (!staleChainEntry(error)) throw error;
          skipped.push({ bounty: safeSummary(bounty), reason: error.message });
          continue;
        }
      }
      entry = await retryRequest(
        () =>
          apiJson(mppx, base, `/api/escrow/intents/${plan.intentId}/confirm`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ transactionHash }),
          }),
        { shouldRetry: transientConfirm },
      );
    } else {
      entry = plan;
    }
    break;
  }
  if (!entry)
    return {
      mode: "no-entry",
      baseUrl: base,
      maxEntry,
      skipped,
      ranked: ranked.map(safeSummary),
    };

  if (entry.status !== "engineering" || !entry.defender)
    throw new Error("The confirmed entry did not reveal an engineering attempt and defender.");
  if (Number(entry.build?.remainingSeconds || 0) < 30)
    throw new Error("The confirmed bounty left less than 30 seconds to deploy a safe counter.");

  const buildDeadline = Number(entry.build?.deadline || 0);
  const searchDeadline = buildDeadline > 0 ? buildDeadline - 5_000 : Number.POSITIVE_INFINITY;
  const optimized = await optimizeCounterParallel(entry.defender, {
    seeds: screenSeeds,
    deadlineMs: searchDeadline,
  });
  if (buildDeadline > 0 && Date.now() >= buildDeadline)
    throw new Error("The engineering deadline elapsed before a counter could be submitted.");
  const deployKey = randomKey("wm_deploy");
  const mppx = createMppClient(wallet, {
    ...mppOptions,
    expectedExternalId: `agent-deploy:${entry.id}:${deployKey}`,
  });
  const deployBody = { blueprint: optimized.selected.packed };
  let attempt = await retryRequest(
    () =>
      apiJson(mppx, base, `/api/attempts/${entry.id}/deploy`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": deployKey },
        body: JSON.stringify(deployBody),
      }),
    { shouldRetry: transientDeployRace },
  );

  const deadline = Date.now() + Math.max(0, Math.min(Number(pollSeconds), 90)) * 1000;
  let pollDelay = 250;
  while (
    !["settled", "refunded"].includes(attempt.status) &&
    Date.now() < deadline
  ) {
    await sleep(pollDelay);
    pollDelay = Math.min(1000, pollDelay * 2);
    attempt = await retryRequest(
      () =>
        apiJson(mppx, base, `/api/attempts/${entry.id}/deploy`, {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": deployKey },
          body: JSON.stringify(deployBody),
        }),
      { shouldRetry: transientDeployRace },
    );
  }
  const finalPayment = attempt.payment || {};
  const mode = terminalPaymentMode(attempt);
  const paid = mode === "paid";
  return {
    mode,
    completed: paid,
    baseUrl: base,
    wallet: from,
    bounty: safeSummary(selectedBounty),
    entry: {
      attemptId: entry.id,
      entryTransactionHash: entry.payment?.entryTransactionHash || null,
    },
    counter: {
      name: optimized.selected.machine.name,
      stats: optimized.selected.stats,
      wins: optimized.selected.wins,
      draws: optimized.selected.draws,
      losses: optimized.selected.losses,
      screenSeeds: optimized.selected.results.map((result) => result.seed),
    },
    attempt: {
      id: attempt.id,
      status: attempt.status,
      result: attempt.result || null,
      payment: attempt.payment || null,
      error: attempt.error || null,
    },
    skipped,
  };
}
