import { performance } from 'node:perf_hooks';
import { Battle } from '../dist/engine.mjs';
import { PRESETS } from '../dist/data.mjs';
import { STRESS_MACHINES } from './stress-machines.mjs';

const arenas = ['foundry', 'quarry', 'furnace', 'brineworks'];
const baselines = [PRESETS[0], PRESETS[8], PRESETS[9]];
const fullSweep = process.argv.includes('--full');
const rows = [];
const started = performance.now();

for (const [index, machine] of STRESS_MACHINES.entries()) {
  const cases = [
    { opponent: baselines[index % baselines.length], arena: arenas[index % arenas.length], seed: 7331 + index, swapSpawns: false },
    { opponent: baselines[(index + 1) % baselines.length], arena: arenas[(index + 1) % arenas.length], seed: 191 + index * 17, swapSpawns: true },
    { opponent: STRESS_MACHINES[(index + 7) % STRESS_MACHINES.length], arena: arenas[(index + 2) % arenas.length], seed: 8675309 + index, swapSpawns: index % 2 === 0 },
    { opponent: STRESS_MACHINES[(index + 13) % STRESS_MACHINES.length], arena: arenas[(index + 3) % arenas.length], seed: 42000 + index * 31, swapSpawns: index % 2 === 1 },
  ];
  const results = [];
  for (const testCase of fullSweep ? cases : cases.slice(0, 1)) {
    const matchStart = performance.now();
    const battle = new Battle(machine, testCase.opponent, testCase.arena, testCase.seed, {
      headless: true,
      swapSpawns: testCase.swapSpawns,
    });
    const result = battle.run();
    const wallMs = performance.now() - matchStart;
    const row = {
      machine: machine.name,
      opponent: testCase.opponent.name,
      arena: testCase.arena,
      seed: testCase.seed,
      swapped: testCase.swapSpawns,
      simSeconds: result.time,
      steps: battle.tick,
      wallMs: Math.round(wallMs * 100) / 100,
      winner: result.winner < 0 ? 'draw' : result.winner === 0 ? machine.name : testCase.opponent.name,
    };
    results.push(row);
    rows.push(row);
  }
  console.log(JSON.stringify({
    machine: machine.name,
    sweep: fullSweep ? 'full' : 'quick',
    modules: machine.modules.length,
    parts: machine.stressMeta.parts,
    mass: machine.stressMeta.mass,
    weapons: machine.stressMeta.weapons,
    towers: machine.stressMeta.towers,
    matches: results.length,
    maxWallMs: Math.max(...results.map(row => row.wallMs)),
    averageWallMs: Math.round(results.reduce((sum, row) => sum + row.wallMs, 0) / results.length * 100) / 100,
  }));
}

const wallMs = performance.now() - started;
console.log(JSON.stringify({
  totalMachines: STRESS_MACHINES.length,
  sweep: fullSweep ? 'full' : 'quick',
  totalMatches: rows.length,
  totalWallMs: Math.round(wallMs * 100) / 100,
  slowestMatches: [...rows].sort((a, b) => b.wallMs - a.wallMs).slice(0, 5),
}));
