import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtempSync,readdirSync,unlinkSync,rmdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../server/store.mjs';
import {startServer} from '../server.mjs';
import {PRESETS,packChallenge} from '../dist/data.mjs';
import {creditUnits,rewardQuote,CREDIT_SCALE} from '../dist/economy.mjs';

const body=(extra={})=>({title:'Disclosed fee trial',blueprint:packChallenge(PRESETS[0],'permafrost',0),entry:10,reward:100,hours:1,listed:true,maxPlatformFeeBps:250,...extra});
function fixture(t){const s=new Store(':memory:',{seed:false});t.after(()=>s.close());return {s,owner:s.session({name:'Creator'}),entrant:s.session({name:'Engineer'})};}
const enter=(s,entrant,b,extra={})=>s.accept(entrant.me.id,b.id,{blueprint:b.blueprint,maxEntry:b.entry,maxPlatformFeeBps:b.platformFeeBps,...extra},randomUUID());
const result=(job,winner=0)=>({winner,time:20,seed:job.seed,reason:'verified test',integrity:[.8,.3]});
const conservation=s=>s.db.prepare('SELECT SUM(balance) AS n FROM accounts').get().n/CREDIT_SCALE+s.db.prepare('SELECT COALESCE(SUM(reserve),0) AS n FROM bounties').get().n;

