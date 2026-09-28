import { packChallenge, stats, unpackChallenge } from "../dist/data.mjs";
import { Battle } from "../dist/engine.mjs";
import { CLIENT_ENGINE_HASH } from "../dist/release.mjs";
import { captureBattleMeta } from "../settlement/meta-snapshot.mjs";

const MAX_ACTIVE_CHALLENGES = 2000;
const MAX_PER_CREATOR = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const REPEAT_RATING_WINDOW_MS = DAY_MS;
const MAX_RATED_REMATCHES_PER_DAY = 3;
const DEFAULT_RATING = 1000;
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MACHINE_CLASSES = new Set(["light", "medium", "heavy"]);

const fail = (status, message) => {
  const error = Error(message);
  error.status = status;
  throw error;
};

const check = (value, status, message) => {
  if (!value) fail(status, message);
  return value;
};

const text = (value, max, label) => {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > max ||
    /[\u0000-\u001f]/.test(value)
  )
    fail(400, `Invalid ${label}.`);
  return value.trim();
};

const parse = (value, label = "stored game data") => {
  try {
    return JSON.parse(value);
  } catch {
    fail(500, `The ${label} is invalid.`);
  }
};

const round = (value, digits = 2) =>
  Number(Number(value || 0).toFixed(digits));

const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
};

async function digest(value) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const randomSeed = () => {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0];
};

const id = () => crypto.randomUUID();

