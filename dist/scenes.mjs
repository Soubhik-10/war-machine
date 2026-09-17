import {Geometry} from './renderer.mjs';
import {BY_ID,partSpec,keyOf,connected,LAYER_HEIGHT,terrainAt} from './data.mjs';
import {world,CELL} from './engine.mjs';
const colors={snow:'#c1d8dc',brine:'#577966',sand:'#bca47c',mud:'#4f4c39',oil:'#24363a',ice:'#82c3d0',lava:'#a74c29',vent:'#282c2b',ridge:'#ac8466',coolant:'#4b9f90',rubble:'#827463'};
const noise=n=>{const x=Math.sin(n*73.19+13)*4731;return x-Math.floor(x);};
const sceneCache=new Map(),battleSceneCache=new WeakMap(),workshopSceneCache=new WeakMap();
const FULL_QUALITY=Object.freeze({tier:'high',effects:'full',ventParticles:7,trailParticles:8,damageSmokeParticles:3,smokeParticles:16,shieldRings:6,shieldSegments:7,debrisLimit:Infinity,ringSegments:64});
const sceneQuality=q=>q?.tier&&q?.effects&&q?.ventParticles!==undefined?q:q?{...FULL_QUALITY,...q}:FULL_QUALITY;
const wx=x=>(x-600)/CELL,wz=y=>(y-400)/CELL;
function bracket(g,x,y,z,color,width=1){for(const dx of [-1,1])for(const dz of [-1,1]){g.box(x+dx*width*.45,y,z+dz*width*.35,.055,.025,width*.25,color,.55);g.box(x+dx*width*.35,y,z+dz*width*.45,width*.25,.025,.055,color,.55);}}
export function workshopScene(machine,{hover=null,selected='cannon',rotation=0,erase=false,grid=true,ghost=true,layer=0,full=true,explode=false,focus=null,phase=0,reuse=false,quality=null}={}){
 const g=reuse?(workshopSceneCache.get(machine)??new Geometry()):new Geometry();if(reuse)workshopSceneCache.set(machine,g);g.vertices.length=0;g.origin=[0,0,0];g.angle=0;g.scale=1;g.material=4;g.detail=quality?.tier==='high'?'full':quality?'reduced':'full';const gap=LAYER_HEIGHT+(explode?.7:0);g.box(0,-.28,0,10.8,.48,10.8,'#222d33');g.bevel(0,-.02,0,10.3,.19,10.3,'#34434a');
 for(let i=-4;i<=4;i++){g.box(i,.078,0,.012,.008,9.7,'#506167');g.box(0,.078,i,9.7,.008,.012,'#506167');}
 for(const x of [-5.15,5.15]){g.box(x,.02,0,.12,.08,10.3,'#17242a');g.box(x,.07,0,.032,.02,9.9,'#799393');for(let i=-4;i<=4;i+=2){g.box(x-.015,.1,i,.14,.025,.6,'#efb459',.15);g.box(x,.15,i-.45,.17,.14,.14,'#72858b');}}
 for(const z of [-5.15,5.15]){g.box(0,.02,z,10.3,.08,.12,'#17242a');g.box(0,.07,z,9.9,.02,.032,'#698287');}g.mark(1,-3.6,.09,4.5,'#c4c8ac');
 for(const x of [-4.7,4.7])for(const z of [-4.7,4.7]){g.cylinder([x,.07,z],[x,.14,z],.13,'#131f25',10);g.cylinder([x,.14,z],[x,.16,z],.066,'#d1b672',8,.4);}
 const cells=new Set(machine.modules.map(keyOf)),valid=connected(machine.modules);
 if(grid)for(let y=0;y<9;y++)for(let x=0;x<9;x++){if(cells.has(keyOf({x,y,z:layer})))continue;const below=machine.modules.find(m=>m.x===x&&m.y===y&&(m.z||0)===layer-1),allowed=layer?below&&BY_ID[below.id].support:machine.modules.some(m=>!(m.z||0)&&Math.abs(m.x-x)+Math.abs(m.y-y)===1);if(!allowed)continue;const height=layer*gap+.1;g.box(x-4,height,y-4,.79,.025,.79,layer?'#365963':'#415457');g.box(x-4,height+.018,y-4,.22,.015,.035,'#cedbbc',.2);g.box(x-4,height+.018,y-4,.035,.015,.22,'#cedbbc',.2);bracket(g,x-4,height+.025,y-4,layer?'#69cfd3':'#a9b89d',.88);}
 g.machine(machine,{cutaway:full?2:layer,explode:explode?.7:0,invalid:valid,phase});
 if(focus){const m=machine.modules.find(m=>keyOf(m)===focus);if(m)bracket(g,m.x-4,(m.z||0)*gap+.65,m.y-4,'#6ee6dc',1.09);}
 if(hover&&hover.x>=0&&hover.x<9&&hover.y>=0&&hover.y<9){const x=hover.x-4,z=hover.y-4,h=layer*gap+.13,c=erase?'#ef8270':'#ffcf83';bracket(g,x,h,z,c,1.02);if(ghost&&!erase&&!cells.has(keyOf({...hover,z:layer}))){g.origin=[x,layer*gap,z];g.angle=rotation*Math.PI/2;g.module({id:selected},'#95b5b0');g.origin=[0,0,0];g.angle=0;}}
 return g;
}
function environment(arena){
 if(sceneCache.has(arena.id))return sceneCache.get(arena.id);const g=new Geometry(),[floor,wall,trim]=arena.palette,industrial=['foundry','furnace','scrapyard'].includes(arena.id);g.material=industrial||arena.id==='permafrost'?4:arena.id==='glacier'?6:5;
 // Keep the arena skin above its dark foundation. Coplanar surfaces here cause
 // z-fighting that reads as a rapidly flickering, diagonal ground shadow.
 g.box(0,-.3,0,57,.6,40,'#202b30');g.box(0,-.02,0,52.2,.08,34.8,floor);
 for(let z=-17;z<17;z+=4.35)for(let x=-26;x<26;x+=4.35){if(industrial){g.box(x+2.16,.005,z+2.16,4.28,.01,4.28,noise(x*30+z)>.5?floor:wall);g.box(x+2.16,.013,z+2.16,4.18,.008,4.18,floor);for(const dx of [.15,4.15])for(const dz of [.15,4.15])g.cylinder([x+dx,.019,z+dz],[x+dx,.024,z+dz],.035,'#778382',6);}else{for(let k=0;k<3;k++){const n=x*70+z*5+k;g.box(x+noise(n)*4.1,.009,z+noise(n+1)*4.1,.4+noise(n+2),.01,.028,wall);}}}
 for(const x of [-26.3,26.3]){g.bevel(x,.26,0,.55,.52,36,wall);g.box(x,.55,0,.14,.07,35,trim);}
 for(const z of [-17.6,17.6]){g.bevel(0,.26,z,53,.52,.55,wall);g.box(0,.55,z,52,.07,.14,trim);}
 for(let i=-24;i<=24;i+=4){for(const z of [-18.3,18.3]){g.box(i,.7,z,.28,1.4,.28,'#35434b');g.box(i,1.45,z,.25,.13,.25,trim,.7);g.cylinder([i,.9,z],[i+3.8,.9,z],.035,'#6c7c80',5);}}
 for(const x of [-24.5,24.5])for(const z of [-15.5,15.5]){g.box(x,.03,z,1.35,.05,1.35,'#26343c');g.cylinder([x,.05,z],[x,3.4,z],.08,wall,8);g.box(x,3.5,z,1.15,.16,.35,'#3b464a');g.box(x,3.42,z,.98,.04,.3,'#e4dbc0',.9);}
 if(industrial){for(const x of [-21,21]){g.box(x,.03,0,.58,.05,30,'#1f2c31');for(let z=-14;z<=14;z+=.55)g.box(x,.065,z,.6,.035,.12,'#687474');}for(const z of [-12.5,12.5])for(let x=-23;x<23;x+=2)g.box(x,.025,z,1,.015,.11,trim);}
 for(const [i,t] of arena.terrain.entries()){
  const x=wx(t.x+t.w/2),z=wz(t.y+t.h/2),w=t.w/CELL,d=t.h/CELL,col=colors[t.type];g.material=({snow:5,brine:8,ridge:5,sand:5,mud:9,ice:6,oil:8,lava:7,vent:2,coolant:6,rubble:5})[t.type];
  if(t.type==='ridge'){const nx=10,nz=8;for(let iz=0;iz<nz;iz++)for(let ix=0;ix<nx;ix++){const point=(a,b)=>{const px=t.x+t.w*a/nx,py=t.y+t.h*b/nz;return [wx(px),terrainAt(arena,px,py).height/CELL+.015,wz(py)];};g.quad(point(ix,iz),point(ix,iz+1),point(ix+1,iz+1),point(ix+1,iz),noise(ix+iz*10)>.3?col:wall);}continue;}
  g.bevel(x,.04,z,w,.06,d,col);
  if(t.type==='vent'){for(let k=-w/2+.2;k<w/2;k+=.35)g.box(x+k,.12,z,.14,.13,d-.12,'#5b6767');for(const zz of [z-d/2,z+d/2])g.box(x,.13,zz,w,.05,.11,'#d8ad57');}
  if(['sand','mud','rubble','snow'].includes(t.type))for(let n=0;n<35;n++){const px=x+(noise(n+i*100)-.5)*(w-.4),pz=z+(noise(n+51+i*100)-.5)*(d-.4);g.box(px,.08,pz,.15+noise(n+8)*.3,.04,.06,wall);}
  if(t.type==='oil')for(let n=0;n<8;n++)g.ring(x+(noise(n)-.5)*w*.65,.083,z+(noise(n+10)-.5)*d*.65,.25+noise(n+1)*.5,.05,'#425c60');
  if(t.type==='brine'){for(let n=0;n<7;n++)g.ring(x+(noise(n+i)-.5)*w*.7,.085,z+(noise(n+i+14)-.5)*d*.7,.18+noise(n+3)*.3,.028,'#a7bfa3',.1);}
  if(t.type==='coolant'){for(let n=0;n<8;n++)g.box(x-w*.4+n*w*.1,.09,z,w*.06,.02,d*.85,'#91d2b8',.08);}
  if(t.type==='ice')for(let n=0;n<9;n++){const px=x+(noise(n+i*20)-.5)*w*.8;g.cylinder([px,.085,z-d*.35],[px+.5,.085,z+d*.35],.02,'#c2eff3',5,.2);}
  if(t.type==='lava')for(let n=0;n<15;n++)g.box(x+(noise(n)-.5)*w*.9,.085,z+(noise(n+20)-.5)*d*.9,.6,.04,.07,'#f29c40',.65);
 }
 g.material=4;
 // Spawn pads are readable orientation marks, outside the central combat lanes.
 for(const [x,col] of [[wx(260),'#779f9b'],[wx(940),'#ac8275']]){g.ring(x,.023,0,4,.055,col);for(let z=-2.8;z<=2.8;z+=1.4)g.box(x,.025,z,3,.015,.08,col);}
 sceneCache.set(arena.id,g.vertices);return g.vertices;
}
export function battleScene(battle,{inspect=false,waypoint=true,reuse=false,quality=null}={}){
 const q=sceneQuality(quality),g=reuse?(battleSceneCache.get(battle)??new Geometry()):new Geometry();if(reuse)battleSceneCache.set(battle,g);g.vertices.length=0;g.origin=[0,0,0];g.angle=0;g.scale=1;g.detail=q.tier==='high'?'full':'reduced';g.material=4;g.staticVertices=environment(battle.arena);const [,wall,trim]=battle.arena.palette;
 for(const b of battle.arena.obstacles){const x=wx(b.x+b.w/2),z=wz(b.y+b.h/2),w=b.w/CELL,d=b.h/CELL,h=b.height/CELL;
  if(b.hp<=0){for(let i=0;i<5;i++)g.bevel(x+(noise(i+b.x)-.5)*w,.1,z+(noise(i+b.y)-.5)*d,.35,.2,.32,wall);continue;}
  g.bevel(x,h*.5,z,w,h,d,wall);g.box(x,h+.02,z,w-.12,.045,d-.12,'#46535a');
  for(let k=-w/2+.2;k<w/2;k+=.5)g.box(x+k,h+.055,z,.19,.045,d-.17,trim);
  for(const zz of [-d/2-.02,d/2+.02]){g.box(x,h*.45,z+zz,w-.12,.14,.035,'#2c383f');for(const xx of [-w*.35,w*.35])g.box(x+xx,h*.45,z+zz,.12,.22,.04,trim);}
  if(inspect){g.box(x,h+.25,z,w,.07,.1,'#202d34');g.box(x-w*.5+(Math.min(b.hp,800)/800)*w*.5,h+.25,z,Math.max(.02,Math.min(b.hp,800)/800*w),.075,.11,'#d1b16e');}
 }
 for(const t of battle.arena.terrain){if(t.type==='vent'&&battle.time%12>=8){const x=wx(t.x+t.w/2),z=wz(t.y+t.h/2);for(let i=0;i<q.ventParticles;i++){const px=x+(noise(i)-.5)*t.w/CELL*.8,pz=z+(noise(i+7)-.5)*t.h/CELL*.8,h=.3+Math.sin(battle.time*8+i)*.15;g.cylinder([px,.12,pz],[px,h+.6,pz],.09,'#f7ac47',7,.9);g.sphere(px,h+.7,pz,.16,'#a28665');}}}
 for(const s of battle.scorches)g.cylinder([wx(s.x),.018,wz(s.y)],[wx(s.x),.022,wz(s.y)],.26*s.scale,'#263030',10);
 const nodeColor=battle.node.owner===0?'#61d6c5':battle.node.owner===1?'#e18069':'#d8bb78';g.ring(0,.035,0,battle.node.r/CELL,.09,nodeColor,.45);g.ring(0,.042,0,1.25,.08,nodeColor,.45);g.ring(0,.042,0,1.48,.035,nodeColor,.3);g.box(0,.045,0,.1,.025,1.4,nodeColor,.5);g.box(0,.045,0,1.4,.025,.1,nodeColor,.5);
 if(battle.objective==='escort')for(const cargo of battle.escort||[]){const x=wx(cargo.x),z=wz(cargo.y),col=cargo.side?'#e18069':'#61d6c5';g.ring(x,.05,z,.95,.06,col,.8);g.bevel(x,.28,z,.62,.38,.62,'#46575a');g.box(x,.52,z,.32,.06,.72,col,.8);g.ring(x,.59,z,.42,.025,'#f5d27b',.75);const progress=Math.max(0,Math.min(1,cargo.progress||0)),start=cargo.side?1050:150,end=cargo.side?150:1050;g.box(wx(start+(end-start)*.5),.035,wz(cargo.y),Math.abs(end-start)/CELL*.5,.018,.035,col,.18);g.box(wx(start+(end-start)*progress),.055,wz(cargo.y),.12,.035,.12,col,.75);}
 for(const p of battle.pickups){const x=wx(p.x),z=wz(p.y);g.ring(x,.028,z,1.3,.05,'#6daf9e');if(battle.time<p.ready)continue;g.bevel(x,.3,z,.85,.5,.65,'#628e83');g.box(x,.57,z,.55,.045,.14,'#d4efd2',.7);g.box(x,.57,z,.14,.045,.5,'#d4efd2',.7);g.ring(x,.06,z,.72+.04*Math.sin(battle.time*3),.03,'#9affd8',.7);}
 for(const v of battle.vehicles){const activeModules=battle.active(v);
  for(let i=0;i<v.path.length;i+=3){const p=v.path[i];g.origin=[wx(p.x),.014,wz(p.y)];g.angle=p.a;for(const x of [-1.5,1.5])g.box(x,0,0,.24,.009,.5,'#29383a');}g.origin=[0,0,0];g.angle=0;
  const pos={x:wx(v.x),z:wz(v.y),h:v.ground/CELL};
  g.machine({...v,paint:v.side&&v.paint===battle.vehicles[0].paint?'#c36c5a':v.paint},{...pos,a:v.a,cx:v.cx,cy:v.cy,phase:(v.odometer||0)*.06,time:battle.time,damage:true});
  const color=v.side?'#ee9d81':'#76e4d3';g.ring(pos.x,pos.h+.06,pos.z,v.radius/CELL+.25,.045,color,.5);
  if(v.boost>0){g.origin=[pos.x,pos.h,pos.z];g.angle=v.a+(v.front||0)*Math.PI/2;for(const x of [-.6,.6])g.cylinder([x,.45,1.1],[x,.45,2.3+Math.sin(battle.time*30)*.25],.16,'#ffb253',7,1);g.origin=[0,0,0];g.angle=0;}
  if(v.brace>0)bracket(g,pos.x,pos.h+.14,pos.z,'#8faeec',v.radius/CELL*2.1);
  if(v.shield>0){const r=v.radius/CELL+.2;g.ring(pos.x,pos.h+.16,pos.z,r,.05,'#67ccb9',.6);for(let i=0;i<q.shieldRings;i++){const a=i*Math.PI/3;for(let j=0;j<q.shieldSegments;j++){const t=j*Math.PI/16,t2=(j+1)*Math.PI/16;g.cylinder([pos.x+Math.cos(a)*Math.cos(t)*r,pos.h+.2+Math.sin(t)*r,pos.z+Math.sin(a)*Math.cos(t)*r],[pos.x+Math.cos(a)*Math.cos(t2)*r,pos.h+.2+Math.sin(t2)*r,pos.z+Math.sin(a)*Math.cos(t2)*r],.012,'#64998f',4,.35);}}}
  if(v.vent>0)for(let i=0;i<q.ventParticles;i++){const age=(battle.time*2+i*.15)%1;g.sphere(pos.x+(noise(i)-.5)*(1+age),pos.h+1+age*1.3,pos.z+(noise(i+3)-.5)*(1+age),.09+age*.15,'#b2c9c7');}
  // Bounded cosmetic dust and damaged-system smoke never consume simulation RNG.
  if(!v.dead&&Math.hypot(v.vx,v.vy)>18&&!v.s.hovering){for(let i=0;i<q.trailParticles;i++){const age=(battle.time*1.8+i*.125)%1;const trail=.15+age*.5;g.sphere(pos.x-v.vx/CELL*trail+(noise(i)-.5)*1.2,pos.h+.08+age*.35,pos.z-v.vy/CELL*trail+(noise(i+8)-.5)*1.2,.035+age*.10,['sand','mud'].includes(v.terrain)?'#99856a':'#5b6668');}}
  for(const m of activeModules.filter(m=>m.hp/partSpec(m).hp<.3).slice(0,4)){const p=world(v,m);for(let i=0;i<q.damageSmokeParticles;i++){const age=(battle.time*.8+i/q.damageSmokeParticles)%1;g.sphere(wx(p.x)+Math.sin(i+age)*age*.25,p.h/CELL+1+age*1.3,wz(p.y)+age*.3,.05+age*.18,'#485153');}}
  if(inspect)for(const m of activeModules){const p=world(v,m),fraction=m.hp/partSpec(m).hp;g.box(wx(p.x),p.h/CELL+1.85,wz(p.y),.72,.07,.1,'#26323a');g.box(wx(p.x)-.36+fraction*.36,p.h/CELL+1.85,wz(p.y),Math.max(.01,fraction*.72),.08,.11,fraction<.35?'#ed9873':color,.5);}
  if(v.side===0&&v.waypoint&&waypoint){const x=wx(v.waypoint.x),z=wz(v.waypoint.y);g.ring(x,.08,z,.7,.07,'#79ebda',.8);g.ring(x,.08,z,1+.15*Math.sin(battle.time*5),.035,'#79ebda',.6);for(let i=1;i<13;i++){const t=i/13;g.box(pos.x+(x-pos.x)*t,.05,pos.z+(z-pos.z)*t,.07,.04,.07,'#75bfaf',.5);}}
 }
 for(const d of (q.debrisLimit===Infinity?battle.debris:battle.debris.slice(-q.debrisLimit))){if(d.age>15)continue;g.origin=[wx(d.x),(d.h||0)/CELL,wz(d.y)];g.angle=d.r;if(['wheel','track'].includes(d.id)){g.cylinder([-.14,.24,0],[.14,.24,0],.27,'#182126',10);g.cylinder([.15,.24,0],[.17,.24,0],.12,'#8c9696',8);}else if(BY_ID[d.id]?.rate){g.bevel(0,.15,0,.47,.24,.43,'#485257');g.cylinder([0,.26,-.1],[0,.26,-.75],.07,'#879595',8);}else{g.bevel(0,.15,0,.65,.15,.56,'#404d53');g.box(.16,.25,-.1,.23,.08,.23,'#87908b');}g.origin=[0,0,0];g.angle=0;}
 for(const mine of battle.mines){const x=wx(mine.x),z=wz(mine.y);g.cylinder([x,.04,z],[x,.2,z],.28,'#384b53',12);g.box(x,.24,z,.13,.05,.08,mine.side?'#ed8d6e':'#90f4d3',mine.age>.8?.85:.2);if(inspect)g.ring(x,.035,z,1.3,.03,mine.side?'#dc8a72':'#8bcfbc',.2);}
 for(const p of battle.projectiles){const x=wx(p.x),z=wz(p.y),h=p.h/CELL,col=p.emp?'#c99bf0':p.chill?'#b5eeff':p.kind==='plasma'?'#70ffca':p.kind==='railgun'?'#a2f9ef':p.burn?'#ff8833':'#ffe3a0';if(p.kind==='plasma'){g.sphere(x,h,z,.23,'#a2ffe4',1);g.ring(x,h,z,.33,.035,'#49d9b2',.8);}if(p.chill)g.sphere(x,h,z,.09,'#9edaff',.8);g.cylinder([x,h,z],[x-Math.cos(p.a)*(p.kind==='railgun'?1.3:.5),h-p.vh/p.speed*.5,z-Math.sin(p.a)*.5],p.burn?.12:p.kind==='mortar'?.10:.037,col,5,1);if(p.kind==='rocket')g.sphere(x-Math.cos(p.a)*.55,h,z-Math.sin(p.a)*.55,.09,'#ff9b42',1);}
 for(const e of battle.effects){if(q.effects==='minimal'&&['muzzle','shield','emp'].includes(e.type))continue;g.material=0;const t=e.life/e.max,x=wx(e.x),z=wz(e.y),h=(e.h||20)/CELL;if(e.type==='beam'){g.cylinder([x,h,z],[wx(e.tx),e.th/CELL,wz(e.ty)],.024,e.color,5,1);continue;}if(['blast','hit','intercept','reactive'].includes(e.type)){const spread=(1-t)*.9+.12;g.ring(x,.065,z,spread*e.scale,.035,e.color,.6);for(let i=0;i<(e.type==='blast'?7:3);i++){const a=i*2.4;g.cylinder([x+Math.cos(a)*spread*.35,h+(1-t)*.35,z+Math.sin(a)*spread*.35],[x+Math.cos(a)*spread*1.8,h+(1-t)*.8,z+Math.sin(a)*spread*1.8],.014*t,e.color,4,1);g.sphere(x+Math.cos(a)*spread,h+Math.sin(i)*spread+t*.5,z+Math.sin(a)*spread,.12*t*e.scale,i%2?'#ed9556':'#ffefbc',1);}}else if(e.type==='muzzle'){g.sphere(x,h,z,.18*t*e.scale,e.color,1);g.ring(x,h,z,(1-t)*.36+.08,.025,e.color,.9);}else if(['shield','emp'].includes(e.type))g.ring(x,h,z,(1-t)*1.1+.15,.05,e.color,.8);}
 for(const s of battle.smoke){const x=wx(s.x),z=wz(s.y),r=s.r/CELL;g.ring(x,.09,z,r,.055,'#a0ada8',.15);for(let i=0;i<q.smokeParticles;i++){const a=i*2.4,d=(.25+noise(i)*.7)*r;g.sphere(x+Math.cos(a+battle.time*.12)*d,.45+noise(i+50)*.8,z+Math.sin(a+battle.time*.12)*d,.3+noise(i+20)*.22,'#748b8b');}}
 if(battle.time>55){const r=battle.ring/CELL;g.ring(0,.09,0,r,.075,'#ed9b55',.85);for(let i=0;i<(q.tier==='high'?64:q.ringSegments);i++){const a=i*Math.PI/32;g.cylinder([Math.cos(a)*r,.1,Math.sin(a)*r],[Math.cos(a)*r,.7,Math.sin(a)*r],.025,'#e29d51',5,.75);}}
 return g;
}
