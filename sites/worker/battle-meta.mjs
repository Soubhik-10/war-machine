import { Battle } from "../../dist/engine.mjs";
import { stats } from "../../dist/data.mjs";
import { CLIENT_ENGINE_HASH } from "../../dist/release.mjs";
import { captureBattleMeta } from "../../settlement/meta-snapshot.mjs";

export const BATTLE_META_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const BATTLE_META_RETENTION_DAYS = 7;
const MAX_REPORT_LOGS = 5000;
const ALLOWED_CLIENT_KINDS = new Set(["browser-practice", "browser-friendly", "browser-challenge"]);
const round = (n, digits = 2) => Number((Number.isFinite(Number(n)) ? Number(n) : 0).toFixed(digits));
const parse = (value, fallback = null) => {
  try { return JSON.parse(value); } catch { return fallback; }
};
const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};

export function metaReportIntervalHours(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 168 ? parsed : 24;
}

export function makeBrowserBattleMeta(body, { canonicalBlueprint, unpackChallenge, engineHash = CLIENT_ENGINE_HASH }) {
  if (!body || typeof body !== "object" || !ALLOWED_CLIENT_KINDS.has(body.kind))
    throw Error("Choose a supported free-play battle type.");
  if (body.engineHash !== engineHash)
    throw Error("This battle used a different engine release and cannot be verified by this server.");
  if (typeof body.clientBattleId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.clientBattleId))
    throw Error("A valid battle ID is required.");
  if (!Number.isSafeInteger(body.seed) || body.seed < 0 || body.seed > 4294967295)
    throw Error("The battle seed is invalid.");
  if (typeof body.swapSpawns !== "boolean") throw Error("The spawn setting is invalid.");
  const challenger = canonicalBlueprint(body.challenger),
    defender = canonicalBlueprint(body.defender),
    a = unpackChallenge(challenger, true),
    b = unpackChallenge(defender, true);
  for (const machine of [a.machine, b.machine]) {
    const summary = stats(machine);
    if (machine.modules.length > 128 || summary.weapons > 24)
      throw Error("Battle meta capture supports up to 128 parts and 24 weapons per machine.");
  }
  const aRules = a.rules || a.q, bRules = b.rules || b.q;
  if (a.arena !== b.arena || stable(aRules) !== stable(bRules))
    throw Error("Both machines must use the same arena and rules.");
  if (body.mode !== aRules.combat) throw Error("The battle mode does not match its locked rules.");
  const commands = body.commands === undefined ? [] : body.commands;
  if (!Array.isArray(commands) || commands.length > 512 || JSON.stringify(commands).length > 24000)
    throw Error("The battle command log is too large.");
  const objective = body.objective === "escort" ? "escort" : "reactor",
    battle = new Battle(a.machine, b.machine, b.arena, body.seed, {
      mode: body.mode,
      swapSpawns: body.swapSpawns,
      objective,
      commands,
      headless: true,
      observeEvents: true,
    }),
    result = { ...battle.run(), seed: body.seed },
    fault = battle.fault;
  if (fault) throw Error("The simulation stopped safely and this match was not recorded.");
  const snapshot = captureBattleMeta({
      record: { engineHash, challenger, defender, seed: body.seed, mode: body.mode, swapSpawns: body.swapSpawns, objective },
      battle,
      result,
      unpackChallenge,
      kind: body.kind,
    });
  return { clientBattleId: body.clientBattleId, snapshot };
}

export async function insertBattleMetaLog(db, {
  attemptId = null,
  clientBattleId = null,
  capturedAt = Date.now(),
  settledAt = null,
  snapshot,
}) {
  if (!snapshot || typeof snapshot.engineHash !== "string") return { stored: false, reason: "missing-snapshot" };
  const battleJson = JSON.stringify(snapshot);
  if (battleJson.length > 1_500_000) return { stored: false, reason: "battle-log-too-large" };
  const logId = crypto.randomUUID();
  const saved = await db.prepare(
    "INSERT OR IGNORE INTO battle_meta_logs (id,attempt_id,client_battle_id,source,captured_at,settled_at,engine_hash,arena,seed,winner,duration,battle_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
  ).bind(
    logId,
    attemptId,
    clientBattleId,
    snapshot.kind,
    capturedAt,
    settledAt,
    snapshot.engineHash,
    snapshot.arena,
    snapshot.seed,
    snapshot.result.winner,
    snapshot.result.time,
    battleJson,
  ).run();
  return { stored: saved.meta?.changes === 1, duplicate: saved.meta?.changes === 0 };
}

