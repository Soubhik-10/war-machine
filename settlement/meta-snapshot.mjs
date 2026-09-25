import { PARTS } from "../dist/data.mjs";

const WEAPON_IDS = new Set(PARTS.filter((part) => part.cat === "Weapons").map((part) => part.id));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const rounded = (value, places = 2) => Number(finite(value).toFixed(places));

function compactBuild(packed, unpackChallenge) {
  const challenge = unpackChallenge(packed),
    machine = challenge.machine,
    parts = {};
  const modules = (machine.modules || []).map((module, slot) => {
    const id = String(module.id || "unknown");
    parts[id] = (parts[id] || 0) + 1;
    return {
      slot,
      id,
      x: finite(module.x),
      y: finite(module.y),
      z: finite(module.z),
      rotation: finite(module.r),
      upgrade: typeof module.u === "string" ? module.u : "stock",
    };
  });
  const armorParts = modules.reduce((total, module) => {
    const category = PARTS.find((part) => part.id === module.id)?.cat;
    return total + (category === "Defense" || module.id === "armor" ? 1 : 0);
  }, 0);
  return {
    modules,
    parts,
    armorParts,
    weaponCount: modules.reduce((total, module) => total + (WEAPON_IDS.has(module.id) ? 1 : 0), 0),
    front: finite(machine.front),
    tactic: String(machine.tactic || "auto").slice(0, 24),
    target: String(machine.target || "reactor").slice(0, 24),
    range: String(machine.range || "default").slice(0, 24),
    stance: String(machine.stance || "balanced").slice(0, 24),
  };
}

function compactEvents(events, limit = 6000) {
  const source = Array.isArray(events) ? events : [],
    kept = source.length > limit
      ? [...source.slice(0, Math.floor(limit / 2)), ...source.slice(-Math.ceil(limit / 2))]
      : source;
  const values = kept.map((event) => {
    const value = {};
    for (const key of [
      "seq", "t", "kind", "side", "sourceSide", "weapon", "phase", "moduleUid",
      "sourceModuleUid", "targetUid", "targetSide", "winner", "pellets", "heat",
      "heatBefore", "x", "y", "h",
    ]) {
      const item = event?.[key];
      if (typeof item === "string") value[key] = item.slice(0, 32);
      else if (typeof item === "boolean" || Number.isFinite(item)) value[key] = item;
    }
    if (event?.target && typeof event.target === "object") {
      value.target = {
        x: rounded(event.target.x),
        y: rounded(event.target.y),
        h: rounded(event.target.h),
      };
    }
    if (event?.states && Array.isArray(event.states))
      value.states = event.states.slice(0, 2).map((state) => ({
        coreLost: !!state?.coreLost,
        dead: !!state?.dead,
        integrity: rounded(state?.integrity),
      }));
    return value;
  });
  return { events: values, eventCount: source.length, truncated: source.length > limit };
}

function compactSide(vehicle) {
  const weapons = {};
  for (const module of vehicle?.modules || []) {
    if (!WEAPON_IDS.has(module.id)) continue;
    const current = weapons[module.id] || {
      count: 0, shots: 0, hits: 0, damage: 0, heatWait: 0, powerWait: 0, destroyed: 0,
    };
    current.count++;
    current.shots += finite(module.fired);
    current.hits += finite(module.landed);
    current.damage += finite(module.dealt);
    current.heatWait += finite(module.heatWait);
    current.powerWait += finite(module.powerWait);
    current.destroyed += finite(module.hp) <= 0 ? 1 : 0;
    weapons[module.id] = current;
  }
  return {
    shots: finite(vehicle?.shots),
    hits: finite(vehicle?.hits),
    damage: rounded(vehicle?.damage),
    peakHeat: rounded(vehicle?.peakHeat),
    overheatCount: finite(vehicle?.overheatCount),
    cooldownCount: finite(vehicle?.cooldownCount),
    cooldownTime: rounded(vehicle?.cooldownTime),
    thermalStressTime: rounded(vehicle?.thermalStressTime),
    powerLimitedTime: rounded(vehicle?.powerLimitedTime),
    brownoutCount: finite(vehicle?.brownoutCount),
    mobilityLossTime: rounded(vehicle?.mobilityLossTime),
    detached: finite(vehicle?.detached),
    destroyed: finite(vehicle?.destroyed),
    intercepts: finite(vehicle?.intercepts),
    pickups: finite(vehicle?.pickups),
    batterySurges: finite(vehicle?.batterySurges),
    energyRemaining: rounded(vehicle?.energy),
    shieldRemaining: rounded(vehicle?.shield),
    coreLost: !!vehicle?.coreLost,
    failures: Object.fromEntries(Object.entries(vehicle?.failureCounts || {}).map(([key, value]) => [key, rounded(value)])),
    weapons: Object.fromEntries(Object.entries(weapons).map(([key, value]) => [key, Object.fromEntries(
      Object.entries(value).map(([name, count]) => [name, rounded(count)]),
    )])),
  };
}

/** A name/address-free replay and telemetry snapshot. It never changes the settlement result. */
export function captureBattleMeta({ record, battle, result, unpackChallenge, kind }) {
  if (!record || record.reason && record.reason !== "battle") return null;
  const challengeA = unpackChallenge(record.challenger),
    challengeB = unpackChallenge(record.defender),
    ruleSet = challengeA.rules || challengeA.q || challengeB.rules || challengeB.q || {};
  const events = compactEvents(battle?.combatEvents);
  return {
    formatVersion: 1,
    kind,
    engineHash: String(record.engineHash || "unknown"),
    arena: String(challengeB.arena || challengeB.a || record.arena || "unknown"),
    rules: ruleSet,
    seed: finite(record.seed),
    mode: String(record.mode || result?.mode || "auto").slice(0, 24),
    swapSpawns: !!record.swapSpawns,
    objective: String(record.objective || challengeB.objective || challengeA.objective || "reactor").slice(0, 24),
    builds: [compactBuild(record.challenger, unpackChallenge), compactBuild(record.defender, unpackChallenge)],
    result: {
      winner: finite(result?.winner, -1),
      outcome: result?.winner === 0 ? "side-0" : result?.winner === 1 ? "side-1" : "draw",
      reason: String(result?.reason || "unknown").slice(0, 80),
      time: rounded(result?.time),
      score: Array.isArray(result?.score) ? result.score.map((value) => rounded(value, 4)) : [],
      integrity: Array.isArray(result?.integrity) ? result.integrity.map((value) => rounded(value, 4)) : [],
      breakdown: Array.isArray(result?.breakdown) ? result.breakdown.map((side) => Object.fromEntries(
        Object.entries(side || {}).filter(([key]) => ["core", "structure", "weapons", "mobility", "systems", "active", "total"].includes(key)).map(([key, value]) => [key, rounded(value, 4)]),
      )) : [],
      damage: Array.isArray(result?.damage) ? result.damage.map((value) => rounded(value)) : [],
      commands: finite(result?.commands),
    },
    sides: (battle?.vehicles || []).slice(0, 2).map(compactSide),
    combatLog: events.events,
    combatEventCount: events.eventCount,
    combatLogTruncated: events.truncated,
  };
}
