// Normal gameplay benchmark.
// Covers the fixed-step game loop, scene generation and typed-array upload
// conversion, complete deterministic battles, and the settlement worker.

import { Worker } from "node:worker_threads";
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { Battle } from "../dist/engine.mjs";
import { PRESETS, packChallenge } from "../dist/data.mjs";
import { battleScene } from "../dist/scenes.mjs";
import { GRAPHICS_PROFILES } from "../dist/performance.mjs";
import { ENGINE_HASH } from "../server/store.mjs";

const samples = Math.max(1, Number(process.env.GAME_BENCH_SAMPLES || 8));
const workerSamples = Math.max(1, Number(process.env.GAME_BENCH_WORKER_SAMPLES || 3));
const frames = Math.max(1, Number(process.env.GAME_BENCH_FRAMES || 120));

const cases = [
  { name: "factory_foundry", challenger: PRESETS[7], defender: PRESETS[0], arena: "foundry", seed: 42 },
  { name: "factory_permafrost", challenger: PRESETS[8], defender: PRESETS[9], arena: "permafrost", seed: 1337 },
  { name: "factory_quarry", challenger: PRESETS[5], defender: PRESETS[6], arena: "quarry", seed: 1891596337 },
];

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function summary(name, values, extra = {}) {
  return {
    name,
    samples: values.length,
    minMs: Math.round(Math.min(...values) * 100) / 100,
    medianMs: Math.round(percentile(values, 0.5) * 100) / 100,
    p95Ms: Math.round(percentile(values, 0.95) * 100) / 100,
    maxMs: Math.round(Math.max(...values) * 100) / 100,
    ...extra,
  };
}

function uploadBuffer(geometry, state) {
  if (!state.upload || state.upload.length < geometry.vertices.length) {
    state.upload = new Float32Array(
      Math.max(1024, 2 ** Math.ceil(Math.log2(geometry.vertices.length))),
    );
  }
  state.upload.set(geometry.vertices);
}

function simulate(caseValue) {
  const battle = new Battle(
    caseValue.challenger,
    caseValue.defender,
    caseValue.arena,
    caseValue.seed,
    { mode: "auto", swapSpawns: !!(caseValue.seed & 1) },
  );
  while (!battle.result) battle.step();
  return battle.result;
}

function benchmarkFullBattle(caseValue) {
  const values = [];
  let result;
  for (let index = 0; index < samples; index += 1) {
    const started = performance.now();
    result = simulate(caseValue);
    values.push(performance.now() - started);
  }
  return summary(`normal_full_battle_${caseValue.name}`, values, {
    arena: caseValue.arena,
    result: { winner: result.winner, time: result.time, integrity: result.integrity },
  });
}

function benchmarkGameLoop(caseValue) {
  const values = [];
  let last = { steps: 0, uploadBytes: 0 };
  for (let index = 0; index < samples; index += 1) {
    const battle = new Battle(
      caseValue.challenger,
      caseValue.defender,
      caseValue.arena,
      caseValue.seed,
      { mode: "auto", swapSpawns: !!(caseValue.seed & 1) },
    );
    const started = performance.now();
    let steps = 0;
    let uploadBytes = 0;
    const uploadState = { upload: null };
    for (let frame = 0; frame < frames && !battle.result; frame += 1) {
      battle.step();
      steps += 1;
      const geometry = battleScene(battle, {
        reuse: true,
        quality: GRAPHICS_PROFILES.high,
      });
      uploadBuffer(geometry, uploadState);
      uploadBytes = geometry.vertices.length * 4;
    }
    values.push(performance.now() - started);
    last = { steps, uploadBytes };
  }
  return summary(`normal_game_loop_${caseValue.name}`, values, {
    frames,
    arena: caseValue.arena,
    simulationSteps: last.steps,
    perFrameUploadBytes: last.uploadBytes,
  });
}

function benchmarkScene(caseValue, quality) {
  const battle = new Battle(
    caseValue.challenger,
    caseValue.defender,
    caseValue.arena,
    caseValue.seed,
    { mode: "auto", swapSpawns: !!(caseValue.seed & 1) },
  );
  for (let index = 0; index < 60; index += 1) battle.step();
  const uploadState = { upload: null };
  for (let index = 0; index < 12; index += 1) {
    const geometry = battleScene(battle, { reuse: true, quality });
    uploadBuffer(geometry, uploadState);
  }
  const values = [];
  let uploadBytes = 0;
  let staticBytes = 0;
  for (let index = 0; index < samples * 4; index += 1) {
    const started = performance.now();
    const geometry = battleScene(battle, { reuse: true, quality });
    uploadBuffer(geometry, uploadState);
    values.push(performance.now() - started);
    uploadBytes = geometry.vertices.length * 4;
    staticBytes = (geometry.staticVertices?.length || 0) * 4;
  }
  return summary(`normal_scene_generation_${quality.tier}_${caseValue.name}`, values, {
    arena: caseValue.arena,
    perFrameUploadBytes: uploadBytes,
    oneTimeUploadBytes: staticBytes,
  });
}

async function workerBattle(caseValue) {
  return new Promise((resolve) => {
    const worker = new Worker(new URL("../server/battle-worker.mjs", import.meta.url), {
      workerData: {
        challenger: packChallenge(caseValue.challenger, caseValue.arena, 0),
        defender: packChallenge(caseValue.defender, caseValue.arena, 0),
        arena: caseValue.arena,
        seed: caseValue.seed,
        swapSpawns: !!(caseValue.seed & 1),
        engineHash: ENGINE_HASH,
      },
    });
    let finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      void worker.terminate();
      resolve(value);
    };
    const timer = setTimeout(() => finish({ error: "worker timeout" }), 30_000);
    worker.once("message", (value) => {
      clearTimeout(timer);
      finish(value);
    });
    worker.once("error", (error) => {
      clearTimeout(timer);
      finish({ error: error.message });
    });
  });
}

async function benchmarkWorker(caseValue) {
  const values = [];
  let result;
  for (let index = 0; index < workerSamples; index += 1) {
    const started = performance.now();
    result = await workerBattle(caseValue);
    values.push(performance.now() - started);
    if (result.error) throw new Error(result.error);
  }
  return summary(`normal_settlement_worker_${caseValue.name}`, values, {
    samples: values.length,
    arena: caseValue.arena,
    result: {
      winner: result.result.winner,
      time: result.result.time,
      integrity: result.result.integrity,
    },
  });
}

const results = [];
for (const caseValue of cases) {
  // Warm the JIT before collecting each family of measurements.
  simulate(caseValue);
  results.push(benchmarkGameLoop(caseValue));
  results.push(benchmarkScene(caseValue, GRAPHICS_PROFILES.high));
  results.push(benchmarkScene(caseValue, GRAPHICS_PROFILES.balanced));
  results.push(benchmarkFullBattle(caseValue));
  results.push(await benchmarkWorker(caseValue));
}

const output = {
  generatedAt: new Date().toISOString(),
  samples,
  workerSamples,
  frames,
  results,
};
await mkdir(new URL("../work/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../work/game-benchmark.json", import.meta.url),
  JSON.stringify(output, null, 2),
);
console.log(JSON.stringify(output, null, 2));
