import {Geometry} from './renderer.mjs';
import {BY_ID,partSpec,keyOf,connected,LAYER_HEIGHT,terrainAt} from './data.mjs';
import {world,CELL} from './engine.mjs';
const colors={snow:'#c1d8dc',brine:'#577966',sand:'#bca47c',mud:'#4f4c39',oil:'#24363a',ice:'#82c3d0',lava:'#a74c29',vent:'#282c2b',ridge:'#ac8466',coolant:'#4b9f90',rubble:'#827463'};
const noise=n=>{const x=Math.sin(n*73.19+13)*4731;return x-Math.floor(x);};
const sceneCache=new Map(),battleSceneCache=new WeakMap(),workshopSceneCache=new WeakMap();
const FULL_QUALITY=Object.freeze({tier:'high',effects:'full',ventParticles:7,trailParticles:8,damageSmokeParticles:3,smokeParticles:16,shieldRings:6,shieldSegments:7,debrisLimit:Infinity,ringSegments:64,effectBudget:120,muzzleLayers:3,impactDebris:7,damageMarks:12});
// Profiles use the app's full/reduced vocabulary. Reduced retains one clear
// identity cue per weapon while bounding smoke, muzzle layers and debris.
const sceneQuality=q=>{const profile=q?{...FULL_QUALITY,...q}:FULL_QUALITY;return profile.effects==='reduced'?{...profile,effectBudget:Math.min(profile.effectBudget,48),muzzleLayers:Math.min(profile.muzzleLayers,1),impactDebris:Math.min(profile.impactDebris,3),damageMarks:Math.min(profile.damageMarks,6)}:profile;};
const wx=x=>(x-600)/CELL,wz=y=>(y-400)/CELL;
function bracket(g,x,y,z,color,width=1){for(const dx of [-1,1])for(const dz of [-1,1]){g.box(x+dx*width*.45,y,z+dz*width*.35,.055,.025,width*.25,color,.55);g.box(x+dx*width*.35,y,z+dz*width*.45,width*.25,.025,.055,color,.55);}}
function weaponMuzzle(g,e,t,x,z,h,q=FULL_QUALITY){const id=e.weapon||'cannon',a=Number.isFinite(e.angle)?e.angle:0,dx=Math.cos(a),dz=Math.sin(a),fade=t*t*(3-2*t),scale=e.scale||1,layers=q.muzzleLayers||1,line=(len,width,color,em=1,op=fade,side=0,up=0)=>g.cylinder([x+dz*side,h,z-dx*side],[x+dx*len+dz*side,h+up,z+dz*len-dx*side],width*scale,color,6,em,op),ring=(r,w,color,em=1,op=fade)=>g.ring(x,h,z,r*scale,w*scale,color,em,q.ringSegments,op),orb=(ox,oy,oz,r,color,em=1,op=fade)=>g.sphere(x+ox,h+oy,z+oz,r*scale,color,em,op);if(id==='cannon'){line(.56,.05,'#ffe0a6');ring(.22,.03,'#ffc878');return;}if(id==='machinegun'){line(.42,.018,'#ffd17b',1,fade,(e.pellets||0)%2?.08:-.08);return;}if(id==='gatling'){for(let i=0;i<layers;i++)line(.34+i*.08,.014,'#ffe19a',.9,fade,(i-1)*.07);ring(.18,.02,'#ffdc9f',.8);return;}if(id==='railgun'){line(1.3,.018,'#d9ffff',1,fade);line(-.5,.012,'#63d9e9',.75,fade);ring(.32,.025,'#a9ffff',.8);return;}if(id==='laser'){line(.95,.015,'#e5fff9',1,fade);ring(.2,.018,'#8affdf',.8);return;}if(id==='plasma'){orb(dx*.18,0,dz*.18,.19,'#b4ffe8',1);ring(.32,.035,'#55e7be',.8);return;}if(id==='rocket'||id==='mortar'){line(-.55,.07,'#ff9d4d',1,fade,0,id==='mortar'?.12:.02);orb(-dx*.42,-.02,-dz*.42,.10,'#ffb45e',1);ring(.18,.02,'#ffcb75',.8);return;}if(id==='flame'){for(let i=0;i<layers;i++)line(.55+i*.11,.04,'#ff7c35',.9,fade,(i-(layers-1)/2)*.09,.025);return;}if(id==='tesla'||id==='emp'){ring(.36,.035,id==='emp'?'#d6b3ff':'#8dfff1',.8);for(let i=0;i<layers;i++)line(.32+i*.12,.014,id==='emp'?'#c597f4':'#70ffe0',.9,fade,(i-1)*.12,.08*Math.sin(i));return;}if(id==='cryo'){ring(.28,.03,'#c4f6ff',.8);for(let i=0;i<layers+1;i++){const s=(i-layers*.5)*.12;line(.42,.014,'#9deaff',.9,fade,s,.03);}return;}if(id==='flak'||id==='shredder'){for(let i=0;i<layers+2;i++)line(.42+Math.abs(i-layers*.5)*.06,.018,id==='flak'?'#ffd795':'#d8f2e8',.85,fade,(i-layers*.5)*.1);return;}if(id==='mine'){orb(0,-.06,0,.13,'#8ce5d2',.8);ring(.28,.025,'#79ffe0',.7);return;}line(.46,.03,e.color||'#ffdd8c');orb(dx*.13,0,dz*.13,.12,e.color||'#ffdd8c');}

