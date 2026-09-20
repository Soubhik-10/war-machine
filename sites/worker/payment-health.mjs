import { readJournal, writeJournal } from './payment-journal.mjs';

// Operational checks must not disable receipt reconciliation or refunds.
// Only admission of new paid operations depends on this cached health result.
export async function paymentHealth(db, config, readBalance, readDeployment = null, at = Date.now()) {
  if (!config.enabled || !config.automaticSettlementReady)
    return { ready: false, checkedAt: at, reason: config.settlementReason || config.reason || 'Settlement is not configured.' };
  const key = `payment-health:${config.chainId}:${config.escrowAddress}:v${config.escrowVersion}:s${config.settlementSigner || ''}:r${config.relayerAddress || ''}`;
  const cached = await readJournal(db, key);
  if (cached && cached.checkedAt > at - 15_000) return cached;
  let result;
  try {
    if (config.escrowVersion === '6' && readDeployment) {
      const chain = await readDeployment('eth_chainId', []);
      if (BigInt(chain) !== BigInt(config.chainId)) throw Error('RPC chain mismatch.');
      const domain = await readDeployment('eth_call', [{ to: config.escrowAddress, data: '0x3644e515' }, 'latest']);
      if (String(domain).toLowerCase() !== String(config.v6DomainSeparator || '').toLowerCase())
        throw Error('Configured V6 escrow address does not expose the expected version 6 domain.');
    }
    const signerBalance = await readBalance(config.settlementSigner);
    const relayerBalance = config.relayerAddress ? await readBalance(config.relayerAddress) : null;
    const pending = await db.prepare("SELECT COUNT(*) AS count,MIN(b.escrow_attempt_deadline) AS oldest FROM attempts a JOIN bounties b ON b.id=a.bounty WHERE b.fee_policy_version=? AND a.status IN ('engineering','queued','awaiting-signatures','ready-to-settle') AND b.escrow_attempt_deadline<?")
      .bind(`pathusd-direct-escrow-v${config.escrowVersion}`, at - Number(config.settlementGraceSeconds || 0) * 1000).first();
    const reasons = [];
    // 0.01 pathUSD is an admission buffer, not an assertion of transaction cost.
    if (BigInt(signerBalance) < 10_000n) reasons.push('Settlement signer needs at least 0.01 pathUSD for transaction fees.');
    if (relayerBalance !== null && BigInt(relayerBalance) < 10_000n) reasons.push('MPP relayer needs at least 0.01 pathUSD for transaction fees.');
    if (Number(pending?.count || 0)) reasons.push('Overdue attempts are awaiting settlement recovery.');
    result = { ready: reasons.length === 0, checkedAt: at, reason: reasons.join(' ') || null,
      signer: config.settlementSigner, relayer: config.relayerAddress,
      signerBalanceUnits: String(signerBalance), relayerBalanceUnits: relayerBalance === null ? null : String(relayerBalance),
      overdueAttempts: Number(pending?.count || 0), oldestAttemptDeadline: pending?.oldest || null };
  } catch {
    result = { ready: false, checkedAt: at, reason: 'Payment readiness could not be verified. Existing operations can still be recovered.' };
  }
  await writeJournal(db, key, result);
  return result;
}
