// Source-run Tempo wallet MCP fallback for agents.
//
// The packaged tempo-wallet binary currently crashes while loading incur's
// dynamic MCP module. This bridge uses the same accounts/cli provider as the
// official CLI, so it reuses the existing local wallet store and access-key
// limit without handling or persisting a private key.

import { createInterface } from "node:readline";
import { Provider, Storage } from "accounts/cli";
import { decodeFunctionData, keccak256, parseAbi, toBytes } from "viem";

const CHAIN_ID = 4217;
const PATHUSD = "0x20c0000000000000000000000000000000000000";
const DEFAULT_ESCROW = "0xb14a3aa99c9349094612143089f55ae5372deb24";
const MCP_VERSION = "2025-11-25";

const json = (value) => JSON.stringify(value);
const lower = (value, label) => {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value))
    throw new Error(`${label} must be a 20-byte 0x address.`);
  return value.toLowerCase();
};
const hexData = (value, label) => {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value))
    throw new Error(`${label} must be hex calldata.`);
  return value.toLowerCase();
};
const selector = (signature) => keccak256(toBytes(signature)).slice(0, 10);
const SELECTORS = {
  approve: selector("approve(address,uint256)"),
  create: selector("createBounty(bytes32,uint128,uint128,uint64)"),
  enter: selector("enterBounty(uint256)"),
  cancel: selector("cancelBounty(uint256)"),
  expire: selector("expireBounty(uint256)"),
  timeout: selector("forfeitTimedOutAttempt(uint256)"),
  reopen: selector("reopenTimedOutAttempt(uint256)"),
  settle: selector(
    "settleAttempt((uint256,uint64,uint8,bytes32,uint64),bytes[])",
  ),
};
const ESCROW_ABI = parseAbi([
  "function createBounty(bytes32 termsHash,uint128 reward,uint128 entry,uint64 expiresAt) returns (uint256)",
  "function enterBounty(uint256 bountyId)",
  "function cancelBounty(uint256 bountyId)",
  "function expireBounty(uint256 bountyId)",
  "function forfeitTimedOutAttempt(uint256 bountyId)",
  "function reopenTimedOutAttempt(uint256 bountyId)",
  "function settleAttempt((uint256 bountyId,uint64 attemptNonce,uint8 outcome,bytes32 resultHash,uint64 validUntil) settlement,bytes[] signatures)",
]);
const ESCROW_SELECTORS = new Set([
  SELECTORS.create,
  SELECTORS.enter,
  SELECTORS.cancel,
  SELECTORS.expire,
  SELECTORS.timeout,
  SELECTORS.reopen,
  SELECTORS.settle,
]);

const configuredEscrow = () =>
  lower(
    process.env.WAR_MACHINES_ESCROW_ADDRESS || DEFAULT_ESCROW,
    "WAR_MACHINES_ESCROW_ADDRESS",
  );

const sameCall = (left, right) =>
  lower(left.to, "call.to") === lower(right.to, "call.to") &&
  hexData(left.data, "call.data") === hexData(right.data, "call.data");

const normalizedCall = (call, label) => {
  if (!call || typeof call !== "object") throw new Error(`${label} is invalid.`);
  const to = lower(call.to, `${label}.to`);
  const data = hexData(call.data, `${label}.data`);
  if (call.value !== undefined && BigInt(call.value) !== 0n)
    throw new Error(`${label}.value must be zero.`);
  return { to, data };
};

function decodeEscrowCall(data) {
  try {
    return decodeFunctionData({ abi: ESCROW_ABI, data });
  } catch {
    throw new Error("The plan escrow calldata is malformed or not a supported V5/V6 method.");
  }
}

