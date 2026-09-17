// One-call War Machines agent workflow.
//
// This module deliberately keeps wallet signing local. The Worker can issue a
// zero-value MPP proof, but it must never receive authority to spend the
// caller's wallet. The local runner uses the same Tempo access-key provider to
// preflight and sign the exact escrow plan returned by the Worker.

import { randomUUID } from "node:crypto";
import { Provider, Storage } from "accounts/cli";
import { Mppx, tempo } from "mppx/client";
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
  "https://war-machine.sssmpp.chatgpt.site";
export const TEMPO_CHAIN_ID = 4217;
export const PATHUSD_DECIMALS = 6;
export const DEFAULT_SCREEN_SEEDS = Object.freeze([
  1,
  7,
  42,
  1337,
  1891596337,
]);

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

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

function candidateBlueprints(defender) {
  const locked = unpackChallenge(defender);
  return PRESETS.map((machine, index) => {
    const issues = validate(machine, locked.rules);
    return {
      index,
      machine,
      packed: packChallenge(machine, locked.arena, 0, locked.rules),
      stats: stats(machine),
      issues,
    };
  }).filter((candidate) => candidate.issues.length === 0);
}

/**
 * Fast deterministic matchup sweep. The official seed remains server-chosen;
 * this selects the most robust legal preset over a small fixed seed set.
 */
export function optimizeCounter(
  defender,
  { seeds = DEFAULT_SCREEN_SEEDS, maxCandidates = 12 } = {},
) {
  const locked = unpackChallenge(defender);
  const seedList = [...new Set(seeds)].map(Number);
  if (
    !seedList.length ||
    seedList.some((seed) => !Number.isInteger(seed) || seed < 0 || seed > 4294967295)
  )
    throw new Error("screen seeds must be uint32 integers.");
  const candidates = candidateBlueprints(defender).slice(0, maxCandidates);
  if (!candidates.length)
    throw new Error("No legal local counter is available for the locked rules.");
  const rows = candidates.map((candidate) => {
    const results = seedList.map((seed) => {
      const result = new Battle(
        candidate.machine,
        locked.machine,
        locked.arena,
        seed,
        { mode: "auto", swapSpawns: !!(seed & 1) },
      ).run();
      return { seed, winner: result.winner, time: result.time, integrity: result.integrity };
    });
    const wins = results.filter((result) => result.winner === 0).length;
    const draws = results.filter((result) => result.winner < 0).length;
    const meanIntegrity =
      results.reduce((total, result) => total + Number(result.integrity?.[0] || 0), 0) /
      results.length;
    const meanTime =
      results.reduce((total, result) => total + Number(result.time || 100), 0) /
      results.length;
    return {
      ...candidate,
      wins,
      draws,
      losses: results.length - wins - draws,
      meanIntegrity,
      meanTime,
      results,
    };
  });
  rows.sort(
    (left, right) =>
      right.wins - left.wins ||
      right.draws - left.draws ||
      right.meanIntegrity - left.meanIntegrity ||
      left.meanTime - right.meanTime ||
      left.stats.cost - right.stats.cost,
  );
  return { locked, selected: rows[0], candidates: rows };
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

export function createMppClient(wallet) {
  return Mppx.create({
    methods: [
      tempo({
        ...wallet.getMppxParameters(),
        expectedChainId: TEMPO_CHAIN_ID,
        mode: "pull",
      }),
    ],
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
  const accounts = await wallet.request({ method: "eth_accounts" });
  if (!Array.isArray(accounts) || !accounts[0])
    throw new Error("No connected Tempo wallet account is available.");
  const chain = await wallet.request({ method: "eth_chainId" });
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
  const discovery = await jsonResponse(await fetch(`${base}/.well-known/war-machines.json`));
  if (discovery.mode !== "tempo-mainnet" || discovery.payments?.enabled !== true)
    throw new Error("The selected War Machines origin is not an enabled Tempo mainnet deployment.");
  if (
    discovery.payments.chainId !== TEMPO_CHAIN_ID ||
    String(discovery.payments.token).toLowerCase() !==
      "0x20c0000000000000000000000000000000000000" ||
    discovery.payments.directEscrow !== true
  )
    throw new Error("Discovery failed the pinned Tempo chain, token or escrow checks.");

  const mppx = createMppClient(wallet);
  const bounties = await apiJson(mppx, base, "/api/bounties");
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

  const from = await connectedAccount(wallet);
  const skipped = [];
  let entry;
  let selectedBounty;
  for (const bounty of ranked) {
    const key = randomKey("wm_enter");
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

  const optimized = optimizeCounter(entry.defender, { seeds: screenSeeds });
  const deployKey = randomKey("wm_deploy");
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
  while (
    !["settled", "refunded", "ready-to-settle", "awaiting-signatures"].includes(attempt.status) &&
    Date.now() < deadline
  ) {
    await sleep(1000);
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
  return {
    mode: "completed",
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