export function friendlySeason(timestamp = Date.now()) {
  const date = new Date(timestamp);
  return `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

export function machineClass(machine) {
  const summary = stats(machine);
  if (summary.mass >= 165) return "heavy";
  if (summary.mass >= 95) return "medium";
  return "light";
}

export function calculateFriendlyRating({
  challengerRating = DEFAULT_RATING,
  defenderRating = DEFAULT_RATING,
  challengerMatches = 0,
  defenderMatches = 0,
  winner = -1,
}) {
  const challengerExpected =
    1 / (1 + 10 ** ((defenderRating - challengerRating) / 400));
  const defenderExpected = 1 - challengerExpected;
  const challengerScore = winner === 0 ? 1 : winner === 1 ? 0 : 0.5;
  const defenderScore = 1 - challengerScore;
  const challengerK = challengerMatches < 10 ? 48 : 32;
  const defenderK = defenderMatches < 10 ? 48 : 32;
  const challengerDelta = round(
    challengerK * (challengerScore - challengerExpected),
  );
  const defenderDelta = round(defenderK * (defenderScore - defenderExpected));
  return {
    challenger: {
      before: round(challengerRating),
      after: round(challengerRating + challengerDelta),
      delta: challengerDelta,
      expected: round(challengerExpected, 4),
      score: challengerScore,
      k: challengerK,
    },
    defender: {
      before: round(defenderRating),
      after: round(defenderRating + defenderDelta),
      delta: defenderDelta,
      expected: round(defenderExpected, 4),
      score: defenderScore,
      k: defenderK,
    },
  };
}

function statusFor(row, timestamp) {
  if ((row.status || "open") === "open" && Number(row.expires) <= timestamp)
    return "expired";
  return row.status || "open";
}

function decodeRow(row, timestamp = Date.now()) {
  return {
    id: row.id,
    challengerName: row.challenger_name,
    creatorName: row.challenger_name,
    title: row.title,
    blueprint: parse(row.blueprint),
    created: row.created,
    expires: row.expires,
    updated: row.updated || row.created,
    status: statusFor(row, timestamp),
    rated: row.rated === 1 || row.rated === true,
    versions: { hash: row.engine_hash },
  };
}

function strictBody(body, allowed) {
  check(body && typeof body === "object" && !Array.isArray(body), 400, "Expected a JSON object.");
  check(
    Object.keys(body).every((key) => allowed.includes(key)),
    400,
    "Unknown field in request.",
  );
}

function clientId(value) {
  check(
    typeof value === "string" && ID_PATTERN.test(value),
    400,
    "Refresh the page and try again.",
  );
  return value.toLowerCase();
}

function optionalBoolean(value, label) {
  check(value === undefined || typeof value === "boolean", 400, `Invalid ${label}.`);
  return value === true;
}

function objectiveOf(challenge) {
  return challenge.objective === "escort" ? "escort" : "reactor";
}

function lockedOpponentBlueprint(value, terms) {
  let proposed;
  try {
    proposed = unpackChallenge(value);
  } catch (error) {
    fail(400, error.message || "Invalid machine blueprint.");
  }
  const objective = objectiveOf(proposed);
  check(
    proposed.arena === terms.arena &&
      stable(proposed.rules) === stable(terms.rules) &&
      objective === objectiveOf(terms),
    409,
    "This challenge locks its arena, rules, and objective. Rebuild inside those terms.",
  );
  return packChallenge(
    proposed.machine,
    terms.arena,
    0,
    terms.rules,
    objectiveOf(terms),
  );
}

function matchResult(result) {
  const winner = Number(result?.winner);
  return {
    winner,
    outcome: winner === 0 ? "challenger" : winner === 1 ? "defender" : "draw",
    time: round(result?.time, 2),
    damage: Array.isArray(result?.damage)
      ? result.damage.map((value) => round(value, 2))
      : [0, 0],
    reason: String(result?.reason || "Unknown result"),
    integrity: Array.isArray(result?.integrity)
      ? result.integrity.map((value) => round(value, 4))
      : [],
    score: Array.isArray(result?.score)
      ? result.score.map((value) => round(value, 4))
      : [],
  };
}

/** Rebuild the exact battle server-side. The caller never supplies a winner. */
export function verifyFriendlyBattle({
  challenger,
  defender,
  seed,
  engineHash = CLIENT_ENGINE_HASH,
}) {
  const challengerTerms = unpackChallenge(challenger);
  const defenderTerms = unpackChallenge(defender);
  check(
    challengerTerms.arena === defenderTerms.arena &&
      stable(challengerTerms.rules) === stable(defenderTerms.rules) &&
      objectiveOf(challengerTerms) === objectiveOf(defenderTerms),
    400,
    "The locked builds do not share the same match terms.",
  );
  const objective = objectiveOf(challengerTerms);
  const battle = new Battle(
    challengerTerms.machine,
    defenderTerms.machine,
    challengerTerms.arena,
    seed,
    {
      mode: challengerTerms.rules.combat,
      swapSpawns: !!(seed & 1),
      objective,
      headless: true,
      observeEvents: true,
    },
  );
  const rawResult = { ...battle.run(), seed };
  if (battle.fault) throw Error("The deterministic simulation stopped safely.");
  const replay = captureBattleMeta({
    record: {
      engineHash,
      challenger,
      defender,
      seed,
      mode: challengerTerms.rules.combat,
      swapSpawns: !!(seed & 1),
      objective,
    },
    battle,
    result: rawResult,
    unpackChallenge,
    kind: "server-friendly",
  });
  return { result: matchResult(rawResult), replay };
}

async function challengeRow(db, challengeId) {
  return db
    .prepare(
      "SELECT id,creator_hash,challenger_name,title,blueprint,engine_hash,created,expires,status,rated,updated FROM friendly_challenges WHERE id=?",
    )
    .bind(challengeId)
    .first();
}

async function runForChallenge(db, challengeId) {
  return db
    .prepare("SELECT * FROM friendly_match_runs WHERE challenge_id=?")
    .bind(challengeId)
    .first();
}

async function matchRow(db, matchId) {
  return db
    .prepare("SELECT * FROM friendly_match_runs WHERE id=?")
    .bind(matchId)
    .first();
}

function replayTerms(row) {
  return {
    challenger: parse(row.challenger_blueprint),
    defender: parse(row.defender_blueprint),
    arena: row.arena,
    seed: Number(row.seed),
    rules: parse(row.rules),
    objective: row.objective,
    swapSpawns: !!row.swap_spawns,
    engineHash: row.engine_hash,
  };
}

function ratingForView(value) {
  if (!value || !value.rated) return { rated: false, suppressedReason: value?.suppressedReason || null };
  return {
    rated: true,
    before: value.challenger.before,
    after: value.challenger.after,
    delta: value.challenger.delta,
    opponentBefore: value.defender.before,
    opponentAfter: value.defender.after,
    challenger: value.challenger,
    defender: value.defender,
    season: value.season,
  };
}

function matchView(row, { includeTelemetry = false } = {}) {
  const result = row.result_json ? parse(row.result_json, "stored match result") : null;
  const rating = row.rating_json ? parse(row.rating_json, "stored rating") : null;
  const view = {
    id: row.id,
    challengeId: row.challenge_id,
    status: row.status,
    challengerName: row.challenger_name,
    defenderName: row.defender_name,
    rated: row.rated_effective === 1 || row.rated_effective === true,
    ratingRequested: row.rated === 1 || row.rated === true,
    result,
    replay: replayTerms(row),
    rating: ratingForView(rating),
    verifiedAt: row.completed || null,
    created: row.created,
    accepted: row.accepted,
    updated: row.updated,
    error: row.status === "retry" ? row.error || "Verification is retrying." : null,
    links: {
      self: `/api/friendly-matches/${row.id}`,
      replay: `/api/friendly-replays/${row.id}`,
      share: `/?friendlyMatch=${row.id}#friendly`,
    },
  };
  if (includeTelemetry) view.telemetry = row.replay_json ? parse(row.replay_json, "stored replay") : null;
  return view;
}