function groupKey(battle) {
  return [battle.kind, battle.engineHash, battle.arena, stable(battle.rules || {})].join("\u0000");
}

function groupFromBattle(battle) {
  return {
    source: battle.kind,
    engineHash: battle.engineHash,
    arena: battle.arena,
    rules: battle.rules || {},
    matches: 0,
    sides: { side0Wins: 0, side1Wins: 0, draws: 0 },
    durationTotal: 0,
    durations: [],
    damageTotal: [0, 0],
    integrityTotal: [0, 0],
    resources: { peakHeat: 0, overheatingBuilds: 0, thermalRetreatSeconds: 0, powerLimitedSeconds: 0, brownouts: 0 },
    weapons: new Map(),
    armorBands: new Map(),
    weaponCountBands: new Map(),
  };
}

function bandName(value) {
  return value === 0 ? "0" : value <= 3 ? "1–3" : value <= 7 ? "4–7" : "8+";
}

function addBuildBand(map, label, winner) {
  const value = map.get(label) || { builds: 0, wins: 0, losses: 0, draws: 0, integrity: 0 };
  value.builds++;
  if (winner === -1) value.draws++;
  else if (winner === 1) value.wins++;
  else value.losses++;
  map.set(label, value);
}

export function analyzeBattleMeta(inputRows, {
  generatedAt = Date.now(),
  windowStart = generatedAt - BATTLE_META_RETENTION_MS,
  windowEnd = generatedAt,
  intervalHours = 24,
  totalRows = inputRows.length,
} = {}) {
  const groups = new Map(), outcomes = { side0Wins: 0, side1Wins: 0, draws: 0 }, durations = [];
  for (const row of inputRows) {
    const battle = typeof row.battle === "object" && row.battle ? row.battle : parse(row.battle_json);
    if (!battle || battle.formatVersion !== 1 || !Array.isArray(battle.sides) || battle.sides.length !== 2) continue;
    let group = groups.get(groupKey(battle));
    if (!group) groups.set(groupKey(battle), group = groupFromBattle(battle));
    const winner = Number(battle.result?.winner), duration = Number(battle.result?.time) || 0;
    group.matches++;
    group.durationTotal += duration;
    group.durations.push(duration);
    durations.push(duration);
    if (winner === 0) { group.sides.side0Wins++; outcomes.side0Wins++; }
    else if (winner === 1) { group.sides.side1Wins++; outcomes.side1Wins++; }
    else { group.sides.draws++; outcomes.draws++; }
    for (let side = 0; side < 2; side++) {
      const build = battle.builds?.[side] || {}, telemetry = battle.sides[side] || {},
        sideWinner = winner === -1 ? -1 : winner === side ? 1 : 0;
      group.damageTotal[side] += Number(battle.result?.damage?.[side]) || 0;
      group.integrityTotal[side] += Number(battle.result?.integrity?.[side]) || 0;
      group.resources.peakHeat += Number(telemetry.peakHeat) || 0;
      group.resources.overheatingBuilds += (Number(telemetry.overheatCount) || 0) > 0 ? 1 : 0;
      group.resources.thermalRetreatSeconds += Number(telemetry.cooldownTime) || 0;
      group.resources.powerLimitedSeconds += Number(telemetry.powerLimitedTime) || 0;
      group.resources.brownouts += Number(telemetry.brownoutCount) || 0;
      addBuildBand(group.armorBands, bandName(Number(build.armorParts) || 0), sideWinner);
      addBuildBand(group.weaponCountBands, bandName(Number(build.weaponCount) || 0), sideWinner);
      for (const [weaponId, stats] of Object.entries(telemetry.weapons || {})) {
        const value = group.weapons.get(weaponId) || {
          weapon: weaponId, builds: 0, instances: 0, wins: 0, losses: 0, draws: 0,
          shots: 0, hits: 0, damage: 0, heatWait: 0, powerWait: 0, destroyed: 0,
        };
        value.builds++;
        value.instances += Number(stats.count) || 0;
        if (sideWinner === 1) value.wins++;
        else if (sideWinner === -1) value.draws++;
        else value.losses++;
        value.shots += Number(stats.shots) || 0;
        value.hits += Number(stats.hits) || 0;
        value.damage += Number(stats.damage) || 0;
        value.heatWait += Number(stats.heatWait) || 0;
        value.powerWait += Number(stats.powerWait) || 0;
        value.destroyed += Number(stats.destroyed) || 0;
        group.weapons.set(weaponId, value);
      }
    }
  }
  const sortedDurations = [...durations].sort((a, b) => a - b), median = sortedDurations.length
    ? sortedDurations[Math.floor(sortedDurations.length / 2)] : 0;
  const reportGroups = [...groups.values()].map((group) => {
    const builds = group.matches * 2;
    const bands = (map) => [...map.entries()].map(([range, value]) => ({
      range, builds: value.builds, wins: value.wins, losses: value.losses, draws: value.draws,
      winShare: value.builds ? round((value.wins + value.draws / 2) / value.builds, 4) : null,
    }));
    const weapons = [...group.weapons.values()].map((weapon) => ({
      ...weapon,
      winShare: weapon.builds ? round((weapon.wins + weapon.draws / 2) / weapon.builds, 4) : null,
      pickShare: builds ? round(weapon.builds / builds, 4) : 0,
      hitRate: weapon.shots ? round(weapon.hits / weapon.shots, 4) : null,
      damagePerGun: weapon.instances ? round(weapon.damage / weapon.instances) : 0,
      heatWaitPerGunSeconds: weapon.instances ? round(weapon.heatWait / weapon.instances) : 0,
      powerWaitPerGunSeconds: weapon.instances ? round(weapon.powerWait / weapon.instances) : 0,
    })).sort((a, b) => b.builds - a.builds || b.winShare - a.winShare);
    const matches = group.matches;
    return {
      source: group.source,
      engineHash: group.engineHash,
      arena: group.arena,
      rules: group.rules,
      matches,
      outcomes: group.sides,
      averageDurationSeconds: matches ? round(group.durationTotal / matches) : 0,
      medianDurationSeconds: matches ? round([...group.durations].sort((a, b) => a - b)[Math.floor(matches / 2)]) : 0,
      averageDamageBySide: group.damageTotal.map((value) => matches ? round(value / matches) : 0),
      averageIntegrityBySide: group.integrityTotal.map((value) => matches ? round(value / matches, 4) : 0),
      resourcePressure: {
        averagePeakHeat: builds ? round(group.resources.peakHeat / builds) : 0,
        overheatingBuildShare: builds ? round(group.resources.overheatingBuilds / builds, 4) : 0,
        averageThermalRetreatSeconds: builds ? round(group.resources.thermalRetreatSeconds / builds) : 0,
        averagePowerLimitedSeconds: builds ? round(group.resources.powerLimitedSeconds / builds) : 0,
        brownoutsPerBuild: builds ? round(group.resources.brownouts / builds, 3) : 0,
      },
      weapons,
      armorBands: bands(group.armorBands),
      weaponCountBands: bands(group.weaponCountBands),
    };
  }).sort((a, b) => b.matches - a.matches || a.source.localeCompare(b.source) || a.arena.localeCompare(b.arena));
  const matchCount = reportGroups.reduce((total, group) => total + group.matches, 0),
    engineHashes = [...new Set(reportGroups.map((group) => group.engineHash))].sort();
  const insights = [];
  for (const group of reportGroups) {
    if (group.matches >= 10) {
      const side0Share = (group.outcomes.side0Wins + group.outcomes.draws / 2) / group.matches;
      if (side0Share >= 0.6 || side0Share <= 0.4)
        insights.push({
          type: "side-skew", source: group.source, arena: group.arena, engineHash: group.engineHash,
          sample: group.matches, side0WinShare: round(side0Share, 3),
          note: "A persistent side-0/side-1 gap is visible in this sample; inspect spawn swaps and matchup selection before calling it a balance issue.",
        });
    }
    const tested = group.weapons.filter((weapon) => weapon.builds >= 10).sort((a, b) => b.winShare - a.winShare);
    if (tested.length) insights.push({
      type: "weapon-sample", source: group.source, arena: group.arena, engineHash: group.engineHash,
      sample: tested[0].builds, weapon: tested[0].weapon, winShare: tested[0].winShare,
      note: "Weapon win share is descriptive and is affected by build quality, pilot selection, rules, and opponent choices.",
    });
  }
  return {
    formatVersion: 1,
    generatedAt,
    windowStart,
    windowEnd,
    intervalHours,
    retentionDays: BATTLE_META_RETENTION_DAYS,
    sample: { matches: matchCount, storedInWindow: totalRows, analyzed: inputRows.length, truncated: totalRows > inputRows.length },
    outcomes,
    averageDurationSeconds: matchCount ? round(durations.reduce((sum, value) => sum + value, 0) / matchCount) : 0,
    medianDurationSeconds: round(median),
    engineHashes,
    groups: reportGroups,
    insights,
    interpretation: "Paid, friendly, shared-link, and practice matches are split by source and exact engine/rules/arena. These are selected player builds, not a controlled balance experiment.",
  };
}

