import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { ARENAS, PRESETS } from '../dist/data.mjs';
import { Battle } from '../dist/engine.mjs';
import { battleScene } from '../dist/scenes.mjs';
import { STRESS_MACHINES } from './stress-machines.mjs';

// This is intentionally separate from the fast unit suite. The fleet sits at
// the legal mass/part limits and a complete arena matrix can take several
// minutes on a laptop. It is a release/soak gate, not a benchmark that should
// be accidentally run on every edit.
const args = process.argv.slice(2);
const mode = args.includes('--soak') ? 'soak' : args.includes('--full') ? 'full' : 'quick';
const deterministic = args.includes('--deterministic');
const replayStride = deterministic ? 1 : mode === 'quick' ? 5 : mode === 'full' ? 8 : 11;
const maxMatches = parsePositiveOption('--max-matches');
const shard = parseShard(args.find(arg => arg.startsWith('--shard='))?.slice('--shard='.length));

function parsePositiveOption(name) {
  const value = args.find(arg => arg.startsWith(name + '='))?.slice(name.length + 1);
  if (value === undefined) return Infinity;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(name + ' must be a positive integer');
  return parsed;
}

function parseShard(value) {
  if (!value) return null;
  const match = /^(\d+)\/(\d+)$/.exec(value);
  if (!match) throw new Error('--shard must use one-based N/TOTAL form, for example --shard=1/4');
  const index = Number(match[1]), total = Number(match[2]);
  if (!Number.isInteger(index) || !Number.isInteger(total) || index < 1 || index > total) throw new Error('Invalid --shard range');
  return { index, total };
}

function caseId(testCase) {
  return testCase.machine.name + ' vs ' + testCase.opponent.name + ' · ' + testCase.arena + ' · ' + testCase.seed + (testCase.swapSpawns ? ' · swapped' : '');
}

function fullCases() {
  return STRESS_MACHINES.flatMap((machine, index) => [
    { machine, opponent: PRESETS[index % PRESETS.length], arena: ARENAS[index % ARENAS.length].id, seed: 7331 + index, swapSpawns: false, lane: 'catalog' },
    { machine, opponent: PRESETS[(index + 3) % PRESETS.length], arena: ARENAS[(index + 1) % ARENAS.length].id, seed: 191 + index * 17, swapSpawns: true, lane: 'catalog-swap' },
    { machine, opponent: STRESS_MACHINES[(index + 7) % STRESS_MACHINES.length], arena: ARENAS[(index + 2) % ARENAS.length].id, seed: 8675309 + index, swapSpawns: index % 2 === 0, lane: 'dense' },
    { machine, opponent: STRESS_MACHINES[(index + 13) % STRESS_MACHINES.length], arena: ARENAS[(index + 3) % ARENAS.length].id, seed: 42000 + index * 31, swapSpawns: index % 2 === 1, lane: 'dense-swap' },
  ]);
}

function soakCases() {
  // Each dense fixture crosses every arena exactly once. The offset opponent
  // avoids twenty trivial self-mirrors, while every fifth case deliberately
  // uses an exact mirror to exercise equal steering/damage trajectories.
  return ARENAS.flatMap((arena, arenaIndex) => STRESS_MACHINES.map((machine, index) => ({
    machine,
    opponent: (index + arenaIndex) % 5 === 0 ? machine : STRESS_MACHINES[(index * 7 + arenaIndex * 3 + 1) % STRESS_MACHINES.length],
    arena: arena.id,
    seed: 910_000 + arenaIndex * 1000 + index * 37,
    swapSpawns: (index + arenaIndex) % 2 === 1,
    lane: (index + arenaIndex) % 5 === 0 ? 'arena-mirror' : 'arena-matrix',
  })));
}

function pickCases() {
  const all = mode === 'soak' ? soakCases() : fullCases();
  const selected = mode === 'quick' ? all.filter((_, index) => index % 4 === 0) : all;
  const sharded = shard ? selected.filter((_, index) => index % shard.total === shard.index - 1) : selected;
  return sharded.slice(0, maxMatches);
}

function compactState(battle) {
  return {
    result: battle.result,
    tick: battle.tick,
    ring: battle.ring,
    vehicles: battle.vehicles.map(vehicle => ({
      x: vehicle.x, y: vehicle.y, vx: vehicle.vx, vy: vehicle.vy, a: vehicle.a,
      heat: vehicle.heat, energy: vehicle.energy, shield: vehicle.shield, damage: vehicle.damage,
      state: vehicle.combatState, modules: vehicle.modules.map(module => [module.uid, module.hp, module.cd, module.spool || 0]),
    })),
    events: battle.events,
  };
}

