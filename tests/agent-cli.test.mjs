import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {startServer} from '../server.mjs';
import {PRESETS,packChallenge} from '../dist/data.mjs';
const exec=promisify(execFile),client=fileURLToPath(new URL('../examples/agent-client.mjs',import.meta.url));
test('external CLI validates, bookmarks, submits and retries one verified climate trial',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'wm-agent-cli-')),app=await startServer({port:0,database:':memory:',seed:false});
 t.after(async()=>{await app.close();assert.ok(dir.startsWith(join(tmpdir(),'wm-agent-cli-')));await rm(dir,{recursive:true,force:true});});
 const creator=app.store.session({name:'Creator'}),entrant=app.store.session({name:'Agent owner'}),token=app.store.agents(app.store.auth(entrant.token),{name:'CLI engineer'}).token;
 const bounty=app.store.create(creator.me.id,{title:'CLI climate test',entry:0,reward:5,maxPlatformFeeBps:250,hours:0,listed:false,blueprint:packChallenge(PRESETS[0],'sunscar',0)},randomUUID());
 const run=async(...args)=>{const r=await exec(process.execPath,[client,...args],{cwd:dir,env:{...process.env,WAR_MACHINE_URL:app.url,WAR_MACHINE_TOKEN:token},windowsHide:true});assert.ok(!r.stdout.includes(token));return JSON.parse(r.stdout);};
 await writeFile(join(dir,'request.json'),JSON.stringify({machine:PRESETS[7],bountyId:bounty.id}));
 const inspected=await run('validate','request.json','blueprint.json');assert.equal(inspected.valid,true);assert.equal(inspected.blueprint.a,'sunscar');
 assert.equal((await run('save',bounty.id)).saved,true);assert.equal((await run('bookmarks')).length,1);
 const attempt=await run('submit',bounty.id,'blueprint.json','0','250'),files=await readdir(join(dir,'work'));assert.equal(files.length,1);
 const retryRecord=await readFile(join(dir,'work',files[0]),'utf8');assert.ok(!retryRecord.includes(token));assert.equal((await run('retry',join('work',files[0]))).id,attempt.id);
 let receipt;for(let i=0;i<100;i++){receipt=app.store.attempt(attempt.id,entrant.me.id);if(['settled','refunded'].includes(receipt.status))break;await new Promise(r=>setTimeout(r,30));}
 assert.equal(receipt.status,'settled');assert.equal(app.store.db.prepare('SELECT COUNT(*) n FROM attempts').get().n,1);assert.equal(receipt.replay.arena,'sunscar');
 assert.equal((await run('unsave',bounty.id)).saved,false);assert.equal((await run('bookmarks')).length,0);
});
