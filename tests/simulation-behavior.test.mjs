import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle, DT } from '../dist/engine.mjs';
import { PRESETS, clone } from '../dist/data.mjs';

const hp = (v) => v.modules.reduce((total, m) => total + m.hp, 0);
const simple = (weapons = ['cannon']) => ({
  ...clone(PRESETS[0]),
  modules: [
    { id: 'core', x: 4, y: 4 },
    { id: 'wheel', x: 3, y: 4 },
    { id: 'wheel', x: 5, y: 4 },
    ...weapons.map((id, n) => ({ id, x: 4 + n, y: 3 })),
  ],
});
const arm = (b) => { b.time = 2; b.tick = 120; };

test('containment spends a time-based bypass budget on core and surviving coreless parts', () => {
  for (const coreless of [false, true]) {
    const losses = [];
    for (const dt of [DT, DT * 4]) {
      const b = new Battle(PRESETS[0], PRESETS[1], 'salt', 42, { headless: true });
      const v = b.vehicles[0];
      b.time = 60;
      b.ring = 220;
      v.shield = 1000;
      if (coreless) b.damageModule(v, v.modules.find(m => m.id === 'core'), 10000, null, { bypass: true });
      const before = hp(v);
      for (let t = 0; t < 1 - 1e-8; t += dt) {
        v.x = 600 + Math.max(45, b.ring - v.radius - 8) + 5;
        v.y = 400;
        assert.equal(b.keepInsideField(v, dt), true);
      }
      losses.push(before - hp(v));
      assert.equal(v.shield, 1000);
    }
    assert.ok(losses[0] > 18);
    assert.ok(Math.abs(losses[0] - losses[1]) < 1e-7, JSON.stringify(losses));
  }
});

test('containment boundary and small radius remain finite and exact', () => {
  const b = new Battle(simple(), simple(), 'foundry', 2, { headless: true });
  const v = b.vehicles[0];
  b.time = 60;
  b.ring = 0;
  const before = hp(v);
  v.x = 600 + 45; v.y = 400;
  assert.equal(b.keepInsideField(v, DT), false);
  assert.equal(hp(v), before);
  v.radius = 500;
  v.x = 700;
  assert.equal(b.keepInsideField(v, DT), true);
  assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y));
  assert.ok(hp(v) < before);
});

test('slow progress and intentional range hold do not arm recovery; obstruction does', () => {
  const b = new Battle(simple(), simple(), 'foundry', 3, { headless: true });
  const v = b.vehicles[0], enemy = b.vehicles[1];
  v.s.thrust = 1;
  for (let i = 0; i < 100; i++) {
    v.x += .1;
    b.updateStall(v, enemy, DT, 200, 6, false);
  }
  assert.equal(v.repositionCount, 0);
  v.x = enemy.x - 200;
  b.updateStall(v, enemy, DT, 200, 6, false);
  assert.equal(v.stallRecovery, 0);
  v.x = 260;
  for (let i = 0; i < 100; i++) {
    v.x = 260 + (i % 2 ? .2 : -.2);
    b.updateStall(v, enemy, DT, 200, 6, false);
  }
  assert.equal(v.repositionCount, 1);
  v.s.thrust = 0;
  b.updateStall(v, enemy, DT, 200, 0, false);
  assert.equal(v.stallRecovery, 0);
});

test('a blocked firing lane recovers inside preferred range and target changes reset it', () => {
  const b = new Battle(simple(), simple(), 'foundry', 31, { headless: true });
  const v = b.vehicles[0], enemy = b.vehicles[1];
  b.arena.obstacles = [{ x: 800, y: 0, w: 5, h: 800, height: 100, hp: 100 }];
  v.x = enemy.x - 200;
  for (let i = 0; i < 100; i++) {
    b.time += DT;
    b.updateStall(v, enemy, DT, 200, 6, false);
  }
  assert.equal(v.repositionCount, 1);
  v.target = 'core';
  b.updateStall(v, enemy, DT, 200, 6, false);
  assert.equal(v.stallRecovery, 0);
});

