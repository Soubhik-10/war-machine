import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("V6 board keeps V5 bounty cards visible and read-only", async () => {
  const source = await readFile(
    new URL("../dist/bounties.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /const isLegacyV5 = \(b\) =>/);
  assert.match(source, /LEGACY V5 · READ ONLY/);
  assert.match(
    source,
    /Existing V5 challenge; new entries are closed while V6 is active\./,
  );
  assert.match(source, /legacyV5 = isLegacyV5\(b\)/);
  assert.match(source, /!legacyV5 && b\.status === "open"/);
  assert.match(source, /!legacyV5 && own && \["open", "completed"\]/);
  assert.match(source, /!legacyV5 && me && isExpired/);
  assert.match(source, /historical entry/);
});
