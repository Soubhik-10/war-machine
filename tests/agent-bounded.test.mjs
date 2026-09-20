import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionData } from "viem";
import { validateEscrowPlan } from "../scripts/tempo-wallet-mcp.mjs";
import {
  optimizeCounterParallel,
  terminalPaymentMode,
} from "../scripts/war-machines-agent.mjs";
import { PRESETS, packChallenge } from "../dist/data.mjs";
import { handleMcpRequest, TOOLS } from "../server/mcp.mjs";
import { mainnetOpenApi } from "../sites/worker/openapi.mjs";

const token = "0x20c0000000000000000000000000000000000000";
const escrow = "0xb14a3aa99c9349094612143089f55ae5372deb24";
const encode = (abi, functionName, args) =>
  encodeFunctionData({ abi, functionName, args });

test("escrow validator decodes economic spend even without an approval call", () => {
  const create = {
    to: escrow,
    data: encode(
      [
        {
          type: "function",
          name: "createBounty",
          stateMutability: "nonpayable",
          inputs: [
            { name: "termsHash", type: "bytes32" },
            { name: "reward", type: "uint128" },
            { name: "entry", type: "uint128" },
            { name: "expiresAt", type: "uint64" },
          ],
          outputs: [{ name: "", type: "uint256" }],
        },
      ],
      "createBounty",
      ["0x" + "11".repeat(32), 50_000n, 10_000n, 0n],
    ),
  };
  assert.throws(
    () => validateEscrowPlan({ chainId: 4217, token, escrow, call: create }, { maxSpend: "10000" }),
    /exceeds maxSpend/,
  );
  const checked = validateEscrowPlan({ chainId: 4217, token, escrow, call: create }, { maxSpend: "50000" });
  assert.equal(checked.spendUnits, 50_000n);
  assert.equal(checked.method, "createBounty");

  const enter = {
    to: escrow,
    data: encode(
      [{ type: "function", name: "enterBounty", stateMutability: "nonpayable", inputs: [{ name: "bountyId", type: "uint256" }], outputs: [] }],
      "enterBounty",
      [1n],
    ),
  };
  assert.throws(
    () => validateEscrowPlan({ chainId: 4217, token, escrow, call: enter }, { maxSpend: "10000" }),
    /approval-free entry plan/,
  );

  const cancel = {
    to: escrow,
    data: encode(
      [{ type: "function", name: "cancelBounty", stateMutability: "nonpayable", inputs: [{ name: "bountyId", type: "uint256" }], outputs: [] }],
      "cancelBounty",
      [1n],
    ),
  };
  const approval = {
    to: token,
    data: encode(
      [{ type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] }],
      "approve",
      [escrow, 1n],
    ),
    amount: "1",
  };
  assert.throws(
    () => validateEscrowPlan({ chainId: 4217, token, escrow, approval, call: cancel }, { maxSpend: "0" }),
    /must not include a token approval/,
  );
});

test("deadline fallback remains a legal counter and terminal payment modes stay truthful", async () => {
  const defender = packChallenge(PRESETS[0], "foundry", 0);
  const result = await optimizeCounterParallel(defender, { deadlineMs: Date.now() - 1, workerCount: 4 });
  assert.equal(result.screening.fallback, true);
  assert.ok(result.selected.packed);
  assert.equal(terminalPaymentMode({ status: "awaiting-signatures", payment: {} }), "awaiting-settlement");
  assert.equal(terminalPaymentMode({ status: "ready-to-settle", payment: {} }), "awaiting-settlement");
  assert.equal(terminalPaymentMode({ status: "settled", payment: { finalized: true } }), "paid");
  assert.equal(terminalPaymentMode({ status: "settled", payment: { retryAvailable: true, technicalFailure: true } }), "technical-recovery");
});

test("cancellable worker search returns its legal fallback at a live deadline", async () => {
  const defender = packChallenge(PRESETS[0], "foundry", 0);
  const started = Date.now();
  const result = await optimizeCounterParallel(defender, {
    deadlineMs: Date.now() + 50,
    maxCandidates: 12,
    seeds: [1, 7, 42],
    workerCount: 4,
  });
  assert.equal(result.screening.fallback, true);
  assert.ok(result.selected.packed);
  assert.ok(Date.now() - started < 1000);
});

test("remote MCP exposes attempt recovery, build vault and bookmark lifecycle tools", async () => {
  const names = TOOLS.map((entry) => entry.name);
  for (const name of [
    "war_machines_get_attempt",
    "war_machines_retry_attempt",
    "war_machines_list_builds",
    "war_machines_save_build",
    "war_machines_update_build",
    "war_machines_delete_build",
    "war_machines_list_bookmarks",
    "war_machines_save_bookmark",
    "war_machines_remove_bookmark",
  ]) assert.ok(names.includes(name), name);

  let seen;
  const request = new Request("https://arena.example/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer session" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "war_machines_retry_attempt", arguments: { attemptId: "11111111-1111-4111-8111-111111111111", idempotencyKey: "retry_key_0000001" } },
    }),
  });
  const response = await handleMcpRequest(request, async (subrequest) => {
    seen = subrequest;
    return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
  });
  assert.equal(response.status, 200);
  assert.equal(seen.method, "POST");
  assert.match(new URL(seen.url).pathname, /\/api\/attempts\/11111111-1111-4111-8111-111111111111\/retry$/);
  assert.equal(seen.headers.get("authorization"), "Bearer session");
});

test("mainnet OpenAPI declares complete operations and real lifecycle parameters", () => {
  for (const [path, item] of Object.entries(mainnetOpenApi.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      assert.ok(operation.operationId, `${method} ${path} operationId`);
      assert.ok(operation.responses && Object.keys(operation.responses).length, `${method} ${path} responses`);
      for (const name of path.matchAll(/\{([^}]+)\}/g)) {
        assert.ok(
          operation.parameters?.some((parameter) => parameter.in === "path" && parameter.name === name[1] && parameter.required === true),
          `${method} ${path} missing ${name[1]} path parameter`,
        );
      }
    }
  }
  const create = mainnetOpenApi.paths["/bounties"].post;
  assert.ok(create.parameters.some((parameter) => parameter.name === "Idempotency-Key"));
  assert.equal(create.requestBody.content["application/json"].schema.required.includes("maxPlatformFeeBps"), true);
  assert.equal(mainnetOpenApi.components.schemas.Blueprint.properties.o.enum.includes("escort"), true);
  assert.equal(mainnetOpenApi.components.schemas.Blueprint.properties.q.properties.parts.type.includes("integer"), true);
  assert.deepEqual(mainnetOpenApi.components.schemas.EscrowPlan.required, ["direct", "intentId", "plan"]);
  assert.equal(mainnetOpenApi.paths["/auth/verify"].post.requestBody.content["application/json"].schema.properties.returnToken, undefined);
  assert.equal(mainnetOpenApi.paths["/attempts/{id}/attestations"].post.security.length, 0);
  assert.deepEqual(
    mainnetOpenApi.paths["/attempts/{id}/attestations"].post.requestBody.content["application/json"].schema.required,
    ["signatures"],
  );
  assert.ok(mainnetOpenApi.paths["/attempts/{id}/retry"].post.requestBody.content["application/json"].schema.properties.participantName);
  assert.equal(mainnetOpenApi.servers[0].url, "/api");
});