function finite(values, label) {
  if (!values.every(Number.isFinite)) throw new Error('Non-finite ' + label);
}

function assertHealthy(battle, result, testCase, inspectScene) {
  const id = caseId(testCase);
  if (!result || battle.fault || result.fault) throw new Error(id + ': simulation fault');
  if (!Number.isFinite(result.time) || result.time < 0 || result.time > 100 + 1 / 60) throw new Error(id + ': invalid result time ' + result.time);
  if (![-1, 0, 1].includes(result.winner)) throw new Error(id + ': invalid winner ' + result.winner);
  finite(result.damage, id + ' result damage');
  for (const vehicle of battle.vehicles) {
    finite([vehicle.x, vehicle.y, vehicle.vx, vehicle.vy, vehicle.a, vehicle.heat, vehicle.energy, vehicle.shield, vehicle.radius, vehicle.damage], id + ' vehicle state');
    if (vehicle.modules.some(module => !Number.isFinite(module.hp) || !Number.isFinite(module.cd) || module.hp < 0)) throw new Error(id + ': invalid module state');
  }
  if (inspectScene) {
    const scene = battleScene(battle);
    finite([...scene.vertices, ...scene.effectVertices, ...scene.additiveVertices], id + ' render mesh');
  }
}

function runOne(testCase, inspectScene) {
  const battle = new Battle(testCase.machine, testCase.opponent, testCase.arena, testCase.seed, {
    headless: true,
    swapSpawns: testCase.swapSpawns,
  });
  let minSeparation = Infinity;
  const collide = battle.collideVehicles.bind(battle);
  battle.collideVehicles = () => {
    collide();
    const [a, b] = battle.vehicles;
    const separation = Math.hypot(a.x - b.x, a.y - b.y);
    minSeparation = Math.min(minSeparation, separation);
    // A zero-distance overlap was the historic shrinking-zone failure. Throw
    // here so Battle converts it to an explicit safe fault and the soak fails.
    if (!Number.isFinite(separation) || separation < 1) throw new Error('Vehicle overlap was not resolved');
  };
  const started = performance.now();
  const result = battle.run();
  const wallMs = performance.now() - started;
  assertHealthy(battle, result, testCase, inspectScene);
  return { battle, result, wallMs, minSeparation };
}

const cases = pickCases();
if (!cases.length) throw new Error('No stress matches selected');

const started = performance.now();
const rows = [];
const failures = [];
let replayChecks = 0;

for (const [index, testCase] of cases.entries()) {
  try {
    const first = runOne(testCase, index % 10 === 0);
    const replay = index % replayStride === 0;
    if (replay) {
      const second = runOne(testCase, false);
      replayChecks++;
      if (!isDeepStrictEqual(compactState(first.battle), compactState(second.battle))) throw new Error(caseId(testCase) + ': same-seed replay diverged');
    }
    rows.push({
      machine: testCase.machine.name,
      opponent: testCase.opponent.name,
      arena: testCase.arena,
      lane: testCase.lane,
      simSeconds: first.result.time,
      steps: first.battle.tick,
      wallMs: first.wallMs,
      minSeparation: first.minSeparation,
      replay,
    });
  } catch (error) {
    failures.push({ case: caseId(testCase), error: error instanceof Error ? error.message : String(error) });
  }
}

const ordered = [...rows].sort((a, b) => b.wallMs - a.wallMs);
const percentile = fraction => ordered.length ? ordered[Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * fraction))].wallMs : 0;
const summary = {
  mode,
  requestedMatches: cases.length,
  completedMatches: rows.length,
  replayChecks,
  failedMatches: failures.length,
  totalWallMs: Math.round((performance.now() - started) * 100) / 100,
  averageWallMs: Math.round((rows.reduce((total, row) => total + row.wallMs, 0) / Math.max(1, rows.length)) * 100) / 100,
  p95WallMs: Math.round(percentile(.95) * 100) / 100,
  slowestMatches: ordered.slice(0, 5).map(row => ({ ...row, wallMs: Math.round(row.wallMs * 100) / 100, minSeparation: Math.round(row.minSeparation * 100) / 100 })),
  shard,
  failures,
};
console.log(JSON.stringify(summary, null, 2));
if (failures.length) process.exitCode = 1;