function ratingDefaults(playerHash, scope, displayName) {
  return {
    player_hash: playerHash,
    scope,
    display_name: displayName,
    rating: DEFAULT_RATING,
    matches: 0,
    wins: 0,
    losses: 0,
    draws: 0,
  };
}

async function ratingRow(db, playerHash, scope, displayName) {
  const row = await db
    .prepare("SELECT * FROM friendly_ratings WHERE player_hash=? AND scope=?")
    .bind(playerHash, scope)
    .first();
  return row || ratingDefaults(playerHash, scope, displayName);
}

function countedRating(row, rating, score, displayName) {
  return {
    player_hash: row.player_hash,
    scope: row.scope,
    display_name: displayName,
    rating: rating.after,
    matches: Number(row.matches) + 1,
    wins: Number(row.wins) + (score === 1 ? 1 : 0),
    losses: Number(row.losses) + (score === 0 ? 1 : 0),
    draws: Number(row.draws) + (score === 0.5 ? 1 : 0),
  };
}

function ratingUpsert(row, timestamp) {
  return {
    sql: "INSERT INTO friendly_ratings (player_hash,scope,display_name,rating,matches,wins,losses,draws,updated) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(player_hash,scope) DO UPDATE SET display_name=excluded.display_name,rating=excluded.rating,matches=excluded.matches,wins=excluded.wins,losses=excluded.losses,draws=excluded.draws,updated=excluded.updated",
    values: [
      row.player_hash,
      row.scope,
      row.display_name,
      row.rating,
      row.matches,
      row.wins,
      row.losses,
      row.draws,
      timestamp,
    ],
  };
}

function ratingEvent({
  matchId,
  playerHash,
  scope,
  displayName,
  update,
  score,
  season,
  arena,
  machineClass: className,
  timestamp,
}) {
  return {
    sql: "INSERT INTO friendly_rating_events (id,match_id,player_hash,scope,display_name,rating_before,rating_after,rating_delta,result,season,arena,machine_class,created) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    values: [
      id(),
      matchId,
      playerHash,
      scope,
      displayName,
      update.before,
      update.after,
      update.delta,
      score,
      season,
      arena,
      className,
      timestamp,
    ],
  };
}

async function ratedRematches(db, run, timestamp) {
  const pair = await db
    .prepare(
      "SELECT COUNT(*) AS total FROM friendly_match_runs WHERE id<>? AND status='complete' AND rated_effective=1 AND completed>=? AND ((challenger_hash=? AND defender_hash=?) OR (challenger_hash=? AND defender_hash=?))",
    )
    .bind(
      run.id,
      timestamp - REPEAT_RATING_WINDOW_MS,
      run.challenger_hash,
      run.defender_hash,
      run.defender_hash,
      run.challenger_hash,
    )
    .first();
  return Number(pair?.total || 0);
}

