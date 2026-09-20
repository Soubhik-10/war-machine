import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Battle } from '../dist/engine.mjs';
import { PRESETS, clone } from '../dist/data.mjs';
import { classifyGraphicsTier } from '../dist/performance.mjs';
import {
  ENGINE_EVALUATORS,
  LEGACY_ENGINE_HASH,
} from '../settlement/protocol.mjs';

const tower = () => ({
  ...clone(PRESETS[0]),
  modules: [
    { id: 'core', x: 4, y: 4, r: 0 },
    { id: 'frame', x: 5, y: 4, r: 0 },
    { id: 'cannon', x: 5, y: 4, z: 1, r: 0 },
    { id: 'wheel', x: 4, y: 5, r: 0 },
  ],
});

test('core loss still applies structural support collapse', () => {
  const battle = new Battle(tower(), PRESETS[0], 'salt', 42, { headless: true });
  const vehicle = battle.vehicles[0];
  vehicle.shield = 0;
  battle.damageModule(vehicle, vehicle.modules.find((m) => m.id === 'core'), 10_000, 1, { bypass: true });
  battle.damageModule(vehicle, vehicle.modules.find((m) => m.id === 'frame'), 10_000, 1, { bypass: true });
  battle.detach(vehicle);
  assert.equal(vehicle.modules.find((m) => m.id === 'cannon').hp, 0);
  assert.ok(vehicle.modules.find((m) => m.id === 'wheel').hp > 0);
  assert.equal(vehicle.dead, false);
});

test('coreless fragments remain vulnerable to containment damage', () => {
  const battle = new Battle(PRESETS[0], PRESETS[0], 'salt', 42, { headless: true });
  const vehicle = battle.vehicles[0];
  vehicle.shield = 0;
  battle.damageModule(vehicle, vehicle.modules.find((m) => m.id === 'core'), 10_000, 1, { bypass: true });
  battle.time = 60;
  battle.tick = 3600;
  vehicle.x = 0;
  vehicle.y = 0;
  battle.updateVehicle = () => {};
  battle.updateObjectives = () => {};
  const before = vehicle.modules.reduce((sum, module) => sum + module.hp, 0);
  battle.step();
  const after = vehicle.modules.reduce((sum, module) => sum + module.hp, 0);
  assert.ok(before - after > 0);
});

test('headless evaluation preserves deterministic battle outcomes', () => {
  const rendered = new Battle(PRESETS[7], PRESETS[0], 'foundry', 913);
  const headless = new Battle(PRESETS[7], PRESETS[0], 'foundry', 913, { headless: true });
  assert.deepEqual(headless.run(), rendered.run());
  assert.deepEqual(headless.events, rendered.events);
  assert.deepEqual(headless.vehicles, rendered.vehicles);
});

test('unknown graphics telemetry selects the bounded profile', () => {
  assert.equal(classifyGraphicsTier(), 'balanced');
  assert.equal(classifyGraphicsTier({ hardwareConcurrency: 8, deviceMemory: 16 }), 'balanced');
  assert.equal(classifyGraphicsTier({ hardwareConcurrency: 8, deviceMemory: 16, renderer: 'ANGLE (NVIDIA RTX)' }), 'high');
});

test('legacy evaluator registry is immutable and rejects no known release', () => {
  assert.ok(ENGINE_EVALUATORS[LEGACY_ENGINE_HASH]);
  assert.equal(Object.isFrozen(ENGINE_EVALUATORS), true);
  assert.equal(typeof ENGINE_EVALUATORS[LEGACY_ENGINE_HASH].Battle, 'function');
});

test('legacy evaluator snapshot retains the audited engine and catalog hash', () => {
  const source = (name) => readFileSync(new URL(`../settlement/engines/${name}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  const hash = createHash('sha256').update(source('4b762a9b76ba071b27799113a0aafb5b8a04a7a02e21a445e60295f3c82ca365.mjs')).update(source('data.mjs')).digest('hex');
  assert.equal(hash, LEGACY_ENGINE_HASH);
});
