// Baseline/after benchmark for the agent-facing path.
// No benchmark case broadcasts a wallet transaction or sends a paid MPP
// credential. The live cases are discovery, public listing, and one unpaid
// 402 challenge only.

import { performance } from "node:perf_hooks";
import { Mppx, tempo as mppTempo } from "mppx/client";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, custom } from "viem";
import { tempo as tempoChain } from "viem/tempo/chains";
import { handleMcpRequest } from "../server/mcp.mjs";
import { Battle } from "../dist/engine.mjs";
import { PRESETS, packChallenge } from "../dist/data.mjs";
import {
  DEFAULT_AGENT_BASE_URL,
  DEFAULT_SCREEN_SEEDS,
  optimizeCounterParallel,
  rankBounties,
} from "./war-machines-agent.mjs";

const baseUrl = (process.env.WAR_MACHINES_API_URL || DEFAULT_AGENT_BASE_URL).replace(/\/$/, "");
const samples = Number(process.env.AGENT_BENCH_SAMPLES || 2);
const liveSamples = Number(process.env.AGENT_BENCH_LIVE_SAMPLES || 3);

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function summary(name, values, extra = {}) {
  return {
    name,
    samples: values.length,
    minMs: Math.round(Math.min(...values) * 100) / 100,
    medianMs: Math.round(percentile(values, 0.5) * 100) / 100,
    p95Ms: Math.round(percentile(values, 0.95) * 100) / 100,
    maxMs: Math.round(Math.max(...values) * 100) / 100,
    ...extra,
  };
}

async function measure(name, operation, count = samples, extra = {}) {
  const values = [];
  for (let index = 0; index < count; index += 1) {
    const started = performance.now();
    await operation(index);
    values.push(performance.now() - started);
  }
  return summary(name, values, extra);
}

function measureSync(name, operation, count = samples, extra = {}) {
  const values = [];
  for (let index = 0; index < count; index += 1) {
    const started = performance.now();
    operation(index);
    values.push(performance.now() - started);
  }
  return summary(name, values, extra);
}

function encodeBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

async function benchmarkMppHandshake() {
  const account = privateKeyToAccount("0x" + "11".repeat(32));
  const walletClient = createWalletClient({
    account,
    chain: tempoChain,
    transport: custom({
      request: async () => {
        throw new Error("synthetic benchmark transport should not make RPC calls");
      },
    }),
  });
  const challenge =
    `Payment id="agent-benchmark", realm="benchmark.test", method="tempo", intent="charge", request="${encodeBase64Url(
      JSON.stringify({
        amount: "0",
        currency: "0x20c0000000000000000000000000000000000000",
        recipient: "0x4444444444444444444444444444444444444444",
        methodDetails: { chainId: 4217 },
      }),
    )}"`;
  let calls = 0;
  const mppx = Mppx.create({
    methods: [
      mppTempo.charge({
        account,
        getClient: async () => walletClient,
        expectedChainId: 4217,
      }),
    ],
    fetch: async () => {
      calls += 1;
      return calls === 1
        ? new Response(null, { status: 402, headers: { "www-authenticate": challenge } })
        : Response.json({ ok: true });
    },
    polyfill: false,
    maxPaymentRetries: 1,
  });
  return measure(
    "mpp_zero_proof_challenge_retry_synthetic",
    async () => {
      calls = 0;
      const response = await mppx.fetch("https://benchmark.test/api/protected");
      if (!response.ok || calls !== 2) throw new Error("synthetic MPP flow did not complete");
    },
    Math.max(1, liveSamples),
    { networkRequests: 2, spends: 0 },
  );
}

async function benchmarkLive() {
  const output = [];
  output.push(
    await measure(
      "live_discovery_get",
      async () => {
        const response = await fetch(`${baseUrl}/.well-known/war-machines.json`);
        if (!response.ok) throw new Error(`discovery HTTP ${response.status}`);
        await response.arrayBuffer();
      },
      liveSamples,
      { url: `${baseUrl}/.well-known/war-machines.json`, spends: 0 },
    ),
  );
  let discovery;
  try {
    discovery = await (await fetch(`${baseUrl}/.well-known/war-machines.json`)).json();
    output.push(
      await measure(
        "live_public_bounty_list_get",
        async () => {
          const response = await fetch(`${baseUrl}/api/bounties`);
          if (!response.ok) throw new Error(`bounty list HTTP ${response.status}`);
          await response.arrayBuffer();
        },
        liveSamples,
        { url: `${baseUrl}/api/bounties`, spends: 0 },
      ),
    );
    if (discovery.payments?.mpp) {
      output.push(
        await measure(
          "live_mpp_challenge_only",
          async (index) => {
            const response = await fetch(`${baseUrl}/api/bounties`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "idempotency-key": `agent_bench_${index.toString().padStart(8, "0")}`,
              },
              body: JSON.stringify({
                title: "Benchmark challenge",
                blueprint: packChallenge(PRESETS[0], "foundry", 0),
                entry: "0.01",
                reward: "0.01",
                hours: 1,
                listed: false,
                maxPlatformFeeBps: 250,
              }),
            });
            if (response.status !== 402) throw new Error(`expected 402, received ${response.status}`);
            await response.arrayBuffer();
          },
          liveSamples,
          { url: `${baseUrl}/api/bounties`, spends: 0, proofRetries: 0 },
        ),
      );
    }
  } catch (error) {
    output.push({ name: "live_cases", skipped: error.message });
  }
  return output;
}

const defender = packChallenge(PRESETS[0], "foundry", 0);
const fakeBounties = Array.from({ length: 100 }, (_, index) => ({
  id: `bench-${index}`,
  title: `Benchmark bounty ${index}`,
  entry: "0.01",
  reward: index % 2 ? "0.05" : "0.04",
  payout: index % 2 ? "0.04875" : "0.039",
  netIfWin: index % 2 ? "0.03875" : "0.029",
  status: "open",
  funded: true,
}));

const results = [
  measureSync(
    "local_rank_100_public_scouts",
    () => rankBounties(fakeBounties, { maxEntry: "1.00" }),
    100,
    { candidates: 100 },
  ),
  measureSync(
    "local_single_battle",
    () => new Battle(PRESETS[7], PRESETS[0], "foundry", 42, { mode: "auto", swapSpawns: false }).run(),
    Math.max(1, samples * 2),
    { candidates: 1 },
  ),
  await measure(
    "local_optimize_counter",
    () => optimizeCounterParallel(defender, { seeds: DEFAULT_SCREEN_SEEDS }),
    samples,
    { candidates: PRESETS.length, seeds: DEFAULT_SCREEN_SEEDS.length },
  ),
  await benchmarkMppHandshake(),
  ...await benchmarkLive(),
];

const mcpValues = [];
for (let index = 0; index < 100; index += 1) {
  const started = performance.now();
  const response = await handleMcpRequest(
    new Request("https://benchmark.test/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: index, method: "tools/list" }),
    }),
    async () => new Response(JSON.stringify({}), { headers: { "content-type": "application/json" } }),
  );
  await response.arrayBuffer();
  mcpValues.push(performance.now() - started);
}
results.push(summary("local_mcp_tools_list_transport", mcpValues, { samples: mcpValues.length }));

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  baseUrl,
  samples,
  liveSamples,
  results,
}, null, 2));
