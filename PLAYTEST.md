# Agent season 02 — 12 September 2026

Current verification supersedes historical notes below. Details: docs/BALANCE-REPORT.md.

- 123 automated tests; portable LF/CRLF release fingerprints; 1,980 factory matches; 224 climate sensitivity matches.
- External engineer dry run: ten candidates, 60 training matches, 4/4 held-out wins with Longbow and no credits spent. Archived-engine mismatch refused correctly.
- Real CLI validation, bookmark, official climate entry and idempotent retry tested in a separate temporary account/database.
- Desktop and 390×844 landing/agent/contract views, live Wraith art, colorways and guest API lab checked. Browser error log empty.
- Created an unlisted zero-entry/zero-reward unlimited Permafrost contract with no deadline. Saved it, filtered Saved by arena/title/zero fee and reopened it.
- Autonomous free practice at 4×: victory at 24.8s, 1,311 damage; unchanged balance. Result card readable on mobile with a neutral scrim.
- Ice shader changed to irregular subdued veins; snow is matte. Cosmetic rendering remains independent of physics.
- Temporary free contract was unsaved and closed; the account balance remained unchanged.
- Final 241-part worker probes finished in 10.82s and 10.85s.
- Tempo auth, MPP, mainnet and hosting are TODOs/unconfigured. Source push does not deploy a site.

---

# Demo bounty release — 12 September 2026

The current build adds a local authoritative Node/SQLite bounty server, demo credits and external-agent API. MPP, Tempo, wallets, mainnet and paid hosting remain disabled/TODO. No npm dependencies or hosted AI calls were added.

- 91 automated tests passed, including actual HTTP worker settlement, concurrent entrants, idempotency, refunds, expiry/restart recovery, caps and new terrain mechanics.
- 1,080 baseline and 1,440 final factory matches measured the balance changes. See [docs/BALANCE-REPORT.md](docs/BALANCE-REPORT.md) for comparable arena samples, costs, limitations and reproducible scripts.
- Two browser identities created/shared a custom capped coolant contract. Practice left the balance unchanged. Official victory settled the reward once and closed the bounty.
- Pre-fee legacy official trial: Marauder versus Firefly in Coolant Basin, seed 4145459044, victory at 12.5 seconds, 1,144 damage, 93.7% versus 33.9% integrity, +90 net credits. Browser exact replay matched the time/damage/result and could not spend or award credits. New 2.5%-fee contracts quote the winner payout before entry instead.
- Tested 390×844 viewport: unlimited quarry creation preserved all uncapped fields, cancellation returned all 100 reserved credits, and focused battle navigation stayed usable without horizontal page overflow. The normal viewport was restored.
- A new draft named “Draft survives replay” remained intact after replaying an earlier Marauder trial and choosing Refit. The original draft name was restored after testing.
- Added an in-arena Contract return button and clear verified-replay actions. No errors/warnings appeared in the final browser console check.
- Final transition checks: Heavy caps carry into Custom contract creation; switching to Unlimited and back restores all four custom values. Eight archived contracts remained browsable after balance changes. Release stamps prevent old tabs from claiming to use new physics.
- Both 241-part worker probes completed a full 100-second simulated match within the 30-second limit (about 10.3 and 10.5 wall seconds locally). Actual phone hardware and eventual hosting capacity are unmeasured.

The sections below are historical notes from earlier releases; their old test counts, controls and static-only statements do not describe the current bounty server.

---

# Engineering edition — September 2026

Direct combat controls were removed in this revision. Workshop doctrine and hardware determine how both machines fight. Camera, pause, inspection, and replay remain available.

