// Stateless MCP Streamable HTTP adapter for the War Machines API.
//
// The worker keeps business rules, MPP verification and escrow receipt checks
// in mainnet.mjs. This module only translates MCP JSON-RPC tool calls into
// those existing HTTP routes, preserving the caller's payment credential.

const MCP_PROTOCOL_VERSION = "2025-11-25";
const SUPPORTED_PROTOCOL_VERSIONS = new Set([
  "2025-06-18",
  "2025-11-25",
  "2026-07-28",
]);

const json = (value) => JSON.stringify(value);

const tool = (name, description, properties = {}, required = []) => ({
  name,
  description,
  inputSchema: {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  },
});

const string = (description) => ({ type: "string", description });
const object = (description) => ({
  type: "object",
  description,
  additionalProperties: true,
});
const integer = (description) => ({ type: "integer", description });

const TOOLS = [
  tool(
    "war_machines_get_rules",
    "Read the live engine, terrain, economy, Tempo escrow and MPP configuration.",
  ),
  tool(
    "war_machines_list_bounties",
    "List public bounty scouts. Defender blueprints remain hidden until a confirmed entry.",
  ),
  tool(
    "war_machines_get_activity",
    "Read the authenticated wallet's recent bounty, escrow, attempt and settlement activity without exposing blueprints or credentials.",
  ),
  tool(
    "war_machines_get_bounty",
    "Read one bounty scout or, for its creator/entrant, the authorized full record.",
    { bountyId: string("Bounty UUID") },
    ["bountyId"],
  ),
  tool(
    "war_machines_validate_blueprint",
    "Validate a readable machine or packed blueprint against the live rules.",
    {
      blueprint: object("Packed blueprint returned by validation or the catalog."),
      machine: object("Readable machine with modules and doctrine."),
      arena: string("Arena ID when supplying a readable machine."),
      rules: object("Construction rules when supplying a readable machine."),
      bountyId: string("Bounty UUID to validate against its locked rules."),
    },
  ),
  tool(
    "war_machines_practice",
    "Run a free deterministic practice battle. Practice never transfers funds.",
    {
      challenger: object("Packed challenger blueprint."),
      defender: object("Packed defender blueprint, unless bountyId is supplied."),
      bountyId: string("Bounty UUID previously revealed to this caller."),
      seed: integer("Optional uint32 practice seed."),
    },
    ["challenger"],
  ),
  tool(
    "war_machines_create_bounty",
    "Prepare a direct Tempo createBounty escrow plan. Submit its exact atomic calls through the caller's Tempo wallet; MPP does not replace wallet signing.",
    {
      title: string("Bounty title."),
      blueprint: object("Packed defender blueprint."),
      entry: string("Entry price in pathUSD."),
      reward: string("Gross reward in pathUSD."),
      hours: integer("Expiry duration in hours; zero means no expiry."),
      listed: { type: "boolean", description: "Whether to list the bounty publicly. Defaults to true; set false for a link-only bounty." },
      maxPlatformFeeBps: integer("Must be 250 to acknowledge the 2.5% fee."),
      idempotencyKey: string("Unique 16-100 character retry key."),
    },
    [
      "title",
      "blueprint",
      "entry",
      "reward",
      "hours",
      "maxPlatformFeeBps",
      "idempotencyKey",
    ],
  ),
  tool(
    "war_machines_enter_bounty",
    "Prepare a direct Tempo enterBounty escrow plan. Submit its exact atomic approval plus enter call through the caller's Tempo wallet; the confirmed response reveals the defender and build deadline.",
    {
      bountyId: string("Bounty UUID."),
      maxEntry: string("Maximum entry price accepted in pathUSD."),
      maxPlatformFeeBps: integer("Maximum accepted platform fee in basis points."),
      idempotencyKey: string("Unique 16-100 character retry key."),
    },
    ["bountyId", "maxEntry", "maxPlatformFeeBps", "idempotencyKey"],
  ),
  tool(
    "war_machines_confirm_escrow",
    "Confirm a previously prepared create, entry or control escrow intent with the exact transaction hash.",
    {
      intentId: string("Escrow intent UUID."),
      transactionHash: string("Tempo transaction hash returned by the agent wallet."),
    },
    ["intentId", "transactionHash"],
  ),
  tool(
    "war_machines_deploy_attempt",
    "Commit one validated counter blueprint before the attempt deadline.",
    {
      attemptId: string("Attempt UUID."),
      blueprint: object("Packed counter blueprint."),
      idempotencyKey: string("Unique 16-100 character retry key."),
    },
    ["attemptId", "blueprint", "idempotencyKey"],
  ),
  tool(
    "war_machines_forfeit_attempt",
    "Finalize an expired counter-build window through the immutable timeout path.",
    {
      attemptId: string("Attempt UUID."),
      idempotencyKey: string("Unique 16-100 character retry key."),
    },
    ["attemptId", "idempotencyKey"],
  ),
  tool(
    "war_machines_get_settlement",
    "Read the verified result and current settlement state for an attempt.",
    { attemptId: string("Attempt UUID.") },
    ["attemptId"],
  ),
  tool(
    "war_machines_get_settlement_plan",
    "Read the exact Tempo escrow settlement transaction plan after attestations are ready.",
    { attemptId: string("Attempt UUID.") },
    ["attemptId"],
  ),
  tool(
    "war_machines_settle_attempt",
    "Confirm an agent-signed escrow settlement transaction after independently checking the returned plan.",
    {
      attemptId: string("Attempt UUID."),
      transactionHash: string("Tempo transaction hash returned by the agent wallet."),
    },
    ["attemptId", "transactionHash"],
  ),
  tool(
    "war_machines_control_bounty",
    "Prepare a direct Tempo control plan for cancel, expiry or timeout-forfeit.",
    {
      bountyId: string("Bounty UUID."),
      action: {
        type: "string",
        enum: ["cancel", "expire", "timeout-forfeit"],
        description: "Control action permitted by the bounty state and caller wallet.",
      },
      idempotencyKey: string("Unique 16-100 character retry key."),
    },
    ["bountyId", "action", "idempotencyKey"],
  ),
];

