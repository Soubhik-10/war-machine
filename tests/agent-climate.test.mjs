import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ARENAS,PRESETS,PARTS,clone,stats,partSpec,terrainAt,environmentProfile,packChallenge,DEFAULT_RULES,validate} from '../dist/data.mjs';
import {Battle,DT} from '../dist/engine.mjs';
import {Store,ENGINE_HASH} from '../server/store.mjs';
import {inspectBlueprint} from '../server/agent-api.mjs';
import {startServer} from '../server.mjs';

const arena=id=>ARENAS.find(a=>a.id===id);
const ground=type=>terrainAt({terrain:[{type,x:0,y:0,w:1200,h:800}]},300,400,9);
const rig=(wheel='wheel',extras=[])=>({...clone(PRESETS[0]),name:'Climate probe',modules:[{id:'core',x:4,y:4},{id:'cannon',x:4,y:3},{id:wheel,x:3,y:4},{id:wheel,x:5,y:4},{id:'battery',x:4,y:5},...extras.map((id,i)=>({id,x:3+i,y:5}))]});
const env=(m,a,t='road',options)=>environmentProfile(stats(m),arena(a),ground(t),options);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('stud tires trade dry performance and cost for ice grip and snow speed',()=>{
 const standard=rig(),winter=rig('winterwheel');
 assert.ok(stats(winter).cost>stats(standard).cost);assert.ok(stats(winter).speed<stats(standard).speed);
 near(env(winter,'permafrost','ice').grip,.95);near(env(winter,'permafrost','snow').traction,.94);
 assert.ok(env(winter,'permafrost','snow').traction>env(standard,'permafrost','snow').traction);
});
test('paddle tires and mixed treads contribute only their share of running gear',()=>{
 const standard=rig(),paddles=rig('dunewheel'),mixed=rig();mixed.modules.find(m=>m.id==='wheel').id='track';
 near(env(paddles,'sunscar','sand').traction,.95);near(env(paddles,'brineworks','brine').traction,.88);
 near(env(mixed,'sunscar','sand').traction,(env(standard,'sunscar','sand').traction+.93)/2);
 assert.ok(stats(paddles).speed<stats(standard).speed);
});
test('cold generation, diminishing heaters and their real energy/heat costs agree',()=>{
 const a=env(rig(),'permafrost'),b=env(rig('wheel',['heater']),'permafrost'),c=env(rig('wheel',['heater','heater']),'permafrost');
 near(a.power,.65);near(b.power,.825);near(c.power,.9125);near(b.drain,6);near(c.drain,12);
 assert.ok(c.power-b.power<b.power-a.power);assert.ok(b.heat>a.heat);assert.ok(b.cooling<a.cooling);
 near(env(rig('wheel',['heater']),'permafrost','road',{powered:false}).power,.65);
 near(env(rig('wheel',['heater']),'foundry').drain,0);
});
test('insulation reduces ambient heat and brine drain with a 60 percent cap, not ground damage',()=>{
 const s=stats(rig());const naked=environmentProfile(s,arena('sunscar'),ground('road'));
 near(naked.heat,7);near(environmentProfile({...s,insulators:1},arena('sunscar'),ground('road')).heat,5.6);
 near(environmentProfile({...s,insulators:20},arena('sunscar'),ground('road')).heat,2.8);
 near(env(rig('wheel',['insulator']),'brineworks','brine').drain,6.4);
 near(env(rig('wheel',['insulator']),'furnace','lava').damage,env(rig(),'furnace','lava').damage);
});
test('hover bypasses contact hazards but keeps ambient climate penalties',()=>{
 const m=rig('hover',['gyro']);near(env(m,'brineworks','brine').drain,0);near(env(m,'permafrost','ice').grip,1);
 near(env(m,'permafrost','ice').drain,0);near(env(m,'sunscar','sand').heat,7);near(env(m,'permafrost').power,.65);
});
test('gyros cost power only on slippery ground and redundant copies do not stack',()=>{
 const a=env(rig('wheel',['gyro']),'permafrost','ice'),b=env(rig('wheel',['gyro','gyro']),'permafrost','ice');
 near(a.grip,.7);near(a.drain,4);near(b.drain,4);near(b.grip,.7);
 near(env(rig('winterwheel',['gyro']),'permafrost','ice').drain,0);
 assert.ok(env(rig('wheel',['gyro']),'permafrost','ice',{powered:false}).grip<.7);
});
test('destroying a regulator or losing its power removes the actual combat benefit',()=>{
 const battle=new Battle(rig('wheel',['heater']),rig(),'permafrost',7),[v,enemy]=battle.vehicles;
 v.holdFire=true;v.energy=50;battle.updateVehicle(v,enemy,DT);near(v.environment.power,.825);
 v.disabled=10;battle.updateVehicle(v,enemy,DT);near(v.environment.power,.65);
 v.disabled=0;v.energy=0;battle.updateVehicle(v,enemy,DT);near(v.environment.power,.65);
 v.energy=50;v.modules.find(m=>m.id==='heater').hp=0;battle.updateVehicle(v,enemy,DT);near(v.environment.power,.65);
});
test('new climate hardware fits legal builds and the flechette gun spends one trigger cost',()=>{
 for(const id of ['insulator','heater','gyro'])assert.deepEqual(validate(rig('wheel',[id])),[]);
 const m=rig('winterwheel',['insulator']);m.modules.find(p=>p.id==='cannon').id='shredder';
 assert.deepEqual(validate(m),[]);const b=new Battle(m,rig(),'salt',9),[v,e]=b.vehicles;b.time=3;b.arena.obstacles=[];e.x=v.x+180;e.y=v.y;v.a=Math.PI/2;
 const gun=v.modules.find(m=>m.id==='shredder');gun.cd=0;const energy=v.energy;b.updateVehicle(v,e,DT);
 assert.equal(gun.fired,3);assert.equal(b.projectiles.filter(p=>p.side===0).length,3);near(v.energy,Math.min(v.maxEnergy,energy+v.s.power*DT)-partSpec(gun).energy);
});

