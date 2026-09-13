import { privateKeyToAccount } from 'viem/accounts';
import { authenticate, serviceCall, secret, reply, safeError } from './auth.mjs';
import { ABI, ESCROW, digest, ensure, typedData, verifyPayload } from './protocol.mjs';
import { publicClient, validateMatchOnChain } from './chain.mjs';
import { CLIENT_ENGINE_HASH } from '../dist/release.mjs';

export async function signRecord(env, attempt, dependencies={}) {
  const data=await serviceCall(env.API,env.API_AUTH,env.SERVICE_ID,'api','/api/internal/settlement/record',{attempt});
  ensure(!data.paused && env.WM_EMERGENCY_PAUSE!=='true','PAUSED');
  verifyPayload(data.record,data.payload);
  const client=dependencies.client || publicClient(env);
  await validateMatchOnChain(client,data.record);
  const account=privateKeyToAccount(await secret(env.SIGNING_KEY));
  ensure(account.address.toLowerCase()===env.SIGNER_ADDRESS.toLowerCase(),'SIGNER_CONFIGURATION');
  ensure(await client.readContract({address:ESCROW,abi:ABI,functionName:'isSettlementSigner',args:[account.address]}),'SIGNER_CONFIGURATION');
  const matchKey=ESCROW+':'+data.record.bountyId+':'+data.record.attemptNonce;
  const recordHash=digest(data.record), payloadHash=digest(data.payload);
  await env.DB.prepare('INSERT OR IGNORE INTO signer_decisions(match_key,record_hash,payload_hash,created) VALUES(?,?,?,?)').bind(matchKey,recordHash,payloadHash,Date.now()).run();
  const decision=await env.DB.prepare('SELECT * FROM signer_decisions WHERE match_key=?').bind(matchKey).first();
  ensure(decision.record_hash===recordHash && decision.payload_hash===payloadHash,'EQUIVOCATION');
  // Recheck global pause immediately before a signing operation; no caller can supply bytes to sign.
  const control=await serviceCall(env.API,env.API_AUTH,env.SERVICE_ID,'api','/api/internal/settlement/control',{});
  ensure(!control.paused,'PAUSED');
  const signature=decision.signature || await account.signTypedData(typedData(data.payload));
  await env.DB.batch([
    env.DB.prepare('UPDATE signer_decisions SET signature=? WHERE match_key=? AND signature IS NULL').bind(signature,matchKey),
    env.DB.prepare('INSERT INTO service_audit(attempt,event,created) VALUES(?,?,?)').bind(attempt,'signed',Date.now()),
  ]);
  return {signature,address:account.address,payloadHash};
}
export default {async fetch(request,env) {
  try {
    const {body}=await authenticate(request,env.DB,{coordinator:env.COORDINATOR_AUTH},env.SERVICE_ID);
    const path=new URL(request.url).pathname;
    if(path==='/health') {
      const account=privateKeyToAccount(await secret(env.SIGNING_KEY));
      ensure(account.address.toLowerCase()===env.SIGNER_ADDRESS.toLowerCase(),'SIGNER_CONFIGURATION');
      const client=publicClient(env);
      ensure(await client.getChainId()===4217,'CHAIN_MISMATCH');
      ensure(await client.readContract({address:ESCROW,abi:ABI,functionName:'isSettlementSigner',args:[account.address]}),'SIGNER_CONFIGURATION');
      return reply({ok:env.WM_EMERGENCY_PAUSE!=='true',address:account.address,engineHash:CLIENT_ENGINE_HASH});
    }
    ensure(path==='/sign' && Object.keys(body).join(',')==='attempt' && /^[a-f0-9-]{36}$/.test(body.attempt));
    return reply(await signRecord(env,body.attempt));
  } catch(error) { return reply({error:safeError(error)},503); }
}};
