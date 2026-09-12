import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {privateKeyToAccount} from 'viem/accounts';
import {runtimeConfig,amountToUnits,unitsToAmount,TEMPO_MAINNET} from '../server/runtime-config.mjs';
import {Store} from '../server/store.mjs';
import {packChallenge,PRESETS} from '../dist/data.mjs';
import {startServer} from '../server.mjs';

const privateKey='0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const signer=privateKeyToAccount(privateKey);
const platform='0x0000000000000000000000000000000000000001';
const payment={mode:'tempo-mainnet',environment:'tempo-mainnet',paymentsEnabled:true,network:TEMPO_MAINNET,escrowRecipient:signer.address,entryRecipient:signer.address,platformRecipient:platform,maxOperationUnits:1_000_000_000n,maxOutstandingUnits:2_000_000_000n};
const body=(reward=100)=>({title:'Funded fixture',blueprint:packChallenge(PRESETS[0],'foundry',0),entry:10,reward,maxPlatformFeeBps:250,hours:1,listed:true});

test('mainnet configuration is fail-closed and binds the dedicated ledger, signer, network and ceilings',()=>{
 assert.throws(()=>runtimeConfig({WM_MODE:'tempo-mainnet'}),/locked/);
 const env={WM_MODE:'tempo-mainnet',WM_MAINNET_ENABLE:'tempo-mainnet-real-funds',WM_LEGAL_REVIEWED:'true',WM_PUBLIC_ORIGIN:'https://arena.example',DATABASE_PATH:'var/war-machines.mainnet.sqlite',WM_LEDGER_NAMESPACE:`tempo-mainnet:4217:${TEMPO_MAINNET.token.toLowerCase()}`,TEMPO_ESCROW_RECIPIENT:signer.address,TEMPO_ENTRY_RECIPIENT:signer.address,TEMPO_PLATFORM_RECIPIENT:platform,TEMPO_ESCROW_PRIVATE_KEY:privateKey,MPP_SECRET_KEY:'x'.repeat(32),WM_MAX_OPERATION_UNITS:'1000000000',WM_MAX_OUTSTANDING_UNITS:'2000000000'};
 const config=runtimeConfig(env,{root:process.cwd()});assert.equal(config.network.chainId,4217);assert.equal(config.network.decimals,6);assert.equal(config.signer.address,signer.address);assert.equal(config.origin,'https://arena.example');
 assert.throws(()=>runtimeConfig({...env,TEMPO_ENTRY_RECIPIENT:platform},{root:process.cwd()}),/entry fees to enter escrow/);
 assert.throws(()=>runtimeConfig({...env,WM_LEDGER_NAMESPACE:'wrong'},{root:process.cwd()}),/WM_LEDGER_NAMESPACE/);
});

test('token amount conversion never uses floating point and preserves six decimal places',()=>{
 for(const value of ['0','0.000001','1','1.025','999999999.999999'])assert.equal(unitsToAmount(amountToUnits(value)),value.replace(/\.0+$/,''));
 assert.throws(()=>amountToUnits('0.0000001'),/at most 6/);
});

