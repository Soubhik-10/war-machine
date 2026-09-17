// Local MCP facade: one tool for the complete wallet-backed bounty workflow.
// Launch this in the same environment as the authorized Tempo Wallet store.

import { createInterface } from "node:readline";
import {
  createTempoWallet,
  runOptimalBounty,
  DEFAULT_AGENT_BASE_URL,
  DEFAULT_SCREEN_SEEDS,
} from "./war-machines-agent.mjs";

const json = (value) => JSON.stringify(value);
const wallet = createTempoWallet({ storagePath: process.env.WAR_MACHINES_WALLET_STORE });

const TOOLS = [
  {
    name: "war_machines_find_and_beat_optimal_bounty",
    description:
      "Discover the best funded open bounty, preflight its exact Tempo escrow entry, enter once, screen legal counters locally, deploy one idempotent counter, and monitor the result. Defaults to a 1.00 pathUSD entry ceiling; use dryRun for a read-only ranking.",
    inputSchema: {
      type: "object",
      properties: {
        baseUrl: { type: "string", description: `War Machines origin. Defaults to ${DEFAULT_AGENT_BASE_URL}.` },
        maxEntry: { type: "string", description: "Maximum entry in pathUSD. Defaults to 1.00." },
        titleQuery: { type: "string", description: "Optional case-insensitive title filter." },
        dryRun: { type: "boolean", description: "Rank only; do not enter or spend." },
        participantName: { type: "string", description: "Optional display name, up to 28 characters." },
        showAddress: { type: "boolean", description: "Opt in to showing a shortened wallet address on completion." },
        screenSeeds: { type: "array", items: { type: "integer", minimum: 0, maximum: 4294967295 }, description: "Optional fixed uint32 local matchup seeds." },
        pollSeconds: { type: "integer", minimum: 0, maximum: 90, description: "Maximum post-deploy monitoring time. Defaults to 45." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "tempo_wallet_get_connection_status",
    description: "Read the connected local Tempo wallet and chain without spending.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

const result = (id, value, isError = false) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  result: {
    content: [{ type: "text", text: json(value) }],
    structuredContent: value,
    ...(isError ? { isError: true } : {}),
  },
});

async function callTool(name, args = {}) {
  if (name === "tempo_wallet_get_connection_status") {
    const accounts = await wallet.request({ method: "eth_accounts" });
    const chainId = await wallet.request({ method: "eth_chainId" });
    return { ready: accounts.length > 0, accounts, chainId, chain: Number.parseInt(chainId, 16) };
  }
  if (name !== "war_machines_find_and_beat_optimal_bounty")
    throw new Error(`Unknown tool: ${name}`);
  return runOptimalBounty({
    wallet,
    baseUrl: args.baseUrl || DEFAULT_AGENT_BASE_URL,
    maxEntry: args.maxEntry || "1.00",
    titleQuery: args.titleQuery || "",
    dryRun: args.dryRun === true,
    participantName: args.participantName,
    showAddress: args.showAddress === true,
    screenSeeds: args.screenSeeds || DEFAULT_SCREEN_SEEDS,
    pollSeconds: args.pollSeconds ?? 45,
  });
}

async function handle(message) {
  const id = message?.id;
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string")
    return { jsonrpc: "2.0", id: id ?? null, error: { code: -32600, message: "Invalid Request." } };
  if (message.method === "notifications/initialized") return null;
  if (message.method === "ping") return { jsonrpc: "2.0", id, result: {} };
  if (message.method === "initialize")
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2025-11-25",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "war-machines-agent", version: "1.0.0" },
        instructions:
          "Use war_machines_find_and_beat_optimal_bounty for the complete flow. dryRun is read-only. Non-dry runs can spend up to maxEntry through the connected Tempo access key, after exact chain/token/escrow preflight.",
      },
    };
  if (message.method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  if (message.method !== "tools/call")
    return { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found." } };
  try {
    return result(id, await callTool(message.params?.name, message.params?.arguments || {}));
  } catch (error) {
    return result(id, { error: error?.message || String(error) }, true);
  }
}

if (process.argv[1] && process.argv[1].endsWith("war-machines-agent-mcp.mjs")) {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    const reply = await handle(JSON.parse(line));
    if (reply) process.stdout.write(`${json(reply)}\n`);
  }
}