async function storeRatings(db, run, timestamp) {
  if (!(run.rated === 1 || run.rated === true))
    return { rated: false, suppressedReason: "casual-match" };

  const priorEvent = await db
    .prepare(
      "SELECT rating_before,rating_after,rating_delta,result FROM friendly_rating_events WHERE match_id=? AND player_hash=? AND scope='global'",
    )
    .bind(run.id, run.challenger_hash)
    .first();
  if (priorEvent) {
    const opponentEvent = await db
      .prepare(
        "SELECT rating_before,rating_after,rating_delta,result FROM friendly_rating_events WHERE match_id=? AND player_hash=? AND scope='global'",
      )
      .bind(run.id, run.defender_hash)
      .first();
    if (opponentEvent)
      return {
        rated: true,
        challenger: {
          before: Number(priorEvent.rating_before),
          after: Number(priorEvent.rating_after),
          delta: Number(priorEvent.rating_delta),
          score: Number(priorEvent.result),
        },
        defender: {
          before: Number(opponentEvent.rating_before),
          after: Number(opponentEvent.rating_after),
          delta: Number(opponentEvent.rating_delta),
          score: Number(opponentEvent.result),
        },
        season: friendlySeason(run.completed || timestamp),
      };
  }

  if ((await ratedRematches(db, run, timestamp)) >= MAX_RATED_REMATCHES_PER_DAY)
    return { rated: false, suppressedReason: "repeat-opponent-limit" };

  const result = parse(run.result_json, "stored match result");
  const challengerTerms = unpackChallenge(parse(run.challenger_blueprint));
  const defenderTerms = unpackChallenge(parse(run.defender_blueprint));
  const season = friendlySeason(run.completed || timestamp);
  const globalChallenger = await ratingRow(
    db,
    run.challenger_hash,
    "global",
    run.challenger_name,
  );
  const globalDefender = await ratingRow(
    db,
    run.defender_hash,
    "global",
    run.defender_name,
  );
  const global = calculateFriendlyRating({
    challengerRating: Number(globalChallenger.rating),
    defenderRating: Number(globalDefender.rating),
    challengerMatches: Number(globalChallenger.matches),
    defenderMatches: Number(globalDefender.matches),
    winner: result.winner,
  });
  const seasonScope = `season:${season}`;
  const seasonChallenger = await ratingRow(
    db,
    run.challenger_hash,
    seasonScope,
    run.challenger_name,
  );
  const seasonDefender = await ratingRow(
    db,
    run.defender_hash,
    seasonScope,
    run.defender_name,
  );
  const seasonal = calculateFriendlyRating({
    challengerRating: Number(seasonChallenger.rating),
    defenderRating: Number(seasonDefender.rating),
    challengerMatches: Number(seasonChallenger.matches),
    defenderMatches: Number(seasonDefender.matches),
    winner: result.winner,
  });
  const challengerClass = machineClass(challengerTerms.machine);
  const defenderClass = machineClass(defenderTerms.machine);
  const challengerGlobal = countedRating(
    globalChallenger,
    global.challenger,
    global.challenger.score,
    run.challenger_name,
  );
  const defenderGlobal = countedRating(
    globalDefender,
    global.defender,
    global.defender.score,
    run.defender_name,
  );
  const challengerSeason = countedRating(
    seasonChallenger,
    seasonal.challenger,
    seasonal.challenger.score,
    run.challenger_name,
  );
  const defenderSeason = countedRating(
    seasonDefender,
    seasonal.defender,
    seasonal.defender.score,
    run.defender_name,
  );
  const statements = [
    ratingEvent({
      matchId: run.id,
      playerHash: run.challenger_hash,
      scope: "global",
      displayName: run.challenger_name,
      update: global.challenger,
      score: global.challenger.score,
      season,
      arena: run.arena,
      machineClass: challengerClass,
      timestamp,
    }),
    ratingEvent({
      matchId: run.id,
      playerHash: run.defender_hash,
      scope: "global",
      displayName: run.defender_name,
      update: global.defender,
      score: global.defender.score,
      season,
      arena: run.arena,
      machineClass: defenderClass,
      timestamp,
    }),
    ratingEvent({
      matchId: run.id,
      playerHash: run.challenger_hash,
      scope: seasonScope,
      displayName: run.challenger_name,
      update: seasonal.challenger,
      score: seasonal.challenger.score,
      season,
      arena: run.arena,
      machineClass: challengerClass,
      timestamp,
    }),
    ratingEvent({
      matchId: run.id,
      playerHash: run.defender_hash,
      scope: seasonScope,
      displayName: run.defender_name,
      update: seasonal.defender,
      score: seasonal.defender.score,
      season,
      arena: run.arena,
      machineClass: defenderClass,
      timestamp,
    }),
    ratingUpsert(challengerGlobal, timestamp),
    ratingUpsert(defenderGlobal, timestamp),
    ratingUpsert(challengerSeason, timestamp),
    ratingUpsert(defenderSeason, timestamp),
  ].map((statement) => db.prepare(statement.sql).bind(...statement.values));
  await db.batch(statements);
  return {
    rated: true,
    challenger: global.challenger,
    defender: global.defender,
    season,
    machineClasses: { challenger: challengerClass, defender: defenderClass },
  };
}

