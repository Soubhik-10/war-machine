Historical report for the earlier bounty release. Current results are in BALANCE-REPORT.md.

# Balance and verification report — local sandbox bounty release

Measured locally on 12 September 2026 with Node 22.21.1. These are factory-design screening results, not certification of an equal-budget or real-money competition.

## Method

Baseline: 1,080 full matches, 10 factory designs, all 45 distinct pairs, six arenas, two fixed seeds (117 and 93542), each pairing starting on both physical sides. Final: the same method across eight arenas, 1,440 matches, 288 appearances per design. The comparable-six column uses only the original six arenas (216 appearances per design). Draws count as zero wins. Machines deliberately spend different budgets and have different difficulty roles. A cheaper rookie is not expected to beat every 1,175-credit defender.

Two intermediate 1,440-match runs and a 144-match focused counter probe informed the final changes. The final report includes every result, terrain, seed, side, duration, integrity, damage, shots, hits and overheating count. Tests and renderer work ran alongside some measurements; timings are approximate wall times on this PC, not a cloud capacity guarantee.

## Factory outcomes

| Factory design | Cost before → after | Baseline six arenas | Final comparable six | Final all eight |
| --- | ---: | ---: | ---: | ---: |
| Nemesis | 985 → 1005 | 87.5% | 73.1% | 74.7% |
| Ironclad | 1145 → 1145 | 69.4% | 73.1% | 74.0% |
| Bullfrog | 815 → 815 | 75.9% | 66.7% | 67.0% |
| Citadel | 1060 → 1175 | 26.9% | 61.1% | 62.5% |
| Wraith | 1028 → 1146 | 22.7% | 52.3% | 50.7% |
| Longbow | 720 → 760 | 92.6% | 48.1% | 45.8% |
| Marauder | 667 → 667 | 53.7% | 39.8% | 39.9% |
| Blackout | 830 → 830 | 34.3% | 32.4% | 34.7% |
| Sidewinder | 657 → 657 | 24.5% | 26.4% | 26.0% |
| Firefly | 677 → 677 | 11.1% | 25.5% | 23.6% |

The old Longbow won 92.6% of its factory matchups; it no longer dominates the set. Nemesis remains a strong mixed long-range build, but now has reliable factory counters. Wraith's reinforced missile mounts, shield and weapon-targeting doctrine can defeat Nemesis while remaining vulnerable to pressure and EMP. Citadel trades more construction credits and mass for reinforced tower supports and paired cannons. Neither gets a hidden combat bonus; players can build the same parts and pay the same prices.

## Changes supported by the tests

- Railgun: 135 → 155 credits; 100 → 82 damage; 2.7 → 3.0-second reload; 650 → 550 range. Its long-range precision and penetration remain useful but carry real cost and heat tradeoffs.
- Rocket: 44 → 48 damage and 260 → 330 projectile speed. Guidance follows the selected module's height instead of dropping elevated shots into flat ground prematurely. Turning is bounded; smoke and interception remain counters.
- Flame: 8 → 9 damage, 145 → 190 range and 3 → 2.8 heat per shot. Its close-range pressure is more useful, but closing safely still matters.
- Mortar: 3.2 → 2.8-second reload, 220 → 260 projectile speed, better target leading. Reinforced Citadel supports and cannons make its expensive tower viable.
- Reverse motion loses 32% of speed, reducing endless full-speed retreat. A ram must face and physically touch its target; rear wedges no longer deal remote collision damage, and an impact uses an actual contacting wedge.
- Wraith: one booster becomes a shield, its central frame becomes armor, missile mounts are reinforced, and it kites at 400 range while targeting weapons. Cost 1,028 → 1,146.
- Citadel: paired cannon coverage and reinforced support decks. Cost 1,060 → 1,175.
- Gameplay and cosmetic random streams are separate. Inspecting or rendering extra debris cannot change the official result.

## Terrain and starting sides

Existing terrain patches now intersect useful routes. Coolant Basin trades wheel speed for 70% more cooling. Shatter Quarry slows wheels 35% on rubble while treads retain 93% speed. Ridges physically stop low shots crossing elevated ground, while high mounts and mortar arcs can clear them. Steering samples danger ahead and avoids active damage zones when possible. Effects sample the core position consistently; wheels do not independently sample separate terrain tiles.

