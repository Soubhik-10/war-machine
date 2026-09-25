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

test('containment field keeps vehicles inside the contracting ring', () => {
  const battle = new Battle(PRESETS[0], PRESETS[0], 'foundry', 42, { headless: true });
  const vehicle = battle.vehicles[0];
  battle.time = 90;
  battle.tick = 5400;
  vehicle.x = 1120;
  vehicle.y = 740;
  vehicle.vx = 120;
  vehicle.vy = 80;
  battle.updateVehicle = () => {};
  battle.updateMines = () => {};
  battle.updateProjectiles = () => {};
  battle.updateObjectives = () => {};
  battle.collideVehicles = () => {};
  battle.step();
  const distance = Math.hypot(vehicle.x - 600, vehicle.y - 400);
  assert.ok(distance <= battle.ring - vehicle.radius + 1);
  assert.ok(battle.events.some((event) => event.text.includes('forced a return')));
});

test('overlapping vehicles separate deterministically inside a tight containment ring', () => {
  const battle = new Battle(PRESETS[0], PRESETS[0], 'foundry', 7654, { headless: true }),
    [a, b] = battle.vehicles;
  battle.time = 99;
  battle.ring = 200;
  a.radius = 170;
  b.radius = 170;
  a.x = b.x = 600;
  a.y = b.y = 400;
  for (let i = 0; i < 20; i += 1) {
    battle.collideVehicles();
    assert.ok([a.x, a.y, b.x, b.y].every(Number.isFinite));
    assert.ok(Math.hypot(b.x - a.x, b.y - a.y) >= 89.99);
  }
});

test('simulation catches invalid state and returns a safe, explicit stop instead of throwing', () => {
  const battle = new Battle(PRESETS[0], PRESETS[1], 'foundry', 91, { headless: true });
  battle.time = 3;
  battle.vehicles[0].x = Number.NaN;
  assert.doesNotThrow(() => battle.step());
  assert.equal(battle.fault, true);
  assert.equal(battle.result.fault, true);
  assert.equal(battle.result.reason, 'Simulation safety stop');
  assert.equal(battle.result.winner, -1);
});

test('run has a hard step ceiling even if a frame cannot advance', () => {
  const battle = new Battle(PRESETS[0], PRESETS[1], 'foundry', 92, { headless: true });
  battle.step = () => {};
  const result = battle.run();
  assert.equal(result.fault, true);
  assert.equal(result.reason, 'Simulation safety stop');
});

test('identical machines complete a contracting-zone mirror fight without corrupting state', () => {
  const battle = new Battle(PRESETS[0], PRESETS[0], 'foundry', 42, { headless: true }),
    result = battle.run();
  assert.equal(battle.fault, undefined);
  assert.ok(result.time <= 100 + 1 / 60);
  assert.ok(result.damage.every(Number.isFinite));
  assert.ok(battle.vehicles.every((vehicle) => [vehicle.x, vehicle.y, vehicle.heat, vehicle.energy].every(Number.isFinite)));
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