const instructions =
  "Use the free discovery, validation and practice tools first. For a funded operation, inspect the returned exact Tempo transaction plan and submit its calls atomically through the caller's own Tempo wallet/access key, then confirm the transaction hash. A Payment-Authorization MPP proof authenticates the wallet for autonomous bounty operations; it does not contain or replace a private key. Never alter a returned recipient, token, calldata or amount, and always preserve idempotency keys.";

const corsHeaders = (request) => ({
  "access-control-allow-origin": request.headers.get("origin") || "*",
  "access-control-allow-headers":
    "Content-Type, Authorization, Idempotency-Key, Payment-Authorization, MCP-Protocol-Version, Mcp-Session-Id",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-expose-headers":
    "MCP-Protocol-Version, Mcp-Session-Id, WWW-Authenticate, Payment-Receipt",
  vary: "Origin",
});

const response = (request, value, status = 200, extra = {}) =>
  new Response(value === null ? null : json(value), {
    status,
    headers: {
      ...corsHeaders(request),
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "mcp-protocol-version": MCP_PROTOCOL_VERSION,
      "x-content-type-options": "nosniff",
      ...extra,
    },
  });

const rpcError = (id, code, message, data) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message, ...(data === undefined ? {} : { data }) },
});

const validIdempotencyKey = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{16,100}$/.test(value);

const requiredString = (value, label) => {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`${label} is required.`);
  return value.trim();
};

const argsObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const apiSpec = (name, args) => {
  switch (name) {
    case "war_machines_get_rules":
      return { method: "GET", path: "/api/rules" };
    case "war_machines_list_bounties":
      return { method: "GET", path: "/api/bounties" };
    case "war_machines_get_activity":
      return { method: "GET", path: "/api/me/activity" };
    case "war_machines_get_bounty":
      return {
        method: "GET",
        path: `/api/bounties/${requiredString(args.bountyId, "bountyId")}`,
      };
    case "war_machines_validate_blueprint":
      return { method: "POST", path: "/api/blueprints/validate", body: args };
    case "war_machines_practice":
      return { method: "POST", path: "/api/practice", body: args };
    case "war_machines_create_bounty": {
      const idempotencyKey = requiredString(args.idempotencyKey, "idempotencyKey");
      if (!validIdempotencyKey(idempotencyKey))
        throw new Error("idempotencyKey must contain 16-100 letters, numbers, _ or -.");
      const { idempotencyKey: _, ...body } = args;
      return { method: "POST", path: "/api/bounties", body, idempotencyKey };
    }
    case "war_machines_enter_bounty": {
      const idempotencyKey = requiredString(args.idempotencyKey, "idempotencyKey");
      if (!validIdempotencyKey(idempotencyKey))
        throw new Error("idempotencyKey must contain 16-100 letters, numbers, _ or -.");
      const bountyId = requiredString(args.bountyId, "bountyId");
      const { bountyId: _, idempotencyKey: __, ...body } = args;
      return {
        method: "POST",
        path: `/api/bounties/${bountyId}/attempts`,
        body,
        idempotencyKey,
      };
    }
    case "war_machines_confirm_escrow": {
      const intentId = requiredString(args.intentId, "intentId");
      const { intentId: _, ...body } = args;
      return {
        method: "POST",
        path: `/api/escrow/intents/${intentId}/confirm`,
        body,
      };
    }
    case "war_machines_deploy_attempt": {
      const idempotencyKey = requiredString(args.idempotencyKey, "idempotencyKey");
      if (!validIdempotencyKey(idempotencyKey))
        throw new Error("idempotencyKey must contain 16-100 letters, numbers, _ or -.");
      const attemptId = requiredString(args.attemptId, "attemptId");
      const { attemptId: _, idempotencyKey: __, ...body } = args;
      return { method: "POST", path: `/api/attempts/${attemptId}/deploy`, body, idempotencyKey };
    }
    case "war_machines_forfeit_attempt": {
      const idempotencyKey = requiredString(args.idempotencyKey, "idempotencyKey");
      if (!validIdempotencyKey(idempotencyKey))
        throw new Error("idempotencyKey must contain 16-100 letters, numbers, _ or -.");
      const attemptId = requiredString(args.attemptId, "attemptId");
      return { method: "POST", path: `/api/attempts/${attemptId}/forfeit`, body: {}, idempotencyKey };
    }
    case "war_machines_get_settlement":
      return {
        method: "GET",
        path: `/api/attempts/${requiredString(args.attemptId, "attemptId")}/settlement`,
      };
    case "war_machines_get_settlement_plan":
      return {
        method: "GET",
        path: `/api/attempts/${requiredString(args.attemptId, "attemptId")}/settlement-plan`,
      };
    case "war_machines_settle_attempt":
      return {
        method: "POST",
        path: `/api/attempts/${requiredString(args.attemptId, "attemptId")}/settlement-confirm`,
        body: { transactionHash: requiredString(args.transactionHash, "transactionHash") },
      };
    case "war_machines_control_bounty": {
      const idempotencyKey = requiredString(args.idempotencyKey, "idempotencyKey");
      if (!validIdempotencyKey(idempotencyKey))
        throw new Error("idempotencyKey must contain 16-100 letters, numbers, _ or -.");
      const bountyId = requiredString(args.bountyId, "bountyId");
      const action = requiredString(args.action, "action");
      if (!["cancel", "expire", "timeout-forfeit"].includes(action))
        throw new Error("action must be cancel, expire or timeout-forfeit.");
      return { method: "POST", path: `/api/bounties/${bountyId}/${action}`, body: {}, idempotencyKey };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
};

const subrequest = (request, spec) => {
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.delete("origin");
  if (spec.idempotencyKey) headers.set("idempotency-key", spec.idempotencyKey);
  if (spec.body !== undefined) headers.set("content-type", "application/json");
  return new Request(new URL(spec.path, request.url), {
    method: spec.method,
    headers,
    body: spec.body === undefined ? undefined : json(spec.body),
  });
};

const toolResult = async (request, spec, invoke) => {
  const apiResponse = await invoke(subrequest(request, spec));
  const raw = await apiResponse.text();
  let value;
  try {
    value = raw ? JSON.parse(raw) : null;
  } catch {
    value = { raw };
  }
  if (apiResponse.status === 402) {
    return {
      response: response(request, value, 402, {
        "www-authenticate": apiResponse.headers.get("www-authenticate") || "Payment",
      }),
    };
  }
  const receipt = apiResponse.headers.get("payment-receipt");
  const result = {
    content: [{ type: "text", text: json(value) }],
    structuredContent: value,
    isError: !apiResponse.ok,
    ...(receipt ? { _meta: { paymentReceipt: receipt } } : {}),
  };
  return { result, receipt };
};

const handleMessage = async (request, message, invoke) => {
  const id = message?.id;
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string")
    return { response: response(request, rpcError(id, -32600, "Invalid Request."), 400) };

  if (message.method === "notifications/initialized" || message.method === "notifications/cancelled")
    return { response: response(request, null, 202) };
  if (message.method === "ping") return { payload: { jsonrpc: "2.0", id, result: {} } };
  if (message.method === "initialize") {
    const requested = message.params?.protocolVersion;
    const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.has(requested)
      ? requested
      : MCP_PROTOCOL_VERSION;
    return {
      payload: {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "war-machines", version: "1.0.0" },
          instructions,
        },
      },
    };
  }
  if (message.method === "tools/list")
    return { payload: { jsonrpc: "2.0", id, result: { tools: TOOLS } } };
  if (message.method !== "tools/call")
    return { response: response(request, rpcError(id, -32601, `Method not found: ${message.method}`), 200) };

  const name = message.params?.name;
  if (typeof name !== "string")
    return { response: response(request, rpcError(id, -32602, "tools/call requires params.name."), 200) };
  let spec;
  try {
    spec = apiSpec(name, argsObject(message.params?.arguments));
  } catch (error) {
    return {
      payload: rpcError(id, -32602, error.message || "Invalid tool arguments."),
    };
  }
  const result = await toolResult(request, spec, invoke);
  if (result.response) return result;
  return {
    payload: { jsonrpc: "2.0", id, result: result.result },
    receipt: result.receipt,
  };
};

