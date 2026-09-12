import {Worker} from 'node:worker_threads';
import {writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {PRESETS,clone,normalizeRules,DEFAULT_RULES,packChallenge,validate,stats} from '../dist/data.mjs';
import {ENGINE_HASH} from '../server/store.mjs';
const rules=normalizeRules({...DEFAULT_RULES,mode:'unlimited'});
function makeDense(armed){const m=clone(PRESETS[0]);m.name=armed?'Heavy roof battery':'Dense structural tower';m.modules=[];for(let z=0;z<3;z++)for(let y=0;y<9;y++)for(let x=0;x<9;x++){if(z&&x===8&&y===8)continue;let id=!z&&x===4&&y===4?'core':!z&&x===8&&y===8?'hover':'deck';if(z===2)id=armed?(x%4===0?'reactor':x%4===1?'radiator':'gatling'):(x===4&&y===4?'laser':'deck');m.modules.push({id,x,y,r:0,...(z?{z}:{})});}return m;}
const rows=[];
for(const armed of [false,true]){const m=makeDense(armed),issues=validate(m,rules);if(issues.length)throw Error(issues.join(', '));const start=performance.now();const result=await new Promise(resolve=>{const w=new Worker(new URL('../server/battle-worker.mjs',import.meta.url),{workerData:{challenger:packChallenge(m,'salt',0,rules),defender:packChallenge(m,'salt',0,rules),arena:'salt',seed:8675309,swapSpawns:true,engineHash:ENGINE_HASH},resourceLimits:{maxOldGenerationSizeMb:192}});let done=false;const finish=x=>{if(done)return;done=true;clearTimeout(timer);void w.terminate();resolve(x);};const timer=setTimeout(()=>finish({error:'30 second worker timeout'}),30000);w.once('message',finish);w.once('error',e=>finish({error:e.message}));});rows.push({name:m.name,stats:stats(m),wallMs:performance.now()-start,...result});console.log(JSON.stringify({name:m.name,parts:m.modules.length,wallMs:rows.at(-1).wallMs,error:result.error,time:result.result?.time,winner:result.result?.winner}));}
const output=resolve(process.argv[2]||'work/large-battle-benchmark.json');mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify({engineHash:ENGINE_HASH,rows},null,2));
