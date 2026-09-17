# Battle rendering changes

The arena skin now stays in a separate static GPU buffer. Only moving/destructible geometry is uploaded each frame. The renderer reuses its dynamic typed upload buffer and GPU allocation, caches attribute/uniform locations, releases both buffers on disposal, and avoids preserving the main drawing buffer. Thumbnail rendering explicitly retains its buffer.

The main canvas caps device pixel ratio at 1.5, reducing fragment work on high-density screens. Fixed 60 Hz simulation steps remain unchanged. Presentation limits simulation catch-up work to a 6 ms budget per frame and suspends background-tab rendering; no deterministic simulation steps are discarded.

Rendering now selects one of two presentation profiles from WebGL renderer information when available, with hardware concurrency, device memory, mobile hints and Save-Data as fallbacks. Weak or software-rendered devices use the tuned balanced profile: medium-detail module silhouettes, reduced effects, 1.1 DPR and 50 Hz presentation. Moderate-to-high-capability devices use the absolute-high profile with full module meshes, full effects, 60 Hz presentation and the existing 1.5 DPR cap. The simulation, battle result, rules and settlement payload are identical across tiers.

The browser exposes the selected profile for diagnostics at `window.warMachinesGraphics.profile`. A developer can force a tier for testing with `window.warMachinesGraphics.setTier('high'|'balanced')`; old `low` overrides are treated as balanced. `setTier(null)` clears the override. On supported browsers, a device that is discharging below 20% battery temporarily steps the absolute-high profile down to balanced. Charging or unsupported battery APIs do not change the selected tier.

Measured with `node scripts/game-benchmark.mjs` on this workspace, using 8 game-loop samples and 32 scene samples per case, the actual reusable scene and typed upload path, and the same three factory cases used by the normal game loop:

| Case | High scene ms | Balanced scene ms | High upload | Balanced upload |
| --- | ---: | ---: | ---: | ---: |
| Foundry | 12.55 median | 11.46 median | 2,330,160 B | 556,752 B |
| Permafrost | 17.46 median | 14.91 median | 3,248,784 B | 725,424 B |
| Quarry | 13.20 median | 12.37 median | 2,559,984 B | 641,424 B |

These are Node CPU/geometry measurements, not browser FPS or GPU measurements. Browser GPU execution and composition still depend on the player’s device and browser. The full battle results remained identical in the high and balanced benchmark paths.

Measured with `node scripts/render-benchmark.mjs` on this workspace, using Siege Tower versus Smoke Runner in the Foundry, 12 warmups and 100 samples:

| Metric | Previous | Updated |
| --- | ---: | ---: |
| Median scene generation plus array conversion | 24.27 ms | 17.20 ms |
| 95th percentile | 45.16 ms | 34.15 ms |
| Geometry uploaded each frame | 5,880,336 bytes | 3,211,152 bytes |

This is approximately 29% less median CPU time and 45% less per-frame geometry upload. An additional 2,669,184 bytes are uploaded once for the static arena. This CPU benchmark excludes GPU execution and browser composition; it is not a measured browser frame rate or a claim of 60 FPS on every device. Phone hardware has not been benchmarked. The test suite checks static-buffer reuse, disposal and simulation independence.
