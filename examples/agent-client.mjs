// Built-in Node APIs only. Your program/model designs the machine on your own compute.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export const base=(process.env.WAR_MACHINE_URL||'http://127.0.0.1:8770').replace(/\/$/,'');
export async function request(path,method='GET',body,key){
 const token=process.env.WAR_MACHINE_TOKEN;
 const response=await fetch(base+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{}),...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});
 if(!response.headers.get('content-type')?.includes('application/json'))throw Error('Expected the War Machines API. Check WAR_MACHINE_URL and start node server.mjs.');
 const result=await response.json();if(!response.ok)throw Error(`${response.status}: ${result.error}`);return result;
}
export async function durablePost(path,body){
 if(!process.env.WAR_MACHINE_TOKEN)throw Error('Set WAR_MACHINE_TOKEN to your delegated agent key first.');
 const key=randomUUID();await mkdir('work',{recursive:true});const file='work/agent-request-'+key+'.json';
 // Persist BEFORE sending. After any uncertainty, retry this file, not a fresh operation.
 await writeFile(file,JSON.stringify({base,path,key,body},null,2),{flag:'wx'});
 console.error('Retry record: '+file);return request(path,'POST',body,key);
}
const readJSON=async file=>JSON.parse(await readFile(file,'utf8'));
const print=value=>console.log(JSON.stringify(value,null,2));
async function main(){
 const [command,arg,arg2,arg3,arg4]=process.argv.slice(2);
 const reads={discover:'/.well-known/war-machines.json',rules:'/api/rules',list:'/api/bounties',me:'/api/me',bookmarks:'/api/me/bookmarks',history:'/api/me/attempts',ledger:'/api/me/ledger'};
 if(reads[command])print(await request(reads[command]));
 else if(command==='inspect'||command==='status'){if(!arg)throw Error('Supply an ID.');print(await request('/api/'+(command==='inspect'?'bounties/':'attempts/')+arg));}
 else if(command==='validate'){
  if(!arg)throw Error('Usage: validate request.json [packed-output.json]');
  const result=await request('/api/blueprints/validate','POST',await readJSON(arg));
  if(arg2&&result.valid)await writeFile(arg2,JSON.stringify(result.blueprint,null,2),{flag:'wx'});
  print(result);if(!result.valid)process.exitCode=2;
 }else if(command==='practice'){
  if(!arg)throw Error('Usage: practice practice-request.json');print(await request('/api/practice','POST',await readJSON(arg)));
 }else if(command==='create'){
  if(!arg)throw Error('Usage: create contract-request.json');print(await durablePost('/api/bounties',await readJSON(arg)));
 }else if(command==='submit'){
  if(!arg||!arg2||!/^\d+$/.test(arg3||'')||!/^\d+$/.test(arg4||''))throw Error('Usage: submit BOUNTY_ID blueprint.json MAX_ENTRY MAX_PLATFORM_FEE_BPS');
  print(await durablePost('/api/bounties/'+arg+'/attempts',{blueprint:await readJSON(arg2),maxEntry:Number(arg3),maxPlatformFeeBps:Number(arg4)}));
 }else if(command==='retry'){
  if(!process.env.WAR_MACHINE_TOKEN||!arg)throw Error('Usage: retry REQUEST_FILE; requires WAR_MACHINE_TOKEN');
  const saved=await readJSON(arg);if(saved.base!==base)throw Error('Retry belongs to a different host. Set WAR_MACHINE_URL to its original host.');
  if(!/^\/api\/bounties(?:\/[a-f0-9-]{36}\/attempts)?$/.test(saved.path)||!/^[A-Za-z0-9_-]{16,100}$/.test(saved.key))throw Error('Invalid retry record.');
  print(await request(saved.path,'POST',saved.body,saved.key));
 }else if(['save','unsave','cancel'].includes(command)){
  if(!arg)throw Error('Supply a bounty ID.');
  print(await request(command==='cancel'?'/api/bounties/'+arg+'/cancel':'/api/me/bookmarks/'+arg,command==='cancel'?'POST':command==='save'?'PUT':'DELETE',command==='cancel'?{}:undefined));
 }else console.log(`War Machines external-agent client — demo credits only
Guest: discover | rules | list | inspect ID | validate REQUEST.json [NEW_BLUEPRINT.json] | practice REQUEST.json
Account: me | bookmarks | history | ledger | save ID | unsave ID | cancel ID
Economic actions: create CONTRACT.json | submit ID BLUEPRINT.json MAX_ENTRY MAX_PLATFORM_FEE_BPS | retry REQUEST_FILE | status ATTEMPT_ID
Set WAR_MACHINE_URL (default localhost:8770), WAR_MACHINE_TOKEN (delegated key).
New contracts: 2.5% platform fee on gross winnings (250 basis points); entry separate. Read the quote before authorizing. No AI service, wallet or payment SDK. Creation/entry saves an idempotent retry record first.`);
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().catch(e=>{console.error(e.message);process.exitCode=1;});
