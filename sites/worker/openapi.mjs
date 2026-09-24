import { ARENAS } from "../../dist/data.mjs";

const uuid = (description) => ({ name: "id", in: "path", required: true, description, schema: { type: "string", format: "uuid" } });
const idempotency = { name: "Idempotency-Key", in: "header", required: true, description: "Stable 16-100 character key. Reuse the exact key and body after an uncertain response.", schema: { type: "string", minLength: 16, maxLength: 100, pattern: "^[A-Za-z0-9_-]+$" } };
const json = (schema) => ({ "application/json": { schema } });
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const response = (description, schema = { type: "object", additionalProperties: true }) => ({ description, content: json(schema) });
const errorResponses = {
  "400": response("Invalid JSON or request fields.", ref("Error")),
  "401": response("Wallet session, bearer session token or MPP proof required.", ref("Error")),
  "402": {
    description: "Tempo MPP payment challenge; retry the exact request with the returned credential.",
    headers: { "WWW-Authenticate": { schema: { type: "string" } }, "Payment-Receipt": { schema: { type: "string" } } },
    content: json(ref("Error")),
  },
  "409": response("Conflict, stale escrow state, duplicate request or deadline.", ref("Error")),
  "429": response("Rate or capacity limit.", ref("Error")),
  "503": response("Payment, settlement or simulation service unavailable.", ref("Error")),
};
const security = { wallet: [{ bearerAuth: [] }, { cookieAuth: [] }, { mppProof: [] }], owner: [{ bearerAuth: [] }, { cookieAuth: [] }, { mppProof: [] }] };
const operation = ({ summary, operationId, parameters = [], body, success = "200", result, auth = false, errors = errorResponses }) => ({
  operationId,
  summary,
  ...(auth ? { security: security.wallet } : { security: [] }),
  ...(parameters.length ? { parameters } : {}),
  ...(body ? { requestBody: { required: true, content: json(body) } } : {}),
  responses: { [success]: response("Success.", result), ...errors },
});

