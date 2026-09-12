import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {ARENAS,DEFAULT_RULES,PARTS,PRESETS,clone,partSpec,stats,validate} from '../dist/data.mjs';
import {Battle} from '../dist/engine.mjs';

// This is deliberately a hostile audit rather than a preset tournament. Every
// weapon gets its largest legal, connected, adequately supplied stack. It is
// then run into several unlike opponents, on maps that expose heat, range and
// mobility weaknesses. A high raw DPS number alone must not pass this test.
const WEAPONS=PARTS.filter(p=>p.rate||p.ram);
// The compact matrix keeps this repeatable in local development while still
// covering neutral ground, heat stress, ice handling and brine power drain.
const ARENA_IDS=['foundry','furnace','glacier','brineworks'].filter(id=>ARENAS.some(a=>a.id===id));
const SEEDS=[117,93542];
const WEAPON_SLOTS=[[4,3],[3,3],[5,3],[2,3],[6,3],[3,2],[4,2],[5,2]];
const SYSTEM_SLOTS=[[3,6],[5,6],[4,7],[2,6],[6,6],[3,7],[5,7],[4,8],[2,7],[6,7],[3,8],[5,8]];

function module(id,x,y,z=0){return {id,x,y,z,r:0};}
function prototypeBase(){
 return [
  module('core',4,4),
  module('wheel',3,4),module('wheel',5,4),module('wheel',4,5),
  module('battery',3,5),module('battery',5,5),module('cooler',4,6),
 ];
}
function configuredMachine(id,count){
 const p=partSpec({id}),modules=prototypeBase();
 for(const [x,y] of WEAPON_SLOTS.slice(0,count))modules.push(module(id,x,y));
 let systemIndex=0;
 const add=id=>{const slot=SYSTEM_SLOTS[systemIndex++];if(!slot)return false;modules.push(module(id,...slot));return true;};
 // A stack has enough infrastructure to use 70% of its listed continuous
 // power and heat demand. The remaining gap is intentional: the simulation
 // includes movement, cover, burst fire, and cooling windows.
 for(let guard=0;guard<24;guard++){
  const s=stats({modules});
  const requiredPower=s.energy*.70;
  const requiredCooling=s.heat*.70;
  if(s.power+1e-6<requiredPower){
   if(!add(requiredPower-s.power>28?'reactor':'battery'))return null;
   continue;
  }
  if(s.cooling+1e-6<requiredCooling){
   if(!add('cooler'))return null;
   continue;
  }
  break;
 }
 const machine={name:'Stack '+id+' ×'+count,paint:'#e5a849',accent:'#f4e1b0',glow:'#79e0d0',pattern:'hazard',number:count,tactic:p.ram?'ram':p.range>=460?'kite':p.range<=240?'flank':'balanced',target:'weapons',range:Math.max(80,Math.min(590,p.range||80)),stance:'steady',front:0,modules};
 const issues=validate(machine,DEFAULT_RULES);
 if(issues.length)return null;
 return machine;
}

export function largestLegalWeaponStack(id){
 for(let count=8;count>=1;count--){
  const machine=configuredMachine(id,count);
  if(machine)return machine;
 }
 throw Error('Could not make a legal stress chassis for '+id);
}

function counters(){
 return ['Ironclad','Wraith','Citadel'].map(name=>clone(PRESETS.find(p=>p.name===name)));
}
function sideSummary(battle,side,id){
 const v=battle.vehicles[side],weapon=v.modules.filter(m=>m.id===id);
 return {damage:v.damage,integrity:battle.result.integrity[side],overheats:v.overheatCount,shots:v.shots,hits:v.hits,
  fired:weapon.reduce((n,m)=>n+(m.fired||0),0),landed:weapon.reduce((n,m)=>n+(m.landed||0),0),dealt:weapon.reduce((n,m)=>n+(m.dealt||0),0),
  powerWait:weapon.reduce((n,m)=>n+(m.powerWait||0),0),heatWait:weapon.reduce((n,m)=>n+(m.heatWait||0),0)};
}
function runMatch(attacker,defender,arena,seed,swapped,id){
 const battle=new Battle(attacker,defender,arena,seed,{swapSpawns:swapped});
 const result=battle.run(),a=sideSummary(battle,0,id);
 return {winner:result.winner,time:result.time,reason:result.reason,...a,win:result.winner===0?1:result.winner<0?.5:0};
}
function mean(rows,key){return rows.reduce((sum,row)=>sum+row[key],0)/Math.max(1,rows.length);}
function round(value,digits=2){const scale=10**digits;return Math.round(value*scale)/scale;}

