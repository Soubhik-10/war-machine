// V6 has a separate escrow. The owner authorized removing app-side pre-V6
// records; this never submits a transaction or changes an on-chain escrow.
const POLICY = "pathusd-direct-escrow-v6";
const MARKER = "v6-predecessor-purge:1";
const legacy = `SELECT id FROM bounties WHERE COALESCE(fee_policy_version,'')<> '${POLICY}'`;
const attempts = `SELECT id FROM attempts WHERE bounty IN (${legacy})`;
const holds = `SELECT id FROM payment_holds WHERE (bounty IN (${legacy}) AND CASE WHEN json_valid(body) THEN COALESCE(CAST(json_extract(body,'$.escrowVersion') AS TEXT),'')<>'6' ELSE 1 END) OR CASE WHEN json_valid(body) THEN CAST(json_extract(body,'$.escrowVersion') AS TEXT) IN ('2','3','4','5') ELSE 0 END`;

export async function purgePreV6Bounties(db, config) {
  if (config?.escrowVersion !== "6") return { ran: false };
  if (await db.prepare("SELECT value FROM payment_kv WHERE key=?").bind(MARKER).first())
    return { ran: false };
  const count = await db.prepare(`SELECT COUNT(*) AS total FROM bounties WHERE COALESCE(fee_policy_version,'')<>?`)
    .bind(POLICY).first();
  // D1 batch is transactional. The two no-delete triggers are restored in the
  // same transaction, retaining V6's immutable record and audit protections.
  const sql = [
    "DROP TRIGGER IF EXISTS settlement_audit_no_delete",
    "DROP TRIGGER IF EXISTS match_record_no_delete",
    `DELETE FROM payment_kv WHERE key IN (SELECT 'bounty-release:'||id FROM (${legacy})) OR key IN (SELECT 'settlement-broadcast:'||id FROM (${attempts})) OR CASE WHEN json_valid(value) THEN (json_extract(value,'$.bounty') IN (${legacy}) OR json_extract(value,'$.bountyId') IN (${legacy}) OR json_extract(value,'$.attempt') IN (${attempts}) OR json_extract(value,'$.attemptId') IN (${attempts}) OR json_extract(value,'$.hold') IN (${holds}) OR ((key LIKE 'bounty-release:%' OR key LIKE 'mpp-bounty-state:%' OR key LIKE 'mpp-payment-journal:%') AND CAST(json_extract(value,'$.escrowVersion') AS TEXT) IN ('2','3','4','5'))) ELSE 0 END`,
    `DELETE FROM idempotency WHERE ref IN (${legacy}) OR ref IN (${attempts}) OR ref IN (${holds}) OR EXISTS (SELECT 1 FROM payment_holds h WHERE h.id IN (${holds}) AND h.account=idempotency.account AND h.request_key=idempotency.key)`,
    `DELETE FROM financial_operations WHERE ref IN (${legacy}) OR ref IN (${attempts}) OR ref IN (${holds})`,
    `DELETE FROM ledger WHERE ref IN (${legacy}) OR ref IN (${attempts}) OR ref IN (${holds})`,
    `DELETE FROM payment_holds WHERE id IN (${holds})`,
    `DELETE FROM bookmarks WHERE bounty IN (${legacy})`,
    `DELETE FROM settlement_audit WHERE attempt IN (${attempts})`,
    `DELETE FROM settlement_jobs WHERE attempt IN (${attempts})`,
    `DELETE FROM attempts WHERE id IN (${attempts})`,
    `DELETE FROM bounties WHERE id IN (${legacy})`,
    "CREATE TRIGGER IF NOT EXISTS settlement_audit_no_delete BEFORE DELETE ON settlement_audit BEGIN SELECT RAISE(ABORT,'append only'); END",
    "CREATE TRIGGER IF NOT EXISTS match_record_no_delete BEFORE DELETE ON attempts WHEN OLD.match_record IS NOT NULL BEGIN SELECT RAISE(ABORT,'immutable match'); END",
    `INSERT INTO payment_kv (key,value) VALUES ('${MARKER}',?) ON CONFLICT(key) DO NOTHING`,
  ];
  await db.batch(sql.map((statement, index) => {
    const prepared = db.prepare(statement);
    return index === sql.length - 1
      ? prepared.bind(JSON.stringify({ completedAt: Date.now(), removedBounties: Number(count?.total || 0) }))
      : prepared;
  }));
  return { ran: true, removedBounties: Number(count?.total || 0) };
}
