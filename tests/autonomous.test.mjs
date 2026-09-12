import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_RULES,normalizeRules,PRESETS,ARENAS,PARTS,clone,packChallenge,unpackChallenge,encodeChallenge,decodeChallenge} from '../dist/data.mjs';
import {Battle} from '../dist/engine.mjs';
import {Geometry,VERTEX_STRIDE,worldLight,workshopScene,battleScene} from '../dist/renderer.mjs';

test('old command challenges become autonomous while preserving budget and machine customization',()=>{
 const m={...clone(PRESETS[0]),finish:'alloy',front:2,accent:'#c5d382',pattern:'hazard'};
 const r={...DEFAULT_RULES,mode:'custom',credits:1600,parts:50,mass:900,weapons:10,combat:'command'};
 const old=packChallenge(m,'glacier',513,r);old.q.combat='command';
 const migrated=decodeChallenge(encodeChallenge(old));
 assert.equal(migrated.rules.combat,'auto');assert.deepEqual(migrated.rules,normalizeRules(r));assert.deepEqual(migrated.machine,m);
 assert.equal(packChallenge(migrated.machine,migrated.arena,migrated.seed,migrated.rules).q.combat,'auto');
 for(const finish of ['matte','alloy'])assert.equal(unpackChallenge(packChallenge({...m,finish},'foundry',1)).machine.finish,finish);
});

test('autonomous trials reject live commands and both pilots operate their own systems',()=>{
 const b=new Battle(PRESETS[9],PRESETS[9],'foundry',117);b.time=3;b.tick=180;
 for(const v of b.vehicles){v.heat=90;v.energy=v.maxEnergy;}
 b.automatedCommands(b.vehicles[0],b.vehicles[1]);b.tick=195;b.automatedCommands(b.vehicles[1],b.vehicles[0]);
 assert.ok(b.vehicles.every(v=>v.vent>0&&v.heat<90));
 for(const [type,data] of [['ability',{id:'boost'}],['drive',{x:1,y:0}],['focus',{uid:1000}],['fire',{hold:true}]])assert.equal(b.command(0,type,data).ok,false);
 assert.equal(b.commands.length,0);
});

test('material coordinates stay attached to a cached part under rotation and translation',()=>{
 const a=new Geometry(),b=new Geometry(),m={id:'armor',finish:'alloy',pattern:'racing'};
 a.cachedModule(m,'#bd8362');b.origin=[4,2,-3];b.angle=1.4;b.cachedModule(m,'#bd8362');
 assert.equal(a.vertices.length,b.vertices.length);assert.equal(a.vertices.length%(VERTEX_STRIDE*3),0);
 for(let i=0;i<a.vertices.length;i+=VERTEX_STRIDE)assert.deepEqual(a.vertices.slice(i+10,i+14),b.vertices.slice(i+10,i+14));
 assert.notDeepEqual(a.vertices.slice(0,3),b.vertices.slice(0,3));
});

test('directional light stays in world space while the camera follows a battle',()=>{
 const a=worldLight(),b=worldLight();
 assert.deepEqual(a.eye,[-36,64,-24]);assert.deepEqual(a.target,[0,0,0]);assert.deepEqual(a,b);
 assert.notEqual(a.eye,b.eye);assert.notEqual(a.target,b.target);
});

test('finishes use distinct materials and animation changes tracks and recoil geometry',()=>{
 const mesh=(id,finish,phase=0,recoil=0)=>{const g=new Geometry();g.cachedModule({id,finish,recoil},'#bd8362',phase);return g.vertices;};
 assert.notDeepEqual(mesh('armor','matte'),mesh('armor','alloy'));
 assert.notDeepEqual(mesh('track','matte',0),mesh('track','matte',2));
 assert.notDeepEqual(mesh('railgun','matte',0,0),mesh('railgun','matte',0,1));
 for(const p of PARTS){const vertices=mesh(p.id,'alloy',2,1);assert.ok(vertices.every(Number.isFinite));assert.equal(vertices.length%(VERTEX_STRIDE*3),0);}
});

test('rendering effects and inspecting damaged builds cannot change the seeded outcome',()=>{
 const a=new Battle(PRESETS[9],PRESETS[8],'badlands',38),b=new Battle(PRESETS[9],PRESETS[8],'badlands',38);
 for(let i=0;i<600&&!a.result;i++){a.step();b.step();if(i%75===0){const before=JSON.stringify(a);const g=battleScene(a,{inspect:true});assert.ok(g.vertices.every(Number.isFinite));assert.equal(JSON.stringify(a),before);}}
 assert.deepEqual(a.run(),b.run());assert.deepEqual(a.vehicles,b.vehicles);assert.deepEqual(a.events,b.events);
 assert.ok(a.vehicles.some(v=>v.odometer>0));
});

test('every terrain environment and workshop layer produces valid material geometry',()=>{
 for(const arena of ARENAS){const b=new Battle(PRESETS[0],PRESETS[9],arena.id);b.time=9;const g=battleScene(b);assert.ok(g.vertices.every(Number.isFinite));assert.equal(g.vertices.length%(VERTEX_STRIDE*3),0);}
 for(const layer of [0,1,2])assert.ok(workshopScene({...clone(PRESETS[9]),finish:'alloy'},{layer,explode:true}).vertices.every(Number.isFinite));
});
