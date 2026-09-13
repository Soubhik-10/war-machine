import { authenticate, serviceCall, reply, safeError } from './auth.mjs';
import { canonical, digest, ensure, evaluate, quorum } from './protocol.mjs';
import { publicClient, verifySettlementReceipt } from './chain.mjs';
import { CLIENT_ENGINE_HASH } from '../dist/release.mjs';

export const configured = env => !!(env.SIGNER_A?.fetch && env.SIGNER_B?.fetch && env.RELAY?.fetch && env.SIGNER_A_AUTH?.get && env.SIGNER_B_AUTH?.get && env.RELAY_AUTH?.get);
export async function control(env) {
  const row=await env.DB.prepare('SELECT * FROM settlement_control WHERE id=1').first();
  return {paused:env.WM_EMERGENCY_PAUSE==='true' || !row || !!row.paused,heartbeat:row?.heartbeat || 0};
}
export async function ready(env) {
  if(!configured(env)) return false;
  const value=await control(env);
  return !value.paused && Date.now()-value.heartbeat<90000;
}
export async function storedRecord(db, attempt) {
  const row=await db.prepare('SELECT match_record,settlement_payload FROM attempts WHERE id=?').bind(attempt).first();
  ensure(row?.match_record && row?.settlement_payload,'INVALID_PAYLOAD');
  const full=JSON.parse(row.settlement_payload);
  const {bountyId,attemptNonce,outcome,resultHash,validUntil}=full;
  return {record:JSON.parse(row.match_record),payload:{bountyId,attemptNonce,outcome,resultHash,validUntil},signatures:full.signatures || []};
}
export async function materializeResult(db, attempt, time=Date.now()) {
  const row=await db.prepare('SELECT match_record,settlement_payload FROM attempts WHERE id=?').bind(attempt).first();
  ensure(row?.match_record,'INVALID_PAYLOAD');
  if(row.settlement_payload) return;
  const verified=evaluate(JSON.parse(row.match_record),time);
  const settlement={...verified.payload,signatures:[]};
  await db.prepare("UPDATE attempts SET result=?,settlement_payload=?,status='awaiting-signatures',updated=? WHERE id=? AND settlement_payload IS NULL").bind(JSON.stringify({...verified.result,settlement}),JSON.stringify(settlement),time,attempt).run();
}
const audit = (db,attempt,actor,event) => db.prepare('INSERT INTO settlement_audit(attempt,actor,event,created) VALUES(?,?,?,?)').bind(attempt,actor,event,Date.now()).run();
export async function internalRoute(request,env,run) {
  const {caller,body}=await authenticate(request,env.DB,{
    'signer-a':env.SIGNER_A_API_AUTH,'signer-b':env.SIGNER_B_API_AUTH,relay:env.RELAY_API_AUTH,operator:env.OPERATOR_AUTH,scheduler:env.SCHEDULER_AUTH,monitor:env.MONITOR_AUTH,
  },'api');
  const path=new URL(request.url).pathname;
  if(path.endsWith('/control')) return reply(await control(env));
  if(path.endsWith('/record')) {
    ensure(['signer-a','signer-b','relay'].includes(caller));
    return reply({...await storedRecord(env.DB,body.attempt),...await control(env)});
  }
  ensure(caller==='operator' || caller==='scheduler' || caller==='monitor' && path.endsWith('/metrics'),'UNAUTHORIZED');
  if(path.endsWith('/tick')) { await run(); return reply({ok:true}); }
  ensure(caller==='operator' || caller==='monitor' && path.endsWith('/metrics'),'UNAUTHORIZED');
  if(path.endsWith('/pause')) {
    ensure(typeof body.paused==='boolean');
    await env.DB.prepare('UPDATE settlement_control SET paused=? WHERE id=1').bind(body.paused?1:0).run();
    await audit(env.DB,null,body.operator || caller,body.paused?'paused':'resumed');
    return reply(await control(env));
  }
  if(path.endsWith('/retry')) {
    await env.DB.prepare("UPDATE settlement_jobs SET next_run=0 WHERE attempt=? AND state NOT IN ('complete','timeout')").bind(body.attempt).run();
    await audit(env.DB,body.attempt,body.operator || caller,'retry-requested'); return reply({ok:true});
  }
  if(path.endsWith('/audit')) return reply((await env.DB.prepare('SELECT * FROM settlement_audit ORDER BY id DESC LIMIT 50').all()).results);
  if(path.endsWith('/metrics')) {
    const rows=(await env.DB.prepare('SELECT state,COUNT(*) AS count,MIN(created) AS oldest FROM settlement_jobs GROUP BY state').all()).results;
    const legacy=await env.DB.prepare("SELECT COUNT(*) AS count FROM attempts WHERE match_record IS NULL AND status IN ('awaiting-signatures','ready-to-settle')").first();
    const state=await control(env);
    return reply({...state,jobs:rows,alerts:{heartbeatStale:Date.now()-state.heartbeat>90000,backlog:rows.some(x=>!['complete','timeout'].includes(x.state)&&Date.now()-x.oldest>60000),timeouts:rows.some(x=>x.state==='timeout'),legacyUnverified:legacy.count>0}});
  }
  ensure(false,'INVALID_PAYLOAD');
}