async function ensureRatings(db, run, timestamp) {
  if (run.status !== "complete") return run;
  if (run.rating_json) return run;
  const rating = await storeRatings(db, run, timestamp);
  const updated = await db
    .prepare(
      "UPDATE friendly_match_runs SET rated_effective=?,rating_suppressed_reason=?,rating_json=?,updated=? WHERE id=? AND rating_json IS NULL",
    )
    .bind(
      rating.rated ? 1 : 0,
      rating.suppressedReason || null,
      JSON.stringify(rating),
      timestamp,
      run.id,
    )
    .run();
  if (updated.meta?.changes) return matchRow(db, run.id);
  return matchRow(db, run.id);
}

async function verifyPendingMatch(db, matchId, timestamp) {
  let run = await matchRow(db, matchId);
  check(run, 404, "Friendly match not found.");
  if (run.status === "complete") return ensureRatings(db, run, timestamp);
  if (run.status === "verifying" && Number(run.updated) > timestamp - 30_000)
    return run;
  const claimed = await db
    .prepare(
      "UPDATE friendly_match_runs SET status='verifying',error=NULL,updated=? WHERE id=? AND (status IN ('running','retry') OR (status='verifying' AND updated<=?))",
    )
    .bind(timestamp, matchId, timestamp - 30_000)
    .run();
  if (!claimed.meta?.changes) return (await matchRow(db, matchId)) || run;
  run = await matchRow(db, matchId);
  try {
    const verified = verifyFriendlyBattle({
      challenger: parse(run.challenger_blueprint),
      defender: parse(run.defender_blueprint),
      seed: Number(run.seed),
      engineHash: run.engine_hash,
    });
    await db
      .prepare(
        "UPDATE friendly_match_runs SET status='complete',result_json=?,replay_json=?,completed=?,updated=? WHERE id=? AND status='verifying'",
      )
      .bind(
        JSON.stringify(verified.result),
        JSON.stringify(verified.replay),
        timestamp,
        timestamp,
        run.id,
      )
      .run();
    run = await matchRow(db, matchId);
    return ensureRatings(db, run, timestamp);
  } catch (error) {
    await db
      .prepare(
        "UPDATE friendly_match_runs SET status='retry',error=?,updated=? WHERE id=?",
      )
      .bind(String(error?.message || "Server verification failed.").slice(0, 240), timestamp, matchId)
      .run();
    throw error;
  }
}

export async function purgeFriendlyChallenges(db, timestamp = Date.now()) {
  // Completed matches retain their immutable snapshots and replay links. Only
  // unplayed listings disappear at the 24-hour deadline.
  const result = await db
    .prepare(
      "DELETE FROM friendly_challenges WHERE expires<=? AND NOT EXISTS (SELECT 1 FROM friendly_match_runs WHERE friendly_match_runs.challenge_id=friendly_challenges.id)",
    )
    .bind(timestamp)
    .run();
  return result.meta?.changes || 0;
}

