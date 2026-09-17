import assert from "node:assert/strict";
import test from "node:test";
import { rankBounties, pathUsdUnits } from "../scripts/war-machines-agent.mjs";

test("optimal agent ranking is deterministic and respects the spend cap", () => {
  assert.equal(pathUsdUnits("1.00"), 1_000_000n);
  const ranked = rankBounties(
    [
      {
        id: "low-entry",
        title: "Small reliable bounty",
        entry: "0.01",
        reward: "0.05",
        payout: "0.04875",
        netIfWin: "0.03875",
        status: "open",
        funded: true,
      },
      {
        id: "higher-entry",
        title: "Large bounty",
        entry: "1.01",
        reward: "2.00",
        payout: "1.95",
        netIfWin: "0.94",
        status: "open",
        funded: true,
      },
      {
        id: "closed",
        title: "Already claimed",
        entry: "0.01",
        reward: "5.00",
        status: "claimed",
        funded: true,
      },
    ],
    { maxEntry: "1.00" },
  );
  assert.deepEqual(ranked.map((bounty) => bounty.id), ["low-entry"]);
});

test("optimal agent ranking supports a title filter without changing spend policy", () => {
  const ranked = rankBounties(
    [
      { id: "a", title: "AI TEST BOUNTY", entry: "0.01", reward: "0.05", status: "open" },
      { id: "b", title: "Other BOUNTY", entry: "0.01", reward: "0.05", status: "open" },
    ],
    { maxEntry: "0.01", titleQuery: "ai test" },
  );
  assert.deepEqual(ranked.map((bounty) => bounty.id), ["a"]);
});
