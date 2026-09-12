import {simulationHash} from '../server/simulation-hash.mjs';
import {writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {PRESETS,ARENAS,stats,validate,PARTS} from '../dist/data.mjs';
import {Battle} from '../dist/engine.mjs';

const seeds=[117,93542];
const rows=[];
const started=performance.now();
const summary=PRESETS.map(m=>({name:m.name,cost:stats(m).cost,mass:stats(m).mass,wins:0,losses:0,draws:0,byArena:{}}));
for(const arena of ARENAS){
 for(let a=0;a<PRESETS.length;a++)for(let b=a+1;b<PRESETS.length;b++)for(const seed of seeds)for(const swapped of [false,true]){
  const ids=swapped?[b,a]:[a,b];
  const battle=new Battle(PRESETS[ids[0]],PRESETS[ids[1]],arena.id,seed);
  const t=performance.now(),r=battle.run();
  rows.push({arena:arena.id,seed,left:PRESETS[ids[0]].name,right:PRESETS[ids[1]].name,winner:r.winner<0?'draw':PRESETS[ids[r.winner]].name,winnerSide:r.winner,time:r.time,reason:r.reason,integrity:r.integrity,damage:r.damage,wallMs:performance.now()-t,overheats:battle.vehicles.map(v=>v.overheatCount),shots:battle.vehicles.map(v=>v.shots),hits:battle.vehicles.map(v=>v.hits)});
  ids.forEach((id,side)=>{const s=summary[id],key=r.winner<0?'draws':r.winner===side?'wins':'losses';s[key]++;s.byArena[arena.id]||={wins:0,losses:0,draws:0};s.byArena[arena.id][key]++;});
 }
 console.log(JSON.stringify({arena:arena.id,matches:rows.length,elapsedSeconds:Math.round((performance.now()-started)/1000)}));
}
const report={canonicalReleaseHash:simulationHash(),createdAt:new Date().toISOString(),engineHash:createHash('sha256').update(readFileSync(new URL('../dist/engine.mjs',import.meta.url))).digest('hex'),dataHash:createHash('sha256').update(readFileSync(new URL('../dist/data.mjs',import.meta.url))).digest('hex'),seeds,matches:rows.length,validPresets:PRESETS.map(m=>({name:m.name,issues:validate(m)})),summary:summary.map(s=>({...s,winRate:s.wins/(s.wins+s.losses+s.draws)})).sort((a,b)=>b.winRate-a.winRate),arenaSummary:ARENAS.map(a=>{const r=rows.filter(r=>r.arena===a.id);return {id:a.id,matches:r.length,leftWins:r.filter(r=>r.winnerSide===0).length,rightWins:r.filter(r=>r.winnerSide===1).length,draws:r.filter(r=>r.winnerSide<0).length,timeouts:r.filter(r=>r.time>=100).length,meanSeconds:r.reduce((s,r)=>s+r.time,0)/r.length};}),weaponEconomics:PARTS.filter(p=>p.rate).map(p=>({id:p.id,cost:p.cost,rawDps:p.damage*(p.pellets||1)/p.rate,powerPerSecond:p.energy/p.rate,heatPerSecond:p.heat/p.rate,range:p.range})),rows};
const output=resolve(process.argv[2]||'work/balance-report.json');mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({matches:report.matches,ranking:report.summary.map(({name,cost,winRate,wins,losses,draws})=>({name,cost,winRate,wins,losses,draws})),arenas:report.arenaSummary},null,2));