export async function processJob(env, job, adapters, time=Date.now()) {
  const db=env.DB, lease=crypto.randomUUID();
  const acquired=await db.prepare("UPDATE settlement_jobs SET lease=?,lease_until=?,tries=tries+1 WHERE attempt=? AND lease_until<=? AND state!='complete'").bind(lease,time+120000,job.attempt,time).run();
  if(acquired.meta.changes!==1) return;
  const update=async(state,hash,error,next=0)=>{
    await db.prepare('UPDATE settlement_jobs SET state=?,tx_hash=COALESCE(?,tx_hash),error_code=?,next_run=?,lease=NULL,lease_until=0,updated=? WHERE attempt=? AND lease=?').bind(state,hash,error,next,Date.now(),job.attempt,lease).run();
    await audit(db,job.attempt,'coordinator',error || state);
  };
  try {
    await materializeResult(db,job.attempt,time);
    const data=await storedRecord(db,job.attempt);
    // Reconciliation is attempted even after expiry or pause: an earlier broadcast
    // may already have succeeded. Never infer a failed payment from wall-clock time.
    let hash=job.tx_hash;
    if(data.signatures.length===2) {
      try { hash=(await adapters.relay(job.attempt)).hash; } catch(error) {
        if(hash) { /* an existing durable hash can be verified despite relay outage */ }
        else {
        if(time<data.record.deadline*1000) throw error;
        // An unavailable relayer leaves the outcome unknown, including at timeout.
        await update('timeout',null,'DEADLINE_ELAPSED_UNCONFIRMED',time+60000); return;
        }
      }
    }
    if(hash) {
      await db.prepare('UPDATE settlement_jobs SET tx_hash=? WHERE attempt=? AND lease=?').bind(hash,job.attempt,lease).run();
      const verified=evaluate(data.record,Math.min(time,data.record.deadline*1000-1));
      ensure(canonical(verified.payload)===canonical(data.payload),'PAYLOAD_MISMATCH');
      await adapters.verify(hash,data.record,data.payload,verified.amounts);
      await adapters.confirm(job.attempt,hash);
      await update('complete',hash,null); return;
    }
    if(time>=data.record.deadline*1000) { await update('timeout',null,'DEADLINE_ELAPSED_UNCONFIRMED',time+60000); return; }
    ensure(!(await control(env)).paused,'PAUSED');
    const signatures=await adapters.sign(job.attempt);
    await adapters.attest(job.attempt,signatures);
    // Durable accepted signatures allow recovery if the relay's response is lost.
    const sent=await adapters.relay(job.attempt);
    await update('confirming',sent.hash,null,time+5000);
  } catch(error) {
    const code=safeError(error), delay=Math.min(30000,1000*2**Math.min(job.tries,5));
    await update(code==='EXPIRED'?'timeout':job.tx_hash?'confirming':'retry',null,code,time+delay);
  }
}

export async function tick(env, adapters) {
  if(!configured(env)) return;
  if(adapters.adoptLegacy) await adapters.adoptLegacy();
  const services=[['SIGNER_A','SIGNER_A_AUTH','signer-a'],['SIGNER_B','SIGNER_B_AUTH','signer-b'],['RELAY','RELAY_AUTH','relay']];
  const health=await Promise.allSettled(services.map(([binding,key,audience])=>serviceCall(env[binding],env[key],'coordinator',audience,'/health',{})));
  const healthy=health.every(x=>x.status==='fulfilled'&&x.value.ok) && health.slice(0,2).every(x=>x.value.engineHash===CLIENT_ENGINE_HASH) && health[0].value?.address?.toLowerCase()!==health[1].value?.address?.toLowerCase();
  await env.DB.prepare('UPDATE settlement_control SET heartbeat=? WHERE id=1').bind(healthy?Date.now():0).run();
  // Auto-finalize expired construction windows; simulation failure is never a fabricated refund.
  const expired=(await env.DB.prepare("SELECT id,account FROM attempts WHERE status='engineering' AND build_deadline<=? ORDER BY build_deadline LIMIT 10").bind(Date.now()).all()).results;
  if(!(await control(env)).paused) for(const attempt of expired) {
    try { await adapters.forfeit(attempt); } catch { /* contract timeout remains visible */ }
  }
  const jobs=(await env.DB.prepare("SELECT * FROM settlement_jobs WHERE state!='complete' AND next_run<=? AND lease_until<=? ORDER BY next_run,created LIMIT 10").bind(Date.now(),Date.now()).all()).results;
  const calls={...adapters,
    sign:async attempt=>{
      const results=await Promise.all(services.slice(0,2).map(([binding,key,audience])=>serviceCall(env[binding],env[key],'coordinator',audience,'/sign',{attempt})));
      const data=await storedRecord(env.DB,attempt);
      return quorum(data.payload,results.map(x=>x.signature),JSON.parse(env.SIGNER_ADDRESSES));
    },
    relay:attempt=>serviceCall(env.RELAY,env.RELAY_AUTH,'coordinator','relay','/relay',{attempt}),
    verify:(hash,record,payload,amounts)=>verifySettlementReceipt(publicClient(env),hash,record,payload,amounts),
  };
  for(const job of jobs) await processJob(env,job,calls);
}
