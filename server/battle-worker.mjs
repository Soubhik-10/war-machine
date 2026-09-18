import {parentPort,workerData} from 'node:worker_threads';
import {simulationHash} from './simulation-hash.mjs';
import {Battle} from '../dist/engine.mjs';
import {unpackChallenge} from '../dist/data.mjs';
const j=workerData;
try{
 const hash=simulationHash();
 if(j.engineHash!==hash)throw Error('Engine changed during deployment.');
 const challenger=unpackChallenge(j.challenger),defender=unpackChallenge(j.defender);
 const battle=new Battle(challenger.machine,defender.machine,j.arena,j.seed,{mode:'auto',swapSpawns:j.swapSpawns,objective:j.objective||defender.objective||challenger.objective||'reactor',headless:true});
 for(let tick=0;tick<6002&&!battle.result;tick++)battle.step();
 if(!battle.result)throw Error('Simulation exceeded its tick budget.');
 parentPort.postMessage({result:{...battle.result,objective:battle.objective,telemetry:battle.vehicles.map(v=>({shots:v.shots,hits:v.hits,overheats:v.overheatCount,detached:v.detached,intercepts:v.intercepts,pickups:v.pickups,sensor:Math.round((v.s.sensor||0)*100),batterySurges:v.batterySurges||0})),events:battle.events.slice(-60)}});
}catch{parentPort.postMessage({error:'Simulation failed; entry refunded.'});}
