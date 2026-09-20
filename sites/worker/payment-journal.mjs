import { keccak256 } from 'viem';
import { Transaction } from 'viem/tempo';

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
export const paymentJournalKey = operation => `mpp-payment-journal:${operation}`;
function normalizedBinding(value) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      typeof value.amount !== 'string' || !/^\d+$/.test(value.amount) ||
      !/^0x[0-9a-fA-F]{40}$/.test(value.recipient || '') ||
      !/^0x[0-9a-fA-F]{40}$/.test(value.token || '') ||
      !Number.isSafeInteger(Number(value.chainId)) || Number(value.chainId) <= 0) return null;
  return { amount: BigInt(value.amount).toString(), recipient: value.recipient.toLowerCase(),
    token: value.token.toLowerCase(), chainId: String(value.chainId) };
}
export async function readJournal(db, key) {
  const row = await db.prepare('SELECT value FROM payment_kv WHERE key=?').bind(key).first();
  return row ? JSON.parse(row.value) : null;
}
export async function writeJournal(db, key, value) {
  await db.prepare('INSERT INTO payment_kv (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .bind(key, JSON.stringify(value)).run();
}

// A database lease, rather than process-local state, serializes request retries
// and background recovery on stateless Sites Workers.
export async function withOperationLease(db, operation, callback, at = Date.now()) {
  const key = `operation-lease:${operation}`, owner = crypto.randomUUID();
  const lock = await db.prepare("INSERT INTO payment_kv (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(json_extract(payment_kv.value,'$.expires') AS INTEGER)<?")
    .bind(key, JSON.stringify({ owner, expires: at + 180_000 }), at).run();
  if (lock.meta.changes !== 1) fail(409, 'This operation is still processing. Retry the same idempotency key; do not pay again.');
  try { return await callback(); }
  finally {
    await db.prepare("DELETE FROM payment_kv WHERE key=? AND json_extract(value,'$.owner')=?").bind(key, owner).run();
  }
}

// Mppx checks its challenge HMAC and request binding before invoking this
// method. Journal only after method validation, but before its replay claim or
// broadcast. A crashed SDK call can then be reconciled without consuming a new
// payment or bypassing its global replay protection.
export function journaledCharge(method, { db, operation, credentialDigest, binding, confirm }) {
  const key = paymentJournalKey(operation);
  return {
    ...method,
    async broadcast(args) {
      const prior = await readJournal(db, key);
      if (prior) {
        fail(409, prior.phase === 'paid'
          ? 'This payment operation is already paid; recover the original response.'
          : 'This payment operation already has a saved transaction; recover it before retrying.');
      }
      const checked = await method.validate(args);
      const source = checked.details.sender;
      if (!source) fail(401, 'The payment did not identify a verified payer.');
      const suppliedSource = args.credential.source?.split(':').at(-1);
      if (suppliedSource && suppliedSource.toLowerCase() !== source.toLowerCase())
        fail(401, 'Payment source does not match the verified payer.');
      // Zero-value identity proofs have no monetary crash boundary.
      if (checked.details.mode === 'proof') return method.broadcast(args);
      const raw = checked.details.serializedTransaction
        ? await Transaction.serialize(Transaction.deserialize(checked.details.serializedTransaction)) : null;
      const transactionHash = raw ? keccak256(raw) : args.credential.payload.hash;
      const claimKey = `mpp-payment-owner:${transactionHash.toLowerCase()}`;
      await db.prepare('INSERT INTO payment_kv (key,value) VALUES (?,?) ON CONFLICT(key) DO NOTHING')
        .bind(claimKey, JSON.stringify({ operation })).run();
      if ((await readJournal(db, claimKey)).operation !== operation)
        fail(409, 'This payment already belongs to a different operation.');
      const entry = { operation, binding, source, credentialDigest, transactionHash, raw,
        phase: 'validated', createdAt: Date.now() };
      await writeJournal(db, key, entry);
      const receipt = await method.broadcast(args);
      await confirm(transactionHash);
      await writeJournal(db, key, { ...entry, phase: 'paid', receipt });
      return receipt;
    },
  };
}

export async function recoverCharge(db, operation, binding, { confirm, broadcast }) {
  const key = paymentJournalKey(operation), entry = await readJournal(db, key);
  if (!entry) return null;
  const bindingFields = ['amount', 'recipient', 'token', 'chainId'];
  const savedBinding = normalizedBinding(entry.binding), expectedBinding = normalizedBinding(binding);
  if (!savedBinding || !expectedBinding || bindingFields.some((field) => savedBinding[field] !== expectedBinding[field]))
    fail(409, 'Saved payment terms differ from this request.');
  if (entry.phase === 'paid') return entry;
  // Receipt lookup always comes first, even after a local expiry or quarantine
  // marker. A relayer can mine a transaction just before validBefore while the
  // original response is lost; skipping this check would misclassify a paid
  // operation and invite an unsafe second payment.
  try {
    await confirm(entry.transactionHash);
  } catch (error) {
    if (entry.recoveryRequired) {
      fail(503, `Payment recovery is required for transaction ${entry.transactionHash}; do not pay again.`);
    }
    if (/reverted/i.test(String(error?.message || error))) {
      const quarantined = { ...entry, recoveryRequired: true, recoveryHash: entry.transactionHash, recoveryError: 'Saved payment transaction reverted; manual reconciliation is required.' };
      await writeJournal(db, key, quarantined);
      fail(503, `Payment transaction ${entry.transactionHash} reverted; recovery is required and no replacement will be sent.`);
    }
    if (Number(entry.validBefore || 0) > 0 && Number(entry.validBefore) <= Math.floor(Date.now() / 1000)) {
      const quarantined = { ...entry, recoveryRequired: true, recoveryHash: entry.transactionHash, recoveryError: 'Saved transaction expired before finality.' };
      await writeJournal(db, key, quarantined);
      fail(503, `Payment transaction ${entry.transactionHash} expired before finality; recovery is required and no replacement will be sent.`);
    }
    // Broadcast identical prevalidated bytes only. Never replace an uncertain
    // payment with a fresh transaction or release its replay ownership.
    if (!entry.raw) throw error;
    try { await broadcast(entry.raw); } catch { /* reconcile a lost RPC response */ }
    await confirm(entry.transactionHash);
  }
  const receipt = { method: 'tempo', status: 'success', reference: entry.transactionHash,
    timestamp: new Date().toISOString() };
  const paid = { ...entry, phase: 'paid', receipt };
  await writeJournal(db, key, paid);
  return paid;
}
