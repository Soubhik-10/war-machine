import { packChallenge, unpackChallenge } from "../dist/data.mjs";
import { CLIENT_ENGINE_HASH } from "../dist/release.mjs";

const MAX_ACTIVE_CHALLENGES = 2000;
const MAX_PER_CREATOR = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const fail = (status, message) => {
  const error = Error(message);
  error.status = status;
  throw error;
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

async function digest(value) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function decodeRow(row) {
  return {
    id: row.id,
    challengerName: row.challenger_name,
    title: row.title,
    blueprint: JSON.parse(row.blueprint),
    created: row.created,
    expires: row.expires,
    versions: { hash: row.engine_hash },
  };
}

export async function purgeFriendlyChallenges(db, timestamp = Date.now()) {
  const result = await db
    .prepare("DELETE FROM friendly_challenges WHERE expires<=?")
    .bind(timestamp)
    .run();
  return result.meta?.changes || 0;
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
  if (!path.startsWith("/api/friendly-challenges")) return null;
  await purgeFriendlyChallenges(db, timestamp);

  if (path === "/api/friendly-challenges" && method === "GET") {
    const rows = await db
      .prepare(
        "SELECT id,challenger_name,title,blueprint,created,expires,engine_hash FROM friendly_challenges WHERE expires>? ORDER BY created DESC,id DESC LIMIT 150",
      )
      .bind(timestamp)
      .all();
    return response(rows.results.map(decodeRow));
  }

  if (path === "/api/friendly-challenges" && method === "POST") {
    if (!body || typeof body !== "object" || Array.isArray(body))
      fail(400, "Expected a JSON object.");
    if (
      !Object.keys(body).every((key) =>
        ["challengerName", "title", "blueprint", "clientId"].includes(key),
      )
    )
      fail(400, "Unknown field in request.");

    const challengerName = text(body.challengerName, 28, "challenger name");
    const title = text(body.title, 70, "challenge title");
    if (typeof body.clientId !== "string" || !ID_PATTERN.test(body.clientId))
      fail(400, "Refresh the page and try creating the challenge again.");

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
      challenge.objective,
    );
    const creatorHash = await digest(body.clientId.toLowerCase());
    const active = await db
      .prepare(
        "SELECT COUNT(*) AS total FROM friendly_challenges WHERE creator_hash=? AND expires>?",
      )
      .bind(creatorHash, timestamp)
      .first();
    if (active.total >= MAX_PER_CREATOR)
      fail(429, "You already have three active friendly challenges. Try again after one expires.");

    const total = await db
      .prepare("SELECT COUNT(*) AS total FROM friendly_challenges WHERE expires>?")
      .bind(timestamp)
      .first();
    if (total.total >= MAX_ACTIVE_CHALLENGES)
      fail(503, "The friendly challenge board is full right now. Try again later.");

    const id = crypto.randomUUID();
    const created = timestamp;
    const expires = created + DAY_MS;
    await db
      .prepare(
        "INSERT INTO friendly_challenges (id,creator_hash,challenger_name,title,blueprint,engine_hash,created,expires) VALUES (?,?,?,?,?,?,?,?)",
      )
      .bind(
        id,
        creatorHash,
        challengerName,
        title,
        JSON.stringify(blueprint),
        CLIENT_ENGINE_HASH,
        created,
        expires,
      )
      .run();
    return response(
      decodeRow({
        id,
        challenger_name: challengerName,
        title,
        blueprint: JSON.stringify(blueprint),
        engine_hash: CLIENT_ENGINE_HASH,
        created,
        expires,
      }),
      201,
    );
  }

  const match = path.match(/^\/api\/friendly-challenges\/([a-f0-9-]{36})$/i);
  if (match && method === "GET") {
    const row = await db
      .prepare(
        "SELECT id,challenger_name,title,blueprint,created,expires,engine_hash FROM friendly_challenges WHERE id=? AND expires>?",
      )
      .bind(match[1], timestamp)
      .first();
    if (!row) fail(404, "This friendly challenge has expired or was removed.");
    return response(decodeRow(row));
  }

  return null;
}

export const FRIENDLY_CHALLENGE_TTL_MS = DAY_MS;
