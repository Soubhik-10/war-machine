# Audio event lifecycle

`Battle(..., { observeEvents: true })` retains the latest 256 presentation records. Each record has a monotonic `seq`, simulation time `t`, `kind`, `side`, `moduleUid`, `weapon`, and world position; firing has exactly one `fire` record per volley, even when the renderer also creates muzzle and beam effects.

The arena frame calls `combatEventsSince(lastSeq)`, then `AudioDirector.ingest()` and `drain()`. This runs independently of HUD timing and effect lifetime. Records advance the cursor while muted, blocked, hidden, paused/restarted, or after a battle switch, so a later resume never plays stale combat. Replay seek and battle replacement call `reset()`, which stops active voices and resets the sequence cursor for the new battle. Route cleanup calls `clear({ stop: true })`. No audio-owned animation frame or timer is created.

The queue holds at most 160 records and each drain considers at most 48. Overflow and discarded stale records are counted in `stats.dropped` and `stats.stale`; repeated sequences are `stats.duplicate`. At 2×/4×, only same-side gatling or machinegun shots in an 83 ms simulated bucket are aggregated, with each additional shot counted in `stats.coalesced`. All other events are consumed once. Background, mute, and suspended contexts discard queued records instead of replaying a backlog.

## Mix and voice budget

Every combat voice uses envelope gain -> shared master gain -> conservative compressor (`-14 dB` threshold, 8:1 ratio) -> destination. The master begins at the stored 70% default once a user enables audio. A maximum of 24 concurrent voices and 160 queued events prevents a slow frame from allocating unbounded nodes. Nodes disconnect on `ended`; mute and cleanup stop active voices immediately. The compressor provides headroom but does not guarantee a clip-free device output.

| Family | Attack / body / tail |
| --- | --- |
| Cannon | square transient, low noise body, short decay |
| Machinegun / gatling | dry square ticks plus filtered noise; accelerated burst aggregation |
| Railgun | rising electrical saw charge and bright noise discharge |
| Laser | stable rising sine energy onset/release |
| Plasma | rounded low sine launch with soft noise body |
| Rocket / mortar | low exhaust noise; rocket is brighter than mortar |
| Tesla / EMP | high crackle plus descending electrical pulse |
| Flame / cryo | filtered combustion noise / bright airy noise with icy tone |
| Mine / flak / shredder | low deployment tone / fragmented bright impacts |

Preferences are stored only in `wm-audio-v1` as `{ enabled, volume }`. A saved enabled preference displays `BLOCKED` until the player activates the SFX button in a browser user gesture; the button then reports `ON` only when the context is actually running. The current header does not expose a volume control, but the validated `volume` field and master gain are ready for one.

## Reproduction for Agent 09

Run `node --test tests/audio-events.test.mjs tests/simulation-behavior.test.mjs`. For event accounting, run an observed `Battle` at 4× and feed every step's `combatEventsSince(director.lastSeq)` into `AudioDirector`; the current `PRESETS[0]` vs `PRESETS[1]` foundry fixture emits 104 records and reports 104 consumed, zero coalesced/dropped/stale. For an audible dense test, serve `dist`, enable SFX with the button, then run a 4× foundry match using two gatling-heavy machines and check that returning from a background tab produces no backlog.

No human listening session was available for this change. Synthesis distinction, loudness, stereo balance, harshness, and device clipping remain perceptually unverified.