async function createChallenge(db, body, timestamp) {
  strictBody(body, ["challengerName", "title", "blueprint", "clientId", "rated"]);
  const challengerName = text(body.challengerName, 28, "challenger name");
  const title = text(body.title, 70, "challenge title");
  const creatorHash = await digest(clientId(body.clientId));
  const rated = optionalBoolean(body.rated, "rated setting");
  let challenge;
  try {
    challenge = unpackChallenge(body.blueprint);
  } catch (error) {
    fail(400, error.message || "Invalid machine blueprint.");
  }
  const blueprint = packChallenge(
    challenge.machine,
    challenge.arena,
    0,
    challenge.rules,
    objectiveOf(challenge),
  );
  const active = await db
    .prepare(
      "SELECT COUNT(*) AS total FROM friendly_challenges WHERE creator_hash=? AND expires>? AND status='open'",
    )
    .bind(creatorHash, timestamp)
    .first();
  if (Number(active.total) >= MAX_PER_CREATOR)
    fail(429, "You already have three active friendly challenges. Try again after one expires.");
  const total = await db
    .prepare(
      "SELECT COUNT(*) AS total FROM friendly_challenges WHERE expires>? AND status='open'",
    )
    .bind(timestamp)
    .first();
  if (Number(total.total) >= MAX_ACTIVE_CHALLENGES)
    fail(503, "The friendly challenge board is full right now. Try again later.");
  const challengeId = id();
  const expires = timestamp + DAY_MS;
  await db
    .prepare(
      "INSERT INTO friendly_challenges (id,creator_hash,challenger_name,title,blueprint,engine_hash,created,expires,status,rated,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      challengeId,
      creatorHash,
      challengerName,
      title,
      JSON.stringify(blueprint),
      CLIENT_ENGINE_HASH,
      timestamp,
      expires,
      "open",
      rated ? 1 : 0,
      timestamp,
    )
    .run();
  return decodeRow(
    {
      id: challengeId,
      challenger_name: challengerName,
      title,
      blueprint: JSON.stringify(blueprint),
      engine_hash: CLIENT_ENGINE_HASH,
      created: timestamp,
      expires,
      status: "open",
      rated: rated ? 1 : 0,
      updated: timestamp,
    },
    timestamp,
  );
}

async function acceptChallenge(db, challengeId, body, timestamp) {
  strictBody(body, ["clientId", "participantName", "blueprint", "rated"]);
  const challengerHash = await digest(clientId(body.clientId));
  const challengerName = text(body.participantName, 28, "pilot name");
  const wantsRated = optionalBoolean(body.rated, "rated setting");
  const challenge = await challengeRow(db, challengeId);
  check(challenge, 404, "This friendly challenge has expired or was removed.");
  const existing = await runForChallenge(db, challengeId);
  if (existing) {
    check(
      existing.challenger_hash === challengerHash,
      409,
      "Another player has already accepted this challenge.",
    );
    return verifyPendingMatch(db, existing.id, timestamp);
  }
  check(Number(challenge.expires) > timestamp, 409, "This friendly challenge has expired.");
  check(statusFor(challenge, timestamp) === "open", 409, "This friendly challenge is no longer open.");
  check(
    challengerHash !== challenge.creator_hash,
    403,
    "You cannot accept your own friendly challenge.",
  );
  const defenderTerms = unpackChallenge(parse(challenge.blueprint));
  const challengerBlueprint = lockedOpponentBlueprint(body.blueprint, defenderTerms);
  const claimed = await db
    .prepare(
      "UPDATE friendly_challenges SET status='accepted',updated=? WHERE id=? AND status='open' AND expires>?",
    )
    .bind(timestamp, challenge.id, timestamp)
    .run();
  if (!claimed.meta?.changes) {
    const competing = await runForChallenge(db, challengeId);
    if (competing && competing.challenger_hash === challengerHash)
      return verifyPendingMatch(db, competing.id, timestamp);
    fail(409, "Another player accepted this challenge first.");
  }
  const matchId = id();
  const seed = randomSeed();
  const rated = (challenge.rated === 1 || challenge.rated === true) && wantsRated;
  try {
    await db
      .prepare(
        "INSERT INTO friendly_match_runs (id,challenge_id,challenger_hash,challenger_name,challenger_blueprint,defender_hash,defender_name,defender_blueprint,rated,rated_effective,rating_suppressed_reason,status,engine_hash,arena,rules,objective,seed,swap_spawns,result_json,replay_json,rating_json,error,created,accepted,completed,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        matchId,
        challenge.id,
        challengerHash,
        challengerName,
        JSON.stringify(challengerBlueprint),
        challenge.creator_hash,
        challenge.challenger_name,
        challenge.blueprint,
        rated ? 1 : 0,
        0,
        null,
        "running",
        CLIENT_ENGINE_HASH,
        defenderTerms.arena,
        JSON.stringify(defenderTerms.rules),
        objectiveOf(defenderTerms),
        seed,
        seed & 1 ? 1 : 0,
        null,
        null,
        null,
        null,
        timestamp,
        timestamp,
        null,
        timestamp,
      )
      .run();
  } catch (error) {
    await db
      .prepare(
        "UPDATE friendly_challenges SET status='open',updated=? WHERE id=? AND status='accepted'",
      )
      .bind(timestamp, challenge.id)
      .run();
    throw error;
  }
  return verifyPendingMatch(db, matchId, timestamp);
}

