import test from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { Battle } from '../dist/engine.mjs';
import { battleScene } from '../dist/scenes.mjs';
import { STRESS_MACHINES } from '../scripts/stress-machines.mjs';

const finite = values => values.every(Number.isFinite);

function snapshot(battle) {
  return {
    result: battle.result,
    tick: battle.tick,
    ring: battle.ring,
    vehicles: battle.vehicles.map(vehicle => ({
      x: vehicle.x, y: vehicle.y, vx: vehicle.vx, vy: vehicle.vy, a: vehicle.a,
      heat: vehicle.heat, energy: vehicle.energy, shield: vehicle.shield, damage: vehicle.damage,
      state: vehicle.combatState,
      modules: vehicle.modules.map(module => [module.uid, module.hp, module.cd, module.spool || 0]),
    })),
  };
}

function run(machine, opponent, arena, seed, swapSpawns = false) {
  const battle = new Battle(machine, opponent, arena, seed, { headless: true, swapSpawns });
  const result = battle.run();
  assert.equal(battle.fault, undefined, result?.reason);
  assert.equal(result?.fault, undefined, result?.reason);
  assert.ok(result.time >= 2 && result.time <= 100 + 1 / 60, 'unexpected duration: ' + result.time);
  assert.ok(finite(result.damage));
  for (const vehicle of battle.vehicles) {
    assert.ok(finite([vehicle.x, vehicle.y, vehicle.vx, vehicle.vy, vehicle.a, vehicle.heat, vehicle.energy, vehicle.shield, vehicle.radius, vehicle.damage]));
    assert.ok(vehicle.modules.every(module => Number.isFinite(module.hp) && Number.isFinite(module.cd) && module.hp >= 0));
  }
  const scene = battleScene(battle);
  assert.ok(finite([...scene.vertices, ...scene.effectVertices, ...scene.additiveVertices]));
  return { battle, state: snapshot(battle) };
}

test('dense tower and armor fixtures remain deterministic across hostile arenas', { timeout: 90_000 }, () => {
  const cases = [
    [18, 18, 'sunscar', 910_018, false], // equal four-tower builds under heat pressure
    [15, 19, 'brineworks', 910_115, true], // dense blast defenses through power leakage
    [3, 17, 'furnace', 910_203, false], // plasma and gatling thermal pressure
  ];
  for (const [left, right, arena, seed, swapSpawns] of cases) {
    const first = run(STRESS_MACHINES[left], STRESS_MACHINES[right], arena, seed, swapSpawns);
    const second = run(STRESS_MACHINES[left], STRESS_MACHINES[right], arena, seed, swapSpawns);
    assert.ok(isDeepStrictEqual(first.state, second.state), STRESS_MACHINES[left].name + ' replay diverged in ' + arena);
  }
});

test('dense mirrored builds do not merge at the contracting containment limit', () => {
  const battle = new Battle(STRESS_MACHINES[18], STRESS_MACHINES[18], 'sunscar', 615_204, { headless: true });
  const [a, b] = battle.vehicles;
  battle.time = 99;
  battle.ring = 145;
  a.x = b.x = 600;
  a.y = b.y = 400;
  for (let index = 0; index < 120; index++) {
    battle.collideVehicles();
    const separation = Math.hypot(a.x - b.x, a.y - b.y);
    assert.ok(Number.isFinite(separation));
    assert.ok(separation >= 45 - 1e-6, 'vehicles overlapped after collision ' + index);
  }
});