- The first autonomous browser trial used Aegis Counter against Marauder, seed 42817. It won at **17.9 seconds**, dealt **1,935 damage**, and retained its 300-HP core.
- At a **390×844 viewport**, created a self-challenge, reloaded it, and verified the locked automatic rules and alloy finish. The mirror match lost at **19.0 seconds / 816 damage**. Exact replay reproduced the same result and the rival's remaining **54 core HP**. Camera, playback, and diagnostics stayed reachable. No browser warnings or errors were reported.
- Added weathered paint and brushed alloy finish selection, local procedural surface textures, smoother turret motion, distance-driven track animation, mount recoil, moving dust, damaged-system smoke, spark streaks, and recognizable part wreckage.
- Old live-command challenges migrate to automatic matches while preserving their machines and economic rules. Finish choices persist in local saves and challenge exports.
- **59 automated tests pass**, including render-state isolation, local texture coordinates, animation geometry, all terrain environments, replay determinism, arsenal behavior, and legacy challenge conversion.
- No npm dependencies or external texture fetches were introduced. The upload directory is entirely static.

The notes below describe earlier versions, including the manual controls that have now been removed.

---

# Historical playtest and improvements

Played in the local browser on 12 September 2026, using an isolated port so the user's original draft and saves were preserved.

## Matches played

- **First live match:** stock Marauder against Marauder. Used Boost, Flank, Attack, mobility targeting, and Brace. Lost by core destruction at **33.0 seconds** after dealing **1,225 damage**.
- **Friend challenge:** captured the stock machine's challenge link and imported it against a refitted counter within the same 1,200-credit limit. The counter cost **1,172 credits**, used an elevated railgun, a laser, bulkheads, shields, stronger generation, and cooling. Targeted the core and won at **11.0 seconds**, with the counter's core intact.
- **Self-challenge:** tested the new Challenge myself and Scout rival flow with the counter machine. Lost the mirror battle at **20.4 seconds**. The new report recorded **94 shots / 79 impacts**, with weapon contributions of **441 autocannon damage, 369 railgun damage, and 10 laser damage**. These exclude absorbed shield damage.
- **Small screen:** checked at a **390×844 browser viewport**, used Brace, Hold, pause/resume, and hold/resume fire. Combat and controls remained reachable in Focus battle. A final counter-versus-stock match won at **15.6 seconds / 1,635 damage**, with the counter's core intact. Exact replay reproduced the same time, damage, and two recorded commands. This was viewport testing, not a physical phone benchmark.

## Changes prompted by play

1. **Focus battle:** deploying can bring the arena, camera, abilities, orders, and playback controls together in the current viewport. This fixes controls falling below the visible battle. Hold fire remains available on small screens.
2. **Rival scouting:** inspect an orbitable 3D rival, its fitted components, doctrine, budget, levels, and engineering weaknesses before building a counter.
3. **Engineering report:** explains missing essentials, likely continuous-fire heat/power shortages, backward weapons, exposed cores, and vulnerable tower connections. Warning buttons open the relevant component category.
4. **Weapon feedback:** shows individual/grouped cooldowns, range and arc restrictions, low power, heat locks, and destroyed guns. Floating damage numbers show hits, with spacing to reduce overlap.
5. **Battle report:** compares surviving integrity and lists shots, surviving weapons, actual attributed weapon damage, and refit advice based on the match. Removed an unrelated missile-defense recommendation when the rival had no missiles.
6. **Safer assembly:** fitted parts are selected by default instead of silently replaced. Replacement is explicit, and 3D picking respects the visible part body and build levels. A browser click on a fitted wheel correctly opened its inspector without replacing it.
7. **Persistence and sharing:** machine names now save while typing. Added Challenge myself and made imported challenges persist in the URL for reloads. Existing challenge budgets, front directions, colors, and upgrades remain supported.
8. **Local launcher:** the Windows launcher opens the game in the default browser and reuses an already-running game server. No npm packages or backend services were added.

## Verification

53 automated tests cover combat, replay determinism, challenge codecs and limits, the expanded arsenal, telemetry, 3D picking, and engineering advice. The original 60 factory-rival/arena combinations are included. Runtime files and upload/source archives were checked against the current source. Browser console checks during the updated desktop/mobile flows reported no warnings or errors.

The game still uses simplified vehicle collision radii and cosmetic debris physics. Very large Unlimited builds cost more rendering work; no physical-phone performance guarantee is implied.
