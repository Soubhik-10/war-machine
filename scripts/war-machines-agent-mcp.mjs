// Local MCP facade: one tool for the complete wallet-backed bounty workflow.
// Launch this in the same environment as the authorized Tempo Wallet store.

import { createInterface } from "node:readline";
import {
  createTempoWallet,
  requestAgentApi,
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
  {
    name: "war_machines_get_attempt",
    description: "Inspect an authorized attempt and its payment or retry state.",
    inputSchema: {
      type: "object",
      properties: { baseUrl: { type: "string" }, attemptId: { type: "string" } },
      required: ["attemptId"],
      additionalProperties: false,
    },
  },
  {
    name: "war_machines_retry_attempt",
    description: "Use one sponsored retry after an infrastructure settlement timeout.",
    inputSchema: {
      type: "object",
      properties: { baseUrl: { type: "string" }, attemptId: { type: "string" }, idempotencyKey: { type: "string" } },
      required: ["attemptId", "idempotencyKey"],
      additionalProperties: false,
    },
  },
  {
    name: "war_machines_list_builds",
    description: "List the authenticated account's saved blueprint vault.",
    inputSchema: { type: "object", properties: { baseUrl: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "war_machines_save_build",
    description: "Save a blueprint in the authenticated account's vault.",
    inputSchema: {
      type: "object",
      properties: { baseUrl: { type: "string" }, name: { type: "string" }, blueprint: { type: "object" }, idempotencyKey: { type: "string" } },
      required: ["name", "blueprint", "idempotencyKey"],
      additionalProperties: false,
    },
  },
  {
    name: "war_machines_update_build",
    description: "Replace one saved blueprint in the authenticated account's vault.",
    inputSchema: {
      type: "object",
      properties: { baseUrl: { type: "string" }, buildId: { type: "string" }, name: { type: "string" }, blueprint: { type: "object" }, idempotencyKey: { type: "string" } },
      required: ["buildId", "name", "blueprint", "idempotencyKey"],
      additionalProperties: false,
    },
  },
  {
    name: "war_machines_delete_build",
    description: "Delete one saved blueprint from the authenticated account's vault.",
    inputSchema: {
      type: "object",
      properties: { baseUrl: { type: "string" }, buildId: { type: "string" } },
      required: ["buildId"],
      additionalProperties: false,
    },
  },
  {
    name: "war_machines_list_bookmarks",
    description: "List the authenticated account's bounty bookmarks.",
    inputSchema: { type: "object", properties: { baseUrl: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "war_machines_save_bookmark",
    description: "Bookmark a bounty for the authenticated account.",
    inputSchema: {
      type: "object",
      properties: { baseUrl: { type: "string" }, bountyId: { type: "string" } },
      required: ["bountyId"],
      additionalProperties: false,
    },
  },
  {
    name: "war_machines_remove_bookmark",
    description: "Remove a bounty bookmark from the authenticated account.",
    inputSchema: {
      type: "object",
      properties: { baseUrl: { type: "string" }, bountyId: { type: "string" } },
      required: ["bountyId"],
      additionalProperties: false,
    },
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
  const baseUrl = args.baseUrl || DEFAULT_AGENT_BASE_URL;
  if (name === "war_machines_get_attempt")
    return requestAgentApi(wallet, { baseUrl, path: `/api/attempts/${args.attemptId}` });
  if (name === "war_machines_retry_attempt")
    return requestAgentApi(wallet, { baseUrl, method: "POST", path: `/api/attempts/${args.attemptId}/retry`, idempotencyKey: args.idempotencyKey, body: {} });
  if (name === "war_machines_list_builds")
    return requestAgentApi(wallet, { baseUrl, path: "/api/me/builds" });
  if (name === "war_machines_save_build")
    return requestAgentApi(wallet, { baseUrl, method: "POST", path: "/api/me/builds", idempotencyKey: args.idempotencyKey, body: { name: args.name, blueprint: args.blueprint } });
  if (name === "war_machines_update_build")
    return requestAgentApi(wallet, { baseUrl, method: "PATCH", path: `/api/me/builds/${args.buildId}`, idempotencyKey: args.idempotencyKey, body: { name: args.name, blueprint: args.blueprint } });
  if (name === "war_machines_delete_build")
    return requestAgentApi(wallet, { baseUrl, method: "DELETE", path: `/api/me/builds/${args.buildId}` });
  if (name === "war_machines_list_bookmarks")
    return requestAgentApi(wallet, { baseUrl, path: "/api/me/bookmarks" });
  if (name === "war_machines_save_bookmark")
    return requestAgentApi(wallet, { baseUrl, method: "PUT", path: `/api/me/bookmarks/${args.bountyId}` });
  if (name === "war_machines_remove_bookmark")
    return requestAgentApi(wallet, { baseUrl, method: "DELETE", path: `/api/me/bookmarks/${args.bountyId}` });
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