const clamp=(value,low=0,high=1)=>Math.max(low,Math.min(high,value));
const weaponColors={cannon:'#ffd18d',machinegun:'#ffe0a8',gatling:'#ffd06f',railgun:'#a5f7ff',laser:'#73ffe0',plasma:'#55e7be',rocket:'#ff9d4d',mortar:'#ffc36e',flame:'#ff7638',tesla:'#8cffe4',emp:'#d7a8ff',cryo:'#9eeaff',flak:'#ffd795',shredder:'#d8f2e8',mine:'#8ce5d2',interceptor:'#93ffef',ram:'#ffd59a'};
const weaponColor=(id,fallback='#efb575')=>weaponColors[id]||fallback;

// A tiny source-coded flash on the struck module makes weapon identity readable
// even when the projectile's impact is hidden by the chassis. Marks are brief,
// transient additive geometry (no decals or particle entities) and quality-capped.
function moduleDamageCue(g,v,m,q){
 const id=m.lastDamageBy,color=weaponColors[id];if(!(m.flash>0)||!color)return;
 const p=world(v,m),x=wx(p.x),z=wz(p.y),h=p.h/CELL+.73,fade=clamp(m.flash/.13),size=.17+fade*.09;
 const bar=(ox,oz,w,d,c=color)=>g.box(x+ox,h,z+oz,w,.018,d,c,.9,fade*.72);
 if(id==='railgun'||id==='laser'){bar(0,0,size*1.8,.035);if(q.damageMarks>6)bar(0,0,.035,size*1.8,'#f1fffe');return;}
 if(id==='tesla'||id==='emp'){bar(-size*.35,-size*.18,.045,size*.65);bar(size*.35,size*.18,.045,size*.65,id==='emp'?'#f1d9ff':'#d9fff8');return;}
 if(id==='cryo'){bar(-size*.5,0,.035,size);bar(size*.5,0,.035,size);bar(0,-size*.5,size,.035);bar(0,size*.5,size,.035);return;}
 if(id==='plasma'){bar(-size*.4,0,.07,size*.8);bar(size*.4,0,.07,size*.8,'#c7ffef');return;}
 // Kinetic, explosive and flame hits use a compact outward spark/scorch mark.
 bar(-size*.48,-size*.38,.07,.035);bar(size*.42,size*.3,.06,.035);
 if(id==='flame'&&q.damageMarks>6)bar(0,size*.42,size*.65,.045,'#ffb05a');
}

