import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { encodeEventTopics, encodeAbiParameters, sha256, stringToHex, createWalletClient, custom, keccak256, decodeFunctionData } from 'viem';
import { tempo } from 'viem/chains';
import { Transaction } from 'viem/tempo';
import { canonical, evaluate, verifyPayload, digest, typedData, quorum, ABI, ESCROW } from '../settlement/protocol.mjs';
import { authenticate, serviceCall } from '../settlement/auth.mjs';
import { processJob, materializeResult } from '../settlement/coordinator.mjs';
import { verifySettlementReceipt } from '../settlement/chain.mjs';
import { paymentStatus, paymentPanel } from '../dist/payment-status.mjs';
import { broadcastPrepared, resumeBroadcast } from '../settlement/relay-journal.mjs';
import { signRecord } from '../settlement/signer.mjs';
import { relayFetch } from '../settlement/relay-service.mjs';
import { packChallenge, PRESETS, clone } from '../dist/data.mjs';
import { CLIENT_ENGINE_HASH } from '../dist/release.mjs';

class D1 {
  constructor(){this.sqlite=new DatabaseSync(':memory:');for(const name of ['0000_war_machines','0001_tempo_mainnet','0002_direct_escrow','0003_paid_reveal','0005_automatic_settlement'])this.sqlite.exec(readFileSync(new URL('../drizzle/'+name+'.sql',import.meta.url),'utf8'));}
  prepare(sql){const statement=this.sqlite.prepare(sql);let args=[];const wrapper={bind(...values){args=values;return wrapper;},async first(){return statement.get(...args)||null;},async all(){return {results:statement.all(...args)};},async run(){return {meta:{changes:Number(statement.run(...args).changes)}};}};return wrapper;}
  async batch(statements){this.sqlite.exec('BEGIN');try{const out=[];for(const statement of statements)out.push(await statement.run());this.sqlite.exec('COMMIT');return out;}catch(error){this.sqlite.exec('ROLLBACK');throw error;}}
}
const now=Date.now(), creator='0x'+'11'.repeat(20), challengerAddress='0x'+'22'.repeat(20),txHash='0x'+'ab'.repeat(32);
function record(overrides={}) {return {version:1,engineHash:CLIENT_ENGINE_HASH,chainId:4217,escrow:ESCROW,attemptId:randomUUID(),bountyId:'7',attemptNonce:'1',creator,challengerAddress,title:'Fixture',listed:true,expiresAt:0,reward:'1000001',entry:'10000',feeBps:250,defender:packChallenge(PRESETS[0],'foundry',0),challenger:packChallenge(PRESETS[1],'foundry',0),seed:1,reason:'battle',entryTx:'0x'+'cd'.repeat(32),deadline:Math.floor(now/1000)+600,buildDeadline:now+300000,committedAt:now,...overrides};}
function fixture(t,r=record()) {const DB=new D1();t.after(()=>DB.sqlite.close());DB.sqlite.prepare('INSERT INTO accounts(id,token_hash,name,balance,created) VALUES(?,?,?,?,?)').run('a','h','Fixture',0,now);DB.sqlite.prepare('INSERT INTO bounties(id,owner,title,blueprint,entry,reward,status,listed,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)').run('b','a','Fixture','{}',0,0,'busy',1,now,now);DB.sqlite.prepare('INSERT INTO attempts(id,bounty,account,blueprint,seed,status,created,updated,build_deadline) VALUES(?,?,?,?,?,?,?,?,?)').run(r.attemptId,'b','a',JSON.stringify(r.challenger),r.seed,'queued',now,now,r.buildDeadline);DB.sqlite.prepare('UPDATE attempts SET match_record=? WHERE id=?').run(JSON.stringify(r),r.attemptId);DB.sqlite.prepare('UPDATE settlement_control SET paused=0').run();return {DB,env:{DB},r,job:()=>DB.sqlite.prepare('SELECT * FROM settlement_jobs WHERE attempt=?').get(r.attemptId)};}
const failure=code=>Object.assign(Error(code),{code});

