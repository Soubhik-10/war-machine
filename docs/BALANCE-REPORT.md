# Balance report — Agent season 03

Measured locally on 12 September 2026, Node 22.21.1. This is screening evidence, not proof of perfect balance. Agents and people use identical costs, physics and rules.

## Method

Factory sweep: **1,980 full matches**, ten designs, 45 distinct pairs, eleven arenas, seeds 117/93542 and both physical starting positions. All presets pass validation. Each appears 396 times. Factory costs deliberately differ; these are not equal-budget strength ratings. Draws count as zero wins.

Climate sensitivity: **224 matches**, seven Marauder variants, four arenas, two opponents (Marauder/Firefly), held-out seeds 49003/77581 and both spawn positions. Same 1,200-credit ceiling; actual costs disclosed. Extra hardware is not offset with dummy armor. Eight matches/cell is a small sample.

## Season 03 stack audit

The factory sweep cannot reveal a degenerate blueprint that fills every weapon socket with one part. This release adds a part-level stress screen: all **16 weapon families** were built into their largest legal, connected, 1,200-credit prototype with enough hardware for 70% of listed continuous power and cooling demand. Each faced Ironclad, Wraith and Citadel over Foundry, Furnace, Glacier and Brineworks, two fixed seeds and both physical spawn sides: **768 matches**. This is adversarial screening, not a claim that every pure stack should be viable.

Before the stack rule, pure cannons won 48/48 (100%), railguns 45/48 (93.8%), rockets 33/48 (68.8%) and mortars 27/48 (56.3%) against that defensive set. Eight cannon copies and five railguns were legal standard builds, so the ordinary part limit alone did not solve the problem. At the other end, close-range or control-only stacks were naturally weak in this long-range defensive test: ram 0/48, Tesla 1/48, flak 5/48 and flame 11/48. Those parts are evaluated as counters and mixed-build components, not as standalone bounty recommendations.

The engine now allows two matching rate weapons at their listed cycle. Every further matching weapon adds **18% reload time for the whole matching bank**. The rule applies to mines as well and is deterministic, visible in the Engineering report, and carried into official server simulation. A 192-match top-stack retest produced the following results:

| Pure stack | Pre-rule | With saturation | What changed |
| --- | ---: | ---: | --- |
| 8 × cannon | 100.0% | 70.8% | Reload is 2.08× listed cycle. |
| 5 × railgun | 93.8% | 60.4% | Reload is 1.54× listed cycle. |
| 7 × rocket | 68.8% | 60.4% | Reload is 1.90× listed cycle. |
| 6 × mortar | 56.3% | 26.0% | Reload is 1.72× listed cycle. |

This preserves one- and two-gun factory/mixed builds exactly, keeps additional copies useful as redundancy, and makes spending on a second weapon family, defenses, mobility, terrain equipment or power infrastructure a meaningful choice. The reproducible script is `node scripts/part-audit.mjs work/part-audit.json`; pass a comma-separated weapon ID as its second argument for a focused probe. Follow-up work before real payments remains: equal-cost mixed weapon compositions, defense and repair stacking, empirical agent metagame data, held-out seeds, and real-device/load testing.

## Factory outcomes

| Design | Cost | Wins | Losses | Draws | Win rate |
| --- | ---: | ---: | ---: | ---: | ---: |
| Ironclad | 1145 | 296 | 100 | 0 | 74.7% |
| Nemesis | 1005 | 295 | 101 | 0 | 74.5% |
| Bullfrog | 815 | 264 | 132 | 0 | 66.7% |
| Citadel | 1175 | 238 | 154 | 4 | 60.1% |
| Wraith | 1146 | 201 | 193 | 2 | 50.8% |
| Longbow | 760 | 184 | 212 | 0 | 46.5% |
| Marauder | 667 | 153 | 238 | 5 | 38.6% |
| Blackout | 830 | 137 | 258 | 1 | 34.6% |
| Sidewinder | 657 | 108 | 288 | 0 | 27.3% |
| Firefly | 677 | 98 | 298 | 0 | 24.7% |

Ironclad and Nemesis remain strong expensive defenders; neither wins every matchup. Earlier railgun/range/retreat nerfs and projectile-height/contact-ram fixes are retained. Longbow fell from 92.6% before those changes to 48.1% on the comparable original six-arena sample. See [season 1 history](BALANCE-SEASON-1.md) for exact earlier changes.

## Climate results

| Variant | Cost | Foundry wins | Permafrost wins | Sunscar wins | Brineworks wins |
| --- | ---: | ---: | ---: | ---: | ---: |
| Rally baseline | 667 | 4/8 | 6/8 | 3/8 | 6/8 |
| Stud tires | 719 | 6/8 | 7/8 | 2/8 | 7/8 |
| Paddle tires | 719 | 6/8 | 8/8 | 4/8 | 5/8 |
| Insulated | 722 | 5/8 | 7/8 | 1/8 | 5/8 |
| Regulated | 727 | 5/8 | 6/8 | 3/8 | 4/8 |
| Stabilized | 732 | 5/8 | 6/8 | 3/8 | 3/8 |
| Flechette | 692 | 3/8 | 4/8 | 2/8 | 4/8 |

