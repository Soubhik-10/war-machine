import test from 'node:test';
import assert from 'node:assert/strict';
import {Geometry,VERTEX_STRIDE,battleScene} from '../dist/renderer.mjs';
import {Battle} from '../dist/engine.mjs';
import {PRESETS} from '../dist/data.mjs';

test('effects use opacity independently from emissive intensity',()=>{
 const g=new Geometry();g.box(0,0,0,1,1,1,'#ffffff',.2);
 assert.equal(g.vertices[10],1);
 g.beginEffects('alpha');g.box(0,0,0,1,1,1,'#ffffff',.35);g.endEffects();
 assert.equal(g.effectVertices[10],.35);
 assert.equal(g.effectVertices.length%(VERTEX_STRIDE*3),0);
});

test('rail trails remain finite at zero speed and effect envelopes fade to zero',()=>{
 const battle=new Battle(PRESETS[0],PRESETS[1],'foundry',19);
 battle.projectiles.push({x:600,y:400,h:20,a:Math.PI/4,vh:80,speed:0,kind:'railgun',life:1});
 battle.effects.push({x:600,y:400,h:20,tx:700,ty:500,th:20,type:'beam',weapon:'laser',color:'#ffffff',life:0,max:.2,scale:1});
 const scene=battleScene(battle);
 assert.ok(scene.additiveVertices.every(Number.isFinite));
 assert.ok(scene.additiveVertices.some((value,index)=>index%VERTEX_STRIDE===10&&value===0));
});

test('reduced effects retain a bounded representative set',()=>{
 const battle=new Battle(PRESETS[0],PRESETS[1],'foundry',23);
 for(let i=0;i<100;i++)battle.effects.push({x:400+i*2,y:400,h:20,type:'muzzle',weapon:i%2?'gatling':'cannon',angle:0,color:'#ffffff',life:.15,max:.2,scale:1});
 const reduced=battleScene(battle,{quality:{tier:'balanced',effects:'reduced',ventParticles:5,trailParticles:5,damageSmokeParticles:3,smokeParticles:10,shieldRings:5,shieldSegments:6,debrisLimit:96,ringSegments:40}});
 const full=battleScene(battle,{quality:{tier:'high',effects:'full',ventParticles:7,trailParticles:8,damageSmokeParticles:3,smokeParticles:16,shieldRings:6,shieldSegments:7,debrisLimit:Infinity,ringSegments:64}});
 assert.ok(reduced.additiveVertices.length>0);
 assert.ok(reduced.additiveVertices.length<full.additiveVertices.length);
 assert.ok(reduced.additiveVertices.every(Number.isFinite));
});

test('hot weapons and distinct impact classes produce bounded finite battle effects',()=>{
 const cool=new Battle(PRESETS[0],PRESETS[1],'foundry',31),hot=new Battle(PRESETS[0],PRESETS[1],'foundry',31),weapon=hot.vehicles[0].modules.find(m=>m.id==='cannon');
 hot.vehicles[0].heat=92;weapon.thermal=1;
 hot.effects.push({x:560,y:400,h:20,type:'hit',weapon:'laser',color:'#ffffff',life:.16,max:.2,scale:1},{x:640,y:400,h:20,type:'blast',weapon:'rocket',color:'#ffffff',life:.4,max:.7,scale:1},{x:600,y:470,h:20,type:'hit',weapon:'cryo',color:'#ffffff',life:.16,max:.2,scale:1});
 const coolScene=battleScene(cool),hotScene=battleScene(hot);
 assert.ok(hotScene.additiveVertices.length>coolScene.additiveVertices.length);
 assert.ok(hotScene.additiveVertices.every(Number.isFinite));
});
