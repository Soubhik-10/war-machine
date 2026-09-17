import assert from "node:assert/strict";
import test from "node:test";
import { PRESETS, packChallenge } from "../dist/data.mjs";
import {
  optimizeCounterParallel,
  rankBounties,
  pathUsdUnits,
} from "../scripts/war-machines-agent.mjs";

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

test("parallel counter search preserves deterministic selection while screening work", async () => {
  const defender = packChallenge(PRESETS[0], "foundry", 0);
  const result = await optimizeCounterParallel(defender, {
    seeds: [1, 7],
    maxCandidates: 2,
    initialSeeds: 1,
    shortlist: 1,
    workerCount: 2,
  });
  assert.equal(result.selected.index, 1);
  assert.equal(result.evaluatedMatches, 3);
  assert.equal(result.selected.results.length, 2);
});
