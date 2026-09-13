# Battle rendering changes

The arena skin now stays in a separate static GPU buffer. Only moving/destructible geometry is uploaded each frame. The renderer reuses its dynamic typed upload buffer and GPU allocation, caches attribute/uniform locations, releases both buffers on disposal, and avoids preserving the main drawing buffer. Thumbnail rendering explicitly retains its buffer.

The main canvas caps device pixel ratio at 1.5, reducing fragment work on high-density screens. Fixed 60 Hz simulation steps remain unchanged. Presentation limits simulation catch-up work to a 6 ms budget per frame and suspends background-tab rendering; no deterministic simulation steps are discarded.

Measured with `node scripts/render-benchmark.mjs` on this workspace, using Siege Tower versus Smoke Runner in the Foundry, 12 warmups and 100 samples:

| Metric | Previous | Updated |
| --- | ---: | ---: |
| Median scene generation plus array conversion | 24.27 ms | 17.20 ms |
| 95th percentile | 45.16 ms | 34.15 ms |
| Geometry uploaded each frame | 5,880,336 bytes | 3,211,152 bytes |

This is approximately 29% less median CPU time and 45% less per-frame geometry upload. An additional 2,669,184 bytes are uploaded once for the static arena. This CPU benchmark excludes GPU execution and browser composition; it is not a measured browser frame rate or a claim of 60 FPS on every device. Phone hardware has not been benchmarked. The test suite checks static-buffer reuse, disposal and simulation independence.