test('2.5% payout is exact, including the smallest and maximum gross reward',()=>{
 for(const [gross,fee,payout] of [[0,0,0],[1,.025,.975],[5,.125,4.875],[100,2.5,97.5],[1000000000,25000000,975000000]]){
  const q=rewardQuote(gross,10);assert.equal(q.platformFee,fee);assert.equal(q.payout,payout);assert.equal(creditUnits(q.payout)+creditUnits(q.platformFee),creditUnits(gross));
 }
 assert.equal(rewardQuote(.001).platformFee,0);assert.equal(rewardQuote(.001).payout,.001); // Always round down, never up.
 assert.throws(()=>creditUnits(.0001));assert.throws(()=>creditUnits(NaN));assert.throws(()=>rewardQuote(1,0,250.5));
});
test('creation and entry reject missing, fractional and too-small fee acknowledgements without debits',t=>{
 const {s,owner,entrant}=fixture(t);
 for(const cap of [undefined,0,249,250.5,10001])assert.throws(()=>s.create(owner.me.id,body({maxPlatformFeeBps:cap}),randomUUID()),/Acknowledge/);
 assert.equal(s.me(owner.me.id).balance,1000);const b=s.create(owner.me.id,body(),randomUUID());
 for(const cap of [undefined,0,249,250.5,10001])assert.throws(()=>enter(s,entrant,b,{maxPlatformFeeBps:cap}),/Platform fee/);
 assert.equal(s.me(entrant.me.id).balance,1000);assert.equal(s.bounty(b.id).status,'open');assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM attempts').get().n,0);
});
test('a verified win pays the winner and platform once, conserving the full reserve',t=>{
 const {s,owner,entrant}=fixture(t),b=s.create(owner.me.id,body(),randomUUID());
 assert.equal(b.payout,97.5);assert.equal(b.netIfWin,87.5);assert.equal(b.platformFee,2.5);assert.equal(b.platformFeeBps,250);
 const a=enter(s,entrant,b),job=s.claim();assert.deepEqual(a.economics,rewardQuote(100,10));s.finish(job,result(job));s.finish(job,result(job));
 const r=s.attempt(a.id).result;assert.equal(r.grossReward,100);assert.equal(r.payout,97.5);assert.equal(r.reward,97.5);assert.equal(r.platformFee,2.5);assert.equal(r.net,87.5);
 assert.equal(s.me(entrant.me.id).balance,1087.5);assert.equal(s.me('platform').balance,2.5);assert.equal(s.me('house').balance,10);assert.equal(conservation(s),2000);
 assert.equal(s.ledger('platform').filter(l=>l.kind==='platform-fee').length,1);assert.equal(s.ledger(entrant.me.id).find(l=>l.kind==='reward').amount,97.5);
 assert.equal(s.db.prepare('SELECT balance FROM accounts WHERE id=?').get(entrant.me.id).balance,1087500);
});
for(const gross of [0,1,5])test(`small gross reward ${gross} settles without minimum fees or lost fractions`,t=>{
 const {s,owner,entrant}=fixture(t),b=s.create(owner.me.id,body({reward:gross,entry:0}),randomUUID());enter(s,entrant,b);const job=s.claim();s.finish(job,result(job));
 assert.equal(s.me(entrant.me.id).balance,1000+b.payout);assert.equal(s.me('platform').balance,b.platformFee);assert.equal(conservation(s),2000);
});
for(const outcome of [1,-1,'error','cancel','expire'])test(`${outcome} never collects a platform payout fee`,t=>{
 const {s,owner,entrant}=fixture(t),b=s.create(owner.me.id,body(),randomUUID());
 if(outcome==='cancel')s.cancel(s.auth(owner.token),b.id);
 else if(outcome==='expire'){s.now=()=>b.expires+1;s.expire();}
 else {const a=enter(s,entrant,b),job=s.claim();s.finish(job,outcome==='error'?null:result(job,outcome),outcome==='error'?'Technical failure':undefined);if(outcome!=='error')assert.equal(s.attempt(a.id).result.platformFee,0);}
 assert.equal(s.me('platform').balance,0);assert.equal(s.ledger('platform').length,0);assert.equal(conservation(s),2000);
});
test('failure during the split rolls back receipt and both transfers; retry settles once',t=>{
 const {s,owner,entrant}=fixture(t),b=s.create(owner.me.id,body(),randomUUID()),a=enter(s,entrant,b),job=s.claim(),credit=s.credit;
 s.credit=function(account,...args){if(account==='platform')throw Error('Injected treasury failure');return credit.call(this,account,...args);};
 assert.throws(()=>s.finish(job,result(job)),/Injected/);assert.equal(s.me(entrant.me.id).balance,990);assert.equal(s.attempt(a.id,entrant.me.id).status,'running');assert.equal(s.attempt(a.id,entrant.me.id).result,null);assert.equal(s.me(owner.me.id).reserved,100);
 s.credit=credit;s.finish(job,result(job));assert.equal(s.me(entrant.me.id).balance,1087.5);assert.equal(s.me('platform').balance,2.5);assert.equal(conservation(s),2000);
});
test('legacy whole-credit database migrates once and accepted zero-fee terms remain unchanged',t=>{
 const dir=mkdtempSync(join(tmpdir(),'wm-fee-migration-')),path=join(dir,'test.sqlite');let s=new Store(path,{seed:false});
 t.after(()=>{s.close();for(const f of readdirSync(dir))unlinkSync(join(dir,f));rmdirSync(dir);});
 const owner=s.session({name:'Old creator'}),entrant=s.session({name:'Old entrant'}),creation=body(),createKey=randomUUID(),b=s.create(owner.me.id,creation,createKey),entry={blueprint:b.blueprint,maxEntry:10,maxPlatformFeeBps:250},key=randomUUID(),a=s.accept(entrant.me.id,b.id,entry,key);
 // Reconstruct the prior release's persisted schema, whole-unit ledger and exact request bodies.
 delete creation.maxPlatformFeeBps;delete entry.maxPlatformFeeBps;
 for(const [k,v] of [[createKey,creation],[key,entry]])s.db.prepare('UPDATE operations SET digest=? WHERE key=?').run(createHash('sha256').update(JSON.stringify(v)).digest('hex'),k);
 s.db.exec("ALTER TABLE bounties DROP COLUMN platform_fee_bps; ALTER TABLE bounties DROP COLUMN fee_policy_version; UPDATE accounts SET balance=balance/1000; UPDATE ledger SET amount=amount/1000; DELETE FROM meta WHERE key='credit-scale'");s.close();
 s=new Store(path,{seed:false});assert.equal(s.me(owner.me.id).balance,900);assert.equal(s.me(entrant.me.id).balance,990);assert.equal(s.me(entrant.me.id).spentToday,10);assert.equal(s.ledger(entrant.me.id).find(l=>l.kind==='entry').amount,-10);
 assert.equal(s.create(owner.me.id,creation,createKey).id,b.id);assert.equal(s.accept(entrant.me.id,b.id,entry,key).id,a.id);assert.equal(s.bounty(b.id).platformFeeBps,0);assert.equal(s.bounty(b.id).feePolicyVersion,'legacy-no-fee');assert.equal(s.bounty(b.id).payout,100);
 const job=s.claim();s.finish(job,result(job));assert.equal(s.me(entrant.me.id).balance,1090);assert.equal(s.me('platform').balance,0);assert.equal(s.attempt(a.id).result.platformFee,0);
 s.close();s=new Store(path,{seed:false});assert.equal(s.me(entrant.me.id).balance,1090);assert.equal(conservation(s),2000);
 const next=s.create(owner.me.id,body(),randomUUID());assert.equal(next.platformFeeBps,250);
});
test('fee policy version is stored with the bounty instead of derived from a future catalog policy',t=>{
 const {s,owner,entrant}=fixture(t),b=s.create(owner.me.id,body(),randomUUID());
 s.db.prepare("UPDATE bounties SET fee_policy_version='preserved-policy-v0' WHERE id=?").run(b.id);
 const terms=s.bounty(b.id);assert.equal(terms.feePolicyVersion,'preserved-policy-v0');const a=enter(s,entrant,terms),job=s.claim();s.finish(job,result(job));
 assert.equal(s.attempt(a.id).economics.feePolicyVersion,'preserved-policy-v0');assert.equal(s.attempt(a.id).result.feePolicyVersion,'preserved-policy-v0');
});
test('discovery exposes the downloadable skill and fee policy to guests',async t=>{
 const app=await startServer({port:0,database:':memory:',seed:false,workers:false});t.after(()=>app.close());
 const d=await (await fetch(app.url+'/.well-known/war-machines.json')).json(),r=await (await fetch(app.url+'/api/rules')).json();
 assert.equal(d.payments.enabled,false);assert.equal(d.payments.mpp,false);assert.equal(d.payments.tempoMainnet,false);assert.ok(d.payments.prerequisitesForPaidMode.some(x=>x.includes('Tempo')));assert.equal(r.economics.platformFee.basisPoints,250);
 const res=await fetch(app.url+d.skill),text=await res.text();assert.equal(res.status,200);assert.match(res.headers.get('content-type'),/text\/plain/);assert.match(text,/^---\nname: war-machines-engineer/);assert.match(text,/0\.975/);assert.match(text,/direct Tempo escrow/i);assert.match(text,/MPP never creates, enters or settles a bounty/i);
});
