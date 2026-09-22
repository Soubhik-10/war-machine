import { readJournal, writeJournal } from './payment-journal.mjs';

// Coalescing is isolate-local. The journal only shares a recent observation.
export const HEALTH_TTL_MS = 15_000;
export const REFRESH_BUDGET_MS = 4_000;
export const MIN_FEE_BALANCE_UNITS = 10_000n;
const snapshots = new Map();
const inFlight = new Map();
const counters = { hit: 0, miss: 0, refresh: 0 };

function identity(config) {
  const base = `payment-health:${config.chainId}:${config.escrowAddress}:v${config.escrowVersion}:s${config.settlementSigner || ''}:r${config.relayerAddress || ''}`;
  return config.escrowVersion === '6'
    ? `${base}:d${String(config.v6DomainSeparator || '').toLowerCase()}` : base;
}

function unavailable(config) {
  return { state: 'unavailable', ready: false, fresh: false, checkedAt: null,
    reason: config.settlementReason || config.reason || 'Settlement is not configured.' };
}

function snapshot(value, at) {
  if (!value) return { state: 'unknown', ready: false, fresh: false, checkedAt: null,
    reason: 'Payment readiness has not yet been verified.' };
  const fresh = Number.isFinite(value.checkedAt) && value.checkedAt <= at &&
    value.checkedAt > at - HEALTH_TTL_MS;
  if (!fresh) return { ...value, state: 'stale', ready: false, fresh: false,
    reason: 'Payment readiness is stale; a new check is required.' };
  return { ...value, state: value.ready ? 'ready' : 'unavailable',
    ready: value.ready === true, fresh: true };
}

export function paymentHealthSnapshot(config, at = Date.now()) {
  if (!config.enabled || !config.automaticSettlementReady) return unavailable(config);
  const key = identity(config);
  const value = snapshot(snapshots.get(key), at);
  return value.state === 'unknown' && inFlight.has(key)
    ? { ...value, state: 'checking' } : value;
}

export function paymentHealthCounters() { return { ...counters }; }

export function settlementCapacity(health) {
  const minimumUnits = String(MIN_FEE_BALANCE_UNITS);
  const fresh = health?.fresh === true;
  if (!fresh && ['unknown', 'checking', 'stale', undefined, null].includes(health?.state)) {
    const checking = (role) => ({ role, state: 'checking', balanceUnits: null, minimumUnits });
    return { state: 'checking', ready: false, fresh: false, checkedAt: health?.checkedAt || null,
      signer: checking('settlement-signer'), relayer: checking('mpp-relayer'), warning: null };
  }
  const capacityOf = (role, balanceUnits) => {
    let state = 'unavailable';
    if (balanceUnits !== null && balanceUnits !== undefined && /^\d+$/.test(String(balanceUnits)))
      state = BigInt(balanceUnits) < MIN_FEE_BALANCE_UNITS ? 'low' : 'ready';
    return { role, state, balanceUnits: balanceUnits == null ? null : String(balanceUnits), minimumUnits };
  };
  const signer = capacityOf('settlement-signer', health?.signerBalanceUnits);
  const relayer = health?.relayer
    ? capacityOf('mpp-relayer', health.relayerBalanceUnits)
    : { role: 'mpp-relayer', state: 'not-configured', balanceUnits: null, minimumUnits };
  const state = !fresh ? 'unavailable' : signer.state !== 'ready' ? signer.state
    : relayer.state === 'low' || relayer.state === 'unavailable' ? relayer.state : 'ready';
  const warning = signer.state === 'low'
    ? 'Settlement signer fee balance is below the 0.01 pathUSD admission minimum. New paid activity cannot be safely admitted; existing attempts may need recovery.'
    : signer.state !== 'ready' || !fresh
      ? 'Settlement signer fee balance is unavailable or stale. New paid activity cannot be safely admitted; existing attempts may need recovery.'
      : relayer.state === 'low'
        ? 'MPP relayer fee balance is below the 0.01 pathUSD admission minimum. New paid activity cannot be safely admitted; existing attempts may need recovery.'
        : relayer.state === 'unavailable'
          ? 'MPP relayer fee balance is unavailable. New paid activity cannot be safely admitted; existing attempts may need recovery.'
          : null;
  return { state, ready: state === 'ready', fresh, checkedAt: health?.checkedAt || null,
    signer, relayer, warning };
}

export async function persistedPaymentHealthSnapshot(db, config, at = Date.now()) {
  const local = paymentHealthSnapshot(config, at);
  if (local.fresh || !config.enabled || !config.automaticSettlementReady) return local;
  // D1 is optional for browsing. A slow or failed read falls back to the
  // isolate snapshot; it never starts RPC in the response path.
  let timer;
  try {
    const saved = await Promise.race([
      readJournal(db, identity(config)),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), 100); }),
    ]);
    const result = snapshot(saved, at);
    if (result.fresh) {
      snapshots.set(identity(config), saved);
      counters.hit++;
      return result;
    }
  } catch { /* Unknown is an honest browsing state when D1 is unavailable. */ }
  finally { clearTimeout(timer); }
  return local;
}

