import assert from "node:assert/strict";
import test from "node:test";
import { createHashRouter, parseRoute, serializeRoute } from "../dist/routes.mjs";

test("route parser preserves share links and identifies recoverable routes", () => {
  assert.deepEqual(parseRoute("#bounty=abc-123"), { name: "bounty", value: "abc-123" });
  assert.deepEqual(parseRoute("#free=abc-123"), { name: "free", value: "abc-123" });
  assert.deepEqual(parseRoute("#challenge=packed"), { name: "challenge", value: "packed" });
  assert.deepEqual(parseRoute("#rules-result"), { name: "anchor", value: "rules-result" });
  assert.deepEqual(parseRoute("#not-a-route"), { name: "missing", value: "not-a-route" });
  assert.equal(serializeRoute({ name: "bounties" }), "#bounties");
  assert.equal(serializeRoute({ name: "free-board" }), "#free-board");
  assert.equal(serializeRoute({ name: "bounty", value: "abc-123" }), "#bounty=abc-123");
  assert.equal(serializeRoute({ name: "free", value: "abc-123" }), "#free=abc-123");
});

test("back and forward restore one screen even when both browser events fire", async () => {
  const windowRef = new EventTarget();
  const entries = [{ hash: "#home", state: null }];
  let index = 0;
  windowRef.location = { hash: "#home" };
  windowRef.history = {
    get state() {
      return entries[index].state;
    },
    pushState(state, _title, hash) {
      entries.splice(index + 1);
      entries.push({ hash, state });
      index++;
      windowRef.location.hash = hash;
    },
    replaceState(state, _title, hash) {
      entries[index] = { hash, state };
      windowRef.location.hash = hash;
    },
  };
  const renders = [];
  const router = createHashRouter({
    windowRef,
    render(route, meta) {
      renders.push([route.name, meta.source]);
    },
  });
  router.start();
  router.navigate({ name: "workshop" });
  router.navigate({ name: "arena" });
  assert.equal(entries.length, 3);
  const workshopRendersBeforeRestore = renders.filter(([name]) => name === "workshop").length;

  index--;
  windowRef.location.hash = entries[index].hash;
  windowRef.dispatchEvent(new Event("popstate"));
  windowRef.dispatchEvent(new Event("hashchange"));
  await Promise.resolve();
  assert.deepEqual(renders.at(-1), ["workshop", "restore"]);
  assert.equal(renders.filter(([name]) => name === "workshop").length, workshopRendersBeforeRestore + 1);

  index++;
  windowRef.location.hash = entries[index].hash;
  windowRef.dispatchEvent(new Event("popstate"));
  windowRef.dispatchEvent(new Event("hashchange"));
  await Promise.resolve();
  assert.deepEqual(renders.at(-1), ["arena", "restore"]);
  router.navigate({ name: "arena" });
  assert.equal(entries.length, 3, "same-route navigation replaces instead of pushing");
});
