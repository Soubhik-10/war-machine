import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import worker from '../sites/worker/index.mjs';
import {packChallenge,PRESETS} from '../dist/data.mjs';
import {pathUsdToUnits,payoutQuote,unitsToPathUsd} from '../sites/worker/pathusd.mjs';
import {privateKeyToAccount} from 'viem/accounts';

class Statement {
 constructor(statement){this.statement=statement;this.args=[];}
 bind(...args){this.args=args;return this;}
 async first(){return this.statement.get(...this.args)||null;}
 async all(){return {results:this.statement.all(...this.args)};}
 async run(){const result=this.statement.run(...this.args);return {meta:{changes:Number(result.changes)}};}
}
class D1Mock {
 constructor(){this.sqlite=new DatabaseSync(':memory:');}
 prepare(sql){return new Statement(this.sqlite.prepare(sql));}
 async batch(statements){return Promise.all(statements.map(statement=>statement.run()));}
 async migrate(){this.sqlite.exec(await readFile(new URL('../drizzle/0000_war_machines.sql',import.meta.url),'utf8'));this.sqlite.exec(await readFile(new URL('../drizzle/0001_tempo_mainnet.sql',import.meta.url),'utf8'));}
 close(){this.sqlite.close();}
}
const json=(url,method='GET',body,token,key)=>new Request('https://foundry.example'+url,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:'Bearer '+token}:{}),...(key?{'idempotency-key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});
const call=async(env,url,method,body,token,key)=>{const response=await worker.fetch(json(url,method,body,token,key),env);return {status:response.status,body:await response.json()};};
const sha256=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');

test('pathUSD uses exact base units for cents and preserves the 2.5% fee quote',()=>{
 assert.equal(pathUsdToUnits('0.01',{allowZero:false}).toString(),'10000');
 assert.equal(pathUsdToUnits('1.234567',{allowZero:false}).toString(),'1234567');
 assert.throws(()=>pathUsdToUnits('0.0000001',{allowZero:false}),/at most 6 decimal places/);
 assert.equal(unitsToPathUsd('100000'),'0.1');
 const quote=payoutQuote('1000000','100000');
 assert.equal(quote.platformFee,'0.025');
 assert.equal(quote.payout,'0.975');
 assert.equal(quote.netIfWin,'0.875');
});

test('Tempo mode is fail-closed and never falls back to demo credits',async t=>{
 const DB=new D1Mock();await DB.migrate();t.after(()=>DB.close());const env={DB,WM_MODE:'tempo-mainnet'};
 const health=await call(env,'/api/health');assert.equal(health.status,200);assert.equal(health.body.mode,'tempo-mainnet');assert.equal(health.body.paymentsEnabled,false);
 const session=await call(env,'/api/session','POST',{name:'No demo'});assert.equal(session.status,503);assert.match(session.body.error,/activation/i);
 const rules=await call(env,'/api/rules');assert.equal(rules.status,200);assert.equal(rules.body.startingCredits,0);assert.equal(rules.body.mpp,'locked');
});

test('enabled Tempo mode issues an MPP payment challenge before a cent-denominated bounty is funded',async t=>{
 const DB=new D1Mock();await DB.migrate();t.after(()=>DB.close());const key='0x'+'11'.repeat(32),escrow=privateKeyToAccount(key).address,token='test-wallet-session',account='11111111-1111-4111-8111-111111111111';
 DB.sqlite.prepare('INSERT INTO accounts (id,token_hash,name,balance,entry_cap,daily_cap,created,payout_address) VALUES (?,?,?,?,?,?,?,?)').run(account,'wallet:'+account,'Test engineer',0,null,null,Date.now(),escrow);
 DB.sqlite.prepare('INSERT INTO sessions (id,token_hash,account,expires,created) VALUES (?,?,?,?,?)').run('22222222-2222-4222-8222-222222222222',await sha256(token),account,Date.now()+60000,Date.now());
 const env={DB,WM_MODE:'tempo-mainnet',WM_MAINNET_ENABLE:'tempo-mainnet-real-funds',WM_PAYMENT_PAUSED:'false',WM_LEGAL_REVIEWED:'true',WM_PUBLIC_ORIGIN:'https://foundry.example',WM_LEDGER_NAMESPACE:'tempo-mainnet:4217:0x20c0000000000000000000000000000000000000',TEMPO_ESCROW_RECIPIENT:escrow,TEMPO_ENTRY_RECIPIENT:escrow,TEMPO_PLATFORM_RECIPIENT:'0xc20131e9132888993de6519D486E5558A5DbCb7A',TEMPO_ESCROW_PRIVATE_KEY:key,MPP_SECRET_KEY:'m'.repeat(32),WM_MAX_OPERATION_UNITS:'100000000',WM_MAX_OUTSTANDING_UNITS:'1000000000'};
 const blueprint=packChallenge(PRESETS[0],'foundry',0),request=new Request('https://foundry.example/api/bounties',{method:'POST',headers:{'content-type':'application/json','idempotency-key':'tempo_cent_bounty_0001','cookie':'wm_session='+token},body:JSON.stringify({title:'Cent payment',blueprint,entry:'0.01',reward:'1.00',maxPlatformFeeBps:250,hours:1,listed:true})}),res=await worker.fetch(request,env),raw=await res.text();
 assert.equal(res.status,402,raw);assert.match(res.headers.get('www-authenticate')||'',/method="tempo"/);assert.match(res.headers.get('www-authenticate')||'',/Payment-Authorization/);assert.equal(DB.sqlite.prepare('SELECT amount_units FROM payment_holds').get().amount_units,'1000000');
});

test('Sites Worker + D1 supports private build vaults and authoritative demo bounty settlement',async t=>{
 const DB=new D1Mock();await DB.migrate();t.after(()=>DB.close());const env={DB,ASSETS:{fetch:()=>new Response('asset')}};
 const home=await worker.fetch(new Request('https://foundry.example/'),env);assert.equal(home.status,200);assert.match(await home.text(),/WAR MACHINES/);
 const owner=(await call(env,'/api/session','POST',{name:'Owner'})).body,challenger=(await call(env,'/api/session','POST',{name:'Challenger'})).body;
 const blueprint=packChallenge(PRESETS[0],'foundry',0),saved=await call(env,'/api/me/builds','POST',{name:'Owner design',blueprint},owner.token,'save_worker_build_0001');
 assert.equal(saved.status,201,JSON.stringify(saved.body));const builds=await call(env,'/api/me/builds','GET',undefined,owner.token);assert.equal(builds.body.length,1);assert.equal(builds.body[0].name,'Owner design');
 const updated=await call(env,'/api/me/builds/'+saved.body.id,'PATCH',{name:'Refitted owner design',blueprint},owner.token,'update_worker_build_0001');assert.equal(updated.status,200,JSON.stringify(updated.body));assert.equal(updated.body.name,'Refitted owner design');
 const created=await call(env,'/api/bounties','POST',{title:'Break the D1 fortress',blueprint,entry:0,reward:100,maxPlatformFeeBps:250,hours:1,listed:true},owner.token,'create_worker_bounty_0001');assert.equal(created.status,201);assert.equal(created.body.platformFee,2.5);assert.equal(created.body.payout,97.5);
 const inspection=await call(env,'/api/blueprints/validate','POST',{blueprint:packChallenge(PRESETS[1],'salt',0),bountyId:created.body.id});assert.equal(inspection.status,200);assert.equal(inspection.body.arena,'foundry');
 const practice=await call(env,'/api/practice','POST',{challenger:packChallenge(PRESETS[1],'salt',0),bountyId:created.body.id,seed:42});assert.equal(practice.status,200);assert.equal(practice.body.kind,'practice');
 const entered=await call(env,'/api/bounties/'+created.body.id+'/attempts','POST',{blueprint:packChallenge(PRESETS[1],'foundry',0,created.body.blueprint.q),maxEntry:0,maxPlatformFeeBps:250},challenger.token,'enter_worker_bounty_0001');assert.equal(entered.status,202);assert.equal(entered.body.status,'settled');assert.ok(['win','loss','draw'].includes(entered.body.result.outcome));
 const publicAttempt=await call(env,'/api/attempts/'+entered.body.id);assert.equal(publicAttempt.status,200);assert.equal(publicAttempt.body.replay.versions.hash.length,64);
});