function spendForEscrowCall(decoded, approvalAmount) {
  switch (decoded.functionName) {
    case "createBounty":
      return BigInt(decoded.args[1]);
    case "enterBounty":
      // The bounty amount is intentionally not trusted from the calldata: the
      // ID alone does not contain it. An approval is therefore required for
      // entry plans, and its amount is an upper bound enforced by ERC-20.
      if (approvalAmount === null)
        throw new Error("An approval-free entry plan has no bounded spend amount.");
      return approvalAmount;
    case "cancelBounty":
    case "expireBounty":
    case "forfeitTimedOutAttempt":
    case "reopenTimedOutAttempt":
    case "settleAttempt":
      return 0n;
    default:
      throw new Error(`The plan method ${decoded.functionName} is not allowed.`);
  }
}

export function validateEscrowPlan(plan, options = {}) {
  if (!plan || typeof plan !== "object") throw new Error("plan is required.");
  if (Number(plan.chainId) !== CHAIN_ID)
    throw new Error("The plan is not for Tempo mainnet (4217).");
  const token = lower(
    process.env.WAR_MACHINES_TOKEN_ADDRESS || PATHUSD,
    "WAR_MACHINES_TOKEN_ADDRESS",
  );
  const escrow = lower(options.escrow || configuredEscrow(), "escrow");
  if (lower(plan.token, "plan.token") !== token)
    throw new Error("The plan fee/payment token is not pathUSD.");
  if (lower(plan.escrow, "plan.escrow") !== escrow)
    throw new Error("The plan escrow does not match the configured War Machines escrow.");

  const call = normalizedCall(plan.call, "plan.call");
  if (call.to !== escrow || !ESCROW_SELECTORS.has(call.data.slice(0, 10)))
    throw new Error("The plan call is not an allowed War Machines escrow method.");
  const decoded = decodeEscrowCall(call.data);

  const approval = plan.approval
    ? normalizedCall(plan.approval, "plan.approval")
    : null;
  if (approval) {
    if (approval.to !== token || approval.data.slice(0, 10) !== SELECTORS.approve)
      throw new Error("The plan approval is not a pathUSD approval.");
    if (approval.data.length !== 138)
      throw new Error("The pathUSD approval calldata is malformed.");
    const spender = `0x${approval.data.slice(34, 74)}`;
    if (spender !== escrow)
      throw new Error("The pathUSD approval spender is not the configured escrow.");
    if (plan.approval.amount !== undefined && !/^\d+$/.test(String(plan.approval.amount)))
      throw new Error("The plan approval amount must be integer token units.");
    if (
      plan.approval.amount !== undefined &&
      BigInt(String(plan.approval.amount)) !== BigInt(`0x${approval.data.slice(74)}`)
    )
      throw new Error("The plan approval amount does not match its calldata.");
    if (BigInt(`0x${approval.data.slice(74)}`) === 0n)
      throw new Error("The pathUSD approval amount must be positive.");
  }

  const approvalAmount = approval ? BigInt(`0x${approval.data.slice(74)}`) : null;
  if (
    approval &&
    ["cancelBounty", "expireBounty", "forfeitTimedOutAttempt", "reopenTimedOutAttempt", "settleAttempt"].includes(decoded.functionName)
  )
    throw new Error(`The ${decoded.functionName} plan must not include a token approval.`);
  const spendUnits = spendForEscrowCall(decoded, approvalAmount);
  if (plan.spendUnits !== undefined) {
    if (!/^\d+$/.test(String(plan.spendUnits)))
      throw new Error("plan.spendUnits must be integer token units.");
    if (BigInt(String(plan.spendUnits)) !== spendUnits)
      throw new Error("plan.spendUnits does not match the decoded escrow call.");
  }
  if (decoded.functionName === "createBounty" && approvalAmount !== null && approvalAmount !== spendUnits)
    throw new Error("The create plan approval must equal the decoded reward.");
  if (options.maxSpend !== undefined) {
    if (!/^\d+$/.test(String(options.maxSpend)))
      throw new Error("maxSpend must be integer token units.");
    const maxSpend = BigInt(String(options.maxSpend));
    // Compare the decoded economic operation, never merely the presence of
    // an approve call. For entries approvalAmount is a conservative upper
    // bound on the eventual transferFrom amount.
    if (spendUnits > maxSpend) throw new Error("The plan exceeds maxSpend.");
  }

  const expectedCalls = approval ? [approval, call] : [call];
  if (plan.calls !== undefined) {
    if (!Array.isArray(plan.calls) || plan.calls.length !== expectedCalls.length)
      throw new Error("The plan calls batch does not match approval plus escrow call.");
    plan.calls.forEach((item, index) => {
      if (!sameCall(normalizedCall(item, `plan.calls[${index}]`), expectedCalls[index]))
        throw new Error("The plan calls batch does not match the signed plan.");
    });
  }
  return {
    chainId: CHAIN_ID,
    token,
    escrow,
    calls: expectedCalls,
    method: decoded.functionName,
    spendUnits,
  };
}