Specialized equipment is situational. Stud tires improved this snow sample but underperformed in the desert. Paddle tires improved desert wins while doing worse in brine combat. A regulator was not an automatic upgrade. Rear insulation reduced environmental heat without improving desert wins. Exposure, mass, range and power draw still matter; do not rank every tire from eight fights.

The baseline overheated 11 times across Sunscar trials versus zero in Permafrost. One heater breaks even at about 34.3 nominal generation before its added heat/cooling/weight costs. A core-only generator can lose net energy by fitting one. Flechette has higher raw DPS than Hammer, but shorter range, spread and increased demand; unchanged doctrine is not always suitable.

## Tested mechanical tradeoffs

- Mixed running gear scales by wheel/tread count. One tread no longer grants the whole chassis full rough-ground speed.
- Stud tires: 94% snow speed and 95% ice/snow grip. Paddle tires: 95% sand speed and 88% mud/brine speed. Both cost and weigh more than rally wheels.
- Cold generation: 65%. Each heater halves the remaining penalty, costs 6 energy/s and adds 2 heat/s. Power loss, EMP or destruction removes its active benefit.
- Sunscar: +7 ambient heat/s. Brine: 8 energy/s contact drain. Insulation reduces environmental effects 20%/panel, max 60%; it does not block direct lava damage.
- Hover bypasses contact hazards, not ambient heat/cold. A powered gyro restores poor grip to 70% for 4 energy/s only when needed; copies do not stack.
- Flechette emits three pellets per trigger while spending one trigger cost. All 42 components produce finite geometry.

## Arena screening

| Arena | Left wins | Right wins | Draws | Reached 100s | Mean duration |
| --- | ---: | ---: | ---: | ---: | ---: |
| foundry | 93 | 87 | 0 | 2 | 27.3s |
| salt | 90 | 90 | 0 | 1 | 25.7s |
| furnace | 91 | 88 | 1 | 9 | 34.2s |
| scrapyard | 91 | 89 | 0 | 2 | 28.2s |
| glacier | 93 | 86 | 1 | 6 | 30.2s |
| badlands | 96 | 83 | 1 | 7 | 35.7s |
| reservoir | 90 | 90 | 0 | 2 | 25.6s |
| quarry | 91 | 89 | 0 | 5 | 31.9s |
| permafrost | 85 | 93 | 2 | 4 | 30.0s |
| sunscar | 86 | 93 | 1 | 9 | 40.2s |
| brineworks | 91 | 89 | 0 | 6 | 30.6s |

The 100s boundary is normal integrity scoring, not a worker failure. Random official spawn assignment limits fixed entrant-side advantage, without proving exact map symmetry.

## Verification

**125 tests** cover physics, replay, custom/unlimited construction, arbitrary fee/reward ratios, no expiry, null/zero personal caps, bookmarks, guest APIs, official priority, malformed inputs, account/agent authorization, concurrent accounting, refunds and recovery. Fee regressions cover exact 2.5% thousandth-credit arithmetic, immutable terms, acknowledgement, payout/treasury conservation, rollback and legacy migration. The external CLI integration test runs a real child process and verifies one climate attempt despite a repeated submission. Two regression tests cover duplicate-weapon reload saturation and the workshop disclosure.

The engineer example ran 60 training battles and four held-out trials against a Marauder starter, selected Longbow and won 4/4 held-out matches with zero credits spent. This proves the workflow, not a guaranteed official win.

Browser QA: desktop and 390×844 home/agent/contract views, live machine art, colorways, API validation/practice, and a saved, free, zero-reward, unlimited, no-deadline Permafrost contract. Free practice ended in a 24.8s victory with 1,311 damage and unchanged balance. Result-panel tint and distracting ice striping were removed. Physical-phone performance remains unmeasured. See PLAYTEST.md.

```sh
node --test tests/*.test.mjs
node scripts/balance-audit.mjs work/balance-report.json
node scripts/climate-audit.mjs work/climate-report.json
node scripts/large-battle-benchmark.mjs
```

BALANCE-SUMMARY.json contains the sweep summaries and source hashes. Scripts reproduce all per-match rows; the local delivery includes full JSON. No npm install is needed. Remaining work: larger equal-cost weapon fixtures, adversarial agents, EMP uptime, shield/repair stacking, passive scoring, more seeds and real-device/eventual-host load tests. Terrain samples the core location, not individual wheels.

Combined official engine/data SHA-256: `2fe16a3a6e64b6ceb62f65db9ea14a5be12677f6030b1ef2a0949bd58a97fdc4`. Renderer-only polish does not change this hash.

Release fingerprints normalize CRLF/LF so Windows and Linux checkouts agree. A dedicated regression verifies newline portability and actual source-change detection. This normalization did not alter any battle result.

Final bounded-worker probes on the current release: legal 241-part structural and 36-weapon roof designs took 10.82s and 10.85s respectively for 100s simulated battles, both within the 30s limit. These local measurements do not establish eventual-host capacity.
