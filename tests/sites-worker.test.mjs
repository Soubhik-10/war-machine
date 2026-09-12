import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import worker from '../sites/worker/index.mjs';
import {packChallenge,PRESETS} from '../dist/data.mjs';

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
 async migrate(){this.sqlite.exec(await readFile(new URL('../drizzle/0000_war_machines.sql',import.meta.url),'utf8'));}
 close(){this.sqlite.close();}
}
const json=(url,method='GET',body,token,key)=>new Request('https://foundry.example'+url,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:'Bearer '+token}:{}),...(key?{'idempotency-key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});
const call=async(env,url,method,body,token,key)=>{const response=await worker.fetch(json(url,method,body,token,key),env);return {status:response.status,body:await response.json()};};

test('Sites Worker + D1 supports private build vaults and authoritative demo bounty settlement',async t=>{
 const DB=new D1Mock();await DB.migrate();t.after(()=>DB.close());const env={DB,ASSETS:{fetch:()=>new Response('asset')}};
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