test('recovery has no teleport and cannot move a propulsion-free machine or cross thin cover', () => {
  for (const swapSpawns of [false, true]) {
    const b = new Battle(simple(['ram']), simple(), 'foundry', 4, { headless: true, swapSpawns });
    const v = b.vehicles[0], enemy = b.vehicles[1];
    arm(b);
    const wall = swapSpawns ? 800 : 400;
    b.arena.obstacles = [{ x: wall, y: 0, w: 2, h: 800, hp: 100, height: 100 }];
    v.x = swapSpawns ? 940 : 260; v.y = 400; v.vx = swapSpawns ? -500 : 500; v.vy = 0; v.stallRecovery = 2; v.stallDirection = 1;
    b.updateVehicle(v, enemy, .5);
    assert.ok(swapSpawns ? v.x > wall + 2 + v.radius : v.x < wall - v.radius, `crossed thin wall: ${v.x}`);
    for (const m of v.modules.filter(m => m.id === 'wheel')) b.damageModule(v, m, 10000, null, { bypass: true });
    b.recalc(v); v.vx = 0; v.vy = 0;
    const x = v.x, y = v.y;
    b.updateVehicle(v, enemy, DT);
    assert.equal(Math.hypot(v.x - x, v.y - y), 0);
  }
});

test('core loss is crippled, disarmament is disabled, and ram remains combat-capable', () => {
  const b = new Battle(simple(['ram']), simple(), 'foundry', 5, { headless: true });
  const v = b.vehicles[0];
  b.damageModule(v, v.modules.find(m => m.id === 'core'), 10000, null, { bypass: true });
  b.recalc(v);
  assert.equal(v.combatState, 'crippled');
  assert.equal(v.dead, false);
  assert.equal(b.result, null);
  b.damageModule(v, v.modules.find(m => m.id === 'ram'), 10000, null, { bypass: true });
  b.recalc(v);
  assert.equal(v.combatState, 'disabled');
  arm(b);
  b.step();
  assert.equal(b.result?.winner, 1);
  assert.equal(b.result?.reason, 'Combat systems disabled');
});

test('a machine built without weapons starts disabled after arming', () => {
  const b = new Battle(simple([]), simple(), 'foundry', 51, { headless: true });
  assert.equal(b.vehicles[0].combatState, 'disabled');
  assert.equal(b.vehicles[0].dead, false);
  arm(b);
  b.step();
  assert.equal(b.result?.winner, 1);
  assert.equal(b.result?.reason, 'Combat systems disabled');
});

test('mutual disable waits for live projectiles and mines, then draws', () => {
  const b = new Battle(simple(), simple(), 'foundry', 6, { headless: true });
  arm(b);
  for (const v of b.vehicles) b.damageModule(v, v.modules.find(m => m.id === 'cannon'), 10000, null, { bypass: true });
  b.projectiles = [{ side: 0, life: 1 }];
  b.mines = [{ side: 1, life: 1 }];
  b.updateProjectiles = () => {};
  b.updateMines = () => {};
  b.step();
  assert.equal(b.result, null);
  b.projectiles = []; b.mines = [];
  b.step();
  assert.equal(b.result?.winner, -1);
  assert.equal(b.result?.reason, 'Both machines lost their weapons');
  assert.deepEqual(b.vehicles.map(v => v.combatState), ['disabled', 'disabled']);
});

test('complete destruction is distinct from core loss and ends the match', () => {
  const b = new Battle(simple(), simple(), 'foundry', 61, { headless: true });
  arm(b);
  const v = b.vehicles[0];
  for (const m of v.modules.filter(m => m.id !== 'core')) b.damageModule(v, m, 10000, null, { bypass: true });
  b.damageModule(v, v.modules.find(m => m.id === 'core'), 10000, null, { bypass: true });
  b.recalc(v);
  assert.equal(v.combatState, 'destroyed');
  assert.equal(v.dead, true);
  b.step();
  assert.equal(b.result?.winner, 1);
  assert.equal(b.result?.reason, 'Machine destroyed');
});