async function cancelChallenge(db, challengeId, body, timestamp) {
  strictBody(body, ["clientId"]);
  const creatorHash = await digest(clientId(body.clientId));
  const changed = await db
    .prepare(
      "UPDATE friendly_challenges SET status='cancelled',updated=? WHERE id=? AND creator_hash=? AND status='open'",
    )
    .bind(timestamp, challengeId, creatorHash)
    .run();
  if (!changed.meta?.changes) {
    const row = await challengeRow(db, challengeId);
    check(row, 404, "Friendly challenge not found.");
    check(row.creator_hash === creatorHash, 403, "Only the challenge creator can cancel it.");
    fail(409, "This friendly challenge is already in progress or complete.");
  }
  return { id: challengeId, status: "cancelled" };
}

async function declineChallenge(db, challengeId, body, timestamp) {
  strictBody(body, ["clientId"]);
  const actorHash = await digest(clientId(body.clientId));
  const challenge = await challengeRow(db, challengeId);
  check(challenge, 404, "Friendly challenge not found.");
  check(Number(challenge.expires) > timestamp, 409, "This friendly challenge has expired.");
  await db
    .prepare(
      "INSERT OR IGNORE INTO friendly_challenge_declines (challenge_id,actor_hash,created) VALUES (?,?,?)",
    )
    .bind(challengeId, actorHash, timestamp)
    .run();
  return { id: challengeId, status: "declined" };
}

function requestedScope(url, timestamp) {
  const requested = url.searchParams.get("scope") || "global";
  if (requested === "global") return "global";
  if (requested === "season") return `season:${friendlySeason(timestamp)}`;
  if (/^season:\d{4}-Q[1-4]$/.test(requested)) return requested;
  fail(400, "Choose global or a valid season leaderboard.");
}

async function leaderboard(db, url, timestamp) {
  const scope = requestedScope(url, timestamp);
  const requestedLimit = Number(url.searchParams.get("limit") || 50);
  check(
    Number.isSafeInteger(requestedLimit) && requestedLimit >= 1 && requestedLimit <= 100,
    400,
    "Choose a leaderboard limit from 1 to 100.",
  );
  const arena = url.searchParams.get("arena");
  const className = url.searchParams.get("machineClass");
  check(!arena || /^[a-z0-9-]{2,32}$/i.test(arena), 400, "Invalid arena filter.");
  check(!className || MACHINE_CLASSES.has(className), 400, "Invalid machine class filter.");
  if (!arena && !className) {
    const rows = await db
      .prepare(
        "SELECT display_name,rating,matches,wins,losses,draws,updated FROM friendly_ratings WHERE scope=? AND matches>0 ORDER BY rating DESC,matches DESC,updated ASC LIMIT ?",
      )
      .bind(scope, requestedLimit)
      .all();
    return {
      scope,
      season: scope.startsWith("season:") ? scope.slice(7) : null,
      ratingBasis: "verified Elo",
      rankings: rows.results.map((row, index) => ({
        rank: index + 1,
        name: row.display_name,
        rating: round(row.rating),
        matches: Number(row.matches),
        wins: Number(row.wins),
        losses: Number(row.losses),
        draws: Number(row.draws),
        updated: row.updated,
      })),
    };
  }
  const filters = ["scope=?"];
  const values = [scope];
  if (arena) {
    filters.push("arena=?");
    values.push(arena);
  }
  if (className) {
    filters.push("machine_class=?");
    values.push(className);
  }
  values.push(requestedLimit);
  const rows = await db
    .prepare(
      `SELECT display_name,COUNT(DISTINCT match_id) AS matches,SUM(CASE WHEN result=1 THEN 1 ELSE 0 END) AS wins,SUM(CASE WHEN result=0 THEN 1 ELSE 0 END) AS losses,SUM(CASE WHEN result=0.5 THEN 1 ELSE 0 END) AS draws,SUM(rating_delta) AS rating_delta,MAX(created) AS updated FROM friendly_rating_events WHERE ${filters.join(" AND ")} GROUP BY player_hash,display_name ORDER BY rating_delta DESC,matches DESC,updated ASC LIMIT ?`,
    )
    .bind(...values)
    .all();
  return {
    scope,
    season: scope.startsWith("season:") ? scope.slice(7) : null,
    filters: { arena: arena || null, machineClass: className || null },
    ratingBasis: "verified Elo change within the selected filter",
    rankings: rows.results.map((row, index) => ({
      rank: index + 1,
      name: row.display_name,
      rating: round(DEFAULT_RATING + Number(row.rating_delta || 0)),
      ratingDelta: round(row.rating_delta),
      matches: Number(row.matches),
      wins: Number(row.wins),
      losses: Number(row.losses),
      draws: Number(row.draws),
      updated: row.updated,
    })),
  };
}