// Only new paid admission awaits this. Public reads use the snapshot and can
// start a refresh in waitUntil without placing chain RPC on the response path.
export async function paymentHealth(db, config, readBalance, readDeployment = null, at = Date.now()) {
  if (!config.enabled || !config.automaticSettlementReady) return unavailable(config);
  const key = identity(config);
  const local = snapshot(snapshots.get(key), at);
  if (local.fresh) { counters.hit++; return local; }
  if (inFlight.has(key)) { counters.hit++; return inFlight.get(key); }
  counters.miss++;
  const refresh = (async () => {
    const started = Date.now();
    let rpcChecks = 0;
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('Readiness refresh timed out.')), REFRESH_BUDGET_MS);
    });
    try {
      const result = await Promise.race([(async () => {
        const cached = await readJournal(db, key);
        const saved = snapshot(cached, at);
        if (saved.fresh) { counters.hit++; return cached; }
        const overdue = db.prepare("SELECT COUNT(*) AS count,MIN(b.escrow_attempt_deadline) AS oldest FROM attempts a JOIN bounties b ON b.id=a.bounty WHERE b.fee_policy_version=? AND a.status IN ('engineering','queued','awaiting-signatures','ready-to-settle') AND b.escrow_attempt_deadline<?")
          .bind(`pathusd-direct-escrow-v${config.escrowVersion}`,
            at - Number(config.settlementGraceSeconds || 0) * 1000).first();
        const checks = [];
        if (config.escrowVersion === '6') {
          if (!readDeployment) throw Error('V6 chain and domain verification is unavailable.');
          checks.push((async () => {
            rpcChecks++;
            const chain = await readDeployment('eth_chainId', []);
            if (BigInt(chain) !== BigInt(config.chainId)) throw Error('RPC chain mismatch.');
          })());
          checks.push((async () => {
            rpcChecks++;
            const domain = await readDeployment('eth_call', [{ to: config.escrowAddress, data: '0x3644e515' }, 'latest']);
            if (String(domain).toLowerCase() !== String(config.v6DomainSeparator || '').toLowerCase())
              throw Error('Configured V6 escrow domain mismatch.');
          })());
        }
        rpcChecks++;
        const signer = readBalance(config.settlementSigner);
        const sameAddress = config.relayerAddress &&
          config.relayerAddress.toLowerCase() === config.settlementSigner?.toLowerCase();
        if (config.relayerAddress && !sameAddress) rpcChecks++;
        const relayer = !config.relayerAddress ? Promise.resolve(null)
          : sameAddress ? signer : readBalance(config.relayerAddress);
        const [signerBalance, relayerBalance, pending] =
          await Promise.all([signer, relayer, overdue, ...checks]);
        const reasons = [];
        // This is an admission buffer, not an estimate of transaction cost.
        if (BigInt(signerBalance) < MIN_FEE_BALANCE_UNITS)
          reasons.push('Settlement signer needs at least 0.01 pathUSD for transaction fees.');
        if (relayerBalance !== null && BigInt(relayerBalance) < MIN_FEE_BALANCE_UNITS)
          reasons.push('MPP relayer needs at least 0.01 pathUSD for transaction fees.');
        if (Number(pending?.count || 0))
          reasons.push('Overdue attempts are awaiting settlement recovery.');
        const result = { ready: reasons.length === 0, checkedAt: Date.now(), reason: reasons.join(' ') || null,
          signer: config.settlementSigner, relayer: config.relayerAddress,
          signerBalanceUnits: String(signerBalance),
          relayerBalanceUnits: relayerBalance === null ? null : String(relayerBalance),
          overdueAttempts: Number(pending?.count || 0), oldestAttemptDeadline: pending?.oldest || null };
        await writeJournal(db, key, result);
        return result;
      })(), deadline]);
      snapshots.set(key, result);
      counters.refresh++;
      const state = snapshot(result, Date.now());
      console.info('Payment readiness refresh', { state: state.state,
        elapsedMs: Date.now() - started, rpcChecks,
        cacheHit: counters.hit, cacheMiss: counters.miss });
      return state;
    } catch (error) {
      const message = String(error?.message || error);
      const reason = /timed out/i.test(message) ? 'Payment readiness timed out.'
        : /chain mismatch/i.test(message) ? 'Tempo RPC chain mismatch.'
        : /domain mismatch/i.test(message) ? 'Configured V6 escrow domain mismatch.'
        : 'Payment readiness could not be verified. Existing operations can still be recovered.';
      const failed = { state: 'unavailable', ready: false, fresh: true,
        checkedAt: Date.now(), reason };
      snapshots.set(key, failed);
      console.error('Payment readiness refresh failed', { reason,
        elapsedMs: Date.now() - started, rpcChecks,
        cacheHit: counters.hit, cacheMiss: counters.miss });
      return failed;
    } finally {
      clearTimeout(timer);
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, refresh);
  return refresh;
}