export async function handleMcpRequest(request, invoke) {
  const headers = corsHeaders(request);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method === "GET")
    return response(request, { error: "This stateless MCP endpoint accepts POST messages." }, 405, {
      allow: "POST, OPTIONS",
    });
  if (request.method === "DELETE") return new Response(null, { status: 204, headers });
  if (request.method !== "POST")
    return response(request, { error: "Method not allowed." }, 405, { allow: "POST, OPTIONS" });
  const contentType = request.headers.get("content-type")?.split(";")[0];
  if (contentType !== "application/json")
    return response(request, { error: "MCP requests must use application/json." }, 415);
  let message;
  try {
    message = await request.json();
  } catch {
    return response(request, rpcError(null, -32700, "Parse error."), 400);
  }
  const messages = Array.isArray(message) ? message : [message];
  const outputs = [];
  let receipt = null;
  for (const item of messages) {
    const handled = await handleMessage(request, item, invoke);
    if (handled.response) return handled.response;
    if (handled.receipt) receipt = handled.receipt;
    if (handled.payload) outputs.push(handled.payload);
  }
  if (!outputs.length) return new Response(null, { status: 202, headers });
  return response(
    request,
    outputs.length === 1 ? outputs[0] : outputs,
    200,
    receipt ? { "payment-receipt": receipt } : {},
  );
}

export { TOOLS, MCP_PROTOCOL_VERSION };