export async function handleFriendlyChallenges({
  db,
  request,
  path,
  method,
  body,
  response,
  timestamp = Date.now(),
}) {
  if (
    !path.startsWith("/api/friendly-challenges") &&
    !path.startsWith("/api/friendly-matches") &&
    !path.startsWith("/api/friendly-replays") &&
    path !== "/api/friendly-leaderboard" &&
    path !== "/api/friendly-rankings"
  )
    return null;
  await purgeFriendlyChallenges(db, timestamp);
  const url = new URL(request.url);

  if ((path === "/api/friendly-leaderboard" || path === "/api/friendly-rankings") && method === "GET")
    return response(await leaderboard(db, url, timestamp));

  if (path === "/api/friendly-challenges" && method === "GET") {
    const rows = await db
      .prepare(
        "SELECT id,challenger_name,title,blueprint,created,expires,engine_hash,status,rated,updated FROM friendly_challenges WHERE expires>? AND status='open' ORDER BY created DESC,id DESC LIMIT 150",
      )
      .bind(timestamp)
      .all();
    return response(rows.results.map((row) => decodeRow(row, timestamp)));
  }

  if (path === "/api/friendly-challenges" && method === "POST")
    return response(await createChallenge(db, body, timestamp), 201);

  let match = path.match(/^\/api\/friendly-challenges\/([a-f0-9-]{36})(?:\/(accept|cancel|decline))?$/i);
  if (match) {
    const [, challengeId, action] = match;
    if (!action && method === "GET") {
      const row = await challengeRow(db, challengeId);
      check(row, 404, "This friendly challenge has expired or was removed.");
      const run = await runForChallenge(db, challengeId);
      if (statusFor(row, timestamp) === "expired" && !run)
        fail(404, "This friendly challenge has expired or was removed.");
      const value = decodeRow(row, timestamp);
      if (run) value.match = matchView(await ensureRatings(db, run, timestamp));
      return response(value);
    }
    if (action === "accept" && method === "POST")
      return response(matchView(await acceptChallenge(db, challengeId, body, timestamp)), 201);
    if (action === "cancel" && method === "POST")
      return response(await cancelChallenge(db, challengeId, body, timestamp));
    if (action === "decline" && method === "POST")
      return response(await declineChallenge(db, challengeId, body, timestamp));
  }

  match = path.match(/^\/api\/friendly-matches\/([a-f0-9-]{36})(?:\/(verify))?$/i);
  if (match) {
    const [, matchId, action] = match;
    if (!action && method === "GET") {
      const run = await matchRow(db, matchId);
      check(run, 404, "Friendly match not found.");
      return response(matchView(await ensureRatings(db, run, timestamp)));
    }
    if (action === "verify" && method === "POST")
      return response(matchView(await verifyPendingMatch(db, matchId, timestamp)));
  }

  match = path.match(/^\/api\/friendly-replays\/([a-f0-9-]{36})$/i);
  if (match && method === "GET") {
    const run = await matchRow(db, match[1]);
    check(run, 404, "Friendly replay not found.");
    check(run.status === "complete", 409, "The server is still verifying this match.");
    return response(matchView(await ensureRatings(db, run, timestamp), { includeTelemetry: true }));
  }

  return null;
}

export const FRIENDLY_CHALLENGE_TTL_MS = DAY_MS;
export const FRIENDLY_REPEAT_RATING_LIMIT = MAX_RATED_REMATCHES_PER_DAY;
