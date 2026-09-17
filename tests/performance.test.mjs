import test from "node:test";
import assert from "node:assert/strict";
import { Battle } from "../dist/engine.mjs";
import { PRESETS } from "../dist/data.mjs";
import { battleScene } from "../dist/scenes.mjs";
import {
  GRAPHICS_PROFILES,
  classifyGraphicsTier,
  powerProfile,
} from "../dist/performance.mjs";

test("high graphics profile preserves the fresh scene output", () => {
  const reusedBattle = new Battle(PRESETS[7], PRESETS[0], "foundry", 42);
  const freshBattle = new Battle(PRESETS[7], PRESETS[0], "foundry", 42);
  for (let index = 0; index < 20; index += 1) {
    reusedBattle.step();
    freshBattle.step();
  }
  const reused = battleScene(reusedBattle, {
    reuse: true,
    quality: GRAPHICS_PROFILES.high,
  });
  const fresh = battleScene(freshBattle, {
    quality: GRAPHICS_PROFILES.high,
  });
  assert.equal(
    reused,
    battleScene(reusedBattle, {
      reuse: true,
      quality: GRAPHICS_PROFILES.high,
    }),
  );
  assert.deepEqual(reused.vertices, fresh.vertices);
  assert.deepEqual(reused.staticVertices, fresh.staticVertices);
});

test("graphics classification maps weak devices to balanced and capable devices to high", () => {
  assert.equal(
    classifyGraphicsTier({
      hardwareConcurrency: 2,
      deviceMemory: 2,
      renderer: "Google SwiftShader",
    }),
    "balanced",
  );
  assert.equal(
    classifyGraphicsTier({
      hardwareConcurrency: 16,
      deviceMemory: 32,
      renderer: "ANGLE (NVIDIA GeForce RTX 5070 Ti)",
    }),
    "high",
  );
  assert.equal(
    classifyGraphicsTier({
      hardwareConcurrency: 4,
      deviceMemory: 4,
      renderer: "ANGLE (Intel UHD Graphics)",
    }),
    "high",
  );
});

test("graphics policy has a tuned balanced tier and an absolute-high tier", () => {
  assert.deepEqual(Object.keys(GRAPHICS_PROFILES), ["balanced", "high"]);
  assert.equal(GRAPHICS_PROFILES.balanced.maxPixelRatio, 1.1);
  assert.equal(GRAPHICS_PROFILES.balanced.renderHz, 50);
  assert.equal(GRAPHICS_PROFILES.balanced.effects, "reduced");
  assert.equal(GRAPHICS_PROFILES.balanced.debrisLimit, 96);
  assert.equal(GRAPHICS_PROFILES.high.effects, "full");
  assert.equal(GRAPHICS_PROFILES.high.debrisLimit, Infinity);
});

test("battery policy only steps high down to balanced while discharging", () => {
  assert.equal(powerProfile(GRAPHICS_PROFILES.high, { charging: true, level: 0.1 }).tier, "high");
  assert.equal(powerProfile(GRAPHICS_PROFILES.high, { charging: false, level: 0.5 }).tier, "high");
  assert.equal(powerProfile(GRAPHICS_PROFILES.high, { charging: false, level: 0.1 }).tier, "balanced");
  assert.equal(powerProfile(GRAPHICS_PROFILES.balanced, { charging: false, level: 0.1 }).tier, "balanced");
});