Official trials choose a physical starting side from one bit of the server-generated random seed. Challenger identity remains side 0 for results and payment accounting. This reduces systematic entrant-slot advantage; it does not prove perfect numerical symmetry.

Final screening, 180 matches per arena:

| Arena | Left wins | Right wins | Draws | Reached 100s scoring | Mean battle time |
| --- | ---: | ---: | ---: | ---: | ---: |
| foundry | 93 | 87 | 0 | 2 | 27.3s |
| salt | 90 | 90 | 0 | 1 | 25.7s |
| furnace | 91 | 88 | 1 | 9 | 34.2s |
| scrapyard | 91 | 89 | 0 | 2 | 28.2s |
| glacier | 93 | 86 | 1 | 6 | 30.2s |
| badlands | 96 | 83 | 1 | 7 | 35.7s |
| reservoir | 90 | 90 | 0 | 2 | 25.6s |
| quarry | 92 | 88 | 0 | 5 | 31.9s |

“Reached 100s scoring” is the game's normal integrity tiebreak, not a worker failure or an automatic refund.

## Verification

**91 automated tests passed**, with zero failures, in approximately 19.9 seconds locally. They cover mechanics, all 36 parts, stacking/support, caps/unlimited, old link import, deterministic playback, terrain effects and line-of-fire obstruction, orientation/ram contact, missile height, swap-spawn identity, HTTP races, idempotency, credit conservation paths, payouts/refunds, lease fencing, SQLite restart, expiry, cap enforcement, credential revocation and hostile requests. A real worker result is compared with a fresh run of the same engine.

Browser playtests used two independent local sandbox identities. Creation and sharing preserved custom construction caps (800 credits / 20 parts / 360 t / 8 weapons), terrain and defender. Free practice spent nothing. A legacy zero-fee win paid +90 net once and closed its contract. On the final release, Marauder beat the Firefly coolant contract in 12.5 seconds; the browser replay matched the stored result. A newer workshop draft survived watching and exiting that older replay.

At a 390×844 browser viewport, created an unlimited quarry contract, verified the immutable 243-socket rules, closed it, and recovered the complete 100-credit reserve. Contract pages and focused battle controls had no horizontal page overflow. Returning from replay left the balance unchanged. Normal viewport sizing was restored. Browser error/warning log was empty. This was responsive viewport testing, not a physical phone performance benchmark.

Large-build worker probes used two legal 241-part designs, each against itself on Salt Flats, seed 8675309, with 192 MiB old-generation heap and the same 30-second wall limit as official trials:

| Fixture | Parts per machine | Weapons per machine | Local worker wall time | Result |
| --- | ---: | ---: | ---: | --- |
| Dense structural tower | 241 | 1 | 10.28s | 100.0s simulated; winner 0 |
| Heavy roof battery | 241 | 36 | 10.46s | 100.0s simulated; draw |

These probes finished within the worker limit. They do not exhaust every legal build or establish performance on a free hosting tier. A worker timeout is handled as a technical refund, never a loss.

## Reproduce and extend

Run `node --test tests/*.test.mjs` for regression checks. Run `node scripts/balance-audit.mjs` for the full factory screening (writes `work/balance-report.json`), or pass an output path. Run `node scripts/large-battle-benchmark.mjs` for the bounded large-build probes. No package installation is required.

Before enabling paid competition: add equal-budget and held-out-seed fixtures for all weapon families, adversarial builds, shield/repair stacking, EMP uptime, passive integrity strategies, mirrored geometry, additional seeds, real-device measurements and eventual-host worker load tests. Retain versioned engines for historical exact replays. The current release archives/refunds incompatible live work and preserves old receipts.

Final source hashes:

- Engine SHA-256: `ca04861c01b595cd7d5593571a2b1b16b556a99cb5a4fbe340a60dd1176ac568`
- Data SHA-256: `0dc081fa54fe21242eb208e21dba0cc0202d769a4604087ed0db705298f664f1`
- Combined official engine/data hash: `9c3d3e3782b1a7eb09711b0e10045a7bd86f9b868926d7bebfa1fc5f7e9ac164`