test('timeout reason is well-formed and terminal event reports states', () => {
  const b = new Battle(simple(), simple(), 'foundry', 7, { headless: true, observeEvents: true });
  b.time = 100; b.tick = 6000;
  b.updateVehicle = () => {};
  b.updateMines = () => {};
  b.updateProjectiles = () => {};
  b.updateObjectives = () => {};
  b.step();
  assert.equal(b.result?.reason, 'Time limit · weighted integrity');
  assert.equal(b.combatEvents.at(-1)?.kind, 'terminal');
  assert.deepEqual(b.combatEvents.at(-1)?.states, ['operational', 'operational']);
});

test('escort emits one terminal observation after its final objective decision', () => {
  const b = new Battle(simple(), simple(), 'foundry', 71, { headless: true, observeEvents: true, objective: 'escort' });
  arm(b);
  b.escort[0].reached = true;
  b.updateVehicle = () => {};
  b.updateObjectives = () => {};
  b.step();
  assert.equal(b.result?.reason, 'Escort reached extraction');
  assert.deepEqual(b.combatEvents.filter(e => e.kind === 'terminal').map(e => e.winner), [0]);
  const seq = b.combatEventSeq;
  b.step();
  assert.equal(b.combatEventSeq, seq);
});

test('observational events are bounded and preserve headless/rendered and 1×/4× results', () => {
  const battles = [
    new Battle(PRESETS[0], PRESETS[1], 'foundry', 42, { headless: true, observeEvents: true }),
    new Battle(PRESETS[0], PRESETS[1], 'foundry', 42, { observeEvents: true }),
    new Battle(PRESETS[0], PRESETS[1], 'foundry', 42, { headless: true, observeEvents: true }),
  ];
  while (!battles[0].result) battles[0].step();
  while (!battles[1].result) battles[1].step();
  while (!battles[2].result) for (let i = 0; i < 4; i++) battles[2].step();
  assert.deepEqual(battles[0].result, battles[1].result);
  assert.deepEqual(battles[0].result, battles[2].result);
  assert.deepEqual(battles[0].combatEvents, battles[1].combatEvents);
  assert.deepEqual(battles[0].combatEvents, battles[2].combatEvents);
  assert.ok(battles[0].combatEvents.length <= 256);
  assert.ok(battles[0].combatEvents.every((e, i, a) => i === 0 || e.seq === a[i - 1].seq + 1));
  assert.ok(battles[0].combatEventsSince(battles[0].combatEventSeq - 1).length <= 1);
  const silent = new Battle(simple(), simple(), 'foundry', 42, { headless: true });
  silent.run();
  assert.equal(silent.combatEvents.length, 0);
  assert.equal(silent.combatEventSeq, 0);
});

test('pellet volleys emit one fire record and wrapped queues expose a sequence gap', () => {
  const b = new Battle(simple(['flak']), simple(), 'foundry', 81, { headless: true, observeEvents: true });
  arm(b);
  b.arena.obstacles = [];
  const v = b.vehicles[0], enemy = b.vehicles[1];
  v.x = 600; v.y = 400; enemy.x = 750; enemy.y = 400;
  v.modules.find(m => m.id === 'flak').cd = 0;
  b.updateVehicle(v, enemy, DT);
  const fires = b.combatEvents.filter(e => e.kind === 'fire' && e.side === 0);
  assert.equal(fires.length, 1);
  assert.equal(fires[0].pellets, 6);
  for (let i = 0; i < 300; i++) b.emitCombat({ kind: 'fixture' });
  assert.equal(b.combatEvents.length, 256);
  assert.equal(b.combatEventsSince(0)[0].seq, b.combatEventSeq - 255);
});
