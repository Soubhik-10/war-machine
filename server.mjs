import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {Worker} from 'node:worker_threads';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {Store,ApiError,check,ENGINE_HASH} from './server/store.mjs';
import {CLIENT_ENGINE_HASH} from './dist/release.mjs';
import {inspectBlueprint,practiceJob,discovery} from './server/agent-api.mjs';
import {OPENAPI} from './server/api-spec.mjs';
import {runtimeConfig} from './server/runtime-config.mjs';

const root=fileURLToPath(new URL('./',import.meta.url)),dist=resolve(root,'dist');
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.json':'application/json','.md':'text/plain; charset=utf-8'};
export async function startServer({port=8770,host='127.0.0.1',database,seed=true,workers=true,config}={}){
 check(CLIENT_ENGINE_HASH===ENGINE_HASH,'Simulation files changed. Run node scripts/stamp-release.mjs before starting this release.',503);
 const runtime=config||runtimeConfig(process.env,{root,database});database=runtime.database;
 if(database!==':memory:')await mkdir(resolve(database,'..'),{recursive:true});
 const store=new Store(database,{seed,mode:runtime.mode,environment:runtime.environment,payment:runtime}),limits=new Map();let tempoAuth=null,payments=null,payouts=null;if(runtime.origin){const [{createTempoAuth},{createTempoPayments,createPayoutReconciler}]=await Promise.all([import('./server/tempo-auth.mjs'),import('./server/tempo-payments.mjs')]);tempoAuth=createTempoAuth(store,runtime);payments=createTempoPayments(store,runtime);payouts=createPayoutReconciler(store,runtime);}let worker=null,practiceWorker=null,stopping=false;
 function limited(ip,kind,max){const k=ip+':'+kind,now=Date.now(),old=limits.get(k),v=old&&old.until>now?old:{count:0,until:now+60000};check(++v.count<=max,'Too many requests. Try again in a minute.',429);limits.set(k,v);if(limits.size>20000)for(const [key,value]of limits)if(value.until<now)limits.delete(key);}
 function pump(){if(stopping||worker||practiceWorker)return;try{store.expire();if(!workers)return;const job=store.claim();if(!job)return;let settled=false;const w=new Worker(new URL('./server/battle-worker.mjs',import.meta.url),{workerData:job,resourceLimits:{maxOldGenerationSizeMb:192}});worker=w;
  const timer=setTimeout(()=>finish(null,'Simulation timed out; entry refunded.'),30000);
  function finish(result,error){if(settled)return;settled=true;clearTimeout(timer);try{store.finish(job,result,error);}catch(e){console.error('Settlement deferred for recovery:',e.message);}void w.terminate();worker=null;setImmediate(pump);}
  w.once('message',m=>finish(m.result,m.error));w.once('error',()=>finish(null,'Simulation worker failed; entry refunded.'));w.once('exit',code=>{if(!settled)finish(null,'Simulation interrupted; entry refunded.');});
 }catch(e){console.error('Arena queue:',e.message);}}
 function practice(job){
  check(!worker&&!practiceWorker&&!store.db.prepare("SELECT id FROM attempts WHERE status IN ('queued','running') LIMIT 1").get(),'Official trials have priority. Retry free practice later or simulate locally.',429);
  return new Promise((resolve,reject)=>{const w=new Worker(new URL('./server/battle-worker.mjs',import.meta.url),{workerData:job,resourceLimits:{maxOldGenerationSizeMb:192}});practiceWorker=w;let finished=false;
   const finish=(result,error)=>{if(finished)return;finished=true;clearTimeout(timeout);practiceWorker=null;void w.terminate();setImmediate(pump);error?reject(new ApiError(503,error)):resolve({kind:'practice',official:false,creditsChanged:0,versions:discovery(runtime).versions,result});};
   const timeout=setTimeout(()=>finish(null,'Free practice exceeded its 30-second limit. No credits were spent.'),30000);
   w.once('message',m=>finish(m.result,m.error));w.once('error',()=>finish(null,'Practice worker failed. No credits were spent.'));w.once('exit',()=>finish(null,'Practice interrupted. No credits were spent.'));
  });
 }
 const timer=setInterval(pump,500);timer.unref();
 const payoutTimer=payouts?setInterval(()=>void payouts.once().catch(e=>console.error('Payout reconciliation paused:',e.message)),3000):null;payoutTimer?.unref();
 const server=createServer(async(req,res)=>{
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
  const fetchRequest=(path,body)=>new Request(new URL(path,runtime.origin||'http://localhost'),{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:JSON.stringify(body||{})})});
  const forward=async response=>{const headers=Object.fromEntries(response.headers);const cookies=response.headers.getSetCookie?.()||[];if(cookies.length)headers['set-cookie']=cookies;res.writeHead(response.status,headers);res.end(Buffer.from(await response.arrayBuffer()));};
  const paidResponse=async(result,status,data)=>forward(result.withReceipt(new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}})));
  try{
   const url=new URL(req.url,'http://localhost'),path=url.pathname,method=req.method;
   if(path==='/.well-known/war-machines.json'&&method==='GET')return send(200,discovery(runtime));
   res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
   if(!path.startsWith('/api/')){
    check(method==='GET'||method==='HEAD','Method not allowed.',405);const decoded=decodeURIComponent(path),file=resolve(dist,'.'+(decoded==='/'?'/index.html':decoded));check(file.startsWith(dist+sep)&&!decoded.split('/').some(p=>p.startsWith('.')),'Not found.',404);
    let data;try{data=await readFile(file);}catch{throw new ApiError(404,'File not found.');}
    res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(method==='HEAD'?undefined:data);return;
   }
   limited(req.socket.remoteAddress,'api',240);
   if(req.headers.origin){const origin=new URL(req.headers.origin);check(origin.host===req.headers.host,'Cross-origin API requests are not allowed.',403);}
   let body={};if(['POST','PATCH'].includes(method)){
    check(req.headers['content-type']?.split(';')[0]==='application/json','Use application/json.',415);let size=0,chunks=[];
    for await(const chunk of req){size+=chunk.length;if(size>65536){send(413,{error:'Request exceeds 64 KiB.'});req.destroy();return;}chunks.push(chunk);}
    try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new ApiError(400,'Invalid JSON.');}
   }
   if(tempoAuth&&path.startsWith('/api/auth/')){
    limited(req.socket.remoteAddress,'auth',30);
    if(path==='/api/auth/session'&&method==='GET'){const identity=await tempoAuth.session(fetchRequest(path));return send(200,{authenticated:!!identity,identity});}
    const target=path==='/api/auth/verify'?'/api/auth':path,handler=path.startsWith('/api/auth/passkey/')?tempoAuth.passkey:tempoAuth.wallet;
    return forward(await handler.fetch(fetchRequest(target,body)));
   }
   const token=req.headers.authorization?.replace(/^Bearer /,''),publicRoute=(method==='GET'&&!path.startsWith('/api/me')&&!path.startsWith('/api/agents'))||['/api/session','/api/blueprints/validate','/api/practice'].includes(path);let auth=null;
   if(token){try{auth=store.auth(token);}catch(e){if(!tempoAuth&&!publicRoute)throw e;}}
   if(!auth&&tempoAuth){const identity=await tempoAuth.session(fetchRequest(path));if(identity)auth={account:identity.account,role:'owner',identity};else if(token&&!publicRoute)throw new ApiError(401,'Invalid or revoked session.');}
   const requireAuth=()=>{check(auth,'Sign in for bounty actions. Building and practice are open to guests.',401);return auth;},key=req.headers['idempotency-key'];
   store.expire();
   if(method==='GET'&&path==='/api/rules')return send(200,store.catalog());
   if(method==='GET'&&path==='/api/openapi.json')return send(200,OPENAPI);
   if(method==='POST'&&path==='/api/blueprints/validate')return send(200,inspectBlueprint(body,store));
   if(method==='POST'&&path==='/api/practice'){limited(req.socket.remoteAddress,'practice',4);return send(200,await practice(practiceJob(body,store)));}
   if(method==='GET'&&path==='/api/health')return send(200,{ok:true,app:'war-machines',mode:runtime.mode,paymentsEnabled:runtime.paymentsEnabled,engineHash:ENGINE_HASH});
   if(method==='POST'&&path==='/api/session'){check(runtime.mode==='demo','Anonymous demo profiles are disabled in Tempo mainnet mode. Use verified wallet or passkey login.',403);limited(req.socket.remoteAddress,'profiles',8);return send(201,store.session(body));}
   if(path==='/api/me'&&method==='GET')return send(200,store.me(requireAuth().account));
   if(path==='/api/me'&&method==='PATCH')return send(200,store.settings(requireAuth(),body));
   if(path==='/api/me/ledger'&&method==='GET')return send(200,store.ledger(requireAuth().account));
    if(path==='/api/me/bookmarks'&&method==='GET')return send(200,store.bookmarks(requireAuth().account));
    const bookmark=path.match(/^\/api\/me\/bookmarks\/([a-f0-9-]{36})$/);if(bookmark&&['PUT','DELETE'].includes(method))return send(200,store.bookmark(requireAuth(),bookmark[1],method==='PUT'));
    if(path==='/api/me/builds'&&method==='GET')return send(200,store.builds(requireAuth()));
    if(path==='/api/me/builds'&&method==='POST')return send(201,store.saveBuild(requireAuth(),body,key));
    const savedBuild=path.match(/^\/api\/me\/builds\/([a-f0-9-]{36})$/);if(savedBuild&&method==='PATCH')return send(200,store.updateBuild(requireAuth(),savedBuild[1],body,key));if(savedBuild&&method==='DELETE')return send(200,store.deleteBuild(requireAuth(),savedBuild[1]));
   if(path==='/api/me/attempts'&&method==='GET')return send(200,store.db.prepare('SELECT id FROM attempts WHERE account=? ORDER BY created DESC LIMIT 30').all(requireAuth().account).map(a=>store.attempt(a.id,auth.account)));
   if(path==='/api/agents'&&['GET','POST'].includes(method))return send(200,store.agents(requireAuth(),method==='POST'?body:undefined));
   let match=path.match(/^\/api\/agents\/([a-f0-9]{16})$/);if(match&&method==='DELETE')return send(200,store.revoke(requireAuth(),match[1]));
   if(path==='/api/bounties'&&method==='GET')return send(200,store.list(auth?.account));
   if(path==='/api/bounties'&&method==='POST'){
    const actor=requireAuth();if(!payments)return send(201,store.create(actor,body,key));
    const preview=store.previewCreate(actor,body,key);if(preview.prior)return send(200,store.bounty(preview.prior.ref));
    if(body.reward===0)return send(201,store.create(actor,body,key,false,'zero-reward'));
    const operation=createHash('sha256').update(`${actor.account}:create:${key}`).digest('hex'),handler=payments.charge({amount:body.reward.toString(),recipient:runtime.escrowRecipient,externalId:operation,description:'Fund a War Machines bounty reward',expires:new Date(Date.now()+runtime.quoteTtlSeconds*1000),meta:{operation,kind:'reward-funding',environment:runtime.environment,chainId:String(runtime.network.chainId),currency:runtime.network.token,recipient:runtime.escrowRecipient,platformFeeBps:'250',feePolicyVersion:'gross-reward-v1'}}),result=await handler(fetchRequest(path,body));
    if(result.status===402)return forward(result.challenge);const proof=createHash('sha256').update(req.headers['payment-authorization']||'').digest('hex'),bounty=store.create(actor,body,key,false,proof);return paidResponse(result,201,bounty);
   }
   match=path.match(/^\/api\/bounties\/([a-f0-9-]{36})(?:\/(attempts|cancel))?$/);
   if(match){const [,bounty,action]=match;if(!action&&method==='GET')return send(200,store.bounty(bounty));if(action==='cancel'&&method==='POST')return send(200,store.cancel(requireAuth(),bounty));if(action==='attempts'&&method==='POST'){const actor=requireAuth();if(!payments){const a=store.accept(actor,bounty,body,key);send(202,a);setImmediate(pump);return;}const old=store.prior(actor.account,key,'enter:'+bounty,body);if(old)return send(200,store.attempt(old.ref,actor.account));const hold=store.preparePaidAttempt(actor,bounty,body,key,runtime.quoteTtlSeconds),terms=store.bounty(bounty);if(terms.entry===0){const accepted=store.acceptPaidAttempt(actor,hold.id,'zero-entry');send(202,accepted.attempt);setImmediate(pump);return;}const handler=payments.charge({amount:terms.entry.toString(),recipient:runtime.entryRecipient,externalId:hold.id,description:`Official attempt: ${terms.title}`,expires:new Date(hold.expires),meta:{operation:hold.id,kind:'official-entry',bounty,blueprint:createHash('sha256').update(JSON.stringify(body.blueprint)).digest('hex'),grossReward:String(terms.reward),entry:String(terms.entry),platformFeeBps:String(terms.platformFeeBps),platformFee:String(terms.platformFee),winnerPayout:String(terms.payout),environment:runtime.environment,chainId:String(runtime.network.chainId),currency:runtime.network.token,recipient:runtime.entryRecipient,networkCost:'paid separately by payer'}}),result=await handler(fetchRequest(path,body));if(result.status===402)return forward(result.challenge);const proof=createHash('sha256').update(req.headers['payment-authorization']||'').digest('hex'),accepted=store.acceptPaidAttempt(actor,hold.id,proof);if(!accepted.accepted)return paidResponse(result,409,accepted);setImmediate(pump);return paidResponse(result,202,accepted.attempt);}}
   match=path.match(/^\/api\/attempts\/([a-f0-9-]{36})$/);if(match&&method==='GET')return send(200,store.attempt(match[1],auth?.account));
   throw new ApiError(404,'API route not found.');
  }catch(e){if(e.status===undefined)console.error('Request failed:',e.message);if(!res.headersSent)send(e.status||500,{error:e.status?e.message:'Server error. Retry with the same idempotency key.'});else res.end();}
 });
 server.requestTimeout=15000;server.headersTimeout=10000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});pump();
 return {server,store,config:runtime,url:`http://${host==='0.0.0.0'?'127.0.0.1':host}:${server.address().port}`,close:async()=>{stopping=true;clearInterval(timer);if(payoutTimer)clearInterval(payoutTimer);if(practiceWorker)await practiceWorker.terminate();if(worker){worker.removeAllListeners();await worker.terminate();worker=null;}await new Promise(r=>server.close(r));store.close();}};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const port=Number(process.env.PORT||8770),host=process.env.HOST||'127.0.0.1',url=`http://${host==='0.0.0.0'?'127.0.0.1':host}:${port}`;
 const openBrowser=url=>{const child=spawn(process.platform==='win32'?'explorer.exe':process.platform==='darwin'?'open':'xdg-open',[url],{stdio:'ignore',windowsHide:true});child.on('error',()=>{});child.unref();};
 let alreadyRunning=false;
 if(process.argv.includes('--open')){try{const response=await fetch(url+'/api/health',{signal:AbortSignal.timeout(1000)}),health=await response.json();alreadyRunning=response.ok&&health.app==='war-machines'&&health.engineHash===CLIENT_ENGINE_HASH;}catch{}}
 if(alreadyRunning){console.log(`Opening the running War Machines server: ${url}`);openBrowser(url);}else{
 const app=await startServer({port,host,...(process.env.DATABASE_PATH?{database:resolve(process.env.DATABASE_PATH)}:{})});
 console.log(`War Machines: ${app.url}\nMode: ${app.config.mode}. Database persists at ${app.config.database}. Ctrl+C to stop.`);
 if(process.argv.includes('--open'))openBrowser(app.url);
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void app.close().then(()=>process.exit(0)));
 }
}
