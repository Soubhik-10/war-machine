import {fields,check,canonicalBlueprint,versions} from './store.mjs';
import {PRESETS,ARENAS,DEFAULT_RULES,MAX_MODULES,PARTS,clone,normalizeRules,packChallenge,unpackChallenge,stats,validate,terrainAt,environmentProfile} from '../dist/data.mjs';
import {engineeringReport} from '../dist/engineering.mjs';

// Agents may use readable part IDs; compact numeric tuples are only the share format.
export function inspectBlueprint(body,store){
 fields(body,['blueprint','machine','arena','rules','bountyId']);
 check(!!body.blueprint!==!!body.machine,'Supply either blueprint or machine.');
 let locked=null;
 if(body.bountyId){locked=store.bounty(body.bountyId);check(locked.compatible,'This contract uses an archived engine.',409);}
 try{
  let packed;
  if(body.machine){
   fields(body.machine,['name','paint','accent','glow','pattern','number','finish','front','modules','tactic','target','range','stance']);
   check(Array.isArray(body.machine.modules)&&body.machine.modules.length<=MAX_MODULES,'Supply at most 243 modules.');
   for(const m of body.machine.modules){fields(m,['id','x','y','z','r','u','c']);check(PARTS.some(p=>p.id===m.id),'Unknown part ID.');for(const [key,max] of [['x',8],['y',8],['z',2],['r',3]])if(m[key]!==undefined||key==='x'||key==='y')check(Number.isInteger(m[key])&&m[key]>=0&&m[key]<=max,'Invalid module '+key+'.');}
   const machine={...clone(PRESETS[0]),...body.machine};
   packed=packChallenge(machine,locked?.blueprint.a||body.arena||'foundry',0,locked?.blueprint.q||normalizeRules(body.rules||DEFAULT_RULES));
  }else{
   fields(body.blueprint,['v','n','p','t','g','d','s','a','e','b','q','fr','ac','gl','pt','no','f','m']);
   if(body.blueprint.q)fields(body.blueprint.q,['mode','combat','credits','parts','mass','weapons']);
   packed=locked?{...body.blueprint,a:locked.blueprint.a,q:locked.blueprint.q,b:locked.blueprint.b}:body.blueprint;
  }
  const c=unpackChallenge(packed,true),s=stats(c.machine),issues=validate(c.machine,c.rules),arena=ARENAS.find(a=>a.id===c.arena);
  const surfaces=[{type:'road',x:260,y:400,w:0,h:0},...arena.terrain].filter((p,i,all)=>all.findIndex(a=>a.type===p.type)===i).map(p=>{
   const t=p.type==='road'?{type:'road',friction:1,grip:1,cooling:1,heat:0,damage:0}:terrainAt(arena,p.x+p.w/2,p.y+p.h/2,9),env=environmentProfile(s,arena,t);
   return {type:p.type,speed:s.speed*arena.friction*env.traction,grip:env.grip,generation:s.power*env.power,cooling:s.cooling*env.cooling,ambientHeat:env.heat,environmentDrain:env.drain};
  });
  return {valid:!issues.length,issues,stats:s,rules:c.rules,arena:c.arena,blueprint:packChallenge(c.machine,c.arena,0,c.rules),machine:c.machine,environment:surfaces,advice:engineeringReport(c.machine,c.rules,c.arena),versions};
 }catch(e){if(e.status===409)throw e;return {valid:false,issues:[e.message],versions};}
}

export function practiceJob(body,store){
 fields(body,['challenger','defender','bountyId','seed']);
 check(!!body.defender!==!!body.bountyId,'Supply defender or bountyId.');
 const bounty=body.bountyId?store.bounty(body.bountyId):null;
 if(bounty)check(bounty.compatible,'This contract uses an archived engine.',409);
 const defender=canonicalBlueprint(bounty?.blueprint||body.defender);
 const challenger=canonicalBlueprint(body.challenger,defender);
 const seed=body.seed??42;check(Number.isInteger(seed)&&seed>=0&&seed<=4294967295,'Seed must be a uint32.');
 return {challenger,defender,arena:defender.a,seed,swapSpawns:!!(seed&1),engineHash:versions.hash};
}

export function discovery(){return {
 name:'War Machines',version:'2',mode:'demo',description:'Engineer autonomous machines with your own code or model. Same engine, rules and contract economy as human players.',
 base:'/api',openapi:'/api/openapi.json',instructions:'/agents.md',catalog:'/api/rules',
 workflow:['Read rules and terrain','Inspect a contract','Build using readable part IDs','Validate and obtain a packed blueprint','Practice for free locally or via the bounded practice API','Save an idempotency key and submit one official attempt','Poll its receipt; never submit a winner'],
 authentication:{guest:['catalog','contracts','validation','practice'],account:['create/cancel bounty','official entry','save bounty','history'],scheme:'Bearer',ownerOnly:['set spending caps','issue/revoke agent keys'],wallet:'TODO: Tempo wallet or passkey proof with a server-verified session'},
 payments:{enabled:false,mpp:false,tempoMainnet:false,currency:'demo credits',cashValue:false},
 invariants:{oneActiveAttemptPerBounty:true,creatorSetsEconomics:true,creatorSetsConstructionRules:true,results:'server generated',practicePays:false,officialSeed:'server chosen',externalAgentCodeRuns:'on the agent’s infrastructure'},versions
};}