function auditWeapon(id){
 const machine=largestLegalWeaponStack(id),s=stats(machine),p=partSpec({id});
 const rows=[];
 for(const opponent of counters())for(const arena of ARENA_IDS)for(const seed of SEEDS)for(const swapped of [false,true]){
  rows.push({opponent:opponent.name,arena,seed,swapped,...runMatch(machine,opponent,arena,seed,swapped,id)});
 }
 const rate=mean(rows,'win'),damage=mean(rows,'damage'),dealt=mean(rows,'dealt'),fired=mean(rows,'fired');
 return {id,name:p.name,rawDps:round(p.damage*(p.pellets||1)/p.rate),stackCount:machine.modules.filter(m=>m.id===id).length,
  cost:s.cost,mass:s.mass,parts:s.parts,power:s.power,cooling:s.cooling,listedPower:round(s.energy),listedHeat:round(s.heat),
  winRate:round(rate,4),meanDamage:round(damage),damagePer100Credits:round(damage/s.cost*100),
  weaponDamage:round(dealt),hitRate:round(fired?mean(rows,'landed')/fired:0,3),
  meanOverheats:round(mean(rows,'overheats'),3),powerWaitSeconds:round(mean(rows,'powerWait'),3),heatWaitSeconds:round(mean(rows,'heatWait'),3),
  byArena:Object.fromEntries(ARENA_IDS.map(arena=>{const r=rows.filter(row=>row.arena===arena);return [arena,{winRate:round(mean(r,'win'),3),damage:round(mean(r,'damage')),overheats:round(mean(r,'overheats'),2)}];})),rows};
}

function catalogue(){
 return PARTS.map(p=>({id:p.id,name:p.name,category:p.cat,cost:p.cost,hp:p.hp,mass:p.mass,stackable:p.id!=='core',
  role:p.rate?'weapon':p.thrust?'mobility':p.armor||p.shield||p.repair||p.reactive||p.intercept||p.smoke||p.thermalResist||p.blastResist?'defense':p.power||p.cooling||p.capacity||p.id==='heater'||p.id==='gyro'?'systems':'structure'}));
}

const requested=(process.argv[3]||'').split(',').map(v=>v.trim()).filter(Boolean);
const selected=requested.length?WEAPONS.filter(p=>requested.includes(p.id)):WEAPONS;
if(requested.length!==selected.length)throw Error('Unknown weapon requested for audit.');
const started=performance.now();
const weaponResults=selected.map((p,index)=>{
 const result=auditWeapon(p.id);
 console.log(JSON.stringify({completed:index+1,total:selected.length,id:p.id,stack:result.stackCount,winRate:result.winRate,elapsedSeconds:round((performance.now()-started)/1000,1)}));
 return result;
});
const report={createdAt:new Date().toISOString(),rules:DEFAULT_RULES,arenas:ARENA_IDS,seeds:SEEDS,method:'Largest legal connected stack with 70% sustained weapon support; each stack plays Ironclad, Wraith and Citadel across neutral, heat, ice and brine arenas, seeds and spawn sides.',matches:weaponResults.reduce((n,r)=>n+r.rows.length,0),catalogue:catalogue(),weapons:weaponResults.sort((a,b)=>b.winRate-a.winRate||b.damagePer100Credits-a.damagePer100Credits)};
const output=resolve(process.argv[2]||'work/part-audit.json');
mkdirSync(dirname(output),{recursive:true});
writeFileSync(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({matches:report.matches,ranking:report.weapons.map(({id,stackCount,cost,winRate,meanDamage,damagePer100Credits,meanOverheats,powerWaitSeconds,heatWaitSeconds})=>({id,stackCount,cost,winRate,meanDamage,damagePer100Credits,meanOverheats,powerWaitSeconds,heatWaitSeconds}))},null,2));