function fixture(t,options={}){const s=new Store(':memory:',{seed:false,...options});t.after(()=>s.close());const owner=s.session({name:'Creator'}),entrant=s.session({name:'Entrant'});return {s,owner,entrant};}
const creation=(extra={})=>({title:'Creator-defined contract',blueprint:packChallenge(PRESETS[0],'sunscar',0),entry:10,reward:100,hours:24,listed:false,...extra});
test('creators can choose zero rewards, fees greater than rewards, and no expiry',t=>{
 let now=1000000000000;const {s,owner,entrant}=fixture(t,{now:()=>now});
 const b=s.create(owner.me.id,creation({entry:100,reward:0,hours:0}),randomUUID());assert.equal(b.expires,null);assert.equal(b.funded,true);
 now+=400*86400000;s.expire();assert.equal(s.bounty(b.id).status,'open');assert.equal(s.me(owner.me.id).balance,1000);
 const a=s.accept(entrant.me.id,b.id,{blueprint:b.blueprint,maxEntry:100},randomUUID()),job=s.claim();
 s.finish(job,{winner:0,time:5,seed:job.seed,integrity:[1,0],damage:[300,0],mode:'auto',reason:'Fixture'});
 assert.equal(s.attempt(a.id).result.net,-100);assert.equal(s.me(entrant.me.id).balance,900);assert.equal(s.bounty(b.id).funded,false);
});
test('optional personal caps default to no cap, zero stays free-only, null clears a cap',t=>{
 const {s,owner,entrant}=fixture(t),auth=s.auth(entrant.token);assert.equal(entrant.me.entryCap,null);assert.equal(entrant.me.dailyCap,null);
 s.settings(auth,{entryCap:0,dailyCap:0});const b=s.create(owner.me.id,creation(),randomUUID());
 assert.throws(()=>s.accept(entrant.me.id,b.id,{blueprint:b.blueprint,maxEntry:10},randomUUID()),/cap/);
 s.settings(auth,{entryCap:null});assert.equal(s.me(entrant.me.id).dailyCap,0);assert.equal(s.me(entrant.me.id).entryCap,null);
 s.settings(auth,{dailyCap:null});assert.ok(s.accept(entrant.me.id,b.id,{blueprint:b.blueprint,maxEntry:10},randomUUID()).id);
});
test('saved bounties are account-scoped and idempotent; an agent cannot cancel another owner',t=>{
 const {s,owner,entrant}=fixture(t),b=s.create(owner.me.id,creation(),randomUUID());
 s.bookmark(entrant.me.id,b.id,true);s.bookmark(entrant.me.id,b.id,true);assert.equal(s.bookmarks(entrant.me.id).length,1);assert.equal(s.bookmarks(owner.me.id).length,0);
 const agent=s.auth(s.agents(s.auth(entrant.token),{name:'Engineer'}).token);assert.throws(()=>s.cancel(agent,b.id),/creator/);
 s.bookmark(entrant.me.id,b.id,false);s.bookmark(entrant.me.id,b.id,false);assert.equal(s.bookmarks(entrant.me.id).length,0);
});
test('named-part inspection locks contract limits and rejects forged or malformed machine data',t=>{
 const {s,owner}=fixture(t),rules={...DEFAULT_RULES,mode:'custom',credits:300},b=s.create(owner.me.id,creation({blueprint:packChallenge(rig(),'permafrost',0,rules)}),randomUUID());
 const r=inspectBlueprint({machine:rig('winterwheel'),bountyId:b.id,rules:{...DEFAULT_RULES,mode:'unlimited'}},s);
 assert.equal(r.valid,false);assert.ok(r.issues.some(i=>i.includes('Over budget')));assert.equal(r.rules.credits,300);assert.equal(r.arena,'permafrost');
 for(const change of [m=>m.modules.push({...m.modules[0]}),m=>m.modules[0].id='free-supergun',m=>m.modules[0].x=50,m=>m.modules[0].power=99999,m=>m.modules[0].r=null]){const m=rig();change(m);assert.equal(inspectBlueprint({machine:m},s).valid,false);}
});