function weaponThermal(g,battle,v,m,q){
 const spec=partSpec(m);if(!spec?.rate)return;
 const local=clamp(Number(m.thermal)||0),chassis=clamp(((v.heat||0)-52)/54),heat=Math.max(local,chassis*.52);
 if(heat<.08)return;
 const p=world(v,m),x=wx(p.x),z=wz(p.y),h=p.h/CELL+.62,a=v.a+(m.r||0)*Math.PI/2-Math.PI/2,dx=Math.cos(a),dz=Math.sin(a),color=weaponColor(m.id),pulse=.82+.18*Math.sin(battle.time*(8+heat*6)+(m.uid||0)*.37),opacity=(.18+heat*.52)*pulse,r=.12+heat*.13;
 g.ring(x,h,z,r,.017+heat*.014,color,.78,Math.min(q.ringSegments,18),opacity);
 if(['laser','railgun','tesla','emp'].includes(m.id))g.cylinder([x,h,z],[x+dx*(.28+heat*.34),h+heat*.08,z+dz*(.28+heat*.34)],.012+heat*.008,color,5,1,opacity);
 else if(m.id==='plasma')g.sphere(x+dx*.13,h+heat*.08,z+dz*.13,.07+heat*.07,'#b7ffe9',1,opacity);
 else if(['rocket','mortar','cannon'].includes(m.id))g.cylinder([x-dx*.08,h,z-dz*.08],[x+dx*(.22+heat*.18),h+heat*.04,z+dz*(.22+heat*.18)],.018+heat*.018,color,6,1,opacity);
 else if(m.id==='flame')for(let i=-1;i<=1;i++)g.cylinder([x+dz*i*.045,h,z-dx*i*.045],[x+dx*(.2+heat*.32)+dz*i*.07,h+heat*.08,z+dz*(.2+heat*.32)-dx*i*.07],.013+heat*.013,'#ff974b',5,.95,opacity*.9);
 else g.sphere(x,h,z,.045+heat*.055,color,.9,opacity);
 if(v.coolingDown&&heat>.28)g.sphere(x-dx*.08,h+.14+heat*.12,z-dz*.08,.035+heat*.045,'#b8ded8',.45,.18+heat*.2);
}

function projectileEffect(g,p,q){
 const id=p.weapon||p.kind||'cannon',x=wx(p.x),z=wz(p.y),h=p.h/CELL,a=Number.isFinite(p.a)?p.a:0,dx=Math.cos(a),dz=Math.sin(a),color=weaponColor(id,p.emp?'#c99bf0':p.chill?'#b5eeff':p.burn?'#ff8833':'#ffe3a0'),trail=id==='railgun'?1.45:id==='rocket'?.82:id==='mortar'?.72:id==='flame'?.46:.54,vertical=Number.isFinite(p.speed)&&Math.abs(p.speed)>1e-5?p.vh/p.speed*trail:0,line=(length,width,col=color,side=0,rise=0,opacity=.86)=>g.cylinder([x+dz*side,h,z-dx*side],[x-dx*length+dz*side,h-vertical*(length/trail)+rise,z-dz*length-dx*side],width,col,5,1,opacity);
 if(id==='plasma'){g.sphere(x,h,z,.24,'#a2ffe4',1,.86);g.ring(x,h,z,.34,.035,'#49d9b2',.85,Math.min(q.ringSegments,18),.76);line(.38,.052,'#7ffff0',0,0,.65);return;}
 if(id==='rocket'){g.sphere(x-dx*.48,h,z-dz*.48,.105,'#ff9b42',1,.88);line(.72,.075,'#ffb45e',0,0,.8);if(q.effects!=='reduced')g.ring(x-dx*.58,h,z-dz*.58,.12,.018,'#ffcd7d',.65,Math.min(q.ringSegments,16),.58);return;}
 if(id==='mortar'){g.sphere(x,h,z,.12,'#ffdb9a',.9,.8);line(.72,.072,'#f5b45f',0,.02,.76);return;}
 if(id==='flame'){for(let i=-1;i<=1;i++)line(.45+Math.abs(i)*.08,.035,'#ff813b',i*.055,.025*(1-Math.abs(i)*.3),.72);return;}
 if(id==='cryo'){g.sphere(x,h,z,.1,'#c6f6ff',.9,.82);line(.5,.032,'#9deaff',0,.015,.8);if(q.effects!=='reduced')g.ring(x,h,z,.17,.018,'#dffcff',.65,Math.min(q.ringSegments,16),.55);return;}
 if(id==='railgun'){line(1.45,.028,'#d9ffff',0,0,.92);line(.92,.055,'#72dce8',0,0,.42);return;}
 if(['machinegun','gatling','flak','shredder'].includes(id)){line(.54,.019,color,0,0,.86);return;}
 if(id==='mine'){g.sphere(x,h,z,.13,'#8ce5d2',.8,.76);g.ring(x,h,z,.22,.022,'#79ffe0',.7,Math.min(q.ringSegments,16),.68);return;}
 line(trail,.038,color,0,0,.84);
}

