import { parentPort } from "node:worker_threads";
import { Battle } from "../dist/engine.mjs";

parentPort.on("message", ({ index, candidate, locked, seeds }) => {
  try {
    const results = seeds.map((seed) => {
      const result = new Battle(
        candidate.machine,
        locked.machine,
        locked.arena,
        seed,
        { mode: "auto", swapSpawns: !!(seed & 1) },
      ).run();
      return { seed, winner: result.winner, time: result.time, integrity: result.integrity };
    });
    parentPort.postMessage({ index, results });
  } catch (error) {
    parentPort.postMessage({
      index,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
