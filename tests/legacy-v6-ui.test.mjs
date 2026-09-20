import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("V6 board hides V5 bounty cards while preserving read-only links", async () => {
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
  assert.match(source, /const shown = data\.filter\(\s*\(b\) =>\s*!isLegacyV5\(b\) &&/);
  assert.match(source, /!legacyV5 && b\.status === "open"/);
  assert.match(source, /!legacyV5 && own && \["open", "completed"\]/);
  assert.match(source, /!legacyV5 && me && isExpired/);
  assert.match(source, /historical entry/);
  assert.match(source, /isExpired = deadlinePassed && b\.status === "open"/);
  assert.match(source, /!legacyV5 && me && isExpired && b\.status === "open"/);
  assert.match(source, /Active paid attempt/);
});