const wallet = Provider.create({
  // This bridge owns its fetch calls. The provider's default MPP polyfill
  // would replace global fetch and make ordinary RPC/HTTP calls look like
  // malformed payment requests.
  mpp: { mode: "pull", polyfill: false },
  storage: Storage.filesystem(),
  open() {
    throw new Error(
      "Tempo Wallet needs device authorization. Complete login/access-key authorization first, then retry.",
    );
  },
});

const result = (id, value, isError = false) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  result: {
    content: [{ type: "text", text: json(value) }],
    structuredContent: value,
    ...(isError ? { isError: true } : {}),
  },
});

const TOOLS = [
  {
    name: "tempo_wallet_get_connection_status",
    description: "Read the connected local Tempo wallet and chain without spending.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "tempo_wallet_execute_escrow_plan",
    description:
      "Atomically submit a verified War Machines approve plus escrow transaction plan through the logged-in Tempo access key.",
    inputSchema: {
      type: "object",
      properties: {
        plan: { type: "object", description: "Exact plan returned by War Machines MCP." },
        from: { type: "string", description: "Optional connected wallet address." },
        maxSpend: { type: "string", description: "Optional maximum decoded escrow spend in base units." },
      },
      required: ["plan"],
      additionalProperties: false,
    },
  },
];

async function callTool(name, args) {
  if (name === "tempo_wallet_get_connection_status") {
    const accounts = await wallet.request({ method: "eth_accounts" });
    const chainId = await wallet.request({ method: "eth_chainId" });
    return { ready: Array.isArray(accounts) && accounts.length > 0, accounts, chainId };
  }
  if (name !== "tempo_wallet_execute_escrow_plan")
    throw new Error(`Unknown tool: ${name}`);
  const checked = validateEscrowPlan(args?.plan, { maxSpend: args?.maxSpend });
  const accounts = await wallet.request({ method: "eth_accounts" });
  const from = args?.from || accounts?.[0];
  if (!from) throw new Error("No connected Tempo wallet account is available.");
  const normalizedFrom = lower(from, "from");
  if (!accounts.some((account) => lower(account, "wallet account") === normalizedFrom))
    throw new Error("from is not one of the connected Tempo wallet accounts.");
  const transactionHash = await wallet.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: normalizedFrom,
        // accounts/cli validates transactionRequest.chainId as a number. The
        // browser connector accepts a hex quantity, but the local provider
        // does not.
        chainId: CHAIN_ID,
        feeToken: checked.token,
        calls: checked.calls.map((call) => ({ ...call, value: 0n })),
      },
    ],
  });
  return { transactionHash, chainId: CHAIN_ID, escrow: checked.escrow, calls: checked.calls.length };
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
        protocolVersion: MCP_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "tempo-wallet-war-machines", version: "1.0.0" },
        instructions:
          "Only exact War Machines escrow plans are accepted. The provider enforces the connected Tempo access-key spending limit.",
      },
    };
  if (message.method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  if (message.method !== "tools/call")
    return { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found." } };
  try {
    const value = await callTool(message.params?.name, message.params?.arguments || {});
    return result(id, value);
  } catch (error) {
    return result(id, { error: error?.message || String(error) }, true);
  }
}

if (process.argv[1] && process.argv[1].endsWith("tempo-wallet-mcp.mjs")) {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    const reply = await handle(JSON.parse(line));
    if (reply) process.stdout.write(`${json(reply)}\n`);
  }
}
