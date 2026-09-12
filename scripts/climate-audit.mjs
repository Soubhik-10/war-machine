import {simulationHash} from '../server/simulation-hash.mjs';
import {writeFileSync} from 'node:fs';
import {PARTS,PRESETS,ARENAS,clone,stats,validate,terrainAt,environmentProfile,DEFAULT_RULES} from '../dist/data.mjs';
import {Battle} from '../dist/engine.mjs';
const variants=[['Rally baseline',null,null],['Stud tires','winterwheel',null],['Paddle tires','dunewheel',null],['Insulated',null,'insulator'],['Regulated',null,'heater'],['Stabilized',null,'gyro'],['Flechette',null,'shredder']].map(([name,wheel,extra])=>{
 const m=clone(PRESETS[0]);m.name=name;if(wheel)for(const p of m.modules)if(p.id==='wheel')p.id=wheel;
 if(extra==='shredder')m.modules.find(p=>p.id==='cannon').id='shredder';else if(extra)m.modules.push({id:extra,x:4,y:6,r:0});
 if(validate(m).length)throw Error(name+': '+validate(m));return m;
});
const rows=[],arenas=['foundry','permafrost','sunscar','brineworks'],seeds=[49003,77581];
for(const m of variants){for(const arena of arenas)for(const opponent of [PRESETS[0],PRESETS[6]])for(const seed of seeds)for(const swapSpawns of [false,true]){
 const battle=new Battle(m,opponent,arena,seed,{swapSpawns}),r=battle.run();rows.push({variant:m.name,cost:stats(m).cost,arena,opponent:opponent.name,seed,swapSpawns,winner:r.winner,time:r.time,integrity:r.integrity,overheats:battle.vehicles[0].overheatCount});
 }console.log(m.name+' complete');}
const summary=variants.map(m=>({name:m.name,cost:stats(m).cost,byArena:arenas.map(arena=>{const r=rows.filter(r=>r.variant===m.name&&r.arena===arena);return {arena,wins:r.filter(r=>r.winner===0).length,draws:r.filter(r=>r.winner===-1).length,matches:r.length,overheats:r.reduce((n,r)=>n+r.overheats,0)};})}));
const report={canonicalReleaseHash:simulationHash(),matches:rows.length,seeds,rules:DEFAULT_RULES,method:'Matched chassis except named equipment changes, same 1200-credit ceiling, actual costs disclosed. Two opponents, two held-out seeds, both spawn positions. Costs are not equalized with dummy armor; this is sensitivity screening, not a universal fairness claim.',summary,rows};
writeFileSync(process.argv[2]||'work/climate-audit.json',JSON.stringify(report,null,2));console.log(JSON.stringify({matches:report.matches,summary},null,2));
