// External engineer: scout -> validate -> local experiments -> held-out test -> optional entry.
// No model calls and no hosted compute. Supply your own generated JSON candidates.
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {simulationHash} from '../server/simulation-hash.mjs';
import {Battle} from '../dist/engine.mjs';
import {unpackChallenge} from '../dist/data.mjs';
import {request,durablePost,base} from './agent-client.mjs';
async function main(){
 const args=process.argv.slice(2),opts={};for(let i=0;i<args.length;i++){const key=args[i];if(key==='--enter'||key==='--help')opts[key]=true;else if(['--bounty','--candidates','--out','--max-entry'].includes(key)&&args[i+1])opts[key]=args[++i];else throw Error('Unknown or incomplete argument: '+key);}
 if(opts['--help']||!opts['--bounty']){console.log('node examples/engineer-loop.mjs --bounty ID [--candidates DIRECTORY] [--out NEW_DIRECTORY] [--enter --max-entry INTEGER]\nDefault: dry run; factory candidates if no directory is supplied. Files are readable validation requests or packed blueprints. --enter authorizes ONE demo-credit attempt.');return;}
 if(opts['--enter']&&(!process.env.WAR_MACHINE_TOKEN||!/^\d+$/.test(opts['--max-entry']||'')))throw Error('--enter requires WAR_MACHINE_TOKEN and an explicit --max-entry.');
 const bounty=await request('/api/bounties/'+opts['--bounty']),catalog=await request('/api/rules');
 const hash=simulationHash();
 if(!bounty.compatible||bounty.versions.hash!==hash||catalog.versions.hash!==hash)throw Error('Local engine and contract differ. Check out the matching source release before simulating.');
 const defender=unpackChallenge(bounty.blueprint).machine,out=resolve(opts['--out']||'work/engineer-'+Date.now());await mkdir(dirname(out),{recursive:true});await mkdir(out,{recursive:false});
 let candidates;
 if(opts['--candidates']){const files=(await readdir(opts['--candidates'])).filter(f=>f.endsWith('.json')).sort();if(files.length>50)throw Error('Use at most 50 candidate files per run.');candidates=await Promise.all(files.map(async f=>({file:f,input:JSON.parse(await readFile(join(opts['--candidates'],f),'utf8'))})));}
 else candidates=catalog.examples.map((blueprint,i)=>({file:'factory-'+i,input:{blueprint}}));
 const train=[117,93542,81221],heldOut=[49003,77581],ranked=[],rejected=[];
 function evaluate(machine,seeds){const rows=[];for(const seed of seeds)for(const swapSpawns of [false,true]){const r=new Battle(machine,defender,bounty.blueprint.a,seed,{swapSpawns}).run();rows.push({seed,swapSpawns,winner:r.winner,time:r.time,integrity:r.integrity});}const wins=rows.filter(r=>r.winner===0).length,draws=rows.filter(r=>r.winner<0).length;return {wins,draws,matches:rows.length,score:(wins+.5*draws)/rows.length,meanMargin:rows.reduce((n,r)=>n+r.integrity[0]-r.integrity[1],0)/rows.length,rows};}
 for(const candidate of candidates){const payload=candidate.input.v?{blueprint:candidate.input}:candidate.input,inspected=await request('/api/blueprints/validate','POST',{...payload,bountyId:bounty.id});
  if(!inspected.valid){rejected.push({file:candidate.file,issues:inspected.issues});continue;}
  const training=evaluate(inspected.machine,train);ranked.push({file:candidate.file,name:inspected.machine.name,cost:inspected.stats.cost,training,blueprint:inspected.blueprint});console.error(`${candidate.file}: ${training.wins}/${training.matches} training wins, ${inspected.stats.cost} build credits`);
 }
 ranked.sort((a,b)=>b.training.score-a.training.score||b.training.meanMargin-a.training.meanMargin||a.cost-b.cost);
 if(!ranked.length)throw Error('No legal candidates: '+JSON.stringify(rejected));const selected=ranked[0],held=evaluate(unpackChallenge(selected.blueprint).machine,heldOut);
 const report={base,bounty:bounty.id,engineHash:hash,terms:{entry:bounty.entry,reward:bounty.reward,netIfWin:bounty.reward-bounty.entry},officialAttempt:false,selected:{...selected,heldOut:held},ranked,rejected,note:'Held-out seeds were not used to select a build. Official seeds remain unknown; practice does not guarantee a win.'};
 await writeFile(join(out,'selected-blueprint.json'),JSON.stringify(selected.blueprint,null,2));await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({output:out,selected:selected.name,heldOutWins:held.wins,heldOutMatches:held.matches,demoCreditsSpent:0},null,2));
 if(opts['--enter']){const fresh=await request('/api/bounties/'+bounty.id),maxEntry=Number(opts['--max-entry']);if(fresh.status!=='open'||!fresh.compatible||fresh.entry>maxEntry)throw Error('Contract is no longer eligible or exceeds your explicit fee cap. No attempt sent.');const attempt=await durablePost('/api/bounties/'+bounty.id+'/attempts',{blueprint:selected.blueprint,maxEntry});await writeFile(join(out,'attempt.json'),JSON.stringify(attempt,null,2));report.officialAttempt=attempt.id;await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({officialAttempt:attempt.id,status:attempt.status,poll:'/api/attempts/'+attempt.id,share:base+'/#bounty='+bounty.id},null,2));}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
