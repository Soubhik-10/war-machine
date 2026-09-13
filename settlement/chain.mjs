import { createPublicClient, http, decodeEventLog, sha256, stringToHex } from 'viem';
import { tempo } from 'viem/chains';
import { ABI, CHAIN_ID, ESCROW, ensure } from './protocol.mjs';
export const publicClient = env => createPublicClient({chain:tempo,transport:http(env.WM_TEMPO_RPC_URL,{timeout:15000,retryCount:0})});
export async function finalizedReceipt(client, hash) {
  ensure(await client.getChainId() === CHAIN_ID,'CHAIN_MISMATCH');
  const receipt = await client.getTransactionReceipt({hash});
  ensure(receipt.status === 'success','TRANSACTION_REVERTED');
  const finalized = await client.getBlock({blockTag:'finalized'});
  ensure(receipt.blockNumber <= finalized.number,'FINALITY_PENDING');
  const block = await client.getBlock({blockNumber:receipt.blockNumber});
  ensure(block.hash === receipt.blockHash,'FINALITY_PENDING');
  return receipt;
}
export function matchingEvent(receipt,name) {
  const events = receipt.logs.filter(x=>x.address.toLowerCase()===ESCROW.toLowerCase()).flatMap(log=>{
    try { const event=decodeEventLog({abi:ABI,...log}); return event.eventName===name?[event.args]:[]; } catch { return []; }
  });
  ensure(events.length===1,'EVENT_MISMATCH'); return events[0];
}
export async function validateMatchOnChain(client, record) {
  const entered = matchingEvent(await finalizedReceipt(client,record.entryTx),'AttemptEntered');
  ensure(entered.bountyId.toString()===record.bountyId && entered.attemptNonce.toString()===record.attemptNonce && entered.challenger.toLowerCase()===record.challengerAddress.toLowerCase() && Number(entered.attemptDeadline)===record.deadline,'ENTRY_MISMATCH');
  const bounty = await client.readContract({address:ESCROW,abi:ABI,functionName:'getBounty',args:[BigInt(record.bountyId)],blockTag:'finalized'});
  ensure(bounty.status===2 && bounty.attemptNonce.toString()===record.attemptNonce && Number(bounty.attemptDeadline)===record.deadline,'ATTEMPT_NOT_ACTIVE');
  ensure(bounty.creator.toLowerCase()===record.creator.toLowerCase() && bounty.challenger.toLowerCase()===record.challengerAddress.toLowerCase() && bounty.reward.toString()===record.reward && bounty.entry.toString()===record.entry,'TERMS_MISMATCH');
  const terms = {version:'war-machines-direct-escrow-v2',engineHash:record.engineHash,creator:record.creator,title:record.title,defender:record.defender,entry:record.entry,reward:record.reward,expiresAt:record.expiresAt,listed:record.listed,platformFeeBps:record.feeBps};
  ensure(sha256(stringToHex(JSON.stringify(terms))).toLowerCase()===bounty.termsHash.toLowerCase(),'TERMS_MISMATCH');
}
export async function verifySettlementReceipt(client, hash, record, payload, amounts) {
  const receipt=await finalizedReceipt(client,hash), event=matchingEvent(receipt,'AttemptSettled');
  ensure(event.bountyId.toString()===payload.bountyId && event.attemptNonce.toString()===payload.attemptNonce && event.challenger.toLowerCase()===record.challengerAddress.toLowerCase() && event.outcome===payload.outcome && event.resultHash.toLowerCase()===payload.resultHash.toLowerCase(),'EVENT_MISMATCH');
  ensure(event.winnerPayout.toString()===amounts.winnerPayout && event.platformFee.toString()===amounts.platformFee && event.creatorEntry.toString()===amounts.creatorEntry,'AMOUNT_MISMATCH');
  return receipt;
}