export async function runBattleMetaReport(db, { intervalHours = 24, at = Date.now() } = {}) {
  const interval = metaReportIntervalHours(intervalHours), token = crypto.randomUUID(),
    state = await db.prepare(
      "UPDATE battle_meta_state SET lease_token=?,lease_until=? WHERE id=1 AND lease_until<=? AND last_report_at<=? RETURNING id",
    ).bind(token, at + 5 * 60 * 1000, at, at - interval * 60 * 60 * 1000).first();
  if (!state) return { generated: false, reason: "not-due-or-leased" };
  try {
    const windowStart = at - BATTLE_META_RETENTION_MS,
      total = await db.prepare(
        "SELECT COUNT(*) AS total FROM battle_meta_logs l WHERE l.captured_at>=? AND l.captured_at<=? AND l.settled_at IS NOT NULL",
      ).bind(windowStart, at).first(),
      rows = await db.prepare(
        "SELECT battle_json FROM battle_meta_logs WHERE captured_at>=? AND captured_at<=? AND settled_at IS NOT NULL ORDER BY captured_at DESC LIMIT ?",
      ).bind(windowStart, at, MAX_REPORT_LOGS).all(),
      report = analyzeBattleMeta(rows.results || [], {
        generatedAt: at,
        windowStart,
        windowEnd: at,
        intervalHours: interval,
        totalRows: Number(total?.total) || 0,
      });
    await db.batch([
      db.prepare(
        "INSERT INTO battle_meta_reports (generated_at,window_start,window_end,interval_hours,battle_count,engine_hashes,report_json) VALUES (?,?,?,?,?,?,?)",
      ).bind(at, windowStart, at, interval, report.sample.matches, JSON.stringify(report.engineHashes), JSON.stringify(report)),
      db.prepare(
        "UPDATE battle_meta_state SET last_report_at=?,lease_token=NULL,lease_until=0 WHERE id=1 AND lease_token=?",
      ).bind(at, token),
      db.prepare("DELETE FROM battle_meta_logs WHERE captured_at<?").bind(at - BATTLE_META_RETENTION_MS),
      db.prepare(
        "DELETE FROM battle_meta_reports WHERE id NOT IN (SELECT id FROM battle_meta_reports ORDER BY generated_at DESC LIMIT 365)",
      ),
    ]);
    return { generated: true, matches: report.sample.matches, reportId: at };
  } catch (error) {
    await db.prepare(
      "UPDATE battle_meta_state SET lease_token=NULL,lease_until=0 WHERE id=1 AND lease_token=?",
    ).bind(token).run().catch(() => {});
    throw error;
  }
}

