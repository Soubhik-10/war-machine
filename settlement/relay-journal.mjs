import { keccak256 } from 'viem';
import { ensure } from './protocol.mjs';

// Transactions and signatures here are public broadcast artifacts, never keys.
export async function broadcastPrepared(storage, client, key, raw, payloadHash, request, now=Date.now()) {
  const existing=await storage.get(key);
  if(existing) { ensure(existing.payloadHash===payloadHash,'PAYLOAD_MISMATCH'); return existing; }
  const value={raw,hash:keccak256(raw),payloadHash,request,hashes:[keccak256(raw)],updated:now};
  await storage.put(key,value);
  try { const hash=await client.sendRawTransaction({serializedTransaction:raw}); ensure(hash===value.hash,'TRANSACTION_HASH_MISMATCH'); } catch { /* durable hash is reconciled on retry */ }
  return value;
}
export async function resumeBroadcast(storage,client,wallet,key,journal,{paused,deadline,maxFeePerGas},now=Date.now()) {
  for(const hash of journal.hashes || [journal.hash]) {
    try { await client.getTransactionReceipt({hash}); return {hash}; } catch {}
  }
  if(paused || now>=deadline*1000) return {hash:journal.hash};
  if(now-journal.updated>=15000 && journal.request && BigInt(journal.request.maxFeePerGas)<maxFeePerGas) {
    const current=BigInt(journal.request.maxFeePerGas), bumped=current+current/8n+1n;
    const next={...journal.request,maxFeePerGas:bumped>maxFeePerGas?maxFeePerGas:bumped};
    const tip=BigInt(journal.request.maxPriorityFeePerGas || 0n),nextTip=tip+tip/8n+1n;
    next.maxPriorityFeePerGas=nextTip>next.maxFeePerGas?next.maxFeePerGas:nextTip;
    // Only fee fields change. Escrow, calldata, zero value, per-match nonce and
    // deadline stay identical, so replacement cannot redirect a payment.
    const raw=await wallet.signTransaction(next),hash=keccak256(raw);
    journal={...journal,raw,hash,request:next,hashes:[...(journal.hashes || [journal.hash]),hash],updated:now};
    await storage.put(key,journal);
  }
  try { await client.sendRawTransaction({serializedTransaction:journal.raw}); } catch {}
  return {hash:journal.hash};
}