const decimal = { type: "string", pattern: "^(0|[1-9][0-9]*)(\\.[0-9]{1,6})?$", description: "Non-negative pathUSD amount with up to six decimal places." };
const amountUnits = { type: "integer", minimum: 0, maximum: 1000000000, description: "Integer pathUSD base units." };
const empty = { type: "object", additionalProperties: false };
const boardPageParameters = [
  { name: "scope", in: "query", description: "public is the discovery board. mine, history, and saved require read authentication and keep owner or entrant records out of public discovery.", schema: { enum: ["public", "mine", "history", "saved"], default: "public" } },
  { name: "limit", in: "query", description: "Page size, from 1 to 100. The default is 50.", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
  { name: "cursor", in: "query", description: "Opaque cursor from X-Next-Cursor or Link. Keep scope and sorting unchanged while paging.", schema: { type: "string" } },
];
const buildRules = {
  type: "object",
  additionalProperties: false,
  required: ["mode", "credits", "parts", "mass", "weapons", "combat"],
  properties: {
    mode: { enum: ["standard", "custom", "unlimited"] },
    credits: { type: ["integer", "null"], minimum: 1, maximum: 1000000 },
    parts: { type: ["integer", "null"], minimum: 1, maximum: 243 },
    mass: { type: ["integer", "null"], minimum: 1, maximum: 100000 },
    weapons: { type: ["integer", "null"], minimum: 1, maximum: 243 },
    combat: { const: "auto" },
  },
};
const blueprint = {
  type: "object",
  additionalProperties: true,
  required: ["v", "n", "p", "t", "g", "d", "s", "a", "e", "b", "q", "m"],
  properties: {
    v: { const: 3 }, n: { type: "string", maxLength: 28 }, p: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
    t: { enum: ["balanced", "kite", "ram", "flank"] }, g: { enum: ["weapons", "core", "power", "mobility", "nearest"] },
    d: { type: "number", minimum: 80, maximum: 600 }, s: { enum: ["steady", "aggressive", "guarded"] },
    a: { type: "string", enum: ARENAS.map((arena) => arena.id) }, e: { type: "integer", minimum: 0, maximum: 4294967295 }, b: { type: "integer", minimum: 0 },
    q: buildRules, m: { type: "array", maxItems: 243, items: { type: "array", minItems: 4, maxItems: 7 } },
    o: { enum: ["reactor", "escort"], description: "Optional objective; omitted means reactor." },
  },
};
const bountyBody = { type: "object", additionalProperties: false, required: ["title", "blueprint", "entry", "reward", "hours", "maxPlatformFeeBps"], properties: {
  title: { type: "string", minLength: 1, maxLength: 70 }, blueprint, entry: decimal, reward: decimal,
  hours: { type: "integer", minimum: 0, maximum: 8760 }, listed: { type: "boolean", default: true }, maxPlatformFeeBps: { type: "integer", minimum: 0, maximum: 10000, const: 250 },
} };
const entryBody = { type: "object", additionalProperties: false, required: ["maxEntry", "maxPlatformFeeBps"], properties: {
  maxEntry: decimal, maxPlatformFeeBps: { type: "integer", minimum: 0, maximum: 10000, const: 250 }, participantName: { type: "string", maxLength: 28 }, showAddress: { type: "boolean" },
} };
const attempt = { type: "object", additionalProperties: true, required: ["id", "bounty", "status"], properties: {
  id: { type: "string", format: "uuid" }, bounty: { type: "string", format: "uuid" }, status: { type: "string" }, build: { type: ["object", "null"] }, defender: { type: ["object", "null"] },
  result: { type: ["object", "null"] }, payment: { type: ["object", "null"] }, error: { type: ["string", "null"] },
} };

export const mainnetOpenApi = {
  openapi: "3.1.0",
  info: { title: "War Machines Tempo mainnet API", version: "4.0.0", description: "Guest discovery and validation plus wallet or MPP-authenticated bounty lifecycle, escrow confirmation, settlement and private account tools." },
  servers: [{ url: "/api" }],
  security: [],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "session", description: "Bearer session token returned by wallet verification." },
      cookieAuth: { type: "apiKey", in: "cookie", name: "wm_session", description: "HttpOnly wallet session cookie." },
      mppProof: { type: "apiKey", in: "header", name: "Authorization", description: "MPP Payment credential from the exact Tempo 402 challenge; Payment-Authorization is accepted as a compatibility alias." },
    },
    schemas: {
      Error: { type: "object", required: ["error"], properties: { error: { type: "string" }, message: { type: "string" }, status: { type: "integer" } }, additionalProperties: true },
      SettlementCapacity: { type: "object", required: ["state", "ready", "fresh", "checkedAt", "signer", "relayer", "warning"], properties: {
        state: { enum: ["ready", "low", "unavailable"] }, ready: { type: "boolean" }, fresh: { type: "boolean" }, checkedAt: { type: ["integer", "null"], description: "Timestamp in Unix milliseconds of the underlying payment-health check." },
        signer: { type: "object", required: ["role", "state", "balanceUnits", "minimumUnits"], properties: { role: { const: "settlement-signer" }, state: { enum: ["ready", "low", "unavailable"] }, balanceUnits: { type: ["string", "null"] }, minimumUnits: { type: "string" } } },
        relayer: { type: "object", required: ["role", "state", "balanceUnits", "minimumUnits"], properties: { role: { const: "mpp-relayer" }, state: { enum: ["ready", "low", "unavailable", "not-configured"] }, balanceUnits: { type: ["string", "null"] }, minimumUnits: { type: "string" } } },
        warning: { type: ["string", "null"], description: "Actionable capacity warning. Browsing and recovery remain available when new paid admission is paused." },
      } },
      Rules: { type: "object", additionalProperties: true, properties: { mode: { type: "string" }, combat: { const: "auto" }, versions: { type: "object" }, settlementCapacity: ref("SettlementCapacity"), parts: { type: "array", items: { type: "object" } }, arenas: { type: "array", items: { type: "object" } } } },
      BuildRules: buildRules,
      Blueprint: blueprint,
      Inspection: { type: "object", additionalProperties: false, properties: { blueprint: ref("Blueprint"), machine: { type: "object" }, arena: { type: "string" }, rules: ref("Rules"), bountyId: { type: "string", format: "uuid" } }, oneOf: [{ required: ["blueprint"] }, { required: ["machine"] }] },
      Bounty: { type: "object", additionalProperties: true, required: ["id", "status", "canEnter"], properties: { id: { type: "string", format: "uuid" }, status: { type: "string" }, entry: { type: ["string", "number"] }, reward: { type: ["string", "number"] }, scout: { type: "object" }, blueprint: { type: ["object", "null"] }, canEnter: { type: "boolean", description: "Intrinsic eligibility for the current escrow deployment. Engine build metadata is historical and does not close an otherwise funded bounty." }, compatibilityState: { enum: ["current", "incompatible", "legacy-read-only", "metadata-unavailable"] }, availability: { type: "object", properties: { enter: { type: "object", properties: { allowed: { type: "boolean" }, reasons: { type: "array", items: { type: "string" } } } }, payment: { type: "object", properties: { ready: { type: "boolean" }, reason: { type: ["string", "null"] } } } } } } },
      Attempt: attempt,
      Settlement: { type: "object", additionalProperties: true },
      EscrowPlan: { type: "object", additionalProperties: true, required: ["direct", "intentId", "plan"], properties: { direct: { const: true }, intentId: { type: "string", format: "uuid" }, kind: { type: "string" }, bounty: { type: "string", format: "uuid" }, termsHash: { type: "string" }, expiresAt: { type: "integer" }, transactionHash: { type: ["string", "null"] }, plan: { type: "object", required: ["chainId", "token", "escrow", "call"], properties: { chainId: { const: 4217 }, token: { type: "string" }, escrow: { type: "string" }, approval: { type: ["object", "null"] }, call: { type: "object" }, calls: { type: "array" }, spendUnits: { type: "string" } } } } },
      SettlementPlan: { type: "object", additionalProperties: true, required: ["direct", "plan"], properties: { direct: { const: true }, kind: { type: "string" }, plan: { type: "object", required: ["chainId", "token", "escrow", "call"], properties: { chainId: { const: 4217 }, token: { type: "string" }, escrow: { type: "string" }, approval: { type: ["object", "null"] }, call: { type: "object" }, calls: { type: "array" }, spendUnits: { type: "string" } } } } },
    },
  },
  paths: {
    "/rules": { get: operation({ operationId: "getRules", summary: "Read live game, engine, arena and payment rules.", result: ref("Rules") }) },
    "/health": { get: operation({ operationId: "getHealth", summary: "Read truthful payment and settlement readiness.", result: { type: "object", additionalProperties: true, properties: { settlementCapacity: ref("SettlementCapacity") } } }) },
    "/openapi.json": { get: operation({ operationId: "getOpenApi", summary: "Read this API contract.", result: { type: "object", additionalProperties: true } }) },
    "/mcp": { post: operation({ operationId: "mcp", summary: "Stateless MCP Streamable HTTP JSON-RPC endpoint.", body: { type: "object", additionalProperties: true }, result: { type: "object", additionalProperties: true } }) },
    "/blueprints/validate": { post: operation({ operationId: "validateBlueprint", summary: "Validate a readable or packed blueprint.", body: ref("Inspection"), result: { type: "object", additionalProperties: true } }) },
    "/practice": { post: operation({ operationId: "practiceUnavailable", summary: "Mainnet practice is unavailable; use a paid official attempt.", body: { type: "object", additionalProperties: true }, success: "410", result: ref("Error") }) },
    "/auth/challenge": { post: operation({ operationId: "createAuthChallenge", summary: "Create a domain-bound Tempo wallet challenge.", body: { type: "object", required: ["chainId"], properties: { chainId: { const: 4217 } } }, result: { type: "object", required: ["message"], properties: { message: { type: "string" } } } }) },
    "/auth/verify": { post: operation({ operationId: "verifyAuth", summary: "Verify a wallet signature and issue a bearer or cookie session.", body: { type: "object", required: ["address", "message", "signature"], additionalProperties: false, properties: { address: { type: "string" }, message: { type: "string" }, signature: { type: "string" } } }, result: { type: "object", required: ["me", "token"], properties: { me: { type: "object" }, token: { type: "string" } } } }) },
    "/auth/logout": { post: operation({ operationId: "logoutAuth", summary: "Revoke the current wallet session.", result: { type: "object" } }) },
    "/me": { get: operation({ operationId: "getProfile", summary: "Read the authenticated profile and caps.", auth: true, result: { type: "object", additionalProperties: true } }), patch: operation({ operationId: "updateProfile", summary: "Update pilot name and entry or daily caps.", auth: true, body: { type: "object", additionalProperties: false, properties: { name: { type: "string", maxLength: 28 }, entryCap: { type: ["string", "null"] }, dailyCap: { type: ["string", "null"] } } }, result: { type: "object", additionalProperties: true } }) },
    "/me/wallet": { get: operation({ operationId: "getWallet", summary: "Read wallet address and live pathUSD balance.", auth: true, result: { type: "object", required: ["address", "balance", "currency", "decimals"], properties: { address: { type: "string" }, balance: { type: "string" }, currency: { const: "pathUSD" }, decimals: { const: 6 } } } }) },
    "/me/activity": { get: operation({ operationId: "getActivity", summary: "Read authenticated bounty and payment activity.", auth: true, result: { type: "array", items: { type: "object" } } }) },
    "/me/ledger": { get: operation({ operationId: "getLedger", summary: "Read authenticated ledger entries.", auth: true, result: { type: "array", items: { type: "object" } } }) },
    "/me/attempts": { get: operation({ operationId: "getMyAttempts", summary: "Read authenticated official attempts.", auth: true, result: { type: "array", items: ref("Attempt") } }) },
    "/me/builds": { get: operation({ operationId: "listBuilds", summary: "List the private blueprint vault.", auth: true, result: { type: "array", items: { type: "object" } } }), post: operation({ operationId: "saveBuild", summary: "Save a blueprint in the private vault.", auth: true, parameters: [idempotency], body: { type: "object", required: ["name", "blueprint"], properties: { name: { type: "string", minLength: 1, maxLength: 48 }, blueprint: ref("Blueprint") } }, success: "201", result: { type: "object" } }) },
    "/me/builds/{id}": { patch: operation({ operationId: "updateBuild", summary: "Replace a private saved blueprint.", auth: true, parameters: [uuid("Saved build UUID"), idempotency], body: { type: "object", required: ["name", "blueprint"], properties: { name: { type: "string", minLength: 1, maxLength: 48 }, blueprint: ref("Blueprint") } }, result: { type: "object" } }), delete: operation({ operationId: "deleteBuild", summary: "Delete a private saved blueprint.", auth: true, parameters: [uuid("Saved build UUID")], result: { type: "object" } }) },
    "/me/bookmarks": { get: operation({ operationId: "listBookmarks", summary: "List private bounty bookmarks with the bounded board cursor.", auth: true, parameters: boardPageParameters.filter((parameter) => parameter.name !== "scope"), result: { type: "array", items: ref("Bounty") } }) },
    "/me/bookmarks/{id}": { put: operation({ operationId: "saveBookmark", summary: "Save a bounty bookmark.", auth: true, parameters: [uuid("Bounty UUID")], result: { type: "object" } }), delete: operation({ operationId: "removeBookmark", summary: "Remove a bounty bookmark.", auth: true, parameters: [uuid("Bounty UUID")], result: { type: "object" } }) },
    "/bounties": { get: operation({ operationId: "listBounties", summary: "List bounded public scouts, or authenticated mine/history/saved records. Responses remain arrays; the next opaque cursor is sent in X-Next-Cursor and Link.", parameters: boardPageParameters, result: { type: "array", items: ref("Bounty") } }), post: operation({ operationId: "createBounty", summary: "Create and fund a bounty by exact Tempo escrow plan or native MPP charge.", auth: true, parameters: [idempotency], body: bountyBody, success: "202", result: { oneOf: [ref("Bounty"), ref("EscrowPlan")] } }) },
    "/bounties/{id}": { get: operation({ operationId: "getBounty", summary: "Read a public scout or authorized full bounty.", parameters: [uuid("Bounty UUID")], result: ref("Bounty") }) },
    "/bounties/{id}/attempts": { post: operation({ operationId: "enterBounty", summary: "Enter one bounty by exact Tempo escrow plan or native MPP charge.", auth: true, parameters: [uuid("Bounty UUID"), idempotency], body: entryBody, success: "202", result: { oneOf: [ref("Attempt"), ref("EscrowPlan")] } }) },
    "/bounties/{id}/cancel": { post: operation({ operationId: "cancelBounty", summary: "Prepare or execute creator cancellation.", auth: true, parameters: [uuid("Bounty UUID"), idempotency], body: empty, success: "202", result: { type: "object" } }) },
    "/bounties/{id}/expire": { post: operation({ operationId: "expireBounty", summary: "Prepare or execute expiry release for an idle bounty.", auth: true, parameters: [uuid("Bounty UUID"), idempotency], body: empty, success: "202", result: { type: "object" } }) },
    "/bounties/{id}/timeout-forfeit": { post: operation({ operationId: "timeoutForfeitBounty", summary: "Prepare or execute timeout finalization for a bounty.", auth: true, parameters: [uuid("Bounty UUID"), idempotency], body: empty, success: "202", result: { type: "object" } }) },
    "/escrow/intents/{id}/confirm": { post: operation({ operationId: "confirmEscrow", summary: "Confirm an exact direct escrow transaction hash.", auth: true, parameters: [uuid("Escrow intent UUID")], body: { type: "object", required: ["transactionHash"], properties: { transactionHash: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" } } }, success: "202", result: { type: "object" } }) },
    "/attempts/{id}": { get: operation({ operationId: "getAttempt", summary: "Inspect an authorized attempt, deadline, result and payment state.", auth: true, parameters: [uuid("Attempt UUID")], result: ref("Attempt") }) },
    "/attempts/{id}/deploy": { post: operation({ operationId: "deployAttempt", summary: "Submit one legal counter before the build deadline.", auth: true, parameters: [uuid("Attempt UUID"), idempotency], body: { type: "object", required: ["blueprint"], properties: { blueprint: ref("Blueprint") } }, result: ref("Attempt") }) },
    "/attempts/{id}/forfeit": { post: operation({ operationId: "forfeitAttempt", summary: "Finalize an expired engineering window.", auth: true, parameters: [uuid("Attempt UUID"), idempotency], body: empty, result: ref("Attempt") }) },
    "/attempts/{id}/retry": { post: operation({ operationId: "retryAttempt", summary: "Use one sponsored retry after a technical settlement timeout.", auth: true, parameters: [uuid("Attempt UUID"), idempotency], body: { type: "object", additionalProperties: false, properties: { participantName: { type: ["string", "null"], maxLength: 28 }, showAddress: { type: "boolean" } } }, success: "202", result: ref("Attempt") }) },
    "/attempts/{id}/settlement": { get: operation({ operationId: "getSettlement", summary: "Read the verified result and settlement state.", parameters: [uuid("Attempt UUID")], result: ref("Settlement") }) },
    "/attempts/{id}/attestations": { post: operation({ operationId: "attestSettlement", summary: "Submit an approved result attestation.", parameters: [uuid("Attempt UUID")], body: { type: "object", required: ["signatures"], properties: { signatures: { type: "array", minItems: 1, maxItems: 1, items: { type: "string" } } } }, result: ref("SettlementPlan") }) },
    "/attempts/{id}/settlement-plan": { get: operation({ operationId: "getSettlementPlan", summary: "Read the exact direct settlement transaction plan.", parameters: [uuid("Attempt UUID")], result: ref("SettlementPlan") }) },
    "/attempts/{id}/settlement-confirm": { post: operation({ operationId: "confirmSettlement", summary: "Confirm a final on-chain settlement transaction hash.", auth: true, parameters: [uuid("Attempt UUID")], body: { type: "object", required: ["transactionHash"], properties: { transactionHash: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" } } }, result: ref("Settlement") }) },
  },
};

export default mainnetOpenApi;