test('canonical hashing is key-order invariant, finite and binds amounts, identities, chain and expiry',()=>{
  const r=record(),v=evaluate(r,now);
  assert.equal(digest(r),digest(Object.fromEntries(Object.entries(r).reverse())));
  for(const patch of [{reward:'1000002'},{entry:'10001'},{challengerAddress:creator},{attemptNonce:'2'},{deadline:r.deadline+1}])assert.throws(()=>verifyPayload({...r,...patch},v.payload,now),/MISMATCH/);
  for(const patch of [{chainId:1},{feeBps:0},{seed:NaN},{engineHash:'bad'}])assert.throws(()=>verifyPayload({...r,...patch},v.payload,now));
  assert.throws(()=>canonical({number:Infinity}));
});
test('independent replay verifies win, loss and draw with exact integer payouts',()=>{
  const r=record(),win=evaluate(r,now);assert.equal(win.result.outcome,'win');assert.equal(win.amounts.winnerPayout,'975001');assert.equal(win.amounts.platformFee,'25000');
  const loss=evaluate(record({challenger:r.defender,defender:r.challenger}),now);assert.equal(loss.result.outcome,'loss');assert.equal(loss.amounts.winnerPayout,'0');
  const passive=clone(PRESETS[0]);passive.modules=[{id:'core',x:4,y:4,z:0,r:0},{id:'hover',x:3,y:4,z:0,r:0},{id:'ram',x:5,y:4,z:0,r:2}];passive.tactic='kite';passive.range=600;
  const blueprint=packChallenge(passive,'foundry',0);
  const draw=evaluate(record({challenger:blueprint,defender:blueprint}),now);assert.equal(draw.result.outcome,'draw');assert.equal(draw.payload.outcome,1);assert.equal(draw.amounts.creatorEntry,'10000');
});
test('invalid payload, bad result hash, expired signature and duplicate authorities are rejected',async()=>{
  const r=record(),{payload}=evaluate(r,now),one=privateKeyToAccount(generatePrivateKey()),two=privateKeyToAccount(generatePrivateKey());
  assert.throws(()=>verifyPayload(r,{...payload,outcome:2},now),/MISMATCH/);
  assert.throws(()=>verifyPayload(r,{...payload,resultHash:txHash},now),/MISMATCH/);
  assert.throws(()=>verifyPayload(r,payload,r.deadline*1000),/EXPIRED/);
  const signatures=await Promise.all([one,two].map(a=>a.signTypedData(typedData(payload))));
  assert.equal((await quorum(payload,signatures,[one.address,two.address])).length,2);
  await assert.rejects(quorum(payload,[signatures[0],signatures[0]],[one.address,two.address]),/QUORUM/);
  await assert.rejects(quorum({...payload,validUntil:payload.validUntil+1},signatures,[one.address,two.address]),/QUORUM/);
});
test('immutable commitment atomically enqueues once and survives worker restart before result production',async t=>{
  const f=fixture(t);assert.equal(f.job().state,'queued');
  assert.throws(()=>f.DB.sqlite.prepare('UPDATE attempts SET seed=3 WHERE id=?').run(f.r.attemptId),/immutable/);
  assert.throws(()=>f.DB.sqlite.prepare('DELETE FROM attempts WHERE id=?').run(f.r.attemptId),/immutable/);
  await materializeResult(f.DB,f.r.attemptId,now);await materializeResult(f.DB,f.r.attemptId,now);
  assert.equal(f.DB.sqlite.prepare('SELECT count(*) AS n FROM settlement_jobs').get().n,1);
});
test('duplicate jobs and repeated settlement confirm exactly once after finality',async t=>{
  const f=fixture(t);let signed=0,confirmed=0,verified=0;
  const adapters={sign:async()=>{signed++;return [];},attest:async()=>{},relay:async()=>({hash:txHash}),verify:async()=>{verified++;},confirm:async()=>{confirmed++;}};
  await Promise.all([processJob(f.env,f.job(),adapters,now),processJob(f.env,f.job(),adapters,now)]);
  assert.equal(signed,1);assert.equal(confirmed,0);assert.equal(f.job().state,'confirming');
  await processJob(f.env,f.job(),adapters,now+6000);await processJob(f.env,f.job(),adapters,now+7000);
  assert.equal(verified,1);assert.equal(confirmed,1);assert.equal(f.job().state,'complete');
});
for(const stage of ['signer outage','relay failure','finality pending'])test(stage+' retries without marking payout complete',async t=>{
  const f=fixture(t);let confirms=0;
  if(stage==='finality pending')f.DB.sqlite.prepare('UPDATE settlement_jobs SET tx_hash=?').run(txHash);
  const adapters={sign:async()=>{if(stage==='signer outage')throw failure('SERVICE_UNAVAILABLE');return [];},attest:async()=>{},relay:async()=>{throw failure('SERVICE_UNAVAILABLE');},verify:async()=>{throw failure('FINALITY_PENDING');},confirm:async()=>{confirms++;}};
  await processJob(f.env,f.job(),adapters,now);assert.equal(confirms,0);assert.ok(['retry','confirming'].includes(f.job().state));assert.ok(f.job().next_run>now);
});
test('timeout never invents a refund and a late receipt can still reconcile an earlier transaction',async t=>{
  const f=fixture(t);await materializeResult(f.DB,f.r.attemptId,now);
  let confirmed=0;const adapters={sign:async()=>{throw Error('must not sign');},verify:async()=>{},confirm:async()=>{confirmed++;}};
  await processJob(f.env,f.job(),adapters,f.r.deadline*1000+1);assert.equal(f.job().state,'timeout');assert.equal(confirmed,0);
  f.DB.sqlite.prepare('UPDATE settlement_jobs SET tx_hash=?').run(txHash);
  await processJob(f.env,f.job(),adapters,f.r.deadline*1000+61000);assert.equal(f.job().state,'complete');assert.equal(confirmed,1);
  const status=paymentStatus({payment:{state:'timeout'},result:{outcome:'win'}});assert.equal(status.label,'Settlement timed out');assert.match(status.detail,/No payout or refund is confirmed/);
});
test('global pause blocks new signatures but permits receipt reconciliation',async t=>{
  const f=fixture(t);f.DB.sqlite.prepare('UPDATE settlement_control SET paused=1').run();let calls=0;
  const adapters={sign:async()=>{calls++;},verify:async()=>{},confirm:async()=>{calls++;}};
  await processJob(f.env,f.job(),adapters,now);assert.equal(calls,0);assert.equal(f.job().error_code,'PAUSED');
  f.DB.sqlite.prepare('UPDATE settlement_jobs SET tx_hash=?').run(txHash);
  await processJob(f.env,f.job(),adapters,now+6000);assert.equal(calls,1);
});
test('receipt validation checks finality, canonical block, event identity and every exact amount',async()=>{
  const r=record(),{payload,amounts}=evaluate(r,now);
  const event={address:ESCROW,topics:encodeEventTopics({abi:ABI,eventName:'AttemptSettled',args:{bountyId:7n,attemptNonce:1n,challenger:challengerAddress}}),data:encodeAbiParameters([{type:'uint8'},{type:'bytes32'},{type:'uint128'},{type:'uint128'},{type:'uint128'}],[payload.outcome,payload.resultHash,BigInt(amounts.winnerPayout),BigInt(amounts.platformFee),BigInt(amounts.creatorEntry)])};
  let finalized=9n,canonicalHash=txHash;
  const client={getChainId:async()=>4217,getTransactionReceipt:async()=>({status:'success',blockNumber:10n,blockHash:txHash,logs:[event]}),getBlock:async arg=>arg.blockTag?{number:finalized}:{hash:canonicalHash}};
  await assert.rejects(verifySettlementReceipt(client,txHash,r,payload,amounts),/FINALITY/);
  finalized=10n;canonicalHash='wrong';await assert.rejects(verifySettlementReceipt(client,txHash,r,payload,amounts),/FINALITY/);
  canonicalHash=txHash;await verifySettlementReceipt(client,txHash,r,payload,amounts);
  await assert.rejects(verifySettlementReceipt(client,txHash,r,payload,{...amounts,winnerPayout:'0'}),/AMOUNT/);
  await assert.rejects(verifySettlementReceipt(client,txHash,r,{...payload,attemptNonce:'2'},amounts),/EVENT/);
});
test('service requests bind body, audience, expiry and nonce; replay is rejected',async t=>{
  const f=fixture(t),credential={get:async()=>generatePrivateKey()};const value=generatePrivateKey();credential.get=async()=>value;
  let captured;const binding={fetch:async request=>{captured=request;return Response.json({ok:true});}};
  await serviceCall(binding,credential,'coordinator','signer-a','/sign',{attempt:f.r.attemptId});
  const replay=captured.clone(),expired=captured.clone();
  assert.equal((await authenticate(captured,f.DB,{coordinator:credential},'signer-a')).body.attempt,f.r.attemptId);
  await assert.rejects(authenticate(replay,f.DB,{coordinator:credential},'signer-a'),/REPLAY/);
  await assert.rejects(authenticate(expired,f.DB,{coordinator:credential},'signer-a',Date.now()+60000),/UNAUTHORIZED/);
  await serviceCall(binding,credential,'coordinator','signer-a','/sign',{attempt:f.r.attemptId});
  await assert.rejects(authenticate(captured,f.DB,{coordinator:credential},'relay'),/UNAUTHORIZED/);
});
test('frontend only displays Paid after finality and escapes transaction links',()=>{
  assert.notEqual(paymentStatus({result:{outcome:'win'},payment:{transactionHash:txHash}}).label,'Paid');
  for(const [outcome,label] of [['win','Paid'],['loss','Lost'],['draw','Draw']])assert.equal(paymentStatus({result:{outcome},payment:{finalized:true}}).label,label);
  assert.match(paymentPanel({payment:{transactionHash:txHash}}),/explore.tempo.xyz\/tx\//);
  assert.doesNotMatch(paymentPanel({payment:{transactionHash:'javascript:alert(1)'}}),/javascript:/);
});
test('relay persists before broadcasting and recovers a lost RPC response with identical bytes',async()=>{
  const map=new Map(),storage={get:async key=>map.get(key),put:async(key,value)=>{map.set(key,value);}};
  const sent=[];const client={sendRawTransaction:async({serializedTransaction})=>{assert.ok(map.has('job'));sent.push(serializedTransaction);throw Error('lost response');},getTransactionReceipt:async()=>{throw Error('not mined');}};
  const first=await broadcastPrepared(storage,client,'job','0x1234','payload',null,now);
  await resumeBroadcast(storage,client,{},'job',first,{paused:false,deadline:Math.floor(now/1000)+100,maxFeePerGas:1n},now+1000);
  assert.deepEqual(sent,['0x1234','0x1234']);
  await assert.rejects(broadcastPrepared(storage,client,'job','0xabcd','other',null,now),/MISMATCH/);
});
test('bounded fee replacement preserves canonical call, nonce, amount and destination',async()=>{
  const map=new Map(),storage={get:async key=>map.get(key),put:async(key,value)=>map.set(key,value)};
  const request={to:ESCROW,data:'0x1234',nonce:0,nonceKey:7n,value:0n,maxFeePerGas:100n,maxPriorityFeePerGas:0n};
  const client={sendRawTransaction:async()=>txHash,getTransactionReceipt:async()=>{throw Error('pending');}};
  const first=await broadcastPrepared(storage,client,'job','0x1234','payload',request,now);
  const wallet={signTransaction:async replacement=>{assert.deepEqual({...replacement,maxFeePerGas:100n,maxPriorityFeePerGas:0n},request);assert.ok(replacement.maxFeePerGas<=110n);return '0xabcd';}};
  const updated=await resumeBroadcast(storage,client,wallet,'job',first,{paused:false,deadline:Math.floor(now/1000)+100,maxFeePerGas:110n},now+16000);
  assert.notEqual(updated.hash,first.hash);assert.equal(map.get('job').hashes.length,2);
});
test('separately deployed signers independently read, replay, validate chain terms and refuse equivocation',async t=>{
  const r=record(),value=evaluate(r),credential={get:async()=> 'test-only-ephemeral-auth-'.repeat(3)};
  const entryEvent={address:ESCROW,topics:encodeEventTopics({abi:ABI,eventName:'AttemptEntered',args:{bountyId:7n,attemptNonce:1n,challenger:r.challengerAddress}}),data:encodeAbiParameters([{type:'uint64'}],[BigInt(r.deadline)])};
  const terms=()=>({version:'war-machines-direct-escrow-v2',engineHash:r.engineHash,creator:r.creator,title:r.title,defender:r.defender,entry:r.entry,reward:r.reward,expiresAt:r.expiresAt,listed:r.listed,platformFeeBps:r.feeBps});
  let chainChecks=0,reads=0;
  const client={getChainId:async()=>4217,getTransactionReceipt:async()=>({status:'success',blockNumber:10n,blockHash:txHash,logs:[entryEvent]}),getBlock:async()=>({number:10n,hash:txHash}),readContract:async args=>{chainChecks++;return args.functionName==='isSettlementSigner'?true:{status:2,attemptNonce:1n,attemptDeadline:BigInt(r.deadline),creator:r.creator,challenger:r.challengerAddress,reward:BigInt(r.reward),entry:BigInt(r.entry),termsHash:sha256(stringToHex(JSON.stringify(terms())))};}};
  let payload=value.payload;
  const environments=[];
  for(const id of ['signer-a','signer-b']) {
    const f=fixture(t),key=generatePrivateKey(),account=privateKeyToAccount(key);
    f.DB.sqlite.exec(readFileSync(new URL('../settlement/service-schema.sql',import.meta.url),'utf8').replaceAll('CREATE TABLE ','CREATE TABLE IF NOT EXISTS '));
    const env={DB:f.DB,SERVICE_ID:id,SIGNER_ADDRESS:account.address,SIGNING_KEY:{get:async()=>key},API_AUTH:credential,
      API:{fetch:async request=>{reads++;await authenticate(request,f.DB,{[id]:credential},'api');return Response.json(new URL(request.url).pathname.endsWith('/record')?{record:r,payload,paused:false}:{paused:false});}}};
    environments.push(env);
  }
  const signed=await Promise.all(environments.map(env=>signRecord(env,r.attemptId,{client})));
  assert.equal((await quorum(payload,signed.map(x=>x.signature),signed.map(x=>x.address))).length,2);
  assert.equal(reads,4);assert.equal(chainChecks,4);
  // Exercise the actual authenticated relay handler with both independently produced signatures.
  const relayDb=fixture(t).DB;
  relayDb.sqlite.exec(readFileSync(new URL('../settlement/service-schema.sql',import.meta.url),'utf8').replaceAll('CREATE TABLE ','CREATE TABLE IF NOT EXISTS '));
  const relayKey=generatePrivateKey(),relayAccount=privateKeyToAccount(relayKey),map=new Map(),sent=[];
  const storage={get:async key=>map.get(key),put:async(key,value)=>map.set(key,value)};
  const actualWallet=createWalletClient({account:relayAccount,chain:tempo,transport:custom({request:async({method})=>{
    if(method==='eth_chainId') return '0x1079';
    throw Error('Unexpected test-wallet RPC '+method);
  }})});
  const wallet={signTransaction:actualWallet.signTransaction,prepareTransactionRequest:async request=>({...request,gas:300000n,maxFeePerGas:100000000000n,maxPriorityFeePerGas:0n})};
  const relayClient={...client,getContractEvents:async()=>[],sendRawTransaction:async({serializedTransaction})=>{sent.push(serializedTransaction);return keccak256(serializedTransaction);},readContract:async args=>args.functionName==='settlementQuorum'?2:args.functionName==='balanceOf'?10000000n:client.readContract(args)};
  const relayEnv={DB:relayDb,RELAY_KEY:{get:async()=>relayKey},RELAY_ADDRESS:relayAccount.address,COORDINATOR_AUTH:credential,API_AUTH:credential,MAX_FEE_PER_GAS:'100000000000',SIGNER_ADDRESSES:JSON.stringify(signed.map(x=>x.address)),API:{fetch:async request=>{await authenticate(request,relayDb,{relay:credential},'api');return Response.json(new URL(request.url).pathname.endsWith('/record')?{record:r,payload,signatures:signed.map(x=>x.signature),paused:false}:{paused:false});}}};
  const relayBinding={fetch:request=>relayFetch(request,relayEnv,storage,{client:relayClient,wallet})};
  assert.equal((await serviceCall(relayBinding,credential,'coordinator','relay','/health',{})).ok,true);
  const relayed=await serviceCall(relayBinding,credential,'coordinator','relay','/relay',{attempt:r.attemptId});
  assert.equal(relayed.hash,keccak256(sent[0]));assert.equal(sent.length,1);
  const transaction=Transaction.deserialize(sent[0]);assert.equal(transaction.calls[0].to.toLowerCase(),ESCROW.toLowerCase());
  const decoded=decodeFunctionData({abi:ABI,data:transaction.calls[0].data});assert.equal(decoded.functionName,'settleAttempt');assert.equal(decoded.args[0].resultHash,payload.resultHash);assert.equal(decoded.args[1].length,2);
  assert.equal((await serviceCall(relayBinding,credential,'coordinator','relay','/relay',{attempt:r.attemptId})).hash,relayed.hash);assert.equal(sent.length,1);
  const first=await signRecord(environments[0],r.attemptId,{client});assert.equal(first.signature,signed[0].signature);
  payload={...payload,resultHash:txHash};await assert.rejects(signRecord(environments[1],r.attemptId,{client}),/MISMATCH/);
  r.reward='2000000';payload=evaluate(r).payload;await assert.rejects(signRecord(environments[0],r.attemptId,{client}),/EQUIVOCATION/);
});