function beamEffect(g,e,t,x,z,h,q){
 const id=e.weapon||'laser',tx=wx(e.tx),tz=wz(e.ty),th=Number.isFinite(e.th)?e.th/CELL:h,color=weaponColor(id,e.color),dx=tx-x,dz=tz-z,d=Math.hypot(dx,dz)||1;
 if(id==='tesla'){
  const segments=q.effects==='reduced'?3:5;let px=x,py=h,pz=z;
  for(let i=1;i<=segments;i++){const f=i/segments,j=i===segments?0:(noise((e.x||0)*.017+(e.y||0)*.023+i*17)-.5)*.34,nx=x+dx*f-dz/d*j,ny=h+(th-h)*f+(i===segments?0:Math.sin(i*2.3)*.11),nz=z+dz*f+dx/d*j;g.cylinder([px,py,pz],[nx,ny,nz],.024,'#a9fff1',5,1,t);px=nx;py=ny;pz=nz;}
  return;
 }
 if(id==='emp'){g.cylinder([x,h,z],[tx,th,tz],.045,'#bba0f4',6,.5,t*.72);g.cylinder([x,h,z],[tx,th,tz],.016,'#f0ddff',5,1,t);return;}
 if(id==='laser'){g.cylinder([x,h,z],[tx,th,tz],.044,'#65f2d3',6,.45,t*.75);g.cylinder([x,h,z],[tx,th,tz],.014,'#effffb',5,1,t);return;}
 if(id==='interceptor'){g.cylinder([x,h,z],[tx,th,tz],.036,'#93ffef',5,.9,t);return;}
 g.cylinder([x,h,z],[tx,th,tz],.024,color,6,1,t);
}

