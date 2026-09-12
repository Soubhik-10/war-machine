import {parentPort,workerData} from 'node:worker_threads';
import {simulationHash} from './simulation-hash.mjs';
import {Battle} from '../dist/engine.mjs';
import {unpackChallenge} from '../dist/data.mjs';
const j=workerData;
try{
 const hash=simulationHash();
 if(j.engineHash!==hash)throw Error('Engine changed during deployment.');
 const battle=new Battle(unpackChallenge(j.challenger).machine,unpackChallenge(j.defender).machine,j.arena,j.seed,{mode:'auto',swapSpawns:j.swapSpawns});
 for(let tick=0;tick<6002&&!battle.result;tick++)battle.step();
 if(!battle.result)throw Error('Simulation exceeded its tick budget.');
 parentPort.postMessage({result:{...battle.result,telemetry:battle.vehicles.map(v=>({shots:v.shots,hits:v.hits,overheats:v.overheatCount,detached:v.detached,intercepts:v.intercepts,pickups:v.pickups})),events:battle.events.slice(-60)}});
}catch{parentPort.postMessage({error:'Simulation failed; entry refunded.'});}
