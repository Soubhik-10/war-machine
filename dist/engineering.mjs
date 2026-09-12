import {BY_ID,ARENAS,stats,partSpec,validate,connected,keyOf,terrainAt,environmentProfile} from './data.mjs';

export function engineeringReport(machine,rules,arenaId='foundry'){
 const s=stats(machine),arena=ARENAS.find(a=>a.id===arenaId)||ARENAS[0],notes=validate(machine,rules).map(text=>({level:'error',text,category:text.includes('move')?'Mobility':text.includes('weapon')?'Weapons':'Structure'}));
 const env=environmentProfile(s,arena,terrainAt(arena,260,400)),demand=s.energy+env.drain-s.power*env.power,heat=s.heat+env.heat-s.cooling*env.cooling;
 if(arena.climate?.cold)notes.push({level:s.heaters?'good':'warn',category:'Systems',text:`Deep cold: ${Math.round(env.power*100)}% generation. Thermal regulators recover power but use 6 energy/s each.`});
 if(arena.climate?.heat)notes.push({level:s.insulators?'good':'warn',category:'Defense',text:`Ambient heat adds ${((arena.climate.heat)*env.protection).toFixed(1)} heat/s. Storm insulation reduces environmental heat; active cooling still matters.`});
 if(arena.terrain.some(t=>['snow','ice'].includes(t.type))&&!s.hovering)notes.push({level:s.winterWheels||s.gyros?'good':'warn',category:'Mobility',text:'Ice and snow reduce control. Stud tires scale with their share of your running gear; a powered gyro restores up to 70% grip.'});
 if(arena.terrain.some(t=>t.type==='brine'))notes.push({level:s.hovering||s.insulators?'good':'warn',category:'Systems',text:'Brine lanes drain 8 energy/s before insulation. Hovering avoids contact drain; paddle tires or treads reduce the slowdown.'});
 if(demand>1)notes.push({level:'warn',category:'Systems',text:`Energy reserve runs dry in about ${Math.max(1,Math.round(s.capacity/demand))}s of continuous fire. Add generation or reduce weapon demand.`});
 if(heat>1)notes.push({level:'warn',category:'Systems',text:`Continuous fire can overheat in about ${Math.max(1,Math.round(100/heat))}s in ${arena.name}. Add cooling or reduce continuous weapon heat; automatic purges consume power.`});
 const backwards=machine.modules.filter(m=>BY_ID[m.id].rate&&!BY_ID[m.id].arc&&!BY_ID[m.id].mine&&((m.r-(machine.front||0)+4)%4)===2);
 if(backwards.length)notes.push({level:'warn',category:'Weapons',text:`${backwards.length} weapon${backwards.length===1?' faces':'s face'} away from the marked front. Inspect their firing direction before deployment.`});
 const core=machine.modules.find(m=>m.id==='core');
 if(core){const a=(machine.front||0)*Math.PI/2,dx=Math.round(Math.sin(a)),dy=-Math.round(Math.cos(a)),screened=machine.modules.some(m=>!(m.z||0)&&m.x===core.x+dx&&m.y===core.y+dy);if(!screened)notes.push({level:'warn',category:'Defense',text:'Your core has an open front socket. Fit armor ahead of it to absorb incoming fire.'});}
 if(s.height>1){let weak=null;for(const m of machine.modules.filter(m=>BY_ID[m.id].support&&m.id!=='core')){const con=connected(machine.modules.filter(n=>n!==m)),lost=machine.modules.filter(n=>n!==m&&!con.has(keyOf(n))).length;if(lost>=2&&(!weak||lost>weak.lost))weak={m,lost};}if(weak)notes.push({level:'warn',category:'Structure',text:`Losing the ${BY_ID[weak.m.id].name.toLowerCase()} at ${weak.m.x+1},${weak.m.y+1}, level ${weak.m.z||0} can drop ${weak.lost} other parts. Reinforce that connection.`});}
 if(!notes.length)notes.push({level:'good',category:'All',text:'Balanced systems and a sound structure. Test your firing angles against a rival.'});
 return notes;
}

export function weaponRows(vehicle){
 const rows=new Map();for(const m of vehicle.modules){const p=partSpec(m);if(!p.rate&&!p.ram)continue;let row=rows.get(m.id);if(!row){row={id:m.id,name:p.name,count:0,alive:0,shots:0,hits:0,damage:0,powerWait:0,heatWait:0};rows.set(m.id,row);}row.count++;if(m.hp>0)row.alive++;for(const [key,field] of [['shots','fired'],['hits','landed'],['damage','dealt'],['powerWait','powerWait'],['heatWait','heatWait']])row[key]+=m[field]||0;}return [...rows.values()].sort((a,b)=>b.damage-a.damage);
}

export function battleAdvice(battle,side=0){
 const v=battle.vehicles[side],enemy=battle.vehicles[1-side],rows=weaponRows(v),notes=[];
 const dry=rows.reduce((s,r)=>s+r.powerWait,0),hot=rows.reduce((s,r)=>s+r.heatWait,0);
 if(v.dead)notes.push('Your core was destroyed. Put armor between it and the rival, and use the protected-side damage response.');
 if(dry>4)notes.push(`Guns spent ${Math.round(dry)} combined weapon-seconds waiting for power. Add generation, a capacitor, or use fewer simultaneous weapons.`);
 if(hot>3)notes.push(`Heat or coolant purges blocked guns for ${Math.round(hot)} combined weapon-seconds. Add cooling or replace a high-heat weapon with a more efficient one.`);
 if(v.detached)notes.push(`${v.detached} part${v.detached===1?' was':'s were'} lost to broken connections or supports. Reinforce critical links before adding more armor elsewhere.`);
 if(!v.pickups&&battle.time>25)notes.push('No repair caches collected. Green cache pickups restore surviving parts and energy; a mobile kite doctrine can help your design survive longer.');
 if(!notes.length)notes.push(battle.result?.winner===side?'Your core held and your weapons stayed supplied. Try the same design against a stronger rival or different terrain.':'Review which weapons connected, then adjust their range and firing direction.');
 return {notes:notes.slice(0,4),rows,ownIntegrity:Math.round(battle.health(v)*100),enemyIntegrity:Math.round(battle.health(enemy)*100)};
}

// Intersect a pointer ray with the visible module body, choosing the closest hit.
export function pickModule(ray,machine,{layer=0,full=true,gap=1.65,allLevels=false}={}){
 if(!ray)return null;let result=null,best=Infinity;
 for(const m of machine.modules){const z=m.z||0;if(m.hp===0||(!full&&z>layer)||(!allLevels&&z!==layer))continue;const center=[m.x-4,z*gap+.8,m.y-4],size=[.51,.73,.51];let near=0,far=Infinity;
  for(let axis=0;axis<3;axis++){const d=ray.direction[axis],o=ray.origin[axis],lo=center[axis]-size[axis],hi=center[axis]+size[axis];if(Math.abs(d)<1e-9){if(o<lo||o>hi){far=-1;break;}}else{let a=(lo-o)/d,b=(hi-o)/d;if(a>b)[a,b]=[b,a];near=Math.max(near,a);far=Math.min(far,b);}}
  if(far>=near&&near<best){best=near;result=m;}
 }return result;
}