function impactEffect(g,e,t,x,z,h,q){
 const id=e.weapon||(e.type==='intercept'?'interceptor':e.type==='reactive'?'reactive':'cannon'),color=weaponColor(id,e.color||'#efb575'),scale=e.scale||1,spread=((1-t)*.9+.12)*scale,debris=q.effects==='reduced'?Math.min(2,q.impactDebris):q.impactDebris,segments=Math.min(q.ringSegments,q.effects==='reduced'?14:24),rays=(count,len,width,col=color,lift=.42)=>{for(let i=0;i<count;i++){const a=i*2.399+(noise((e.x||0)*.011+(e.y||0)*.019+i*13)-.5)*.55,grow=len*(.65+noise(i+31)*.35);g.cylinder([x+Math.cos(a)*spread*.18,h+(1-t)*.12,z+Math.sin(a)*spread*.18],[x+Math.cos(a)*grow,h+(1-t)*lift,z+Math.sin(a)*grow],width,col,4,1,t);}};
 const ring=(radius,width,col=color,em=.78,opacity=t)=>g.ring(x,.065,z,radius,width,col,em,segments,opacity);
 if(id==='laser'){ring(spread*.56,.022,'#73ffe0',.9);ring(spread*.24,.012,'#eafffb',1,t*.9);g.cylinder([x,h-.06,z],[x,h+.28+(1-t)*.18,z],.012,'#eafffb',5,1,t);return;}
 if(id==='plasma'){ring(spread*1.08,.042,'#55e7be',.9);g.sphere(x,h,z,(.18+(1-t)*.62)*scale,'#a2ffe4',.78,t*.86);rays(Math.min(4,debris),spread*.85,.015,'#8fffe2',.35);return;}
 if(['rocket','mortar','mine'].includes(id)){ring(spread*1.25,.05,'#ffb45e',.9);ring(spread*.62,.028,'#ffe2a4',.95,t*.86);g.sphere(x,h,z,(.25+(1-t)*.66)*scale,'#ff9b48',.8,t*.82);rays(Math.min(4,debris),spread*1.75,.021,'#ffd08a',.72);return;}
 if(id==='flame'){ring(spread*.75,.035,'#ff813b',.86);g.sphere(x,h,z,(.15+(1-t)*.35)*scale,'#ff9e45',.68,t*.76);rays(Math.min(4,debris),spread*1.15,.018,'#ffb05a',.48);return;}
 if(id==='cryo'){ring(spread*.72,.027,'#bff6ff',.9);g.sphere(x,h,z,.13+(1-t)*.2,'#8edcf6',.65,t*.72);rays(Math.min(5,debris),spread*1.18,.012,'#d8fbff',.62);return;}
 if(['tesla','emp'].includes(id)){ring(spread*.92,.032,id==='emp'?'#d7a8ff':'#8cffe4',.9);rays(Math.min(5,debris),spread*1.35,.015,id==='emp'?'#edd7ff':'#b3fff3',.5);return;}
 if(id==='railgun'){ring(spread*.82,.027,'#a5f7ff',.95);rays(Math.min(4,debris),spread*1.7,.013,'#e5ffff',.24);return;}
 if(['machinegun','gatling','flak','shredder'].includes(id)){ring(spread*.52,.018,color,.75);rays(Math.min(4,debris),spread*.98,.011,'#ffe8b5',.26);return;}
 ring(spread,.035,color,.78);if(id==='cannon')g.sphere(x,h,z,(.14+(1-t)*.28)*scale,'#ffd18d',.58,t*.68);rays(Math.min(4,debris),spread*1.35,.014,color,.45);
}

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
 const q=sceneQuality(quality),g=reuse?(battleSceneCache.get(battle)??new Geometry()):new Geometry();if(reuse)battleSceneCache.set(battle,g);g.vertices.length=0;g.effectVertices.length=0;g.additiveVertices.length=0;g.origin=[0,0,0];g.angle=0;g.scale=1;g.detail=q.tier==='high'?'full':'reduced';g.material=4;g.staticVertices=environment(battle.arena);const [,wall,trim]=battle.arena.palette;
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
   g.beginEffects('additive');
   for(const m of activeModules.filter(m=>m.flash>0&&weaponColors[m.lastDamageBy]).slice(0,q.damageMarks))moduleDamageCue(g,v,m,q);
   for(const m of activeModules)weaponThermal(g,battle,v,m,q);
   const heatSignal=clamp(((v.heat||0)-60)/40);
   if(heatSignal>0){const thermalColor=v.overheated?'#ff6464':v.coolingDown?'#ff9855':'#ffd07e';g.ring(pos.x,pos.h+.14,pos.z,v.radius/CELL+.38+heatSignal*.24,.035+heatSignal*.026,thermalColor,.82,Math.min(q.ringSegments,24),.22+heatSignal*.48);if(v.coolingDown)g.ring(pos.x,pos.h+.18,pos.z,v.radius/CELL+.7+Math.sin(battle.time*7)*.12,.018,'#ffe0a8',.72,Math.min(q.ringSegments,20),.26);}
   g.endEffects();
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
  g.beginEffects('additive');for(const p of battle.projectiles)projectileEffect(g,p,q);g.endEffects();
  g.beginEffects('additive');for(const e of battle.effects.slice(-q.effectBudget)){g.material=0;const t=Math.max(0,Math.min(1,e.life/Math.max(.001,e.max))),x=wx(e.x),z=wz(e.y),h=(e.h||20)/CELL;if(e.type==='beam'){beamEffect(g,e,t,x,z,h,q);continue;}if(['blast','hit','intercept','reactive'].includes(e.type))impactEffect(g,e,t,x,z,h,q);else if(e.type==='muzzle')weaponMuzzle(g,e,t,x,z,h,q);else if(['shield','emp'].includes(e.type)){g.ring(x,h,z,(1-t)*1.1+.15,.05,e.color,.8,q.ringSegments,t);if(e.type==='emp')for(let i=0;i<(q.effects==='reduced'?1:3);i++){const a=i*2.1+t*3;g.cylinder([x,h,z],[x+Math.cos(a)*(1-t)*.8,h+.2*Math.sin(a),z+Math.sin(a)*(1-t)*.8],.018,e.color,5,.7,t);}}}g.endEffects();
  g.beginEffects('alpha');for(const s of battle.smoke){const x=wx(s.x),z=wz(s.y),r=s.r/CELL,fade=Math.max(0,Math.min(1,s.life/Math.max(.001,s.max)));g.ring(x,.09,z,r,.055,'#a0ada8',.15,q.ringSegments,fade*.28);for(let i=0;i<q.smokeParticles;i++){const a=i*2.4,d=(.25+noise(i)*.7)*r;g.sphere(x+Math.cos(a+battle.time*.12)*d,.45+noise(i+50)*.8,z+Math.sin(a+battle.time*.12)*d,.3+noise(i+20)*.22,'#748b8b',.05,fade*.22);}}g.endEffects();
 if(battle.time>55){const r=battle.ring/CELL;g.ring(0,.09,0,r,.075,'#ed9b55',.85);for(let i=0;i<(q.tier==='high'?64:q.ringSegments);i++){const a=i*Math.PI/32;g.cylinder([Math.cos(a)*r,.1,Math.sin(a)*r],[Math.cos(a)*r,.7,Math.sin(a)*r],.025,'#e29d51',5,.75);}}
 return g;
}
