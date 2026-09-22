import assert from "node:assert/strict";
import test from "node:test";
import { boardScopeForFilter, settlementCapacityDescription } from "../dist/bounties.mjs";

test("paid board filters use private scopes only for an authenticated viewer", () => {
  assert.equal(boardScopeForFilter("open", true, true), "public");
  assert.equal(boardScopeForFilter("mine", true, true), "mine");
  assert.equal(boardScopeForFilter("saved", true, true), "saved");
  assert.equal(boardScopeForFilter("completed", true, true), "history");
  for (const filter of ["open", "mine", "saved", "completed"]) {
    assert.equal(boardScopeForFilter(filter, true, false), "public");
    assert.equal(boardScopeForFilter(filter, false, true), "public");
  }
});

test("player capacity warning identifies the signer, relayer, freshness and recovery path", () => {
  const warning = settlementCapacityDescription({ ready: false, fresh: true, checkedAt: 1_800_000_000_000,
    warning: "Settlement signer is below its minimum. New paid activity cannot be safely admitted; existing attempts may need recovery.",
    signer: { state: "low", balanceUnits: "5000" }, relayer: { state: "ready", balanceUnits: "100000" } });
  assert.match(warning, /Signer: low \(0\.005 pathUSD\)/);
  assert.match(warning, /relayer: ready/);
  assert.match(warning, /Checked: .*; fresh/);
  assert.match(warning, /Browsing and recovery remain available/);
  assert.equal(settlementCapacityDescription({ ready: false, fresh: false, checkedAt: null,
    warning: null, signer: { state: "checking", balanceUnits: null },
    relayer: { state: "checking", balanceUnits: null } }), "");
  assert.equal(settlementCapacityDescription({ ready: true }), "");
});
