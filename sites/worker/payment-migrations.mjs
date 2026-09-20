import { getAddress, keccak256, stringToHex } from "viem";

const LEGACY_POLICY = "pathusd-direct-escrow-v4";
const CURRENT_POLICY = "pathusd-direct-escrow-v5";
const CURSOR_KEY = "payment-migration:v5-policy-repair:cursor";
const BOUNTY_CREATED_TOPIC = keccak256(
  stringToHex("BountyCreated(uint256,address,uint128,uint128,uint64,bytes32)"),
).toLowerCase();
const MAX_BATCH = 5;
const WORD_BYTES = 64;

const failClosed = (reason) => ({ ok: false, reason });

function validHash(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function decimal(value) {
  try {
    if (typeof value === "bigint") return value;
    if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
    if (typeof value === "string" && (/^\d+$/.test(value) || /^0x[0-9a-fA-F]+$/.test(value))) return BigInt(value);
  } catch {}
  return null;
}

function address(value) {
  try {
    return getAddress(value).toLowerCase();
  } catch {
    return null;
  }
}

function word(data, index) {
  if (typeof data !== "string" || !/^0x[0-9a-fA-F]*$/.test(data)) return null;
  const raw = data.slice(2);
  const start = index * WORD_BYTES;
  if (raw.length < start + WORD_BYTES) return null;
  try {
    return BigInt(`0x${raw.slice(start, start + WORD_BYTES)}`);
  } catch {
    return null;
  }
}

function bytes32Word(data, index) {
  if (typeof data !== "string" || !/^0x[0-9a-fA-F]{256}$/.test(data)) return null;
  return `0x${data.slice(2 + index * WORD_BYTES, 2 + (index + 1) * WORD_BYTES)}`.toLowerCase();
}

function receiptStatusIsSuccess(receipt) {
  return receipt?.status === "0x1" || receipt?.status === 1 || receipt?.status === "1";
}

function matchingCreationLog(receipt, config, row) {
  if (!receiptStatusIsSuccess(receipt)) return failClosed("receipt-not-successful");
  const escrow = address(config?.escrowAddress);
  if (!escrow || !Array.isArray(receipt.logs)) return failClosed("receipt-not-authoritative");

  const expectedId = decimal(row.escrow_bounty_id);
  const expectedCreator = address(row.creator_wallet);
  const expectedReward = decimal(row.reward_units);
  const expectedEntry = decimal(row.entry_units);
  const expectedExpiry = row.expires === null || row.expires === undefined
    ? null
    : decimal(row.expires);
  const expectedTerms = typeof row.terms_hash === "string" && validHash(row.terms_hash)
    ? row.terms_hash.toLowerCase()
    : null;
  if (expectedId === null || !expectedCreator || expectedReward === null || expectedEntry === null || !expectedTerms || (row.expires !== null && row.expires !== undefined && expectedExpiry === null))
    return failClosed("row-missing-authoritative-fields");

  for (const log of receipt.logs) {
    if (address(log?.address) !== escrow) continue;
    const topics = log?.topics;
    if (!Array.isArray(topics) || topics.length !== 3 || String(topics[0]).toLowerCase() !== BOUNTY_CREATED_TOPIC)
      continue;
    const topicId = decimal(topics[1]);
    const topicCreator = typeof topics[2] === "string" && /^0x[0-9a-fA-F]{64}$/.test(topics[2])
      ? address(`0x${topics[2].slice(-40)}`)
      : null;
    const reward = word(log.data, 0);
    const entry = word(log.data, 1);
    const expiry = word(log.data, 2);
    const termsHash = bytes32Word(log.data, 3);
    const expiryMatches = expectedExpiry === null || (
      expiry !== null && expiry === (expectedExpiry > 10_000_000_000n ? expectedExpiry / 1000n : expectedExpiry)
    );
    if (
      topicId === expectedId &&
      topicCreator === expectedCreator &&
      reward === expectedReward &&
      entry === expectedEntry &&
      expiryMatches &&
      termsHash === expectedTerms
    ) return { ok: true };
  }
  return failClosed("creation-event-does-not-match");
}

async function readCursor(db) {
  const row = await db.prepare("SELECT value FROM payment_kv WHERE key=?").bind(CURSOR_KEY).first();
  if (!row) return null;
  try {
    const value = JSON.parse(row.value);
    return typeof value?.cursor === "string" ? value.cursor : null;
  } catch {
    return null;
  }
}

async function writeCursor(db, cursor) {
  await db.prepare(
    "INSERT INTO payment_kv (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  ).bind(CURSOR_KEY, JSON.stringify({ cursor })).run();
}

async function rowsAfter(db, cursor, limit) {
  const where = cursor
    ? "WHERE b.fee_policy_version=? AND b.id>?"
    : "WHERE b.fee_policy_version=?";
  const values = cursor
    ? [LEGACY_POLICY, cursor, limit]
    : [LEGACY_POLICY, limit];
  return (await db.prepare(
    `SELECT b.id,b.owner,b.status,b.listed,b.expires,b.entry_units,b.reward_units,
            b.escrow_bounty_id,b.terms_hash,b.escrow_create_tx,
            a.payout_address AS creator_wallet
       FROM bounties b
       LEFT JOIN accounts a ON a.id=b.owner
      ${where}
      ORDER BY b.id ASC
      LIMIT ?`,
  ).bind(...values).all()).results;
}

/**
 * Repair only V5 escrow rows that were persisted with the V4 policy label.
 * The callback must return a finalized, canonical receipt for the exact hash.
 * A durable cursor prevents a prefix of genuine V4 rows from starving later
 * mislabeled rows; skipped/uncertain rows are revisited after the cursor wraps.
 */
export async function repairMislabeledBounties(db, config, confirmReceipt, { limit = MAX_BATCH } = {}) {
  if (String(config?.escrowVersion) !== "5")
    return { scanned: 0, repaired: 0, skipped: 0, reason: "escrow-version-not-v5" };
  if (typeof confirmReceipt !== "function")
    throw new TypeError("confirmReceipt must be a function");
  const boundedLimit = Math.min(MAX_BATCH, Math.max(1, Number(limit) || MAX_BATCH));
  const cursor = await readCursor(db);
  let rows = await rowsAfter(db, cursor, boundedLimit);
  if (!rows.length && cursor !== null) {
    await writeCursor(db, "");
    rows = await rowsAfter(db, null, boundedLimit);
  }
  if (!rows.length) return { scanned: 0, repaired: 0, skipped: 0 };

  let repaired = 0;
  let skipped = 0;
  for (const row of rows) {
    if (!validHash(row.escrow_create_tx)) {
      skipped++;
      continue;
    }
    const creator = address(row.creator_wallet);
    const id = decimal(row.escrow_bounty_id);
    const reward = decimal(row.reward_units);
    const entry = decimal(row.entry_units);
    if (!creator || id === null || reward === null || entry === null || !validHash(row.terms_hash)) {
      skipped++;
      continue;
    }
    let receipt;
    try {
      receipt = await confirmReceipt(row.escrow_create_tx);
    } catch {
      skipped++;
      continue;
    }
    if (!validHash(receipt?.transactionHash) || receipt.transactionHash.toLowerCase() !== row.escrow_create_tx.toLowerCase()) {
      skipped++;
      continue;
    }
    const match = matchingCreationLog(receipt, config, row);
    if (!match.ok) {
      skipped++;
      continue;
    }
    const updated = await db.prepare(
      "UPDATE bounties SET fee_policy_version=? WHERE id=? AND fee_policy_version=?",
    ).bind(CURRENT_POLICY, row.id, LEGACY_POLICY).run();
    if (updated.meta.changes === 1) repaired++;
  }
  await writeCursor(db, rows.at(-1).id);
  return { scanned: rows.length, repaired, skipped };
}

export const paymentMigrationConstants = Object.freeze({
  LEGACY_POLICY,
  CURRENT_POLICY,
  MAX_BATCH,
  BOUNTY_CREATED_TOPIC,
});