test('mainnet HTTP surface publishes a domain-bound SIWE challenge and truthful payment discovery',async t=>{
 const config={...payment,database:':memory:',origin:'https://arena.example',mppSecret:'x'.repeat(32),signer,quoteTtlSeconds:180};
 const app=await startServer({port:0,database:':memory:',seed:false,workers:false,config});t.after(()=>app.close());
 const response=await fetch(app.url+'/api/auth/challenge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chainId:4217})}),challenge=await response.json();assert.equal(response.status,200);assert.match(challenge.message,/arena\.example wants you to sign in/);assert.match(challenge.message,/Chain ID: 4217/);
 const discovery=await (await fetch(app.url+'/.well-known/war-machines.json')).json();assert.equal(discovery.payments.enabled,true);assert.equal(discovery.payments.token,TEMPO_MAINNET.token);assert.equal(discovery.authentication.wallet.verify,'/api/auth/verify');
});

test('paid bounty accounting keeps confirmed incoming funds separate and sequences winner before platform payout',t=>{
 const s=new Store(':memory:',{seed:false,mode:'tempo-mainnet',environment:'tempo-mainnet',payment});t.after(()=>s.close());
 const owner=s.provisionIdentity({scheme:'tempo',chain:'4217',network:'tempo-mainnet',address:'0x0000000000000000000000000000000000000010'}).account;
 const entrant=s.provisionIdentity({scheme:'tempo',chain:'4217',network:'tempo-mainnet',address:'0x0000000000000000000000000000000000000020'}).account;
 const bounty=s.create({account:owner,role:'owner'},body(),randomUUID(),false,'funding-proof');
 assert.equal(s.db.prepare("SELECT amount_units,status FROM financial_operations WHERE kind='reward-funded'").get().amount_units,'100000000');
 const entry={blueprint:packChallenge(PRESETS[1],'foundry',0,bounty.blueprint.q),maxEntry:10,maxPlatformFeeBps:250},hold=s.preparePaidAttempt({account:entrant,role:'owner'},bounty.id,entry,randomUUID(),180),accepted=s.acceptPaidAttempt({account:entrant,role:'owner'},hold.id,'entry-proof');
 assert.equal(accepted.accepted,true);const job=s.claim();assert.equal(job.id,accepted.attempt.id);s.finish(job,{winner:0,time:10,seed:job.seed,integrity:[1,0],damage:[1,0],mode:'auto',reason:'fixture'});
 const payouts=s.paymentStatus(job.id);assert.deepEqual(payouts.map(x=>[x.kind,x.amountUnits,x.status]),[['winner-payout','97500000','requested'],['platform-fee','2500000','requested']]);
 assert.equal(s.nextFinancial().kind,'winner-payout');s.markFinancial(payouts[0].id,'confirmed','0xwinner');assert.equal(s.nextFinancial().kind,'platform-fee');
});

test('a paid quote locks one slot before payment and an expired paid retry records exactly one refund',t=>{
 let now=1_000_000;const s=new Store(':memory:',{seed:false,mode:'tempo-mainnet',environment:'tempo-mainnet',payment,now:()=>now});t.after(()=>s.close());
 const owner=s.provisionIdentity({scheme:'tempo',chain:'4217',network:'tempo-mainnet',address:'0x0000000000000000000000000000000000000030'}).account;
 const entrant=s.provisionIdentity({scheme:'tempo',chain:'4217',network:'tempo-mainnet',address:'0x0000000000000000000000000000000000000040'}).account;
 const other=s.provisionIdentity({scheme:'tempo',chain:'4217',network:'tempo-mainnet',address:'0x0000000000000000000000000000000000000050'}).account;
 const bounty=s.create({account:owner,role:'owner'},body(),randomUUID(),false,'funding-proof'),entry={blueprint:packChallenge(PRESETS[1],'foundry',0,bounty.blueprint.q),maxEntry:10,maxPlatformFeeBps:250},hold=s.preparePaidAttempt({account:entrant,role:'owner'},bounty.id,entry,randomUUID(),30);
 assert.throws(()=>s.preparePaidAttempt({account:other,role:'owner'},bounty.id,entry,randomUUID(),30),/busy/);now=hold.expires+1;const late=s.acceptPaidAttempt({account:entrant,role:'owner'},hold.id,'late-proof');assert.equal(late.refundRequired,true);assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM financial_operations WHERE kind='entry-refund'").get().n,1);assert.throws(()=>s.acceptPaidAttempt({account:entrant,role:'owner'},hold.id,'late-proof'),/not active/);
});

test('delegated agent scopes, contract restrictions and independent reward allowance fail atomically',t=>{
 const s=new Store(':memory:',{seed:false});t.after(()=>s.close());const owner=s.session({name:'Owner'}),creator=s.auth(owner.token),other=s.session({name:'Other'}),bounty=s.create(other.me.id,body(5),randomUUID()),issued=s.agents(creator,{name:'Entrant only',scopes:['read','enter'],contracts:[bounty.id],entryCap:10,spendCap:10,rewardCap:0}),agent=s.auth(issued.token);
 assert.throws(()=>s.create(agent,body(1),randomUUID()),/create scope/);s.accept(agent,bounty.id,{blueprint:packChallenge(PRESETS[1],'foundry',0,bounty.blueprint.q),maxEntry:10,maxPlatformFeeBps:250},randomUUID());assert.equal(s.auth(issued.token).spent,10);assert.throws(()=>s.accept(agent,bounty.id,{blueprint:packChallenge(PRESETS[1],'foundry',0,bounty.blueprint.q),maxEntry:10,maxPlatformFeeBps:250},randomUUID()),/busy|spending limit/);
});

test('paid quotes reserve capacity without consuming agent spend, and only accepted payment consumes it',t=>{
 let now=2_000_000;const s=new Store(':memory:',{seed:false,mode:'tempo-mainnet',environment:'tempo-mainnet',payment,now:()=>now});t.after(()=>s.close());
 const creator=s.newAccount('Creator'),entrant=s.newAccount('Entrant');s.attachIdentity(creator.account,{scheme:'tempo',chain:'4217',network:'tempo-mainnet',address:'0x0000000000000000000000000000000000000060'});s.attachIdentity(entrant.account,{scheme:'tempo',chain:'4217',network:'tempo-mainnet',address:'0x0000000000000000000000000000000000000070'});
 const bounty=s.create({account:creator.account,role:'owner'},body(),randomUUID(),false,'funding-proof'),owner=s.auth(entrant.token),issued=s.agents(owner,{name:'Paid entrant',scopes:['read','enter'],contracts:[bounty.id],entryCap:10,spendCap:10,rewardCap:0}),entry={blueprint:packChallenge(PRESETS[1],'foundry',0,bounty.blueprint.q),maxEntry:10,maxPlatformFeeBps:250};
 let agent=s.auth(issued.token),hold=s.preparePaidAttempt(agent,bounty.id,entry,randomUUID(),30);assert.equal(s.auth(issued.token).spent,0);const accepted=s.acceptPaidAttempt(agent,hold.id,'entry-proof');assert.equal(accepted.accepted,true);assert.equal(s.auth(issued.token).spent,10);
 const second=s.create({account:creator.account,role:'owner'},body(),randomUUID(),false,'funding-proof-2'),issued2=s.agents(owner,{name:'Expiring entrant',scopes:['read','enter'],contracts:[second.id],entryCap:10,spendCap:10,rewardCap:0});agent=s.auth(issued2.token);hold=s.preparePaidAttempt(agent,second.id,{...entry,blueprint:packChallenge(PRESETS[1],'foundry',0,second.blueprint.q)},randomUUID(),30);assert.equal(s.auth(issued2.token).spent,0);now=hold.expires+1;assert.equal(s.acceptPaidAttempt(agent,hold.id,'late-entry-proof').refundRequired,true);assert.equal(s.auth(issued2.token).spent,0);
});
