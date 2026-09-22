import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("V6 detail explains removed app records while preserving engine immutability", async () => {
  const source = await readFile(
    new URL("../dist/bounties.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /const missing = id && e\.status === 404/);
  assert.match(source, /Older escrow records were removed during the V6 cleanup/);
  assert.match(source, /this did not change any on-chain escrow/);
  assert.match(source, /!b\.compatible \|\| \(!runtime\.paid && !me\)/);
  assert.match(source, /This challenge uses an older engine version\. Its result remains available, but you cannot submit a new machine\./);
});