export async function readBattleMetaReports(db, { intervalHours = 24, at = Date.now() } = {}) {
  const interval = metaReportIntervalHours(intervalHours);
  try {
    const [state, rows] = await Promise.all([
      db.prepare("SELECT last_report_at FROM battle_meta_state WHERE id=1").first(),
      db.prepare("SELECT generated_at,window_start,window_end,battle_count,engine_hashes,report_json FROM battle_meta_reports ORDER BY generated_at DESC LIMIT 30").all(),
    ]);
    const reports = (rows.results || []).map((row) => ({
      generatedAt: row.generated_at,
      windowStart: row.window_start,
      windowEnd: row.window_end,
      battleCount: row.battle_count,
      engineHashes: parse(row.engine_hashes, []),
      report: parse(row.report_json, null),
    })).filter((row) => row.report);
    return {
      available: true,
      intervalHours: interval,
      retentionDays: BATTLE_META_RETENTION_DAYS,
      nextReportAt: Number(state?.last_report_at || 0) + interval * 60 * 60 * 1000,
      reports,
    };
  } catch {
    return {
      available: false,
      intervalHours: interval,
      retentionDays: BATTLE_META_RETENTION_DAYS,
      nextReportAt: at + interval * 60 * 60 * 1000,
      reports: [],
    };
  }
}

export async function purgeOldBattleMetaLogs(db, at = Date.now()) {
  return db.prepare("DELETE FROM battle_meta_logs WHERE captured_at<?")
    .bind(at - BATTLE_META_RETENTION_MS).run();
}