async function req(app,path,method='GET',body,token,key){const r=await fetch(app.url+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{}),...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};}
test('guest agent can discover, validate and practice the same engine without any account or ledger change',async t=>{
 const app=await startServer({port:0,database:':memory:',seed:false});t.after(()=>app.close());
 const discovery=await req(app,'/.well-known/war-machines.json');assert.equal(discovery.body.payments.enabled,false);
 const spec=await req(app,'/api/openapi.json');assert.equal(spec.body.components.schemas.Module.properties.id.enum.length,42);
 const inspected=await req(app,'/api/blueprints/validate','POST',{machine:rig('winterwheel',['insulator']),arena:'permafrost'});
 assert.equal(inspected.body.valid,true);assert.equal(inspected.body.versions.hash,ENGINE_HASH);assert.ok(inspected.body.environment.some(e=>e.type==='snow'));
 const before=app.store.db.prepare('SELECT COUNT(*) n FROM ledger').get().n;
 const practice=await req(app,'/api/practice','POST',{challenger:inspected.body.blueprint,defender:inspected.body.blueprint,seed:17});assert.equal(practice.status,200);assert.equal(practice.body.creditsChanged,0);
 const expected=new Battle(inspected.body.machine,inspected.body.machine,'permafrost',17,{swapSpawns:true}).run();assert.deepEqual(practice.body.result.integrity,expected.integrity);assert.equal(practice.body.result.winner,expected.winner);
 assert.equal(app.store.db.prepare('SELECT COUNT(*) n FROM ledger').get().n,before);assert.equal(app.store.db.prepare('SELECT COUNT(*) n FROM attempts').get().n,0);
 assert.equal((await req(app,'/api/me/bookmarks')).status,401);assert.equal((await fetch(app.url+'/agents.md')).status,200);
});
test('official queued trials take priority over guest API practice, and stale tokens do not block public reads',async t=>{
 const app=await startServer({port:0,database:':memory:',seed:false,workers:false});t.after(()=>app.close());
 const owner=app.store.session({name:'Owner'}),entrant=app.store.session({name:'Entrant'}),b=app.store.create(owner.me.id,creation(),randomUUID());
 app.store.accept(entrant.me.id,b.id,{blueprint:b.blueprint,maxEntry:10},randomUUID());
 assert.equal((await req(app,'/api/practice','POST',{challenger:b.blueprint,bountyId:b.id})).status,429);
 assert.equal((await req(app,'/api/rules','GET',undefined,'revoked-token')).status,200);
 assert.equal((await req(app,'/api/me','GET',undefined,'revoked-token')).status,401);
 assert.equal((await req(app,'/api/session','POST',{name:'Fresh profile'},'revoked-token')).status,201);
 const saved=await req(app,'/api/me/bookmarks/'+b.id,'PUT',undefined,entrant.token);assert.equal(saved.status,200);
 assert.equal((await req(app,'/api/me/bookmarks','GET',undefined,entrant.token)).body.length,1);
});
